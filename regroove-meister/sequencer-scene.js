/**
 * Sequencer Scene for Meister
 * Tracker-style pattern editor with 4 tracks and 64 rows
 */

import { SequencerEngine, SequencerEntry } from './sequencer-engine.js';
import { showFillDialog } from './fill-dialog.js';
import { uploadMidiFile, downloadMidiFile } from './midi-sequence-utils.js';

export class SequencerScene {
    constructor(controller, sceneId, config = {}, skipRender = false) {
        this.controller = controller;
        this.sceneId = sceneId;
        this.type = 'sequencer';
        this.name = config.name || 'Sequencer';
        this.enabled = config.enabled !== false;

        // Create sequencer engine
        this.engine = config.engine
            ? SequencerEngine.fromJSON(controller, config.engine)
            : new SequencerEngine(controller);

        // UI state
        this.cursorRow = 0;
        this.cursorTrack = 0;
        this.cursorField = 0; // 0=note+octave, 1=volume, 2=effect
        this.scrollOffset = 0;
        this.visibleRows = 24; // Number of rows visible at once

        // Track whether we're in record/edit mode
        this.recordMode = false;

        // Track last preview note time to prevent MIDI feedback loops
        // When navigating with arrow keys, preview notes are sent via MIDI output
        // and can loop back as MIDI input, causing unwanted note entry.
        // We ignore ALL MIDI input for 300ms after ANY preview to prevent this.
        //
        // NOTE: This means you cannot play notes from a MIDI keyboard while rapidly
        // navigating with arrow keys (within 300ms of each navigation).
        //
        // POTENTIAL IMPROVEMENT: Track the specific MIDI note number that was previewed
        // and only ignore that exact note, allowing other notes from MIDI keyboard.
        // This would require: this.lastPreviewNote = null; and checking if
        // (data1 === this.lastPreviewNote && now - this.lastPreviewTime < 300)
        this.lastPreviewTime = 0;
        this.previewIgnoreWindow = 300; // Ignore MIDI input for 300ms after preview

        // Setup pattern change listener for external updates (e.g., from Fire sequencer)
        this.setupPatternChangeListener();

        // Always setup event listeners (even if skipRender)
        // Otherwise resume() won't have keyboard handler attached
        this.setupEventListeners();

        // Only render if not initializing in background
        if (!skipRender) {
            this.render();
        } else {
            // console.log(`[Sequencer] Created instance in background (no render): ${this.name}`);
        }
    }

    render() {
        const container = document.getElementById('pads-grid');

        // PERFORMANCE: Skip full rebuild if already rendered (fast resume)
        if (this.isRendered && container.querySelector('#seq-tracker-grid')) {
            // Resume event listeners (keyboard, MIDI, UI updates)
            this.resume();

            // Quick state sync without full rebuild
            this.updatePlayPauseButton();

            // Only update visible portion of grid (20 rows centered on cursor)
            const visibleStart = Math.max(0, this.currentEditRow - 10);
            const visibleEnd = Math.min(this.engine.pattern.rows, this.currentEditRow + 10);
            for (let row = visibleStart; row < visibleEnd; row++) {
                for (let track = 0; track < this.engine.pattern.tracks; track++) {
                    const entry = this.engine.pattern.getEntry(row, track);
                    this.updateSingleCell(row, track, entry);
                }
            }

            this.updateAllTrackControlButtons();
            return;
        }

        // Mark as rendered for future optimizations
        this.isRendered = true;

        container.innerHTML = '';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.padding = '10px';
        container.style.gap = '10px';
        container.style.overflow = 'hidden';

        // Sync BPM with global clock on render
        if (this.controller.clockBPM && this.engine.bpm !== this.controller.clockBPM) {
            this.engine.bpm = this.controller.clockBPM;
            this.engine.msPerRow = this.engine.calculateMsPerRow();
        }

        // Transport controls
        const transportBar = this.createTransportBar();
        container.appendChild(transportBar);

        // Track headers
        const trackHeaders = this.createTrackHeaders();
        container.appendChild(trackHeaders);

        // Tracker grid
        const trackerGrid = this.createTrackerGrid();
        container.appendChild(trackerGrid);

        // Track controls (mute/solo/volume)
        const trackControls = this.createTrackControls();
        container.appendChild(trackControls);

        // Recalculate visible rows after DOM layout
        requestAnimationFrame(() => {
            this.updateTrackerGrid();
        });
    }

    createTransportBar() {
        const bar = document.createElement('div');
        bar.style.cssText = `
            display: flex;
            gap: 10px;
            align-items: center;
            padding: 10px;
            background: #1a1a1a;
            border: 1px solid #333;
            border-radius: 4px;
        `;

        // Common button style
        const buttonStyle = `
            padding: 8px 16px;
            border: 1px solid;
            border-radius: 3px;
            cursor: pointer;
            font-weight: bold;
            font-size: 0.9em;
            padding-bottom: 10px;
            min-width: 90px;
            height: 36px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
        `;

        // Play button
        const playBtn = document.createElement('button');
        playBtn.textContent = '▶ PLAY';
        playBtn.id = 'seq-play-btn';
        playBtn.style.cssText = buttonStyle + `
            background: #2a4a2a;
            color: #4a9e4a;
            border-color: #3a5a3a;
        `;
        playBtn.addEventListener('click', () => this.handlePlayStop());
        bar.appendChild(playBtn);

        // Stop button
        const stopBtn = document.createElement('button');
        stopBtn.textContent = '■ STOP';
        stopBtn.style.cssText = buttonStyle + `
            background: #4a2a2a;
            color: #CF1A37;
            border-color: #5a3a3a;
        `;
        stopBtn.addEventListener('click', () => this.engine.stopPlayback());
        bar.appendChild(stopBtn);

        // Record/Edit button
        const recordBtn = document.createElement('button');
        recordBtn.textContent = '⏺ REC';
        recordBtn.id = 'seq-record-btn';
        recordBtn.style.cssText = buttonStyle + `
            background: ${this.recordMode ? '#4a2a2a' : '#2a2a2a'};
            color: ${this.recordMode ? '#CF1A37' : '#888'};
            border-color: ${this.recordMode ? '#5a3a3a' : '#3a3a3a'};
        `;
        recordBtn.addEventListener('click', () => this.toggleRecordMode());
        bar.appendChild(recordBtn);

        // File operations button
        const fileBtn = document.createElement('button');
        fileBtn.textContent = '📁 FILE';
        fileBtn.style.cssText = buttonStyle + `
            background: #2a2a4a;
            color: #6a6aaa;
            border-color: #3a3a5a;
        `;
        fileBtn.addEventListener('click', () => this.openFileDialog());
        bar.appendChild(fileBtn);

        // Fill Track button
        const fillBtn = document.createElement('button');
        fillBtn.textContent = '⚡ FILL';
        fillBtn.style.cssText = buttonStyle + `
            background: #2a2a4a;
            color: #6a6aaa;
            border-color: #3a3a5a;
        `;
        fillBtn.addEventListener('click', () => this.openFillDialog());
        bar.appendChild(fillBtn);

        // BPM control
        const bpmLabel = document.createElement('span');
        bpmLabel.textContent = 'BPM:';
        bpmLabel.style.color = '#888';
        bpmLabel.style.marginLeft = '20px';
        bar.appendChild(bpmLabel);

        const bpmInput = document.createElement('input');
        bpmInput.type = 'number';
        bpmInput.value = this.engine.bpm;
        bpmInput.min = 20;
        bpmInput.max = 300;
        bpmInput.id = 'seq-bpm-input';
        bpmInput.style.cssText = `
            width: 60px;
            padding: 5px;
            background: #0a0a0a;
            color: #888;
            border: 1px solid #333;
        `;
        bpmInput.addEventListener('click', (e) => {
            e.target.blur(); // Prevent keyboard popup on mobile
            this.openSequencerTempoSlider();
        });
        bpmInput.addEventListener('change', (e) => {
            this.engine.setBPM(parseInt(e.target.value) || 120);
        });
        bar.appendChild(bpmInput);

        // Sync options
        //const syncLabel = document.createElement('span');
        //syncLabel.textContent = '';
        //syncLabel.style.color = '#888';
        //syncLabel.style.marginLeft = '20px';
        //bar.appendChild(syncLabel);

        const syncRecv = document.createElement('label');
        syncRecv.style.cssText = 'display: flex; align-items: center; gap: 5px; color: #888; margin-left: 10px;';
        syncRecv.innerHTML = `
            <input type="checkbox" id="seq-recv-start" ${this.engine.receiveStartStop ? 'checked' : ''}>
            <span>Recv Start/Stop</span>
        `;
        syncRecv.querySelector('input').addEventListener('change', (e) => {
            this.engine.receiveStartStop = e.target.checked;
        });
        bar.appendChild(syncRecv);

        const syncSend = document.createElement('label');
        syncSend.style.cssText = 'display: flex; align-items: center; gap: 5px; color: #888; margin-left: 10px;';
        syncSend.innerHTML = `
            <input type="checkbox" id="seq-send-start" ${this.engine.sendStartStop ? 'checked' : ''}>
            <span>Send Start/Stop</span>
        `;
        syncSend.querySelector('input').addEventListener('change', (e) => {
            this.engine.sendStartStop = e.target.checked;
        });
        bar.appendChild(syncSend);

        // Sync to MIDI Clock checkbox
        const syncClock = document.createElement('label');
        syncClock.style.cssText = 'display: flex; align-items: center; gap: 5px; color: #888; margin-left: 10px;';
        syncClock.innerHTML = `
            <input type="checkbox" id="seq-sync-clock" ${this.engine.syncToMIDIClock ? 'checked' : ''}>
            <span>MIDI Clock</span>
        `;
        syncClock.querySelector('input').addEventListener('change', (e) => {
            this.engine.syncToMIDIClock = e.target.checked;
            // console.log(`[Sequencer] MIDI Clock sync ${e.target.checked ? 'enabled' : 'disabled'}`);

            // If playing, restart to switch timer modes (MIDI clock vs internal)
            if (this.engine.playing) {
                this.engine.stopPlayback();
                this.engine.startPlayback();
            }
        });
        bar.appendChild(syncClock);

        // Sync Playback checkbox - syncs to global clock
        const syncPlayback = document.createElement('label');
        syncPlayback.style.cssText = 'display: flex; align-items: center; gap: 5px; color: #888; margin-left: 10px;';
        syncPlayback.innerHTML = `
            <input type="checkbox" id="seq-sync-playback" ${this.engine.syncToGlobalClock ? 'checked' : ''}>
            <span>🔗 Sync Playback</span>
        `;

        syncPlayback.querySelector('input').addEventListener('change', (e) => {
            this.engine.syncToGlobalClock = e.target.checked;
            // console.log(`[Sequencer] Sync Playback checkbox: ${e.target.checked} - engine.syncToGlobalClock is now: ${this.engine.syncToGlobalClock}`);

            // If playing, restart to switch sync modes
            if (this.engine.playing) {
                // console.log('[Sequencer] Already playing - restarting with new sync mode');
                this.engine.stopPlayback();
                this.engine.startPlayback();
            }
        });
        bar.appendChild(syncPlayback);

        // Send SPP checkbox
        const sendSPP = document.createElement('label');
        sendSPP.style.cssText = 'display: flex; align-items: center; gap: 5px; color: #888; margin-left: 10px;';
        sendSPP.innerHTML = `
            <input type="checkbox" id="seq-send-spp" ${this.engine.sendSPP ? 'checked' : ''}>
            <span>Send SPP</span>
        `;
        sendSPP.querySelector('input').addEventListener('change', (e) => {
            this.engine.sendSPP = e.target.checked;
        });
        bar.appendChild(sendSPP);

        // SPP interval dropdown
        const sppIntervalLabel = document.createElement('span');
        sppIntervalLabel.textContent = '@';
        sppIntervalLabel.style.cssText = 'color: #666; margin-left: 5px;';
        bar.appendChild(sppIntervalLabel);

        const sppInterval = document.createElement('select');
        sppInterval.id = 'seq-spp-interval';
        sppInterval.style.cssText = `
            padding: 5px;
            background: #0a0a0a;
            color: #888;
            border: 1px solid #333;
        `;
        sppInterval.innerHTML = `
            <option value="4" ${this.engine.sppInterval === 4 ? 'selected' : ''}>4</option>
            <option value="8" ${this.engine.sppInterval === 8 ? 'selected' : ''}>8</option>
            <option value="16" ${this.engine.sppInterval === 16 ? 'selected' : ''}>16</option>
            <option value="32" ${this.engine.sppInterval === 32 ? 'selected' : ''}>32</option>
            <option value="64" ${this.engine.sppInterval === 64 ? 'selected' : ''}>64 (pattern boundary)</option>
        `;
        sppInterval.addEventListener('change', (e) => {
            this.engine.sppInterval = parseInt(e.target.value);
        });
        bar.appendChild(sppInterval);

        // Sync to SPP checkbox
        const syncSPP = document.createElement('label');
        syncSPP.style.cssText = 'display: flex; align-items: center; gap: 5px; color: #888; margin-left: 10px;';
        syncSPP.innerHTML = `
            <input type="checkbox" id="seq-sync-spp" ${this.engine.syncToSPP ? 'checked' : ''}>
            <span>Sync SPP</span>
        `;
        syncSPP.querySelector('input').addEventListener('change', (e) => {
            this.engine.syncToSPP = e.target.checked;
        });
        bar.appendChild(syncSPP);

        // Position indicator
        const posLabel = document.createElement('span');
        posLabel.id = 'seq-position';
        posLabel.textContent = `Row: 00`;
        posLabel.style.cssText = `
            margin-left: auto;
            color: #4a9eff;
            font-family: monospace;
            font-weight: bold;
        `;
        bar.appendChild(posLabel);

        return bar;
    }

    createTrackHeaders() {
        const headers = document.createElement('div');
        headers.style.cssText = `
            display: grid;
            grid-template-columns: 40px repeat(4, 1fr);
            gap: 2px;
            padding: 5px;
            background: #0a0a0a;
            border: 1px solid #333;
            border-radius: 4px;
            font-family: monospace;
            font-size: 0.85em;
        `;

        // Row number header
        const rowHeader = document.createElement('div');
        rowHeader.textContent = 'Row';
        rowHeader.style.cssText = 'color: #666; text-align: center; padding: 5px;';
        headers.appendChild(rowHeader);

        // Track headers
        for (let track = 0; track < 4; track++) {
            const trackHeader = document.createElement('div');
            trackHeader.style.cssText = `
                display: flex;
                flex-direction: column;
                gap: 3px;
                padding: 5px;
                background: #1a1a1a;
                border: 1px solid #333;
                border-radius: 2px;
            `;

            // Track title
            const trackTitle = document.createElement('div');
            trackTitle.textContent = `Track ${track + 1}`;
            trackTitle.style.cssText = `
                color: #ddd;
                text-align: center;
                font-weight: bold;
                font-size: 0.9em;
            padding-bottom: 10px;
            `;
            trackHeader.appendChild(trackTitle);

            // Device selector
            const deviceSelect = document.createElement('select');
            deviceSelect.style.cssText = `
                padding: 2px;
                background: #0a0a0a;
                color: #888;
                border: 1px solid #333;
                border-radius: 2px;
                font-size: 0.75em;
            `;

            // Populate device options
            deviceSelect.innerHTML = '<option value="">Default</option>';
            if (this.controller.deviceManager) {
                const devices = this.controller.deviceManager.getAllDevices();
                devices.forEach(device => {
                    const option = document.createElement('option');
                    option.value = device.id;
                    option.textContent = device.name;
                    deviceSelect.appendChild(option);
                });
            }

            // Set current device binding
            const currentBinding = this.engine.trackDeviceBindings[track];
            if (currentBinding) {
                deviceSelect.value = currentBinding;
            }

            // Device change handler
            deviceSelect.addEventListener('change', (e) => {
                this.engine.trackDeviceBindings[track] = e.target.value || null;
                // console.log(`[Sequencer] Track ${track + 1} device binding set to: ${e.target.value || 'default'}`);
            });

            trackHeader.appendChild(deviceSelect);

            // Program selector with -/+ buttons
            const programControl = document.createElement('div');
            programControl.style.cssText = `
                display: flex;
                gap: 2px;
                align-items: center;
            `;

            // Decrement button
            const programDec = document.createElement('button');
            programDec.textContent = '−';
            programDec.style.cssText = `
                padding: 2px 6px;
                background: #333;
                color: #888;
                border: 1px solid #444;
                border-radius: 2px;
                cursor: pointer;
                font-size: 1em;
                font-weight: bold;
                display: flex;
                align-items: center;
                justify-content: center;
                height: 28px;
            `;
            programDec.addEventListener('click', () => {
                this.engine.trackPrograms[track] = Math.max(0, (this.engine.trackPrograms[track] || 0) - 1);
                this.updateTrackHeaders();
                this.triggerAutoSave(); // Save program change
                // console.log(`[Sequencer] Track ${track + 1} program: ${this.engine.trackPrograms[track]}`);
            });
            programControl.appendChild(programDec);

            // Program display
            const programDisplay = document.createElement('div');
            const currentProg = this.engine.trackPrograms[track] || 0;
            programDisplay.textContent = currentProg === 0 ? 'NO PROG' : `PROG ${currentProg}`;
            programDisplay.style.cssText = `
                padding: 0;
                background: #0a0a0a;
                color: #ccc;
                border: 1px solid #333;
                border-radius: 2px;
                min-width: 70px;
                height: 28px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: bold;
                font-size: 0.75em;
                margin-top: 5px;
            `;
            programControl.appendChild(programDisplay);

            // Increment button
            const programInc = document.createElement('button');
            programInc.textContent = '+';
            programInc.style.cssText = `
                padding: 2px 6px;
                background: #333;
                color: #888;
                border: 1px solid #444;
                border-radius: 2px;
                cursor: pointer;
                font-size: 1em;
                font-weight: bold;
                display: flex;
                align-items: center;
                justify-content: center;
                height: 28px;
            `;
            programInc.addEventListener('click', () => {
                this.engine.trackPrograms[track] = Math.min(32, (this.engine.trackPrograms[track] || 0) + 1);
                this.updateTrackHeaders();
                // console.log(`[Sequencer] Track ${track + 1} program: ${this.engine.trackPrograms[track]}`);
            });
            programControl.appendChild(programInc);

            trackHeader.appendChild(programControl);
            headers.appendChild(trackHeader);
        }

        return headers;
    }

    createTrackerGrid() {
        const gridContainer = document.createElement('div');
        gridContainer.id = 'seq-tracker-grid';
        gridContainer.style.cssText = `
            flex: 1;
            overflow-y: auto;
            background: #000;
            border: 2px solid #333;
            border-radius: 4px;
            font-family: monospace;
            font-size: 0.9em;
            padding: 0;
            scrollbar-width: thin;
            scrollbar-color: #444 #000;
        `;

        // Add webkit scrollbar styling
        const style = document.createElement('style');
        style.textContent = `
            #seq-tracker-grid::-webkit-scrollbar {
                width: 8px;
            }
            #seq-tracker-grid::-webkit-scrollbar-track {
                background: #000;
            }
            #seq-tracker-grid::-webkit-scrollbar-thumb {
                background: #444;
                border-radius: 4px;
            }
            #seq-tracker-grid::-webkit-scrollbar-thumb:hover {
                background: #555;
            }
        `;
        if (!document.getElementById('seq-tracker-scrollbar-style')) {
            style.id = 'seq-tracker-scrollbar-style';
            document.head.appendChild(style);
        }

        this.updateTrackerGrid(gridContainer);

        return gridContainer;
    }

    updateTrackerGrid(gridContainer = null) {
        if (!gridContainer) {
            gridContainer = document.getElementById('seq-tracker-grid');
        }
        if (!gridContainer) return;

        // CRITICAL: Batch DOM updates using DocumentFragment to prevent reflow stutters
        const fragment = document.createDocumentFragment();

        // Render ALL rows, let scrolling handle visibility
        for (let row = 0; row < this.engine.pattern.rows; row++) {
            const rowDiv = document.createElement('div');
            rowDiv.style.cssText = `
                display: grid;
                grid-template-columns: 40px repeat(4, 1fr);
                gap: 2px;
                padding: 2px;
                background: ${row % 4 === 0 ? '#0a0a0a' : '#000'};
                border-bottom: 1px solid ${row % 4 === 0 ? '#222' : '#111'};
            `;

            // Row is current playback position
            if (row === this.engine.currentRow && this.engine.playing) {
                rowDiv.style.background = '#1a2a1a';
            }

            // Row number
            const rowNum = document.createElement('div');
            rowNum.textContent = row.toString().padStart(2, '0');
            rowNum.style.cssText = `
                color: ${row === this.cursorRow ? '#4a9eff' : '#666'};
                text-align: center;
                padding: 4px;
                font-weight: ${row === this.cursorRow ? 'bold' : 'normal'};
            `;
            rowDiv.appendChild(rowNum);

            // Track entries
            for (let track = 0; track < 4; track++) {
                const entry = this.engine.pattern.getEntry(row, track);
                const trackDiv = this.createTrackEntryDiv(row, track, entry);
                rowDiv.appendChild(trackDiv);
            }

            fragment.appendChild(rowDiv);
        }

        // Single DOM update instead of 64 individual appendChild calls
        gridContainer.innerHTML = '';
        gridContainer.appendChild(fragment);
    }

    createTrackEntryDiv(row, track, entry) {
        const div = document.createElement('div');
        const isCursor = (row === this.cursorRow && track === this.cursorTrack);

        // CRITICAL: Add ID so we can update this cell without full rebuild
        div.id = `tracker-cell-${row}-${track}`;

        div.style.cssText = `
            display: grid;
            grid-template-columns: 2fr 1fr 1fr;
            gap: 4px;
            padding: 4px;
            background: ${isCursor ? '#2a2a4a' : '#0a0a0a'};
            border: 1px solid ${isCursor ? '#4a4a9a' : '#1a1a1a'};
            border-radius: 2px;
            cursor: pointer;
        `;

        // Note-Octave (combined, tracker format: C-3 for naturals, C#3 for sharps)
        const noteDiv = document.createElement('span');
        noteDiv.className = 'note-field'; // CRITICAL: Add class for updateSingleCell
        if (entry.note) {
            const separator = entry.note.includes('#') ? '' : '-';
            noteDiv.textContent = `${entry.note}${separator}${entry.octave}`;
        } else {
            noteDiv.textContent = '---';
        }
        noteDiv.style.cssText = `
            color: ${entry.note ? '#4a9eff' : '#333'};
            text-align: center;
            font-weight: bold;
            ${isCursor && this.cursorField === 0 ? 'background: #4a6a9a; color: #fff;' : ''}
        `;
        div.appendChild(noteDiv);

        // Volume
        const volumeDiv = document.createElement('span');
        volumeDiv.className = 'volume-field'; // CRITICAL: Add class for updateSingleCell
        volumeDiv.textContent = entry.note ? entry.volume.toString(16).toUpperCase().padStart(2, '0') : '--';
        volumeDiv.style.cssText = `
            color: ${entry.note ? '#9a9a4a' : '#333'};
            text-align: center;
            ${isCursor && this.cursorField === 1 ? 'background: #4a6a9a; color: #fff;' : ''}
        `;
        div.appendChild(volumeDiv);

        // Effect
        const effectDiv = document.createElement('span');
        effectDiv.className = 'effect-field'; // CRITICAL: Add class for updateSingleCell
        effectDiv.textContent = entry.effect || '---';
        effectDiv.style.cssText = `
            color: ${entry.effect ? '#9a4a9a' : '#333'};
            text-align: center;
            ${isCursor && this.cursorField === 2 ? 'background: #4a6a9a; color: #fff;' : ''}
        `;
        div.appendChild(effectDiv);

        // Click to move cursor
        div.addEventListener('click', () => {
            this.cursorRow = row;
            this.cursorTrack = track;
            this.updateCursorVisual();
        });

        return div;
    }

    createTrackControls() {
        const controls = document.createElement('div');
        controls.style.cssText = `
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 10px;
            padding: 10px;
            background: #1a1a1a;
            border: 1px solid #333;
            border-radius: 4px;
        `;

        for (let track = 0; track < 4; track++) {
            const trackControl = document.createElement('div');
            trackControl.style.cssText = `
                display: flex;
                flex-direction: row;
                gap: 0;
                padding: 0;
                background: transparent;
                border: none;
                justify-content: center;
                align-items: center;
            `;

            // Mute button - shows red when trackMutes[track] is true
            const muteBtn = document.createElement('button');
            muteBtn.id = `seq-mute-${track}`; // Add ID for fast updates
            muteBtn.textContent = 'M';
            muteBtn.style.cssText = `
                padding: 6px 12px;
                background: ${this.engine.trackMutes[track] ? '#CF1A37' : '#2a2a2a'};
                color: ${this.engine.trackMutes[track] ? '#fff' : '#888'};
                border: 1px solid #333;
                border-radius: 2px;
                cursor: pointer;
                font-weight: bold;
                font-size: 0.9em;
                min-width: 42px;
                height: 32px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
            `;
            muteBtn.addEventListener('click', () => {
                this.engine.toggleMute(track);
                this.updateTrackControls();
            });
            trackControl.appendChild(muteBtn);

            // Solo button - shows red when this track is soloed
            const soloBtn = document.createElement('button');
            soloBtn.id = `seq-solo-${track}`; // Add ID for fast updates
            soloBtn.textContent = 'S';
            const isSoloed = this.engine.isTrackSoloed(track);
            soloBtn.style.cssText = `
                padding: 6px 12px;
                background: ${isSoloed ? '#CF1A37' : '#2a2a2a'};
                color: ${isSoloed ? '#fff' : '#888'};
                border: 1px solid #333;
                border-radius: 2px;
                cursor: pointer;
                font-weight: bold;
                font-size: 0.9em;
                min-width: 42px;
                height: 32px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
            `;
            soloBtn.addEventListener('click', () => {
                this.engine.toggleSolo(track);
                this.updateTrackControls();
            });
            trackControl.appendChild(soloBtn);

            controls.appendChild(trackControl);
        }

        return controls;
    }

    updateTrackControls() {
        const container = document.getElementById('pads-grid');
        if (!container) return;

        // Remove old controls
        const oldControls = container.querySelector(':scope > div:last-child');
        if (oldControls) {
            oldControls.remove();
        }

        // Add new controls
        const trackControls = this.createTrackControls();
        container.appendChild(trackControls);
    }

    updateTrackHeaders() {
        const container = document.getElementById('pads-grid');
        if (!container) return;

        // Find and replace track headers
        const oldHeaders = container.querySelector(':scope > div:nth-child(2)');
        if (oldHeaders) {
            const newHeaders = this.createTrackHeaders();
            oldHeaders.replaceWith(newHeaders);
        }
    }

    setupPatternChangeListener() {
        // Listen to pattern changes from external sources (e.g., Fire sequencer)
        this.patternChangeListener = (row, track, entry) => {
            // Trigger autosave for ANY pattern change (even from Fire or other sources)
            this.triggerAutoSave();

            // Only update visual if this scene is currently visible
            const container = document.getElementById('pads-grid');
            if (!container || container.querySelector('#seq-tracker-grid') === null) {
                return; // Scene not visible, skip visual update
            }

            // PARTIAL UPDATE: Only update the specific cell that changed
            this.updateSingleCell(row, track, entry);
        };

        // Add listener (supports multiple listeners)
        this.engine.pattern.addPatternChangeListener(this.patternChangeListener);

        // Listen to mute state changes from external sources (e.g., Fire sequencer)
        this.muteChangeListener = (track, muteStates) => {
            // Update the specific track's mute/solo button visuals
            this.updateTrackControlButton(track);
        };

        // Add mute change listener
        this.engine.addMuteChangeListener(this.muteChangeListener);
    }

    /**
     * Get MIDI input IDs from all Fire scenes
     * Used to exclude Fire devices from Sequencer's MIDI input listener
     *
     * NOTE: Fire has multiple modes (STEP/NOTE/DRUM/PERF):
     * - STEP mode (current): Pads toggle steps - exclude from Sequencer
     * - NOTE mode (future): Pads send notes - include for note entry
     *
     * TODO: Add mode tracking to Fire scene and conditionally exclude
     *       based on current mode (only exclude in STEP/DRUM/PERF modes)
     */
    getFireSceneDeviceIds() {
        const fireDeviceIds = new Set();

        if (!this.controller.sceneManager || !this.controller.deviceManager) {
            return fireDeviceIds;
        }

        // Scan all scenes for Fire scenes with device bindings
        for (let [sceneId, scene] of this.controller.sceneManager.scenes) {
            if (scene.type === 'fire-sequencer' && scene.midiInputDevice) {
                // TODO: Check scene.fireInstance.currentMode === 'STEP' before excluding
                // For now, always exclude (Fire is in STEP mode by default)

                // Get the device from Device Manager
                const device = this.controller.deviceManager.getDevice(scene.midiInputDevice);
                if (device) {
                    // Get MIDI input for this device
                    const midiInput = this.controller.deviceManager.getMidiInput(device.id);
                    if (midiInput) {
                        fireDeviceIds.add(midiInput.id);
                    }
                }
            }
        }

        return fireDeviceIds;
    }

    /**
     * Update all track control buttons (mute/solo) without rebuilding DOM
     */
    updateAllTrackControlButtons() {
        for (let track = 0; track < this.engine.pattern.tracks; track++) {
            this.updateTrackControlButton(track);
        }
    }

    /**
     * Update cursor position visually (fast, no DOM rebuild)
     * Just updates CSS classes/colors without rebuilding grid
     */
    updateCursorVisual() {
        // Update all row numbers to highlight current cursor row
        const gridContainer = document.getElementById('seq-tracker-grid');
        if (!gridContainer) return;

        const rows = gridContainer.children;
        for (let row = 0; row < rows.length; row++) {
            const rowDiv = rows[row];
            const rowNum = rowDiv.children[0]; // First child is row number

            // Update row number color
            if (rowNum) {
                rowNum.style.color = row === this.cursorRow ? '#4a9eff' : '#666';
            }

            // Update cell highlights for this row
            for (let track = 0; track < this.engine.pattern.tracks; track++) {
                const cellIndex = track + 1; // +1 because first child is row number
                const cell = rowDiv.children[cellIndex];
                if (!cell) continue;

                const isCurrentCell = (row === this.cursorRow && track === this.cursorTrack);
                // Match the initial render styling exactly
                cell.style.background = isCurrentCell ? '#2a2a4a' : '#0a0a0a';
                cell.style.border = isCurrentCell ? '1px solid #4a4a9a' : '1px solid #1a1a1a';

                // Update field highlighting (note/volume/effect) within current cell
                if (isCurrentCell) {
                    const noteField = cell.querySelector('.note-field');
                    const volumeField = cell.querySelector('.volume-field');
                    const effectField = cell.querySelector('.effect-field');

                    if (noteField) {
                        noteField.style.background = this.cursorField === 0 ? '#4a6a9a' : '';
                        noteField.style.color = this.cursorField === 0 ? '#fff' : (noteField.textContent !== '---' ? '#4a9eff' : '#333');
                    }
                    if (volumeField) {
                        volumeField.style.background = this.cursorField === 1 ? '#4a6a9a' : '';
                        volumeField.style.color = this.cursorField === 1 ? '#fff' : (volumeField.textContent !== '--' ? '#9a9a4a' : '#333');
                    }
                    if (effectField) {
                        effectField.style.background = this.cursorField === 2 ? '#4a6a9a' : '';
                        effectField.style.color = this.cursorField === 2 ? '#fff' : (effectField.textContent !== '---' ? '#9a4a9a' : '#333');
                    }
                } else {
                    // Clear field highlighting in non-cursor cells
                    const noteField = cell.querySelector('.note-field');
                    const volumeField = cell.querySelector('.volume-field');
                    const effectField = cell.querySelector('.effect-field');

                    if (noteField) {
                        noteField.style.background = '';
                        noteField.style.color = noteField.textContent !== '---' ? '#4a9eff' : '#333';
                    }
                    if (volumeField) {
                        volumeField.style.background = '';
                        volumeField.style.color = volumeField.textContent !== '--' ? '#9a9a4a' : '#333';
                    }
                    if (effectField) {
                        effectField.style.background = '';
                        effectField.style.color = effectField.textContent !== '---' ? '#9a4a9a' : '#333';
                    }
                }
            }
        }

        // Scroll to cursor if needed
        if (rows[this.cursorRow]) {
            rows[this.cursorRow].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    /**
     * Update track control buttons (mute/solo) for a specific track (fast, no full rebuild)
     */
    updateTrackControlButton(track) {
        const muteBtn = document.getElementById(`seq-mute-${track}`);
        const soloBtn = document.getElementById(`seq-solo-${track}`);

        if (!muteBtn || !soloBtn) return; // Buttons not in DOM

        // Update mute button
        const isMuted = this.engine.trackMutes[track];
        muteBtn.style.background = isMuted ? '#CF1A37' : '#2a2a2a';
        muteBtn.style.color = isMuted ? '#fff' : '#888';

        // Update solo button
        const isSoloed = this.engine.isTrackSoloed(track);
        soloBtn.style.background = isSoloed ? '#CF1A37' : '#2a2a2a';
        soloBtn.style.color = isSoloed ? '#fff' : '#888';
    }

    /**
     * Update a single cell in the tracker grid (fast, no full rebuild)
     */
    updateSingleCell(row, track, entry) {
        // Find the specific cell in the DOM
        const cellId = `tracker-cell-${row}-${track}`;
        const cell = document.getElementById(cellId);

        if (!cell) return; // Cell not in DOM (might be scrolled out of view)

        // Update cell content based on entry
        const noteDiv = cell.querySelector('.note-field');
        const volumeDiv = cell.querySelector('.volume-field');
        const effectDiv = cell.querySelector('.effect-field');

        if (!noteDiv || !volumeDiv || !effectDiv) return;

        // Update note field (tracker format: C-3 for naturals, C#3 for sharps)
        if (entry && entry.note) {
            const separator = entry.note.includes('#') ? '' : '-';
            noteDiv.textContent = `${entry.note}${separator}${entry.octave}`;
            noteDiv.style.color = '#4a9eff';
        } else {
            noteDiv.textContent = '---';
            noteDiv.style.color = '#333';
        }

        // Update volume field
        if (entry && entry.note) {
            const volHex = entry.volume.toString(16).toUpperCase().padStart(2, '0');
            volumeDiv.textContent = volHex;
            volumeDiv.style.color = '#9a9a4a';
        } else {
            volumeDiv.textContent = '--';
            volumeDiv.style.color = '#333';
        }

        // Update effect field
        if (entry && entry.effect) {
            effectDiv.textContent = entry.effect;
            effectDiv.style.color = '#9a4a9a';
        } else {
            effectDiv.textContent = '---';
            effectDiv.style.color = '#333';
        }
    }

    setupEventListeners() {
        // Keyboard navigation - bind to instance so we can remove it later
        this.keydownHandler = (e) => this.handleKeyDown(e);
        document.addEventListener('keydown', this.keydownHandler);

        // Sync global BPM changes to sequencer
        const globalBpmInput = document.getElementById('clock-bpm');
        if (globalBpmInput) {
            this.globalBpmListener = () => {
                const newBpm = parseInt(globalBpmInput.value) || 120;
                if (newBpm !== this.engine.bpm) {
                    this.engine.bpm = newBpm;
                    this.engine.msPerRow = this.engine.calculateMsPerRow();

                    // Update sequencer BPM display
                    const seqBpmInput = document.getElementById('seq-bpm-input');
                    if (seqBpmInput) {
                        seqBpmInput.value = newBpm;
                    }

                    // console.log(`[Sequencer] BPM synced from global: ${newBpm}`);
                }
            };
            globalBpmInput.addEventListener('change', this.globalBpmListener);
        }

        // MIDI input for note entry
        if (this.controller.midiAccess) {
            this.midiInputListener = (event) => {
                const [status, data1, data2] = event.data;
                const messageType = status & 0xF0;

                // Only process Note On messages
                if (messageType !== 0x90 || data2 === 0) return;

                // CRITICAL: Only handle MIDI input when this scene is active
                // This prevents notes from other sequencers bleeding in via MIDI loopback
                if (this.controller.sceneManager?.currentScene !== this.sceneId) {
                    return; // Not the active scene - ignore all MIDI input
                }

                // CRITICAL: Only insert notes when in record mode
                if (!this.recordMode) return;

                // Only insert notes when cursor is on note field (not velocity/program fields)
                if (this.cursorField !== 0) return;

                // CRITICAL: Never insert notes from MIDI input while ANY sequencer is playing
                // This prevents feedback loops where sequencer output loops back to input
                // Check if ANY scene has a playing sequencer (not just this one)
                if (this.controller.sceneManager) {
                    for (let [sceneId, sceneData] of this.controller.sceneManager.scenes) {
                        if (sceneData.type === 'sequencer' &&
                            sceneData.sequencerInstance &&
                            sceneData.sequencerInstance.engine.playing) {
                            return; // A sequencer is playing - don't insert notes from MIDI input
                        }
                    }
                }

                // CRITICAL: Ignore MIDI input shortly after preview to prevent feedback loops
                // When navigating with arrow keys, preview notes are sent via MIDI and can
                // loop back as input, causing unwanted note entry
                const now = Date.now();
                if (now - this.lastPreviewTime < this.previewIgnoreWindow) {
                    return; // Too soon after preview - likely feedback from our own preview
                }

                // If we got here, accept the note
                const midiNote = data1;
                const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
                const octave = Math.floor(midiNote / 12);
                const noteName = noteNames[midiNote % 12];

                // Set the note at cursor position
                const entry = this.engine.pattern.getEntry(this.cursorRow, this.cursorTrack) || new SequencerEntry();
                entry.note = noteName;
                entry.octave = octave;
                entry.volume = data2; // Use velocity as volume
                this.engine.pattern.setEntry(this.cursorRow, this.cursorTrack, entry);
                this.updateTrackerGrid();

                // Auto-save after MIDI input
                this.triggerAutoSave();

                // Don't preview MIDI input notes - user already hears them from controller
                // and previewing creates infinite loops if MIDI output routes back to input
            };

            // Attach listener to MIDI inputs (excluding Fire devices)
            // Fire scenes have dedicated listeners for their control surfaces
            const fireDeviceIds = this.getFireSceneDeviceIds();

            for (let input of this.controller.midiAccess.inputs.values()) {
                // Skip Fire device inputs - they're handled by Fire scenes
                if (fireDeviceIds.has(input.id)) {
                    continue;
                }
                input.addEventListener('midimessage', this.midiInputListener);
            }
        }

        // Setup UI update interval
        this.setupUIUpdateInterval();
    }

    handlePlayStop() {
        if (this.engine.playing) {
            this.engine.stopPlayback();
        } else {
            this.engine.startPlayback();
        }
    }

    toggleRecordMode() {
        this.recordMode = !this.recordMode;

        // Update record button appearance
        const recordBtn = document.getElementById('seq-record-btn');
        if (recordBtn) {
            recordBtn.style.background = this.recordMode ? '#4a2a2a' : '#2a2a2a';
            recordBtn.style.color = this.recordMode ? '#CF1A37' : '#888';
            recordBtn.style.borderColor = this.recordMode ? '#5a3a3a' : '#3a3a3a';
        }

        // console.log(`[Sequencer] Record mode ${this.recordMode ? 'enabled' : 'disabled'}`);
    }

    openFileDialog() {
        if (!window.nbDialog) {
            console.error('[Sequencer] nbDialog not available');
            return;
        }

        const dialogContent = `
            <div style="
                background: #1a1a1a;
                border: 2px solid #4a4a4a;
                border-radius: 8px;
                padding: 20px;
                min-width: 400px;
                color: #fff;
                font-family: 'Arial', sans-serif;
            ">
                <h3 style="margin: 0 0 20px 0; text-align: center;">File Operations</h3>

                <div style="display: flex; flex-direction: column; gap: 12px;">
                    <button id="file-export-btn" style="
                        padding: 12px 20px;
                        background: #2a4a4a;
                        color: #6a9a9a;
                        border: 1px solid #3a5a5a;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
                        font-size: 14px;
                    ">💾 Export MIDI File</button>

                    <button id="file-import-btn" style="
                        padding: 12px 20px;
                        background: #2a4a2a;
                        color: #6a9a6a;
                        border: 1px solid #3a5a3a;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
                        font-size: 14px;
                    ">📁 Import MIDI File</button>

                    <button id="file-upload-btn" style="
                        padding: 12px 20px;
                        background: #4a2a4a;
                        color: #aa6aaa;
                        border: 1px solid #5a3a5a;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
                        font-size: 14px;
                    ">📤 Upload to Device</button>

                    <button id="file-download-btn" style="
                        padding: 12px 20px;
                        background: #2a2a4a;
                        color: #6a6aaa;
                        border: 1px solid #3a3a5a;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
                        font-size: 14px;
                    ">📥 Download from Device</button>
                </div>

                <div style="margin-top: 20px; text-align: center;">
                    <button id="file-close-btn" style="
                        padding: 10px 30px;
                        background: #4a4a4a;
                        color: #fff;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
                    ">Close</button>
                </div>
            </div>
        `;

        window.nbDialog.show(dialogContent);

        // Wire up buttons
        setTimeout(() => {
            document.getElementById('file-export-btn')?.addEventListener('click', () => {
                window.nbDialog.hide();
                this.exportMIDI();
            });

            document.getElementById('file-import-btn')?.addEventListener('click', () => {
                window.nbDialog.hide();
                this.importMIDI();
            });

            document.getElementById('file-upload-btn')?.addEventListener('click', () => {
                window.nbDialog.hide();
                this.uploadToDevice();
            });

            document.getElementById('file-download-btn')?.addEventListener('click', () => {
                window.nbDialog.hide();
                this.downloadFromDevice();
            });

            document.getElementById('file-close-btn')?.addEventListener('click', () => {
                window.nbDialog.hide();
            });
        }, 100);
    }

    handleKeyDown(e) {
        // Only handle if this scene is active
        if (this.controller.sceneManager?.currentScene !== this.sceneId) {
            return;
        }

        // Handle CTRL+C/V separately (before switch) to not block plain C/V for note entry
        if (e.ctrlKey && !e.shiftKey && !e.altKey) {
            if (e.key === 'c' || e.key === 'C') {
                e.preventDefault();
                this.copyCurrentEntry();
                return;
            }
            if (e.key === 'v' || e.key === 'V') {
                e.preventDefault();
                this.pasteEntry();
                return;
            }
        }

        // Arrow keys for navigation (always enabled)
        // Note editing requires record mode (editing operations below)
        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();

                // Note field: Shift+Up = increment note, Ctrl+Up = increment octave
                if (this.cursorField === 0) {
                    if (e.shiftKey) {
                        this.incrementNote(1);
                    } else if (e.ctrlKey) {
                        this.incrementOctave(1);
                    } else {
                        // Normal Up = move cursor up
                        this.cursorRow = Math.max(0, this.cursorRow - 1);
                        this.ensureCursorVisible();
                        this.updateCursorVisual();

                        // Only preview if NOT playing
                        if (!this.engine.playing) {
                            const entry = this.engine.pattern.getEntry(this.cursorRow, this.cursorTrack);
                            if (entry && entry.note) {
                                this.previewNote(entry);
                            }
                        }
                    }
                }
                // Volume field: Shift+Up = small increment (+1), Ctrl+Up = large increment (+16)
                else if (this.cursorField === 1) {
                    if (e.shiftKey) {
                        this.incrementVolume(1);
                    } else if (e.ctrlKey) {
                        this.incrementVolume(16);
                    } else {
                        // Normal Up = move cursor up
                        this.cursorRow = Math.max(0, this.cursorRow - 1);
                        this.ensureCursorVisible();
                        this.updateCursorVisual();
                    }
                }
                // Effect field: just move cursor
                else {
                    this.cursorRow = Math.max(0, this.cursorRow - 1);
                    this.ensureCursorVisible();
                    this.updateCursorVisual();
                }
                break;

            case 'ArrowDown':
                e.preventDefault();

                // Note field: Shift+Down = decrement note, Ctrl+Down = decrement octave
                if (this.cursorField === 0) {
                    if (e.shiftKey) {
                        this.incrementNote(-1);
                    } else if (e.ctrlKey) {
                        this.incrementOctave(-1);
                    } else {
                        // Normal Down = move cursor down
                        this.cursorRow = Math.min(this.engine.pattern.rows - 1, this.cursorRow + 1);
                        this.ensureCursorVisible();
                        this.updateCursorVisual();

                        // Only preview if NOT playing
                        if (!this.engine.playing) {
                            const entry = this.engine.pattern.getEntry(this.cursorRow, this.cursorTrack);
                            if (entry && entry.note) {
                                this.previewNote(entry);
                            }
                        }
                    }
                }
                // Volume field: Shift+Down = small decrement (-1), Ctrl+Down = large decrement (-16)
                else if (this.cursorField === 1) {
                    if (e.shiftKey) {
                        this.incrementVolume(-1);
                    } else if (e.ctrlKey) {
                        this.incrementVolume(-16);
                    } else {
                        // Normal Down = move cursor down
                        this.cursorRow = Math.min(this.engine.pattern.rows - 1, this.cursorRow + 1);
                        this.ensureCursorVisible();
                        this.updateCursorVisual();
                    }
                }
                // Effect field: just move cursor
                else {
                    this.cursorRow = Math.min(this.engine.pattern.rows - 1, this.cursorRow + 1);
                    this.ensureCursorVisible();
                    this.updateCursorVisual();
                }
                break;

            case 'ArrowLeft':
                e.preventDefault();
                this.cursorField--;
                if (this.cursorField < 0) {
                    this.cursorTrack = Math.max(0, this.cursorTrack - 1);
                    this.cursorField = 2;
                }
                this.updateCursorVisual();
                break;

            case 'ArrowRight':
                e.preventDefault();
                this.cursorField++;
                if (this.cursorField > 2) {
                    this.cursorTrack = Math.min(3, this.cursorTrack + 1);
                    this.cursorField = 0;
                }
                this.updateCursorVisual();
                break;

            case ' ':
                e.preventDefault();
                this.handlePlayStop();
                break;

            case 'PageDown':
                e.preventDefault();
                this.cursorRow = Math.min(this.engine.pattern.rows - 1, this.cursorRow + 16);
                this.ensureCursorVisible();
                this.updateCursorVisual();
                break;

            case 'PageUp':
                e.preventDefault();
                this.cursorRow = Math.max(0, this.cursorRow - 16);
                this.ensureCursorVisible();
                this.updateCursorVisual();
                break;

            case 'Delete':
                e.preventDefault();
                this.clearCurrentEntry();
                break;

            default:
                // Handle note input (C, D, E, F, G, A, B) when on note field (requires record mode)
                if (this.recordMode && this.cursorField === 0 && /^[A-G]$/i.test(e.key)) {
                    e.preventDefault();
                    this.setNote(e.key.toUpperCase());
                }
                // Handle hex input (0-9, A-F) when on volume field (requires record mode)
                else if (this.recordMode && this.cursorField === 1 && /^[0-9A-F]$/i.test(e.key)) {
                    e.preventDefault();
                    this.setVolumeHex(e.key.toUpperCase());
                }
                break;
        }
    }

    incrementNote(direction) {
        const entry = this.engine.pattern.getEntry(this.cursorRow, this.cursorTrack) || new SequencerEntry();
        if (!entry.note) {
            // If no note, start with C-3
            entry.note = 'C';
            entry.octave = 3;
        } else {
            // Note sequence: C, C#, D, D#, E, F, F#, G, G#, A, A#, B
            const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
            let index = notes.indexOf(entry.note);
            if (index !== -1) {
                index += direction;
                // Wrap around
                if (index < 0) {
                    index = notes.length - 1;
                    entry.octave = Math.max(0, entry.octave - 1);
                } else if (index >= notes.length) {
                    index = 0;
                    entry.octave = Math.min(8, entry.octave + 1);
                }
                entry.note = notes[index];
            }
        }

        // Ensure volume is set for preview
        if (!entry.volume) {
            entry.volume = 100;
        }

        this.engine.pattern.setEntry(this.cursorRow, this.cursorTrack, entry);
        this.updateSingleCell(this.cursorRow, this.cursorTrack, entry);
        this.updateCursorVisual(); // Apply cursor highlighting

        // Preview the note audibly (SHIFT+UP/DOWN) - only if NOT playing
        if (!this.engine.playing) {
            this.previewNote(entry);
        }

        // Auto-save after edit
        this.triggerAutoSave();
    }

    incrementOctave(direction) {
        const entry = this.engine.pattern.getEntry(this.cursorRow, this.cursorTrack) || new SequencerEntry();
        if (!entry.note) {
            // If no note, start with C-3
            entry.note = 'C';
            entry.octave = 3;
        } else {
            entry.octave = Math.max(0, Math.min(8, entry.octave + direction));
        }

        // Ensure volume is set for preview
        if (!entry.volume) {
            entry.volume = 100;
        }

        this.engine.pattern.setEntry(this.cursorRow, this.cursorTrack, entry);
        this.updateSingleCell(this.cursorRow, this.cursorTrack, entry);
        this.updateCursorVisual(); // Apply cursor highlighting

        // Preview the note audibly (CTRL+UP/DOWN) - only if NOT playing
        if (!this.engine.playing) {
            this.previewNote(entry);
        }

        // Auto-save after edit
        this.triggerAutoSave();
    }

    ensureCursorVisible() {
        const gridContainer = document.getElementById('seq-tracker-grid');
        if (!gridContainer) return;

        // Find the row element
        const rowElements = gridContainer.children;
        if (this.cursorRow < rowElements.length) {
            const rowElement = rowElements[this.cursorRow];
            if (rowElement) {
                rowElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    }

    previewNote(entry) {
        if (!entry || !entry.note) return;

        const midiNote = entry.getMidiNote();
        if (midiNote === null || midiNote < 0 || midiNote > 127) return;

        const velocity = Math.min(127, Math.max(0, entry.volume || 100));
        const program = entry.program || this.engine.trackPrograms[this.cursorTrack] || 0;

        // Mark preview timestamp to ignore MIDI feedback
        this.lastPreviewTime = Date.now();

        // Play the note on the current track
        this.engine.playNote(this.cursorTrack, midiNote, velocity, program);
    }

    setNote(note) {
        const entry = this.engine.pattern.getEntry(this.cursorRow, this.cursorTrack) || new SequencerEntry();

        // If this was an empty entry, set default octave to 3
        if (!entry.note) {
            entry.octave = 3;
        }

        entry.note = note;
        this.engine.pattern.setEntry(this.cursorRow, this.cursorTrack, entry);
        this.updateTrackerGrid();

        // Preview the note
        this.previewNote(entry);

        // Auto-save after edit
        this.triggerAutoSave();

        // Don't auto-advance cursor - let user press Enter or Down to move
    }

    incrementVolume(amount) {
        const entry = this.engine.pattern.getEntry(this.cursorRow, this.cursorTrack) || new SequencerEntry();

        // If no note, create one first
        if (!entry.note) {
            entry.note = 'C';
            entry.octave = 3;
        }

        // Increment volume (clamp to 0-127)
        entry.volume = Math.max(0, Math.min(127, (entry.volume || 100) + amount));

        this.engine.pattern.setEntry(this.cursorRow, this.cursorTrack, entry);
        this.updateSingleCell(this.cursorRow, this.cursorTrack, entry);
        this.updateCursorVisual(); // Apply cursor highlighting (white text on blue background)

        // Preview the note at new volume - only if NOT playing
        if (!this.engine.playing) {
            this.previewNote(entry);
        }

        // Auto-save after edit
        this.triggerAutoSave();
    }

    setVolumeHex(hexDigit) {
        const entry = this.engine.pattern.getEntry(this.cursorRow, this.cursorTrack) || new SequencerEntry();

        // If no note, create one first
        if (!entry.note) {
            entry.note = 'C';
            entry.octave = 3;
        }

        // Convert hex digit to value (0-15)
        const digitValue = parseInt(hexDigit, 16);

        // Current volume in hex (00-7F)
        const currentVolume = entry.volume || 100;
        const currentHex = currentVolume.toString(16).toUpperCase().padStart(2, '0');

        // Replace second hex digit (units place)
        const highNibble = parseInt(currentHex[0], 16);
        const newVolume = (highNibble * 16) + digitValue;

        // Clamp to 0-127
        entry.volume = Math.max(0, Math.min(127, newVolume));

        this.engine.pattern.setEntry(this.cursorRow, this.cursorTrack, entry);
        this.updateTrackerGrid();

        // Preview the note at new volume
        this.previewNote(entry);
    }

    clearCurrentEntry() {
        const entry = new SequencerEntry();
        this.engine.pattern.setEntry(this.cursorRow, this.cursorTrack, entry);
        this.updateSingleCell(this.cursorRow, this.cursorTrack, entry);

        // Auto-save after edit
        this.triggerAutoSave();
    }

    copyCurrentEntry() {
        // Copy current entry to clipboard
        const entry = this.engine.pattern.getEntry(this.cursorRow, this.cursorTrack);
        if (entry) {
            this.clipboard = entry.clone();
        }
    }

    pasteEntry() {
        // Paste from clipboard to current position
        if (this.clipboard) {
            const entry = this.clipboard.clone();
            this.engine.pattern.setEntry(this.cursorRow, this.cursorTrack, entry);
            this.updateSingleCell(this.cursorRow, this.cursorTrack, entry);
            this.updateCursorVisual(); // Apply cursor highlighting

            // Preview pasted note (only if not playing)
            if (!this.engine.playing && entry.note) {
                this.previewNote(entry);
            }

            // Auto-save after paste
            this.triggerAutoSave();
        }
    }

    openFillDialog() {
        // Use centralized fill dialog from fill-dialog.js with note preview
        showFillDialog(
            this, // sequencer
            this.cursorTrack + 1, // track (1-based for display)
            this.cursorRow,
            this.cursorTrack,
            this.engine,
            (selectedNote, selectedOctave, selectedInterval, selectedVelocity) => {
                // Fill the track starting from cursor position
                for (let row = this.cursorRow; row < this.engine.pattern.rows; row += selectedInterval) {
                    const entry = new SequencerEntry();
                    entry.note = selectedNote;
                    entry.octave = selectedOctave;
                    entry.volume = selectedVelocity;
                    entry.program = this.engine.trackPrograms[this.cursorTrack] || 0;
                    this.engine.pattern.setEntry(row, this.cursorTrack, entry);
                }

                this.updateTrackerGrid();

                // Auto-save after fill
                this.triggerAutoSave();

                const separator = selectedNote.includes('#') ? '' : '-';
                // console.log(`[Sequencer] Filled track ${this.cursorTrack + 1} with ${selectedNote}${separator}${selectedOctave} every ${selectedInterval} rows from row ${this.cursorRow}`);
            }
        );
    }

    /**
     * Open tempo slider popup for sequencer BPM
     */
    openSequencerTempoSlider() {
        const overlay = document.getElementById('tempo-slider-overlay');
        const tempoFader = document.getElementById('global-tempo-fader');
        const display = document.getElementById('tempo-display-value');
        const closeBtn = document.getElementById('close-tempo-slider');

        // Set initial values from sequencer engine
        tempoFader.setAttribute('bpm', this.engine.bpm);
        display.textContent = this.engine.bpm;

        // Show overlay
        overlay.classList.add('active');

        // Handle tempo changes from fader (live updates)
        const handleTempoChange = (e) => {
            const bpm = e.detail.bpm;
            display.textContent = bpm;

            // Update sequencer engine BPM (seamless, no restart)
            this.engine.bpm = bpm;
            this.engine.msPerRow = this.engine.calculateMsPerRow();

            // Update sequencer BPM display
            const seqBpmInput = document.getElementById('seq-bpm-input');
            if (seqBpmInput) {
                seqBpmInput.value = bpm;
            }

            // Sync to global clock if controller is available
            if (this.engine.controller) {
                this.engine.controller.clockBPM = bpm;
                const globalBpmInput = document.getElementById('clock-bpm');
                if (globalBpmInput) {
                    globalBpmInput.value = bpm;
                }
            }
        };

        const handleClose = () => {
            overlay.classList.remove('active');
            tempoFader.removeEventListener('tempo-change', handleTempoChange);
            tempoFader.removeEventListener('tempo-reset', handleTempoChange);
            closeBtn.removeEventListener('click', handleClose);

            // Save config
            if (this.engine.controller && this.engine.controller.saveConfig) {
                this.engine.controller.saveConfig();
            }
        };

        tempoFader.addEventListener('tempo-change', handleTempoChange);
        tempoFader.addEventListener('tempo-reset', handleTempoChange); // Handle reset button too
        closeBtn.addEventListener('click', handleClose);
    }

    /**
     * Export single track to MIDI file
     * @param {number} trackIndex - Track to export (0-3)
     * @returns {Uint8Array} - MIDI file data
     */
    exportSingleTrackMIDI(trackIndex) {
        const tracks = [];
        const ticksPerQuarterNote = 480;
        const ticksPerRow = ticksPerQuarterNote / 4;

        // Tempo track
        const tempoTrack = [];
        tempoTrack.push(0x00);
        tempoTrack.push(0xFF, 0x51, 0x03);
        const microsecondsPerQuarter = Math.floor(60000000 / this.engine.bpm);
        tempoTrack.push((microsecondsPerQuarter >> 16) & 0xFF);
        tempoTrack.push((microsecondsPerQuarter >> 8) & 0xFF);
        tempoTrack.push(microsecondsPerQuarter & 0xFF);
        tempoTrack.push(0x00);
        tempoTrack.push(0xFF, 0x2F, 0x00);
        tracks.push(tempoTrack);

        // Export only the specified track
        const track = this.buildMIDITrack(trackIndex, ticksPerRow);
        tracks.push(track);

        return this.buildMIDIFile(tracks, ticksPerQuarterNote);
    }

    /**
     * Build MIDI track data for a single sequencer track
     */
    buildMIDITrack(trackIndex, ticksPerRow) {
        const midiTrack = [];
        const events = [];

        // Get device and channel for this track
        const trackDeviceBinding = this.engine.trackDeviceBindings[trackIndex];
        let midiChannel = 0;

        if (trackDeviceBinding && this.controller.deviceManager) {
            const device = this.controller.deviceManager.getDevice(trackDeviceBinding);
            if (device) {
                midiChannel = device.midiChannel;
            }
        }

        // Track name
        const trackName = `Track ${trackIndex + 1}`;
        midiTrack.push(0x00);
        midiTrack.push(0xFF, 0x03);
        midiTrack.push(trackName.length);
        for (let i = 0; i < trackName.length; i++) {
            midiTrack.push(trackName.charCodeAt(i));
        }

        // Convert pattern to note events
        const activeNotes = new Map();

        for (let row = 0; row < this.engine.pattern.rows; row++) {
            const entry = this.engine.pattern.getEntry(row, trackIndex);

            if (entry && !entry.isEmpty()) {
                const time = row * ticksPerRow;

                // Note off for previous note
                if (activeNotes.has(trackIndex)) {
                    const prevNote = activeNotes.get(trackIndex);
                    events.push({ time, type: 'noteOff', note: prevNote, velocity: 0, channel: midiChannel });
                    activeNotes.delete(trackIndex);
                }

                if (entry.isNoteOff()) {
                    continue;
                }

                const midiNote = entry.getMidiNote();
                if (midiNote !== null && midiNote >= 0 && midiNote <= 127) {
                    const velocity = Math.min(127, Math.max(0, entry.volume));
                    events.push({ time, type: 'noteOn', note: midiNote, velocity, channel: midiChannel });
                    activeNotes.set(trackIndex, midiNote);
                }
            }
        }

        // Note off for any remaining active notes
        if (activeNotes.has(trackIndex)) {
            const prevNote = activeNotes.get(trackIndex);
            const time = this.engine.pattern.rows * ticksPerRow;
            events.push({ time, type: 'noteOff', note: prevNote, velocity: 0, channel: midiChannel });
        }

        // Sort events by time
        events.sort((a, b) => a.time - b.time);

        // Convert events to MIDI bytes with delta times
        let lastTime = 0;
        events.forEach(event => {
            const deltaTime = event.time - lastTime;
            lastTime = event.time;

            this.writeVarLen(midiTrack, deltaTime);

            if (event.type === 'noteOn') {
                midiTrack.push(0x90 | event.channel, event.note, event.velocity);
            } else if (event.type === 'noteOff') {
                midiTrack.push(0x80 | event.channel, event.note, event.velocity);
            }
        });

        // End of track
        midiTrack.push(0x00);
        midiTrack.push(0xFF, 0x2F, 0x00);

        return midiTrack;
    }

    /**
     * Build complete MIDI file from tracks
     */
    buildMIDIFile(tracks, ticksPerQuarterNote) {
        const midiFile = [];

        // Header chunk
        midiFile.push(0x4D, 0x54, 0x68, 0x64); // "MThd"
        midiFile.push(0x00, 0x00, 0x00, 0x06);
        midiFile.push(0x00, 0x01); // Format 1
        midiFile.push((tracks.length >> 8) & 0xFF, tracks.length & 0xFF);
        midiFile.push((ticksPerQuarterNote >> 8) & 0xFF, ticksPerQuarterNote & 0xFF);

        // Track chunks
        tracks.forEach(track => {
            midiFile.push(0x4D, 0x54, 0x72, 0x6B); // "MTrk"
            const trackLength = track.length;
            midiFile.push((trackLength >> 24) & 0xFF, (trackLength >> 16) & 0xFF, (trackLength >> 8) & 0xFF, trackLength & 0xFF);
            midiFile.push(...track);
        });

        return new Uint8Array(midiFile);
    }

    exportMIDI(returnData = false, selectedTracks = null) {
        // If no track selection provided and not returning data, show dialog
        if (!returnData && selectedTracks === null) {
            this.showExportTrackDialog();
            return;
        }

        // Create Standard MIDI File (Format 1)
        const tracks = [];

        // Calculate ticks per quarter note (standard is 480)
        const ticksPerQuarterNote = 480;
        const ticksPerRow = ticksPerQuarterNote / 4; // 16th note resolution

        // Track 0: Tempo track
        const tempoTrack = [];
        tempoTrack.push(0x00); // Delta time
        tempoTrack.push(0xFF, 0x51, 0x03); // Set Tempo meta event
        const microsecondsPerQuarter = Math.floor(60000000 / this.engine.bpm);
        tempoTrack.push((microsecondsPerQuarter >> 16) & 0xFF);
        tempoTrack.push((microsecondsPerQuarter >> 8) & 0xFF);
        tempoTrack.push(microsecondsPerQuarter & 0xFF);
        tempoTrack.push(0x00); // Delta time
        tempoTrack.push(0xFF, 0x2F, 0x00); // End of track
        tracks.push(tempoTrack);

        // Determine which tracks to export
        const tracksToExport = selectedTracks === 'all'
            ? Array.from({length: 4}, (_, i) => i)
            : [selectedTracks];

        // Convert selected sequencer tracks to MIDI tracks
        for (const track of tracksToExport) {
            tracks.push(this.buildMIDITrack(track, ticksPerRow));
        }

        // Build complete MIDI file
        const midiFile = this.buildMIDIFile(tracks, ticksPerQuarterNote);

        // Return data if requested, otherwise download
        if (returnData) {
            return midiFile;
        }

        // Download file
        const blob = new Blob([midiFile], { type: 'audio/midi' });
        const url = URL.createObjectURL(blob);
        const trackSuffix = selectedTracks === 'all' ? 'all' : `track${selectedTracks + 1}`;
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.name.replace(/[^a-z0-9]/gi, '_')}_${trackSuffix}_${Date.now()}.mid`;
        a.click();
        URL.revokeObjectURL(url);

        // console.log(`[Sequencer] Exported MIDI file: ${a.download}`);
    }

    showExportTrackDialog() {
        if (!window.nbDialog) {
            console.error('[Sequencer] nbDialog not available');
            return;
        }

        const dialogContent = `
            <div style="
                background: #1a1a1a;
                border: 2px solid #4a4a4a;
                border-radius: 8px;
                padding: 20px;
                min-width: 350px;
                color: #fff;
                font-family: 'Arial', sans-serif;
            ">
                <h3 style="margin: 0 0 15px 0; text-align: center;">Export MIDI</h3>

                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: bold;">Select track(s) to export:</label>
                    <select id="export-track-selector" style="
                        width: 100%;
                        padding: 8px;
                        background: #0a0a0a;
                        color: #ccc;
                        border: 1px solid #555;
                        border-radius: 4px;
                        font-size: 14px;
                    ">
                        <option value="all">All 4 tracks</option>
                        ${Array.from({length: 4}, (_, i) => `<option value="${i}">Track ${i + 1}</option>`).join('')}
                    </select>
                </div>

                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button id="export-cancel" style="
                        padding: 10px 20px;
                        background: #4a4a4a;
                        color: #fff;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
                    ">Cancel</button>
                    <button id="export-ok" style="
                        padding: 10px 20px;
                        background: #4a9eff;
                        color: #fff;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
                    ">Export</button>
                </div>
            </div>
        `;

        window.nbDialog.show(dialogContent);

        // Wire up buttons
        setTimeout(() => {
            document.getElementById('export-cancel')?.addEventListener('click', () => {
                window.nbDialog.hide();
            });

            document.getElementById('export-ok')?.addEventListener('click', () => {
                const trackSelection = document.getElementById('export-track-selector').value;
                window.nbDialog.hide();

                const selectedTracks = trackSelection === 'all' ? 'all' : parseInt(trackSelection);
                this.exportMIDI(false, selectedTracks);
            });
        }, 100);
    }

    importMIDI() {
        // Create file input
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.mid,.midi';
        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = new Uint8Array(event.target.result);
                    this.showImportTrackDialog(data, file.name);
                } catch (err) {
                    console.error('[Sequencer] MIDI import error:', err);
                    if (window.nbDialog) {
                        window.nbDialog.alert('Error importing MIDI file: ' + err.message);
                    }
                }
            };
            reader.readAsArrayBuffer(file);
        });
        input.click();
    }

    showImportTrackDialog(midiData, fileName) {
        if (!window.nbDialog) {
            console.error('[Sequencer] nbDialog not available');
            return;
        }

        const dialogContent = `
            <div style="
                background: #1a1a1a;
                border: 2px solid #4a4a4a;
                border-radius: 8px;
                padding: 20px;
                min-width: 350px;
                color: #fff;
                font-family: 'Arial', sans-serif;
            ">
                <h3 style="margin: 0 0 15px 0; text-align: center;">Import MIDI</h3>

                <div style="margin-bottom: 15px;">
                    <strong>File:</strong> ${fileName}
                </div>

                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: bold;">Import to track:</label>
                    <select id="import-track-selector" style="
                        width: 100%;
                        padding: 8px;
                        background: #0a0a0a;
                        color: #ccc;
                        border: 1px solid #555;
                        border-radius: 4px;
                        font-size: 14px;
                    ">
                        ${Array.from({length: 4}, (_, i) => `<option value="${i}">Track ${i + 1}</option>`).join('')}
                    </select>
                </div>

                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button id="import-cancel" style="
                        padding: 10px 20px;
                        background: #4a4a4a;
                        color: #fff;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
                    ">Cancel</button>
                    <button id="import-ok" style="
                        padding: 10px 20px;
                        background: #4a9eff;
                        color: #fff;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
                    ">Import</button>
                </div>
            </div>
        `;

        window.nbDialog.show(dialogContent);

        // Wire up buttons
        setTimeout(() => {
            document.getElementById('import-cancel')?.addEventListener('click', () => {
                window.nbDialog.hide();
            });

            document.getElementById('import-ok')?.addEventListener('click', () => {
                const targetTrack = parseInt(document.getElementById('import-track-selector').value);
                window.nbDialog.hide();

                this.parseMIDIFile(midiData, targetTrack);
            });
        }, 100);
    }

    parseMIDIFile(data, targetTrack) {
        try {
            let pos = 0;

            // Read header
            if (data.length < 14) {
                throw new Error(`File too small (${data.length} bytes), minimum is 14 bytes for MIDI header`);
            }

            const header = String.fromCharCode(...data.slice(pos, pos + 4));
            pos += 4;

            if (header !== 'MThd') {
                throw new Error(`Not a valid MIDI file (missing MThd header, found '${header}')`);
            }

            const headerLength = (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3];
            pos += 4;

            const format = (data[pos] << 8) | data[pos + 1];
            pos += 2;

            const numTracks = (data[pos] << 8) | data[pos + 1];
            pos += 2;

            const ticksPerQuarterNote = (data[pos] << 8) | data[pos + 1];
            pos += 2;

            // console.log(`[Sequencer] MIDI Import: Format ${format}, ${numTracks} tracks, ${ticksPerQuarterNote} ticks/quarter, header length ${headerLength}`);
            // console.log(`[Sequencer] Importing to sequencer track ${targetTrack + 1}`);

            // Parse all tracks and import the first non-tempo track
            let midiTrackIndex = 0;
            let importedTrackCount = 0;

            while (pos < data.length && midiTrackIndex < numTracks) {
                if (pos + 8 > data.length) {
                    console.warn(`[Sequencer] Not enough data for track header at pos ${pos}`);
                    break;
                }

                const trackHeader = String.fromCharCode(...data.slice(pos, pos + 4));
                pos += 4;

                if (trackHeader !== 'MTrk') {
                    console.warn(`[Sequencer] Skipping unknown chunk: '${trackHeader}' at pos ${pos - 4}`);
                    break;
                }

                const trackLength = (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3];
                pos += 4;

                if (pos + trackLength > data.length) {
                    console.warn(`[Sequencer] Track ${midiTrackIndex} length ${trackLength} exceeds file size (${data.length - pos} bytes remaining)`);
                    break;
                }

                const trackData = data.slice(pos, pos + trackLength);
                pos += trackLength;

                // console.log(`[Sequencer] Found MIDI track ${midiTrackIndex}, length ${trackLength} bytes`);

                // Skip track 0 (usually tempo/meta track)
                if (midiTrackIndex === 0) {
                    // console.log(`[Sequencer] Skipping track 0 (tempo/meta track)`);
                    midiTrackIndex++;
                    continue;
                }

                // Import the first non-tempo track we find
                // console.log(`[Sequencer] Importing MIDI track ${midiTrackIndex} to sequencer track ${targetTrack + 1}`);
                this.importMIDITrack(trackData, targetTrack, ticksPerQuarterNote);
                importedTrackCount++;
                midiTrackIndex++;
                break; // Only import one track
            }

            this.updateTrackerGrid();

            if (importedTrackCount > 0) {
                // console.log(`[Sequencer] MIDI import complete: imported ${importedTrackCount} track(s)`);
                if (window.nbDialog) {
                    window.nbDialog.alert(`MIDI file imported successfully to track ${targetTrack + 1}!`);
                }
            } else {
                console.warn('[Sequencer] No tracks found to import');
                if (window.nbDialog) {
                    window.nbDialog.alert('No tracks found in MIDI file');
                }
            }
        } catch (err) {
            console.error(`[Sequencer] Error parsing MIDI file:`, err);
            if (window.nbDialog) {
                window.nbDialog.alert(`Error importing MIDI file: ${err.message}`);
            }
        }
    }

    importMIDITrack(trackData, targetTrack, ticksPerQuarterNote) {
        let pos = 0;
        let time = 0;
        let runningStatus = 0;

        const ticksPerRow = ticksPerQuarterNote / 4; // 16th note resolution
        const noteEvents = [];

        // console.log(`[Sequencer] Parsing track data: ${trackData.length} bytes, ticksPerQuarterNote=${ticksPerQuarterNote}, ticksPerRow=${ticksPerRow}`);

        try {
            while (pos < trackData.length) {
                // Read variable-length delta time
                try {
                    const [deltaTime, newPos] = this.readVarLen(trackData, pos);
                    pos = newPos;
                    time += deltaTime;
                } catch (err) {
                    console.error(`[Sequencer] Error reading delta time at pos ${pos}:`, err);
                    break;
                }

                // Check if we have enough data
                if (pos >= trackData.length) {
                    // console.log(`[Sequencer] Reached end of track data at pos ${pos}`);
                    break;
                }

                // Read event
                let status = trackData[pos];

                // Handle running status
                if (status < 0x80) {
                    status = runningStatus;
                } else {
                    pos++;
                    runningStatus = status;
                }

                const messageType = status & 0xF0;

                if (messageType === 0x90 || messageType === 0x80) {
                    // Note On/Off
                    if (pos + 1 >= trackData.length) {
                        console.warn(`[Sequencer] Not enough data for note event at pos ${pos}`);
                        break;
                    }
                    const note = trackData[pos++];
                    const velocity = trackData[pos++];

                    const row = Math.floor(time / ticksPerRow);

                    if (messageType === 0x90 && velocity > 0) {
                        // Note On - only log occasionally to avoid spam
                        if (noteEvents.length < 5 || noteEvents.length % 10 === 0) {
                            // console.log(`[Sequencer] Note On: ${note} at tick ${time}, row ${row}, velocity ${velocity}`);
                        }
                        noteEvents.push({ row, note, velocity });
                    }
                } else if (messageType >= 0xC0 && messageType <= 0xE0) {
                    // Program Change, Channel Pressure (2 bytes total including status)
                    if (pos >= trackData.length) break;
                    pos++;
                } else if (messageType >= 0x80 && messageType <= 0xB0) {
                    // Note Off, Control Change, etc. (3 bytes total including status)
                    if (pos + 1 >= trackData.length) break;
                    pos += 2;
                } else if (status === 0xFF) {
                    // Meta event
                    if (pos >= trackData.length) break;
                    const metaType = trackData[pos++];
                    if (pos >= trackData.length) break;
                    try {
                        const [length, newPos2] = this.readVarLen(trackData, pos);
                        pos = newPos2 + length;
                        if (pos > trackData.length) {
                            console.warn(`[Sequencer] Meta event extends beyond track data: metaType=0x${metaType.toString(16)}, length=${length}`);
                            pos = trackData.length;
                            break;
                        }
                    } catch (err) {
                        console.error(`[Sequencer] Error reading meta event length at pos ${pos}:`, err);
                        break;
                    }
                } else if (status === 0xF0 || status === 0xF7) {
                    // SysEx
                    try {
                        const [length, newPos2] = this.readVarLen(trackData, pos);
                        pos = newPos2 + length;
                        if (pos > trackData.length) {
                            console.warn(`[Sequencer] SysEx extends beyond track data: length=${length}`);
                            pos = trackData.length;
                            break;
                        }
                    } catch (err) {
                        console.error(`[Sequencer] Error reading SysEx length at pos ${pos}:`, err);
                        break;
                    }
                } else {
                    console.warn(`[Sequencer] Unknown status byte 0x${status.toString(16)} at pos ${pos}`);
                    // Try to skip this byte and continue
                    pos++;
                }
            }
        } catch (err) {
            console.error(`[Sequencer] Error parsing MIDI track:`, err);
            if (window.nbDialog) {
                window.nbDialog.alert(`Error parsing MIDI track: ${err.message}`);
            }
        }

        // Write notes to sequencer pattern
        noteEvents.forEach(event => {
            if (event.row >= 0 && event.row < this.engine.pattern.rows) {
                const entry = new SequencerEntry();
                const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
                entry.note = noteNames[event.note % 12];
                entry.octave = Math.floor(event.note / 12);
                entry.volume = event.velocity;
                entry.program = this.engine.trackPrograms[targetTrack] || 0;
                this.engine.pattern.setEntry(event.row, targetTrack, entry);
            }
        });

        // console.log(`[Sequencer] Imported ${noteEvents.length} notes to track ${targetTrack + 1}`);
    }

    uploadToDevice() {
        // Show device and slot selector dialog
        if (!window.nbDialog) {
            console.error('[Sequencer] nbDialog not available');
            return;
        }

        // Get available devices
        const devices = this.controller.deviceManager ? this.controller.deviceManager.getAllDevices() : [];
        if (devices.length === 0) {
            window.nbDialog.alert('No devices configured. Please add a device in Device Manager first.');
            return;
        }

        const deviceOptions = devices.map(device =>
            `<option value="${device.id}">${device.name} (ID: ${device.deviceId})</option>`
        ).join('');

        const selectorContent = `
            <div style="
                background: #1a1a1a;
                border: 2px solid #4a4a4a;
                border-radius: 8px;
                padding: 20px;
                min-width: 350px;
                color: #fff;
                font-family: 'Arial', sans-serif;
            ">
                <h3 style="margin: 0 0 15px 0; text-align: center;">Upload Pattern to Samplecrate</h3>

                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: bold;">Upload:</label>
                    <select id="upload-track-selector" style="
                        width: 100%;
                        padding: 8px;
                        background: #0a0a0a;
                        color: #ccc;
                        border: 1px solid #555;
                        border-radius: 4px;
                        font-size: 14px;
                    ">
                        <option value="all">All 4 tracks</option>
                        ${Array.from({length: 4}, (_, i) => `<option value="${i}">Track ${i + 1}</option>`).join('')}
                    </select>
                </div>

                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: bold;">Target Device (override):</label>
                    <select id="upload-device-selector" style="
                        width: 100%;
                        padding: 8px;
                        background: #0a0a0a;
                        color: #ccc;
                        border: 1px solid #555;
                        border-radius: 4px;
                        font-size: 14px;
                    ">
                        <option value="">Use track bindings</option>
                        ${deviceOptions}
                    </select>
                    <div style="font-size: 0.8em; color: #888; margin-top: 4px;">Leave as "Use track bindings" to use each track's assigned device</div>
                </div>

                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: bold;">Starting slot:</label>
                    <select id="upload-slot-selector" style="
                        width: 100%;
                        padding: 8px;
                        background: #0a0a0a;
                        color: #ccc;
                        border: 1px solid #555;
                        border-radius: 4px;
                        font-size: 14px;
                    ">
                        ${Array.from({length: 16}, (_, i) => `<option value="${i}">S${i + 1}</option>`).join('')}
                    </select>
                </div>

                <div id="upload-preview" style="margin-bottom: 20px; padding: 10px; background: #0a0a0a; border: 1px solid #333; border-radius: 4px; font-size: 0.85em;">
                    <div style="font-weight: bold; margin-bottom: 8px;">This will upload:</div>
                    <div id="upload-preview-content"></div>
                </div>

                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button id="upload-slot-cancel" style="
                        padding: 10px 20px;
                        background: #4a4a4a;
                        color: #fff;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
                    ">Cancel</button>
                    <button id="upload-slot-ok" style="
                        padding: 10px 20px;
                        background: #4a9eff;
                        color: #fff;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
                    ">Upload</button>
                </div>
            </div>
        `;

        window.nbDialog.show(selectorContent);

        // Wire up dialog interactivity
        setTimeout(() => {
            const trackSelector = document.getElementById('upload-track-selector');
            const deviceSelector = document.getElementById('upload-device-selector');
            const slotSelector = document.getElementById('upload-slot-selector');
            const previewContent = document.getElementById('upload-preview-content');

            // Update preview function
            const updatePreview = () => {
                const trackSelection = trackSelector.value;
                const uploadAll = trackSelection === 'all';
                const startingSlot = parseInt(slotSelector.value);
                const overrideDeviceId = deviceSelector.value;

                let previewHtml = '';

                if (uploadAll) {
                    // Show all 4 tracks
                    for (let track = 0; track < 4; track++) {
                        const targetSlot = startingSlot + track;
                        const program = this.engine.trackPrograms[track] || 0;

                        // Use override device if specified, otherwise use track binding
                        let deviceId = overrideDeviceId || this.engine.trackDeviceBindings[track];
                        let deviceName = 'Default';

                        if (deviceId && this.controller.deviceManager) {
                            const device = this.controller.deviceManager.getDevice(deviceId);
                            if (device) deviceName = device.name;
                        }

                        const progText = program === 0 ? 'No Prog' : `Prog ${program}`;
                        previewHtml += `<div style="padding: 4px 0; color: #ccc;">• Track ${track + 1} (${progText}, ${deviceName}) → S${targetSlot + 1}</div>`;
                    }
                } else {
                    // Show single track
                    const selectedTrack = parseInt(trackSelection);
                    const program = this.engine.trackPrograms[selectedTrack] || 0;

                    // Use override device if specified, otherwise use track binding
                    let deviceId = overrideDeviceId || this.engine.trackDeviceBindings[selectedTrack];
                    let deviceName = 'Default';

                    if (deviceId && this.controller.deviceManager) {
                        const device = this.controller.deviceManager.getDevice(deviceId);
                        if (device) deviceName = device.name;
                    }

                    const progText = program === 0 ? 'No Prog' : `Prog ${program}`;
                    previewHtml = `<div style="padding: 4px 0; color: #ccc;">• Track ${selectedTrack + 1} (${progText}, ${deviceName}) → S${startingSlot + 1}</div>`;
                }

                previewContent.innerHTML = previewHtml;
            };

            // Update preview when selections change
            trackSelector.addEventListener('change', updatePreview);
            deviceSelector.addEventListener('change', updatePreview);
            slotSelector.addEventListener('change', updatePreview);

            // Initial preview
            updatePreview();

            // Cancel button
            document.getElementById('upload-slot-cancel')?.addEventListener('click', () => {
                window.nbDialog.hide();
            });

            // Upload button
            document.getElementById('upload-slot-ok')?.addEventListener('click', () => {
                const trackSelection = trackSelector.value;
                const uploadAll = trackSelection === 'all';
                const startingSlot = parseInt(slotSelector.value);
                const overrideDeviceId = deviceSelector.value || null;

                window.nbDialog.hide();

                if (uploadAll) {
                    // Upload all 4 tracks sequentially
                    this.performMultiTrackUpload(startingSlot, overrideDeviceId);
                } else {
                    // Upload single track
                    const selectedTrack = parseInt(trackSelection);
                    this.performSingleTrackUpload(selectedTrack, startingSlot, overrideDeviceId);
                }
            });
        }, 100);
    }

    /**
     * Upload a single track to a slot using the track's device binding and program
     * @param {number} trackIndex - Track index (0-3)
     * @param {number} slot - Target slot (0-15)
     * @param {string|null} overrideDeviceId - Optional device ID to override track binding
     */
    performSingleTrackUpload(trackIndex, slot, overrideDeviceId = null) {
        // Use override device if specified, otherwise use track binding
        const deviceId = overrideDeviceId || this.engine.trackDeviceBindings[trackIndex];
        if (!deviceId) {
            if (window.nbDialog) {
                window.nbDialog.alert(`Track ${trackIndex + 1} has no device assigned. Please select a device or assign one in the track header.`);
            }
            console.error(`[Sequencer] Track ${trackIndex + 1} has no device binding and no override specified`);
            return;
        }

        const programUI = this.engine.trackPrograms[trackIndex] || 0;
        // Convert UI program (0=NO PROG, 1-32=PROG 1-32) to wire (127=NO PROG, 0-31=PROG 1-32)
        const programWire = programUI > 0 ? (programUI - 1) & 0x7F : 127;

        // Get device configuration
        const device = this.controller.deviceManager.getDevice(deviceId);
        if (!device) {
            if (window.nbDialog) {
                window.nbDialog.alert('Device not found.');
            }
            console.error('[Sequencer] Device not found:', deviceId);
            return;
        }

        // Get MIDI output for this device
        const midiOutput = this.controller.deviceManager.getMidiOutput(deviceId);
        if (!midiOutput) {
            if (window.nbDialog) {
                window.nbDialog.alert('MIDI output not available for this device.');
            }
            console.error('[Sequencer] MIDI output not available for device:', device.name);
            return;
        }

        // console.log(`[Sequencer] Uploading Track ${trackIndex + 1} to device: ${device.name} (SysEx ID: ${device.deviceId}), slot ${slot}, program UI=${programUI} wire=${programWire}`);

        // Generate MIDI file for this track only
        // console.log(`[Sequencer] Generating MIDI file for track ${trackIndex + 1}...`);
        const midiFileData = this.exportSingleTrackMIDI(trackIndex);
        if (!midiFileData) {
            console.error('[Sequencer] Failed to generate MIDI file');
            return;
        }

        // console.log(`[Sequencer] MIDI file generated: ${midiFileData.length} bytes`);

        // Create progress dialog
        if (!window.nbDialog) {
            console.error('[Sequencer] nbDialog not available');
            return;
        }

        let uploadCancelled = false;

        const progressContent = `
            <div style="
                background: #1a1a1a;
                border: 2px solid #4a4a4a;
                border-radius: 8px;
                padding: 20px;
                min-width: 400px;
                color: #fff;
                font-family: 'Arial', sans-serif;
            ">
                <h3 style="margin: 0 0 15px 0; text-align: center;">Uploading Track ${trackIndex + 1}</h3>

                <div style="margin-bottom: 10px;">
                    <strong>Device:</strong> ${device.name}
                </div>
                <div style="margin-bottom: 10px;">
                    <strong>Slot:</strong> S${slot + 1}
                </div>
                <div style="margin-bottom: 10px;">
                    <strong>Program:</strong> ${programUI === 0 ? 'No Prog' : `Prog ${programUI}`}
                </div>
                <div style="margin-bottom: 10px;">
                    <strong>Size:</strong> ${midiFileData.length} bytes
                </div>
                <div style="margin-bottom: 15px;">
                    <strong>Status:</strong> <span id="upload-status">Preparing...</span>
                </div>

                <div style="
                    width: 100%;
                    height: 20px;
                    background: #0a0a0a;
                    border: 1px solid #333;
                    border-radius: 4px;
                    overflow: hidden;
                    margin-bottom: 10px;
                ">
                    <div id="upload-progress-bar" style="
                        width: 0%;
                        height: 100%;
                        background: linear-gradient(90deg, #4a9eff, #aa6aaa);
                        transition: width 0.3s ease;
                    "></div>
                </div>

                <div style="text-align: center; margin-bottom: 15px;">
                    <span id="upload-progress-text">0%</span>
                </div>

                <div style="text-align: center;">
                    <button id="upload-cancel-btn" style="
                        padding: 8px 20px;
                        background: #4a2a2a;
                        color: #ff6a6a;
                        border: 1px solid #6a3a3a;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 14px;
                    ">Cancel</button>
                </div>
            </div>
        `;

        window.nbDialog.show(progressContent);

        // Wire up cancel button
        setTimeout(() => {
            const cancelBtn = document.getElementById('upload-cancel-btn');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    uploadCancelled = true;
                    window.nbDialog.hide();
                    // console.log('[Sequencer] Upload cancelled by user');
                });
            }
        }, 100);

        // Upload with progress callbacks
        try {
            uploadMidiFile(midiOutput, this.controller, device.deviceId, slot, programWire, midiFileData, {
                onProgress: (currentChunk, totalChunks) => {
                    if (uploadCancelled) return;

                    const percent = Math.round((currentChunk / totalChunks) * 100);
                    const progressBar = document.getElementById('upload-progress-bar');
                    const progressText = document.getElementById('upload-progress-text');
                    const statusText = document.getElementById('upload-status');

                    if (progressBar) progressBar.style.width = `${percent}%`;
                    if (progressText) progressText.textContent = `${percent}%`;
                    if (statusText) statusText.textContent = `Uploading chunk ${currentChunk}/${totalChunks}`;

                    // console.log(`[Sequencer] Upload progress: ${currentChunk}/${totalChunks} (${percent}%)`);
                },

                onComplete: () => {
                    if (uploadCancelled) return;

                    // console.log(`[Sequencer] Upload complete: Track ${trackIndex + 1} → slot S${slot + 1}`);
                    const statusText = document.getElementById('upload-status');
                    if (statusText) statusText.textContent = 'Upload complete!';

                    // Close dialog after 1 second
                    setTimeout(() => {
                        window.nbDialog.hide();
                        if (window.nbDialog.alert) {
                            window.nbDialog.alert(`Track ${trackIndex + 1} uploaded successfully to slot S${slot + 1}!`);
                        }
                    }, 1000);
                },

                onError: (error) => {
                    if (uploadCancelled) return;

                    console.error(`[Sequencer] Upload error:`, error);
                    window.nbDialog.hide();
                    if (window.nbDialog.alert) {
                        window.nbDialog.alert(`Upload failed: ${error}`);
                    }
                }
            }).catch(error => {
                if (!uploadCancelled) {
                    console.error('[Sequencer] Upload promise rejected:', error);
                    window.nbDialog.hide();
                    if (window.nbDialog.alert) {
                        window.nbDialog.alert(`Upload failed: ${error}`);
                    }
                }
            });
        } catch (error) {
            console.error('[Sequencer] Upload exception:', error);
            window.nbDialog.hide();
            if (window.nbDialog.alert) {
                window.nbDialog.alert(`Upload failed: ${error.message}`);
            }
        }
    }

    /**
     * Upload all 4 tracks sequentially starting from the specified slot
     * @param {number} startingSlot - Starting slot (0-15)
     * @param {string|null} overrideDeviceId - Optional device ID to override all track bindings
     */
    async performMultiTrackUpload(startingSlot, overrideDeviceId = null) {
        // Validate all tracks have device bindings (unless override specified)
        if (!overrideDeviceId) {
            const missingDevices = [];
            for (let track = 0; track < 4; track++) {
                if (!this.engine.trackDeviceBindings[track]) {
                    missingDevices.push(track + 1);
                }
            }

            if (missingDevices.length > 0) {
                if (window.nbDialog) {
                    window.nbDialog.alert(`Tracks ${missingDevices.join(', ')} have no device assigned. Please select a device override or assign devices in the track headers.`);
                }
                return;
            }
        }

        // Create progress dialog
        if (!window.nbDialog) {
            console.error('[Sequencer] nbDialog not available');
            return;
        }

        let uploadCancelled = false;

        const progressContent = `
            <div style="
                background: #1a1a1a;
                border: 2px solid #4a4a4a;
                border-radius: 8px;
                padding: 20px;
                min-width: 400px;
                color: #fff;
                font-family: 'Arial', sans-serif;
            ">
                <h3 style="margin: 0 0 15px 0; text-align: center;">Uploading All Tracks</h3>

                <div style="margin-bottom: 10px;">
                    <strong>Current Track:</strong> <span id="upload-current-track">1 / 4</span>
                </div>
                <div style="margin-bottom: 10px;">
                    <strong>Current Slot:</strong> <span id="upload-current-slot">S${startingSlot + 1}</span>
                </div>
                <div style="margin-bottom: 15px;">
                    <strong>Status:</strong> <span id="upload-status">Preparing...</span>
                </div>

                <div style="
                    width: 100%;
                    height: 20px;
                    background: #0a0a0a;
                    border: 1px solid #333;
                    border-radius: 4px;
                    overflow: hidden;
                    margin-bottom: 10px;
                ">
                    <div id="upload-progress-bar" style="
                        width: 0%;
                        height: 100%;
                        background: linear-gradient(90deg, #4a9eff, #aa6aaa);
                        transition: width 0.3s ease;
                    "></div>
                </div>

                <div style="text-align: center; margin-bottom: 15px;">
                    <span id="upload-progress-text">0%</span>
                </div>

                <div style="text-align: center;">
                    <button id="upload-cancel-btn" style="
                        padding: 8px 20px;
                        background: #4a2a2a;
                        color: #ff6a6a;
                        border: 1px solid #6a3a3a;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 14px;
                    ">Cancel</button>
                </div>
            </div>
        `;

        window.nbDialog.show(progressContent);

        // Wire up cancel button
        const cancelBtn = document.getElementById('upload-cancel-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                uploadCancelled = true;
                window.nbDialog.hide();
                // console.log('[Sequencer] Multi-track upload cancelled by user');
            });
        }

        // Upload each track sequentially
        try {
            for (let track = 0; track < 4; track++) {
                if (uploadCancelled) {
                    // console.log('[Sequencer] Multi-track upload cancelled');
                    return;
                }

                const slot = startingSlot + track;
                // Use override device if specified, otherwise use track binding
                const deviceId = overrideDeviceId || this.engine.trackDeviceBindings[track];
                const programUI = this.engine.trackPrograms[track] || 0;
                // Convert UI program (0=NO PROG, 1-32=PROG 1-32) to wire (127=NO PROG, 0-31=PROG 1-32)
                const programWire = programUI > 0 ? (programUI - 1) & 0x7F : 127;

                // Update current track display
                const currentTrackSpan = document.getElementById('upload-current-track');
                const currentSlotSpan = document.getElementById('upload-current-slot');
                if (currentTrackSpan) currentTrackSpan.textContent = `${track + 1} / 4`;
                if (currentSlotSpan) currentSlotSpan.textContent = `S${slot + 1}`;

                // Get device
                const device = this.controller.deviceManager.getDevice(deviceId);
                if (!device) {
                    throw new Error(`Device not found for track ${track + 1}`);
                }

                // Get MIDI output
                const midiOutput = this.controller.deviceManager.getMidiOutput(deviceId);
                if (!midiOutput) {
                    throw new Error(`MIDI output not available for device: ${device.name}`);
                }

                // console.log(`[Sequencer] Uploading Track ${track + 1} to device: ${device.name}, slot ${slot}, program UI=${programUI} wire=${programWire}`);

                // Generate MIDI file for this track
                const midiFileData = this.exportSingleTrackMIDI(track);
                if (!midiFileData) {
                    throw new Error(`Failed to generate MIDI file for track ${track + 1}`);
                }

                // console.log(`[Sequencer] MIDI file generated for track ${track + 1}: ${midiFileData.length} bytes`);

                // Upload this track
                await new Promise((resolve, reject) => {
                    uploadMidiFile(midiOutput, this.controller, device.deviceId, slot, programWire, midiFileData, {
                        onProgress: (currentChunk, totalChunks) => {
                            if (uploadCancelled) return;

                            // Calculate overall progress (track progress + chunk progress within track)
                            const trackProgress = track / 4;
                            const chunkProgress = (currentChunk / totalChunks) / 4;
                            const totalProgress = Math.round((trackProgress + chunkProgress) * 100);

                            const progressBar = document.getElementById('upload-progress-bar');
                            const progressText = document.getElementById('upload-progress-text');
                            const statusText = document.getElementById('upload-status');

                            if (progressBar) progressBar.style.width = `${totalProgress}%`;
                            if (progressText) progressText.textContent = `${totalProgress}%`;
                            if (statusText) statusText.textContent = `Track ${track + 1}/4: Chunk ${currentChunk}/${totalChunks}`;
                        },

                        onComplete: () => {
                            if (uploadCancelled) return;
                            // console.log(`[Sequencer] Track ${track + 1} upload complete`);
                            resolve();
                        },

                        onError: (error) => {
                            if (uploadCancelled) return;
                            reject(new Error(`Track ${track + 1} upload failed: ${error}`));
                        }
                    }).catch(error => {
                        if (!uploadCancelled) {
                            reject(error);
                        }
                    });
                });
            }

            // All tracks uploaded
            if (!uploadCancelled) {
                // console.log('[Sequencer] All tracks uploaded successfully');
                const statusText = document.getElementById('upload-status');
                if (statusText) statusText.textContent = 'All tracks uploaded!';

                setTimeout(() => {
                    window.nbDialog.hide();
                    if (window.nbDialog.alert) {
                        window.nbDialog.alert(`All 4 tracks uploaded successfully to slots S${startingSlot + 1}-S${startingSlot + 4}!`);
                    }
                }, 1000);
            }
        } catch (error) {
            console.error('[Sequencer] Multi-track upload error:', error);
            window.nbDialog.hide();
            if (window.nbDialog.alert) {
                window.nbDialog.alert(`Multi-track upload failed: ${error.message}`);
            }
        }
    }

    performUpload(deviceId, slot) {
        // Get device configuration
        const device = this.controller.deviceManager.getDevice(deviceId);
        if (!device) {
            if (window.nbDialog) {
                window.nbDialog.alert('Device not found.');
            }
            console.error('[Sequencer] Device not found:', deviceId);
            return;
        }

        // Get MIDI output for this device
        const midiOutput = this.controller.deviceManager.getMidiOutput(deviceId);
        if (!midiOutput) {
            if (window.nbDialog) {
                window.nbDialog.alert('MIDI output not available for this device.');
            }
            console.error('[Sequencer] MIDI output not available for device:', device.name);
            return;
        }

        // console.log(`[Sequencer] Using device: ${device.name} (SysEx ID: ${device.deviceId}) on MIDI output: ${midiOutput.name}`);

        // Get first available MIDI input (for receiving ACKs)
        if (!this.controller.midiAccess) {
            if (window.nbDialog) {
                window.nbDialog.alert('MIDI access not available.');
            }
            console.error('[Sequencer] MIDI access not available');
            return;
        }

        const inputs = Array.from(this.controller.midiAccess.inputs.values());
        if (inputs.length === 0) {
            if (window.nbDialog) {
                window.nbDialog.alert('No MIDI input devices found (needed for ACK protocol).');
            }
            console.error('[Sequencer] No MIDI input devices');
            return;
        }

        const midiInput = inputs[0]; // Use first input
        // console.log(`[Sequencer] Using MIDI input: ${midiInput.name}`);

        // Generate MIDI file
        // console.log('[Sequencer] Generating MIDI file for upload...');
        const midiFileData = this.exportMIDI(true);
        if (!midiFileData) {
            console.error('[Sequencer] Failed to generate MIDI file');
            return;
        }

        // console.log(`[Sequencer] MIDI file generated: ${midiFileData.length} bytes`);

        // Create progress dialog
        if (!window.nbDialog) {
            console.error('[Sequencer] nbDialog not available');
            return;
        }

        let uploadCancelled = false;

        const progressContent = `
            <div style="
                background: #1a1a1a;
                border: 2px solid #4a4a4a;
                border-radius: 8px;
                padding: 20px;
                min-width: 400px;
                color: #fff;
                font-family: 'Arial', sans-serif;
            ">
                <h3 style="margin: 0 0 15px 0; text-align: center;">Uploading to Samplecrate</h3>

                <div style="margin-bottom: 10px;">
                    <strong>Slot:</strong> ${slot}
                </div>
                <div style="margin-bottom: 10px;">
                    <strong>Size:</strong> ${midiFileData.length} bytes
                </div>
                <div style="margin-bottom: 15px;">
                    <strong>Status:</strong> <span id="upload-status">Preparing...</span>
                </div>

                <div style="
                    width: 100%;
                    height: 20px;
                    background: #0a0a0a;
                    border: 1px solid #333;
                    border-radius: 4px;
                    overflow: hidden;
                    margin-bottom: 10px;
                ">
                    <div id="upload-progress-bar" style="
                        width: 0%;
                        height: 100%;
                        background: linear-gradient(90deg, #4a9eff, #aa6aaa);
                        transition: width 0.3s ease;
                    "></div>
                </div>

                <div style="text-align: center; margin-bottom: 15px;">
                    <span id="upload-progress-text">0%</span>
                </div>

                <div style="text-align: center;">
                    <button id="upload-cancel-btn" style="
                        padding: 8px 20px;
                        background: #4a2a2a;
                        color: #ff6a6a;
                        border: 1px solid #6a3a3a;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 14px;
                    ">Cancel</button>
                </div>
            </div>
        `;

        window.nbDialog.show(progressContent);

        // Wire up cancel button
        setTimeout(() => {
            const cancelBtn = document.getElementById('upload-cancel-btn');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    uploadCancelled = true;
                    window.nbDialog.hide();
                    // console.log('[Sequencer] Upload cancelled by user');
                });
            }
        }, 100);

        // Upload with progress callbacks
        try {
            const program = 0; // TODO: Add program selector
            uploadMidiFile(midiOutput, this.controller, device.deviceId, slot, program, midiFileData, {
                onProgress: (currentChunk, totalChunks) => {
                    if (uploadCancelled) return;

                    const percent = Math.round((currentChunk / totalChunks) * 100);
                    const progressBar = document.getElementById('upload-progress-bar');
                    const progressText = document.getElementById('upload-progress-text');
                    const statusText = document.getElementById('upload-status');

                    if (progressBar) progressBar.style.width = `${percent}%`;
                    if (progressText) progressText.textContent = `${percent}%`;
                    if (statusText) statusText.textContent = `Uploading chunk ${currentChunk}/${totalChunks}`;

                    // console.log(`[Sequencer] Upload progress: ${currentChunk}/${totalChunks} (${percent}%)`);
                },

                onComplete: () => {
                    if (uploadCancelled) return;

                    // console.log(`[Sequencer] Upload complete to slot ${slot}`);
                    const statusText = document.getElementById('upload-status');
                    if (statusText) statusText.textContent = 'Upload complete!';

                    // Close dialog after 1 second
                    setTimeout(() => {
                        window.nbDialog.hide();
                        if (window.nbDialog.alert) {
                            window.nbDialog.alert(`Pattern uploaded successfully to slot ${slot}!`);
                        }
                    }, 1000);
                },

                onError: (error) => {
                    if (uploadCancelled) return;

                    console.error(`[Sequencer] Upload error:`, error);
                    window.nbDialog.hide();
                    if (window.nbDialog.alert) {
                        window.nbDialog.alert(`Upload failed: ${error}`);
                    }
                }
            }).catch(error => {
                if (!uploadCancelled) {
                    console.error('[Sequencer] Upload promise rejected:', error);
                    window.nbDialog.hide();
                    if (window.nbDialog.alert) {
                        window.nbDialog.alert(`Upload failed: ${error}`);
                    }
                }
            });
        } catch (error) {
            console.error('[Sequencer] Upload exception:', error);
            window.nbDialog.hide();
            if (window.nbDialog.alert) {
                window.nbDialog.alert(`Upload failed: ${error.message}`);
            }
        }
    }

    downloadFromDevice() {
        // Show device and slot selector dialog
        if (!window.nbDialog) {
            console.error('[Sequencer] nbDialog not available');
            return;
        }

        // Get available devices
        const devices = this.controller.deviceManager ? this.controller.deviceManager.getAllDevices() : [];
        if (devices.length === 0) {
            window.nbDialog.alert('No devices configured. Please add a device in Device Manager first.');
            return;
        }

        const deviceOptions = devices.map(device =>
            `<option value="${device.id}">${device.name} (ID: ${device.deviceId})</option>`
        ).join('');

        const selectorContent = `
            <div style="
                background: #1a1a1a;
                border: 2px solid #4a4a4a;
                border-radius: 8px;
                padding: 20px;
                min-width: 350px;
                color: #fff;
                font-family: 'Arial', sans-serif;
            ">
                <h3 style="margin: 0 0 15px 0; text-align: center;">Download from Samplecrate</h3>

                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: bold;">Source Device:</label>
                    <select id="download-device-selector" style="
                        width: 100%;
                        padding: 8px;
                        background: #0a0a0a;
                        color: #ccc;
                        border: 1px solid #555;
                        border-radius: 4px;
                        font-size: 14px;
                    ">
                        ${deviceOptions}
                    </select>
                </div>

                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: bold;">Source Slot (0-15):</label>
                    <select id="download-slot-selector" style="
                        width: 100%;
                        padding: 8px;
                        background: #0a0a0a;
                        color: #ccc;
                        border: 1px solid #555;
                        border-radius: 4px;
                        font-size: 14px;
                    ">
                        ${Array.from({length: 16}, (_, i) => `<option value="${i}">S${i + 1}</option>`).join('')}
                    </select>
                </div>

                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button id="download-slot-cancel" style="
                        padding: 10px 20px;
                        background: #4a4a4a;
                        color: #fff;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
                    ">Cancel</button>
                    <button id="download-slot-ok" style="
                        padding: 10px 20px;
                        background: #4a9eff;
                        color: #fff;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
                    ">Download</button>
                </div>
            </div>
        `;

        window.nbDialog.show(selectorContent);

        // Wire up buttons
        setTimeout(() => {
            document.getElementById('download-slot-cancel')?.addEventListener('click', () => {
                window.nbDialog.hide();
            });

            document.getElementById('download-slot-ok')?.addEventListener('click', () => {
                const deviceId = document.getElementById('download-device-selector').value;
                const slot = parseInt(document.getElementById('download-slot-selector').value);
                window.nbDialog.hide();

                // Now proceed with download
                this.performDownload(deviceId, slot);
            });
        }, 100);
    }

    performDownload(deviceId, slot) {
        // Get device configuration
        const device = this.controller.deviceManager.getDevice(deviceId);
        if (!device) {
            if (window.nbDialog) {
                window.nbDialog.alert('Device not found.');
            }
            console.error('[Sequencer] Device not found:', deviceId);
            return;
        }

        // Get MIDI output for this device
        const midiOutput = this.controller.deviceManager.getMidiOutput(deviceId);
        if (!midiOutput) {
            if (window.nbDialog) {
                window.nbDialog.alert('MIDI output not available for this device.');
            }
            console.error('[Sequencer] MIDI output not available for device:', device.name);
            return;
        }

        // console.log(`[Sequencer] Using device: ${device.name} (SysEx ID: ${device.deviceId}) on MIDI output: ${midiOutput.name}`);

        // Get first available MIDI input (for receiving responses)
        if (!this.controller.midiAccess) {
            if (window.nbDialog) {
                window.nbDialog.alert('MIDI access not available.');
            }
            console.error('[Sequencer] MIDI access not available');
            return;
        }

        const inputs = Array.from(this.controller.midiAccess.inputs.values());
        if (inputs.length === 0) {
            if (window.nbDialog) {
                window.nbDialog.alert('No MIDI input devices found (needed for download protocol).');
            }
            console.error('[Sequencer] No MIDI input devices');
            return;
        }

        const midiInput = inputs[0];
        // console.log(`[Sequencer] Using MIDI input: ${midiInput.name}`);

        // Create progress dialog with cancel button
        if (!window.nbDialog) {
            console.error('[Sequencer] nbDialog not available');
            return;
        }

        let downloadCancelled = false;

        const progressContent = `
            <div style="
                background: #1a1a1a;
                border: 2px solid #4a4a4a;
                border-radius: 8px;
                padding: 20px;
                min-width: 400px;
                color: #fff;
                font-family: 'Arial', sans-serif;
            ">
                <h3 style="margin: 0 0 15px 0; text-align: center;">Downloading from Samplecrate</h3>

                <div style="margin-bottom: 10px;">
                    <strong>Slot:</strong> S${slot + 1}
                </div>
                <div style="margin-bottom: 10px;">
                    <strong>Status:</strong> <span id="download-status">Requesting...</span>
                </div>

                <div style="
                    width: 100%;
                    height: 20px;
                    background: #0a0a0a;
                    border: 1px solid #333;
                    border-radius: 4px;
                    overflow: hidden;
                    margin-bottom: 10px;
                ">
                    <div id="download-progress-bar" style="
                        width: 0%;
                        height: 100%;
                        background: linear-gradient(90deg, #4aff9e, #6a6aaa);
                        transition: width 0.3s ease;
                    "></div>
                </div>

                <div style="text-align: center; margin-bottom: 15px;">
                    <span id="download-progress-text">0%</span>
                </div>

                <div style="text-align: center;">
                    <button id="download-cancel-btn" style="
                        padding: 8px 20px;
                        background: #4a2a2a;
                        color: #ff6a6a;
                        border: 1px solid #6a3a3a;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 14px;
                    ">Cancel</button>
                </div>
            </div>
        `;

        window.nbDialog.show(progressContent);

        // Wire up cancel button
        setTimeout(() => {
            const cancelBtn = document.getElementById('download-cancel-btn');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    downloadCancelled = true;
                    window.nbDialog.hide();
                    // console.log('[Sequencer] Download cancelled by user');
                });
            }
        }, 100);

        // Download with progress callbacks
        try {
            downloadMidiFile(midiOutput, midiInput, device.deviceId, slot, {
                onProgress: (currentChunk, totalChunks) => {
                    if (downloadCancelled) return;

                    const percent = Math.round((currentChunk / totalChunks) * 100);
                    const progressBar = document.getElementById('download-progress-bar');
                    const progressText = document.getElementById('download-progress-text');
                    const statusText = document.getElementById('download-status');

                    if (progressBar) progressBar.style.width = `${percent}%`;
                    if (progressText) progressText.textContent = `${percent}%`;
                    if (statusText) statusText.textContent = `Downloading chunk ${currentChunk}/${totalChunks}`;

                    // console.log(`[Sequencer] Download progress: ${currentChunk}/${totalChunks} (${percent}%)`);
                },

                onComplete: (midiData) => {
                    if (downloadCancelled) return;

                    // console.log(`[Sequencer] Download complete from slot ${slot}: ${midiData.length} bytes`);
                    const statusText = document.getElementById('download-status');
                    if (statusText) statusText.textContent = 'Download complete! Importing...';

                    // Import the downloaded MIDI file into the sequencer
                    setTimeout(() => {
                        this.importMIDIFromData(midiData);
                        window.nbDialog.hide();
                        if (window.nbDialog.alert) {
                            window.nbDialog.alert(`Pattern downloaded successfully from slot ${slot}!`);
                        }
                    }, 500);
                },

                onError: (error) => {
                    if (downloadCancelled) return;

                    console.error(`[Sequencer] Download error:`, error);
                    window.nbDialog.hide();
                    if (window.nbDialog.alert) {
                        window.nbDialog.alert(`Download failed: ${error}`);
                    }
                }
            }).catch(error => {
                if (!downloadCancelled) {
                    console.error('[Sequencer] Download promise rejected:', error);
                    window.nbDialog.hide();
                    if (window.nbDialog.alert) {
                        window.nbDialog.alert(`Download failed: ${error}`);
                    }
                }
            });
        } catch (error) {
            console.error('[Sequencer] Download exception:', error);
            window.nbDialog.hide();
            if (window.nbDialog.alert) {
                window.nbDialog.alert(`Download failed: ${error.message}`);
            }
        }
    }

    importMIDIFromData(midiData) {
        try {
            // Reuse existing parseMIDIFile logic
            this.parseMIDIFile(midiData);
            // console.log('[Sequencer] MIDI data imported successfully');
        } catch (error) {
            console.error('[Sequencer] Error importing MIDI data:', error);
            if (window.nbDialog && window.nbDialog.alert) {
                window.nbDialog.alert(`Error importing MIDI data: ${error.message}`);
            }
        }
    }


    readVarLen(data, pos) {
        // Read variable-length quantity (MIDI standard)
        let value = 0;
        let byte;
        let bytesRead = 0;

        do {
            if (pos >= data.length) {
                throw new Error(`readVarLen: unexpected end of data at position ${pos}`);
            }
            if (bytesRead >= 4) {
                throw new Error(`readVarLen: variable-length value too long at position ${pos}`);
            }
            byte = data[pos++];
            value = (value << 7) | (byte & 0x7F);
            bytesRead++;
        } while (byte & 0x80);

        return [value, pos];
    }

    writeVarLen(array, value) {
        // Write variable-length quantity (MIDI standard)
        const buffer = [];
        buffer.push(value & 0x7F);
        value >>= 7;

        while (value > 0) {
            buffer.push((value & 0x7F) | 0x80);
            value >>= 7;
        }

        // Write in reverse order
        for (let i = buffer.length - 1; i >= 0; i--) {
            array.push(buffer[i]);
        }
    }

    /**
     * Pause scene (when switching away) - stop UI updates but keep playback
     */
    pause() {
        // console.log(`[Sequencer] Pausing scene: ${this.name} (${this.sceneId})`);

        // Clear UI update interval
        if (this.positionUpdateInterval) {
            clearInterval(this.positionUpdateInterval);
            this.positionUpdateInterval = null;
            // console.log(`[Sequencer] Cleared UI update interval`);
        }

        // Remove keyboard listener when paused
        if (this.keydownHandler) {
            document.removeEventListener('keydown', this.keydownHandler);
            // console.log(`[Sequencer] Removed keyboard listener for paused scene`);
        }

        // Remove MIDI input listener to prevent note bleeding
        if (this.controller.midiAccess && this.midiInputListener) {
            let listenerCount = 0;
            for (let input of this.controller.midiAccess.inputs.values()) {
                input.removeEventListener('midimessage', this.midiInputListener);
                listenerCount++;
            }
            // console.log(`[Sequencer] Removed MIDI input listener from ${listenerCount} MIDI input(s)`);
        } else {
            console.warn(`[Sequencer] Could not remove MIDI listener: midiAccess=${!!this.controller.midiAccess}, listener=${!!this.midiInputListener}`);
        }
    }

    /**
     * Resume scene (when switching back) - restart UI updates and MIDI input
     */
    resume() {
        // console.log(`[Sequencer] Resuming scene: ${this.name} (${this.sceneId})`);

        // Re-attach keyboard listener
        if (this.keydownHandler) {
            document.addEventListener('keydown', this.keydownHandler);
            // console.log(`[Sequencer] Re-attached keyboard listener for resumed scene`);
        }

        // Restart UI update interval
        if (!this.positionUpdateInterval) {
            this.setupUIUpdateInterval();
            // console.log(`[Sequencer] Restarted UI update interval`);
        }

        // Re-attach MIDI input listener (excluding Fire devices)
        if (this.controller.midiAccess && this.midiInputListener) {
            const fireDeviceIds = this.getFireSceneDeviceIds();
            let listenerCount = 0;

            for (let input of this.controller.midiAccess.inputs.values()) {
                // Skip Fire device inputs - they're handled by Fire scenes
                if (fireDeviceIds.has(input.id)) {
                    continue;
                }
                input.addEventListener('midimessage', this.midiInputListener);
                listenerCount++;
            }
            // console.log(`[Sequencer] Re-attached MIDI input listener to ${listenerCount} MIDI input(s) (excluded ${fireDeviceIds.size} Fire devices)`);
        }
    }

    /**
     * Setup UI update interval (extracted for reuse)
     */
    setupUIUpdateInterval() {
        this.lastHighlightedRow = -1;

        this.positionUpdateInterval = setInterval(() => {
            if (this.engine.playing) {
                const posLabel = document.getElementById('seq-position');
                if (posLabel) {
                    posLabel.textContent = `Row: ${this.engine.currentRow.toString().padStart(2, '0')}`;
                }

                // Update play button state
                const playBtn = document.getElementById('seq-play-btn');
                if (playBtn) {
                    playBtn.textContent = '⏸ PAUSE';
                    playBtn.style.background = '#4a4a2a';
                    playBtn.style.color = '#9a9a4a';
                }

                // Update row highlighting efficiently (only 2 DOM updates per tick!)
                if (this.engine.currentRow !== this.lastHighlightedRow) {
                    const grid = document.getElementById('seq-tracker-grid');
                    if (grid) {
                        // Remove highlight from previous row
                        if (this.lastHighlightedRow >= 0) {
                            const prevRow = grid.children[this.lastHighlightedRow];
                            if (prevRow) {
                                prevRow.style.background = this.lastHighlightedRow % 4 === 0 ? '#0a0a0a' : '#000';
                            }
                        }

                        // Add highlight to current row
                        const currentRowDiv = grid.children[this.engine.currentRow];
                        if (currentRowDiv) {
                            currentRowDiv.style.background = '#1a2a1a';
                        }

                        this.lastHighlightedRow = this.engine.currentRow;
                    }
                }
            } else {
                const playBtn = document.getElementById('seq-play-btn');
                if (playBtn) {
                    playBtn.textContent = '▶ PLAY';
                    playBtn.style.background = '#2a4a2a';
                    playBtn.style.color = '#4a9e4a';
                }
            }
        }, 100);
    }

    destroy() {
        this.engine.stopPlayback();
        if (this.positionUpdateInterval) {
            clearInterval(this.positionUpdateInterval);
        }

        // Remove keyboard listener
        if (this.keydownHandler) {
            document.removeEventListener('keydown', this.keydownHandler);
            this.keydownHandler = null;
        }

        // Remove pattern change listener
        if (this.patternChangeListener) {
            this.engine.pattern.removePatternChangeListener(this.patternChangeListener);
            this.patternChangeListener = null;
        }

        // Remove mute change listener
        if (this.muteChangeListener) {
            this.engine.removeMuteChangeListener(this.muteChangeListener);
            this.muteChangeListener = null;
        }

        // Remove global BPM listener
        const globalBpmInput = document.getElementById('clock-bpm');
        if (globalBpmInput && this.globalBpmListener) {
            globalBpmInput.removeEventListener('change', this.globalBpmListener);
        }

        // Remove MIDI input listener to prevent note bleeding between scenes
        if (this.controller.midiAccess && this.midiInputListener) {
            for (let input of this.controller.midiAccess.inputs.values()) {
                input.removeEventListener('midimessage', this.midiInputListener);
            }
        }
    }

    /**
     * Trigger auto-save with debouncing (saves 2 seconds after last edit)
     */
    triggerAutoSave() {
        // Clear existing timer
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
        }

        // Set new timer to save after 2 seconds of inactivity
        this.autoSaveTimer = setTimeout(() => {
            if (this.controller.sceneEditor) {
                this.controller.sceneEditor.saveScenesToStorage();
            }
        }, 2000);
    }

    toJSON() {
        return {
            id: this.sceneId,
            type: this.type,
            name: this.name,
            enabled: this.enabled,
            engine: this.engine.toJSON()
        };
    }
}
