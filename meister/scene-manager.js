/**
 * Scene Manager for Meister
 * Handles switching between different layout views (Pads, Mixer, etc.)
 */

import './fader-components.js';
import './effects-fader.js';
import './pad-knob.js';
import { InputAction, InputEvent } from './input-actions.js';
import { parseDeckStateResponse, buildGetDeckStateMessage } from './midi-sequence-utils.js';

export class SceneManager {
    constructor(controller) {
        this.controller = controller;

        // Load default scene from localStorage or use 'pads'
        this.defaultScene = localStorage.getItem('meisterDefaultScene') || 'pads';
        this.currentScene = this.defaultScene;

        this.scenes = new Map();

        // Register default scenes
        this.registerDefaultScenes();

        // Setup gesture controls and quick selector
        this.setupGestureControls();
        this.setupQuickSelector();

        // Setup orientation change listener for responsive split scenes
        this.setupOrientationListener();

        // IMPORTANT: Initialize all sequencer instances so they can be triggered via pads
        // Without this, sequencers won't work until you view the scene first!
        this.initializeSequencerInstances();

        // NOTE: initializePersistentFireScenes() is now called AFTER loadScenesFromStorage()
        // See index.html initialization sequence
    }

    /**
     * Initialize all sequencer instances in background
     * This allows sequencers to be controlled via pads without visiting the scene first
     */
    initializeSequencerInstances() {
        // console.log('[SceneManager] Initializing sequencer instances...');
        let count = 0;

        for (const [sceneId, scene] of this.scenes.entries()) {
            if (scene.type === 'sequencer' && !scene.sequencerInstance) {
                if (window.SequencerScene) {
                    // Create instance WITHOUT rendering (skipRender = true)
                    scene.sequencerInstance = new window.SequencerScene(this.controller, sceneId, scene, true);
                    // Immediately pause it so it doesn't respond to MIDI clock
                    scene.sequencerInstance.pause();
                    // console.log(`[SceneManager] Pre-initialized sequencer (paused): ${scene.name} (${sceneId})`);
                    count++;
                } else {
                    console.error('[SceneManager] SequencerScene class not available - cannot initialize sequencers');
                    return;
                }
            }
        }

        // console.log(`[SceneManager] ✓ Initialized ${count} sequencer instance(s) in background`);
    }

    /**
     * Initialize persistent Fire scenes in background
     * This allows persistent Fire scenes to work immediately on startup
     */
    initializePersistentFireScenes() {
        // console.log('[SceneManager] Initializing persistent Fire scenes...');
        let count = 0;
        let fireSceneCount = 0;
        let persistentFireSceneCount = 0;

        for (const [sceneId, scene] of this.scenes.entries()) {
            if (scene.type === 'fire-sequencer') {
                fireSceneCount++;
                // console.log(`[SceneManager] Found Fire scene: ${scene.name} (${sceneId}), persistent=${scene.persistent}, hasInstance=${!!scene.fireInstance}`);

                if (scene.persistent === true) {
                    persistentFireSceneCount++;
                }
            }

            if (scene.type === 'fire-sequencer' && scene.persistent === true && !scene.fireInstance) {
                if (window.FireSequencerScene) {
                    // console.log(`[SceneManager] Creating persistent Fire instance: ${scene.name} (${sceneId}), midiInputDevice: ${scene.midiInputDevice}, linked: ${!!scene.linkedSequencer}`);
                    // Create instance in background (will attach MIDI listeners and initialize hardware)
                    scene.fireInstance = new window.FireSequencerScene(this, sceneId);

                    // Set up linked mode (connects to sequencer, attaches MIDI listener)
                    // This makes the Fire controller work immediately without visiting the scene
                    if (scene.linkedSequencer) {
                        scene.fireInstance.setupLinkedMode();
                    } else {
                        // Compatible mode - initialize hardware, MIDI listener, and OLED
                        scene.fireInstance.initializeFireHardware();
                        scene.fireInstance.setupMIDIInputListener();
                        scene.fireInstance.initializeFireDisplayAdapter();
                    }

                    // console.log(`[SceneManager] ✓ Pre-initialized persistent Fire scene: ${scene.name}`);
                    count++;
                } else {
                    console.error('[SceneManager] FireSequencerScene class not available - cannot initialize persistent Fire scenes');
                    return;
                }
            }
        }

        // console.log(`[SceneManager] Summary: ${fireSceneCount} total Fire scenes, ${persistentFireSceneCount} with persistent=true, ${count} initialized`);
    }

    setupOrientationListener() {
        let resizeTimeout;
        window.addEventListener('resize', () => {
            // Debounce resize events
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                const scene = this.scenes.get(this.currentScene);
                // Only re-render if current scene is a split scene
                if (scene && scene.type === 'split' && scene.render) {
                    // console.log('[SceneManager] Orientation changed, re-rendering split scene');
                    scene.render();
                }
            }, 100);
        });
    }

    /**
     * Register default scene configurations
     * loadSaved: if true, skip registering mixer if it's saved in localStorage
     */
    registerDefaultScenes(loadSaved = false) {
        // Only register default pads scene if not loading a saved one
        if (!loadSaved || !this.scenes.has('pads')) {
            // Preserve custom name if scene was already loaded from storage
            const existingPads = this.scenes.get('pads');
            const customName = existingPads?.name;

            // Pads scene (always available - grid layout)
            // Use controller's gridLayout to match what createPads() uses
            this.scenes.set('pads', {
                name: customName || 'Pads',
                type: 'grid',
                layout: this.controller.config.gridLayout || '4x4',
                enabled: true, // Can be disabled by user
                pollDevices: [], // Empty = uses global polling by default
                pollInterval: null, // null = uses global polling by default
                render: () => this.renderPadsScene()
            });
        }

        // Only register default mixer if we're not loading a saved one
        if (!loadSaved || !this.scenes.has('mixer')) {
            // Preserve custom name if scene was already loaded from storage
            const existingMixer = this.scenes.get('mixer');
            const customName = existingMixer?.name;

            // Mixer scene - customizable layout with 2 rows
            this.scenes.set('mixer', {
                name: customName || 'Mixer',
                type: 'slider',
                enabled: true, // Can be disabled by user
                rows: 2,
                columnsPerRow: 8,
                pollDevices: [0], // Poll these device IDs (will be updated dynamically)
                pollInterval: 250, // Default polling interval
                slots: [
                    // Row 1 - Channels
                    { type: 'CHANNEL', channel: 0, label: 'CH1', deviceBinding: null },
                    { type: 'CHANNEL', channel: 1, label: 'CH2', deviceBinding: null },
                    { type: 'CHANNEL', channel: 2, label: 'CH3', deviceBinding: null },
                    { type: 'CHANNEL', channel: 3, label: 'CH4', deviceBinding: null },
                    { type: 'EMPTY' },
                    { type: 'DIVIDER', label: '' },
                    { type: 'EMPTY' },
                    { type: 'TEMPO', label: 'BPM', deviceBinding: null },

                    // Row 2 - Master controls
                    { type: 'MIX', label: 'Master', deviceBinding: null },
                    { type: 'INPUT', label: 'Input', deviceBinding: null },
                    { type: 'EMPTY' },
                    { type: 'EMPTY' },
                    { type: 'EMPTY' },
                    { type: 'EMPTY' },
                    { type: 'EMPTY' },
                    { type: 'EMPTY' }
                ],
                // Backward compatibility: keep columns property
                columns: [],
                render: () => this.renderSliderScene('mixer')
            });
        }

        // Preserve custom name if scene was already loaded from storage
        const existingEffects = this.scenes.get('effects');
        const effectsName = existingEffects?.name;

        // Effects scene (default - always available)
        this.scenes.set('effects', {
            name: effectsName || 'Effects',
            type: 'effects',
            enabled: true, // Can be disabled by user
            pollDevices: [0], // Poll device 0 for effects state (default)
            pollInterval: 250, // Poll effects state every 250ms
            deviceBinding: null, // Device binding (null = use first available)
            programId: 0, // Program ID (0 for Regroove, 0-31 for Samplecrate pads)
            render: () => this.renderEffectsScene('effects')
        });

        // Preserve custom name if scene was already loaded from storage
        const existingPiano = this.scenes.get('piano');
        const pianoName = existingPiano?.name;

        // Piano scene (default - always available)
        this.scenes.set('piano', {
            name: pianoName || 'Piano',
            type: 'piano',
            enabled: true, // Can be disabled by user
            octave: 3, // Start at octave 3 (C3 = MIDI note 48)
            midiChannel: 0, // MIDI channel (0-15)
            program: -1, // Program change (-1 = no program change, 0-127 = program)
            deviceBinding: null, // Device binding (null = use default output)
            render: () => this.renderPianoScene('piano')
        });

        // Preserve custom name and deviceBinding if scene was already loaded from storage
        const existingControlGrid = this.scenes.get('control-grid');
        const controlGridName = existingControlGrid?.name;
        const controlGridDeviceBinding = existingControlGrid?.deviceBinding;

        // Control Grid scene (flexible grid with multiple control types)
        // Demo: DJ Double Deck layout for Mixxx
        this.scenes.set('control-grid', {
            name: controlGridName || 'DJ Decks',
            type: 'control-grid',
            enabled: true,
            rows: 5,
            cols: 12,
            deviceBinding: controlGridDeviceBinding || null,  // User must set device binding via scene editor
            cells: this.createDemoDoubleDeckCells(),
            render: () => this.renderControlGridScene('control-grid')
        });

    }

    /**
     * Create demo double-deck DJ layout for control grid
     */
    createDemoDoubleDeckCells() {
        const cells = [];

        // Left deck pads (4x4 grid, cols 0-3, rows 0-3)
        const leftDeckPads = [
            { label: 'Cue A1', cc: 1, color: '#0088FF' },  // Blue for CUE buttons
            { label: 'Cue A2', cc: 2, color: '#0088FF' },
            { label: 'Cue A3', cc: 3, color: '#0088FF' },
            { label: 'Cue A4', cc: 4, color: '#0088FF' },
            { label: 'Loop A1', cc: 5, color: '#FFCC00' },
            { label: 'Loop A2', cc: 6, color: '#FFCC00' },
            { label: 'Loop A3', cc: 7, color: '#FFCC00' },
            { label: 'Loop A4', cc: 8, color: '#FFCC00' },
            { label: 'FX A1', cc: 9, color: '#00DD00' },
            { label: 'FX A2', cc: 10, color: '#00DD00' },
            { label: 'FX A3', cc: 11, color: '#00DD00' },
            { label: 'FX A4', cc: 12, color: '#00DD00' },
            {
                label: 'Play A', cc: 13, color: '#DD0000',
                deckStateBinding: {
                    deck: 1,
                    control: 'playing',
                    colorMap: {
                        'true': '#00DD00',
                        'false': '#DD0000',
                        'default': '#DD0000'
                    }
                }
            },
            { label: 'Sync A', cc: 14, color: '#FFAA00' },
            { label: 'PFL A', cc: 15, color: '#888' },
            { label: 'Load A', cc: 16, color: '#888' },
        ];

        let padIndex = 0;
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 4; col++) {
                const pad = leftDeckPads[padIndex++];
                const control = {
                    type: 'pad',
                    label: pad.label,
                    color: pad.color,
                    midiType: 'cc',
                    midiChannel: 0,
                    midiNumber: pad.cc,
                    midiValue: 127
                };

                // Add deckStateBinding if present
                if (pad.deckStateBinding) {
                    control.deckStateBinding = pad.deckStateBinding;
                }

                cells.push({
                    row,
                    col,
                    rowSpan: 1,
                    colSpan: 1,
                    control
                });
            }
        }

        // Deck A GAIN knob (col 4, row 0 - at the top)
        cells.push({
            row: 0,
            col: 4,
            rowSpan: 1,
            colSpan: 1,
            control: {
                type: 'knob',
                label: 'GAIN A',
                midiType: 'cc',
                midiChannel: 0,
                midiNumber: 46,
                midiValue: 100
            }
        });

        // Deck A EQ knobs (col 4, rows 1-3)
        const deckAEQ = [
            { label: 'HIGH A', cc: 40, row: 1 },
            { label: 'MID A', cc: 41, row: 2 },
            { label: 'LOW A', cc: 42, row: 3 }
        ];

        deckAEQ.forEach(knob => {
            cells.push({
                row: knob.row,
                col: 4,
                rowSpan: 1,
                colSpan: 1,
                control: {
                    type: 'knob',
                    label: knob.label,
                    midiType: 'cc',
                    midiChannel: 0,
                    midiNumber: knob.cc,
                    midiValue: 64
                }
            });
        });

        // Display Widget A (col 5, row 0) - above VOL A fader
        cells.push({
            row: 0,
            col: 5,
            rowSpan: 1,
            colSpan: 1,
            control: {
                type: 'display',
                deviceType: 'mixxx',
                deckId: 1,
                updateInterval: 100
                // deviceId inherited from scene
            }
        });

        // Deck A VOLUME fader (col 5, rows 1-3, vertical) - includes mute button
        cells.push({
            row: 1,
            col: 5,
            rowSpan: 3,
            colSpan: 1,
            control: {
                type: 'fader',
                faderType: 'deck-fader',
                deck: 1
                // deviceBinding inherited from scene
            }
        });

        // Display Widget B (col 6, row 0) - above VOL B fader
        cells.push({
            row: 0,
            col: 6,
            rowSpan: 1,
            colSpan: 1,
            control: {
                type: 'display',
                deviceType: 'mixxx',
                deckId: 2,
                updateInterval: 100
                // deviceId inherited from scene
            }
        });

        // Deck B VOLUME fader (col 6, rows 1-3, vertical) - includes mute button
        cells.push({
            row: 1,
            col: 6,
            rowSpan: 3,
            colSpan: 1,
            control: {
                type: 'fader',
                faderType: 'deck-fader',
                deck: 2
                // deviceBinding inherited from scene
            }
        });

        // Deck B GAIN knob (col 7, row 0 - at the top)
        cells.push({
            row: 0,
            col: 7,
            rowSpan: 1,
            colSpan: 1,
            control: {
                type: 'knob',
                label: 'GAIN B',
                midiType: 'cc',
                midiChannel: 0,
                midiNumber: 47,
                midiValue: 100
            }
        });

        // Deck B EQ knobs (col 7, rows 1-3)
        const deckBEQ = [
            { label: 'HIGH B', cc: 43, row: 1 },
            { label: 'MID B', cc: 44, row: 2 },
            { label: 'LOW B', cc: 45, row: 3 }
        ];

        deckBEQ.forEach(knob => {
            cells.push({
                row: knob.row,
                col: 7,
                rowSpan: 1,
                colSpan: 1,
                control: {
                    type: 'knob',
                    label: knob.label,
                    midiType: 'cc',
                    midiChannel: 0,
                    midiNumber: knob.cc,
                    midiValue: 64
                }
            });
        });

        // Bottom row (row 4): TEMPO sliders and crossfader

        // Deck A TEMPO slider (horizontal, row 4, cols 0-3)
        cells.push({
            row: 4,
            col: 0,
            rowSpan: 1,
            colSpan: 4,
            accentColor: '#FF0000',  // RED accent for Deck A
            control: {
                type: 'fader',
                faderType: 'cc-fader',
                label: 'TEMPO A',
                midiType: 'cc',
                midiChannel: 0,
                midiNumber: 48,
                midiValue: 63,  // 125 BPM default mapped to MIDI range
                horizontal: true
            }
        });

        // Horizontal crossfader (row 4, cols 4-7)
        cells.push({
            row: 4,
            col: 4,
            rowSpan: 1,
            colSpan: 4,
            accentColor: '#000000',  // Black accent to keep alignment with TEMPO sliders
            control: {
                type: 'fader',
                faderType: 'cc-fader',
                label: 'X-FADE',
                midiType: 'cc',
                midiChannel: 0,
                midiNumber: 19,
                midiValue: 64,
                horizontal: true
            }
        });

        // Deck B TEMPO slider (horizontal, row 4, cols 8-11)
        cells.push({
            row: 4,
            col: 8,
            rowSpan: 1,
            colSpan: 4,
            accentColor: '#0000FF',  // BLUE accent for Deck B
            control: {
                type: 'fader',
                faderType: 'cc-fader',
                label: 'TEMPO B',
                midiType: 'cc',
                midiChannel: 0,
                midiNumber: 49,
                midiValue: 63,  // 125 BPM default mapped to MIDI range
                horizontal: true
            }
        });

        // Right deck pads (4x4 grid, cols 8-11, rows 0-3)
        const rightDeckPads = [
            { label: 'Cue B1', cc: 21, color: '#0088FF' },
            { label: 'Cue B2', cc: 22, color: '#0088FF' },
            { label: 'Cue B3', cc: 23, color: '#0088FF' },
            { label: 'Cue B4', cc: 24, color: '#0088FF' },
            { label: 'Loop B1', cc: 25, color: '#FFCC00' },
            { label: 'Loop B2', cc: 26, color: '#FFCC00' },
            { label: 'Loop B3', cc: 27, color: '#FFCC00' },
            { label: 'Loop B4', cc: 28, color: '#FFCC00' },
            { label: 'FX B1', cc: 29, color: '#00DD00' },
            { label: 'FX B2', cc: 30, color: '#00DD00' },
            { label: 'FX B3', cc: 31, color: '#00DD00' },
            { label: 'FX B4', cc: 32, color: '#00DD00' },
            {
                label: 'Play B', cc: 33, color: '#DD0000',
                deckStateBinding: {
                    deck: 2,
                    control: 'playing',
                    colorMap: {
                        'true': '#00DD00',
                        'false': '#DD0000',
                        'default': '#DD0000'
                    }
                }
            },
            { label: 'Sync B', cc: 34, color: '#FFAA00' },
            { label: 'PFL B', cc: 35, color: '#888' },
            { label: 'Load B', cc: 36, color: '#888' },
        ];

        padIndex = 0;
        for (let row = 0; row < 4; row++) {
            for (let col = 8; col < 12; col++) {
                const pad = rightDeckPads[padIndex++];
                const control = {
                    type: 'pad',
                    label: pad.label,
                    color: pad.color,
                    midiType: 'cc',
                    midiChannel: 0,
                    midiNumber: pad.cc,
                    midiValue: 127
                };

                // Add deckStateBinding if present
                if (pad.deckStateBinding) {
                    control.deckStateBinding = pad.deckStateBinding;
                }

                cells.push({
                    row,
                    col,
                    rowSpan: 1,
                    colSpan: 1,
                    control
                });
            }
        }

        return cells;
    }

    /**
     * Add a custom scene configuration
     *
     * Example - Two devices in one scene:
     * sceneManager.addScene('dual-mixer', {
     *   name: 'Dual Mixer',
     *   type: 'slider',
     *   rows: 2,
     *   columns: [
     *     // Row 1: Device A (e.g., Regroove)
     *     { type: 'MIX', label: 'Device A', deviceBinding: 'device-a' },
     *     { type: 'CHANNEL', channel: 0, deviceBinding: 'device-a' },
     *     { type: 'CHANNEL', channel: 1, deviceBinding: 'device-a' },
     *     // ... more channels
     *     // Row 2: Device B (e.g., another synth)
     *     { type: 'MIX', label: 'Device B', deviceBinding: 'device-b' },
     *     { type: 'CHANNEL', channel: 0, deviceBinding: 'device-b' },
     *     { type: 'CHANNEL', channel: 1, deviceBinding: 'device-b' },
     *     // ... more channels
     *     { type: 'TEMPO' }
     *   ]
     * });
     */
    addScene(id, config) {
        // Allow editing all scenes, including built-in ones

        const scene = {
            name: config.name,
            type: config.type || 'grid', // 'grid', 'slider', 'effects', 'piano', or 'split'
            enabled: config.enabled !== undefined ? config.enabled : true, // Enabled by default
            render: null
        };

        if (config.type === 'grid') {
            scene.layout = config.layout || '4x4';
            scene.pads = config.pads || []; // Pad configurations for custom grid scenes
            scene.pollDevices = config.pollDevices || []; // Optional - uses global polling if empty
            scene.pollInterval = config.pollInterval || null; // Optional - uses global polling if null
            scene.render = () => this.renderPadsScene(id);
        } else if (config.type === 'slider') {
            scene.rows = config.rows || 1;
            scene.columnsPerRow = config.columnsPerRow;
            scene.slots = config.slots || [];
            scene.columns = config.columns || []; // Backward compatibility
            scene.pollDevices = config.pollDevices || [];
            scene.pollInterval = config.pollInterval || 250;
            scene.render = () => this.renderSliderScene(id);
        } else if (config.type === 'split') {
            scene.padLayout = config.padLayout || '2x4'; // Grid size for pads (e.g., 2x4, 3x3)
            scene.padSide = config.padSide || 'left'; // 'left' or 'right'
            scene.pads = config.pads || []; // Pad configurations
            scene.slots = config.slots || []; // Fader configurations (4-5 faders)
            scene.pollDevices = config.pollDevices || [];
            scene.pollInterval = config.pollInterval || 250;
            scene.render = () => this.renderSplitScene(id);
        } else if (config.type === 'effects') {
            scene.deviceBinding = config.deviceBinding || null;
            scene.programId = config.programId !== undefined ? config.programId : 0;
            scene.pollDevices = config.pollDevices || [];
            scene.pollInterval = config.pollInterval || 250;
            scene.render = () => this.renderEffectsScene(id);
        } else if (config.type === 'piano') {
            scene.octave = config.octave !== undefined ? config.octave : 3;
            scene.midiChannel = config.midiChannel !== undefined ? config.midiChannel : 0;
            scene.program = config.program !== undefined ? config.program : -1;
            scene.deviceBinding = config.deviceBinding || null;
            scene.render = () => this.renderPianoScene(id);
        } else if (config.type === 'sequencer') {
            scene.engine = config.engine || null;
            scene.render = () => this.renderSequencerScene(id);
        } else if (config.type === 'control-grid') {
            scene.rows = config.rows || 8;
            scene.cols = config.cols || 8;
            scene.cells = config.cells || [];
            scene.deviceBinding = config.deviceBinding || null;
            scene.render = () => this.renderControlGridScene(id);
        } else if (config.type === 'fire-sequencer') {
            scene.linkedSequencer = config.linkedSequencer || null;
            scene.deviceBinding = config.deviceBinding || null;
            scene.midiInputDevice = config.midiInputDevice || null;  // Physical Fire controller input
            scene.renderMode = config.renderMode || 'text';  // Display render mode: 'text' or 'graphic'
            scene.midiChannel = config.midiChannel !== undefined ? config.midiChannel : 0;
            scene.tracks = config.tracks || 4;
            scene.stepsPerTrack = config.stepsPerTrack || 16;
            scene.persistent = config.persistent || false;  // Stay active in background when switching scenes
            scene.render = () => this.renderFireSequencerScene(id);
            // console.log(`[Scene] Added Fire scene: ${config.name}, linkedSequencer: ${scene.linkedSequencer}, persistent: ${scene.persistent}`);
        }

        this.scenes.set(id, scene);
        // console.log(`[Scene] Added scene: ${config.name} (${config.type}), polling: ${scene.pollDevices?.length || 0} devices @ ${scene.pollInterval || 'global'}ms`);
    }

    /**
     * Switch to a different scene
     */
    switchScene(sceneName) {
        const scene = this.scenes.get(sceneName);
        if (!scene) {
            console.error(`Scene "${sceneName}" not found`);
            return;
        }

        // Deactivate previous scene (unless it's persistent)
        const previousScene = this.scenes.get(this.currentScene);
        if (previousScene && previousScene.persistent !== true) {
            // Non-persistent scene: pause when switching away (keep listeners active!)
            if (previousScene.type === 'sequencer' && previousScene.sequencerInstance) {
                // console.log(`[Scene] Pausing non-persistent sequencer: ${previousScene.name}`);
                previousScene.sequencerInstance.pause();
            }
            if (previousScene.type === 'fire-sequencer' && previousScene.fireInstance) {
                // console.log(`[Scene] Pausing non-persistent Fire scene: ${previousScene.name}`);
                previousScene.fireInstance.pause();
            }
        } else if (previousScene && previousScene.persistent === true) {
            // console.log(`[Scene] Keeping persistent scene active: ${previousScene.name}`);
        }

        // console.log(`[Scene] Switching to: ${scene.name}`);
        this.currentScene = sceneName;

        // Close any open editor overlays
        document.getElementById('scene-editor-overlay')?.classList.remove('active');
        document.getElementById('effects-scene-editor-overlay')?.classList.remove('active');
        document.getElementById('pad-scene-editor-overlay')?.classList.remove('active');

        // Render the scene
        scene.render();

        // Resolve device IDs from bindings at runtime (so they update when device IDs change)
        const resolvedDeviceIds = this.resolveSceneDeviceIds(scene);

        // Start device-type-aware polling for this scene
        if (resolvedDeviceIds.length > 0) {
            // Scene has device bindings - start polling for those devices
            const pollInterval = scene.pollInterval || 500; // Default to 500ms if not specified

            this.startScenePolling(resolvedDeviceIds, pollInterval);
        } else {
            // Scene has no device bindings - stop polling
            this.stopScenePolling();
        }

        // Update scene selector if it exists
        this.updateSceneSelector();

        // Update quick selector to reflect current scene
        this.refreshQuickSelector();

        // Update settings scenes list if settings UI exists
        if (this.controller.settingsUI) {
            this.controller.settingsUI.refreshScenesList();
        }
    }

    /**
     * Resolve device IDs from scene configuration at runtime
     * This ensures device IDs update when reassigned in device manager
     */
    resolveSceneDeviceIds(scene) {
        const deviceIds = [];

        if (!this.controller.deviceManager) {
            return deviceIds;
        }

        // For effects/piano/control-grid scenes with deviceBinding
        if (scene.deviceBinding) {
            const device = this.controller.deviceManager.getDevice(scene.deviceBinding);
            // console.log(`[Scene] Checking scene.deviceBinding: device=${device?.name}, type=${device?.type}, deviceId=${device?.deviceId}`);
            // Include ALL device types (regroove, samplecrate, etc)
            if (device && device.deviceId !== undefined) {
                deviceIds.push(device.deviceId);
                // console.log(`[Scene] Added deviceId ${device.deviceId} from scene.deviceBinding (${device.type})`);
            }
        }

        // For slider/split scenes with slots containing device bindings
        if (scene.slots) {
            const uniqueDeviceIds = new Set();
            scene.slots.forEach(slot => {
                if (slot && slot.deviceBinding) {
                    const device = this.controller.deviceManager.getDevice(slot.deviceBinding);
                    // Include ALL device types (regroove, samplecrate, etc)
                    if (device && device.deviceId !== undefined) {
                        uniqueDeviceIds.add(device.deviceId);
                    }
                }
            });
            deviceIds.push(...Array.from(uniqueDeviceIds));
        }

        // For grid scenes with pads containing device bindings
        if (scene.pads) {
            const uniqueDeviceIds = new Set();
            scene.pads.forEach(pad => {
                if (pad && pad.deviceBinding) {
                    const device = this.controller.deviceManager.getDevice(pad.deviceBinding);
                    // Include ALL device types (regroove, samplecrate, etc)
                    if (device && device.deviceId !== undefined) {
                        uniqueDeviceIds.add(device.deviceId);
                    }
                }
            });
            deviceIds.push(...Array.from(uniqueDeviceIds));
        }

        // For built-in 'pads' scene, check global config pads
        if (scene.type === 'grid' && this.controller.config && this.controller.config.pads) {
            const uniqueDeviceIds = new Set();
            this.controller.config.pads.forEach(pad => {
                if (pad && pad.deviceBinding) {
                    const device = this.controller.deviceManager.getDevice(pad.deviceBinding);
                    // Include ALL device types (regroove, samplecrate, etc)
                    if (device && device.deviceId !== undefined) {
                        uniqueDeviceIds.add(device.deviceId);
                    }
                }
            });
            deviceIds.push(...Array.from(uniqueDeviceIds));
        }

        // Fallback to pollDevices if no bindings resolved (backward compat)
        if (deviceIds.length === 0 && scene.pollDevices && scene.pollDevices.length > 0) {
            // Include all devices from pollDevices array
            return scene.pollDevices.filter(deviceId => {
                const device = this.controller.deviceManager.getAllDevices().find(d => d.deviceId === deviceId);
                return device && device.deviceId !== undefined;
            });
        }

        return deviceIds;
    }

    /**
     * Start device-type-aware polling for scene
     */
    startScenePolling(deviceIds, pollInterval) {
        // Stop any existing polling
        this.stopScenePolling();

        if (!this.controller.deviceManager || !this.controller.midiOutput) {
            console.warn(`[Scene] Cannot start polling: deviceManager=${!!this.controller.deviceManager}, midiOutput=${!!this.controller.midiOutput}`);
            return;
        }

        this.currentPollingDeviceIds = deviceIds;
        this.currentPollingInterval = pollInterval;

        console.log(`[Scene] Starting device-type-aware polling for devices [${deviceIds.join(', ')}] every ${pollInterval}ms`);

        // Request immediately for all devices
        this.pollAllDevices();

        // Set up interval
        this.scenePollingInterval = setInterval(() => {
            this.pollAllDevices();
        }, pollInterval);
    }

    /**
     * Poll all devices with type-specific status requests
     */
    pollAllDevices() {
        if (!this.currentPollingDeviceIds) return;

        this.currentPollingDeviceIds.forEach(deviceId => {
            const device = this.controller.deviceManager.getAllDevices().find(d => d.deviceId === deviceId);
            if (!device) {
                console.warn(`[Scene] Device ID ${deviceId} not found in device manager`);
                return;
            }

            if (device.type === 'regroove') {
                // Regroove: GET_PLAYER_STATE (0x60)
                if (this.controller.regrooveState) {
                    this.controller.regrooveState.requestPlayerState(deviceId);
                }

                // Also request FX state if current scene is effects
                const currentScene = this.scenes.get(this.currentScene);
                if (currentScene && currentScene.type === 'effects' && currentScene.deviceBinding) {
                    const effectsDevice = this.controller.deviceManager.getDevice(currentScene.deviceBinding);
                    if (effectsDevice && effectsDevice.deviceId === deviceId) {
                        const programId = currentScene.programId || 0;
                        this.controller.sendSysExFxGetAllState(deviceId, programId);
                    }
                }
            } else if (device.type === 'samplecrate') {
                // SampleCrate: GET_PROGRAM_STATE (0x64) for volumes/mixer
                this.controller.sendSysExGetProgramState(deviceId);
                // Also request sequence state for play/stop pad colors
                this.controller.sendSysExGetSequenceState(deviceId);

                // Also request FX state if current scene is effects
                const currentScene = this.scenes.get(this.currentScene);
                if (currentScene && currentScene.type === 'effects' && currentScene.deviceBinding) {
                    const effectsDevice = this.controller.deviceManager.getDevice(currentScene.deviceBinding);
                    if (effectsDevice && effectsDevice.deviceId === deviceId) {
                        const programId = currentScene.programId || 0;
                        this.controller.sendSysExFxGetAllState(deviceId, programId);
                    }
                }
            } else if (device.type === 'mixxx') {
                // Mixxx: GET_DECKS_STATE (0x66) for deck playback/BPM/position
                this.controller.sendSysExGetDeckState(deviceId);
            } else {
                console.warn(`[Scene] Unknown device type "${device.type}" for device ${device.name} (ID ${deviceId})`);
            }
            // Add more device types here as needed
        });
    }

    /**
     * Stop scene polling
     */
    stopScenePolling() {
        if (this.scenePollingInterval) {
            clearInterval(this.scenePollingInterval);
            this.scenePollingInterval = null;
        }

        // Also stop old regrooveState polling
        if (this.controller.regrooveState) {
            this.controller.regrooveState.stopPolling();
        }

        this.currentPollingDeviceIds = null;
        this.currentPollingInterval = null;
    }

    /**
     * Render pads scene (existing grid)
     */
    renderPadsScene(sceneId = 'pads') {
        const container = document.getElementById('pads-grid');
        if (!container) return;

        // Get scene config
        const scene = this.scenes.get(sceneId);
        const isBuiltIn = sceneId === 'pads';

        // console.log(`[renderPadsScene] sceneId=${sceneId}, isBuiltIn=${isBuiltIn}, scene=`, scene);
        // console.log(`[renderPadsScene] scene.pads=`, scene?.pads);

        // Get layout from scene, fallback to config
        const layout = scene?.layout || this.controller.config.gridLayout || '4x4';
        const [cols, rows] = layout.split('x').map(Number);

        // Clear container first
        container.innerHTML = '';

        // Reset ALL container styles (split/slider scenes set flex properties)
        container.removeAttribute('style');
        container.style.display = 'grid';
        container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        container.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
        container.style.gap = '10px';
        container.style.padding = '10px 10px 4px 10px';
        container.style.boxSizing = 'border-box';
        container.style.height = 'calc(100vh - 60px)';

        // For built-in 'pads' scene, use global config pads
        // For custom scenes, use scene's own pads array (or empty if not set)
        if (isBuiltIn) {
            // Set current scene ID to 'pads' so pad editor saves to global config
            this.controller.currentPadSceneId = 'pads';

            // Clear scene pads config (use global config instead)
            this.controller.scenePadsConfig = null;

            // Sync the scene's layout to controller config so createPads uses correct layout
            if (scene && scene.layout) {
                this.controller.config.gridLayout = scene.layout;
            }
            this.controller.createPads();
        } else {
            // Custom pad scene - create empty pads or use scene's pads
            const totalPads = cols * rows;
            const scenePads = scene?.pads || [];

            // Store current scene ID so pad editor knows which scene to save to
            this.controller.currentPadSceneId = sceneId;

            // Reset pads array to hold elements
            this.controller.pads = [];

            for (let i = 0; i < totalPads; i++) {
                // Use null instead of empty object for truly empty pads
                const padConfig = scenePads[i] || null;
                const pad = this.controller.createSinglePad(i, padConfig);
                container.appendChild(pad);
                this.controller.pads.push(pad);
            }

            // Store scene pads config separately for saving
            this.controller.scenePadsConfig = scenePads;
        }
    }

    /**
     * Render slider scene (mixer, custom fader layouts)
     */
    renderSliderScene(sceneId) {
        const container = document.getElementById('pads-grid');
        if (!container) return;

        const scene = this.scenes.get(sceneId);
        if (!scene) return;

        // Use slots if available, fallback to columns for backward compatibility
        const items = scene.slots || scene.columns || [];
        const rows = scene.rows || 1;
        const columnsPerRow = scene.columnsPerRow || Math.ceil(items.length / rows);

        // Clear grid and switch to fader layout
        container.style.display = 'flex';
        container.style.flexDirection = rows > 1 ? 'column' : 'row';
        container.style.gap = rows > 1 ? '20px' : '20px';
        container.style.padding = '10px';
        container.style.justifyContent = 'space-evenly';
        container.style.alignItems = 'stretch';
        container.style.height = 'calc(100vh - 60px)';
        container.innerHTML = '';

        // For multi-row layouts, create rows
        if (rows > 1) {
            for (let r = 0; r < rows; r++) {
                const rowContainer = document.createElement('div');
                rowContainer.style.display = 'flex';
                rowContainer.style.flexDirection = 'row';
                rowContainer.style.gap = '20px';
                rowContainer.style.justifyContent = 'space-evenly';
                rowContainer.style.alignItems = 'stretch';
                rowContainer.style.flex = '1';
                rowContainer.style.minHeight = '0'; // Important for flex children

                const startIdx = r * columnsPerRow;
                const endIdx = Math.min(startIdx + columnsPerRow, items.length);
                const rowItems = items.slice(startIdx, endIdx);

                rowItems.forEach(item => {
                    const fader = this.createFader(item);
                    if (fader) rowContainer.appendChild(fader);
                });

                container.appendChild(rowContainer);
            }

            // Apply current device state to faders after rendering
            this.applyCurrentDeviceStates();
            return;
        }

        // Single row layout - create faders directly
        items.forEach(item => {
            const fader = this.createFader(item);
            if (fader) container.appendChild(fader);
        });

        // Apply current device state to faders after rendering
        this.applyCurrentDeviceStates();
    }

    /**
     * Render split scene (pads on one side, sliders on the other)
     * Responsive: side-by-side in landscape, stacked in portrait
     */
    renderSplitScene(sceneId) {
        const container = document.getElementById('pads-grid');
        if (!container) return;

        const scene = this.scenes.get(sceneId);
        if (!scene) return;

        // Detect orientation: portrait (taller) vs landscape (wider)
        const isPortrait = window.innerHeight > window.innerWidth;

        // Clear and setup container for split layout
        container.style.display = 'flex';
        container.style.flexDirection = isPortrait ? 'column' : 'row';
        container.style.gap = '10px';
        container.style.padding = '10px';
        container.style.height = 'calc(100vh - 60px)';
        container.innerHTML = '';

        // Get pad layout dimensions
        const [cols, rows] = (scene.padLayout || '4x4').split('x').map(Number);
        const totalPads = cols * rows;

        // Create pads container
        const padsContainer = document.createElement('div');
        padsContainer.style.display = 'grid';
        padsContainer.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        padsContainer.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
        padsContainer.style.gap = '10px';

        // In portrait mode: pads take up proportional space based on grid size
        // In landscape mode: 50/50 split
        if (isPortrait) {
            padsContainer.style.flex = '1'; // Let pads take natural space
        } else {
            padsContainer.style.flex = '0 0 50%'; // 50/50 split with faders
        }
        padsContainer.style.minWidth = '0';
        padsContainer.style.minHeight = '0';

        // Store current scene ID so pad editor knows which scene to save to
        this.controller.currentPadSceneId = sceneId;

        // Create pads
        const scenePads = scene.pads || [];

        // Reset pads array to hold elements
        this.controller.pads = [];

        for (let i = 0; i < totalPads; i++) {
            const padConfig = scenePads[i] || null; // Use null for truly empty pads
            const pad = this.controller.createSinglePad(i, padConfig);
            padsContainer.appendChild(pad);
            this.controller.pads.push(pad);
        }

        // Expand scene pads config array to full size with nulls
        while (scenePads.length < totalPads) {
            scenePads.push(null);
        }

        // Store scene pads config separately for saving
        this.controller.scenePadsConfig = scenePads;

        // Create faders container
        const fadersContainer = document.createElement('div');
        fadersContainer.style.display = 'flex';
        fadersContainer.style.flexDirection = 'row';
        fadersContainer.style.gap = '20px';
        fadersContainer.style.justifyContent = 'space-evenly';
        fadersContainer.style.alignItems = 'stretch';
        fadersContainer.style.flex = '1';
        fadersContainer.style.minWidth = '0';
        fadersContainer.style.minHeight = '0';

        // Create faders (4-5 typically)
        const slots = scene.slots || [];
        slots.forEach(slot => {
            const fader = this.createFader(slot);
            if (fader) fadersContainer.appendChild(fader);
        });

        // In portrait mode: always pads at top, faders at bottom
        // In landscape mode: use padSide setting (left/right)
        if (isPortrait) {
            container.appendChild(padsContainer);
            container.appendChild(fadersContainer);
        } else {
            // Landscape: respect padSide setting
            if (scene.padSide === 'right') {
                container.appendChild(fadersContainer);
                container.appendChild(padsContainer);
            } else {
                container.appendChild(padsContainer);
                container.appendChild(fadersContainer);
            }
        }

        // Apply current device state to faders after rendering
        this.applyCurrentDeviceStates();
    }

    /**
     * Render effects scene (effects control panel)
     */
    renderEffectsScene(sceneId = 'effects') {
        const container = document.getElementById('pads-grid');
        if (!container) return;

        // Clear grid and switch to effects layout
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '10px';
        container.style.padding = '10px';
        container.style.justifyContent = 'flex-start';
        container.style.alignItems = 'stretch';
        container.style.height = 'calc(100vh - 60px)';
        container.style.overflow = 'hidden';
        container.innerHTML = '';

        // Get scene and resolve device binding
        const scene = this.scenes.get(sceneId);
        if (!scene) {
            console.error(`[Effects] Scene "${sceneId}" not found`);
            return;
        }
        const currentBinding = scene.deviceBinding;

        // Resolve device from binding
        let device = null;
        if (currentBinding && this.controller.deviceManager) {
            device = this.controller.deviceManager.getDevice(currentBinding);
        }

        // If no device found and we have a device manager, get first available device
        if (!device && this.controller.deviceManager) {
            const devices = this.controller.deviceManager.getAllDevices();
            if (devices.length > 0) {
                device = devices[0]; // Use first available device
                scene.deviceBinding = device.id; // Update binding
                scene.pollDevices = [device.deviceId];
            }
        }

        // Create device info header (display only)
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.gap = '10px';
        header.style.alignItems = 'center';
        header.style.padding = '8px 12px';
        header.style.background = '#1a1a1a';
        header.style.borderRadius = '4px';
        header.style.flexShrink = '0';

        // Device name display
        const deviceLabel = document.createElement('div');
        deviceLabel.style.color = '#aaa';
        deviceLabel.style.fontSize = '1em';
        deviceLabel.style.fontWeight = 'bold';
        deviceLabel.style.textTransform = 'uppercase';
        deviceLabel.style.letterSpacing = '0.5px';
        deviceLabel.style.flex = '1';

        if (device) {
            deviceLabel.textContent = `${device.name} (CH ${device.midiChannel + 1} / ID ${device.deviceId})`;
        } else {
            deviceLabel.textContent = 'NO DEVICE ASSIGNED';
            deviceLabel.style.color = '#666';
        }

        // Program ID display
        const programLabel = document.createElement('div');
        programLabel.style.color = '#666';
        programLabel.style.fontSize = '0.9em';
        programLabel.style.fontWeight = 'bold';
        programLabel.style.textTransform = 'uppercase';
        programLabel.style.letterSpacing = '0.5px';
        programLabel.style.padding = '8px 16px';
        programLabel.style.background = '#0a0a0a';
        programLabel.style.borderRadius = '4px';
        // Display: 0 = "Regroove", 1-30 (wire) = "Program 2-31" (user-facing)
        const programId = scene.programId || 0;
        programLabel.textContent = programId === 0 ? 'REGROOVE' : `PROGRAM ${programId + 1}`;

        header.appendChild(deviceLabel);
        header.appendChild(programLabel);
        container.appendChild(header);

        // Create effects container
        const effectsContainer = document.createElement('div');
        effectsContainer.style.display = 'flex';
        effectsContainer.style.flexDirection = 'row';
        effectsContainer.style.gap = '10px';
        effectsContainer.style.justifyContent = 'center';
        effectsContainer.style.alignItems = 'stretch';
        effectsContainer.style.flex = '1';
        effectsContainer.style.minHeight = '0';
        effectsContainer.style.overflow = 'hidden';

        // Effect definitions with default values from REGROOVE_EFFECTS.md
        const effects = [
            {
                id: 0x00,
                name: 'DISTORTION',
                params: [
                    { name: 'Drive', default: 64 },
                    { name: 'Mix', default: 64 }
                ]
            },
            {
                id: 0x01,
                name: 'FILTER',
                params: [
                    { name: 'Cutoff', default: 127 },
                    { name: 'Resonance', default: 0 }
                ]
            },
            {
                id: 0x02,
                name: 'EQ',
                params: [
                    { name: 'Low', default: 64 },
                    { name: 'Mid', default: 64 },
                    { name: 'High', default: 64 }
                ]
            },
            {
                id: 0x03,
                name: 'REVERB',
                params: [
                    { name: 'Room', default: 64 },
                    { name: 'Damping', default: 64 },
                    { name: 'Mix', default: 32 }
                ]
            },
            {
                id: 0x04,
                name: 'DELAY',
                params: [
                    { name: 'Time', default: 32 },
                    { name: 'Feedback', default: 32 },
                    { name: 'Mix', default: 32 }
                ]
            }
        ];

        // Create effect groups
        effects.forEach(effect => {
            const group = this.createEffectGroup(effect);
            effectsContainer.appendChild(group);
        });

        container.appendChild(effectsContainer);

        // Request current effects state if we have a device
        if (device) {
            const programId = scene.programId || 0;
            this.controller.sendSysExFxGetAllState(device.deviceId, programId);
        }
    }

    /**
     * Create an effect group (enable button + sliders)
     */
    createEffectGroup(effect) {
        const group = document.createElement('div');
        group.className = 'effect-group';
        group.dataset.effectId = effect.id;
        group.style.display = 'flex';
        group.style.flexDirection = 'column';
        group.style.gap = '8px';
        group.style.padding = '8px';
        group.style.background = 'transparent';
        group.style.borderRadius = '4px';
        group.style.minWidth = 'min-content';
        group.style.flex = '0 0 auto'; // Only take space needed, not equal distribution
        group.style.maxWidth = '100%'; // Don't exceed container width

        // Effect name header
        const header = document.createElement('div');
        header.textContent = effect.name;
        header.style.color = '#aaa';
        header.style.fontSize = '0.75em';
        header.style.fontWeight = 'bold';
        header.style.textAlign = 'center';
        header.style.letterSpacing = '1px';
        header.style.marginBottom = '10px';
        header.style.padding = '6px';
        header.style.background = '#1a1a1a';
        header.style.borderRadius = '4px';
        group.appendChild(header);

        // Enable button - match mixer fader button style
        const enableRow = document.createElement('div');
        enableRow.style.display = 'flex';
        enableRow.style.gap = '10px';
        enableRow.style.justifyContent = 'center';
        enableRow.style.marginBottom = '12px';

        const enableBtn = document.createElement('button');
        enableBtn.textContent = 'FX';
        enableBtn.className = 'fx-enable-btn';
        enableBtn.dataset.effectId = effect.id;
        enableBtn.style.width = '60px';
        enableBtn.style.minHeight = '44px';
        enableBtn.style.padding = '12px';
        enableBtn.style.margin = '0 auto';
        enableBtn.style.background = '#2a2a2a';
        enableBtn.style.color = '#aaa';
        enableBtn.style.border = 'none';
        enableBtn.style.borderRadius = '4px';
        enableBtn.style.cursor = 'pointer';
        enableBtn.style.fontSize = '1em';
        enableBtn.style.fontWeight = 'bold';
        enableBtn.style.textTransform = 'uppercase';
        enableBtn.style.transition = 'all 0.15s';

        enableBtn.addEventListener('click', () => {
            const isEnabled = enableBtn.classList.contains('active');
            this.handleEffectEnable(effect.id, !isEnabled);
        });

        enableRow.appendChild(enableBtn);
        group.appendChild(enableRow);

        // Sliders row
        const slidersRow = document.createElement('div');
        slidersRow.style.display = 'flex';
        slidersRow.style.gap = '10px';
        slidersRow.style.flex = '1';
        slidersRow.style.alignItems = 'stretch';
        slidersRow.style.minHeight = '0';

        effect.params.forEach((param, index) => {
            const fader = document.createElement('effects-fader');
            fader.setAttribute('label', param.name);
            fader.setAttribute('value', param.default);
            fader.setAttribute('default', param.default);
            fader.dataset.effectId = effect.id;
            fader.dataset.paramIndex = index;

            fader.addEventListener('change', (e) => {
                this.handleEffectParameterChange(effect.id, index, e.detail.value);
            });

            fader.addEventListener('reset', (e) => {
                this.handleEffectParameterChange(effect.id, index, e.detail.value);
            });

            slidersRow.appendChild(fader);
        });

        group.appendChild(slidersRow);

        return group;
    }

    /**
     * Handle effect enable/disable
     */
    handleEffectEnable(effectId, enabled) {
        // Get device from current effects scene
        const scene = this.scenes.get(this.currentScene);
        if (!scene || scene.type !== 'effects') {
            console.warn('[Effects] Current scene is not an effects scene');
            return;
        }

        if (!scene.deviceBinding || !this.controller.deviceManager) {
            console.warn('[Effects] No device bound to effects scene');
            return;
        }

        const device = this.controller.deviceManager.getDevice(scene.deviceBinding);
        if (!device) {
            console.warn('[Effects] Device binding not found:', scene.deviceBinding);
            return;
        }

        const deviceId = device.deviceId;
        const programId = scene.programId || 0;

        // Get current parameter values from UI
        const params = this.getEffectParams(effectId);

        // console.log(`[Dev${deviceId} Prog${programId} Effects] ${enabled ? 'Enabling' : 'Disabling'} effect ${effectId} with params:`, params);
        // console.log(`[Dev${deviceId}] Sending SysEx 0x71: F0 7D ${deviceId.toString(16).padStart(2, '0')} 71 ${programId.toString(16).padStart(2, '0')} ${effectId.toString(16).padStart(2, '0')} ${enabled ? '01' : '00'} ${params.map(p => p.toString(16).padStart(2, '0')).join(' ')} F7`);

        // Send SysEx command
        this.controller.sendSysExFxEffectSet(deviceId, programId, effectId, enabled, ...params);

        // Update UI - match mixer FX button style
        const enableBtn = document.querySelector(`.fx-enable-btn[data-effect-id="${effectId}"]`);
        if (enableBtn) {
            if (enabled) {
                enableBtn.classList.add('active');
                enableBtn.style.background = '#ccaa44';
                enableBtn.style.color = '#fff';
            } else {
                enableBtn.classList.remove('active');
                enableBtn.style.background = '#2a2a2a';
                enableBtn.style.color = '#aaa';
            }
        }
    }

    /**
     * Handle effect parameter change
     */
    handleEffectParameterChange(effectId, paramIndex, value) {
        // Get device from current effects scene
        const scene = this.scenes.get(this.currentScene);
        if (!scene || scene.type !== 'effects') {
            console.warn('[Effects] Current scene is not an effects scene');
            return;
        }

        if (!scene.deviceBinding || !this.controller.deviceManager) {
            console.warn('[Effects] No device bound to effects scene');
            return;
        }

        const device = this.controller.deviceManager.getDevice(scene.deviceBinding);
        if (!device) {
            console.warn('[Effects] Device binding not found:', scene.deviceBinding);
            return;
        }

        const deviceId = device.deviceId;
        const programId = scene.programId || 0;

        // Get all current parameter values from UI
        const params = this.getEffectParams(effectId);
        params[paramIndex] = value;

        // Get current enable state from button
        const enableBtn = document.querySelector(`.fx-enable-btn[data-effect-id="${effectId}"]`);
        const enabled = enableBtn ? enableBtn.classList.contains('active') : false;

        // console.log(`[Dev${deviceId} Effects] Setting effect ${effectId} param ${paramIndex} = ${value}, enabled=${enabled}, params:`, params);

        // Send SysEx command
        this.controller.sendSysExFxEffectSet(deviceId, programId, effectId, enabled, ...params);
    }

    /**
     * Get current effect parameter values from UI
     */
    getEffectParams(effectId) {
        const faders = document.querySelectorAll(`effects-fader[data-effect-id="${effectId}"]`);
        const params = [];
        faders.forEach(fader => {
            params.push(parseInt(fader.getAttribute('value') || 64));
        });
        return params;
    }

    /**
     * Apply current device states to all faders
     */
    applyCurrentDeviceStates() {
        if (!this.controller.regrooveState) return;

        // Get all device IDs that have state
        const deviceIds = this.controller.regrooveState.getAllDeviceIds();

        // Update faders for each device
        deviceIds.forEach(deviceId => {
            const state = this.controller.regrooveState.getDeviceState(deviceId);
            if (state) {
                this.updateMixerFromDeviceState(deviceId, state);
            }
        });
    }

    /**
     * Resolve device binding to device config
     */
    resolveDeviceBinding(deviceBinding) {
        const deviceManager = this.controller.deviceManager;
        if (!deviceManager) {
            return { deviceId: 0, midiChannel: 0 };
        }

        // If no binding specified, use default device
        const device = deviceBinding
            ? deviceManager.getDevice(deviceBinding)
            : deviceManager.getDefaultDevice();

        if (device) {
            return {
                deviceId: device.deviceId,
                midiChannel: device.midiChannel
            };
        }

        // Fallback
        return { deviceId: 0, midiChannel: 0 };
    }

    /**
     * Convert MIDI pan value (0-127, center=64) to UI value (-100 to 100, center=0)
     * Handles asymmetry: MIDI has 0-64 (65 values) and 64-127 (64 values)
     */
    convertPanToUI(pan) {
        // Map 0-63 to -100 to -1, and 64-127 to 0 to 100
        return pan < 64
            ? Math.round((pan - 64) * 100 / 64)
            : Math.round((pan - 64) * 100 / 63);
    }

    /**
     * Convert UI pan value (-100 to 100, center=0) to MIDI value (0-127, center=64)
     * Handles asymmetry: -100 to -1 maps to 0-63 (64 values), 0 to 100 maps to 64-127 (64 values)
     */
    convertPanToWire(uiPan) {
        // Map -100 to -1 to 0-63, and 0 to 100 to 64-127
        return uiPan < 0
            ? Math.round(64 + (uiPan * 64 / 100))
            : Math.round(64 + (uiPan * 63 / 100));
    }

    /**
     * Create a fader element based on column configuration
     */
    createFader(column) {
        let fader;

        // Handle null/undefined columns (empty slots)
        if (!column || column.type === 'EMPTY') {
            // Empty placeholder
            fader = document.createElement('div');
            fader.style.width = '80px';
            fader.style.margin = '0';
            return fader;
        }

        if (column.type === 'DIVIDER') {
            // Visual divider
            fader = document.createElement('div');
            fader.style.width = '2px';
            fader.style.background = 'var(--border-color, #333)';
            fader.style.margin = '10px 0';
            fader.style.alignSelf = 'stretch';
            if (column.label) {
                fader.title = column.label;
            }
            return fader;
        }

        // Resolve device binding to actual device config
        const deviceConfig = this.resolveDeviceBinding(column.deviceBinding);

        // Get device name for label
        let deviceName = '';
        if (column.deviceBinding && this.controller.deviceManager) {
            const device = this.controller.deviceManager.getDevice(column.deviceBinding);
            if (device) {
                deviceName = device.name;
            }
        }

        if (column.type === 'MIX') {
                fader = document.createElement('mix-fader');
                // Include device name in label (smaller, grey font like sequencer)
                const label = deviceName ? `${column.label}<br><span style="font-size: 0.8em; opacity: 0.7;">${deviceName}</span>` : column.label;
                fader.setAttribute('label', label);
                fader.setAttribute('volume', '100');
                fader.setAttribute('pan', '0');
                fader.setAttribute('fx', 'false');
                fader.setAttribute('muted', 'false');
                fader.dataset.deviceId = deviceConfig.deviceId;
                fader.dataset.deviceBinding = column.deviceBinding || '';

                // Event listeners for mix fader
                fader.addEventListener('fx-toggle', (e) => {
                    const deviceId = parseInt(fader.dataset.deviceId || 0);
                    // console.log(`[Dev${deviceId} Mix] FX Toggle:`, e.detail.enabled);
                    // MASTER fader: toggle between 1 (master) and 0 (off)
                    const route = e.detail.enabled ? 1 : 0;
                    this.handleFxRouting(deviceId, route);
                });

                fader.addEventListener('pan-change', (e) => {
                    const deviceId = parseInt(fader.dataset.deviceId || 0);
                    // Convert from -100..100 to 0..127 (64 = center)
                    const panValue = this.convertPanToWire(e.detail.value);
                    // console.log(`[Dev${deviceId} Mix] Pan: ${e.detail.value} -> ${panValue}`);
                    this.handleMasterPan(deviceId, panValue);
                });

                fader.addEventListener('volume-change', (e) => {
                    const deviceId = parseInt(fader.dataset.deviceId || 0);
                    // console.log(`[Dev${deviceId} Mix] Volume:`, e.detail.value);
                    this.handleMasterVolume(deviceId, e.detail.value);
                });

                fader.addEventListener('mute-toggle', (e) => {
                    const deviceId = parseInt(fader.dataset.deviceId || 0);
                    // console.log(`[Dev${deviceId} Mix] Mute:`, e.detail.muted);
                    this.handleMasterMute(deviceId, e.detail.muted);
                });

            } else if (column.type === 'CHANNEL') {
                fader = document.createElement('channel-fader');
                fader.setAttribute('channel', column.channel);
                // Store device name for display
                if (deviceName) {
                    fader.dataset.deviceName = deviceName;
                }
                fader.setAttribute('volume', '100');
                fader.setAttribute('pan', '0');
                fader.setAttribute('solo', 'false');
                fader.setAttribute('muted', 'false');
                fader.dataset.deviceId = deviceConfig.deviceId;
                fader.dataset.deviceBinding = column.deviceBinding || '';

                // Sync with Regroove player state
                if (this.controller.playerState) {
                    const isMuted = this.controller.playerState.mutedChannels.includes(column.channel);
                    fader.setAttribute('muted', isMuted.toString());
                }

                // Event listeners for channel fader
                fader.addEventListener('solo-toggle', (e) => {
                    const deviceId = parseInt(fader.dataset.deviceId || 0);
                    // console.log(`[Dev${deviceId} CH${e.detail.channel}] Solo:`, e.detail.solo);
                    this.handleChannelSolo(deviceId, e.detail.channel, e.detail.solo);
                });

                fader.addEventListener('pan-change', (e) => {
                    const deviceId = parseInt(fader.dataset.deviceId || 0);
                    // Convert from -100..100 to 0..127 (64 = center)
                    const panValue = this.convertPanToWire(e.detail.value);
                    // console.log(`[Dev${deviceId} CH${e.detail.channel}] Pan: ${e.detail.value} -> ${panValue}`);
                    this.handleChannelPan(deviceId, e.detail.channel, panValue);
                });

                fader.addEventListener('volume-change', (e) => {
                    const deviceId = parseInt(fader.dataset.deviceId || 0);
                    // console.log(`[Dev${deviceId} CH${e.detail.channel}] Volume:`, e.detail.value);
                    this.handleChannelVolume(deviceId, e.detail.channel, e.detail.value);
                });

                fader.addEventListener('mute-toggle', (e) => {
                    const deviceId = parseInt(fader.dataset.deviceId || 0);
                    // console.log(`[Dev${deviceId} CH${e.detail.channel}] Mute:`, e.detail.muted);
                    this.handleChannelMute(deviceId, e.detail.channel, e.detail.muted);
                });

            } else if (column.type === 'INPUT') {
                // Input fader (similar to MIX but for input channel)
                fader = document.createElement('mix-fader');
                // Include device name in label
                const inputLabel = deviceName ? `${column.label || 'Input'}\n${deviceName}` : (column.label || 'Input');
                fader.setAttribute('label', inputLabel);
                fader.setAttribute('volume', '100');
                fader.setAttribute('pan', '0');
                fader.setAttribute('fx', 'false');
                fader.setAttribute('muted', 'false');
                fader.dataset.deviceId = deviceConfig.deviceId;
                fader.dataset.deviceBinding = column.deviceBinding || '';
                fader.dataset.inputFader = 'true'; // Mark as input fader

                // Event listeners for input fader
                fader.addEventListener('fx-toggle', (e) => {
                    const deviceId = parseInt(fader.dataset.deviceId || 0);
                    // console.log(`[Dev${deviceId} Input] FX Toggle:`, e.detail.enabled);
                    // INPUT fader: toggle between 3 (input) and 0 (off)
                    const route = e.detail.enabled ? 3 : 0;
                    this.handleFxRouting(deviceId, route);
                });

                fader.addEventListener('pan-change', (e) => {
                    const deviceId = parseInt(fader.dataset.deviceId || 0);
                    // Convert from -100..100 to 0..127 (64 = center)
                    const panValue = this.convertPanToWire(e.detail.value);
                    // console.log(`[Dev${deviceId} Input] Pan: ${e.detail.value} -> ${panValue}`);
                    this.handleInputPan(deviceId, panValue);
                });

                fader.addEventListener('volume-change', (e) => {
                    const deviceId = parseInt(fader.dataset.deviceId || 0);
                    // console.log(`[Dev${deviceId} Input] Volume:`, e.detail.value);
                    this.handleInputVolume(deviceId, e.detail.value);
                });

                fader.addEventListener('mute-toggle', (e) => {
                    const deviceId = parseInt(fader.dataset.deviceId || 0);
                    // console.log(`[Dev${deviceId} Input] Mute:`, e.detail.muted);
                    this.handleInputMute(deviceId, e.detail.muted);
                });

            } else if (column.type === 'DECK') {
                // Mixxx DJ Deck fader (volume + mute)
                fader = document.createElement('deck-fader');
                const deck = column.deck || 1; // 1 or 2
                fader.setAttribute('deck', deck);
                fader.setAttribute('volume', '100');
                fader.setAttribute('muted', 'false');
                fader.dataset.deviceId = deviceConfig.deviceId;
                fader.dataset.deviceBinding = column.deviceBinding || '';
                fader.dataset.deck = deck;

                // Sync with Mixxx deck state if available
                if (this.controller.mixxxDeckState) {
                    const mixxxDeviceId = column.deviceBinding || 'mixxx';
                    const deviceState = this.controller.mixxxDeckState.get(mixxxDeviceId);
                    if (deviceState && deviceState.decks) {
                        const deckState = deviceState.decks[deck - 1]; // Convert 1-based to 0-based
                        if (deckState) {
                            const volumePercent = Math.round((deckState.volume / 127) * 100);
                            fader.setAttribute('volume', volumePercent.toString());
                            fader.setAttribute('muted', deckState.mute.toString());
                        }
                    }
                }

                // Event listeners for deck fader
                fader.addEventListener('volume-change', (e) => {
                    const deviceBinding = fader.dataset.deviceBinding || column.deviceBinding || 'mixxx';
                    this.handleDeckVolume(deviceBinding, deck, e.detail.value);
                });

                fader.addEventListener('mute-toggle', (e) => {
                    const deviceBinding = fader.dataset.deviceBinding || column.deviceBinding || 'mixxx';
                    this.handleDeckMute(deviceBinding, deck, e.detail.muted);
                });

            } else if (column.type === 'TEMPO') {
                fader = document.createElement('tempo-fader');
                fader.setAttribute('bpm', this.controller.config.bpm || '120');
                fader.dataset.deviceId = deviceConfig.deviceId;
                fader.dataset.deviceBinding = column.deviceBinding || '';

                // Event listeners for tempo fader
                fader.addEventListener('tempo-change', (e) => {
                    const deviceId = parseInt(fader.dataset.deviceId || 0);
                    // console.log(`[Dev${deviceId} Tempo] BPM:`, e.detail.bpm);
                    this.handleTempoChange(deviceId, e.detail.bpm);
                });

                fader.addEventListener('tempo-reset', (e) => {
                    const deviceId = parseInt(fader.dataset.deviceId || 0);
                    // console.log(`[Dev${deviceId} Tempo] Reset to 125`);
                    this.handleTempoChange(deviceId, 125);
                });

            } else if (column.type === 'STEREO') {
                fader = document.createElement('stereo-fader');
                fader.setAttribute('separation', '64'); // Default to 64 (≈100 = normal)
                fader.dataset.deviceId = deviceConfig.deviceId;
                fader.dataset.deviceBinding = column.deviceBinding || '';

                // Event listeners for stereo fader
                fader.addEventListener('separation-change', (e) => {
                    const deviceId = parseInt(fader.dataset.deviceId || 0);
                    const percent = Math.round((e.detail.separation / 127) * 200);
                    // console.log(`[Dev${deviceId} Stereo] Separation: ${e.detail.separation} (${percent}%)`);
                    this.handleStereoChange(deviceId, e.detail.separation);
                });

                fader.addEventListener('separation-reset', (e) => {
                    const deviceId = parseInt(fader.dataset.deviceId || 0);
                    // console.log(`[Dev${deviceId} Stereo] Reset to 64 (100%)`);
                    this.handleStereoChange(deviceId, 64);
                });

            } else if (column.type === 'PROGRAM') {
                // Samplecrate program fader
                fader = document.createElement('program-fader');
                fader.setAttribute('program', column.program || '0');
                // Include device name in label (smaller, grey font like sequencer)
                const programLabel = column.label || `PROG ${column.program || 0}`;
                const label = deviceName ? `${programLabel}<br><span style="font-size: 0.8em; opacity: 0.7;">${deviceName}</span>` : programLabel;
                fader.setAttribute('label', label);
                fader.setAttribute('volume', '100');
                fader.setAttribute('pan', '0');
                fader.setAttribute('fx', 'false');
                fader.setAttribute('muted', 'false');
                fader.dataset.deviceId = deviceConfig.deviceId;
                fader.dataset.deviceBinding = column.deviceBinding || '';

                // Event listeners for program fader
                fader.addEventListener('fx-toggle', (e) => {
                    const deviceId = parseInt(fader.dataset.deviceId || 0);
                    // console.log(`[Dev${deviceId} PROG${e.detail.program}] FX Toggle:`, e.detail.enabled);
                    this.handleProgramFxEnable(deviceId, e.detail.program, e.detail.enabled);
                });

                fader.addEventListener('pan-change', (e) => {
                    const deviceId = parseInt(fader.dataset.deviceId || 0);
                    // Convert from -100..100 to 0..127 (64 = center)
                    const panValue = this.convertPanToWire(e.detail.value);
                    // console.log(`[Dev${deviceId} PROG${e.detail.program}] Pan: ${e.detail.value} -> ${panValue}`);
                    this.handleProgramPan(deviceId, e.detail.program, panValue);
                });

                fader.addEventListener('volume-change', (e) => {
                    const deviceId = parseInt(fader.dataset.deviceId || 0);
                    // console.log(`[Dev${deviceId} PROG${e.detail.program}] Volume:`, e.detail.value);
                    this.handleProgramVolume(deviceId, e.detail.program, e.detail.value);
                });

                fader.addEventListener('mute-toggle', (e) => {
                    const deviceId = parseInt(fader.dataset.deviceId || 0);
                    // console.log(`[Dev${deviceId} PROG${e.detail.program}] Mute:`, e.detail.muted);
                    this.handleProgramMute(deviceId, e.detail.program, e.detail.muted);
                });
        } else if (column.type === 'SEQUENCER_TRACK') {
                // Sequencer track fader (volume/mute/solo for a specific track)
                const seqScene = this.scenes.get(column.sequencerScene);
                const seqName = seqScene ? seqScene.name : 'Unknown';

                fader = document.createElement('channel-fader');
                fader.setAttribute('channel', column.sequencerTrack - 1); // Display 1-4, internal 0-3
                fader.dataset.sequencerScene = column.sequencerScene;
                fader.dataset.sequencerTrack = column.sequencerTrack;
                fader.dataset.deviceName = seqName;
                fader.setAttribute('volume', '100');
                fader.setAttribute('pan', '0');
                fader.setAttribute('solo', 'false');
                fader.setAttribute('muted', 'false');

                // Get initial state from sequencer
                if (seqScene && seqScene.sequencerInstance) {
                    const engine = seqScene.sequencerInstance.engine;
                    const trackIdx = column.sequencerTrack - 1;
                    const volume = Math.round((engine.trackVolumes[trackIdx] / 127) * 100);
                    fader.setAttribute('volume', volume.toString());
                    fader.setAttribute('muted', engine.trackMutes[trackIdx].toString());
                    fader.setAttribute('solo', engine.isTrackSoloed(trackIdx).toString());
                }

                // Event listeners for sequencer track fader
                fader.addEventListener('solo-toggle', (e) => {
                    const seqScene = this.scenes.get(column.sequencerScene);
                    if (seqScene && seqScene.sequencerInstance) {
                        const trackIdx = column.sequencerTrack - 1;
                        seqScene.sequencerInstance.engine.toggleSolo(trackIdx);

                        // Update fader UI to reflect new state
                        const engine = seqScene.sequencerInstance.engine;
                        fader.setAttribute('solo', engine.isTrackSoloed(trackIdx).toString());
                        fader.setAttribute('muted', engine.trackMutes[trackIdx].toString());

                        // Update all other sequencer track faders in this scene
                        this.updateSequencerFaders(column.sequencerScene);
                    }
                });

                fader.addEventListener('mute-toggle', (e) => {
                    const seqScene = this.scenes.get(column.sequencerScene);
                    if (seqScene && seqScene.sequencerInstance) {
                        const trackIdx = column.sequencerTrack - 1;
                        seqScene.sequencerInstance.engine.toggleMute(trackIdx);

                        // Update fader UI to reflect new state
                        const engine = seqScene.sequencerInstance.engine;
                        fader.setAttribute('muted', engine.trackMutes[trackIdx].toString());
                        fader.setAttribute('solo', engine.isTrackSoloed(trackIdx).toString());
                    }
                });

                fader.addEventListener('volume-change', (e) => {
                    const seqScene = this.scenes.get(column.sequencerScene);
                    if (seqScene && seqScene.sequencerInstance) {
                        const trackIdx = column.sequencerTrack - 1;
                        // Convert 0-100 to 0-127
                        const volume = Math.round((e.detail.value / 100) * 127);
                        seqScene.sequencerInstance.engine.setTrackVolume(trackIdx, volume);
                    }
                });
        } else if (column.type === 'SEQUENCER_MASTER') {
                // Sequencer master fader (overall volume for all tracks)
                const seqScene = this.scenes.get(column.sequencerScene);
                const seqName = seqScene ? seqScene.name : 'Unknown';

                fader = document.createElement('mix-fader');
                fader.setAttribute('label', `Master<br><span style="font-size: 0.8em; opacity: 0.7;">${seqName}</span>`);
                fader.dataset.sequencerScene = column.sequencerScene;
                fader.setAttribute('volume', '100');
                fader.setAttribute('pan', '0');
                fader.setAttribute('fx', 'false');
                fader.setAttribute('muted', 'false');

                // Event listeners for sequencer master fader
                fader.addEventListener('volume-change', (e) => {
                    const seqScene = this.scenes.get(column.sequencerScene);
                    if (seqScene && seqScene.sequencerInstance) {
                        // Apply volume to all tracks
                        const volume = Math.round((e.detail.value / 100) * 127);
                        for (let track = 0; track < 4; track++) {
                            seqScene.sequencerInstance.engine.setTrackVolume(track, volume);
                        }
                    }
                });

                fader.addEventListener('mute-toggle', (e) => {
                    const seqScene = this.scenes.get(column.sequencerScene);
                    if (seqScene && seqScene.sequencerInstance) {
                        // Mute/unmute all tracks
                        for (let track = 0; track < 4; track++) {
                            seqScene.sequencerInstance.engine.trackMutes[track] = e.detail.muted;
                            if (e.detail.muted) {
                                seqScene.sequencerInstance.engine.stopTrackNote(track);
                            }
                        }
                    }
                });
        } else if (column.type === 'CC_FADER') {
                // Generic CC fader
                fader = document.createElement('cc-fader');
                const label = column.label || 'CC';
                const labelWithDevice = deviceName ? `${label}<br><span style="font-size: 0.8em; opacity: 0.7;">${deviceName}</span>` : label;
                fader.setAttribute('label', labelWithDevice);
                fader.setAttribute('cc', column.cc || '1');
                fader.setAttribute('value', column.value !== undefined ? column.value : '64');
                fader.setAttribute('min', column.min !== undefined ? column.min : '0');
                fader.setAttribute('max', column.max !== undefined ? column.max : '127');
                fader.dataset.deviceBinding = column.deviceBinding || '';

                // Event listener for CC changes
                fader.addEventListener('cc-change', (e) => {
                    const device = column.deviceBinding && this.controller.deviceManager
                        ? this.controller.deviceManager.getDevice(column.deviceBinding)
                        : null;

                    if (device) {
                        // Send CC to specific device
                        const midiOutput = this.controller.deviceManager.getMidiOutput(device.id);
                        if (midiOutput) {
                            const statusByte = 0xB0 + device.midiChannel; // CC on device's channel
                            midiOutput.send([statusByte, e.detail.cc, e.detail.value]);
                        }
                    } else {
                        // Send CC to default output
                        if (this.controller.midiOutput) {
                            const statusByte = 0xB0; // CC on channel 1
                            this.controller.midiOutput.send([statusByte, e.detail.cc, e.detail.value]);
                        }
                    }
                });
        } else if (column.type === 'DISPLAY') {
                // Display widget - shows device status
                // Supports colspan for taking up multiple slot widths
                const colspan = column.colspan || 1;

                fader = document.createElement('div');
                fader.style.cssText = `
                    flex: ${colspan} 1 0;
                    min-width: ${100 * colspan}px;
                    height: 100%;
                    min-height: 200px;
                    display: flex;
                    flex-direction: column;
                `;

                if (!column.deviceBinding) {
                    fader.innerHTML = '<div style="padding: 10px; color: #666; text-align: center; font-size: 0.8em;">Display Widget<br>(No device configured)</div>';
                } else {
                    const device = this.controller.deviceManager?.getDevice(column.deviceBinding);
                    if (!device) {
                        fader.innerHTML = '<div style="padding: 10px; color: #ff6666; text-align: center; font-size: 0.8em;">Display Widget<br>(Device not found)</div>';
                    } else {
                        // Create display-widget element
                        const displayWidget = document.createElement('display-widget');
                        displayWidget.setAttribute('device-id', column.deviceBinding);
                        displayWidget.setAttribute('device-type', device.type);
                        displayWidget.setAttribute('display-mode', column.displayMode || 'push');
                        displayWidget.setAttribute('update-interval', column.updateInterval || 100);

                        displayWidget.style.cssText = `
                            width: 100%;
                            height: 100%;
                        `;

                        fader.appendChild(displayWidget);
                    }
                }
        }

        return fader;
    }

    /**
     * Handle channel mute
     */
    handleChannelMute(deviceId, channel, muted) {
        // Send SysEx CHANNEL_MUTE (0x30) command
        // Note: We send the SET command directly (not toggle) since the fader tells us the state
        if (this.controller.sendSysExChannelMute) {
            this.controller.sendSysExChannelMute(deviceId, channel, muted ? 1 : 0);
        } else {
            // Fallback to CC for compatibility
            if (this.controller.sendRegrooveCC) {
                this.controller.sendRegrooveCC(48 + channel, 127, deviceId);
            } else {
                this.controller.sendCC(48 + channel, 127);
            }
        }
    }

    /**
     * Handle channel solo
     */
    handleChannelSolo(deviceId, channel, solo) {
        // Use the SAME method as pads - it works!
        const newSoloState = this.controller.toggleChannelSoloState(deviceId, channel);

        // Send SysEx CHANNEL_SOLO (0x31) command with the new state
        if (this.controller.sendSysExChannelSolo) {
            this.controller.sendSysExChannelSolo(deviceId, channel, newSoloState ? 1 : 0);
        } else {
            // Fallback to CC for compatibility
            if (this.controller.sendRegrooveCC) {
                this.controller.sendRegrooveCC(32 + channel, 127, deviceId);
            } else {
                this.controller.sendCC(32 + channel, 127);
            }
        }
    }

    /**
     * Handle channel volume
     */
    handleChannelVolume(deviceId, channel, volume) {
        // Send SysEx CHANNEL_VOLUME (0x32) command
        // volume: 0-127 value from the fader
        // console.log(`[Dev${deviceId}] Sending CH${channel} volume=${volume} via SysEx 0x32`);
        if (this.controller.sendSysExChannelVolume) {
            this.controller.sendSysExChannelVolume(deviceId, channel, volume);
        } else {
            console.warn(`[Dev${deviceId}] Channel volume SysEx command not available`);
        }
    }

    /**
     * Handle master volume
     */
    handleMasterVolume(deviceId, volume) {
        // Send SysEx MASTER_VOLUME (0x33) command
        // console.log(`[Dev${deviceId}] Sending Master volume=${volume} via SysEx 0x33`);
        if (this.controller.sendSysExMasterVolume) {
            this.controller.sendSysExMasterVolume(deviceId, volume);
        } else {
            console.warn(`[Dev${deviceId}] Master volume SysEx command not available`);
        }
    }

    /**
     * Handle master mute
     */
    handleMasterMute(deviceId, muted) {
        // Send SysEx MASTER_MUTE (0x34) command
        if (this.controller.sendSysExMasterMute) {
            this.controller.sendSysExMasterMute(deviceId, muted ? 1 : 0);
        } else {
            console.warn(`[Dev${deviceId}] Master mute SysEx command not available`);
        }
    }

    /**
     * Handle input volume
     */
    handleInputVolume(deviceId, volume) {
        // Send SysEx INPUT_VOLUME (0x35) command
        // console.log(`[Dev${deviceId}] Sending Input volume=${volume} via SysEx 0x35`);
        if (this.controller.sendSysExInputVolume) {
            this.controller.sendSysExInputVolume(deviceId, volume);
        } else {
            console.warn(`[Dev${deviceId}] Input volume SysEx command not available`);
        }
    }

    /**
     * Handle input mute
     */
    handleInputMute(deviceId, muted) {
        // Send SysEx INPUT_MUTE (0x36) command
        if (this.controller.sendSysExInputMute) {
            this.controller.sendSysExInputMute(deviceId, muted ? 1 : 0);
        } else {
            console.warn(`[Dev${deviceId}] Input mute SysEx command not available`);
        }
    }

    /**
     * Handle Mixxx deck volume
     */
    handleDeckVolume(deviceBinding, deck, volume) {
        // Send CC message to Mixxx for deck volume
        // CC mapping: Deck 1=0x11, Deck 2=0x12, Deck 3=0x40, Deck 4=0x41
        const ccMap = {
            1: 0x11,  // Channel 1 volume
            2: 0x12,  // Channel 2 volume
            3: 0x40,  // Channel 3 volume
            4: 0x41   // Channel 4 volume
        };
        const cc = ccMap[deck] || 0x11;

        // Get MIDI output (same pattern as sendControlMIDI)
        let midiOutput = this.controller.midiOutput; // Fallback to default
        let midiChannel = 0;

        if (deviceBinding && this.controller.deviceManager) {
            const device = this.controller.deviceManager.getDevice(deviceBinding);
            if (device) {
                const deviceOutput = this.controller.deviceManager.getMidiOutput(device.id);
                if (deviceOutput) {
                    midiOutput = deviceOutput;
                    midiChannel = device.midiChannel || 0;
                }
            }
        }

        if (midiOutput) {
            const status = 0xB0 + midiChannel; // Control Change on device's channel
            const message = [status, cc, volume];
            midiOutput.send(message);
        } else {
            console.warn(`[Mixxx] MIDI output not available for deck ${deck} volume (device: ${deviceBinding})`);
        }
    }

    /**
     * Handle Mixxx deck mute
     */
    handleDeckMute(deviceBinding, deck, muted) {
        // Send CC message to Mixxx for deck mute toggle
        // CC mapping: Deck 1=0x25, Deck 2=0x26, Deck 3=0x54, Deck 4=0x55 (volume +20)
        const ccMap = {
            1: 0x25,  // Channel 1 mute (0x11 + 20)
            2: 0x26,  // Channel 2 mute (0x12 + 20)
            3: 0x54,  // Channel 3 mute (0x40 + 20)
            4: 0x55   // Channel 4 mute (0x41 + 20)
        };
        const cc = ccMap[deck] || 0x25;

        // Get MIDI output (same pattern as sendControlMIDI)
        let midiOutput = this.controller.midiOutput; // Fallback to default
        let midiChannel = 0;

        if (deviceBinding && this.controller.deviceManager) {
            const device = this.controller.deviceManager.getDevice(deviceBinding);
            if (device) {
                const deviceOutput = this.controller.deviceManager.getMidiOutput(device.id);
                if (deviceOutput) {
                    midiOutput = deviceOutput;
                    midiChannel = device.midiChannel || 0;
                }
            }
        }

        if (midiOutput) {
            const status = 0xB0 + midiChannel; // Control Change on device's channel
            const value = muted ? 127 : 0; // Toggle value
            const message = [status, cc, value];
            midiOutput.send(message);
            // console.log(`[Mixxx Deck ${deck}] Mute: ${muted} (CC 0x${cc.toString(16)})`);
        } else {
            console.warn(`[Mixxx] MIDI output not available for deck ${deck} mute (device: ${deviceBinding})`);
        }
    }

    /**
     * Handle channel panning
     */
    handleChannelPan(deviceId, channel, pan) {
        // Send SysEx CHANNEL_PANNING (0x58) command
        // pan: 0-127 value (0=left, 64=center, 127=right)
        // console.log(`[Dev${deviceId}] Sending CH${channel} pan=${pan} via SysEx 0x58`);
        if (this.controller.sendSysExChannelPanning) {
            this.controller.sendSysExChannelPanning(deviceId, channel, pan);
        } else {
            console.warn(`[Dev${deviceId}] Channel panning SysEx command not available`);
        }
    }

    /**
     * Handle master panning
     */
    handleMasterPan(deviceId, pan) {
        // Send SysEx MASTER_PANNING (0x59) command
        // console.log(`[Dev${deviceId}] Sending Master pan=${pan} via SysEx 0x59`);
        if (this.controller.sendSysExMasterPanning) {
            this.controller.sendSysExMasterPanning(deviceId, pan);
        } else {
            console.warn(`[Dev${deviceId}] Master panning SysEx command not available`);
        }
    }

    /**
     * Handle input panning
     */
    handleInputPan(deviceId, pan) {
        // Send SysEx INPUT_PANNING (0x5A) command
        // console.log(`[Dev${deviceId}] Sending Input pan=${pan} via SysEx 0x5A`);
        if (this.controller.sendSysExInputPanning) {
            this.controller.sendSysExInputPanning(deviceId, pan);
        } else {
            console.warn(`[Dev${deviceId}] Input panning SysEx command not available`);
        }
    }

    /**
     * Handle FX routing
     * FX routing is mutex: 0=none, 1=master, 2=playback, 3=input
     * Each fader sets its own route or turns off
     */
    handleFxRouting(deviceId, route) {
        // Send SysEx FX_SET_ROUTE (0x37) command
        if (this.controller.sendSysExFxSetRoute) {
            this.controller.sendSysExFxSetRoute(deviceId, route);
        } else {
            console.warn(`[Dev${deviceId}] FX routing SysEx command not available`);
        }
    }

    /**
     * Handle tempo change
     */
    handleTempoChange(deviceId, bpm) {
        // Send SysEx SET_TEMPO (0x42) command
        // console.log(`[Dev${deviceId}] Sending Tempo BPM=${bpm} via SysEx 0x42`);
        if (this.controller.sendSysExSetTempo) {
            this.controller.sendSysExSetTempo(deviceId, bpm);
        } else {
            console.warn(`[Dev${deviceId}] Tempo SysEx command not available`);
            // Fallback to old clock-based method
            if (this.controller.setBPM) {
                this.controller.setBPM(bpm);
            } else {
                this.controller.clockBPM = bpm;
                this.controller.config.bpm = bpm;

                // Update clock BPM dynamically if running (no restart!)
                if (this.controller.clockMaster && this.controller.updateClockBPM) {
                    this.controller.updateClockBPM(bpm);
                }
            }
        }
    }

    /**
     * Handle stereo separation change
     */
    handleStereoChange(deviceId, separation) {
        // Send SysEx STEREO_SEPARATION (0x57) command
        const percent = Math.round((separation / 127) * 200);
        // console.log(`[Dev${deviceId}] Sending Stereo Separation=${separation} (${percent}%) via SysEx 0x57`);
        if (this.controller.sendSysExStereoSeparation) {
            this.controller.sendSysExStereoSeparation(deviceId, separation);
        } else {
            console.warn(`[Dev${deviceId}] Stereo separation SysEx command not available`);
        }
    }

    /**
     * Update all sequencer faders for a given sequencer scene
     */
    updateSequencerFaders(sequencerSceneId) {
        const seqScene = this.scenes.get(sequencerSceneId);
        if (!seqScene || !seqScene.sequencerInstance) return;

        const engine = seqScene.sequencerInstance.engine;

        // Find all faders that reference this sequencer (search entire document, not just one container)
        const sequencerFaders = document.querySelectorAll('channel-fader[data-sequencer-scene]');
        sequencerFaders.forEach(fader => {
            if (fader.dataset.sequencerScene === sequencerSceneId) {
                const trackIdx = parseInt(fader.dataset.sequencerTrack) - 1;
                fader.setAttribute('muted', engine.trackMutes[trackIdx].toString());
                fader.setAttribute('solo', engine.isTrackSoloed(trackIdx).toString());
                // console.log(`[SceneManager] Updated fader for track ${trackIdx}: muted=${engine.trackMutes[trackIdx]}, solo=${engine.isTrackSoloed(trackIdx)}`);
            }
        });
    }

    /**
     * Handle program volume (Samplecrate)
     */
    handleProgramVolume(deviceId, program, volume) {
        // Send SysEx CHANNEL_VOLUME (0x32) command
        // For Samplecrate: program = program_id (0-31), volume = 0-127
        // console.log(`[Dev${deviceId}] Sending PROG${program} volume=${volume} via SysEx 0x32`);
        if (this.controller.sendSysExChannelVolume) {
            this.controller.sendSysExChannelVolume(deviceId, program, volume);
        } else {
            console.warn(`[Dev${deviceId}] Program volume SysEx command not available`);
        }
    }

    /**
     * Handle program panning (Samplecrate)
     */
    handleProgramPan(deviceId, program, pan) {
        // Send SysEx CHANNEL_PANNING (0x58) command
        // For Samplecrate: program = program_id (0-31), pan = 0-127
        // console.log(`[Dev${deviceId}] Sending PROG${program} pan=${pan} via SysEx 0x58`);
        if (this.controller.sendSysExChannelPanning) {
            this.controller.sendSysExChannelPanning(deviceId, program, pan);
        } else {
            console.warn(`[Dev${deviceId}] Program panning SysEx command not available`);
        }
    }

    /**
     * Handle program mute (Samplecrate)
     */
    handleProgramMute(deviceId, program, muted) {
        // Send SysEx CHANNEL_MUTE (0x30) command
        // For Samplecrate: program = program_id (0-31), muted = 0/1
        if (this.controller.sendSysExChannelMute) {
            this.controller.sendSysExChannelMute(deviceId, program, muted ? 1 : 0);
        } else {
            console.warn(`[Dev${deviceId}] Program mute SysEx command not available`);
        }
    }

    /**
     * Handle program FX enable (Samplecrate)
     */
    handleProgramFxEnable(deviceId, program, enabled) {
        // Send SysEx CHANNEL_FX_ENABLE (0x38) command
        // For Samplecrate: program = program_id (0-31), enabled = 0/1
        // console.log(`[Dev${deviceId}] Sending PROG${program} FX=${enabled ? 'ON' : 'OFF'} via SysEx 0x38`);
        if (this.controller.sendSysExChannelFxEnable) {
            this.controller.sendSysExChannelFxEnable(deviceId, program, enabled ? 1 : 0);
        } else {
            console.warn(`[Dev${deviceId}] Program FX enable SysEx command not available`);
        }
    }

    /**
     * Update scene selector UI
     */
    updateSceneSelector() {
        const selector = document.getElementById('scene-selector');
        if (!selector) return;

        // Get current scene
        const scene = this.scenes.get(this.currentScene);
        if (scene) {
            // Set button text to current scene name
            selector.textContent = scene.name;
        }
    }

    /**
     * Get all available scenes
     */
    getScenes(includeDisabled = false) {
        return Array.from(this.scenes.entries())
            .filter(([id, scene]) => includeDisabled || scene.enabled !== false)
            .map(([id, scene]) => ({
                id,
                name: scene.name,
                type: scene.type,
                enabled: scene.enabled !== false
            }));
    }

    /**
     * Get the first enabled scene ID
     */
    getFirstEnabledScene() {
        const enabledScenes = this.getScenes(false); // Only enabled scenes
        return enabledScenes.length > 0 ? enabledScenes[0].id : null;
    }

    /**
     * Switch to first enabled scene if current scene is disabled
     */
    switchToFirstEnabledIfNeeded() {
        const currentScene = this.scenes.get(this.currentScene);

        // If current scene is disabled or doesn't exist, switch to first enabled
        if (!currentScene || currentScene.enabled === false) {
            const firstEnabled = this.getFirstEnabledScene();
            if (firstEnabled) {
                // console.log(`[SceneManager] Current scene disabled, switching to ${firstEnabled}`);
                this.switchScene(firstEnabled);
            } else {
                console.warn('[SceneManager] No enabled scenes found!');
            }
        }
    }

    /**
     * Update mixer faders from device state
     */
    updateMixerFromDeviceState(deviceId, deviceState) {
        const scene = this.scenes.get(this.currentScene);
        if (!scene || !['slider', 'split'].includes(scene.type)) return;

        const container = document.getElementById('pads-grid');
        if (!container) return;

        // Update MIX and INPUT faders for this device
        const mixFaders = container.querySelectorAll('mix-fader');
        mixFaders.forEach(mixFader => {
            const faderDeviceId = parseInt(mixFader.dataset.deviceId || 0);
            if (faderDeviceId !== deviceId) return;

            // Check if user is currently changing the volume
            if (mixFader.dataset.volumeChanging === 'true') {
                return; // Skip update while user is adjusting volume
            }

            const isInputFader = mixFader.dataset.inputFader === 'true';

            if (isInputFader) {
                // Update INPUT fader
                if (deviceState.inputVolume !== undefined) {
                    const volumePercent = Math.round((deviceState.inputVolume / 127) * 100);
                    mixFader.setAttribute('volume', volumePercent.toString());
                }
                if (deviceState.inputMute !== undefined) {
                    mixFader.setAttribute('muted', deviceState.inputMute ? 'true' : 'false');
                }
                if (deviceState.inputPan !== undefined) {
                    // Convert from 0..127 to -100..100 (64 = center = 0)
                    const panValue = this.convertPanToUI(deviceState.inputPan);
                    mixFader.setAttribute('pan', panValue.toString());
                }
                // Update FX routing state - INPUT fader: yellow if route=3, red if route=1/2, off if route=0
                if (deviceState.fxRouting !== undefined) {
                    let fxState = 'false';
                    if (deviceState.fxRouting === 3) {
                        fxState = 'active'; // Yellow - enabled for input
                    } else if (deviceState.fxRouting !== 0) {
                        fxState = 'warning'; // Red - enabled elsewhere
                    }
                    mixFader.setAttribute('fx', fxState);
                    mixFader.dataset.fxRoute = deviceState.fxRouting.toString();
                }
            } else {
                // Update MASTER/MIX fader
                if (deviceState.masterVolume !== undefined) {
                    const volumePercent = Math.round((deviceState.masterVolume / 127) * 100);
                    mixFader.setAttribute('volume', volumePercent.toString());
                    mixFader.setAttribute('muted', deviceState.masterMute ? 'true' : 'false');
                }
                if (deviceState.masterPan !== undefined) {
                    // Convert from 0..127 to -100..100 (64 = center = 0)
                    const panValue = this.convertPanToUI(deviceState.masterPan);
                    mixFader.setAttribute('pan', panValue.toString());
                }
                // Update FX routing state - MASTER fader: yellow if route=1, red if route=2/3, off if route=0
                if (deviceState.fxRouting !== undefined) {
                    let fxState = 'false';
                    if (deviceState.fxRouting === 1) {
                        fxState = 'active'; // Yellow - enabled for master
                    } else if (deviceState.fxRouting !== 0) {
                        fxState = 'warning'; // Red - enabled elsewhere
                    }
                    mixFader.setAttribute('fx', fxState);
                    // Store the current route for toggle logic
                    mixFader.dataset.fxRoute = deviceState.fxRouting.toString();
                }
            }
        });

        // Update CHANNEL faders for this device
        const channelFaders = container.querySelectorAll('channel-fader');
        channelFaders.forEach(fader => {
            const faderDeviceId = parseInt(fader.dataset.deviceId || 0);
            if (faderDeviceId !== deviceId) return; // Skip faders for other devices

            // Check if user is currently changing the volume
            if (fader.dataset.volumeChanging === 'true') {
                return; // Skip update while user is adjusting volume
            }

            const channel = parseInt(fader.getAttribute('channel'));

            // Update mute state
            const isMuted = deviceState.mutedChannels.includes(channel);
            fader.setAttribute('muted', isMuted.toString());

            // Update solo state - INFER from mute state like pads do
            const isSoloed = this.controller.isChannelSolo(channel, deviceState);
            fader.setAttribute('solo', isSoloed.toString());

            // Update volume if available
            if (deviceState.channelVolumes && deviceState.channelVolumes[channel] !== undefined) {
                const volumePercent = Math.round((deviceState.channelVolumes[channel] / 127) * 100);
                fader.setAttribute('volume', volumePercent.toString());
            }

            // Update pan if available
            if (deviceState.channelPans && deviceState.channelPans[channel] !== undefined) {
                // Convert from 0..127 to -100..100 (64 = center = 0)
                const panValue = this.convertPanToUI(deviceState.channelPans[channel]);
                fader.setAttribute('pan', panValue.toString());
            }
        });

        // Update TEMPO faders for this device
        const tempoFaders = container.querySelectorAll('tempo-fader');
        tempoFaders.forEach(fader => {
            const faderDeviceId = parseInt(fader.dataset.deviceId || 0);
            if (faderDeviceId !== deviceId) return; // Skip faders for other devices

            // Check if user is currently changing the tempo
            if (fader.dataset.tempoChanging === 'true') {
                return; // Skip update while user is adjusting tempo
            }

            // Update BPM from device state
            if (deviceState.bpm !== undefined) {
                fader.setAttribute('bpm', deviceState.bpm.toString());
            }
        });

        // Update STEREO faders for this device
        const stereoFaders = container.querySelectorAll('stereo-fader');
        stereoFaders.forEach(fader => {
            const faderDeviceId = parseInt(fader.dataset.deviceId || 0);
            if (faderDeviceId !== deviceId) return; // Skip faders for other devices

            // Check if user is currently changing the separation
            if (fader.dataset.separationChanging === 'true') {
                return; // Skip update while user is adjusting separation
            }

            // Update stereo separation from device state
            if (deviceState.stereoSeparation !== undefined) {
                fader.setAttribute('separation', deviceState.stereoSeparation.toString());
            }
        });

        // Update PROGRAM faders for this device (Samplecrate)
        const programFaders = container.querySelectorAll('program-fader');
        programFaders.forEach(fader => {
            const faderDeviceId = parseInt(fader.dataset.deviceId || 0);
            if (faderDeviceId !== deviceId) return; // Skip faders for other devices

            // Check if user is currently changing the volume
            if (fader.dataset.volumeChanging === 'true') {
                return; // Skip update while user is adjusting volume
            }

            const program = parseInt(fader.getAttribute('program'));

            // Update mute state (Samplecrate stores program mutes similar to channel mutes)
            if (deviceState.mutedChannels) {
                const isMuted = deviceState.mutedChannels.includes(program);
                fader.setAttribute('muted', isMuted.toString());
            }

            // Update FX enable state (Samplecrate per-program FX)
            if (deviceState.programFxEnabled && deviceState.programFxEnabled[program] !== undefined) {
                fader.setAttribute('fx', deviceState.programFxEnabled[program] ? 'true' : 'false');
            }

            // Update volume if available
            if (deviceState.channelVolumes && deviceState.channelVolumes[program] !== undefined) {
                const volumePercent = Math.round((deviceState.channelVolumes[program] / 127) * 100);
                fader.setAttribute('volume', volumePercent.toString());
            }

            // Update pan if available
            if (deviceState.channelPans && deviceState.channelPans[program] !== undefined) {
                // Convert from 0..127 to -100..100 (64 = center = 0)
                const panValue = this.convertPanToUI(deviceState.channelPans[program]);
                fader.setAttribute('pan', panValue.toString());
            }
        });
    }

    /**
     * Update program faders from Samplecrate program state (0x65 response)
     */
    updateProgramFadersFromState(deviceId, programState) {
        const scene = this.scenes.get(this.currentScene);
        if (!scene || !['slider', 'split'].includes(scene.type)) return;

        const container = document.getElementById('pads-grid');
        if (!container) return;

        // Get device by deviceId (string ID)
        const device = this.controller.deviceManager?.getDevice(deviceId);
        if (!device) return;

        // Update PROGRAM faders for this device
        const programFaders = container.querySelectorAll('program-fader');
        programFaders.forEach(fader => {
            const faderDeviceBinding = fader.dataset.deviceBinding;
            if (faderDeviceBinding !== deviceId) return; // Skip faders for other devices

            // Check if user is currently changing the volume
            if (fader.dataset.volumeChanging === 'true') {
                return; // Skip update while user is adjusting volume
            }

            const programNum = parseInt(fader.getAttribute('program'));
            const programData = programState.programs[programNum];

            if (!programData) return;

            // Update volume (convert wire 0-127 to percentage 0-100)
            const volumePercent = Math.round((programData.volume / 127) * 100);
            fader.setAttribute('volume', volumePercent.toString());

            // Update pan (convert from 0-127 to -100..100)
            const panValue = this.convertPanToUI(programData.pan);
            fader.setAttribute('pan', panValue.toString());

            // Update mute state
            fader.setAttribute('muted', programData.muted.toString());

            // Update FX enable state (now included in PROGRAM_STATE_RESPONSE)
            if (programData.fxEnabled !== undefined) {
                fader.setAttribute('fx', programData.fxEnabled ? 'true' : 'false');
            }
        });

        // Update MASTER fader for this device (if showing master volume)
        const mixFaders = container.querySelectorAll('mix-fader');
        mixFaders.forEach(mixFader => {
            const faderDeviceBinding = mixFader.dataset.deviceBinding;
            if (faderDeviceBinding !== deviceId) return;

            // Check if user is currently changing the volume
            if (mixFader.dataset.volumeChanging === 'true') {
                return;
            }

            // Update master volume (convert wire 0-127 to percentage 0-100)
            const volumePercent = Math.round((programState.master.volume / 127) * 100);
            mixFader.setAttribute('volume', volumePercent.toString());

            // Update master pan (convert from 0-127 to -100..100)
            const panValue = this.convertPanToUI(programState.master.pan);
            mixFader.setAttribute('pan', panValue.toString());

            // Update master mute
            mixFader.setAttribute('muted', programState.master.mute.toString());
        });
    }

    /**
     * Update mixer faders from player state (backward compat)
     */
    updateMixerFromState() {
        if (this.currentScene !== 'mixer') return;
        if (!this.controller.playerState) return;

        const deviceId = this.controller.playerState.deviceId || 0;
        this.updateMixerFromDeviceState(deviceId, this.controller.playerState);
    }

    /**
     * Update effects UI from device state
     */
    updateEffectsFromDeviceState(deviceId, deviceState) {
        const scene = this.scenes.get(this.currentScene);
        if (!scene || scene.type !== 'effects') return;

        const container = document.getElementById('pads-grid');
        if (!container) return;

        // Get FX state for the current scene's program ID
        const programId = scene.programId || 0;
        const fxState = deviceState.fxStates?.[programId];

        // Check if we have effects state for this program
        if (!fxState || !fxState.effects) return;

        // console.log(`[Effects] Updating UI from device ${deviceId} program ${programId} state:`, fxState);

        // Map effect IDs to effect names
        const effectMap = {
            0x00: 'distortion',
            0x01: 'filter',
            0x02: 'eq',
            0x03: 'reverb',
            0x04: 'delay'
        };

        // Update each effect group
        for (const [effectId, effectName] of Object.entries(effectMap)) {
            const effect = fxState.effects[effectName];
            if (!effect) continue;

            const effectIdNum = parseInt(effectId);

            // Update enable button - match mixer FX button style
            const enableBtn = container.querySelector(`.fx-enable-btn[data-effect-id="${effectIdNum}"]`);
            if (enableBtn) {
                if (effect.enabled) {
                    enableBtn.classList.add('active');
                    enableBtn.style.background = '#ccaa44';
                    enableBtn.style.color = '#fff';
                } else {
                    enableBtn.classList.remove('active');
                    enableBtn.style.background = '#2a2a2a';
                    enableBtn.style.color = '#aaa';
                }
            }

            // Update parameter sliders
            const faders = container.querySelectorAll(`effects-fader[data-effect-id="${effectIdNum}"]`);
            faders.forEach((fader, paramIndex) => {
                // Check if user is currently changing this parameter
                if (fader.dataset.paramChanging === 'true') {
                    return; // Skip update while user is adjusting parameter
                }

                const params = Object.keys(effect).filter(k => k !== 'enabled');
                const paramName = params[paramIndex];
                if (paramName && effect[paramName] !== undefined) {
                    fader.setAttribute('value', effect[paramName].toString());
                }
            });
        }
    }

    /**
     * Setup swipe gesture controls for scene switching
     * DISABLED - Gestures removed to prevent interference with interactive elements
     */
    setupGestureControls() {
        // Gesture detection disabled - use quick selector button in status bar instead
    }

    /**
     * Setup quick scene selector
     */
    setupQuickSelector() {
        this.refreshQuickSelector();
    }

    /**
     * Toggle quick selector visibility
     */
    toggleQuickSelector() {
        const selector = document.getElementById('scene-quick-selector');
        if (selector) {
            selector.classList.toggle('active');
            if (selector.classList.contains('active')) {
                this.refreshQuickSelector();
            }
        }
    }

    /**
     * Refresh quick selector content
     */
    refreshQuickSelector() {
        const container = document.getElementById('scene-quick-list');
        if (!container) return;

        const scenes = this.getScenes();
        const currentScene = this.currentScene;

        container.innerHTML = scenes.map(scene => {
            let typeLabel = 'Slider';
            if (scene.type === 'grid') typeLabel = 'Grid';
            else if (scene.type === 'effects') typeLabel = 'Effects';
            else if (scene.type === 'piano') typeLabel = 'Piano';
            else if (scene.type === 'split') typeLabel = 'Split';
            else if (scene.type === 'sequencer') typeLabel = 'Sequencer';

            return `
                <div class="scene-quick-item ${scene.id === currentScene ? 'active' : ''}"
                     data-scene-id="${scene.id}">
                    <div class="scene-quick-item-name">${scene.name}</div>
                    <div class="scene-quick-item-type">${typeLabel}</div>
                </div>
            `;
        }).join('');

        // Add click handlers
        container.querySelectorAll('.scene-quick-item').forEach(item => {
            item.addEventListener('click', () => {
                const sceneId = item.getAttribute('data-scene-id');
                this.switchScene(sceneId);
                this.toggleQuickSelector();
            });
        });
    }

    // Old scene-specific polling methods removed - now using regrooveState.startPolling() exclusively

    /**
     * Render piano keyboard scene
     */
    renderPianoScene(sceneId = 'piano') {
        const container = document.getElementById('pads-grid');
        if (!container) return;

        // Clear and setup container
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '10px';
        container.style.padding = '10px';
        container.style.justifyContent = 'flex-start';
        container.style.alignItems = 'center';
        container.style.height = 'calc(100vh - 60px)';
        container.style.overflow = 'hidden';
        container.innerHTML = '';

        // Get scene
        const scene = this.scenes.get(sceneId);
        if (!scene) {
            console.error(`[Piano] Scene "${sceneId}" not found`);
            return;
        }

        // Create header with octave controls
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.gap = '10px';
        header.style.alignItems = 'center';
        header.style.padding = '8px 12px';
        header.style.background = '#1a1a1a';
        header.style.borderRadius = '4px';
        header.style.flexShrink = '0';
        header.style.width = '100%';

        // Octave down button
        const octaveDownBtn = document.createElement('button');
        octaveDownBtn.textContent = 'OCT -';
        octaveDownBtn.style.padding = '8px 16px';
        octaveDownBtn.style.background = '#2a2a2a';
        octaveDownBtn.style.color = '#aaa';
        octaveDownBtn.style.border = '1px solid #333';
        octaveDownBtn.style.borderRadius = '4px';
        octaveDownBtn.style.cursor = 'pointer';
        octaveDownBtn.style.fontSize = '0.9em';
        octaveDownBtn.style.fontWeight = 'bold';
        octaveDownBtn.addEventListener('click', () => {
            if (scene.octave > 0) {
                scene.octave--;
                this.renderPianoScene(sceneId);
            }
        });

        // Octave label
        const octaveLabel = document.createElement('div');
        octaveLabel.style.color = '#666';
        octaveLabel.style.fontSize = '0.9em';
        octaveLabel.style.fontWeight = 'bold';
        octaveLabel.style.padding = '8px 16px';
        octaveLabel.style.background = '#0a0a0a';
        octaveLabel.style.borderRadius = '4px';
        octaveLabel.style.minWidth = '100px';
        octaveLabel.style.textAlign = 'center';
        octaveLabel.textContent = `OCT ${scene.octave}`;

        // Octave up button
        const octaveUpBtn = document.createElement('button');
        octaveUpBtn.textContent = 'OCT +';
        octaveUpBtn.style.padding = '8px 16px';
        octaveUpBtn.style.background = '#2a2a2a';
        octaveUpBtn.style.color = '#aaa';
        octaveUpBtn.style.border = '1px solid #333';
        octaveUpBtn.style.borderRadius = '4px';
        octaveUpBtn.style.cursor = 'pointer';
        octaveUpBtn.style.fontSize = '0.9em';
        octaveUpBtn.style.fontWeight = 'bold';
        octaveUpBtn.addEventListener('click', () => {
            if (scene.octave < 8) {
                scene.octave++;
                this.renderPianoScene(sceneId);
            }
        });

        // Device and channel info
        const deviceLabel = document.createElement('div');
        deviceLabel.style.color = '#666';
        deviceLabel.style.fontSize = '0.9em';
        deviceLabel.style.fontWeight = 'bold';
        deviceLabel.style.padding = '8px 16px';
        deviceLabel.style.background = '#0a0a0a';
        deviceLabel.style.borderRadius = '4px';

        // Resolve device from binding
        let device = null;
        if (scene.deviceBinding && this.controller.deviceManager) {
            device = this.controller.deviceManager.getDevice(scene.deviceBinding);
        }

        if (device) {
            deviceLabel.textContent = `${device.name} (CH ${scene.midiChannel + 1} / ID ${device.deviceId})`;
        } else {
            deviceLabel.textContent = `DEFAULT (CH ${scene.midiChannel + 1})`;
        }

        // Program down button
        const programDownBtn = document.createElement('button');
        programDownBtn.textContent = 'PROG -';
        programDownBtn.style.padding = '8px 16px';
        programDownBtn.style.background = '#2a2a2a';
        programDownBtn.style.color = '#aaa';
        programDownBtn.style.border = '1px solid #333';
        programDownBtn.style.borderRadius = '4px';
        programDownBtn.style.cursor = 'pointer';
        programDownBtn.style.fontSize = '0.9em';
        programDownBtn.style.fontWeight = 'bold';
        programDownBtn.addEventListener('click', () => {
            if (scene.program > -1) {
                scene.program--;
                if (scene.program >= 0) {
                    this.sendProgramChange(scene, scene.program);
                }
                this.renderPianoScene(sceneId);
            }
        });

        // Program label
        const programLabel = document.createElement('div');
        programLabel.style.color = '#666';
        programLabel.style.fontSize = '0.9em';
        programLabel.style.fontWeight = 'bold';
        programLabel.style.padding = '8px 16px';
        programLabel.style.background = '#0a0a0a';
        programLabel.style.borderRadius = '4px';
        programLabel.style.minWidth = '100px';
        programLabel.style.textAlign = 'center';
        programLabel.textContent = scene.program >= 0 ? `PROG ${scene.program + 1}` : 'NO PROG'; // Display as 1-128 (user-facing)

        // Program up button
        const programUpBtn = document.createElement('button');
        programUpBtn.textContent = 'PROG +';
        programUpBtn.style.padding = '8px 16px';
        programUpBtn.style.background = '#2a2a2a';
        programUpBtn.style.color = '#aaa';
        programUpBtn.style.border = '1px solid #333';
        programUpBtn.style.borderRadius = '4px';
        programUpBtn.style.cursor = 'pointer';
        programUpBtn.style.fontSize = '0.9em';
        programUpBtn.style.fontWeight = 'bold';
        programUpBtn.addEventListener('click', () => {
            if (scene.program < 127) {
                scene.program++;
                this.sendProgramChange(scene, scene.program);
                this.renderPianoScene(sceneId);
            }
        });

        header.appendChild(octaveDownBtn);
        header.appendChild(octaveLabel);
        header.appendChild(octaveUpBtn);
        header.appendChild(deviceLabel);
        header.appendChild(programDownBtn);
        header.appendChild(programLabel);
        header.appendChild(programUpBtn);
        container.appendChild(header);

        // Send program change if scene has a program set
        if (scene.program >= 0) {
            this.sendProgramChange(scene, scene.program);
        }

        // Create piano keyboard container
        const keyboardContainer = document.createElement('div');
        keyboardContainer.style.position = 'relative';
        keyboardContainer.style.width = '100%';
        keyboardContainer.style.flex = '1';
        keyboardContainer.style.display = 'flex';
        keyboardContainer.style.alignItems = 'stretch';
        keyboardContainer.style.justifyContent = 'center';
        keyboardContainer.style.padding = '0 10px';
        keyboardContainer.style.minHeight = '0';
        keyboardContainer.id = 'piano-keyboard-container';

        // Detect screen width to determine number of octaves
        const screenWidth = window.innerWidth;
        const numOctaves = screenWidth >= 768 ? 2 : 1; // 2 octaves on tablets/desktops, 1 on phones

        // Resolve MIDI output and channel from device binding
        let midiOutput = this.controller.midiOutput; // Default output
        let midiChannel = scene.midiChannel || 0; // Scene's MIDI channel

        if (scene.deviceBinding && this.controller.deviceManager) {
            const boundDevice = this.controller.deviceManager.getDevice(scene.deviceBinding);
            if (boundDevice) {
                // Use device-specific output and channel
                const deviceOutput = this.controller.deviceManager.getMidiOutput(boundDevice.id);
                if (deviceOutput) {
                    midiOutput = deviceOutput;
                    midiChannel = boundDevice.midiChannel; // Use device's channel, not scene's
                } else {
                    console.warn(`[Piano] No MIDI output found for device ${boundDevice.name}, using default`);
                }
            } else {
                console.warn(`[Piano] Device binding ${scene.deviceBinding} not found, using default output`);
            }
        }

        // Helper function to send note on/off
        const sendNote = (noteNumber, velocity) => {
            if (!midiOutput) {
                console.warn('[Piano] No MIDI output available');
                return;
            }

            const statusByte = velocity > 0 ? (0x90 + midiChannel) : (0x80 + midiChannel);
            midiOutput.send([statusByte, noteNumber, velocity]);
        };

        // Create PianoKeyboard instance using reusable component
        const piano = new PianoKeyboard(keyboardContainer, {
            octaves: numOctaves,
            baseOctave: scene.octave,
            showLabels: true,
            enableTouch: true,
            enableMouse: true
        });

        // Listen for note events
        piano.addEventListener('noteon', (e) => {
            sendNote(e.detail.note, e.detail.velocity);
        });

        piano.addEventListener('noteoff', (e) => {
            sendNote(e.detail.note, 0);
        });

        // Append keyboard to container
        container.appendChild(keyboardContainer);
    }

    /**
     * Send MIDI program change message
     * @param {Object} scene - Piano scene object with deviceBinding and midiChannel
     * @param {number} program - Program number (0-127)
     */
    sendProgramChange(scene, program) {
        // Resolve MIDI output and channel from device binding
        let midiOutput = this.controller.midiOutput; // Default output
        let midiChannel = scene.midiChannel || 0; // Scene's MIDI channel

        if (scene.deviceBinding && this.controller.deviceManager) {
            const boundDevice = this.controller.deviceManager.getDevice(scene.deviceBinding);
            if (boundDevice) {
                // Use device-specific output and channel
                const deviceOutput = this.controller.deviceManager.getMidiOutput(boundDevice.id);
                if (deviceOutput) {
                    midiOutput = deviceOutput;
                    midiChannel = boundDevice.midiChannel; // Use device's channel
                    // console.log(`[Piano] Sending Program Change via device: ${boundDevice.name}, channel ${midiChannel + 1}`);
                } else {
                    console.warn(`[Piano] No MIDI output found for device ${boundDevice.name}, using default`);
                }
            } else {
                console.warn(`[Piano] Device binding ${scene.deviceBinding} not found, using default output`);
            }
        }

        if (!midiOutput) {
            console.warn('[Piano] No MIDI output available for program change');
            return;
        }

        // MIDI Program Change: 0xC0-0xCF (channel) + program number (0-127 on wire, 1-128 user-facing)
        const statusByte = 0xC0 + midiChannel;
        midiOutput.send([statusByte, program]);
        // console.log(`[Piano] Sent Program Change: CH ${midiChannel + 1} -> Program ${program + 1} (wire: ${program})`);
    }

    /**
     * Render sequencer scene
     */
    renderSequencerScene(sceneId) {
        const scene = this.scenes.get(sceneId);
        if (!scene) {
            console.error(`[Sequencer] Scene "${sceneId}" not found`);
            return;
        }

        // Create or reuse SequencerScene instance
        if (!scene.sequencerInstance || scene.sequencerInstance.sceneId !== sceneId) {
            // Destroy old instance if exists
            if (scene.sequencerInstance) {
                scene.sequencerInstance.destroy();
            }

            // Create new instance
            if (window.SequencerScene) {
                scene.sequencerInstance = new window.SequencerScene(this.controller, sceneId, scene);
                // console.log(`[Sequencer] Created new sequencer instance for scene: ${scene.name}`);
            } else {
                console.error('[Sequencer] SequencerScene class not available');
                return;
            }
        } else {
            // Re-render existing instance
            scene.sequencerInstance.render();

            // Resume the scene (restart UI updates and MIDI input)
            // console.log(`[Sequencer] Resuming sequencer scene: ${scene.name}`);
            scene.sequencerInstance.resume();
        }
    }

    /**
     * Render Control Grid scene - flexible grid with multiple control types
     */
    renderControlGridScene(sceneId) {
        const container = document.getElementById('pads-grid');
        if (!container) return;

        const scene = this.scenes.get(sceneId);
        if (!scene) {
            console.error(`[ControlGrid] Scene "${sceneId}" not found`);
            return;
        }

        // Clear container and match pad grid styling
        container.removeAttribute('style');
        container.style.display = 'grid';
        container.style.gridTemplateColumns = `repeat(${scene.cols}, 1fr)`;
        container.style.gridTemplateRows = `repeat(${scene.rows}, 1fr)`;
        container.style.gap = '10px';
        container.style.padding = '10px 10px 4px 10px';
        container.style.height = 'calc(100vh - 60px)';
        container.innerHTML = '';

        // Track occupied positions to avoid overlapping spanning cells
        const occupiedPositions = new Set();

        // Create cells from config (handles spanning)
        scene.cells.forEach(cellConfig => {
            const cell = this.createGridCell(cellConfig, sceneId);

            // Apply grid positioning
            cell.style.gridRow = `${cellConfig.row + 1} / span ${cellConfig.rowSpan || 1}`;
            cell.style.gridColumn = `${cellConfig.col + 1} / span ${cellConfig.colSpan || 1}`;

            // Mark positions as occupied
            for (let r = cellConfig.row; r < cellConfig.row + (cellConfig.rowSpan || 1); r++) {
                for (let c = cellConfig.col; c < cellConfig.col + (cellConfig.colSpan || 1); c++) {
                    occupiedPositions.add(`${r},${c}`);
                }
            }

            container.appendChild(cell);
        });

        // Fill empty positions
        for (let row = 0; row < scene.rows; row++) {
            for (let col = 0; col < scene.cols; col++) {
                const key = `${row},${col}`;
                if (!occupiedPositions.has(key)) {
                    const cell = this.createGridCell({row, col, rowSpan: 1, colSpan: 1, control: {type: 'empty'}}, sceneId);
                    cell.style.gridRow = `${row + 1}`;
                    cell.style.gridColumn = `${col + 1}`;
                    container.appendChild(cell);
                }
            }
        }

        // console.log(`[ControlGrid] Rendered ${scene.name} (${scene.rows}x${scene.cols}, ${scene.cells.length} controls)`);
    }

    /**
     * Create a single grid cell with the specified control type
     */
    createGridCell(cellConfig, sceneId) {
        const cell = document.createElement('div');
        cell.style.position = 'relative';
        // No background/border - let controls provide their own styling (match pad grid)

        // Apply accent color as bottom border if set
        if (cellConfig.accentColor) {
            // console.log(`[Accent] Setting accent color ${cellConfig.accentColor} for cell at row ${cellConfig.row}, col ${cellConfig.col}`);
            cell.style.borderBottom = `4px solid ${cellConfig.accentColor}`;
            cell.style.setProperty('border-bottom-color', cellConfig.accentColor, 'important');
        }

        // Store cell config for editing
        cell.dataset.row = cellConfig.row;
        cell.dataset.col = cellConfig.col;
        cell.dataset.sceneId = sceneId;
        cell.setAttribute('draggable', 'false');

        // Ctrl+drag support (like pads grid)
        cell.addEventListener('mousedown', (e) => {
            if (e.button === 0 && e.ctrlKey) {
                e.preventDefault();
                cell.setAttribute('draggable', 'true');
                cell.style.cursor = 'move';
            }
        });

        cell.addEventListener('dragstart', (e) => {
            if (cell.getAttribute('draggable') === 'true') {
                this.draggingCell = { row: cellConfig.row, col: cellConfig.col, sceneId };
                cell.style.opacity = '0.4';
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', `${cellConfig.row},${cellConfig.col}`);
            }
        });

        cell.addEventListener('dragend', () => {
            cell.style.opacity = '';
            cell.style.cursor = '';
            cell.setAttribute('draggable', 'false');
        });

        cell.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });

        cell.addEventListener('drop', (e) => {
            e.preventDefault();
            if (this.draggingCell && this.draggingCell.sceneId === sceneId) {
                this.swapControlGridCells(sceneId, this.draggingCell.row, this.draggingCell.col, cellConfig.row, cellConfig.col);
                this.draggingCell = null;
            }
        });

        // Add right-click context menu
        cell.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showControlGridCellEditor(sceneId, cellConfig.row, cellConfig.col);
        });

        const control = cellConfig.control || {type: 'empty'};

        switch (control.type) {
            case 'pad':
                this.createPadControl(cell, control, sceneId);
                break;
            case 'fader':
                this.createFaderControl(cell, control, sceneId);
                break;
            case 'knob':
                this.createKnobControl(cell, control, sceneId);
                break;
            case 'button':
                this.createButtonControl(cell, control, sceneId);
                break;
            case 'display':
                this.createDisplayControl(cell, control, sceneId);
                break;
            case 'empty':
            default:
                // Empty cell - no styling (transparent like pad grid)
                break;
        }

        return cell;
    }

    /**
     * Create a pad control (momentary button that sends MIDI) - uses regroove-pad component
     */
    createPadControl(cell, control, sceneId) {
        const pad = document.createElement('regroove-pad');
        pad.setAttribute('label', control.label || '');

        // Pass color directly to pad - component will handle both named and hex colors
        if (control.color) {
            pad.setAttribute('color', control.color);
        }

        // Set MIDI attribute based on type
        if (control.midiType === 'note') {
            pad.setAttribute('note', control.midiNumber || 60);
        } else if (control.midiType === 'cc') {
            pad.setAttribute('cc', control.midiNumber || 1);
        }

        pad.style.cssText = `
            width: 100%;
            height: 100%;
        `;

        // Listen for pad-press event (fired by regroove-pad component)
        pad.addEventListener('pad-press', (e) => {
            this.sendControlMIDI(control, 127);
        });

        // Listen for pad-release event for note pads
        if (control.midiType === 'note') {
            pad.addEventListener('pad-release', (e) => {
                this.sendControlMIDI(control, 0);
            });
        }

        cell.appendChild(pad);
    }

    /**
     * Create a fader control (vertical slider) - supports different fader types
     */
    createFaderControl(cell, control, sceneId) {
        const faderType = control.faderType || 'cc-fader';
        const fader = document.createElement(faderType);

        // Configure based on fader type
        if (faderType === 'cc-fader') {
            fader.setAttribute('label', control.label || 'Fader');
            fader.setAttribute('cc', control.midiNumber || 1);
            fader.setAttribute('value', control.midiValue !== undefined ? control.midiValue : 64);
            fader.setAttribute('min', '0');
            fader.setAttribute('max', '127');

            // Pass horizontal attribute if specified
            if (control.horizontal) {
                fader.setAttribute('horizontal', 'true');
            }

            fader.addEventListener('cc-change', (e) => {
                this.sendControlMIDI(control, e.detail.value);
            });
        } else if (faderType === 'channel-fader') {
            fader.setAttribute('channel', control.midiNumber || 0);
            fader.setAttribute('label', control.label || `CH${(control.midiNumber || 0) + 1}`);
            fader.setAttribute('volume', '100');
            fader.setAttribute('pan', '0');
            fader.setAttribute('solo', 'false');
            fader.setAttribute('muted', 'false');

            // Set device binding for MIDI
            const deviceConfig = this.resolveDeviceBinding(control.deviceBinding);
            fader.dataset.deviceId = deviceConfig.deviceId;
            fader.dataset.deviceBinding = control.deviceBinding || '';

            // Add event listeners for channel fader
            fader.addEventListener('volume-change', (e) => {
                const deviceId = parseInt(fader.dataset.deviceId || 0);
                this.handleChannelVolume(deviceId, e.detail.channel, e.detail.value);
            });
            fader.addEventListener('pan-change', (e) => {
                const deviceId = parseInt(fader.dataset.deviceId || 0);
                const panValue = this.convertPanToWire(e.detail.value);
                this.handleChannelPan(deviceId, e.detail.channel, panValue);
            });
            fader.addEventListener('solo-toggle', (e) => {
                const deviceId = parseInt(fader.dataset.deviceId || 0);
                this.handleChannelSolo(deviceId, e.detail.channel, e.detail.solo);
            });
            fader.addEventListener('mute-toggle', (e) => {
                const deviceId = parseInt(fader.dataset.deviceId || 0);
                this.handleChannelMute(deviceId, e.detail.channel, e.detail.muted);
            });
        } else if (faderType === 'mix-fader') {
            fader.setAttribute('label', control.label || 'Master');
            fader.setAttribute('volume', '100');
            fader.setAttribute('pan', '0');
            fader.setAttribute('fx', 'false');
            fader.setAttribute('muted', 'false');

            const deviceConfig = this.resolveDeviceBinding(control.deviceBinding);
            fader.dataset.deviceId = deviceConfig.deviceId;
            fader.dataset.deviceBinding = control.deviceBinding || '';

            fader.addEventListener('volume-change', (e) => {
                const deviceId = parseInt(fader.dataset.deviceId || 0);
                this.handleMasterVolume(deviceId, e.detail.value);
            });
            fader.addEventListener('pan-change', (e) => {
                const deviceId = parseInt(fader.dataset.deviceId || 0);
                const panValue = this.convertPanToWire(e.detail.value);
                this.handleMasterPan(deviceId, panValue);
            });
            fader.addEventListener('fx-toggle', (e) => {
                const deviceId = parseInt(fader.dataset.deviceId || 0);
                const route = e.detail.enabled ? 1 : 0;
                this.handleFxRouting(deviceId, route);
            });
            fader.addEventListener('mute-toggle', (e) => {
                const deviceId = parseInt(fader.dataset.deviceId || 0);
                this.handleMasterMute(deviceId, e.detail.muted);
            });
        } else if (faderType === 'tempo-fader') {
            fader.setAttribute('bpm', control.midiValue || '120');

            const deviceConfig = this.resolveDeviceBinding(control.deviceBinding);
            fader.dataset.deviceId = deviceConfig.deviceId;

            fader.addEventListener('tempo-change', (e) => {
                const deviceId = parseInt(fader.dataset.deviceId || 0);
                this.handleTempoChange(deviceId, e.detail.bpm);
            });
        } else if (faderType === 'stereo-fader') {
            fader.setAttribute('separation', control.midiValue || '64');

            const deviceConfig = this.resolveDeviceBinding(control.deviceBinding);
            fader.dataset.deviceId = deviceConfig.deviceId;

            fader.addEventListener('separation-change', (e) => {
                const deviceId = parseInt(fader.dataset.deviceId || 0);
                this.handleStereoChange(deviceId, e.detail.separation);
            });
        } else if (faderType === 'program-fader') {
            fader.setAttribute('program', control.midiNumber || 0);
            fader.setAttribute('label', control.label || `PROG ${(control.midiNumber || 0) + 1}`);
            fader.setAttribute('volume', '100');
            fader.setAttribute('pan', '0');
            fader.setAttribute('fx', 'false');
            fader.setAttribute('muted', 'false');

            const deviceConfig = this.resolveDeviceBinding(control.deviceBinding);
            fader.dataset.deviceId = deviceConfig.deviceId;

            fader.addEventListener('volume-change', (e) => {
                const deviceId = parseInt(fader.dataset.deviceId || 0);
                this.handleProgramVolume(deviceId, e.detail.program, e.detail.value);
            });
            fader.addEventListener('pan-change', (e) => {
                const deviceId = parseInt(fader.dataset.deviceId || 0);
                const panValue = this.convertPanToWire(e.detail.value);
                this.handleProgramPan(deviceId, e.detail.program, panValue);
            });
            fader.addEventListener('fx-toggle', (e) => {
                const deviceId = parseInt(fader.dataset.deviceId || 0);
                this.handleProgramFxEnable(deviceId, e.detail.program, e.detail.enabled);
            });
            fader.addEventListener('mute-toggle', (e) => {
                const deviceId = parseInt(fader.dataset.deviceId || 0);
                this.handleProgramMute(deviceId, e.detail.program, e.detail.muted);
            });
        } else if (faderType === 'deck-fader') {
            // Mixxx DJ Deck fader (volume + mute)
            const scene = this.scenes.get(sceneId);
            const deck = control.deck || 1; // 1 = Deck A, 2 = Deck B
            fader.setAttribute('deck', deck);
            fader.setAttribute('volume', '100');
            fader.setAttribute('muted', 'false');

            // Use control deviceBinding if set, otherwise fall back to scene deviceBinding
            const deviceBinding = control.deviceBinding || scene?.deviceBinding || null;
            const deviceConfig = this.resolveDeviceBinding(deviceBinding);
            fader.dataset.deviceId = deviceConfig.deviceId;
            fader.dataset.deviceBinding = deviceBinding || '';
            fader.dataset.deck = deck;

            // Sync with Mixxx deck state if available
            if (this.controller.mixxxDeckState && deviceBinding) {
                const deviceState = this.controller.mixxxDeckState.get(deviceBinding);
                if (deviceState && deviceState.decks) {
                    const deckState = deviceState.decks[deck - 1];
                    if (deckState) {
                        const volumePercent = Math.round((deckState.volume / 127) * 100);
                        fader.setAttribute('volume', volumePercent.toString());
                        fader.setAttribute('muted', deckState.mute.toString());
                    }
                }
            }

            fader.addEventListener('volume-change', (e) => {
                const binding = fader.dataset.deviceBinding || deviceBinding;
                this.handleDeckVolume(binding, deck, e.detail.value);
            });

            fader.addEventListener('mute-toggle', (e) => {
                const binding = fader.dataset.deviceBinding || deviceBinding;
                this.handleDeckMute(binding, deck, e.detail.muted);
            });
        }

        fader.style.cssText = `
            width: 100%;
            height: 100%;
        `;

        cell.appendChild(fader);
    }

    /**
     * Create a knob control (rotary control that sends CC) - uses pad-knob component
     */
    createKnobControl(cell, control, sceneId) {
        const knob = document.createElement('pad-knob');
        knob.setAttribute('label', control.label || 'Knob');
        knob.setAttribute('cc', control.midiNumber || 1);
        knob.setAttribute('value', control.midiValue !== undefined ? control.midiValue : 64);
        knob.setAttribute('min', '0');
        knob.setAttribute('max', '127');

        knob.style.cssText = `
            width: 100%;
            height: 100%;
        `;

        // Listen for CC changes and send MIDI
        knob.addEventListener('cc-change', (e) => {
            const value = e.detail.value;
            this.sendControlMIDI(control, value);
        });

        cell.appendChild(knob);
    }

    /**
     * Create a button control (toggle or momentary)
     */
    createButtonControl(cell, control, sceneId) {
        // For now, buttons work like pads
        this.createPadControl(cell, control, sceneId);
    }

    /**
     * Create a display widget control (shows device status)
     * Works in both control-grid and split scenes
     */
    createDisplayControl(cell, control, sceneId) {
        const scene = this.scenes.get(sceneId);

        // Resolve device (could be a string ID or placeholder like 'mixxx-device-id')
        let device = null;
        let deviceType = control.deviceType || 'unknown';
        let deviceId = control.deviceId;

        // Priority 1: Use scene's deviceBinding if set
        if (scene?.deviceBinding) {
            device = this.controller.deviceManager?.getDevice(scene.deviceBinding);
            if (device) {
                deviceId = device.id;
                deviceType = device.type;
            }
        }
        // Priority 2: Use control's deviceId if it's not a placeholder
        else if (deviceId && deviceId !== 'mixxx-device-id') {
            device = this.controller.deviceManager?.getDevice(deviceId);
        }
        // Priority 3: If placeholder 'mixxx-device-id', find first mixxx device
        else if (deviceId === 'mixxx-device-id') {
            const devices = this.controller.deviceManager?.getAllDevices() || [];
            device = devices.find(d => d.type === 'mixxx');
            if (device) {
                deviceId = device.id;
                deviceType = device.type;
            }
        }

        if (!deviceId) {
            cell.innerHTML = '<div style="padding: 10px; color: #666; text-align: center; font-size: 0.8em;">Display Widget<br>(No device configured)</div>';
            return;
        }

        if (!device) {
            cell.innerHTML = '<div style="padding: 10px; color: #ff6666; text-align: center; font-size: 0.8em;">Display Widget<br>(Device not found)</div>';
            return;
        }

        // Create display-widget element
        const displayWidget = document.createElement('display-widget');
        displayWidget.setAttribute('device-id', deviceId);
        displayWidget.setAttribute('device-type', deviceType);
        displayWidget.setAttribute('display-mode', control.displayMode || 'poll');
        displayWidget.setAttribute('update-interval', control.updateInterval || 100);

        // Add deck-id for Mixxx displays
        if (control.deckId) {
            displayWidget.setAttribute('deck-id', control.deckId);
        }

        displayWidget.style.cssText = `
            width: 100%;
            height: 100%;
        `;

        cell.appendChild(displayWidget);
    }

    /**
     * Swap two control grid cells (for Ctrl+drag)
     */
    swapControlGridCells(sceneId, fromRow, fromCol, toRow, toCol) {
        const scene = this.scenes.get(sceneId);
        if (!scene) return;

        // Find cells in config
        const fromIndex = scene.cells.findIndex(c => c.row === fromRow && c.col === fromCol);
        const toIndex = scene.cells.findIndex(c => c.row === toRow && c.col === toCol);

        if (fromIndex >= 0 && toIndex >= 0) {
            // Swap the cell positions
            const fromCell = scene.cells[fromIndex];
            const toCell = scene.cells[toIndex];

            // Update row/col references
            fromCell.row = toRow;
            fromCell.col = toCol;
            toCell.row = fromRow;
            toCell.col = fromCol;
        } else if (fromIndex >= 0) {
            // Moving to empty cell
            scene.cells[fromIndex].row = toRow;
            scene.cells[fromIndex].col = toCol;
        }

        // Save and re-render
        this.controller.sceneEditor.saveScenesToStorage();
        this.renderControlGridScene(sceneId);
    }

    /**
     * Send MIDI from a control grid element
     */
    sendControlMIDI(control, value) {
        // Get MIDI output (use device binding if specified)
        // Priority: control.deviceBinding > scene.deviceBinding > default output
        let midiOutput = this.controller.midiOutput;
        let midiChannel = control.midiChannel || 0;

        // First, try control-specific device binding
        let deviceBinding = control.deviceBinding;

        // If no control-specific binding, try scene-level device binding
        if (!deviceBinding) {
            const currentScene = this.scenes.get(this.currentScene);
            if (currentScene && currentScene.deviceBinding) {
                deviceBinding = currentScene.deviceBinding;
            }
        }

        // Apply device binding if we found one
        if (deviceBinding && this.controller.deviceManager) {
            const device = this.controller.deviceManager.getDevice(deviceBinding);
            if (device) {
                const deviceOutput = this.controller.deviceManager.getMidiOutput(device.id);
                if (deviceOutput) {
                    midiOutput = deviceOutput;
                    midiChannel = device.midiChannel;
                    // console.log(`[ControlGrid] Using device: ${device.name} (Ch${midiChannel + 1}, Output: ${deviceOutput.name})`);
                }
            }
        }

        if (!midiOutput) return;

        const midiType = control.midiType || 'cc';
        const midiNumber = control.midiNumber || 0;

        if (midiType === 'note') {
            const statusByte = value > 0 ? (0x90 + midiChannel) : (0x80 + midiChannel);
            midiOutput.send([statusByte, midiNumber, value]);
        } else if (midiType === 'cc') {
            const statusByte = 0xB0 + midiChannel;
            midiOutput.send([statusByte, midiNumber, value]);
        } else if (midiType === 'program') {
            const statusByte = 0xC0 + midiChannel;
            midiOutput.send([statusByte, midiNumber]);
        }

        // console.log(`[ControlGrid] MIDI ${midiType}: Ch${midiChannel + 1}, Num${midiNumber}, Val${value}`);
    }

    /**
     * Show cell editor dialog for control grid
     */
    showControlGridCellEditor(sceneId, row, col) {
        const scene = this.scenes.get(sceneId);
        if (!scene) return;

        // Find existing cell config
        const cellIndex = scene.cells.findIndex(c => c.row === row && c.col === col);
        const existingCell = cellIndex >= 0 ? scene.cells[cellIndex] : null;
        const control = existingCell?.control || {type: 'empty'};

        if (!window.nbDialog) {
            console.error('[ControlGrid] nbDialog not available');
            return;
        }

        const dialogContent = `
            <div style="background: #1a1a1a; border: 2px solid #4a4a4a; border-radius: 8px; padding: 20px; min-width: 400px; color: #fff; font-family: Arial, sans-serif;">
                <h3 style="margin: 0 0 20px 0; text-align: center;">Edit Grid Control</h3>

                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; color: #888;">Position:</label>
                    <div style="color: #ccc;">Row ${row + 1}, Col ${col + 1}</div>
                </div>

                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; color: #888;">Control Type:</label>
                    <select id="control-type" style="width: 100%; padding: 8px; background: #0a0a0a; color: #ccc; border: 1px solid #555; border-radius: 4px;">
                        <option value="empty" ${control.type === 'empty' ? 'selected' : ''}>Empty</option>
                        <option value="pad" ${control.type === 'pad' ? 'selected' : ''}>Pad (Button)</option>
                        <option value="fader" ${control.type === 'fader' ? 'selected' : ''}>Fader (Vertical Slider)</option>
                        <option value="knob" ${control.type === 'knob' ? 'selected' : ''}>Knob (Rotary)</option>
                        <option value="button" ${control.type === 'button' ? 'selected' : ''}>Button (Toggle)</option>
                    </select>
                </div>

                <div id="fader-type-section" style="display: ${control.type === 'fader' ? 'block' : 'none'}; margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; color: #888;">Fader Type:</label>
                    <select id="fader-type" style="width: 100%; padding: 8px; background: #0a0a0a; color: #ccc; border: 1px solid #555; border-radius: 4px;">
                        <option value="cc-fader" ${control.faderType === 'cc-fader' || !control.faderType ? 'selected' : ''}>CC Fader (Generic)</option>
                        <option value="channel-fader" ${control.faderType === 'channel-fader' ? 'selected' : ''}>Channel Fader (Volume/Pan/Solo/Mute)</option>
                        <option value="mix-fader" ${control.faderType === 'mix-fader' ? 'selected' : ''}>Mix Fader (Master Volume/Pan/FX/Mute)</option>
                        <option value="deck-fader" ${control.faderType === 'deck-fader' ? 'selected' : ''}>Deck Fader (Mixxx Deck Volume/Mute)</option>
                        <option value="tempo-fader" ${control.faderType === 'tempo-fader' ? 'selected' : ''}>Tempo Fader (BPM)</option>
                        <option value="stereo-fader" ${control.faderType === 'stereo-fader' ? 'selected' : ''}>Stereo Fader (Separation)</option>
                        <option value="program-fader" ${control.faderType === 'program-fader' ? 'selected' : ''}>Program Fader (Samplecrate)</option>
                    </select>
                </div>

                <div id="deck-number-section" style="display: ${control.faderType === 'deck-fader' ? 'block' : 'none'}; margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; color: #888;">Deck Number (1-4):</label>
                    <input type="number" id="deck-number" min="1" max="4" value="${control.deck || 1}" style="width: 100%; padding: 8px; background: #0a0a0a; color: #ccc; border: 1px solid #555; border-radius: 4px;">
                </div>

                <div id="control-settings" style="display: ${control.type !== 'empty' ? 'block' : 'none'};">
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; color: #888;">Label:</label>
                        <input type="text" id="control-label" value="${control.label || ''}" style="width: 100%; padding: 8px; background: #0a0a0a; color: #ccc; border: 1px solid #555; border-radius: 4px;">
                    </div>

                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; color: #888;">Color:</label>
                        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 8px;">
                            <button class="color-preset" data-color="#DD8000" style="padding: 12px; background: #DD8000; border: 2px solid ${control.color === '#DD8000' ? '#fff' : '#333'}; border-radius: 4px; cursor: pointer; font-size: 0.75em; color: #fff; font-weight: bold;">RED</button>
                            <button class="color-preset" data-color="#0088FF" style="padding: 12px; background: #0088FF; border: 2px solid ${control.color === '#0088FF' ? '#fff' : '#333'}; border-radius: 4px; cursor: pointer; font-size: 0.75em; color: #fff; font-weight: bold;">BLUE</button>
                            <button class="color-preset" data-color="#00DD00" style="padding: 12px; background: #00DD00; border: 2px solid ${control.color === '#00DD00' ? '#fff' : '#333'}; border-radius: 4px; cursor: pointer; font-size: 0.75em; color: #000; font-weight: bold;">GREEN</button>
                            <button class="color-preset" data-color="#FFCC00" style="padding: 12px; background: #FFCC00; border: 2px solid ${control.color === '#FFCC00' ? '#fff' : '#333'}; border-radius: 4px; cursor: pointer; font-size: 0.75em; color: #000; font-weight: bold;">YELLOW</button>
                            <button class="color-preset" data-color="#FFAA00" style="padding: 12px; background: #FFAA00; border: 2px solid ${control.color === '#FFAA00' ? '#fff' : '#333'}; border-radius: 4px; cursor: pointer; font-size: 0.75em; color: #000; font-weight: bold;">ORANGE</button>
                            <button class="color-preset" data-color="#9a4aff" style="padding: 12px; background: #9a4aff; border: 2px solid ${control.color === '#9a4aff' ? '#fff' : '#333'}; border-radius: 4px; cursor: pointer; font-size: 0.75em; color: #fff; font-weight: bold;">PURPLE</button>
                            <button class="color-preset" data-color="#888" style="padding: 12px; background: #888; border: 2px solid ${control.color === '#888' ? '#fff' : '#333'}; border-radius: 4px; cursor: pointer; font-size: 0.75em; color: #fff; font-weight: bold;">GRAY</button>
                            <button id="custom-color-btn" style="padding: 12px; background: #2a2a2a; border: 2px solid #555; border-radius: 4px; cursor: pointer; font-size: 0.75em; color: #aaa; font-weight: bold;">CUSTOM</button>
                        </div>
                        <div id="custom-color-picker" style="display: none; margin-top: 8px;">
                            <input type="color" id="control-color-picker" value="${control.color || '#4a9eff'}" style="width: 100%; height: 40px; padding: 4px; background: #0a0a0a; border: 1px solid #555; border-radius: 4px; cursor: pointer;">
                        </div>
                        <input type="hidden" id="control-color" value="${control.color || '#4a9eff'}">
                    </div>

                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; color: #888;">MIDI Type:</label>
                        <select id="midi-type" style="width: 100%; padding: 8px; background: #0a0a0a; color: #ccc; border: 1px solid #555; border-radius: 4px;">
                            <option value="cc" ${control.midiType === 'cc' ? 'selected' : ''}>CC (Control Change)</option>
                            <option value="note" ${control.midiType === 'note' ? 'selected' : ''}>Note On/Off</option>
                            <option value="program" ${control.midiType === 'program' ? 'selected' : ''}>Program Change</option>
                        </select>
                    </div>

                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; color: #888;">MIDI Channel (1-16):</label>
                        <input type="number" id="midi-channel" value="${(control.midiChannel || 0) + 1}" min="1" max="16" style="width: 100%; padding: 8px; background: #0a0a0a; color: #ccc; border: 1px solid #555; border-radius: 4px;">
                    </div>

                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; color: #888;">MIDI Number (CC/Note/Program):</label>
                        <input type="number" id="midi-number" value="${control.midiNumber || 1}" min="0" max="127" style="width: 100%; padding: 8px; background: #0a0a0a; color: #ccc; border: 1px solid #555; border-radius: 4px;">
                    </div>

                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; color: #888;">Initial Value (0-127):</label>
                        <input type="number" id="midi-value" value="${control.midiValue !== undefined ? control.midiValue : 64}" min="0" max="127" style="width: 100%; padding: 8px; background: #0a0a0a; color: #ccc; border: 1px solid #555; border-radius: 4px;">
                    </div>

                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; color: #888;">Size:</label>
                        <div style="display: flex; gap: 10px;">
                            <div style="flex: 1;">
                                <label style="display: block; margin-bottom: 3px; color: #666; font-size: 0.85em;">Rows:</label>
                                <input type="number" id="row-span" value="${existingCell?.rowSpan || 1}" min="1" max="${scene.rows}" style="width: 100%; padding: 8px; background: #0a0a0a; color: #ccc; border: 1px solid #555; border-radius: 4px;">
                            </div>
                            <div style="flex: 1;">
                                <label style="display: block; margin-bottom: 3px; color: #666; font-size: 0.85em;">Cols:</label>
                                <input type="number" id="col-span" value="${existingCell?.colSpan || 1}" min="1" max="${scene.cols}" style="width: 100%; padding: 8px; background: #0a0a0a; color: #ccc; border: 1px solid #555; border-radius: 4px;">
                            </div>
                        </div>
                    </div>
                </div>

                <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
                    ${existingCell && control.type !== 'empty' ? `<button id="delete-control" style="padding: 10px 20px; background: #4a2a2a; color: #CF1A37; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Delete</button>` : ''}
                    <button id="cancel-control" style="padding: 10px 20px; background: #4a4a4a; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Cancel</button>
                    <button id="save-control" style="padding: 10px 20px; background: #4a9eff; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Save</button>
                </div>
            </div>
        `;

        window.nbDialog.show(dialogContent);

        // Show/hide settings based on control type
        setTimeout(() => {
            const typeSelect = document.getElementById('control-type');
            const settingsDiv = document.getElementById('control-settings');
            const faderTypeSection = document.getElementById('fader-type-section');

            const deckNumberSection = document.getElementById('deck-number-section');
            const faderTypeSelect = document.getElementById('fader-type');

            typeSelect?.addEventListener('change', () => {
                settingsDiv.style.display = typeSelect.value === 'empty' ? 'none' : 'block';
                faderTypeSection.style.display = typeSelect.value === 'fader' ? 'block' : 'none';
                // Hide deck number section if not fader type
                if (typeSelect.value !== 'fader') {
                    deckNumberSection.style.display = 'none';
                }
            });

            faderTypeSelect?.addEventListener('change', () => {
                deckNumberSection.style.display = faderTypeSelect.value === 'deck-fader' ? 'block' : 'none';
            });

            // Handle color preset buttons
            const colorPresets = document.querySelectorAll('.color-preset');
            const colorInput = document.getElementById('control-color');
            const customColorBtn = document.getElementById('custom-color-btn');
            const customColorPicker = document.getElementById('custom-color-picker');
            const colorPicker = document.getElementById('control-color-picker');

            colorPresets.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const color = btn.dataset.color;
                    colorInput.value = color;

                    // Update button borders
                    colorPresets.forEach(b => b.style.border = '2px solid #333');
                    btn.style.border = '2px solid #fff';
                    customColorBtn.style.border = '2px solid #555';

                    // Hide custom picker
                    customColorPicker.style.display = 'none';
                });
            });

            customColorBtn.addEventListener('click', (e) => {
                e.preventDefault();
                customColorPicker.style.display = 'block';
                customColorBtn.style.border = '2px solid #fff';
                colorPresets.forEach(b => b.style.border = '2px solid #333');
            });

            colorPicker.addEventListener('input', () => {
                colorInput.value = colorPicker.value;
            });

            document.getElementById('cancel-control')?.addEventListener('click', () => {
                window.nbDialog.hide();
            });

            document.getElementById('delete-control')?.addEventListener('click', () => {
                // Remove cell from config
                if (cellIndex >= 0) {
                    scene.cells.splice(cellIndex, 1);
                    this.controller.sceneEditor.saveScenesToStorage();
                    window.nbDialog.hide();
                    this.renderControlGridScene(sceneId);
                }
            });

            document.getElementById('save-control')?.addEventListener('click', () => {
                const type = document.getElementById('control-type').value;

                if (type === 'empty') {
                    // Remove cell if it exists
                    if (cellIndex >= 0) {
                        scene.cells.splice(cellIndex, 1);
                    }
                } else {
                    // Create/update cell config
                    const newCell = {
                        row,
                        col,
                        rowSpan: parseInt(document.getElementById('row-span').value) || 1,
                        colSpan: parseInt(document.getElementById('col-span').value) || 1,
                        control: {
                            type,
                            label: document.getElementById('control-label').value,
                            color: document.getElementById('control-color').value,
                            midiType: document.getElementById('midi-type').value,
                            midiChannel: parseInt(document.getElementById('midi-channel').value) - 1,
                            midiNumber: parseInt(document.getElementById('midi-number').value),
                            midiValue: parseInt(document.getElementById('midi-value').value)
                        }
                    };

                    // Add faderType if this is a fader
                    if (type === 'fader') {
                        const faderType = document.getElementById('fader-type').value;
                        newCell.control.faderType = faderType;

                        // Add deck number for deck-fader
                        if (faderType === 'deck-fader') {
                            newCell.control.deck = parseInt(document.getElementById('deck-number').value) || 1;
                            // Use scene's deviceBinding if available, otherwise null
                            newCell.control.deviceBinding = scene.deviceBinding || null;
                        }
                    }

                    if (cellIndex >= 0) {
                        scene.cells[cellIndex] = newCell;
                    } else {
                        scene.cells.push(newCell);
                    }
                }

                this.controller.sceneEditor.saveScenesToStorage();
                window.nbDialog.hide();
                this.renderControlGridScene(sceneId);
            });
        }, 100);
    }

    /**
     * Render Fire Sequencer scene
     */
    renderFireSequencerScene(sceneId) {
        const scene = this.scenes.get(sceneId);
        if (!scene) {
            console.error(`[FireSequencer] Scene "${sceneId}" not found`);
            return;
        }

        // Create or get Fire sequencer instance
        if (!scene.fireInstance) {
            scene.fireInstance = new FireSequencerScene(this, sceneId);
        }

        // Render the Fire interface
        scene.fireInstance.render();
    }

    /**
     * Handle DECKS_STATE_RESPONSE (0x67) from Mixxx
     * Updates deck state and pad colors
     * @param {string} deviceId - Device string ID
     * @param {Uint8Array} data - SysEx message data
     */
    handleDeckStateResponse(deviceId, data) {
        // console.log(`[Scene] handleDeckStateResponse called for device: ${deviceId}, data length: ${data.length}`);
        const state = parseDeckStateResponse(data);
        if (!state) {
            console.warn('[Scene] Failed to parse deck state response');
            return;
        }

        // console.log('[Scene] Parsed deck state:', state);

        // Store deck state in controller for display widgets
        if (!this.controller.mixxxDeckState) {
            this.controller.mixxxDeckState = new Map();
        }
        this.controller.mixxxDeckState.set(deviceId, state);

        // Update pad colors for current scene
        this.updateDJDeckPadColors(deviceId, state);

        // Update faders (volume, tempo, crossfader) with Mixxx state
        this.updateDJDeckFaders(deviceId, state);

        // Update display widgets
        this.updateMixxxDisplays(deviceId);
    }

    /**
     * Update DJ Deck pad colors based on deck state
     * @param {string} deviceId - Device string ID
     * @param {Object} state - Parsed deck state
     */
    updateDJDeckPadColors(deviceId, state) {
        const currentScene = this.scenes.get(this.currentScene);
        // console.log(`[Scene] updateDJDeckPadColors: scene=${this.currentScene}, deviceId=${deviceId}, scene.deviceBinding=${currentScene?.deviceBinding}`);

        if (!currentScene) {
            console.warn('[Scene] No current scene');
            return;
        }

        // Get device for comparison
        const device = this.controller.deviceManager?.getDevice(deviceId);
        if (!device) {
            console.warn(`[Scene] Device ${deviceId} not found in device manager`);
            return;
        }

        // Check if this scene is bound to this device (compare deviceBinding, not deviceId)
        if (currentScene.deviceBinding !== deviceId) {
            console.log(`[Scene] Scene ${this.currentScene} not bound to device ${deviceId} (bound to ${currentScene.deviceBinding})`);
            return;
        }

        // For control-grid scenes, iterate through cells, not pads
        if (currentScene.type === 'control-grid' && currentScene.cells) {
            // console.log(`[Scene] Processing ${currentScene.cells.length} control-grid cells`);
            currentScene.cells.forEach((cellConfig, index) => {
                if (!cellConfig.control || !cellConfig.control.deckStateBinding) return;

                const binding = cellConfig.control.deckStateBinding;
                const deckIndex = binding.deck - 1; // Convert 1-based to 0-based

                if (deckIndex < 0 || deckIndex >= state.decks.length) return;

                const deckState = state.decks[deckIndex];
                const controlValue = deckState[binding.control];

                // Skip if control value doesn't exist
                if (controlValue === undefined) {
                    console.warn(`[Scene] Cell ${index}: Control '${binding.control}' not found in deck ${binding.deck} state`);
                    return;
                }

                // Get color from color map
                let color = null;
                if (binding.colorMap) {
                    color = binding.colorMap[controlValue.toString()] || binding.colorMap['default'];
                }

                // console.log(`[Scene] Cell ${index} (deck ${binding.deck}, control ${binding.control}): value=${controlValue}, color=${color}`);

                // Find the pad element in the DOM
                const cell = document.querySelector(`[data-scene-id="${this.currentScene}"][data-row="${cellConfig.row}"][data-col="${cellConfig.col}"]`);
                if (cell) {
                    const padElement = cell.querySelector('regroove-pad');
                    if (padElement && color) {
                        padElement.setAttribute('color', color);
                    }
                }
            });
        }
        // For split/grid scenes with pads array
        else if (currentScene.pads) {
            // console.log(`[Scene] Processing ${currentScene.pads.length} pads`);
            currentScene.pads.forEach((padConfig, index) => {
                if (!padConfig || !padConfig.deckStateBinding) return;

                const binding = padConfig.deckStateBinding;
                const deckIndex = binding.deck - 1; // Convert 1-based to 0-based

                if (deckIndex < 0 || deckIndex >= state.decks.length) return;

                const deckState = state.decks[deckIndex];
                const controlValue = deckState[binding.control];

                // Skip if control value doesn't exist
                if (controlValue === undefined) {
                    console.warn(`[Scene] Pad ${index}: Control '${binding.control}' not found in deck ${binding.deck} state`);
                    return;
                }

                // Get color from color map
                let color = null;
                if (binding.colorMap) {
                    color = binding.colorMap[controlValue.toString()] || binding.colorMap['default'];
                }

                // console.log(`[Scene] Pad ${index} (deck ${binding.deck}, control ${binding.control}): value=${controlValue}, color=${color}`);

                // Update pad color
                const padElement = this.controller.pads[index];
                if (padElement && color) {
                    padElement.setAttribute('color', color);
                }
            });
        }

        // Update pad colors for FX, Loop, Sync, PFL (works for both dj-decks and control-grid)
        const scene = this.scenes.get(this.currentScene);
        if (scene) {
            const allPads = document.querySelectorAll(`[data-scene-id="${this.currentScene}"] regroove-pad`);

            allPads.forEach(pad => {
                // Pads can have either 'cc' or 'note' attribute
                const ccAttr = pad.getAttribute('cc');
                const noteAttr = pad.getAttribute('note');
                const cc = parseInt(ccAttr || noteAttr);
                if (isNaN(cc)) return;

                // Deck A pads
                if (state.decks[0]) {
                    const deckA = state.decks[0];

                    // Loop A1-4 (CC 5-8): Yellow when looping, grey when not
                    if (cc >= 5 && cc <= 8) {
                        pad.setAttribute('color', deckA.looping ? '#FFCC00' : '#888');
                    }
                    // FX A1-4 (CC 9-12): Green when FX enabled, grey when not
                    else if (cc === 9) {
                        pad.setAttribute('color', deckA.fx1 ? '#00DD00' : '#888');
                    } else if (cc === 10) {
                        pad.setAttribute('color', deckA.fx2 ? '#00DD00' : '#888');
                    } else if (cc === 11) {
                        pad.setAttribute('color', deckA.fx3 ? '#00DD00' : '#888');
                    } else if (cc === 12) {
                        pad.setAttribute('color', deckA.fx4 ? '#00DD00' : '#888');
                    }
                    // Sync A (CC 14): Yellow when enabled, grey when not
                    else if (cc === 14) {
                        pad.setAttribute('color', deckA.sync ? '#FFCC00' : '#888');
                    }
                    // PFL A (CC 15): Green when enabled, grey when not
                    else if (cc === 15) {
                        pad.setAttribute('color', deckA.pfl ? '#00ff00' : '#888');
                    }
                }

                // Deck B pads
                if (state.decks[1]) {
                    const deckB = state.decks[1];

                    // Loop B1-4 (CC 25-28): Yellow when looping, grey when not
                    if (cc >= 25 && cc <= 28) {
                        pad.setAttribute('color', deckB.looping ? '#FFCC00' : '#888');
                    }
                    // FX B1-4 (CC 29-32): Default color when FX enabled, grey when not
                    else if (cc === 29) {
                        pad.setAttribute('color', deckB.fx1 ? '#00DD00' : '#888');
                    } else if (cc === 30) {
                        pad.setAttribute('color', deckB.fx2 ? '#00DD00' : '#888');
                    } else if (cc === 31) {
                        pad.setAttribute('color', deckB.fx3 ? '#00DD00' : '#888');
                    } else if (cc === 32) {
                        pad.setAttribute('color', deckB.fx4 ? '#00DD00' : '#888');
                    }
                    // Sync B (CC 34): Yellow when enabled, grey when not
                    else if (cc === 34) {
                        pad.setAttribute('color', deckB.sync ? '#FFCC00' : '#888');
                    }
                    // PFL B (CC 35): Green when enabled, grey when not
                    else if (cc === 35) {
                        pad.setAttribute('color', deckB.pfl ? '#00ff00' : '#888');
                    }
                }
            });
        }
    }

    /**
     * Update DJ Deck faders (volume, tempo, crossfader) based on Mixxx state
     * @param {string} deviceId - Device string ID
     * @param {Object} state - Parsed deck state
     */
    updateDJDeckFaders(deviceId, state) {
        const currentScene = this.scenes.get(this.currentScene);
        // console.log(`[Scene] updateDJDeckFaders: scene=${this.currentScene}, deviceId=${deviceId}`);

        if (!currentScene || currentScene.type !== 'control-grid') {
            return;
        }

        // Check if this scene is bound to this device
        if (currentScene.deviceBinding !== deviceId) {
            // console.log(`[Scene] Scene not bound to device ${deviceId}`);
            return;
        }

        // Find all cc-fader elements in the scene
        const container = document.getElementById('pads-grid');
        if (!container) return;

        const ccFaders = container.querySelectorAll('cc-fader');
        // console.log(`[Scene] Found ${ccFaders.length} cc-faders`);

        ccFaders.forEach(fader => {
            // Skip update if user is currently changing this fader
            if (fader.dataset.ccChanging === 'true') {
                return;
            }

            const cc = parseInt(fader.getAttribute('cc'));

            // VOL A (CC 17) - Deck 1 volume
            if (cc === 17 && state.decks[0]) {
                const volume = state.decks[0].volume; // 0-127
                // console.log(`[Scene] Updating VOL A (CC 17) to ${volume}`);
                fader.setAttribute('value', volume.toString());
            }

            // VOL B (CC 18) - Deck 2 volume
            else if (cc === 18 && state.decks[1]) {
                const volume = state.decks[1].volume; // 0-127
                // console.log(`[Scene] Updating VOL B (CC 18) to ${volume}`);
                fader.setAttribute('value', volume.toString());
            }

            // TEMPO A (CC 48) - Deck 1 rate (pitch adjustment)
            else if (cc === 48 && state.decks[0]) {
                const rate = state.decks[0].rate; // 0-127 (64 = center/normal)
                // console.log(`[Scene] Updating TEMPO A (CC 48) to rate ${rate}`);
                fader.setAttribute('value', rate.toString());
            }

            // TEMPO B (CC 49) - Deck 2 rate (pitch adjustment)
            else if (cc === 49 && state.decks[1]) {
                const rate = state.decks[1].rate; // 0-127 (64 = center/normal)
                // console.log(`[Scene] Updating TEMPO B (CC 49) to rate ${rate}`);
                fader.setAttribute('value', rate.toString());
            }

            // X-FADE (CC 19) - Crossfader
            else if (cc === 19 && state.master) {
                const crossfader = state.master.crossfader; // 0-127
                // console.log(`[Scene] Updating X-FADE (CC 19) to ${crossfader}`);
                fader.setAttribute('value', crossfader.toString());
            }

            // EQ HIGH A (CC 40) - Deck 1 EQ High
            else if (cc === 40 && state.decks[0]) {
                fader.setAttribute('value', state.decks[0].eqHigh.toString());
            }

            // EQ MID A (CC 41) - Deck 1 EQ Mid
            else if (cc === 41 && state.decks[0]) {
                fader.setAttribute('value', state.decks[0].eqMid.toString());
            }

            // EQ LOW A (CC 42) - Deck 1 EQ Low
            else if (cc === 42 && state.decks[0]) {
                fader.setAttribute('value', state.decks[0].eqLow.toString());
            }

            // EQ HIGH B (CC 43) - Deck 2 EQ High
            else if (cc === 43 && state.decks[1]) {
                fader.setAttribute('value', state.decks[1].eqHigh.toString());
            }

            // EQ MID B (CC 44) - Deck 2 EQ Mid
            else if (cc === 44 && state.decks[1]) {
                fader.setAttribute('value', state.decks[1].eqMid.toString());
            }

            // EQ LOW B (CC 45) - Deck 2 EQ Low
            else if (cc === 45 && state.decks[1]) {
                fader.setAttribute('value', state.decks[1].eqLow.toString());
            }
        });

        // Also update knobs (EQ uses pad-knob components)
        const knobs = container.querySelectorAll('pad-knob');
        knobs.forEach(knob => {
            // Skip update if user is currently changing this knob
            if (knob.dataset.ccChanging === 'true') {
                return;
            }

            const cc = parseInt(knob.getAttribute('cc'));

            // EQ HIGH A (CC 40) - Deck 1 EQ High
            if (cc === 40 && state.decks[0]) {
                knob.setAttribute('value', state.decks[0].eqHigh.toString());
            }
            // EQ MID A (CC 41) - Deck 1 EQ Mid
            else if (cc === 41 && state.decks[0]) {
                knob.setAttribute('value', state.decks[0].eqMid.toString());
            }
            // EQ LOW A (CC 42) - Deck 1 EQ Low
            else if (cc === 42 && state.decks[0]) {
                knob.setAttribute('value', state.decks[0].eqLow.toString());
            }
            // EQ HIGH B (CC 43) - Deck 2 EQ High
            else if (cc === 43 && state.decks[1]) {
                knob.setAttribute('value', state.decks[1].eqHigh.toString());
            }
            // EQ MID B (CC 44) - Deck 2 EQ Mid
            else if (cc === 44 && state.decks[1]) {
                knob.setAttribute('value', state.decks[1].eqMid.toString());
            }
            // EQ LOW B (CC 45) - Deck 2 EQ Low
            else if (cc === 45 && state.decks[1]) {
                knob.setAttribute('value', state.decks[1].eqLow.toString());
            }
            // GAIN A (CC 46) - Deck 1 Pregain
            else if (cc === 46 && state.decks[0]) {
                // Pregain not in state yet - need to add it
            }
            // GAIN B (CC 47) - Deck 2 Pregain
            else if (cc === 47 && state.decks[1]) {
                // Pregain not in state yet - need to add it
            }
        });

        // Update deck-fader elements (volume + mute)
        const deckFaders = container.querySelectorAll('deck-fader');
        // console.log(`[Scene] Found ${deckFaders.length} deck-faders`);
        deckFaders.forEach(fader => {
            // Skip update if user is currently changing this fader
            if (fader.dataset.volumeChanging === 'true') {
                return;
            }

            const deck = parseInt(fader.dataset.deck || fader.getAttribute('deck'));
            const deckIndex = deck - 1; // Convert 1-based to 0-based

            if (deckIndex >= 0 && deckIndex < state.decks.length) {
                const deckState = state.decks[deckIndex];

                // Update volume (convert 0-127 to 0-100 percentage)
                const volumePercent = Math.round((deckState.volume / 127) * 100);
                fader.setAttribute('volume', volumePercent.toString());

                // Update mute state
                fader.setAttribute('muted', deckState.mute.toString());

                // console.log(`[Scene] Updated Deck ${deck} fader: volume=${volumePercent}%, muted=${deckState.mute}`);
            }
        });
    }

    /**
     * Update Mixxx display widgets
     * @param {string} deviceId - Device string ID
     */
    updateMixxxDisplays(deviceId) {
        // Find all display widgets for this device
        const displays = document.querySelectorAll(`display-widget[device-id="${deviceId}"][device-type="mixxx"]`);
        // console.log(`[Scene] updateMixxxDisplays: Found ${displays.length} display widgets for device ${deviceId}`);
        displays.forEach(display => {
            // Display widgets will automatically query state via getVirtualDeviceState()
            // Trigger a refresh by calling the public refresh() method
            if (display.refresh) {
                display.refresh();
            }
        });
    }
}
