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
        this.editingStep = null;  // Which step is being edited

        // Pattern data
        this.pattern = {
            steps: Array(16).fill(null).map((_, i) => ({
                note: 60,        // MIDI note (C4)
                gate: (i === 0 || i === 4 || i === 8 || i === 12),  // Four-on-the-floor pattern
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
        this.noteRecordingCallback = null;  // For live note recording

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
    }

    setParameterChangeCallback(callback) {
        this.parameterChangeCallback = callback;
    }

    // Auto-discover and connect to a synth instance
    connectToSynth(synth, synthUI = null) {
        if (!synth) {
            this.style.display = 'none';
            return;
        }

        // Check if synth has required methods (accept both noteOn/noteOff and handleNoteOn/handleNoteOff)
        const hasNoteOn = synth.noteOn || synth.handleNoteOn;
        const hasNoteOff = synth.noteOff || synth.handleNoteOff;

        if (!hasNoteOn || !hasNoteOff) {
            this.style.display = 'none';
            return;
        }

        this.style.display = 'block';  // Show the sequencer

        // Get parameter info if available, otherwise use empty array
        const paramInfo = synth.getParameterInfo ? synth.getParameterInfo().map(p => ({name: p.name})) : [];

        // Connect sequencer to synth (use noteOn/noteOff if available, fallback to handleNoteOn/handleNoteOff)
        const noteOnMethod = synth.noteOn || synth.handleNoteOn;
        const noteOffMethod = synth.noteOff || synth.handleNoteOff;

        this.setSynth({
            noteOn: (note, velocity) => noteOnMethod.call(synth, note, velocity),
            noteOff: (note) => noteOffMethod.call(synth, note)
        }, paramInfo);

        // Set parameter callback if synth supports parameters
        if (synth.setParameter) {
            this.setParameterChangeCallback((index, value) => {
                synth.setParameter(index, value);
            });
        }

        // Connect UI to sequencer if provided (for motion recording)
        if (synthUI && synthUI.setSequencer) {
            synthUI.setSequencer(this);
        }
    }

    render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: block;
                    color: #fff;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                }

                .controls-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
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
                    margin-bottom: 20px;
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
                    gap: 5px;
                    margin-bottom: 20px;
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
                    padding: 15px;
                    margin-top: 15px;
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
                    margin-top: 15px;
                    padding-top: 15px;
                    border-top: 1px solid #2a2a2a;
                    font-style: italic;
                }
            </style>

            <div class="controls-header">
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
                💡 Click steps to toggle. Press REC + PLAY, then play notes - they'll be recorded per step. Adjust synth controls while recording for parameter automation.
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

        // Step clicks - left click toggles gate
        root.getElementById('stepsGrid').addEventListener('click', (e) => {
            const stepEl = e.target.closest('.step');
            if (!stepEl) return;

            const stepIndex = parseInt(stepEl.dataset.step);
            this.toggleStep(stepIndex);
        });

        // Clear motion
        root.getElementById('clearMotionBtn').addEventListener('click', () => this.clearMotion());
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

            // STEP RECORDING MODE: If not playing, highlight step 0 for input
            if (!this.isPlaying && this.currentStep === -1) {
                this.currentStep = 0;
                this.shadowRoot.querySelectorAll('.step').forEach(s => s.classList.remove('current'));
                const stepEl = this.shadowRoot.querySelector(`.step[data-step="0"]`);
                if (stepEl) {
                    stepEl.classList.add('current');
                }
            }
        } else {
            recordBtn.classList.remove('active');

            // Clear step highlight if not playing
            if (!this.isPlaying) {
                this.currentStep = -1;
                this.shadowRoot.querySelectorAll('.step').forEach(s => s.classList.remove('current'));
            }
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
        if (step.motion) {
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

    // Record note played during live recording
    recordNote(note) {
        if (!this.pattern.recordingMotion) {
            return;
        }

        // STEP RECORDING MODE: REC on, PLAY off (like Volca step input)
        // Record note and advance to next step
        if (!this.isPlaying) {
            // If currentStep is -1 (stopped), start at step 0
            if (this.currentStep === -1) {
                this.currentStep = 0;
            }

            // Record note into current step
            this.pattern.steps[this.currentStep].note = note;
            this.pattern.steps[this.currentStep].gate = true;
            this.renderSteps();

            // Advance to next step
            this.currentStep = (this.currentStep + 1) % this.pattern.steps.length;

            // Highlight the new current step
            this.shadowRoot.querySelectorAll('.step').forEach(s => s.classList.remove('current'));
            const stepEl = this.shadowRoot.querySelector(`.step[data-step="${this.currentStep}"]`);
            if (stepEl) {
                stepEl.classList.add('current');
            }
            return;
        }

        // LIVE RECORDING MODE: REC on, PLAY on
        // Record note into current playing step
        if (this.currentStep === -1) return;

        this.pattern.steps[this.currentStep].note = note;
        this.pattern.steps[this.currentStep].gate = true;
        this.renderSteps();
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

        // Restore step highlight if recording
        if (this.pattern.recordingMotion && !this.isPlaying && this.currentStep !== -1) {
            const stepEl = this.shadowRoot.querySelector(`.step[data-step="${this.currentStep}"]`);
            if (stepEl) {
                stepEl.classList.add('current');
            }
        }
    }

    clearMotion() {
        this.pattern.steps.forEach(step => {
            step.motion = {};
        });
        this.renderSteps();
        this.updateMotionList();
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
        } catch (e) {
            console.error('[Sequencer] Failed to import pattern:', e);
        }
    }
}

// Register custom element
customElements.define('motion-sequencer', MotionSequencer);
