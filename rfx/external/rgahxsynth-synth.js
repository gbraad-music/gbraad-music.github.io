// RGAHXSynth - WASM-based AHX synthesizer for Regroove visualization
// Wraps the RGAHX WASM synth in an AudioWorklet

class RGAHXSynth {
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.workletNode = null;
        this.masterGain = null;
        this.speakerGain = null;
        this.frequencyAnalyzer = null;
        this.isActive = false;
        this.isAudible = false;

        // Event emitter (for InputManager integration)
        this.listeners = new Map();

        // WASM state
        this.wasmReady = false;
        this.pendingNotes = [];
    }

    /**
     * Get parameter metadata (LV2-style descriptor)
     */
    static getParameterInfo() {
        return [
            // Oscillator (0-2)
            { index: 0, name: "Waveform", type: "enum", group: "Oscillator", default: 1,
              options: [
                {value: 0, label: "Triangle"},
                {value: 1, label: "Sawtooth"},
                {value: 2, label: "Square"},
                {value: 3, label: "Noise"}
              ]
            },
            { index: 1, name: "Wave Len", type: "int", min: 0, max: 5, default: 4, group: "Oscillator", width: 40 },
            { index: 2, name: "Volume", type: "int", min: 0, max: 64, default: 64, group: "Oscillator", width: 40 },

            // Envelope (3-9)
            { index: 3, name: "A Time", type: "int", min: 0, max: 255, default: 1, group: "Envelope", width: 35, height: 150 },
            { index: 4, name: "A Vol", type: "int", min: 0, max: 64, default: 64, group: "Envelope", width: 35, height: 150 },
            { index: 5, name: "D Time", type: "int", min: 0, max: 255, default: 20, group: "Envelope", width: 35, height: 150 },
            { index: 6, name: "D Vol", type: "int", min: 0, max: 64, default: 48, group: "Envelope", width: 35, height: 150 },
            { index: 7, name: "S Time", type: "int", min: 0, max: 255, default: 0, group: "Envelope", width: 35, height: 150, format: "sustain" },
            { index: 8, name: "R Time", type: "int", min: 0, max: 255, default: 30, group: "Envelope", width: 35, height: 150 },
            { index: 9, name: "R Vol", type: "int", min: 0, max: 64, default: 0, group: "Envelope", width: 35, height: 150 },

            // Filter (10-13)
            { index: 10, name: "Lower", type: "int", min: 0, max: 63, default: 1, group: "Filter", width: 40 },
            { index: 11, name: "Upper", type: "int", min: 0, max: 63, default: 63, group: "Filter", width: 40 },
            { index: 12, name: "Speed", type: "int", min: 0, max: 63, default: 0, group: "Filter", width: 40 },
            { index: 13, name: "Enable", type: "boolean", default: false, group: "Filter" },

            // PWM / Square (14-17)
            { index: 14, name: "Lower", type: "int", min: 0, max: 63, default: 1, group: "PWM", width: 40 },
            { index: 15, name: "Upper", type: "int", min: 0, max: 63, default: 63, group: "PWM", width: 40 },
            { index: 16, name: "Speed", type: "int", min: 0, max: 63, default: 0, group: "PWM", width: 40 },
            { index: 17, name: "Enable", type: "boolean", default: false, group: "PWM" },

            // Vibrato (18-20)
            { index: 18, name: "Delay", type: "int", min: 0, max: 255, default: 0, group: "Vibrato", width: 40 },
            { index: 19, name: "Depth", type: "int", min: 0, max: 255, default: 0, group: "Vibrato", width: 40 },
            { index: 20, name: "Speed", type: "int", min: 0, max: 255, default: 0, group: "Vibrato", width: 40 },

            // Hard Cut Release (21-22)
            { index: 21, name: "Enable", type: "boolean", default: false, group: "Hard Cut Release" },
            { index: 22, name: "Frames", type: "int", min: 0, max: 255, default: 0, group: "Hard Cut Release", width: 40 }
        ];
    }

    /**
     * Instance method for parameter info (delegates to static)
     */
    getParameterInfo() {
        return RGAHXSynth.getParameterInfo();
    }

    async initialize() {
        console.log('[RGAHXSynth] 🎛️ Initializing WASM AHX Synth...');
        try {
            // Frequency analyzer is now managed externally (shared MIDI analyzer in app.js)
            this.frequencyAnalyzer = null;

            // Master gain
            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = 1.0;

            // Speaker output (can be toggled on/off)
            this.speakerGain = this.audioContext.createGain();
            this.speakerGain.gain.value = 0; // Start muted
            this.speakerGain.connect(this.audioContext.destination);

            // Audio graph: worklet → masterGain → speakerGain → destination
            this.masterGain.connect(this.speakerGain);
            console.log('[RGAHXSynth] Audio graph connected: worklet → masterGain → speakerGain → destination');

            // Load and register AudioWorklet processor (with cache-busting)
            await this.audioContext.audioWorklet.addModule('worklets/synth-worklet-processor.js?v=242');

            // Create worklet node
            this.workletNode = new AudioWorkletNode(this.audioContext, 'synth-worklet-processor');
            this.workletNode.connect(this.masterGain);

            // Handle worklet messages
            this.workletNode.port.onmessage = (event) => {
                const { type, data } = event.data;

                if (type === 'needWasm') {
                    this.loadWasm();
                } else if (type === 'ready') {
                    console.log('[RGAHXSynth] ✅ WASM AHX Synth ready');
                    this.wasmReady = true;

                    // Process any pending notes
                    for (const note of this.pendingNotes) {
                        if (note.type === 'on') {
                            this.handleNoteOn(note.note, note.velocity);
                        } else {
                            this.handleNoteOff(note.note);
                        }
                    }
                    this.pendingNotes = [];
                } else if (type === 'error') {
                    console.error('[RGAHXSynth] WASM error:', data);
                } else if (type === 'plist_state') {
                    // Forward PList state to UI
                    this.handlePListStateUpdate(data);
                } else if (type === 'preset_exported') {
                    // Handle preset export
                    this.handlePresetExport(data);
                } else if (type === 'preset_imported') {
                    // Handle preset import result
                    const event = new CustomEvent('preset_imported', { detail: data });
                    window.dispatchEvent(event);
                }
            };

            this.isActive = true;

            console.log('[RGAHXSynth] Initialized - waiting for WASM...');
            return true;
        } catch (error) {
            console.error('[RGAHXSynth] Failed to initialize:', error);
            return false;
        }
    }

    async loadWasm() {
        try {
            console.log('[RGAHXSynth] Loading WASM...');

            // Fetch both JS glue code and WASM binary
            const [jsResponse, wasmResponse] = await Promise.all([
                fetch('synths/rgahxsynth.js?v=242'),
                fetch('synths/rgahxsynth.wasm?v=242')
            ]);

            const jsCode = await jsResponse.text();
            const wasmBytes = await wasmResponse.arrayBuffer();

            // Send to worklet
            this.workletNode.port.postMessage({
                type: 'wasmBytes',
                data: {
                    jsCode: jsCode,
                    wasmBytes: wasmBytes,
                    sampleRate: this.audioContext.sampleRate,
                    engine: 1 // RGAHX engine ID
                }
            });

            console.log('[RGAHXSynth] WASM sent to worklet');
        } catch (error) {
            console.error('[RGAHXSynth] Failed to load WASM:', error);
        }
    }

    handleNoteOn(note, velocity) {
        if (!this.isActive) return;

        if (!this.wasmReady) {
            // Queue note for later
            this.pendingNotes.push({ type: 'on', note, velocity });
            return;
        }

        // Send to worklet
        this.workletNode.port.postMessage({
            type: 'noteOn',
            data: { note, velocity }
        });
    }

    handleNoteOff(note) {
        if (!this.isActive) return;

        if (!this.wasmReady) {
            // Queue note for later
            this.pendingNotes.push({ type: 'off', note });
            return;
        }

        // Send to worklet
        this.workletNode.port.postMessage({
            type: 'noteOff',
            data: { note }
        });
    }

    setupBeatSynth() {
        // Simple beat oscillator (could use RG909 later)
        this.beatOscillator = this.audioContext.createOscillator();
        this.beatOscillator.type = 'sine';
        this.beatOscillator.frequency.value = 60; // Deep bass

        this.beatGain = this.audioContext.createGain();
        this.beatGain.gain.value = 0;

        this.beatOscillator.connect(this.beatGain);
        this.beatGain.connect(this.masterGain);

        this.beatOscillatorStopped = false;

        try {
            this.beatOscillator.start();
            console.log('[RGAHXSynth] Beat oscillator started');
        } catch (e) {
            console.warn('[RGAHXSynth] Beat oscillator failed to start:', e.message);
            this.beatOscillatorStopped = true;
        }
    }

    handleBeat(intensity = 1.0) {
        if (!this.beatGain || this.beatOscillatorStopped) return;

        const now = this.audioContext.currentTime;
        this.beatGain.gain.cancelScheduledValues(now);
        this.beatGain.gain.setValueAtTime(0, now);
        this.beatGain.gain.linearRampToValueAtTime(intensity * 0.8, now + 0.01);
        this.beatGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        this.beatGain.gain.linearRampToValueAtTime(0, now + 0.31);
    }

    stopAll() {
        if (!this.wasmReady || !this.workletNode) return;

        this.workletNode.port.postMessage({
            type: 'allNotesOff'
        });
    }

    /**
     * Set parameter by index (for auto-generated UI)
     * Maps index to named parameter for worklet
     */
    setParameter(index, value) {
        if (!this.isActive || !this.wasmReady || !this.workletNode) return;

        // Map index to parameter name
        const paramMap = {
            0: 'waveform', 1: 'wave_length', 2: 'osc_volume',
            3: 'attack_frames', 4: 'attack_volume', 5: 'decay_frames',
            6: 'decay_volume', 7: 'sustain_frames', 8: 'release_frames',
            9: 'release_volume', 10: 'filter_lower', 11: 'filter_upper',
            12: 'filter_speed', 13: 'filter_enable', 14: 'square_lower',
            15: 'square_upper', 16: 'square_speed', 17: 'square_enable',
            18: 'vibrato_delay', 19: 'vibrato_depth', 20: 'vibrato_speed',
            21: 'hard_cut_release', 22: 'hard_cut_frames'
        };

        const param = paramMap[index];
        if (!param) {
            console.warn(`[RGAHXSynth] Unknown parameter index: ${index}`);
            return;
        }

        // Send to worklet
        this.workletNode.port.postMessage({
            type: 'setParam',
            data: { param, value }
        });
    }

    /**
     * Connect this synth to a destination node (Web Audio API standard)
     */
    connect(destination) {
        if (!this.masterGain) {
            console.warn('[RGAHXSynth] Cannot connect - not initialized');
            return destination;
        }
        return this.masterGain.connect(destination);
    }

    /**
     * Disconnect this synth from all destinations
     */
    disconnect() {
        if (this.masterGain) {
            this.masterGain.disconnect();
        }
    }

    /**
     * Get analyser node for visualization
     */
    getAnalyser() {
        return this.frequencyAnalyzer ? this.frequencyAnalyzer.getAnalyser() : null;
    }

    async setAudible(enabled) {
        if (!this.speakerGain) {
            console.error('[RGAHXSynth] ❌ setAudible called but speakerGain is null!');
            return;
        }

        this.isAudible = enabled;
        console.log(`[RGAHXSynth] setAudible(${enabled})`);

        // Resume AudioContext if needed
        if (enabled && this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
                console.log('[RGAHXSynth] AudioContext resumed');
            } catch (error) {
                console.error('[RGAHXSynth] Failed to resume AudioContext:', error);
                return;
            }
        }

        // Smooth fade to avoid clicks
        const currentTime = this.audioContext.currentTime;
        this.speakerGain.gain.cancelScheduledValues(currentTime);
        this.speakerGain.gain.setValueAtTime(this.speakerGain.gain.value, currentTime);
        this.speakerGain.gain.linearRampToValueAtTime(enabled ? 1.0 : 0.0, currentTime + 0.05);

        console.log(`[RGAHXSynth] ✅ ${enabled ? 'AUDIBLE' : 'MUTED'}`);
    }

    /**
     * Handle PList state update from worklet
     */
    handlePListStateUpdate(data) {
        // Dispatch custom event that the UI can listen to
        const event = new CustomEvent('plist_state', { detail: data });
        window.dispatchEvent(event);
    }

    /**
     * Handle preset export from worklet
     */
    handlePresetExport(data) {
        const { name, buffer, text, format } = data;

        if (format === 'binary' && buffer) {
            // Download binary .ahxp file
            const blob = new Blob([buffer], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${name}.ahxp`;
            a.click();
            URL.revokeObjectURL(url);
            console.log(`[RGAHXSynth] Exported binary preset: ${name}.ahxp`);
        } else if (format === 'text' && text) {
            // Download text file
            const blob = new Blob([text], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${name}.txt`;
            a.click();
            URL.revokeObjectURL(url);
            console.log(`[RGAHXSynth] Exported text preset: ${name}.txt`);
        }
    }

    destroy() {
        console.log('[RGAHXSynth] Destroying...');

        this.isActive = false;

        // Stop all notes
        this.stopAll();

        // Destroy frequency analyzer
        if (this.frequencyAnalyzer) {
            this.frequencyAnalyzer.destroy();
            this.frequencyAnalyzer = null;
        }

        // Disconnect audio graph
        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode = null;
        }

        if (this.masterGain) {
            this.masterGain.disconnect();
            this.masterGain = null;
        }

        if (this.speakerGain) {
            this.speakerGain.disconnect();
            this.speakerGain = null;
        }

        // Clear event listeners
        this.listeners.clear();

        console.log('[RGAHXSynth] Destroyed');
    }

    // Event emitter interface
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }

    off(event, callback) {
        if (!this.listeners.has(event)) return;
        const callbacks = this.listeners.get(event);
        const index = callbacks.indexOf(callback);
        if (index > -1) {
            callbacks.splice(index, 1);
        }
    }

    emit(event, data) {
        if (!this.listeners.has(event)) return;
        const callbacks = this.listeners.get(event);
        for (const callback of callbacks) {
            try {
                callback(data);
            } catch (error) {
                console.error(`[RGAHXSynth] Error in ${event} listener:`, error);
            }
        }
    }
}

// Register synth in registry (auto-discovery)
if (typeof SynthRegistry !== 'undefined') {
    SynthRegistry.register({
        id: 'rgahx',
        name: 'RGAHX',
        displayName: 'RGAHX - Amiga AHX/HivelyTracker',
        description: 'Authentic Amiga AHX synthesizer with waveform generation',
        engineId: 1,
        class: RGAHXSynth,
        wasmFiles: {
            js: 'synths/rgahxsynth.js',
            wasm: 'synths/rgahxsynth.wasm'
        },
        category: 'synthesizer',
        getParameterInfo: RGAHXSynth.getParameterInfo
    });
}
