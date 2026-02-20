// RGSlicer - WASM-based slicing sampler with WAV+CUE support
// Wraps the RGSlicer WASM synth in an AudioWorklet

class RGSlicerSynth {
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
        this.pendingNotes = [];
    }

    async initialize() {
        console.log('[RGSlicer] Initializing WASM Slicer...');
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
            console.log('[RGSlicer] Audio graph connected: worklet → masterGain → speakerGain → destination');

            // Load and register AudioWorklet processor (reuse synth-worklet, with cache-busting)
            await this.audioContext.audioWorklet.addModule('worklets/synth-worklet-processor.js?v=176');

            // Create worklet node
            this.workletNode = new AudioWorkletNode(this.audioContext, 'synth-worklet-processor');
            this.workletNode.connect(this.masterGain);

            // Handle worklet messages
            this.workletNode.port.onmessage = (event) => {
                const { type, data } = event.data;

                if (type === 'needWasm') {
                    this.loadWasm();
                } else if (type === 'ready') {
                    console.log('[RGSlicer] WASM Slicer ready');
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
                } else if (type === 'sliceInfo') {
                    // Emit slice info event
                    this.emit('sliceInfo', data);
                } else if (type === 'error') {
                    console.error('[RGSlicer] WASM error:', data);
                }
            };

            this.isActive = true;

            console.log('[RGSlicer] Initialized - waiting for WASM...');
            return true;
        } catch (error) {
            console.error('[RGSlicer] Failed to initialize:', error);
            return false;
        }
    }

    async loadWasm() {
        try {
            console.log('[RGSlicer] Loading WASM...');

            // Fetch both JS glue code and WASM binary
            const [jsResponse, wasmResponse] = await Promise.all([
                fetch('synths/rgslicer.js'),
                fetch('synths/rgslicer.wasm')
            ]);

            const jsCode = await jsResponse.text();
            const wasmBytes = await wasmResponse.arrayBuffer();

            // Send to worklet
            this.workletNode.port.postMessage({
                type: 'wasmBytes',
                data: {
                    jsCode: jsCode,
                    wasmBytes: wasmBytes,
                    engine: 4 // RGSlicer engine ID
                }
            });

            console.log('[RGSlicer] WASM sent to worklet');
        } catch (error) {
            console.error('[RGSlicer] Failed to load WASM:', error);
        }
    }

    // Load WAV file into slicer
    async loadWavFile(pcmData, sampleRate, cuePoints = []) {
        if (!this.wasmReady) {
            console.error('[RGSlicer] WASM not ready yet');
            return false;
        }

        this.workletNode.port.postMessage({
            type: 'loadWav',
            data: {
                pcmData: pcmData, // Int16Array
                sampleRate: sampleRate,
                cuePoints: cuePoints // Array of {id, position, label}
            }
        });

        return true;
    }

    // Parameter info for synth-ui compatibility
    static getParameterInfo() {
        return [
            { index: 0, name: "Master Volume", min: 0, max: 100, default: 70, group: "Master" },
            { index: 1, name: "Master Pitch", min: 0, max: 100, default: 50, group: "Master" },
            { index: 2, name: "Master Time", min: 0, max: 100, default: 50, group: "Master" },
            { index: 3, name: "Slice Mode", type: "enum", group: "Slicing", default: 0,
              options: [
                {value: 0, label: "Transient"},
                {value: 1, label: "Zero Cross"},
                {value: 2, label: "Grid"},
                {value: 3, label: "BPM"}
              ]},
            { index: 4, name: "Num Slices", min: 1, max: 64, default: 16, group: "Slicing" },
            { index: 5, name: "Sensitivity", min: 0, max: 100, default: 50, group: "Slicing" },
            { index: 6, name: "S0 Pitch", min: 0, max: 100, default: 50, group: "Slice 0" },
            { index: 7, name: "S0 Time", min: 0, max: 100, default: 50, group: "Slice 0" },
            { index: 8, name: "S0 Volume", min: 0, max: 100, default: 50, group: "Slice 0" },
            { index: 9, name: "S0 Pan", min: 0, max: 100, default: 50, group: "Slice 0" },
            { index: 10, name: "S0 Loop", type: "enum", group: "Slice 0", default: 0,
              options: [
                {value: 0, label: "Off"},
                {value: 1, label: "On"}
              ]},
            { index: 11, name: "S0 One-Shot", type: "enum", group: "Slice 0", default: 0,
              options: [
                {value: 0, label: "Off"},
                {value: 1, label: "On"}
              ]},
            { index: 12, name: "BPM", min: 20, max: 300, default: 125, group: "Sequencer", unit: "BPM" }
        ];
    }

    getParameterInfo() {
        return RGSlicerSynth.getParameterInfo();
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

    stopAll() {
        if (this.workletNode) {
            this.workletNode.port.postMessage({ type: 'allNotesOff' });
        }
    }

    async setAudible(audible) {
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        this.isAudible = audible;
        this.speakerGain.gain.setValueAtTime(audible ? 1.0 : 0.0, this.audioContext.currentTime);
        console.log(`[RGSlicer] Audio ${audible ? 'enabled' : 'muted'}`);
    }

    destroy() {
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
        console.log('[RGSlicer] Destroyed');
    }

    // Event emitter methods
    on(eventType, callback) {
        if (!this.listeners.has(eventType)) {
            this.listeners.set(eventType, []);
        }
        this.listeners.get(eventType).push(callback);
    }

    emit(eventType, data) {
        const callbacks = this.listeners.get(eventType);
        if (callbacks) {
            callbacks.forEach(cb => cb(data));
        }
        const allCallbacks = this.listeners.get('*');
        if (allCallbacks) {
            allCallbacks.forEach(cb => cb({ type: eventType, data }));
        }
    }
}

// Register with SynthRegistry
if (typeof SynthRegistry !== 'undefined') {
    SynthRegistry.register({
        id: 'rgslicer',
        name: 'RGSlicer',
        displayName: 'RGSlicer - Slicing Sampler',
        description: 'WAV file slicer with CUE point support and transient detection',
        engineId: 4,
        class: RGSlicerSynth,
        wasmFiles: {
            js: 'synths/rgslicer.js',
            wasm: 'synths/rgslicer.wasm'
        },
        category: 'sampler',
        getParameterInfo: RGSlicerSynth.getParameterInfo
    });
}
