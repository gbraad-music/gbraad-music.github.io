/**
 * Electron implementation of MIDI-RTC
 * Can use both browser APIs (in renderer) and Node.js APIs (in main process)
 */

import { MIDIRTCConnection } from '../core/connection.js';
import { ICE_CONFIG } from '../core/protocol.js';

/**
 * Electron-specific MIDI-RTC connection
 * Automatically detects if running in renderer or main process
 */
export class ElectronMIDIRTC extends MIDIRTCConnection {
    constructor(role, options = {}) {
        super(role, options);

        // Detect environment
        this.isRenderer = typeof window !== 'undefined' && window.process && window.process.type === 'renderer';
        this.isMain = !this.isRenderer && typeof process !== 'undefined' && process.versions && process.versions.electron;

        this.log(`Running in ${this.isRenderer ? 'renderer' : 'main'} process`);

        // RTP-MIDI session (only available in main process with node-rtpmidi)
        this.rtpMidiSession = null;
        this.rtpMidiEnabled = false;

        // MIDI Bridging configuration
        this.bridgeConfig = {
            webrtcToRtpMidi: options.bridgeWebRTCtoRTPMIDI !== false,  // Default: true
            rtpMidiToWebRTC: options.bridgeRTPMIDItoWebRTC !== false,  // Default: true
            usbToWebRTC: options.bridgeUSBtoWebRTC !== false,          // Default: true
            usbToRtpMidi: options.bridgeUSBtoRTPMIDI !== false,        // Default: true
            ...options.bridgeConfig
        };
    }

    /**
     * Create peer connection
     * Uses native RTCPeerConnection in renderer, wrtc in main process
     */
    createPeerConnection() {
        if (this.isRenderer) {
            // Use browser's RTCPeerConnection in renderer
            return new RTCPeerConnection(ICE_CONFIG);
        } else {
            // Use wrtc in main process
            if (!this.wrtc) {
                throw new Error('wrtc library required in main process. Install: npm install wrtc');
            }
            return new this.wrtc.RTCPeerConnection(ICE_CONFIG);
        }
    }

    /**
     * Initialize connection
     */
    async initialize(options = {}) {
        // Load wrtc if in main process
        if (this.isMain) {
            try {
                const wrtcModule = await import('wrtc');
                this.wrtc = wrtcModule;
                this.log('Loaded wrtc library (main process)');
            } catch (error) {
                throw new Error('Failed to load wrtc in main process. Install with: npm install wrtc');
            }
        }

        await super.initialize();

        // Connect to MIDI if requested
        if (this.role === 'sender' && options.autoConnectMIDI !== false) {
            await this.connectMIDI(options.sysex !== false);
        }

        // Connect to RTP-MIDI if requested (main process only)
        if (this.isMain && options.enableRtpMidi !== false) {
            await this.connectRtpMidi(options.rtpMidiOptions || {});
        }

        // Set up automatic MIDI bridging between all transports
        this.setupMIDIBridging();
    }

    /**
     * Setup automatic MIDI bridging between all transports
     * WebRTC ↔ RTP-MIDI ↔ USB MIDI (all interconnected)
     * Configurable via bridgeConfig options
     */
    setupMIDIBridging() {
        // Bridge incoming WebRTC MIDI to RTP-MIDI and local outputs
        this.onMIDIMessage = (message) => {
            this.log('WebRTC received:', message.data);

            // Forward to RTP-MIDI if enabled and configured
            if (this.isMain && this.rtpMidiEnabled && this.bridgeConfig.webrtcToRtpMidi) {
                this.sendMIDI(message.data, message.timestamp, 'webrtc');
                this.log('  → Bridged to RTP-MIDI');
            }

            // Note: Could also forward to local MIDI outputs here
            // if (this.midiOutputs && this.bridgeConfig.webrtcToUSB) {
            //     this.midiOutputs.forEach(output => output.sendMessage(message.data));
            // }
        };
    }

    /**
     * Connect to MIDI
     * Uses Web MIDI API in renderer, node-midi in main process
     */
    async connectMIDI(sysex = true) {
        if (this.isRenderer) {
            // Use Web MIDI API in renderer
            return await this.connectWebMIDI(sysex);
        } else {
            // Use node-midi in main process
            return await this.connectNodeMIDI();
        }
    }

    /**
     * Connect to Web MIDI API (renderer process)
     */
    async connectWebMIDI(sysex = true) {
        if (!navigator.requestMIDIAccess) {
            this.log('Web MIDI API not supported');
            return false;
        }

        try {
            this.midiAccess = await navigator.requestMIDIAccess({ sysex });
            this.log('Web MIDI access granted');
            this.setupWebMIDIInputs();
            return true;
        } catch (error) {
            this.log('Web MIDI access denied:', error);
            this.handleError(error);
            return false;
        }
    }

    /**
     * Setup Web MIDI inputs (renderer process)
     */
    setupWebMIDIInputs() {
        if (!this.midiAccess) return;

        this.midiAccess.inputs.forEach((input) => {
            this.log('Listening to MIDI input:', input.name);
            input.onmidimessage = (message) => {
                // Determine virtual channel from device name (or use default)
                const channel = this.getChannelForDevice(input.name);
                this.sendMIDI(message.data, message.timeStamp, channel);
            };
        });

        this.midiAccess.onstatechange = (e) => {
            this.log('MIDI device state changed:', e.port.name, e.port.state);
            if (e.port.state === 'connected' && e.port.type === 'input') {
                e.port.onmidimessage = (message) => {
                    this.sendMIDI(message.data, message.timeStamp, 'usb');
                };
            }
        };
    }

    /**
     * Connect to node-midi (main process)
     */
    async connectNodeMIDI() {
        try {
            const midiModule = await import('midi');
            this.midi = midiModule;
            this.log('Loaded midi library (main process)');
            this.setupNodeMIDIInputs();
            return true;
        } catch (error) {
            this.log('Failed to load midi library. Install with: npm install midi');
            return false;
        }
    }

    /**
     * Setup node-midi inputs (main process)
     */
    setupNodeMIDIInputs() {
        if (!this.midi) return;

        const input = new this.midi.Input();
        const portCount = input.getPortCount();
        this.log(`Found ${portCount} MIDI input ports`);

        if (portCount === 0) {
            this.log('No MIDI input devices found');
            return;
        }

        this.midiInputs = [];

        for (let i = 0; i < portCount; i++) {
            const portName = input.getPortName(i);
            this.log(`Opening MIDI port ${i}: ${portName}`);

            const portInput = new this.midi.Input();
            portInput.on('message', (deltaTime, message) => {
                this.sendMIDI(new Uint8Array(message), performance.now(), 'usb');
            });

            portInput.openPort(i);
            this.midiInputs.push(portInput);
        }
    }

    /**
     * Get list of MIDI inputs
     */
    getMIDIInputs() {
        if (this.isRenderer && this.midiAccess) {
            // Web MIDI API
            const inputs = [];
            this.midiAccess.inputs.forEach((input) => {
                inputs.push({
                    id: input.id,
                    name: input.name,
                    manufacturer: input.manufacturer,
                    state: input.state
                });
            });
            return inputs;
        } else if (this.isMain && this.midi) {
            // node-midi
            const input = new this.midi.Input();
            const portCount = input.getPortCount();
            const inputs = [];

            for (let i = 0; i < portCount; i++) {
                inputs.push({
                    id: i,
                    name: input.getPortName(i)
                });
            }
            return inputs;
        }

        return [];
    }

    /**
     * Connect to RTP-MIDI (main process only)
     * Uses node-rtpmidi library for AppleMIDI/RTP-MIDI protocol
     */
    async connectRtpMidi(options = {}) {
        if (!this.isMain) {
            this.log('RTP-MIDI only available in main process');
            return false;
        }

        try {
            // Try to load node-rtpmidi (optional dependency)
            const rtpmidiModule = await import('rtpmidi');
            this.rtpmidi = rtpmidiModule.default || rtpmidiModule;
            this.log('Loaded rtpmidi library (RTP-MIDI support)');

            // Create RTP-MIDI session
            const sessionOptions = {
                localName: options.localName || 'MIDI-RTC',
                bonjourName: options.bonjourName || 'MIDI-RTC',
                port: options.port || 5004,
                ...options
            };

            this.rtpMidiSession = this.rtpmidi.manager.createSession(sessionOptions);
            this.log(`RTP-MIDI session created: ${sessionOptions.localName} on port ${sessionOptions.port}`);

            // Handle incoming RTP-MIDI messages
            this.rtpMidiSession.on('message', (deltaTime, message) => {
                this.log('RTP-MIDI received:', message);
                // Forward to WebRTC data channel (mark source to prevent loop)
                this.sendMIDI(new Uint8Array(message), performance.now(), 'rtpmidi');
            });

            // Handle RTP-MIDI connection events
            this.rtpMidiSession.on('streamAdded', (stream) => {
                this.log('RTP-MIDI peer connected:', stream.name);
            });

            this.rtpMidiSession.on('streamRemoved', (stream) => {
                this.log('RTP-MIDI peer disconnected:', stream.name);
            });

            this.rtpMidiEnabled = true;
            return true;

        } catch (error) {
            this.log('RTP-MIDI not available (rtpmidi not installed):', error.message);
            this.log('  To enable RTP-MIDI: npm install rtpmidi');
            return false;
        }
    }

    /**
     * Send MIDI to RTP-MIDI network
     */
    sendMIDItoRtpMidi(data) {
        if (!this.rtpMidiEnabled || !this.rtpMidiSession) {
            return false;
        }

        try {
            // Convert Uint8Array to regular array for rtpmidi
            const message = Array.from(data);
            this.rtpMidiSession.sendMessage(message);
            return true;
        } catch (error) {
            this.log('Failed to send to RTP-MIDI:', error);
            return false;
        }
    }

    /**
     * Get virtual channel for a MIDI device (can be customized)
     * @param {string} deviceName - MIDI device name
     * @returns {string} Virtual channel identifier
     */
    getChannelForDevice(deviceName) {
        // Default channel mapping (can be overridden via options.channelMapping)
        const name = deviceName.toLowerCase();

        if (name.includes('keyboard') || name.includes('piano')) return 'synth';
        if (name.includes('launchpad') || name.includes('apc') || name.includes('fighter')) return 'control';
        if (name.includes('clock') || name.includes('sync')) return 'clock';

        // Check custom mapping
        if (this.options.channelMapping) {
            for (const [pattern, channel] of Object.entries(this.options.channelMapping)) {
                if (name.includes(pattern.toLowerCase())) {
                    return channel;
                }
            }
        }

        return 'default';  // Fallback
    }

    /**
     * Override sendMIDI to support virtual channels and bridging
     * @param {Uint8Array} data - MIDI data
     * @param {number} timestamp - MIDI timestamp
     * @param {string} channelOrSource - Virtual channel OR source (for backwards compat)
     */
    sendMIDI(data, timestamp, channelOrSource = 'default') {
        // Determine if this is a channel or source (backwards compatibility)
        const isSource = ['usb', 'rtpmidi', 'webrtc'].includes(channelOrSource);
        const channel = isSource ? 'default' : channelOrSource;
        const source = isSource ? channelOrSource : 'usb';

        // Send via WebRTC - unless it came from WebRTC or bridging is disabled
        if (source !== 'webrtc') {
            const shouldSendToWebRTC =
                (source === 'usb' && this.bridgeConfig.usbToWebRTC) ||
                (source === 'rtpmidi' && this.bridgeConfig.rtpMidiToWebRTC);

            if (shouldSendToWebRTC) {
                super.sendMIDI(data, timestamp, channel);  // Include virtual channel
            }
        }

        // Send via RTP-MIDI - unless it came from RTP-MIDI or bridging is disabled
        if (this.isMain && this.rtpMidiEnabled && source !== 'rtpmidi') {
            const shouldSendToRtpMidi =
                (source === 'usb' && this.bridgeConfig.usbToRtpMidi) ||
                (source === 'webrtc' && this.bridgeConfig.webrtcToRtpMidi);

            if (shouldSendToRtpMidi) {
                this.sendMIDItoRtpMidi(data);
            }
        }
    }

    /**
     * Close connection and cleanup
     */
    close() {
        // Cleanup Web MIDI (renderer)
        if (this.midiAccess) {
            this.midiAccess.inputs.forEach((input) => {
                input.onmidimessage = null;
            });
            this.midiAccess.onstatechange = null;
            this.midiAccess = null;
        }

        // Cleanup node-midi (main)
        if (this.midiInputs) {
            this.midiInputs.forEach(input => {
                input.closePort();
            });
            this.midiInputs = null;
        }

        // Cleanup RTP-MIDI (main)
        if (this.rtpMidiSession) {
            this.log('Closing RTP-MIDI session');
            this.rtpMidiSession.end();
            this.rtpMidiSession = null;
            this.rtpMidiEnabled = false;
        }

        super.close();
    }
}

// Export for Electron usage
export default ElectronMIDIRTC;
