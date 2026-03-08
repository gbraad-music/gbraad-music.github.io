// Regroove Device State Manager
// Handles state tracking, SysEx response parsing, and device polling for Regroove instances

class RegrooveStateManager {
    constructor() {
        // Multi-device state tracking (Map: deviceId -> deviceState)
        this.deviceStates = new Map();

        // Default player state (for backward compatibility)
        this.playerState = {
            playing: false,
            mode: 0, // 00=song, 01=pattern/loop, 10=performance, 11=record
            order: 0,
            row: 0,
            pattern: 0,
            totalRows: 0,
            numChannels: 0,
            mutedChannels: [],
            soloedChannels: [], // Track solo state locally (not in SysEx response)
            channelVolumes: []
        };

        // State polling
        this.statePollingInterval = null;
        this.pollingIntervalMs = 500; // Poll every 500ms (default - can be adjusted)
        this.targetDeviceIds = [0]; // Array of device IDs to poll

        // Connection watchdog
        this.lastStateUpdate = null;
        this.stateTimeoutMs = 3000; // 3 seconds without update = disconnected
        this.connectionWatchdog = null;
        this.isConnectedToRegroove = false;

        // Callbacks
        this.onStateUpdate = null; // Called when state is updated
        this.onConnectionChange = null; // Called when connection status changes
        this.sendSysExCallback = null; // Callback to send SysEx messages
    }

    // Initialize with MIDI send callback
    init(sendSysExCallback) {
        this.sendSysExCallback = sendSysExCallback;
    }

    // Start polling for player state
    // deviceIds can be a single number or an array of device IDs
    startPolling(deviceIds = 0) {
        // Normalize to array
        this.targetDeviceIds = Array.isArray(deviceIds) ? deviceIds : [deviceIds];

        if (this.statePollingInterval) {
            clearInterval(this.statePollingInterval);
        }

        console.log(`[RegrooveState] Starting polling for devices [${this.targetDeviceIds.join(', ')}] every ${this.pollingIntervalMs}ms`);

        // Request immediately for all devices
        this.targetDeviceIds.forEach(deviceId => {
            this.requestPlayerState(deviceId);
        });

        this.statePollingInterval = setInterval(() => {
            // Poll all devices
            this.targetDeviceIds.forEach(deviceId => {
                this.requestPlayerState(deviceId);
            });
        }, this.pollingIntervalMs);

        console.log(`[RegrooveState] Polling started - interval ID: ${this.statePollingInterval}`);
    }

    // Stop polling
    stopPolling() {
        if (this.statePollingInterval) {
            clearInterval(this.statePollingInterval);
            this.statePollingInterval = null;
            console.log('[RegrooveState] Stopped polling');
        }
    }

    // Request player state from device
    requestPlayerState(deviceId) {
        if (this.sendSysExCallback) {
            // Send GET_PLAYER_STATE (0x60)
            this.sendSysExCallback(deviceId, 0x60, []);
        } else {
            console.warn(`[RegrooveState] Cannot request state - sendSysExCallback not initialized`);
        }
    }

    // Parse and handle PLAYER_STATE_RESPONSE (0x61)
    handlePlayerStateResponse(deviceId, data) {
        if (!data || data.length < 13) {
            console.warn('[RegrooveState] PLAYER_STATE_RESPONSE data too short');
            return;
        }

        // Parse header
        const flags = data[0];
        const order = data[1];
        const row = data[2];
        const pattern = data[3];
        const totalRows = data[4];
        const numChannels = data[5];
        const masterVolume = data[6];
        const mixerFlags = data[7];
        const inputVolume = data[8];
        const fxRouting = data[9];
        const stereoSeparation = data[10]; // 0-127 (maps to 0-200, where 64≈100=normal)
        const bpmLsb = data[11];
        const bpmMsb = data[12];
        const bpm = bpmLsb | (bpmMsb << 7); // Reconstruct BPM from 14-bit value
        const masterPan = data[13]; // 0-127 (0=left, 64=center, 127=right)
        const inputPan = data[14]; // 0-127 (0=left, 64=center, 127=right)

        // Extract playback state
        const playing = (flags & 0x01) !== 0;
        const mode = (flags >> 1) & 0x03; // bits 1-2

        // Extract mixer flags
        const masterMute = (mixerFlags & 0x01) !== 0;
        const inputMute = (mixerFlags & 0x02) !== 0;

        // Commented out to reduce console clutter
        // console.log(`[RegrooveState] Device ${deviceId} state: playing=${playing}, mode=${mode}, order=${order}, row=${row}, pattern=${pattern}, channels=${numChannels}`);

        // Parse bit-packed mute data (now starts at byte 15)
        const muteBytes = Math.ceil(numChannels / 8);
        if (data.length < 15 + muteBytes) {
            console.warn('[RegrooveState] PLAYER_STATE_RESPONSE incomplete mute data');
            return;
        }

        const mutedChannels = [];
        for (let ch = 0; ch < numChannels; ch++) {
            const byteIdx = 15 + Math.floor(ch / 8);
            const bitIdx = ch % 8;
            if (data[byteIdx] & (1 << bitIdx)) {
                mutedChannels.push(ch);
            }
        }

        // Commented out to reduce console clutter
        // console.log(`[RegrooveState] Device ${deviceId} muted channels: [${mutedChannels.join(', ')}]`);

        // Parse channel volumes array
        const volumeStartIdx = 15 + muteBytes;
        const channelVolumes = [];
        if (data.length >= volumeStartIdx + numChannels) {
            for (let ch = 0; ch < numChannels; ch++) {
                channelVolumes.push(data[volumeStartIdx + ch]);
            }
        }

        // Parse channel panning array
        const panStartIdx = volumeStartIdx + numChannels;
        const channelPans = [];
        if (data.length >= panStartIdx + numChannels) {
            for (let ch = 0; ch < numChannels; ch++) {
                channelPans.push(data[panStartIdx + ch]);
            }
        }

        // Get or create state for this device
        let deviceState = this.deviceStates.get(deviceId);

        if (!deviceState) {
            deviceState = {
                deviceId,
                soloedChannels: [] // Initialize local-only fields
            };
            this.deviceStates.set(deviceId, deviceState);
        }

        // Update state fields from SysEx response (preserving local-only fields like soloedChannels)
        deviceState.playing = playing;
        deviceState.mode = mode;
        deviceState.order = order;
        deviceState.row = row;
        deviceState.pattern = pattern;
        deviceState.totalRows = totalRows;
        deviceState.numChannels = numChannels;
        deviceState.masterVolume = masterVolume;
        deviceState.masterMute = masterMute;
        deviceState.masterPan = masterPan; // 0-127 (0=left, 64=center, 127=right)
        deviceState.inputVolume = inputVolume;
        deviceState.inputMute = inputMute;
        deviceState.inputPan = inputPan; // 0-127 (0=left, 64=center, 127=right)
        deviceState.fxRouting = fxRouting;
        deviceState.stereoSeparation = stereoSeparation; // 0-127 (maps to 0-200)
        deviceState.bpm = bpm; // 14-bit BPM value (0-16383)
        deviceState.mutedChannels = mutedChannels;
        deviceState.channelVolumes = channelVolumes;
        deviceState.channelPans = channelPans; // Array of pan values (0-127)
        deviceState.lastUpdate = Date.now();
        // Note: soloedChannels is NOT updated here - it's tracked locally only

        // Maintain backward compatibility: use device 0 as default player state
        if (deviceId === 0) {
            this.playerState = deviceState;
        }

        // Update connection timestamp (for debugging only)
        this.lastStateUpdate = Date.now();
        if (!this.isConnectedToRegroove) {
            this.isConnectedToRegroove = true;
            console.log('[RegrooveState] Connected - receiving state updates');
            if (this.onConnectionChange) {
                this.onConnectionChange(true);
            }
        }

        // Note: Connection watchdog removed - we just keep polling until responses come back

        // Notify callback
        if (this.onStateUpdate) {
            this.onStateUpdate(deviceId, deviceState);
        }
    }

    // Connection watchdog removed - we just keep polling until responses come back
    // No need to timeout and stop processing - cable disconnects happen!

    // Device State Query Methods
    getDeviceState(deviceId) {
        // Get state for specific device, or fall back to default
        if (this.deviceStates.has(deviceId)) {
            return this.deviceStates.get(deviceId);
        }
        // Fallback to device 0 or playerState
        return this.deviceStates.get(0) || this.playerState;
    }

    isLoopEnabled(deviceId) {
        const state = this.getDeviceState(deviceId);
        return state.mode === 0x01; // Mode 01 = pattern/loop
    }

    isChannelMuted(deviceId, channel) {
        const state = this.getDeviceState(deviceId);
        return state.mutedChannels && state.mutedChannels.includes(channel);
    }

    isChannelSoloed(deviceId, channel) {
        const state = this.getDeviceState(deviceId);
        return state.soloedChannels && state.soloedChannels.includes(channel);
    }

    getChannelVolume(deviceId, channel) {
        const state = this.getDeviceState(deviceId);
        return state.channelVolumes && state.channelVolumes[channel];
    }

    getCurrentPosition(deviceId) {
        const state = this.getDeviceState(deviceId);
        return {
            order: state.order,
            row: state.row,
            pattern: state.pattern,
            totalRows: state.totalRows
        };
    }

    isPlaying(deviceId) {
        const state = this.getDeviceState(deviceId);
        return state.playing;
    }

    getPlaybackMode(deviceId) {
        const state = this.getDeviceState(deviceId);
        const modes = ['song', 'pattern/loop', 'performance', 'record'];
        return modes[state.mode] || 'unknown';
    }

    // State Mutation Methods (for toggle operations)
    toggleChannelMuteState(deviceId, channel) {
        // Update local state tracking
        const state = this.getDeviceState(deviceId);
        if (!state.mutedChannels) {
            state.mutedChannels = [];
        }

        const index = state.mutedChannels.indexOf(channel);
        if (index > -1) {
            state.mutedChannels.splice(index, 1);
            return false; // Now unmuted
        } else {
            state.mutedChannels.push(channel);
            return true; // Now muted
        }
    }

    toggleChannelSoloState(deviceId, channel) {
        // Get or create state for THIS SPECIFIC device - no fallback!
        let state = this.deviceStates.get(deviceId);
        if (!state) {
            state = {
                deviceId,
                soloedChannels: [],
                mutedChannels: []
            };
            this.deviceStates.set(deviceId, state);
        }

        if (!state.soloedChannels) {
            state.soloedChannels = [];
        }

        const index = state.soloedChannels.indexOf(channel);
        const newState = (index === -1);

        if (index > -1) {
            state.soloedChannels.splice(index, 1);
        } else {
            state.soloedChannels.push(channel);
        }

        return newState;
    }

    // Get all devices
    getAllDeviceIds() {
        return Array.from(this.deviceStates.keys());
    }

    // Handle FX_STATE_RESPONSE (0x7F)
    handleFxStateResponse(deviceId, data) {
        if (!data || data.length < 19) { // Minimum length for version 1 format
            console.warn('[RegrooveState] FX_STATE_RESPONSE data too short');
            return;
        }

        // Parse header
        const programId = data[0];
        const version = data[1];
        const fxRouting = data[2];
        const enableFlags = data[3];

        if (version !== 0x01) {
            console.warn(`[RegrooveState] Unknown FX state version: 0x${version.toString(16)}`);
            return;
        }

        // Parse enable flags (bit-packed)
        const effects = {
            distortion: {
                enabled: (enableFlags & 0x01) !== 0,
                drive: data[4],
                mix: data[5]
            },
            filter: {
                enabled: (enableFlags & 0x02) !== 0,
                cutoff: data[6],
                resonance: data[7]
            },
            eq: {
                enabled: (enableFlags & 0x04) !== 0,
                low: data[8],
                mid: data[9],
                high: data[10]
            },
            reverb: {
                enabled: (enableFlags & 0x08) !== 0,
                roomSize: data[11],
                damping: data[12],
                mix: data[13]
            },
            delay: {
                enabled: (enableFlags & 0x10) !== 0,
                time: data[14],
                feedback: data[15],
                mix: data[16]
            }
        };

        // console.log(`[RegrooveState] Device ${deviceId} FX state (prog ${programId}): routing=${fxRouting}, enabled=${enableFlags.toString(2)}`);

        // Get or create state for this device
        let deviceState = this.deviceStates.get(deviceId);
        if (!deviceState) {
            deviceState = { deviceId, fxStates: {} };
            this.deviceStates.set(deviceId, deviceState);
        }

        // Initialize fxStates object if not present
        if (!deviceState.fxStates) {
            deviceState.fxStates = {};
        }

        // Store effects state by program ID (allows multiple programs per device)
        deviceState.fxStates[programId] = {
            programId,
            version,
            fxRouting,
            enableFlags,
            effects
        };

        // Keep backward compatibility: default fxState points to program 0
        if (programId === 0) {
            deviceState.fxState = deviceState.fxStates[0];
        }

        // Notify callback
        if (this.onStateUpdate) {
            this.onStateUpdate(deviceId, deviceState);
        }
    }

    // Clear all state
    clearAllState() {
        this.deviceStates.clear();
        this.lastStateUpdate = null;
        this.isConnectedToRegroove = false;
    }

    // Cleanup
    destroy() {
        this.stopPolling();
        this.clearAllState();
    }
}
