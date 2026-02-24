// RV Bass UI Component - Simplified Bass Synth Controls
// Sections: VCF, LFO, EG, VCO (3 oscillators with pitch and mute), Volume

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
    }

    setSynth(synth) {
        this.synth = synth;

        // Send initial VCO levels (all ON by default)
        if (synth && synth.setParameter) {
            this.setParameter(9, 1.0);   // VCO1 Level ON
            this.setParameter(10, 1.0);  // VCO2 Level ON
            this.setParameter(11, 1.0);  // VCO3 Level ON
            console.log('[RV Bass UI] Initialized VCO levels to ON');
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

            <div class="panel-title">🎸 RV Bass (Voltakt Bass)</div>

            <div class="controls-grid">
                <!-- VCF Section -->
                <div class="section">
                    <div class="section-title">VCF (Filter)</div>

                    <div class="control">
                        <label class="control-label">Cutoff</label>
                        <input type="range" id="cutoff" min="0" max="1" step="0.01" value="0.55">
                        <span class="control-value" id="cutoffValue">55%</span>
                    </div>

                    <div class="control">
                        <label class="control-label">Peak (Resonance)</label>
                        <input type="range" id="peak" min="0" max="1" step="0.01" value="0.71">
                        <span class="control-value" id="peakValue">71%</span>
                    </div>
                </div>

                <!-- LFO Section -->
                <div class="section">
                    <div class="section-title">LFO</div>

                    <div class="control">
                        <label class="control-label">Rate</label>
                        <input type="range" id="lfoRate" min="0" max="1" step="0.01" value="0.31">
                        <span class="control-value" id="lfoRateValue">31%</span>
                    </div>

                    <div class="control">
                        <label class="control-label">Int (Cutoff)</label>
                        <input type="range" id="lfoInt" min="0" max="1" step="0.01" value="0">
                        <span class="control-value" id="lfoIntValue">0%</span>
                    </div>
                </div>

                <!-- EG (Envelope) Section -->
                <div class="section">
                    <div class="section-title">EG (Envelope)</div>

                    <div class="control">
                        <label class="control-label">Attack</label>
                        <input type="range" id="attack" min="0" max="1" step="0.01" value="0.16">
                        <span class="control-value" id="attackValue">16%</span>
                    </div>

                    <div class="control">
                        <label class="control-label">Decay/Release</label>
                        <input type="range" id="decayRelease" min="0" max="1" step="0.01" value="0.63">
                        <span class="control-value" id="decayReleaseValue">63%</span>
                    </div>

                    <div class="control">
                        <label class="control-label">Sustain</label>
                        <input type="range" id="sustain" min="0" max="1" step="0.01" value="0.71">
                        <span class="control-value" id="sustainValue">71%</span>
                    </div>

                    <div class="control">
                        <label class="control-label">Cutoff EG Int</label>
                        <input type="range" id="vcfEgInt" min="0" max="1" step="0.01" value="0.39">
                        <span class="control-value" id="vcfEgIntValue">39%</span>
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
                            <label class="control-label">Pitch</label>
                            <select id="vco1Pitch">
                                <option value="0.5" selected>0</option>
                                <option value="0.42">-1</option>
                                <option value="0.58">+1</option>
                                <option value="0.33">-2</option>
                                <option value="0.67">+2</option>
                            </select>
                        </div>
                        <button class="mute-btn active" id="vco1Mute" data-vco="1">ON</button>
                    </div>
                </div>

                <div class="vco-row">
                    <div class="vco-number">VCO 2</div>
                    <div class="vco-controls">
                        <div class="vco-pitch">
                            <label class="control-label">Pitch</label>
                            <select id="vco2Pitch">
                                <option value="0.5" selected>0</option>
                                <option value="0.42">-1</option>
                                <option value="0.58">+1</option>
                                <option value="0.33">-2</option>
                                <option value="0.67">+2</option>
                            </select>
                        </div>
                        <button class="mute-btn active" id="vco2Mute" data-vco="2">ON</button>
                    </div>
                </div>

                <div class="vco-row">
                    <div class="vco-number">VCO 3</div>
                    <div class="vco-controls">
                        <div class="vco-pitch">
                            <label class="control-label">Pitch</label>
                            <select id="vco3Pitch">
                                <option value="0.5" selected>0</option>
                                <option value="0.42">-1</option>
                                <option value="0.58">+1</option>
                                <option value="0.33">-2</option>
                                <option value="0.67">+2</option>
                            </select>
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
        root.getElementById('lfoRate').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.setParameter(20, value);
            root.getElementById('lfoRateValue').textContent = `${Math.round(value * 100)}%`;
        });

        root.getElementById('lfoInt').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.setParameter(22, value);  // LFO Cutoff Int
            root.getElementById('lfoIntValue').textContent = `${Math.round(value * 100)}%`;
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
            this.setParameter(24, value);  // Bass param 24 = volume
            root.getElementById('volumeValue').textContent = `${Math.round(value * 100)}%`;
        });

        // VCO Pitch controls
        root.getElementById('vco1Pitch').addEventListener('change', (e) => {
            this.setParameter(3, parseFloat(e.target.value));  // VCO1 Pitch
        });

        root.getElementById('vco2Pitch').addEventListener('change', (e) => {
            this.setParameter(4, parseFloat(e.target.value));  // VCO2 Pitch
        });

        root.getElementById('vco3Pitch').addEventListener('change', (e) => {
            this.setParameter(5, parseFloat(e.target.value));  // VCO3 Pitch
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

    toggleMute(button, paramIndex) {
        const isMuted = button.classList.contains('muted');

        if (isMuted) {
            // Unmute - set level to 100%
            button.classList.remove('muted');
            button.classList.add('active');
            button.textContent = 'ON';
            this.setParameter(paramIndex, 1.0);
        } else {
            // Mute - set level to 0%
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
        }
    }
}

// Register custom element
customElements.define('rvbass-ui', RVBassUI);
