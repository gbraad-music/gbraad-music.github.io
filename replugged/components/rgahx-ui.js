// RGAHX UI Component - Amiga AHX Synthesizer Controls
// Sections: Oscillator, Envelope, Filter, PWM, Vibrato, Hard Cut Release

import { setupParameterSync, cleanupParameterSync, emitParameterChange } from './synth-ui-base.js';

class RGAHXui extends HTMLElement {
    constructor() {
        super();
        this.synth = null;
        this.sequencer = null;
        this.attachShadow({ mode: 'open' });
        this.updatingFromExternal = false; // Flag to prevent feedback loop
    }

    connectedCallback() {
        this.render();
        this.setupEventListeners();

        // Setup generic parameter sync for ALL parameters
        setupParameterSync(this, {
            0: 'waveform',
            1: 'wavelength',
            2: 'volume',
            3: 'attacktime',
            4: 'attackvolume',
            5: 'decaytime',
            6: 'decayvolume',
            7: 'sustaintime',
            8: 'releasetime',
            9: 'releasevolume',
            10: 'filterlower',
            11: 'filterupper',
            12: 'filterspeed',
            13: 'filterenable',
            14: 'pwmlower',
            15: 'pwmupper',
            16: 'pwmspeed',
            17: 'pwmenable',
            18: 'vibratodelay',
            19: 'vibratodepth',
            20: 'vibratospeed',
            21: 'hardcutenable',
            22: 'hardcutframes'
        });
    }

    disconnectedCallback() {
        cleanupParameterSync(this);
    }

    // Called by setupParameterSync when external knob changes
    updateParameter(index, value) {
        const root = this.shadowRoot;

        // Set flag to prevent feedback loop (UI change → setParameter → change synth)
        this.updatingFromExternal = true;

        // Get parameter info to know the range
        const paramInfo = this.synth?.getParameterInfo?.()[index];
        if (!paramInfo) {
            this.updatingFromExternal = false;
            return;
        }

        // For integer parameters, value comes as the actual integer (not normalized)
        // For normalized parameters, value is 0-1
        const isIntParam = paramInfo.type === 'int' || paramInfo.type === 'boolean' || paramInfo.enum_values;

        switch(index) {
            case 0: // Waveform
                const waveform = root.getElementById('waveform');
                if (waveform) waveform.value = value;
                break;
            case 1: // Wave Length
                if (root.getElementById('waveLen')) {
                    root.getElementById('waveLen').value = value;
                    root.getElementById('waveLenValue').textContent = value;
                }
                break;
            case 2: // Volume
                if (root.getElementById('volume')) {
                    root.getElementById('volume').value = value;
                    root.getElementById('volumeValue').textContent = value;
                }
                break;
            case 3: // Attack Time
                if (root.getElementById('aTime')) {
                    root.getElementById('aTime').value = value;
                    root.getElementById('aTimeValue').textContent = value;
                }
                break;
            case 4: // Attack Volume
                if (root.getElementById('aVol')) {
                    root.getElementById('aVol').value = value;
                    root.getElementById('aVolValue').textContent = value;
                }
                break;
            case 5: // Decay Time
                if (root.getElementById('dTime')) {
                    root.getElementById('dTime').value = value;
                    root.getElementById('dTimeValue').textContent = value;
                }
                break;
            case 6: // Decay Volume
                if (root.getElementById('dVol')) {
                    root.getElementById('dVol').value = value;
                    root.getElementById('dVolValue').textContent = value;
                }
                break;
            case 7: // Sustain Time
                if (root.getElementById('sTime')) {
                    root.getElementById('sTime').value = value;
                    root.getElementById('sTimeValue').textContent = value === 0 ? '∞' : value;
                }
                break;
            case 8: // Release Time
                if (root.getElementById('rTime')) {
                    root.getElementById('rTime').value = value;
                    root.getElementById('rTimeValue').textContent = value;
                }
                break;
            case 9: // Release Volume
                if (root.getElementById('rVol')) {
                    root.getElementById('rVol').value = value;
                    root.getElementById('rVolValue').textContent = value;
                }
                break;
            case 10: // Filter Lower
                if (root.getElementById('filterLower')) {
                    root.getElementById('filterLower').value = value;
                    root.getElementById('filterLowerValue').textContent = value;
                }
                break;
            case 11: // Filter Upper
                if (root.getElementById('filterUpper')) {
                    root.getElementById('filterUpper').value = value;
                    root.getElementById('filterUpperValue').textContent = value;
                }
                break;
            case 12: // Filter Speed
                if (root.getElementById('filterSpeed')) {
                    root.getElementById('filterSpeed').value = value;
                    root.getElementById('filterSpeedValue').textContent = value;
                }
                break;
            case 13: // Filter Enable
                if (root.getElementById('filterEnable')) {
                    root.getElementById('filterEnable').checked = value === 1;
                }
                break;
            case 14: // PWM Lower
                if (root.getElementById('pwmLower')) {
                    root.getElementById('pwmLower').value = value;
                    root.getElementById('pwmLowerValue').textContent = value;
                }
                break;
            case 15: // PWM Upper
                if (root.getElementById('pwmUpper')) {
                    root.getElementById('pwmUpper').value = value;
                    root.getElementById('pwmUpperValue').textContent = value;
                }
                break;
            case 16: // PWM Speed
                if (root.getElementById('pwmSpeed')) {
                    root.getElementById('pwmSpeed').value = value;
                    root.getElementById('pwmSpeedValue').textContent = value;
                }
                break;
            case 17: // PWM Enable
                if (root.getElementById('pwmEnable')) {
                    root.getElementById('pwmEnable').checked = value === 1;
                }
                break;
            case 18: // Vibrato Delay
                if (root.getElementById('vibratoDelay')) {
                    root.getElementById('vibratoDelay').value = value;
                    root.getElementById('vibratoDelayValue').textContent = value;
                }
                break;
            case 19: // Vibrato Depth
                if (root.getElementById('vibratoDepth')) {
                    root.getElementById('vibratoDepth').value = value;
                    root.getElementById('vibratoDepthValue').textContent = value;
                }
                break;
            case 20: // Vibrato Speed
                if (root.getElementById('vibratoSpeed')) {
                    root.getElementById('vibratoSpeed').value = value;
                    root.getElementById('vibratoSpeedValue').textContent = value;
                }
                break;
            case 21: // Hard Cut Enable
                if (root.getElementById('hardCutEnable')) {
                    root.getElementById('hardCutEnable').checked = value === 1;
                }
                break;
            case 22: // Hard Cut Frames
                if (root.getElementById('hardCutFrames')) {
                    root.getElementById('hardCutFrames').value = value;
                    root.getElementById('hardCutFramesValue').textContent = value;
                }
                break;
        }

        // Reset flag after UI update
        this.updatingFromExternal = false;
    }

    setSynth(synth) {
        this.synth = synth;

        // Sync UI with current synth parameter values
        this.syncUIWithSynth();
    }

    syncUIWithSynth() {
        if (!this.synth || !this.synth.workletNode) return;

        // Request current parameter values from the synth
        // For now, we'll just update UI to match hardcoded defaults
        // TODO: Add WASM function to query current parameter values
        console.log('[RGAHX UI] Synced with synth (TODO: read actual values from WASM)');
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
                    color: #FF6B35;
                    text-transform: uppercase;
                    letter-spacing: 2px;
                    margin-bottom: 20px;
                    font-weight: bold;
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
                    color: #FF6B35;
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
                    background: #FF6B35;
                    cursor: pointer;
                    border-radius: 50%;
                }

                input[type="range"]::-moz-range-thumb {
                    width: 14px;
                    height: 14px;
                    background: #FF6B35;
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
                    border-color: #FF6B35;
                }

                input[type="checkbox"] {
                    cursor: pointer;
                }

                .envelope-grid {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 10px;
                }

                .ahx-info {
                    background: #0a0a0a;
                    border: 1px solid #2a2a2a;
                    border-radius: 4px;
                    padding: 12px;
                    margin-top: 15px;
                    font-size: 10px;
                    color: #666;
                    text-align: center;
                }

                .button {
                    background: #FF6B35;
                    color: white;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 10px;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    font-weight: bold;
                    transition: background 0.2s;
                }

                .button:hover {
                    background: #ff8555;
                }

                .button:active {
                    background: #cc5528;
                }

                .file-input-wrapper {
                    position: relative;
                    overflow: hidden;
                    display: inline-block;
                }

                .file-input-wrapper input[type=file] {
                    position: absolute;
                    left: -9999px;
                }

                @media (max-width: 768px) {
                    .controls-grid {
                        grid-template-columns: 1fr;
                    }
                }
            </style>

            <div class="panel-title">RGAHX - Amiga AHX/HivelyTracker</div>

            <div class="controls-grid">
                <!-- Oscillator Section -->
                <div class="section">
                    <div class="section-title">Oscillator</div>

                    <div class="control">
                        <label class="control-label">Waveform</label>
                        <select id="waveform">
                            <option value="0">Triangle</option>
                            <option value="1" selected>Sawtooth</option>
                            <option value="2">Square</option>
                            <option value="3">Noise</option>
                        </select>
                    </div>

                    <div class="control">
                        <label class="control-label">Wave Length<span class="control-value" id="waveLenValue">4</span></label>
                        <input type="range" id="waveLen" min="0" max="5" value="4" step="1">
                    </div>

                    <div class="control">
                        <label class="control-label">Volume<span class="control-value" id="volumeValue">64</span></label>
                        <input type="range" id="volume" min="0" max="64" value="64" step="1">
                    </div>
                </div>

                <!-- Envelope Section -->
                <div class="section">
                    <div class="section-title">Envelope (ADSR)</div>

                    <div class="envelope-grid">
                        <div class="control">
                            <label class="control-label">Attack Time<span class="control-value" id="aTimeValue">1</span></label>
                            <input type="range" id="aTime" min="0" max="255" value="1" step="1">
                        </div>

                        <div class="control">
                            <label class="control-label">Attack Vol<span class="control-value" id="aVolValue">64</span></label>
                            <input type="range" id="aVol" min="0" max="64" value="64" step="1">
                        </div>

                        <div class="control">
                            <label class="control-label">Decay Time<span class="control-value" id="dTimeValue">20</span></label>
                            <input type="range" id="dTime" min="0" max="255" value="20" step="1">
                        </div>

                        <div class="control">
                            <label class="control-label">Decay Vol<span class="control-value" id="dVolValue">48</span></label>
                            <input type="range" id="dVol" min="0" max="64" value="48" step="1">
                        </div>

                        <div class="control">
                            <label class="control-label">Sustain Time<span class="control-value" id="sTimeValue">∞</span></label>
                            <input type="range" id="sTime" min="0" max="255" value="0" step="1">
                        </div>

                        <div class="control">
                            <label class="control-label">Release Time<span class="control-value" id="rTimeValue">30</span></label>
                            <input type="range" id="rTime" min="0" max="255" value="30" step="1">
                        </div>

                        <div class="control">
                            <label class="control-label">Release Vol<span class="control-value" id="rVolValue">0</span></label>
                            <input type="range" id="rVol" min="0" max="64" value="0" step="1">
                        </div>
                    </div>
                </div>

                <!-- Filter Section -->
                <div class="section">
                    <div class="section-title">Filter</div>

                    <div class="control">
                        <label class="control-label">Lower<span class="control-value" id="filterLowerValue">1</span></label>
                        <input type="range" id="filterLower" min="0" max="63" value="1" step="1">
                    </div>

                    <div class="control">
                        <label class="control-label">Upper<span class="control-value" id="filterUpperValue">63</span></label>
                        <input type="range" id="filterUpper" min="0" max="63" value="63" step="1">
                    </div>

                    <div class="control">
                        <label class="control-label">Speed<span class="control-value" id="filterSpeedValue">0</span></label>
                        <input type="range" id="filterSpeed" min="0" max="63" value="0" step="1">
                    </div>

                    <div class="control">
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" id="filterEnable" style="cursor: pointer;">
                            <span style="font-size: 11px;">ENABLE</span>
                        </label>
                    </div>
                </div>

                <!-- PWM Section -->
                <div class="section">
                    <div class="section-title">PWM (Pulse Width Modulation)</div>

                    <div class="control">
                        <label class="control-label">Lower<span class="control-value" id="pwmLowerValue">1</span></label>
                        <input type="range" id="pwmLower" min="0" max="63" value="1" step="1">
                    </div>

                    <div class="control">
                        <label class="control-label">Upper<span class="control-value" id="pwmUpperValue">63</span></label>
                        <input type="range" id="pwmUpper" min="0" max="63" value="63" step="1">
                    </div>

                    <div class="control">
                        <label class="control-label">Speed<span class="control-value" id="pwmSpeedValue">0</span></label>
                        <input type="range" id="pwmSpeed" min="0" max="63" value="0" step="1">
                    </div>

                    <div class="control">
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" id="pwmEnable" style="cursor: pointer;">
                            <span style="font-size: 11px;">ENABLE</span>
                        </label>
                    </div>
                </div>

                <!-- Vibrato Section -->
                <div class="section">
                    <div class="section-title">Vibrato</div>

                    <div class="control">
                        <label class="control-label">Delay<span class="control-value" id="vibratoDelayValue">0</span></label>
                        <input type="range" id="vibratoDelay" min="0" max="255" value="0" step="1">
                    </div>

                    <div class="control">
                        <label class="control-label">Depth<span class="control-value" id="vibratoDepthValue">0</span></label>
                        <input type="range" id="vibratoDepth" min="0" max="255" value="0" step="1">
                    </div>

                    <div class="control">
                        <label class="control-label">Speed<span class="control-value" id="vibratoSpeedValue">0</span></label>
                        <input type="range" id="vibratoSpeed" min="0" max="255" value="0" step="1">
                    </div>
                </div>

                <!-- Hard Cut Release Section -->
                <div class="section">
                    <div class="section-title">Hard Cut Release</div>

                    <div class="control">
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" id="hardCutEnable" style="cursor: pointer;">
                            <span style="font-size: 11px;">ENABLE</span>
                        </label>
                    </div>

                    <div class="control">
                        <label class="control-label">Frames<span class="control-value" id="hardCutFramesValue">0</span></label>
                        <input type="range" id="hardCutFrames" min="0" max="255" value="0" step="1">
                    </div>
                </div>

                <!-- PList Management Section -->
                <div class="section">
                    <div class="section-title">PList / Preset</div>

                    <div class="control">
                        <div class="file-input-wrapper">
                            <button class="button" id="plistLoadButton">Load PList / AHX</button>
                            <input type="file" id="plistFileInput" accept=".ahx,.ahxp" style="display: none;">
                        </div>
                    </div>
                </div>
            </div>

            <div class="ahx-info">
                💡 RGAHX is an authentic Amiga AHX synthesizer. Use envelope controls for classic chiptune ADSR shaping, filter for tonal sweeps, and PWM for evolving textures.
            </div>
        `;
    }

    setupEventListeners() {
        const root = this.shadowRoot;

        // Oscillator
        root.getElementById('waveform').addEventListener('change', (e) => {
            this.setParameter(0, parseInt(e.target.value));
        });

        root.getElementById('waveLen').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(1, value);
            root.getElementById('waveLenValue').textContent = value;
        });

        root.getElementById('volume').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(2, value);
            root.getElementById('volumeValue').textContent = value;
        });

        // Envelope
        root.getElementById('aTime').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(3, value);
            root.getElementById('aTimeValue').textContent = value;
        });

        root.getElementById('aVol').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(4, value);
            root.getElementById('aVolValue').textContent = value;
        });

        root.getElementById('dTime').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(5, value);
            root.getElementById('dTimeValue').textContent = value;
        });

        root.getElementById('dVol').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(6, value);
            root.getElementById('dVolValue').textContent = value;
        });

        root.getElementById('sTime').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(7, value);
            root.getElementById('sTimeValue').textContent = value === 0 ? '∞' : value;
        });

        root.getElementById('rTime').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(8, value);
            root.getElementById('rTimeValue').textContent = value;
        });

        root.getElementById('rVol').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(9, value);
            root.getElementById('rVolValue').textContent = value;
        });

        // Filter
        root.getElementById('filterLower').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(10, value);
            root.getElementById('filterLowerValue').textContent = value;
        });

        root.getElementById('filterUpper').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(11, value);
            root.getElementById('filterUpperValue').textContent = value;
        });

        root.getElementById('filterSpeed').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(12, value);
            root.getElementById('filterSpeedValue').textContent = value;
        });

        root.getElementById('filterEnable').addEventListener('change', (e) => {
            this.setParameter(13, e.target.checked ? 1 : 0);
        });

        // PWM
        root.getElementById('pwmLower').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(14, value);
            root.getElementById('pwmLowerValue').textContent = value;
        });

        root.getElementById('pwmUpper').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(15, value);
            root.getElementById('pwmUpperValue').textContent = value;
        });

        root.getElementById('pwmSpeed').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(16, value);
            root.getElementById('pwmSpeedValue').textContent = value;
        });

        root.getElementById('pwmEnable').addEventListener('change', (e) => {
            this.setParameter(17, e.target.checked ? 1 : 0);
        });

        // Vibrato
        root.getElementById('vibratoDelay').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(18, value);
            root.getElementById('vibratoDelayValue').textContent = value;
        });

        root.getElementById('vibratoDepth').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(19, value);
            root.getElementById('vibratoDepthValue').textContent = value;
        });

        root.getElementById('vibratoSpeed').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(20, value);
            root.getElementById('vibratoSpeedValue').textContent = value;
        });

        // Hard Cut Release
        root.getElementById('hardCutEnable').addEventListener('change', (e) => {
            this.setParameter(21, e.target.checked ? 1 : 0);
        });

        root.getElementById('hardCutFrames').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.setParameter(22, value);
            root.getElementById('hardCutFramesValue').textContent = value;
        });

        // PList Management
        root.getElementById('plistLoadButton').addEventListener('click', () => {
            root.getElementById('plistFileInput').click();
        });

        root.getElementById('plistFileInput').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.loadPListFile(file);
            }
        });
    }

    setParameter(index, value) {
        // Don't apply parameter changes when UI is being updated from external source
        // This prevents feedback loop: knob → updateParameter → UI change → setParameter → synth
        if (this.updatingFromExternal) {
            return;
        }

        if (this.synth && this.synth.setParameter) {
            this.synth.setParameter(index, value);

            // Record motion if sequencer is in recording mode
            if (this.sequencer && this.sequencer.pattern.recordingMotion) {
                this.sequencer.recordMotion(index, value);
            }

            // Emit parameter change event for knob sync
            const paramNames = {
                10: 'filterlower',
                11: 'filterupper',
                12: 'filterspeed',
                18: 'vibratodelay',
                19: 'vibratodepth',
                20: 'vibratospeed'
            };
            const paramName = paramNames[index];
            if (paramName) {
                emitParameterChange(index, paramName, value, this);
            }
        }
    }

    async loadPListFile(file) {
        console.log(`[RGAHX UI] Loading PList file: ${file.name}`);

        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        if (this.synth && this.synth.workletNode) {
            this.synth.workletNode.port.postMessage({
                type: 'plist_import',
                data: { buffer: uint8Array }
            });
            console.log(`[RGAHX UI] Sent ${uint8Array.length} bytes to worklet`);
        } else {
            console.error('[RGAHX UI] Synth or worklet not available');
        }
    }

}

// Register custom element
customElements.define('rgahx-ui', RGAHXui);
