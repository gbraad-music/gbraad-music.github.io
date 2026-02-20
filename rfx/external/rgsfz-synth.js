/**
 * RGSFZ Synth - JavaScript wrapper for WASM SFZ player
 * Provides easy-to-use API for SFZ sampler in web applications
 */

class RGSFZSynth {
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.wasmModule = null;
        this.playerPtr = null;
        this.audioBufferPtr = null;
        this.scriptNode = null;
        this.masterGain = audioContext.createGain();
        this.masterGain.gain.value = 1.0;
        this.isInitialized = false;

        // SFZ data
        this.regions = [];
    }

    async initialize() {
        console.log('[RGSFZ] Loading WASM module...');

        // Load WASM module
        const createRGSFZModule = await import('../synths/rgsfz-player.js').then(m => m.default);
        this.wasmModule = await createRGSFZModule();
        console.log('[RGSFZ] WASM module loaded');

        // Create player instance
        this.playerPtr = this.wasmModule._rgsfz_player_create(this.audioContext.sampleRate);
        if (!this.playerPtr) {
            throw new Error('Failed to create RGSFZ player');
        }
        console.log('[RGSFZ] Player created, ptr:', this.playerPtr);

        // Create ScriptProcessor for audio processing
        const bufferSize = 4096;
        this.audioBufferPtr = this.wasmModule._rgsfz_create_audio_buffer(bufferSize);
        console.log('[RGSFZ] Audio buffer allocated, ptr:', this.audioBufferPtr);

        this.scriptNode = this.audioContext.createScriptProcessor(bufferSize, 0, 2);
        this.scriptNode.onaudioprocess = (e) => {
            this.processAudio(e);
        };

        // Connect to audio graph
        this.scriptNode.connect(this.masterGain);
        console.log('[RGSFZ] ScriptProcessorNode connected to masterGain');

        this.isInitialized = true;
        console.log('[RGSFZ] Initialized successfully');
    }

    processAudio(e) {
        if (!this.playerPtr || !this.audioBufferPtr) return;

        const leftOut = e.outputBuffer.getChannelData(0);
        const rightOut = e.outputBuffer.getChannelData(1);
        const frames = leftOut.length;

        // Process WASM audio
        this.wasmModule._rgsfz_player_process_f32(this.playerPtr, this.audioBufferPtr, frames);

        // Get memory buffer reference
        const memBuffer = this.wasmModule.wasmMemory ?
                          this.wasmModule.wasmMemory.buffer :
                          this.wasmModule.HEAPF32.buffer;

        // Copy interleaved stereo data from WASM
        const audioData = new Float32Array(memBuffer, this.audioBufferPtr, frames * 2);

        // Check if there's any audio data (debug)
        let hasAudio = false;
        for (let i = 0; i < frames; i++) {
            leftOut[i] = audioData[i * 2];
            rightOut[i] = audioData[i * 2 + 1];
            if (Math.abs(leftOut[i]) > 0.001 || Math.abs(rightOut[i]) > 0.001) {
                hasAudio = true;
            }
        }

        if (hasAudio && !this._loggedAudio) {
            console.log('[RGSFZ] Audio processing - detected non-zero samples');
            this._loggedAudio = true;
        }
    }

    /**
     * Parse SFZ file content using the C parser!
     */
    parseSFZ(sfzText) {
        console.log('[RGSFZ] Passing SFZ content to C parser...');

        // Allocate memory for SFZ text in WASM
        const encoder = new TextEncoder();
        const sfzBytes = encoder.encode(sfzText);
        const sfzPtr = this.wasmModule._malloc(sfzBytes.length + 1);

        // Copy SFZ text to WASM memory
        const heap = new Uint8Array(
            this.wasmModule.wasmMemory ? this.wasmModule.wasmMemory.buffer : this.wasmModule.HEAPU8.buffer
        );
        heap.set(sfzBytes, sfzPtr);
        heap[sfzPtr + sfzBytes.length] = 0;  // Null terminator

        // Call C parser!
        const result = this.wasmModule._rgsfz_player_load_sfz_from_memory(
            this.playerPtr,
            sfzPtr,
            sfzBytes.length
        );

        // Free temporary memory
        this.wasmModule._free(sfzPtr);

        if (!result) {
            console.error('[RGSFZ] C parser failed');
            return [];
        }

        // Get parsed region count from C
        const numRegions = this.wasmModule._rgsfz_player_get_num_regions(this.playerPtr);
        console.log('[RGSFZ] C parser successfully parsed', numRegions, 'regions');

        // Helper to read C string from WASM memory
        const readCString = (ptr) => {
            const heap = new Uint8Array(
                this.wasmModule.wasmMemory ? this.wasmModule.wasmMemory.buffer : this.wasmModule.HEAPU8.buffer
            );
            let end = ptr;
            while (heap[end] !== 0) end++;
            const bytes = heap.slice(ptr, end);
            return new TextDecoder().decode(bytes);
        };

        // Query region data from C for display
        this.regions = new Array(numRegions);
        for (let i = 0; i < numRegions; i++) {
            // Get sample path (need to convert C string pointer to JS string)
            const samplePtr = this.wasmModule._rgsfz_player_get_region_sample(this.playerPtr, i);
            const sample = readCString(samplePtr);

            this.regions[i] = {
                index: i,
                sample: sample,
                lokey: this.wasmModule._rgsfz_player_get_region_lokey(this.playerPtr, i),
                hikey: this.wasmModule._rgsfz_player_get_region_hikey(this.playerPtr, i),
                lovel: this.wasmModule._rgsfz_player_get_region_lovel(this.playerPtr, i),
                hivel: this.wasmModule._rgsfz_player_get_region_hivel(this.playerPtr, i),
                pitch_keycenter: this.wasmModule._rgsfz_player_get_region_pitch(this.playerPtr, i)
            };
        }

        console.log('[RGSFZ] Region data retrieved from C:', this.regions);
        return this.regions;
    }

    /**
     * Parse opcodes from a line (key=value pairs)
     * Handles spaces in values by finding next key= pattern
     */
    parseOpcodes(line) {
        const opcodes = {};

        // Remove <region> and <group> tags
        let cleanLine = line.replace(/<[^>]+>/g, '').trim();

        // Find all key= positions
        const keyPattern = /\b([a-z_]+)=/gi;
        const matches = [];
        let match;

        while ((match = keyPattern.exec(cleanLine)) !== null) {
            matches.push({
                key: match[1],
                start: match.index,
                valueStart: match.index + match[0].length
            });
        }

        // Extract values (everything between this key= and next key=, or end of line)
        for (let i = 0; i < matches.length; i++) {
            const current = matches[i];
            const next = matches[i + 1];
            const valueEnd = next ? next.start : cleanLine.length;
            const value = cleanLine.substring(current.valueStart, valueEnd).trim();

            switch (current.key) {
                case 'sample':
                    opcodes.sample = value.replace(/\\/g, '/');
                    break;
                case 'key':
                    opcodes.lokey = opcodes.hikey = parseInt(value);
                    opcodes.pitch_keycenter = parseInt(value);
                    break;
                case 'lokey':
                    opcodes.lokey = parseInt(value);
                    break;
                case 'hikey':
                    opcodes.hikey = parseInt(value);
                    break;
                case 'lovel':
                    opcodes.lovel = parseInt(value);
                    break;
                case 'hivel':
                    opcodes.hivel = parseInt(value);
                    break;
                case 'pitch_keycenter':
                    opcodes.pitch_keycenter = parseInt(value);
                    break;
                case 'pan':
                    opcodes.pan = parseFloat(value);
                    break;
                case 'offset':
                    opcodes.offset = parseInt(value);
                    break;
                case 'end':
                    opcodes.end = parseInt(value);
                    break;
            }
        }

        return opcodes;
    }

    /**
     * Load sample for a specific region
     * regionIndex: Index of the region (0-based)
     * arrayBuffer: ArrayBuffer containing WAV file data
     */
    async loadRegionSample(regionIndex, arrayBuffer) {
        // Decode WAV to PCM
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

        // Convert to mono int16 PCM
        const samples = audioBuffer.getChannelData(0);
        const pcm = new Int16Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Allocate WASM memory and copy PCM data
        const pcmPtr = this.wasmModule._malloc(pcm.length * 2);
        const heap16 = new Int16Array(
            this.wasmModule.wasmMemory ? this.wasmModule.wasmMemory.buffer : this.wasmModule.HEAP16.buffer,
            pcmPtr,
            pcm.length
        );
        heap16.set(pcm);

        // Load into WASM player
        this.wasmModule._rgsfz_player_load_region_sample(
            this.playerPtr,
            regionIndex,
            pcmPtr,
            pcm.length,
            audioBuffer.sampleRate
        );

        // Free temporary memory
        this.wasmModule._free(pcmPtr);

        console.log('[RGSFZ] Loaded sample for region', regionIndex);
    }

    handleNoteOn(note, velocity) {
        if (!this.playerPtr) {
            console.warn('[RGSFZ] handleNoteOn: playerPtr is null');
            return;
        }
        console.log('[RGSFZ] Note ON:', note, 'vel:', velocity);
        this.wasmModule._rgsfz_player_note_on(this.playerPtr, note, velocity);

        // Check active voices
        const activeVoices = this.wasmModule._rgsfz_player_get_active_voices(this.playerPtr);
        console.log('[RGSFZ] Active voices:', activeVoices);
    }

    handleNoteOff(note, velocity) {
        if (!this.playerPtr) return;
        console.log('[RGSFZ] Note OFF:', note);
        this.wasmModule._rgsfz_player_note_off(this.playerPtr, note);
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

    destroy() {
        if (this.scriptNode) {
            this.scriptNode.disconnect();
            this.scriptNode = null;
        }

        if (this.audioBufferPtr) {
            this.wasmModule._rgsfz_destroy_audio_buffer(this.audioBufferPtr);
            this.audioBufferPtr = null;
        }

        if (this.playerPtr) {
            this.wasmModule._rgsfz_player_destroy(this.playerPtr);
            this.playerPtr = null;
        }

        this.isInitialized = false;
    }
}

// Export for use in other scripts
window.RGSFZSynth = RGSFZSynth;
