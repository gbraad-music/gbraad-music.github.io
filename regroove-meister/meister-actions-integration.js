/**
 * Meister Action System Integration
 * Extends MeisterController with action trigger capabilities
 */

import { InputEvent, PadActionConfig, MidiInputMapping, KeyboardMapping, InputAction } from './input-actions.js';
import { ActionDispatcher } from './action-dispatcher.js';
import { InputMapper } from './input-mapper.js';

/**
 * Integrate action system into MeisterController
 * Call this after MeisterController is initialized
 */
export function integrateActionSystem(controller) {
    console.log('[Actions] Integrating action system into MeisterController...');

    // Create action dispatcher and input mapper
    controller.actionDispatcher = new ActionDispatcher(controller);
    controller.inputMapper = new InputMapper(controller);

    // Load default keyboard mappings
    controller.inputMapper.loadDefaultKeyboardMappings();

    // Store original methods for compatibility
    controller._originalHandlePadPress = controller.handlePadPress;
    controller._originalHandleMIDIMessage = controller.handleMIDIMessage;
    controller._originalSetupUI = controller.setupUI;

    // === EXTEND MIDI MESSAGE HANDLING ===
    controller.handleMIDIMessage = function(event) {
        const data = event.data;
        const deviceName = event.target.name || 'Unknown Device';

        // Try to process as action input first
        const inputEvent = this.inputMapper.processMidiMessage(deviceName, data);
        if (inputEvent) {
            // Dispatch action
            this.actionDispatcher.handleEvent(inputEvent);
            return; // Don't process further
        }

        // Fall back to original handler (SPP, SysEx, etc.)
        this._originalHandleMIDIMessage.call(this, event);
    };

    // === EXTEND PAD PRESS HANDLING ===
    controller.handlePadPress = function(detail, padElement, padIndex) {
        // console.log(`[handlePadPress] Called with padIndex=${padIndex}, detail=`, detail);

        // Get pad config from the correct location (split scene vs default pads)
        const isCustomScene = this.currentPadSceneId && this.currentPadSceneId !== 'pads';
        let padConfig = null;
        if (isCustomScene) {
            const scene = this.sceneManager?.scenes.get(this.currentPadSceneId);
            padConfig = scene?.pads?.[padIndex];
            // console.log(`[handlePadPress] Split scene pad - scene="${this.currentPadSceneId}", padConfig=`, padConfig);
        } else {
            padConfig = this.config.pads[padIndex];
            // console.log(`[handlePadPress] Default pad - padConfig=`, padConfig);
        }

        if (!padConfig) {
            console.warn(`[handlePadPress] No config for pad ${padIndex}`);
            return;
        }

        // Create PadActionConfig
        const actionConfig = new PadActionConfig(padConfig);

        // Check if it's an action-based pad
        if (actionConfig.action && actionConfig.action !== InputAction.ACTION_NONE) {
            // New action system
            const event = new InputEvent(actionConfig.action, actionConfig.parameter, 127);
            // Attach deviceId if present (for device sequencer actions)
            if (padConfig.deviceId) {
                event.deviceId = padConfig.deviceId;
            }
            this.actionDispatcher.handleEvent(event);
            return;
        }

        // Check if it's a legacy pad (CC/note/MMC)
        if (actionConfig.isLegacy()) {
            // Try to convert to action
            const convertedAction = actionConfig.toLegacyAction();
            if (convertedAction !== InputAction.ACTION_NONE) {
                const event = new InputEvent(actionConfig.action, actionConfig.parameter, 127);
                // Attach deviceBinding if present (for device-specific routing)
                if (padConfig.deviceBinding) {
                    event.deviceBinding = padConfig.deviceBinding;
                }
                // Attach noteProgram if present (for program change before note)
                if (padConfig.noteProgram !== undefined) {
                    event.noteProgram = padConfig.noteProgram;
                }
                this.actionDispatcher.handleEvent(event);
                return;
            }
        }

        // Fall back to original handler for backward compatibility (CC/Note/MMC/SysEx)
        this._originalHandlePadPress.call(this, detail, padElement, padIndex);
    };

    // === ADD KEYBOARD HANDLING ===
    controller.setupKeyboardHandling = function() {
        document.addEventListener('keydown', (event) => {
            const inputEvent = this.inputMapper.processKeyboardEvent(event);
            if (inputEvent) {
                this.actionDispatcher.handleEvent(inputEvent);
            }
        });
        console.log('[Actions] Keyboard handling enabled');
    };

    // === ADD HELPER METHODS FOR ACTION DISPATCHER ===

    /**
     * Send CC to a specific device instance
     * @param {number} deviceId - SysEx device ID (0-15)
     * @param {number} cc - CC number
     * @param {number} value - CC value
     */
    controller.sendCCToDevice = function(deviceId, cc, value) {
        if (!this.midiOutput) {
            console.warn('No MIDI output selected');
            return;
        }

        // Get device manager
        const deviceManager = this.deviceManager;
        if (!deviceManager) {
            // Fallback to default channel
            this.sendCC(cc, value);
            return;
        }

        // Find device by deviceId
        const devices = deviceManager.getAllDevices();
        const device = devices.find(d => d.deviceId === deviceId);

        if (device) {
            // Send CC on the device's MIDI channel
            const status = 0xB0 | device.midiChannel;
            this.midiOutput.send([status, cc, value]);
            console.log(`Sent CC ${cc}=${value} to Device ${deviceId} (Ch ${device.midiChannel + 1})`);
        } else {
            // Device not found, use default
            console.warn(`Device ${deviceId} not found, using default channel`);
            this.sendCC(cc, value);
        }
    };

    /**
     * Send Regroove CC message
     * Helper method for action dispatcher
     */
    controller.sendRegrooveCC = function(cc, value, deviceId = null) {
        if (deviceId !== null) {
            this.sendCCToDevice(deviceId, cc, value);
        } else {
            this.sendCC(cc, value);
        }
    };

    /**
     * Send MIDI CC message
     * Helper method for action dispatcher
     */
    controller.sendMidiCC = function(cc, value, deviceId = null) {
        if (deviceId !== null) {
            this.sendCCToDevice(deviceId, cc, value);
        } else {
            this.sendCC(cc, value);
        }
    };

    /**
     * Send MIDI note
     * Helper method for action dispatcher
     */
    controller.sendMidiNote = function(note, velocity) {
        this.sendNote(note, velocity);
    };

    /**
     * Send program change
     */
    controller.sendProgramChange = function(program) {
        if (this.midiOutput) {
            const status = 0xC0 | this.midiChannel; // Program Change with channel
            this.midiOutput.send([status, program]);
            console.log(`Sent Program Change ${program} on channel ${this.midiChannel + 1}`);
        } else {
            console.warn('No MIDI output selected');
        }
    };

    /**
     * Toggle clock master
     */
    controller.toggleClockMaster = function() {
        this.clockMaster = !this.clockMaster;

        if (this.clockMaster) {
            this.startClock();
            console.log('[Clock] Master enabled');
        } else {
            this.stopClock();
            console.log('[Clock] Master disabled');
        }

        // Update config
        this.config.clockMaster = this.clockMaster;
        this.saveConfig();
    };

    /**
     * Set BPM
     */
    controller.setBPM = function(bpm) {
        bpm = Math.max(20, Math.min(300, bpm)); // Clamp to valid range
        this.clockBPM = bpm;
        this.config.bpm = bpm;

        // Restart clock if running
        if (this.clockMaster && this.midiOutput) {
            this.stopClock();
            this.startClock();
        }

        console.log(`[Clock] BPM set to ${bpm}`);
        this.saveConfig();
    };

    // === EXTEND CONFIG SAVE/LOAD ===
    controller._originalSaveConfig = controller.saveConfig;
    controller.saveConfig = function() {
        // Save action mappings
        const actionConfig = {
            inputMapper: this.inputMapper.toJSON(),
            macros: this.actionDispatcher.getMacros(),
        };

        this.config.actions = actionConfig;

        // Call original save
        this._originalSaveConfig.call(this);
    };

    controller._originalLoadConfig = controller.loadConfig;
    controller.loadConfig = function() {
        // Call original load
        this._originalLoadConfig.call(this);

        // Load action mappings
        if (this.config.actions) {
            this.inputMapper.fromJSON(this.config.actions.inputMapper);

            // Load macros
            if (this.config.actions.macros) {
                this.actionDispatcher.clearMacros();
                for (const macro of this.config.actions.macros) {
                    // TODO: Reconstruct InputEvent objects from saved data
                    console.log(`[Actions] Macro ${macro.id} has ${macro.actions} actions`);
                }
            }
        }
    };

    // DISABLED: Keyboard handling conflicts with sequencer editor
    // controller.setupKeyboardHandling();

    console.log('[Actions] Action system integration complete');
    return controller;
}

/**
 * Create default action-based configuration
 * This replaces CC-based pads with action-based pads
 */
export function createDefaultActionConfig() {
    return {
        version: "2.0", // New version with action support
        gridLayout: "4x4",
        midiChannel: 0,
        pads: [
            { label: "PLAY\nPAUSE", action: InputAction.ACTION_REGROOVE_PLAY_PAUSE },
            { label: "STOP", action: InputAction.ACTION_REGROOVE_STOP },
            { label: "RETRIG", action: InputAction.ACTION_REGROOVE_RETRIGGER },
            { label: "LOOP\nTOGGLE", action: InputAction.ACTION_REGROOVE_LOOP_TOGGLE },

            { label: "PREV\nORDER", action: InputAction.ACTION_REGROOVE_ORDER_PREV },
            { label: "NEXT\nORDER", action: InputAction.ACTION_REGROOVE_ORDER_NEXT },
            { label: "SYNC\nTEMPO", action: InputAction.ACTION_REGROOVE_SYNC_TEMPO_TOGGLE },
            { label: "RECV\nSTART", action: InputAction.ACTION_REGROOVE_SYNC_TRANSPORT_TOGGLE },

            { label: "RECV\nSPP", action: InputAction.ACTION_REGROOVE_SYNC_SPP_TOGGLE },
            { label: "SEND\nCLOCK", action: InputAction.ACTION_REGROOVE_SYNC_RECEIVE_TOGGLE },
            { label: "SEND\nSTART", action: InputAction.ACTION_REGROOVE_SYNC_SEND_TOGGLE },
            { label: "CLOCK\nMASTER", action: InputAction.ACTION_CLOCK_MASTER_TOGGLE },

            { label: "FILE\nLOAD", action: InputAction.ACTION_REGROOVE_FILE_LOAD },
            { label: "FILE\nNEXT", action: InputAction.ACTION_REGROOVE_FILE_NEXT },
            { label: "FILE\nPREV", action: InputAction.ACTION_REGROOVE_FILE_PREV },
            { label: "RECORD", action: InputAction.ACTION_REGROOVE_RECORD_TOGGLE },
        ],
        actions: {
            inputMapper: {
                midiMappings: [],
                keyboardMappings: [],
                deviceConfigs: [],
            },
            macros: [],
        },
    };
}

/**
 * Migrate legacy CC-based config to action-based config
 */
export function migrateLegacyConfig(legacyConfig) {
    if (!legacyConfig || !legacyConfig.pads) {
        return createDefaultActionConfig();
    }

    const newConfig = {
        ...legacyConfig,
        version: "2.0",
        pads: legacyConfig.pads.map(pad => {
            const actionConfig = new PadActionConfig(pad);

            if (actionConfig.isLegacy()) {
                // Convert to action-based
                actionConfig.toLegacyAction();
                return actionConfig.toJSON();
            }

            return pad;
        }),
        actions: legacyConfig.actions || {
            inputMapper: {
                midiMappings: [],
                keyboardMappings: [],
                deviceConfigs: [],
            },
            macros: [],
        },
    };

    console.log('[Migration] Migrated legacy config to action-based config');
    return newConfig;
}
