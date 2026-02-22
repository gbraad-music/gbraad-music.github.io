// Generic AudioWorklet Processor for WASM Synths
// Handles MIDI events and audio generation for RGResonate1, RG1Piano, etc.
// VERSION v171 - Made generic to support multiple WASM engines

class SynthWorkletProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        console.log('[SynthWorklet] ✅ LOADED v180 - Added voice-specific UI updates + detailed logging');
        this.wasmModule = null;
        this.synthPtr = null;
        this.audioBufferPtr = null;
        this.bufferSize = 128; // AudioWorklet quantum size
        this.sampleRate = 48000;

        // WASM function name mappings (will be filled after examining WASM exports)
        this.wasmFuncs = {
            create: null,
            destroy: null,
            note_on: null,
            note_off: null,
            all_notes_off: null,
            process: null,
            reset: null,
            set_parameter_value: null
        };

        this.port.onmessage = this.handleMessage.bind(this);

        // Request WASM bytes from main thread
        this.port.postMessage({ type: 'needWasm' });
    }

    handleMessage(event) {
        const { type, data } = event.data;

        if (type === 'wasmBytes') {
            this.initWasm(data, data.sampleRate || 48000);
        } else if (type === 'noteOn') {
            this.handleNoteOn(data.note, data.velocity);
        } else if (type === 'noteOff') {
            this.handleNoteOff(data.note);
        } else if (type === 'allNotesOff') {
            this.allNotesOff();
        } else if (type === 'setParam') {
            this.setParameter(data.index, data.value);
        } else if (type === 'reset') {
            this.reset();
        } else if (type === 'plist_import') {
            this.importPreset(data.buffer);
        } else if (type === 'plist_export') {
            this.exportPreset(data.presetName || 'MyPreset');
        } else if (type === 'plist_set_speed') {
            this.setPListSpeed(data.speed);
        } else if (type === 'plist_get_state') {
            this.getPListState();
        } else if (type === 'loadWav') {
            this.loadWavFile(data);
        } else if (type === 'getPresetCount') {
            this.getPresetCount();
        } else if (type === 'getPresetName') {
            this.getPresetName(data.index);
        } else if (type === 'loadPreset') {
            this.loadPreset(data.index, data.voice);
        }
    }

    importPreset(buffer) {
        if (!this.wasmModule || !this.synthPtr) {
            console.error('[SynthWorklet] Cannot import preset: WASM not initialized');
            return;
        }

        try {
            // Stop all notes before importing
            this.allNotesOff();

            // Allocate buffer in WASM memory
            const bufferPtr = this.wasmModule._malloc(buffer.length);
            const heapU8 = new Uint8Array(this.wasmMemory.buffer, bufferPtr, buffer.length);
            heapU8.set(buffer);

            // Call C import function (handles all parsing)
            const result = this.wasmModule._regroove_synth_import_preset(this.synthPtr, bufferPtr, buffer.length);

            // Free buffer
            this.wasmModule._free(bufferPtr);

            if (result) {
                console.log('[SynthWorklet] .ahxp preset imported successfully');
                this.port.postMessage({ type: 'preset_imported', data: { success: true } });
            } else {
                console.error('[SynthWorklet] Preset import failed');
                this.port.postMessage({ type: 'preset_imported', data: { success: false } });
            }
        } catch (error) {
            console.error('[SynthWorklet] Import error:', error);
            this.port.postMessage({ type: 'preset_imported', data: { success: false, error: error.message } });
        }
    }

    setPListSpeed(speed) {
        if (!this.wasmModule || !this.synthPtr) {
            console.error('[SynthWorklet] Cannot set PList speed: WASM not initialized');
            return;
        }

        try {
            if (this.wasmModule._regroove_synth_set_plist_speed) {
                this.wasmModule._regroove_synth_set_plist_speed(this.synthPtr, speed);
                console.log(`[SynthWorklet] PList speed set to ${speed}`);
            } else {
                console.error('[SynthWorklet] _regroove_synth_set_plist_speed not available');
            }
        } catch (error) {
            console.error('[SynthWorklet] Error setting PList speed:', error);
        }
    }

    getPListState() {
        if (!this.wasmModule || !this.synthPtr) {
            console.error('[SynthWorklet] Cannot get PList state: WASM not initialized');
            return;
        }

        try {
            const length = this.wasmModule._regroove_synth_get_plist_length(this.synthPtr);
            const speed = this.wasmModule._regroove_synth_get_plist_speed(this.synthPtr);

            // Get all entries
            const entries = [];
            for (let i = 0; i < length; i++) {
                const entryPtr = this.wasmModule._malloc(8); // PList entry struct size
                this.wasmModule._regroove_synth_get_plist_entry(this.synthPtr, i, entryPtr);

                const heapU8 = new Uint8Array(this.wasmMemory.buffer, entryPtr, 8);
                entries.push({
                    note: heapU8[0] | (heapU8[1] << 8),
                    fixed: heapU8[2],
                    waveform: heapU8[3],
                    fx: [heapU8[4], heapU8[5]],
                    fx_param: [heapU8[6], heapU8[7]]
                });

                this.wasmModule._free(entryPtr);
            }

            // Send state to main thread
            this.port.postMessage({
                type: 'plist_state',
                data: { length, speed, entries }
            });
        } catch (error) {
            console.error('[SynthWorklet] Error getting PList state:', error);
        }
    }

    loadWavFile(data) {
        if (!this.wasmModule || !this.synthPtr) {
            console.error('[SynthWorklet] Cannot load WAV: WASM not initialized');
            return;
        }

        try {
            const { pcmData, sampleRate, cuePoints } = data;
            console.log(`[SynthWorklet] Loading WAV: ${pcmData.length} samples, ${cuePoints.length} cue points`);

            // Allocate PCM data in WASM memory
            const pcmPtr = this.wasmModule._malloc(pcmData.length * 2); // Int16 = 2 bytes
            const heapI16 = new Int16Array(this.wasmMemory.buffer, pcmPtr, pcmData.length);
            heapI16.set(pcmData);

            // Call rgslicer_load_wav_from_memory to load the WAV data
            // Function signature: rgslicer_load_wav_from_memory(synth*, pcm_data*, num_samples, sample_rate) -> int
            if (this.wasmModule._rgslicer_load_wav_from_memory) {
                const result = this.wasmModule._rgslicer_load_wav_from_memory(
                    this.synthPtr,
                    pcmPtr,
                    pcmData.length,
                    sampleRate
                );

                if (!result) {
                    console.error('[SynthWorklet] Failed to load sample into RGSlicer');
                    this.wasmModule._free(pcmPtr);
                    return;
                }

                // Prepare CUE positions for slicing
                let cuePtr = 0;
                let numCues = 0;

                if (cuePoints && cuePoints.length > 0) {
                    console.log(`[SynthWorklet] Creating ${cuePoints.length} slices from CUE points`);
                    numCues = cuePoints.length;
                    cuePtr = this.wasmModule._malloc(numCues * 4); // uint32 array
                    const heapU32 = new Uint32Array(this.wasmMemory.buffer, cuePtr, numCues);
                    for (let i = 0; i < numCues; i++) {
                        heapU32[i] = cuePoints[i].position;
                    }
                }

                // Call rgslicer_set_slices_from_cues to create slices
                // This handles both CUE-based slicing and auto-slicing
                if (this.wasmModule._rgslicer_set_slices_from_cues) {
                    const numSlicesCreated = this.wasmModule._rgslicer_set_slices_from_cues(
                        this.synthPtr,
                        cuePtr,
                        numCues
                    );
                    console.log(`[SynthWorklet] Created ${numSlicesCreated} slices`);
                }

                // Free CUE pointer if allocated
                if (cuePtr) {
                    this.wasmModule._free(cuePtr);
                }

                // Get slice info from WASM
                const numSlices = this.wasmModule._rgslicer_get_slice_count
                    ? this.wasmModule._rgslicer_get_slice_count(this.synthPtr)
                    : 0;

                // Get slice details
                const slices = [];
                if (this.wasmModule._rgslicer_get_slice_offset_at && this.wasmModule._rgslicer_get_slice_length_at) {
                    for (let i = 0; i < numSlices; i++) {
                        const offset = this.wasmModule._rgslicer_get_slice_offset_at(this.synthPtr, i);
                        const length = this.wasmModule._rgslicer_get_slice_length_at(this.synthPtr, i);
                        slices.push({
                            offset: offset,
                            length: length,
                            midiNote: 36 + i  // White key mapping starts at C2 (MIDI 36)
                        });
                    }
                }

                console.log(`[SynthWorklet] WAV loaded: ${numSlices} slices`);

                // Send slice info back to main thread
                this.port.postMessage({
                    type: 'sliceInfo',
                    data: {
                        numSlices: numSlices,
                        slices: slices.length > 0 ? slices : null
                    }
                });
            } else {
                console.error('[SynthWorklet] _rgslicer_load_wav_from_memory not found in WASM exports');
            }

            // Free allocated memory
            this.wasmModule._free(pcmPtr);
        } catch (error) {
            console.error('[SynthWorklet] Error loading WAV:', error);
            this.port.postMessage({
                type: 'error',
                data: error.message
            });
        }
    }

    exportPreset(presetName) {
        if (!this.wasmModule || !this.synthPtr) {
            console.error('[SynthWorklet] Cannot export preset: WASM not initialized');
            return;
        }

        try {
            // Allocate size output parameter
            const sizePtr = this.wasmModule._malloc(4);
            const heapU32 = new Uint32Array(this.wasmMemory.buffer, sizePtr, 1);

            // Call C export function (writes preset + PList data to buffer)
            const namePtr = this.wasmModule._malloc(presetName.length + 1);
            const heapU8Name = new Uint8Array(this.wasmMemory.buffer, namePtr, presetName.length + 1);
            for (let i = 0; i < presetName.length; i++) {
                heapU8Name[i] = presetName.charCodeAt(i);
            }
            heapU8Name[presetName.length] = 0;

            const bufferPtr = this.wasmModule._regroove_synth_export_preset(this.synthPtr, namePtr, sizePtr);
            const size = heapU32[0];

            this.wasmModule._free(namePtr);
            this.wasmModule._free(sizePtr);

            if (!bufferPtr || size === 0) {
                console.error('[SynthWorklet] Export failed - no data');
                return;
            }

            // Copy buffer to JavaScript
            const buffer = new Uint8Array(size);
            const heapU8 = new Uint8Array(this.wasmMemory.buffer, bufferPtr, size);
            buffer.set(heapU8);

            // Free C buffer
            this.wasmModule._regroove_synth_free_preset_buffer(bufferPtr);

            console.log(`[SynthWorklet] Exported preset (${size} bytes)`);

            // Send to main thread
            this.port.postMessage({
                type: 'preset_exported',
                data: {
                    name: presetName,
                    buffer: buffer,
                    format: 'binary'
                }
            });
        } catch (error) {
            console.error('[SynthWorklet] Export error:', error);
        }
    }

    async initWasm(wasmData, sampleRate) {
        try {
            console.log('[SynthWorklet] Loading Emscripten module...');
            this.sampleRate = sampleRate;

            const moduleCode = wasmData.jsCode;
            const wasmBytes = wasmData.wasmBytes;
            const engineId = wasmData.engine || 0;

            // Create fake CommonJS environment to capture the module export
            // Emscripten modules end with: if(typeof exports==="object"&&typeof module==="object"){module.exports=...}
            const fakeExports = {};
            const fakeModule = { exports: fakeExports };

            // Inject code to capture wasmMemory and eval in a scope with fake module/exports
            const modifiedCode = moduleCode.replace(
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

            // Call the factory with WASM bytes
            this.wasmModule = await ModuleFactory({
                wasmBinary: wasmBytes
            });

            // Capture the memory reference
            this.wasmMemory = globalThis.__wasmMemory;
            delete globalThis.__wasmMemory;

            console.log('[SynthWorklet] WASM ready');

            // Map function names
            this.mapWasmFunctions();

            // Allocate audio buffer (stereo interleaved)
            this.audioBufferPtr = this.wasmModule._malloc(this.bufferSize * 2 * 4);

            if (!this.audioBufferPtr) {
                throw new Error('_malloc returned null - memory allocation failed');
            }

            console.log(`[SynthWorklet] Buffer: 0x${this.audioBufferPtr.toString(16)}`);

            // Create synth instance (engine ID passed from main thread, sampleRate)
            if (this.wasmFuncs.create) {
                this.synthPtr = this.wasmFuncs.create(engineId, this.sampleRate);
                console.log(`[SynthWorklet] Synth created (engine ${engineId}): 0x${this.synthPtr.toString(16)}`);
            } else {
                throw new Error('regroove_synth_create not found in WASM exports');
            }

            this.port.postMessage({ type: 'ready' });
            console.log('[SynthWorklet] ✅ Ready!');
        } catch (error) {
            console.error('[SynthWorklet] ❌ Failed:', error);
            this.port.postMessage({ type: 'error', error: error.message });
        }
    }

    mapWasmFunctions() {
        // Debug: List available functions
        const exportedFuncs = Object.keys(this.wasmModule).filter(k => k.startsWith('_'));
        console.log('[SynthWorklet] Available exports:', exportedFuncs.slice(0, 20));

        // Map Emscripten Module exports
        this.wasmFuncs.create = this.wasmModule._regroove_synth_create;
        this.wasmFuncs.destroy = this.wasmModule._regroove_synth_destroy;
        this.wasmFuncs.reset = this.wasmModule._regroove_synth_reset;
        this.wasmFuncs.note_on = this.wasmModule._regroove_synth_note_on;
        this.wasmFuncs.note_off = this.wasmModule._regroove_synth_note_off;
        this.wasmFuncs.all_notes_off = this.wasmModule._regroove_synth_all_notes_off;
        this.wasmFuncs.process = this.wasmModule._regroove_synth_process_f32;
        this.wasmFuncs.set_parameter_value = this.wasmModule._regroove_synth_set_parameter;

        console.log('[SynthWorklet] ✓ Mapped synth functions');
    }

    handleNoteOn(note, velocity) {
        if (!this.synthPtr || !this.wasmFuncs.note_on) return;
        this.wasmFuncs.note_on(this.synthPtr, note, velocity);
    }

    handleNoteOff(note) {
        if (!this.synthPtr || !this.wasmFuncs.note_off) return;
        this.wasmFuncs.note_off(this.synthPtr, note);
    }

    allNotesOff() {
        if (!this.synthPtr || !this.wasmFuncs.all_notes_off) return;
        this.wasmFuncs.all_notes_off(this.synthPtr);
    }

    setParameter(index, value) {
        if (!this.synthPtr || !this.wasmFuncs.set_parameter_value) return;
        this.wasmFuncs.set_parameter_value(this.synthPtr, index, value);
    }

    reset() {
        if (!this.synthPtr || !this.wasmFuncs.reset) return;
        this.wasmFuncs.reset(this.synthPtr);
    }

    getPresetCount() {
        if (!this.wasmModule || !this.synthPtr) {
            console.error('[SynthWorklet] Cannot get preset count: WASM not initialized');
            return;
        }

        if (this.wasmModule._regroove_synth_get_preset_count) {
            const count = this.wasmModule._regroove_synth_get_preset_count();
            console.log(`[SynthWorklet] Preset count: ${count}`);
            this.port.postMessage({ type: 'presetCount', count });
        } else {
            console.warn('[SynthWorklet] _regroove_synth_get_preset_count not available');
        }
    }

    getPresetName(index) {
        if (!this.wasmModule || !this.synthPtr) {
            console.error('[SynthWorklet] Cannot get preset name: WASM not initialized');
            return;
        }

        if (this.wasmModule._regroove_synth_get_preset_name) {
            const namePtr = this.wasmModule._regroove_synth_get_preset_name(index);
            if (namePtr) {
                // Read C string from memory (manually decode - TextDecoder not available in AudioWorklet)
                const heapU8 = new Uint8Array(this.wasmMemory.buffer);
                let length = 0;
                while (heapU8[namePtr + length] !== 0 && length < 256) {
                    length++;
                }
                // Manually convert bytes to string (ASCII/UTF-8)
                let name = '';
                for (let i = 0; i < length; i++) {
                    name += String.fromCharCode(heapU8[namePtr + i]);
                }
                console.log(`[SynthWorklet] Preset ${index}: "${name}"`);
                this.port.postMessage({ type: 'presetName', index, name });
            }
        } else {
            console.warn('[SynthWorklet] _regroove_synth_get_preset_name not available');
        }
    }

    loadPreset(index, voice = 0) {
        if (!this.wasmModule || !this.synthPtr) {
            console.error('[SynthWorklet] Cannot load preset: WASM not initialized');
            return;
        }

        if (this.wasmModule._regroove_synth_load_preset) {
            console.log(`[SynthWorklet] ======================================`);
            console.log(`[SynthWorklet] loadPreset() called in worklet`);
            console.log(`[SynthWorklet]   index = ${index} (type: ${typeof index})`);
            console.log(`[SynthWorklet]   voice = ${voice} (type: ${typeof voice})`);
            console.log(`[SynthWorklet]   0=Voice1, 1=Voice2, 2=Voice3`);
            console.log(`[SynthWorklet] Calling WASM: _regroove_synth_load_preset(${this.synthPtr}, ${index}, ${voice})`);
            console.log(`[SynthWorklet] ======================================`);
            this.wasmModule._regroove_synth_load_preset(this.synthPtr, index, voice);

            // Get updated parameters ONLY for the voice that was loaded
            const parameters = [];
            if (this.wasmModule._regroove_synth_get_parameter) {
                // Voice parameter mapping:
                // Voice 1 (0): params 0-7
                // Voice 2 (1): params 8-15
                // Voice 3 (2): params 16-23
                const startParam = voice * 8;
                const endParam = startParam + 8;

                console.log(`[SynthWorklet] Reading back parameters ${startParam}-${endParam-1} for voice ${voice}`);

                // Read all 42 parameters but only log the voice-specific ones
                for (let i = 0; i < 42; i++) {
                    const value = this.wasmModule._regroove_synth_get_parameter(this.synthPtr, i);
                    parameters.push(value);

                    // Log voice-specific parameters for debugging
                    if (i >= startParam && i < endParam) {
                        console.log(`[SynthWorklet]   Param ${i} = ${value}`);
                    }
                }
            }

            this.port.postMessage({ type: 'presetLoaded', index, parameters, voice });
            console.log(`[SynthWorklet] ✅ Preset ${index} loaded to voice ${voice}`);
        } else {
            console.warn('[SynthWorklet] _regroove_synth_load_preset not available');
        }
    }

    process(inputs, outputs, parameters) {
        if (!this.wasmModule || !this.synthPtr || !this.audioBufferPtr || !this.wasmFuncs.process) {
            // Output silence
            return true;
        }

        const output = outputs[0];
        if (!output || output.length === 0) {
            return true;
        }

        const frames = output[0].length;

        // Update heap view (use saved memory reference)
        const heapF32 = new Float32Array(
            this.wasmMemory.buffer,
            this.audioBufferPtr,
            frames * 2
        );

        // Zero the buffer
        heapF32.fill(0);

        // Process audio through synth
        this.wasmFuncs.process(this.synthPtr, this.audioBufferPtr, frames, this.sampleRate);

        // De-interleave output
        const outputL = output[0];
        const outputR = output[1] || output[0];

        for (let i = 0; i < frames; i++) {
            outputL[i] = heapF32[i * 2];
            outputR[i] = heapF32[i * 2 + 1];
        }

        return true;
    }
}

registerProcessor('synth-worklet-processor', SynthWorkletProcessor);
