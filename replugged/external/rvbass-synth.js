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

            // VCO Pitches (3-5)
            { index: 3, name: "VCO1 Pitch", type: "enum", group: "VCO", default: 0.5,
              options: [
                {value: 0.33, label: "-2"},
                {value: 0.42, label: "-1"},
                {value: 0.5, label: "0"},
                {value: 0.58, label: "+1"},
                {value: 0.67, label: "+2"}
              ]
            },
            { index: 4, name: "VCO2 Pitch", type: "enum", group: "VCO", default: 0.5,
              options: [
                {value: 0.33, label: "-2"},
                {value: 0.42, label: "-1"},
                {value: 0.5, label: "0"},
                {value: 0.58, label: "+1"},
                {value: 0.67, label: "+2"}
              ]
            },
            { index: 5, name: "VCO3 Pitch", type: "enum", group: "VCO", default: 0.5,
              options: [
                {value: 0.33, label: "-2"},
                {value: 0.42, label: "-1"},
                {value: 0.5, label: "0"},
                {value: 0.58, label: "+1"},
                {value: 0.67, label: "+2"}
              ]
            },

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

            // LFO (19-23) - only rate and cutoff int exposed
            { index: 19, name: "LFO Wave", type: "enum", group: "LFO", default: 0,
              options: [{value: 0, label: "Triangle"}, {value: 0.5, label: "Square"}, {value: 1, label: "Sawtooth"}]
            },
            { index: 20, name: "LFO Rate", type: "float", min: 0, max: 1, default: 0, group: "LFO", scale: "normalized", width: 45 },
            { index: 21, name: "LFO Pitch Int", type: "float", min: 0, max: 1, default: 0, group: "LFO", scale: "normalized" },
            { index: 22, name: "LFO Cutoff Int", type: "float", min: 0, max: 1, default: 0, group: "LFO", scale: "normalized", width: 40 },
            { index: 23, name: "LFO Sync", type: "boolean", default: true, group: "LFO" },

            // Global (24-26) - no Voice Mode for Bass
            { index: 24, name: "Volume", type: "float", min: 0, max: 1, default: 0.7, group: "Global", scale: "normalized", width: 50, height: 150 },
            { index: 25, name: "Octave", type: "enum", group: "Global", default: 0.3,
              options: [
                {value: 0.1, label: "-2"},
                {value: 0.3, label: "-1"},
                {value: 0.5, label: "0"},
                {value: 0.7, label: "+1"},
                {value: 0.9, label: "+2"}
              ]
            },
            { index: 26, name: "Portamento", type: "float", min: 0, max: 1, default: 0, group: "Global", scale: "normalized" },

            // Delay (27-29)
            { index: 27, name: "Delay Enable", type: "boolean", default: false, group: "Delay" },
            { index: 28, name: "Delay Time", type: "float", min: 0, max: 1, default: 0.5, group: "Delay", scale: "normalized" },
            { index: 29, name: "Delay Feedback", type: "float", min: 0, max: 1, default: 0.47, group: "Delay", scale: "normalized" }
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
            this.speakerGain = this.audioContext.createGain();
            this.speakerGain.gain.value = 0; // Start muted
            this.speakerGain.connect(this.audioContext.destination);

            // Audio graph: worklet → masterGain → speakerGain → destination
            this.masterGain.connect(this.speakerGain);

            // Load and register AudioWorklet processor (only once per AudioContext)
            if (!this.audioContext._synthWorkletLoaded) {
                await this.audioContext.audioWorklet.addModule(
                    window.location.pathname.includes('/synths/')
                        ? '../replugged/worklets/synth-worklet-processor.js?v=203'
                        : 'replugged/worklets/synth-worklet-processor.js?v=203'
                );
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
                            this.handleNoteOn(note.note, note.velocity);
                        } else {
                            this.handleNoteOff(note.note);
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

            // Fetch both JS glue code and WASM binary
            const [jsResponse, wasmResponse] = await Promise.all([
                fetch(`${window.location.pathname.includes('/synths/') ? '' : 'synths/'}rvbass.js`),
                fetch(`${window.location.pathname.includes('/synths/') ? '' : 'synths/'}rvbass.wasm`)
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

    handleNoteOn(note, velocity) {
        if (!this.wasmReady) {
            this.pendingNotes.push({ type: 'on', note, velocity });
            return;
        }

        this.workletNode.port.postMessage({
            type: 'noteOn',
            data: { note, velocity }
        });
    }

    handleNoteOff(note) {
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
        displayName: 'RV Bass - Voltakt Bass',
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
