/**
 * RGSFZ Synth - JavaScript wrapper for WASM SFZ player
 * Provides easy-to-use API for SFZ sampler in web applications
 */

class RGSFZSynth {
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.workletNode = null;
        this.masterGain = audioContext.createGain();
        this.masterGain.gain.value = 1.0;
        this.isInitialized = false;
        this.wasmReady = false;

        // SFZ data
        this.regions = [];
    }

    async initialize() {
        try {
            console.log('[RGSFZ] Initializing AudioWorklet...');

            // Load and register AudioWorklet processor
            if (!this.audioContext._sfzWorkletLoaded) {
                const workletPath = window.location.pathname.includes('/replugged/') ? 'worklets/' : '../replugged/worklets/';
                await this.audioContext.audioWorklet.addModule(`${workletPath}sfz-worklet-processor.js`);
                this.audioContext._sfzWorkletLoaded = true;
            }

            // Create worklet node
            this.workletNode = new AudioWorkletNode(this.audioContext, 'sfz-worklet-processor');
            this.workletNode.connect(this.masterGain);

            // Handle worklet messages
            this.workletNode.port.onmessage = (event) => {
                const { type, data } = event.data;

                if (type === 'needWasm') {
                    this.loadWasm();
                } else if (type === 'ready') {
                    console.log('[RGSFZ] ✅ WASM SFZ ready');
                    this.wasmReady = true;
                    this.isInitialized = true;
                } else if (type === 'error') {
                    console.error('[RGSFZ] WASM error:', data);
                    this.wasmError = data;
                }
            };

            console.log('[RGSFZ] AudioWorklet initialized - waiting for WASM...');
            return true;
        } catch (error) {
            console.error('[RGSFZ] Initialization error:', error);
            this.wasmError = error.message;
            return false;
        }
    }

    async loadWasm() {
        try {
            console.log('[RGSFZ] Loading WASM...');

            // Fetch both JS glue code and WASM binary
            const wasmPath = window.location.pathname.includes('/rfxsynths/') ? './' : '../../rfxsynths/';
            const [jsResponse, wasmResponse] = await Promise.all([
                fetch(wasmPath + 'rgsfz-player.js'),
                fetch(wasmPath + 'rgsfz-player.wasm')
            ]);

            const jsCode = await jsResponse.text();
            const wasmBytes = await wasmResponse.arrayBuffer();

            // Send to worklet
            this.workletNode.port.postMessage({
                type: 'wasmBytes',
                data: {
                    jsCode: jsCode,
                    wasmBytes: wasmBytes,
                    sampleRate: this.audioContext.sampleRate
                }
            });

            console.log('[RGSFZ] WASM sent to worklet');
        } catch (error) {
            console.error('[RGSFZ] Failed to load WASM:', error);
            this.wasmError = error.message;
        }
    }


    /**
     * Parse SFZ file content
     */
    parseSFZ(sfzText) {
        if (!this.wasmReady) {
            console.warn('[RGSFZ] parseSFZ: WASM not ready');
            return [];
        }

        console.log('[RGSFZ] Passing SFZ content to worklet...');
        this.workletNode.port.postMessage({
            type: 'parseSFZ',
            data: { sfzText }
        });

        // Note: Parsing is async in worklet, regions will be available after processing
        return [];
        }


    noteOn(note, velocity) {
        if (!this.wasmReady) {
            console.warn('[RGSFZ] noteOn: WASM not ready');
            return;
        }
        this.workletNode.port.postMessage({
            type: 'noteOn',
            data: { note, velocity }
        });
    }

    handleNoteOn(note, velocity) {
        return this.noteOn(note, velocity);
    }

    noteOff(note, velocity) {
        if (!this.wasmReady) return;
        this.workletNode.port.postMessage({
            type: 'noteOff',
            data: { note }
        });
    }

    handleNoteOff(note, velocity) {
        return this.noteOff(note, velocity);
    }

    allNotesOff() {
        if (!this.playerPtr) return;
        this.wasmModule._rgsfz_player_all_notes_off(this.playerPtr);
    }

    setParameter(param, value) {
        if (!this.playerPtr) return;

        switch (param) {
            case 'volume':
                this.wasmModule._rgsfz_player_set_volume(this.playerPtr, value);
                break;
            case 'pan':
                this.wasmModule._rgsfz_player_set_pan(this.playerPtr, value);
                break;
            case 'decay':
                this.wasmModule._rgsfz_player_set_decay(this.playerPtr, value);
                break;
        }
    }

    getInfo() {
        if (!this.playerPtr) {
            return { regions: 0, activeVoices: 0 };
        }

        return {
            regions: this.wasmModule._rgsfz_player_get_num_regions(this.playerPtr),
            activeVoices: this.wasmModule._rgsfz_player_get_active_voices(this.playerPtr)
        };
    }

    connect(destination) {
        if (!this.masterGain) {
            console.warn('[RGSFZ] Cannot connect - not initialized');
            return destination;
        }
        return this.masterGain.connect(destination);
    }

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

        this.isInitialized = false;
        this.wasmReady = false;
    }
}

// Export for use in other scripts
window.RGSFZSynth = RGSFZSynth;

// Register synth in registry (auto-discovery)
if (typeof window !== "undefined" && window.SynthRegistry) {
    window.SynthRegistry.register({
        id: 'rgsfz',
        name: 'RGSFZ',
        displayName: 'RGSFZ - SFZ Sampler',
        description: 'SFZ format sampler',
        engineId: 5,
        class: RGSFZSynth,
        wasmFiles: {
            js: 'synths/rgsfz.js',
            wasm: 'synths/rgsfz.wasm'
        },
        category: 'sampler',
        getParameterInfo: () => []
    });
}
