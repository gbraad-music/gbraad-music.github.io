// AudioWorklet Processor for RGSFZ WASM SFZ Player
// Handles SFZ loading and audio generation

class SFZWorkletProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        console.log('[SFZWorklet] ✅ LOADED - SFZ Player');
        this.wasmModule = null;
        this.playerPtr = null;
        this.audioBufferPtr = null;
        this.bufferSize = 128;
        this.sampleRate = 48000;
        this.wasmMemory = null;

        this.port.onmessage = this.handleMessage.bind(this);

        // Request WASM bytes from main thread
        this.port.postMessage({ type: 'needWasm' });
    }

    handleMessage(event) {
        const { type, data } = event.data;

        if (type === 'wasmBytes') {
            this.initWasm(data);
        } else if (type === 'noteOn') {
            this.triggerNote(data.note, data.velocity);
        } else if (type === 'noteOff') {
            this.releaseNote(data.note);
        } else if (type === 'parseSFZ') {
            this.parseSFZ(data.sfzText);
        } else if (type === 'loadSample') {
            this.loadSample(data.region, data.audioData);
        }
    }

    async initWasm(wasmData) {
        try {
            console.log('[SFZWorklet] Loading Emscripten module...');

            const { jsCode, wasmBytes, sampleRate } = wasmData;
            this.sampleRate = sampleRate || 48000;

            // Create fake CommonJS environment to capture the module export
            const fakeExports = {};
            const fakeModule = { exports: fakeExports };

            // Inject code to capture wasmMemory
            const modifiedCode = jsCode.replace(
                ';return moduleRtn',
                ';globalThis.__wasmMemory=wasmMemory;return moduleRtn'
            );

            // Execute in a function scope with module and exports defined
            (function(module, exports) {
                eval(modifiedCode);
            })(fakeModule, fakeExports);

            // Get the module factory from the fake exports
            const ModuleFactory = fakeModule.exports || fakeModule.exports.default;
            if (!ModuleFactory) {
                throw new Error('Failed to capture WASM module factory');
            }

            // Initialize WASM module
            this.wasmModule = await ModuleFactory({ wasmBinary: wasmBytes });
            this.wasmMemory = globalThis.__wasmMemory;
            delete globalThis.__wasmMemory;

            console.log('[SFZWorklet] WASM ready');

            // Create player instance
            this.playerPtr = this.wasmModule._rgsfz_player_create(this.sampleRate);
            if (!this.playerPtr) {
                throw new Error('Failed to create SFZ player');
            }
            console.log(`[SFZWorklet] Player created: 0x${this.playerPtr.toString(16)}`);

            // Allocate audio buffer
            this.audioBufferPtr = this.wasmModule._rgsfz_create_audio_buffer(this.bufferSize * 4); // Allocate larger buffer
            console.log(`[SFZWorklet] Buffer: 0x${this.audioBufferPtr.toString(16)}`);

            console.log('[SFZWorklet] ✅ Ready!');
            this.port.postMessage({ type: 'ready' });

        } catch (error) {
            console.error('[SFZWorklet] ❌ Failed:', error);
            this.port.postMessage({ type: 'error', data: error.message });
        }
    }

    triggerNote(note, velocity) {
        if (!this.wasmModule || !this.playerPtr) return;

        if (this.wasmModule._rgsfz_player_note_on) {
            this.wasmModule._rgsfz_player_note_on(this.playerPtr, note, velocity);
        }
    }

    releaseNote(note) {
        if (!this.wasmModule || !this.playerPtr) return;

        if (this.wasmModule._rgsfz_player_note_off) {
            this.wasmModule._rgsfz_player_note_off(this.playerPtr, note);
        }
    }

    parseSFZ(sfzText) {
        if (!this.wasmModule || !this.playerPtr) return;

        if (this.wasmModule._rgsfz_parse_sfz) {
            // Pass SFZ text to WASM parser
            const strPtr = this.wasmModule._malloc(sfzText.length + 1);
            this.wasmModule.writeStringToMemory(sfzText, strPtr);
            this.wasmModule._rgsfz_parse_sfz(this.playerPtr, strPtr);
            this.wasmModule._free(strPtr);
        }
    }

    loadSample(region, audioData) {
        if (!this.wasmModule || !this.playerPtr) return;

        if (this.wasmModule._rgsfz_load_sample) {
            // Load sample data for a region
            const dataPtr = this.wasmModule._malloc(audioData.length * 4);
            this.wasmModule.HEAPF32.set(audioData, dataPtr / 4);
            this.wasmModule._rgsfz_load_sample(this.playerPtr, region, dataPtr, audioData.length);
            this.wasmModule._free(dataPtr);
        }
    }

    process(inputs, outputs, parameters) {
        if (!this.wasmModule || !this.playerPtr || !this.audioBufferPtr) {
            return true;
        }

        const output = outputs[0];
        if (!output || output.length === 0) {
            return true;
        }

        const frames = output[0].length;

        // Process audio through SFZ player
        if (this.wasmModule._rgsfz_player_process_f32) {
            this.wasmModule._rgsfz_player_process_f32(this.playerPtr, this.audioBufferPtr, frames);
        }

        // Get audio data from WASM memory
        const audioData = new Float32Array(
            this.wasmMemory.buffer,
            this.audioBufferPtr,
            frames * 2
        );

        // De-interleave stereo output
        const outputL = output[0];
        const outputR = output[1] || output[0];

        for (let i = 0; i < frames; i++) {
            outputL[i] = audioData[i * 2];
            outputR[i] = audioData[i * 2 + 1];
        }

        return true;
    }
}

registerProcessor('sfz-worklet-processor', SFZWorkletProcessor);
