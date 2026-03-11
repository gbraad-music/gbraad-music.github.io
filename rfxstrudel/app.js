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
        this.lastEvaluatedCode = null; // Track last evaluated code to detect changes
        this.midiInputListenerAttached = false; // Prevent duplicate event listeners
        this.midiInputConnected = false; // Track if MIDI input is connected
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
        // Global keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Escape key to cancel MIDI Learn
            if (e.key === 'Escape' && this.midiLearnMode) {
                this.setMIDILearnMode(false);
                e.preventDefault();
            }
        });

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

        document.getElementById('savePresetClose')?.addEventListener('click', () => this.closeSavePreset());
        document.getElementById('savePresetOverlay')?.addEventListener('click', () => this.closeSavePreset());
        document.getElementById('btnConfirmSavePreset')?.addEventListener('click', () => this.confirmSavePreset());

        // Enter key to save preset
        document.getElementById('presetNameInput')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.confirmSavePreset();
            }
        });

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

        // Listen for knob clearing
        window.addEventListener('rfx:clearknobs', () => {
            this.clearAllKnobs();
        });

        // Synth Shelf UI
        document.getElementById('synthShelfBtn')?.addEventListener('click', () => this.openSynthShelf());
        document.getElementById('synthShelfOverlay')?.addEventListener('click', () => this.closeSynthShelf());
        document.getElementById('synthDetailClose')?.addEventListener('click', () => this.closeSynthDetail());

        // Listen for synth load events
        window.addEventListener('rfx:synthLoaded', (e) => {
            this.onSynthLoaded(e.detail);
        });

        // Listen for synth clear event
        window.addEventListener('rfx:synthsCleared', () => {
            this.updateSynthList();
            this.updateSynthCount();
            this.closeSynthDetail();
        });

        // Listen for synth label updates
        window.addEventListener('rfx:synthLabelUpdated', (e) => {
            this.updateSynthList();
        });

        // Listen for parameter changes from custom UIs
        window.addEventListener('rfx:paramChanged', (e) => {
            const { paramName, value, source } = e.detail;

            // Don't update knob if event came from knob (avoid loop)
            if (source === 'knob') return;

            // Update all scoped knobs that match this parameter (e.g., r:cutoff, s:cutoff)
            for (const scopedName of this.dynamicKnobs.keys()) {
                if (scopedName === paramName || scopedName.endsWith(`:${paramName}`)) {
                    this.updateKnobFromSlider(scopedName, value);
                    // Update rfxParams for scoped name
                    if (window.rfxParams) {
                        window.rfxParams[scopedName] = value;
                    }
                }
            }

            // Also update unscoped parameter if it exists
            this.updateKnobFromSlider(paramName, value);
            if (window.rfxParams) {
                window.rfxParams[paramName] = value;
            }
        });

        // Clear all synths button
        document.getElementById('btnClearSynths')?.addEventListener('click', () => {
            rfx.clearAllSynths();
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

        // console.log(`🎛️ Creating knob for: ${paramName}`);

        const container = document.getElementById('dynamicKnobs');
        if (!container) return;

        // Remove placeholder message if it exists
        if (container.children.length === 1 && container.children[0].textContent.includes('Parameters will appear')) {
            container.innerHTML = '';
        }

        // Create display label (keep original casing for scoped names like "r:cutoff")
        const displayLabel = paramName.toUpperCase();

        // Create knob module
        const module = document.createElement('div');
        module.className = 'effect-module';
        module.innerHTML = `
            <div class="knob-container">
                <pad-knob id="param_${paramName}" label="${displayLabel}"
                          value="${Math.round(defaultValue * 127)}" min="0" max="127" size="50"></pad-knob>
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

        // console.log(`Registering knob ${knobId} with paramName=${paramName}`);
        this.knobs[knobId] = knob;

        // Listen to knob changes (pad-knob uses 'cc-change' event)
        knob.addEventListener('cc-change', (e) => {
            // console.log(`cc-change event fired for ${knobId}:`, e.detail);
            const value = e.detail.value; // Value is in event detail, not target
            this.handleKnobChange(knobId, paramName, value);
        });

        // Click to learn
        knob.addEventListener('click', () => {
            if (this.midiLearnMode) {
                this.learnKnob(knobId);
            }
        });

        // console.log(`✅ Registered knob: ${knobId}`);
    }

    handleKnobChange(knobId, paramName, value) {
        // console.log(`🎛️ Knob change: ${knobId}, paramName=${paramName}, value=${value}`);

        // Normalize to 0-1
        const normalized = value / 127;

        // Update RFX params
        if (paramName && window.rfxParams) {
            // console.log(`Setting rfxParams[${paramName}] = ${normalized.toFixed(2)}`);
            window.rfxParams[paramName] = normalized;
            // console.log(`📊 ${paramName} = ${normalized.toFixed(2)} (after set)`);

            // Extract base parameter name for UI sync (remove label prefix if present)
            const baseName = paramName.includes(':') ? paramName.split(':')[1] : paramName;

            // Emit event for custom UI sync
            window.dispatchEvent(new CustomEvent('rfx:paramChanged', {
                detail: { paramName: baseName, value: normalized, source: 'knob' }
            }));

            // Sync slider in synth detail panel if open (use base name)
            this.updateSliderFromKnob(baseName, normalized);
        } else {
            console.warn(`Cannot update param: paramName=${paramName}, rfxParams exists=${!!window.rfxParams}`);
        }
    }

    // Update slider value when knob changes (for generic sliders only)
    updateSliderFromKnob(paramName, value) {
        const slider = document.querySelector(`[data-param-name="${paramName}"]`);
        if (slider) {
            slider.value = Math.round(value * 127);
            const valueDisplay = slider.parentElement?.querySelector('.synth-param-value');
            if (valueDisplay) {
                valueDisplay.textContent = value.toFixed(2);
            }
        }
    }

    // Update knob value when slider changes
    updateKnobFromSlider(paramName, value) {
        const knobId = `param_${paramName}`;
        const knob = document.getElementById(knobId);

        if (knob) {
            // Try setAttribute first (pad-knob uses attributes)
            knob.setAttribute('value', Math.round(value * 127));

            // Also try setValue method if it exists
            if (knob.setValue) {
                knob.setValue(Math.round(value * 127));
            }
        }
        // Don't warn if knob not found - it's normal if user hasn't created it with .knob()
    }

    loadPreset(presetName) {
        if (!presetName) return;

        // console.log(`🎨 Loading preset: ${presetName}`);

        // Example presets (GM drum mapping for drums)
        const presets = {
            preset1: {
                code: `// 909 Techno\n// GM: 36=Kick, 38=Snare, 42=ClosedHH, 46=OpenHH\nstack(\n  note("36 ~ ~ ~").s("rg909"),        // Kick\n  note("~ 38 ~ 38").s("rg909"),       // Snare\n  note("42*8").s("rg909")             // Hi-hat\n).cpm(128)`
            },
            preset2: {
                code: `// AHX Drums\nstack(\n  note("36 ~ ~ ~").s("rgahxdrum"),    // Kick\n  note("~ 38 ~ 38").s("rgahxdrum")    // Snare\n).cpm(140)`
            },
            preset3: {
                code: `// AHX Chip Melody\nnote("c4 e4 g4 a4").s("rgahxsynth").cpm(140)`
            },
            preset4: {
                code: `// RV Bass\nnote("c2 ~ e2 ~").s("rvbass")\n  .knob("cutoff")\n  .knob("resonance")\n  .cpm(120)`
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
        // Open modal instead of blocking prompt
        document.getElementById('savePresetOverlay')?.classList.add('active');
        document.getElementById('savePresetModal')?.classList.add('active');
        document.getElementById('presetNameInput')?.focus();
    }

    closeSavePreset() {
        document.getElementById('savePresetOverlay')?.classList.remove('active');
        document.getElementById('savePresetModal')?.classList.remove('active');
        document.getElementById('presetNameInput').value = '';
    }

    confirmSavePreset() {
        const code = this.editor.getValue();
        const nameInput = document.getElementById('presetNameInput');
        const name = nameInput?.value.trim();
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

            // console.log(`💾 Saved preset: ${name}`);
            this.closeSavePreset();
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

        // Restore saved code from localStorage
        const savedCode = localStorage.getItem('rfxstrudel_last_code');
        if (savedCode) {
            this.editor.setValue(savedCode);
            console.log('Restored saved code from previous session');
        }

        // Fade in editor after initialization (prevent white flash)
        setTimeout(() => {
            const container = document.querySelector('.editor-container');
            if (container) {
                container.classList.remove('loading');
                container.classList.add('initialized');
            }
        }, 50);

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

        // Store current selection to restore it
        const currentSelection = midiInputSelect.value;
        const savedDevice = localStorage.getItem('rfxstrudel_midi_device');

        midiInputSelect.innerHTML = '<option value="">None</option>';

        for (const input of this.midiAccess.inputs.values()) {
            const option = document.createElement('option');
            option.value = input.id;
            option.textContent = input.name;
            midiInputSelect.appendChild(option);
        }

        // Set up listener only once
        if (!this.midiInputListenerAttached) {
            midiInputSelect.addEventListener('change', (e) => {
                this.connectMIDIInput(e.target.value);
                // Save selection
                if (e.target.value) {
                    localStorage.setItem('rfxstrudel_midi_device', e.target.value);
                } else {
                    localStorage.removeItem('rfxstrudel_midi_device');
                }
            });
            this.midiInputListenerAttached = true;
        }

        // Restore previous selection (current or saved)
        const deviceToSelect = currentSelection || savedDevice;
        if (deviceToSelect && midiInputSelect.querySelector(`option[value="${deviceToSelect}"]`)) {
            midiInputSelect.value = deviceToSelect;
            // Auto-connect if we restored a saved device
            if (savedDevice && !this.midiInputConnected) {
                this.connectMIDIInput(deviceToSelect);
            }
        }
    }

    connectMIDIInput(deviceId) {
        if (!this.midiAccess) return;

        // Disconnect all inputs first
        for (const input of this.midiAccess.inputs.values()) {
            input.onmidimessage = null;
        }

        if (!deviceId) {
            console.log('MIDI input disconnected');
            this.midiInputConnected = false;
            return;
        }

        const input = this.midiAccess.inputs.get(deviceId);
        if (input) {
            input.onmidimessage = (e) => this.handleMIDIMessage(e);
            this.midiInputConnected = true;
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
                    // Update pad-knob using setAttribute (triggers visual update)
                    knob.setAttribute('value', value);

                    // Also try setValue method if it exists
                    if (knob.setValue) {
                        knob.setValue(value);
                    }

                    // Manually fire cc-change event to trigger parameter updates
                    knob.dispatchEvent(new CustomEvent('cc-change', {
                        detail: { value: value }
                    }));
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

            // Clear any existing timeout
            if (this.midiLearnTimeout) {
                clearTimeout(this.midiLearnTimeout);
                this.midiLearnTimeout = null;
            }

            // Close the MIDI Setup modal so user can access knobs
            this.closeMIDISetup();

            // Show floating status indicator
            this.showMIDILearnIndicator('Click a knob to learn...');

            console.log('MIDI Learn mode enabled - click a knob, then move a MIDI controller');
        } else {
            btn.classList.remove('active');
            btn.textContent = 'Start MIDI Learn';

            // Clear timeout
            if (this.midiLearnTimeout) {
                clearTimeout(this.midiLearnTimeout);
                this.midiLearnTimeout = null;
            }

            // Hide floating indicator
            this.hideMIDILearnIndicator();

            console.log('MIDI Learn mode disabled');
        }
    }

    showMIDILearnIndicator(message) {
        let indicator = document.getElementById('midiLearnFloatingIndicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'midiLearnFloatingIndicator';
            indicator.style.cssText = `
                position: fixed;
                top: 70px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(207, 26, 55, 0.95);
                color: white;
                padding: 15px 25px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: bold;
                z-index: 10000;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
                border: 2px solid var(--brand-accent);
                cursor: pointer;
            `;

            // Click indicator to cancel MIDI learn
            indicator.addEventListener('click', () => {
                this.setMIDILearnMode(false);
            });

            document.body.appendChild(indicator);
        }
        indicator.innerHTML = `${message} <span style="opacity: 0.7; font-size: 0.9em;">(ESC or click to cancel)</span>`;
        indicator.style.display = 'block';
    }

    hideMIDILearnIndicator() {
        const indicator = document.getElementById('midiLearnFloatingIndicator');
        if (indicator) {
            indicator.style.display = 'none';
        }
    }

    learnKnob(knobId) {
        this.learnTarget = knobId;
        // Strip "param_" prefix for display
        const displayName = knobId.replace(/^param_/, '');
        this.showMIDILearnIndicator(`Learning ${displayName}... Move a MIDI controller.`);
        console.log(`Learning knob: ${knobId}`);
    }

    mapMIDIToKnob(cc, knobId) {
        this.midiMappings[cc] = knobId;
        this.saveMIDIMappings();
        console.log(`Mapped CC ${cc} to ${knobId}`);

        // Strip "param_" prefix for display
        const displayName = knobId.replace(/^param_/, '');
        this.showMIDILearnIndicator(`✓ Mapped CC ${cc} to ${displayName}!`);

        // Clear any existing timeout
        if (this.midiLearnTimeout) {
            clearTimeout(this.midiLearnTimeout);
        }

        // Show success for 2 seconds, then return to ready state
        setTimeout(() => {
            if (this.midiLearnMode) {
                this.showMIDILearnIndicator('Click a knob to learn...');
            }
        }, 2000);

        // Auto-exit MIDI learn after 10 seconds of inactivity
        this.midiLearnTimeout = setTimeout(() => {
            if (this.midiLearnMode) {
                console.log('MIDI Learn timeout - auto-exiting');
                this.setMIDILearnMode(false);
            }
        }, 10000);
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

        try {
            // Auto-save code to localStorage
            localStorage.setItem('rfxstrudel_last_code', code);

            // Preload synths before evaluating to avoid delays during playback
            await rfx.preloadSynths(code);

            // Only hush if code actually changed (for immediate pattern change)
            const codeChanged = code !== this.lastEvaluatedCode;
            if (this.isPlaying && codeChanged && window.hush) {
                window.hush();
                rfx.stopAll();
            }

            // Evaluate the code with Strudel (this also starts playback via .play())
            await this.strudel.evaluate(code);
            this.lastEvaluatedCode = code;

            // Mark as playing since evaluate() triggers playback
            this.isPlaying = true;
            const btn = document.getElementById('btnPlay');
            if (btn) {
                btn.classList.add('active');
            }

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

        // Auto-save code to localStorage
        const code = this.editor.getValue();
        localStorage.setItem('rfxstrudel_last_code', code);

        console.log('▶ Starting playback');
        const t0 = performance.now();
        this.isPlaying = true;

        const btn = document.getElementById('btnPlay');
        if (btn) {
            btn.classList.add('active');
        }

        try {
            // Evaluate code first
            await this.evaluate();
            const t1 = performance.now();
            console.log(`⏱️ evaluate: ${(t1 - t0).toFixed(0)}ms`);

            // Start Strudel scheduler
            await this.strudel.start();
            const t2 = performance.now();
            console.log(`⏱️ start: ${(t2 - t1).toFixed(0)}ms`);
            console.log(`⏱️ TOTAL play: ${(t2 - t0).toFixed(0)}ms`);
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

        // Stop immediately - don't wait
        if (window.hush) {
            window.hush();
        }
        rfx.stopAll();
    }

    clear() {
        this.editor.setValue('');
        rfx.clearKnobs();
        // Clear saved code from localStorage
        localStorage.removeItem('rfxstrudel_last_code');
        console.log('Code cleared');
    }

    clearAllKnobs() {
        const container = document.getElementById('dynamicKnobs');
        if (container) {
            container.innerHTML = '<div style="color: var(--text-secondary); font-size: 12px; padding: 10px;">Parameters will appear here as you code...</div>';
        }
        this.dynamicKnobs.clear();
        console.log('Cleared all knobs');
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

    // Synth Shelf UI Methods
    openSynthShelf() {
        document.getElementById('synthShelfOverlay')?.classList.add('active');
        document.getElementById('synthShelfPanel')?.classList.add('active');
        this.updateSynthList();
    }

    closeSynthShelf() {
        document.getElementById('synthShelfOverlay')?.classList.remove('active');
        document.getElementById('synthShelfPanel')?.classList.remove('active');
    }

    openSynthDetail(synthName) {
        this.closeSynthShelf();

        document.getElementById('synthDetailName').textContent = synthName.toUpperCase();
        const paramsContainer = document.getElementById('synthDetailParams');
        paramsContainer.innerHTML = '';

        // Try to load the synth's custom UI component
        const descriptor = window.SynthRegistry?.get?.(synthName);
        const synthInstance = rfx.getSynthByName(synthName);

        if (descriptor?.uiComponent) {
            // Load custom UI component
            const uiComponentName = descriptor.uiComponent;
            console.log(`Loading UI component: ${uiComponentName}`);

            const uiElement = document.createElement(uiComponentName);
            if (synthInstance?.instance) {
                uiElement.setSynth(synthInstance.instance);
            }
            paramsContainer.appendChild(uiElement);

            // Sync initial values from rfxParams after UI loads
            setTimeout(() => {
                if (window.rfxParams) {
                    for (const [paramName, value] of Object.entries(window.rfxParams)) {
                        window.dispatchEvent(new CustomEvent('rfx:paramChanged', {
                            detail: { paramName, value, source: 'init' }
                        }));
                    }
                }
            }, 100);
        } else {
            // Fallback to generic parameter sliders
            const params = rfx.getParameterInfo(synthName);

            if (params.length === 0) {
                paramsContainer.innerHTML = '<div style="color: var(--text-secondary); padding: 20px; text-align: center;">No parameters available</div>';
            } else {
                params.forEach(param => {
                    const item = document.createElement('div');
                    item.className = 'synth-param-item';

                    const label = document.createElement('div');
                    label.className = 'synth-param-label';
                    label.textContent = param.name || `Param ${param.index}`;

                    const slider = document.createElement('input');
                    slider.type = 'range';
                    slider.className = 'synth-param-slider';
                    slider.min = '0';
                    slider.max = '127';
                    slider.value = Math.round((param.default || 0.5) * 127);

                    // Add param name for knob sync lookup
                    const paramName = param.name?.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (paramName) {
                        slider.setAttribute('data-param-name', paramName);
                    }

                    const value = document.createElement('div');
                    value.className = 'synth-param-value';
                    value.textContent = (param.default || 0.5).toFixed(2);

                    slider.addEventListener('input', () => {
                        const normalized = slider.value / 127;
                        value.textContent = normalized.toFixed(2);
                        rfx.setSynthParameter(synthName, param.index, normalized);

                        // Sync with dynamic knob if it exists
                        if (paramName) {
                            this.updateKnobFromSlider(paramName, normalized);
                            // Also update rfxParams for pattern knobs
                            if (window.rfxParams) {
                                window.rfxParams[paramName] = normalized;
                            }
                        }
                    });

                    item.appendChild(label);
                    item.appendChild(slider);
                    item.appendChild(value);
                    paramsContainer.appendChild(item);
                });
            }
        }

        document.getElementById('synthDetailPanel')?.classList.add('active');
        document.querySelector('.content-wrapper')?.classList.add('synth-open');
    }

    closeSynthDetail() {
        document.getElementById('synthDetailPanel')?.classList.remove('active');
        document.querySelector('.content-wrapper')?.classList.remove('synth-open');
        // Also close the shelf
        this.closeSynthShelf();
    }

    onSynthLoaded(detail) {
        console.log(`🎹 Synth loaded: ${detail.name} (${detail.id})`);
        this.updateSynthList();
        this.updateSynthCount();
    }

    updateSynthList() {
        const synthList = document.getElementById('synthList');
        if (!synthList) return;

        const synths = rfx.getLoadedSynths();

        if (synths.length === 0) {
            synthList.innerHTML = `
                <div style="color: var(--text-secondary); font-size: 12px; padding: 20px; text-align: center;">
                    No synths loaded yet.<br>Play a pattern to load synths.
                </div>
            `;
            return;
        }

        synthList.innerHTML = '';
        synths.forEach(synth => {
            const inst = rfx.getSynthById(synth.id);
            const descriptor = window.SynthRegistry?.get?.(synth.name);

            // First line: "label: instanceId" or just "instanceId"
            const firstLine = inst?.label ? `${inst.label}: ${synth.id}` : synth.id;

            // Second line: Full display name from registry, or uppercase synth name as fallback
            const secondLine = descriptor?.displayName || synth.name.toUpperCase();

            const item = document.createElement('div');
            item.className = 'synth-item';
            item.innerHTML = `
                <div class="synth-item-name">${firstLine}</div>
                <div class="synth-item-id">${secondLine}</div>
            `;
            item.addEventListener('click', () => this.openSynthDetail(synth.name));
            synthList.appendChild(item);
        });
    }

    updateSynthCount() {
        const synthCount = document.getElementById('synthCount');
        if (synthCount) {
            const synths = rfx.getLoadedSynths();
            synthCount.textContent = synths.length;
        }
    }
}

// Initialize app when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
    window.app = new RFXStrudel();
    window.app.init();
});
