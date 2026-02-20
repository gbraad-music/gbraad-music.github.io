/**
 * SFZ Sampler Player
 * Loads and plays SFZ sample banks with MIDI note/velocity mapping
 */

class SFZPlayer {
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.regions = [];
        this.samples = new Map(); // Map<samplePath, AudioBuffer>
        this.activeVoices = new Map(); // Map<noteId, {source, gain}>
        this.masterGain = audioContext.createGain();
        this.masterGain.connect(audioContext.destination);
        this.masterGain.gain.value = 0.7;
    }

    /**
     * Parse SFZ text content
     */
    parseSFZ(sfzText) {
        const regions = [];
        let currentRegion = null;
        let currentGroup = {};

        const lines = sfzText.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();

            // Skip comments and empty lines
            if (!trimmed || trimmed.startsWith('//')) continue;

            // Check for <group> header
            if (trimmed.includes('<group>')) {
                currentGroup = this.parseOpcodes(trimmed);
                continue;
            }

            // Check for <region> header
            if (trimmed.includes('<region>')) {
                if (currentRegion) {
                    regions.push(currentRegion);
                }
                // Start new region with group defaults
                currentRegion = {
                    sample: '',
                    lokey: 0,
                    hikey: 127,
                    lovel: 0,
                    hivel: 127,
                    pitch_keycenter: 60,
                    pan: 0,
                    tune: 0,
                    volume: 0,
                    offset: 0,
                    end: 0,
                    loop_mode: 'no_loop',
                    ...currentGroup
                };

                // Parse inline opcodes
                const opcodes = this.parseOpcodes(trimmed);
                Object.assign(currentRegion, opcodes);
                continue;
            }

            // Parse key=value pairs on their own line
            if (currentRegion) {
                const opcodes = this.parseOpcodes(trimmed);
                Object.assign(currentRegion, opcodes);
            }
        }

        // Push last region
        if (currentRegion) {
            regions.push(currentRegion);
        }

        this.regions = regions;
        console.log('[SFZ] Parsed', this.regions.length, 'regions');
        return this.regions;
    }

    /**
     * Parse opcodes from a line (key=value pairs)
     */
    parseOpcodes(line) {
        const opcodes = {};
        const pairs = line.replace(/<[^>]+>/g, '').split(/\s+/);

        for (const pair of pairs) {
            const [key, value] = pair.split('=');
            if (!key || value === undefined) continue;

            switch (key) {
                case 'sample':
                    opcodes.sample = value.replace(/\\/g, '/'); // Convert backslashes
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
                case 'tune':
                    opcodes.tune = parseInt(value); // cents
                    break;
                case 'volume':
                    opcodes.volume = parseFloat(value); // dB
                    break;
                case 'pan':
                    opcodes.pan = parseFloat(value); // -100 to +100
                    break;
                case 'offset':
                    opcodes.offset = parseInt(value); // samples
                    break;
                case 'end':
                    opcodes.end = parseInt(value); // samples
                    break;
                case 'loop_mode':
                    opcodes.loop_mode = value; // no_loop, one_shot, loop_continuous, etc.
                    break;
            }
        }

        return opcodes;
    }

    /**
     * Load WAV files referenced in SFZ
     * sampleFiles: Map<samplePath, File> or directory path
     */
    async loadSamples(sampleFiles) {
        console.log('[SFZ] Loading samples...');
        const uniqueSamples = new Set(this.regions.map(r => r.sample).filter(s => s));

        let loadedCount = 0;
        for (const samplePath of uniqueSamples) {
            const file = sampleFiles.get(samplePath);
            if (!file) {
                console.warn('[SFZ] Missing sample file:', samplePath);
                continue;
            }

            try {
                const arrayBuffer = await file.arrayBuffer();
                const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
                this.samples.set(samplePath, audioBuffer);
                loadedCount++;
                console.log('[SFZ] Loaded:', samplePath);
            } catch (error) {
                console.error('[SFZ] Failed to load:', samplePath, error);
            }
        }

        console.log('[SFZ] Loaded', loadedCount, '/', uniqueSamples.size, 'samples');
        return loadedCount;
    }

    /**
     * Find the best matching region for a note and velocity
     */
    findRegion(note, velocity) {
        for (const region of this.regions) {
            if (note >= region.lokey && note <= region.hikey &&
                velocity >= region.lovel && velocity <= region.hivel) {
                return region;
            }
        }
        return null;
    }

    /**
     * Trigger a note
     */
    handleNoteOn(note, velocity) {
        const region = this.findRegion(note, velocity);
        if (!region || !region.sample) {
            console.warn('[SFZ] No region for note', note, 'velocity', velocity);
            return;
        }

        const audioBuffer = this.samples.get(region.sample);
        if (!audioBuffer) {
            console.warn('[SFZ] Sample not loaded:', region.sample);
            return;
        }

        // Create voice
        const source = this.audioContext.createBufferSource();
        const gainNode = this.audioContext.createGain();
        const panNode = this.audioContext.createStereoPanner();

        source.buffer = audioBuffer;

        // Apply offset/end
        const startOffset = region.offset / audioBuffer.sampleRate;
        const duration = region.end > 0 ? (region.end - region.offset) / audioBuffer.sampleRate : undefined;

        // Apply loop mode
        if (region.loop_mode === 'loop_continuous') {
            source.loop = true;
        }

        // Calculate pitch shift (semitones difference from root)
        const semitones = note - region.pitch_keycenter + (region.tune / 100);
        source.playbackRate.value = Math.pow(2, semitones / 12);

        // Apply volume (dB to linear gain)
        const velocityGain = velocity / 127;
        const volumeGain = Math.pow(10, region.volume / 20);
        gainNode.gain.value = velocityGain * volumeGain;

        // Apply panning (-100 to +100 → -1 to +1)
        panNode.pan.value = Math.max(-1, Math.min(1, region.pan / 100));

        // Connect
        source.connect(gainNode);
        gainNode.connect(panNode);
        panNode.connect(this.masterGain);

        // Start
        source.start(0, startOffset, duration);

        // Track active voice
        const voiceId = `${note}`;
        this.activeVoices.set(voiceId, { source, gainNode });

        // Auto-cleanup on end
        source.onended = () => {
            this.activeVoices.delete(voiceId);
        };

        console.log('[SFZ] Note ON:', note, 'vel:', velocity, 'region:', region.sample, 'pitch:', source.playbackRate.value.toFixed(2));
    }

    /**
     * Release a note
     */
    handleNoteOff(note, velocity) {
        const voiceId = `${note}`;
        const voice = this.activeVoices.get(voiceId);

        if (voice) {
            // Fade out
            const now = this.audioContext.currentTime;
            voice.gainNode.gain.cancelScheduledValues(now);
            voice.gainNode.gain.setValueAtTime(voice.gainNode.gain.value, now);
            voice.gainNode.gain.linearRampToValueAtTime(0, now + 0.05);

            // Stop after fade
            voice.source.stop(now + 0.05);
            this.activeVoices.delete(voiceId);

            console.log('[SFZ] Note OFF:', note);
        }
    }

    /**
     * Stop all voices
     */
    allNotesOff() {
        const now = this.audioContext.currentTime;

        for (const [voiceId, voice] of this.activeVoices) {
            voice.gainNode.gain.cancelScheduledValues(now);
            voice.gainNode.gain.setValueAtTime(voice.gainNode.gain.value, now);
            voice.gainNode.gain.linearRampToValueAtTime(0, now + 0.05);
            voice.source.stop(now + 0.05);
        }

        this.activeVoices.clear();
        console.log('[SFZ] All notes off');
    }

    /**
     * Get info about loaded SFZ
     */
    getInfo() {
        return {
            regions: this.regions.length,
            samplesLoaded: this.samples.size,
            activeVoices: this.activeVoices.size
        };
    }
}

// Export for use in other scripts
window.SFZPlayer = SFZPlayer;
