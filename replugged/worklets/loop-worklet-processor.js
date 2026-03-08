// AudioWorklet Processor for Loop Station
class LoopWorkletProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        this.wasmModule = null;
        this.loopStationPtr = null;
        this.inputBufferPtr = null;
        this.outputBufferPtr = null;
        this.bufferSize = 4096;
        this.sampleRate = globalThis.sampleRate || 48000;

        this.port.onmessage = this.handleMessage.bind(this);

        console.log('[LoopWorklet] Constructor, sample rate:', this.sampleRate);
    }

    async handleMessage(event) {
        const { type, ...data } = event.data;

        if (type === 'loadWASM') {
            await this.loadWASM(data.jsCode, data.wasmBytes);
        } else if (type === 'trackRecord') {
            this.trackRecord(data.track);
        } else if (type === 'trackPlay') {
            this.trackPlay(data.track);
        } else if (type === 'trackTogglePlay') {
            this.trackTogglePlay(data.track);
        } else if (type === 'trackStop') {
            this.trackStop(data.track);
        } else if (type === 'trackClear') {
            this.trackClear(data.track);
        } else if (type === 'setVolume') {
            this.setVolume(data.track, data.volume);
        } else if (type === 'setBPM') {
            this.setBPM(data.bpm);
        } else if (type === 'setInputGain') {
            this.setInputGain(data.gain);
        } else if (type === 'setMasterGain') {
            this.setMasterGain(data.gain);
        } else if (type === 'setPassthrough') {
            this.setPassthrough(data.enabled);
        } else if (type === 'reset') {
            this.reset();
        } else if (type === 'exportTrack') {
            this.exportTrack(data.track);
        } else if (type === 'importTrack') {
            this.importTrack(data.track, data.left, data.right, data.numSamples);
        } else if (type === 'getWaveform') {
            this.getWaveform(data.track, data.numPoints);
        }
    }

    async loadWASM(jsCode, wasmBytes) {
        try {
            console.log('[LoopWorklet] Loading WASM...');

            // Modify Emscripten code to expose wasmMemory
            const modifiedCode = jsCode.replace(
                ';return moduleRtn',
                ';globalThis.__wasmMemory=wasmMemory;return moduleRtn'
            );

            // Evaluate the Emscripten module code
            eval(modifiedCode + '\nthis.LoopStationModule = LoopStationModule;');

            // Initialize the module with WASM binary
            this.wasmModule = await this.LoopStationModule({
                wasmBinary: wasmBytes
            });

            // Capture the memory reference
            this.wasmMemory = globalThis.__wasmMemory;
            delete globalThis.__wasmMemory;

            console.log('[LoopWorklet] WASM module loaded');

            // Create loop station instance
            this.loopStationPtr = this.wasmModule._loop_station_create_wasm(this.sampleRate);

            if (!this.loopStationPtr) {
                throw new Error('Failed to create loop station');
            }

            console.log('[LoopWorklet] Loop station created:', this.loopStationPtr);

            // Allocate I/O buffers
            this.inputBufferPtr = this.wasmModule._malloc(this.bufferSize * 4);
            this.outputBufferPtr = this.wasmModule._malloc(this.bufferSize * 4);

            this.port.postMessage({ type: 'ready' });

        } catch (error) {
            console.error('[LoopWorklet] Failed to load WASM:', error);
            this.port.postMessage({ type: 'error', error: error.message });
        }
    }

    trackRecord(track) {
        if (this.wasmModule && this.loopStationPtr) {
            this.wasmModule._loop_station_track_record_wasm(this.loopStationPtr, track);
            const state = this.wasmModule._loop_station_get_track_state_wasm(this.loopStationPtr, track);
            console.log('[LoopWorklet] Recording track', track, 'state:', state, '(1=recording)');
        }
    }

    trackTogglePlay(track) {
        if (this.wasmModule && this.loopStationPtr) {
            const state = this.wasmModule._loop_station_get_track_state_wasm(this.loopStationPtr, track);

            if (state === 2) { // TRACK_PLAYING
                // Stop it
                this.wasmModule._loop_station_track_stop_wasm(this.loopStationPtr, track);
                console.log('[LoopWorklet] Stopped track', track);
            } else {
                // Play it
                this.wasmModule._loop_station_track_play_wasm(this.loopStationPtr, track);
                const length = this.wasmModule._loop_station_get_track_length_wasm(this.loopStationPtr, track);
                console.log('[LoopWorklet] Playing track', track, 'length:', length, 'samples');
            }
        }
    }

    trackPlay(track) {
        if (this.wasmModule && this.loopStationPtr) {
            const prevState = this.wasmModule._loop_station_get_track_state_wasm(this.loopStationPtr, track);
            this.wasmModule._loop_station_track_play_wasm(this.loopStationPtr, track);
            const length = this.wasmModule._loop_station_get_track_length_wasm(this.loopStationPtr, track);
            const state = this.wasmModule._loop_station_get_track_state_wasm(this.loopStationPtr, track);
            console.log('[LoopWorklet] Playing track', track, 'length:', length, 'samples, state:', state);

            // If we just stopped recording (state was 1, now is 2), trigger auto-save
            if (prevState === 1 && state === 2) {
                this.port.postMessage({ type: 'trackSaved', track: track });
            }
        }
    }

    trackStop(track) {
        if (this.wasmModule && this.loopStationPtr) {
            this.wasmModule._loop_station_track_stop_wasm(this.loopStationPtr, track);
            console.log('[LoopWorklet] Stopping track', track);
        }
    }

    trackClear(track) {
        if (this.wasmModule && this.loopStationPtr) {
            this.wasmModule._loop_station_track_clear_wasm(this.loopStationPtr, track);
            console.log('[LoopWorklet] Clearing track', track);
        }
    }

    setVolume(track, volume) {
        if (this.wasmModule && this.loopStationPtr) {
            this.wasmModule._loop_station_set_track_volume_wasm(this.loopStationPtr, track, volume);
        }
    }

    setBPM(bpm) {
        if (this.wasmModule && this.loopStationPtr) {
            this.wasmModule._loop_station_set_bpm_wasm(this.loopStationPtr, bpm);
        }
    }

    setInputGain(gain) {
        if (this.wasmModule && this.loopStationPtr) {
            this.wasmModule._loop_station_set_input_gain_wasm(this.loopStationPtr, gain);
        }
    }

    setMasterGain(gain) {
        if (this.wasmModule && this.loopStationPtr) {
            this.wasmModule._loop_station_set_master_gain_wasm(this.loopStationPtr, gain);
        }
    }

    setPassthrough(enabled) {
        if (this.wasmModule && this.loopStationPtr) {
            this.wasmModule._loop_station_set_passthrough_wasm(this.loopStationPtr, enabled ? 1 : 0);
        }
    }

    reset() {
        if (this.wasmModule && this.loopStationPtr) {
            this.wasmModule._loop_station_reset_wasm(this.loopStationPtr);
            console.log('[LoopWorklet] Reset - cleared all tracks and master loop length');
        }
    }

    exportTrack(track) {
        if (this.wasmModule && this.loopStationPtr && this.wasmMemory) {
            const length = this.wasmModule._loop_station_get_track_length_wasm(this.loopStationPtr, track);
            if (length === 0) {
                this.port.postMessage({ type: 'exportError', error: 'Track is empty' });
                return;
            }

            // Allocate buffers
            const leftPtr = this.wasmModule._malloc(length * 4);
            const rightPtr = this.wasmModule._malloc(length * 4);

            // Get track data
            this.wasmModule._loop_station_get_track_buffer_wasm(this.loopStationPtr, track, leftPtr, rightPtr, length);

            // Read from WASM memory
            const leftData = new Float32Array(this.wasmMemory.buffer, leftPtr, length);
            const rightData = new Float32Array(this.wasmMemory.buffer, rightPtr, length);

            // Copy to regular arrays
            const leftArray = Array.from(leftData);
            const rightArray = Array.from(rightData);

            // Free buffers
            this.wasmModule._free(leftPtr);
            this.wasmModule._free(rightPtr);

            // Send to main thread
            this.port.postMessage({
                type: 'trackData',
                track: track,
                left: leftArray,
                right: rightArray,
                length: length
            });
        }
    }

    importTrack(track, left, right, numSamples) {
        if (this.wasmModule && this.loopStationPtr && this.wasmMemory) {
            // Allocate buffers
            const leftPtr = this.wasmModule._malloc(numSamples * 4);
            const rightPtr = this.wasmModule._malloc(numSamples * 4);

            // Write to WASM memory
            const leftView = new Float32Array(this.wasmMemory.buffer, leftPtr, numSamples);
            const rightView = new Float32Array(this.wasmMemory.buffer, rightPtr, numSamples);
            leftView.set(left);
            rightView.set(right);

            // Set track buffer (this will trim and quantize)
            this.wasmModule._loop_station_set_track_buffer_wasm(this.loopStationPtr, track, leftPtr, rightPtr, numSamples);

            // Get the actual length after quantization
            const finalLength = this.wasmModule._loop_station_get_track_length_wasm(this.loopStationPtr, track);

            // Free buffers
            this.wasmModule._free(leftPtr);
            this.wasmModule._free(rightPtr);

            console.log(`[LoopWorklet] Imported ${numSamples} samples to track ${track}, final length: ${finalLength}`);

            // Notify main thread to update UI
            this.port.postMessage({
                type: 'trackImported',
                track: track,
                length: finalLength
            });
        }
    }

    getWaveform(track, numPoints) {
        if (this.wasmModule && this.loopStationPtr && this.wasmMemory) {
            // Check if function exists (requires rebuilt WASM)
            if (typeof this.wasmModule._loop_station_get_track_waveform_wasm !== 'function') {
                // Function not available - send empty waveform
                const emptyData = new Array(numPoints).fill(0);
                this.port.postMessage({
                    type: 'waveformData',
                    track: track,
                    data: emptyData
                });
                return;
            }

            // Allocate buffer for waveform data
            const waveformPtr = this.wasmModule._malloc(numPoints * 4);

            // Get waveform data from WASM
            this.wasmModule._loop_station_get_track_waveform_wasm(
                this.loopStationPtr,
                track,
                waveformPtr,
                numPoints
            );

            // Read the data from WASM memory
            const waveformData = new Float32Array(
                this.wasmMemory.buffer,
                waveformPtr,
                numPoints
            );

            // Copy to a regular array (so it survives after we free the buffer)
            const dataArray = Array.from(waveformData);

            // Free WASM buffer
            this.wasmModule._free(waveformPtr);

            // Send to main thread
            this.port.postMessage({
                type: 'waveformData',
                track: track,
                data: dataArray
            });
        }
    }

    process(inputs, outputs, parameters) {
        if (!this.wasmModule || !this.loopStationPtr) {
            return true;
        }

        const input = inputs[0];
        const output = outputs[0];

        if (!input || !output || input.length === 0 || output.length === 0) {
            return true;
        }

        const frames = input[0].length;

        // Debug logging disabled - causes MIDI lag

        // Get input channels (stereo)
        const inputL = input[0] || new Float32Array(frames);
        const inputR = input[1] || input[0] || new Float32Array(frames);

        // Get WASM heap views
        const heapInput = new Float32Array(
            this.wasmMemory.buffer,
            this.inputBufferPtr,
            frames * 2
        );

        const heapOutput = new Float32Array(
            this.wasmMemory.buffer,
            this.outputBufferPtr,
            frames * 2
        );

        // Copy input to WASM memory (separate L/R buffers)
        for (let i = 0; i < frames; i++) {
            heapInput[i] = inputL[i];
            heapInput[frames + i] = inputR[i];
        }

        // Process through loop station
        this.wasmModule._loop_station_process_wasm(
            this.loopStationPtr,
            this.inputBufferPtr,                    // input_left
            this.inputBufferPtr + (frames * 4),     // input_right
            this.outputBufferPtr,                   // output_left
            this.outputBufferPtr + (frames * 4),    // output_right
            frames
        );

        // Copy output from WASM memory
        const outputL = output[0];
        const outputR = output[1] || output[0];

        for (let i = 0; i < frames; i++) {
            outputL[i] = heapOutput[i];
            outputR[i] = heapOutput[frames + i];
        }

        // Send track states to UI periodically
        if (this.frameCounter === undefined) {
            this.frameCounter = 0;
        }

        this.frameCounter += frames;
        if (this.frameCounter >= 4800) { // ~100ms at 48kHz
            this.frameCounter = 0;

            // Get state for each track
            for (let t = 0; t < 6; t++) {
                const state = this.wasmModule._loop_station_get_track_state_wasm(this.loopStationPtr, t);
                const length = this.wasmModule._loop_station_get_track_length_wasm(this.loopStationPtr, t);
                const level = this.wasmModule._loop_station_get_track_level_wasm(this.loopStationPtr, t);
                const recordPosition = this.wasmModule._loop_station_get_track_record_position_wasm(this.loopStationPtr, t);

                this.port.postMessage({
                    type: 'trackState',
                    track: t,
                    state: state,
                    length: length,
                    level: level,
                    recordPosition: recordPosition
                });
            }

            // Send input level for LED indicator
            let inputLevel = 0;
            for (let i = 0; i < Math.min(frames, 128); i++) {
                const l = Math.abs(inputL[i]);
                const r = Math.abs(inputR[i]);
                inputLevel = Math.max(inputLevel, l, r);
            }
            this.port.postMessage({
                type: 'inputLevel',
                level: inputLevel
            });
        }

        return true;
    }
}

registerProcessor('loop-worklet-processor', LoopWorkletProcessor);
