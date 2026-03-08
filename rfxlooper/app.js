// RFXLooper - 6 Track Loop Station using WASM

class RFXLooper {
    constructor() {
        this.audioContext = null;
        this.workletNode = null;
        this.inputStream = null;
        this.inputNode = null;

        this.bpm = 120;
        this.clearArmed = Array(6).fill(false); // Track which clear buttons are armed
        this.clearAllArmed = false; // Clear all armed state

        // Input hotkey mappings (hotkey number -> device ID)
        this.inputHotkeys = {
            1: null,
            2: null,
            3: null,
            4: null
        };

        this.activeInputHotkey = null; // Currently selected hotkey (1-4)
        this.passThrough = false; // Pass-through enabled/disabled
        this.audioInputDevices = []; // List of available input devices
        this.workletReady = false; // Track if worklet is initialized and ready
        this.trackStates = Array(6).fill(0); // Track state: 0=empty, 1=recording, 2=playing, 3=stopped
        this.tapTimes = []; // Tap tempo timing array
        this.beatClockStartTime = null; // Beat clock reference time
    }

    async init() {
        console.log('Initializing RFXLooper...');

        // Load saved input preferences
        this.loadInputPreferences();

        // Setup UI event listeners
        this.setupUI();

        // Enumerate audio inputs
        await this.enumerateInputs();
    }

    loadInputPreferences() {
        try {
            const saved = localStorage.getItem('rfxlooper_inputHotkeys');
            if (saved) {
                this.inputHotkeys = JSON.parse(saved);
                console.log('Loaded input hotkey preferences:', this.inputHotkeys);
            }
        } catch (error) {
            console.error('Failed to load input preferences:', error);
        }
    }

    saveInputPreferences() {
        try {
            localStorage.setItem('rfxlooper_inputHotkeys', JSON.stringify(this.inputHotkeys));
            console.log('Saved input hotkey preferences');
        } catch (error) {
            console.error('Failed to save input preferences:', error);
        }
    }

    setupUI() {
        // Transport controls
        document.getElementById('btnStart')?.addEventListener('click', () => this.start());
        document.getElementById('btnStop')?.addEventListener('click', () => this.stop());

        const btnClearAll = document.getElementById('btnClearAll');
        btnClearAll?.addEventListener('click', () => {
            if (this.clearAllArmed) {
                // Second press - actually clear all
                this.clearAll();
                this.clearAllArmed = false;
                btnClearAll.classList.remove('active');
            } else {
                // First press - arm for clear (just highlight, don't change text)
                this.clearAllArmed = true;
                btnClearAll.classList.add('active');

                // Reset after 3 seconds
                setTimeout(() => {
                    if (this.clearAllArmed) {
                        this.clearAllArmed = false;
                        btnClearAll.classList.remove('active');
                    }
                }, 3000);
            }
        });

        // Auto-enable first input hotkey on initialization (removed old button)

        // BPM control
        document.getElementById('bpmInput')?.addEventListener('change', (e) => {
            this.bpm = parseInt(e.target.value) || 120;
            if (this.workletNode) {
                this.workletNode.port.postMessage({
                    type: 'setBPM',
                    bpm: this.bpm
                });
            }
        });

        document.getElementById('btnTapTempo')?.addEventListener('click', () => this.tapTempo());

        // Track controls
        document.querySelectorAll('.btn-rec').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const trackIndex = parseInt(e.target.dataset.track);
                this.recordTrack(trackIndex);
            });
        });

        document.querySelectorAll('.btn-play').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const trackIndex = parseInt(e.target.dataset.track);
                this.playTrack(trackIndex);
            });
        });

        document.querySelectorAll('.btn-clear').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const trackIndex = parseInt(e.target.dataset.track);

                if (this.clearArmed[trackIndex]) {
                    // Second press - actually clear
                    this.clearTrack(trackIndex);
                    this.clearArmed[trackIndex] = false;
                    btn.classList.remove('active');
                } else {
                    // First press - arm for clear (just highlight, don't change text)
                    this.clearArmed[trackIndex] = true;
                    btn.classList.add('active');

                    // Reset after 3 seconds
                    setTimeout(() => {
                        if (this.clearArmed[trackIndex]) {
                            this.clearArmed[trackIndex] = false;
                            btn.classList.remove('active');
                        }
                    }, 3000);
                }
            });
        });

        document.querySelectorAll('.btn-export').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const trackIndex = parseInt(e.target.dataset.track);
                this.exportTrack(trackIndex);
            });
        });

        document.querySelectorAll('.btn-import').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const trackIndex = parseInt(e.target.dataset.track);
                this.importTrack(trackIndex);
            });
        });

        // Volume sliders
        document.querySelectorAll('.track-volume').forEach(slider => {
            slider.addEventListener('change', (e) => {
                const trackIndex = parseInt(e.target.dataset.track);
                const volume = e.detail.value / 127.0;
                this.setTrackVolume(trackIndex, volume);
            });
        });

        // Input gain knob (0-4x range)
        document.getElementById('inputGainKnob')?.addEventListener('cc-change', (e) => {
            const gain = (e.detail.value / 127.0) * 4.0; // 0.0 to 4.0
            if (this.workletNode) {
                this.workletNode.port.postMessage({
                    type: 'setInputGain',
                    gain: gain
                });
            }
        });

        // Master gain knob (0-2x range)
        document.getElementById('masterGainKnob')?.addEventListener('cc-change', (e) => {
            const gain = (e.detail.value / 127.0) * 2.0; // 0.0 to 2.0
            if (this.workletNode) {
                this.workletNode.port.postMessage({
                    type: 'setMasterGain',
                    gain: gain
                });
            }
        });

        // Hamburger menu
        document.getElementById('hamburgerBtn')?.addEventListener('click', () => this.openMenu());
        document.getElementById('menuClose')?.addEventListener('click', () => this.closeMenu());
        document.getElementById('menuOverlay')?.addEventListener('click', () => this.closeMenu());

        document.getElementById('btnAudioOutput')?.addEventListener('click', () => this.openAudioOutput());
        document.getElementById('btnInputSetup')?.addEventListener('click', () => this.openInputSetup());
        document.getElementById('btnAbout')?.addEventListener('click', () => this.openAbout());

        // Audio Output modal
        document.getElementById('audioOutputClose')?.addEventListener('click', () => this.closeAudioOutput());
        document.getElementById('audioOutputOverlay')?.addEventListener('click', () => this.closeAudioOutput());

        // Input Setup modal
        document.getElementById('inputSetupClose')?.addEventListener('click', () => this.closeInputSetup());
        document.getElementById('inputSetupOverlay')?.addEventListener('click', () => this.closeInputSetup());

        // About modal
        document.getElementById('aboutClose')?.addEventListener('click', () => this.closeAbout());
        document.getElementById('aboutOverlay')?.addEventListener('click', () => this.closeAbout());

        // Input hotkey buttons
        for (let i = 1; i <= 4; i++) {
            document.getElementById(`inputHotkey${i}Btn`)?.addEventListener('click', () => this.selectInputHotkey(i));
        }

        // Pass-through button
        document.getElementById('btnPass')?.addEventListener('click', () => this.togglePassThrough());

        // Input hotkey setup selects
        for (let i = 1; i <= 4; i++) {
            document.getElementById(`inputHotkey${i}`)?.addEventListener('change', (e) => {
                this.inputHotkeys[i] = e.target.value || null;
                console.log(`Hotkey ${i} assigned to device:`, e.target.value);
                this.saveInputPreferences(); // Save to localStorage
            });
        }
    }

    openMenu() {
        document.getElementById('menuOverlay')?.classList.add('active');
        document.getElementById('menuPanel')?.classList.add('active');
    }

    closeMenu() {
        document.getElementById('menuOverlay')?.classList.remove('active');
        document.getElementById('menuPanel')?.classList.remove('active');
    }

    openAudioOutput() {
        this.closeMenu();
        document.getElementById('audioOutputOverlay')?.classList.add('active');
        document.getElementById('audioOutputModal')?.classList.add('active');
    }

    closeAudioOutput() {
        document.getElementById('audioOutputOverlay')?.classList.remove('active');
        document.getElementById('audioOutputModal')?.classList.remove('active');
    }

    openInputSetup() {
        this.closeMenu();
        document.getElementById('inputSetupOverlay')?.classList.add('active');
        document.getElementById('inputSetupModal')?.classList.add('active');
    }

    closeInputSetup() {
        document.getElementById('inputSetupOverlay')?.classList.remove('active');
        document.getElementById('inputSetupModal')?.classList.remove('active');
    }

    openAbout() {
        this.closeMenu();
        document.getElementById('aboutOverlay')?.classList.add('active');
        document.getElementById('aboutModal')?.classList.add('active');
    }

    closeAbout() {
        document.getElementById('aboutOverlay')?.classList.remove('active');
        document.getElementById('aboutModal')?.classList.remove('active');
    }

    async selectInputHotkey(hotkeyNum) {
        // Update UI
        for (let i = 1; i <= 4; i++) {
            const btn = document.getElementById(`inputHotkey${i}Btn`);
            if (btn) {
                if (i === hotkeyNum) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            }
        }

        this.activeInputHotkey = hotkeyNum;
        console.log(`Selected input hotkey: ${hotkeyNum}`);

        // Always enable input when hotkey is selected
        // This ensures microphone permission is requested
        if (!this.inputNode) {
            console.log('[RFXLooper] Requesting microphone access...');
            await this.enableInput();
            console.log('[RFXLooper] Input enabled!');
        } else {
            // Just switch device
            const deviceId = this.inputHotkeys[hotkeyNum];
            if (deviceId) {
                await this.switchInputDevice(deviceId);
            }
        }
    }

    togglePassThrough() {
        this.passThrough = !this.passThrough;

        const btn = document.getElementById('btnPass');
        if (btn) {
            if (this.passThrough) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }

        console.log(`Pass-through: ${this.passThrough ? 'ON' : 'OFF'}`);

        // Send passthrough state to worklet
        if (this.workletNode) {
            this.workletNode.port.postMessage({
                type: 'setPassthrough',
                enabled: this.passThrough
            });
        }
    }

    async switchInputDevice(deviceId) {
        // Stop current stream if any
        if (this.inputStream) {
            this.inputStream.getTracks().forEach(track => track.stop());
            this.inputStream = null;
        }

        if (this.inputNode) {
            this.inputNode.disconnect();
            this.inputNode = null;
        }

        if (!deviceId) return;

        // Get new stream with selected device
        try {
            this.inputStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: { exact: deviceId },
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });

            if (this.audioContext && this.workletNode) {
                this.inputNode = this.audioContext.createMediaStreamSource(this.inputStream);
                this.inputNode.connect(this.workletNode);
                console.log(`Switched to input device: ${deviceId}`);
            }
        } catch (error) {
            console.error('Failed to switch input device:', error);
        }
    }

    async enumerateInputs() {
        try {
            // Request permission to get device labels
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(track => track.stop());
            } catch (permErr) {
                console.warn('Could not get audio permission for device labels:', permErr);
            }

            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(d => d.kind === 'audioinput');
            const audioOutputs = devices.filter(d => d.kind === 'audiooutput');

            this.audioInputDevices = audioInputs;

            // Populate input hotkey setup dropdowns
            for (let i = 1; i <= 4; i++) {
                const select = document.getElementById(`inputHotkey${i}`);
                if (select) {
                    select.innerHTML = '<option value="">None</option>';
                    audioInputs.forEach(device => {
                        const option = document.createElement('option');
                        option.value = device.deviceId;
                        option.textContent = device.label || `Microphone ${device.deviceId.substring(0, 8)}`;
                        select.appendChild(option);
                    });

                    // Restore saved value
                    if (this.inputHotkeys[i]) {
                        select.value = this.inputHotkeys[i];
                    }
                }
            }

            // Populate output device dropdown
            const outputSelect = document.getElementById('outputDeviceList');
            if (outputSelect) {
                outputSelect.innerHTML = '<option value="">Default Output</option>';
                audioOutputs.forEach(device => {
                    const option = document.createElement('option');
                    option.value = device.deviceId;
                    option.textContent = device.label || `Speaker ${device.deviceId.substring(0, 8)}`;
                    outputSelect.appendChild(option);
                });

                outputSelect.addEventListener('change', async () => {
                    const deviceId = outputSelect.value || "";
                    await this.setOutputDevice(deviceId);
                });
            }
        } catch (error) {
            console.error('Failed to enumerate devices:', error);
        }
    }

    async setOutputDevice(deviceId) {
        if (this.audioContext && this.audioContext.setSinkId) {
            try {
                await this.audioContext.setSinkId(deviceId);
                console.log('Output device changed to:', deviceId || 'default');
            } catch (error) {
                console.error('Failed to set output device:', error);
            }
        }
    }

    async initializeAudioWorklet() {
        // Initialize audio context and WASM worklet (no microphone needed)
        try {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                    latencyHint: 'interactive',
                    sampleRate: 48000
                });
                console.log('Audio context created, sample rate:', this.audioContext.sampleRate);

                if (this.audioContext.state === 'suspended') {
                    await this.audioContext.resume();
                    console.log('Audio context resumed');
                }

                // Load WASM and initialize worklet
                await this.loadWASM();
            } else {
                if (this.audioContext.state === 'suspended') {
                    await this.audioContext.resume();
                }
            }
        } catch (error) {
            console.error('Failed to initialize audio worklet:', error);
        }
    }

    async enableInput() {
        try {
            // First ensure worklet is initialized
            await this.initializeAudioWorklet();

            // Get device from active hotkey
            const deviceId = this.activeInputHotkey ? this.inputHotkeys[this.activeInputHotkey] : null;

            // Request microphone access
            const constraints = {
                audio: {
                    deviceId: deviceId ? { exact: deviceId } : undefined,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            };

            // Disconnect existing input if any
            if (this.inputNode) {
                this.inputNode.disconnect();
            }

            this.inputStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.inputNode = this.audioContext.createMediaStreamSource(this.inputStream);

            // Connect input to worklet
            this.inputNode.connect(this.workletNode);

            console.log('Audio input enabled with device:', deviceId || 'default');
        } catch (error) {
            console.error('Failed to enable audio input:', error);
        }
    }

    async loadWASM() {
        console.log('Loading WASM module...');

        // Fetch WASM files
        const [jsResponse, wasmResponse] = await Promise.all([
            fetch('rgloopstation.js'),
            fetch('rgloopstation.wasm')
        ]);

        const jsCode = await jsResponse.text();
        const wasmBytes = await wasmResponse.arrayBuffer();

        // Register AudioWorklet
        await this.audioContext.audioWorklet.addModule('../replugged/worklets/loop-worklet-processor.js');

        // Create worklet node
        this.workletNode = new AudioWorkletNode(this.audioContext, 'loop-worklet-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2]
        });

        // Handle messages from worklet
        this.workletNode.port.onmessage = (e) => {
            this.handleWorkletMessage(e.data);
        };

        // Send WASM to worklet
        this.workletNode.port.postMessage({
            type: 'loadWASM',
            jsCode: jsCode,
            wasmBytes: wasmBytes
        }, [wasmBytes]);

        // Connect to output
        this.workletNode.connect(this.audioContext.destination);

        console.log('WASM loaded and worklet initialized');
    }

    handleWorkletMessage(data) {
        if (data.type === 'ready') {
            console.log('Worklet ready');
            this.workletReady = true;

            // Initialize beat clock for quantized start
            if (this.audioContext) {
                this.beatClockStartTime = this.audioContext.currentTime;
                console.log('[RFXLooper] Beat clock initialized');
            }

            // Set initial gain values (both knobs default to 127 = 100%)
            this.workletNode.port.postMessage({
                type: 'setInputGain',
                gain: 4.0  // 127/127 * 4.0 = 4.0x
            });
            this.workletNode.port.postMessage({
                type: 'setMasterGain',
                gain: 2.0  // 127/127 * 2.0 = 2.0x
            });
            console.log('[RFXLooper] Initial gains: input=4.0x, master=2.0x');

            // Auto-load disabled - localStorage too small for audio tracks
            // Users should use 💾 SAVE and 📂 LOAD buttons for persistence
        } else if (data.type === 'trackState') {
            this.trackStates[data.track] = data.state; // Update local state cache
            this.updateTrackUI(data.track, data.state, data.length, data.level);

            // Update recording progress indicator
            if (data.state === 1 && data.recordPosition) { // TRACK_RECORDING
                this.updateRecordingProgress(data.track, data.recordPosition);
            } else {
                // Reset progress bar when not recording
                const trackEl = document.querySelector(`.track[data-track="${data.track}"]`);
                const progressBar = trackEl?.querySelector('.rec-progress-bar');
                if (progressBar) {
                    progressBar.style.width = '0%';
                }
            }
        } else if (data.type === 'inputLevel') {
            this.updateInputLevelLED(data.level);
        } else if (data.type === 'waveformData') {
            this.drawWaveformData(data.track, data.data);
        } else if (data.type === 'trackData') {
            // Check if this is for export or auto-save
            if (this.exportingTrack === data.track) {
                this.downloadTrackAsWAV(data.track, data.left, data.right, data.length);
                this.exportingTrack = null;
            } else {
                // Auto-save to localStorage
                this.saveTrackToLocalStorage(data.track, data.left, data.right, data.length);
            }
        } else if (data.type === 'exportError') {
            console.error('Export error:', data.error);
        } else if (data.type === 'trackSaved') {
            // Auto-save disabled - tracks are too large for localStorage
            // Users should use the 💾 SAVE button to export WAV files
            console.log(`Track ${data.track} recorded - use 💾 button to save`);
        } else if (data.type === 'trackImported') {
            // Track was imported - update UI to show it
            console.log(`Track ${data.track} imported, length: ${data.length}`);
            // Force waveform refresh
            this.drawWaveform(document.querySelector(`.track-waveform[data-track="${data.track}"]`), data.track, data.length, 0, 3);
        }
    }

    updateInputLevelLED(level) {
        const led = document.getElementById('inputLevelLED');
        if (!led) return;

        // Apply input gain to level (since worklet sends pre-gain level)
        // Input gain is 4.0x at 127, scaled down to actual gain
        const inputGainKnob = document.getElementById('inputGainKnob');
        const gainValue = inputGainKnob ? parseInt(inputGainKnob.getAttribute('value') || 127) : 127;
        const inputGain = (gainValue / 127.0) * 4.0;
        level = level * inputGain;

        // LED glows based on input level - LOWER threshold for better visibility
        // Starts glowing at 0.05, full brightness at 0.5+
        const threshold = 0.05;
        let glow = (level - threshold) / (0.5 - threshold);
        glow = Math.max(0, Math.min(glow, 1)); // Clamp 0-1

        if (glow > 0.01) {
            // Color progression: green (low) -> yellow (mid) -> red (high)
            let r, g, b;
            if (level < 0.5) {
                // Green to yellow
                const t = (level - threshold) / (0.5 - threshold);
                r = Math.round(t * 255);
                g = 255;
                b = 0;
            } else if (level < 0.8) {
                // Yellow to orange
                const t = (level - 0.5) / (0.8 - 0.5);
                r = 255;
                g = Math.round(255 * (1 - t * 0.5));
                b = 0;
            } else {
                // Orange to red
                const t = (level - 0.8) / (1.0 - 0.8);
                r = 255;
                g = Math.round(128 * (1 - t));
                b = 0;
            }

            led.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
            const shadowIntensity = 3 + glow * 8;
            led.style.boxShadow = `
                0 0 ${shadowIntensity}px rgba(${r}, ${g}, ${b}, ${glow * 0.8}),
                inset 0 0 3px rgba(255, 255, 255, ${glow * 0.3})
            `;
        } else {
            // Dark/off state
            led.style.backgroundColor = '#030';
            led.style.boxShadow = 'inset 0 1px 2px rgba(0,0,0,0.5)';
        }
    }

    start() {
        if (!this.workletReady) return;
        if (!this.audioContext) return;

        // Initialize beat clock if not started
        if (this.beatClockStartTime === null) {
            this.beatClockStartTime = this.audioContext.currentTime;
        }

        // Calculate quantized start time (next beat boundary)
        const beatsPerSecond = this.bpm / 60.0;
        const secondsPerBeat = 1.0 / beatsPerSecond;

        const currentTime = this.audioContext.currentTime;
        const elapsedTime = currentTime - this.beatClockStartTime;
        const currentBeat = elapsedTime / secondsPerBeat;
        const nextBeat = Math.ceil(currentBeat);
        const timeToNextBeat = (nextBeat - currentBeat) * secondsPerBeat;

        // Convert to milliseconds for setTimeout
        const delayMs = timeToNextBeat * 1000;

        console.log(`START: Quantizing to next beat in ${delayMs.toFixed(1)}ms`);

        // Schedule start at next beat
        setTimeout(() => {
            console.log('START: Playing all tracks (quantized)');
            // Start playback on all tracks that have audio
            for (let i = 0; i < 6; i++) {
                const state = this.trackStates[i];
                // If track has audio and is not already playing
                if (state === 3 || (state !== 1 && state !== 2 && state !== 0)) {
                    this.workletNode.port.postMessage({
                        type: 'trackPlay',
                        track: i
                    });
                }
            }
        }, delayMs);
    }

    stop() {
        if (!this.workletReady) return;

        console.log('STOP: Stopping all tracks');
        // Stop all tracks
        for (let i = 0; i < 6; i++) {
            this.workletNode.port.postMessage({
                type: 'trackStop',
                track: i
            });
        }
    }

    clearAll() {
        console.log('Clear all clicked');

        // Call WASM reset to clear all tracks AND reset master loop length
        if (this.workletNode) {
            this.workletNode.port.postMessage({ type: 'reset' });
        }

        // Clear UI state for all tracks
        for (let i = 0; i < 6; i++) {
            this.trackStates[i] = 0;
            this.updateTrackUI(i);
        }
    }

    recordTrack(index) {
        const currentState = this.trackStates[index];
        console.log(`REC button track ${index}, current state: ${currentState}`);

        if (currentState === 1) {
            // Currently recording -> STOP recording and start playing
            console.log(`Stopping recording on track ${index}, starting playback`);
            if (!this.workletReady) return;
            this.workletNode.port.postMessage({
                type: 'trackPlay', // This will stop recording and start playing
                track: index
            });
        } else if (currentState === 2 || currentState === 3) {
            // Track has data (PLAYING or STOPPED) - cannot record over it
            console.warn('Cannot record - track has data. Clear the track first!');
            return;
        } else {
            // Empty (state 0) -> START recording
            // MUST have input enabled to record!
            if (!this.inputNode) {
                console.warn('Cannot record - no input enabled. Click an IN button first!');
                return;
            }
            if (!this.workletReady) {
                console.warn('Worklet not ready yet');
                return;
            }

            console.log(`Starting recording on track ${index}`);
            this.workletNode.port.postMessage({
                type: 'trackRecord',
                track: index
            });
        }
    }

    playTrack(index) {
        console.log('Play track', index);
        if (this.workletNode) {
            // Check current state and toggle play/stop
            this.workletNode.port.postMessage({
                type: 'trackTogglePlay',
                track: index
            });
        }
    }

    clearTrack(index) {
        console.log('Clear track', index);
        if (this.workletNode) {
            this.workletNode.port.postMessage({
                type: 'trackClear',
                track: index
            });
        }

        // Reset the clear armed state
        this.clearArmed[index] = false;
        const btn = document.querySelector(`.btn-clear[data-track="${index}"]`);
        if (btn) {
            btn.classList.remove('active');
        }
    }

    setTrackVolume(index, volume) {
        if (this.workletNode) {
            this.workletNode.port.postMessage({
                type: 'setVolume',
                track: index,
                volume: volume
            });
        }
    }

    updateTrackUI(track, state, length, level) {
        const trackEl = document.querySelector(`.track[data-track="${track}"]`);
        const stateEl = trackEl?.querySelector('.track-state');
        const recBtn = trackEl?.querySelector('.btn-rec');
        const playBtn = trackEl?.querySelector('.btn-play');
        const canvas = trackEl?.querySelector('.track-waveform');

        if (trackEl) {
            trackEl.classList.remove('recording', 'playing');

            // Reset button styles
            if (recBtn) {
                recBtn.style.background = '';
                recBtn.style.borderColor = '';
            }
            if (playBtn) {
                playBtn.style.background = '';
                playBtn.style.borderColor = '';
            }

            const stateNames = ['Empty', 'Recording', 'Playing', 'Stopped'];
            const stateName = stateNames[state] || 'Unknown';

            if (state === 1) { // TRACK_RECORDING
                trackEl.classList.add('recording');
                if (recBtn) {
                    recBtn.style.background = '#ff0000';
                    recBtn.style.borderColor = '#ff0000';
                }
            }

            if (state === 2) { // TRACK_PLAYING
                trackEl.classList.add('playing');
                if (playBtn) {
                    playBtn.style.background = '#00ff00';
                    playBtn.style.borderColor = '#00ff00';
                    playBtn.style.color = '#000';
                }
            }

            if (state === 3 && length > 0) { // TRACK_STOPPED with data
                if (playBtn) {
                    playBtn.style.background = '#ff0000';
                    playBtn.style.borderColor = '#ff0000';
                    playBtn.style.color = '#fff';
                }
            }

            if (stateEl) {
                // Show time in seconds
                const seconds = length / 48000; // Assuming 48kHz
                if (length > 0) {
                    stateEl.textContent = `${seconds.toFixed(1)}s`;
                } else {
                    stateEl.textContent = stateName;
                }
            }

            // Draw waveform
            if (canvas) {
                if (length > 0) {
                    this.drawWaveform(canvas, track, length, level, state);
                } else {
                    // Clear waveform for empty track
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        const width = canvas.width = canvas.offsetWidth;
                        const height = canvas.height = canvas.offsetHeight;
                        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                        ctx.fillRect(0, 0, width, height);
                    }
                }
            }
        }
    }

    updateRecordingProgress(track, recordPosition) {
        const trackEl = document.querySelector(`.track[data-track="${track}"]`);
        const progressBar = trackEl?.querySelector('.rec-progress-bar');
        if (!progressBar) return;

        // Calculate expected bar length at current BPM
        const bpm = this.bpm || 120;
        const samplesPerBar = (48000 / (bpm / 60)) * 4; // 4 beats per bar

        // Calculate which bar we're in
        const currentBar = Math.floor(recordPosition / samplesPerBar);
        const positionInBar = recordPosition % samplesPerBar;
        const progressPercent = (positionInBar / samplesPerBar) * 100;

        // Update progress bar width
        progressBar.style.width = `${progressPercent}%`;

        // Change color for each bar (cycle through colors)
        const colors = ['#ff0000', '#ff6600', '#ffcc00', '#00ff00'];
        progressBar.style.background = colors[currentBar % colors.length];
    }

    drawWaveform(canvas, track, length, level, state) {
        if (length === 0) {
            // Clear empty track
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            const width = canvas.width = canvas.offsetWidth;
            const height = canvas.height = canvas.offsetHeight;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.fillRect(0, 0, width, height);
            return;
        }

        // Request actual waveform data from WASM
        if (this.workletNode && this.workletNode.port) {
            const width = canvas.offsetWidth;
            this.workletNode.port.postMessage({
                type: 'getWaveform',
                track: track,
                numPoints: Math.min(Math.floor(width), 512) // Limit to 512 points max
            });
        }
    }

    drawWaveformData(track, waveformData) {
        const trackEl = document.querySelector(`.track[data-track="${track}"]`);
        const canvas = trackEl?.querySelector('.track-waveform');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width = canvas.offsetWidth;
        const height = canvas.height = canvas.offsetHeight;

        // Clear canvas
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, width, height);

        if (!waveformData || waveformData.length === 0) return;

        // Check if all data is zero (empty track)
        const hasData = waveformData.some(v => Math.abs(v) > 0.001);
        if (!hasData) return;

        // Get track state for coloring (only red when recording)
        const state = trackEl.classList.contains('recording') ? 1 : 0;
        const color = (state === 1) ? '#ff0000' : '#CF1A37';

        // Draw waveform
        ctx.strokeStyle = color;
        ctx.fillStyle = color + '80';
        ctx.lineWidth = 1.5;

        ctx.beginPath();
        const centerY = height / 2;

        for (let i = 0; i < waveformData.length; i++) {
            const x = (i / waveformData.length) * width;
            const amplitude = waveformData[i] * height * 0.9; // Use 90% of height

            if (i === 0) {
                ctx.moveTo(x, centerY - amplitude / 2);
            } else {
                ctx.lineTo(x, centerY - amplitude / 2);
            }
        }

        // Draw bottom half (mirror)
        for (let i = waveformData.length - 1; i >= 0; i--) {
            const x = (i / waveformData.length) * width;
            const amplitude = waveformData[i] * height * 0.9;
            ctx.lineTo(x, centerY + amplitude / 2);
        }

        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // TODO: Draw yellow playhead marker when we get play position from WASM
    }

    saveTrackToLocalStorage(track, left, right, length) {
        try {
            const key = `rfxlooper_track_${track}`;
            const data = {
                left: Array.from(left),
                right: Array.from(right),
                length: length,
                timestamp: Date.now()
            };
            localStorage.setItem(key, JSON.stringify(data));
            console.log(`Saved track ${track} to localStorage (${length} samples)`);
        } catch (error) {
            console.error(`Failed to save track ${track} to localStorage:`, error);
            // localStorage might be full - try to clear old data
            if (error.name === 'QuotaExceededError') {
                console.warn('localStorage quota exceeded - tracks may not be saved');
            }
        }
    }

    loadTracksFromLocalStorage() {
        if (!this.workletReady) {
            console.warn('Cannot load from localStorage - worklet not ready');
            return;
        }

        console.log('Loading tracks from localStorage...');
        let loadedCount = 0;

        for (let track = 0; track < 6; track++) {
            const key = `rfxlooper_track_${track}`;
            const saved = localStorage.getItem(key);
            if (saved) {
                try {
                    const data = JSON.parse(saved);
                    console.log(`Loading track ${track} from localStorage (${data.length} samples)`);

                    // Send to WASM worklet
                    this.workletNode.port.postMessage({
                        type: 'importTrack',
                        track: track,
                        left: new Float32Array(data.left),
                        right: new Float32Array(data.right),
                        numSamples: data.length
                    });
                    loadedCount++;
                } catch (error) {
                    console.error(`Failed to load track ${track} from localStorage:`, error);
                }
            }
        }

        if (loadedCount === 0) {
            console.log('No saved tracks found in localStorage');
        } else {
            console.log(`Loaded ${loadedCount} tracks from localStorage`);
        }
    }

    async exportTrack(trackIndex) {
        console.log(`Export track ${trackIndex}`);

        // Initialize audio worklet if not ready (no mic needed for export)
        if (!this.workletReady) {
            await this.initializeAudioWorklet();
        }

        // Mark this as export (not auto-save)
        this.exportingTrack = trackIndex;

        // Request track buffer from WASM via worklet
        this.workletNode.port.postMessage({
            type: 'exportTrack',
            track: trackIndex
        });
    }

    downloadTrackAsWAV(track, leftData, rightData, length) {
        // Create WAV file
        const sampleRate = 48000;
        const numChannels = 2;
        const bitsPerSample = 16;
        const blockAlign = numChannels * bitsPerSample / 8;
        const byteRate = sampleRate * blockAlign;
        const dataSize = length * blockAlign;
        const fileSize = 44 + dataSize;

        const buffer = new ArrayBuffer(fileSize);
        const view = new DataView(buffer);

        // WAV header
        const writeString = (offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        writeString(0, 'RIFF');
        view.setUint32(4, fileSize - 8, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true); // fmt chunk size
        view.setUint16(20, 1, true); // PCM format
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);
        writeString(36, 'data');
        view.setUint32(40, dataSize, true);

        // Write audio data (interleaved, convert float to int16)
        let offset = 44;
        for (let i = 0; i < length; i++) {
            // Left channel
            const sampleL = Math.max(-1, Math.min(1, leftData[i]));
            view.setInt16(offset, sampleL * 0x7FFF, true);
            offset += 2;

            // Right channel
            const sampleR = Math.max(-1, Math.min(1, rightData[i]));
            view.setInt16(offset, sampleR * 0x7FFF, true);
            offset += 2;
        }

        // Create blob and download
        const blob = new Blob([buffer], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `rfxlooper-track${track + 1}.wav`;
        a.click();
        URL.revokeObjectURL(url);

        console.log(`Downloaded track ${track} as WAV`);
    }

    async importTrack(trackIndex) {
        console.log(`Import track ${trackIndex}`);

        // Initialize audio worklet if not ready (no mic needed for import)
        if (!this.workletReady) {
            await this.initializeAudioWorklet();
        }

        // Create file input
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'audio/wav,.wav';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const arrayBuffer = await file.arrayBuffer();
                const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

                const leftChannel = audioBuffer.getChannelData(0);
                const rightChannel = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : audioBuffer.getChannelData(0);

                // Check if audio data is valid
                let hasAudio = false;
                for (let i = 0; i < Math.min(1000, leftChannel.length); i++) {
                    if (Math.abs(leftChannel[i]) > 0.001 || Math.abs(rightChannel[i]) > 0.001) {
                        hasAudio = true;
                        break;
                    }
                }
                console.log(`Import check: ${audioBuffer.length} samples, has audio: ${hasAudio}`);

                // Send to WASM worklet
                this.workletNode.port.postMessage({
                    type: 'importTrack',
                    track: trackIndex,
                    left: leftChannel,
                    right: rightChannel,
                    numSamples: audioBuffer.length
                });

                console.log(`Imported ${audioBuffer.length} samples to track ${trackIndex}`);
            } catch (error) {
                console.error('Failed to import track:', error);
            }
        };
        input.click();
    }

    tapTempo() {
        const now = Date.now();
        this.tapTimes.push(now);

        // Keep only last 4 taps
        if (this.tapTimes.length > 4) {
            this.tapTimes.shift();
        }

        // Need at least 2 taps to calculate BPM
        if (this.tapTimes.length >= 2) {
            // Calculate average interval between taps
            let totalInterval = 0;
            for (let i = 1; i < this.tapTimes.length; i++) {
                totalInterval += this.tapTimes[i] - this.tapTimes[i - 1];
            }
            const avgInterval = totalInterval / (this.tapTimes.length - 1);

            // Convert to BPM (60000ms per minute)
            const bpm = Math.round(60000 / avgInterval);

            // Update BPM (clamp to reasonable range)
            if (bpm >= 60 && bpm <= 200) {
                this.bpm = bpm;
                const bpmInput = document.getElementById('bpmInput');
                if (bpmInput) {
                    bpmInput.value = bpm;
                }

                // Send to worklet
                if (this.workletNode) {
                    this.workletNode.port.postMessage({
                        type: 'setBPM',
                        bpm: bpm
                    });
                }

                console.log(`Tap tempo: ${bpm} BPM (from ${this.tapTimes.length} taps)`);
            }
        }

        // Reset if no tap for 3 seconds
        clearTimeout(this.tapTimeout);
        this.tapTimeout = setTimeout(() => {
            this.tapTimes = [];
        }, 3000);
    }
}

// Initialize when page loads
const looper = new RFXLooper();
looper.init();
