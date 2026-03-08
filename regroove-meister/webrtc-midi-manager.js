/**
 * WebRTC-MIDI Manager for Meister
 * Enables receiving MIDI over WebRTC from remote MIDI bridges
 */

import { BrowserMIDIRTC } from './external/midi-rtc/platforms/browser.js';

export class WebRTCMIDIManager {
    constructor(options = {}) {
        this.options = {
            debug: options.debug !== false,
            ...options
        };

        // Connection instance
        this.connection = null;

        // Virtual MIDI inputs (simulated MIDI devices for device-manager)
        this.virtualInputs = new Map();

        // Virtual MIDI outputs (for sending MIDI over WebRTC)
        this.virtualOutputs = new Map();

        // Connection state
        this.isConnected = false;
        this.connectionState = 'disconnected';

        // Event handlers
        this.onMIDIMessage = null;  // Called when MIDI received
        this.onConnectionStateChange = null;  // Called when connection state changes
        this.onTargetDiscovered = null;  // Called when new target/device discovered

        // Statistics
        this.stats = {
            messagesReceived: 0,
            bytesReceived: 0,
            latency: 0
        };

        this.log('WebRTC-MIDI Manager initialized');
    }

    /**
     * Initialize as receiver
     */
    async initialize() {
        this.log('Initializing WebRTC-MIDI receiver');

        // Create MIDI-RTC connection in receiver mode
        this.connection = new BrowserMIDIRTC('receiver', {
            debug: this.options.debug,
            trunkMode: true,  // Receive all targets
            autoReconnect: true
        });

        await this.connection.initialize();

        // Setup event handlers
        this.connection.onMIDIMessage = (message) => {
            this.handleMIDIMessage(message);
        };

        this.connection.onConnectionStateChange = (state) => {
            this.handleConnectionStateChange(state);
        };

        this.log('WebRTC-MIDI receiver ready');
    }

    /**
     * Handle incoming MIDI message
     */
    handleMIDIMessage(message) {
        const { data, timestamp, target, latency } = message;

        this.stats.messagesReceived++;
        this.stats.bytesReceived += data.length;
        this.stats.latency = latency;

        // Ensure virtual input exists for this target
        if (!this.virtualInputs.has(target)) {
            this.createVirtualInput(target);
        }

        // Get virtual input for this target
        const virtualInput = this.virtualInputs.get(target);

        // Trigger MIDI message on virtual input
        if (virtualInput && virtualInput.onmidimessage) {
            virtualInput.onmidimessage({
                data: data,
                timeStamp: timestamp,
                target: target
            });
        }

        // Also call global handler if set
        if (this.onMIDIMessage) {
            this.onMIDIMessage({
                data: data,
                timeStamp: timestamp,
                target: target,
                latency: latency
            });
        }
    }

    /**
     * Create virtual MIDI input for a target
     */
    createVirtualInput(target) {
        this.log(`Creating virtual MIDI input for target: ${target}`);

        const virtualInput = {
            id: `webrtc-midi-${target}`,
            name: `WebRTC MIDI (${target})`,
            manufacturer: 'WebRTC',
            type: 'input',
            state: 'connected',
            connection: 'open',
            target: target,
            onmidimessage: null,

            // Additional methods for compatibility
            addEventListener: function(event, handler) {
                if (event === 'midimessage') {
                    this.onmidimessage = handler;
                }
            },

            removeEventListener: function(event, handler) {
                if (event === 'midimessage') {
                    this.onmidimessage = null;
                }
            }
        };

        this.virtualInputs.set(target, virtualInput);

        // Notify listeners that a new target/device was discovered
        if (this.onTargetDiscovered) {
            this.onTargetDiscovered(target, virtualInput);
        }

        return virtualInput;
    }

    /**
     * Get virtual MIDI input by target
     */
    getVirtualInput(target) {
        return this.virtualInputs.get(target);
    }

    /**
     * Get all virtual MIDI inputs
     */
    getVirtualInputs() {
        return Array.from(this.virtualInputs.values());
    }

    /**
     * Create virtual MIDI output for a target
     */
    createVirtualOutput(target) {
        this.log(`Creating virtual MIDI output for target: ${target}`);

        const virtualOutput = {
            id: `webrtc-midi-out-${target}`,
            name: `WebRTC MIDI Out (${target})`,
            manufacturer: 'WebRTC',
            type: 'output',
            state: 'connected',
            connection: 'open',
            target: target,

            // Send method that routes to WebRTC
            send: (data, timestamp) => {
                this.sendMIDI(data, timestamp, target);
            },

            // Clear method (noop for WebRTC)
            clear: () => {}
        };

        this.virtualOutputs.set(target, virtualOutput);
        return virtualOutput;
    }

    /**
     * Send MIDI data over WebRTC
     */
    sendMIDI(data, timestamp, target = 'default') {
        if (!this.connection || !this.connection.isConnected()) {
            this.log('Cannot send MIDI - not connected');
            return false;
        }

        // Convert data to Uint8Array if needed
        const midiData = data instanceof Uint8Array ? data : new Uint8Array(data);

        // Send via connection
        this.connection.sendMIDI(midiData, timestamp || performance.now(), target);
        this.log(`Sent MIDI to target ${target}:`, Array.from(midiData));

        return true;
    }

    /**
     * Get virtual MIDI output by target
     */
    getVirtualOutput(target) {
        return this.virtualOutputs.get(target);
    }

    /**
     * Get all virtual MIDI outputs
     */
    getVirtualOutputs() {
        return Array.from(this.virtualOutputs.values());
    }

    /**
     * Handle connection state change
     */
    handleConnectionStateChange(state) {
        this.log('Connection state changed:', state);
        this.connectionState = state;
        this.isConnected = (state === 'connected');

        if (this.onConnectionStateChange) {
            this.onConnectionStateChange(state);
        }

        // Create default virtual outputs when connected
        if (state === 'connected') {
            // Create outputs for common targets
            const defaultTargets = ['default', 'synth', 'control', 'feedback'];
            defaultTargets.forEach(target => {
                this.createVirtualOutput(target);
            });

            this.log('Created virtual MIDI outputs:', defaultTargets);
        }

        // Clear virtual devices on disconnect
        if (state === 'disconnected' || state === 'failed') {
            this.virtualInputs.clear();
            this.virtualOutputs.clear();
        }
    }

    /**
     * Process offer from sender and generate answer
     * @param {string} offerJSON - SDP offer from sender
     * @returns {Promise<string>} SDP answer
     */
    async processOffer(offerJSON) {
        if (!this.connection) {
            throw new Error('Connection not initialized. Call initialize() first.');
        }

        this.log('Processing offer from sender');
        const answerJSON = await this.connection.handleOffer(offerJSON);
        this.log('Answer generated');

        return answerJSON;
    }

    /**
     * Get connection statistics
     */
    getStats() {
        const connectionStats = this.connection ? this.connection.getStats() : {};

        return {
            ...this.stats,
            ...connectionStats,
            virtualInputs: this.virtualInputs.size,
            targets: Array.from(this.virtualInputs.keys())
        };
    }

    /**
     * Check if connected
     */
    get connected() {
        return this.isConnected && this.connection && this.connection.isConnected();
    }

    /**
     * Disconnect
     */
    disconnect() {
        if (this.connection) {
            this.connection.close();
            this.connection = null;
        }

        this.virtualInputs.clear();
        this.isConnected = false;
        this.connectionState = 'disconnected';

        this.log('Disconnected');
    }

    /**
     * Log message
     */
    log(...args) {
        if (this.options.debug) {
            console.log('[WebRTC-MIDI]', ...args);
        }
    }
}

export default WebRTCMIDIManager;
