// RG1Piano - WASM-based M1 Piano synthesizer with modal synthesis
// Wraps the RG1Piano WASM synth in an AudioWorklet

class RG1PianoSynth {
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
        console.log('[RG1Piano] 🎹 Initializing WASM Piano...');
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
            console.log('[RG1Piano] Audio graph connected: worklet → masterGain → speakerGain → destination');

            // Load and register AudioWorklet processor (reuse synth-worklet, with cache-busting)
            await this.audioContext.audioWorklet.addModule('worklets/synth-worklet-processor.js?v=184');

            // Create worklet node
            this.workletNode = new AudioWorkletNode(this.audioContext, 'synth-worklet-processor');
            this.workletNode.connect(this.masterGain);

            // Handle worklet messages
            this.workletNode.port.onmessage = (event) => {
                const { type, data } = event.data;

                if (type === 'needWasm') {
                    this.loadWasm();
                } else if (type === 'ready') {
                    console.log('[RG1Piano] ✅ WASM Piano ready');
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
                    console.error('[RG1Piano] WASM error:', data);
                }
            };

            this.isActive = true;

            console.log('[RG1Piano] Initialized - waiting for WASM...');
            return true;
        } catch (error) {
            console.error('[RG1Piano] Failed to initialize:', error);
            return false;
        }
    }

    async loadWasm() {
        try {
            console.log('[RG1Piano] Loading WASM...');

            // Fetch both JS glue code and WASM binary
            const [jsResponse, wasmResponse] = await Promise.all([
                fetch('synths/rg1piano.js'),
                fetch('synths/rg1piano.wasm')
            ]);

            const jsCode = await jsResponse.text();
            const wasmBytes = await wasmResponse.arrayBuffer();

            // Send to worklet
            this.workletNode.port.postMessage({
                type: 'wasmBytes',
                data: {
                    jsCode: jsCode,
                    wasmBytes: wasmBytes,
                    engine: 3 // RG1Piano engine ID
                }
            });

            console.log('[RG1Piano] WASM sent to worklet');
        } catch (error) {
            console.error('[RG1Piano] Failed to load WASM:', error);
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
        console.log(`[RG1Piano] Audio ${audible ? 'enabled' : 'muted'}`);
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
        console.log('[RG1Piano] Destroyed');
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
