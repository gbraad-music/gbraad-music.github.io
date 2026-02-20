/**
 * Browser implementation of MIDI-RTC
 * Uses native WebRTC APIs available in modern browsers
 */

import { MIDIRTCConnection } from '../core/connection.js';
import { ICE_CONFIG } from '../core/protocol.js';

/**
 * Browser-specific MIDI-RTC connection
 */
export class BrowserMIDIRTC extends MIDIRTCConnection {
    /**
     * Create peer connection using browser's RTCPeerConnection
     */
    createPeerConnection() {
        return new RTCPeerConnection(ICE_CONFIG);
    }

    /**
     * Initialize with optional Web MIDI API integration
     * @param {Object} options - Configuration options
     * @param {boolean} options.autoConnectMIDI - Auto-connect to Web MIDI inputs (sender only)
     * @param {boolean} options.sysex - Request SysEx access
     */
    async initialize(options = {}) {
        await super.initialize();

        // If sender and autoConnectMIDI is true, connect to Web MIDI
        if (this.role === 'sender' && options.autoConnectMIDI !== false) {
            await this.connectWebMIDI(options.sysex !== false);
        }
    }

    /**
     * Connect to Web MIDI API (sender only)
     * @param {boolean} sysex - Request SysEx access
     */
    async connectWebMIDI(sysex = true) {
        if (!navigator.requestMIDIAccess) {
            this.log('Web MIDI API not supported');
            return false;
        }

        try {
            this.midiAccess = await navigator.requestMIDIAccess({ sysex });
            this.log('Web MIDI access granted');
            this.setupMIDIInputs();
            return true;
        } catch (error) {
            this.log('Web MIDI access denied:', error);
            this.handleError(error);
            return false;
        }
    }

    /**
     * Setup Web MIDI input listeners
     */
    setupMIDIInputs() {
        if (!this.midiAccess) return;

        // Listen to all MIDI inputs
        this.midiAccess.inputs.forEach((input) => {
            this.log('Listening to MIDI input:', input.name);

            input.onmidimessage = (message) => {
                this.sendMIDI(message.data, message.timeStamp);
            };
        });

        // Handle device changes (hot-plug)
        this.midiAccess.onstatechange = (e) => {
            this.log('MIDI device state changed:', e.port.name, e.port.state);

            if (e.port.state === 'connected' && e.port.type === 'input') {
                e.port.onmidimessage = (message) => {
                    this.sendMIDI(message.data, message.timeStamp);
                };
            }
        };
    }

    /**
     * Get list of MIDI inputs
     * @returns {Array} Array of MIDI input devices
     */
    getMIDIInputs() {
        if (!this.midiAccess) return [];

        const inputs = [];
        this.midiAccess.inputs.forEach((input) => {
            inputs.push({
                id: input.id,
                name: input.name,
                manufacturer: input.manufacturer,
                state: input.state,
                connection: input.connection
            });
        });
        return inputs;
    }

    /**
     * Close connection and cleanup
     */
    close() {
        // Cleanup Web MIDI
        if (this.midiAccess) {
            this.midiAccess.inputs.forEach((input) => {
                input.onmidimessage = null;
            });
            this.midiAccess.onstatechange = null;
            this.midiAccess = null;
        }

        super.close();
    }
}

// Export for browser usage (can be used with <script type="module">)
export default BrowserMIDIRTC;
