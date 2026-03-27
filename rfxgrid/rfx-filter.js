/**
 * RFX Filter WASM Wrapper
 * Uses miniKORG 700S ladder filter from rfx/synth
 */

export class RFXFilter {
    constructor(audioContext) {
        this.ctx = audioContext;
        this.module = null;
        this.filterPtr = null;
        this.isReady = false;

        // Audio processing
        this.inputBuffer = null;
        this.outputBuffer = null;
        this.bufferSize = 128; // Process in small chunks

        // ScriptProcessor for real-time processing
        this.processor = null;
    }

    async init() {
        // Load WASM module
        const Filter700SModule = (await import('./700s-filter.js')).default;
        this.module = await Filter700SModule();

        // Create filter instance
        this.filterPtr = this.module._filter700s_create();
        if (!this.filterPtr) {
            throw new Error('Failed to create RFX filter instance');
        }

        // Set sample rate
        this.module._filter700s_set_sample_rate(this.filterPtr, this.ctx.sampleRate);

        // Allocate audio buffers in WASM memory
        this.inputBuffer = this.module._malloc(this.bufferSize * 4); // float32
        this.outputBuffer = this.module._malloc(this.bufferSize * 4);

        // Create ScriptProcessorNode for real-time processing
        this.processor = this.ctx.createScriptProcessor(this.bufferSize, 1, 1);
        this.processor.onaudioprocess = (e) => this.processAudio(e);

        this.isReady = true;
        console.log('[RFXFilter] Initialized with sample rate:', this.ctx.sampleRate);

        return this;
    }

    // Set cutoff frequency (Hz)
    set frequency(value) {
        if (!this.isReady) return;
        this.module._filter700s_set_lp_cutoff(this.filterPtr, value);
    }

    // Set resonance (0-30 for Q factor compatibility)
    set Q(value) {
        if (!this.isReady) return;
        // Map Web Audio Q (1-30) to 700S resonance (0.5-15)
        const resonance = 0.5 + (value / 30) * 14.5;
        this.module._filter700s_set_resonance(this.filterPtr, resonance);
    }

    // Process audio in real-time
    processAudio(event) {
        if (!this.isReady) return;

        const input = event.inputBuffer.getChannelData(0);
        const output = event.outputBuffer.getChannelData(0);

        // Copy input to WASM memory
        const inputHeap = new Float32Array(
            this.module.HEAPF32.buffer,
            this.inputBuffer,
            this.bufferSize
        );
        inputHeap.set(input);

        // Process through RFX filter
        this.module._filter700s_process(
            this.filterPtr,
            this.inputBuffer,
            this.bufferSize
        );

        // Copy output from WASM memory
        const outputHeap = new Float32Array(
            this.module.HEAPF32.buffer,
            this.inputBuffer, // In-place processing
            this.bufferSize
        );
        output.set(outputHeap);
    }

    // Web Audio node compatibility
    connect(destination) {
        if (this.processor) {
            this.processor.connect(destination);
        }
        return destination;
    }

    disconnect() {
        if (this.processor) {
            this.processor.disconnect();
        }
    }

    // For modulation connections
    get frequencyParam() {
        // Create a pseudo AudioParam that sets frequency when changed
        const self = this;
        return {
            value: 1000,
            setValueAtTime(value, time) {
                self.frequency = value;
            },
            setTargetAtTime(value, time, constant) {
                // Simplified - just set immediately
                self.frequency = value;
            },
            linearRampToValueAtTime(value, time) {
                self.frequency = value;
            }
        };
    }

    destroy() {
        if (this.processor) {
            this.processor.disconnect();
            this.processor.onaudioprocess = null;
            this.processor = null;
        }

        if (this.inputBuffer) {
            this.module._free(this.inputBuffer);
            this.inputBuffer = null;
        }

        if (this.outputBuffer) {
            this.module._free(this.outputBuffer);
            this.outputBuffer = null;
        }

        if (this.filterPtr) {
            this.module._filter700s_destroy(this.filterPtr);
            this.filterPtr = null;
        }

        this.isReady = false;
    }
}
