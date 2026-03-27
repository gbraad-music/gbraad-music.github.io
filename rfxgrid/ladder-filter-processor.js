/**
 * AudioWorklet Processor for RFX Ladder Filter
 * Runs in audio thread for low-latency processing
 * Loads its own WASM instance (can't share via postMessage)
 */

class LadderFilterProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        this.filterPtr = null;
        this.wasmModule = null;
        this.wasmReady = false;
        this.modulationDepth = 0.8;
        this.baseCutoff = 0.5;
        this.cutoff = 0.5;
        this.resonance = 0.0;

        // Listen for WASM binary and parameter updates from main thread
        this.port.onmessage = (e) => {
            if (e.data.type === 'init') {
                this.initWASM(
                    e.data.wasmBytes,
                    e.data.moduleCode,
                    e.data.sampleRate,
                    e.data.cutoff,
                    e.data.resonance
                );
            } else if (e.data.type === 'setParam') {
                this.setParameter(e.data.param, e.data.value);
            } else if (e.data.type === 'setModDepth') {
                this.modulationDepth = e.data.depth;
                this.baseCutoff = e.data.baseCutoff;
            }
        };
    }

    async initWASM(wasmBytes, moduleCode, initialSampleRate, initialCutoff, initialResonance) {
        try {
            // Load WASM module factory in worklet scope
            if (!globalThis.LadderFilterModule) {
                if (!moduleCode) {
                    this.port.postMessage({
                        type: 'error',
                        message: 'No module code provided to worklet'
                    });
                    return;
                }

                // Eval the factory code in worklet scope
                eval(moduleCode);
            }

            const LadderFilterModule = globalThis.LadderFilterModule;
            if (!LadderFilterModule) {
                this.port.postMessage({
                    type: 'error',
                    message: 'LadderFilterModule not found after eval'
                });
                return;
            }

            this.wasmModule = await LadderFilterModule({ wasmBinary: wasmBytes });

            // Create filter instance
            this.filterPtr = this.wasmModule._ladder_create();
            this.wasmModule._ladder_set_sample_rate(this.filterPtr, initialSampleRate);
            this.wasmModule._ladder_set_cutoff(this.filterPtr, initialCutoff);
            this.wasmModule._ladder_set_resonance(this.filterPtr, initialResonance);

            this.cutoff = initialCutoff;
            this.baseCutoff = initialCutoff;
            this.resonance = initialResonance;

            this.wasmReady = true;
            this.port.postMessage({ type: 'ready' });
        } catch (err) {
            this.port.postMessage({
                type: 'error',
                message: 'WASM init failed: ' + err.message
            });
        }
    }

    setParameter(param, value) {
        switch (param) {
            case 'cutoff':
                this.cutoff = value;
                this.baseCutoff = value;
                if (this.wasmReady) {
                    this.wasmModule._ladder_set_cutoff(this.filterPtr, value);
                }
                break;
            case 'resonance':
                this.resonance = value;
                if (this.wasmReady) {
                    this.wasmModule._ladder_set_resonance(this.filterPtr, value);
                }
                break;
        }
    }

    process(inputs, outputs, parameters) {
        if (!this.wasmReady || !this.filterPtr || !this.wasmModule) {
            // Pass through if not ready
            if (inputs[0] && inputs[0][0] && outputs[0] && outputs[0][0]) {
                outputs[0][0].set(inputs[0][0]);
            }
            return true;
        }

        const audioInput = inputs[0];
        const modInput = inputs[1]; // Modulation CV input
        const output = outputs[0];

        if (!audioInput || !audioInput[0] || !output || !output[0]) {
            return true;
        }

        const inputChannel = audioInput[0];
        const outputChannel = output[0];
        const bufferLength = inputChannel.length;

        // Apply modulation if present (read average of modulation buffer)
        if (modInput && modInput[0] && modInput[0].length > 0) {
            let modSum = 0;
            for (let i = 0; i < modInput[0].length; i++) {
                modSum += modInput[0][i];
            }
            const modValue = modSum / modInput[0].length;

            // Apply modulation to cutoff
            const modulatedCutoff = Math.max(0, Math.min(1,
                this.baseCutoff + (modValue * this.modulationDepth)
            ));

            // Update filter cutoff
            this.wasmModule._ladder_set_cutoff(this.filterPtr, modulatedCutoff);
        }

        // Process sample-by-sample (can't use buffer pointer in AudioWorklet)
        for (let i = 0; i < bufferLength; i++) {
            outputChannel[i] = this.wasmModule._ladder_process_sample(this.filterPtr, inputChannel[i]);
        }

        return true;
    }
}

registerProcessor('ladder-filter-processor', LadderFilterProcessor);
