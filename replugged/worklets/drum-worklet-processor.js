// AudioWorklet Processor for WASM Drum Synths (RG909, RG404, RGAHX)
// Handles drum triggers and audio generation

class DrumWorkletProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        console.log('[DrumWorklet] ✅ LOADED - Drum Machine Worklet');
        this.wasmModule = null;
        this.drumPtr = null;
        this.audioBufferPtr = null;
        this.bufferSize = 128; // AudioWorklet quantum size
        this.sampleRate = 48000;

        this.port.onmessage = this.handleMessage.bind(this);

        // Request WASM bytes from main thread
        this.port.postMessage({ type: 'needWasm' });
    }

    handleMessage(event) {
        const { type, data } = event.data;

        if (type === 'wasmBytes') {
            this.initWasm(data, data.sampleRate || 48000);
        } else if (type === 'triggerDrum') {
            this.triggerDrum(data.note, data.velocity);
        } else if (type === 'reset') {
            this.reset();
        }
    }

    async initWasm(wasmData, sampleRate) {
        try {
            console.log('[DrumWorklet] Loading Emscripten module...');
            this.sampleRate = sampleRate;

            const moduleCode = wasmData.jsCode;
            const wasmBytes = wasmData.wasmBytes;

            // Store function names (defaults to RG909 for backward compatibility)
            this.moduleName = wasmData.moduleName || 'RG909Module';
            this.createFunc = wasmData.createFunc || 'rg909_create';
            this.destroyFunc = wasmData.destroyFunc || 'rg909_destroy';
            this.triggerFunc = wasmData.triggerFunc || 'rg909_trigger_drum';
            this.processFunc = wasmData.processFunc || 'rg909_process_f32';

            // Eval the Emscripten loader and capture memory reference
            const modifiedCode = moduleCode.replace(
                ';return moduleRtn',
                ';globalThis.__wasmMemory=wasmMemory;return moduleRtn'
            );

            eval(modifiedCode + `\nthis.DrumModule = ${this.moduleName};`);

            // Call the factory with WASM bytes
            this.wasmModule = await this.DrumModule({
                wasmBinary: wasmBytes
            });

            // Capture the memory reference
            this.wasmMemory = globalThis.__wasmMemory;
            delete globalThis.__wasmMemory;

            console.log('[DrumWorklet] WASM ready');

            // Allocate audio buffer (mono for AHX, stereo for RG909/RG404)
            const channelCount = this.processFunc.includes('f32') ? 2 : 1;
            this.audioBufferPtr = this.wasmModule._malloc(this.bufferSize * channelCount * 4);

            if (!this.audioBufferPtr) {
                throw new Error('_malloc returned null - memory allocation failed');
            }

            console.log(`[DrumWorklet] Buffer: 0x${this.audioBufferPtr.toString(16)}`);

            // Create drum synth instance
            const createFn = this.wasmModule['_' + this.createFunc];
            this.drumPtr = createFn(this.sampleRate);
            console.log(`[DrumWorklet] Drum created: 0x${this.drumPtr.toString(16)}`);

            this.port.postMessage({ type: 'ready' });
            console.log('[DrumWorklet] ✅ Ready!');
        } catch (error) {
            console.error('[DrumWorklet] ❌ Failed:', error);
            this.port.postMessage({ type: 'error', error: error.message });
        }
    }

    triggerDrum(note, velocity) {
        if (!this.drumPtr) return;
        const triggerFn = this.wasmModule['_' + this.triggerFunc];
        if (!triggerFn) return;
        // Convert normalized velocity (0-1) to MIDI velocity (0-127)
        // If velocity > 1.0, assume it's already in MIDI range (0-127)
        const midiVelocity = velocity > 1.0 ? Math.floor(velocity) : Math.floor(velocity * 127);
        // RG909 and RG404 use 4 params, RGAHX uses 3
        if (this.triggerFunc.includes('909') || this.triggerFunc.includes('404')) {
            triggerFn(this.drumPtr, note, midiVelocity, this.sampleRate);
        } else {
            triggerFn(this.drumPtr, note, midiVelocity);
        }
    }

    reset() {
        if (!this.drumPtr) return;
        const resetFn = this.wasmModule['_' + this.destroyFunc];
        if (resetFn) resetFn(this.drumPtr);
    }

    process(inputs, outputs, parameters) {
        const processFn = this.wasmModule ? this.wasmModule['_' + this.processFunc] : null;
        if (!this.wasmModule || !this.drumPtr || !this.audioBufferPtr || !processFn) {
            // Output silence
            return true;
        }

        const output = outputs[0];
        if (!output || output.length === 0) {
            return true;
        }

        const frames = output[0].length;
        const isStereo = this.processFunc.includes('f32');

        // Update heap view (use saved memory reference)
        const heapF32 = new Float32Array(
            this.wasmMemory.buffer,
            this.audioBufferPtr,
            frames * (isStereo ? 2 : 1)
        );

        // Zero the buffer
        heapF32.fill(0);

        // Process audio through drum synth
        // RG909 and RG404 use 4 params (drumPtr, buffer, frames, sampleRate), RGAHX uses 3 (drumPtr, buffer, frames)
        if (this.processFunc.includes('909') || this.processFunc.includes('404')) {
            processFn(this.drumPtr, this.audioBufferPtr, frames, this.sampleRate);
        } else {
            processFn(this.drumPtr, this.audioBufferPtr, frames);
        }

        if (isStereo) {
            // De-interleave stereo output (RG909, RG404)
            const outputL = output[0];
            const outputR = output[1] || output[0];

            for (let i = 0; i < frames; i++) {
                outputL[i] = heapF32[i * 2];
                outputR[i] = heapF32[i * 2 + 1];
            }
        } else {
            // Mono output, duplicate to both channels (RGAHX)
            const outputL = output[0];
            const outputR = output[1] || output[0];

            for (let i = 0; i < frames; i++) {
                outputL[i] = outputR[i] = heapF32[i];
            }
        }

        return true;
    }
}

registerProcessor('drum-worklet-processor', DrumWorkletProcessor);
