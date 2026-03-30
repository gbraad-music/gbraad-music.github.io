/**
 * RG101 Synth UI Component
 * UI for SH-101 inspired synthesizer
 */

import { setupParameterSync, cleanupParameterSync, emitParameterChange } from './synth-ui-base.js';

class RG101UI extends HTMLElement {
    constructor() {
        super();
        this.synthInstance = null;
    }

    connectedCallback() {
        this.render();
        this.setupEventListeners();

        // Setup parameter sync
        const paramMapping = {
            0: 'sawLevel',
            1: 'squareLevel',
            2: 'triangleLevel',
            3: 'subLevel',
            4: 'noiseLevel',
            5: 'pulseWidth',
            6: 'pwmDepth',
            7: 'cutoff',
            8: 'resonance',
            9: 'envMod',
            10: 'kbdTrack',
            11: 'filtAttack',
            12: 'filtDecay',
            13: 'filtSustain',
            14: 'filtRelease',
            15: 'ampAttack',
            16: 'ampDecay',
            17: 'ampSustain',
            18: 'ampRelease',
            19: 'modAttack',
            20: 'modDecay',
            21: 'modSustain',
            22: 'modRelease',
            23: 'pitchModDepth',
            24: 'lfoWaveform',
            25: 'lfoRate',
            26: 'lfoPitch',
            27: 'lfoFilter',
            28: 'lfoAmp',
            29: 'velocitySens',
            30: 'portamento',
            31: 'glideMode',
            32: 'volume',
            33: 'vcaMode',
            34: 'envMerge',
            35: 'lfoRetrigger'
        };
        setupParameterSync(this, paramMapping);
    }

    disconnectedCallback() {
        cleanupParameterSync(this);
    }

    set synth(instance) {
        this.synthInstance = instance;
    }

    render() {
        this.innerHTML = `
            <style>
                .rg101-container {
                    padding: 20px;
                    background: #1a1a1a;
                    border-radius: 8px;
                    color: #fff;
                    font-family: 'Segoe UI', sans-serif;
                }

                .rg101-header {
                    font-size: 20px;
                    font-weight: bold;
                    color: #ff6b35;
                    margin: 0 0 20px 0;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                }

                .rg101-section {
                    margin-bottom: 20px;
                }

                .rg101-section h3 {
                    margin: 0 0 10px 0;
                    font-size: 14px;
                    color: #4ecdc4;
                    text-transform: uppercase;
                }

                .param-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                    gap: 15px;
                }

                .param-control {
                    display: flex;
                    flex-direction: column;
                    gap: 5px;
                }

                .param-label {
                    font-size: 11px;
                    color: #aaa;
                    text-transform: uppercase;
                }

                .param-value {
                    font-size: 12px;
                    color: #4ecdc4;
                    font-weight: bold;
                }

                input[type="range"] {
                    width: 100%;
                    height: 4px;
                    background: #333;
                    outline: none;
                    border-radius: 2px;
                }

                input[type="range"]::-webkit-slider-thumb {
                    appearance: none;
                    width: 16px;
                    height: 16px;
                    background: #4ecdc4;
                    cursor: pointer;
                    border-radius: 50%;
                }

                input[type="range"]::-moz-range-thumb {
                    width: 16px;
                    height: 16px;
                    background: #4ecdc4;
                    cursor: pointer;
                    border-radius: 50%;
                    border: none;
                }

                .rg101-container select {
                    background: #333;
                    color: #fff;
                    border: 1px solid #4ecdc4;
                    padding: 5px;
                    border-radius: 4px;
                    font-size: 12px;
                }

                .toggle-switch {
                    width: 40px;
                    height: 20px;
                    background: #333;
                    border-radius: 10px;
                    position: relative;
                    cursor: pointer;
                    transition: background 0.3s;
                }

                .toggle-switch.active {
                    background: #4ecdc4;
                }

                .toggle-switch::after {
                    content: '';
                    position: absolute;
                    width: 16px;
                    height: 16px;
                    background: white;
                    border-radius: 50%;
                    top: 2px;
                    left: 2px;
                    transition: left 0.3s;
                }

                .toggle-switch.active::after {
                    left: 22px;
                }
            </style>

            <div class="rg101-container">
                <h2 class="rg101-header">RG101 - Monophonic Synthesizer</h2>

                <div class="rg101-section">
                    <h3>Oscillator</h3>
                    <div class="param-grid">
                        <div class="param-control">
                            <label class="param-label">Saw Level</label>
                            <input type="range" id="sawLevel" min="0" max="127" value="102">
                            <span class="param-value" id="sawLevelValue">102</span>
                        </div>
                        <div class="param-control">
                            <label class="param-label">Square Level</label>
                            <input type="range" id="squareLevel" min="0" max="127" value="0">
                            <span class="param-value" id="squareLevelValue">0</span>
                        </div>
                        <div class="param-control">
                            <label class="param-label">Triangle Level</label>
                            <input type="range" id="triangleLevel" min="0" max="127" value="0">
                            <span class="param-value" id="triangleLevelValue">0</span>
                        </div>
                        <div class="param-control">
                            <label class="param-label">Sub Level</label>
                            <input type="range" id="subLevel" min="0" max="127" value="38">
                            <span class="param-value" id="subLevelValue">38</span>
                        </div>
                        <div class="param-control">
                            <label class="param-label">Noise Level</label>
                            <input type="range" id="noiseLevel" min="0" max="127" value="0">
                            <span class="param-value" id="noiseLevelValue">0</span>
                        </div>
                        <div class="param-control">
                            <label class="param-label">Pulse Width</label>
                            <input type="range" id="pulseWidth" min="0" max="127" value="64">
                            <span class="param-value" id="pulseWidthValue">64</span>
                        </div>
                        <div class="param-control">
                            <label class="param-label">PWM Depth</label>
                            <input type="range" id="pwmDepth" min="0" max="127" value="0">
                            <span class="param-value" id="pwmDepthValue">0</span>
                        </div>
                    </div>
                </div>

                <div class="rg101-section">
                    <h3>Filter</h3>
                    <div class="param-grid">
                        <div class="param-control">
                            <label class="param-label">Cutoff</label>
                            <input type="range" id="cutoff" min="0" max="127" value="64">
                            <span class="param-value" id="cutoffValue">64</span>
                        </div>
                        <div class="param-control">
                            <label class="param-label">Resonance</label>
                            <input type="range" id="resonance" min="0" max="127" value="38">
                            <span class="param-value" id="resonanceValue">38</span>
                        </div>
                        <div class="param-control">
                            <label class="param-label">Env Mod</label>
                            <input type="range" id="envMod" min="0" max="127" value="64">
                            <span class="param-value" id="envModValue">64</span>
                        </div>
                        <div class="param-control">
                            <label class="param-label">Kbd Track</label>
                            <input type="range" id="kbdTrack" min="0" max="127" value="64">
                            <span class="param-value" id="kbdTrackValue">64</span>
                        </div>
                    </div>
                </div>

                <div class="rg101-section">
                    <h3>Envelopes</h3>
                    <div class="param-grid">
                        <div class="param-control">
                            <label class="param-label">Filt Attack</label>
                            <input type="range" id="filtAttack" min="0" max="127" value="1">
                            <span class="param-value" id="filtAttackValue">1</span>
                        </div>
                        <div class="param-control">
                            <label class="param-label">Filt Decay</label>
                            <input type="range" id="filtDecay" min="0" max="127" value="38">
                            <span class="param-value" id="filtDecayValue">38</span>
                        </div>
                        <div class="param-control">
                            <label class="param-label">Filt Sustain</label>
                            <input type="range" id="filtSustain" min="0" max="127" value="0">
                            <span class="param-value" id="filtSustainValue">0</span>
                        </div>
                        <div class="param-control">
                            <label class="param-label">Filt Release</label>
                            <input type="range" id="filtRelease" min="0" max="127" value="13">
                            <span class="param-value" id="filtReleaseValue">13</span>
                        </div>
                        <div class="param-control">
                            <label class="param-label">Amp Attack</label>
                            <input type="range" id="ampAttack" min="0" max="127" value="1">
                            <span class="param-value" id="ampAttackValue">1</span>
                        </div>
                        <div class="param-control">
                            <label class="param-label">Amp Decay</label>
                            <input type="range" id="ampDecay" min="0" max="127" value="38">
                            <span class="param-value" id="ampDecayValue">38</span>
                        </div>
                        <div class="param-control">
                            <label class="param-label">Amp Sustain</label>
                            <input type="range" id="ampSustain" min="0" max="127" value="89">
                            <span class="param-value" id="ampSustainValue">89</span>
                        </div>
                        <div class="param-control">
                            <label class="param-label">Amp Release</label>
                            <input type="range" id="ampRelease" min="0" max="127" value="13">
                            <span class="param-value" id="ampReleaseValue">13</span>
                        </div>
                    </div>
                </div>

                <div class="rg101-section">
                    <h3>LFO</h3>
                    <div class="param-grid">
                        <div class="param-control">
                            <label class="param-label">Waveform</label>
                            <select id="lfoWaveform">
                                <option value="0">Sine</option>
                                <option value="1">Triangle</option>
                                <option value="2">Square</option>
                                <option value="3">Saw Up</option>
                                <option value="4">Saw Down</option>
                                <option value="5">Random</option>
                            </select>
                        </div>
                        <div class="param-control">
                            <label class="param-label">LFO Rate</label>
                            <input type="range" id="lfoRate" min="0" max="127" value="5">
                            <span class="param-value" id="lfoRateValue">5</span>
                        </div>
                        <div class="param-control">
                            <label class="param-label">LFO Pitch</label>
                            <input type="range" id="lfoPitch" min="0" max="127" value="0">
                            <span class="param-value" id="lfoPitchValue">0</span>
                        </div>
                        <div class="param-control">
                            <label class="param-label">LFO Filter</label>
                            <input type="range" id="lfoFilter" min="0" max="127" value="0">
                            <span class="param-value" id="lfoFilterValue">0</span>
                        </div>
                        <div class="param-control">
                            <label class="param-label">LFO Amp</label>
                            <input type="range" id="lfoAmp" min="0" max="127" value="0">
                            <span class="param-value" id="lfoAmpValue">0</span>
                        </div>
                    </div>
                </div>

                <div class="rg101-section">
                    <h3>Performance</h3>
                    <div class="param-grid">
                        <div class="param-control">
                            <label class="param-label">Velocity Sens</label>
                            <input type="range" id="velocitySens" min="0" max="127" value="64">
                            <span class="param-value" id="velocitySensValue">64</span>
                        </div>
                        <div class="param-control">
                            <label class="param-label">Portamento</label>
                            <input type="range" id="portamento" min="0" max="127" value="0">
                            <span class="param-value" id="portamentoValue">0</span>
                        </div>
                        <div class="param-control">
                            <label class="param-label">Volume</label>
                            <input type="range" id="volume" min="0" max="127" value="89">
                            <span class="param-value" id="volumeValue">89</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    setupEventListeners() {
        // Range inputs with their parameter indices
        const params = {
            sawLevel: 0, squareLevel: 1, triangleLevel: 2, subLevel: 3,
            noiseLevel: 4, pulseWidth: 5, pwmDepth: 6, cutoff: 7,
            resonance: 8, envMod: 9, kbdTrack: 10, filtAttack: 11,
            filtDecay: 12, filtSustain: 13, filtRelease: 14, ampAttack: 15,
            ampDecay: 16, ampSustain: 17, ampRelease: 18, lfoRate: 25,
            lfoPitch: 26, lfoFilter: 27, lfoAmp: 28, velocitySens: 29,
            portamento: 30, volume: 32
        };

        Object.entries(params).forEach(([name, index]) => {
            const input = this.querySelector(`#${name}`);
            const valueDisplay = this.querySelector(`#${name}Value`);

            if (input && valueDisplay) {
                input.addEventListener('input', (e) => {
                    const value = parseInt(e.target.value);
                    valueDisplay.textContent = value;

                    if (this.synthInstance) {
                        // Normalize 0-127 to 0.0-1.0 for the synth
                        this.synthInstance.setParameter(index, value / 127.0);
                        emitParameterChange(index, name, value, this);
                    }
                });
            }
        });

        // LFO Waveform select
        const lfoWaveform = this.querySelector('#lfoWaveform');
        if (lfoWaveform) {
            lfoWaveform.addEventListener('change', (e) => {
                const value = parseInt(e.target.value);
                if (this.synthInstance) {
                    // Normalize 0-127 to 0.0-1.0 for the synth
                    this.synthInstance.setParameter(24, value / 127.0);
                    emitParameterChange(24, 'lfoWaveform', value, this);
                }
            });
        }
    }

    updateParameter(paramIndex, value) {
        const paramMap = {
            0: 'sawLevel', 1: 'squareLevel', 2: 'triangleLevel', 3: 'subLevel',
            4: 'noiseLevel', 5: 'pulseWidth', 6: 'pwmDepth', 7: 'cutoff',
            8: 'resonance', 9: 'envMod', 10: 'kbdTrack', 11: 'filtAttack',
            12: 'filtDecay', 13: 'filtSustain', 14: 'filtRelease', 15: 'ampAttack',
            16: 'ampDecay', 17: 'ampSustain', 18: 'ampRelease', 24: 'lfoWaveform',
            25: 'lfoRate', 26: 'lfoPitch', 27: 'lfoFilter', 28: 'lfoAmp',
            29: 'velocitySens', 30: 'portamento', 32: 'volume'
        };

        const paramName = paramMap[paramIndex];
        if (paramName) {
            const input = this.querySelector(`#${paramName}`);
            const valueDisplay = this.querySelector(`#${paramName}Value`);

            if (input && input.type === 'range') {
                input.value = value;
                if (valueDisplay) valueDisplay.textContent = value;
            } else if (input && input.tagName === 'SELECT') {
                input.value = value;
            }
        }
    }
}

customElements.define('rg101-ui', RG101UI);

export { RG101UI };
