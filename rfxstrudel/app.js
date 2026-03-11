// RFXStrudel - Live Coding with Effects & MIDI

import { initStrudel } from './strudel-bundle.js';
import { rfx } from './rfx-integration.js';

class RFXStrudel {
    constructor() {
        this.editor = null;
        this.strudel = null;
        this.isPlaying = false;
        this.audioContext = null;
        this.midiAccess = null;
        this.midiLearnMode = false;
        this.midiMappings = {}; // { cc: knobId }
        this.knobs = {};
        this.dynamicKnobs = new Map(); // Track dynamically created knobs
    }

    async init() {
        console.log('Initializing RFXStrudel...');

        // Setup UI
        this.setupUI();

        // Initialize CodeMirror
        this.initializeEditor();

        // Initialize Strudel
        await this.initializeStrudel();

        // Initialize MIDI
        await this.initializeMIDI();

        // Load saved MIDI mappings
        this.loadMIDIMappings();

        console.log('RFXStrudel initialized!');
    }

    setupUI() {
        // Menu controls
        document.getElementById('hamburgerBtn')?.addEventListener('click', () => this.openMenu());
        document.getElementById('menuClose')?.addEventListener('click', () => this.closeMenu());
        document.getElementById('menuOverlay')?.addEventListener('click', () => this.closeMenu());

        document.getElementById('btnAudioOutput')?.addEventListener('click', () => this.openAudioOutput());
        document.getElementById('btnMIDISetup')?.addEventListener('click', () => this.openMIDISetup());
        document.getElementById('btnAbout')?.addEventListener('click', () => this.openAbout());

        // Modal close buttons
        document.getElementById('audioOutputClose')?.addEventListener('click', () => this.closeAudioOutput());
        document.getElementById('audioOutputOverlay')?.addEventListener('click', () => this.closeAudioOutput());

        document.getElementById('midiSetupClose')?.addEventListener('click', () => this.closeMIDISetup());
        document.getElementById('midiSetupOverlay')?.addEventListener('click', () => this.closeMIDISetup());

        document.getElementById('aboutClose')?.addEventListener('click', () => this.closeAbout());
        document.getElementById('aboutOverlay')?.addEventListener('click', () => this.closeAbout());

        // Control buttons
        document.getElementById('btnPlay')?.addEventListener('click', () => this.play());
        document.getElementById('btnStop')?.addEventListener('click', () => this.stop());
        document.getElementById('btnEvaluate')?.addEventListener('click', () => this.evaluate());
        document.getElementById('btnClear')?.addEventListener('click', () => this.clear());

        // MIDI Learn button
        document.getElementById('btnMIDILearn')?.addEventListener('click', () => this.toggleMIDILearn());

        // Debug logging
        const debugLog = document.getElementById('debugLog');
        const enableLogging = document.getElementById('enableLogging');
        const clearLogBtn = document.getElementById('clearLog');

        if (enableLogging && debugLog && clearLogBtn) {
            const originalLog = console.log;
            const originalWarn = console.warn;
            const originalError = console.error;

            const addLogEntry = (message, type = 'log') => {
                if (!enableLogging.checked) return;

                const entry = document.createElement('div');
                const timestamp = new Date().toLocaleTimeString();

                if (type === 'error') {
                    entry.style.color = '#ff4444';
                } else if (type === 'warn') {
                    entry.style.color = '#ffaa00';
                } else {
                    entry.style.color = '#aaa';
                }

                entry.textContent = `[${timestamp}] ${message}`;
                debugLog.appendChild(entry);
                debugLog.scrollTop = debugLog.scrollHeight;
            };

            console.log = function(...args) {
                originalLog.apply(console, args);
                addLogEntry(args.join(' '), 'log');
            };

            console.warn = function(...args) {
                originalWarn.apply(console, args);
                addLogEntry(args.join(' '), 'warn');
            };

            console.error = function(...args) {
                originalError.apply(console, args);
                addLogEntry(args.join(' '), 'error');
            };

            enableLogging.addEventListener('change', () => {
                if (enableLogging.checked) {
                    debugLog.style.display = 'block';
                } else {
                    debugLog.style.display = 'none';
                }
            });

            clearLogBtn.addEventListener('click', () => {
                debugLog.innerHTML = '<div style="color: #555;">Debug log</div>';
            });
        }

        // Listen for dynamic parameter creation
        window.addEventListener('rfx:newparam', (e) => {
            this.createDynamicKnob(e.detail.name, e.detail.value);
        });

        // Preset selection
        document.getElementById('presetSelect')?.addEventListener('change', (e) => {
            this.loadPreset(e.target.value);
        });

        document.getElementById('btnSavePreset')?.addEventListener('click', () => {
            this.savePreset();
        });
    }

    createDynamicKnob(paramName, defaultValue) {
        // Don't create duplicate knobs
        if (this.dynamicKnobs.has(paramName)) return;

        console.log(`🎛️ Creating knob for: ${paramName}`);

        const container = document.getElementById('dynamicKnobs');
        if (!container) return;

        // Remove placeholder message if it exists
        if (container.children.length === 1 && container.children[0].textContent.includes('Parameters will appear')) {
            container.innerHTML = '';
        }

        // Create knob module
        const module = document.createElement('div');
        module.className = 'effect-module';
        module.innerHTML = `
            <div class="effect-title">${paramName}</div>
            <div class="knob-container">
                <pad-knob id="param_${paramName}" label="${paramName.substring(0, 4).toUpperCase()}"
                          value="${Math.round(defaultValue * 127)}" min="0" max="127" size="50"></pad-knob>
                <span class="knob-label">0.0 - 1.0</span>
            </div>
        `;

        container.appendChild(module);

        // Register for MIDI learn
        const knobId = `param_${paramName}`;
        setTimeout(() => {
            this.registerKnob(knobId, paramName);
        }, 100);

        this.dynamicKnobs.set(paramName, module);
    }

    registerKnob(knobId, paramName = null) {
        const knob = document.getElementById(knobId);
        if (!knob) {
            console.warn(`⚠️ Knob ${knobId} not found`);
            return;
        }

        this.knobs[knobId] = knob;

        // Listen to knob changes
        knob.addEventListener('change', (e) => {
            const value = parseInt(e.target.value);
            this.handleKnobChange(knobId, paramName, value);
        });

        // Click to learn
        knob.addEventListener('click', () => {
            if (this.midiLearnMode) {
                this.learnKnob(knobId);
            }
        });

        console.log(`✅ Registered knob: ${knobId}`);
    }

    handleKnobChange(knobId, paramName, value) {
        // Normalize to 0-1
        const normalized = value / 127;

        // Update RFX params
        if (paramName && window.rfxParams) {
            window.rfxParams[paramName] = normalized;
            console.log(`📊 ${paramName} = ${normalized.toFixed(2)}`);
        }
    }

    loadPreset(presetName) {
        if (!presetName) return;

        console.log(`🎨 Loading preset: ${presetName}`);

        // Example presets (GM drum mapping for drums)
        const presets = {
            preset1: {
                code: `// 909 Techno\n// GM: 36=Kick, 38=Snare, 42=ClosedHH, 46=OpenHH\nstack(\n  note("36 ~ ~ ~").s("rg909"),        // Kick\n  note("~ 38 ~ 38").s("rg909"),       // Snare\n  note("42*8").s("rg909")             // Hi-hat\n).cpm(128)`
            },
            preset2: {
                code: `// AHX Drums\n// GM drum mapping\nstack(\n  note("36 ~ ~ ~").s("rgahxdrum"),    // Kick\n  note("~ 38 ~ 38").s("rgahxdrum"),   // Snare\n  note("42*8").s("rgahxdrum")         // Hi-hat\n).cpm(140)`
            },
            preset3: {
                code: `// AHX Chip Melody\nnote("c4 e4 g4 a4").s("rgahxsynth").cpm(140)`
            },
            preset4: {
                code: `// SID Bass Line\nnote("c2 ~ c2 ~@2").s("rgsidsynth").lpf(800).cpm(128)`
            },
            preset5: {
                code: `// Piano Lead\nnote("c4 e4 g4 b4 c5").s("rg1piano").room(0.5).cpm(90)`
            }
        };

        if (presets[presetName]) {
            this.editor.setValue(presets[presetName].code);
        }
    }

    savePreset() {
        const code = this.editor.getValue();
        const name = prompt('Preset name:');
        if (!name) return;

        try {
            const saved = JSON.parse(localStorage.getItem('rfxstrudel_presets') || '{}');
            saved[name] = { code };
            localStorage.setItem('rfxstrudel_presets', JSON.stringify(saved));

            // Add to select
            const select = document.getElementById('presetSelect');
            if (select) {
                const option = document.createElement('option');
                option.value = name;
                option.textContent = name;
                select.appendChild(option);
            }

            console.log(`💾 Saved preset: ${name}`);
        } catch (error) {
            console.error('Failed to save preset:', error);
        }
    }


    initializeEditor() {
        const textarea = document.getElementById('codeEditor');

        this.editor = CodeMirror.fromTextArea(textarea, {
            mode: 'javascript',
            theme: 'tomorrow-night-bright',
            lineNumbers: true,
            lineWrapping: true,
            autoCloseBrackets: true,
            matchBrackets: true,
            tabSize: 2
        });

        // Ctrl+Enter to evaluate
        this.editor.setOption('extraKeys', {
            'Ctrl-Enter': () => this.evaluate(),
            'Cmd-Enter': () => this.evaluate()
        });

        console.log('Code editor initialized');
    }

    async initializeStrudel() {
        try {
            console.log('Initializing Strudel...');

            // Initialize Strudel from local bundle
            this.strudel = await initStrudel();
            this.audioContext = this.strudel.audioContext;

            console.log('✅ Strudel ready!');

            // Initialize RFX integration
            await rfx.init(this.audioContext);

            // Register RFX methods to Strudel
            rfx.registerStrudelMethods();

            console.log('✅ RFX integration complete!');
            console.log('📦 Available synths:', rfx.getSynthList().join(', '));

        } catch (error) {
            console.error('❌ Failed to initialize Strudel:', error);
            console.error(error.stack);
        }
    }

    async initializeMIDI() {
        try {
            if (navigator.requestMIDIAccess) {
                this.midiAccess = await navigator.requestMIDIAccess();
                console.log('MIDI access granted');

                // Populate MIDI input dropdown
                this.updateMIDIDeviceList();

                // Listen for MIDI state changes
                this.midiAccess.onstatechange = () => this.updateMIDIDeviceList();
            } else {
                console.warn('Web MIDI API not supported');
            }
        } catch (error) {
            console.error('Failed to initialize MIDI:', error);
        }
    }

    updateMIDIDeviceList() {
        const midiInputSelect = document.getElementById('midiInput');
        if (!midiInputSelect || !this.midiAccess) return;

        midiInputSelect.innerHTML = '<option value="">None</option>';

        for (const input of this.midiAccess.inputs.values()) {
            const option = document.createElement('option');
            option.value = input.id;
            option.textContent = input.name;
            midiInputSelect.appendChild(option);
        }

        // Set up listener
        midiInputSelect.addEventListener('change', (e) => {
            this.connectMIDIInput(e.target.value);
        });
    }

    connectMIDIInput(deviceId) {
        if (!this.midiAccess) return;

        // Disconnect all inputs first
        for (const input of this.midiAccess.inputs.values()) {
            input.onmidimessage = null;
        }

        if (!deviceId) {
            console.log('MIDI input disconnected');
            return;
        }

        const input = this.midiAccess.inputs.get(deviceId);
        if (input) {
            input.onmidimessage = (e) => this.handleMIDIMessage(e);
            console.log(`Connected to MIDI input: ${input.name}`);
        }
    }

    handleMIDIMessage(event) {
        const [status, data1, data2] = event.data;
        const messageType = status & 0xf0;

        // Control Change (CC)
        if (messageType === 0xb0) {
            const cc = data1;
            const value = data2;

            console.log(`MIDI CC ${cc}: ${value}`);

            // If in learn mode, map this CC to the selected knob
            if (this.midiLearnMode && this.learnTarget) {
                this.mapMIDIToKnob(cc, this.learnTarget);
                this.learnTarget = null;
                this.setMIDILearnMode(false);
            }

            // Apply mapped CC to knob
            if (this.midiMappings[cc]) {
                const knobId = this.midiMappings[cc];
                const knob = this.knobs[knobId];
                if (knob) {
                    knob.value = value;
                    knob.dispatchEvent(new Event('change'));
                }
            }
        }
    }

    toggleMIDILearn() {
        this.setMIDILearnMode(!this.midiLearnMode);
    }

    setMIDILearnMode(enabled) {
        this.midiLearnMode = enabled;

        const btn = document.getElementById('btnMIDILearn');
        const status = document.getElementById('midiLearnStatus');

        if (enabled) {
            btn.classList.add('active');
            btn.textContent = 'Stop MIDI Learn';
            status.style.display = 'block';
            console.log('MIDI Learn mode enabled - click a knob, then move a MIDI controller');
        } else {
            btn.classList.remove('active');
            btn.textContent = 'Start MIDI Learn';
            status.style.display = 'none';
            console.log('MIDI Learn mode disabled');
        }
    }

    learnKnob(knobId) {
        this.learnTarget = knobId;
        const status = document.getElementById('midiLearnStatus');
        if (status) {
            status.querySelector('p').textContent = `Learning ${knobId}... Move a MIDI controller.`;
        }
        console.log(`Learning knob: ${knobId}`);
    }

    mapMIDIToKnob(cc, knobId) {
        this.midiMappings[cc] = knobId;
        this.saveMIDIMappings();
        console.log(`Mapped CC ${cc} to ${knobId}`);

        const status = document.getElementById('midiLearnStatus');
        if (status) {
            status.querySelector('p').textContent = `Mapped CC ${cc} to ${knobId}!`;
        }
    }

    saveMIDIMappings() {
        try {
            localStorage.setItem('rfxstrudel_midi_mappings', JSON.stringify(this.midiMappings));
        } catch (error) {
            console.error('Failed to save MIDI mappings:', error);
        }
    }

    loadMIDIMappings() {
        try {
            const saved = localStorage.getItem('rfxstrudel_midi_mappings');
            if (saved) {
                this.midiMappings = JSON.parse(saved);
                console.log('Loaded MIDI mappings:', this.midiMappings);
            }
        } catch (error) {
            console.error('Failed to load MIDI mappings:', error);
        }
    }

    async evaluate() {
        if (!this.strudel) {
            console.warn('⚠️ Strudel not ready yet');
            return;
        }

        const code = this.editor.getValue();
        console.log('📝 Evaluating code:', code);

        try {
            // Evaluate the code with Strudel
            await this.strudel.evaluate(code);
            console.log('✅ Code evaluated successfully');
        } catch (error) {
            console.error('❌ Error evaluating code:', error);
            console.error(error.stack);
        }
    }

    async play() {
        if (!this.strudel) {
            console.warn('⚠️ Strudel not ready yet');
            return;
        }

        if (this.isPlaying) {
            console.log('Already playing');
            return;
        }

        console.log('▶ Starting playback');
        this.isPlaying = true;

        const btn = document.getElementById('btnPlay');
        if (btn) {
            btn.classList.add('active');
        }

        try {
            // Evaluate code first
            await this.evaluate();

            // Start Strudel scheduler
            await this.strudel.start();
        } catch (error) {
            console.error('❌ Failed to start playback:', error);
            console.error(error.stack);
            this.isPlaying = false;
            if (btn) {
                btn.classList.remove('active');
            }
        }
    }

    async stop() {
        if (!this.strudel) {
            console.warn('⚠️ Strudel not ready yet');
            return;
        }

        if (!this.isPlaying) return;

        console.log('◼ Stopping playback');
        this.isPlaying = false;

        const btn = document.getElementById('btnPlay');
        if (btn) {
            btn.classList.remove('active');
        }

        try {
            // Stop Strudel scheduler
            await this.strudel.stop();
        } catch (error) {
            console.error('❌ Failed to stop playback:', error);
            console.error(error.stack);
        }
    }

    clear() {
        this.editor.setValue('');
        console.log('Code cleared');
    }

    // Menu functions
    openMenu() {
        document.getElementById('menuOverlay')?.classList.add('active');
        document.getElementById('menuPanel')?.classList.add('active');
    }

    closeMenu() {
        document.getElementById('menuOverlay')?.classList.remove('active');
        document.getElementById('menuPanel')?.classList.remove('active');
    }

    openAudioOutput() {
        this.closeMenu();
        document.getElementById('audioOutputOverlay')?.classList.add('active');
        document.getElementById('audioOutputModal')?.classList.add('active');
    }

    closeAudioOutput() {
        document.getElementById('audioOutputOverlay')?.classList.remove('active');
        document.getElementById('audioOutputModal')?.classList.remove('active');
    }

    openMIDISetup() {
        this.closeMenu();
        document.getElementById('midiSetupOverlay')?.classList.add('active');
        document.getElementById('midiSetupModal')?.classList.add('active');
    }

    closeMIDISetup() {
        document.getElementById('midiSetupOverlay')?.classList.remove('active');
        document.getElementById('midiSetupModal')?.classList.remove('active');
    }

    openAbout() {
        this.closeMenu();
        document.getElementById('aboutOverlay')?.classList.add('active');
        document.getElementById('aboutModal')?.classList.add('active');
    }

    closeAbout() {
        document.getElementById('aboutOverlay')?.classList.remove('active');
        document.getElementById('aboutModal')?.classList.remove('active');
    }
}

// Initialize app when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
    window.app = new RFXStrudel();
    window.app.init();
});
