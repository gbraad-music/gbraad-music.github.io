// RFX Effects & Synths Integration for Strudel
// Makes RFX synths and effects available as Strudel pattern methods

export class RFXIntegration {
    constructor() {
        this.audioContext = null;
        this.synths = new Map(); // { name: synthInfo }
        this.loadedSynths = new Map(); // { name: wasmInstance }
        this.loadingSynths = new Set(); // Track synths currently loading
        this.effects = new Map(); // { name: effectNode }
        this.params = new Proxy({}, {
            get: (target, prop) => {
                if (!(prop in target)) {
                    target[prop] = 0.5; // Default value
                    console.log(`📊 New parameter: ${prop} = 0.5`);
                    // Notify UI to create a knob
                    window.dispatchEvent(new CustomEvent('rfx:newparam', {
                        detail: { name: prop, value: 0.5 }
                    }));
                }
                return target[prop];
            },
            set: (target, prop, value) => {
                target[prop] = value;
                console.log(`📊 Parameter updated: ${prop} = ${value}`);
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
    }

    // Register RFX synths with Strudel
    registerStrudelMethods() {
        // Try to register as custom synths in superdough
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
    }

    // Play RFX synth when triggered by Strudel
    async playRFXSynth(synthName, hap, time) {
        const synthInfo = this.synths.get(synthName);
        if (!synthInfo) return;

        // Load WASM synth if not already loaded
        if (!this.loadedSynths.has(synthName)) {
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
        }

        const synthInstance = this.loadedSynths.get(synthName);
        if (!synthInstance) return;

        // Get note and velocity from hap
        const note = hap.note || 60;
        const velocity = hap.velocity || 0.8;
        const duration = hap.duration || 0.5;

        // Schedule at the precise time Strudel tells us
        const now = this.audioContext.currentTime;
        const delaySeconds = Math.max(0, time - now);
        const delayMs = delaySeconds * 1000;

        // Schedule note trigger
        setTimeout(() => {
            try {
                synthInstance.noteOn(note, velocity);

                // Schedule note off
                setTimeout(() => {
                    synthInstance.noteOff(note);
                }, duration * 1000);
            } catch (error) {
                console.error(`❌ Error playing ${synthName}:`, error);
            }
        }, delayMs);
    }

    // Load WASM synth module
    async loadWASMSynth(name, synthInfo) {
        try {
            console.log(`📦 Loading WASM synth: ${name}`);

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

            const synthPtr = createFunc(this.audioContext.sampleRate);
            console.log(`Created synth instance, ptr=${synthPtr}`);

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

            // Create audio worklet wrapper
            const synthInstance = {
                module: wasmModule,
                memory: wasmMemory,
                synthPtr,
                processor,
                isDrum,
                isSynth,
                noteOn: (note, velocity = 0.8) => {
                    const vel = Math.floor(velocity * 127);
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
                        wasmModule._regroove_synth_note_off(synthPtr, note);
                    }
                    // Drums don't need noteOff
                }
            };

            this.loadedSynths.set(name, synthInstance);
            console.log(`✅ Loaded ${name}`);
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
}

// Create global instance
export const rfx = new RFXIntegration();
