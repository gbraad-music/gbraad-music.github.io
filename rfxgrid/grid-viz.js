// Import pad-knob component from RegrooveFX
        class PadKnob extends HTMLElement {
            constructor() {
                super();
                this.attachShadow({ mode: 'open' });
                this.isDragging = false;
                this.startY = 0;
                this.startValue = 0;
                this.hasSetupInteraction = false;
            }

            static get observedAttributes() {
                return ['value', 'min', 'max', 'label'];
            }

            connectedCallback() {
                this.render();
                if (!this.hasSetupInteraction) {
                    this.setupInteraction();
                    this.hasSetupInteraction = true;
                }
            }

            attributeChangedCallback() {
                if (this.shadowRoot.children.length > 0) {
                    // Only update value display, don't re-render entire DOM
                    this.updateDisplay();
                } else {
                    this.render();
                }
            }

            updateDisplay() {
                const value = parseFloat(this.getAttribute('value') || '0');
                const min = parseFloat(this.getAttribute('min') || '0');
                const max = parseFloat(this.getAttribute('max') || '127');

                const percentage = ((value - min) / (max - min)) * 100;
                const rotation = (percentage / 100) * 270 - 135;

                const indicator = this.shadowRoot.querySelector('.knob-indicator');
                const valueDisplay = this.shadowRoot.querySelector('.knob-value');

                if (indicator) {
                    indicator.style.transform = `translateX(-50%) rotate(${rotation}deg)`;
                }
                if (valueDisplay) {
                    valueDisplay.textContent = value.toFixed(1);
                }
            }

            setupInteraction() {
                const container = this.shadowRoot.querySelector('.knob-container');

                const onMouseDown = (e) => {
                    this.isDragging = true;
                    this.startY = e.clientY;
                    this.startValue = parseFloat(this.getAttribute('value') || '0');
                    e.preventDefault();
                    e.stopPropagation(); // Prevent module drag
                    document.body.style.cursor = 'ns-resize';
                    container.classList.add('dragging');
                };

                const onMouseMove = (e) => {
                    if (!this.isDragging) return;

                    const deltaY = this.startY - e.clientY; // Inverted: up = increase
                    const min = parseFloat(this.getAttribute('min') || '0');
                    const max = parseFloat(this.getAttribute('max') || '127');
                    const range = max - min;
                    const sensitivity = range / 200; // 200px for full range

                    let newValue = this.startValue + (deltaY * sensitivity);
                    newValue = Math.max(min, Math.min(max, newValue));

                    this.setAttribute('value', newValue.toFixed(2));

                    // Dispatch change event
                    this.dispatchEvent(new CustomEvent('knob-change', {
                        bubbles: true,
                        composed: true,
                        detail: { value: newValue }
                    }));
                };

                const onMouseUp = () => {
                    if (this.isDragging) {
                        this.isDragging = false;
                        document.body.style.cursor = '';
                        container.classList.remove('dragging');
                    }
                };

                container.addEventListener('mousedown', onMouseDown);
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);

                // Store references for cleanup
                this._cleanupListeners = () => {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                };
            }

            disconnectedCallback() {
                if (this._cleanupListeners) {
                    this._cleanupListeners();
                }
            }

            render() {
                const label = this.getAttribute('label') || 'Param';
                const value = parseFloat(this.getAttribute('value') || '0');
                const min = parseFloat(this.getAttribute('min') || '0');
                const max = parseFloat(this.getAttribute('max') || '127');

                const percentage = ((value - min) / (max - min)) * 100;
                const rotation = (percentage / 100) * 270 - 135;

                this.shadowRoot.innerHTML = `
                    <style>
                        :host {
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            gap: 4px;
                            width: 80px;
                            user-select: none;
                        }

                        .knob-label {
                            font-size: 0.7em;
                            font-weight: bold;
                            color: #d0d0d0;
                            text-transform: uppercase;
                            letter-spacing: 0.5px;
                            text-align: center;
                        }

                        .knob-container {
                            position: relative;
                            width: 60px;
                            height: 60px;
                        }

                        .knob-track {
                            position: absolute;
                            inset: 0;
                            border-radius: 50%;
                            background: #1a1a1a;
                            border: 2px solid #333;
                            transition: border-color 0.1s;
                        }

                        .knob-container:hover .knob-track {
                            border-color: #555;
                        }

                        .knob-container.dragging .knob-track {
                            border-color: #CF1A37;
                        }

                        .knob-indicator {
                            position: absolute;
                            top: 6px;
                            left: 50%;
                            width: 3px;
                            height: 24px;
                            background: #CF1A37;
                            border-radius: 2px;
                            transform-origin: bottom center;
                            transform: translateX(-50%) rotate(${rotation}deg);
                        }

                        .knob-center {
                            position: absolute;
                            inset: 30%;
                            border-radius: 50%;
                            background: #2a2a2a;
                        }

                        .knob-value {
                            font-size: 0.65em;
                            color: #aaa;
                            text-align: center;
                            font-family: monospace;
                        }
                    </style>
                    <div class="knob-label">${label}</div>
                    <div class="knob-container">
                        <div class="knob-track"></div>
                        <div class="knob-indicator"></div>
                        <div class="knob-center"></div>
                    </div>
                    <div class="knob-value">${value.toFixed(1)}</div>
                `;
            }
        }

        customElements.define('pad-knob', PadKnob);

        // Import audio engine
        import { GridAudioEngine } from './audio-engine.js';

        // Grid data and rendering
        let gridData = null;
        let moduleElements = new Map();

        // Module size mapping based on category and name
        function getModuleSize(module) {
            const name = module.name.toLowerCase();
            const category = module.category;

            // Oscillators: 2x3 (2 rows high, 3 columns wide)
            if (category === 'Oscillator') {
                return 'module-2x3';
            }

            // Envelopes
            if (category === 'Envelope') {
                if (name.includes('adsr')) {
                    return 'module-2x2';
                }
                if (name.includes('ad') || name.includes('ar')) {
                    return 'module-2x2';
                }
            }

            // Filter: 2x3 (2 rows high, 3 columns wide)
            if (category === 'Filter') {
                return 'module-2x3';
            }

            // Mix/Blend: 1x1
            if (category === 'Mix' || name.includes('blend')) {
                return 'module-1x1';
            }

            // Gain: 1x1
            if (category === 'Gain' || name.includes('gain')) {
                return 'module-1x1';
            }

            // Hard Clip: 2x1 (height x width)
            if (name.includes('clip')) {
                return 'module-2x1';
            }

            // Audio Out / Output: 2x3 (same as oscillators)
            if (name.includes('audio out') || (name.includes('output') && category === 'I/O')) {
                return 'module-2x3';
            }

            // Gate In: 1x1
            if (name.includes('gate')) {
                return 'module-1x1';
            }

            // Interface/Grid: 1x1
            if (category === 'Interface' || category === 'The Grid' || category === 'Note-driven') {
                return 'module-1x1';
            }

            // Default: 2x2
            return 'module-2x2';
        }

        // Get important parameters to display as knobs
        function getModuleKnobs(module) {
            const knobs = [];
            const params = module.parameters || {};

            // For oscillators: use TIMBRE (shape/PW) and WRAP (sync)
            if (module.category === 'Oscillator') {
                const nameLower = module.name.toLowerCase();

                if (params['TIMBRE']) {
                    const label = nameLower.includes('pulse') ? 'PW' : 'Shape';
                    knobs.push({ label: label, value: params['TIMBRE'].value * 100, min: 0, max: 100, paramName: 'TIMBRE' });
                }
                if (params['WRAP']) {
                    knobs.push({ label: 'Sync', value: params['WRAP'].value, min: -48, max: 48, paramName: 'WRAP' });
                }
            }

            // Helper: Transform envelope time parameter (cubic curve)
            // UI_seconds = 8.0 × (stored_value / 2.0)³
            function transformEnvelopeTime(storedValue) {
                return 8.0 * Math.pow(storedValue / 2.0, 3);
            }

            // For AD envelope
            if (module.name === 'AD') {
                if (params['ATTACK']) {
                    const timeSeconds = transformEnvelopeTime(params['ATTACK'].value);
                    knobs.push({ label: 'Attack', value: timeSeconds * 1000, min: 0, max: 8000, paramName: 'ATTACK' });
                }
                if (params['DECAY']) {
                    const timeSeconds = transformEnvelopeTime(params['DECAY'].value);
                    knobs.push({ label: 'Decay', value: timeSeconds * 1000, min: 0, max: 8000, paramName: 'DECAY' });
                }
            }

            // For AR envelope
            if (module.name === 'AR') {
                if (params['ATTACK']) {
                    const timeSeconds = transformEnvelopeTime(params['ATTACK'].value);
                    knobs.push({ label: 'Attack', value: timeSeconds * 1000, min: 0, max: 8000, paramName: 'ATTACK' });
                }
                if (params['RELEASE']) {
                    const timeSeconds = transformEnvelopeTime(params['RELEASE'].value);
                    knobs.push({ label: 'Release', value: timeSeconds * 1000, min: 0, max: 8000, paramName: 'RELEASE' });
                }
            }

            // For ADSR envelope
            if (module.name.includes('ADSR')) {
                if (params['ATTACK']) {
                    const timeSeconds = transformEnvelopeTime(params['ATTACK'].value);
                    knobs.push({ label: 'A', value: timeSeconds * 1000, min: 0, max: 8000, paramName: 'ATTACK' });
                }
                if (params['DECAY']) {
                    const timeSeconds = transformEnvelopeTime(params['DECAY'].value);
                    knobs.push({ label: 'D', value: timeSeconds * 1000, min: 0, max: 8000, paramName: 'DECAY' });
                }
                if (params['SUSTAIN']) {
                    knobs.push({ label: 'S', value: params['SUSTAIN'].value * 100, min: 0, max: 100, paramName: 'SUSTAIN' });
                }
                if (params['RELEASE']) {
                    const timeSeconds = transformEnvelopeTime(params['RELEASE'].value);
                    knobs.push({ label: 'R', value: timeSeconds * 1000, min: 0, max: 8000, paramName: 'RELEASE' });
                }
            }

            // For filters
            if (module.category === 'Filter') {
                if (params['CUTOFF']) {
                    knobs.push({ label: 'Cutoff', value: params['CUTOFF'].value, min: 0, max: 127, paramName: 'CUTOFF' });
                }
                if (params['RESONANCE']) {
                    knobs.push({ label: 'Res', value: params['RESONANCE'].value * 100, min: 0, max: 100, paramName: 'RESONANCE' });
                }
            }

            // For blend/mix - uses DEPTH parameter (0.0 = 100% IN, 1.0 = 100% IN2)
            if (module.category === 'Mix' || module.name.toLowerCase().includes('blend')) {
                if (params['DEPTH']) {
                    const percentage = params['DEPTH'].value * 100;
                    knobs.push({ label: 'Blend', value: percentage, min: 0, max: 100, paramName: 'DEPTH' });
                }
            }

            // For gain
            if (params['GAIN']) {
                knobs.push({ label: 'Gain', value: params['GAIN'].value, min: 0, max: 127, paramName: 'GAIN' });
            }

            // For hard clip - uses DRIVE parameter
            if (module.name.toLowerCase().includes('clip')) {
                if (params['DRIVE']) {
                    knobs.push({ label: 'Drive', value: params['DRIVE'].value, min: 0, max: 1, paramName: 'DRIVE' });
                }
            }

            return knobs;
        }

        // Handle knob value changes
        function handleKnobChange(module, paramName, uiValue) {
            if (!gridData || !module.parameters || !module.parameters[paramName]) return;

            const param = module.parameters[paramName];
            let storedValue = uiValue;

            // Convert UI value back to stored value based on parameter type
            if (paramName === 'TIMBRE') {
                // UI: 0-100, stored: 0-1
                storedValue = uiValue / 100;
            } else if (paramName === 'WRAP') {
                // UI: -48 to 48, stored: same
                storedValue = uiValue;
            } else if (paramName === 'ATTACK' || paramName === 'DECAY' || paramName === 'RELEASE') {
                // UI: ms (0-8000), stored: inverse cubic transform
                // UI_seconds = 8.0 × (stored_value / 2.0)³
                // stored_value = 2.0 × (UI_seconds / 8.0)^(1/3)
                const seconds = uiValue / 1000;
                storedValue = 2.0 * Math.pow(seconds / 8.0, 1/3);
            } else if (paramName === 'SUSTAIN') {
                // UI: 0-100, stored: 0-1
                storedValue = uiValue / 100;
            } else if (paramName === 'CUTOFF') {
                // UI: 0-127, stored: same
                storedValue = uiValue;
            } else if (paramName === 'RESONANCE') {
                // UI: 0-100, stored: 0-1
                storedValue = uiValue / 100;
            } else if (paramName === 'DEPTH') {
                // UI: 0-100, stored: 0-1
                storedValue = uiValue / 100;
            } else if (paramName === 'GAIN') {
                // UI: 0-127 (or dB), stored: same
                storedValue = uiValue;
            } else if (paramName === 'DRIVE') {
                // UI: 0-1, stored: same
                storedValue = uiValue;
            }

            // Update gridData
            param.value = storedValue;
            console.log(`[Knob] ${module.name}.${paramName} = ${storedValue.toFixed(3)} (UI: ${uiValue.toFixed(1)})`);

            // Update audio engine parameter in real-time (affects active voices)
            if (audioEngine) {
                audioEngine.updateParameter(module.id, paramName, storedValue);
            }
        }

        // Auto-layout helper
        let layoutX = 20;
        let layoutY = 20;
        let rowHeight = 0;
        const maxWidth = 1400;

        function resetLayout() {
            layoutX = 20;
            layoutY = 20;
            rowHeight = 0;
        }

        // Create module element
        function createModule(module, index) {
            const div = document.createElement('div');
            div.className = `module ${getModuleSize(module)}`;
            div.dataset.moduleId = module.id;
            div.dataset.category = module.category;

            // Get module dimensions from CSS class
            const sizeClass = getModuleSize(module);
            let width = 120, height = 120;
            if (sizeClass === 'module-2x3') { width = 360; height = 240; }
            else if (sizeClass === 'module-2x2') { width = 240; height = 240; }
            else if (sizeClass === 'module-3x2') { width = 240; height = 360; }
            else if (sizeClass === 'module-2x1') { width = 120; height = 240; }

            // Auto-layout: place in rows
            if (layoutX + width > maxWidth) {
                // Move to next row
                layoutX = 20;
                layoutY += rowHeight + 20;
                rowHeight = 0;
            }

            div.style.left = `${layoutX}px`;
            div.style.top = `${layoutY}px`;

            // Update layout position
            layoutX += width + 20;
            rowHeight = Math.max(rowHeight, height);

            const header = document.createElement('div');
            header.className = 'module-header';
            header.innerHTML = `
                <div class="module-name">${module.name}</div>
                <div class="module-category">${module.category}</div>
            `;

            const knobsContainer = document.createElement('div');
            knobsContainer.className = 'module-knobs';

            const knobs = getModuleKnobs(module);
            knobs.forEach(knob => {
                const knobEl = document.createElement('pad-knob');
                knobEl.setAttribute('label', knob.label);
                knobEl.setAttribute('value', knob.value);
                knobEl.setAttribute('min', knob.min);
                knobEl.setAttribute('max', knob.max);
                knobEl.dataset.paramName = knob.paramName;
                knobEl.dataset.moduleId = module.id;

                // Listen for knob changes
                knobEl.addEventListener('knob-change', (e) => {
                    handleKnobChange(module, knob.paramName, e.detail.value);
                });

                knobsContainer.appendChild(knobEl);
            });

            div.appendChild(header);
            div.appendChild(knobsContainer);

            // Add oscilloscope for Oscillator modules (shows raw waveform)
            if (module.category === 'Oscillator') {
                const scopeContainer = document.createElement('div');
                scopeContainer.className = 'scope-container';
                scopeContainer.style.cssText = 'width: 100%; height: 100px; padding: 5px;';

                const scopeCanvas = document.createElement('canvas');
                scopeCanvas.id = `scope-osc-${module.id}`;
                scopeCanvas.className = 'scope-canvas-osc';
                scopeCanvas.dataset.moduleId = module.id;
                scopeCanvas.style.cssText = 'width: 100%; height: 100%; background: #0a0a0a; border-radius: 4px;';

                scopeContainer.appendChild(scopeCanvas);
                div.appendChild(scopeContainer);
            }

            // Add oscilloscope for Audio Out modules (shows final output)
            if (module.name.toLowerCase().includes('audio out') || module.name.toLowerCase().includes('output')) {
                const scopeContainer = document.createElement('div');
                scopeContainer.className = 'scope-container';
                scopeContainer.style.cssText = 'width: 100%; height: 140px; padding: 10px;';

                const scopeCanvas = document.createElement('canvas');
                scopeCanvas.id = `scope-${module.id}`;
                scopeCanvas.className = 'scope-canvas';
                scopeCanvas.dataset.moduleId = module.id;
                scopeCanvas.style.cssText = 'width: 100%; height: 100%; background: #0a0a0a; border-radius: 4px;';

                scopeContainer.appendChild(scopeCanvas);
                div.appendChild(scopeContainer);

                // Start scope after module is added to DOM
                setTimeout(() => {
                    if (audioEngine && audioEngine.analyser) {
                        startOscilloscope(scopeCanvas);
                    }
                }, 100);
            }

            // Drag and drop functionality
            setupDragAndDrop(div);

            moduleElements.set(module.id, div);
            return div;
        }

        // Drag and drop setup
        let draggedElement = null;
        let dragOffsetX = 0;
        let dragOffsetY = 0;

        function setupDragAndDrop(element) {
            element.addEventListener('mousedown', (e) => {
                if (e.target.tagName === 'PAD-KNOB' || e.target.closest('pad-knob')) {
                    return; // Don't drag if clicking knobs
                }

                draggedElement = element;
                const rect = element.getBoundingClientRect();
                const canvas = document.getElementById('gridCanvas');
                const canvasRect = canvas.getBoundingClientRect();

                dragOffsetX = e.clientX - rect.left;
                dragOffsetY = e.clientY - rect.top;

                element.classList.add('dragging');
                e.preventDefault();
            });
        }

        // Global mouse move and up handlers
        document.addEventListener('mousemove', (e) => {
            if (!draggedElement) return;

            const canvas = document.getElementById('gridCanvas');
            const canvasRect = canvas.getBoundingClientRect();

            let x = e.clientX - canvasRect.left - dragOffsetX + canvas.scrollLeft;
            let y = e.clientY - canvasRect.top - dragOffsetY + canvas.scrollTop;

            // Snap to grid (120px)
            x = Math.round(x / 120) * 120;
            y = Math.round(y / 120) * 120;

            draggedElement.style.left = `${x}px`;
            draggedElement.style.top = `${y}px`;

            drawConnections();
        });

        document.addEventListener('mouseup', () => {
            if (draggedElement) {
                draggedElement.classList.remove('dragging');
                draggedElement = null;
                drawConnections();
            }
        });

        // Draw connections
        function drawConnections() {
            if (!gridData) return;

            const svg = document.getElementById('connectionsSvg');
            const canvas = document.getElementById('gridCanvas');

            // Clear existing lines
            svg.querySelectorAll('.connection-line').forEach(el => el.remove());

            // Draw each connection
            gridData.modules.forEach(module => {
                const params = module.parameters || {};
                Object.entries(params).forEach(([paramName, paramData]) => {
                    if (paramData.type === 'connection' && paramData.from_module) {
                        const fromModule = gridData.modules.find(m => m.name === paramData.from_module);
                        if (fromModule) {
                            const fromEl = moduleElements.get(fromModule.id);
                            const toEl = moduleElements.get(module.id);

                            if (fromEl && toEl) {
                                const fromRect = fromEl.getBoundingClientRect();
                                const toRect = toEl.getBoundingClientRect();
                                const canvasRect = canvas.getBoundingClientRect();

                                const x1 = fromRect.right - canvasRect.left;
                                const y1 = fromRect.top + fromRect.height / 2 - canvasRect.top;
                                const x2 = toRect.left - canvasRect.left;
                                const y2 = toRect.top + toRect.height / 2 - canvasRect.top;

                                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                                const midX = (x1 + x2) / 2;
                                path.setAttribute('d', `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
                                path.setAttribute('class', 'connection-line');
                                path.setAttribute('marker-end', 'url(#arrowhead)');
                                svg.appendChild(path);
                            }
                        }
                    }
                });
            });
        }

        // Load and render grid
        async function loadGrid(jsonData) {
            gridData = jsonData;
            const canvas = document.getElementById('gridCanvas');
            canvas.innerHTML = '';
            moduleElements.clear();

            // Filter out Grid/Interface modules for cleaner view
            const displayModules = gridData.modules.filter(m =>
                m.category !== 'The Grid' && m.category !== 'Interface'
            );

            // Reset layout position
            resetLayout();

            // Create module elements with auto-layout
            displayModules.forEach((module, index) => {
                canvas.appendChild(createModule(module, index));
            });

            // Update SVG size to cover entire canvas
            const svg = document.getElementById('connectionsSvg');
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', '100%');

            // Draw connections after layout
            setTimeout(() => drawConnections(), 100);

            // Initialize audio engine and load grid data
            console.log('[UI] Initializing audio engine...');
            const engine = await initAudio();
            console.log('[UI] Loading grid into audio engine...');
            await engine.loadGrid(gridData);
            console.log('[UI] Setting up keyboard...');
            engine.setupKeyboard();
            console.log('[UI] Grid data loaded into audio engine');
            console.log('[UI] Keyboard and MIDI enabled, ready to play');

            // Update UI
            const enableBtn = document.getElementById('enableKeyboardBtn');
            if (enableBtn) {
                enableBtn.textContent = '✓ Keyboard Enabled';
                enableBtn.disabled = true;
            }

            // Start oscillator scopes
            document.querySelectorAll('.scope-canvas-osc').forEach(canvas => {
                const moduleId = canvas.dataset.moduleId;
                startOscillatorScope(canvas, moduleId);
            });

            // Start oscilloscopes for any Audio Out modules
            document.querySelectorAll('.scope-canvas').forEach(canvas => {
                startOscilloscope(canvas);
            });

            console.log(`Loaded ${displayModules.length} modules (${gridData.modules.length} total)`);
        }

        // Hamburger menu handlers
        const hamburgerBtn = document.getElementById('hamburgerBtn');
        const menuOverlay = document.getElementById('menuOverlay');
        const menuPanel = document.getElementById('menuPanel');
        const menuClose = document.getElementById('menuClose');
        const loadJsonBtn = document.getElementById('loadJsonBtn');

        function toggleMenu() {
            menuOverlay.classList.toggle('active');
            menuPanel.classList.toggle('active');
        }

        function closeMenu() {
            menuOverlay.classList.remove('active');
            menuPanel.classList.remove('active');
        }

        hamburgerBtn.addEventListener('click', toggleMenu);
        menuClose.addEventListener('click', closeMenu);
        menuOverlay.addEventListener('click', closeMenu);
        loadJsonBtn.addEventListener('click', () => {
            document.getElementById('jsonFile').click();
        });

        // File input handler
        document.getElementById('jsonFile').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            document.getElementById('fileLabel').textContent = file.name;
            closeMenu();

            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const json = JSON.parse(event.target.result);
                    await loadGrid(json);
                } catch (err) {
                    alert('Error parsing JSON: ' + err.message);
                    console.error('[UI] Error loading grid:', err);
                }
            };
            reader.readAsText(file);
        });

        // Redraw connections on window resize
        window.addEventListener('resize', () => {
            setTimeout(() => drawConnections(), 100);
        });

        // Audio Engine Integration
        let audioContext = null;
        let audioEngine = null;

        async function initAudio() {
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                audioEngine = new GridAudioEngine(audioContext);
                console.log('[UI] Audio engine initialized');
            }

            // Resume AudioContext (required by browsers after user interaction)
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
                console.log('[UI] AudioContext resumed');
            }

            return audioEngine;
        }

        // Add audio controls to menu
        const audioSection = document.createElement('div');
        audioSection.innerHTML = `
            <div class="menu-section-title" style="margin-top: 20px;">Audio</div>
            <button class="menu-item" id="enableKeyboardBtn">🎹 Enable Keyboard</button>
            <button class="menu-item" id="allNotesOffBtn">⏹ All Notes Off</button>
            <div style="color: var(--text-secondary); font-size: 0.8em; padding: 10px 15px; line-height: 1.4;">
                Play using keyboard (A-K keys) or MIDI input (auto-detected).
            </div>
        `;
        document.querySelector('.menu-items').appendChild(audioSection);

        // Enable Keyboard button
        document.getElementById('enableKeyboardBtn').addEventListener('click', async () => {
            if (!gridData) {
                alert('Please load a Grid JSON file first');
                return;
            }

            const engine = await initAudio();
            engine.setupKeyboard();
            document.getElementById('enableKeyboardBtn').textContent = '✓ Keyboard Enabled';
            document.getElementById('enableKeyboardBtn').disabled = true;
            console.log('[UI] Keyboard enabled, ready to play');
        });

        // All Notes Off button
        document.getElementById('allNotesOffBtn').addEventListener('click', () => {
            if (audioEngine) {
                audioEngine.allNotesOff();
                console.log('[UI] All notes off');
            }
        });

        // Oscillator scope rendering (shows raw waveform)
        function startOscillatorScope(canvas, moduleId) {
            if (!audioEngine) return;

            const ctx = canvas.getContext('2d');

            function draw() {
                requestAnimationFrame(draw);

                // Get analyser from active voices
                let analyser = null;
                if (audioEngine.voices && audioEngine.voices.size > 0) {
                    const voice = Array.from(audioEngine.voices.values())[0];
                    analyser = voice.nodes[`osc_analyser_${moduleId}`];
                }

                if (!analyser) {
                    // No active voice, show blank
                    canvas.width = canvas.offsetWidth;
                    canvas.height = canvas.offsetHeight;
                    ctx.fillStyle = '#0a0a0a';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    return;
                }

                const bufferLength = analyser.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);
                analyser.getByteTimeDomainData(dataArray);

                canvas.width = canvas.offsetWidth;
                canvas.height = canvas.offsetHeight;

                ctx.fillStyle = '#0a0a0a';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Draw waveform
                ctx.strokeStyle = '#ff6b35'; // Orange/red like Bitwig
                ctx.lineWidth = 2;
                ctx.beginPath();

                const sliceWidth = canvas.width / bufferLength;
                let x = 0;

                for (let i = 0; i < bufferLength; i++) {
                    const v = dataArray[i] / 128.0;
                    const y = v * canvas.height / 2;

                    if (i === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }

                    x += sliceWidth;
                }

                ctx.lineTo(canvas.width, canvas.height / 2);
                ctx.stroke();
            }

            draw();
        }

        // Oscilloscope rendering (shows final output)
        function startOscilloscope(canvas) {
            if (!audioEngine || !audioEngine.analyser) return;

            const ctx = canvas.getContext('2d');
            const analyser = audioEngine.analyser;
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);

            function draw() {
                requestAnimationFrame(draw);

                analyser.getByteTimeDomainData(dataArray);

                // Auto-resize canvas
                canvas.width = canvas.offsetWidth;
                canvas.height = canvas.offsetHeight;

                // Background
                ctx.fillStyle = '#0a0a0a';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Grid
                ctx.strokeStyle = '#1a1a1a';
                ctx.lineWidth = 1;
                for (let i = 0; i < 5; i++) {
                    const y = (canvas.height / 4) * i;
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(canvas.width, y);
                    ctx.stroke();
                }

                // Waveform - REGROOVE RED
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#CF1A37';
                ctx.beginPath();

                const sliceWidth = canvas.width / bufferLength;
                let x = 0;

                for (let i = 0; i < bufferLength; i++) {
                    const v = dataArray[i] / 128.0;
                    const y = v * canvas.height / 2;

                    if (i === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }

                    x += sliceWidth;
                }

                ctx.lineTo(canvas.width, canvas.height / 2);
                ctx.stroke();
            }

            draw();
        }