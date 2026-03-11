// RV Bass UI Component - Simplified Bass Synth Controls
// Sections: VCF, LFO, EG, VCO (3 oscillators with pitch and mute), Volume

import { setupParameterSync, cleanupParameterSync, emitParameterChange } from './synth-ui-base.js';

class RVBassUI extends HTMLElement {
    constructor() {
        super();
        this.synth = null;
        this.sequencer = null;
        this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this.render();
        this.setupEventListeners();

        // Setup generic parameter sync
        setupParameterSync(this, {
            13: 'cutoff',
            14: 'resonance',
            16: 'attack',
            17: 'decayrelease',
            18: 'sustain',
            20: 'lforate'
        });
    }

    disconnectedCallback() {
        cleanupParameterSync(this);
    }

    // Called by setupParameterSync when external knob changes
    updateParameter(index, value) {
        const root = this.shadowRoot;

        switch(index) {
            case 13: // Cutoff
                const cutoff = root.getElementById('cutoff');
                if (cutoff) {
                    cutoff.value = value;
                    root.getElementById('cutoffValue').textContent = `${Math.round(value * 100)}%`;
                }
                break;
            case 14: // Resonance
                const peak = root.getElementById('peak');
                if (peak) {
                    peak.value = value;
                    root.getElementById('peakValue').textContent = `${Math.round(value * 100)}%`;
                }
                break;
        }
    }

    setSynth(synth) {
        this.synth = synth;

        // Send initial VCO levels (0.33 each = volca.js defaultVcoAmp)
        if (synth && synth.setParameter) {
            this.setParameter(9, 0.33);   // VCO1 Level
            this.setParameter(10, 0.33);  // VCO2 Level
            this.setParameter(11, 0.33);  // VCO3 Level
        }
    }

    setSequencer(sequencer) {
        this.sequencer = sequencer;
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
                    color: #CC3333;
                    text-transform: uppercase;
                    letter-spacing: 2px;
                    margin-bottom: 20px;
                    font-weight: bold;
                }

                .controls-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
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
                    margin-bottom: 15px;
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
                    color: #CC3333;
                    margin-left: 8px;
                    font-weight: bold;
                    min-width: 45px;
                    display: inline-block;
                }

                input[type="range"] {
                    width: 100%;
                    height: 4px;
                    background: #2a2a2a;
                    border-radius: 2px;
                    outline: none;
                    -webkit-appearance: none;
                }

                input[type="range"]::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 14px;
                    height: 14px;
                    background: #CC3333;
                    cursor: pointer;
                    border-radius: 50%;
                }

                input[type="range"]::-moz-range-thumb {
                    width: 14px;
                    height: 14px;
                    background: #CC3333;
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
                    border-color: #CC3333;
                }

                .vco-row {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 12px;
                }

                .vco-number {
                    font-size: 12px;
                    color: #888;
                    font-weight: bold;
                    min-width: 30px;
                }

                .vco-controls {
                    flex: 1;
                    display: flex;
                    gap: 8px;
                    align-items: center;
                }

                .vco-pitch {
                    flex: 1;
                }

                .mute-btn {
                    padding: 6px 12px;
                    background: #0a0a0a;
                    border: 1px solid #2a2a2a;
                    color: #888;
                    font-size: 10px;
                    cursor: pointer;
                    border-radius: 3px;
                    text-transform: uppercase;
                    font-weight: bold;
                    transition: all 0.2s;
                    min-width: 50px;
                }

                .mute-btn:hover {
                    border-color: #CC3333;
                }

                .mute-btn.active {
                    background: #0a0a0a;
                    border-color: #2a2a2a;
                    color: #CC3333;
                }

                .mute-btn.muted {
                    background: #2a2a2a;
                    border-color: #3a3a3a;
                    color: #666;
                }

                .bass-info {
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

            <div class="panel-title">Regroove Voltakt Bass</div>

            <div class="controls-grid">
                <!-- VCF Section -->
                <div class="section">
                    <div class="section-title">VCF (Filter)</div>

                    <div class="control">
                        <label class="control-label">Cutoff</label>
                        <input type="range" id="cutoff" min="0" max="1" step="0.01" value="1">
                        <span class="control-value" id="cutoffValue">55%</span>
                    </div>

                    <div class="control">
                        <label class="control-label">Peak (Resonance)</label>
                        <input type="range" id="peak" min="0" max="1" step="0.01" value="0">
                        <span class="control-value" id="peakValue">71%</span>
                    </div>
                </div>

                <!-- LFO Section -->
                <div class="section">
                    <div class="section-title">LFO</div>

                    <div class="control">
                        <label class="control-label">Wave</label>
                        <select id="lfoWave">
                            <option value="0">Triangle</option>
                            <option value="0.5">Square</option>
                            <option value="1">Sawtooth</option>
                        </select>
                    </div>

                    <div class="control">
                        <label class="control-label">Rate</label>
                        <input type="range" id="lfoRate" min="0" max="1" step="0.01" value="0">
                        <span class="control-value" id="lfoRateValue">0%</span>
                    </div>

                    <div class="control">
                        <label class="control-label">Intensity</label>
                        <input type="range" id="lfoInt" min="0" max="1" step="0.01" value="0">
                        <span class="control-value" id="lfoIntValue">0%</span>
                    </div>

                    <div class="control">
                        <label class="control-label">Targets (Modulation)</label>
                        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                            <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
                                <input type="checkbox" id="lfoTargetPitch" style="cursor: pointer;">
                                <span style="font-size: 11px;">PITCH</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
                                <input type="checkbox" id="lfoTargetCutoff" style="cursor: pointer;">
                                <span style="font-size: 11px;">CUTOFF</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
                                <input type="checkbox" id="lfoTargetAmp" style="cursor: pointer;">
                                <span style="font-size: 11px;">AMP</span>
                            </label>
                        </div>
                    </div>
                </div>

                <!-- EG (Envelope) Section -->
                <div class="section">
                    <div class="section-title">EG (Envelope)</div>

                    <div class="control">
                        <label class="control-label">Attack</label>
                        <input type="range" id="attack" min="0" max="1" step="0.01" value="0">
                        <span class="control-value" id="attackValue">0%</span>
                    </div>

                    <div class="control">
                        <label class="control-label">Decay/Release</label>
                        <input type="range" id="decayRelease" min="0" max="1" step="0.01" value="0">
                        <span class="control-value" id="decayReleaseValue">0%</span>
                    </div>

                    <div class="control">
                        <label class="control-label">Sustain</label>
                        <input type="range" id="sustain" min="0" max="1" step="0.01" value="1">
                        <span class="control-value" id="sustainValue">100%</span>
                    </div>

                    <div class="control">
                        <label class="control-label">Cutoff EG Int</label>
                        <input type="range" id="vcfEgInt" min="0" max="1" step="0.01" value="0">
                        <span class="control-value" id="vcfEgIntValue">0%</span>
                    </div>

                    <div class="control">
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" id="sustainOn" style="cursor: pointer;">
                            <span style="font-size: 11px;">SUSTAIN ON</span>
                        </label>
                    </div>

                    <div class="control">
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" id="ampEgOn" style="cursor: pointer;">
                            <span style="font-size: 11px;">AMP EG ON</span>
                        </label>
                    </div>
                </div>

                <!-- Volume Section -->
                <div class="section">
                    <div class="section-title">Output</div>

                    <div class="control">
                        <label class="control-label">Volume</label>
                        <input type="range" id="volume" min="0" max="1" step="0.01" value="0.7">
                        <span class="control-value" id="volumeValue">70%</span>
                    </div>
                </div>
            </div>

            <!-- VCO Section (Full Width) -->
            <div class="section" style="margin-top: 15px;">
                <div class="section-title">VCO (Oscillators - Stacked)</div>

                <div class="vco-row">
                    <div class="vco-number">VCO 1</div>
                    <div class="vco-controls">
                        <div class="vco-pitch">
                            <label class="control-label">Wave</label>
                            <select id="vco1Wave">
                                <option value="0">Sawtooth</option>
                                <option value="0.5">Square</option>
                            </select>
                        </div>
                        <div class="vco-pitch">
                            <label class="control-label">Pitch<span class="control-value" id="vco1PitchValue">0c</span></label>
                            <input type="range" id="vco1Pitch" min="0" max="127" value="64" step="1">
                        </div>
                        <button class="mute-btn active" id="vco1Mute" data-vco="1">ON</button>
                    </div>
                </div>

                <div class="vco-row">
                    <div class="vco-number">VCO 2</div>
                    <div class="vco-controls">
                        <div class="vco-pitch">
                            <label class="control-label">Wave</label>
                            <select id="vco2Wave">
                                <option value="0">Sawtooth</option>
                                <option value="0.5">Square</option>
                            </select>
                        </div>
                        <div class="vco-pitch">
                            <label class="control-label">Pitch<span class="control-value" id="vco2PitchValue">0c</span></label>
                            <input type="range" id="vco2Pitch" min="0" max="127" value="64" step="1">
                        </div>
                        <button class="mute-btn active" id="vco2Mute" data-vco="2">ON</button>
                    </div>
                </div>

                <div class="vco-row">
                    <div class="vco-number">VCO 3</div>
                    <div class="vco-controls">
                        <div class="vco-pitch">
                            <label class="control-label">Wave</label>
                            <select id="vco3Wave">
                                <option value="0">Sawtooth</option>
                                <option value="0.5">Square</option>
                            </select>
                        </div>
                        <div class="vco-pitch">
                            <label class="control-label">Pitch<span class="control-value" id="vco3PitchValue">0c</span></label>
                            <input type="range" id="vco3Pitch" min="0" max="127" value="64" step="1">
                        </div>
                        <button class="mute-btn active" id="vco3Mute" data-vco="3">ON</button>
                    </div>
                </div>
            </div>

            <div class="bass-info">
                💡 RV Bass is monophonic with 3 stacked oscillators for fat bass sounds.
                Adjust individual oscillator pitches and mute/unmute to shape your tone.
            </div>
        `;
    }

    setupEventListeners() {
        const root = this.shadowRoot;

        // VCF
        root.getElementById('cutoff').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.setParameter(13, value);
            root.getElementById('cutoffValue').textContent = `${Math.round(value * 100)}%`;
        });

        root.getElementById('peak').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.setParameter(14, value);
            root.getElementById('peakValue').textContent = `${Math.round(value * 100)}%`;
        });

        // LFO
        this.lfoIntensity = 0.5;  // Track current intensity

        root.getElementById('lfoWave').addEventListener('change', (e) => {
            this.setParameter(19, parseFloat(e.target.value));
        });

        root.getElementById('lfoRate').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.setParameter(20, value);
            root.getElementById('lfoRateValue').textContent = `${Math.round(value * 100)}%`;
        });

        root.getElementById('lfoInt').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.lfoIntensity = value;
            root.getElementById('lfoIntValue').textContent = `${Math.round(value * 100)}%`;

            // Update all enabled targets with new intensity
            if (root.getElementById('lfoTargetPitch').checked) {
                this.setParameter(21, value);
            }
            if (root.getElementById('lfoTargetCutoff').checked) {
                this.setParameter(22, value);
            }
            if (root.getElementById('lfoTargetAmp').checked) {
                this.setParameter(23, value);
            }
        });

        root.getElementById('lfoTargetPitch').addEventListener('change', (e) => {
            const value = e.target.checked ? this.lfoIntensity : 0;
            this.setParameter(21, value);
        });

        root.getElementById('lfoTargetCutoff').addEventListener('change', (e) => {
            const value = e.target.checked ? this.lfoIntensity : 0;
            this.setParameter(22, value);
        });

        root.getElementById('lfoTargetAmp').addEventListener('change', (e) => {
            const value = e.target.checked ? this.lfoIntensity : 0;
            this.setParameter(23, value);
        });

        // EG Switches
        root.getElementById('sustainOn').addEventListener('change', (e) => {
            this.setParameter(24, e.target.checked ? 1.0 : 0.0);
        });

        root.getElementById('ampEgOn').addEventListener('change', (e) => {
            this.setParameter(25, e.target.checked ? 1.0 : 0.0);
        });

        // EG
        root.getElementById('attack').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.setParameter(16, value);
            root.getElementById('attackValue').textContent = `${Math.round(value * 100)}%`;
        });

        root.getElementById('decayRelease').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.setParameter(17, value);
            root.getElementById('decayReleaseValue').textContent = `${Math.round(value * 100)}%`;
        });

        root.getElementById('sustain').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.setParameter(18, value);
            root.getElementById('sustainValue').textContent = `${Math.round(value * 100)}%`;
        });

        root.getElementById('vcfEgInt').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.setParameter(15, value);
            root.getElementById('vcfEgIntValue').textContent = `${Math.round(value * 100)}%`;
        });

        // Volume
        root.getElementById('volume').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.setParameter(26, value);  // Bass param 26 = volume
            root.getElementById('volumeValue').textContent = `${Math.round(value * 100)}%`;
        });

        // VCO Wave controls
        root.getElementById('vco1Wave').addEventListener('change', (e) => {
            this.setParameter(0, parseFloat(e.target.value));  // VCO1 Wave
        });

        root.getElementById('vco2Wave').addEventListener('change', (e) => {
            this.setParameter(1, parseFloat(e.target.value));  // VCO2 Wave
        });

        root.getElementById('vco3Wave').addEventListener('change', (e) => {
            this.setParameter(2, parseFloat(e.target.value));  // VCO3 Wave
        });

        // VCO Pitch controls (MIDI 0-127 mapped to cents via pitchMap)
        root.getElementById('vco1Pitch').addEventListener('input', (e) => {
            const midiValue = parseInt(e.target.value);
            const normalized = midiValue / 127.0;
            const cents = this.midiToCents(midiValue);
            this.setParameter(3, normalized);  // VCO1 Pitch
            root.getElementById('vco1PitchValue').textContent = cents >= 0 ? `+${cents}c` : `${cents}c`;
        });

        root.getElementById('vco2Pitch').addEventListener('input', (e) => {
            const midiValue = parseInt(e.target.value);
            const normalized = midiValue / 127.0;
            const cents = this.midiToCents(midiValue);
            this.setParameter(4, normalized);  // VCO2 Pitch
            root.getElementById('vco2PitchValue').textContent = cents >= 0 ? `+${cents}c` : `${cents}c`;
        });

        root.getElementById('vco3Pitch').addEventListener('input', (e) => {
            const midiValue = parseInt(e.target.value);
            const normalized = midiValue / 127.0;
            const cents = this.midiToCents(midiValue);
            this.setParameter(5, normalized);  // VCO3 Pitch
            root.getElementById('vco3PitchValue').textContent = cents >= 0 ? `+${cents}c` : `${cents}c`;
        });

        // VCO Mute buttons
        root.getElementById('vco1Mute').addEventListener('click', (e) => {
            this.toggleMute(e.target, 9);  // VCO1 Level
        });

        root.getElementById('vco2Mute').addEventListener('click', (e) => {
            this.toggleMute(e.target, 10);  // VCO2 Level
        });

        root.getElementById('vco3Mute').addEventListener('click', (e) => {
            this.toggleMute(e.target, 11);  // VCO3 Level
        });
    }

    midiToCents(midiValue) {
        // VCO Pitch Map from volca.js (MIDI 0-127 to cents)
        const pitchMap = [
            -1200, -1200, -1100, -1000, -900, -800, -700, -600, -500, -400, -300, -200, -100,
            -96, -92, -88, -84, -80, -78, -76, -74, -72, -70, -68, -66, -64, -62, -60, -58,
            -56, -54, -52, -50, -48, -46, -44, -42, -40, -38, -36, -34, -32, -30, -28, -26,
            -24, -22, -20, -18, -16, -14, -12, -10, -8, -6, -4, -2,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32,
            34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60, 62, 64,
            66, 68, 70, 72, 74, 76, 78, 80, 84, 88, 92, 96, 100,
            200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1200
        ];
        return pitchMap[Math.min(127, Math.max(0, midiValue))];
    }

    toggleMute(button, paramIndex) {
        const isMuted = button.classList.contains('muted');

        if (isMuted) {
            // Unmute - set level to 0.33 (volca.js defaultVcoAmp)
            button.classList.remove('muted');
            button.classList.add('active');
            button.textContent = 'ON';
            this.setParameter(paramIndex, 0.33);
        } else {
            // Mute - set level to 0
            button.classList.remove('active');
            button.classList.add('muted');
            button.textContent = 'MUTE';
            this.setParameter(paramIndex, 0.0);
        }
    }

    setParameter(index, value) {
        if (this.synth && this.synth.setParameter) {
            this.synth.setParameter(index, value);

            // Record motion if sequencer is in recording mode
            if (this.sequencer && this.sequencer.pattern.recordingMotion) {
                this.sequencer.recordMotion(index, value);
            }

            // Emit parameter change event for knob sync (generic)
            const paramNames = {
                13: 'cutoff',
                14: 'resonance',
                16: 'attack',
                17: 'decayrelease',
                18: 'sustain',
                20: 'lforate'
            };
            const paramName = paramNames[index];
            if (paramName) {
                emitParameterChange(index, paramName, value);
            }
        }
    }
}

// Register custom element
customElements.define('rvbass-ui', RVBassUI);
