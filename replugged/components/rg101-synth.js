/**
 * RG101 Synth - Web Audio Synth
 * SH-101 inspired monophonic synthesizer with Donner Essential L1 extensions
 */

import { SynthRegistry } from '../synth-registry.js';

class RG101Synth {
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.workletNode = null;
        this.masterGain = null;
        this.wasmModule = null;
        this.wasmInstance = null;
        this.wasmError = null;
        this.isInitialized = false;

        // Parameter ranges
        this.parameterInfo = RG101Synth.getParameterInfo();
    }

    static getParameterInfo() {
        return [
            // Oscillator (0-6)
            { id: 0, name: 'Saw Level', min: 0, max: 127, default: 102 },
            { id: 1, name: 'Square Level', min: 0, max: 127, default: 0 },
            { id: 2, name: 'Triangle Level', min: 0, max: 127, default: 0 },
            { id: 3, name: 'Sub Level', min: 0, max: 127, default: 38 },
            { id: 4, name: 'Noise Level', min: 0, max: 127, default: 0 },
            { id: 5, name: 'Pulse Width', min: 0, max: 127, default: 64 },
            { id: 6, name: 'PWM Depth', min: 0, max: 127, default: 0 },

            // Filter (7-10)
            { id: 7, name: 'Cutoff', min: 0, max: 127, default: 64 },
            { id: 8, name: 'Resonance', min: 0, max: 127, default: 38 },
            { id: 9, name: 'Env Mod', min: 0, max: 127, default: 64 },
            { id: 10, name: 'Kbd Track', min: 0, max: 127, default: 64 },

            // Filter Envelope (11-14)
            { id: 11, name: 'Filt Attack', min: 0, max: 127, default: 1 },
            { id: 12, name: 'Filt Decay', min: 0, max: 127, default: 38 },
            { id: 13, name: 'Filt Sustain', min: 0, max: 127, default: 0 },
            { id: 14, name: 'Filt Release', min: 0, max: 127, default: 13 },

            // Amp Envelope (15-18)
            { id: 15, name: 'Amp Attack', min: 0, max: 127, default: 1 },
            { id: 16, name: 'Amp Decay', min: 0, max: 127, default: 38 },
            { id: 17, name: 'Amp Sustain', min: 0, max: 127, default: 89 },
            { id: 18, name: 'Amp Release', min: 0, max: 127, default: 13 },

            // Mod Envelope (19-23)
            { id: 19, name: 'Mod Attack', min: 0, max: 127, default: 1 },
            { id: 20, name: 'Mod Decay', min: 0, max: 127, default: 38 },
            { id: 21, name: 'Mod Sustain', min: 0, max: 127, default: 0 },
            { id: 22, name: 'Mod Release', min: 0, max: 127, default: 13 },
            { id: 23, name: 'Pitch Mod Depth', min: 0, max: 127, default: 0 },

            // LFO (24-28)
            { id: 24, name: 'LFO Waveform', min: 0, max: 127, default: 0, type: 'select',
              options: ['Sine', 'Triangle', 'Square', 'Saw Up', 'Saw Down', 'Random'] },
            { id: 25, name: 'LFO Rate', min: 0, max: 127, default: 5 },
            { id: 26, name: 'LFO Pitch', min: 0, max: 127, default: 0 },
            { id: 27, name: 'LFO Filter', min: 0, max: 127, default: 0 },
            { id: 28, name: 'LFO Amp', min: 0, max: 127, default: 0 },

            // Performance (29-32)
            { id: 29, name: 'Velocity Sens', min: 0, max: 127, default: 64 },
            { id: 30, name: 'Portamento', min: 0, max: 127, default: 0 },
            { id: 31, name: 'Glide Mode', min: 0, max: 127, default: 0, type: 'select',
              options: ['On', 'Auto'] },
            { id: 32, name: 'Volume', min: 0, max: 127, default: 89 },

            // Modulation Options (33-35)
            { id: 33, name: 'VCA Mode', min: 0, max: 127, default: 0, type: 'select',
              options: ['ENV2', 'Gate', 'Cycling', 'Drone'] },
            { id: 34, name: 'Env Merge', min: 0, max: 127, default: 0, type: 'toggle' },
            { id: 35, name: 'LFO Retrigger', min: 0, max: 127, default: 0, type: 'toggle' },
        ];
    }

    async initialize() {
        try {
            console.log('[RG101] Loading WASM module...');

            const paths = SynthRegistry.getPaths();
            const wasmJsPath = paths.wasm + 'rg101-synth.js';
            const wasmBinaryPath = paths.wasm + 'rg101-synth.wasm';

            // Fetch WASM files
            const [jsResponse, wasmResponse] = await Promise.all([
                fetch(wasmJsPath),
                fetch(wasmBinaryPath)
            ]);

            if (!jsResponse.ok || !wasmResponse.ok) {
                throw new Error('Failed to fetch WASM files');
            }

            const jsCode = await jsResponse.text();
            const wasmBytes = await wasmResponse.arrayBuffer();

            console.log('[RG101] WASM files loaded');

            // Create AudioWorklet processor using generic synth worklet
            await this.audioContext.audioWorklet.addModule(paths.worklets + 'synth-worklet-processor.js');

            // Create master gain for volume control and connection point
            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = 1.0;

            this.workletNode = new AudioWorkletNode(this.audioContext, 'synth-worklet-processor', {
                outputChannelCount: [2]
            });

            // Wait for worklet to request WASM
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Worklet timeout')), 5000);

                this.workletNode.port.onmessage = (event) => {
                    if (event.data.type === 'needWasm') {
                        // Send WASM bytes to worklet
                        this.workletNode.port.postMessage({
                            type: 'wasmBytes',
                            data: {
                                jsCode: jsCode,
                                wasmBytes: wasmBytes,
                                engineId: 101,  // RG101 engine ID
                                sampleRate: this.audioContext.sampleRate
                            }
                        });
                    } else if (event.data.type === 'ready') {
                        clearTimeout(timeout);
                        resolve();
                    } else if (event.data.type === 'error') {
                        clearTimeout(timeout);
                        reject(new Error(event.data.data.message));
                    }
                };
            });

            // Connect worklet to master gain
            this.workletNode.connect(this.masterGain);

            this.isInitialized = true;
            console.log('[RG101] Initialized successfully');
            return true;

        } catch (error) {
            console.error('[RG101] Initialization error:', error);
            this.wasmError = error.message;
            return false;
        }
    }

    noteOn(note, velocity) {
        if (!this.isInitialized) return;
        this.workletNode?.port.postMessage({
            type: 'noteOn',
            data: { note, velocity }
        });
    }

    noteOff(note) {
        if (!this.isInitialized) return;
        this.workletNode?.port.postMessage({
            type: 'noteOff',
            data: { note }
        });
    }

    setParameter(paramId, value) {
        if (!this.isInitialized) return;
        // Generic worklet expects normalized 0.0-1.0 float
        this.workletNode?.port.postMessage({
            type: 'setParameter',
            data: { index: paramId, value: value }
        });
    }

    allNotesOff() {
        if (!this.isInitialized) return;
        for (let note = 0; note < 128; note++) {
            this.noteOff(note);
        }
    }

    destroy() {
        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode = null;
        }
        this.isInitialized = false;
        console.log('[RG101] Destroyed');
    }
}

// Register synth
SynthRegistry.register({
    id: 'rg101',
    name: 'RG101',
    displayName: 'RG101 Synth',
    description: 'SH-101 inspired monophonic synthesizer with Donner Essential L1 extensions',
    engineId: 101,
    class: RG101Synth,
    category: 'synthesizer',
    wasmFiles: {
        js: 'rg101-synth.js',
        wasm: 'rg101-synth.wasm'
    },
    getParameterInfo: RG101Synth.getParameterInfo
});

export { RG101Synth };
