// RV Keys UI Component - Matches Volca Keys Hardware Layout
// Sections: Voicing, Octave, VCO, VCF, LFO, EG, Delay, Volume

class RVKeysUI extends HTMLElement {
    constructor() {
        super();
        this.synth = null;
        this.sequencer = null;
        this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this.render();
        this.setupEventListeners();
    }

    setSynth(synth) {
        this.synth = synth;
        // Initialize LFO Sync to ON by default
        this.setParameter(23, 1.0);
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
                    color: #0066FF;
                    text-transform: uppercase;
                    letter-spacing: 2px;
                    margin-bottom: 20px;
                    font-weight: bold;
                }

                .controls-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 20px;
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
                    color: #0066FF;
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
                    background: #0066FF;
                    cursor: pointer;
                    border-radius: 50%;
                }

                input[type="range"]::-moz-range-thumb {
                    width: 14px;
                    height: 14px;
                    background: #0066FF;
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
                    border-color: #0066FF;
                }

                .wave-toggle {
                    display: flex;
                    gap: 5px;
                }

                .wave-btn {
                    flex: 1;
                    padding: 6px;
                    background: #0a0a0a;
                    border: 1px solid #2a2a2a;
                    color: #888;
                    font-size: 10px;
                    cursor: pointer;
                    border-radius: 3px;
                    text-transform: uppercase;
                    transition: all 0.2s;
                }

                .wave-btn.active {
                    background: #0066FF;
                    border-color: #0088FF;
                    color: #fff;
                }

                .wave-btn:hover {
                    border-color: #0066FF;
                }

                .top-row {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 20px;
                    margin-bottom: 20px;
                }

                @media (max-width: 768px) {
                    .controls-grid {
                        grid-template-columns: 1fr;
                    }
                    .top-row {
                        grid-template-columns: 1fr;
                    }
                }
            </style>

            <div class="panel-title">Regroove Voltakt Keys</div>

            <!-- Top Row: Voicing & Octave -->
            <div class="top-row">
                <div class="section">
                    <div class="section-title">Voice Mode</div>
                    <div class="control">
                        <label class="control-label">Mode</label>
                        <select id="voiceMode">
                            <option value="0">Poly</option>
                            <option value="0.17">Unison</option>
                            <option value="0.34">Octave</option>
                            <option value="0.51">Fifth</option>
                            <option value="0.68">Unison Ring</option>
                            <option value="0.85">Poly Ring</option>
                        </select>
                    </div>
                </div>

                <div class="section">
                    <div class="section-title">Octave</div>
                    <div class="control">
                        <label class="control-label">Octave Shift</label>
                        <select id="octave">
                            <option value="0.1">-2</option>
                            <option value="0.3">-1</option>
                            <option value="0.5" selected>0</option>
                            <option value="0.7">+1</option>
                            <option value="0.9">+2</option>
                        </select>
                    </div>
                </div>
            </div>

            <!-- Main Controls Grid -->
            <div class="controls-grid">
                <!-- VCO Section -->
                <div class="section">
                    <div class="section-title">VCO (Oscillator)</div>

                    <div class="control">
                        <label class="control-label">Detune</label>
                        <input type="range" id="detune" min="0" max="1" step="0.01" value="0.5">
                        <span class="control-value" id="detuneValue">0 cents</span>
                    </div>

                    <div class="control">
                        <label class="control-label">Portamento</label>
                        <input type="range" id="portamento" min="0" max="1" step="0.01" value="0">
                        <span class="control-value" id="portamentoValue">Off</span>
                    </div>

                    <div class="control">
                        <label class="control-label">VCO EG Int</label>
                        <input type="range" id="vcoEgInt" min="0" max="1" step="0.01" value="0">
                        <span class="control-value" id="vcoEgIntValue">0</span>
                    </div>
                </div>

                <!-- VCF Section -->
                <div class="section">
                    <div class="section-title">VCF (Filter)</div>

                    <div class="control">
                        <label class="control-label">Cutoff</label>
                        <input type="range" id="cutoff" min="0" max="1" step="0.01" value="1.0">
                        <span class="control-value" id="cutoffValue">100%</span>
                    </div>

                    <div class="control">
                        <label class="control-label">Peak (Resonance)</label>
                        <input type="range" id="peak" min="0" max="1" step="0.01" value="0">
                        <span class="control-value" id="peakValue">0%</span>
                    </div>

                    <div class="control">
                        <label class="control-label">VCF EG Int</label>
                        <input type="range" id="vcfEgInt" min="0" max="1" step="0.01" value="0">
                        <span class="control-value" id="vcfEgIntValue">0%</span>
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
                        <label class="control-label">Pitch Int</label>
                        <input type="range" id="lfoPitchInt" min="0" max="1" step="0.01" value="0">
                        <span class="control-value" id="lfoPitchIntValue">0%</span>
                    </div>

                    <div class="control">
                        <label class="control-label">Cutoff Int</label>
                        <input type="range" id="lfoCutoffInt" min="0" max="1" step="0.01" value="0">
                        <span class="control-value" id="lfoCutoffIntValue">0%</span>
                    </div>

                    <div class="control">
                        <label class="control-label">Sync (Trigger on Note)</label>
                        <select id="lfoSync">
                            <option value="0">Off</option>
                            <option value="1" selected>On</option>
                        </select>
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
                        <input type="range" id="decayRelease" min="0" max="1" step="0.01" value="0.055">
                        <span class="control-value" id="decayReleaseValue">5.5%</span>
                    </div>

                    <div class="control">
                        <label class="control-label">Sustain</label>
                        <input type="range" id="sustain" min="0" max="1" step="0.01" value="1.0">
                        <span class="control-value" id="sustainValue">100%</span>
                    </div>
                </div>

                <!-- Delay Section -->
                <div class="section">
                    <div class="section-title">Delay</div>

                    <div class="control">
                        <label class="control-label">Enable</label>
                        <select id="delayEnable">
                            <option value="0">Off</option>
                            <option value="1">On</option>
                        </select>
                    </div>

                    <div class="control">
                        <label class="control-label">Time</label>
                        <input type="range" id="delayTime" min="0" max="1" step="0.01" value="0.5">
                        <span class="control-value" id="delayTimeValue">50%</span>
                    </div>

                    <div class="control">
                        <label class="control-label">Feedback</label>
                        <input type="range" id="delayFeedback" min="0" max="1" step="0.01" value="0.47">
                        <span class="control-value" id="delayFeedbackValue">47%</span>
                    </div>
                </div>

                <!-- Volume Section -->
                <div class="section">
                    <div class="section-title">Output</div>

                    <div class="control">
                        <label class="control-label">Volume</label>
                        <input type="range" id="volume" min="0" max="1" step="0.01" value="0.5">
                        <span class="control-value" id="volumeValue">50%</span>
                    </div>

                    <div class="control">
                        <label class="control-label" style="color: #666;">Sequencer</label>
                        <div style="font-size: 10px; color: #555; font-style: italic;">
                            (Not implemented)
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    setupEventListeners() {
        const root = this.shadowRoot;

        // Voice Mode
        root.getElementById('voiceMode').addEventListener('change', (e) => {
            this.setParameter(24, parseFloat(e.target.value));
        });

        // Octave
        root.getElementById('octave').addEventListener('change', (e) => {
            this.setParameter(26, parseFloat(e.target.value));
        });

        // VCO
        root.getElementById('detune').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.setParameter(7, value);  // VCO2 detune (main control)
            const cents = ((value - 0.5) * 100).toFixed(1);
            root.getElementById('detuneValue').textContent = `${cents} cents`;
        });

        root.getElementById('portamento').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.setParameter(27, value);
            root.getElementById('portamentoValue').textContent = value > 0.01 ? `${Math.round(value * 100)}%` : 'Off';
        });

        root.getElementById('vcoEgInt').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.setParameter(12, value);
            root.getElementById('vcoEgIntValue').textContent = Math.round(value * 100);
        });

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

        root.getElementById('vcfEgInt').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.setParameter(15, value);
            root.getElementById('vcfEgIntValue').textContent = `${Math.round(value * 100)}%`;
        });

        // LFO
        root.getElementById('lfoWave').addEventListener('change', (e) => {
            this.setParameter(19, parseFloat(e.target.value));
        });

        root.getElementById('lfoRate').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.setParameter(20, value);
            root.getElementById('lfoRateValue').textContent = `${Math.round(value * 100)}%`;
        });

        root.getElementById('lfoPitchInt').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.setParameter(21, value);
            root.getElementById('lfoPitchIntValue').textContent = `${Math.round(value * 100)}%`;
        });

        root.getElementById('lfoCutoffInt').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.setParameter(22, value);
            root.getElementById('lfoCutoffIntValue').textContent = `${Math.round(value * 100)}%`;
        });

        root.getElementById('lfoSync').addEventListener('change', (e) => {
            this.setParameter(23, parseFloat(e.target.value));
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

        // Delay
        root.getElementById('delayEnable').addEventListener('change', (e) => {
            this.setParameter(28, parseFloat(e.target.value));
        });

        root.getElementById('delayTime').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.setParameter(29, value);
            root.getElementById('delayTimeValue').textContent = `${Math.round(value * 100)}%`;
        });

        root.getElementById('delayFeedback').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.setParameter(30, value);
            root.getElementById('delayFeedbackValue').textContent = `${Math.round(value * 100)}%`;
        });

        // Volume
        root.getElementById('volume').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.setParameter(25, value);
            root.getElementById('volumeValue').textContent = `${Math.round(value * 100)}%`;
        });
    }

    setParameter(index, value) {
        if (this.synth && this.synth.setParameter) {
            this.synth.setParameter(index, value);

            // Record motion if sequencer is in recording mode
            if (this.sequencer && this.sequencer.pattern.recordingMotion) {
                this.sequencer.recordMotion(index, value);
            }
        }
    }
}

// Register custom element
customElements.define('rvkeys-ui', RVKeysUI);
