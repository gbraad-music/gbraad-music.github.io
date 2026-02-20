// Regroove Meister Controller - Minimalist WebMIDI Interface
class MeisterController {
    constructor() {
        this.midiOutput = null;
        this.midiAccess = null;
        this.midiChannel = 0; // Default channel 1 (0-indexed)
        this.config = this.getDefaultConfig();
        this.pads = [];
        this.editingPadIndex = null;
        this.enabledMidiInputs = new Set(); // Set of enabled MIDI input names (not IDs, as IDs change between sessions)

        // MIDI Clock Master
        this.clockMaster = false;
        this.clockBPM = 120;
        this.clockInterval = null;
        this.clockStartTime = 0;
        this.clockTickCount = 0;

        // Web Worker for clock timing (runs in separate thread!)
        this.clockWorker = null;
        this.initClockWorker();

        // SPP Position tracking
        this.receiveSPP = true;
        this.currentPosition = 0; // In MIDI beats (1/16th notes)
        this.patternLength = 64; // Default pattern length

        // Regroove State Manager
        this.regrooveState = new RegrooveStateManager();
        this.regrooveState.onStateUpdate = (deviceId, state) => {
            // Update pad colors when state changes
            this.updatePadColors();
            // Notify scene manager to update faders and effects
            if (this.sceneManager) {
                this.sceneManager.updateMixerFromDeviceState(deviceId, state);
                this.sceneManager.updateEffectsFromDeviceState(deviceId, state);
            }
        };
        this.regrooveState.onConnectionChange = (connected) => {
            this.isConnectedToRegroove = connected;
        };

        // SysEx message handlers (for upload/download etc)
        this.sysexHandlers = new Map(); // command -> callback
        this.regrooveDeviceId = 0; // Target Regroove device ID

        this.init();
    }

    getDefaultConfig() {
        return {
            version: "1.0",
            gridLayout: "4x4",
            midiChannel: 0,
            pads: [
                { label: "PLAY\nPAUSE", cc: 41 },
                { label: "STOP", cc: 42 },
                { label: "RETRIG", cc: 45 },
                { label: "LOOP\nTOGGLE", cc: 46 },
                { label: "PREV\nORDER", cc: 43 },
                { label: "NEXT\nORDER", cc: 44 },
                { label: "SYNC\nTEMPO", cc: 70 },
                { label: "RECV\nSTART", cc: 71 },
                { label: "RECV\nSPP", cc: 72 },
                { label: "SEND\nCLOCK", cc: 73 },
                { label: "SEND\nSTART", cc: 74 },
                { label: "SEND\nSPP", cc: 75 },
                { label: "SPP\nMODE", cc: 76 },
                { label: "FILE\nLOAD", cc: 60 },
                { label: "FILE\nNEXT", cc: 62 },
                { label: "FILE\nPREV", cc: 61 }
            ]
        };
    }

    async init() {
        this.loadConfig(); // Load config FIRST so midiOutputId is available
        await this.setupMIDI();

        // Initialize regrooveState with MIDI send callback
        this.regrooveState.init((deviceId, command, data) => {
            this.sendSysEx(deviceId, command, data);
        });

        this.setupUI();
        this.createPads();
    }

    async setupMIDI() {
        try {
            this.midiAccess = await navigator.requestMIDIAccess({ sysex: true });
            // console.log('MIDI Access granted (with SysEx)');
            this.populateMIDIOutputs();
            this.setupMIDIInputs();
            this.midiAccess.onstatechange = () => {
                this.populateMIDIOutputs();
                this.setupMIDIInputs();
            };
        } catch (err) {
            console.error('MIDI Access failed:', err);
        }
    }

    setupMIDIInputs() {
        if (!this.midiAccess) {
            console.warn('[Meister] setupMIDIInputs called but midiAccess is null');
            return;
        }

        // console.log('[Meister] Setting up MIDI input listeners...');
        let count = 0;

        // If no enabled inputs are configured, start with empty set (user must explicitly enable inputs)
        // This prevents locking all MIDI devices on platforms like Windows
        if (!this.enabledMidiInputs) {
            this.enabledMidiInputs = new Set();
            // console.log('[Meister] No enabled inputs configured, starting with none enabled to avoid device locks');
        }

        // Store the handler function reference for each input so we can remove it later
        if (!this.midiInputHandlers) {
            this.midiInputHandlers = new Map();
        }

        // Remove existing listeners from all inputs
        for (let input of this.midiAccess.inputs.values()) {
            const existingHandler = this.midiInputHandlers.get(input.name);
            if (existingHandler) {
                input.removeEventListener('midimessage', existingHandler);
            }
        }

        // Listen only to enabled MIDI inputs (match by name, not ID)
        for (let input of this.midiAccess.inputs.values()) {
            if (this.enabledMidiInputs.has(input.name)) {
                const handler = (event) => this.handleMIDIMessage(event);
                this.midiInputHandlers.set(input.name, handler);
                input.addEventListener('midimessage', handler);
                // console.log(`[Meister] ✓ Listener attached to: ${input.name}`);
                count++;
            } else {
                // console.log(`[Meister] ✗ Skipped (disabled): ${input.name}`);
            }
        }
        // console.log(`[Meister] ${count} MIDI input(s) configured (${this.midiAccess.inputs.size} total available)`);
    }

    handleMIDIMessage(event) {
        const data = event.data;
        const status = data[0];
        const messageType = status & 0xF0;

        // Check if we're in sequencer note entry mode
        const currentScene = this.sceneManager?.currentScene;
        const scene = currentScene ? this.sceneManager.scenes.get(currentScene) : null;
        const isSequencerNoteEntry = scene?.type === 'sequencer' && messageType === 0x90;

        // Route channel messages through InputRouter (if configured)
        // System messages (>= 0xF0) are NOT routed - they're handled locally
        // Note On messages in sequencer mode are NOT routed - handled by sequencer
        const isSystemMessage = (status >= 0xF0);
        if (!isSystemMessage && !isSequencerNoteEntry && this.inputRouter) {
            // Use input name for routing (not ID, as IDs change between sessions)
            this.inputRouter.routeMessage(event.target.name, data);
        }

        // Check for SysEx messages (0xF0)
        if (status === 0xF0) {
            this.handleSysExMessage(data);
            return;
        }

        const data1 = data[1];
        const data2 = data[2];

        // SPP (Song Position Pointer) - 0xF2
        if (status === 0xF2 && this.receiveSPP) {
            // SPP is in MIDI beats (1/16th notes)
            // data1 = LSB, data2 = MSB
            const rawPosition = (data2 << 7) | data1;

            // Modulo 64 to get position within pattern (Regroove sends 64-row patterns)
            this.currentPosition = rawPosition % 64;

            this.updatePositionBar();
            // console.log(`SPP Received: ${rawPosition} -> Position in pattern: ${this.currentPosition} (row ${this.currentPosition})`);

            // Forward to sequencer if active
            this.notifySequencerSPP(rawPosition);
        }

        // MIDI Clock (0xF8) - forward to sequencer for stable timing
        if (status === 0xF8) {
            this.notifySequencerClock();
        }

        // Start (0xFA) - Reset position
        if (status === 0xFA && this.receiveSPP) {
            this.currentPosition = 0;
            this.updatePositionBar();
            // console.log('MIDI Start received - position reset');

            // Forward to sequencer if active
            this.notifySequencerStart();
        }

        // Stop (0xFC) - Keep position
        if (status === 0xFC && this.receiveSPP) {
            // Position stays where it is
            this.updatePositionBar();
            // console.log('MIDI Stop received');

            // Forward to sequencer if active
            this.notifySequencerStop();
        }
    }

    handleSysExMessage(data) {
        // Check for Regroove SysEx: F0 7D <device_id> <command> [data...] F7
        if (data.length < 5) return;
        if (data[0] !== 0xF0 || data[1] !== 0x7D) return; // Not Regroove SysEx
        if (data[data.length - 1] !== 0xF7) return; // Invalid end

        const deviceId = data[2];
        const command = data[3];
        const payload = data.slice(4, -1); // Extract data between command and F7

        // Commented out to reduce console clutter
        // if (command === 0x61) {
        //     console.log(`[SysEx] Received PLAYER_STATE_RESPONSE from device ${deviceId}, length: ${payload.length} bytes`);
        // }

        // Only log non-state commands to reduce spam (0x60 = GET_PLAYER_STATE, 0x61 = PLAYER_STATE_RESPONSE, 0x62 = GET_SEQUENCE_STATE, 0x63 = SEQUENCE_STATE_RESPONSE, 0x64 = GET_PROGRAM_STATE, 0x65 = PROGRAM_STATE_RESPONSE, 0x71 = FX_EFFECT_SET, 0x7E = FX_GET_ALL_STATE, 0x7F = FX_STATE_RESPONSE)
        if (command !== 0x60 && command !== 0x61 && command !== 0x62 && command !== 0x63 && command !== 0x64 && command !== 0x65 && command !== 0x71 && command !== 0x7E && command !== 0x7F) {
            // console.log(`[SysEx] Received command ${command.toString(16)} from device ${deviceId}`);
        }

        // Check for registered handlers (upload/download etc)
        if (this.sysexHandlers.has(command)) {
            const handler = this.sysexHandlers.get(command);
            handler(data); // Pass full SysEx message
        }

        // PLAYER_STATE_RESPONSE = 0x61
        if (command === 0x61) {
            // Commented out to reduce console spam - uncomment for debugging
            // console.log(`[Meister] Received PLAYER_STATE_RESPONSE from device ${deviceId}, routing to regrooveState`);
            this.regrooveState.handlePlayerStateResponse(deviceId, payload);
        }

        // SEQUENCE_STATE_RESPONSE = 0x63
        if (command === 0x63 && this.actionDispatcher) {
            // Find device by deviceId number
            const device = this.deviceManager?.getDeviceByDeviceId(deviceId);
            if (device) {
                // console.log(`[SysEx 0x63] SEQUENCE_STATE_RESPONSE from device ${device.name} (ID ${deviceId})`);
                this.actionDispatcher.handleSequenceStateResponse(device.id, data);
            } else {
                console.warn(`[SysEx] Received sequence state from unknown device ${deviceId}`);
            }
        }

        // PROGRAM_STATE_RESPONSE = 0x65 (Samplecrate mixer state)
        if (command === 0x65 && this.actionDispatcher) {
            // Find device by deviceId number
            const device = this.deviceManager?.getDeviceByDeviceId(deviceId);
            if (device) {
                // console.log(`[SysEx 0x65] PROGRAM_STATE_RESPONSE from device ${device.name} (ID ${deviceId})`);
                this.actionDispatcher.handleProgramStateResponse(device.id, data);
            } else {
                console.warn(`[SysEx] Received program state from unknown device ${deviceId}`);
            }
        }

        // DECKS_STATE_RESPONSE = 0x67 (Mixxx deck state)
        if (command === 0x67 && this.sceneManager) {
            // Find device by deviceId number
            const device = this.deviceManager?.getDeviceByDeviceId(deviceId);
            if (device) {
                // console.log(`[SysEx 0x67] DECKS_STATE_RESPONSE from device ${device.name} (ID ${deviceId}), data length: ${data.length}`);
                this.sceneManager.handleDeckStateResponse(device.id, data);
            } else {
                console.warn(`[SysEx] Received deck state from unknown device ${deviceId}`);
            }
        }

        // FX_STATE_RESPONSE = 0x7F
        if (command === 0x7F) {
            this.regrooveState.handleFxStateResponse(deviceId, payload);
        }
    }

    // Register a handler for a specific SysEx command
    registerSysExHandler(command, callback) {
        // console.log(`[Meister] Registered SysEx handler for command 0x${command.toString(16)}`);
        this.sysexHandlers.set(command, callback);
    }

    // Unregister a handler for a specific SysEx command
    unregisterSysExHandler(command) {
        // console.log(`[Meister] Unregistered SysEx handler for command 0x${command.toString(16)}`);
        this.sysexHandlers.delete(command);
    }

    // Device State Management Helper Methods (delegate to regrooveState)
    getDeviceState(deviceId) {
        return this.regrooveState.getDeviceState(deviceId);
    }

    isLoopEnabled(deviceId) {
        return this.regrooveState.isLoopEnabled(deviceId);
    }

    isChannelMuted(deviceId, channel) {
        return this.regrooveState.isChannelMuted(deviceId, channel);
    }

    isChannelSoloed(deviceId, channel) {
        return this.regrooveState.isChannelSoloed(deviceId, channel);
    }

    toggleChannelMuteState(deviceId, channel) {
        return this.regrooveState.toggleChannelMuteState(deviceId, channel);
    }

    toggleChannelSoloState(deviceId, channel) {
        return this.regrooveState.toggleChannelSoloState(deviceId, channel);
    }

    populateMIDIOutputs() {
        const select = document.getElementById('midi-output');
        const currentValue = select.value;
        select.innerHTML = '<option value="">-- Select MIDI Output --</option>';

        if (this.midiAccess) {
            // Add physical MIDI outputs
            for (let output of this.midiAccess.outputs.values()) {
                const option = document.createElement('option');
                option.value = output.name; // Use name instead of ID (IDs change between sessions)
                option.textContent = output.name;
                select.appendChild(option);
            }

            // Add WebRTC virtual MIDI outputs
            if (this.webrtcMidiUI) {
                const manager = this.webrtcMidiUI.getManager();
                if (manager) {
                    const virtualOutputs = manager.getVirtualOutputs();
                    if (virtualOutputs.length > 0) {
                        // Add a separator
                        const separator = document.createElement('option');
                        separator.disabled = true;
                        separator.textContent = '───── WebRTC Outputs ─────';
                        select.appendChild(separator);

                        virtualOutputs.forEach(output => {
                            const option = document.createElement('option');
                            option.value = output.name;
                            option.textContent = `🌐 ${output.name}`;
                            select.appendChild(option);
                        });
                    }
                }
            }

            // Try to restore saved MIDI output from config, or fall back to current dropdown value
            const savedOutputName = this.config.midiOutputName || currentValue;

            if (savedOutputName) {
                select.value = savedOutputName;
                if (select.value === savedOutputName) {
                    // Find output by name (check physical outputs first)
                    this.midiOutput = Array.from(this.midiAccess.outputs.values())
                        .find(output => output.name === savedOutputName);

                    // If not found, check WebRTC virtual outputs
                    if (!this.midiOutput && this.webrtcMidiUI) {
                        const manager = this.webrtcMidiUI.getManager();
                        if (manager) {
                            const virtualOutputs = manager.getVirtualOutputs();
                            this.midiOutput = virtualOutputs.find(output => output.name === savedOutputName);
                        }
                    }

                    if (this.midiOutput) {
                        this.updateConnectionStatus(true);
                        // Note: State polling is now managed by scene manager, not globally
                        // console.log(`[MIDI] Restored output: ${this.midiOutput.name}`);
                    }
                }
            }
        }
    }

    setupUI() {
        // Menu button
        document.getElementById('menu-button').addEventListener('click', () => {
            this.openSettings();
        });

        // Close settings
        document.getElementById('close-settings').addEventListener('click', () => {
            this.closeSettings();
        });

        // Click overlay to close
        document.getElementById('settings-overlay').addEventListener('click', (e) => {
            if (e.target.id === 'settings-overlay') {
                this.closeSettings();
            }
        });

        // MIDI output selection
        document.getElementById('midi-output').addEventListener('change', (e) => {
            const outputName = e.target.value;
            if (outputName && this.midiAccess) {
                // Find output by name (not ID, as IDs change between sessions)
                this.midiOutput = Array.from(this.midiAccess.outputs.values())
                    .find(output => output.name === outputName);
                this.updateConnectionStatus(true);
                this.saveConfig();

                // Auto-start clock if it was enabled
                if (this.clockMaster) {
                    this.startClock();
                }

                // Note: State polling is now managed by scene manager, not globally
                // Trigger scene switch to start polling if scene manager exists
                if (this.sceneManager) {
                    this.sceneManager.switchScene(this.sceneManager.currentScene);
                }
            } else {
                this.midiOutput = null;
                this.updateConnectionStatus(false);

                // Stop clock if output disconnected
                if (this.clockMaster) {
                    this.stopClock();
                }

                // Stop state polling (handled by scene manager via regrooveState)
                if (this.regrooveState) {
                    this.regrooveState.stopPolling();
                }
            }
        });

        // Load config
        document.getElementById('load-config').addEventListener('click', () => {
            document.getElementById('file-input').click();
        });

        document.getElementById('file-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.loadConfigFromFile(file);
            }
        });

        // Save config
        document.getElementById('save-config').addEventListener('click', () => {
            if (!this.sceneEditor) {
                console.warn('[Config] SceneEditor not yet initialized');
                window.nbDialog.alert('Please wait for the app to fully load before saving configuration.');
                return;
            }
            this.downloadConfig();
        });

        // Close pad editor
        document.getElementById('close-pad-editor').addEventListener('click', () => {
            this.closePadEditor();
        });

        // Save pad config
        document.getElementById('save-pad').addEventListener('click', () => {
            this.savePadConfig();
        });

        // Clear pad
        document.getElementById('clear-pad').addEventListener('click', () => {
            this.clearPad();
        });

        // Knob enabled checkbox
        document.getElementById('pad-knob-enabled').addEventListener('change', (e) => {
            const knobConfig = document.getElementById('pad-knob-config');
            knobConfig.style.display = e.target.checked ? 'block' : 'none';
        });

        // Message type selector
        document.getElementById('pad-message-type').addEventListener('change', (e) => {
            const messageType = e.target.value;
            this.updatePadEditorFields(messageType);

            // For sequencer message type, also show parameter fields based on selected action
            if (messageType === 'sequencer') {
                const select = document.getElementById('pad-sequencer-action');
                const selectedOption = select.options[select.selectedIndex];
                const actionValue = selectedOption.value;

                const sceneField = document.getElementById('pad-sequencer-scene-field');
                const trackField = document.getElementById('pad-sequencer-track-field');
                const deviceField = document.getElementById('pad-device-sequencer-field');
                const slotField = document.getElementById('pad-device-sequencer-slot-field');

                // Hide all first
                sceneField.style.display = 'none';
                trackField.style.display = 'none';
                deviceField.style.display = 'none';
                slotField.style.display = 'none';

                // Show appropriate fields based on default action
                if (actionValue === 'play' || actionValue === 'stop' || actionValue === 'play_stop') {
                    sceneField.style.display = 'block';
                    this.populateSequencerScenes();
                } else if (actionValue === 'mute_track' || actionValue === 'solo_track') {
                    sceneField.style.display = 'block';
                    trackField.style.display = 'block';
                    this.populateSequencerScenes();
                } else if (actionValue.startsWith('device_')) {
                    deviceField.style.display = 'block';
                    slotField.style.display = 'block';
                    this.populateDeviceSequencerDevices();
                }
            }
        });

        // Secondary message type selector
        document.getElementById('pad-secondary-message-type').addEventListener('change', (e) => {
            this.updateSecondaryPadEditorFields(e.target.value);
        });

        // MMC command selector - show/hide locate params
        document.getElementById('pad-mmc-command').addEventListener('change', (e) => {
            const locateParams = document.getElementById('pad-mmc-locate-params');
            locateParams.style.display = e.target.value === 'locate' ? 'block' : 'none';
        });

        // SysEx action selector - show/hide parameter fields
        document.getElementById('pad-sysex-action').addEventListener('change', (e) => {
            const jumpParams = document.getElementById('pad-sysex-jump-params');
            const fileParams = document.getElementById('pad-sysex-file-params');
            const channelParams = document.getElementById('pad-sysex-channel-params');

            jumpParams.style.display = e.target.value === 'jump_to_order_row' ? 'block' : 'none';
            fileParams.style.display = e.target.value === 'file_load' ? 'block' : 'none';
            channelParams.style.display = (e.target.value === 'channel_mute' || e.target.value === 'channel_solo') ? 'block' : 'none';
        });

        // Regroove action selector - show/hide routing parameter fields
        document.getElementById('pad-regroove-action').addEventListener('change', (e) => {
            const selectedOption = e.target.options[e.target.selectedIndex];
            const actionId = selectedOption.getAttribute('data-action');
            const routingParams = document.getElementById('pad-routing-input-params');

            // Show routing params for ACTION_SWITCH_INPUT_ROUTE (602)
            if (actionId === '602') {
                routingParams.style.display = 'block';
                this.populateRoutingInputs();
            } else {
                routingParams.style.display = 'none';
            }
        });

        // Action selector (MIDI, Routing, Sequencer) - show/hide parameter fields
        document.getElementById('pad-action-select').addEventListener('change', (e) => {
            const selectedOption = e.target.options[e.target.selectedIndex];
            const actionId = selectedOption.getAttribute('data-action');
            const dataParam = selectedOption.getAttribute('data-param');

            const routingParams = document.getElementById('pad-routing-input-params');

            // Hide all parameter fields by default (only if they exist)
            if (routingParams) routingParams.style.display = 'none';

            // Show routing params for ACTION_SWITCH_INPUT_ROUTE (602) with custom param
            if (actionId === '602' && dataParam === 'custom') {
                if (routingParams) {
                    routingParams.style.display = 'block';
                    this.populateRoutingInputs();
                }
            }
        });

        // Sequencer action selector - show/hide parameter fields
        document.getElementById('pad-sequencer-action').addEventListener('change', (e) => {
            const selectedOption = e.target.options[e.target.selectedIndex];
            const actionValue = selectedOption.value;
            const actionId = selectedOption.getAttribute('data-action');

            const sceneField = document.getElementById('pad-sequencer-scene-field');
            const trackField = document.getElementById('pad-sequencer-track-field');
            const deviceField = document.getElementById('pad-device-sequencer-field');
            const slotField = document.getElementById('pad-device-sequencer-slot-field');

            // Hide all fields by default
            sceneField.style.display = 'none';
            trackField.style.display = 'none';
            deviceField.style.display = 'none';
            slotField.style.display = 'none';

            // Meister sequencer actions (play, stop, play_stop) - show scene selector
            if (actionValue === 'play' || actionValue === 'stop' || actionValue === 'play_stop') {
                sceneField.style.display = 'block';
                this.populateSequencerScenes();
            }
            // Meister track actions (mute_track, solo_track) - show scene + track selectors
            else if (actionValue === 'mute_track' || actionValue === 'solo_track') {
                sceneField.style.display = 'block';
                trackField.style.display = 'block';
                this.populateSequencerScenes();
            }
            // Device sequencer actions - show device + slot selectors
            else if (actionValue.startsWith('device_')) {
                deviceField.style.display = 'block';
                slotField.style.display = 'block';
                this.populateDeviceSequencerDevices();
            }
        });

        // MIDI Clock Master
        document.getElementById('clock-master').addEventListener('change', (e) => {
            this.clockMaster = e.target.checked;
            if (this.clockMaster) {
                this.startClock();
            } else {
                this.stopClock();
            }
            this.saveConfig();
        });

        // Open tempo slider popup on click (touch-friendly!)
        document.getElementById('clock-bpm').addEventListener('click', (e) => {
            e.target.blur(); // Prevent keyboard popup on mobile
            this.openTempoSlider();
        });

        document.getElementById('clock-bpm').addEventListener('change', (e) => {
            this.clockBPM = parseInt(e.target.value) || 120;
            if (this.clockMaster) {
                // Update BPM dynamically without restarting clock
                this.updateClockBPM(this.clockBPM);
            }

            // Sync sequencer BPM if active
            if (this.sceneManager) {
                const currentScene = this.sceneManager.scenes.get(this.sceneManager.currentScene);
                if (currentScene && currentScene.type === 'sequencer' && currentScene.sequencerInstance) {
                    currentScene.sequencerInstance.engine.bpm = this.clockBPM;
                    currentScene.sequencerInstance.engine.msPerRow = currentScene.sequencerInstance.engine.calculateMsPerRow();

                    // Update sequencer BPM display
                    const seqBpmInput = document.getElementById('seq-bpm-input');
                    if (seqBpmInput) {
                        seqBpmInput.value = this.clockBPM;
                    }

                    // console.log(`[Sequencer] BPM synced from global clock: ${this.clockBPM}`);
                }
            }

            this.saveConfig();
        });

        // Receive SPP
        document.getElementById('receive-spp').addEventListener('change', (e) => {
            this.receiveSPP = e.target.checked;
            // Position bar is always visible now (used for playback position + loop length)
            // receiveSPP only controls whether we respond to incoming SPP messages

            this.saveConfig();
        });

        // Global polling interval control removed - polling is now per-scene

        // Show status bar on mouse movement
        let statusTimeout;
        document.addEventListener('mousemove', () => {
            const statusBar = document.getElementById('status-bar');
            statusBar.classList.add('visible');
            clearTimeout(statusTimeout);
            statusTimeout = setTimeout(() => {
                statusBar.classList.remove('visible');
            }, 2000);
        });
    }

    openSettings() {
        document.getElementById('settings-overlay').classList.add('active');
    }

    closeSettings() {
        document.getElementById('settings-overlay').classList.remove('active');
    }

    openPadEditor(padIndex = null) {
        this.editingPadIndex = padIndex;
        const editor = document.getElementById('pad-editor-overlay');

        // Hide error message when opening editor
        document.getElementById('pad-label-error').style.display = 'none';

        // Populate device binding dropdown
        this.populatePadDeviceBindings();

        // Populate note program change dropdown
        this.populateNoteProgramDropdown();

        // Populate note selector buttons
        this.populateNoteSelectorButtons();

        // Populate SysEx channel dropdown (CH1-CH64)
        this.populateSysExChannelDropdown();

        // Get pad config from the correct location (split scene vs default pads)
        const isCustomScene = this.currentPadSceneId && this.currentPadSceneId !== 'pads';
        let pad = null;
        if (padIndex !== null) {
            if (isCustomScene) {
                const scene = this.sceneManager?.scenes.get(this.currentPadSceneId);
                pad = scene?.pads?.[padIndex];
            } else {
                pad = this.config.pads[padIndex];
            }
        }

        if (padIndex !== null && pad) {
            document.getElementById('pad-label').value = pad.label || '';
            document.getElementById('pad-sublabel').value = pad.sublabel || '';
            document.getElementById('pad-device-binding').value = pad.deviceBinding || '';

            // Determine message type
            if (pad.action !== undefined) {
                // New action system - determine message type based on action ID range
                // 100-199 = Regroove
                // 200-299 = MIDI Clock
                // 600-699 = Routing
                // 700-799 = Sequencer
                let messageType, selectId;

                if (pad.action >= 700 && pad.action < 800) {
                    messageType = 'sequencer';
                    selectId = 'pad-sequencer-action';
                } else if ((pad.action >= 200 && pad.action < 300) || (pad.action >= 600 && pad.action < 700)) {
                    messageType = 'action';
                    selectId = 'pad-action-select';
                } else {
                    messageType = 'regroove';
                    selectId = 'pad-regroove-action';
                }

                document.getElementById('pad-message-type').value = messageType;

                // Find the option with matching data-action attribute
                const select = document.getElementById(selectId);
                let foundOption = false;

                for (let i = 0; i < select.options.length; i++) {
                    const option = select.options[i];
                    const actionId = option.getAttribute('data-action');

                    if (actionId === pad.action.toString()) {
                        select.selectedIndex = i;
                        foundOption = true;

                        // If this is a routing action with a custom parameter, show and populate the input selector
                        if (pad.action === 602 && pad.parameter !== undefined) {
                            this.populateRoutingInputs();
                            const routingParams = document.getElementById('pad-routing-input-params');
                            routingParams.style.display = 'block';

                            const routingSelect = document.getElementById('pad-routing-input-select');
                            if (routingSelect) {
                                routingSelect.value = pad.parameter || '';
                            }
                        }
                        // Note: Sequencer action parameter fields are now handled after updatePadEditorFields()
                        break;
                    }
                }

                if (!foundOption) {
                    console.warn(`[Pad Editor] Action ${pad.action} not found in ${messageType} dropdown`);
                }

                // Update visible fields
                this.updatePadEditorFields(messageType);

                // Trigger parameter field visibility based on action (for sequencer actions)
                if (messageType === 'sequencer') {
                    const select = document.getElementById('pad-sequencer-action');
                    const selectedOption = select.options[select.selectedIndex];
                    const actionValue = selectedOption.value;

                    const sceneField = document.getElementById('pad-sequencer-scene-field');
                    const trackField = document.getElementById('pad-sequencer-track-field');
                    const deviceField = document.getElementById('pad-device-sequencer-field');
                    const slotField = document.getElementById('pad-device-sequencer-slot-field');

                    // Show appropriate fields based on action
                    if (actionValue === 'play' || actionValue === 'stop' || actionValue === 'play_stop') {
                        sceneField.style.display = 'block';
                        this.populateSequencerScenes();
                        // Set value if parameter exists
                        if (pad.parameter) {
                            document.getElementById('pad-sequencer-scene-select').value = pad.parameter;
                        }
                    } else if (actionValue === 'mute_track' || actionValue === 'solo_track') {
                        sceneField.style.display = 'block';
                        trackField.style.display = 'block';
                        this.populateSequencerScenes();
                        // Set values if parameter exists
                        if (typeof pad.parameter === 'object') {
                            document.getElementById('pad-sequencer-scene-select').value = pad.parameter.sceneId || '';
                            document.getElementById('pad-sequencer-track-number').value = pad.parameter.trackNumber || 1;
                        }
                    } else if (actionValue.startsWith('device_')) {
                        deviceField.style.display = 'block';
                        slotField.style.display = 'block';
                        this.populateDeviceSequencerDevices();
                        // Set values - prefer deviceId field (stable), fallback to parameter (deprecated)
                        if (pad.deviceId) {
                            // New format: use device string ID
                            document.getElementById('pad-device-seq-device-select').value = pad.deviceId;
                            const slot = pad.parameter & 0xFF;
                            document.getElementById('pad-device-seq-slot-select').value = slot.toString();
                        } else if (pad.parameter !== undefined) {
                            // Old format: use device index (may be broken if devices changed)
                            const deviceIndex = (pad.parameter >> 8) & 0xFF;
                            const slot = pad.parameter & 0xFF;
                            document.getElementById('pad-device-seq-device-select').value = deviceIndex.toString();
                            document.getElementById('pad-device-seq-slot-select').value = slot.toString();
                        }
                    }
                }
            } else if (pad.mmc !== undefined) {
                document.getElementById('pad-message-type').value = 'mmc';
                document.getElementById('pad-mmc-command').value = pad.mmc || 'stop';
            } else if (pad.cc !== undefined && pad.cc !== null) {
                // Check if this is a known Regroove action CC
                if (this.isRegrooveActionCC(pad.cc)) {
                    document.getElementById('pad-message-type').value = 'regroove';
                    document.getElementById('pad-regroove-action').value = pad.cc.toString();
                } else {
                    document.getElementById('pad-message-type').value = 'cc';
                    document.getElementById('pad-cc').value = pad.cc || '';
                }
            } else if (pad.note !== undefined && pad.note !== null) {
                document.getElementById('pad-message-type').value = 'note';
                const noteValue = parseInt(pad.note) || 60;
                document.getElementById('pad-note').value = noteValue;
                this.updatePadNoteSelection(noteValue); // Update button highlights
                document.getElementById('pad-note-program').value = pad.noteProgram !== undefined ? pad.noteProgram : '-1';
            } else if (pad.sysex !== undefined) {
                document.getElementById('pad-message-type').value = 'sysex';
                document.getElementById('pad-sysex-action').value = pad.sysex || 'play';

                // Load SysEx parameters if present
                if (pad.sysexParams) {
                    if (pad.sysex === 'jump_to_order_row' && pad.sysexParams.order !== undefined) {
                        document.getElementById('pad-sysex-jump-order').value = pad.sysexParams.order;
                        document.getElementById('pad-sysex-jump-row').value = pad.sysexParams.row || 0;
                        document.getElementById('pad-sysex-jump-params').style.display = 'block';
                    } else if (pad.sysex === 'file_load' && pad.sysexParams.filename) {
                        document.getElementById('pad-sysex-filename').value = pad.sysexParams.filename;
                        document.getElementById('pad-sysex-file-params').style.display = 'block';
                    } else if ((pad.sysex === 'channel_mute' || pad.sysex === 'channel_solo') && pad.sysexParams.channel !== undefined) {
                        document.getElementById('pad-sysex-channel').value = pad.sysexParams.channel;
                        document.getElementById('pad-sysex-channel-params').style.display = 'block';
                    }
                }
            } else if (pad.display !== undefined) {
                document.getElementById('pad-message-type').value = 'display';

                // Determine if this is a scene or device display
                if (pad.display.sceneId) {
                    document.getElementById('pad-display-source-type').value = 'scene';
                    this.populateDisplayScenes();
                    // Set value after populating to ensure option exists
                    const sceneSelect = document.getElementById('pad-display-scene');
                    sceneSelect.value = pad.display.sceneId;
                    // Verify it was set correctly
                    // if (sceneSelect.value !== pad.display.sceneId) {
                    //     console.warn(`[PadEditor] Failed to set scene value to "${pad.display.sceneId}", available options:`, Array.from(sceneSelect.options).map(o => o.value));
                    // }
                    document.getElementById('pad-display-scene-select-container').style.display = 'block';
                    document.getElementById('pad-display-device-select-container').style.display = 'none';
                } else {
                    document.getElementById('pad-display-source-type').value = 'device';
                    this.populateDisplayDevices();
                    document.getElementById('pad-display-device').value = pad.display.deviceId || '';
                    document.getElementById('pad-display-scene-select-container').style.display = 'none';
                    document.getElementById('pad-display-device-select-container').style.display = 'block';
                }

                document.getElementById('pad-display-mode').value = pad.display.mode || 'push';
                document.getElementById('pad-display-interval').value = pad.display.interval || 100;
            } else {
                document.getElementById('pad-message-type').value = 'regroove';
            }

            // Load MMC parameters if present
            if (pad.mmc === 'locate' && pad.mmcParams) {
                document.getElementById('pad-mmc-locate-order').value = pad.mmcParams.order || 0;
                document.getElementById('pad-mmc-locate-row').value = pad.mmcParams.row || 0;
                document.getElementById('pad-mmc-locate-params').style.display = 'block';
            }

            this.updatePadEditorFields(document.getElementById('pad-message-type').value);

            // Load secondary action if present
            if (pad.secondaryCC !== undefined || pad.secondaryNote !== undefined || pad.secondaryMMC !== undefined) {
                if (pad.secondaryMMC !== undefined) {
                    document.getElementById('pad-secondary-message-type').value = 'mmc';
                    document.getElementById('pad-secondary-mmc-command').value = pad.secondaryMMC || 'stop';
                } else if (pad.secondaryCC !== undefined) {
                    if (this.isRegrooveActionCC(pad.secondaryCC)) {
                        document.getElementById('pad-secondary-message-type').value = 'regroove';
                        document.getElementById('pad-secondary-regroove-action').value = pad.secondaryCC.toString();
                    } else {
                        document.getElementById('pad-secondary-message-type').value = 'cc';
                        document.getElementById('pad-secondary-cc').value = pad.secondaryCC || '';
                    }
                } else if (pad.secondaryNote !== undefined) {
                    document.getElementById('pad-secondary-message-type').value = 'note';
                    document.getElementById('pad-secondary-note').value = pad.secondaryNote || '';
                }
                this.updateSecondaryPadEditorFields(document.getElementById('pad-secondary-message-type').value);
            } else {
                document.getElementById('pad-secondary-message-type').value = 'none';
                this.updateSecondaryPadEditorFields('none');
            }

            // Load knob configuration if present
            if (pad.ccKnob) {
                document.getElementById('pad-knob-enabled').checked = true;
                document.getElementById('pad-knob-cc').value = pad.ccKnob.cc || 1;
                document.getElementById('pad-knob-min').value = pad.ccKnob.min !== undefined ? pad.ccKnob.min : 0;
                document.getElementById('pad-knob-max').value = pad.ccKnob.max !== undefined ? pad.ccKnob.max : 127;
                document.getElementById('pad-knob-value').value = pad.ccKnob.value !== undefined ? pad.ccKnob.value : 64;
                document.getElementById('pad-knob-config').style.display = 'block';
            } else {
                document.getElementById('pad-knob-enabled').checked = false;
                document.getElementById('pad-knob-cc').value = 1;
                document.getElementById('pad-knob-min').value = 0;
                document.getElementById('pad-knob-max').value = 127;
                document.getElementById('pad-knob-value').value = 64;
                document.getElementById('pad-knob-config').style.display = 'none';
            }

            document.getElementById('pad-editor-title').textContent = `EDIT PAD ${padIndex + 1}`;
        } else {
            // New pad
            document.getElementById('pad-label').value = '';
            document.getElementById('pad-sublabel').value = '';
            document.getElementById('pad-device-binding').value = '';
            document.getElementById('pad-message-type').value = 'regroove';
            document.getElementById('pad-regroove-action').value = '41';
            this.updatePadEditorFields('regroove');
            document.getElementById('pad-secondary-message-type').value = 'none';
            this.updateSecondaryPadEditorFields('none');
            document.getElementById('pad-editor-title').textContent = 'EDIT PAD';
        }

        editor.classList.add('active');
    }

    populatePadDeviceBindings() {
        const select = document.getElementById('pad-device-binding');
        if (!select) return;

        // Get device manager
        const deviceManager = this.deviceManager;
        if (!deviceManager) {
            select.innerHTML = '<option value="">Default Device</option>';
            return;
        }

        const devices = deviceManager.getAllDevices();
        select.innerHTML = '<option value="">Default Device</option>' +
            devices.map(device =>
                `<option value="${device.id}">${device.name} (Ch ${device.midiChannel + 1}, ID ${device.deviceId})</option>`
            ).join('');
    }

    populateNoteProgramDropdown() {
        const select = document.getElementById('pad-note-program');
        if (!select) return;

        // Build options: No Program Change (-1) + Programs 1-128 (wire: 0-127)
        select.innerHTML = '<option value="-1">No Program Change</option>';
        for (let i = 0; i <= 127; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = `Program ${i + 1}`; // Display as 1-128 (user-facing)
            select.appendChild(option);
        }
    }

    populateSysExChannelDropdown() {
        const select = document.getElementById('pad-sysex-channel');
        if (!select) return;

        // Build options: CH1-CH64 (display) mapping to 0-63 (wire value)
        select.innerHTML = '';
        for (let i = 0; i < 64; i++) {
            const option = document.createElement('option');
            option.value = i; // Wire value (0-63)
            option.textContent = `CH${i + 1}`; // Display as CH1-CH64
            select.appendChild(option);
        }
    }

    populateNoteSelectorButtons() {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const octaves = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

        // Populate note buttons
        const noteButtonsContainer = document.getElementById('pad-note-buttons');
        if (noteButtonsContainer) {
            noteButtonsContainer.innerHTML = noteNames.map(note => `
                <button type="button" class="pad-note-btn" data-note="${note}" style="
                    padding: 8px 4px;
                    background: #2a2a2a;
                    color: #aaa;
                    border: 1px solid #444;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 0.85em;
                    font-weight: bold;
                ">${note}</button>
            `).join('');

            // Add click handlers
            noteButtonsContainer.querySelectorAll('.pad-note-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.selectPadNote(btn.dataset.note);
                });
            });
        }

        // Populate octave buttons
        const octaveButtonsContainer = document.getElementById('pad-octave-buttons');
        if (octaveButtonsContainer) {
            octaveButtonsContainer.innerHTML = octaves.map(octave => `
                <button type="button" class="pad-octave-btn" data-octave="${octave}" style="
                    padding: 8px 4px;
                    background: #2a2a2a;
                    color: #aaa;
                    border: 1px solid #444;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 0.85em;
                    font-weight: bold;
                ">${octave}</button>
            `).join('');

            // Add click handlers
            octaveButtonsContainer.querySelectorAll('.pad-octave-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.selectPadOctave(parseInt(btn.dataset.octave));
                });
            });
        }

        // Set initial selection (C-4 = MIDI note 60)
        this.updatePadNoteSelection(60);
    }

    selectPadNote(noteName) {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const noteIndex = noteNames.indexOf(noteName);
        if (noteIndex === -1) return;

        // Get current octave
        const currentMidiNote = parseInt(document.getElementById('pad-note').value) || 60;
        const currentOctave = Math.floor(currentMidiNote / 12);

        // Calculate new MIDI note
        const newMidiNote = (currentOctave * 12) + noteIndex;
        if (newMidiNote >= 0 && newMidiNote <= 127) {
            this.updatePadNoteSelection(newMidiNote);
        }
    }

    selectPadOctave(octave) {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

        // Get current note
        const currentMidiNote = parseInt(document.getElementById('pad-note').value) || 60;
        const noteIndex = currentMidiNote % 12;

        // Calculate new MIDI note
        const newMidiNote = (octave * 12) + noteIndex;
        if (newMidiNote >= 0 && newMidiNote <= 127) {
            this.updatePadNoteSelection(newMidiNote);
        }
    }

    updatePadNoteSelection(midiNote) {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const octave = Math.floor(midiNote / 12);
        const noteIndex = midiNote % 12;
        const noteName = noteNames[noteIndex];

        // Update hidden input
        document.getElementById('pad-note').value = midiNote;

        // Update display
        const display = document.getElementById('pad-note-display');
        if (display) {
            display.textContent = `${noteName}-${octave} (${midiNote})`;
        }

        // Update button highlights
        document.querySelectorAll('.pad-note-btn').forEach(btn => {
            if (btn.dataset.note === noteName) {
                btn.style.background = '#4a9eff';
                btn.style.color = '#fff';
            } else {
                btn.style.background = '#2a2a2a';
                btn.style.color = '#aaa';
            }
        });

        document.querySelectorAll('.pad-octave-btn').forEach(btn => {
            if (parseInt(btn.dataset.octave) === octave) {
                btn.style.background = '#4a9eff';
                btn.style.color = '#fff';
            } else {
                btn.style.background = '#2a2a2a';
                btn.style.color = '#aaa';
            }
        });
    }

    populateRoutingInputs() {
        const select = document.getElementById('pad-routing-input-select');
        if (!select) return;

        // Start with "All Inputs" option
        let options = '<option value="">All Inputs</option>';

        // Get configured routes from inputRouter
        if (this.inputRouter) {
            const routes = this.inputRouter.getAllRoutes();
            if (routes && routes.length > 0) {
                routes.forEach(route => {
                    if (route.targets && route.targets.length > 1) {
                        // Only show inputs that have multiple targets to switch between
                        options += `<option value="${route.inputId}">${route.inputId} (${route.targets.length} targets)</option>`;
                    }
                });
            }
        }

        // Also add all available MIDI inputs (even if not configured yet)
        if (this.midiAccess) {
            for (let input of this.midiAccess.inputs.values()) {
                // Check if not already in routes
                const alreadyListed = this.inputRouter &&
                    this.inputRouter.getAllRoutes().some(r => r.inputName === input.name);

                if (!alreadyListed) {
                    options += `<option value="${input.name}">${input.name}</option>`;
                }
            }
        }

        select.innerHTML = options;
    }

    populateSequencerScenes() {
        const select = document.getElementById('pad-sequencer-scene-select');
        if (!select) return;

        // Get all sequencer scenes
        const sequencerScenes = [];
        if (this.sceneManager) {
            this.sceneManager.scenes.forEach((scene, id) => {
                if (scene.type === 'sequencer') {
                    sequencerScenes.push({ id, name: scene.name });
                }
            });
        }

        if (sequencerScenes.length === 0) {
            select.innerHTML = '<option value="">-- No Sequencers Found --</option>';
            return;
        }

        select.innerHTML = '<option value="">-- Select Sequencer --</option>' +
            sequencerScenes.map(seq =>
                `<option value="${seq.id}">${seq.name}</option>`
            ).join('');
    }

    populateDeviceSequencerDevices() {
        const select = document.getElementById('pad-device-seq-device-select');
        if (!select) return;

        const deviceManager = this.deviceManager;
        if (!deviceManager) {
            select.innerHTML = '<option value="">-- No Devices Found --</option>';
            return;
        }

        const devices = deviceManager.getAllDevices();
        if (devices.length === 0) {
            select.innerHTML = '<option value="">-- No Devices Configured --</option>';
            return;
        }

        select.innerHTML = '<option value="">-- Select Device --</option>' +
            devices.map(device =>
                `<option value="${device.id}">${device.name} (ID ${device.deviceId})</option>`
            ).join('');
    }

    populateDisplayDevices() {
        const select = document.getElementById('pad-display-device');
        if (!select) return;

        const deviceManager = this.deviceManager;
        if (!deviceManager) {
            select.innerHTML = '<option value="">-- No Devices Found --</option>';
            return;
        }

        const devices = deviceManager.getAllDevices();
        if (devices.length === 0) {
            select.innerHTML = '<option value="">-- No Devices Configured (add in Devices Tab) --</option>';
            return;
        }

        select.innerHTML = '<option value="">-- Select Device --</option>' +
            devices.map(device =>
                `<option value="${device.id}">${device.name} (${device.type})</option>`
            ).join('');
    }

    populateDisplayScenes() {
        const select = document.getElementById('pad-display-scene');
        if (!select) return;

        const sceneManager = this.sceneManager;
        if (!sceneManager) {
            select.innerHTML = '<option value="">-- No Scenes Found --</option>';
            return;
        }

        // Get all Fire sequencer and regular sequencer scenes
        const scenes = [];
        for (let [sceneId, scene] of sceneManager.scenes) {
            if (scene.type === 'fire-sequencer' || scene.type === 'sequencer') {
                scenes.push({ id: sceneId, name: scene.name, type: scene.type });
            }
        }

        if (scenes.length === 0) {
            select.innerHTML = '<option value="">-- No Sequencer Scenes Found --</option>';
            return;
        }

        select.innerHTML = '<option value="">-- Select Scene --</option>' +
            scenes.map(scene =>
                `<option value="${scene.id}">${scene.name} (${scene.type})</option>`
            ).join('');
    }

    isRegrooveActionCC(cc) {
        // List of all Regroove action CCs
        const regrooveCCs = [
            32, 33, 34, 35, 36, 37, 38, 39, // Channel Solo
            41, 42, 43, 44, 45, 46,          // Transport
            48, 49, 50, 51, 52, 53, 54, 55, // Channel Mute
            60, 61, 62,                      // File Browser
            70, 71, 72, 73, 74, 75, 76, 77, // MIDI Sync
            80, 81                           // Performance
        ];
        return regrooveCCs.includes(cc);
    }

    closePadEditor() {
        document.getElementById('pad-editor-overlay').classList.remove('active');
        this.editingPadIndex = null;
    }

    updatePadEditorFields(messageType) {
        const regrooveField = document.getElementById('pad-regroove-field');
        const actionField = document.getElementById('pad-action-field');
        const sequencerField = document.getElementById('pad-sequencer-field');
        const sysexField = document.getElementById('pad-sysex-field');
        const ccField = document.getElementById('pad-cc-field');
        const noteField = document.getElementById('pad-note-field');
        const noteProgramField = document.getElementById('pad-note-program-field');
        const mmcField = document.getElementById('pad-mmc-field');
        const deviceField = document.getElementById('pad-device-field');
        const displayField = document.getElementById('pad-display-field');
        const displayModeField = document.getElementById('pad-display-mode-field');
        const displayIntervalField = document.getElementById('pad-display-interval-field');

        // Hide all parameter fields first (they will be shown by specific handlers if needed)
        const routingParams = document.getElementById('pad-routing-input-params');
        const seqTrackParams = document.getElementById('pad-sequencer-track-params');
        const deviceSeqParams = document.getElementById('pad-device-seq-params');
        const seqSceneField = document.getElementById('pad-sequencer-scene-field');
        const seqTrackField = document.getElementById('pad-sequencer-track-field');
        const deviceSeqField = document.getElementById('pad-device-sequencer-field');
        const slotField = document.getElementById('pad-device-sequencer-slot-field');
        const sysexJumpParams = document.getElementById('pad-sysex-jump-params');
        const sysexFileParams = document.getElementById('pad-sysex-file-params');
        const sysexChannelParams = document.getElementById('pad-sysex-channel-params');
        const mmcLocateParams = document.getElementById('pad-mmc-locate-params');

        if (routingParams) routingParams.style.display = 'none';
        if (seqTrackParams) seqTrackParams.style.display = 'none';
        if (deviceSeqParams) deviceSeqParams.style.display = 'none';
        if (seqSceneField) seqSceneField.style.display = 'none';
        if (seqTrackField) seqTrackField.style.display = 'none';
        if (deviceSeqField) deviceSeqField.style.display = 'none';
        if (slotField) slotField.style.display = 'none';
        if (sysexJumpParams) sysexJumpParams.style.display = 'none';
        if (sysexFileParams) sysexFileParams.style.display = 'none';
        if (sysexChannelParams) sysexChannelParams.style.display = 'none';
        if (mmcLocateParams) mmcLocateParams.style.display = 'none';

        regrooveField.style.display = messageType === 'regroove' ? 'block' : 'none';
        actionField.style.display = messageType === 'action' ? 'block' : 'none';
        sequencerField.style.display = messageType === 'sequencer' ? 'block' : 'none';
        sysexField.style.display = messageType === 'sysex' ? 'block' : 'none';
        ccField.style.display = messageType === 'cc' ? 'block' : 'none';
        noteField.style.display = messageType === 'note' ? 'block' : 'none';
        noteProgramField.style.display = messageType === 'note' ? 'block' : 'none';
        mmcField.style.display = messageType === 'mmc' ? 'block' : 'none';
        displayField.style.display = messageType === 'display' ? 'block' : 'none';
        displayModeField.style.display = messageType === 'display' ? 'block' : 'none';
        displayIntervalField.style.display = messageType === 'display' ? 'block' : 'none';

        // Hide device binding for Action System (MIDI, Routing), Sequencer, and Display - those don't use device binding
        deviceField.style.display = (messageType === 'action' || messageType === 'sequencer' || messageType === 'display') ? 'none' : 'block';

        // Populate device/scene lists for display widget and setup source type toggle
        if (messageType === 'display') {
            this.populateDisplayDevices();
            this.populateDisplayScenes();

            // Setup source type toggle
            const sourceTypeSelect = document.getElementById('pad-display-source-type');
            const sceneContainer = document.getElementById('pad-display-scene-select-container');
            const deviceContainer = document.getElementById('pad-display-device-select-container');

            // Remove old listener if exists
            if (sourceTypeSelect._displaySourceListener) {
                sourceTypeSelect.removeEventListener('change', sourceTypeSelect._displaySourceListener);
            }

            // Add new listener
            sourceTypeSelect._displaySourceListener = (e) => {
                if (e.target.value === 'scene') {
                    sceneContainer.style.display = 'block';
                    deviceContainer.style.display = 'none';
                } else {
                    sceneContainer.style.display = 'none';
                    deviceContainer.style.display = 'block';
                }
            };
            sourceTypeSelect.addEventListener('change', sourceTypeSelect._displaySourceListener);

            // Set initial state
            if (sourceTypeSelect.value === 'scene') {
                sceneContainer.style.display = 'block';
                deviceContainer.style.display = 'none';
            } else {
                sceneContainer.style.display = 'none';
                deviceContainer.style.display = 'block';
            }
        }

        // If message type is sysex, check current sysex action and show appropriate parameters
        if (messageType === 'sysex') {
            const sysexAction = document.getElementById('pad-sysex-action')?.value;
            if (sysexAction === 'jump_to_order_row' && sysexJumpParams) {
                sysexJumpParams.style.display = 'block';
            } else if (sysexAction === 'file_load' && sysexFileParams) {
                sysexFileParams.style.display = 'block';
            } else if ((sysexAction === 'channel_mute' || sysexAction === 'channel_solo') && sysexChannelParams) {
                sysexChannelParams.style.display = 'block';
            }
        }

        // If message type is mmc, check current mmc command and show appropriate parameters
        if (messageType === 'mmc') {
            const mmcCommand = document.getElementById('pad-mmc-command')?.value;
            if (mmcCommand === 'locate' && mmcLocateParams) {
                mmcLocateParams.style.display = 'block';
            }
        }
    }

    updateSecondaryPadEditorFields(messageType) {
        const regrooveField = document.getElementById('pad-secondary-regroove-field');
        const ccField = document.getElementById('pad-secondary-cc-field');
        const noteField = document.getElementById('pad-secondary-note-field');
        const mmcField = document.getElementById('pad-secondary-mmc-field');

        regrooveField.style.display = messageType === 'regroove' ? 'block' : 'none';
        ccField.style.display = messageType === 'cc' ? 'block' : 'none';
        noteField.style.display = messageType === 'note' ? 'block' : 'none';
        mmcField.style.display = messageType === 'mmc' ? 'block' : 'none';
    }

    savePadConfig() {
        if (this.editingPadIndex === null) return;

        const label = document.getElementById('pad-label').value.trim();
        const sublabel = document.getElementById('pad-sublabel').value.trim();
        const messageType = document.getElementById('pad-message-type').value;
        const deviceBinding = document.getElementById('pad-device-binding').value;
        const errorElement = document.getElementById('pad-label-error');

        // Check for secondary action fields
        const secondaryMessageType = document.getElementById('pad-secondary-message-type')?.value;

        const padConfig = {};

        // Check for message type first
        let hasMessage = false;

        if (messageType === 'regroove') {
            // Regroove action - check if using new action system or legacy CC
            const select = document.getElementById('pad-regroove-action');
            const selectedOption = select.options[select.selectedIndex];
            const actionId = selectedOption.getAttribute('data-action');
            const actionParam = selectedOption.getAttribute('data-param');

            if (actionId) {
                // New action system - save action ID and parameter
                padConfig.action = parseInt(actionId);
                hasMessage = true;

                // Handle parameter
                if (actionParam === 'custom') {
                    // Custom parameter from input field (for routing actions)
                    const inputId = document.getElementById('pad-routing-input-select')?.value;
                    padConfig.parameter = inputId || ''; // Empty string means "all inputs"
                } else if (actionParam && actionParam !== '0') {
                    // Fixed parameter from data-param attribute
                    padConfig.parameter = parseInt(actionParam) || 0;
                } else {
                    // No parameter or parameter is 0
                    padConfig.parameter = 0;
                }
            } else {
                // Legacy CC fallback
                const cc = parseInt(select.value);
                if (!isNaN(cc) && cc >= 0 && cc <= 127) {
                    padConfig.cc = cc;
                    hasMessage = true;
                }
            }
        } else if (messageType === 'action') {
            // Action system (MIDI, Routing, Sequencer)
            const select = document.getElementById('pad-action-select');
            const selectedOption = select.options[select.selectedIndex];
            const actionId = selectedOption.getAttribute('data-action');
            const actionParam = selectedOption.getAttribute('data-param');

            if (actionId) {
                // Save action ID and parameter
                padConfig.action = parseInt(actionId);
                hasMessage = true;

                // Handle parameter
                if (actionParam === 'custom') {
                    const actionIdInt = parseInt(actionId);

                    // Routing actions (602) - use input ID string parameter
                    if (actionIdInt === 602) {
                        const inputId = document.getElementById('pad-routing-input-select')?.value;
                        padConfig.parameter = inputId || ''; // Empty string means "all inputs"
                    }
                    else {
                        padConfig.parameter = 0;
                    }
                } else if (actionParam && actionParam !== '0') {
                    // Fixed parameter from data-param attribute
                    padConfig.parameter = parseInt(actionParam) || 0;
                } else {
                    // No parameter or parameter is 0
                    padConfig.parameter = 0;
                }
            }
        } else if (messageType === 'sequencer') {
            // Sequencer Control
            const select = document.getElementById('pad-sequencer-action');
            const selectedOption = select.options[select.selectedIndex];
            const actionId = selectedOption.getAttribute('data-action');
            const actionValue = selectedOption.value;

            if (actionId) {
                padConfig.action = parseInt(actionId);
                hasMessage = true;

                // Determine parameter based on action type
                const actionIdInt = parseInt(actionId);

                // Meister sequencer actions (700-702: play/stop/toggle)
                if (actionIdInt >= 700 && actionIdInt <= 702) {
                    const sceneId = document.getElementById('pad-sequencer-scene-select')?.value || '';

                    // console.log(`[Pad Save] Action ${actionIdInt}: Scene selector value = "${sceneId}"`);

                    // Validate scene selection
                    if (!sceneId) {
                        console.error('[Pad Save] ERROR: No scene selected!');
                        window.nbDialog.alert('Please select a sequencer scene to control!');
                        return;
                    }

                    padConfig.parameter = sceneId; // Store scene ID as string
                    // console.log(`[Pad Save] Saved action ${actionIdInt} with parameter (sceneId): "${sceneId}"`);
                }
                // Meister track actions (710-711: mute/solo track)
                else if (actionIdInt === 710 || actionIdInt === 711) {
                    const sceneId = document.getElementById('pad-sequencer-scene-select')?.value || '';
                    const trackNumber = parseInt(document.getElementById('pad-sequencer-track-number')?.value) || 1;

                    // Validate scene selection
                    if (!sceneId) {
                        window.nbDialog.alert('Please select a sequencer scene to control!');
                        return;
                    }

                    // Store as object with scene ID and track number
                    padConfig.parameter = { sceneId, trackNumber };
                }
                // Device sequencer actions (720-724: play/stop/mute/solo slot)
                else if (actionIdInt >= 720 && actionIdInt <= 724) {
                    const deviceStringId = document.getElementById('pad-device-seq-device-select')?.value || '';
                    const slot = parseInt(document.getElementById('pad-device-seq-slot-select')?.value) || 0;

                    // console.log(`[Pad Save] Action ${actionIdInt}: Device="${deviceStringId}", Slot=${slot}`);

                    // Validate device selection
                    if (!deviceStringId) {
                        console.error('[Pad Save] ERROR: No device selected!');
                        window.nbDialog.alert('Please select a device to control!');
                        return;
                    }

                    // Store device string ID in pad config for stable lookup
                    padConfig.deviceId = deviceStringId;

                    // For backward compat, also encode device index in parameter
                    // (will be ignored, we use deviceId field instead)
                    const devices = this.deviceManager?.getAllDevices() || [];
                    const deviceIndex = devices.findIndex(d => d.id === deviceStringId);
                    padConfig.parameter = (deviceIndex << 8) | slot;
                    // console.log(`[Pad Save] Saved action ${actionIdInt} with deviceId="${deviceStringId}", slot=${slot}, index=${deviceIndex}`);
                }
                else {
                    padConfig.parameter = 0;
                }
            }
        } else if (messageType === 'cc') {
            const cc = parseInt(document.getElementById('pad-cc').value);
            if (!isNaN(cc) && cc >= 0 && cc <= 127) {
                padConfig.cc = cc;
                hasMessage = true;
            }
        } else if (messageType === 'note') {
            const note = parseInt(document.getElementById('pad-note').value);
            if (!isNaN(note) && note >= 0 && note <= 127) {
                padConfig.note = note;
                hasMessage = true;

                // Optional program change
                const program = parseInt(document.getElementById('pad-note-program').value);
                if (!isNaN(program) && program >= 0 && program <= 127) {
                    padConfig.noteProgram = program;
                }
            }
        } else if (messageType === 'mmc') {
            const mmcCommand = document.getElementById('pad-mmc-command').value;
            padConfig.mmc = mmcCommand;
            hasMessage = true;

            // Save MMC LOCATE parameters if present
            if (mmcCommand === 'locate') {
                const order = parseInt(document.getElementById('pad-mmc-locate-order').value);
                const row = parseInt(document.getElementById('pad-mmc-locate-row').value);
                if (!isNaN(order) && !isNaN(row)) {
                    padConfig.mmcParams = { order, row };
                }
            }
        } else if (messageType === 'sysex') {
            const sysexAction = document.getElementById('pad-sysex-action').value;
            padConfig.sysex = sysexAction;
            hasMessage = true;

            // Save SysEx parameters based on action type
            if (sysexAction === 'jump_to_order_row') {
                const order = parseInt(document.getElementById('pad-sysex-jump-order').value);
                const row = parseInt(document.getElementById('pad-sysex-jump-row').value);
                if (!isNaN(order) && !isNaN(row)) {
                    padConfig.sysexParams = { order, row };
                }
            } else if (sysexAction === 'file_load') {
                const filename = document.getElementById('pad-sysex-filename').value.trim();
                if (filename) {
                    padConfig.sysexParams = { filename };
                }
            } else if (sysexAction === 'channel_mute' || sysexAction === 'channel_solo') {
                const channel = parseInt(document.getElementById('pad-sysex-channel').value);
                if (!isNaN(channel) && channel >= 0 && channel <= 63) {
                    padConfig.sysexParams = { channel };
                }
            }
        } else if (messageType === 'display') {
            const sourceType = document.getElementById('pad-display-source-type').value;
            const displayMode = document.getElementById('pad-display-mode').value || 'push';
            const displayInterval = parseInt(document.getElementById('pad-display-interval').value) || 100;

            if (sourceType === 'scene') {
                const sceneId = document.getElementById('pad-display-scene').value;
                if (!sceneId) {
                    window.nbDialog.alert('Please select a scene to display!');
                    return;
                }
                padConfig.display = {
                    sceneId: sceneId,
                    mode: displayMode,
                    interval: displayInterval
                };
            } else {
                const deviceId = document.getElementById('pad-display-device').value;
                if (!deviceId) {
                    window.nbDialog.alert('Please select a device to monitor!');
                    return;
                }
                padConfig.display = {
                    deviceId: deviceId,
                    mode: displayMode,
                    interval: displayInterval
                };
            }
            hasMessage = true;
        } else if (messageType === 'ccknob') {
            // CC Knob (Embedded) - check if knob is actually enabled
            const knobEnabled = document.getElementById('pad-knob-enabled').checked;
            if (knobEnabled) {
                const knobCC = parseInt(document.getElementById('pad-knob-cc').value);
                if (!isNaN(knobCC) && knobCC >= 0 && knobCC <= 127) {
                    hasMessage = true;
                }
            }
        }

        // Check for secondary action
        if (secondaryMessageType && secondaryMessageType !== 'none') {
            if (secondaryMessageType === 'regroove') {
                const cc = parseInt(document.getElementById('pad-secondary-regroove-action').value);
                if (!isNaN(cc) && cc >= 0 && cc <= 127) {
                    padConfig.secondaryCC = cc;
                }
            } else if (secondaryMessageType === 'cc') {
                const cc = parseInt(document.getElementById('pad-secondary-cc').value);
                if (!isNaN(cc) && cc >= 0 && cc <= 127) {
                    padConfig.secondaryCC = cc;
                }
            } else if (secondaryMessageType === 'note') {
                const note = parseInt(document.getElementById('pad-secondary-note').value);
                if (!isNaN(note) && note >= 0 && note <= 127) {
                    padConfig.secondaryNote = note;
                }
            } else if (secondaryMessageType === 'mmc') {
                padConfig.secondaryMMC = document.getElementById('pad-secondary-mmc-command').value;
            }
        }

        // If we have a message but no label, show error
        if (hasMessage && !label) {
            errorElement.style.display = 'block';
            // Focus the label input
            document.getElementById('pad-label').focus();
            return;
        }

        // Hide error if it was showing
        errorElement.style.display = 'none';

        // Only add label if not empty
        if (label) {
            padConfig.label = label;
        }
        if (sublabel) {
            padConfig.sublabel = sublabel;
        }
        // Add device binding
        if (deviceBinding) {
            padConfig.deviceBinding = deviceBinding;
        }

        // Add knob configuration if enabled
        const knobEnabled = document.getElementById('pad-knob-enabled').checked;
        if (knobEnabled) {
            const knobCC = parseInt(document.getElementById('pad-knob-cc').value);
            const knobMin = parseInt(document.getElementById('pad-knob-min').value);
            const knobMax = parseInt(document.getElementById('pad-knob-max').value);
            const knobValue = parseInt(document.getElementById('pad-knob-value').value);

            if (!isNaN(knobCC) && !isNaN(knobMin) && !isNaN(knobMax) && !isNaN(knobValue)) {
                padConfig.ccKnob = {
                    
                    cc: knobCC,
                    min: knobMin,
                    max: knobMax,
                    value: knobValue
                };
            }
        }

        // Check if we're editing a custom scene's pads or the default pads
        const isCustomScene = this.currentPadSceneId && this.currentPadSceneId !== 'pads';

        // console.log(`[Pad Save] Final padConfig for pad ${this.editingPadIndex}:`, JSON.stringify(padConfig, null, 2));
        // console.log(`[Pad Save] hasMessage = ${hasMessage}, messageType = ${messageType}`);
        // console.log(`[Pad Save] Saving to: ${isCustomScene ? 'scene "' + this.currentPadSceneId + '"' : 'global config'}`);

        if (isCustomScene) {
            // Save to scene's pads array
            const scene = this.sceneManager.scenes.get(this.currentPadSceneId);
            if (scene) {
                // Ensure pads array exists and is properly sized
                if (!scene.pads) {
                    const [rows, cols] = (scene.layout || '4x4').split('x').map(Number);
                    const gridSize = rows * cols;
                    scene.pads = Array(gridSize).fill(null);
                }

                // Ensure array is large enough for this index
                while (scene.pads.length <= this.editingPadIndex) {
                    scene.pads.push(null);
                }

                // Check if we have at least a message type (cc, note, or mmc)
                // If not, treat as empty pad
                if (!hasMessage) {
                    scene.pads[this.editingPadIndex] = null;
                } else {
                    scene.pads[this.editingPadIndex] = padConfig;
                    // console.log(`[Pad Save] ✓ Saved to scene.pads[${this.editingPadIndex}]`);
                }

                // Auto-update pollDevices based on all pad deviceBindings in the scene
                const pollDevices = new Set();
                scene.pads.forEach(pad => {
                    if (pad && pad.deviceBinding) {
                        pollDevices.add(pad.deviceBinding);
                    }
                });
                scene.pollDevices = Array.from(pollDevices);

                // Save scene config to localStorage
                this.sceneEditor.saveScenesToStorage();

                // Re-render the scene
                if (scene.render) scene.render();
            }
        } else {
            // Save to global config (built-in pads scene)
            // Check if we have at least a message type (cc, note, or mmc)
            // If not, treat as empty pad
            if (!hasMessage) {
                if (!this.config.pads) this.config.pads = [];
                this.config.pads[this.editingPadIndex] = null;
            } else {
                // Valid pad config
                if (!this.config.pads) this.config.pads = [];
                this.config.pads[this.editingPadIndex] = padConfig;
            }

            this.saveConfig();
            this.createPads();
        }

        this.closePadEditor();
    }

    clearPad() {
        if (this.editingPadIndex === null) return;

        // Check if we're editing a custom scene's pads or the default pads
        const isCustomScene = this.currentPadSceneId && this.currentPadSceneId !== 'pads';

        if (isCustomScene) {
            // Clear from scene's pads array
            const scene = this.sceneManager.scenes.get(this.currentPadSceneId);
            if (scene) {
                if (!scene.pads) scene.pads = [];
                scene.pads[this.editingPadIndex] = null;

                // Save scene config to localStorage
                this.sceneEditor.saveScenesToStorage();

                // Re-render the scene
                if (scene.render) scene.render();
            }
        } else {
            // Clear from global config (built-in pads scene)
            if (!this.config.pads) this.config.pads = [];
            this.config.pads[this.editingPadIndex] = null;

            this.saveConfig();
            this.createPads();
        }

        this.closePadEditor();
    }

    updateConnectionStatus(connected) {
        const indicator = document.getElementById('midi-indicator');
        if (connected) {
            indicator.classList.add('connected');
        } else {
            indicator.classList.remove('connected');
        }
    }

    applyGridLayout() {
        const grid = document.getElementById('pads-grid');
        const [cols, rows] = this.config.gridLayout.split('x').map(n => parseInt(n));
        grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

        // Recreate pads with new layout
        this.createPads();
    }

    /**
     * Create a single pad element with the given configuration
     * @param {number} index - The pad index
     * @param {Object} padConfig - The pad configuration
     * @returns {HTMLElement} The created pad element
     */
    createSinglePad(index, padConfig) {
        // console.log(`[createSinglePad] Index ${index}, padConfig=`, padConfig);

        // Check if this is a display widget instead of a pad
        if (padConfig && padConfig.display) {
            let displayElement;

            // Support linking to a scene (Fire sequencer, regular sequencer, etc.)
            if (padConfig.display.sceneId) {
                const scene = this.sceneManager?.scenes.get(padConfig.display.sceneId);
                if (!scene) {
                    displayElement = document.createElement('div');
                    displayElement.innerHTML = '<div style="padding: 10px; color: #ff6666; text-align: center; font-size: 0.8em;">Display Widget<br>(Scene not found)</div>';
                } else if (scene.type === 'fire-sequencer') {
                    displayElement = document.createElement('fire-display');
                    displayElement.setAttribute('scene-id', padConfig.display.sceneId);
                } else if (scene.type === 'sequencer') {
                    displayElement = document.createElement('sequencer-display');
                    displayElement.setAttribute('scene-id', padConfig.display.sceneId);
                } else {
                    displayElement = document.createElement('div');
                    displayElement.innerHTML = `<div style="padding: 10px; color: #666; text-align: center; font-size: 0.8em;">Display Widget<br>(Scene type "${scene.type}" not supported)</div>`;
                }
            } else {
                // Legacy: device-based display (for Regroove devices)
                const deviceId = padConfig.display.deviceId;
                if (!deviceId) {
                    displayElement = document.createElement('div');
                    displayElement.innerHTML = '<div style="padding: 10px; color: #666; text-align: center; font-size: 0.8em;">Display Widget<br>(No scene or device configured)</div>';
                } else {
                    const device = this.deviceManager?.getDevice(deviceId);
                    if (!device) {
                        displayElement = document.createElement('div');
                        displayElement.innerHTML = '<div style="padding: 10px; color: #ff6666; text-align: center; font-size: 0.8em;">Display Widget<br>(Device not found)</div>';
                    } else {
                        displayElement = document.createElement('display-widget');
                        displayElement.setAttribute('device-id', deviceId);
                        displayElement.setAttribute('device-type', device.type);
                        displayElement.setAttribute('display-mode', padConfig.display.mode || 'push');
                        displayElement.setAttribute('update-interval', padConfig.display.interval || 100);
                    }
                }
            }

            // Store pad index for editing and add right-click menu
            displayElement.dataset.padIndex = index;
            displayElement.style.cursor = 'default';
            displayElement.style.userSelect = 'none';

            displayElement.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.openPadEditor(index);
            });

            return displayElement;
        }

        const padElement = document.createElement('regroove-pad');

        if (padConfig) {
            // Store original label for later replacement
            padElement._originalLabel = padConfig.label;
            padElement._originalSublabel = padConfig.sublabel;

            // For knob-only pads, set label on the pad element itself
            if (padConfig.ccKnob && !padConfig.cc && !padConfig.note && !padConfig.mmc && !padConfig.sysex && !padConfig.action) {
                if (padConfig.label) {
                    padElement.setAttribute('label', padConfig.label);
                }
            }

            // Set label with appropriate prefix for sequencer buttons
            if (padConfig.label) {
                let displayLabel = this.replacePlaceholders(padConfig.label);

                // Local sequencer actions (700-702)
                if (padConfig.action === 700) {
                    // ACTION_SEQUENCER_PLAY
                    displayLabel = `PLAY: ${displayLabel}`;
                } else if (padConfig.action === 701) {
                    // ACTION_SEQUENCER_STOP
                    displayLabel = `STOP: ${displayLabel}`;
                } else if (padConfig.action === 702 && padConfig.parameter) {
                    // ACTION_SEQUENCER_PLAY_STOP (toggle) - always has color
                    const sceneId = padConfig.parameter;
                    const scene = this.sceneManager?.scenes.get(sceneId);
                    if (scene && scene.type === 'sequencer' && scene.sequencerInstance) {
                        const isPlaying = scene.sequencerInstance.engine.playing;
                        const statusLabel = isPlaying ? 'STOP' : 'PLAY';
                        displayLabel = `${statusLabel}: ${displayLabel}`;
                        padElement.setAttribute('color', isPlaying ? 'green' : 'red');
                    } else {
                        // Default to PLAY/RED if scene not loaded yet
                        displayLabel = `PLAY: ${displayLabel}`;
                        padElement.setAttribute('color', 'red');
                    }
                }
                // Device sequencer actions (720-722)
                else if (padConfig.action === 720) {
                    // ACTION_DEVICE_SEQ_PLAY
                    displayLabel = `PLAY: ${displayLabel}`;
                } else if (padConfig.action === 721) {
                    // ACTION_DEVICE_SEQ_STOP
                    displayLabel = `STOP: ${displayLabel}`;
                } else if (padConfig.action === 722 && padConfig.deviceId) {
                    // ACTION_DEVICE_SEQ_PLAY_STOP (toggle) - always has color
                    const slot = padConfig.parameter & 0xFF;
                    const isPlaying = this.actionDispatcher?.isDeviceSlotPlaying(padConfig.deviceId, slot) || false;
                    const statusLabel = isPlaying ? 'STOP' : 'PLAY';
                    displayLabel = `${statusLabel}: ${displayLabel}`;
                    padElement.setAttribute('color', isPlaying ? 'green' : 'red');
                }

                padElement.setAttribute('label', displayLabel);
            }

            // Build sublabel with device indicator if non-default device is bound
            let sublabel = padConfig.sublabel ? this.replacePlaceholders(padConfig.sublabel) : '';
            if (padConfig.deviceBinding) {
                if (this.deviceManager) {
                    const device = this.deviceManager.getDevice(padConfig.deviceBinding);
                    if (device) {
                        // Add device name as a note
                        const deviceNote = `[${device.name}]`;
                        sublabel = sublabel ? `${sublabel}\n${deviceNote}` : deviceNote;
                        // console.log(`[Pad ${index}] Added device label: ${device.name}`);
                    } else {
                        console.warn(`[Pad ${index}] Device binding "${padConfig.deviceBinding}" not found`);
                    }
                }
                // Note: DeviceManager may not be initialized yet on first render - that's OK, pads get re-rendered later
            }

            // Action system (new)
            if (padConfig.action !== undefined) {
                padElement.setAttribute('action', padConfig.action);
                // Store action parameter in dataset
                if (padConfig.parameter !== undefined) {
                    padElement.dataset.actionParameter = padConfig.parameter;
                }

                // For routing actions (602), add active target info to sublabel and set color
                if (padConfig.action === 602 && this.inputRouter) {
                    const inputName = padConfig.parameter || '';
                    const routingInfo = this.getRoutingDisplayInfo(inputName);
                    if (routingInfo) {
                        sublabel = sublabel ? `${sublabel}\n${routingInfo}` : routingInfo;
                    }

                    // Set color based on active target index
                    const route = this.inputRouter.getRoute(inputName);
                    if (route && route.targets && route.targets.length > 0) {
                        const colors = ['red', 'blue', 'green', 'yellow'];
                        const activeIndex = route.activeTargetIndex || 0;
                        const color = colors[activeIndex % colors.length];
                        padElement.setAttribute('color', color);
                    }
                }

                // For sequencer actions (700-702), add scene name to sublabel
                if (padConfig.action >= 700 && padConfig.action <= 702 && padConfig.parameter) {
                    const sceneId = padConfig.parameter;
                    const scene = this.sceneManager?.scenes.get(sceneId);
                    if (scene) {
                        const sceneName = `[${scene.name}]`;
                        sublabel = sublabel ? `${sublabel}\n${sceneName}` : sceneName;
                    }
                }

                // For device sequencer actions (720-724), add device name to sublabel
                if (padConfig.action >= 720 && padConfig.action <= 724 && padConfig.deviceId) {
                    const device = this.deviceManager?.getDevice(padConfig.deviceId);
                    if (device) {
                        const slot = padConfig.parameter & 0xFF;
                        const deviceInfo = `[${device.name} S${slot + 1}]`; // Display as S1-S16 (one-based)
                        sublabel = sublabel ? `${sublabel}\n${deviceInfo}` : deviceInfo;
                    }
                }
            }

            // Set sublabel after all modifications
            if (sublabel) padElement.setAttribute('sublabel', sublabel);

            // Legacy message types
            if (padConfig.cc !== undefined) padElement.setAttribute('cc', padConfig.cc);
            if (padConfig.note !== undefined) {
                padElement.setAttribute('note', padConfig.note);
                // Set note-program attribute if present
                if (padConfig.noteProgram !== undefined) {
                    padElement.setAttribute('note-program', padConfig.noteProgram);
                }
            }
            if (padConfig.mmc !== undefined) {
                padElement.setAttribute('mmc', padConfig.mmc);
                // Store MMC parameters in dataset
                if (padConfig.mmcParams) {
                    padElement.dataset.mmcParams = JSON.stringify(padConfig.mmcParams);
                }
            }
            if (padConfig.sysex !== undefined) {
                padElement.setAttribute('sysex', padConfig.sysex);
                // Store SysEx parameters in dataset
                if (padConfig.sysexParams) {
                    padElement.dataset.sysexParams = JSON.stringify(padConfig.sysexParams);
                }
            }

            // Set secondary actions
            if (padConfig.secondaryCC !== undefined) padElement.setAttribute('secondary-cc', padConfig.secondaryCC);
            if (padConfig.secondaryNote !== undefined) padElement.setAttribute('secondary-note', padConfig.secondaryNote);
            if (padConfig.secondaryMMC !== undefined) padElement.setAttribute('secondary-mmc', padConfig.secondaryMMC);

            // Store device binding on the element
            if (padConfig.deviceBinding) {
                padElement.dataset.deviceBinding = padConfig.deviceBinding;
            }

            // Add CC knob if configured
            if (padConfig.ccKnob) {
                // Check if this is a knob-only pad (no other message types)
                const hasOtherMessage = padConfig.cc !== undefined ||
                                       padConfig.note !== undefined ||
                                       padConfig.mmc !== undefined ||
                                       padConfig.sysex !== undefined ||
                                       padConfig.action !== undefined;

                // console.log(`[createSinglePad] Pad ${index} has knob, hasOtherMessage=${hasOtherMessage}, ccKnob=`, padConfig.ccKnob);

                if (!hasOtherMessage) {
                    // Mark as knob-only for transparent background styling
                    padElement.setAttribute('knob-only', '');
                    // console.log(`[createSinglePad] Set knob-only attribute on pad ${index}`);
                }

                const knob = document.createElement('pad-knob');
                knob.setAttribute('label', padConfig.label || 'CC');
                knob.setAttribute('sublabel', sublabel || '');
                knob.setAttribute('cc', padConfig.ccKnob.cc || '1');
                knob.setAttribute('value', padConfig.ccKnob.value !== undefined ? padConfig.ccKnob.value : '64');
                knob.setAttribute('min', padConfig.ccKnob.min !== undefined ? padConfig.ccKnob.min : '0');
                knob.setAttribute('max', padConfig.ccKnob.max !== undefined ? padConfig.ccKnob.max : '127');
                // console.log(`[createSinglePad] Created knob element for pad ${index}`, knob);

                // Handle CC changes from knob
                knob.addEventListener('cc-change', (e) => {
                    const device = padConfig.deviceBinding && this.deviceManager
                        ? this.deviceManager.getDevice(padConfig.deviceBinding)
                        : null;

                    if (device) {
                        // Send CC to specific device
                        const midiOutput = this.deviceManager.getMidiOutput(device.id);
                        if (midiOutput) {
                            const statusByte = 0xB0 + device.midiChannel;
                            midiOutput.send([statusByte, e.detail.cc, e.detail.value]);
                        }
                    } else {
                        // Send CC to default output
                        if (this.midiOutput) {
                            const statusByte = 0xB0;
                            this.midiOutput.send([statusByte, e.detail.cc, e.detail.value]);
                        }
                    }

                    // Update stored value
                    padConfig.ccKnob.value = e.detail.value;
                    this.saveConfig();
                });

                // Append knob to pad element's shadow root
                padElement.appendChild(knob);
            }

            padElement.addEventListener('pad-press', (e) => {
                this.handlePadPress(e.detail, padElement, index);
            });

            // Add pad-release listener for note pads
            if (padConfig.note !== undefined) {
                padElement.addEventListener('pad-release', (e) => {
                    this.handlePadRelease(e.detail, padElement, index);
                });
            }
        }

        // Store pad index
        padElement.dataset.padIndex = index;

        // Right-click to edit
        padElement.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.openPadEditor(index);
        });

        // Drag and drop with Ctrl + left mouse button
        padElement.setAttribute('draggable', 'false');

        padElement.addEventListener('mousedown', (e) => {
            // Ctrl + Left click = drag mode
            if (e.button === 0 && e.ctrlKey) {
                e.preventDefault();
                padElement.setAttribute('draggable', 'true');
                padElement.style.cursor = 'move';
            }
        });

        padElement.addEventListener('dragstart', (e) => {
            if (padElement.getAttribute('draggable') === 'true') {
                this.draggingPadIndex = index;
                padElement.style.opacity = '0.4';
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', index);
            }
        });

        padElement.addEventListener('dragend', (e) => {
            padElement.style.opacity = '';
            padElement.setAttribute('draggable', 'false');
            padElement.style.cursor = '';
            this.draggingPadIndex = null;
        });

        // Make pad a drop target
        padElement.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (this.draggingPadIndex !== null && this.draggingPadIndex !== index) {
                padElement.style.opacity = '0.5';
            }
        });

        padElement.addEventListener('dragleave', (e) => {
            padElement.style.opacity = '';
        });

        padElement.addEventListener('drop', (e) => {
            e.preventDefault();
            padElement.style.opacity = '';
            if (this.draggingPadIndex !== null && this.draggingPadIndex !== index) {
                this.swapPads(this.draggingPadIndex, index);
            }
        });

        let longPressTimer;
        padElement.addEventListener('touchstart', (e) => {
            longPressTimer = setTimeout(() => {
                e.preventDefault();
                this.openPadEditor(index);
            }, 500);
        });
        padElement.addEventListener('touchend', () => {
            clearTimeout(longPressTimer);
        });
        padElement.addEventListener('touchmove', () => {
            clearTimeout(longPressTimer);
        });

        return padElement;
    }

    createPads() {
        const container = document.getElementById('pads-grid');
        container.innerHTML = '';
        this.pads = [];

        const [cols, rows] = this.config.gridLayout.split('x').map(n => parseInt(n));
        const totalPads = cols * rows;

        for (let i = 0; i < totalPads; i++) {
            const padConfig = this.config.pads[i];
            const padElement = this.createSinglePad(i, padConfig);
            container.appendChild(padElement);
            this.pads.push(padElement);
        }
    }

    swapPads(fromIndex, toIndex) {
        if (fromIndex === toIndex) return;

        // console.log(`Swapping pad ${fromIndex} with pad ${toIndex}`);

        // Check if we're in a custom scene (like split scene)
        const isCustomScene = this.currentPadSceneId && this.currentPadSceneId !== 'pads';

        if (isCustomScene) {
            // Swap in the scene's pads array
            const scene = this.sceneManager.scenes.get(this.currentPadSceneId);
            if (scene && scene.pads) {
                const temp = scene.pads[fromIndex];
                scene.pads[fromIndex] = scene.pads[toIndex];
                scene.pads[toIndex] = temp;

                // Save scene config
                this.sceneEditor.saveScenesToStorage();

                // Re-render the scene
                if (scene.render) {
                    scene.render();
                }
            }
        } else {
            // Swap in global config (built-in pads scene)
            if (!this.config.pads) this.config.pads = [];
            const temp = this.config.pads[fromIndex];
            this.config.pads[fromIndex] = this.config.pads[toIndex];
            this.config.pads[toIndex] = temp;

            // Save and re-render
            this.saveConfig();
            this.createPads();
        }
    }

    handlePadPress(detail, padElement, padIndex) {
        // Resolve device binding to BOTH string ID (for Note/CC) and numeric device ID (for SysEx)
        let deviceStringId = null; // String ID like "device-1762582928232" (for Note/CC channel lookup)
        let deviceId = null;       // Numeric SysEx device ID 0-15 (for SysEx commands)

        if (padElement && padElement.dataset.deviceBinding) {
            const deviceManager = this.deviceManager;
            if (deviceManager) {
                const device = deviceManager.getDevice(padElement.dataset.deviceBinding);
                if (device) {
                    deviceStringId = device.id;       // String ID for Note/CC
                    deviceId = device.deviceId;       // Numeric ID for SysEx
                }
            }
        }

        // If no device binding, use default device
        if (deviceId === null && this.deviceManager) {
            const defaultDevice = this.deviceManager.getDefaultDevice();
            if (defaultDevice) {
                deviceStringId = defaultDevice.id;
                deviceId = defaultDevice.deviceId;
            }
        }

        // Fallback to device ID 0
        if (deviceId === null) {
            deviceId = 0;
        }

        // Get pad config for parameters
        const padConfig = this.config.pads[padIndex];

        // Send the message
        if (detail.action !== undefined && detail.action !== null) {
            // Handle action system (new)
            const actionId = parseInt(detail.action);
            let parameter = 0;

            // console.log(`[Pad Press] Pad ${padIndex} pressed - action=${detail.action}`);
            // console.log(`[Pad Press] Pad element dataset:`, padElement.dataset);

            // Get parameter from pad element's dataset
            if (padElement.dataset.actionParameter !== undefined) {
                const paramValue = padElement.dataset.actionParameter;
                // Parameter can be string (MIDI input ID) or number
                parameter = isNaN(paramValue) ? paramValue : parseInt(paramValue);
                // console.log(`[Pad Press] Found parameter in dataset: "${paramValue}" → parsed as:`, parameter);
            } else {
                console.warn(`[Pad Press] WARNING: No actionParameter in dataset!`);
            }

            // console.log(`[Pad Press] Executing action ${actionId} with parameter:`, parameter, `(type: ${typeof parameter})`);

            // Execute action through action system (added by meister-actions-integration.js)
            if (this.executeAction) {
                this.executeAction(actionId, parameter, deviceId);

                // For routing actions (602), update the pad's sublabel to show new active target
                if (actionId === 602) {
                    setTimeout(() => {
                        const routingInfo = this.getRoutingDisplayInfo(parameter);
                        // console.log(`[Pad] Routing info after switch:`, routingInfo);

                        if (routingInfo) {
                            // Get device binding info if it exists (non-routing related sublabel)
                            let deviceBindingInfo = '';
                            const currentSublabel = padElement.getAttribute('sublabel') || '';

                            // Extract device binding line (marked with [...])
                            const lines = currentSublabel.split('\n');
                            for (const line of lines) {
                                if (line.match(/^\[.*\]$/)) {
                                    deviceBindingInfo = line;
                                    break;
                                }
                            }

                            // Build new sublabel: device binding (if any) + routing info
                            const newSublabel = deviceBindingInfo
                                ? `${deviceBindingInfo}\n${routingInfo}`
                                : routingInfo;

                            // console.log(`[Pad] Updating sublabel to:`, newSublabel);
                            padElement.setAttribute('sublabel', newSublabel);
                        }
                    }, 100); // Increased delay to ensure route switch completes
                }
            } else {
                console.warn('[Pad] Action system not initialized - executeAction() not found');
            }
        } else if (detail.sysex) {
            // Handle SysEx actions
            const sysexAction = detail.sysex;
            let params = null;
            if (padElement.dataset.sysexParams) {
                try {
                    params = JSON.parse(padElement.dataset.sysexParams);
                } catch(e) {
                    console.error('Failed to parse sysex params:', e);
                }
            }

            switch(sysexAction) {
                case 'play':
                    this.sendSysExPlay(deviceId);
                    break;
                case 'stop':
                    this.sendSysExStop(deviceId);
                    break;
                case 'pause':
                    this.sendSysExPause(deviceId);
                    break;
                case 'retrigger':
                    this.sendSysExRetrigger(deviceId);
                    break;
                case 'next_order':
                    this.sendSysExNextOrder(deviceId);
                    break;
                case 'prev_order':
                    this.sendSysExPrevOrder(deviceId);
                    break;
                case 'jump_to_order_row':
                    if (params && params.order !== undefined && params.row !== undefined) {
                        this.sendSysExJumpToOrderRow(deviceId, params.order, params.row);
                    }
                    break;
                case 'file_load':
                    if (params && params.filename) {
                        this.sendSysExFileLoad(deviceId, params.filename);
                    }
                    break;
                case 'set_loop_current':
                    // Toggle based on current state
                    const currentLoopState = this.isLoopEnabled(deviceId);
                    this.sendSysExSetLoopCurrent(deviceId, currentLoopState ? 0 : 1);
                    break;
                case 'channel_mute':
                    if (params && params.channel !== undefined) {
                        const channel = parseInt(params.channel);
                        const newMuteState = this.toggleChannelMuteState(deviceId, channel);
                        this.sendSysExChannelMute(deviceId, channel, newMuteState ? 1 : 0);
                    }
                    break;
                case 'channel_solo':
                    if (params && params.channel !== undefined) {
                        const channel = parseInt(params.channel);
                        const newSoloState = this.toggleChannelSoloState(deviceId, channel);
                        this.sendSysExChannelSolo(deviceId, channel, newSoloState ? 1 : 0);
                    }
                    break;
            }
        } else if (detail.mmc) {
            // Handle MMC with parameters and device ID
            let mmcParams = {};
            if (padElement.dataset.mmcParams) {
                try {
                    mmcParams = JSON.parse(padElement.dataset.mmcParams);
                } catch(e) {
                    console.error('Failed to parse MMC params:', e);
                }
            }
            this.sendMMC(detail.mmc, mmcParams, deviceId);
        } else if (detail.cc !== undefined && detail.cc !== null) {
            // Use device-aware sending for CC (Regroove actions) - uses numeric deviceId for SysEx
            if (this.sendRegrooveCC && deviceId !== null) {
                this.sendRegrooveCC(parseInt(detail.cc), 127, deviceId);
            } else {
                this.sendCC(parseInt(detail.cc), 127);
            }
        } else if (detail.note !== undefined && detail.note !== null) {
            // Use string ID for Note messages (needs MIDI channel lookup)
            const noteProgram = detail.noteProgram !== undefined ? parseInt(detail.noteProgram) : null;
            // console.log(`[Pad Click] Sending note ${detail.note}, program=${noteProgram}, deviceStringId="${deviceStringId}"`);
            this.sendNote(parseInt(detail.note), 127, noteProgram, deviceStringId);
        }
    }

    handlePadRelease(detail, padElement, padIndex) {
        // Resolve device binding to string ID for Note Off (same as handlePadPress)
        let deviceStringId = null;
        if (padElement && padElement.dataset.deviceBinding) {
            const deviceManager = this.deviceManager;
            if (deviceManager) {
                const device = deviceManager.getDevice(padElement.dataset.deviceBinding);
                if (device) {
                    deviceStringId = device.id; // Use string ID for getDevice() lookup
                }
            }
        }

        // If no device binding, use default device
        if (deviceStringId === null && this.deviceManager) {
            const defaultDevice = this.deviceManager.getDefaultDevice();
            if (defaultDevice) {
                deviceStringId = defaultDevice.id;
            }
        }

        // Send Note Off (velocity 0)
        if (detail.note !== undefined && detail.note !== null) {
            this.sendNoteOff(parseInt(detail.note), deviceStringId);
        }
    }

    sendCC(cc, value) {
        if (this.midiOutput) {
            const status = 0xB0 | this.midiChannel; // CC message with channel
            this.midiOutput.send([status, cc, value]);
            // console.log(`Sent CC ${cc}, value ${value} on channel ${this.midiChannel + 1}`);
        } else {
            console.warn('No MIDI output selected');
        }
    }

    sendNote(note, velocity = 127, program = null, deviceId = null) {
        if (this.midiOutput) {
            // Get MIDI channel - use device's channel if deviceId provided, else global channel
            let midiChannel = this.midiChannel;
            // console.log(`[sendNote] deviceId="${deviceId}", deviceManager=${!!this.deviceManager}`);
            if (deviceId !== null && this.deviceManager) {
                const device = this.deviceManager.getDevice(deviceId);
                // console.log(`[sendNote] Found device:`, device);
                if (device) {
                    midiChannel = device.midiChannel;
                    // console.log(`[sendNote] Using device channel: ${midiChannel + 1}`);
                }
            }

            // Send program change first if specified
            if (program !== null && program >= 0 && program <= 127) {
                const programChange = 0xC0 | midiChannel;
                this.midiOutput.send([programChange, program]);
                // console.log(`Sent Program Change ${program + 1} on channel ${midiChannel + 1}`);
            }

            const noteOn = 0x90 | midiChannel;

            // Note On only (Note Off will be sent on release)
            this.midiOutput.send([noteOn, note, velocity]);
            // console.log(`Sent Note On ${note}, velocity ${velocity} on channel ${midiChannel + 1}`);
        } else {
            console.warn('No MIDI output selected');
        }
    }

    sendNoteOff(note, deviceId = null) {
        if (this.midiOutput) {
            // Get MIDI channel - use device's channel if deviceId provided, else global channel
            let midiChannel = this.midiChannel;
            if (deviceId !== null && this.deviceManager) {
                const device = this.deviceManager.getDevice(deviceId);
                if (device) {
                    midiChannel = device.midiChannel;
                }
            }

            const noteOff = 0x80 | midiChannel;

            // Note Off (velocity 0)
            this.midiOutput.send([noteOff, note, 0]);
            // console.log(`Sent Note Off ${note} on channel ${midiChannel + 1}`);
        } else {
            console.warn('No MIDI output selected');
        }
    }

    // startStatePolling() and stopStatePolling() removed - polling is now handled entirely by scene manager

    replacePlaceholders(text) {
        if (!text) return text;

        const state = this.regrooveState.playerState;
        return text
            .replace(/\{order\}/gi, state.order)
            .replace(/\{pattern\}/gi, state.pattern)
            .replace(/\{row\}/gi, state.row);
    }

    /**
     * Get display info for routing action pads (action 602)
     * Shows the MIDI input name and currently active target
     */
    getRoutingDisplayInfo(inputName) {
        if (!this.inputRouter) return null;

        // Handle "all inputs" case
        if (inputName === '') {
            const allRoutes = this.inputRouter.getAllRoutes();
            if (allRoutes.length === 0) return 'No routes configured';
            return `All Routes (${allRoutes.length})`;
        }

        // inputName is already the name of the input device, no need to look it up

        // Get active target
        const activeTarget = this.inputRouter.getActiveTarget(inputName);
        if (!activeTarget) {
            return `${inputName}\nNo active route`;
        }

        // Format target name
        let targetName = 'Unknown';
        if (activeTarget.deviceId !== undefined) {
            // Device mode
            if (this.deviceManager) {
                const device = this.deviceManager.getDevice(activeTarget.deviceId);
                if (device) {
                    targetName = device.name;
                } else {
                    targetName = `Device ${activeTarget.deviceId}`;
                }
            }
        } else if (activeTarget.outputName !== undefined) {
            // Pass-through mode
            if (this.midiAccess) {
                const output = this.midiAccess.outputs.get(activeTarget.outputName);
                if (output) {
                    targetName = output.name;
                } else {
                    targetName = 'Unknown Output';
                }
            }
        }

        return `${inputName}\n→ ${targetName}`;
    }

    updateDeviceSequencerPads() {
        // Update ONLY device sequencer pads (actions 720-724), not local sequencer pads
        this.pads.forEach((pad, index) => {
            const padConfig = this.scenePadsConfig ? this.scenePadsConfig[index] : this.config.pads[index];
            if (!padConfig) return;

            // ONLY handle device sequencer actions (720-724)
            if (padConfig.action >= 720 && padConfig.action <= 724 && padConfig.deviceId) {
                const slot = padConfig.parameter & 0xFF;
                const isPlaying = this.actionDispatcher?.isDeviceSlotPlaying(padConfig.deviceId, slot) || false;

                let color = null;

                // For play or toggle actions (720, 722), set color and label based on state
                if (padConfig.action === 720) {
                    // ACTION_DEVICE_SEQ_PLAY - only green when playing
                    color = isPlaying ? 'green' : null;
                } else if (padConfig.action === 722) {
                    // ACTION_DEVICE_SEQ_PLAY_STOP (toggle) - always has color
                    color = isPlaying ? 'green' : 'red';
                    const baseName = padConfig.label || '';
                    const statusLabel = isPlaying ? 'STOP' : 'PLAY';
                    pad.setAttribute('label', `${statusLabel}: ${baseName}`);
                } else if (padConfig.action === 721) {
                    // ACTION_DEVICE_SEQ_STOP
                    color = !isPlaying ? 'red' : null;
                }

                // Apply color to pad
                if (color) {
                    pad.setAttribute('color', color);
                } else {
                    pad.removeAttribute('color');
                }
            }
        });
    }

    updateLocalSequencerPads() {
        // Update ONLY local Meister sequencer pads (actions 700-702), not device sequencer pads
        this.pads.forEach((pad, index) => {
            const padConfig = this.scenePadsConfig ? this.scenePadsConfig[index] : this.config.pads[index];
            if (!padConfig) return;

            let color = null;

            // ONLY handle local sequencer PLAY/STOP actions (700-702)
            if (padConfig.action === 700) {
                // ACTION_SEQUENCER_PLAY - only green when playing
                const sceneId = padConfig.parameter;
                const scene = this.sceneManager?.scenes.get(sceneId);
                if (scene && scene.type === 'sequencer' && scene.sequencerInstance) {
                    const isPlaying = scene.sequencerInstance.engine.playing;
                    color = isPlaying ? 'green' : null;
                }
            } else if (padConfig.action === 702) {
                // ACTION_SEQUENCER_PLAY_STOP (toggle) - always has color
                const sceneId = padConfig.parameter;
                const scene = this.sceneManager?.scenes.get(sceneId);
                if (scene && scene.type === 'sequencer' && scene.sequencerInstance) {
                    const isPlaying = scene.sequencerInstance.engine.playing;
                    color = isPlaying ? 'green' : 'red';
                    const baseName = padConfig.label || '';
                    const statusLabel = isPlaying ? 'STOP' : 'PLAY';
                    pad.setAttribute('label', `${statusLabel}: ${baseName}`);
                }
            } else if (padConfig.action === 701) {
                // ACTION_SEQUENCER_STOP
                const sceneId = padConfig.parameter;
                const scene = this.sceneManager?.scenes.get(sceneId);
                if (scene && scene.type === 'sequencer' && scene.sequencerInstance) {
                    color = !scene.sequencerInstance.engine.playing ? 'red' : null;
                }
            }

            // Only update if this is a local sequencer pad
            if (padConfig.action >= 700 && padConfig.action <= 702) {
                if (color) {
                    pad.setAttribute('color', color);
                } else {
                    pad.removeAttribute('color');
                }
            }
        });
    }

    updatePadColors() {
        // Update all pads based on player state
        this.pads.forEach((pad, index) => {
            // Get padConfig from scene or from config (for built-in pads)
            const padConfig = this.scenePadsConfig ? this.scenePadsConfig[index] : this.config.pads[index];
            if (!padConfig) return;

            // Resolve device state for this pad
            let deviceState = this.regrooveState.playerState; // Default to device 0
            if (padConfig.deviceBinding && this.deviceManager) {
                const device = this.deviceManager.getDevice(padConfig.deviceBinding);
                if (device) {
                    deviceState = this.regrooveState.getDeviceState(device.deviceId);
                }
            }

            // Update placeholders in labels using device state
            if (pad._originalLabel) {
                const labelText = pad._originalLabel
                    .replace(/\{order\}/gi, deviceState.order)
                    .replace(/\{pattern\}/gi, deviceState.pattern)
                    .replace(/\{row\}/gi, deviceState.row);
                pad.setAttribute('label', labelText);
            }
            if (pad._originalSublabel) {
                const sublabelText = pad._originalSublabel
                    .replace(/\{order\}/gi, deviceState.order)
                    .replace(/\{pattern\}/gi, deviceState.pattern)
                    .replace(/\{row\}/gi, deviceState.row);
                pad.setAttribute('sublabel', sublabelText);
            }

            const label = padConfig.label || '';
            let color = null;

            // Check for sequencer PLAY/STOP actions (700-702)
            if (padConfig.action === 700) {
                // ACTION_SEQUENCER_PLAY - only green when playing
                const sceneId = padConfig.parameter;
                const scene = this.sceneManager?.scenes.get(sceneId);
                if (scene && scene.type === 'sequencer' && scene.sequencerInstance) {
                    const isPlaying = scene.sequencerInstance.engine.playing;
                    color = isPlaying ? 'green' : null;
                }
            } else if (padConfig.action === 702) {
                // ACTION_SEQUENCER_PLAY_STOP (toggle) - always has color
                const sceneId = padConfig.parameter;
                const scene = this.sceneManager?.scenes.get(sceneId);
                if (scene && scene.type === 'sequencer' && scene.sequencerInstance) {
                    const isPlaying = scene.sequencerInstance.engine.playing;
                    color = isPlaying ? 'green' : 'red';
                    const baseName = padConfig.label || '';
                    const statusLabel = isPlaying ? 'STOP' : 'PLAY';
                    pad.setAttribute('label', `${statusLabel}: ${baseName}`);
                }
            } else if (padConfig.action === 701) {
                // ACTION_SEQUENCER_STOP
                const sceneId = padConfig.parameter;
                const scene = this.sceneManager?.scenes.get(sceneId);
                if (scene && scene.type === 'sequencer' && scene.sequencerInstance) {
                    color = !scene.sequencerInstance.engine.playing ? 'red' : null;
                }
            }
            // Check for device sequencer PLAY/STOP actions (720-724)
            else if (padConfig.action >= 720 && padConfig.action <= 724 && padConfig.deviceId) {
                const slot = padConfig.parameter & 0xFF;
                const isPlaying = this.actionDispatcher?.isDeviceSlotPlaying(padConfig.deviceId, slot) || false;

                // For play or toggle actions (720, 722), set color and label based on state
                if (padConfig.action === 720) {
                    // ACTION_DEVICE_SEQ_PLAY - only green when playing
                    color = isPlaying ? 'green' : null;
                } else if (padConfig.action === 722) {
                    // ACTION_DEVICE_SEQ_PLAY_STOP (toggle) - always has color
                    color = isPlaying ? 'green' : 'red';
                    const baseName = padConfig.label || '';
                    const statusLabel = isPlaying ? 'STOP' : 'PLAY';
                    pad.setAttribute('label', `${statusLabel}: ${baseName}`);
                } else if (padConfig.action === 721) {
                    // ACTION_DEVICE_SEQ_STOP
                    color = !isPlaying ? 'red' : null;
                }
            }
            // Check for PLAY pad (Regroove)
            else if (label.includes('PLAY')) {
                color = deviceState.playing ? 'green' : null;
            }
            // Check for STOP pad (Regroove)
            else if (label.includes('STOP')) {
                color = !deviceState.playing ? 'red' : null;
            }
            // Check for LOOP pad
            else if (label.includes('LOOP')) {
                // Mode 01 = pattern/loop
                const loopEnabled = (deviceState.mode === 0x01);
                color = loopEnabled ? 'yellow' : null;
            }
            // Check for SOLO CH pads (e.g., "SOLO\nCH1", "SOLO\nCH 2", etc.)
            else if (label.includes('SOLO') && label.match(/CH\s*(\d+)/i)) {
                const match = label.match(/CH\s*(\d+)/i);
                if (match) {
                    const channel = parseInt(match[1]) - 1; // Convert to 0-indexed
                    const isSolo = this.isChannelSolo(channel, deviceState);
                    color = isSolo ? 'red' : null;
                }
            }
            // Check for MUTE CH pads (e.g., "MUTE\nCH1", "MUTE\nCH 2", etc.)
            else if (label.includes('MUTE') && label.match(/CH\s*(\d+)/i)) {
                const match = label.match(/CH\s*(\d+)/i);
                if (match) {
                    const channel = parseInt(match[1]) - 1; // Convert to 0-indexed
                    const isMuted = deviceState.mutedChannels.includes(channel);
                    color = isMuted ? 'red' : null;
                }
            }

            // Apply color to pad
            if (color) {
                pad.setAttribute('color', color);
            } else {
                pad.removeAttribute('color');
            }
        });
    }

    isChannelSolo(channel, deviceState = null) {
        // Use provided deviceState or fall back to default playerState
        const state = deviceState || this.regrooveState.playerState;
        const { numChannels, mutedChannels } = state;

        // Check if this channel is unmuted
        if (mutedChannels.includes(channel)) {
            return false; // Can't be solo if it's muted
        }

        // Check if all other channels are muted
        for (let ch = 0; ch < numChannels; ch++) {
            if (ch !== channel && !mutedChannels.includes(ch)) {
                return false; // Another channel is also unmuted
            }
        }

        // Only this channel is unmuted (and there are other channels muted)
        return mutedChannels.length > 0;
    }

    sendMMC(command, params = {}, deviceId = 0x7F) {
        if (!this.midiOutput) {
            console.warn('No MIDI output selected');
            return;
        }

        // MMC command mapping
        const mmcCommands = {
            'stop': 0x01,
            'play': 0x02,
            'deferred_play': 0x03,
            'fast_forward': 0x04,
            'rewind': 0x05,
            'record_strobe': 0x06,
            'record_exit': 0x07,
            'record_pause': 0x08,
            'pause': 0x09,
            'eject': 0x0A,
            'chase': 0x0B,
            'reset': 0x0D,
            'locate': 0x44,
            'shuttle': 0x47
        };

        const cmdByte = mmcCommands[command];
        if (cmdByte === undefined) {
            console.error(`Unknown MMC command: ${command}`);
            return;
        }

        let message = [
            0xF0,       // SysEx start
            0x7F,       // Real-time Universal SysEx
            deviceId & 0x7F,   // Device ID (0x7F = all, or specific device)
            0x06,       // MMC sub-ID
            cmdByte     // Command
        ];

        // Add parameters for LOCATE command
        if (command === 'locate' && params.order !== undefined && params.row !== undefined) {
            // MMC LOCATE format:
            // F0 7F <dev> 06 44 06 01 <order> <row> 00 00 00 F7
            // 06 = information field length (6 bytes: type + 5 time bytes)
            // 01 = target position type (0x04 = loop start, 0x05 = loop end)
            const order = params.order & 0x7F;
            const row = params.row & 0x7F;
            message.push(
                0x06,  // Information field length (6 bytes)
                0x01,  // Locate type: target position
                order, // Hours (order)
                row,   // Minutes (row)
                0x00,  // Seconds (unused)
                0x00,  // Frames (unused)
                0x00   // Subframes (unused)
            );
        }

        message.push(0xF7); // SysEx end

        this.midiOutput.send(message);
        // console.log(`Sent MMC to device ${deviceId}: ${command} (0x${cmdByte.toString(16).toUpperCase()})`, params);
    }

    // SysEx Helper Functions for Regroove
    sendSysEx(deviceId, command, data = []) {
        // Get MIDI output for this device (uses device-specific output if configured)
        const midiOutput = this.getMidiOutputForDeviceId(deviceId);

        if (!midiOutput) {
            console.warn('[Meister] Cannot send SysEx - No MIDI output available for device', deviceId);
            return;
        }

        const message = [
            0xF0,  // SysEx start
            0x7D,  // Regroove manufacturer ID
            deviceId,
            command,
            ...data,
            0xF7   // SysEx end
        ];

        // Only log non-polling commands to reduce console spam
        // 0x60 = GET_PLAYER_STATE, 0x71 = FX_EFFECT_SET, 0x7E = FX_GET_ALL_STATE
        if (command !== 0x60 && command !== 0x71 && command !== 0x7E) {
            // console.log(`[Meister] sendSysEx: Sending to device ${deviceId}, command 0x${command.toString(16).toUpperCase()}, message: [${message.join(', ')}]`);
        }
        midiOutput.send(message);
    }

    /**
     * Get MIDI output for a device based on its SysEx device ID
     */
    getMidiOutputForDeviceId(sysexDeviceId) {
        // Find device by SysEx device ID
        if (this.deviceManager) {
            const devices = this.deviceManager.getAllDevices();
            const device = devices.find(d => d.deviceId === sysexDeviceId);
            if (device) {
                // Get device-specific MIDI output
                return this.deviceManager.getMidiOutput(device.id);
            }
        }

        // Fallback to default MIDI output
        return this.midiOutput;
    }

    // SysEx: NEXT_ORDER (0x24) - Queue next order (beat-synced)
    sendSysExNextOrder(deviceId) {
        this.sendSysEx(deviceId, 0x24, []);
    }

    // SysEx: PREV_ORDER (0x25) - Queue previous order (beat-synced)
    sendSysExPrevOrder(deviceId) {
        this.sendSysEx(deviceId, 0x25, []);
    }

    // SysEx: JUMP_TO_ORDER_ROW (0x40) - Immediate jump to order+row
    sendSysExJumpToOrderRow(deviceId, order, row) {
        this.sendSysEx(deviceId, 0x40, [order & 0x7F, row & 0x7F]);
    }

    // SysEx: FILE_LOAD (0x10) - Load file by filename
    sendSysExFileLoad(deviceId, filename) {
        // Format: <length_byte> <filename_bytes...>
        const filenameBytes = [];
        for (let i = 0; i < filename.length; i++) {
            filenameBytes.push(filename.charCodeAt(i) & 0x7F);
        }
        // Prepend length byte
        const data = [filenameBytes.length, ...filenameBytes];
        this.sendSysEx(deviceId, 0x10, data);
    }

    // SysEx: PLAY (0x20)
    sendSysExPlay(deviceId) {
        this.sendSysEx(deviceId, 0x20, []);
    }

    // SysEx: STOP (0x21)
    sendSysExStop(deviceId) {
        this.sendSysEx(deviceId, 0x21, []);
    }

    // SysEx: PAUSE (0x22)
    sendSysExPause(deviceId) {
        this.sendSysEx(deviceId, 0x22, []);
    }

    // SysEx: RETRIGGER (0x23)
    sendSysExRetrigger(deviceId) {
        this.sendSysEx(deviceId, 0x23, []);
    }

    // SysEx: CHANNEL_MUTE (0x30)
    sendSysExChannelMute(deviceId, channel, mute) {
        this.sendSysEx(deviceId, 0x30, [channel & 0x7F, mute ? 1 : 0]);
    }

    // SysEx: CHANNEL_SOLO (0x31)
    sendSysExChannelSolo(deviceId, channel, solo) {
        this.sendSysEx(deviceId, 0x31, [channel & 0x7F, solo ? 1 : 0]);
    }

    // SysEx: CHANNEL_FX_ENABLE (0x38) - Samplecrate per-program FX enable
    sendSysExChannelFxEnable(deviceId, program, enable) {
        this.sendSysEx(deviceId, 0x38, [program & 0x7F, enable ? 1 : 0]);
    }

    // SysEx: SET_LOOP_CURRENT (0x43)
    sendSysExSetLoopCurrent(deviceId, enable) {
        this.sendSysEx(deviceId, 0x43, [enable ? 1 : 0]);
    }

    // SysEx: PING (0x01) - Device discovery/heartbeat
    sendSysExPing(deviceId) {
        this.sendSysEx(deviceId, 0x01, []);
    }

    // SysEx: CHANNEL_VOLUME (0x32)
    sendSysExChannelVolume(deviceId, channel, volume) {
        this.sendSysEx(deviceId, 0x32, [channel & 0x7F, volume & 0x7F]);
    }

    // SysEx: MASTER_VOLUME (0x33) - Set master volume
    sendSysExMasterVolume(deviceId, volume) {
        this.sendSysEx(deviceId, 0x33, [volume & 0x7F]);
    }

    // SysEx: MASTER_MUTE (0x34) - Set master mute
    sendSysExMasterMute(deviceId, mute) {
        this.sendSysEx(deviceId, 0x34, [mute ? 1 : 0]);
    }

    // SysEx: INPUT_VOLUME (0x35) - Set input volume
    sendSysExInputVolume(deviceId, volume) {
        this.sendSysEx(deviceId, 0x35, [volume & 0x7F]);
    }

    // SysEx: INPUT_MUTE (0x36) - Set input mute
    sendSysExInputMute(deviceId, mute) {
        this.sendSysEx(deviceId, 0x36, [mute ? 1 : 0]);
    }

    // SysEx: FX_SET_ROUTE (0x37) - Set FX routing
    // route: 0=none, 1=master, 2=playback, 3=input
    sendSysExFxSetRoute(deviceId, route) {
        this.sendSysEx(deviceId, 0x37, [route & 0x7F]);
    }

    // SysEx: STEREO_SEPARATION (0x57) - Set stereo separation width
    // separation: 0-127 (maps to 0-200, where 0=mono, 64≈100=normal, 127=200=extra wide)
    sendSysExStereoSeparation(deviceId, separation) {
        this.sendSysEx(deviceId, 0x57, [separation & 0x7F]);
    }

    // SysEx: CHANNEL_PANNING (0x58) - Set channel panning
    // channel: 0-63, panning: 0-127 (0=left, 64=center, 127=right)
    sendSysExChannelPanning(deviceId, channel, panning) {
        this.sendSysEx(deviceId, 0x58, [channel & 0x7F, panning & 0x7F]);
    }

    // SysEx: MASTER_PANNING (0x59) - Set master output panning
    // panning: 0-127 (0=left, 64=center, 127=right)
    sendSysExMasterPanning(deviceId, panning) {
        this.sendSysEx(deviceId, 0x59, [panning & 0x7F]);
    }

    // SysEx: INPUT_PANNING (0x5A) - Set audio input panning
    // panning: 0-127 (0=left, 64=center, 127=right)
    sendSysExInputPanning(deviceId, panning) {
        this.sendSysEx(deviceId, 0x5A, [panning & 0x7F]);
    }

    // SysEx: JUMP_TO_PATTERN_ROW (0x46) - Immediate jump to pattern+row
    sendSysExJumpToPatternRow(deviceId, pattern, row) {
        this.sendSysEx(deviceId, 0x46, [pattern & 0x7F, row & 0x7F]);
    }

    // SysEx: SET_LOOP_RANGE (0x41) - Set loop: start_order, start_row, end_order, end_row
    sendSysExSetLoopRange(deviceId, startOrder, startRow, endOrder, endRow) {
        this.sendSysEx(deviceId, 0x41, [startOrder & 0x7F, startRow & 0x7F, endOrder & 0x7F, endRow & 0x7F]);
    }

    // SysEx: SET_LOOP_ORDER (0x44) - Loop specific order number
    sendSysExSetLoopOrder(deviceId, orderNumber) {
        this.sendSysEx(deviceId, 0x44, [orderNumber & 0x7F]);
    }

    // SysEx: SET_LOOP_PATTERN (0x45) - Loop specific pattern number
    sendSysExSetLoopPattern(deviceId, patternNumber) {
        this.sendSysEx(deviceId, 0x45, [patternNumber & 0x7F]);
    }

    // SysEx: SET_TEMPO (0x42) - Set playback tempo (BPM as 16-bit value, sent as two 7-bit bytes)
    sendSysExSetTempo(deviceId, bpm) {
        this.sendSysEx(deviceId, 0x42, [bpm & 0x7F, (bpm >> 7) & 0x7F]);
    }

    // SysEx: TRIGGER_PHRASE (0x50) - Trigger phrase by index
    sendSysExTriggerPhrase(deviceId, phraseIndex) {
        this.sendSysEx(deviceId, 0x50, [phraseIndex & 0x7F]);
    }

    // SysEx: TRIGGER_LOOP (0x51) - Trigger saved loop range by index
    sendSysExTriggerLoop(deviceId, loopIndex) {
        this.sendSysEx(deviceId, 0x51, [loopIndex & 0x7F]);
    }

    // SysEx: TRIGGER_PAD (0x52) - Trigger application/song pad by index
    sendSysExTriggerPad(deviceId, padIndex) {
        this.sendSysEx(deviceId, 0x52, [padIndex & 0x7F]);
    }

    // SysEx: FX_EFFECT_SET (0x71) - Set effect parameters
    sendSysExFxEffectSet(deviceId, programId, effectId, enabled, ...params) {
        this.sendSysEx(deviceId, 0x71, [programId & 0x7F, effectId & 0x7F, enabled ? 1 : 0, ...params.map(p => p & 0x7F)]);
    }

    // SysEx: FX_GET_ALL_STATE (0x7E) - Request complete effects state
    sendSysExFxGetAllState(deviceId, programId = 0) {
        this.sendSysEx(deviceId, 0x7E, [programId & 0x7F]);
    }

    // SysEx: GET_PROGRAM_STATE (0x64) - Request program/mixer state (SampleCrate)
    sendSysExGetProgramState(deviceId) {
        this.sendSysEx(deviceId, 0x64, []);
    }

    // SysEx: GET_SEQUENCE_STATE (0x62) - Request sequence slot state (SampleCrate)
    sendSysExGetSequenceState(deviceId) {
        this.sendSysEx(deviceId, 0x62, []);
    }

    // SysEx: GET_DECKS_STATE (0x66) - Request DJ deck state (Mixxx)
    sendSysExGetDeckState(deviceId) {
        this.sendSysEx(deviceId, 0x66, []);
    }

    /**
     * Initialize Web Worker for MIDI clock timing
     * Worker runs in separate thread - won't be blocked by UI!
     */
    initClockWorker() {
        try {
            this.clockWorker = new Worker('midi-clock-worker.js');

            this.clockWorker.onmessage = (e) => {
                const { type, count, bpm, interval } = e.data;

                if (type === 'pulse') {
                    // Send MIDI clock
                    if (this.midiOutput && this.clockMaster) {
                        this.midiOutput.send([0xF8]);

                        // Log every 96 pulses (4 beats) - DISABLED (too noisy)
                        // if (count % 96 === 0) {
                        //     console.log(`[MIDI Clock] Worker sent pulse ${count} (beat ${count / 24})`);
                        // }
                    }

                    // ONLY notify sequencer if it wants MIDI clock sync
                    // Check if current scene's sequencer has MIDI clock sync enabled
                    if (this.sceneManager) {
                        const currentScene = this.sceneManager.scenes.get(this.sceneManager.currentScene);
                        if (currentScene && currentScene.type === 'sequencer' &&
                            currentScene.sequencerInstance &&
                            currentScene.sequencerInstance.engine.syncToMIDIClock) {
                            this.notifySequencerClock();
                        }
                    }
                } else if (type === 'started') {
                    // console.log(`[MIDI Clock] Worker started: BPM=${bpm}, interval=${interval}ms`);
                } else if (type === 'stopped') {
                    // console.log(`[MIDI Clock] Worker stopped`);
                } else if (type === 'error') {
                    console.error(`[MIDI Clock] Worker error:`, e.data.message);
                }
            };

            this.clockWorker.onerror = (error) => {
                console.error('[MIDI Clock] Worker error:', error);
            };

            // console.log('[MIDI Clock] Worker initialized successfully');
        } catch (error) {
            console.error('[MIDI Clock] Failed to initialize worker:', error);
            this.clockWorker = null;
        }
    }

    // MIDI Clock Master functions
    startClock() {
        if (!this.midiOutput) {
            // console.log('[MIDI Clock] No MIDI output selected - clock will run internally only (no MIDI output)');
        }

        // Note: We do NOT send MIDI Start (0xFA) here
        // Only send clock pulses, let the slave control its own transport

        // Use Web Worker if available (best performance - runs in separate thread!)
        if (this.clockWorker) {
            this.clockWorker.postMessage({ cmd: 'start', bpm: this.clockBPM });
            this.clockInterval = true; // Mark as running
        } else {
            // Fallback to JS clock
            console.warn('[MIDI Clock] Worker not available, using fallback JS clock');
            this.startJSClock();
        }
    }

    startJSClock() {
        // Calculate interval (24 ppqn)
        const PULSES_PER_QUARTER_NOTE = 24;
        const msPerBeat = 60000 / this.clockBPM;
        const interval = msPerBeat / PULSES_PER_QUARTER_NOTE;

        // console.log(`[MIDI Clock] Starting High-Precision Clock: BPM=${this.clockBPM}, interval=${interval.toFixed(2)}ms`);

        // Shared pulse counter for sequencer to read (decoupled!)
        this.clockPulseCount = 0;
        let nextPulseTime = performance.now();

        // Use recursive setTimeout with drift compensation
        const clockTick = () => {
            if (!this.clockInterval) return; // Stopped

            // Increment counter (sequencer reads this asynchronously)
            this.clockPulseCount++;

            // ONLY send MIDI clock - DO NOT call sequencer here!
            // Sequencer polls clockPulseCount separately to avoid blocking
            if (this.midiOutput && this.clockMaster) {
                this.midiOutput.send([0xF8]);

                // Log every 96 pulses (4 beats)
                if (this.clockPulseCount % 96 === 0) {
                    // console.log(`[MIDI Clock] Sent pulse ${this.clockPulseCount} (beat ${this.clockPulseCount / 24})`);
                }
            }

            // Schedule next pulse with drift compensation
            nextPulseTime += interval;
            const delay = Math.max(0, nextPulseTime - performance.now());

            // Continue loop with precise timing
            this.clockInterval = setTimeout(clockTick, delay);
        };

        // Start the clock immediately
        this.clockInterval = setTimeout(clockTick, 0);
    }

    stopClock() {
        // Stop Web Worker clock
        if (this.clockWorker && this.clockInterval) {
            this.clockWorker.postMessage({ cmd: 'stop' });
            this.clockInterval = null;
            return;
        }

        // Fallback: Stop JavaScript clock
        if (this.clockInterval) {
            clearTimeout(this.clockInterval);
            this.clockInterval = null;
        }

        // Note: We do NOT send MIDI Stop (0xFC) here
        // Only stop sending clock pulses
        // This allows the slave to continue running if desired
    }

    updateClockBPM(bpm) {
        // Update BPM dynamically without stopping/restarting
        if (this.clockWorker && this.clockInterval) {
            this.clockWorker.postMessage({ cmd: 'setBPM', bpm: bpm });
            // console.log(`[MIDI Clock] BPM updated to ${bpm} (seamless transition)`);
        }
        // No fallback needed - if not using worker, clock isn't running
    }

    openTempoSlider() {
        const overlay = document.getElementById('tempo-slider-overlay');
        const tempoFader = document.getElementById('global-tempo-fader');
        const display = document.getElementById('tempo-display-value');
        const closeBtn = document.getElementById('close-tempo-slider');

        // Set initial values
        tempoFader.setAttribute('bpm', this.clockBPM);
        display.textContent = this.clockBPM;

        // Show overlay
        overlay.classList.add('active');

        // Handle tempo changes from fader (live updates)
        const handleTempoChange = (e) => {
            const bpm = e.detail.bpm;
            display.textContent = bpm;
            this.clockBPM = bpm;
            document.getElementById('clock-bpm').value = bpm;

            // Update clock dynamically
            if (this.clockMaster) {
                this.updateClockBPM(bpm);
            }

            // Sync sequencer BPM if active
            if (this.sceneManager) {
                const currentScene = this.sceneManager.scenes.get(this.sceneManager.currentScene);
                if (currentScene && currentScene.type === 'sequencer' && currentScene.sequencerInstance) {
                    currentScene.sequencerInstance.engine.bpm = bpm;
                    currentScene.sequencerInstance.engine.msPerRow = currentScene.sequencerInstance.engine.calculateMsPerRow();

                    const seqBpmInput = document.getElementById('seq-bpm-input');
                    if (seqBpmInput) {
                        seqBpmInput.value = bpm;
                    }
                }
            }
        };

        const handleClose = () => {
            overlay.classList.remove('active');
            tempoFader.removeEventListener('tempo-change', handleTempoChange);
            tempoFader.removeEventListener('tempo-reset', handleTempoChange);
            closeBtn.removeEventListener('click', handleClose);
            this.saveConfig();
        };

        tempoFader.addEventListener('tempo-change', handleTempoChange);
        tempoFader.addEventListener('tempo-reset', handleTempoChange); // Handle reset button too
        closeBtn.addEventListener('click', handleClose);
    }

    createSequencerButtons() {
        const container = document.getElementById('sequencer-buttons');
        container.innerHTML = '';

        // Create 16 buttons (representing 16 rows/beats)
        for (let i = 0; i < 16; i++) {
            const button = document.createElement('div');
            button.className = 'seq-button';

            // Mark every 4th button (quarter notes)
            if ((i + 1) % 4 === 0) {
                button.classList.add('quarter');
            }

            // Click to send SPP to this position
            button.addEventListener('click', () => {
                // Only send SPP if ANY sequencer is playing with sendSPP enabled
                let shouldSendSPP = false;

                if (this.sceneManager) {
                    // Check all scenes for a playing sequencer with sendSPP enabled
                    for (const [sceneId, scene] of this.sceneManager.scenes.entries()) {
                        if (scene.type === 'sequencer' &&
                            scene.sequencerInstance &&
                            scene.sequencerInstance.engine.playing &&
                            scene.sequencerInstance.engine.sendSPP) {
                            shouldSendSPP = true;
                            break;
                        }
                    }
                }

                if (shouldSendSPP) {
                    this.sendSPP(i * 4); // Each button = 4 16th notes (1 beat)
                }
            });

            container.appendChild(button);
        }
    }

    updatePositionBar() {
        if (!this.receiveSPP) return;

        // currentPosition is in rows (16th notes), 0-63
        // Each button represents 4 rows (1 beat)
        // So button index = floor(position / 4)
        const buttons = document.querySelectorAll('.seq-button');
        const currentBeat = Math.floor(this.currentPosition / 4);

        // console.log(`Updating position bar: position ${this.currentPosition}, beat ${currentBeat}`);

        buttons.forEach((button, index) => {
            if (index === currentBeat) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });
    }

    sendSPP(position) {
        if (!this.midiOutput) {
            console.warn('[SPP] No MIDI output selected');
            return;
        }

        // SPP position is in MIDI beats (6 per quarter note)
        // But we're working in 16th notes, so convert
        const sppPosition = position; // position is already in 16th notes

        // Split into LSB and MSB (14-bit value)
        const lsb = sppPosition & 0x7F;
        const msb = (sppPosition >> 7) & 0x7F;

        // Send SPP message: 0xF2 + LSB + MSB
        this.midiOutput.send([0xF2, lsb, msb]);

        // console.log(`[SPP] Sent SPP: position ${position} (beat ${Math.floor(position / 4)})`);

        // Update local position for visual feedback
        this.currentPosition = position;
        this.updatePositionBar();
    }

    // Configuration management
    saveConfig() {
        try {
            // Add clock and SPP settings to config
            this.config.clockMaster = this.clockMaster;
            this.config.clockBPM = this.clockBPM;
            this.config.receiveSPP = this.receiveSPP;
            this.config.pollingIntervalMs = this.regrooveState.pollingIntervalMs;

            // Save MIDI output selection (use name, not ID, as IDs change between sessions)
            if (this.midiOutput) {
                this.config.midiOutputName = this.midiOutput.name;
            }

            // Save enabled MIDI inputs (convert Set to Array for JSON)
            this.config.enabledMidiInputs = Array.from(this.enabledMidiInputs);

            localStorage.setItem('meisterConfig', JSON.stringify(this.config));
        } catch (e) {
            console.error('Failed to save config to localStorage:', e);
        }
    }

    loadConfig() {
        try {
            const saved = localStorage.getItem('meisterConfig');
            if (saved) {
                this.config = JSON.parse(saved);

                // Apply saved settings to UI
                // Note: Grid layout is now managed in the Scenes tab via scene editor
                // Note: MIDI channel and Device ID are now managed in the Devices tab
                // Keep legacy values in config for backward compatibility
                this.midiChannel = this.config.midiChannel || 0;
                this.regrooveDeviceId = this.config.sysexDeviceId || 0;

                // Load clock and SPP settings
                this.clockMaster = this.config.clockMaster || false;
                this.clockBPM = this.config.clockBPM || 120;
                this.receiveSPP = this.config.receiveSPP !== undefined ? this.config.receiveSPP : true; // Default to true

                // Load polling interval
                if (this.config.pollingIntervalMs !== undefined) {
                    this.regrooveState.pollingIntervalMs = this.config.pollingIntervalMs;
                }

                // Load enabled MIDI inputs (convert Array back to Set)
                if (this.config.enabledMidiInputs && Array.isArray(this.config.enabledMidiInputs)) {
                    this.enabledMidiInputs = new Set(this.config.enabledMidiInputs);
                    // console.log(`[Meister] Loaded ${this.enabledMidiInputs.size} enabled MIDI input(s) from config`);
                }

                document.getElementById('clock-master').checked = this.clockMaster;
                document.getElementById('clock-bpm').value = this.clockBPM;
                document.getElementById('receive-spp').checked = this.receiveSPP;

                // Global polling interval UI removed - polling is now per-scene

                // Always show position bar and create buttons (used for playback + loop length)
                const sequencer = document.getElementById('position-sequencer');
                sequencer.style.display = 'flex';
                this.createSequencerButtons();

                // Auto-start clock if it was enabled (runs even without MIDI output for internal sequencer sync)
                if (this.clockMaster) {
                    this.startClock();
                }

                this.applyGridLayout();
            }
        } catch (e) {
            console.error('Failed to load config from localStorage:', e);
            this.config = this.getDefaultConfig();
        }
    }

    loadConfigFromFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const fullConfig = JSON.parse(e.target.result);

                // Extract main config (everything except devices and customScenes)
                const { devices, customScenes, ...config } = fullConfig;

                // Merge with existing config instead of replacing entirely
                // This preserves any runtime properties
                Object.assign(this.config, config);

                // Restore device manager data
                if (devices && this.deviceManager) {
                    // console.log('[Config] Restoring device manager data...');

                    // Clear existing devices
                    this.deviceManager.devices.clear();

                    // Restore devices
                    if (devices.devices && Array.isArray(devices.devices)) {
                        devices.devices.forEach(device => {
                            this.deviceManager.devices.set(device.id, {
                                id: device.id,
                                name: device.name,
                                midiChannel: device.midiChannel,
                                deviceId: device.deviceId,
                                color: device.color || '#CF1A37'
                            });
                        });
                    }

                    // Restore default device
                    this.deviceManager.defaultDeviceId = devices.defaultDeviceId || null;

                    // Save to localStorage and refresh UI
                    this.deviceManager.saveDevices();
                    this.deviceManager.refreshDeviceList();

                    // console.log(`[Config] Restored ${devices.devices?.length || 0} device(s)`);
                }

                // Restore custom scenes
                if (customScenes && this.sceneEditor) {
                    try {
                        // console.log('[Config] Restoring custom scenes...');
                        this.sceneEditor.loadCustomScenes(customScenes);
                    } catch (sceneError) {
                        console.error('[Config] Error restoring custom scenes:', sceneError);
                        window.nbDialog.alert('Warning: Could not restore custom mixer scenes. Pads and devices were loaded successfully.');
                    }
                }

                // Apply to UI
                // Note: Grid layout is now managed in Scenes tab via scene editor
                // Note: MIDI channel and Device ID are now managed in Devices tab
                if (config.midiChannel !== undefined) {
                    this.midiChannel = config.midiChannel;
                }
                if (config.sysexDeviceId !== undefined) {
                    this.regrooveDeviceId = config.sysexDeviceId;
                }

                this.applyGridLayout();
                this.saveConfig();

                // console.log('[Config] Configuration loaded from file');
                window.nbDialog.alert('Configuration loaded successfully!');
            } catch (err) {
                console.error('Failed to parse config file:', err);
                window.nbDialog.alert('Error loading configuration file');
            }
        };
        reader.readAsText(file);
    }

    downloadConfig() {
        // Create a complete config bundle with all settings
        const fullConfig = {
            ...this.config,
            // Include device manager data
            devices: this.deviceManager ? {
                devices: Array.from(this.deviceManager.devices.entries()).map(([id, device]) => ({
                    id,
                    ...device
                })),
                defaultDeviceId: this.deviceManager.defaultDeviceId
            } : null,
            // Include custom scenes from scene editor
            customScenes: (this.sceneEditor && typeof this.sceneEditor.getCustomScenes === 'function')
                ? this.sceneEditor.getCustomScenes()
                : null
        };

        const configJson = JSON.stringify(fullConfig, null, 2);
        const blob = new Blob([configJson], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'meister-config.rcx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // console.log('Configuration downloaded with devices and scenes');
    }

    startConnectionWatchdog() {
        if (this.connectionWatchdog) return; // Already running

        this.connectionWatchdog = setInterval(() => {
            const now = Date.now();
            const timeSinceLastUpdate = this.lastStateUpdate ? (now - this.lastStateUpdate) : Infinity;

            if (timeSinceLastUpdate > this.stateTimeoutMs && this.isConnectedToRegroove) {
                // Connection lost
                // console.log('[Regroove] Disconnected - no state updates for ' + Math.round(timeSinceLastUpdate / 1000) + 's');
                this.handleRegrooveDisconnect();
            }
        }, 1000); // Check every second
    }

    stopConnectionWatchdog() {
        if (this.connectionWatchdog) {
            clearInterval(this.connectionWatchdog);
            this.connectionWatchdog = null;
        }
    }

    handleRegrooveDisconnect() {
        this.isConnectedToRegroove = false;

        // Clear all state in regrooveState
        this.regrooveState.clearAllState();

        // Clear all pad colors (reset to default state)
        this.pads.forEach((pad) => {
            pad.removeAttribute('color');
        });

        // Update labels to show default placeholders (will show 0s)
        this.updatePadColors();
    }

    /**
     * Notify active sequencer scene of SPP message
     */
    notifySequencerSPP(position) {
        if (!this.sceneManager) return;

        const currentScene = this.sceneManager.scenes.get(this.sceneManager.currentScene);
        if (currentScene && currentScene.type === 'sequencer' && currentScene.sequencerInstance) {
            currentScene.sequencerInstance.engine.handleSPP(position);
        }
    }

    /**
     * Notify active sequencer scene of MIDI Start
     */
    notifySequencerStart() {
        if (!this.sceneManager) return;

        const currentScene = this.sceneManager.scenes.get(this.sceneManager.currentScene);
        if (currentScene && currentScene.type === 'sequencer' && currentScene.sequencerInstance) {
            currentScene.sequencerInstance.engine.handleMIDIStart();
        }
    }

    /**
     * Notify active sequencer scene of MIDI Stop
     */
    notifySequencerStop() {
        if (!this.sceneManager) return;

        const currentScene = this.sceneManager.scenes.get(this.sceneManager.currentScene);
        if (currentScene && currentScene.type === 'sequencer' && currentScene.sequencerInstance) {
            currentScene.sequencerInstance.engine.handleMIDIStop();
        }
    }

    /**
     * Notify active sequencer scene of MIDI Clock pulse
     */
    notifySequencerClock() {
        // Fast path - no logging to avoid blocking clock loop (called 52+ times per second!)
        if (!this.sceneManager) return;

        const currentScene = this.sceneManager.scenes.get(this.sceneManager.currentScene);
        if (!currentScene) return;

        if (currentScene.type !== 'sequencer') return;

        if (!currentScene.sequencerInstance) return;

        // Call sequencer directly (no deferring needed - console.log removal solved blocking)
        currentScene.sequencerInstance.engine.handleMIDIClock();
    }
}

// Initialize controller when DOM is ready
// Action system integration will be done from index.html module script
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.meisterController = new MeisterController();
    });
} else {
    window.meisterController = new MeisterController();
}
