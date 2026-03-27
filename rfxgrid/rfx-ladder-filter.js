/**
 * RFX Moog Ladder Filter WASM Wrapper (TB303-style)
 * Real DSP from ~/Projects/rfx/synth/
 */

export class RFXLadderFilter {
    constructor(audioContext, skipWorkletRegistration = false, cachedWasmBytes = null, cachedModuleCode = null) {
        this.ctx = audioContext;
        this.module = null;
        this.filterPtr = null;
        this.isReady = false;
        this.skipWorkletRegistration = skipWorkletRegistration;
        this.cachedWasmBytes = cachedWasmBytes;
        this.cachedModuleCode = cachedModuleCode;

        // AudioWorklet node
        this.workletNode = null;

        // Current parameter values
        this._cutoff = 0.5; // 0.0 - 1.0
        this._baseCutoff = 0.5; // Base cutoff without modulation
        this._resonance = 0.0; // 0.0 - 1.0

        // Modulation
        this.modulationDepth = 0.5; // How much modulation affects cutoff

        // Pre-allocated audio buffer
        this.audioBufferPtr = null;
        this.maxBufferSize = 4096; // Pre-allocate for max ScriptProcessor size
    }

    async init() {
        // Load WASM JS factory ONCE (if not already loaded)
        if (!globalThis.LadderFilterModule) {
            // Load WASM JS code as text to modify it (rfxstrudel pattern)
            const jsResponse = await fetch('./ladder-filter.js');
            const jsCode = await jsResponse.text();

            // Modify code to expose wasmMemory (same as rfxstrudel)
            const modifiedCode = jsCode
                .replace(';return moduleRtn', ';globalThis.__wasmMemory=wasmMemory;return moduleRtn')
                .replace('var LadderFilterModule=', 'globalThis.LadderFilterModule=');

            // Eval modified code
            eval(modifiedCode);
            console.log('[RFXLadderFilter] Loaded WASM factory');
        }

        // Get the factory from global
        const LadderFilterModule = globalThis.LadderFilterModule;

        // Use cached WASM bytes if provided, otherwise fetch
        let wasmBytes;
        if (this.cachedWasmBytes) {
            wasmBytes = this.cachedWasmBytes;
            console.log('[RFXLadderFilter] Using cached WASM bytes');
        } else {
            const wasmResponse = await fetch('./ladder-filter.wasm');
            wasmBytes = await wasmResponse.arrayBuffer();
            console.log('[RFXLadderFilter] Fetched WASM bytes');
        }

        // Call factory with WASM bytes
        this.module = await LadderFilterModule({ wasmBinary: wasmBytes });

        // Capture memory reference
        this.wasmMemory = globalThis.__wasmMemory;
        delete globalThis.__wasmMemory;

        if (!this.wasmMemory) {
            throw new Error('Failed to capture WASM memory');
        }

        console.log('[RFXLadderFilter] Got WASM memory, size:', this.wasmMemory.buffer.byteLength);

        // Create filter instance
        this.filterPtr = this.module._ladder_create();
        if (!this.filterPtr) {
            throw new Error('Failed to create RFX ladder filter instance');
        }

        // Set sample rate
        this.module._ladder_set_sample_rate(this.filterPtr, this.ctx.sampleRate);

        // Pre-allocate audio buffer (prevents malloc/free every frame)
        this.audioBufferPtr = this.module._malloc(this.maxBufferSize * 4);
        console.log('[RFXLadderFilter] Pre-allocated buffer:', this.audioBufferPtr);

        // Register AudioWorklet processor (only if not already done)
        if (!this.skipWorkletRegistration) {
            await this.ctx.audioWorklet.addModule('./ladder-filter-processor.js');
            console.log('[RFXLadderFilter] Registered AudioWorklet processor');
        }

        // Create AudioWorklet node instance
        this.workletNode = new AudioWorkletNode(this.ctx, 'ladder-filter-processor', {
            numberOfInputs: 2,
            numberOfOutputs: 1,
            outputChannelCount: [1]
        });

        // Send WASM bytes and factory code to worklet
        this.workletNode.port.postMessage({
            type: 'init',
            wasmBytes: wasmBytes,
            moduleCode: this.cachedModuleCode, // Send factory code to worklet
            sampleRate: this.ctx.sampleRate,
            cutoff: this._cutoff,
            resonance: this._resonance
        });

        // Wait for worklet ready (with timeout)
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Worklet init timeout - never received ready message'));
            }, 3000);

            this.workletNode.port.onmessage = (e) => {
                if (e.data.type === 'ready') {
                    clearTimeout(timeout);
                    resolve();
                } else if (e.data.type === 'error') {
                    clearTimeout(timeout);
                    reject(new Error('Worklet error: ' + e.data.message));
                }
            };
        });

        this.isReady = true;
        console.log('[RFXLadderFilter] Initialized - Moog ladder (TB303-style) @ ' + this.ctx.sampleRate + 'Hz');

        return this;
    }

    // Connect envelope modulation to filter cutoff
    connectModulation(sourceNode, depth = 0.8) {
        if (this.workletNode) {
            // Connect envelope to input[1] of AudioWorklet
            sourceNode.connect(this.workletNode, 0, 1);
            this.modulationDepth = depth;

            // Send modulation config to worklet
            this.workletNode.port.postMessage({
                type: 'setModDepth',
                depth: depth,
                baseCutoff: this._baseCutoff
            });

            console.log('[RFXLadderFilter] Modulation connected, depth:', depth);
        }
    }

    // Set cutoff (Hz) - converts to 0-1 range
    set frequency(hz) {
        if (!this.isReady) return;

        // Convert Hz (20-20000) to normalized cutoff (0-1) using exponential mapping
        // 20Hz → 0.0, 20kHz → 1.0
        const normalized = Math.log(hz / 20.0) / Math.log(1000.0);
        this._cutoff = Math.max(0.0, Math.min(1.0, normalized));
        this._baseCutoff = this._cutoff; // Store base cutoff for modulation

        // Update main thread filter
        this.module._ladder_set_cutoff(this.filterPtr, this._cutoff);

        // Update worklet
        if (this.workletNode) {
            this.workletNode.port.postMessage({
                type: 'setParam',
                param: 'cutoff',
                value: this._cutoff
            });
        }
    }

    // Get cutoff frequency object (for Web Audio compatibility)
    get frequency() {
        const self = this;
        return {
            value: 20 * Math.pow(1000, self._cutoff),
            setValueAtTime(hz, time) {
                self.frequency = hz;
            },
            setTargetAtTime(hz, time, constant) {
                self.frequency = hz;
            },
            linearRampToValueAtTime(hz, time) {
                self.frequency = hz;
            },
            exponentialRampToValueAtTime(hz, time) {
                self.frequency = hz;
            }
        };
    }

    // Set resonance (Q factor) - converts to 0-1 range
    set Q(q) {
        if (!this.isReady) return;

        // Convert Web Audio Q (1-30) to ladder resonance (0-1)
        // Q=1 → 0.0 (no resonance)
        // Q=30 → 1.0 (self-oscillation)
        this._resonance = Math.max(0.0, Math.min(1.0, (q - 1.0) / 29.0));

        // Update main thread filter
        this.module._ladder_set_resonance(this.filterPtr, this._resonance);

        // Update worklet
        if (this.workletNode) {
            this.workletNode.port.postMessage({
                type: 'setParam',
                param: 'resonance',
                value: this._resonance
            });
        }
    }

    // Get resonance object (for Web Audio compatibility)
    get Q() {
        const self = this;
        return {
            value: 1.0 + self._resonance * 29.0,
            setValueAtTime(q, time) {
                self.Q = q;
            },
            setTargetAtTime(q, time, constant) {
                self.Q = q;
            },
            linearRampToValueAtTime(q, time) {
                self.Q = q;
            }
        };
    }

    // Web Audio node compatibility
    connect(destination) {
        if (this.workletNode) {
            this.workletNode.connect(destination);
        }
        return destination;
    }

    disconnect() {
        if (this.workletNode) {
            this.workletNode.disconnect();
        }
    }

    destroy() {
        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode.onaudioprocess = null;
            this.workletNode = null;
        }

        if (this.filterPtr && this.module) {
            this.module._ladder_destroy(this.filterPtr);
            this.filterPtr = null;
        }

        this.wasmMemory = null;
        this.module = null;
        this.isReady = false;
    }
}
