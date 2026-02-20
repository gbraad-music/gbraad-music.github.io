// RGAHXDrum - AHX One-Shot WASM Drum Synthesizer
// For AHX-based kick, snare, and other drum sounds

class RGAHXDrum {
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
    }

    async initialize() {
        console.log('[RGAHXDrum] 🥁 Initializing AHX WASM Drum Synth...');
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
            console.log('[RGAHXDrum] Audio graph connected: worklet → masterGain → speakerGain → destination');

            // Load and register AudioWorklet processor (reuse drum worklet)
            await this.audioContext.audioWorklet.addModule('synths/drum-worklet-processor.js');

            // Create worklet node with custom name
            this.workletNode = new AudioWorkletNode(this.audioContext, 'drum-worklet-processor');
            this.workletNode.connect(this.masterGain);

            // Handle worklet messages
            this.workletNode.port.onmessage = (event) => {
                const { type, data } = event.data;

                if (type === 'needWasm') {
                    this.loadWasm();
                } else if (type === 'ready') {
                    console.log('[RGAHXDrum] ✅ AHX WASM Drum Synth ready');
                    this.wasmReady = true;
                } else if (type === 'error') {
                    console.error('[RGAHXDrum] WASM error:', data);
                }
            };

            this.isActive = true;

            console.log('[RGAHXDrum] Initialized - waiting for WASM...');
            return true;
        } catch (error) {
            console.error('[RGAHXDrum] Failed to initialize:', error);
            return false;
        }
    }

    async loadWasm() {
        try {
            console.log('[RGAHXDrum] Loading AHX WASM...');

            // Fetch both JS glue code and WASM binary (cache-busting with timestamp)
            const timestamp = Date.now();
            const [jsResponse, wasmResponse] = await Promise.all([
                fetch(`synths/rgahxdrum.js?t=${timestamp}`),
                fetch(`synths/rgahxdrum.wasm?t=${timestamp}`)
            ]);

            const jsCode = await jsResponse.text();
            const wasmBytes = await wasmResponse.arrayBuffer();

            // Send to worklet with AHX-specific function names
            this.workletNode.port.postMessage({
                type: 'wasmBytes',
                data: {
                    jsCode: jsCode,
                    wasmBytes: wasmBytes,
                    sampleRate: this.audioContext.sampleRate,
                    moduleName: 'RGAHXDrumModule',
                    createFunc: 'rgahxdrum_create',
                    destroyFunc: 'rgahxdrum_destroy',
                    triggerFunc: 'rgahxdrum_trigger',
                    processFunc: 'rgahxdrum_process'
                }
            });

            console.log('[RGAHXDrum] WASM sent to worklet');
        } catch (error) {
            console.error('[RGAHXDrum] Failed to load WASM:', error);
        }
    }

    // Trigger drum hit
    triggerDrum(note, velocity = 127) {
        if (!this.wasmReady || !this.workletNode) return;

        this.workletNode.port.postMessage({
            type: 'triggerDrum',
            data: { note, velocity }
        });
    }

    async setAudible(enabled) {
        if (!this.speakerGain) {
            console.error('[RGAHXDrum] setAudible called but speakerGain is null!');
            return;
        }

        this.isAudible = enabled;
        console.log(`[RGAHXDrum] setAudible(${enabled})`);

        // Resume AudioContext if needed
        if (enabled && this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
                console.log('[RGAHXDrum] AudioContext resumed');
            } catch (error) {
                console.error('[RGAHXDrum] Failed to resume AudioContext:', error);
                return;
            }
        }

        // Smooth fade to avoid clicks
        const currentTime = this.audioContext.currentTime;
        this.speakerGain.gain.cancelScheduledValues(currentTime);
        this.speakerGain.gain.setValueAtTime(this.speakerGain.gain.value, currentTime);
        this.speakerGain.gain.linearRampToValueAtTime(enabled ? 1.0 : 0.0, currentTime + 0.05);

        console.log(`[RGAHXDrum] ${enabled ? 'AUDIBLE' : 'MUTED'}`);
    }

    destroy() {
        console.log('[RGAHXDrum] Destroying...');

        this.isActive = false;

        // Disconnect audio graph
        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode = null;
        }

        if (this.masterGain) {
            this.masterGain.disconnect();
            this.masterGain = null;
        }

        console.log('[RGAHXDrum] Destroyed');
    }

    // Event emitter methods (for InputManager integration)
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
                console.error(`[RGAHXDrum] Error in ${event} listener:`, error);
            }
        }
    }
}
