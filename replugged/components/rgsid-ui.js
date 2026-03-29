// RGSID UI Component - Commodore 64 SID Chip Synthesizer
// Sections: Voice 1/2/3, Filter, Global, LFO 1/2, Unison

import { setupParameterSync, cleanupParameterSync, emitParameterChange } from './synth-ui-base.js';

class RGSIDui extends HTMLElement {
    constructor() {
        super();
        this.synth = null;
        this.sequencer = null;
        this.currentVoice = 1;
        this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this.render();
        this.setupEventListeners();

        // Setup generic parameter sync
        setupParameterSync(this, {
            // Voice 1
            4: 'v1attack',
            5: 'v1decay',
            6: 'v1sustain',
            7: 'v1release',
            // Voice 2
            12: 'v2attack',
            13: 'v2decay',
            14: 'v2sustain',
            15: 'v2release',
            // Voice 3
            20: 'v3attack',
            21: 'v3decay',
            22: 'v3sustain',
            23: 'v3release',
            // Filter
            27: 'filtercutoff',
            28: 'filterresonance'
        });
    }

    disconnectedCallback() {
        cleanupParameterSync(this);
    }

    updateParameter(index, value) {
        // Called by setupParameterSync when external knob changes
        // Implement UI updates if needed
    }

    setSynth(synth) {
        this.synth = synth;

        // Load presets if available
        if (synth && typeof synth.onPresetsReady === 'function') {
            synth.onPresetsReady((presetNames) => {
                this.renderPresetSelector(presetNames);
            });
        }
    }

    setSequencer(sequencer) {
        this.sequencer = sequencer;
    }

    renderPresetSelector(presetNames) {
        const presetSelect = this.shadowRoot.getElementById('presetSelect');
        if (!presetSelect) return;

        presetSelect.innerHTML = presetNames.map((name, idx) =>
            `<option value="${idx}">${idx}: ${name}</option>`
        ).join('');
    }

    render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: block;
                    background: #1a1a1a;
                    border: 1px solid #2a2a2a;
                    border-radius: 8px;
                    padding: 20px;
                    color: #fff;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                }

                .panel-title {
                    font-size: 14px;
                    color: #6495ED;
                    text-transform: uppercase;
                    letter-spacing: 2px;
                    margin-bottom: 20px;
                    font-weight: bold;
                }

                .preset-row {
                    display: flex;
                    gap: 10px;
                    align-items: center;
                    margin-bottom: 15px;
                    padding-bottom: 15px;
                    border-bottom: 1px solid #2a2a2a;
                }

                .preset-label {
                    font-size: 10px;
                    color: #888;
                    text-transform: uppercase;
                }

                .voice-selector {
                    display: flex;
                    gap: 10px;
                    align-items: center;
                    margin-bottom: 15px;
                    padding-bottom: 15px;
                    border-bottom: 1px solid #2a2a2a;
                }

                .voice-btn {
                    padding: 8px 16px;
                    background: #0a0a0a;
                    border: 1px solid #2a2a2a;
                    color: #888;
                    font-size: 11px;
                    cursor: pointer;
                    border-radius: 3px;
                    text-transform: uppercase;
                    font-weight: bold;
                }

                .voice-btn.active {
                    background: #6495ED;
                    border-color: #6495ED;
                    color: #fff;
                }

                .controls-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 15px;
                }

                .section {
                    background: #0f0f0f;
                    border: 1px solid #2a2a2a;
                    border-radius: 4px;
                    padding: 15px;
                }

                .section-title {
                    font-size: 11px;
                    color: #888;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    margin-bottom: 12px;
                    font-weight: bold;
                }

                .control {
                    margin-bottom: 12px;
                }

                .control:last-child {
                    margin-bottom: 0;
                }

                .control-label {
                    display: block;
                    font-size: 10px;
                    color: #aaa;
                    text-transform: uppercase;
                    margin-bottom: 6px;
                    letter-spacing: 0.5px;
                }

                .control-value {
                    font-size: 11px;
                    color: #6495ED;
                    margin-left: 8px;
                    font-weight: bold;
                    min-width: 45px;
                    display: inline-block;
                }

                input[type="range"] {
                    width: 100%;
                    height: 4px;
                    background: #2a2a2a;
                    border-radius: 0px;
                    outline: none;
                    -webkit-appearance: none;
                }

                input[type="range"]::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 14px;
                    height: 14px;
                    background: #6495ED;
                    cursor: pointer;
                    border-radius: 50%;
                }

                input[type="range"]::-moz-range-thumb {
                    width: 14px;
                    height: 14px;
                    background: #6495ED;
                    cursor: pointer;
                    border-radius: 50%;
                    border: none;
                }

                select {
                    width: 100%;
                    padding: 6px 8px;
                    background: #0a0a0a;
                    color: #fff;
                    border: 1px solid #2a2a2a;
                    border-radius: 3px;
                    font-size: 11px;
                    cursor: pointer;
                }

                select:focus {
                    outline: none;
                    border-color: #6495ED;
                }

                input[type="checkbox"] {
                    cursor: pointer;
                }

                .sid-info {
                    background: #0a0a0a;
                    border: 1px solid #2a2a2a;
                    border-radius: 4px;
                    padding: 12px;
                    margin-top: 15px;
                    font-size: 10px;
                    color: #666;
                    text-align: center;
                }

                @media (max-width: 768px) {
                    .controls-grid {
                        grid-template-columns: 1fr;
                    }
                }
            </style>

            <div class="panel-title">RGSID - Commodore 64 SID Chip</div>

            <!-- Preset Selector -->
            <div class="preset-row">
                <span class="preset-label">Preset:</span>
                <select id="presetSelect" style="flex: 1;">
                    <option value="0">0: Init</option>
                </select>
            </div>

            <!-- Voice Selector -->
            <div class="voice-selector">
                <span class="preset-label">Voice:</span>
                <button class="voice-btn active" data-voice="1">1</button>
                <button class="voice-btn" data-voice="2">2</button>
                <button class="voice-btn" data-voice="3">3</button>
            </div>

            <div class="controls-grid">
                <!-- Voice Parameters (changes per selected voice) -->
                <div class="section" id="voiceSection">
                    <div class="section-title" id="voiceTitle">Voice 1</div>

                    <div class="control">
                        <label class="control-label">Waveform</label>
                        <select id="waveform">
                            <option value="0">Triangle</option>
                            <option value="1">Sawtooth</option>
                            <option value="2">Pulse</option>
                            <option value="3">Noise</option>
                        </select>
                    </div>

                    <div class="control">
                        <label class="control-label">Pulse Width<span class="control-value" id="pwValue">50%</span></label>
                        <input type="range" id="pw" min="0" max="100" value="50" step="1">
                    </div>

                    <div class="control">
                        <label class="control-label">Attack<span class="control-value" id="attackValue">0</span></label>
                        <input type="range" id="attack" min="0" max="100" value="0" step="1">
                    </div>

                    <div class="control">
                        <label class="control-label">Decay<span class="control-value" id="decayValue">50</span></label>
                        <input type="range" id="decay" min="0" max="100" value="50" step="1">
                    </div>

                    <div class="control">
                        <label class="control-label">Sustain<span class="control-value" id="sustainValue">70</span></label>
                        <input type="range" id="sustain" min="0" max="100" value="70" step="1">
                    </div>

                    <div class="control">
                        <label class="control-label">Release<span class="control-value" id="releaseValue">30</span></label>
                        <input type="range" id="release" min="0" max="100" value="30" step="1">
                    </div>

                    <div class="control">
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" id="ringMod" style="cursor: pointer;">
                            <span style="font-size: 11px;">Ring Mod</span>
                        </label>
                    </div>

                    <div class="control">
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" id="sync" style="cursor: pointer;">
                            <span style="font-size: 11px;">Sync</span>
                        </label>
                    </div>
                </div>

                <!-- Filter Section -->
                <div class="section">
                    <div class="section-title">Filter</div>

                    <div class="control">
                        <label class="control-label">Mode</label>
                        <select id="filterMode">
                            <option value="0">Low Pass</option>
                            <option value="1">Band Pass</option>
                            <option value="2">High Pass</option>
                        </select>
                    </div>

                    <div class="control">
                        <label class="control-label">Cutoff<span class="control-value" id="cutoffValue">50</span></label>
                        <input type="range" id="cutoff" min="0" max="100" value="50" step="1">
                    </div>

                    <div class="control">
                        <label class="control-label">Resonance<span class="control-value" id="resonanceValue">0</span></label>
                        <input type="range" id="resonance" min="0" max="100" value="0" step="1">
                    </div>

                    <div class="control">
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" id="v1Flt" style="cursor: pointer;">
                            <span style="font-size: 11px;">V1 → Flt</span>
                        </label>
                    </div>

                    <div class="control">
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" id="v2Flt" style="cursor: pointer;">
                            <span style="font-size: 11px;">V2 → Flt</span>
                        </label>
                    </div>

                    <div class="control">
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" id="v3Flt" style="cursor: pointer;">
                            <span style="font-size: 11px;">V3 → Flt</span>
                        </label>
                    </div>
                </div>

                <!-- Global Section -->
                <div class="section">
                    <div class="section-title">Global</div>

                    <div class="control">
                        <label class="control-label">Volume<span class="control-value" id="volumeValue">70</span></label>
                        <input type="range" id="volume" min="0" max="100" value="70" step="1">
                    </div>

                    <div class="control">
                        <label class="control-label">Mod Wheel<span class="control-value" id="modWheelValue">0</span></label>
                        <input type="range" id="modWheel" min="0" max="127" value="0" step="1">
                    </div>

                    <div class="control">
                        <label class="control-label">Engine</label>
                        <select id="engine">
                            <option value="0">Mono</option>
                            <option value="1" selected>Multi</option>
                        </select>
                    </div>
                </div>

                <!-- LFO 1 Section -->
                <div class="section">
                    <div class="section-title">LFO 1</div>

                    <div class="control">
                        <label class="control-label">Rate<span class="control-value" id="lfo1RateValue">50</span></label>
                        <input type="range" id="lfo1Rate" min="0" max="100" value="50" step="1">
                    </div>

                    <div class="control">
                        <label class="control-label">Wave</label>
                        <select id="lfo1Wave">
                            <option value="0" selected>Sine</option>
                            <option value="1">Triangle</option>
                            <option value="2">Sawtooth</option>
                            <option value="3">Square</option>
                        </select>
                    </div>

                    <div class="control">
                        <label class="control-label">→ Pitch<span class="control-value" id="lfo1PitchValue">0</span></label>
                        <input type="range" id="lfo1Pitch" min="0" max="100" value="0" step="1">
                    </div>
                </div>

                <!-- LFO 2 Section -->
                <div class="section">
                    <div class="section-title">LFO 2</div>

                    <div class="control">
                        <label class="control-label">Rate<span class="control-value" id="lfo2RateValue">25</span></label>
                        <input type="range" id="lfo2Rate" min="0" max="100" value="25" step="1">
                    </div>

                    <div class="control">
                        <label class="control-label">Wave</label>
                        <select id="lfo2Wave">
                            <option value="0">Sine</option>
                            <option value="1" selected>Triangle</option>
                            <option value="2">Sawtooth</option>
                            <option value="3">Square</option>
                        </select>
                    </div>

                    <div class="control">
                        <label class="control-label">→ Filter<span class="control-value" id="lfo2FilterValue">0</span></label>
                        <input type="range" id="lfo2Filter" min="0" max="100" value="0" step="1">
                    </div>

                    <div class="control">
                        <label class="control-label">→ PW<span class="control-value" id="lfo2PWValue">0</span></label>
                        <input type="range" id="lfo2PW" min="0" max="100" value="0" step="1">
                    </div>
                </div>

                <!-- Unison Section -->
                <div class="section">
                    <div class="section-title">Unison</div>

                    <div class="control">
                        <label class="control-label">Detune Mode</label>
                        <select id="detuneMode">
                            <option value="0" selected>Normal</option>
                            <option value="1">Wide</option>
                        </select>
                    </div>

                    <div class="control">
                        <label class="control-label">Detune<span class="control-value" id="detuneValue">30</span></label>
                        <input type="range" id="detune" min="0" max="100" value="30" step="1">
                    </div>
                </div>
            </div>

            <div class="sid-info">
                💡 RGSID emulates the legendary Commodore 64 SID chip. Use Ring Mod and Sync for classic digital sounds, and route voices through the filter for authentic C64 timbres.
            </div>
        `;
    }

    setupEventListeners() {
        const root = this.shadowRoot;

        // Voice selector buttons
        root.querySelectorAll('.voice-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const voice = parseInt(e.target.dataset.voice);
                this.switchVoice(voice);
            });
        });

        // Preset selector
        root.getElementById('presetSelect').addEventListener('change', (e) => {
            const presetIdx = parseInt(e.target.value);
            if (this.synth && typeof this.synth.loadPreset === 'function') {
                this.synth.loadPreset(presetIdx, this.currentVoice);
            }
        });

        // Voice parameters (will be routed to correct voice based on currentVoice)
        this.setupVoiceControls();

        // Filter
        root.getElementById('filterMode').addEventListener('change', (e) => {
            this.setParameter(26, parseInt(e.target.value));
        });

        root.getElementById('cutoff').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(27, value);
            root.getElementById('cutoffValue').textContent = value;
        });

        root.getElementById('resonance').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(28, value);
            root.getElementById('resonanceValue').textContent = value;
        });

        root.getElementById('v1Flt').addEventListener('change', (e) => {
            this.setParameter(29, e.target.checked ? 1 : 0);
        });

        root.getElementById('v2Flt').addEventListener('change', (e) => {
            this.setParameter(30, e.target.checked ? 1 : 0);
        });

        root.getElementById('v3Flt').addEventListener('change', (e) => {
            this.setParameter(31, e.target.checked ? 1 : 0);
        });

        // Global
        root.getElementById('volume').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(32, value);
            root.getElementById('volumeValue').textContent = value;
        });

        root.getElementById('modWheel').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(33, value);
            root.getElementById('modWheelValue').textContent = value;
        });

        root.getElementById('engine').addEventListener('change', (e) => {
            this.setParameter(34, parseInt(e.target.value));
        });

        // LFO 1
        root.getElementById('lfo1Rate').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(35, value);
            root.getElementById('lfo1RateValue').textContent = value;
        });

        root.getElementById('lfo1Wave').addEventListener('change', (e) => {
            this.setParameter(36, parseInt(e.target.value));
        });

        root.getElementById('lfo1Pitch').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(37, value);
            root.getElementById('lfo1PitchValue').textContent = value;
        });

        // LFO 2
        root.getElementById('lfo2Rate').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(38, value);
            root.getElementById('lfo2RateValue').textContent = value;
        });

        root.getElementById('lfo2Wave').addEventListener('change', (e) => {
            this.setParameter(39, parseInt(e.target.value));
        });

        root.getElementById('lfo2Filter').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(40, value);
            root.getElementById('lfo2FilterValue').textContent = value;
        });

        root.getElementById('lfo2PW').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(41, value);
            root.getElementById('lfo2PWValue').textContent = value;
        });

        // Unison
        root.getElementById('detuneMode').addEventListener('change', (e) => {
            this.setParameter(42, parseInt(e.target.value));
        });

        root.getElementById('detune').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(43, value);
            root.getElementById('detuneValue').textContent = value;
        });
    }

    setupVoiceControls() {
        const root = this.shadowRoot;

        root.getElementById('waveform').addEventListener('change', (e) => {
            const paramIdx = this.getVoiceParamIndex(0);
            this.setParameter(paramIdx, parseInt(e.target.value));
        });

        root.getElementById('pw').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            const paramIdx = this.getVoiceParamIndex(1);
            this.setParameter(paramIdx, value);
            root.getElementById('pwValue').textContent = `${value}%`;
        });

        root.getElementById('attack').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            const paramIdx = this.getVoiceParamIndex(4);
            this.setParameter(paramIdx, value);
            root.getElementById('attackValue').textContent = value;
        });

        root.getElementById('decay').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            const paramIdx = this.getVoiceParamIndex(5);
            this.setParameter(paramIdx, value);
            root.getElementById('decayValue').textContent = value;
        });

        root.getElementById('sustain').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            const paramIdx = this.getVoiceParamIndex(6);
            this.setParameter(paramIdx, value);
            root.getElementById('sustainValue').textContent = value;
        });

        root.getElementById('release').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            const paramIdx = this.getVoiceParamIndex(7);
            this.setParameter(paramIdx, value);
            root.getElementById('releaseValue').textContent = value;
        });

        root.getElementById('ringMod').addEventListener('change', (e) => {
            const paramIdx = this.getVoiceParamIndex(2);
            this.setParameter(paramIdx, e.target.checked ? 1 : 0);
        });

        root.getElementById('sync').addEventListener('change', (e) => {
            const paramIdx = this.getVoiceParamIndex(3);
            this.setParameter(paramIdx, e.target.checked ? 1 : 0);
        });
    }

    switchVoice(voice) {
        this.currentVoice = voice;

        // Update button states
        const root = this.shadowRoot;
        root.querySelectorAll('.voice-btn').forEach(btn => {
            if (parseInt(btn.dataset.voice) === voice) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Update section title
        root.getElementById('voiceTitle').textContent = `Voice ${voice}`;
    }

    getVoiceParamIndex(offset) {
        // Voice 1: params 0-7, Voice 2: params 8-15, Voice 3: params 16-23
        const baseIndex = (this.currentVoice - 1) * 8;
        return baseIndex + offset;
    }

    setParameter(index, value) {
        if (this.synth && this.synth.setParameter) {
            this.synth.setParameter(index, value);

            // Record motion if sequencer is in recording mode
            if (this.sequencer && this.sequencer.pattern.recordingMotion) {
                this.sequencer.recordMotion(index, value);
            }

            // Emit parameter change event for knob sync
            const paramNames = {
                4: 'v1attack',
                5: 'v1decay',
                6: 'v1sustain',
                7: 'v1release',
                12: 'v2attack',
                13: 'v2decay',
                14: 'v2sustain',
                15: 'v2release',
                20: 'v3attack',
                21: 'v3decay',
                22: 'v3sustain',
                23: 'v3release',
                27: 'filtercutoff',
                28: 'filterresonance'
            };
            const paramName = paramNames[index];
            if (paramName) {
                emitParameterChange(index, paramName, value, this);
            }
        }
    }
}

// Register custom element
customElements.define('rgsid-ui', RGSIDui);
