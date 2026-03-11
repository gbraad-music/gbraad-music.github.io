// RFX Effects & Synths Integration for Strudel
// Makes RFX synths and effects available as Strudel pattern methods

export class RFXIntegration {
    constructor() {
        this.audioContext = null;
        this.synths = new Map(); // { name: synthInfo }
        this.loadedSynths = new Map(); // { name: wasmInstance }
        this.loadingSynths = new Set(); // Track synths currently loading
        this.effects = new Map(); // { name: effectNode }
        this.synthParams = new Map(); // Store parameter values per synth
        this.scheduledNotes = new Set(); // Track scheduled setTimeout IDs
        this.activeNotes = new Map(); // Track currently playing notes: Map<synthName, Set<noteNumber>>

        // Synth instance tracking with IDs
        this.synthInstanceCounter = 0;
        this.synthInstances = new Map(); // { instanceId: { name, instance, params, metadata } }

        // Note name to MIDI number conversion
        this.noteMap = {};
        const noteNames = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
        for (let octave = -1; octave <= 9; octave++) {
            for (let i = 0; i < noteNames.length; i++) {
                const noteName = noteNames[i] + octave;
                const midiNote = (octave + 1) * 12 + i;
                this.noteMap[noteName] = midiNote;
                // Also support 'db' instead of 'c#', etc.
                if (noteNames[i].includes('#')) {
                    const flatName = String.fromCharCode(noteNames[i].charCodeAt(0) + 1) + 'b' + octave;
                    this.noteMap[flatName] = midiNote;
                }
            }
        }

        this.params = new Proxy({}, {
            get: (target, prop) => {
                if (!(prop in target)) {
                    target[prop] = 0.5; // Default value
                    // console.log(`🎛️ Creating new param: ${prop}`);
                    // Notify UI to create a knob
                    window.dispatchEvent(new CustomEvent('rfx:newparam', {
                        detail: { name: prop, value: 0.5 }
                    }));
                }
                return target[prop];
            },
            set: (target, prop, value) => {
                // console.log(`🎛️ Proxy setter: ${prop} = ${value}`);
                target[prop] = value;

                // Handle scoped parameters (label:param format)
                if (prop.includes(':')) {
                    const [label, paramName] = prop.split(':');
                    // Update only synths with this label
                    this.updateParameterForLabel(label, paramName, value);
                } else {
                    // Update all loaded synths that have this parameter (unscoped)
                    this.updateParameterAllSynths(prop, value);
                }

                return true;
            }
        });

        // Expose params globally for Strudel patterns
        window.rfxParams = this.params;
    }

    async init(audioContext) {
        this.audioContext = audioContext;
        console.log('🎹 Initializing RFX Integration...');

        // Load available synths
        await this.loadSynths();

        console.log('✅ RFX Integration ready');
    }

    async loadSynths() {
        // List of available RFX synths
        const synthModules = [
            { name: 'rg909', js: '../rfxsynths/rg909-drum.js', wasm: '../rfxsynths/rg909-drum.wasm' },
            { name: 'rgahxsynth', js: '../rfxsynths/rgahxsynth.js', wasm: '../rfxsynths/rgahxsynth.wasm' },
            { name: 'rgahxdrum', js: '../rfxsynths/rgahxdrum.js', wasm: '../rfxsynths/rgahxdrum.wasm' },
            { name: 'rgsidsynth', js: '../rfxsynths/rgsidsynth.js', wasm: '../rfxsynths/rgsidsynth.wasm' },
            { name: 'rgresonate1', js: '../rfxsynths/rgresonate1-synth.js', wasm: '../rfxsynths/rgresonate1-synth.wasm' },
            { name: 'rvbass', js: '../rfxsynths/rvbass.js', wasm: '../rfxsynths/rvbass.wasm' },
            { name: 'rvkeys', js: '../rfxsynths/rvkeys.js', wasm: '../rfxsynths/rvkeys.wasm' },
            { name: 'rg1piano', js: '../rfxsynths/rg1piano.js', wasm: '../rfxsynths/rg1piano.wasm' },
        ];

        for (const synth of synthModules) {
            this.synths.set(synth.name, synth);
            console.log(`📦 Registered synth: ${synth.name}`);
        }

        // GM drum mapping for sample names
        this.drumMap = {
            // Kick variations
            'bd': 36, 'kick': 36, 'bassdrum': 36,
            // Snare variations
            'sd': 38, 'snare': 38, 'sn': 38,
            // Rimshot
            'rim': 37, 'rimshot': 37,
            // Hi-hats
            'hh': 42, 'hihat': 42, 'chh': 42, 'closedhh': 42,
            'oh': 46, 'openhh': 46, 'openhat': 46,
            // Toms
            'lt': 41, 'lowtom': 41,
            'mt': 47, 'midtom': 47,
            'ht': 50, 'hightom': 50,
            // Clap
            'cp': 39, 'clap': 39, 'handclap': 39,
            // Crash
            'crash': 49, 'cr': 49,
            // Ride
            'ride': 51, 'rd': 51
        };
    }

    // Register RFX synths with Strudel
    registerStrudelMethods() {
        // Register synths by name (e.g., s("rgahxdrum"))
        if (window.superdough?.registerSound) {
            for (const [name] of this.synths) {
                window.superdough.registerSound(name, async (t, value, onended) => {
                    await this.playRFXSynth(name, value, t);
                    if (onended) onended();
                });
            }
        } else if (window.registerSound) {
            for (const [name] of this.synths) {
                window.registerSound(name, (time, hap) => {
                    this.playRFXSynth(name, hap, time);
                });
            }
        } else {
            console.warn('⚠️ No sound registration API found');
        }

        // Also register drum sample names to trigger drums
        // This allows s("bd hh sd") syntax
        if (window.registerSound) {
            for (const sampleName of Object.keys(this.drumMap)) {
                window.registerSound(sampleName, (time, hap) => {
                    // Use rgahxdrum as default drum engine for sample names
                    this.playRFXSynth('rgahxdrum', { ...hap, s: sampleName }, time);
                });
            }
            console.log(`✅ Registered ${Object.keys(this.drumMap).length} drum sample names`);
        }

        // Add .knob() method to Pattern
        // Usage: note("c2 ~ e2 ~").s("rvbass").knob("cutoff").bpm(120)
        if (window.Pattern?.prototype) {
            window.Pattern.prototype.knob = function(paramName) {
                return this.fmap(hap => {
                    // Mark this parameter as active for this synth
                    // Don't create the knob yet - wait until playback when we have the label
                    if (!hap._rfx_knobs) {
                        hap._rfx_knobs = [];
                    }
                    hap._rfx_knobs.push(paramName);

                    return hap;
                });
            };

            // Add .bpm() method - converts BPM to CPM
            window.Pattern.prototype.bpm = function(beatsPerMinute) {
                const cyclesPerMinute = beatsPerMinute / 2;
                return this.cpm(cyclesPerMinute);
            };

            // Add .vel() method - set constant velocity (0.0-1.0)
            window.Pattern.prototype.vel = function(velocityValue) {
                return this.velocity(velocityValue);
            };

            console.log('✅ Registered .knob(), .bpm(), and .vel() pattern methods');
        } else {
            console.warn('⚠️ Pattern.prototype not found, .knob() and .bpm() methods not registered');
        }
    }

    // Play RFX synth when triggered by Strudel
    async playRFXSynth(synthName, hap, time) {
        const synthInfo = this.synths.get(synthName);
        if (!synthInfo) return;

        // Load WASM synth if not already loaded
        if (!this.loadedSynths.has(synthName)) {
            console.warn(`⚠️ ${synthName} not preloaded! Loading now...`);
            const loadStart = performance.now();
            // Check if already loading
            if (this.loadingSynths.has(synthName)) {
                // Wait for it to finish loading
                while (this.loadingSynths.has(synthName)) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            } else {
                this.loadingSynths.add(synthName);
                await this.loadWASMSynth(synthName, synthInfo);
                this.loadingSynths.delete(synthName);
            }
            console.warn(`⏱️ ${synthName} loaded in ${(performance.now() - loadStart).toFixed(0)}ms`);
        }

        // Find or assign synth instance for this hap
        let assignedInstance = null;

        // Update synth instance label from hap metadata
        if (hap._label) {
            for (const inst of this.synthInstances.values()) {
                if (inst.name === synthName && !inst.label) {
                    inst.label = hap._label;
                    assignedInstance = inst;
                    // Emit event to update UI
                    window.dispatchEvent(new CustomEvent('rfx:synthLabelUpdated', {
                        detail: { id: inst.id, label: hap._label }
                    }));
                    break;
                }
            }
        } else {
            // No label: find first instance without a label, or create association with instance ID
            for (const inst of this.synthInstances.values()) {
                if (inst.name === synthName && !inst.label) {
                    assignedInstance = inst;
                    break;
                }
            }
        }

        // Get label to use for scoping (either pattern label or instance ID)
        const scopeLabel = hap._label || (assignedInstance ? assignedInstance.id : synthName);

        // Create scoped knobs if pattern has .knob() calls
        if (hap._rfx_knobs && hap._rfx_knobs.length > 0) {
            for (const paramName of hap._rfx_knobs) {
                const scopedName = `${scopeLabel}:${paramName}`;

                // Access rfxParams to ensure it exists (triggers proxy)
                if (!(scopedName in window.rfxParams)) {
                    window.rfxParams[scopedName] = 0.5;
                    // Emit event to create knob
                    window.dispatchEvent(new CustomEvent('rfx:newparam', {
                        detail: {
                            name: scopedName,
                            value: 0.5,
                            label: scopeLabel,
                            paramName: paramName
                        }
                    }));
                }
            }
        }

        const synthInstance = this.loadedSynths.get(synthName);
        if (!synthInstance) return;

        // Apply scoped knob parameters to this synth before playing
        if (hap._rfx_knobs && synthInstance.setParameter) {
            for (const paramName of hap._rfx_knobs) {
                const scopedName = `${scopeLabel}:${paramName}`;
                const value = window.rfxParams[scopedName];

                // Find parameter by name
                const paramInfo = this.getParameterByName(synthName, paramName);
                if (paramInfo && value !== undefined) {
                    synthInstance.setParameter(paramInfo.index, value);
                }
            }
        }

        // Get note from hap - support MIDI numbers, note names, and sample names
        let note = hap.note || 60;

        // Convert note name to MIDI number if it's a string
        if (typeof note === 'string') {
            const noteLower = note.toLowerCase();
            // Check note map first (c4, d#5, etc.)
            let midiNote = this.noteMap[noteLower];
            // If not found, check drum map (bd, sd, hh, etc.)
            if (midiNote === undefined) {
                midiNote = this.drumMap[noteLower];
            }
            if (midiNote !== undefined) {
                note = midiNote;
            } else {
                console.warn(`Unknown note name: ${note}, defaulting to 60`);
                note = 60;
            }
        }

        // If hap has 's' (sample name), map it to MIDI note
        if (hap.s && this.drumMap[hap.s]) {
            note = this.drumMap[hap.s];
        }

        // Use constant velocity unless explicitly set in pattern
        // (Strudel's built-in drums don't respond to automatic velocity variations)
        const velocity = hap.velocity !== undefined ? hap.velocity : 1.0;
        const duration = hap.duration || 0.5;

        // Only apply explicit param_* values from the hap (for per-note parameter changes)
        // Global knob parameters are already set via updateParameterAllSynths() when knobs change
        if (synthInstance.setParameter) {
            for (const [key, value] of Object.entries(hap)) {
                if (key.startsWith('param_')) {
                    const paramName = key.substring(6); // Remove 'param_' prefix

                    // Support both index numbers and names
                    let paramIndex = parseInt(paramName);
                    if (isNaN(paramIndex)) {
                        // Try to find by name
                        const paramInfo = this.getParameterByName(synthName, paramName);
                        if (paramInfo) {
                            paramIndex = paramInfo.index;
                        } else {
                            console.warn(`[${synthName}] Parameter "${paramName}" not found, skipping`);
                            continue;
                        }
                    }

                    // Normalize value to 0-1 range if it's 0-127
                    let normalizedValue = value;
                    if (value > 1) {
                        normalizedValue = value / 127;
                    }

                    synthInstance.setParameter(paramIndex, normalizedValue);
                }
            }
        }

        // Calculate clock offset on first note, then use it for all notes
        const now = this.audioContext.currentTime;
        if (this.clockOffset === undefined) {
            this.clockOffset = time - now;
            console.log(`🕐 Clock offset: ${this.clockOffset.toFixed(2)}s (Strudel ahead of AudioContext)`);
        }

        // Adjust Strudel's time by the offset to sync with AudioContext
        const adjustedTime = time - this.clockOffset;
        const delaySeconds = Math.max(0, adjustedTime - now);
        const delayMs = delaySeconds * 1000;

        // Schedule note trigger (immediate)
        const timeoutId = setTimeout(() => {
            this.scheduledNotes.delete(timeoutId);
            try {
                synthInstance.noteOn(note, velocity);

                // Track active note
                if (!this.activeNotes.has(synthName)) {
                    this.activeNotes.set(synthName, new Set());
                }
                this.activeNotes.get(synthName).add(note);

                // Schedule note off
                const offTimeoutId = setTimeout(() => {
                    this.scheduledNotes.delete(offTimeoutId);
                    synthInstance.noteOff(note);

                    // Remove from active notes
                    const activeSet = this.activeNotes.get(synthName);
                    if (activeSet) {
                        activeSet.delete(note);
                        if (activeSet.size === 0) {
                            this.activeNotes.delete(synthName);
                        }
                    }
                }, duration * 1000);
                this.scheduledNotes.add(offTimeoutId);
            } catch (error) {
                console.error(`❌ Error playing ${synthName}:`, error);
            }
        }, delayMs);
        this.scheduledNotes.add(timeoutId);
    }

    // Load WASM synth module
    async loadWASMSynth(name, synthInfo) {
        try {
            const loadStart = performance.now();
            console.log(`📦 Loading WASM synth: ${name}`);

            // First, load the synth wrapper class from SynthRegistry (for parameter metadata)
            // Only if not already registered
            if (typeof window.SynthRegistry !== 'undefined' && !window.SynthRegistry.has(name)) {
                try {
                    await window.SynthRegistry.loadSynthClass(name);
                    // console.log(`✓ Loaded wrapper class for ${name}`);
                } catch (error) {
                    // Silently ignore - not all synths have wrapper classes
                    // console.warn(`Failed to load wrapper class for ${name}:`, error);
                }
            }

            // Fetch the JS code as text (can't capture memory from script tag)
            const response = await fetch(synthInfo.js);
            const jsCode = await response.text();


            // Find the module name from the JS code
            const match = jsCode.match(/var (\w+Module)=/);
            if (!match) {
                throw new Error('Could not find Module name in JS code');
            }
            const moduleName = match[1];
            console.log(`Found module name: ${moduleName}`);

            // Modify the code to:
            // 1. Inject memory capture
            // 2. Make the module global instead of local var
            let modifiedCode = jsCode
                .replace(';return moduleRtn', ';globalThis.__wasmMemory=wasmMemory;return moduleRtn')
                .replace(`var ${moduleName}=`, `globalThis.${moduleName}=`);

            // Eval the modified code
            eval(modifiedCode);

            // Get the factory from global
            const ModuleFactory = globalThis[moduleName];

            if (!ModuleFactory) {
                throw new Error(`Module factory ${moduleName} not found on globalThis`);
            }

            console.log(`✓ Got ${moduleName} factory`);

            // Fetch WASM bytes
            const wasmResponse = await fetch(synthInfo.wasm);
            const wasmBytes = await wasmResponse.arrayBuffer();

            // Call the factory with WASM bytes
            const wasmModule = await ModuleFactory({
                wasmBinary: wasmBytes
            });

            // Capture the memory reference that was injected
            const wasmMemory = globalThis.__wasmMemory;
            delete globalThis.__wasmMemory;

            if (!wasmMemory) {
                throw new Error('wasmMemory was not captured');
            }

            console.log(`✓ Got WASM memory, buffer size: ${wasmMemory.buffer.byteLength}`);

            // Detect if this is a drum or synth based on available functions
            const isDrum = !!wasmModule[`_${name}_create`];
            const isSynth = !!wasmModule._regroove_synth_create;

            let createFunc, triggerFunc, processFunc;

            if (isDrum) {
                // Drum API: _<name>_create, _<name>_trigger, _<name>_process
                createFunc = wasmModule[`_${name}_create`];
                triggerFunc = wasmModule[`_${name}_trigger`] || wasmModule[`_${name}_trigger_drum`];
                processFunc = wasmModule[`_${name}_process`] || wasmModule[`_${name}_process_f32`];
            } else if (isSynth) {
                // Synth API: _regroove_synth_create, _regroove_synth_note_on, _regroove_synth_process_f32
                createFunc = wasmModule._regroove_synth_create;
                triggerFunc = wasmModule._regroove_synth_note_on;
                processFunc = wasmModule._regroove_synth_process_f32;
            } else {
                throw new Error(`${name} has unknown API`);
            }

            if (!createFunc || !triggerFunc || !processFunc) {
                throw new Error(`${name} missing required functions`);
            }

            const createSampleRate = this.audioContext.sampleRate;
            console.log(`Creating ${name} with sampleRate=${createSampleRate}`);
            const synthPtr = createFunc(createSampleRate);
            console.log(`Created synth instance, ptr=${synthPtr}, sampleRate=${createSampleRate}`);

            // Detect output format
            // RG909: 4 params, stereo output
            // RGAHX drums: 3 params, mono output
            // Regroove synths: 4 params, stereo output
            const isRG909 = name.includes('909');
            const isStereoOutput = isRG909 || isSynth;  // Synths output stereo, RGAHX drums are mono

            // Create ScriptProcessor for audio output
            const bufferSize = 512;
            const processor = this.audioContext.createScriptProcessor(bufferSize, 0, 2);

            // Allocate buffer (stereo for RG909/synths, mono for RGAHX drums)
            const channelCount = isStereoOutput ? 2 : 1;
            const outputBuffer = wasmModule._malloc(bufferSize * 4 * channelCount); // float32

            const sampleRate = this.audioContext.sampleRate;
            processor.onaudioprocess = (e) => {
                // Process audio from WASM
                // RG909 & Synths: 4 params (ptr, buffer, frames, sampleRate)
                // RGAHX drums: 3 params (ptr, buffer, frames)
                if (isRG909 || isSynth) {
                    processFunc(synthPtr, outputBuffer, bufferSize, sampleRate);
                } else {
                    processFunc(synthPtr, outputBuffer, bufferSize);
                }

                // Create Float32Array view of the WASM buffer
                const heapF32 = new Float32Array(
                    wasmMemory.buffer,
                    outputBuffer,
                    bufferSize * channelCount
                );

                const left = e.outputBuffer.getChannelData(0);
                const right = e.outputBuffer.getChannelData(1);

                if (isStereoOutput) {
                    // De-interleave stereo output (RG909, synths)
                    for (let i = 0; i < bufferSize; i++) {
                        left[i] = heapF32[i * 2];
                        right[i] = heapF32[i * 2 + 1];
                    }
                } else {
                    // Mono output, duplicate to both channels (RGAHX drums)
                    for (let i = 0; i < bufferSize; i++) {
                        const sample = heapF32[i];
                        left[i] = sample;
                        right[i] = sample;
                    }
                }
            };

            processor.connect(this.audioContext.destination);

            // Make sure AudioContext is running
            if (this.audioContext.state !== 'running') {
                console.warn(`⚠️ AudioContext state: ${this.audioContext.state} - attempting to resume`);
                await this.audioContext.resume();
                console.log(`AudioContext state after resume: ${this.audioContext.state}`);
            } else {
                console.log(`✓ AudioContext is running`);
            }

            // Get parameter info from SynthRegistry (if available)
            let parameterInfo = null;
            if (isSynth) {
                // Try to get parameter metadata from SynthRegistry
                if (typeof window.SynthRegistry !== 'undefined') {
                    try {
                        const synthDescriptor = window.SynthRegistry.get(name);
                        if (synthDescriptor && synthDescriptor.getParameterInfo) {
                            parameterInfo = synthDescriptor.getParameterInfo();
                            console.log(`[${name}] Loaded ${parameterInfo.length} parameter definitions from SynthRegistry`);
                            // Log parameter names for debugging
                            const paramNames = parameterInfo.map(p => `${p.index}:${p.name}`).join(', ');
                            console.log(`[${name}] Parameters: ${paramNames}`);
                        } else {
                            console.warn(`[${name}] Not found in SynthRegistry or missing getParameterInfo`);
                        }
                    } catch (error) {
                        console.warn(`[${name}] Failed to get parameter info from registry:`, error);
                    }
                }

                // Fallback: just get parameter count from WASM
                if (!parameterInfo && wasmModule._regroove_synth_get_parameter_count) {
                    const paramCount = wasmModule._regroove_synth_get_parameter_count(synthPtr);
                    console.log(`[${name}] Has ${paramCount} parameters (use param_0, param_1, ... param_${paramCount-1})`);
                    parameterInfo = [];
                }
            }

            // Create audio worklet wrapper
            const synthInstance = {
                module: wasmModule,
                memory: wasmMemory,
                synthPtr,
                processor,
                isDrum,
                isSynth,
                parameterInfo,
                setParameter: isSynth && wasmModule._regroove_synth_set_parameter
                    ? (index, value) => wasmModule._regroove_synth_set_parameter(synthPtr, index, value)
                    : null,
                noteOn: (note, velocity = 0.8) => {
                    const vel = Math.floor(velocity * 127);
                    // console.log(`[${name}] noteOn: note=${note}, vel=${vel}, isDrum=${isDrum}, isSynth=${isSynth}`);
                    if (isDrum) {
                        // Drum API: (ptr, note, vel) or (ptr, note, vel, sampleRate) for RG909
                        if (isRG909) {
                            triggerFunc(synthPtr, note, vel, this.audioContext.sampleRate);
                        } else {
                            triggerFunc(synthPtr, note, vel);
                        }
                    } else if (isSynth) {
                        // Synth API: _regroove_synth_note_on(ptr, note, velocity)
                        triggerFunc(synthPtr, note, vel);
                    }
                },
                noteOff: (note) => {
                    if (isSynth && wasmModule._regroove_synth_note_off) {
                        // console.log(`[${name}] noteOff: note=${note}`);
                        wasmModule._regroove_synth_note_off(synthPtr, note);
                    }
                    // Drums don't need noteOff
                }
            };

            this.loadedSynths.set(name, synthInstance);

            // Register instance with ID for external access
            const instanceId = `${name}_${this.synthInstanceCounter++}`;
            this.synthInstances.set(instanceId, {
                id: instanceId,
                name: name,
                instance: synthInstance,
                params: this.synthParams.get(name) || new Map(),
                metadata: synthInfo,
                label: null  // Will be set when pattern plays
            });

            // Emit event for UI integration
            window.dispatchEvent(new CustomEvent('rfx:synthLoaded', {
                detail: { id: instanceId, name: name }
            }));

            const loadEnd = performance.now();
            console.log(`✅ Loaded ${name} (ID: ${instanceId}) in ${(loadEnd - loadStart).toFixed(0)}ms`);
        } catch (error) {
            console.error(`❌ Failed to load ${name}:`, error);
        }
    }

    // Load script dynamically
    loadScript(url) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    // Get list of available synths
    getSynthList() {
        return Array.from(this.synths.keys());
    }

    // Get all parameters currently in use
    getParams() {
        return { ...this.params };
    }

    // Set parameter value
    setParam(name, value) {
        this.params[name] = value;
    }

    // Get parameter info by name for a synth
    getParameterByName(synthName, paramName) {
        const synthInstance = this.loadedSynths.get(synthName);
        if (!synthInstance || !synthInstance.parameterInfo) return null;

        // Normalize parameter name (lowercase, remove spaces/underscores/parens)
        const normalizedName = paramName.toLowerCase().replace(/[_\s()]/g, '');

        // First try exact match
        let param = synthInstance.parameterInfo.find(p =>
            p.name.toLowerCase().replace(/[_\s()]/g, '') === normalizedName
        );

        // If no exact match, try partial match (contains)
        if (!param) {
            param = synthInstance.parameterInfo.find(p =>
                p.name.toLowerCase().replace(/[_\s()]/g, '').includes(normalizedName)
            );
        }

        return param;
    }

    // Update a parameter across all loaded synths
    updateParameterAllSynths(paramName, value) {
        for (const [synthName, synthInstance] of this.loadedSynths) {
            if (!synthInstance.setParameter || !synthInstance.parameterInfo) continue;

            const paramInfo = this.getParameterByName(synthName, paramName);
            if (paramInfo) {
                // Normalize value to 0-1 range if it's 0-127
                let normalizedValue = value;
                if (value > 1) {
                    normalizedValue = value / 127;
                }

                synthInstance.setParameter(paramInfo.index, normalizedValue);
                // console.log(`[${synthName}] Updated ${paramInfo.name} (${paramInfo.index}) = ${normalizedValue.toFixed(2)}`);
            }
        }
    }

    // Update a parameter only for synth instances with a specific label or instance ID
    updateParameterForLabel(label, paramName, value) {
        // Find synth instances with this label OR instance ID
        for (const inst of this.synthInstances.values()) {
            // Match by label (e.g., "r") OR by instance ID (e.g., "rvbass_0")
            if (inst.label !== label && inst.id !== label) continue;

            const synthInstance = inst.instance;
            if (!synthInstance.setParameter || !synthInstance.parameterInfo) continue;

            const paramInfo = this.getParameterByName(inst.name, paramName);
            if (paramInfo) {
                // Normalize value to 0-1 range if it's 0-127
                let normalizedValue = value;
                if (value > 1) {
                    normalizedValue = value / 127;
                }

                synthInstance.setParameter(paramInfo.index, normalizedValue);
                // console.log(`[${inst.name}:${label}] Updated ${paramInfo.name} (${paramInfo.index}) = ${normalizedValue.toFixed(2)}`);
            }
        }
    }

    // Clear all knobs and parameters
    clearKnobs() {
        // Reset params object
        for (const key of Object.keys(this.params)) {
            delete this.params[key];
        }

        // Notify UI to clear knobs
        window.dispatchEvent(new CustomEvent('rfx:clearknobs'));
    }

    // Stop all scheduled notes (for when playback stops)
    stopAll() {
        console.log(`🛑 Canceling ${this.scheduledNotes.size} scheduled notes`);

        // Cancel all scheduled timeouts (future note-ons and note-offs)
        for (const timeoutId of this.scheduledNotes) {
            clearTimeout(timeoutId);
        }
        this.scheduledNotes.clear();

        // Reset timing reference for next playback
        this.clockOffset = undefined;

        // Send noteOff to all currently playing notes to stop stuck notes
        // console.log(`🛑 Sending noteOff to ${this.activeNotes.size} active synths`);
        for (const [synthName, noteSet] of this.activeNotes) {
            const synthInstance = this.loadedSynths.get(synthName);
            if (synthInstance && synthInstance.noteOff) {
                for (const note of noteSet) {
                    // console.log(`[${synthName}] Emergency noteOff: ${note}`);
                    synthInstance.noteOff(note);
                }
            }
        }
        this.activeNotes.clear();
    }

    // Preload synths used in a pattern (extract synth names from code)
    async preloadSynths(code) {
        const synthNames = [];
        for (const [name] of this.synths) {
            if (code.includes(`"${name}"`) || code.includes(`'${name}'`)) {
                synthNames.push(name);
            }
        }

        if (synthNames.length > 0) {
            console.log(`📦 Preloading synths: ${synthNames.join(', ')}`);
            const preloadStart = performance.now();

            // Load in parallel for speed
            const loadPromises = synthNames.map(name => {
                const synthInfo = this.synths.get(name);
                if (synthInfo && !this.loadedSynths.has(name) && !this.loadingSynths.has(name)) {
                    this.loadingSynths.add(name);
                    return this.loadWASMSynth(name, synthInfo).finally(() => {
                        this.loadingSynths.delete(name);
                    });
                }
                return Promise.resolve();
            });

            await Promise.all(loadPromises);
            const preloadEnd = performance.now();
            console.log(`✅ All synths preloaded in ${(preloadEnd - preloadStart).toFixed(0)}ms`);
        }
    }

    // ==================== PUBLIC API FOR EXTERNAL ACCESS ====================

    // Get all loaded synth instances
    getLoadedSynths() {
        return Array.from(this.synthInstances.values()).map(inst => ({
            id: inst.id,
            name: inst.name,
            parameters: this.getParameterInfo(inst.name)
        }));
    }

    // Get synth instance by ID
    getSynthById(instanceId) {
        return this.synthInstances.get(instanceId);
    }

    // Get synth instance by name (returns first match)
    getSynthByName(name) {
        for (const inst of this.synthInstances.values()) {
            if (inst.name === name) return inst;
        }
        return null;
    }

    // Get parameter info for a synth
    getParameterInfo(synthName) {
        // Get from SynthRegistry descriptor
        const descriptor = window.SynthRegistry?.get?.(synthName);
        if (descriptor?.getParameterInfo) {
            const params = typeof descriptor.getParameterInfo === 'function'
                ? descriptor.getParameterInfo()
                : descriptor.getParameterInfo;
            if (params && params.length > 0) return params;
        }

        // Fallback to synth instance
        const synthInstance = this.loadedSynths.get(synthName);
        if (synthInstance?.getParameterInfo) {
            return synthInstance.getParameterInfo();
        }
        return [];
    }

    // Set parameter value for a synth
    setSynthParameter(synthName, paramIndex, value) {
        const synthInstance = this.loadedSynths.get(synthName);
        if (synthInstance?.setParameter) {
            synthInstance.setParameter(paramIndex, value);
            console.log(`🎛️ ${synthName} param ${paramIndex} = ${value}`);
            return true;
        }
        return false;
    }

    // Get current parameter values for a synth
    getSynthParameters(synthName) {
        return this.synthParams.get(synthName) || new Map();
    }

    // Trigger note programmatically
    triggerNote(synthName, note, velocity = 127, duration = 500) {
        const synthInstance = this.loadedSynths.get(synthName);
        if (!synthInstance) {
            console.warn(`Synth ${synthName} not loaded`);
            return false;
        }

        synthInstance.noteOn(note, velocity / 127);
        setTimeout(() => {
            synthInstance.noteOff(note);
        }, duration);
        return true;
    }

    // Clear all loaded synths (without page reload)
    clearAllSynths() {
        console.log('🧹 Clearing all synths...');

        // Stop playback first
        this.stopAll();

        // Clear all synth instances
        this.loadedSynths.clear();
        this.synthInstances.clear();
        this.loadingSynths.clear();
        this.synthInstanceCounter = 0;

        // Emit event for UI update
        window.dispatchEvent(new CustomEvent('rfx:synthsCleared'));

        console.log('✅ All synths cleared');
    }
}

// Create global instance
export const rfx = new RFXIntegration();

// Global helper to add parameters to haps
// Usage in Strudel: note("c4").s("rgahxsynth").fmap(param("waveform", 2))
window.rfxparam = (name, value) => {
    return (hap) => ({
        ...hap,
        [`param_${name}`]: value
    });
};

// Alternative: set global parameter values
// Usage: rfx.setGlobalParam("filter_cutoff", 0.8)
window.rfx = rfx;
