/**
 * Scene Editor UI for Meister
 * Allows visual configuration of mixer scenes with fader slots
 */

export class SceneEditor {
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
        this.currentSceneId = null;
        this.editingSlotIndex = null;
        this.sceneConfig = {
            name: '',
            layout: '1x5',
            faders: []
        };
        this.padSceneConfig = {
            name: '',
            layout: '4x4',
            pollDevices: [],
            pollInterval: 250
        };
        this.splitFaderSlots = []; // For split scene fader configuration

        this.setupUI();
    }

    setupUI() {
        // Edit built-in pad scene
        document.getElementById('edit-pad-scene-btn')?.addEventListener('click', () => {
            this.openPadSceneEditor('pads');
        });

        // Edit built-in mixer scene
        document.getElementById('edit-mixer-btn')?.addEventListener('click', () => {
            this.openSceneEditor('mixer');
        });

        // Edit built-in effects scene
        document.getElementById('edit-effects-btn')?.addEventListener('click', () => {
            this.openEffectsSceneEditor('effects');
        });

        // Edit built-in piano scene
        document.getElementById('edit-piano-btn')?.addEventListener('click', () => {
            this.openPianoSceneEditor('piano');
        });

        // New mixer scene button
        document.getElementById('new-scene-btn')?.addEventListener('click', () => {
            this.openSceneEditor();
        });

        // Template buttons
        document.getElementById('template-1x10-btn')?.addEventListener('click', () => {
            this.applyTemplate('1x10');
        });

        document.getElementById('template-1x12-btn')?.addEventListener('click', () => {
            this.applyTemplate('1x12');
        });

        // New effects scene button
        document.getElementById('new-effects-btn')?.addEventListener('click', () => {
            this.openEffectsSceneEditor();
        });

        // New pad scene button
        document.getElementById('new-pad-scene-btn')?.addEventListener('click', () => {
            this.openPadSceneEditor();
        });

        // New knobs grid button (control-grid scene)
        document.getElementById('new-knobs-scene-btn')?.addEventListener('click', () => {
            this.openControlGridSceneEditor();
        });

        // New piano scene button
        document.getElementById('new-piano-scene-btn')?.addEventListener('click', () => {
            this.openPianoSceneEditor();
        });

        document.getElementById('new-split-scene-btn')?.addEventListener('click', () => {
            this.openSplitSceneEditor();
        });

        // New sequencer scene button
        document.getElementById('new-sequencer-scene-btn')?.addEventListener('click', () => {
            this.createSequencerScene();
        });

        // New Fire scene button
        document.getElementById('new-fire-scene-btn')?.addEventListener('click', () => {
            this.createFireScene();
        });

        // Close Fire scene editor
        document.getElementById('close-fire-scene-editor')?.addEventListener('click', () => {
            this.closeFireSceneEditor();
        });

        // Save Fire scene
        document.getElementById('save-fire-scene')?.addEventListener('click', () => {
            this.saveFireScene();
        });

        // Delete Fire scene
        document.getElementById('delete-fire-scene')?.addEventListener('click', () => {
            this.deleteFireScene();
        });

        // Fire scene mode change
        document.getElementById('fire-scene-mode')?.addEventListener('change', (e) => {
            const isLinked = e.target.value === 'linked';

            // Show/hide linked mode fields
            document.getElementById('fire-linked-sequencer-field').style.display = isLinked ? 'block' : 'none';

            // Show/hide compatible mode fields
            document.getElementById('fire-compatible-output-field').style.display = isLinked ? 'none' : 'block';
            document.getElementById('fire-compatible-channel-field').style.display = isLinked ? 'none' : 'block';

            if (isLinked) {
                this.populateFireSequencerList();
            }
        });

        // Close control grid scene editor
        document.getElementById('close-control-grid-scene-editor')?.addEventListener('click', () => {
            this.closeControlGridSceneEditor();
        });

        // Save control grid scene
        document.getElementById('save-control-grid-scene')?.addEventListener('click', () => {
            this.saveControlGridScene();
        });

        // Delete control grid scene
        document.getElementById('delete-control-grid-scene')?.addEventListener('click', () => {
            this.deleteControlGridScene();
        });

        // Close split scene editor
        document.getElementById('close-split-scene-editor')?.addEventListener('click', () => {
            this.closeSplitSceneEditor();
        });

        // Save split scene
        document.getElementById('save-split-scene')?.addEventListener('click', () => {
            this.saveSplitScene();
        });

        // Delete split scene
        document.getElementById('delete-split-scene')?.addEventListener('click', () => {
            this.deleteSplitScene();
        });

        // Close scene editor
        document.getElementById('close-scene-editor')?.addEventListener('click', () => {
            this.closeSceneEditor();
        });

        // Close pad scene editor
        document.getElementById('close-pad-scene-editor')?.addEventListener('click', () => {
            this.closePadSceneEditor();
        });

        // Close effects scene editor
        document.getElementById('close-effects-scene-editor')?.addEventListener('click', () => {
            this.closeEffectsSceneEditor();
        });

        // Close fader editor
        document.getElementById('close-fader-editor')?.addEventListener('click', () => {
            this.closeFaderEditor();
        });

        // Layout change
        document.getElementById('scene-layout')?.addEventListener('change', (e) => {
            this.sceneConfig.layout = e.target.value;
            this.renderFaderGrid();
        });

        // Polling interval slider
        document.getElementById('scene-polling-interval')?.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            document.getElementById('scene-polling-interval-value').textContent = value + 'ms';
        });

        // Fader type change
        document.getElementById('fader-type')?.addEventListener('change', (e) => {
            this.updateFaderEditorFields(e.target.value);
        });

        // Save scene
        document.getElementById('save-scene')?.addEventListener('click', () => {
            this.saveScene();
        });

        // Delete scene
        document.getElementById('delete-scene')?.addEventListener('click', () => {
            this.deleteScene();
        });

        // Save fader
        document.getElementById('save-fader')?.addEventListener('click', () => {
            // Check if we're editing a split scene fader or mixer scene fader
            if (this.editingSplitSlotIndex !== null && this.editingSplitSlotIndex !== undefined) {
                this.saveSplitFader();
            } else {
                this.saveFader();
            }
        });

        // Clear fader
        document.getElementById('clear-fader')?.addEventListener('click', () => {
            this.clearFader();
        });

        // Save pad scene
        document.getElementById('save-pad-scene')?.addEventListener('click', () => {
            this.savePadScene();
        });

        // Delete pad scene
        document.getElementById('delete-pad-scene')?.addEventListener('click', () => {
            this.deletePadScene();
        });

        // Pad scene polling interval slider
        document.getElementById('pad-scene-polling-interval')?.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            document.getElementById('pad-scene-polling-interval-value').textContent = value + 'ms';
        });

        // Split scene polling interval slider
        document.getElementById('split-scene-polling-interval')?.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            document.getElementById('split-scene-polling-interval-value').textContent = value + 'ms';
        });

        // Save effects scene
        document.getElementById('save-effects-scene')?.addEventListener('click', () => {
            this.saveEffectsScene();
        });

        // Delete effects scene
        document.getElementById('delete-effects-scene')?.addEventListener('click', () => {
            this.deleteEffectsScene();
        });

        // Effects scene polling interval slider
        document.getElementById('effects-scene-polling-interval')?.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            document.getElementById('effects-scene-polling-interval-value').textContent = value + 'ms';
        });

        // Close piano scene editor
        document.getElementById('close-piano-scene-editor')?.addEventListener('click', () => {
            this.closePianoSceneEditor();
        });

        // Save piano scene
        document.getElementById('save-piano-scene')?.addEventListener('click', () => {
            this.savePianoScene();
        });

        // Delete piano scene
        document.getElementById('delete-piano-scene')?.addEventListener('click', () => {
            this.deletePianoScene();
        });

        // Sequencer scene editor
        document.getElementById('close-sequencer-scene-editor')?.addEventListener('click', () => {
            this.closeSequencerSceneEditor();
        });

        document.getElementById('save-sequencer-scene')?.addEventListener('click', () => {
            this.saveSequencerScene();
        });
    }

    openSceneEditor(sceneId = null) {
        this.currentSceneId = sceneId;

        // Check if this is a control-grid scene - use simplified editor
        if (sceneId) {
            const scene = this.sceneManager.scenes.get(sceneId);
            if (scene && scene.type === 'control-grid') {
                this.openControlGridEditor(sceneId);
                return;
            }
        }

        if (sceneId && sceneId !== 'pads') {
            // Edit existing scene
            const scene = this.sceneManager.scenes.get(sceneId);
            if (scene) {
                this.sceneConfig.name = scene.name;

                // Use slots if available, fallback to columns for backward compatibility
                const items = scene.slots || scene.columns || [];
                const rows = scene.rows || 1;
                const cols = scene.columnsPerRow || Math.ceil(items.length / rows);

                this.sceneConfig.layout = `${rows}x${cols}`;
                this.sceneConfig.faders = items;
                this.sceneConfig.pollingInterval = scene.pollInterval || 250;

                document.getElementById('scene-name').value = scene.name;
                document.getElementById('scene-layout').value = this.sceneConfig.layout;

                // Set polling interval
                const pollingSlider = document.getElementById('scene-polling-interval');
                if (pollingSlider) {
                    pollingSlider.value = this.sceneConfig.pollingInterval;
                    document.getElementById('scene-polling-interval-value').textContent = this.sceneConfig.pollingInterval + 'ms';
                }
                // Set display mode
                const displayModeSelect = document.getElementById("scene-display-mode");
                if (displayModeSelect) {
                }
            }
        } else {
            // New scene
            this.currentSceneId = 'custom-' + Date.now();
            this.sceneConfig = {
                name: 'Custom Mixer',
                layout: '1x5',
                faders: [],
                pollingInterval: 250
            };
            document.getElementById('scene-name').value = this.sceneConfig.name;
            document.getElementById('scene-layout').value = this.sceneConfig.layout;

            // Set default polling interval
            const pollingSlider = document.getElementById('scene-polling-interval');
            if (pollingSlider) {
                pollingSlider.value = 250;
                document.getElementById('scene-polling-interval-value').textContent = '250ms';
            }
            // Set default display mode
            const displayModeSelect = document.getElementById("scene-display-mode");
            if (displayModeSelect) {
            }
        }

        this.renderFaderGrid();
        document.getElementById('scene-editor-overlay').classList.add('active');
    }

    closeSceneEditor() {
        document.getElementById('scene-editor-overlay').classList.remove('active');
    }

    /**
     * Open simplified editor for control-grid scenes
     */
    openControlGridEditor(sceneId) {
        const scene = this.sceneManager.scenes.get(sceneId);
        if (!scene) return;

        this.currentSceneId = sceneId;

        // Populate form fields
        document.getElementById('control-grid-scene-name').value = scene.name;
        document.getElementById('control-grid-scene-rows').value = scene.rows || 5;
        document.getElementById('control-grid-scene-cols').value = scene.cols || 12;

        // Populate device dropdown
        this.populateControlGridDeviceDropdown(scene.deviceBinding);

        // Show overlay
        document.getElementById('control-grid-scene-editor-overlay').classList.add('active');
    }

    /**
     * Open control-grid scene editor (create new or edit existing)
     */
    openControlGridSceneEditor(sceneId = null) {
        if (sceneId) {
            // Edit existing control-grid scene
            const scene = this.sceneManager.scenes.get(sceneId);
            if (scene && scene.type === 'control-grid') {
                this.currentSceneId = sceneId;

                document.getElementById('control-grid-scene-name').value = scene.name;
                document.getElementById('control-grid-scene-rows').value = scene.rows || 5;
                document.getElementById('control-grid-scene-cols').value = scene.cols || 12;

                this.populateControlGridDeviceDropdown(scene.deviceBinding);

                document.getElementById('control-grid-scene-editor-title').textContent = 'EDIT CONTROL GRID SCENE';
            }
        } else {
            // New control-grid scene
            this.currentSceneId = 'control-grid-' + Date.now();

            document.getElementById('control-grid-scene-name').value = 'Control Grid';
            document.getElementById('control-grid-scene-rows').value = 5;
            document.getElementById('control-grid-scene-cols').value = 12;

            this.populateControlGridDeviceDropdown();

            document.getElementById('control-grid-scene-editor-title').textContent = 'NEW CONTROL GRID SCENE';
        }

        document.getElementById('control-grid-scene-editor-overlay').classList.add('active');
    }

    closeControlGridSceneEditor() {
        document.getElementById('control-grid-scene-editor-overlay').classList.remove('active');
    }

    populateControlGridDeviceDropdown(selectedDeviceId = null) {
        const select = document.getElementById('control-grid-scene-device');
        if (!select) return;

        // Get all available devices
        const devices = this.sceneManager.controller.deviceManager?.getAllDevices() || [];

        // Build options
        select.innerHTML = '<option value="">Default MIDI Output</option>' +
            devices.map(d =>
                `<option value="${d.id}" ${selectedDeviceId === d.id ? 'selected' : ''}>${d.name} (CH ${d.midiChannel + 1})</option>`
            ).join('');
    }

    saveControlGridScene() {
        if (!this.currentSceneId) return;

        const name = document.getElementById('control-grid-scene-name').value.trim();
        const deviceBinding = document.getElementById('control-grid-scene-device').value || null;
        const rows = parseInt(document.getElementById('control-grid-scene-rows').value);
        const cols = parseInt(document.getElementById('control-grid-scene-cols').value);

        if (!name) {
            window.nbDialog.alert('Please enter a scene name');
            return;
        }

        const scene = this.sceneManager.scenes.get(this.currentSceneId);

        if (scene) {
            // Update existing scene
            scene.name = name;
            scene.deviceBinding = deviceBinding;
            scene.rows = rows;
            scene.cols = cols;
        } else {
            // Create new scene
            const sceneConfig = {
                name: name,
                type: 'control-grid',
                rows: rows,
                cols: cols,
                deviceBinding: deviceBinding,
                cells: Array(rows * cols).fill(null),
                render: () => this.sceneManager.renderControlGridScene(this.currentSceneId)
            };

            this.sceneManager.addScene(this.currentSceneId, sceneConfig);
        }

        // Save and refresh
        this.saveScenesToStorage();
        this.sceneManager.switchScene(this.currentSceneId);  // Re-render with new settings

        // Update scene selector
        if (this.sceneManager.controller.settingsUI) {
            this.sceneManager.controller.settingsUI.refreshScenesList();
        }

        // Close editor
        this.closeControlGridSceneEditor();
    }

    deleteControlGridScene() {
        if (!this.currentSceneId) return;

        const scene = this.sceneManager.scenes.get(this.currentSceneId);
        if (!scene) return;

        window.nbDialog.confirm(`Delete scene "${scene.name}"?`, (confirmed) => {
            if (confirmed) {
                this.sceneManager.scenes.delete(this.currentSceneId);
                this.saveScenesToStorage();
                if (this.sceneManager.controller.settingsUI) {
                    this.sceneManager.controller.settingsUI.refreshScenesList();
                }
                this.closeControlGridSceneEditor();
                // Switch to default scene
                this.sceneManager.switchScene('pads');
            }
        });
    }

    renderFaderGrid() {
        const [rows, cols] = this.sceneConfig.layout.split('x').map(Number);
        const totalSlots = rows * cols;
        const grid = document.getElementById('scene-fader-grid');

        // Set grid layout
        grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

        // Ensure faders array is right size
        if (this.sceneConfig.faders.length < totalSlots) {
            this.sceneConfig.faders = [
                ...this.sceneConfig.faders,
                ...Array(totalSlots - this.sceneConfig.faders.length).fill(null)
            ];
        }

        // Render slots
        grid.innerHTML = this.sceneConfig.faders.slice(0, totalSlots).map((fader, index) => {
            const label = this.getFaderLabel(fader);
            return `
                <div class="fader-slot" data-slot="${index}" style="
                    background: ${fader ? '#2a2a2a' : '#1a1a1a'};
                    border: 2px solid ${fader ? '#CF1A37' : '#333'};
                    padding: 12px;
                    border-radius: 4px;
                    cursor: pointer;
                    text-align: center;
                    font-size: 0.75em;
                    color: ${fader ? '#ccc' : '#555'};
                    min-height: 60px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                ">
                    ${label}
                </div>
            `;
        }).join('');

        // Add click handlers
        grid.querySelectorAll('.fader-slot').forEach(slot => {
            slot.addEventListener('click', () => {
                const slotIndex = parseInt(slot.getAttribute('data-slot'));
                this.openFaderEditor(slotIndex);
            });
        });
    }

    getFaderLabel(fader) {
        if (!fader) return 'EMPTY';

        const deviceManager = window.meisterController?.deviceManager;
        let deviceName = 'Default';

        // Get device name from binding
        if (fader.deviceBinding && deviceManager) {
            const device = deviceManager.getDevice(fader.deviceBinding);
            if (device) {
                deviceName = device.name;
            }
        }

        switch(fader.type) {
            case 'MIX':
                return `MIX<br>${fader.label || 'Master'}<br>${deviceName}`;
            case 'INPUT':
                return `INPUT<br>${fader.label || 'Input'}<br>${deviceName}`;
            case 'PROGRAM':
                return `PROG ${fader.program}<br>${fader.label || ''}<br>${deviceName}`;
            case 'CHANNEL':
                return `CH ${fader.channel + 1}<br>${deviceName}`;
            case 'TEMPO':
                return `TEMPO<br>${deviceName}`;
            case 'STEREO':
                return `STEREO<br>${deviceName}`;
            case 'CC_FADER':
                return `${fader.label || 'CC'}<br>CC${fader.cc || 1}<br>${deviceName}`;
            case 'SEQUENCER_TRACK': {
                const seqScene = fader.sequencerScene ? this.sceneManager.scenes.get(fader.sequencerScene) : null;
                const seqName = seqScene ? seqScene.name : 'Unknown';
                return `SEQ TRACK ${fader.sequencerTrack || 1}<br>${seqName}`;
            }
            case 'SEQUENCER_MASTER': {
                const seqScene = fader.sequencerScene ? this.sceneManager.scenes.get(fader.sequencerScene) : null;
                const seqName = seqScene ? seqScene.name : 'Unknown';
                return `SEQ MASTER<br>${seqName}`;
            }
            case 'EMPTY':
                return 'EMPTY';
            default:
                return 'EMPTY';
        }
    }

    openFaderEditor(slotIndex) {
        this.editingSlotIndex = slotIndex;
        const fader = this.sceneConfig.faders[slotIndex];

        // Set title
        document.getElementById('fader-editor-title').textContent = `EDIT SLOT ${slotIndex + 1}`;

        // Populate device binding dropdown
        this.populateDeviceBindings();

        // Populate sequencer scenes dropdown
        this.populateSequencerScenes();

        // Load fader config
        if (fader) {
            document.getElementById('fader-type').value = fader.type;
            document.getElementById('fader-label').value = fader.label || '';
            document.getElementById('fader-channel').value = fader.channel ?? 0;
            document.getElementById('fader-device-binding').value = fader.deviceBinding || '';
            document.getElementById('fader-sequencer-scene').value = fader.sequencerScene || '';
            document.getElementById('fader-sequencer-track').value = fader.sequencerTrack || 1;
            document.getElementById('fader-cc').value = fader.cc || 1;
            document.getElementById('fader-cc-min').value = fader.min ?? 0;
            document.getElementById('fader-cc-max').value = fader.max ?? 127;
        } else {
            document.getElementById('fader-type').value = 'EMPTY';
            document.getElementById('fader-label').value = '';
            document.getElementById('fader-channel').value = 0;
            document.getElementById('fader-device-binding').value = '';
            document.getElementById('fader-sequencer-scene').value = '';
            document.getElementById('fader-sequencer-track').value = 1;
            document.getElementById('fader-cc').value = 1;
            document.getElementById('fader-cc-min').value = 0;
            document.getElementById('fader-cc-max').value = 127;
        }

        this.updateFaderEditorFields(document.getElementById('fader-type').value);
        document.getElementById('fader-editor-overlay').classList.add('active');
    }

    populateDeviceBindings() {
        const select = document.getElementById('fader-device-binding');
        if (!select) return;

        // Get device manager from controller
        const deviceManager = window.meisterController?.deviceManager;
        if (!deviceManager) {
            select.innerHTML = '<option value="">Default Device</option>';
            return;
        }

        const devices = deviceManager.getAllDevices();
        select.innerHTML = '<option value="">Default Device</option>' +
            devices.map(device =>
                `<option value="${device.id}">${device.name} (Ch ${device.midiChannel + 1}, ID ${device.deviceId})</option>`
            ).join('');
    }

    populateSequencerScenes() {
        const select = document.getElementById('fader-sequencer-scene');
        if (!select) return;

        // Get all sequencer scenes
        const sequencerScenes = [];
        this.sceneManager.scenes.forEach((scene, id) => {
            if (scene.type === 'sequencer') {
                sequencerScenes.push({ id, name: scene.name });
            }
        });

        if (sequencerScenes.length === 0) {
            select.innerHTML = '<option value="">-- No Sequencers Found --</option>';
            return;
        }

        select.innerHTML = '<option value="">-- Select Sequencer --</option>' +
            sequencerScenes.map(seq =>
                `<option value="${seq.id}">${seq.name}</option>`
            ).join('');
    }

    closeFaderEditor() {
        document.getElementById('fader-editor-overlay').classList.remove('active');
        this.editingSlotIndex = null;
        this.editingSplitSlotIndex = null;
    }

    updateFaderEditorFields(type) {
        const labelField = document.getElementById('fader-label-field');
        const channelField = document.getElementById('fader-channel-field');
        const programField = document.getElementById('fader-program-field');
        const deviceField = document.getElementById('fader-device-field');
        const sequencerField = document.getElementById('fader-sequencer-field');
        const sequencerTrackField = document.getElementById('fader-sequencer-track-field');
        const ccField = document.getElementById('fader-cc-field');
        const ccMinField = document.getElementById('fader-cc-min-field');
        const ccMaxField = document.getElementById('fader-cc-max-field');

        labelField.style.display = (type === 'MIX' || type === 'INPUT' || type === 'PROGRAM' || type === 'CC_FADER') ? 'block' : 'none';
        channelField.style.display = type === 'CHANNEL' ? 'block' : 'none';
        programField.style.display = type === 'PROGRAM' ? 'block' : 'none';
        deviceField.style.display = (type !== 'EMPTY' && type !== 'SEQUENCER_TRACK' && type !== 'SEQUENCER_MASTER') ? 'block' : 'none';
        sequencerField.style.display = (type === 'SEQUENCER_TRACK' || type === 'SEQUENCER_MASTER') ? 'block' : 'none';
        sequencerTrackField.style.display = (type === 'SEQUENCER_TRACK') ? 'block' : 'none';
        ccField.style.display = type === 'CC_FADER' ? 'block' : 'none';
        ccMinField.style.display = type === 'CC_FADER' ? 'block' : 'none';
        ccMaxField.style.display = type === 'CC_FADER' ? 'block' : 'none';
    }

    saveFader() {
        if (this.editingSlotIndex === null) return;

        const type = document.getElementById('fader-type').value;

        if (type === 'EMPTY') {
            this.sceneConfig.faders[this.editingSlotIndex] = null;
        } else {
            const deviceBinding = document.getElementById('fader-device-binding').value;
            const fader = {
                type: type,
                deviceBinding: deviceBinding || null
            };

            if (type === 'MIX') {
                fader.label = document.getElementById('fader-label').value || 'Master';
            } else if (type === 'INPUT') {
                fader.label = document.getElementById('fader-label').value || 'Input';
            } else if (type === 'CHANNEL') {
                fader.channel = parseInt(document.getElementById('fader-channel').value) || 0;
            } else if (type === 'PROGRAM') {
                fader.program = parseInt(document.getElementById('fader-program').value) || 0;
                fader.label = document.getElementById('fader-label').value || 'PROG ' + fader.program;
                fader.channel = parseInt(document.getElementById('fader-channel').value) || 0;
            } else if (type === 'CC_FADER') {
                fader.label = document.getElementById('fader-label').value || 'CC';
                fader.cc = parseInt(document.getElementById('fader-cc').value) || 1;
                fader.min = parseInt(document.getElementById('fader-cc-min').value) || 0;
                fader.max = parseInt(document.getElementById('fader-cc-max').value) || 127;
                fader.value = 64; // Default value
            } else if (type === 'SEQUENCER_TRACK') {
                fader.sequencerScene = document.getElementById('fader-sequencer-scene').value;
                fader.sequencerTrack = parseInt(document.getElementById('fader-sequencer-track').value) || 1;
                delete fader.deviceBinding; // Sequencers don't use device binding
            } else if (type === 'SEQUENCER_MASTER') {
                fader.sequencerScene = document.getElementById('fader-sequencer-scene').value;
                delete fader.deviceBinding; // Sequencers don't use device binding
            }
            // TEMPO and STEREO don't need additional fields

            this.sceneConfig.faders[this.editingSlotIndex] = fader;
        }

        this.renderFaderGrid();
        this.closeFaderEditor();
    }

    clearFader() {
        // Handle split scene faders
        if (this.editingSplitSlotIndex !== null && this.editingSplitSlotIndex !== undefined) {
            this.splitFaderSlots[this.editingSplitSlotIndex] = { type: 'EMPTY' };
            this.renderSplitFaderGrid();
            this.closeFaderEditor();
            return;
        }

        // Handle mixer scene faders
        if (this.editingSlotIndex === null) return;
        this.sceneConfig.faders[this.editingSlotIndex] = null;
        this.renderFaderGrid();
        this.closeFaderEditor();
    }

    saveScene() {
        const name = document.getElementById('scene-name').value.trim();
        if (!name) {
            window.nbDialog.alert('Please enter a scene name');
            return;
        }

        this.sceneConfig.name = name;
        const [rows, cols] = this.sceneConfig.layout.split('x').map(Number);

        // Get polling interval from slider
        const pollingInterval = parseInt(document.getElementById('scene-polling-interval').value);

        // console.log(`[SceneEditor] Saving scene "${name}" with ${rows}x${cols} layout, ${pollingInterval}ms polling`);
        // console.log(`[SceneEditor] Faders:`, this.sceneConfig.faders);

        // Collect all device IDs from faders for polling
        const deviceIds = new Set();
        this.sceneConfig.faders.forEach(fader => {
            if (fader && fader.deviceBinding) {
                const deviceManager = this.sceneManager.controller.deviceManager;
                if (deviceManager) {
                    const device = deviceManager.getDevice(fader.deviceBinding);
                    if (device) {
                        deviceIds.add(device.deviceId);
                    }
                }
            }
        });

        // Create scene config with slots (new format)
        const sceneConfig = {
            name: this.sceneConfig.name,
            type: 'slider',
            rows: rows,
            columnsPerRow: cols,
            slots: this.sceneConfig.faders.slice(0, rows * cols), // Include all slots (even nulls/empty)
            pollDevices: Array.from(deviceIds),
            pollInterval: pollingInterval,
            render: () => this.sceneManager.renderSliderScene(this.currentSceneId) // Add render function!
        };

        // console.log(`[SceneEditor] Scene config:`, sceneConfig);

        // Add scene to scene manager
        this.sceneManager.addScene(this.currentSceneId, sceneConfig);

        // Save to localStorage
        this.saveScenesToStorage();

        // Refresh scenes list in settings panel
        if (this.sceneManager.controller.settingsUI) {
            this.sceneManager.controller.settingsUI.refreshScenesList();
        }

        // If we're currently viewing this scene, re-render it
        if (this.sceneManager.currentScene === this.currentSceneId) {
            // console.log(`[SceneEditor] Re-rendering current scene: ${this.currentSceneId}`);
            this.sceneManager.switchScene(this.currentSceneId);
        }

        this.closeSceneEditor();
    }

    deleteScene() {
        if (!this.currentSceneId || this.currentSceneId === 'pads' || this.currentSceneId === 'mixer') {
            window.nbDialog.alert('Cannot delete built-in scenes');
            return;
        }

        window.nbDialog.confirm(`Delete scene "${this.sceneConfig.name}"?`, (confirmed) => {
            if (confirmed) {
                this.sceneManager.scenes.delete(this.currentSceneId);
                this.saveScenesToStorage();
                if (this.sceneManager.controller.settingsUI) {
                    this.sceneManager.controller.settingsUI.refreshScenesList();
                }
                this.closeSceneEditor();
            }
        });
    }

    openPadSceneEditor(sceneId = null) {
        if (sceneId) {
            // Edit existing pad scene (including built-in 'pads')
            const scene = this.sceneManager.scenes.get(sceneId);
            if (scene && scene.type === 'grid') {
                this.currentSceneId = sceneId;
                this.padSceneConfig.name = scene.name;
                // For built-in pads scene, get layout from controller config
                const isBuiltInPads = sceneId === 'pads';
                this.padSceneConfig.layout = scene.layout || (isBuiltInPads ? this.sceneManager.controller.config.gridLayout : '4x4');
                this.padSceneConfig.pollInterval = scene.pollInterval || 250;
                this.padSceneConfig.pollDevices = scene.pollDevices || [];

                document.getElementById('pad-scene-name').value = scene.name;
                document.getElementById('pad-scene-layout').value = this.padSceneConfig.layout;

                // Set polling interval
                const pollingSlider = document.getElementById('pad-scene-polling-interval');
                if (pollingSlider) {
                    pollingSlider.value = this.padSceneConfig.pollInterval;
                    document.getElementById('pad-scene-polling-interval-value').textContent = this.padSceneConfig.pollInterval + 'ms';
                }

                document.getElementById('pad-scene-editor-title').textContent = 'EDIT PAD SCENE';
            }
        } else {
            // New pad scene
            this.currentSceneId = 'custom-pads-' + Date.now();
            this.padSceneConfig = {
                name: 'Custom Pads',
                layout: '4x4',
                pollDevices: [],
                pollInterval: 250
            };
            document.getElementById('pad-scene-name').value = this.padSceneConfig.name;
            document.getElementById('pad-scene-layout').value = this.padSceneConfig.layout;

            // Set default polling interval
            const pollingSlider = document.getElementById('pad-scene-polling-interval');
            if (pollingSlider) {
                pollingSlider.value = 250;
                document.getElementById('pad-scene-polling-interval-value').textContent = '250ms';
            }

            document.getElementById('pad-scene-editor-title').textContent = 'NEW PAD SCENE';
        }

        document.getElementById('pad-scene-editor-overlay').classList.add('active');
    }

    closePadSceneEditor() {
        document.getElementById('pad-scene-editor-overlay').classList.remove('active');
    }

    /**
     * Open effects scene editor
     */
    openEffectsSceneEditor(sceneId = null) {
        // Populate device dropdown
        this.populateEffectsDeviceDropdown();

        // Populate Samplecrate program dropdown (1-31, wire: 0-30)
        const programSelect = document.getElementById('effects-scene-program-select');
        if (programSelect) {
            programSelect.innerHTML = '';
            for (let i = 1; i <= 31; i++) {
                const option = document.createElement('option');
                option.value = i - 1; // Wire value (0-30)
                option.textContent = `Program ${i}`; // Display value (1-31)
                programSelect.appendChild(option);
            }
        }

        // Setup radio button listeners
        const regrooveRadio = document.getElementById('effects-target-regroove');
        const samplecrateRadio = document.getElementById('effects-target-samplecrate');
        const samplecrateSelector = document.getElementById('samplecrate-program-selector');

        const toggleProgramSelector = () => {
            if (samplecrateRadio.checked) {
                samplecrateSelector.style.display = 'block';
            } else {
                samplecrateSelector.style.display = 'none';
            }
        };

        regrooveRadio.addEventListener('change', toggleProgramSelector);
        samplecrateRadio.addEventListener('change', toggleProgramSelector);

        if (sceneId) {
            // Edit existing effects scene
            const scene = this.sceneManager.scenes.get(sceneId);
            if (scene && scene.type === 'effects') {
                this.currentSceneId = sceneId;

                document.getElementById('effects-scene-name').value = scene.name;
                document.getElementById('effects-scene-device').value = scene.deviceBinding || '';

                // Set radio button based on programId
                const programId = scene.programId || 0;
                if (programId === 0) {
                    regrooveRadio.checked = true;
                } else {
                    samplecrateRadio.checked = true;
                    programSelect.value = programId;
                }
                toggleProgramSelector();

                // Set polling interval
                const pollingSlider = document.getElementById('effects-scene-polling-interval');
                if (pollingSlider) {
                    pollingSlider.value = scene.pollInterval || 250;
                    document.getElementById('effects-scene-polling-interval-value').textContent = (scene.pollInterval || 250) + 'ms';
                }

                document.getElementById('effects-scene-editor-title').textContent = sceneId === 'effects' ? 'EDIT EFFECTS SCENE' : 'EDIT CUSTOM EFFECTS';
            }
        } else {
            // New effects scene
            this.currentSceneId = 'custom-effects-' + Date.now();

            document.getElementById('effects-scene-name').value = 'Custom Effects';
            document.getElementById('effects-scene-device').value = '';
            regrooveRadio.checked = true;
            toggleProgramSelector();

            // Set default polling interval
            const pollingSlider = document.getElementById('effects-scene-polling-interval');
            if (pollingSlider) {
                pollingSlider.value = 250;
                document.getElementById('effects-scene-polling-interval-value').textContent = '250ms';
            }

            document.getElementById('effects-scene-editor-title').textContent = 'NEW EFFECTS SCENE';
        }

        document.getElementById('effects-scene-editor-overlay').classList.add('active');
    }

    closeEffectsSceneEditor() {
        document.getElementById('effects-scene-editor-overlay').classList.remove('active');
    }

    populateEffectsDeviceDropdown() {
        const select = document.getElementById('effects-scene-device');
        if (!select) return;

        select.innerHTML = '<option value="">-- Select Device --</option>';

        if (this.sceneManager.controller.deviceManager) {
            const devices = this.sceneManager.controller.deviceManager.getAllDevices();
            devices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.id;
                option.textContent = `${device.name} (Ch ${device.midiChannel + 1}, ID ${device.deviceId})`;
                select.appendChild(option);
            });
        }
    }

    saveEffectsScene() {
        const name = document.getElementById('effects-scene-name').value.trim();
        const deviceBinding = document.getElementById('effects-scene-device').value;
        const pollingInterval = parseInt(document.getElementById('effects-scene-polling-interval').value) || 250;

        // Determine programId from radio buttons
        const isRegroove = document.getElementById('effects-target-regroove').checked;
        let programId = 0;
        if (!isRegroove) {
            // Samplecrate: read from dropdown (already 0-based)
            programId = parseInt(document.getElementById('effects-scene-program-select').value) || 0;
        }

        if (!name) {
            window.nbDialog.alert('Please enter a scene name');
            return;
        }

        if (!deviceBinding) {
            window.nbDialog.alert('Please select a device');
            return;
        }

        // Get device ID for polling
        let deviceId = 0;
        if (this.sceneManager.controller.deviceManager) {
            const device = this.sceneManager.controller.deviceManager.getDevice(deviceBinding);
            if (device) {
                deviceId = device.deviceId;
            }
        }

        // Save scene
        this.sceneManager.addScene(this.currentSceneId, {
            name: name,
            type: 'effects',
            deviceBinding: deviceBinding,
            programId: programId,
            pollDevices: [deviceId],
            pollInterval: pollingInterval
        });

        // console.log(`[SceneEditor] Saved effects scene: ${name} (device: ${deviceBinding}, program: ${programId})`);

        // Save to localStorage
        this.saveScenesToStorage();

        // Refresh scenes list in settings panel
        if (this.sceneManager.controller.settingsUI) {
            this.sceneManager.controller.settingsUI.refreshScenesList();
        }

        // Close editor
        this.closeEffectsSceneEditor();

        // Switch to the scene
        this.sceneManager.switchScene(this.currentSceneId);
    }

    deleteEffectsScene() {
        if (this.currentSceneId === 'effects') {
            window.nbDialog.alert('Cannot delete the built-in effects scene');
            return;
        }

        window.nbDialog.confirm('Are you sure you want to delete this effects scene?', (confirmed) => {
            if (!confirmed) return;
            this.sceneManager.scenes.delete(this.currentSceneId);
            this.saveScenesToStorage();
            if (this.sceneManager.controller.settingsUI) {
                this.sceneManager.controller.settingsUI.refreshScenesList();
            }
            this.closeEffectsSceneEditor();
        });

        // console.log(`[SceneEditor] Deleted effects scene: ${this.currentSceneId}`);
    }

    savePadScene() {
        const name = document.getElementById('pad-scene-name').value.trim();
        if (!name) {
            window.nbDialog.alert('Please enter a scene name');
            return;
        }

        const layout = document.getElementById('pad-scene-layout').value;
        const pollingInterval = parseInt(document.getElementById('pad-scene-polling-interval').value);

        this.padSceneConfig.name = name;
        this.padSceneConfig.layout = layout;
        this.padSceneConfig.pollInterval = pollingInterval;

        // console.log(`[SceneEditor] Saving pad scene "${name}" with ${layout} layout, ${pollingInterval}ms polling`);

        // Get existing scene if editing, to preserve pads
        const existingScene = this.sceneManager.scenes.get(this.currentSceneId);

        // Calculate grid size
        const [rows, cols] = layout.split('x').map(Number);
        const gridSize = rows * cols;

        // Preserve existing pads array or initialize with correct size
        const pads = existingScene?.pads || Array(gridSize).fill(null);

        // Ensure pads array is the right size for new layout
        if (pads.length !== gridSize) {
            pads.length = gridSize;
            pads.fill(null, existingScene?.pads?.length || 0);
        }

        // Auto-detect which devices to poll based on pad deviceBindings
        const pollDevices = new Set();
        if (pads) {
            pads.forEach(pad => {
                if (pad && pad.deviceBinding) {
                    pollDevices.add(pad.deviceBinding);
                }
            });
        }

        // Create scene config for grid type
        const sceneConfig = {
            name: this.padSceneConfig.name,
            type: 'grid',
            layout: this.padSceneConfig.layout,
            pads: pads,
            pollDevices: Array.from(pollDevices),
            pollInterval: pollingInterval
        };

        // console.log(`[SceneEditor] Pad scene config:`, sceneConfig);

        // Add scene to scene manager
        this.sceneManager.addScene(this.currentSceneId, sceneConfig);

        // For built-in pads scene, also update controller config so createPads() uses correct layout
        if (this.currentSceneId === 'pads') {
            this.sceneManager.controller.config.gridLayout = layout;
            this.sceneManager.controller.saveConfig();
        }

        // Save to localStorage
        this.saveScenesToStorage();

        // Refresh scenes list in settings panel
        if (this.sceneManager.controller.settingsUI) {
            this.sceneManager.controller.settingsUI.refreshScenesList();
        }

        // If we're currently viewing this scene, re-render it
        if (this.sceneManager.currentScene === this.currentSceneId) {
            // console.log(`[SceneEditor] Re-rendering current scene: ${this.currentSceneId}`);
            this.sceneManager.switchScene(this.currentSceneId);
        }

        this.closePadSceneEditor();
    }

    deletePadScene() {
        if (!this.currentSceneId || this.currentSceneId === 'pads') {
            window.nbDialog.alert('Cannot delete the built-in pads scene');
            return;
        }

        window.nbDialog.confirm(`Delete pad scene "${this.padSceneConfig.name}"?`, (confirmed) => {
            if (confirmed) {
                this.sceneManager.scenes.delete(this.currentSceneId);
                this.saveScenesToStorage();
                if (this.sceneManager.controller.settingsUI) {
                    this.sceneManager.controller.settingsUI.refreshScenesList();
                }
                this.closePadSceneEditor();
            }
        });
    }

    /**
     * Open piano scene editor
     */
    openPianoSceneEditor(sceneId = null) {
        // Populate device dropdown
        this.populatePianoDeviceDropdown();

        if (sceneId) {
            // Edit existing piano scene
            const scene = this.sceneManager.scenes.get(sceneId);
            if (scene && scene.type === 'piano') {
                this.currentSceneId = sceneId;

                document.getElementById('piano-scene-name').value = scene.name;
                document.getElementById('piano-scene-device').value = scene.deviceBinding || '';
                document.getElementById('piano-scene-channel').value = scene.midiChannel !== undefined ? scene.midiChannel : 0;
                document.getElementById('piano-scene-octave').value = scene.octave !== undefined ? scene.octave : 4;
                document.getElementById('piano-scene-program').value = scene.program !== undefined ? scene.program : -1;

                document.getElementById('piano-scene-editor-title').textContent = sceneId === 'piano' ? 'EDIT PIANO SCENE' : 'EDIT CUSTOM PIANO';
            }
        } else {
            // New piano scene
            this.currentSceneId = 'custom-piano-' + Date.now();

            document.getElementById('piano-scene-name').value = 'Custom Piano';
            document.getElementById('piano-scene-device').value = '';
            document.getElementById('piano-scene-channel').value = 0;
            document.getElementById('piano-scene-octave').value = 4;
            document.getElementById('piano-scene-program').value = -1;

            document.getElementById('piano-scene-editor-title').textContent = 'NEW PIANO SCENE';
        }

        document.getElementById('piano-scene-editor-overlay').classList.add('active');
    }

    populatePianoDeviceDropdown() {
        const select = document.getElementById('piano-scene-device');
        if (!select) return;

        select.innerHTML = '<option value="">Default Device</option>';

        if (this.sceneManager.controller.deviceManager) {
            const devices = this.sceneManager.controller.deviceManager.getAllDevices();
            devices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.id;
                option.textContent = `${device.name} (Ch ${device.midiChannel + 1}, ID ${device.deviceId})`;
                select.appendChild(option);
            });
        }

        // Populate program dropdown (0-127 + "No Program Change")
        const programSelect = document.getElementById('piano-scene-program');
        if (programSelect) {
            programSelect.innerHTML = '<option value="-1">No Program Change</option>';
            for (let i = 0; i <= 127; i++) {
                const option = document.createElement('option');
                option.value = i;
                option.textContent = `Program ${i + 1}`; // Display as 1-128 (user-facing)
                programSelect.appendChild(option);
            }
        }
    }

    /**
     * Open split scene editor (pads + sliders)
     */
    openSplitSceneEditor(sceneId = null) {
        this.currentSceneId = sceneId;

        if (sceneId) {
            // Edit existing split scene
            const scene = this.sceneManager.scenes.get(sceneId);
            if (scene && scene.type === 'split') {
                document.getElementById('split-scene-name').value = scene.name;
                document.getElementById('split-scene-pad-layout').value = scene.padLayout || '4x4';
                document.getElementById('split-scene-pad-side').value = scene.padSide || 'left';

                // Set polling interval
                const pollingInterval = scene.pollInterval || 250;
                const slider = document.getElementById('split-scene-polling-interval');
                if (slider) {
                    slider.value = pollingInterval;
                    document.getElementById('split-scene-polling-interval-value').textContent = pollingInterval + 'ms';
                }

                // Load existing fader slots
                this.splitFaderSlots = scene.slots || this.getDefaultSplitFaders(5);

                document.getElementById('split-scene-editor-title').textContent = 'EDIT SPLIT SCENE';
            }
        } else {
            // New split scene - default 5 faders
            this.currentSceneId = 'custom-split-' + Date.now();

            document.getElementById('split-scene-name').value = 'Split Scene';
            document.getElementById('split-scene-pad-layout').value = '4x4';
            document.getElementById('split-scene-pad-side').value = 'left';

            // Set default polling interval
            const slider = document.getElementById('split-scene-polling-interval');
            if (slider) {
                slider.value = 250;
                document.getElementById('split-scene-polling-interval-value').textContent = '250ms';
            }

            // Initialize with default faders
            this.splitFaderSlots = this.getDefaultSplitFaders(5);

            document.getElementById('split-scene-editor-title').textContent = 'NEW SPLIT SCENE';
        }

        // Render fader configuration grid
        this.renderSplitFaderGrid();

        document.getElementById('split-scene-editor-overlay').classList.add('active');
    }

    getDefaultSplitFaders(count) {
        const slots = [];
        for (let i = 0; i < count - 1; i++) {
            slots.push({ type: 'CHANNEL', channel: i, deviceBinding: null });
        }
        // Last fader is Master
        slots.push({ type: 'MIX', label: 'Master', deviceBinding: null });
        return slots;
    }

    renderSplitFaderGrid() {
        const grid = document.getElementById('split-fader-grid');
        if (!grid) return;

        grid.innerHTML = this.splitFaderSlots.map((fader, index) => {
            const label = this.getFaderLabel(fader);
            return `
                <div class="fader-slot" data-slot="${index}" style="
                    background: ${fader ? '#2a2a2a' : '#1a1a1a'};
                    border: 2px solid ${fader ? '#CF1A37' : '#333'};
                    padding: 12px;
                    border-radius: 4px;
                    cursor: pointer;
                    text-align: center;
                    font-size: 0.75em;
                    color: ${fader ? '#ccc' : '#555'};
                    min-width: 80px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 50px;
                    user-select: none;
                    -webkit-user-select: none;
                ">
                    ${label}
                </div>
            `;
        }).join('') + `
            <div class="fader-slot-add" style="
                background: #1a3a1a;
                border: 2px dashed #3a5a3a;
                padding: 12px;
                border-radius: 4px;
                cursor: pointer;
                text-align: center;
                font-size: 0.75em;
                color: #5a9a5a;
                min-width: 80px;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 50px;
                user-select: none;
                -webkit-user-select: none;
            ">
                + ADD
            </div>
        `;

        // Add click handlers
        grid.querySelectorAll('.fader-slot').forEach(slot => {
            slot.addEventListener('click', () => {
                const slotIndex = parseInt(slot.getAttribute('data-slot'));
                this.openSplitFaderEditor(slotIndex);
            });
        });

        // Add handler for add button
        grid.querySelector('.fader-slot-add')?.addEventListener('click', () => {
            this.splitFaderSlots.push({ type: 'EMPTY' });
            this.renderSplitFaderGrid();
        });
    }

    openSplitFaderEditor(slotIndex) {
        this.editingSplitSlotIndex = slotIndex;
        const fader = this.splitFaderSlots[slotIndex];

        // Set title
        document.getElementById('fader-editor-title').textContent = `EDIT FADER ${slotIndex + 1}`;

        // Populate device binding dropdown
        this.populateDeviceBindings();

        // Populate sequencer scenes dropdown
        this.populateSequencerScenes();

        // Load fader config
        if (fader) {
            document.getElementById('fader-type').value = fader.type;
            document.getElementById('fader-label').value = fader.label || '';
            document.getElementById('fader-channel').value = fader.channel ?? 0;
            document.getElementById('fader-program').value = fader.program ?? 0;
            document.getElementById('fader-device-binding').value = fader.deviceBinding || '';
            document.getElementById('fader-sequencer-scene').value = fader.sequencerScene || '';
            document.getElementById('fader-sequencer-track').value = fader.sequencerTrack || 1;
            document.getElementById('fader-cc').value = fader.cc || 1;
            document.getElementById('fader-cc-min').value = fader.min ?? 0;
            document.getElementById('fader-cc-max').value = fader.max ?? 127;
        } else {
            document.getElementById('fader-type').value = 'EMPTY';
            document.getElementById('fader-label').value = '';
            document.getElementById('fader-channel').value = 0;
            document.getElementById('fader-program').value = 0;
            document.getElementById('fader-device-binding').value = '';
            document.getElementById('fader-sequencer-scene').value = '';
            document.getElementById('fader-sequencer-track').value = 1;
            document.getElementById('fader-cc').value = 1;
            document.getElementById('fader-cc-min').value = 0;
            document.getElementById('fader-cc-max').value = 127;
        }

        this.updateFaderEditorFields(fader?.type || 'EMPTY');
        document.getElementById('fader-editor-overlay').classList.add('active');
    }

    saveSplitFader() {
        if (this.editingSplitSlotIndex === null) return;

        const type = document.getElementById('fader-type').value;

        if (type === 'EMPTY') {
            this.splitFaderSlots[this.editingSplitSlotIndex] = { type: 'EMPTY' };
        } else {
            const deviceBinding = document.getElementById('fader-device-binding').value;
            const fader = {
                type: type,
                deviceBinding: deviceBinding || null
            };

            if (type === 'MIX') {
                fader.label = document.getElementById('fader-label').value || 'Master';
            } else if (type === 'INPUT') {
                fader.label = document.getElementById('fader-label').value || 'Input';
            } else if (type === 'CHANNEL') {
                fader.channel = parseInt(document.getElementById('fader-channel').value) || 0;
            } else if (type === 'PROGRAM') {
                fader.program = parseInt(document.getElementById('fader-program').value) || 0;
                fader.label = document.getElementById('fader-label').value || 'PROG ' + fader.program;
            } else if (type === 'CC_FADER') {
                fader.label = document.getElementById('fader-label').value || 'CC';
                fader.cc = parseInt(document.getElementById('fader-cc').value) || 1;
                fader.min = parseInt(document.getElementById('fader-cc-min').value) || 0;
                fader.max = parseInt(document.getElementById('fader-cc-max').value) || 127;
                fader.value = 64; // Default value
            } else if (type === 'SEQUENCER_TRACK') {
                fader.sequencerScene = document.getElementById('fader-sequencer-scene').value;
                fader.sequencerTrack = parseInt(document.getElementById('fader-sequencer-track').value) || 1;
                delete fader.deviceBinding;
            } else if (type === 'SEQUENCER_MASTER') {
                fader.sequencerScene = document.getElementById('fader-sequencer-scene').value;
                delete fader.deviceBinding;
            }

            this.splitFaderSlots[this.editingSplitSlotIndex] = fader;
        }

        this.renderSplitFaderGrid();
        this.closeFaderEditor();
    }

    closeSplitSceneEditor() {
        document.getElementById('split-scene-editor-overlay').classList.remove('active');
    }

    saveSplitScene() {
        const name = document.getElementById('split-scene-name').value.trim();
        if (!name) {
            window.nbDialog.alert('Please enter a scene name');
            return;
        }

        const padLayout = document.getElementById('split-scene-pad-layout').value;
        const padSide = document.getElementById('split-scene-pad-side').value;
        const pollInterval = parseInt(document.getElementById('split-scene-polling-interval').value) || 250;

        // Get existing scene to preserve pads
        const existingScene = this.sceneManager.scenes.get(this.currentSceneId);
        const existingPads = existingScene?.pads || [];

        // Filter out EMPTY fader slots
        const slots = this.splitFaderSlots.filter(slot => slot && slot.type !== 'EMPTY');

        if (slots.length === 0) {
            window.nbDialog.alert('Please configure at least one fader');
            return;
        }

        // Capture sceneId in closure for render function
        const sceneId = this.currentSceneId;

        // Create scene config
        const sceneConfig = {
            name: name,
            type: 'split',
            padLayout: padLayout,
            padSide: padSide,
            pads: existingPads, // Preserve existing pad configurations
            slots: slots, // Use configured faders
            pollDevices: [0],
            pollInterval: pollInterval,
            render: () => this.sceneManager.renderSplitScene(sceneId)
        };

        // Add scene to scene manager
        this.sceneManager.addScene(sceneId, sceneConfig);

        // Save to localStorage
        this.saveScenesToStorage();

        // Refresh scenes list
        if (this.sceneManager.controller.settingsUI) {
            this.sceneManager.controller.settingsUI.refreshScenesList();
        }
        if (this.sceneManager.controller.settingsUI) {
            this.sceneManager.controller.settingsUI.refreshScenesList();
        }

        // Close editor and switch to scene
        this.closeSplitSceneEditor();
        this.sceneManager.switchScene(this.currentSceneId);
    }

    deleteSplitScene() {
        if (!this.currentSceneId) return;

        const scene = this.sceneManager.scenes.get(this.currentSceneId);
        if (!scene) return;

        window.nbDialog.confirm(`Delete split scene "${scene.name}"?`, (confirmed) => {
            if (confirmed) {
                this.sceneManager.scenes.delete(this.currentSceneId);
                this.saveScenesToStorage();
                if (this.sceneManager.controller.settingsUI) {
                    this.sceneManager.controller.settingsUI.refreshScenesList();
                }
                if (this.sceneManager.controller.settingsUI) {
                    this.sceneManager.controller.settingsUI.refreshScenesList();
                }
                this.closeSplitSceneEditor();
            }
        });
    }

    closePianoSceneEditor() {
        document.getElementById('piano-scene-editor-overlay').classList.remove('active');
    }

    savePianoScene() {
        const name = document.getElementById('piano-scene-name').value.trim();
        const deviceBinding = document.getElementById('piano-scene-device').value || null;
        const midiChannel = parseInt(document.getElementById('piano-scene-channel').value) || 0;
        const octave = parseInt(document.getElementById('piano-scene-octave').value) || 4;
        const program = parseInt(document.getElementById('piano-scene-program').value);

        if (!name) {
            window.nbDialog.alert('Please enter a scene name');
            return;
        }

        // Save scene
        this.sceneManager.addScene(this.currentSceneId, {
            name: name,
            type: 'piano',
            octave: octave,
            midiChannel: midiChannel,
            deviceBinding: deviceBinding,
            program: program
        });

        // Save to localStorage
        this.saveScenesToStorage();

        // Refresh scenes list
        if (this.sceneManager.controller.settingsUI) {
            this.sceneManager.controller.settingsUI.refreshScenesList();
        }

        // Close editor
        this.closePianoSceneEditor();

        // Switch to the scene
        this.sceneManager.switchScene(this.currentSceneId);
    }

    deletePianoScene() {
        if (this.currentSceneId === 'piano') {
            window.nbDialog.alert('Cannot delete the built-in piano scene');
            return;
        }

        window.nbDialog.confirm('Are you sure you want to delete this piano scene?', (confirmed) => {
            if (!confirmed) return;
            this.sceneManager.scenes.delete(this.currentSceneId);
            this.saveScenesToStorage();
            if (this.sceneManager.controller.settingsUI) {
                this.sceneManager.controller.settingsUI.refreshScenesList();
            }
            this.closePianoSceneEditor();
        });
    }

    saveScenesToStorage() {
        const scenes = {};
        this.sceneManager.scenes.forEach((scene, id) => {
            // Save all scenes (pads and mixer can now be saved)
            scenes[id] = {
                name: scene.name,
                type: scene.type,
                enabled: scene.enabled !== undefined ? scene.enabled : true, // Save enabled state
                rows: scene.rows,
                cols: scene.cols, // For control-grid scenes
                columnsPerRow: scene.columnsPerRow,
                slots: scene.slots,
                columns: scene.columns, // Keep for backward compatibility
                pollDevices: scene.pollDevices,
                pollInterval: scene.pollInterval,
                layout: scene.layout, // For grid-type scenes
                octave: scene.octave, // For piano scenes
                midiChannel: scene.midiChannel, // For piano scenes (also for fire-sequencer in compatible mode)
                program: scene.program, // For piano scenes
                deviceBinding: scene.deviceBinding, // For effects, piano, control-grid, and fire-sequencer scenes
                programId: scene.programId, // For effects scenes
                padLayout: scene.padLayout, // For split scenes
                padSide: scene.padSide, // For split scenes
                pads: scene.pads, // For split scenes (and custom pad scenes)
                linkedSequencer: scene.linkedSequencer, // For fire-sequencer scenes
                midiInputDevice: scene.midiInputDevice, // For fire-sequencer scenes (device ID from Devices Tab)
                renderMode: scene.renderMode, // For fire-sequencer scenes
                persistent: scene.persistent, // For fire-sequencer scenes (stay active in background)
                tracks: scene.tracks, // For fire-sequencer scenes
                stepsPerTrack: scene.stepsPerTrack, // For fire-sequencer scenes
                engine: scene.sequencerInstance ? scene.sequencerInstance.engine.toJSON() : scene.engine // For sequencer scenes
            };
        });

        localStorage.setItem('meisterScenes', JSON.stringify(scenes));
    }

    loadScenesFromStorage() {
        try {
            const saved = localStorage.getItem('meisterScenes');
            // console.log('[SceneEditor] Loading scenes from localStorage:', saved ? 'Found' : 'Not found');
            if (saved) {
                const scenes = JSON.parse(saved);
                // console.log('[SceneEditor] Parsed scenes:', Object.keys(scenes));

                // Load saved scenes BEFORE registering defaults
                // This allows saved mixer scene to override the default
                Object.entries(scenes).forEach(([id, config]) => {
                    // console.log(`[SceneEditor] Loading saved scene: ${id}, type: ${config.type}, linkedSequencer: ${config.linkedSequencer}`);
                    this.sceneManager.addScene(id, config);
                });

                // Re-register defaults with loadSaved=true to skip mixer if saved
                this.sceneManager.registerDefaultScenes(true);

                // Initialize any sequencer instances that were loaded
                this.sceneManager.initializeSequencerInstances();
            } else {
                // console.log('[SceneEditor] No scenes in localStorage');
            }
        } catch (e) {
            console.error('Failed to load scenes from storage:', e);
        }

        // Refresh the scenes list UI
        if (this.sceneManager.controller.settingsUI) {
            this.sceneManager.controller.settingsUI.refreshScenesList();
        }
    }

    /**
     * Get custom scenes for export (includes pads and mixer)
     */
    getCustomScenes() {
        const scenes = {};
        this.sceneManager.scenes.forEach((scene, id) => {
            // Export all scenes (pads and mixer can now be exported)
            scenes[id] = {
                name: scene.name,
                type: scene.type,
                enabled: scene.enabled !== undefined ? scene.enabled : true,
                rows: scene.rows,
                columns: scene.columns,
                slots: scene.slots,
                columnsPerRow: scene.columnsPerRow,
                pollDevices: scene.pollDevices,
                pollInterval: scene.pollInterval,
                layout: scene.layout, // For grid-type scenes
                octave: scene.octave, // For piano scenes
                midiChannel: scene.midiChannel, // For piano scenes (also for fire-sequencer in compatible mode)
                program: scene.program, // For piano scenes
                deviceBinding: scene.deviceBinding, // For effects, piano, and fire-sequencer scenes
                programId: scene.programId, // For effects scenes
                padLayout: scene.padLayout, // For split scenes
                padSide: scene.padSide, // For split scenes
                pads: scene.pads, // For split scenes (and custom pad scenes)
                linkedSequencer: scene.linkedSequencer, // For fire-sequencer scenes
                midiInputDevice: scene.midiInputDevice, // For fire-sequencer scenes (device ID from Devices Tab)
                persistent: scene.persistent, // For fire-sequencer scenes (stay active in background)
                tracks: scene.tracks, // For fire-sequencer scenes
                stepsPerTrack: scene.stepsPerTrack // For fire-sequencer scenes
            };
        });
        return scenes;
    }

    /**
     * Load custom scenes from imported config
     */
    loadCustomScenes(scenes) {
        if (!scenes || typeof scenes !== 'object') return;

        Object.entries(scenes).forEach(([id, config]) => {
            this.sceneManager.addScene(id, config);
        });

        // Initialize any sequencer instances that were just loaded
        this.sceneManager.initializeSequencerInstances();

        // Save to localStorage
        this.saveScenesToStorage();

        // Refresh the scenes list UI
        if (this.sceneManager.controller.settingsUI) {
            this.sceneManager.controller.settingsUI.refreshScenesList();
        }
    }

    /**
     * Apply a template to the current scene being edited
     */
    applyTemplate(templateType) {
        let layout, slots;

        switch (templateType) {
            case '1x10':
                layout = '1x10';
                slots = [
                    { type: 'CHANNEL', channel: 0, deviceBinding: null },
                    { type: 'CHANNEL', channel: 1, deviceBinding: null },
                    { type: 'CHANNEL', channel: 2, deviceBinding: null },
                    { type: 'CHANNEL', channel: 3, deviceBinding: null },
                    { type: 'CHANNEL', channel: 4, deviceBinding: null },
                    { type: 'CHANNEL', channel: 5, deviceBinding: null },
                    { type: 'CHANNEL', channel: 6, deviceBinding: null },
                    { type: 'CHANNEL', channel: 7, deviceBinding: null },
                    { type: 'MIX', label: 'Master', deviceBinding: null },
                    { type: 'TEMPO', label: 'BPM', deviceBinding: null }
                ];
                break;

            case '1x12':
                layout = '1x12';
                slots = [
                    { type: 'CHANNEL', channel: 0, deviceBinding: null },
                    { type: 'CHANNEL', channel: 1, deviceBinding: null },
                    { type: 'CHANNEL', channel: 2, deviceBinding: null },
                    { type: 'CHANNEL', channel: 3, deviceBinding: null },
                    { type: 'CHANNEL', channel: 4, deviceBinding: null },
                    { type: 'CHANNEL', channel: 5, deviceBinding: null },
                    { type: 'CHANNEL', channel: 6, deviceBinding: null },
                    { type: 'CHANNEL', channel: 7, deviceBinding: null },
                    { type: 'INPUT', label: 'Input', deviceBinding: null },
                    { type: 'MIX', label: 'Master', deviceBinding: null },
                    { type: 'STEREO', label: 'Stereo', deviceBinding: null },
                    { type: 'TEMPO', label: 'BPM', deviceBinding: null }
                ];
                break;

            default:
                console.error(`Unknown template type: ${templateType}`);
                return;
        }

        // Update scene config with template
        this.sceneConfig.layout = layout;
        this.sceneConfig.faders = slots;

        // Update layout dropdown
        document.getElementById('scene-layout').value = layout;

        // Re-render the fader grid
        this.renderFaderGrid();

        // console.log(`[SceneEditor] Applied ${layout} template`);
    }

    /**
     * Create a new sequencer scene
     */
    createSequencerScene() {
        this.openSequencerSceneEditor();
    }

    /**
     * Open sequencer scene editor (for create or rename)
     */
    openSequencerSceneEditor(sceneId = null) {
        this.currentSceneId = sceneId;

        if (sceneId) {
            // Edit existing scene (rename only)
            const scene = this.sceneManager.scenes.get(sceneId);
            if (scene && scene.type === 'sequencer') {
                document.getElementById('sequencer-scene-editor-title').textContent = 'RENAME SEQUENCER SCENE';
                document.getElementById('sequencer-scene-name').value = scene.name;
            }
        } else {
            // New scene
            document.getElementById('sequencer-scene-editor-title').textContent = 'NEW SEQUENCER SCENE';
            document.getElementById('sequencer-scene-name').value = 'Sequencer ' + (this.sceneManager.scenes.size + 1);
        }

        document.getElementById('sequencer-scene-editor-overlay').classList.add('active');

        // Focus on name input
        setTimeout(() => {
            document.getElementById('sequencer-scene-name').focus();
            document.getElementById('sequencer-scene-name').select();
        }, 100);
    }

    closeSequencerSceneEditor() {
        document.getElementById('sequencer-scene-editor-overlay').classList.remove('active');
    }

    saveSequencerScene() {
        const name = document.getElementById('sequencer-scene-name').value.trim();
        if (!name) {
            window.nbDialog.alert('Please enter a scene name');
            return;
        }

        if (this.currentSceneId) {
            // Rename existing scene
            const scene = this.sceneManager.scenes.get(this.currentSceneId);
            if (scene) {
                scene.name = name;
                this.saveScenesToStorage();
                if (this.sceneManager.controller.settingsUI) {
                    this.sceneManager.controller.settingsUI.refreshScenesList();
                }
                if (this.sceneManager.controller.settingsUI) {
                    this.sceneManager.controller.settingsUI.refreshScenesList();
                }
                this.closeSequencerSceneEditor();
                // console.log(`[SceneEditor] Renamed sequencer scene: ${name}`);
            }
        } else {
            // Create new scene
            const sceneId = 'sequencer-' + Date.now();

            this.sceneManager.addScene(sceneId, {
                name: name,
                type: 'sequencer',
                enabled: true
            });

            // Save to localStorage
            this.saveScenesToStorage();

            // Refresh scenes list
            if (this.sceneManager.controller.settingsUI) {
                this.sceneManager.controller.settingsUI.refreshScenesList();
            }
            if (this.sceneManager.controller.settingsUI) {
                this.sceneManager.controller.settingsUI.refreshScenesList();
            }

            // Close editor
            this.closeSequencerSceneEditor();

            // Switch to the new scene
            this.sceneManager.switchScene(sceneId);

            // console.log(`[SceneEditor] Created sequencer scene: ${name}`);
        }
    }

    /**
     * Create Fire sequencer scene
     */
    createFireScene() {
        this.openFireSceneEditor();
    }

    /**
     * Open Fire scene editor
     */
    openFireSceneEditor(sceneId = null) {
        this.currentSceneId = sceneId;
        const isLinked = sceneId ? this.sceneManager.scenes.get(sceneId)?.linkedSequencer : false;

        // Populate dropdowns FIRST before setting values
        this.populateFireMIDIInputs();
        this.populateFireMIDIOutputs();
        this.populateFireSequencerList();

        if (sceneId) {
            // Edit existing scene
            const scene = this.sceneManager.scenes.get(sceneId);
            if (scene && scene.type === 'fire-sequencer') {
                document.getElementById('fire-scene-editor-title').textContent = 'EDIT FIRE SEQUENCER';
                document.getElementById('fire-scene-name').value = scene.name;
                document.getElementById('fire-scene-mode').value = scene.linkedSequencer ? 'linked' : 'compatible';
                document.getElementById('fire-linked-sequencer').value = scene.linkedSequencer || '';
                this.populateFireDevices();
                document.getElementById('fire-midi-input-device').value = scene.midiInputDevice || '';
                document.getElementById('fire-render-mode').value = scene.renderMode || 'text';
                document.getElementById('fire-persistent').checked = scene.persistent || false;

                // Set compatible mode fields (MIDI output and channel)
                if (!scene.linkedSequencer) {
                    const outputSelect = document.getElementById('fire-midi-output');
                    if (outputSelect) outputSelect.value = scene.deviceBinding || '';
                    document.getElementById('fire-midi-channel').value = scene.midiChannel || '0';
                }

                document.getElementById('delete-fire-scene').style.display = 'block';
            }
        } else {
            // New scene
            document.getElementById('fire-scene-editor-title').textContent = 'NEW FIRE SEQUENCER';
            document.getElementById('fire-scene-name').value = 'Fire ' + (this.sceneManager.scenes.size + 1);
            document.getElementById('fire-scene-mode').value = 'compatible';
            document.getElementById('fire-linked-sequencer').value = '';
            this.populateFireDevices();
            document.getElementById('fire-midi-input-device').value = '';
            document.getElementById('fire-render-mode').value = 'text';
            document.getElementById('fire-persistent').checked = false;

            const outputSelect = document.getElementById('fire-midi-output');
            if (outputSelect) outputSelect.value = '';
            document.getElementById('fire-midi-channel').value = '0';

            document.getElementById('delete-fire-scene').style.display = 'none';
        }

        // Show/hide fields based on mode
        const mode = document.getElementById('fire-scene-mode').value;
        const linkedMode = mode === 'linked';
        document.getElementById('fire-linked-sequencer-field').style.display = linkedMode ? 'block' : 'none';
        document.getElementById('fire-compatible-output-field').style.display = linkedMode ? 'none' : 'block';
        document.getElementById('fire-compatible-channel-field').style.display = linkedMode ? 'none' : 'block';

        // Show overlay
        document.getElementById('fire-scene-editor-overlay').classList.add('active');
    }

    /**
     * Close Fire scene editor
     */
    closeFireSceneEditor() {
        document.getElementById('fire-scene-editor-overlay').classList.remove('active');
        this.currentSceneId = null;
    }

    /**
     * Populate Fire devices from Device Manager
     */
    populateFireDevices() {
        const select = document.getElementById('fire-midi-input-device');
        if (!select) return;

        select.innerHTML = '<option value="">None (Software Only)</option>';

        // Populate from Device Manager
        const deviceManager = this.sceneManager.controller.deviceManager;
        if (deviceManager) {
            const devices = deviceManager.getAllDevices();
            devices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.id;
                option.textContent = `${device.name} (${device.type})`;
                select.appendChild(option);
            });
        }
    }

    /**
     * Populate Fire MIDI input devices (LEGACY - replaced by populateFireDevices)
     */
    populateFireMIDIInputs() {
        const select = document.getElementById('fire-midi-input-device');
        if (!select) return;

        select.innerHTML = '<option value="">None (Software Only)</option>';

        if (this.sceneManager.controller.midiAccess) {
            for (let input of this.sceneManager.controller.midiAccess.inputs.values()) {
                const option = document.createElement('option');
                option.value = input.name;
                option.textContent = input.name;
                select.appendChild(option);
            }
        }
    }

    /**
     * Populate Fire MIDI outputs (for compatible mode)
     */
    populateFireMIDIOutputs() {
        const select = document.getElementById('fire-midi-output');
        if (!select) return;

        select.innerHTML = '<option value="">Default MIDI Output</option>';

        if (this.sceneManager.controller.midiAccess) {
            for (let output of this.sceneManager.controller.midiAccess.outputs.values()) {
                const option = document.createElement('option');
                option.value = output.name;
                option.textContent = output.name;
                select.appendChild(option);
            }
        }
    }

    /**
     * Populate Fire sequencer list
     */
    populateFireSequencerList() {
        const select = document.getElementById('fire-linked-sequencer');
        if (!select) return;

        select.innerHTML = '<option value="">-- Select Sequencer --</option>';

        for (let [id, scene] of this.sceneManager.scenes) {
            if (scene.type === 'sequencer') {
                const option = document.createElement('option');
                option.value = id;
                option.textContent = scene.name;
                select.appendChild(option);
            }
        }
    }

    /**
     * Save Fire scene
     */
    saveFireScene() {
        const name = document.getElementById('fire-scene-name').value.trim();
        const mode = document.getElementById('fire-scene-mode').value;
        const isLinked = mode === 'linked';
        const midiInputDevice = document.getElementById('fire-midi-input-device').value || null;
        const renderMode = document.getElementById('fire-render-mode').value || 'text';
        const persistent = document.getElementById('fire-persistent').checked;

        if (!name) {
            alert('Please enter a scene name');
            return;
        }

        let linkedSequencer = null;
        let deviceBinding = null;
        let midiChannel = 0;

        if (isLinked) {
            // Linked mode: only need sequencer (device routing handled by sequencer)
            linkedSequencer = document.getElementById('fire-linked-sequencer').value || null;

            if (!linkedSequencer) {
                alert('Please select a sequencer to link to');
                return;
            }
        } else {
            // Compatible mode: use MIDI output and channel
            deviceBinding = document.getElementById('fire-midi-output').value || null;
            midiChannel = parseInt(document.getElementById('fire-midi-channel').value);
        }

        const sceneId = this.currentSceneId || `fire-${Date.now()}`;

        const config = {
            name,
            type: 'fire-sequencer',
            enabled: true,
            linkedSequencer,
            deviceBinding,
            midiInputDevice,
            renderMode,
            persistent,
            midiChannel,
            tracks: 4,
            stepsPerTrack: 16
        };

        if (this.currentSceneId) {
            // Update existing scene
            this.sceneManager.scenes.delete(sceneId);
        }

        this.sceneManager.addScene(sceneId, config);
        this.saveScenesToStorage();
        this.closeFireSceneEditor();

        // Refresh scenes list
        if (this.sceneManager.controller.settingsUI) {
            this.sceneManager.controller.settingsUI.refreshScenesList();
        }

        // Switch to the new scene
        this.sceneManager.switchScene(sceneId);

        // console.log(`[SceneEditor] Created Fire scene: ${name} (${isLinked ? 'Linked' : 'Compatible'} mode)`);
    }

    /**
     * Delete Fire scene
     */
    deleteFireScene() {
        if (!this.currentSceneId) return;

        const scene = this.sceneManager.scenes.get(this.currentSceneId);
        if (!scene) return;

        if (confirm(`Delete Fire scene "${scene.name}"?`)) {
            this.sceneManager.scenes.delete(this.currentSceneId);
            this.saveScenesToStorage();
            this.closeFireSceneEditor();

            // Refresh scenes list
            if (this.sceneManager.controller.settingsUI) {
                this.sceneManager.controller.settingsUI.refreshScenesList();
            }

            // Switch to default scene
            this.sceneManager.switchScene('pads');

            // console.log(`[SceneEditor] Deleted Fire scene: ${scene.name}`);
        }
    }
}
