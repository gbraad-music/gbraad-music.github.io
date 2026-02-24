// Motion Sequencer Component
// 16-step sequencer with motion sequencing (parameter automation)
// Based on Korg Volca series sequencer design
// Can be used with any synthesizer

class MotionSequencer extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        // Sequencer state
        this.steps = 16;
        this.currentStep = -1;
        this.isPlaying = false;
        this.bpm = 120;
        this.intervalId = null;

        // Pattern data
        this.pattern = {
            steps: Array(16).fill(null).map(() => ({
                note: 60,        // MIDI note (C4)
                gate: true,      // Note on/off
                accent: false,   // Accent flag
                slide: false,    // Portamento/slide
                motion: {}       // Parameter automation { paramIndex: value }
            })),
            motionEnabled: false,
            recording: false,
            recordingMotion: false
        };

        // Synth callback
        this.synthCallback = null;
        this.parameterChangeCallback = null;

        // Available parameters for motion sequencing
        this.availableParams = [];
    }

    connectedCallback() {
        this.render();
        this.setupEventListeners();
    }

    disconnectedCallback() {
        this.stop();
    }

    // Set synth and parameter list
    setSynth(synthCallback, paramList = []) {
        this.synthCallback = synthCallback;
        this.availableParams = paramList;
        this.updateParameterSelect();
    }

    setParameterChangeCallback(callback) {
        this.parameterChangeCallback = callback;
    }

    render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: block;
                    background: #0f0f0f;
                    border: 1px solid #2a2a2a;
                    border-radius: 8px;
                    padding: 15px;
                    color: #fff;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                }

                .sequencer-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 15px;
                }

                .sequencer-title {
                    font-size: 12px;
                    color: #0066FF;
                    text-transform: uppercase;
                    letter-spacing: 1.5px;
                    font-weight: bold;
                }

                .transport-controls {
                    display: flex;
                    gap: 10px;
                }

                .transport-btn {
                    padding: 8px 16px;
                    background: #1a1a1a;
                    border: 1px solid #2a2a2a;
                    color: #aaa;
                    font-size: 11px;
                    cursor: pointer;
                    border-radius: 4px;
                    text-transform: uppercase;
                    font-weight: bold;
                    transition: all 0.2s;
                }

                .transport-btn:hover {
                    border-color: #0066FF;
                    color: #fff;
                }

                .transport-btn.active {
                    background: #0066FF;
                    border-color: #0088FF;
                    color: #fff;
                }

                .transport-btn.record {
                    border-color: #aa0000;
                }

                .transport-btn.record.active {
                    background: #cc0000;
                    border-color: #ff0000;
                    animation: pulse 1s infinite;
                }

                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.6; }
                }

                .settings-row {
                    display: flex;
                    gap: 15px;
                    margin-bottom: 15px;
                    align-items: center;
                }

                .setting {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .setting-label {
                    font-size: 10px;
                    color: #888;
                    text-transform: uppercase;
                }

                .setting input, .setting select {
                    padding: 4px 8px;
                    background: #0a0a0a;
                    border: 1px solid #2a2a2a;
                    color: #fff;
                    font-size: 11px;
                    border-radius: 3px;
                }

                .steps-grid {
                    display: grid;
                    grid-template-columns: repeat(16, 1fr);
                    gap: 4px;
                    margin-bottom: 15px;
                }

                .step {
                    aspect-ratio: 1;
                    background: #1a1a1a;
                    border: 2px solid #2a2a2a;
                    border-radius: 4px;
                    cursor: pointer;
                    position: relative;
                    transition: all 0.1s;
                }

                .step:hover {
                    border-color: #0066FF;
                }

                .step.active {
                    background: #0066FF;
                    border-color: #0088FF;
                }

                .step.current {
                    box-shadow: 0 0 10px #0066FF;
                    border-color: #0066FF;
                }

                .step.has-note {
                    background: #2a2a2a;
                }

                .step.has-note.active {
                    background: #0066FF;
                }

                .step.has-motion::after {
                    content: '';
                    position: absolute;
                    bottom: 2px;
                    right: 2px;
                    width: 4px;
                    height: 4px;
                    background: #ff6600;
                    border-radius: 50%;
                }

                .step-number {
                    position: absolute;
                    top: 2px;
                    left: 4px;
                    font-size: 8px;
                    color: #555;
                }

                .motion-controls {
                    background: #0a0a0a;
                    border: 1px solid #2a2a2a;
                    border-radius: 4px;
                    padding: 12px;
                    margin-top: 10px;
                }

                .motion-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 10px;
                }

                .motion-title {
                    font-size: 10px;
                    color: #888;
                    text-transform: uppercase;
                }

                .motion-list {
                    font-size: 10px;
                    color: #666;
                    max-height: 100px;
                    overflow-y: auto;
                }

                .motion-item {
                    padding: 4px;
                    background: #0f0f0f;
                    margin-bottom: 2px;
                    border-radius: 2px;
                    display: flex;
                    justify-content: space-between;
                }

                .clear-btn {
                    padding: 4px 8px;
                    background: #1a1a1a;
                    border: 1px solid #2a2a2a;
                    color: #aaa;
                    font-size: 9px;
                    cursor: pointer;
                    border-radius: 3px;
                }

                .clear-btn:hover {
                    border-color: #cc0000;
                    color: #ff6666;
                }

                .info {
                    font-size: 10px;
                    color: #666;
                    margin-top: 10px;
                    font-style: italic;
                }
            </style>

            <div class="sequencer-header">
                <div class="sequencer-title">🎛️ Motion Sequencer</div>
                <div class="transport-controls">
                    <button class="transport-btn" id="playBtn">▶ Play</button>
                    <button class="transport-btn" id="stopBtn">⏹ Stop</button>
                    <button class="transport-btn record" id="recordBtn">⏺ Rec</button>
                    <button class="transport-btn" id="clearBtn">Clear</button>
                </div>
            </div>

            <div class="settings-row">
                <div class="setting">
                    <span class="setting-label">BPM:</span>
                    <input type="number" id="bpmInput" value="120" min="40" max="300" step="1" style="width: 60px;">
                </div>
                <div class="setting">
                    <span class="setting-label">Motion:</span>
                    <select id="motionToggle">
                        <option value="false">Off</option>
                        <option value="true">On</option>
                    </select>
                </div>
                <div class="setting">
                    <span class="setting-label">Parameter:</span>
                    <select id="paramSelect" style="width: 120px;">
                        <option value="">Select...</option>
                    </select>
                </div>
            </div>

            <div class="steps-grid" id="stepsGrid"></div>

            <div class="motion-controls">
                <div class="motion-header">
                    <span class="motion-title">Motion Data (Parameter Automation)</span>
                    <button class="clear-btn" id="clearMotionBtn">Clear Motion</button>
                </div>
                <div class="motion-list" id="motionList">
                    <div style="color: #555;">No motion data recorded</div>
                </div>
            </div>

            <div class="info">
                💡 Click steps to toggle notes. Enable Motion and select a parameter, then adjust synth controls while playing to record automation.
            </div>
        `;

        this.renderSteps();
    }

    renderSteps() {
        const grid = this.shadowRoot.getElementById('stepsGrid');
        grid.innerHTML = '';

        for (let i = 0; i < this.steps; i++) {
            const step = document.createElement('div');
            step.className = 'step';
            step.dataset.step = i;

            if (this.pattern.steps[i].gate) {
                step.classList.add('has-note');
            }

            if (Object.keys(this.pattern.steps[i].motion).length > 0) {
                step.classList.add('has-motion');
            }

            const stepNum = document.createElement('div');
            stepNum.className = 'step-number';
            stepNum.textContent = i + 1;
            step.appendChild(stepNum);

            grid.appendChild(step);
        }
    }

    setupEventListeners() {
        const root = this.shadowRoot;

        // Transport controls
        root.getElementById('playBtn').addEventListener('click', () => this.play());
        root.getElementById('stopBtn').addEventListener('click', () => this.stop());
        root.getElementById('recordBtn').addEventListener('click', () => this.toggleRecord());
        root.getElementById('clearBtn').addEventListener('click', () => this.clearPattern());

        // Settings
        root.getElementById('bpmInput').addEventListener('change', (e) => {
            this.bpm = parseInt(e.target.value);
            if (this.isPlaying) {
                this.stop();
                this.play();
            }
        });

        root.getElementById('motionToggle').addEventListener('change', (e) => {
            this.pattern.motionEnabled = e.target.value === 'true';
        });

        // Step clicks
        root.getElementById('stepsGrid').addEventListener('click', (e) => {
            const stepEl = e.target.closest('.step');
            if (!stepEl) return;

            const stepIndex = parseInt(stepEl.dataset.step);
            this.toggleStep(stepIndex);
        });

        // Clear motion
        root.getElementById('clearMotionBtn').addEventListener('click', () => this.clearMotion());
    }

    updateParameterSelect() {
        const select = this.shadowRoot.getElementById('paramSelect');
        select.innerHTML = '<option value="">Select...</option>';

        this.availableParams.forEach((param, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = param.name || `Parameter ${index}`;
            select.appendChild(option);
        });
    }

    toggleStep(index) {
        this.pattern.steps[index].gate = !this.pattern.steps[index].gate;
        this.renderSteps();
    }

    play() {
        if (this.isPlaying) return;

        this.isPlaying = true;
        this.currentStep = -1;

        const playBtn = this.shadowRoot.getElementById('playBtn');
        playBtn.classList.add('active');

        const msPerStep = (60 / this.bpm) * 1000 / 4;  // 16th notes
        let nextStepTime = performance.now();

        const stepTick = () => {
            if (!this.isPlaying) return;

            this.advanceStep();

            // Schedule next step with drift compensation
            nextStepTime += msPerStep;
            const delay = Math.max(0, nextStepTime - performance.now());

            this.intervalId = setTimeout(stepTick, delay);
        };

        // Start immediately
        this.intervalId = setTimeout(stepTick, 0);
    }

    stop() {
        if (!this.isPlaying) return;

        this.isPlaying = false;

        if (this.intervalId) {
            clearTimeout(this.intervalId);
            this.intervalId = null;
        }

        this.currentStep = -1;

        const playBtn = this.shadowRoot.getElementById('playBtn');
        playBtn.classList.remove('active');

        // Clear current step highlight
        this.shadowRoot.querySelectorAll('.step').forEach(s => s.classList.remove('current'));
    }

    toggleRecord() {
        this.pattern.recordingMotion = !this.pattern.recordingMotion;

        const recordBtn = this.shadowRoot.getElementById('recordBtn');
        if (this.pattern.recordingMotion) {
            recordBtn.classList.add('active');
            console.log('[Sequencer] Motion recording enabled');
        } else {
            recordBtn.classList.remove('active');
            console.log('[Sequencer] Motion recording disabled');
        }
    }

    advanceStep() {
        // Clear previous step highlight
        this.shadowRoot.querySelectorAll('.step').forEach(s => s.classList.remove('current'));

        // Advance to next step
        this.currentStep = (this.currentStep + 1) % this.steps;

        // Highlight current step
        const stepEl = this.shadowRoot.querySelector(`.step[data-step="${this.currentStep}"]`);
        if (stepEl) {
            stepEl.classList.add('current');
        }

        const step = this.pattern.steps[this.currentStep];

        // Play note if gate is on
        if (step.gate && this.synthCallback) {
            this.synthCallback.noteOn(step.note, 100);

            // Note off after a short duration
            setTimeout(() => {
                this.synthCallback.noteOff(step.note);
            }, 50);
        }

        // Apply motion (parameter automation)
        if (this.pattern.motionEnabled && step.motion) {
            Object.entries(step.motion).forEach(([paramIndex, value]) => {
                if (this.parameterChangeCallback) {
                    this.parameterChangeCallback(parseInt(paramIndex), value);
                }
            });
        }
    }

    // Record motion data for current step
    recordMotion(paramIndex, value) {
        if (!this.pattern.recordingMotion || this.currentStep === -1) return;

        this.pattern.steps[this.currentStep].motion[paramIndex] = value;
        this.renderSteps();
        this.updateMotionList();
    }

    updateMotionList() {
        const list = this.shadowRoot.getElementById('motionList');
        const motionData = [];

        this.pattern.steps.forEach((step, index) => {
            if (Object.keys(step.motion).length > 0) {
                Object.entries(step.motion).forEach(([paramIndex, value]) => {
                    const paramName = this.availableParams[paramIndex]?.name || `Param ${paramIndex}`;
                    motionData.push(`Step ${index + 1}: ${paramName} = ${(value * 100).toFixed(0)}%`);
                });
            }
        });

        if (motionData.length === 0) {
            list.innerHTML = '<div style="color: #555;">No motion data recorded</div>';
        } else {
            list.innerHTML = motionData.map(item =>
                `<div class="motion-item"><span>${item}</span></div>`
            ).join('');
        }
    }

    clearPattern() {
        this.pattern.steps = Array(16).fill(null).map(() => ({
            note: 60,
            gate: false,
            accent: false,
            slide: false,
            motion: {}
        }));
        this.renderSteps();
        this.updateMotionList();
        console.log('[Sequencer] Pattern cleared');
    }

    clearMotion() {
        this.pattern.steps.forEach(step => {
            step.motion = {};
        });
        this.renderSteps();
        this.updateMotionList();
        console.log('[Sequencer] Motion data cleared');
    }

    // Export/import pattern data
    exportPattern() {
        return JSON.stringify(this.pattern);
    }

    importPattern(jsonData) {
        try {
            this.pattern = JSON.parse(jsonData);
            this.renderSteps();
            this.updateMotionList();
            console.log('[Sequencer] Pattern imported');
        } catch (e) {
            console.error('[Sequencer] Failed to import pattern:', e);
        }
    }
}

// Register custom element
customElements.define('motion-sequencer', MotionSequencer);
