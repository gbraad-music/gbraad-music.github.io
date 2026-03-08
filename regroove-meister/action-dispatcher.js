/**
 * Action Dispatcher for Meister
 * Handles execution of InputActions
 */

import { InputAction, ActionCategory, getActionCategory } from './input-actions.js';
import {
    buildPlaybackControlMessage,
    buildMuteMessage,
    buildSoloMessage,
    buildGetSequenceStateMessage,
    parseSequenceStateResponse,
    buildGetProgramStateMessage,
    parseProgramStateResponse
} from './midi-sequence-utils.js';

/**
 * ActionDispatcher
 * Central dispatcher for all input actions
 */
export class ActionDispatcher {
    constructor(controller) {
        this.controller = controller;
        this.macros = new Map(); // macro_id -> array of actions
        // Track device sequencer playback state: deviceId -> Set of playing slots (0-15)
        this.deviceSequencerState = new Map();
        // Track device program mixer state: deviceId -> {master, programs}
        this.deviceProgramState = new Map();
        // Periodic state polling
        this.statePollingInterval = null;
        this.statePollingIntervalMs = 2000; // Poll every 2 seconds
    }

    /**
     * Handle an InputEvent
     * @param {InputEvent} event - The input event to process
     */
    handleEvent(event) {
        if (!event || event.action === InputAction.ACTION_NONE) {
            console.warn('[ActionDispatcher] Received null/ACTION_NONE event');
            return;
        }

        const category = getActionCategory(event.action);
        const normalizedValue = event.getNormalizedValue();
        const meetsThreshold = event.meetsThreshold();

        // Log action for debugging
        // console.log(`[ActionDispatcher] Handling action ${event.action} (cat: ${category}, val: ${event.value}, param: ${event.parameter}, threshold: ${meetsThreshold})`);

        switch (event.action) {
            // === REGROOVE TRANSPORT CONTROL ===
            case InputAction.ACTION_REGROOVE_PLAY:
                if (meetsThreshold) {
                    this.controller.sendRegrooveCC(41, 127); // Play
                }
                break;

            case InputAction.ACTION_REGROOVE_STOP:
                if (meetsThreshold) {
                    this.controller.sendRegrooveCC(42, 127); // Stop
                }
                break;

            case InputAction.ACTION_REGROOVE_PLAY_PAUSE:
                if (meetsThreshold) {
                    this.controller.sendRegrooveCC(41, 127); // Play/Pause toggle
                }
                break;

            case InputAction.ACTION_REGROOVE_RETRIGGER:
                if (meetsThreshold) {
                    this.controller.sendRegrooveCC(45, 127); // Retrigger
                }
                break;

            case InputAction.ACTION_REGROOVE_LOOP_TOGGLE:
                if (meetsThreshold) {
                    this.controller.sendRegrooveCC(46, 127); // Loop toggle
                }
                break;

            // === REGROOVE NAVIGATION ===
            case InputAction.ACTION_REGROOVE_ORDER_NEXT:
                if (meetsThreshold) {
                    this.controller.sendRegrooveCC(44, 127); // Next order
                }
                break;

            case InputAction.ACTION_REGROOVE_ORDER_PREV:
                if (meetsThreshold) {
                    this.controller.sendRegrooveCC(43, 127); // Previous order
                }
                break;

            case InputAction.ACTION_REGROOVE_ORDER_JUMP:
                if (meetsThreshold) {
                    // TODO: Implement order jump via SysEx
                    console.warn('ACTION_REGROOVE_ORDER_JUMP not yet implemented');
                }
                break;

            // === REGROOVE FILE OPERATIONS ===
            case InputAction.ACTION_REGROOVE_FILE_LOAD:
                if (meetsThreshold) {
                    this.controller.sendRegrooveCC(60, 127); // Load file
                }
                break;

            case InputAction.ACTION_REGROOVE_FILE_NEXT:
                if (meetsThreshold) {
                    this.controller.sendRegrooveCC(62, 127); // Next file
                }
                break;

            case InputAction.ACTION_REGROOVE_FILE_PREV:
                if (meetsThreshold) {
                    this.controller.sendRegrooveCC(61, 127); // Previous file
                }
                break;

            // === REGROOVE CHANNEL CONTROL ===
            case InputAction.ACTION_REGROOVE_CHANNEL_MUTE:
                if (meetsThreshold) {
                    const channel = event.parameter;
                    if (channel >= 0 && channel <= 7) {
                        this.controller.sendRegrooveCC(48 + channel, 127); // Mute channel
                    }
                }
                break;

            case InputAction.ACTION_REGROOVE_CHANNEL_SOLO:
                if (meetsThreshold) {
                    const channel = event.parameter;
                    if (channel >= 0 && channel <= 7) {
                        this.controller.sendRegrooveCC(32 + channel, 127); // Solo channel
                    }
                }
                break;

            case InputAction.ACTION_REGROOVE_CHANNEL_VOLUME:
                {
                    const channel = event.parameter;
                    if (channel >= 0 && channel <= 7) {
                        // TODO: Implement channel volume control (needs SysEx or dedicated CC range)
                        console.warn('ACTION_REGROOVE_CHANNEL_VOLUME not yet implemented');
                    }
                }
                break;

            case InputAction.ACTION_REGROOVE_MUTE_ALL:
                if (meetsThreshold) {
                    // Mute all channels
                    for (let i = 0; i < 8; i++) {
                        this.controller.sendRegrooveCC(48 + i, 127);
                    }
                }
                break;

            case InputAction.ACTION_REGROOVE_UNMUTE_ALL:
                if (meetsThreshold) {
                    // Unmute all channels (send again to toggle off)
                    for (let i = 0; i < 8; i++) {
                        this.controller.sendRegrooveCC(48 + i, 127);
                    }
                }
                break;

            // === REGROOVE MIDI SYNC ===
            case InputAction.ACTION_REGROOVE_SYNC_TEMPO_TOGGLE:
                if (meetsThreshold) {
                    this.controller.sendRegrooveCC(70, 127);
                }
                break;

            case InputAction.ACTION_REGROOVE_SYNC_TRANSPORT_TOGGLE:
                if (meetsThreshold) {
                    this.controller.sendRegrooveCC(71, 127);
                }
                break;

            case InputAction.ACTION_REGROOVE_SYNC_SPP_TOGGLE:
                if (meetsThreshold) {
                    this.controller.sendRegrooveCC(72, 127);
                }
                break;

            case InputAction.ACTION_REGROOVE_SYNC_RECEIVE_TOGGLE:
                if (meetsThreshold) {
                    this.controller.sendRegrooveCC(73, 127);
                }
                break;

            case InputAction.ACTION_REGROOVE_SYNC_SEND_TOGGLE:
                if (meetsThreshold) {
                    this.controller.sendRegrooveCC(74, 127);
                }
                break;

            // === REGROOVE PERFORMANCE ===
            case InputAction.ACTION_REGROOVE_RECORD_TOGGLE:
                if (meetsThreshold) {
                    this.controller.sendRegrooveCC(80, 127);
                }
                break;

            case InputAction.ACTION_REGROOVE_TAP_TEMPO:
                if (meetsThreshold) {
                    this.controller.sendRegrooveCC(81, 127);
                }
                break;

            // === REGROOVE MIXER CONTROL ===
            case InputAction.ACTION_REGROOVE_MASTER_VOLUME:
                {
                    const deviceId = event.deviceId || 0;
                    this.controller.sendSysExMasterVolume(deviceId, event.value);
                }
                break;

            case InputAction.ACTION_REGROOVE_MASTER_PAN:
                {
                    const deviceId = event.deviceId || 0;
                    this.controller.sendSysExMasterPanning(deviceId, event.value);
                }
                break;

            case InputAction.ACTION_REGROOVE_MASTER_MUTE:
                if (meetsThreshold) {
                    const deviceId = event.deviceId || 0;
                    this.controller.sendSysExMasterMute(deviceId, 1); // Toggle
                }
                break;

            case InputAction.ACTION_REGROOVE_INPUT_VOLUME:
                {
                    const deviceId = event.deviceId || 0;
                    this.controller.sendSysExInputVolume(deviceId, event.value);
                }
                break;

            case InputAction.ACTION_REGROOVE_INPUT_PAN:
                {
                    const deviceId = event.deviceId || 0;
                    this.controller.sendSysExInputPanning(deviceId, event.value);
                }
                break;

            case InputAction.ACTION_REGROOVE_INPUT_MUTE:
                if (meetsThreshold) {
                    const deviceId = event.deviceId || 0;
                    this.controller.sendSysExInputMute(deviceId, 1); // Toggle
                }
                break;

            case InputAction.ACTION_REGROOVE_CHANNEL_PAN:
                {
                    const channel = event.parameter;
                    const deviceId = event.deviceId || 0;
                    if (channel >= 0 && channel <= 63) {
                        this.controller.sendSysExChannelPanning(deviceId, channel, event.value);
                    }
                }
                break;

            case InputAction.ACTION_REGROOVE_FX_ROUTING:
                {
                    const route = event.parameter; // 0=off, 1=master, 2=playback, 3=input
                    const deviceId = event.deviceId || 0;
                    if (route >= 0 && route <= 3) {
                        this.controller.sendSysExFxSetRoute(deviceId, route);
                    }
                }
                break;

            case InputAction.ACTION_REGROOVE_TEMPO_SET:
                {
                    const deviceId = event.deviceId || 0;
                    // Map 0-127 to 20-300 BPM
                    const bpm = Math.round(20 + (event.value / 127) * 280);
                    this.controller.sendSysExSetTempo(deviceId, bpm);
                }
                break;

            case InputAction.ACTION_REGROOVE_STEREO_SEP:
                {
                    const deviceId = event.deviceId || 0;
                    this.controller.sendSysExStereoSeparation(deviceId, event.value);
                }
                break;

            // === REGROOVE EFFECTS CONTROL ===
            case InputAction.ACTION_REGROOVE_FX_ENABLE:
                {
                    const effectId = event.parameter;
                    const deviceId = event.deviceId || 0;
                    const programId = event.programId || 0;
                    const enabled = meetsThreshold;

                    // Get current parameters from scene manager if available
                    const params = this.controller.sceneManager?.getEffectParams(effectId) || [64, 64, 64];
                    this.controller.sendSysExFxEffectSet(deviceId, programId, effectId, enabled, ...params);
                }
                break;

            case InputAction.ACTION_REGROOVE_FX_PARAM:
                {
                    // Parameter is encoded as (effect_id << 8) | param_index
                    const effectId = (event.parameter >> 8) & 0xFF;
                    const paramIndex = event.parameter & 0xFF;
                    const deviceId = event.deviceId || 0;
                    const programId = event.programId || 0;

                    // Get current parameters and update the specified one
                    const params = this.controller.sceneManager?.getEffectParams(effectId) || [64, 64, 64];
                    params[paramIndex] = event.value;

                    // Get enable state
                    const enabled = true; // Assume enabled when adjusting parameters
                    this.controller.sendSysExFxEffectSet(deviceId, programId, effectId, enabled, ...params);
                }
                break;

            // === MIDI CLOCK CONTROL ===
            case InputAction.ACTION_CLOCK_MASTER_TOGGLE:
                if (meetsThreshold) {
                    this.controller.toggleClockMaster();
                }
                break;

            case InputAction.ACTION_CLOCK_START:
                if (meetsThreshold) {
                    this.controller.startClock();
                }
                break;

            case InputAction.ACTION_CLOCK_STOP:
                if (meetsThreshold) {
                    this.controller.stopClock();
                }
                break;

            case InputAction.ACTION_CLOCK_BPM_SET:
                {
                    const bpm = event.parameter || Math.round(20 + normalizedValue * 280); // Map 0-127 to 20-300
                    this.controller.setBPM(bpm);
                }
                break;

            case InputAction.ACTION_CLOCK_BPM_INC:
                if (meetsThreshold) {
                    const currentBPM = this.controller.config.bpm || 120;
                    this.controller.setBPM(Math.min(300, currentBPM + 1));
                }
                break;

            case InputAction.ACTION_CLOCK_BPM_DEC:
                if (meetsThreshold) {
                    const currentBPM = this.controller.config.bpm || 120;
                    this.controller.setBPM(Math.max(20, currentBPM - 1));
                }
                break;

            // === CONFIGURATION/PRESET ===
            case InputAction.ACTION_CONFIG_LOAD:
                if (meetsThreshold) {
                    // TODO: Implement config loading by name/index
                    console.warn('ACTION_CONFIG_LOAD not yet implemented');
                }
                break;

            case InputAction.ACTION_CONFIG_SAVE:
                if (meetsThreshold) {
                    this.controller.saveConfig();
                }
                break;

            case InputAction.ACTION_CONFIG_NEXT:
            case InputAction.ACTION_CONFIG_PREV:
                if (meetsThreshold) {
                    // TODO: Implement config preset cycling
                    console.warn('Config preset cycling not yet implemented');
                }
                break;

            // === MIDI OUTPUT ===
            case InputAction.ACTION_MIDI_NOTE:
                if (meetsThreshold) {
                    const note = event.parameter;
                    const velocity = event.value;
                    const noteProgram = event.noteProgram !== undefined ? event.noteProgram : null;

                    // Resolve device ID from deviceBinding if present
                    let deviceId = null;
                    if (event.deviceBinding && this.controller.deviceManager) {
                        const device = this.controller.deviceManager.getDevice(event.deviceBinding);
                        if (device) {
                            deviceId = device.id; // String ID for getDevice() lookup
                            console.log(`[ActionDispatcher] Note action using device: ${device.name} (ID: ${deviceId}, Ch: ${device.midiChannel + 1})`);
                        }
                    }

                    this.controller.sendNote(note, velocity, noteProgram, deviceId);
                }
                break;

            case InputAction.ACTION_MIDI_CC:
                {
                    const cc = event.parameter;
                    const value = event.value;
                    this.controller.sendMidiCC(cc, value);
                }
                break;

            case InputAction.ACTION_MIDI_PROGRAM_CHANGE:
                if (meetsThreshold) {
                    const program = event.parameter;
                    this.controller.sendProgramChange(program);
                }
                break;

            case InputAction.ACTION_MIDI_MMC:
                if (meetsThreshold) {
                    // TODO: Parse MMC command from parameters field
                    console.warn('ACTION_MIDI_MMC not yet implemented');
                }
                break;

            // === MULTI-ACTION MACROS ===
            case InputAction.ACTION_MACRO:
                if (meetsThreshold) {
                    this.executeMacro(event.parameter);
                }
                break;

            // === EXTERNAL ROUTING ===
            case InputAction.ACTION_ROUTE_MIDI_NOTE:
                if (meetsThreshold) {
                    // Direct routing (already handled by routing layer)
                    const note = event.parameter;
                    const velocity = event.value;
                    this.controller.sendMidiNote(note, velocity);
                }
                break;

            case InputAction.ACTION_ROUTE_MIDI_CC:
                {
                    // Direct routing (already handled by routing layer)
                    const cc = event.parameter;
                    const value = event.value;
                    this.controller.sendMidiCC(cc, value);
                }
                break;

            case InputAction.ACTION_SWITCH_INPUT_ROUTE:
                if (meetsThreshold && this.controller.inputRouter) {
                    // Switch to next routing target for the specified input
                    // parameter should contain the input ID or index
                    // If parameter is 0 or not set, switch all inputs
                    const inputId = event.parameter;

                    if (inputId) {
                        // Switch specific input
                        const target = this.controller.inputRouter.switchTarget(inputId);
                        if (target) {
                            console.log(`[Action] Switched input routing target to:`, target);
                        }
                    } else {
                        // Switch all configured inputs
                        const routes = this.controller.inputRouter.getAllRoutes();
                        routes.forEach(route => {
                            if (route.targets && route.targets.length > 1) {
                                this.controller.inputRouter.switchTarget(route.inputId);
                            }
                        });
                        console.log(`[Action] Switched all input routing targets`);
                    }

                    // Update all routing action pads to show new active targets
                    this.updateRoutingPadLabels(inputId);
                }
                break;

            // === SEQUENCER CONTROL ===
            case InputAction.ACTION_SEQUENCER_PLAY:
                {
                    const sceneId = event.parameter;
                    const scene = this.controller.sceneManager.scenes.get(sceneId);
                    if (scene && scene.type === 'sequencer' && scene.sequencerInstance) {
                        scene.sequencerInstance.engine.startPlayback();
                    } else {
                        console.error(`[Action 700] ERROR: Cannot start sequencer - scene=${scene}, type=${scene?.type}, instance=${scene?.sequencerInstance}`);
                    }
                }
                break;

            case InputAction.ACTION_SEQUENCER_STOP:
                {
                    const sceneId = event.parameter;
                    const scene = this.controller.sceneManager.scenes.get(sceneId);
                    if (scene && scene.type === 'sequencer' && scene.sequencerInstance) {
                        scene.sequencerInstance.engine.stopPlayback();
                    }
                }
                break;

            case InputAction.ACTION_SEQUENCER_PLAY_STOP:
                {
                    const sceneId = event.parameter;
                    const scene = this.controller.sceneManager.scenes.get(sceneId);
                    if (scene && scene.type === 'sequencer' && scene.sequencerInstance) {
                        if (scene.sequencerInstance.engine.playing) {
                            scene.sequencerInstance.engine.stopPlayback();
                        } else {
                            scene.sequencerInstance.engine.startPlayback();
                        }
                    }
                }
                break;

            case InputAction.ACTION_SEQUENCER_TRACK_MUTE:
                {
                    const sceneIndex = (event.parameter >> 8) & 0xFF;
                    const trackIndex = event.parameter & 0xFF;
                    // Find sequencer by index (nth sequencer scene)
                    const sequencers = Array.from(this.controller.sceneManager.scenes.entries())
                        .filter(([id, scene]) => scene.type === 'sequencer');
                    if (sceneIndex < sequencers.length) {
                        const [sceneId, scene] = sequencers[sceneIndex];
                        if (scene.sequencerInstance) {
                            scene.sequencerInstance.engine.toggleMute(trackIndex);
                        }
                    }
                }
                break;

            case InputAction.ACTION_SEQUENCER_TRACK_SOLO:
                {
                    const sceneIndex = (event.parameter >> 8) & 0xFF;
                    const trackIndex = event.parameter & 0xFF;
                    // Find sequencer by index (nth sequencer scene)
                    const sequencers = Array.from(this.controller.sceneManager.scenes.entries())
                        .filter(([id, scene]) => scene.type === 'sequencer');
                    if (sceneIndex < sequencers.length) {
                        const [sceneId, scene] = sequencers[sceneIndex];
                        if (scene.sequencerInstance) {
                            scene.sequencerInstance.engine.toggleSolo(trackIndex);
                        }
                    }
                }
                break;

            // === DEVICE SEQUENCER CONTROL ===
            case InputAction.ACTION_DEVICE_SEQ_PLAY:
                if (meetsThreshold) {
                    const slot = event.parameter & 0xFF;

                    // NEW: Use event.deviceId to look up device by stable string ID
                    if (event.deviceId) {
                        this.playDeviceSequencerByDeviceId(event.deviceId, slot, true); // loop = true
                    } else {
                        // FALLBACK: Old parameter-based index (backward compat)
                        const deviceIndex = (event.parameter >> 8) & 0xFF;
                        console.warn(`[Action 720] Using old device index (${deviceIndex}) - please re-save pad config`);
                        this.playDeviceSequencer(deviceIndex, slot, true);
                    }
                } else {
                    console.warn(`[Action 720] Threshold not met - value=${event.value}`);
                }
                break;

            case InputAction.ACTION_DEVICE_SEQ_STOP:
                if (meetsThreshold) {
                    const slot = event.parameter & 0xFF;

                    if (event.deviceId) {
                        this.stopDeviceSequencerByDeviceId(event.deviceId, slot);
                    } else {
                        const deviceIndex = (event.parameter >> 8) & 0xFF;
                        console.warn(`[Action 721] Using old device index (${deviceIndex}) - please re-save pad config`);
                        this.stopDeviceSequencer(deviceIndex, slot);
                    }
                }
                break;

            case InputAction.ACTION_DEVICE_SEQ_PLAY_STOP:
                if (meetsThreshold) {
                    const slot = event.parameter & 0xFF;

                    if (event.deviceId) {
                        this.toggleDeviceSequencerByDeviceId(event.deviceId, slot);
                    } else {
                        const deviceIndex = (event.parameter >> 8) & 0xFF;
                        console.warn(`[Action 722] Using old device index (${deviceIndex}) - please re-save pad config`);
                        this.toggleDeviceSequencer(deviceIndex, slot);
                    }
                }
                break;

            case InputAction.ACTION_DEVICE_SEQ_MUTE:
                if (meetsThreshold) {
                    const slot = event.parameter & 0xFF;

                    if (event.deviceId) {
                        this.muteDeviceSequencerByDeviceId(event.deviceId, slot);
                    } else {
                        const deviceIndex = (event.parameter >> 8) & 0xFF;
                        console.warn(`[Action 723] Using old device index (${deviceIndex}) - please re-save pad config`);
                        this.muteDeviceSequencer(deviceIndex, slot);
                    }
                }
                break;

            case InputAction.ACTION_DEVICE_SEQ_SOLO:
                if (meetsThreshold) {
                    const slot = event.parameter & 0xFF;

                    if (event.deviceId) {
                        this.soloDeviceSequencerByDeviceId(event.deviceId, slot);
                    } else {
                        const deviceIndex = (event.parameter >> 8) & 0xFF;
                        console.warn(`[Action 724] Using old device index (${deviceIndex}) - please re-save pad config`);
                        this.soloDeviceSequencer(deviceIndex, slot);
                    }
                }
                break;

            default:
                console.warn(`Unhandled action: ${event.action}`);
                break;
        }
    }

    /**
     * Execute a macro (sequence of actions)
     * @param {number} macroId - The macro ID
     */
    executeMacro(macroId) {
        const macro = this.macros.get(macroId);
        if (!macro) {
            console.warn(`Macro ${macroId} not found`);
            return;
        }

        console.log(`Executing macro ${macroId} with ${macro.length} actions`);
        for (const event of macro) {
            // Execute each action in sequence
            this.handleEvent(event);
        }
    }

    /**
     * Register a macro
     * @param {number} macroId - The macro ID
     * @param {Array<InputEvent>} actions - Array of InputEvents to execute
     */
    registerMacro(macroId, actions) {
        this.macros.set(macroId, actions);
        console.log(`Registered macro ${macroId} with ${actions.length} actions`);
    }

    /**
     * Clear all macros
     */
    clearMacros() {
        this.macros.clear();
    }

    /**
     * Get all registered macros
     */
    getMacros() {
        return Array.from(this.macros.entries()).map(([id, actions]) => ({
            id,
            actions: actions.length,
        }));
    }

    /**
     * Update pad labels for routing action pads (action 602)
     * Shows the current active target after a route switch
     * @param {string} inputId - The input ID that was switched (or empty for all)
     */
    updateRoutingPadLabels(inputId) {
        if (!this.controller.pads || !this.controller.getRoutingDisplayInfo) return;

        // Iterate through all pads to find routing action pads
        this.controller.pads.forEach((padElement, index) => {
            const padConfig = this.controller.config.pads[index];
            if (!padConfig || padConfig.action !== 602) return; // Not a routing action pad

            // Check if this pad's parameter matches the switched input (or update all if inputId is empty)
            const padParameter = padConfig.parameter || '';
            if (inputId && padParameter !== inputId) return; // Different input, skip

            // Get updated routing info
            const routingInfo = this.controller.getRoutingDisplayInfo(padParameter);
            if (!routingInfo) return;

            // Get active target and its color from device configuration
            let targetColor = null;
            if (this.controller.inputRouter && this.controller.deviceManager) {
                const route = this.controller.inputRouter.getRoute(padParameter);
                if (route && route.targets && route.targets.length > 0) {
                    const activeIndex = route.activeTargetIndex || 0;
                    const activeTarget = route.targets[activeIndex];

                    // Get device color if in device mode
                    if (route.mode === 'device' && activeTarget && activeTarget.deviceId) {
                        const device = this.controller.deviceManager.getDevice(activeTarget.deviceId);
                        if (device && device.color) {
                            targetColor = device.color;
                        }
                    }

                    // Fallback to default colors for pass-through mode or if device color not found
                    if (!targetColor) {
                        const fallbackColors = ['red', 'blue', 'green', 'yellow'];
                        targetColor = fallbackColors[activeIndex % fallbackColors.length];
                    }
                }
            }

            // Preserve device binding info if it exists
            let deviceBindingInfo = '';
            const currentSublabel = padElement.getAttribute('sublabel') || '';
            const lines = currentSublabel.split('\n');
            for (const line of lines) {
                if (line.match(/^\[.*\]$/)) {
                    deviceBindingInfo = line;
                    break;
                }
            }

            // Build new sublabel
            const newSublabel = deviceBindingInfo
                ? `${deviceBindingInfo}\n${routingInfo}`
                : routingInfo;

            console.log(`[Action] Updating pad ${index} sublabel to:`, newSublabel, `color: ${targetColor}`);
            padElement.setAttribute('sublabel', newSublabel);

            // Set color based on active target
            if (targetColor) {
                padElement.setAttribute('color', targetColor);
            } else {
                padElement.removeAttribute('color');
            }
        });
    }

    /**
     * Play a sequence on a device by device string ID (NEW - stable identifier)
     * @param {string} deviceId - Device string ID (e.g., 'device-abc123')
     * @param {number} slot - Slot number (0-15)
     * @param {boolean} loop - Loop mode (true=LOOP, false=ONESHOT)
     */
    playDeviceSequencerByDeviceId(deviceId, slot, loop = true) {
        if (!this.controller.deviceManager) {
            console.error('[Action] DeviceManager not available');
            return;
        }

        // Look up device by string ID
        const device = this.controller.deviceManager.getDevice(deviceId);
        if (!device) {
            console.error(`[Action] Device ${deviceId} not found`);
            return;
        }

        const midiOutput = this.controller.deviceManager.getMidiOutput(device.id);
        if (!midiOutput) {
            console.error(`[Action] No MIDI output for device: ${device.name}`);
            return;
        }

        // Use device's CURRENT deviceId number (may have changed in settings!)
        const message = buildPlaybackControlMessage(device.deviceId, slot, 'play', loop);
        midiOutput.send(message);

        // Track playback state
        if (!this.deviceSequencerState.has(deviceId)) {
            this.deviceSequencerState.set(deviceId, new Set());
        }
        this.deviceSequencerState.get(deviceId).add(slot);


        // Query device state to sync
        setTimeout(() => {
            this.queryDeviceSequenceState(deviceId);
        }, 100);
    }

    /**
     * Play a sequence on a device (Samplecrate) - OLD method using device index
     * @param {number} deviceIndex - Index in device list (0, 1, 2...)
     * @param {number} slot - Slot number (0-15)
     * @param {boolean} loop - Loop mode (true=LOOP, false=ONESHOT)
     */
    playDeviceSequencer(deviceIndex, slot, loop = true) {
        if (!this.controller.deviceManager) {
            console.error('[Action] DeviceManager not available');
            return;
        }

        // Get device at this index in the list
        const devices = this.controller.deviceManager.getAllDevices();
        if (deviceIndex >= devices.length) {
            console.error(`[Action] Device index ${deviceIndex} out of range (0-${devices.length - 1})`);
            return;
        }

        const device = devices[deviceIndex];
        const midiOutput = this.controller.deviceManager.getMidiOutput(device.id);
        if (!midiOutput) {
            console.error(`[Action] No MIDI output for device: ${device.name}`);
            return;
        }

        // Use device's CURRENT deviceId (may have changed in settings!)
        const message = buildPlaybackControlMessage(device.deviceId, slot, 'play', loop);
        midiOutput.send(message);

        // Track playback state using device string ID
        if (!this.deviceSequencerState.has(device.id)) {
            this.deviceSequencerState.set(device.id, new Set());
        }
        this.deviceSequencerState.get(device.id).add(slot);


        // Query device state to sync
        setTimeout(() => {
            this.queryDeviceSequenceState(device.id);
        }, 100);
    }

    /**
     * Stop a sequence on a device by device string ID (NEW - stable identifier)
     * @param {string} deviceId - Device string ID (e.g., 'device-abc123')
     * @param {number} slot - Slot number (0-15)
     */
    stopDeviceSequencerByDeviceId(deviceId, slot) {
        if (!this.controller.deviceManager) {
            console.error('[Action] DeviceManager not available');
            return;
        }

        const device = this.controller.deviceManager.getDevice(deviceId);
        if (!device) {
            console.error(`[Action] Device ${deviceId} not found`);
            return;
        }

        const midiOutput = this.controller.deviceManager.getMidiOutput(device.id);
        if (!midiOutput) {
            console.error(`[Action] No MIDI output for device: ${device.name}`);
            return;
        }

        const message = buildPlaybackControlMessage(device.deviceId, slot, 'stop');
        midiOutput.send(message);

        // Track playback state
        if (this.deviceSequencerState.has(deviceId)) {
            this.deviceSequencerState.get(deviceId).delete(slot);
        }


        // Query device state to sync
        setTimeout(() => {
            this.queryDeviceSequenceState(deviceId);
        }, 100);
    }

    /**
     * Stop a sequence on a device (Samplecrate) - OLD method using device index
     * @param {number} deviceIndex - Index in device list (0, 1, 2...)
     * @param {number} slot - Slot number (0-15)
     */
    stopDeviceSequencer(deviceIndex, slot) {
        if (!this.controller.deviceManager) {
            console.error('[Action] DeviceManager not available');
            return;
        }

        // Get device at this index in the list
        const devices = this.controller.deviceManager.getAllDevices();
        if (deviceIndex >= devices.length) {
            console.error(`[Action] Device index ${deviceIndex} out of range (0-${devices.length - 1})`);
            return;
        }

        const device = devices[deviceIndex];
        const midiOutput = this.controller.deviceManager.getMidiOutput(device.id);
        if (!midiOutput) {
            console.error(`[Action] No MIDI output for device: ${device.name}`);
            return;
        }

        // Use device's CURRENT deviceId (may have changed in settings!)
        const message = buildPlaybackControlMessage(device.deviceId, slot, 'stop');
        midiOutput.send(message);

        // Track playback state using device string ID
        if (this.deviceSequencerState.has(device.id)) {
            this.deviceSequencerState.get(device.id).delete(slot);
        }


        // Query device state to sync
        setTimeout(() => {
            this.queryDeviceSequenceState(device.id);
        }, 100);
    }

    /**
     * Toggle play/stop of a sequence on a device by device string ID (NEW - stable identifier)
     * @param {string} deviceId - Device string ID (e.g., 'device-abc123')
     * @param {number} slot - Slot number (0-15)
     */
    toggleDeviceSequencerByDeviceId(deviceId, slot) {
        // Check if slot is currently playing
        const isPlaying = this.isDeviceSlotPlaying(deviceId, slot);

        if (isPlaying) {
            this.stopDeviceSequencerByDeviceId(deviceId, slot);
        } else {
            this.playDeviceSequencerByDeviceId(deviceId, slot, true);
        }
    }

    /**
     * Toggle play/stop of a sequence on a device - OLD method using device index
     * @param {number} deviceIndex - Index in device list (0, 1, 2...)
     * @param {number} slot - Slot number (0-15)
     */
    toggleDeviceSequencer(deviceIndex, slot) {
        if (!this.controller.deviceManager) {
            console.error('[Action] DeviceManager not available');
            return;
        }

        // Get device at this index to get its string ID
        const devices = this.controller.deviceManager.getAllDevices();
        if (deviceIndex >= devices.length) {
            console.error(`[Action] Device index ${deviceIndex} out of range (0-${devices.length - 1})`);
            return;
        }

        const device = devices[deviceIndex];

        // Check if slot is currently playing using device string ID
        const isPlaying = this.isDeviceSlotPlaying(device.id, slot);

        if (isPlaying) {
            this.stopDeviceSequencer(deviceIndex, slot);
        } else {
            this.playDeviceSequencer(deviceIndex, slot, true);
        }
    }

    /**
     * Mute a sequence on a device by device string ID (NEW - stable identifier)
     * @param {string} deviceId - Device string ID (e.g., 'device-abc123')
     * @param {number} slot - Slot number (0-15)
     */
    muteDeviceSequencerByDeviceId(deviceId, slot) {
        if (!this.controller.deviceManager) {
            console.error('[Action] DeviceManager not available');
            return;
        }

        const device = this.controller.deviceManager.getDevice(deviceId);
        if (!device) {
            console.error(`[Action] Device ${deviceId} not found`);
            return;
        }

        const midiOutput = this.controller.deviceManager.getMidiOutput(device.id);
        if (!midiOutput) {
            console.error(`[Action] No MIDI output for device: ${device.name}`);
            return;
        }

        const message = buildMuteMessage(device.deviceId, slot, true);
        midiOutput.send(message);
    }

    /**
     * Mute a sequence on a device - OLD method using device index
     * @param {number} deviceIndex - Index in device list (0, 1, 2...)
     * @param {number} slot - Slot number (0-15)
     */
    muteDeviceSequencer(deviceIndex, slot) {
        if (!this.controller.deviceManager) {
            console.error('[Action] DeviceManager not available');
            return;
        }

        // Get device at this index in the list
        const devices = this.controller.deviceManager.getAllDevices();
        if (deviceIndex >= devices.length) {
            console.error(`[Action] Device index ${deviceIndex} out of range (0-${devices.length - 1})`);
            return;
        }

        const device = devices[deviceIndex];
        const midiOutput = this.controller.deviceManager.getMidiOutput(device.id);
        if (!midiOutput) {
            console.error(`[Action] No MIDI output for device: ${device.name}`);
            return;
        }

        // Toggle mute (send true, device should toggle)
        // Use device's CURRENT deviceId (may have changed in settings!)
        const message = buildMuteMessage(device.deviceId, slot, true);
        midiOutput.send(message);
    }

    /**
     * Solo a sequence on a device by device string ID (NEW - stable identifier)
     * @param {string} deviceId - Device string ID (e.g., 'device-abc123')
     * @param {number} slot - Slot number (0-15)
     */
    soloDeviceSequencerByDeviceId(deviceId, slot) {
        if (!this.controller.deviceManager) {
            console.error('[Action] DeviceManager not available');
            return;
        }

        const device = this.controller.deviceManager.getDevice(deviceId);
        if (!device) {
            console.error(`[Action] Device ${deviceId} not found`);
            return;
        }

        const midiOutput = this.controller.deviceManager.getMidiOutput(device.id);
        if (!midiOutput) {
            console.error(`[Action] No MIDI output for device: ${device.name}`);
            return;
        }

        const message = buildSoloMessage(device.deviceId, slot, true);
        midiOutput.send(message);
    }

    /**
     * Solo a sequence on a device - OLD method using device index
     * @param {number} deviceIndex - Index in devices array (0-based)
     * @param {number} slot - Slot number (0-15)
     */
    soloDeviceSequencer(deviceIndex, slot) {
        if (!this.controller.deviceManager) {
            console.error('[Action] DeviceManager not available');
            return;
        }

        const devices = this.controller.deviceManager.getAllDevices();
        if (deviceIndex >= devices.length) {
            console.error(`[Action] Device index ${deviceIndex} out of range (0-${devices.length - 1})`);
            return;
        }

        const device = devices[deviceIndex];
        const midiOutput = this.controller.deviceManager.getMidiOutput(device.id);
        if (!midiOutput) {
            console.error(`[Action] No MIDI output for device: ${device.name}`);
            return;
        }

        // Toggle solo (send true, device should toggle)
        const message = buildSoloMessage(device.deviceId, slot, true);
        midiOutput.send(message);
    }

    /**
     * Check if a device slot is currently playing
     * @param {string} deviceId - Device string ID (e.g., 'device-abc123')
     * @param {number} slot - Slot number (0-15)
     * @returns {boolean} - True if playing, false otherwise
     */
    isDeviceSlotPlaying(deviceId, slot) {
        if (!this.deviceSequencerState.has(deviceId)) {
            return false;
        }
        return this.deviceSequencerState.get(deviceId).has(slot);
    }

    /**
     * Query sequence state from a device
     * Sends GET_SEQUENCE_STATE (0x62) command
     * @param {string} deviceId - Device string ID (e.g., 'device-abc123')
     */
    queryDeviceSequenceState(deviceId) {
        if (!this.controller.deviceManager) {
            console.error('[Action] DeviceManager not available');
            return;
        }

        const device = this.controller.deviceManager.getDevice(deviceId);
        if (!device) {
            console.error(`[Action] Device ${deviceId} not found`);
            return;
        }

        const midiOutput = this.controller.deviceManager.getMidiOutput(device.id);
        if (!midiOutput) {
            console.error(`[Action] No MIDI output for device: ${device.name}`);
            return;
        }

        const message = buildGetSequenceStateMessage(device.deviceId);
        midiOutput.send(message);
    }

    /**
     * Handle SEQUENCE_STATE_RESPONSE (0x63) from device
     * Updates internal state and button displays
     * @param {string} deviceId - Device string ID
     * @param {Uint8Array} data - SysEx message data
     */
    handleSequenceStateResponse(deviceId, data) {
        const state = parseSequenceStateResponse(data);
        if (!state) {
            console.warn('[Action] Failed to parse sequence state response');
            return;
        }

        // Update device sequencer state
        const playingSlots = new Set();
        for (const slotState of state.slots) {
            if (slotState.playing) {
                playingSlots.add(slotState.slot);
            }
        }

        this.deviceSequencerState.set(deviceId, playingSlots);

        // Update ONLY device sequencer button states (not local sequencer pads)
        this.controller.updateDeviceSequencerPads();
    }

    /**
     * Handle PROGRAM_STATE_RESPONSE (0x65) from device (Samplecrate mixer)
     * Updates internal mixer state
     * @param {string} deviceId - Device string ID
     * @param {Uint8Array} data - SysEx message data
     */
    handleProgramStateResponse(deviceId, data) {
        const state = parseProgramStateResponse(data);
        if (!state) {
            console.warn('[Action] Failed to parse program state response');
            return;
        }

        // Store program state for this device
        this.deviceProgramState.set(deviceId, {
            master: state.master,
            programs: state.programs
        });

        // Update program faders in current scene
        if (this.controller.sceneManager) {
            this.controller.sceneManager.updateProgramFadersFromState(deviceId, state);
        }
    }

    /**
     * Query program state (mixer) from a specific device (Samplecrate)
     * @param {string} deviceId - Device string ID
     */
    queryDeviceProgramState(deviceId) {
        if (!this.controller.deviceManager) {
            return;
        }

        const device = this.controller.deviceManager.getDevice(deviceId);
        if (!device) {
            console.error(`[Action] Device ${deviceId} not found`);
            return;
        }

        const midiOutput = this.controller.deviceManager.getMidiOutput(device.id);
        if (!midiOutput) {
            console.error(`[Action] No MIDI output for device: ${device.name}`);
            return;
        }

        const message = buildGetProgramStateMessage(device.deviceId);
        midiOutput.send(message);
    }

    /**
     * Query sequence state from all devices
     */
    // queryAllDeviceStates(), startStatePolling(), and stopStatePolling() removed
    // All polling is now handled by scene manager via regrooveState
}
