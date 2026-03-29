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
            // Note: Don't auto-connect to destination - let external code route via connect()
            this.speakerGain = this.audioContext.createGain();
            this.speakerGain.gain.value = 1.0; // Default enabled for direct usage

            // Audio graph will be: worklet → masterGain → (external via connect())

            // Load and register AudioWorklet processor (reuse synth-worklet, with cache-busting)
            if (!this.audioContext._synthWorkletLoaded) {
                await this.audioContext.audioWorklet.addModule(window.location.pathname.includes('/rfxsynths') ? '../replugged/worklets/synth-worklet-processor.js?v=210' : '../replugged/worklets/synth-worklet-processor.js?v=210');
                this.audioContext._synthWorkletLoaded = true;
            }

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
                            this.noteOn(note.note, note.velocity);
                        } else {
                            this.noteOff(note.note);
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

            // Determine WASM path: either in /rfxsynths/ or accessing ../rfxsynths/
            const wasmPath = window.location.pathname.includes('/rfxsynths/') ? '' : '../rfxsynths/';

            // Fetch both JS glue code and WASM binary
            const [jsResponse, wasmResponse] = await Promise.all([
                fetch(`${wasmPath}rg1piano.js`),
                fetch(`${wasmPath}rg1piano.wasm`)
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

    /**
     * Connect this synth to a destination node (Web Audio API standard)
     */
    connect(destination) {
        if (!this.masterGain) {
            console.warn('[RG1Piano] Cannot connect - not initialized');
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

// Register synth in registry (auto-discovery)
if (typeof window !== "undefined" && window.SynthRegistry) {
    window.SynthRegistry.register({
        id: 'rg1piano',
        name: 'RG1Piano',
        displayName: 'RG1Piano - Acoustic Piano',
        description: 'Acoustic piano synthesizer',
        engineId: 3,
        class: RG1PianoSynth,
        wasmFiles: {
            js: 'synths/rg1piano.js',
            wasm: 'synths/rg1piano.wasm'
        },
        category: 'synthesizer',
        getParameterInfo: RG1PianoSynth.getParameterInfo
    });
}
