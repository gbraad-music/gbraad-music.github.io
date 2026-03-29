/**
 * RGDX7 Synth - Web Audio DX7 FM Synthesizer
 * Yamaha DX7 style 6-operator FM synthesis
 */

import { SynthRegistry } from '../synth-registry.js';

class RGDX7Synth {
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.workletNode = null;
        this.masterGain = null;
        this.wasmModule = null;
        this.wasmInstance = null;
        this.wasmError = null;
        this.isInitialized = false;

        // SysEx data management
        this.sysexData = null;
        this.currentPatch = 0;

        // Parameter ranges
        this.parameterInfo = RGDX7Synth.getParameterInfo();
    }

    static getParameterInfo() {
        return [
            // Patch Selection
            { id: 0, name: 'Patch', min: 0, max: 31, default: 0, type: 'integer' },
            
            // Global Controls
            { id: 1, name: 'Volume', min: 0, max: 127, default: 89 },
            
            // Algorithm & Feedback
            { id: 2, name: 'Algorithm', min: 1, max: 32, default: 1, type: 'integer' },
            { id: 3, name: 'Feedback', min: 0, max: 7, default: 0, type: 'integer' },
            
            // LFO
            { id: 4, name: 'LFO Speed', min: 0, max: 99, default: 50, type: 'integer' },
            { id: 5, name: 'LFO Delay', min: 0, max: 99, default: 0, type: 'integer' },
            { id: 6, name: 'LFO Pitch Depth', min: 0, max: 99, default: 0, type: 'integer' },
            { id: 7, name: 'LFO Amp Depth', min: 0, max: 99, default: 0, type: 'integer' },
        ];
    }

    async initialize() {
        try {
            console.log('[RGDX7] Loading WASM module...');

            const paths = SynthRegistry.getPaths();
            const cacheBust = '?v=' + Date.now();
            const wasmJsPath = paths.wasm + 'rx7synth.js' + cacheBust;
            const wasmBinaryPath = paths.wasm + 'rx7synth.wasm' + cacheBust;

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

            console.log('[RGDX7] WASM files loaded');

            // Create master gain for volume control and connection point
            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = 1.0;

            // Create AudioWorklet processor using generic synth worklet
            const cacheBust2 = '?v=' + Date.now();
            await this.audioContext.audioWorklet.addModule(paths.worklets + 'synth-worklet-processor.js' + cacheBust2);

            this.workletNode = new AudioWorkletNode(this.audioContext, 'synth-worklet-processor', {
                outputChannelCount: [2]
            });

            // Wait for worklet to request WASM
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Worklet timeout')), 5000);

                const initHandler = (event) => {
                    if (event.data.type === 'needWasm') {
                        // Send WASM bytes to worklet
                        this.workletNode.port.postMessage({
                            type: 'wasmBytes',
                            data: {
                                jsCode: jsCode,
                                wasmBytes: wasmBytes,
                                engineId: 707,  // RGDX7 engine ID
                                sampleRate: this.audioContext.sampleRate
                            }
                        });
                    } else if (event.data.type === 'ready') {
                        clearTimeout(timeout);
                        // Remove this temporary handler - worklet has its own internal handler
                        this.workletNode.port.onmessage = null;
                        resolve();
                    } else if (event.data.type === 'error') {
                        clearTimeout(timeout);
                        this.workletNode.port.onmessage = null;
                        reject(new Error(event.data.data.message));
                    }
                };

                this.workletNode.port.onmessage = initHandler;
            });

            // Connect worklet to master gain
            this.workletNode.connect(this.masterGain);

            this.isInitialized = true;
            console.log('[RGDX7] Initialized successfully');
            return true;

        } catch (error) {
            console.error('[RGDX7] Initialization error:', error);
            this.wasmError = error.message;
            return false;
        }
    }

    // Load SysEx cartridge (32 patches)
    async loadSysex(arrayBuffer) {
        if (!this.isInitialized) {
            console.warn('[RGDX7] Cannot load SysEx - not initialized');
            return false;
        }

        try {
            this.sysexData = new Uint8Array(arrayBuffer);

            // Send SysEx data to worklet
            this.workletNode.port.postMessage({
                type: 'loadSysex',
                data: {
                    sysexData: this.sysexData,
                    patchNum: this.currentPatch
                }
            });

            console.log(`[RGDX7] Loaded SysEx cartridge (${this.sysexData.length} bytes)`);
            return true;

        } catch (error) {
            console.error('[RGDX7] SysEx load error:', error);
            return false;
        }
    }

    // Select patch from loaded cartridge
    selectPatch(patchNum) {
        if (!this.isInitialized || !this.sysexData) {
            console.warn('[RGDX7] Cannot select patch - not initialized or no SysEx loaded');
            return;
        }

        if (patchNum < 0 || patchNum > 31) {
            console.warn(`[RGDX7] Invalid patch number: ${patchNum}`);
            return;
        }

        this.currentPatch = patchNum;

        this.workletNode.port.postMessage({
            type: 'selectPatch',
            data: { 
                sysexData: this.sysexData,
                patchNum: patchNum
            }
        });

        console.log(`[RGDX7] Selected patch ${patchNum}`);
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
        
        // Handle patch selection
        if (paramId === 0) {
            this.selectPatch(Math.floor(value));
            return;
        }

        this.workletNode?.port.postMessage({
            type: 'setParameter',
            data: { index: paramId, value: value }
        });
    }

    pitchBend(value) {
        if (!this.isInitialized) return;
        this.workletNode?.port.postMessage({
            type: 'pitchBend',
            data: { value }
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
        this.sysexData = null;
        this.isInitialized = false;
        console.log('[RGDX7] Destroyed');
    }
}

// Register synth
SynthRegistry.register({
    id: 'rgdx7',
    name: 'RGDX7',
    displayName: 'RGDX7 FM Synth',
    description: 'Yamaha DX7 style 6-operator FM synthesizer',
    engineId: 707,
    class: RGDX7Synth,
    category: 'synthesizer',
    wasmFiles: {
        js: 'rgdx7.js',
        wasm: 'rgdx7.wasm'
    },
    getParameterInfo: RGDX7Synth.getParameterInfo,
    features: {
        loadSysex: true,  // Supports SysEx loading
        patchSelection: true  // Supports patch selection
    }
});

export { RGDX7Synth };
