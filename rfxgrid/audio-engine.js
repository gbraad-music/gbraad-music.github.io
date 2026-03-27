/**
 * BitWig Grid Audio Engine - Voice-based Synthesis
 * MIDI/Keyboard triggered with proper envelopes
 * Uses RFX WASM filters for authentic sound
 */

import { RFXLadderFilter } from './rfx-ladder-filter.js';

export class GridAudioEngine {
    constructor(audioContext) {
        this.ctx = audioContext;
        this.gridData = null;
        this.voices = new Map(); // note -> Voice
        this.maxVoices = 8;
        this.midiAccess = null;

        // Pre-allocated filter pool (prevents WASM loading during playback)
        this.filterPool = [];
        this.filterPoolSize = 8; // One per voice
        this.workletRegistered = false;
        this.wasmBytes = null; // Cached WASM bytes
        this.wasmModuleCode = null; // Cached WASM factory code

        // Create analyser for oscilloscope
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.connect(this.ctx.destination);
    }

    // Load Grid data
    async loadGrid(gridData) {
        console.log('[AudioEngine] Loading grid with', gridData.modules.length, 'modules');
        this.gridData = gridData;

        // Always preload filter pool (prevents crackling during playback)
        console.log('[AudioEngine] Preloading filter pool...');
        try {
            await this.preloadFilterPool();
            console.log('[AudioEngine] Filter pool ready:', this.filterPool.length, 'filters');
        } catch (err) {
            console.error('[AudioEngine] Failed to preload filter pool:', err);
            // Continue anyway, filters will be created on-demand
        }

        // Setup MIDI input
        await this.setupMIDI();
    }

    // Preload filter pool BEFORE playback starts
    async preloadFilterPool() {
        console.log('[AudioEngine] preloadFilterPool() started, current pool size:', this.filterPool.length);
        this.filterPool = [];

        try {
            // Load WASM factory ONCE and set in global scope
            if (!globalThis.LadderFilterModule) {
                console.log('[AudioEngine] Loading WASM factory (ONCE)...');
                const jsResponse = await fetch('./ladder-filter.js');
                console.log('[AudioEngine] Fetched ladder-filter.js');
                const jsCode = await jsResponse.text();
                console.log('[AudioEngine] Read ladder-filter.js, length:', jsCode.length);

                // Modify code to expose wasmMemory and LadderFilterModule globally
                this.wasmModuleCode = jsCode
                    .replace(';return moduleRtn', ';globalThis.__wasmMemory=wasmMemory;return moduleRtn')
                    .replace('var LadderFilterModule=', 'globalThis.LadderFilterModule=');

                // Eval modified code (sets globalThis.LadderFilterModule)
                eval(this.wasmModuleCode);
                console.log('[AudioEngine] WASM factory loaded');
            }

            // Fetch WASM bytes ONCE
            if (!this.wasmBytes) {
                console.log('[AudioEngine] Fetching WASM bytes (ONCE)...');
                const wasmResponse = await fetch('./ladder-filter.wasm');
                this.wasmBytes = await wasmResponse.arrayBuffer();
                console.log('[AudioEngine] WASM bytes fetched, size:', this.wasmBytes.byteLength);
            }

            // Register AudioWorklet processor ONCE for all filters
            if (!this.workletRegistered) {
                await this.ctx.audioWorklet.addModule('./ladder-filter-processor.js');
                this.workletRegistered = true;
                console.log('[AudioEngine] Registered AudioWorklet processor (ONCE)');
            }

            for (let i = 0; i < this.filterPoolSize; i++) {
                console.log(`[AudioEngine] Creating filter ${i + 1}/${this.filterPoolSize}...`);
                const filter = new RFXLadderFilter(this.ctx, true, this.wasmBytes, this.wasmModuleCode); // Pass cached resources

                // Add timeout to prevent hanging
                const initPromise = filter.init();
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Filter init timeout')), 5000)
                );

                await Promise.race([initPromise, timeoutPromise]);
                this.filterPool.push(filter);
                console.log(`[AudioEngine] ✓ Preloaded filter ${i + 1}/${this.filterPoolSize}`);
            }
            console.log(`[AudioEngine] All ${this.filterPool.length} filters ready!`);
        } catch (err) {
            console.error('[AudioEngine] Filter pool preload failed:', err);
            throw err;
        }
    }

    // Update a parameter in real-time without recreating voices
    updateParameter(moduleId, paramName, value) {
        if (!this.gridData) return;

        // Find and update the module parameter in gridData
        const module = this.gridData.modules.find(m => m.id === moduleId);
        if (!module || !module.parameters || !module.parameters[paramName]) return;

        module.parameters[paramName].value = value;

        // Update all active voices
        this.voices.forEach((voice, midiNote) => {
            const nodeKey = `${this.getNodeType(module)}_${moduleId}`;
            const node = voice.nodes[nodeKey];

            if (!node) return;

            // Update specific parameter on the audio node
            this.applyParameterToNode(node, module, paramName, value);
        });
    }

    // Get node type prefix for a module
    getNodeType(module) {
        if (module.category === 'Oscillator') return 'osc';
        if (module.category === 'Filter') return 'filter';
        if (module.category === 'Envelope') return 'env';
        if (module.category === 'Mix') return 'mixer';
        if (module.category === 'Gain' || module.category === 'Level') return 'gain';
        if (module.category === 'Shaper' || module.name.toLowerCase().includes('clip')) return 'shaper';
        return 'node';
    }

    // Apply a parameter change to an audio node
    applyParameterToNode(node, module, paramName, value) {
        const now = this.ctx.currentTime;

        // Oscillator parameters
        if (module.category === 'Oscillator') {
            if (paramName === 'WRAP') {
                // node is the gain wrapper, find the actual oscillator(s)
                for (const [noteId, voice] of this.voices) {
                    if (voice.nodes[`osc_${module.id}`] === node) {
                        const oscSource = voice.nodes[`osc_source_${module.id}`];
                        if (oscSource && oscSource.frequency) {
                            // WRAP = pitch offset in semitones
                            const baseFreq = voice.frequency;
                            const newFreq = baseFreq * Math.pow(2, value / 12);
                            oscSource.frequency.setTargetAtTime(newFreq, now, 0.01);
                            console.log(`[Param] Updated WRAP: ${value.toFixed(1)} semitones -> ${newFreq.toFixed(1)}Hz`);
                        }
                        // For supersaw (mixer node with sub-oscillators)
                        if (node._oscillators) {
                            const baseFreq = voice.frequency;
                            const newFreq = baseFreq * Math.pow(2, value / 12);
                            node._oscillators.forEach(osc => {
                                if (osc.frequency) {
                                    osc.frequency.setTargetAtTime(newFreq, now, 0.01);
                                }
                            });
                            console.log(`[Param] Updated WRAP (supersaw): ${value.toFixed(1)} semitones -> ${newFreq.toFixed(1)}Hz`);
                        }
                        break;
                    }
                }
            }
        }

        // Filter parameters
        if (module.category === 'Filter') {
            if (paramName === 'CUTOFF' && node.frequency) {
                const cutoff = 20 * Math.pow(1000, value / 127);
                node.frequency.setTargetAtTime(cutoff, now, 0.01);
            } else if (paramName === 'RESONANCE' && node.Q) {
                const Q = 1 + value * 30;
                node.Q.setTargetAtTime(Q, now, 0.01);
            }
        }

        // Gain parameters (Level modules)
        if ((module.category === 'Gain' || module.category === 'Level') && node.gain) {
            if (paramName === 'GAIN') {
                const linearGain = Math.pow(10, value / 20); // dB to linear
                node.gain.setTargetAtTime(linearGain, now, 0.01);
            }
        }

        // Shaper parameters
        if (module.category === 'Shaper' && node.gain) {
            if (paramName === 'DRIVE') {
                const driveGain = 1 + value * 10;
                node.gain.setTargetAtTime(driveGain, now, 0.01);
            }
        }

        // Mixer/Blend parameters
        if (module.category === 'Mix') {
            if (paramName === 'DEPTH' && node._inputA && node._inputB) {
                // Equal power crossfade
                const gainA = Math.sqrt(1 - value); // Decreases as value increases
                const gainB = Math.sqrt(value);     // Increases as value increases

                // Use setValueAtTime for instant, precise changes (no exponential bleed)
                node._inputA.gain.setValueAtTime(gainA, now);
                node._inputB.gain.setValueAtTime(gainB, now);

                console.log(`[Param] Blend DEPTH=${value.toFixed(3)}: A=${gainA.toFixed(4)}, B=${gainB.toFixed(4)}`);
            }
        }

        // Note: Oscillator and envelope parameters only affect new voices
        // They can't be updated on running oscillators/envelopes
    }

    // Setup MIDI input
    async setupMIDI() {
        try {
            this.midiAccess = await navigator.requestMIDIAccess();
            console.log('[AudioEngine] MIDI access granted');

            for (const input of this.midiAccess.inputs.values()) {
                input.onmidimessage = (e) => this.handleMIDI(e);
                console.log(`[AudioEngine] Listening to MIDI: ${input.name}`);
            }
        } catch (err) {
            console.warn('[AudioEngine] MIDI not available:', err);
        }
    }

    // Handle MIDI messages
    handleMIDI(event) {
        const [status, note, velocity] = event.data;
        const command = status & 0xf0;

        if (command === 0x90 && velocity > 0) {
            // Note On
            this.noteOn(note, velocity / 127);
        } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
            // Note Off
            this.noteOff(note);
        }
    }

    // Trigger note on
    async noteOn(midiNote, velocity = 1.0) {
        // Stop old voice if still playing
        if (this.voices.has(midiNote)) {
            this.noteOff(midiNote);
        }

        // Voice stealing if too many voices
        if (this.voices.size >= this.maxVoices) {
            const oldestNote = this.voices.keys().next().value;
            this.noteOff(oldestNote);
        }

        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
        const voice = await this.createVoice(freq, velocity);

        if (voice) {
            this.voices.set(midiNote, voice);
            voice.start();
            console.log(`[AudioEngine] Note On: ${midiNote} (${freq.toFixed(1)}Hz)`);
        }
    }

    // Trigger note off
    noteOff(midiNote) {
        const voice = this.voices.get(midiNote);
        if (voice) {
            voice.stop();
            this.voices.delete(midiNote);
            console.log(`[AudioEngine] Note Off: ${midiNote}`);
        }
    }

    // Create a voice (one note instance)
    async createVoice(frequency, velocity) {
        if (!this.gridData) return null;

        const voice = {
            frequency: frequency,
            velocity: velocity,
            nodes: {},
            startTime: this.ctx.currentTime,
            stopTime: null
        };

        // Find oscillator modules
        const oscillators = this.gridData.modules.filter(m => m.category === 'Oscillator');

        // Create oscillator nodes with analysers for scopes
        oscillators.forEach((module, idx) => {
            const osc = this.createOscillatorNode(module, frequency);

            // Create analyser as a TAP (doesn't interrupt signal flow)
            const oscAnalyser = this.ctx.createAnalyser();
            oscAnalyser.fftSize = 2048;

            // Create passthrough gain node
            const oscGain = this.ctx.createGain();
            oscGain.gain.value = 1.0;

            // Connect: osc -> gain (main path) + analyser (tap)
            osc.connect(oscGain);
            osc.connect(oscAnalyser); // Tap for scope

            // Store gain as the main node (for connections)
            voice.nodes[`osc_${module.id}`] = oscGain;
            voice.nodes[`osc_analyser_${module.id}`] = oscAnalyser;
            voice.nodes[`osc_source_${module.id}`] = osc; // For stop() calls
        });

        // Find envelope modules (AD, AR, ADSR)
        const envelopes = this.gridData.modules.filter(m => m.category === 'Envelope');

        // Create envelope nodes
        envelopes.forEach(module => {
            const env = this.createEnvelopeNode(module, velocity);
            voice.nodes[`env_${module.id}`] = env;
        });

        // Find filter modules
        const filters = this.gridData.modules.filter(m => m.category === 'Filter');

        // Create filter nodes (async - RFX WASM filters)
        for (const module of filters) {
            const filter = await this.createFilterNode(module);
            voice.nodes[`filter_${module.id}`] = filter;
        }

        // Find mixer/blend modules
        const mixers = this.gridData.modules.filter(m => m.category === 'Mix');

        mixers.forEach(module => {
            // Create proper crossfade mixer with two input gains
            const params = module.parameters || {};
            const depth = params.DEPTH ? params.DEPTH.value : 0.5; // 0-1

            // Input A gain (decreases as depth increases)
            const gainA = this.ctx.createGain();
            gainA.gain.value = Math.sqrt(1 - depth); // Equal power crossfade

            // Input B gain (increases as depth increases)
            const gainB = this.ctx.createGain();
            gainB.gain.value = Math.sqrt(depth); // Equal power crossfade

            // Output mixer
            const mixer = this.ctx.createGain();
            mixer.gain.value = 1.0;

            // Connect: gainA + gainB -> mixer
            gainA.connect(mixer);
            gainB.connect(mixer);

            // Store references
            mixer._inputA = gainA;
            mixer._inputB = gainB;

            voice.nodes[`mixer_${module.id}`] = mixer;

            console.log(`[Mixer] ${module.name} DEPTH=${depth.toFixed(2)}: A=${gainA.gain.value.toFixed(3)}, B=${gainB.gain.value.toFixed(3)}`);
        });

        // Find gain modules (Gain, Level categories)
        const gains = this.gridData.modules.filter(m =>
            m.category === 'Gain' || m.category === 'Level'
        );

        gains.forEach(module => {
            const params = module.parameters || {};
            const gain = this.ctx.createGain();

            // GAIN parameter is in decibels - convert to linear
            if (params.GAIN) {
                const dB = params.GAIN.value;
                gain.gain.value = Math.pow(10, dB / 20); // dB to linear
            } else {
                gain.gain.value = 1.0; // Unity gain
            }

            voice.nodes[`gain_${module.id}`] = gain;
        });

        // Find shaper/distortion modules (Hardclip, etc.)
        const shapers = this.gridData.modules.filter(m =>
            m.category === 'Shaper' || m.name.toLowerCase().includes('clip')
        );

        shapers.forEach(module => {
            const shaper = this.createShaperNode(module);
            voice.nodes[`shaper_${module.id}`] = shaper;
        });

        // Master output gain
        voice.masterGain = this.ctx.createGain();
        voice.masterGain.gain.value = 0.3; // Overall volume

        // Connect the audio graph based on Grid connections
        this.connectVoiceGraph(voice);

        // Voice control methods
        voice.start = () => {
            const now = this.ctx.currentTime;
            console.log(`[Voice] Starting voice at ${now.toFixed(3)}s`);

            // Start all oscillators (look for osc_source_ nodes)
            Object.entries(voice.nodes).forEach(([key, node]) => {
                if (key.startsWith('osc_source_') && node.start) {
                    node.start(now);
                    console.log(`[Voice] Started oscillator: ${key}, freq=${node.frequency.value.toFixed(1)}Hz`);
                }
                // Also handle supersaw mixer nodes
                if (key.startsWith('osc_') && node.start && !key.includes('_source_') && !key.includes('_analyser_')) {
                    node.start(now);
                    console.log(`[Voice] Started oscillator: ${key}`);
                }
            });

            // Trigger all envelopes
            Object.entries(voice.nodes).forEach(([key, node]) => {
                if (key.startsWith('env_') && node.trigger) {
                    node.trigger(now);
                    console.log(`[Voice] Triggered envelope: ${key}`);
                }
            });
        };

        voice.stop = () => {
            voice.stopTime = this.ctx.currentTime;

            // Release all envelopes
            Object.entries(voice.nodes).forEach(([key, node]) => {
                if (key.startsWith('env_') && node.release) {
                    node.release(this.ctx.currentTime);
                }
            });

            // Schedule voice cleanup after longest release
            const maxRelease = this.getMaxReleaseTime();
            setTimeout(() => {
                // Stop oscillators (look for osc_source_ nodes which are the actual oscillators)
                Object.entries(voice.nodes).forEach(([key, node]) => {
                    if (key.startsWith('osc_source_') && node.stop) {
                        try { node.stop(); } catch (e) {}
                    }
                    // Also handle old-style oscillators (supersaw mixer nodes)
                    if (key.startsWith('osc_') && node.stop) {
                        try { node.stop(); } catch (e) {}
                    }
                });

                // Return filters to pool for reuse
                Object.entries(voice.nodes).forEach(([key, node]) => {
                    if (key.startsWith('filter_') && node._rfxWrapper) {
                        // Reset filter state
                        const filter = node._rfxWrapper;
                        if (filter.module && filter.module._ladder_reset) {
                            filter.module._ladder_reset(filter.filterPtr);
                        }
                        // Return to pool
                        this.filterPool.push(filter);
                        console.log('[AudioEngine] Returned filter to pool, available:', this.filterPool.length);
                    }
                });

                // Disconnect all nodes
                Object.values(voice.nodes).forEach(node => {
                    if (node.disconnect) node.disconnect();
                });
                if (voice.masterGain) voice.masterGain.disconnect();
            }, maxRelease * 1000 + 100);
        };

        return voice;
    }

    // Create oscillator node
    createOscillatorNode(module, baseFreq) {
        const params = module.parameters || {};

        // Get TIMBRE value (0.0 - 1.0)
        const timbre = params.TIMBRE ? params.TIMBRE.value : 0.5;

        // For sawtooth with TIMBRE control, create multiple detuned oscillators (supersaw)
        if (module.name.toLowerCase().includes('sawtooth') && timbre > 0.1) {
            // Create supersaw: number of voices based on TIMBRE
            const numVoices = Math.floor(1 + timbre * 6); // 1-7 voices
            const detune = timbre * 25; // Max detune in cents

            const mixer = this.ctx.createGain();
            mixer.gain.value = 1.0 / Math.sqrt(numVoices); // Normalize volume

            for (let i = 0; i < numVoices; i++) {
                const osc = this.ctx.createOscillator();
                osc.type = 'sawtooth';

                // Apply base frequency
                let freq = baseFreq;

                // WRAP = pitch offset in semitones
                if (params.WRAP && params.WRAP.value !== undefined) {
                    const semitones = params.WRAP.value;
                    freq = baseFreq * Math.pow(2, semitones / 12);
                }

                osc.frequency.value = freq;

                // Detune each voice
                if (numVoices > 1) {
                    const detuneAmount = (i - (numVoices - 1) / 2) * (detune / (numVoices - 1));
                    osc.detune.value = detuneAmount;
                }

                osc.connect(mixer);
                osc.start();

                // Store sub-oscillators for cleanup
                if (!mixer._oscillators) mixer._oscillators = [];
                mixer._oscillators.push(osc);
            }

            // Add stop method that stops all sub-oscillators
            mixer.stop = () => {
                if (mixer._oscillators) {
                    mixer._oscillators.forEach(osc => {
                        try { osc.stop(); } catch(e) {}
                    });
                }
            };

            return mixer;
        } else {
            // Single oscillator
            const osc = this.ctx.createOscillator();

            // Waveform
            if (module.name.toLowerCase().includes('sawtooth')) {
                osc.type = 'sawtooth';
            } else if (module.name.toLowerCase().includes('pulse')) {
                osc.type = 'square';
            } else {
                osc.type = 'sine';
            }

            // Base frequency
            osc.frequency.value = baseFreq;

            // WRAP = pitch offset in semitones (Sync parameter)
            if (params.WRAP && params.WRAP.value !== undefined) {
                const semitones = params.WRAP.value;
                osc.frequency.value = baseFreq * Math.pow(2, semitones / 12);
            }

            return osc;
        }
    }

    // Create envelope node (returns GainNode with envelope methods)
    createEnvelopeNode(module, velocity) {
        const envGain = this.ctx.createGain();
        envGain.gain.value = 0;

        const params = module.parameters || {};

        // Transform envelope times: UI_seconds = 8.0 × (stored/2.0)³
        const transformTime = (stored) => {
            return 8.0 * Math.pow(stored / 2.0, 3);
        };

        // Get envelope parameters
        let attack = 0.01;
        let decay = 0.1;
        let sustain = 1.0;
        let release = 0.1;

        if (params.ATTACK) {
            attack = Math.max(0.001, transformTime(params.ATTACK.value)); // Minimum 1ms
        }
        if (params.DECAY) {
            decay = transformTime(params.DECAY.value);
        }
        if (params.SUSTAIN) {
            sustain = params.SUSTAIN.value;
        }
        if (params.RELEASE) {
            release = transformTime(params.RELEASE.value);
        }

        console.log(`[Envelope] ${module.name}: A=${(attack*1000).toFixed(1)}ms D=${(decay*1000).toFixed(1)}ms S=${(sustain*100).toFixed(1)}% R=${(release*1000).toFixed(1)}ms`);

        // Add envelope trigger method
        envGain.trigger = (startTime) => {
            const g = envGain.gain;
            g.cancelScheduledValues(startTime);
            g.setValueAtTime(0, startTime);

            // Attack
            g.linearRampToValueAtTime(velocity, startTime + attack);

            // Decay to sustain
            if (module.name.includes('ADSR') || module.name.includes('AD')) {
                g.linearRampToValueAtTime(sustain * velocity, startTime + attack + decay);
            }
        };

        // Add envelope release method
        envGain.release = (releaseTime) => {
            const g = envGain.gain;
            g.cancelScheduledValues(releaseTime);
            g.setValueAtTime(g.value, releaseTime);
            g.linearRampToValueAtTime(0, releaseTime + release);
        };

        return envGain;
    }

    // Create filter node (reuses pre-initialized filters from pool)
    async createFilterNode(module) {
        // Get filter from pre-initialized pool (no WASM loading during playback!)
        const filterWrapper = this.filterPool.shift();

        if (!filterWrapper) {
            console.error('[AudioEngine] Filter pool exhausted! Creating new filter (will cause crackling)');
            const newFilter = new RFXLadderFilter(this.ctx);
            await newFilter.init();
            return this.setupFilterNode(newFilter, module);
        }

        return this.setupFilterNode(filterWrapper, module);
    }

    // Setup filter parameters and return node
    setupFilterNode(filterWrapper, module) {
        const params = module.parameters || {};

        // CUTOFF (0-127 → 20Hz-20kHz, exponential)
        if (params.CUTOFF) {
            const cutoff = params.CUTOFF.value;
            filterWrapper.frequency = 20 * Math.pow(1000, cutoff / 127);
        } else {
            filterWrapper.frequency = 1000;
        }

        // RESONANCE (0-1 → Q factor 1-30)
        if (params.RESONANCE) {
            filterWrapper.Q = 1 + params.RESONANCE.value * 30;
        } else {
            filterWrapper.Q = 1;
        }

        console.log('[AudioEngine] Using pre-loaded RFX Ladder Filter from pool');

        // Return the AudioWorklet node
        const node = filterWrapper.workletNode;

        // Attach wrapper for parameter access
        node._rfxWrapper = filterWrapper;
        node.frequency = filterWrapper.frequency;
        node.Q = filterWrapper.Q;

        return node;
    }

    // Create shaper node (distortion/hardclip)
    createShaperNode(module) {
        const params = module.parameters || {};

        // For hard clip, use simple gain with clipping
        const shaper = this.ctx.createGain();

        // DRIVE parameter controls the gain before clipping
        if (params.DRIVE) {
            shaper.gain.value = 1 + params.DRIVE.value * 10; // Scale drive
        } else {
            shaper.gain.value = 1;
        }

        return shaper;
    }

    // Connect voice audio graph
    connectVoiceGraph(voice) {
        if (!this.gridData) return;

        // Build connection map
        this.gridData.modules.forEach(module => {
            const params = module.parameters || {};
            const destNode = voice.nodes[`osc_${module.id}`] ||
                           voice.nodes[`filter_${module.id}`] ||
                           voice.nodes[`mixer_${module.id}`] ||
                           voice.nodes[`gain_${module.id}`] ||
                           voice.nodes[`shaper_${module.id}`] ||
                           voice.nodes[`env_${module.id}`];

            if (!destNode) return;

            // Find incoming connections
            Object.entries(params).forEach(([paramName, paramData]) => {
                if (paramData.type === 'connection' && paramData.from_module) {
                    const srcModule = this.gridData.modules.find(m => m.name === paramData.from_module);
                    if (srcModule) {
                        const srcNode = voice.nodes[`osc_${srcModule.id}`] ||
                                      voice.nodes[`env_${srcModule.id}`] ||
                                      voice.nodes[`filter_${srcModule.id}`] ||
                                      voice.nodes[`mixer_${srcModule.id}`] ||
                                      voice.nodes[`gain_${srcModule.id}`] ||
                                      voice.nodes[`shaper_${srcModule.id}`];

                        if (srcNode) {
                            // Check if this is a modulation connection (e.g., envelope to filter)
                            if (paramName === 'MOD_IN' && destNode.frequency) {
                                // Check if this is an RFX filter (WASM-based)
                                if (destNode._rfxWrapper) {
                                    // RFX filter - use custom modulation wrapper
                                    destNode._rfxWrapper.connectModulation(srcNode, 0.8);
                                    console.log(`[Connect] ${srcModule.name} (env) -> ${module.name} (mod) [RFX]`);
                                } else {
                                    // Web Audio filter - standard AudioParam modulation
                                    const modGain = this.ctx.createGain();
                                    modGain.gain.value = 5000; // Modulation depth
                                    srcNode.connect(modGain);
                                    modGain.connect(destNode.frequency);
                                    console.log(`[Connect] ${srcModule.name} (env) -> ${module.name} (mod)`);
                                }
                            } else if (module.category === 'Mix' && (paramName === 'IN' || paramName === 'IN2')) {
                                // Mixer/Blend module - route to correct input
                                if (paramName === 'IN' && destNode._inputA) {
                                    srcNode.connect(destNode._inputA);
                                    console.log(`[Connect] ${srcModule.name} -> ${module.name} (Input A)`);
                                } else if (paramName === 'IN2' && destNode._inputB) {
                                    srcNode.connect(destNode._inputB);
                                    console.log(`[Connect] ${srcModule.name} -> ${module.name} (Input B)`);
                                } else {
                                    // Fallback for old-style mixer
                                    srcNode.connect(destNode);
                                    console.log(`[Connect] ${srcModule.name} -> ${module.name}`);
                                }
                            } else {
                                // Regular audio connection
                                srcNode.connect(destNode);
                                console.log(`[Connect] ${srcModule.name} -> ${module.name}`);
                            }
                        }
                    }
                }
            });
        });

        // Connect final output to master gain
        // Find the "Audio Out" module and what connects to it
        const audioOutModule = this.gridData.modules.find(m =>
            m.name.toLowerCase().includes('audio out') ||
            m.name.toLowerCase().includes('output') ||
            m.category === 'Output'
        );

        if (audioOutModule) {
            // Find what module connects TO Audio Out
            const params = audioOutModule.parameters || {};
            let finalSourceNode = null;

            Object.entries(params).forEach(([paramName, paramData]) => {
                if (paramData.type === 'connection' && paramData.from_module) {
                    const srcModule = this.gridData.modules.find(m => m.name === paramData.from_module);
                    if (srcModule) {
                        finalSourceNode = voice.nodes[`gain_${srcModule.id}`] ||
                                        voice.nodes[`filter_${srcModule.id}`] ||
                                        voice.nodes[`mixer_${srcModule.id}`] ||
                                        voice.nodes[`shaper_${srcModule.id}`] ||
                                        voice.nodes[`osc_${srcModule.id}`];

                        if (finalSourceNode) {
                            console.log(`[Connect] ${srcModule.name} -> Audio Out -> destination`);
                        }
                    }
                }
            });

            if (finalSourceNode) {
                finalSourceNode.connect(voice.masterGain);
                voice.masterGain.connect(this.analyser);
            } else {
                console.warn('[AudioEngine] No source found for Audio Out');
            }
        } else {
            console.warn('[AudioEngine] No Audio Out module found');
        }
    }

    // Get maximum release time from all envelopes
    getMaxReleaseTime() {
        if (!this.gridData) return 0.1;

        let maxRelease = 0.1;
        const envelopes = this.gridData.modules.filter(m => m.category === 'Envelope');

        envelopes.forEach(module => {
            const params = module.parameters || {};
            if (params.RELEASE) {
                const release = 8.0 * Math.pow(params.RELEASE.value / 2.0, 3);
                maxRelease = Math.max(maxRelease, release);
            }
        });

        return maxRelease;
    }

    // Keyboard support
    setupKeyboard(keyMap) {
        // Default keyboard mapping (QWERTY piano)
        const defaultMap = {
            'a': 60, // C4
            'w': 61, // C#4
            's': 62, // D4
            'e': 63, // D#4
            'd': 64, // E4
            'f': 65, // F4
            't': 66, // F#4
            'g': 67, // G4
            'y': 68, // G#4
            'h': 69, // A4
            'u': 70, // A#4
            'j': 71, // B4
            'k': 72, // C5
        };

        const map = keyMap || defaultMap;
        const heldKeys = new Set();

        window.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();
            if (map[key] && !heldKeys.has(key)) {
                heldKeys.add(key);
                this.noteOn(map[key], 1.0);
            }
        });

        window.addEventListener('keyup', (e) => {
            const key = e.key.toLowerCase();
            if (map[key]) {
                heldKeys.delete(key);
                this.noteOff(map[key]);
            }
        });

        console.log('[AudioEngine] Keyboard enabled (QWERTY piano, keys: a-k)');
    }

    // All notes off (panic button)
    allNotesOff() {
        this.voices.forEach((voice, note) => {
            this.noteOff(note);
        });
    }
}
