/**
 * Mini Sequencer Engine for Meister
 * 64-row pattern sequencer with 4 tracks
 */

/**
 * Sequencer Track Entry
 * Represents a single note event in the sequencer
 */
export class SequencerEntry {
    constructor() {
        this.note = null;      // Note name (C, D, E, F, G, A, B) or null for empty
        this.octave = 3;       // Octave (0-8), default C-3
        this.program = 0;      // Program/instrument (0=none, 1-32 for Samplecrate)
        this.volume = 100;     // Velocity/volume (0-127)
        this.effect = null;    // Effect code ('fff' for note off, null for none)
    }

    /**
     * Get MIDI note number from note name and octave
     */
    getMidiNote() {
        if (!this.note) return null;

        const noteMap = {
            'C': 0, 'C#': 1, 'D': 2, 'D#': 3,
            'E': 4, 'F': 5, 'F#': 6, 'G': 7,
            'G#': 8, 'A': 9, 'A#': 10, 'B': 11
        };

        const noteOffset = noteMap[this.note.toUpperCase()];
        if (noteOffset === undefined) return null;

        return (this.octave * 12) + noteOffset;
    }

    /**
     * Check if this entry is empty
     */
    isEmpty() {
        return this.note === null;
    }

    /**
     * Check if this is a note off effect
     */
    isNoteOff() {
        return this.effect === 'fff' || this.effect === 'FFF';
    }

    /**
     * Clone this entry
     */
    clone() {
        const entry = new SequencerEntry();
        entry.note = this.note;
        entry.octave = this.octave;
        entry.program = this.program;
        entry.volume = this.volume;
        entry.effect = this.effect;
        return entry;
    }

    /**
     * Serialize to JSON
     */
    toJSON() {
        return {
            note: this.note,
            octave: this.octave,
            program: this.program,
            volume: this.volume,
            effect: this.effect
        };
    }

    /**
     * Deserialize from JSON
     */
    static fromJSON(data) {
        const entry = new SequencerEntry();
        if (data) {
            entry.note = data.note || null;
            entry.octave = data.octave ?? 4;
            entry.program = data.program ?? 0;
            entry.volume = data.volume ?? 100;
            entry.effect = data.effect || null;
        }
        return entry;
    }
}

/**
 * Sequencer Pattern
 * 64 rows × 4 tracks
 */
export class SequencerPattern {
    constructor() {
        this.rows = 64;
        this.tracks = 4;
        this.pattern = this.createEmptyPattern();
        this.name = 'Untitled Pattern';
    }

    /**
     * Create empty pattern
     */
    createEmptyPattern() {
        const pattern = [];
        for (let row = 0; row < this.rows; row++) {
            const trackRow = [];
            for (let track = 0; track < this.tracks; track++) {
                trackRow.push(new SequencerEntry());
            }
            pattern.push(trackRow);
        }
        return pattern;
    }

    /**
     * Get entry at specific row and track
     */
    getEntry(row, track) {
        if (row < 0 || row >= this.rows || track < 0 || track >= this.tracks) {
            return null;
        }
        return this.pattern[row][track];
    }

    /**
     * Set entry at specific row and track
     */
    setEntry(row, track, entry) {
        if (row < 0 || row >= this.rows || track < 0 || track >= this.tracks) {
            return;
        }
        this.pattern[row][track] = entry;

        // Emit pattern change event to ALL listeners
        if (this.patternChangeListeners && this.patternChangeListeners.length > 0) {
            this.patternChangeListeners.forEach(listener => listener(row, track, entry));
        }
    }

    /**
     * Add pattern change listener
     */
    addPatternChangeListener(listener) {
        if (!this.patternChangeListeners) {
            this.patternChangeListeners = [];
        }
        this.patternChangeListeners.push(listener);
    }

    /**
     * Remove pattern change listener
     */
    removePatternChangeListener(listener) {
        if (!this.patternChangeListeners) return;
        const index = this.patternChangeListeners.indexOf(listener);
        if (index > -1) {
            this.patternChangeListeners.splice(index, 1);
        }
    }

    /**
     * Clear pattern
     */
    clear() {
        this.pattern = this.createEmptyPattern();
    }

    /**
     * Serialize to JSON
     */
    toJSON() {
        return {
            name: this.name,
            rows: this.rows,
            tracks: this.tracks,
            pattern: this.pattern.map(row => row.map(entry => entry.toJSON()))
        };
    }

    /**
     * Deserialize from JSON
     */
    static fromJSON(data) {
        const pattern = new SequencerPattern();
        if (data) {
            pattern.name = data.name || 'Untitled Pattern';
            pattern.rows = data.rows || 64;
            pattern.tracks = data.tracks || 4;

            if (data.pattern) {
                pattern.pattern = data.pattern.map(row =>
                    row.map(entryData => SequencerEntry.fromJSON(entryData))
                );
            }
        }
        return pattern;
    }
}

/**
 * Sequencer Engine
 * Handles playback, timing, and MIDI output
 */
export class SequencerEngine {
    constructor(controller) {
        this.controller = controller;
        this.pattern = new SequencerPattern();

        // Debug: unique ID for this engine instance
        this.instanceId = Math.random().toString(36).substr(2, 9);

        // Cross-tab coordination using BroadcastChannel
        // Only ONE tab should control playback to avoid double-triggering
        this.tabId = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.broadcastChannel = null;
        this.isMasterTab = false; // Only master tab runs playback
        this.setupCrossTabCoordination();

        // Playback state
        this.playing = false;
        this.currentRow = 0;
        // Initialize BPM from global clock BPM
        this.bpm = controller.clockBPM || 120;
        this.deviceId = null; // Target device ID
        this.playbackLength = 64; // Playback loop length (defaults to full 64 rows, can be set to 4, 8, 16, 32)

        // Track state
        this.trackMutes = [false, false, false, false];
        this.trackPrograms = [0, 0, 0, 0]; // Program per track (0=default)
        this.trackVolumes = [127, 127, 127, 127]; // Volume multipliers per track
        this.trackDeviceBindings = [null, null, null, null]; // Device binding ID per track (null = use default deviceId)

        // Sync settings
        this.syncToSPP = false;          // Sync playback to incoming SPP
        this.syncToMIDIClock = false;    // Sync to MIDI clock (0xF8) - OFF by default, uses internal timing
        this.syncToGlobalClock = false;  // NEW: Sync to global clock (shared across all sequencers)
        this.sendStartStop = false;      // Send MIDI start/stop messages
        this.receiveStartStop = false;   // Start/stop on incoming MIDI messages
        this.sendSPP = false;            // Send SPP (Song Position Pointer) messages
        this.sppInterval = 16;           // SPP send interval: 4, 8, 16, 32, or 64 rows
        this.clockPulseCounter = 0;      // Count MIDI clock pulses (24 ppqn)
        this.pulsesPerRow = 12;          // 24 ppqn / 2 rows per beat = 12 pulses per row (CORRECTED!)
        this.lastGlobalRow = -1;         // NEW: Track last row from global clock to detect changes

        // Timing
        this.tickInterval = null;
        this.msPerRow = this.calculateMsPerRow();
        this.startTime = null;           // When playback started (for drift compensation)
        this.nextTickTime = null;        // When next tick should occur
        this.rafHandle = null;           // requestAnimationFrame handle for stable timing
        this.lastTickTime = null;        // For timing diagnostics
        this.tickCount = 0;              // Count ticks for diagnostics

        // Active notes tracking (for note off)
        this.activeNotes = new Map(); // track -> {note, timestamp}

        // Global clock master flag
        this.isMasterClock = false;
    }

    /**
     * Setup cross-tab coordination using BroadcastChannel
     * Only ONE tab should run playback engine to avoid double-triggering
     */
    setupCrossTabCoordination() {
        if (typeof BroadcastChannel === 'undefined') {
            console.warn('[Engine] BroadcastChannel not supported - multi-tab coordination disabled');
            this.isMasterTab = true; // Assume master if no coordination available
            return;
        }

        this.broadcastChannel = new BroadcastChannel('meister-sequencer-sync');

        // Listen for messages from other tabs
        this.broadcastChannel.addEventListener('message', (event) => {
            const { type, tabId, instanceId } = event.data;

            if (tabId === this.tabId) return; // Ignore own messages

            if (type === 'claim-master') {
                // Another tab is claiming master status
                this.isMasterTab = false;
            } else if (type === 'release-master') {
                // Previous master released control - claim it if we're the oldest tab
                this.claimMaster();
            }
        });

        // Claim master status on startup
        this.claimMaster();

        // Release master on page unload
        window.addEventListener('beforeunload', () => {
            if (this.isMasterTab) {
                this.broadcastChannel.postMessage({
                    type: 'release-master',
                    tabId: this.tabId,
                    instanceId: this.instanceId
                });
            }
        });
    }

    /**
     * Claim master tab status
     */
    claimMaster() {
        this.isMasterTab = true;
        if (this.broadcastChannel) {
            this.broadcastChannel.postMessage({
                type: 'claim-master',
                tabId: this.tabId,
                instanceId: this.instanceId
            });
        }
    }

    /**
     * Calculate milliseconds per row based on BPM
     * Classic tracker timing: 4 rows = 1 beat (64 rows = 16 beats)
     */
    calculateMsPerRow() {
        // 1 beat = 60000 / BPM milliseconds
        // 4 rows per beat (classic tracker timing)
        // So: 1 row = (60000 / BPM) / 4
        return (60000 / this.bpm) / 4;
    }

    /**
     * Set BPM and recalculate timing
     */
    setBPM(bpm) {
        this.bpm = Math.max(20, Math.min(300, bpm));
        this.msPerRow = this.calculateMsPerRow();

        // Sync with global clock BPM
        if (this.controller) {
            this.controller.clockBPM = this.bpm;
            // Update the global BPM input if it exists
            const globalBpmInput = document.getElementById('clock-bpm');
            if (globalBpmInput) {
                globalBpmInput.value = this.bpm;
            }
        }

        // No restart needed - timing will adjust on next tick
        // The new msPerRow will be used automatically in the timer loop
    }

    /**
     * Start playback
     */
    startPlayback() {
        if (this.playing) return;

        this.playing = true;

        // Update ONLY local sequencer pad colors, not device sequencer pads
        if (this.controller.updateLocalSequencerPads) {
            this.controller.updateLocalSequencerPads();
        }

        // Send MIDI start if configured
        if (this.sendStartStop && this.controller.midiOutput) {
            this.controller.midiOutput.send([0xFA]); // MIDI Start
            // console.log('[Sequencer] Sent MIDI Start');
        }

        // Reset timing counters
        this.lastTickTime = null;
        this.tickCount = 0;
        this.clockPulseCounter = 0;

        // Choose sync method (priority order: Global Clock > MIDI Clock > SPP > Internal)
        if (this.syncToGlobalClock) {
            // console.log(`[Sequencer] ✓✓✓ Started with GLOBAL CLOCK SYNC ✓✓✓`);
            this.currentRow = 0;
            this.lastGlobalRow = -1;

            // CRITICAL: Stop ANY existing timers - we sync to global clock, not internal timer!
            if (this.rafHandle) {
                clearTimeout(this.rafHandle);
                this.rafHandle = null;
            }
            if (this.tickInterval) {
                clearTimeout(this.tickInterval);
                this.tickInterval = null;
            }

            // Start polling global clock position
            this.startGlobalClockSync();
        } else if (this.syncToMIDIClock) {
            // console.log(`[Sequencer] ✓✓✓ Started with MIDI CLOCK SYNC ✓✓✓ (BPM: ${this.bpm})`);
            this.currentRow = 0;

            // CRITICAL: Stop ANY existing timers to prevent dual-timer bug!
            if (this.rafHandle) {
                // console.log(`[Sequencer] WARNING: Killing existing rafHandle timer!`);
                clearTimeout(this.rafHandle);
                this.rafHandle = null;
            }
            if (this.tickInterval) {
                // console.log(`[Sequencer] WARNING: Killing existing tickInterval timer!`);
                clearTimeout(this.tickInterval);
                this.tickInterval = null;
            }

            // Will advance ONLY on incoming MIDI clock pulses (handleMIDIClock)
            // Clock now uses Web Worker - stable timing even with UI visible!
            // console.log(`[Sequencer] Will advance ONLY on MIDI clock pulses (not internal timer)`);
        } else if (this.syncToSPP) {
            // console.log(`[Sequencer] Started (BPM: ${this.bpm}, Sync: SPP - waiting for position)`);
            // SPP sync - waits for incoming position messages, no internal timer
        } else {
            // Internal timing with high-precision setTimeout
            this.currentRow = 0;
            this.startTime = performance.now();
            this.nextTickTime = this.startTime;

            // CRITICAL: Clear any old timers first!
            if (this.rafHandle) {
                clearTimeout(this.rafHandle);
                this.rafHandle = null;
            }
            if (this.tickInterval) {
                clearTimeout(this.tickInterval);
                this.tickInterval = null;
            }

            // Start global clock if not already running
            if (!this.controller.globalClockRunning) {
                // console.log(`[Sequencer] ✓✓✓ STARTING GLOBAL CLOCK ✓✓✓ (BPM: ${this.bpm})`);
                this.startGlobalClock();
            }

            // console.log(`[Sequencer] Started (BPM: ${this.bpm}, Sync: Internal Timer)`);
            this.scheduleWithRAF();
        }
    }

    /**
     * Start global clock - marks this sequencer as the master
     */
    startGlobalClock() {
        // Mark this sequencer as the global clock master
        this.controller.globalClockRunning = true;
        this.controller.globalClockRow = this.currentRow; // Start from current position
        this.isMasterClock = true; // Flag to know we should update global clock

        // console.log('[Global Clock] Started - this sequencer is now the master clock');
    }

    /**
     * Update global clock (called by master sequencer when it advances)
     */
    updateGlobalClock() {
        if (this.isMasterClock && this.controller.globalClockRunning) {
            this.controller.globalClockRow = this.currentRow;
        }
    }

    /**
     * Stop playback
     */
    stopPlayback() {
        if (!this.playing) return;

        this.playing = false;

        // Update ONLY local sequencer pad colors, not device sequencer pads
        if (this.controller.updateLocalSequencerPads) {
            this.controller.updateLocalSequencerPads();
        }

        // Clear ALL timers to prevent multiple timers running!
        if (this.rafHandle) {
            clearTimeout(this.rafHandle);
            this.rafHandle = null;
        }

        if (this.tickInterval) {
            clearTimeout(this.tickInterval);
            this.tickInterval = null;
        }

        // Reset MIDI clock sync state
        this.clockPulseCounter = 0;
        this.lastTickTime = null;
        this.tickCount = 0;

        // Stop all active notes
        this.stopAllNotes();

        // Send MIDI stop if configured
        if (this.sendStartStop && this.controller.midiOutput) {
            this.controller.midiOutput.send([0xFC]); // MIDI Stop
            // console.log('[Sequencer] Sent MIDI Stop');
        }

        // console.log('[Sequencer] Stopped');
    }

    /**
     * Schedule playback using high-precision setTimeout (better than RAF!)
     */
    scheduleWithRAF() {
        // console.log(`[Sequencer] Starting high-precision internal timer at ${this.bpm} BPM (${this.msPerRow.toFixed(2)}ms per row)`);

        const clockTick = () => {
            if (!this.playing) return;

            const now = performance.now();

            // Timing diagnostics
            let delta = 0;
            if (this.lastTickTime !== null) {
                delta = now - this.lastTickTime;
            }
            this.lastTickTime = now;
            this.tickCount++;

            // Timing diagnostics disabled to prevent performance degradation with multiple sequencers
            // Uncomment for debugging timing issues:
            // if (this.tickCount % 64 === 1) {
            //     const expectedMs = this.msPerRow;
            //     const drift = delta - expectedMs;
            //     console.log(`[Sequencer] Internal Tick #${this.tickCount} Row ${this.currentRow}: delta=${delta.toFixed(2)}ms (expected=${expectedMs.toFixed(2)}ms, drift=${drift.toFixed(2)}ms)`);
            // }

            // Play the row
            this.playRow(this.currentRow);

            // Update global clock if this is the master (BEFORE incrementing row)
            this.updateGlobalClock();

            // Send SPP at configured intervals
            if (this.sendSPP && this.controller.midiOutput) {
                if (this.currentRow % this.sppInterval === 0) {
                    this.sendSPPPosition(this.currentRow);
                }
            }

            // Advance to next row (wrap at playbackLength, not pattern.rows)
            this.currentRow = (this.currentRow + 1) % this.playbackLength;

            // Schedule next tick with drift compensation
            this.nextTickTime += this.msPerRow;
            const delay = Math.max(0, this.nextTickTime - performance.now());

            // Use setTimeout for precise timing (not RAF which is limited to 60Hz!)
            this.rafHandle = setTimeout(clockTick, delay);
        };

        // Start the loop immediately
        this.rafHandle = setTimeout(clockTick, 0);
    }

    /**
     * Process one tick (advance to next row and play notes)
     */
    tick() {
        if (!this.playing) return;

        // Timing diagnostics for JS clock
        const now = performance.now();
        let delta = 0;
        if (this.lastTickTime !== null) {
            delta = now - this.lastTickTime;
        }
        this.lastTickTime = now;
        this.tickCount++;

        // Timing diagnostics disabled to prevent performance degradation with multiple sequencers
        // Uncomment for debugging timing issues:
        // if (this.tickCount % 64 === 1) {
        //     const expectedMs = this.msPerRow;
        //     const drift = delta - expectedMs;
        //     console.log(`[Sequencer] JS Tick #${this.tickCount} Row ${this.currentRow}: delta=${delta.toFixed(2)}ms (expected=${expectedMs.toFixed(2)}ms, drift=${drift.toFixed(2)}ms)`);
        // }

        this.playRow(this.currentRow);

        // Update global clock if this is the master (BEFORE incrementing row)
        this.updateGlobalClock();

        // Send SPP at configured intervals
        if (this.sendSPP && this.controller.midiOutput) {
            // Check if current row is a send boundary
            if (this.currentRow % this.sppInterval === 0) {
                this.sendSPPPosition(this.currentRow);
            }
        }

        // Advance to next row
        this.currentRow = (this.currentRow + 1) % this.pattern.rows;

        // Schedule next tick if still playing
        if (this.playing && !this.syncToSPP) {
            this.scheduleTick();
        }
    }

    /**
     * Schedule the next tick with drift compensation
     */
    scheduleTick() {
        // Calculate when next tick should occur (based on ideal timing from start)
        this.nextTickTime += this.msPerRow;

        // Calculate how long to wait (compensate for drift)
        const now = performance.now();
        const delay = Math.max(0, this.nextTickTime - now);

        // Schedule next tick
        this.tickInterval = setTimeout(() => {
            this.tick();
        }, delay);
    }

    /**
     * Play notes for a specific row
     */
    playRow(row) {
        // Collect all notes for this row
        const notesToPlay = [];

        for (let track = 0; track < this.pattern.tracks; track++) {
            const entry = this.pattern.getEntry(row, track);
            if (!entry || entry.isEmpty()) continue;

            // Check mute/solo
            if (this.isTrackMuted(track)) continue;

            // Handle note off effect
            if (entry.isNoteOff()) {
                this.stopTrackNote(track);
                continue;
            }

            // Get MIDI note number
            const midiNote = entry.getMidiNote();
            if (midiNote === null || midiNote < 0 || midiNote > 127) continue;

            // Calculate velocity with track volume multiplier
            const baseVelocity = Math.min(127, Math.max(0, entry.volume));
            const trackVolume = this.trackVolumes[track] / 127;
            const velocity = Math.round(baseVelocity * trackVolume);

            if (velocity === 0) continue;

            // Determine program/instrument
            const program = entry.program || this.trackPrograms[track];

            notesToPlay.push({ track, midiNote, velocity, program });
        }

        // Play notes with tiny delays between them to allow program changes to take effect
        // When multiple notes play on same row with different programs, we need to:
        // 1. Send program change for note 1
        // 2. Send note 1
        // 3. Wait 1ms
        // 4. Send program change for note 2
        // 5. Send note 2
        let delay = 0;
        for (const note of notesToPlay) {
            if (delay === 0) {
                // First note - play immediately
                this.playNote(note.track, note.midiNote, note.velocity, note.program);
                delay = 1; // Next note waits 1ms
            } else {
                // Subsequent notes - delay to allow previous program change to take effect
                setTimeout(() => {
                    this.playNote(note.track, note.midiNote, note.velocity, note.program);
                }, delay);
                delay += 1; // Each note adds 1ms delay
            }
        }
    }

    /**
     * Play a note on a specific track
     */
    playNote(track, midiNote, velocity, program) {
        // CRITICAL: Only master tab should send MIDI to prevent double-triggering
        if (!this.isMasterTab) {
            return; // Slave tab - don't send MIDI
        }

        // Get target device - use track-specific binding if set, otherwise fall back to global deviceId
        const trackDeviceBinding = this.trackDeviceBindings[track];
        let device = null;

        if (trackDeviceBinding && this.controller.deviceManager) {
            device = this.controller.deviceManager.getDevice(trackDeviceBinding);
        }

        // Fallback to global deviceId if no track-specific binding
        if (!device && this.controller.deviceManager) {
            const deviceId = this.deviceId ?? 0;
            device = this.controller.deviceManager.getDeviceByDeviceId(deviceId) ||
                     this.controller.deviceManager.getDefaultDevice();
        }

        if (!device) {
            console.warn(`[Sequencer] Track ${track}: No device available`);
            return;
        }

        // Get MIDI output for device
        const midiOutput = this.controller.deviceManager.getMidiOutput(device.id);
        if (!midiOutput) {
            console.warn(`[Sequencer] Track ${track}: No MIDI output for device ${device.name}`);
            return;
        }

        // Determine MIDI channel - use device's base channel for all tracks
        // Samplecrate doesn't use multi-channel, it uses program changes on a single channel
        let midiChannel = device.midiChannel;

        // CRITICAL: Stop previous note on THIS track BEFORE changing program
        // This ensures note-off is sent with the correct program for that note
        this.stopTrackNote(track);

        // ALWAYS send Program Change before EVERY note
        // UI stores: 0 = no program, 1-32 = user-facing "PROG 1" to "PROG 32"
        // Wire protocol: 0 = Regroove, 1-31 = Samplecrate slots 1-31
        // So we need to send program-1 when program > 0
        if (program > 0 && program <= 32) {
            const wireProgram = (program - 1) & 0x7F; // Convert UI 1-32 to wire 0-31
            const programChange = 0xC0 | midiChannel;
            midiOutput.send([programChange, wireProgram]);
        }

        // Send note immediately after program change
        const noteOn = 0x90 | midiChannel;
        midiOutput.send([noteOn, midiNote, velocity]);

        // Track active note with its program so we can send note-off with correct program
        this.activeNotes.set(track, {
            note: midiNote,
            channel: midiChannel,
            output: midiOutput,
            program: program  // Store program for this note
        });
    }

    /**
     * Stop note on a specific track
     */
    stopTrackNote(track) {
        const activeNote = this.activeNotes.get(track);
        if (!activeNote) return;

        // Send program change back to the note's original program before sending note-off
        // This ensures note-off is sent with the correct program context
        if (activeNote.program > 0 && activeNote.program <= 32) {
            const wireProgram = (activeNote.program - 1) & 0x7F;
            const programChange = 0xC0 | activeNote.channel;
            activeNote.output.send([programChange, wireProgram]);
        }

        // Now send note-off
        const noteOff = 0x80 | activeNote.channel;
        activeNote.output.send([noteOff, activeNote.note, 0]);

        this.activeNotes.delete(track);
    }

    /**
     * Stop all active notes
     */
    stopAllNotes() {
        for (let track = 0; track < this.pattern.tracks; track++) {
            this.stopTrackNote(track);
        }
    }

    /**
     * Send SPP (Song Position Pointer) message
     * Position is in 16th notes (MIDI beats)
     */
    sendSPPPosition(position) {
        if (!this.controller.midiOutput) return;

        // Only send SPP if sequencer is actually playing AND sendSPP is enabled
        if (!this.playing) return;
        if (!this.sendSPP) return;

        // SPP position is in MIDI beats (16th notes)
        // Split into LSB and MSB (14-bit value)
        const lsb = position & 0x7F;
        const msb = (position >> 7) & 0x7F;

        // Send SPP message: 0xF2 + LSB + MSB
        this.controller.midiOutput.send([0xF2, lsb, msb]);

        // console.log(`[Sequencer] Sent SPP: position ${position} (row ${position % 64})`);
    }

    /**
     * Handle incoming SPP message
     */
    handleSPP(position) {
        if (!this.syncToSPP || !this.playing) return;

        // SPP position is in MIDI beats (1/16th notes)
        // Map to our 64-row pattern
        const row = position % this.pattern.rows;

        // Only update if position changed
        if (row !== this.currentRow) {
            this.currentRow = row;
            this.playRow(this.currentRow);
        }
    }

    /**
     * Handle incoming MIDI start
     */
    handleMIDIStart() {
        if (!this.receiveStartStop) return;
        this.currentRow = 0;
        this.startPlayback();
    }

    /**
     * Handle incoming MIDI stop
     */
    handleMIDIStop() {
        if (!this.receiveStartStop) return;
        this.stopPlayback();
    }

    /**
     * Handle incoming MIDI clock pulse (0xF8)
     * Advances sequencer on MIDI clock pulses for rock-solid timing
     */
    handleMIDIClock() {
        if (!this.syncToMIDIClock) {
            // Not syncing to MIDI clock - use internal timing instead
            return;
        }

        if (!this.playing) {
            // Not playing - ignore clock pulses
            return;
        }

        // CRITICAL: Kill any internal timers that might be running!
        if (this.rafHandle) {
            clearTimeout(this.rafHandle);
            this.rafHandle = null;
        }
        if (this.tickInterval) {
            clearTimeout(this.tickInterval);
            this.tickInterval = null;
        }

        // Timing diagnostics
        const now = performance.now();
        let delta = 0;
        if (this.lastTickTime !== null) {
            delta = now - this.lastTickTime;
        }

        // Increment pulse counter
        this.clockPulseCounter++;

        // Advance row every 12 pulses (24 ppqn / 2 rows per beat = 12 pulses per row)
        if (this.clockPulseCounter >= this.pulsesPerRow) {
            this.clockPulseCounter = 0;
            this.lastTickTime = now;
            this.tickCount++;

            // Play current row
            this.playRow(this.currentRow);

            // Update global clock if this is the master (BEFORE incrementing row)
            this.updateGlobalClock();

            // Send SPP at configured intervals
            if (this.sendSPP && this.controller.midiOutput) {
                if (this.currentRow % this.sppInterval === 0) {
                    this.sendSPPPosition(this.currentRow);
                }
            }

            // Advance to next row (wrap at playbackLength, not pattern.rows)
            this.currentRow = (this.currentRow + 1) % this.playbackLength;
        }
    }

    /**
     * Start global clock sync - polls controller's global clock position
     */
    startGlobalClockSync() {
        // console.log(`[Sequencer] startGlobalClockSync called - controller.globalClockRunning=${this.controller.globalClockRunning}, globalClockRow=${this.controller.globalClockRow}`);

        if (!this.syncToGlobalClock) {
            console.warn('[Sequencer] Cannot start global clock sync: syncToGlobalClock=false');
            return;
        }

        // Ensure global clock is running
        if (!this.controller.globalClockRunning) {
            console.warn('[Sequencer] Global clock not running! Starting it now...');
            this.startGlobalClock();
        }

        // Poll global clock position every 5ms for tight sync
        const pollGlobalClock = () => {
            if (!this.playing || !this.syncToGlobalClock) {
                // console.log('[Sequencer] Stopping global clock sync polling');
                return; // Stop polling if playback stopped or sync mode changed
            }

            // Get global clock row position
            const globalRow = (this.controller.globalClockRow || 0) % 64; // Wrap to 64 rows

            // Only advance when global clock advances
            if (globalRow !== this.lastGlobalRow) {
                this.lastGlobalRow = globalRow;
                this.currentRow = globalRow;

                // Play notes at this row
                this.playRow(this.currentRow);
            }

            // Continue polling
            this.rafHandle = setTimeout(pollGlobalClock, 5);
        };

        // Start polling loop
        // console.log('[Sequencer] Starting global clock sync polling (5ms interval)');
        this.rafHandle = setTimeout(pollGlobalClock, 5);
    }

    /**
     * Check if track is muted (just check trackMutes)
     */
    isTrackMuted(track) {
        return this.trackMutes[track];
    }

    /**
     * Check if a track is soloed (NOT muted while AT LEAST 3 others ARE muted)
     * If user manually unmutes another track, solo disappears (< 3 muted means not solo)
     */
    isTrackSoloed(track) {
        if (this.trackMutes[track]) return false;

        let otherMutedCount = 0;
        for (let t = 0; t < this.pattern.tracks; t++) {
            if (t !== track && this.trackMutes[t]) {
                otherMutedCount++;
            }
        }
        return otherMutedCount >= 3;
    }

    /**
     * Toggle track mute
     */
    toggleMute(track) {
        if (track < 0 || track >= this.pattern.tracks) return;

        this.trackMutes[track] = !this.trackMutes[track];

        if (this.trackMutes[track]) {
            this.stopTrackNote(track);
        }

        // Notify listeners of mute state change
        this.notifyMuteChange(track);
    }

    /**
     * Notify all mute change listeners
     */
    notifyMuteChange(track) {
        if (this.muteChangeListeners && this.muteChangeListeners.length > 0) {
            this.muteChangeListeners.forEach(listener => listener(track, this.trackMutes));
        }
    }

    /**
     * Add mute change listener
     */
    addMuteChangeListener(listener) {
        if (!this.muteChangeListeners) {
            this.muteChangeListeners = [];
        }
        this.muteChangeListeners.push(listener);
    }

    /**
     * Remove mute change listener
     */
    removeMuteChangeListener(listener) {
        if (!this.muteChangeListeners) return;
        const index = this.muteChangeListeners.indexOf(listener);
        if (index > -1) {
            this.muteChangeListeners.splice(index, 1);
        }
    }

    /**
     * Toggle track solo
     */
    toggleSolo(track) {
        if (track < 0 || track >= this.pattern.tracks) return;

        if (this.isTrackSoloed(track)) {
            // Deactivating solo: unmute all tracks
            for (let t = 0; t < this.pattern.tracks; t++) {
                this.trackMutes[t] = false;
            }
        } else {
            // Activating solo: unmute this track, mute all other tracks
            this.trackMutes[track] = false;
            for (let t = 0; t < this.pattern.tracks; t++) {
                if (t !== track) {
                    this.trackMutes[t] = true;
                    this.stopTrackNote(t);
                }
            }
        }

        // Notify listeners that ALL tracks changed (solo affects all tracks)
        for (let t = 0; t < this.pattern.tracks; t++) {
            this.notifyMuteChange(t);
        }
    }

    /**
     * Set track volume
     */
    setTrackVolume(track, volume) {
        if (track < 0 || track >= this.pattern.tracks) return;
        this.trackVolumes[track] = Math.max(0, Math.min(127, volume));
    }

    /**
     * Set track program
     */
    setTrackProgram(track, program) {
        if (track < 0 || track >= this.pattern.tracks) return;
        this.trackPrograms[track] = Math.max(0, Math.min(32, program));
    }

    /**
     * Serialize engine state to JSON
     */
    toJSON() {
        return {
            pattern: this.pattern.toJSON(),
            deviceId: this.deviceId,
            bpm: this.bpm,
            syncToSPP: this.syncToSPP,
            syncToGlobalClock: this.syncToGlobalClock,
            sendStartStop: this.sendStartStop,
            receiveStartStop: this.receiveStartStop,
            sendSPP: this.sendSPP,
            sppInterval: this.sppInterval,
            trackMutes: this.trackMutes,
            trackPrograms: this.trackPrograms,
            trackVolumes: this.trackVolumes,
            trackDeviceBindings: this.trackDeviceBindings
        };
    }

    /**
     * Deserialize engine state from JSON
     */
    static fromJSON(controller, data) {
        const engine = new SequencerEngine(controller);
        if (data) {
            engine.pattern = SequencerPattern.fromJSON(data.pattern);
            engine.deviceId = data.deviceId ?? null;
            engine.bpm = data.bpm ?? 120;
            engine.syncToSPP = data.syncToSPP ?? false;
            engine.syncToGlobalClock = data.syncToGlobalClock ?? false;
            engine.sendStartStop = data.sendStartStop ?? false;
            engine.receiveStartStop = data.receiveStartStop ?? false;
            engine.sendSPP = data.sendSPP ?? false;
            engine.sppInterval = data.sppInterval ?? 16;
            engine.trackMutes = data.trackMutes || [false, false, false, false];
            engine.trackPrograms = data.trackPrograms || [0, 0, 0, 0];
            engine.trackVolumes = data.trackVolumes || [127, 127, 127, 127];
            engine.trackDeviceBindings = data.trackDeviceBindings || [null, null, null, null];
            engine.msPerRow = engine.calculateMsPerRow();
        }
        return engine;
    }
}
