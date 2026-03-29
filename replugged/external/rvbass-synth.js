// RV Bass - Voltakt Bass WASM Monophonic Synthesizer
// Wraps the RV Bass WASM synth in an AudioWorklet

class RVBassSynth {
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.workletNode = null;
        this.masterGain = null;
        this.speakerGain = null;
        this.frequencyAnalyzer = null;
        this.isActive = false;
        this.isAudible = false;

        // Event emitter
        this.listeners = new Map();

        // WASM state
        this.wasmReady = false;
        this.wasmError = null;
        this.pendingNotes = [];
    }

    /**
     * Get parameter metadata (LV2-style descriptor)
     */
    static getParameterInfo() {
        return [
            // VCO Waves (0-2) - not exposed in UI
            { index: 0, name: "VCO1 Wave", type: "enum", group: "VCO", default: 0,
              options: [{value: 0, label: "Sawtooth"}, {value: 0.5, label: "Square"}]
            },
            { index: 1, name: "VCO2 Wave", type: "enum", group: "VCO", default: 0,
              options: [{value: 0, label: "Sawtooth"}, {value: 0.5, label: "Square"}]
            },
            { index: 2, name: "VCO3 Wave", type: "enum", group: "VCO", default: 0,
              options: [{value: 0, label: "Sawtooth"}, {value: 0.5, label: "Square"}]
            },

            // VCO Pitches (3-5) - Range: 0-127 MIDI value (-12 to +12 semitones)
            { index: 3, name: "VCO1 Pitch", type: "float", min: 0, max: 1, default: 0.5, group: "VCO", scale: "normalized" },
            { index: 4, name: "VCO2 Pitch", type: "float", min: 0, max: 1, default: 0.5, group: "VCO", scale: "normalized" },
            { index: 5, name: "VCO3 Pitch", type: "float", min: 0, max: 1, default: 0.5, group: "VCO", scale: "normalized" },

            // VCO Detunes (6-8) - not exposed in UI
            { index: 6, name: "VCO1 Detune", type: "float", min: 0, max: 1, default: 0.5, group: "VCO", scale: "normalized" },
            { index: 7, name: "VCO2 Detune", type: "float", min: 0, max: 1, default: 0.5, group: "VCO", scale: "normalized" },
            { index: 8, name: "VCO3 Detune", type: "float", min: 0, max: 1, default: 0.5, group: "VCO", scale: "normalized" },

            // VCO Levels (9-11) - exposed as ON/MUTE buttons
            { index: 9, name: "VCO1 Level", type: "float", min: 0, max: 1, default: 1.0, group: "VCO", scale: "normalized" },
            { index: 10, name: "VCO2 Level", type: "float", min: 0, max: 1, default: 1.0, group: "VCO", scale: "normalized" },
            { index: 11, name: "VCO3 Level", type: "float", min: 0, max: 1, default: 1.0, group: "VCO", scale: "normalized" },

            // VCO EG (12) - not exposed in UI
            { index: 12, name: "VCO EG Int", type: "float", min: 0, max: 1, default: 0, group: "VCO", scale: "normalized" },

            // VCF (13-15)
            { index: 13, name: "Cutoff", type: "float", min: 0, max: 1, default: 0.31, group: "VCF", scale: "normalized", width: 50, height: 150 },
            { index: 14, name: "Peak (Resonance)", type: "float", min: 0, max: 1, default: 0.71, group: "VCF", scale: "normalized", width: 50, height: 150 },
            { index: 15, name: "Cutoff EG Int", type: "float", min: 0, max: 1, default: 0.39, group: "VCF", scale: "normalized", width: 45 },

            // EG (16-18)
            { index: 16, name: "Attack", type: "float", min: 0, max: 1, default: 0.16, group: "EG", scale: "normalized", width: 40 },
            { index: 17, name: "Decay/Release", type: "float", min: 0, max: 1, default: 0.63, group: "EG", scale: "normalized", width: 40 },
            { index: 18, name: "Sustain", type: "float", min: 0, max: 1, default: 0.71, group: "EG", scale: "normalized", width: 40 },

            // LFO (19-22)
            { index: 19, name: "LFO Wave", type: "enum", group: "LFO", default: 0,
              options: [{value: 0, label: "Triangle"}, {value: 0.5, label: "Square"}, {value: 1, label: "Sawtooth"}]
            },
            { index: 20, name: "LFO Rate", type: "float", min: 0, max: 1, default: 0, group: "LFO", scale: "normalized", width: 45 },
            { index: 21, name: "LFO Pitch Int", type: "float", min: 0, max: 1, default: 0, group: "LFO", scale: "normalized" },
            { index: 22, name: "LFO Cutoff Int", type: "float", min: 0, max: 1, default: 0, group: "LFO", scale: "normalized", width: 40 },
            { index: 23, name: "LFO Amp Int", type: "float", min: 0, max: 1, default: 0, group: "LFO", scale: "normalized" },

            // EG (24-25)
            { index: 24, name: "Sustain ON", type: "boolean", default: false, group: "EG" },
            { index: 25, name: "AMP EG ON", type: "boolean", default: false, group: "EG" },

            // Global (26-27)
            { index: 26, name: "Volume", type: "float", min: 0, max: 1, default: 0.7, group: "Global", scale: "normalized", width: 50, height: 150 },
            { index: 27, name: "Portamento", type: "float", min: 0, max: 1, default: 0, group: "Global", scale: "normalized" },

            // Delay (28-30)
            { index: 28, name: "Delay Enable", type: "boolean", default: false, group: "Delay" },
            { index: 29, name: "Delay Time", type: "float", min: 0, max: 1, default: 0.5, group: "Delay", scale: "normalized" },
            { index: 30, name: "Delay Feedback", type: "float", min: 0, max: 1, default: 0.47, group: "Delay", scale: "normalized" }
        ];
    }

    /**
     * Instance method for parameter info (delegates to static)
     */
    getParameterInfo() {
        return RVBassSynth.getParameterInfo();
    }

    async initialize() {
        try {
            // Frequency analyzer is managed externally
            this.frequencyAnalyzer = null;

            // Master gain
            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = 1.0;

            // Speaker output (can be toggled on/off)
            // Note: Don't auto-connect to destination - let external code route via connect()
            this.speakerGain = this.audioContext.createGain();
            this.speakerGain.gain.value = 1.0; // Default enabled for direct usage

            // Audio graph will be: worklet → masterGain → (external via connect())
            // Or for standalone: worklet → masterGain → speakerGain → destination (set via setAudible)

            // Load and register AudioWorklet processor (only once per AudioContext)
            if (!this.audioContext._synthWorkletLoaded) {
                const workletPath = window.location.pathname.includes('/replugged/') ? 'worklets/' : '../replugged/worklets/';
                await this.audioContext.audioWorklet.addModule(`${workletPath}synth-worklet-processor.js?v=210`);
                this.audioContext._synthWorkletLoaded = true;
            }

            // Create worklet node
            this.workletNode = new AudioWorkletNode(this.audioContext, 'synth-worklet-processor');
            this.workletNode.connect(this.masterGain);

            // Promise to wait for WASM ready or error
            const wasmPromise = new Promise((resolve, reject) => {
                this.wasmReadyResolve = resolve;
                this.wasmReadyReject = reject;
            });

            // Handle worklet messages
            this.workletNode.port.onmessage = (event) => {
                const { type, data } = event.data;

                if (type === 'needWasm') {
                    this.loadWasm();
                } else if (type === 'ready') {
                    this.wasmReady = true;

                    // Process any pending notes
                    for (const note of this.pendingNotes) {
                        if (note.type === 'on') {
                            this.noteOn(note.note, note.velocity);
                        } else {
                            this.noteOff(note.note);
                        }
                    }
                    this.pendingNotes = [];

                    // Resolve the promise
                    if (this.wasmReadyResolve) {
                        this.wasmReadyResolve();
                    }
                } else if (type === 'error') {
                    console.error('[RV Bass] WASM error:', data);
                    this.wasmError = `Synth engine error: ${(data && data.message) || 'Unknown error'}`;

                    // Reject the promise
                    if (this.wasmReadyReject) {
                        this.wasmReadyReject(new Error(this.wasmError));
                    }
                }
            };

            this.isActive = true;


            // Wait for WASM to be ready or fail (with 10 second timeout)
            const timeout = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('WASM load timeout')), 10000)
            );

            await Promise.race([wasmPromise, timeout]);
            return true;
        } catch (error) {
            console.error('[RV Bass] Failed to initialize:', error);
            this.wasmError = error.message;
            return false;
        }
    }

    async loadWasm() {
        try {
            // Determine WASM path: either in /rfxsynths/ or accessing ../rfxsynths/
            const wasmPath = window.location.pathname.includes('/rfxsynths/') ? '' : '../rfxsynths/';

            // Fetch both JS glue code and WASM binary
            const [jsResponse, wasmResponse] = await Promise.all([
                fetch(`${wasmPath}rvbass.js`),
                fetch(`${wasmPath}rvbass.wasm`)
            ]);

            // Check if responses are OK
            if (!jsResponse.ok) {
                throw new Error(`Failed to load rvbass.js: ${jsResponse.status} ${jsResponse.statusText}`);
            }
            if (!wasmResponse.ok) {
                throw new Error(`Failed to load rvbass.wasm: ${wasmResponse.status} ${wasmResponse.statusText}`);
            }

            const jsCode = await jsResponse.text();
            const wasmBytes = await wasmResponse.arrayBuffer();

            // Send to worklet
            this.workletNode.port.postMessage({
                type: 'wasmBytes',
                data: {
                    jsCode: jsCode,
                    wasmBytes: wasmBytes,
                    sampleRate: this.audioContext.sampleRate,
                    moduleName: 'RVBassModule',  // Module export name
                    engineId: 1  // Bass = 1
                }
            });

        } catch (error) {
            console.error('[RV Bass] Failed to load WASM:', error);
            this.wasmError = `Failed to load synth engine: ${error.message}`;

            // Reject the initialization promise
            if (this.wasmReadyReject) {
                this.wasmReadyReject(error);
            }
        }
    }

    noteOn(note, velocity) {
        if (!this.wasmReady) {
            this.pendingNotes.push({ type: 'on', note, velocity });
            return;
        }

        this.workletNode.port.postMessage({
            type: 'noteOn',
            data: { note, velocity }
        });
    }

    noteOff(note) {
        if (!this.wasmReady) {
            this.pendingNotes.push({ type: 'off', note });
            return;
        }

        this.workletNode.port.postMessage({
            type: 'noteOff',
            data: { note }
        });
    }

    handleControlChange(controller, value) {
        if (!this.wasmReady) return;

        this.workletNode.port.postMessage({
            type: 'controlChange',
            data: { controller, value }
        });
    }

    setParameter(index, value) {
        if (!this.wasmReady) return;

        this.workletNode.port.postMessage({
            type: 'setParameter',
            data: { index, value }
        });
    }

    getParameterCount() {
        return 30;  // RV Bass has 30 parameters (no voice mode)
    }

    setMasterGain(value) {
        if (this.masterGain) {
            this.masterGain.gain.value = value;
        }
    }

    setSpeakerOutput(enabled) {
        if (this.speakerGain) {
            this.speakerGain.gain.value = enabled ? 1.0 : 0.0;
            this.isAudible = enabled;
        }
    }

    /**
     * Connect this synth to a destination node (Web Audio API standard)
     */
    connect(destination) {
        if (!this.masterGain) {
            console.warn('[RV Bass] Cannot connect - not initialized');
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

    connectFrequencyAnalyzer(analyzer) {
        this.frequencyAnalyzer = analyzer;
        if (this.masterGain && analyzer) {
            this.masterGain.connect(analyzer.getAnalyser());
        }
    }

    disconnectFrequencyAnalyzer() {
        if (this.frequencyAnalyzer && this.masterGain) {
            this.masterGain.disconnect(this.frequencyAnalyzer.getAnalyser());
        }
        this.frequencyAnalyzer = null;
    }

    async destroy() {

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

        this.isActive = false;
        this.wasmReady = false;
        this.pendingNotes = [];

    }
}

// Make globally available
window.RVBassSynth = RVBassSynth;

// Register synth in registry (auto-discovery)
if (typeof SynthRegistry !== 'undefined') {
    SynthRegistry.register({
        id: 'rvbass',
        name: 'RV Bass',
        displayName: 'Regroove Voltakt Bass',
        description: 'Monophonic bass synthesizer with 3 stacked VCOs, resonant filter, and individual oscillator pitch control',
        engineId: 101,  // Unique engine ID for RV Bass
        class: RVBassSynth,
        wasmFiles: {
            js: 'synths/rvbass.js',
            wasm: 'synths/rvbass.wasm'
        },
        category: 'synthesizer',
        tags: ['monophonic', 'bass', 'analog', 'volca'],
        uiComponent: 'rvbass-ui',
        sequencerComponent: 'motion-sequencer',
        getParameterInfo: RVBassSynth.getParameterInfo
    });
}
