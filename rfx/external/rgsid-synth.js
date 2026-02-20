// RGSIDSynth - WASM-based SID synthesizer for Regroove visualization
// Wraps the RGSID WASM synth in an AudioWorklet

class RGSIDSynth {
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
        this.pendingNotes = [];

        // Preset state
        this.presetCount = 0;
        this.presetNames = [];
        this.presetCallbacks = new Map();
        this.factoryPresetCount = 0;  // Built-in WASM presets
        this.userPresets = [];  // Loaded from ./data/
    }

    /**
     * Get parameter metadata (LV2-style descriptor)
     */
    static getParameterInfo() {
        return [
            // Voice 1 (0-7)
            { index: 0, name: "Waveform", type: "enum", group: "Voice 1", default: 4,
              options: [
                {value: 0, label: "Off"}, {value: 1, label: "Triangle"},
                {value: 2, label: "Sawtooth"}, {value: 4, label: "Pulse"},
                {value: 8, label: "Noise"}, {value: 3, label: "Tri+Saw"},
                {value: 5, label: "Tri+Pulse"}, {value: 6, label: "Saw+Pulse"}
              ]
            },
            { index: 1, name: "PW", type: "float", min: 0, max: 100, default: 50, unit: "%", group: "Voice 1", scale: "normalized", width: 40 },
            { index: 2, name: "Attack", type: "float", min: 0, max: 100, default: 0, group: "Voice 1", scale: "normalized", width: 35 },
            { index: 3, name: "Decay", type: "float", min: 0, max: 100, default: 50, group: "Voice 1", scale: "normalized", width: 35 },
            { index: 4, name: "Sustain", type: "float", min: 0, max: 100, default: 70, group: "Voice 1", scale: "normalized", width: 35 },
            { index: 5, name: "Release", type: "float", min: 0, max: 100, default: 30, group: "Voice 1", scale: "normalized", width: 35 },
            { index: 6, name: "Ring Mod", type: "boolean", default: false, group: "Voice 1" },
            { index: 7, name: "Sync", type: "boolean", default: false, group: "Voice 1" },

            // Voice 2 (8-15)
            { index: 8, name: "Waveform", type: "enum", group: "Voice 2", default: 2,
              options: [
                {value: 0, label: "Off"}, {value: 1, label: "Triangle"},
                {value: 2, label: "Sawtooth"}, {value: 4, label: "Pulse"},
                {value: 8, label: "Noise"}, {value: 3, label: "Tri+Saw"},
                {value: 5, label: "Tri+Pulse"}, {value: 6, label: "Saw+Pulse"}
              ]
            },
            { index: 9, name: "PW", type: "float", min: 0, max: 100, default: 50, unit: "%", group: "Voice 2", scale: "normalized", width: 40 },
            { index: 10, name: "Attack", type: "float", min: 0, max: 100, default: 0, group: "Voice 2", scale: "normalized", width: 35 },
            { index: 11, name: "Decay", type: "float", min: 0, max: 100, default: 50, group: "Voice 2", scale: "normalized", width: 35 },
            { index: 12, name: "Sustain", type: "float", min: 0, max: 100, default: 70, group: "Voice 2", scale: "normalized", width: 35 },
            { index: 13, name: "Release", type: "float", min: 0, max: 100, default: 30, group: "Voice 2", scale: "normalized", width: 35 },
            { index: 14, name: "Ring Mod", type: "boolean", default: false, group: "Voice 2" },
            { index: 15, name: "Sync", type: "boolean", default: false, group: "Voice 2" },

            // Voice 3 (16-23)
            { index: 16, name: "Waveform", type: "enum", group: "Voice 3", default: 4,
              options: [
                {value: 0, label: "Off"}, {value: 1, label: "Triangle"},
                {value: 2, label: "Sawtooth"}, {value: 4, label: "Pulse"},
                {value: 8, label: "Noise"}, {value: 3, label: "Tri+Saw"},
                {value: 5, label: "Tri+Pulse"}, {value: 6, label: "Saw+Pulse"}
              ]
            },
            { index: 17, name: "PW", type: "float", min: 0, max: 100, default: 50, unit: "%", group: "Voice 3", scale: "normalized", width: 40 },
            { index: 18, name: "Attack", type: "float", min: 0, max: 100, default: 0, group: "Voice 3", scale: "normalized", width: 35 },
            { index: 19, name: "Decay", type: "float", min: 0, max: 100, default: 50, group: "Voice 3", scale: "normalized", width: 35 },
            { index: 20, name: "Sustain", type: "float", min: 0, max: 100, default: 70, group: "Voice 3", scale: "normalized", width: 35 },
            { index: 21, name: "Release", type: "float", min: 0, max: 100, default: 30, group: "Voice 3", scale: "normalized", width: 35 },
            { index: 22, name: "Ring Mod", type: "boolean", default: false, group: "Voice 3" },
            { index: 23, name: "Sync", type: "boolean", default: false, group: "Voice 3" },

            // Filter (24-29)
            { index: 24, name: "Mode", type: "enum", group: "Filter", default: 1,
              options: [
                {value: 0, label: "Off"}, {value: 1, label: "Low Pass"},
                {value: 2, label: "Band Pass"}, {value: 3, label: "High Pass"}
              ]
            },
            { index: 25, name: "Cutoff", type: "float", min: 0, max: 100, default: 50, group: "Filter", scale: "normalized", width: 45, height: 140 },
            { index: 26, name: "Resonance", type: "float", min: 0, max: 100, default: 0, group: "Filter", scale: "normalized", width: 45, height: 140 },
            { index: 27, name: "V1 → Flt", type: "boolean", default: true, group: "Filter" },
            { index: 28, name: "V2 → Flt", type: "boolean", default: false, group: "Filter" },
            { index: 29, name: "V3 → Flt", type: "boolean", default: false, group: "Filter" },

            // Global (30)
            { index: 30, name: "Volume", type: "float", min: 0, max: 100, default: 70, group: "Global", scale: "normalized", width: 50, height: 150 },

            // LFO 1 (31-33)
            { index: 31, name: "LFO1 Rate", type: "float", min: 0, max: 100, default: 50, unit: "Hz", group: "LFO 1", scale: "log", width: 45 },
            { index: 32, name: "LFO1 Wave", type: "enum", group: "LFO 1", default: 0,
              options: [
                {value: 0, label: "Sine"}, {value: 1, label: "Triangle"},
                {value: 2, label: "Square"}, {value: 3, label: "Saw Up"},
                {value: 4, label: "Saw Down"}, {value: 5, label: "Random"}
              ]
            },
            { index: 33, name: "→ Pitch", type: "float", min: 0, max: 100, default: 0, group: "LFO 1", scale: "normalized", width: 40 },

            // LFO 2 (34-37)
            { index: 34, name: "LFO2 Rate", type: "float", min: 0, max: 100, default: 25, unit: "Hz", group: "LFO 2", scale: "log", width: 45 },
            { index: 35, name: "LFO2 Wave", type: "enum", group: "LFO 2", default: 1,
              options: [
                {value: 0, label: "Sine"}, {value: 1, label: "Triangle"},
                {value: 2, label: "Square"}, {value: 3, label: "Saw Up"},
                {value: 4, label: "Saw Down"}, {value: 5, label: "Random"}
              ]
            },
            { index: 36, name: "→ Filter", type: "float", min: 0, max: 100, default: 0, group: "LFO 2", scale: "normalized", width: 40 },
            { index: 37, name: "→ PW", type: "float", min: 0, max: 100, default: 0, group: "LFO 2", scale: "normalized", width: 40 },

            // Modulation Wheel (38)
            { index: 38, name: "Mod Wheel", type: "float", min: 0, max: 100, default: 0, group: "Global", scale: "normalized", width: 40, height: 120 },

            // Engine Mode (39)
            { index: 39, name: "Engine", type: "enum", group: "Global", default: 1,
              options: [
                {value: 0, label: "Lead"},
                {value: 1, label: "Multi"}
              ]
            },

            // Detune (40-41)
            { index: 40, name: "Detune Mode", type: "enum", group: "Unison", default: 0,
              options: [
                {value: 0, label: "Normal"},
                {value: 1, label: "Spread"},
                {value: 2, label: "SuperSaw-"},
                {value: 3, label: "SuperSaw+"}
              ]
            },
            { index: 41, name: "Detune", type: "float", min: 0, max: 100, default: 30, unit: "cents", group: "Unison", scale: "normalized", width: 40, height: 120 }
        ];
    }

    /**
     * Instance method for parameter info (delegates to static)
     */
    getParameterInfo() {
        return RGSIDSynth.getParameterInfo();
    }

    async initialize() {
        console.log('[RGSIDSynth] 🎛️ Initializing WASM SID Synth...');
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
            console.log('[RGSIDSynth] Audio graph connected: worklet → masterGain → speakerGain → destination');

            // Load and register AudioWorklet processor (with cache-busting)
            await this.audioContext.audioWorklet.addModule('worklets/synth-worklet-processor.js?v=300');

            // Create worklet node
            this.workletNode = new AudioWorkletNode(this.audioContext, 'synth-worklet-processor');
            this.workletNode.connect(this.masterGain);

            // Handle worklet messages
            this.workletNode.port.onmessage = (event) => {
                const { type, data, count, index, name, parameters } = event.data;

                if (type === 'needWasm') {
                    this.loadWasm();
                } else if (type === 'ready') {
                    console.log('[RGSIDSynth] ✅ WASM SID Synth ready');
                    this.wasmReady = true;

                    // Request preset count
                    this.requestPresetCount();

                    // Process any pending notes
                    for (const note of this.pendingNotes) {
                        if (note.type === 'on') {
                            this.handleNoteOn(note.note, note.velocity);
                        } else {
                            this.handleNoteOff(note.note);
                        }
                    }
                    this.pendingNotes = [];
                } else if (type === 'error') {
                    console.error('[RGSIDSynth] WASM error:', data);
                } else if (type === 'presetCount') {
                    this.handlePresetCount(count);
                } else if (type === 'presetName') {
                    this.handlePresetName(index, name);
                } else if (type === 'presetLoaded') {
                    this.handlePresetLoaded(index, parameters);
                }
            };

            this.isActive = true;

            console.log('[RGSIDSynth] Initialized - waiting for WASM...');
            return true;
        } catch (error) {
            console.error('[RGSIDSynth] Failed to initialize:', error);
            return false;
        }
    }

    async loadWasm() {
        try {
            console.log('[RGSIDSynth] Loading WASM...');

            // Fetch both JS glue code and WASM binary
            const [jsResponse, wasmResponse] = await Promise.all([
                fetch('synths/rgsidsynth.js'),
                fetch('synths/rgsidsynth.wasm')
            ]);

            const jsCode = await jsResponse.text();
            const wasmBytes = await wasmResponse.arrayBuffer();

            // Send to worklet
            this.workletNode.port.postMessage({
                type: 'wasmBytes',
                data: {
                    jsCode: jsCode,
                    wasmBytes: wasmBytes,
                    sampleRate: this.audioContext.sampleRate,
                    engine: 2 // RGSID engine ID
                }
            });

            console.log('[RGSIDSynth] WASM sent to worklet');
        } catch (error) {
            console.error('[RGSIDSynth] Failed to load WASM:', error);
        }
    }

    handleNoteOn(note, velocity) {
        if (!this.isActive) return;

        if (!this.wasmReady) {
            // Queue note for later
            this.pendingNotes.push({ type: 'on', note, velocity });
            return;
        }

        // Send to worklet
        this.workletNode.port.postMessage({
            type: 'noteOn',
            data: { note, velocity }
        });
    }

    handleNoteOff(note) {
        if (!this.isActive) return;

        if (!this.wasmReady) {
            // Queue note for later
            this.pendingNotes.push({ type: 'off', note });
            return;
        }

        // Send to worklet
        this.workletNode.port.postMessage({
            type: 'noteOff',
            data: { note }
        });
    }

    handleMidi(status, data1, data2) {
        if (!this.isActive) return;

        if (!this.wasmReady) {
            return;
        }

        // Send raw MIDI to worklet
        this.workletNode.port.postMessage({
            type: 'midi',
            data: { status, data1, data2 }
        });
    }

    handleControlChange(controller, value) {
        if (!this.isActive || !this.wasmReady || !this.workletNode) return;

        this.workletNode.port.postMessage({
            type: 'controlChange',
            data: { controller, value }
        });
    }

    setParameter(index, value) {
        if (!this.isActive || !this.wasmReady || !this.workletNode) return;

        this.workletNode.port.postMessage({
            type: 'setParam',
            data: { index, value }
        });
    }

    stopAll() {
        if (!this.wasmReady || !this.workletNode) return;

        this.workletNode.port.postMessage({
            type: 'allNotesOff'
        });
    }

    /**
     * Connect this synth to a destination node (Web Audio API standard)
     */
    connect(destination) {
        if (!this.masterGain) {
            console.warn('[RGSIDSynth] Cannot connect - not initialized');
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

    /**
     * Get analyser node for visualization
     */
    getAnalyser() {
        return this.frequencyAnalyzer ? this.frequencyAnalyzer.getAnalyser() : null;
    }

    async setAudible(enabled) {
        if (!this.speakerGain) {
            console.error('[RGSIDSynth] ❌ setAudible called but speakerGain is null!');
            return;
        }

        this.isAudible = enabled;
        console.log(`[RGSIDSynth] setAudible(${enabled})`);

        // Resume AudioContext if needed
        if (enabled && this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
                console.log('[RGSIDSynth] AudioContext resumed');
            } catch (error) {
                console.error('[RGSIDSynth] Failed to resume AudioContext:', error);
                return;
            }
        }

        // Smooth fade to avoid clicks
        const currentTime = this.audioContext.currentTime;
        this.speakerGain.gain.cancelScheduledValues(currentTime);
        this.speakerGain.gain.setValueAtTime(this.speakerGain.gain.value, currentTime);
        this.speakerGain.gain.linearRampToValueAtTime(enabled ? 1.0 : 0.0, currentTime + 0.05);

        console.log(`[RGSIDSynth] ✅ ${enabled ? 'AUDIBLE' : 'MUTED'}`);
    }

    // ============================================================================
    // Preset API (Dynamic Loading from WASM)
    // ============================================================================

    requestPresetCount() {
        if (!this.wasmReady || !this.workletNode) return;
        this.workletNode.port.postMessage({ type: 'getPresetCount' });
    }

    handlePresetCount(count) {
        this.factoryPresetCount = count;
        console.log(`[RGSIDSynth] 🎨 ${count} factory presets from WASM`);

        // Request all factory preset names
        this.presetNames = new Array(count);
        for (let i = 0; i < count; i++) {
            this.workletNode.port.postMessage({ type: 'getPresetName', data: { index: i } });
        }

        // Load user presets from external file
        this.loadUserPresets();
    }

    async loadUserPresets() {
        try {
            const response = await fetch('data/sid_user_presets.txt');
            if (!response.ok) {
                console.log('[RGSIDSynth] No user presets found (data/sid_user_presets.txt)');
                return;
            }

            const text = await response.text();

            // Parse PRESET(name, waveform, pw, attack, decay, sustain, release, filterMode, cutoff, resonance, filterV1)
            const presetRegex = /PRESET\s*\(\s*"([^"]+)"\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g;

            let match;
            this.userPresets = [];
            while ((match = presetRegex.exec(text)) !== null) {
                this.userPresets.push({
                    name: match[1],
                    waveform: parseFloat(match[2]),
                    pulseWidth: parseFloat(match[3]),
                    attack: parseFloat(match[4]),
                    decay: parseFloat(match[5]),
                    sustain: parseFloat(match[6]),
                    release: parseFloat(match[7]),
                    filterMode: parseFloat(match[8]),
                    filterCutoff: parseFloat(match[9]),
                    filterResonance: parseFloat(match[10]),
                    filterVoice1: parseFloat(match[11])
                });
            }

            if (this.userPresets.length === 0) {
                console.log('[RGSIDSynth] No PRESET() entries found in file');
                return;
            }

            console.log(`[RGSIDSynth] ✅ Loaded ${this.userPresets.length} user presets from .h file`);

            // Append user preset names
            for (const preset of this.userPresets) {
                this.presetNames.push(preset.name);
            }

            // Update total count
            this.presetCount = this.factoryPresetCount + this.userPresets.length;
            console.log(`[RGSIDSynth] 🎨 Total: ${this.presetCount} presets (${this.factoryPresetCount} factory + ${this.userPresets.length} user)`);

            // Notify UI
            this.emit('presetName', { index: -1, name: '' });  // Trigger UI refresh
            const callback = this.presetCallbacks.get('names');
            if (callback) {
                callback(this.presetNames);
            }
        } catch (error) {
            console.log('[RGSIDSynth] Could not load user presets:', error.message);
        }
    }

    handlePresetName(index, name) {
        this.presetNames[index] = name;
        console.log(`[RGSIDSynth] Preset ${index}: "${name}"`);

        // Notify listeners
        this.emit('presetName', { index, name });

        // If callback registered, call it
        const callback = this.presetCallbacks.get('names');
        if (callback) {
            callback(this.presetNames);
        }
    }

    handlePresetLoaded(index, parameters) {
        console.log(`[RGSIDSynth] ✅ Loaded preset ${index}: ${this.presetNames[index]}`);
        if (parameters && parameters.length > 0) {
            console.log(`[RGSIDSynth] Syncing ${parameters.length} parameters to UI`);
        }
        this.emit('presetLoaded', { index, name: this.presetNames[index], parameters });
    }

    /**
     * Get number of available presets
     */
    getPresetCount() {
        return this.presetCount;
    }

    /**
     * Get all preset names (returns copy of array)
     */
    getPresetNames() {
        return [...this.presetNames];
    }

    /**
     * Get name of specific preset
     */
    getPresetName(index) {
        return this.presetNames[index] || '';
    }

    /**
     * Load a preset by index (factory or user)
     */
    loadPreset(index, voice = 0) {
        if (!this.wasmReady || !this.workletNode) {
            console.warn('[RGSIDSynth] Cannot load preset - not ready');
            return;
        }
        if (index < 0 || index >= this.presetCount) {
            console.warn(`[RGSIDSynth] Invalid preset index: ${index}`);
            return;
        }

        console.log(`[RGSIDSynth] ======================================`);
        console.log(`[RGSIDSynth] loadPreset() called`);
        console.log(`[RGSIDSynth]   index = ${index} (type: ${typeof index})`);
        console.log(`[RGSIDSynth]   voice = ${voice} (type: ${typeof voice})`);
        console.log(`[RGSIDSynth]   preset name = "${this.presetNames[index]}"`);
        console.log(`[RGSIDSynth] ======================================`);

        // Factory preset - load from WASM
        if (index < this.factoryPresetCount) {
            console.log(`[RGSIDSynth] Sending 'loadPreset' message to worklet: { index: ${index}, voice: ${voice} }`);
            this.workletNode.port.postMessage({ type: 'loadPreset', data: { index, voice } });
        }
        // User preset - apply parameters directly
        else {
            const userIndex = index - this.factoryPresetCount;
            const preset = this.userPresets[userIndex];
            if (!preset) {
                console.warn('[RGSIDSynth] User preset not found:', userIndex);
                return;
            }

            console.log(`[RGSIDSynth] Applying user preset to voice ${voice}`);

            // Map preset parameters to target voice
            // Voice 0: params 0-7, Voice 1: params 8-15, Voice 2: params 16-23
            const baseParam = voice * 8;

            // Only set parameters for the target voice (don't touch other voices or global params)
            this.setParameter(baseParam + 0, preset.waveform || 4);  // Waveform
            this.setParameter(baseParam + 1, preset.pulseWidth || 0.5);  // PW
            this.setParameter(baseParam + 2, preset.attack || 0.0);  // Attack
            this.setParameter(baseParam + 3, preset.decay || 0.5);  // Decay
            this.setParameter(baseParam + 4, preset.sustain || 0.7);  // Sustain
            this.setParameter(baseParam + 5, preset.release || 0.3);  // Release
            this.setParameter(baseParam + 6, preset.ringMod || 0);  // Ring Mod
            this.setParameter(baseParam + 7, preset.sync || 0);  // Sync

            // Optionally update filter settings (but don't override filter routing for other voices)
            if (preset.filterMode !== undefined) {
                this.setParameter(24, preset.filterMode);  // Filter Mode
            }
            if (preset.filterCutoff !== undefined) {
                this.setParameter(25, preset.filterCutoff);  // Filter Cutoff
            }
            if (preset.filterResonance !== undefined) {
                this.setParameter(26, preset.filterResonance);  // Filter Resonance
            }

            // Set filter routing for target voice only
            const filterRoutingParam = 27 + voice;  // 27=V1, 28=V2, 29=V3
            this.setParameter(filterRoutingParam, preset.filterVoice1 !== undefined ? preset.filterVoice1 : 1);

            // Build parameters array for UI update (only the voice that changed)
            const parameters = new Array(31).fill(null);
            parameters[baseParam + 0] = preset.waveform || 4;
            parameters[baseParam + 1] = preset.pulseWidth || 0.5;
            parameters[baseParam + 2] = preset.attack || 0.0;
            parameters[baseParam + 3] = preset.decay || 0.5;
            parameters[baseParam + 4] = preset.sustain || 0.7;
            parameters[baseParam + 5] = preset.release || 0.3;
            parameters[baseParam + 6] = preset.ringMod || 0;
            parameters[baseParam + 7] = preset.sync || 0;

            // Emit event for UI sync with parameters (include voice so UI knows what changed)
            this.emit('presetLoaded', { index, name: preset.name, parameters, voice });
        }
    }

    /**
     * Register callback for when preset names are loaded
     */
    onPresetsReady(callback) {
        this.presetCallbacks.set('names', callback);
        // If already loaded, call immediately
        if (this.presetNames.length > 0) {
            callback(this.presetNames);
        }
    }

    destroy() {
        console.log('[RGSIDSynth] Destroying...');

        this.isActive = false;

        // Stop all notes
        this.stopAll();

        // Destroy frequency analyzer
        if (this.frequencyAnalyzer) {
            this.frequencyAnalyzer.destroy();
            this.frequencyAnalyzer = null;
        }

        // Disconnect audio graph
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

        // Clear event listeners
        this.listeners.clear();

        console.log('[RGSIDSynth] Destroyed');
    }

    // Event emitter interface
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
                console.error(`[RGSIDSynth] Error in ${event} listener:`, error);
            }
        }
    }
}

// Register synth in registry (auto-discovery)
if (typeof SynthRegistry !== 'undefined') {
    SynthRegistry.register({
        id: 'rgsid',
        name: 'RGSID',
        displayName: 'RGSID - Commodore 64 SID Chip',
        description: '3-voice synthesizer with filter, ring modulation, and hard sync',
        engineId: 2,
        class: RGSIDSynth,
        wasmFiles: {
            js: 'synths/rgsidsynth.js',
            wasm: 'synths/rgsidsynth.wasm'
        },
        category: 'synthesizer',
        getParameterInfo: RGSIDSynth.getParameterInfo
    });
}
