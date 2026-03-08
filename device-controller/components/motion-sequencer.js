// Motion Sequencer Component for MIDI Devices
// 16-step sequencer with parameter automation via MIDI CC
// Adapted for use with generic MIDI device controller

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

        // Pattern data - stores CC automation per step
        this.pattern = {
            steps: Array(16).fill(null).map(() => ({
                active: false,   // Step enabled
                motion: {}       // CC automation { cc: value }
            })),
            recordingMotion: false
        };

        // Available CC parameters from device
        this.availableParams = [];

        // MIDI output callback
        this.midiCallback = null;
    }

    connectedCallback() {
        this.render();
        this.setupEventListeners();
    }

    disconnectedCallback() {
        this.stop();
    }

    // Set MIDI send callback and available parameters
    setMIDICallback(callback) {
        this.midiCallback = callback;
    }

    setAvailableParameters(params) {
        // params = [{ cc: 7, label: 'Volume' }, { cc: 10, label: 'Pan' }, ...]
        this.availableParams = params;
    }

    render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: block;
                    color: #fff;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                }

                .sequencer-container {
                    background: #0f0f0f;
                    border: 1px solid #2a2a2a;
                    border-radius: 8px;
                    padding: 20px;
                }

                .sequencer-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                    padding-bottom: 15px;
                    border-bottom: 1px solid #2a2a2a;
                }

                .sequencer-title {
                    font-size: 14px;
                    font-weight: bold;
                    color: #fff;
                    text-transform: uppercase;
                    letter-spacing: 1px;
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

                .file-controls {
                    display: flex;
                    gap: 8px;
                }

                .file-btn {
                    padding: 6px 12px;
                    background: #1a1a1a;
                    border: 1px solid #2a2a2a;
                    color: #888;
                    font-size: 10px;
                    cursor: pointer;
                    border-radius: 4px;
                    text-transform: uppercase;
                    font-weight: bold;
                    transition: all 0.2s;
                }

                .file-btn:hover {
                    border-color: #0066FF;
                    color: #fff;
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

                .setting input {
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
                    background: #2a2a2a;
                    border-color: #4a4a4a;
                }

                .step.current {
                    box-shadow: 0 0 10px #0066FF;
                    border-color: #0066FF;
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
                    cursor: pointer;
                }

                .motion-header:hover .motion-title {
                    color: #aaa;
                }

                .motion-title {
                    font-size: 10px;
                    color: #888;
                    text-transform: uppercase;
                }

                .motion-toggle {
                    font-size: 12px;
                    color: #888;
                    margin-right: 10px;
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

            <div class="sequencer-container">
                <div class="sequencer-header">
                    <div class="sequencer-title">Motion Sequencer</div>
                    <div class="transport-controls">
                        <button class="transport-btn" id="playBtn">▶ Play</button>
                        <button class="transport-btn" id="stopBtn">⏹ Stop</button>
                        <button class="transport-btn record" id="recordBtn">⏺ Rec</button>
                        <button class="transport-btn" id="clearBtn">Clear</button>
                        <button class="transport-btn" id="exportBtn">Export</button>
                        <button class="transport-btn" id="importBtn">Import</button>
                        <input type="file" id="importFile" accept=".json" style="display: none;">
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
                    <div class="motion-header" id="motionHeader">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span class="motion-toggle" id="motionToggle">▶</span>
                            <span class="motion-title">Motion Data (CC Automation)</span>
                        </div>
                        <button class="clear-btn" id="clearMotionBtn">Clear Motion</button>
                    </div>
                    <div class="motion-list" id="motionList" style="display: none;">
                        <div style="color: #555;">No motion data recorded</div>
                    </div>
                </div>

                <div class="info">
                    Click steps to toggle. Press REC and adjust device controls - CC changes will be recorded per step. Press PLAY to automate parameters.
                </div>
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

            if (this.pattern.steps[i].active) {
                step.classList.add('active');
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
            // BPM change applies immediately without restarting playback
        });

        // Step clicks
        root.getElementById('stepsGrid').addEventListener('click', (e) => {
            const stepEl = e.target.closest('.step');
            if (!stepEl) return;

            const stepIndex = parseInt(stepEl.dataset.step);
            this.toggleStep(stepIndex);
        });

        // Clear motion
        root.getElementById('clearMotionBtn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.clearMotion();
        });

        // Toggle motion list visibility
        root.getElementById('motionHeader').addEventListener('click', () => this.toggleMotionList());

        // Export/Import
        root.getElementById('exportBtn').addEventListener('click', () => this.handleExport());
        root.getElementById('importBtn').addEventListener('click', () => {
            root.getElementById('importFile').click();
        });
        root.getElementById('importFile').addEventListener('change', (e) => this.handleImport(e));
    }

    toggleStep(index) {
        this.pattern.steps[index].active = !this.pattern.steps[index].active;
        this.renderSteps();
    }

    play() {
        if (this.isPlaying) return;

        this.isPlaying = true;
        this.currentStep = -1;

        const playBtn = this.shadowRoot.getElementById('playBtn');
        playBtn.classList.add('active');

        let nextStepTime = performance.now();

        const stepTick = () => {
            if (!this.isPlaying) return;

            this.advanceStep();

            // Recalculate timing based on current BPM (allows live tempo changes)
            const msPerStep = (60 / this.bpm) * 1000 / 4;  // 16th notes
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

            // If not playing, highlight step 0 for motion recording
            if (!this.isPlaying) {
                this.currentStep = 0;
                this.pattern.steps[0].active = true;
                this.shadowRoot.querySelectorAll('.step').forEach(s => s.classList.remove('current'));
                const stepEl = this.shadowRoot.querySelector(`.step[data-step="0"]`);
                if (stepEl) {
                    stepEl.classList.add('current');
                }
                this.renderSteps();
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

        // Apply motion (CC automation) if step is active
        if (step.active && step.motion && this.midiCallback) {
            Object.entries(step.motion).forEach(([cc, value]) => {
                const ccValue = cc.toString().startsWith('nrpn:') ? cc : parseInt(cc);
                this.midiCallback(ccValue, value);
            });
        }
    }

    // Record CC motion data for current step
    recordMotion(cc, value) {
        if (!this.pattern.recordingMotion) return;

        // Recording but not playing - record to step 0 (or manually selected step)
        const targetStep = this.currentStep === -1 ? 0 : this.currentStep;

        // Enable the step automatically when recording motion to it
        this.pattern.steps[targetStep].active = true;
        this.pattern.steps[targetStep].motion[cc] = value;

        this.renderSteps();
        this.updateMotionList();
    }

    // Manually advance to next step (for step recording without playback)
    advanceRecordingStep() {
        if (!this.pattern.recordingMotion || this.isPlaying) return;

        this.currentStep = (this.currentStep + 1) % this.steps;

        // Highlight the new step
        this.shadowRoot.querySelectorAll('.step').forEach(s => s.classList.remove('current'));
        const stepEl = this.shadowRoot.querySelector(`.step[data-step="${this.currentStep}"]`);
        if (stepEl) {
            stepEl.classList.add('current');
        }
    }

    updateMotionList() {
        const list = this.shadowRoot.getElementById('motionList');
        const motionData = [];

        this.pattern.steps.forEach((step, index) => {
            if (Object.keys(step.motion).length > 0) {
                Object.entries(step.motion).forEach(([cc, value]) => {
                    const param = this.availableParams.find(p => p.cc === parseInt(cc));
                    const ccLabel = param ? param.label : `CC${cc}`;
                    motionData.push(`Step ${index + 1}: ${ccLabel} = ${value}`);
                });
            }
        });

        if (motionData.length === 0) {
            list.innerHTML = '<div style="color: #555;">No motion data recorded</div>';
        } else {
            list.innerHTML = motionData.map(item =>
                `<div class="motion-item">${item}</div>`
            ).join('');
        }
    }

    clearPattern() {
        this.pattern.steps = Array(16).fill(null).map(() => ({
            active: false,
            motion: {}
        }));
        this.renderSteps();
        this.updateMotionList();
    }

    clearMotion() {
        this.pattern.steps.forEach(step => {
            step.motion = {};
        });
        this.renderSteps();
        this.updateMotionList();
    }

    toggleMotionList() {
        const list = this.shadowRoot.getElementById('motionList');
        const toggle = this.shadowRoot.getElementById('motionToggle');

        if (list.style.display === 'none') {
            list.style.display = 'block';
            toggle.textContent = '▼';
        } else {
            list.style.display = 'none';
            toggle.textContent = '▶';
        }
    }

    // Export pattern with metadata
    exportPattern(metadata = {}) {
        const exportData = {
            version: 1,
            deviceId: metadata.deviceId || null,
            deviceName: metadata.deviceName || null,
            name: metadata.name || 'Untitled Pattern',
            description: metadata.description || '',
            bpm: this.bpm,
            timestamp: new Date().toISOString(),
            pattern: this.pattern,
            availableParams: this.availableParams
        };
        return JSON.stringify(exportData, null, 2);
    }

    importPattern(jsonData) {
        try {
            const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;

            // Handle new format (with metadata) or old format (just pattern)
            if (data.version === 1) {
                this.pattern = data.pattern;
                this.bpm = data.bpm || 120;

                // Update BPM input
                const bpmInput = this.shadowRoot.getElementById('bpmInput');
                if (bpmInput) {
                    bpmInput.value = this.bpm;
                }
            } else {
                // Old format - just pattern data
                this.pattern = data;
            }

            this.renderSteps();
            this.updateMotionList();
            return true;
        } catch (e) {
            return false;
        }
    }

    // Export to file
    exportToFile(deviceId, deviceName) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const name = `Pattern_${timestamp}`;

        const jsonData = this.exportPattern({
            deviceId,
            deviceName,
            name,
            description: ''
        });

        const filename = `${deviceId}_${timestamp}.json`;
        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    // Import from file
    async importFromFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    const success = this.importPattern(e.target.result);
                    if (success) {
                        resolve(true);
                    } else {
                        reject(new Error('Failed to parse pattern'));
                    }
                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    handleExport() {
        // Get device info from global scope if available
        const deviceId = window.currentDeviceId || 'unknown';
        const deviceName = window.currentDeviceName || 'Unknown Device';
        this.exportToFile(deviceId, deviceName);
    }

    async handleImport(e) {
        const file = e.target.files[0];
        if (!file) return;

        try {
            await this.importFromFile(file);
        } catch (error) {
            alert('Failed to import pattern: ' + error.message);
        }

        e.target.value = '';
    }
}

// Register custom element
customElements.define('motion-sequencer', MotionSequencer);
