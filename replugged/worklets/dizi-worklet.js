// Dizhi AudioWorklet - receives WASM bytes from main thread

class DizhiProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.module = null;
        this.processBufferPtr = null;
        this.ready = false;
        this.testTone = false; // Test tone disabled - use real synth
        this.phase = 0;
        this.processCount = 0;

        console.log('[DiziWorklet] Constructor called');
        this.port.onmessage = this.handleMessage.bind(this);
        this.port.postMessage({ type: 'needWasm' });
    }

    async handleMessage(event) {
        const { type, data } = event.data;

        if (type === 'wasmData') {
            await this.initWasm(data);
        } else if (!this.ready) {
            return;
        } else if (type === 'noteOn') {
            this.module._regroove_synth_note_on(data.note, data.velocity);
        } else if (type === 'noteOff') {
            this.module._regroove_synth_note_off(data.note);
        } else if (type === 'setMode') {
            this.module._regroove_synth_set_mode(data.value);
        } else if (type === 'setDimoIntensity') {
            this.module._regroove_synth_set_dimo_intensity(data.value);
        } else if (type === 'setDimoFrequency') {
            this.module._regroove_synth_set_dimo_frequency(data.value);
        } else if (type === 'setBrightness') {
            this.module._regroove_synth_set_brightness(data.value);
        } else if (type === 'setDamping') {
            this.module._regroove_synth_set_damping(data.value);
        } else if (type === 'setBreath') {
            this.module._regroove_synth_set_breath(data.value);
        } else if (type === 'setJetGain') {
            this.module._regroove_synth_set_jet_gain(data.value);
        } else if (type === 'setNoiseLevel') {
            this.module._regroove_synth_set_noise_level(data.value);
        } else if (type === 'setJetReflection') {
            this.module._regroove_synth_set_jet_reflection(data.value);
        } else if (type === 'setEndReflection') {
            this.module._regroove_synth_set_end_reflection(data.value);
        } else if (type === 'setFlutter') {
            this.module._regroove_synth_set_flutter(data.rate, data.depth);
        } else if (type === 'setVibrato') {
            this.module._regroove_synth_set_vibrato(data.rate, data.depth);
        } else if (type === 'setPitchBend') {
            this.module._regroove_synth_set_pitch_bend(data.value);
        } else if (type === 'setAttack') {
            this.module._regroove_synth_set_attack(data.value);
        } else if (type === 'setDecay') {
            this.module._regroove_synth_set_decay(data.value);
        } else if (type === 'setSustain') {
            this.module._regroove_synth_set_sustain(data.value);
        } else if (type === 'setRelease') {
            this.module._regroove_synth_set_release(data.value);
        }
    }

    async initWasm(wasmData) {
        try {
            const { jsCode, wasmBytes, sampleRate } = wasmData;

            // Create fake CommonJS environment
            const fakeExports = {};
            const fakeModule = { exports: fakeExports };

            // Inject code to capture wasmMemory
            const modifiedCode = jsCode.replace(
                ';return moduleRtn',
                ';globalThis.__wasmMemory=wasmMemory;return moduleRtn'
            );

            // Eval the Emscripten JS code
            const func = new Function('module', 'exports', modifiedCode);
            func(fakeModule, fakeExports);

            const ModuleFactory = fakeModule.exports;
            if (!ModuleFactory) {
                throw new Error('Failed to get module factory');
            }

            // Instantiate with WASM bytes
            this.module = await ModuleFactory({ wasmBinary: wasmBytes });

            // Capture memory reference
            this.wasmMemory = globalThis.__wasmMemory;
            delete globalThis.__wasmMemory;

            // Check functions exist
            const funcs = ['_regroove_synth_init', '_malloc', '_regroove_synth_process_f32',
                          '_regroove_synth_note_on', '_regroove_synth_note_off'];
            for (const func of funcs) {
                if (!this.module[func]) {
                    throw new Error(`Missing function: ${func}`);
                }
            }

            // Initialize
            this.module._regroove_synth_init(sampleRate);
            this.processBufferPtr = this.module._malloc(128 * 2 * 4);
            this.ready = true;

            this.port.postMessage({ type: 'ready' });
            console.log('[DiziWorklet] Ready, processBufferPtr=', this.processBufferPtr);
        } catch (err) {
            console.error('[DiziWorklet] Init error:', err);
            this.port.postMessage({ type: 'error', error: err.message });
        }
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        if (!output || output.length < 2) return true;

        const numFrames = output[0].length;

        // Test tone for debugging
        if (this.testTone) {
            for (let i = 0; i < numFrames; i++) {
                const sample = Math.sin(this.phase) * 0.3;
                output[0][i] = sample;
                output[1][i] = sample;
                this.phase += (2 * Math.PI * 440) / sampleRate;
            }
            return true;
        }

        if (!this.ready || !this.module || !this.processBufferPtr) return true;

        try {
            // Process
            this.module._regroove_synth_process_f32(this.processBufferPtr, numFrames);

            // Copy from WASM memory using captured memory reference
            const heap = new Float32Array(this.wasmMemory.buffer, this.processBufferPtr, numFrames * 2);

            for (let i = 0; i < numFrames; i++) {
                output[0][i] = heap[i * 2];
                output[1][i] = heap[i * 2 + 1];
            }
        } catch (err) {
            console.error('[DiziWorklet] Process error:', err);
        }

        return true;
    }
}

registerProcessor('dizi-processor', DizhiProcessor);
