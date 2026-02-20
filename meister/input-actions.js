/**
 * Input Action System for Meister
 * Based on the Samplecrate/Regroove action trigger architecture
 */

/**
 * InputAction Types
 * Defines all available actions that can be triggered
 */
export const InputAction = {
    // No action (empty pad)
    ACTION_NONE: 0,

    // === REGROOVE TRANSPORT CONTROL ===
    ACTION_REGROOVE_PLAY: 100,
    ACTION_REGROOVE_STOP: 101,
    ACTION_REGROOVE_PLAY_PAUSE: 102,
    ACTION_REGROOVE_RETRIGGER: 103,
    ACTION_REGROOVE_LOOP_TOGGLE: 104,

    // === REGROOVE NAVIGATION ===
    ACTION_REGROOVE_ORDER_NEXT: 110,
    ACTION_REGROOVE_ORDER_PREV: 111,
    ACTION_REGROOVE_ORDER_JUMP: 112,      // parameter = order index

    // === REGROOVE FILE OPERATIONS ===
    ACTION_REGROOVE_FILE_LOAD: 120,       // parameter = file index or name
    ACTION_REGROOVE_FILE_NEXT: 121,
    ACTION_REGROOVE_FILE_PREV: 122,

    // === REGROOVE CHANNEL CONTROL ===
    ACTION_REGROOVE_CHANNEL_MUTE: 130,    // parameter = channel index
    ACTION_REGROOVE_CHANNEL_SOLO: 131,    // parameter = channel index
    ACTION_REGROOVE_CHANNEL_VOLUME: 132,  // parameter = channel index, value = volume
    ACTION_REGROOVE_CHANNEL_PAN: 133,     // parameter = channel index, value = pan (0-127)
    ACTION_REGROOVE_MUTE_ALL: 134,
    ACTION_REGROOVE_UNMUTE_ALL: 135,

    // === REGROOVE MIDI SYNC ===
    ACTION_REGROOVE_SYNC_TEMPO_TOGGLE: 140,
    ACTION_REGROOVE_SYNC_TRANSPORT_TOGGLE: 141,
    ACTION_REGROOVE_SYNC_SPP_TOGGLE: 142,
    ACTION_REGROOVE_SYNC_RECEIVE_TOGGLE: 143,
    ACTION_REGROOVE_SYNC_SEND_TOGGLE: 144,

    // === REGROOVE PERFORMANCE ===
    ACTION_REGROOVE_RECORD_TOGGLE: 150,
    ACTION_REGROOVE_TAP_TEMPO: 151,

    // === REGROOVE MIXER CONTROL ===
    ACTION_REGROOVE_MASTER_VOLUME: 160,   // value = volume (0-127)
    ACTION_REGROOVE_MASTER_PAN: 161,      // value = pan (0-127, 64=center)
    ACTION_REGROOVE_MASTER_MUTE: 162,     // toggle
    ACTION_REGROOVE_INPUT_VOLUME: 163,    // value = volume (0-127)
    ACTION_REGROOVE_INPUT_PAN: 164,       // value = pan (0-127, 64=center)
    ACTION_REGROOVE_INPUT_MUTE: 165,      // toggle
    ACTION_REGROOVE_FX_ROUTING: 166,      // parameter = route (0=off, 1=master, 2=playback, 3=input)
    ACTION_REGROOVE_TEMPO_SET: 167,       // value = BPM (20-300)
    ACTION_REGROOVE_STEREO_SEP: 168,      // value = separation (0-127)

    // === REGROOVE EFFECTS CONTROL ===
    ACTION_REGROOVE_FX_ENABLE: 170,       // parameter = effect_id (0-4), value = enable/disable
    ACTION_REGROOVE_FX_PARAM: 171,        // parameter = (effect_id << 8) | param_index, value = param value

    // === MIDI CLOCK CONTROL ===
    ACTION_CLOCK_MASTER_TOGGLE: 200,
    ACTION_CLOCK_START: 201,
    ACTION_CLOCK_STOP: 202,
    ACTION_CLOCK_BPM_SET: 203,            // parameter = BPM value
    ACTION_CLOCK_BPM_INC: 204,
    ACTION_CLOCK_BPM_DEC: 205,

    // === CONFIGURATION/PRESET ===
    ACTION_CONFIG_LOAD: 300,              // parameter = config name/index
    ACTION_CONFIG_SAVE: 301,
    ACTION_CONFIG_NEXT: 302,
    ACTION_CONFIG_PREV: 303,

    // === MIDI OUTPUT ===
    ACTION_MIDI_NOTE: 400,                // parameter = note number, value = velocity
    ACTION_MIDI_CC: 401,                  // parameter = CC number, value = CC value
    ACTION_MIDI_PROGRAM_CHANGE: 402,     // parameter = program number
    ACTION_MIDI_MMC: 403,                 // parameter = MMC command type

    // === MULTI-ACTION MACROS ===
    ACTION_MACRO: 500,                    // parameter = macro index

    // === EXTERNAL ROUTING ===
    ACTION_ROUTE_MIDI_NOTE: 600,          // Direct MIDI note routing to device
    ACTION_ROUTE_MIDI_CC: 601,            // Direct MIDI CC routing to device
    ACTION_SWITCH_INPUT_ROUTE: 602,       // parameter = input_id (switch to next target)

    // === SEQUENCER CONTROL (Meister) ===
    ACTION_SEQUENCER_PLAY: 700,           // parameter = sequencer scene ID
    ACTION_SEQUENCER_STOP: 701,           // parameter = sequencer scene ID
    ACTION_SEQUENCER_PLAY_STOP: 702,      // parameter = sequencer scene ID
    ACTION_SEQUENCER_TRACK_MUTE: 710,     // parameter = (scene_index << 8) | track_index
    ACTION_SEQUENCER_TRACK_SOLO: 711,     // parameter = (scene_index << 8) | track_index

    // === DEVICE SEQUENCER CONTROL (Samplecrate Slots) ===
    ACTION_DEVICE_SEQ_PLAY: 720,          // parameter = (device_index << 8) | slot (0-15)
    ACTION_DEVICE_SEQ_STOP: 721,          // parameter = (device_index << 8) | slot (0-15)
    ACTION_DEVICE_SEQ_PLAY_STOP: 722,     // parameter = (device_index << 8) | slot (0-15)
    ACTION_DEVICE_SEQ_MUTE: 723,          // parameter = (device_index << 8) | slot (0-15)
    ACTION_DEVICE_SEQ_SOLO: 724,          // parameter = (device_index << 8) | slot (0-15)
};

/**
 * Action Category Types
 * Used for organizing and handling actions
 */
export const ActionCategory = {
    TOGGLE: 'toggle',           // Threshold-based (>= 64)
    CONTINUOUS: 'continuous',   // 0-127 range, normalized to 0.0-1.0
    PARAMETRIC: 'parametric',   // Requires parameter field
    TRIGGER: 'trigger',         // One-shot trigger
};

/**
 * MIDI Routing Modes
 * Determines how MIDI input is processed
 */
export const MidiRoutingMode = {
    INPUT: 'input',     // Parse MIDI into actions
    ROUTED: 'routed',   // Direct pass-through to output device
};

/**
 * Get action category for a given action
 */
export function getActionCategory(action) {
    // Toggle actions (threshold-based)
    const toggleActions = [
        InputAction.ACTION_REGROOVE_PLAY_PAUSE,
        InputAction.ACTION_REGROOVE_LOOP_TOGGLE,
        InputAction.ACTION_REGROOVE_SYNC_TEMPO_TOGGLE,
        InputAction.ACTION_REGROOVE_SYNC_TRANSPORT_TOGGLE,
        InputAction.ACTION_REGROOVE_SYNC_SPP_TOGGLE,
        InputAction.ACTION_REGROOVE_SYNC_RECEIVE_TOGGLE,
        InputAction.ACTION_REGROOVE_SYNC_SEND_TOGGLE,
        InputAction.ACTION_REGROOVE_RECORD_TOGGLE,
        InputAction.ACTION_REGROOVE_MASTER_MUTE,
        InputAction.ACTION_REGROOVE_INPUT_MUTE,
        InputAction.ACTION_CLOCK_MASTER_TOGGLE,
    ];

    // Continuous actions (0-127 range)
    const continuousActions = [
        InputAction.ACTION_REGROOVE_CHANNEL_VOLUME,
        InputAction.ACTION_REGROOVE_CHANNEL_PAN,
        InputAction.ACTION_REGROOVE_MASTER_VOLUME,
        InputAction.ACTION_REGROOVE_MASTER_PAN,
        InputAction.ACTION_REGROOVE_INPUT_VOLUME,
        InputAction.ACTION_REGROOVE_INPUT_PAN,
        InputAction.ACTION_REGROOVE_TEMPO_SET,
        InputAction.ACTION_REGROOVE_STEREO_SEP,
        InputAction.ACTION_REGROOVE_FX_ENABLE,
        InputAction.ACTION_REGROOVE_FX_PARAM,
        InputAction.ACTION_CLOCK_BPM_SET,
        InputAction.ACTION_MIDI_CC,
    ];

    // Parametric actions (require parameter)
    const parametricActions = [
        InputAction.ACTION_REGROOVE_ORDER_JUMP,
        InputAction.ACTION_REGROOVE_FILE_LOAD,
        InputAction.ACTION_REGROOVE_CHANNEL_MUTE,
        InputAction.ACTION_REGROOVE_CHANNEL_SOLO,
        InputAction.ACTION_REGROOVE_CHANNEL_VOLUME,
        InputAction.ACTION_REGROOVE_CHANNEL_PAN,
        InputAction.ACTION_REGROOVE_FX_ROUTING,
        InputAction.ACTION_REGROOVE_FX_ENABLE,
        InputAction.ACTION_REGROOVE_FX_PARAM,
        InputAction.ACTION_CONFIG_LOAD,
        InputAction.ACTION_MIDI_NOTE,
        InputAction.ACTION_MIDI_CC,
        InputAction.ACTION_MIDI_PROGRAM_CHANGE,
        InputAction.ACTION_MIDI_MMC,
        InputAction.ACTION_MACRO,
        InputAction.ACTION_ROUTE_MIDI_NOTE,
        InputAction.ACTION_ROUTE_MIDI_CC,
    ];

    if (toggleActions.includes(action)) return ActionCategory.TOGGLE;
    if (continuousActions.includes(action)) return ActionCategory.CONTINUOUS;
    if (parametricActions.includes(action)) return ActionCategory.PARAMETRIC;
    return ActionCategory.TRIGGER;
}

/**
 * Get human-readable action name
 */
export function getActionName(action) {
    const names = {
        [InputAction.ACTION_NONE]: 'None',

        // Regroove Transport
        [InputAction.ACTION_REGROOVE_PLAY]: 'Regroove: Play',
        [InputAction.ACTION_REGROOVE_STOP]: 'Regroove: Stop',
        [InputAction.ACTION_REGROOVE_PLAY_PAUSE]: 'Regroove: Play/Pause',
        [InputAction.ACTION_REGROOVE_RETRIGGER]: 'Regroove: Retrigger',
        [InputAction.ACTION_REGROOVE_LOOP_TOGGLE]: 'Regroove: Loop Toggle',

        // Regroove Navigation
        [InputAction.ACTION_REGROOVE_ORDER_NEXT]: 'Regroove: Next Order',
        [InputAction.ACTION_REGROOVE_ORDER_PREV]: 'Regroove: Previous Order',
        [InputAction.ACTION_REGROOVE_ORDER_JUMP]: 'Regroove: Jump to Order',

        // Regroove Files
        [InputAction.ACTION_REGROOVE_FILE_LOAD]: 'Regroove: Load File',
        [InputAction.ACTION_REGROOVE_FILE_NEXT]: 'Regroove: Next File',
        [InputAction.ACTION_REGROOVE_FILE_PREV]: 'Regroove: Previous File',

        // Regroove Channels
        [InputAction.ACTION_REGROOVE_CHANNEL_MUTE]: 'Regroove: Mute Channel',
        [InputAction.ACTION_REGROOVE_CHANNEL_SOLO]: 'Regroove: Solo Channel',
        [InputAction.ACTION_REGROOVE_CHANNEL_VOLUME]: 'Regroove: Channel Volume',
        [InputAction.ACTION_REGROOVE_CHANNEL_PAN]: 'Regroove: Channel Pan',
        [InputAction.ACTION_REGROOVE_MUTE_ALL]: 'Regroove: Mute All',
        [InputAction.ACTION_REGROOVE_UNMUTE_ALL]: 'Regroove: Unmute All',

        // Regroove Mixer
        [InputAction.ACTION_REGROOVE_MASTER_VOLUME]: 'Regroove: Master Volume',
        [InputAction.ACTION_REGROOVE_MASTER_PAN]: 'Regroove: Master Pan',
        [InputAction.ACTION_REGROOVE_MASTER_MUTE]: 'Regroove: Master Mute',
        [InputAction.ACTION_REGROOVE_INPUT_VOLUME]: 'Regroove: Input Volume',
        [InputAction.ACTION_REGROOVE_INPUT_PAN]: 'Regroove: Input Pan',
        [InputAction.ACTION_REGROOVE_INPUT_MUTE]: 'Regroove: Input Mute',
        [InputAction.ACTION_REGROOVE_FX_ROUTING]: 'Regroove: FX Routing',
        [InputAction.ACTION_REGROOVE_TEMPO_SET]: 'Regroove: Set Tempo',
        [InputAction.ACTION_REGROOVE_STEREO_SEP]: 'Regroove: Stereo Separation',

        // Regroove Effects
        [InputAction.ACTION_REGROOVE_FX_ENABLE]: 'Regroove: FX Enable',
        [InputAction.ACTION_REGROOVE_FX_PARAM]: 'Regroove: FX Parameter',

        // Regroove MIDI Sync
        [InputAction.ACTION_REGROOVE_SYNC_TEMPO_TOGGLE]: 'Regroove: Toggle Tempo Sync',
        [InputAction.ACTION_REGROOVE_SYNC_TRANSPORT_TOGGLE]: 'Regroove: Toggle Transport Sync',
        [InputAction.ACTION_REGROOVE_SYNC_SPP_TOGGLE]: 'Regroove: Toggle SPP Sync',
        [InputAction.ACTION_REGROOVE_SYNC_RECEIVE_TOGGLE]: 'Regroove: Toggle Receive Sync',
        [InputAction.ACTION_REGROOVE_SYNC_SEND_TOGGLE]: 'Regroove: Toggle Send Sync',

        // Regroove Performance
        [InputAction.ACTION_REGROOVE_RECORD_TOGGLE]: 'Regroove: Toggle Record',
        [InputAction.ACTION_REGROOVE_TAP_TEMPO]: 'Regroove: Tap Tempo',

        // MIDI Clock
        [InputAction.ACTION_CLOCK_MASTER_TOGGLE]: 'Clock: Master Toggle',
        [InputAction.ACTION_CLOCK_START]: 'Clock: Start',
        [InputAction.ACTION_CLOCK_STOP]: 'Clock: Stop',
        [InputAction.ACTION_CLOCK_BPM_SET]: 'Clock: Set BPM',
        [InputAction.ACTION_CLOCK_BPM_INC]: 'Clock: BPM +1',
        [InputAction.ACTION_CLOCK_BPM_DEC]: 'Clock: BPM -1',

        // Configuration
        [InputAction.ACTION_CONFIG_LOAD]: 'Config: Load',
        [InputAction.ACTION_CONFIG_SAVE]: 'Config: Save',
        [InputAction.ACTION_CONFIG_NEXT]: 'Config: Next',
        [InputAction.ACTION_CONFIG_PREV]: 'Config: Previous',

        // MIDI Output
        [InputAction.ACTION_MIDI_NOTE]: 'MIDI: Note',
        [InputAction.ACTION_MIDI_CC]: 'MIDI: CC',
        [InputAction.ACTION_MIDI_PROGRAM_CHANGE]: 'MIDI: Program Change',
        [InputAction.ACTION_MIDI_MMC]: 'MIDI: MMC',

        // Macros
        [InputAction.ACTION_MACRO]: 'Macro',

        // Routing
        [InputAction.ACTION_ROUTE_MIDI_NOTE]: 'Route: MIDI Note',
        [InputAction.ACTION_ROUTE_MIDI_CC]: 'Route: MIDI CC',
        [InputAction.ACTION_SWITCH_INPUT_ROUTE]: 'Route: Switch Input Target',

        // Sequencer
        [InputAction.ACTION_SEQUENCER_PLAY]: 'Sequencer: Play',
        [InputAction.ACTION_SEQUENCER_STOP]: 'Sequencer: Stop',
        [InputAction.ACTION_SEQUENCER_PLAY_STOP]: 'Sequencer: Play/Stop Toggle',
        [InputAction.ACTION_SEQUENCER_TRACK_MUTE]: 'Sequencer: Track Mute',
        [InputAction.ACTION_SEQUENCER_TRACK_SOLO]: 'Sequencer: Track Solo',
    };

    return names[action] || `Unknown Action (${action})`;
}

/**
 * InputEvent structure
 * Represents a parsed input event ready for action dispatching
 */
export class InputEvent {
    constructor(action, parameter = 0, value = 127, deviceId = 0, programId = 0) {
        this.action = action;
        this.parameter = parameter;
        this.value = value;
        this.deviceId = deviceId;      // Target device ID (0-based)
        this.programId = programId;    // Target program ID (0=Regroove, 0-31=Samplecrate pads)
        this.timestamp = Date.now();
    }

    /**
     * Get normalized value (0.0 - 1.0) for continuous actions
     */
    getNormalizedValue() {
        return this.value / 127.0;
    }

    /**
     * Check if value meets threshold (for toggle actions)
     */
    meetsThreshold(threshold = 64) {
        return this.value >= threshold;
    }
}

/**
 * PadActionConfig
 * Configuration for a pad's action
 */
export class PadActionConfig {
    constructor(config = {}) {
        this.action = config.action || InputAction.ACTION_NONE;
        this.parameter = config.parameter || 0;
        this.parameters = config.parameters || '';  // Semicolon-separated string
        this.label = config.label || '';
        this.sublabel = config.sublabel || '';

        // Legacy support for CC/note/MMC
        this.cc = config.cc;
        this.note = config.note;
        this.mmc = config.mmc;
    }

    /**
     * Check if this is a legacy configuration (CC/note/MMC)
     */
    isLegacy() {
        return this.cc !== undefined || this.note !== undefined || this.mmc !== undefined;
    }

    /**
     * Convert legacy config to action-based config
     */
    toLegacyAction() {
        if (this.cc !== undefined) {
            // Map known CC values to actions
            const ccActionMap = {
                41: InputAction.ACTION_REGROOVE_PLAY_PAUSE,
                42: InputAction.ACTION_REGROOVE_STOP,
                43: InputAction.ACTION_REGROOVE_ORDER_PREV,
                44: InputAction.ACTION_REGROOVE_ORDER_NEXT,
                45: InputAction.ACTION_REGROOVE_RETRIGGER,
                46: InputAction.ACTION_REGROOVE_LOOP_TOGGLE,
                60: InputAction.ACTION_REGROOVE_FILE_LOAD,
                61: InputAction.ACTION_REGROOVE_FILE_PREV,
                62: InputAction.ACTION_REGROOVE_FILE_NEXT,
                70: InputAction.ACTION_REGROOVE_SYNC_TEMPO_TOGGLE,
                71: InputAction.ACTION_REGROOVE_SYNC_TRANSPORT_TOGGLE,
                72: InputAction.ACTION_REGROOVE_SYNC_SPP_TOGGLE,
                73: InputAction.ACTION_REGROOVE_SYNC_RECEIVE_TOGGLE,
                74: InputAction.ACTION_REGROOVE_SYNC_SEND_TOGGLE,
                80: InputAction.ACTION_REGROOVE_RECORD_TOGGLE,
                81: InputAction.ACTION_REGROOVE_TAP_TEMPO,
            };

            if (ccActionMap[this.cc]) {
                return ccActionMap[this.cc];
            }

            // Solo channels (CC 32-39)
            if (this.cc >= 32 && this.cc <= 39) {
                this.action = InputAction.ACTION_REGROOVE_CHANNEL_SOLO;
                this.parameter = this.cc - 32;
                return this.action;
            }

            // Mute channels (CC 48-55)
            if (this.cc >= 48 && this.cc <= 55) {
                this.action = InputAction.ACTION_REGROOVE_CHANNEL_MUTE;
                this.parameter = this.cc - 48;
                return this.action;
            }

            // Unknown CC - treat as generic MIDI CC action
            this.action = InputAction.ACTION_MIDI_CC;
            this.parameter = this.cc;
            return this.action;
        }

        if (this.note !== undefined) {
            this.action = InputAction.ACTION_MIDI_NOTE;
            this.parameter = this.note;
            return this.action;
        }

        if (this.mmc !== undefined) {
            this.action = InputAction.ACTION_MIDI_MMC;
            this.parameters = this.mmc;
            return this.action;
        }

        return InputAction.ACTION_NONE;
    }

    /**
     * Serialize to JSON
     */
    toJSON() {
        const obj = {
            action: this.action,
            label: this.label,
        };

        if (this.parameter !== 0) obj.parameter = this.parameter;
        if (this.parameters) obj.parameters = this.parameters;
        if (this.sublabel) obj.sublabel = this.sublabel;

        return obj;
    }
}

/**
 * MidiInputMapping
 * Maps MIDI input (note/CC) to actions
 */
export class MidiInputMapping {
    constructor(config = {}) {
        this.deviceId = config.deviceId || -1;      // -1 = any device
        this.deviceName = config.deviceName || '';  // Empty = any device
        this.type = config.type || 'cc';            // 'cc' or 'note'
        this.channel = config.channel || -1;        // -1 = any channel
        this.number = config.number || 0;           // CC number or note number
        this.action = config.action || InputAction.ACTION_NONE;
        this.parameter = config.parameter || 0;
        this.continuous = config.continuous || false;
        this.threshold = config.threshold || 64;
        this.routingMode = config.routingMode || MidiRoutingMode.INPUT;
        this.targetDeviceId = config.targetDeviceId || 0;    // Target device for action (0-based)
        this.targetProgramId = config.targetProgramId || 0;  // Target program for action (0=Regroove, 0-31=Samplecrate)
    }

    /**
     * Check if this mapping matches a MIDI message
     */
    matches(deviceName, channel, number, type = 'cc') {
        if (this.type !== type) return false;
        if (this.number !== number) return false;
        if (this.channel !== -1 && this.channel !== channel) return false;
        if (this.deviceName && this.deviceName !== deviceName) return false;
        return true;
    }

    /**
     * Create InputEvent from MIDI value
     */
    createEvent(value) {
        return new InputEvent(this.action, this.parameter, value, this.targetDeviceId, this.targetProgramId);
    }
}

/**
 * KeyboardMapping
 * Maps keyboard keys to actions
 */
export class KeyboardMapping {
    constructor(config = {}) {
        this.key = config.key || '';                // Keyboard key
        this.code = config.code || '';              // KeyboardEvent.code
        this.action = config.action || InputAction.ACTION_NONE;
        this.parameter = config.parameter || 0;
        this.ctrl = config.ctrl || false;
        this.shift = config.shift || false;
        this.alt = config.alt || false;
        this.targetDeviceId = config.targetDeviceId || 0;    // Target device for action (0-based)
        this.targetProgramId = config.targetProgramId || 0;  // Target program for action (0=Regroove, 0-31=Samplecrate)
    }

    /**
     * Check if this mapping matches a keyboard event
     */
    matches(event) {
        if (this.code && event.code !== this.code) return false;
        if (this.key && event.key !== this.key) return false;
        if (this.ctrl && !event.ctrlKey) return false;
        if (this.shift && !event.shiftKey) return false;
        if (this.alt && !event.altKey) return false;
        if (!this.ctrl && event.ctrlKey) return false;
        if (!this.shift && event.shiftKey) return false;
        if (!this.alt && event.altKey) return false;
        return true;
    }

    /**
     * Create InputEvent from keyboard press
     */
    createEvent() {
        return new InputEvent(this.action, this.parameter, 127, this.targetDeviceId, this.targetProgramId);
    }
}
