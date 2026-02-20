/**
 * Input Mapper for Meister
 * Handles MIDI routing modes and input mapping to actions
 */

import { InputEvent, MidiInputMapping, KeyboardMapping, MidiRoutingMode } from './input-actions.js';

/**
 * MidiDeviceConfig
 * Configuration for how a MIDI device should be handled
 */
export class MidiDeviceConfig {
    constructor(config = {}) {
        this.deviceName = config.deviceName || '';
        this.routingMode = config.routingMode || MidiRoutingMode.INPUT;
        this.routeToOutput = config.routeToOutput || '';  // Output device name for ROUTED mode
        this.routeChannel = config.routeChannel || -1;    // -1 = preserve channel
        this.enabled = config.enabled !== false;
    }

    toJSON() {
        return {
            deviceName: this.deviceName,
            routingMode: this.routingMode,
            routeToOutput: this.routeToOutput,
            routeChannel: this.routeChannel,
            enabled: this.enabled,
        };
    }
}

/**
 * InputMapper
 * Maps MIDI/keyboard inputs to actions or routes them directly
 */
export class InputMapper {
    constructor(controller) {
        this.controller = controller;
        this.midiMappings = [];      // Array of MidiInputMapping
        this.keyboardMappings = [];  // Array of KeyboardMapping
        this.deviceConfigs = new Map(); // deviceName -> MidiDeviceConfig
        this.learnMode = false;
        this.learnCallback = null;
    }

    /**
     * Process incoming MIDI message
     * @param {string} deviceName - MIDI device name
     * @param {Uint8Array} data - MIDI message data
     * @returns {InputEvent|null} - InputEvent if parsed, null if routed directly
     */
    processMidiMessage(deviceName, data) {
        if (!data || data.length === 0) return null;

        const status = data[0];
        const msgType = status & 0xF0;
        const channel = status & 0x0F;

        // Get device routing configuration
        const deviceConfig = this.deviceConfigs.get(deviceName);

        // If in learn mode, handle learning
        if (this.learnMode && this.learnCallback) {
            this.handleMidiLearn(deviceName, msgType, channel, data);
            return null;
        }

        // Check routing mode
        if (deviceConfig && deviceConfig.routingMode === MidiRoutingMode.ROUTED) {
            // Direct routing - pass through to output
            this.routeMidiDirect(deviceConfig, data);
            return null;
        }

        // INPUT mode - parse into actions
        let type, number, value;

        if (msgType === 0x90) { // Note On
            type = 'note';
            number = data[1];
            value = data[2];
        } else if (msgType === 0x80) { // Note Off
            type = 'note';
            number = data[1];
            value = 0;
        } else if (msgType === 0xB0) { // Control Change
            type = 'cc';
            number = data[1];
            value = data[2];
        } else {
            // Other MIDI messages not mapped to actions
            return null;
        }

        // Find matching mapping
        const mapping = this.findMidiMapping(deviceName, channel, number, type);
        if (mapping) {
            return mapping.createEvent(value);
        }

        return null;
    }

    /**
     * Route MIDI message directly to output device
     * @param {MidiDeviceConfig} deviceConfig - Device configuration
     * @param {Uint8Array} data - MIDI message data
     */
    routeMidiDirect(deviceConfig, data) {
        if (!deviceConfig.routeToOutput || !this.controller.midiOutput) {
            return;
        }

        // Get output device name
        const targetOutput = deviceConfig.routeToOutput;

        // If channel routing is specified, modify the message
        let outputData = data;
        if (deviceConfig.routeChannel !== -1) {
            const status = data[0];
            const msgType = status & 0xF0;
            const newStatus = msgType | (deviceConfig.routeChannel & 0x0F);
            outputData = new Uint8Array(data);
            outputData[0] = newStatus;
        }

        // Send to output
        // TODO: Support multiple output devices, not just the selected one
        console.log(`[Route] ${deviceConfig.deviceName} -> ${targetOutput}`, outputData);

        try {
            this.controller.midiOutput.send(outputData);
        } catch (err) {
            console.error('Failed to route MIDI:', err);
        }
    }

    /**
     * Find MIDI mapping for given parameters
     * @param {string} deviceName - MIDI device name
     * @param {number} channel - MIDI channel (0-15)
     * @param {number} number - Note or CC number
     * @param {string} type - 'note' or 'cc'
     * @returns {MidiInputMapping|null}
     */
    findMidiMapping(deviceName, channel, number, type) {
        for (const mapping of this.midiMappings) {
            if (mapping.matches(deviceName, channel, number, type)) {
                return mapping;
            }
        }
        return null;
    }

    /**
     * Process keyboard event
     * @param {KeyboardEvent} event - Keyboard event
     * @returns {InputEvent|null}
     */
    processKeyboardEvent(event) {
        // Skip if target is input field
        if (event.target.tagName === 'INPUT' ||
            event.target.tagName === 'TEXTAREA' ||
            event.target.isContentEditable) {
            return null;
        }

        // Find matching keyboard mapping
        for (const mapping of this.keyboardMappings) {
            if (mapping.matches(event)) {
                event.preventDefault();
                return mapping.createEvent();
            }
        }

        return null;
    }

    /**
     * Add MIDI mapping
     * @param {MidiInputMapping} mapping
     */
    addMidiMapping(mapping) {
        this.midiMappings.push(mapping);
    }

    /**
     * Remove MIDI mapping
     * @param {number} index - Mapping index
     */
    removeMidiMapping(index) {
        if (index >= 0 && index < this.midiMappings.length) {
            this.midiMappings.splice(index, 1);
        }
    }

    /**
     * Clear all MIDI mappings
     */
    clearMidiMappings() {
        this.midiMappings = [];
    }

    /**
     * Add keyboard mapping
     * @param {KeyboardMapping} mapping
     */
    addKeyboardMapping(mapping) {
        this.keyboardMappings.push(mapping);
    }

    /**
     * Remove keyboard mapping
     * @param {number} index - Mapping index
     */
    removeKeyboardMapping(index) {
        if (index >= 0 && index < this.keyboardMappings.length) {
            this.keyboardMappings.splice(index, 1);
        }
    }

    /**
     * Clear all keyboard mappings
     */
    clearKeyboardMappings() {
        this.keyboardMappings = [];
    }

    /**
     * Set device configuration
     * @param {string} deviceName - MIDI device name
     * @param {MidiDeviceConfig} config - Device configuration
     */
    setDeviceConfig(deviceName, config) {
        this.deviceConfigs.set(deviceName, config);
    }

    /**
     * Get device configuration
     * @param {string} deviceName - MIDI device name
     * @returns {MidiDeviceConfig}
     */
    getDeviceConfig(deviceName) {
        return this.deviceConfigs.get(deviceName) || new MidiDeviceConfig({ deviceName });
    }

    /**
     * Remove device configuration
     * @param {string} deviceName - MIDI device name
     */
    removeDeviceConfig(deviceName) {
        this.deviceConfigs.delete(deviceName);
    }

    /**
     * Enable MIDI learn mode
     * @param {Function} callback - Callback(deviceName, channel, number, type)
     */
    enableLearnMode(callback) {
        this.learnMode = true;
        this.learnCallback = callback;
        console.log('[MIDI Learn] Enabled - move a control to learn');
    }

    /**
     * Disable MIDI learn mode
     */
    disableLearnMode() {
        this.learnMode = false;
        this.learnCallback = null;
        console.log('[MIDI Learn] Disabled');
    }

    /**
     * Handle MIDI learn
     * @param {string} deviceName - MIDI device name
     * @param {number} msgType - MIDI message type
     * @param {number} channel - MIDI channel
     * @param {Uint8Array} data - MIDI data
     */
    handleMidiLearn(deviceName, msgType, channel, data) {
        let type, number;

        if (msgType === 0x90 || msgType === 0x80) { // Note
            type = 'note';
            number = data[1];
        } else if (msgType === 0xB0) { // CC
            type = 'cc';
            number = data[1];
        } else {
            return; // Ignore other message types
        }

        if (this.learnCallback) {
            this.learnCallback(deviceName, channel, number, type);
            this.disableLearnMode();
        }
    }

    /**
     * Load default keyboard mappings
     */
    loadDefaultKeyboardMappings() {
        // Import after circular dependency resolution
        import('./input-actions.js').then(({ InputAction, KeyboardMapping }) => {
            this.keyboardMappings = [
                // Transport
                new KeyboardMapping({ key: ' ', action: InputAction.ACTION_REGROOVE_PLAY_PAUSE }),
                new KeyboardMapping({ key: 'Escape', code: 'Escape', action: InputAction.ACTION_REGROOVE_STOP }),

                // Navigation
                new KeyboardMapping({ key: '[', action: InputAction.ACTION_REGROOVE_ORDER_PREV }),
                new KeyboardMapping({ key: ']', action: InputAction.ACTION_REGROOVE_ORDER_NEXT }),

                // Files
                new KeyboardMapping({ key: 'PageDown', code: 'PageDown', action: InputAction.ACTION_REGROOVE_FILE_NEXT }),
                new KeyboardMapping({ key: 'PageUp', code: 'PageUp', action: InputAction.ACTION_REGROOVE_FILE_PREV }),

                // Clock
                new KeyboardMapping({ key: 'c', action: InputAction.ACTION_CLOCK_MASTER_TOGGLE }),
                new KeyboardMapping({ key: '+', action: InputAction.ACTION_CLOCK_BPM_INC }),
                new KeyboardMapping({ key: '-', action: InputAction.ACTION_CLOCK_BPM_DEC }),

                // Configuration
                new KeyboardMapping({ key: 's', ctrl: true, action: InputAction.ACTION_CONFIG_SAVE }),
            ];

            console.log('Loaded default keyboard mappings:', this.keyboardMappings.length);
        });
    }

    /**
     * Export configuration
     */
    toJSON() {
        return {
            midiMappings: this.midiMappings.map(m => ({
                deviceName: m.deviceName,
                type: m.type,
                channel: m.channel,
                number: m.number,
                action: m.action,
                parameter: m.parameter,
                continuous: m.continuous,
                threshold: m.threshold,
                routingMode: m.routingMode,
            })),
            keyboardMappings: this.keyboardMappings.map(m => ({
                key: m.key,
                code: m.code,
                action: m.action,
                parameter: m.parameter,
                ctrl: m.ctrl,
                shift: m.shift,
                alt: m.alt,
            })),
            deviceConfigs: Array.from(this.deviceConfigs.entries()).map(([name, config]) => ({
                name,
                ...config.toJSON(),
            })),
        };
    }

    /**
     * Import configuration
     */
    fromJSON(data) {
        if (!data) return;

        // Import after circular dependency resolution
        import('./input-actions.js').then(({ MidiInputMapping, KeyboardMapping }) => {
            // Load MIDI mappings
            if (data.midiMappings) {
                this.midiMappings = data.midiMappings.map(m => new MidiInputMapping(m));
                console.log('Loaded MIDI mappings:', this.midiMappings.length);
            }

            // Load keyboard mappings
            if (data.keyboardMappings) {
                this.keyboardMappings = data.keyboardMappings.map(m => new KeyboardMapping(m));
                console.log('Loaded keyboard mappings:', this.keyboardMappings.length);
            }

            // Load device configs
            if (data.deviceConfigs) {
                this.deviceConfigs.clear();
                for (const config of data.deviceConfigs) {
                    const { name, ...configData } = config;
                    this.deviceConfigs.set(name, new MidiDeviceConfig(configData));
                }
                console.log('Loaded device configs:', this.deviceConfigs.size);
            }
        });
    }
}
