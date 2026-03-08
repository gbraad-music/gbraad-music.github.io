/**
 * Display Message Manager for Meister
 * Central manager for routing display messages to appropriate adapters
 */

class DisplayMessageManager {
    constructor(deviceManager) {
        this.deviceManager = deviceManager;
        this.adapters = new Map();  // deviceId -> { type, adapter }
        this.warnedDevices = new Set();  // Track devices we've already warned about
        console.log('[DisplayMessageManager] Initialized');
    }

    /**
     * Register a display adapter for a device
     * @param {string} deviceId - Device binding ID
     * @param {string} deviceType - Device type (regroove, samplecrate, fire)
     * @param {Object} adapter - Display adapter instance
     */
    registerDisplay(deviceId, deviceType, adapter) {
        this.adapters.set(deviceId, {
            type: deviceType,
            adapter: adapter
        });
        console.log(`[Display] Registered ${deviceType} display for device: ${deviceId}`);
    }

    /**
     * Unregister a display adapter
     * @param {string} deviceId - Device binding ID
     */
    unregisterDisplay(deviceId) {
        if (this.adapters.delete(deviceId)) {
            console.log(`[Display] Unregistered device: ${deviceId}`);
        }
    }

    /**
     * Send a display message to a specific device
     * @param {Object} message - DisplayMessage object
     */
    sendMessage(message) {
        const deviceId = message.deviceId;

        if (!this.adapters.has(deviceId)) {
            // Only warn once per device to avoid console spam
            if (!this.warnedDevices.has(deviceId)) {
                console.warn(`[Display] No adapter registered for device: ${deviceId}`);
                this.warnedDevices.add(deviceId);
            }
            return false;
        }

        const { type, adapter } = this.adapters.get(deviceId);

        try {
            adapter.sendMessage(message);
            return true;
        } catch (err) {
            console.error(`[Display] Error sending to ${deviceId}:`, err);
            return false;
        }
    }

    /**
     * Broadcast a message to all registered displays
     * @param {Object} messageTemplate - DisplayMessage template (deviceId will be set per device)
     */
    broadcast(messageTemplate) {
        let successCount = 0;
        this.adapters.forEach((config, deviceId) => {
            const message = { ...messageTemplate, deviceId };
            if (this.sendMessage(message)) {
                successCount++;
            }
        });
        console.log(`[Display] Broadcast to ${successCount}/${this.adapters.size} devices`);
        return successCount;
    }

    /**
     * Get registered adapter for a device
     * @param {string} deviceId - Device binding ID
     * @returns {Object|null} Adapter info or null
     */
    getAdapter(deviceId) {
        return this.adapters.get(deviceId) || null;
    }

    /**
     * Get all registered device IDs
     * @returns {Array<string>} Array of device IDs
     */
    getRegisteredDevices() {
        return Array.from(this.adapters.keys());
    }

    /**
     * Create a status message for a device
     * @param {string} deviceId - Device binding ID
     * @param {string} deviceType - Device type
     * @param {Object} state - Device state object
     * @returns {Object} DisplayMessage object
     */
    createStatusMessage(deviceId, deviceType, state) {
        if (deviceType === 'regroove') {
            return this.createRegrooveStatusMessage(deviceId, state);
        } else if (deviceType === 'samplecrate') {
            return this.createSamplecrateStatusMessage(deviceId, state);
        } else if (deviceType === 'mixxx') {
            return this.createMixxxStatusMessage(deviceId, state);
        } else if (deviceType === 'fire') {
            return this.createFireStatusMessage(deviceId, state);
        } else {
            // Generic fallback
            return {
                type: 'display_message',
                deviceId,
                deviceType,
                lines: [
                    `${deviceType}`,
                    'Ready'
                ],
                metadata: { category: 'status', priority: 'normal' }
            };
        }
    }

    /**
     * Create Regroove status message
     */
    createRegrooveStatusMessage(deviceId, state) {
        const bpm = String(state.bpm || 0).padStart(3, ' ');
        const order = String(state.order || 0).padStart(2, '0');
        const pattern = String(state.pattern || 0).padStart(2, '0');
        const row = String(state.row || 0).padStart(2, ' ');
        const status = state.playing ? 'Playing' : 'Stopped';
        const muteStr = state.channelMutes || '----';

        return {
            type: 'display_message',
            deviceId,
            deviceType: 'regroove',
            lines: [
                `Regroove      ${bpm}BPM`.padEnd(20),
                `Ord:${order}  Pat:${pattern}    `.padEnd(20),
                `Ch 0-3: ${muteStr}       `.padEnd(20),
                `[${status}] Row:${row}  `.padEnd(20)
            ],
            metadata: { category: 'status', priority: 'normal' }
        };
    }

    /**
     * Create Samplecrate status message
     */
    createSamplecrateStatusMessage(deviceId, state) {
        const bpm = String(state.bpm || 0).padStart(3, ' ');
        const pad = String(state.pad || 0).padStart(2, '0');
        const volume = String(state.volume || 0).padStart(3, ' ');
        const filter = String(state.filter || 0).padStart(3, ' ');
        const resonance = String(state.resonance || 0).padStart(2, ' ');
        const status = state.playing ? 'Playing' : 'Stopped';
        const sequence = String(state.sequence || 1);

        return {
            type: 'display_message',
            deviceId,
            deviceType: 'samplecrate',
            lines: [
                `Samplecrate   ${bpm}BPM`.padEnd(20),
                `Pad:${pad}  Vol:${volume}%   `.padEnd(20),
                `Flt:${filter}%  Res:${resonance} `.padEnd(20),
                `[${status}] Seq ${sequence} `.padEnd(20)
            ],
            metadata: { category: 'status', priority: 'normal' }
        };
    }

    /**
     * Create Mixxx deck status message
     * @param {string} deviceId - Device ID
     * @param {Object} state - Deck state from parseDeckStateResponse
     * @returns {Object} - Display message
     */
    createMixxxStatusMessage(deviceId, state) {
        const deckNum = state.deck || 1;
        const playing = state.playing ? '▶ ' : '⏸ ';
        const looping = (state.playing && state.looping) ? ' LOOP' : '';
        const sync = state.sync ? ' S' : '';
        const pfl = state.pfl ? ' PFL' : '';
        const mute = state.mute ? ' M' : ''; // Mute indicator on first line

        // FX indicators (show which FX units are enabled)
        const fx = [];
        if (state.fx1) fx.push('1');
        if (state.fx2) fx.push('2');
        if (state.fx3) fx.push('3');
        if (state.fx4) fx.push('4');
        const fxStr = fx.length > 0 ? `FX:${fx.join('')}` : '';

        // FX color mapping (green for all FX)
        const fxColors = {
            '1': '#00FF00',  // Green
            '2': '#00FF00',  // Green
            '3': '#00FF00',  // Green
            '4': '#00FF00'   // Green
        };

        // Format BPM with 2 decimal places
        const bpm = state.bpm ? state.bpm.toFixed(2) : '0.00';

        // Position bar (14 chars to fit better)
        const posLevel = Math.round((state.position / 100) * 14);
        const posBar = '█'.repeat(posLevel) + '░'.repeat(14 - posLevel);

        // Format time as M:SS
        const formatTime = (seconds) => {
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        };

        const currentTime = formatTime((state.position / 100) * (state.duration || 0));
        const totalTime = formatTime(state.duration || 0);

        // Line 1: Play status, loop (if playing), sync, PFL, mute, and BPM
        const statusLine = `${playing}${looping}${sync}${pfl}${mute} BPM: ${bpm}`.padEnd(20);

        // Line 2: Time position
        const timeLine = `${currentTime} / ${totalTime}`.padEnd(20);

        // Line 3: Progress bar
        const progressLine = `${posBar}`.padEnd(20);

        return {
            type: 'display_message',
            deviceId,
            deviceType: 'mixxx',
            lines: [
                statusLine,
                timeLine,
                progressLine,
                fxStr.padEnd(20)
            ],
            metadata: {
                category: 'status',
                priority: 'normal',
                pfl: state.pfl,
                mute: state.mute, // Add mute to metadata for coloring
                fx: fx.length > 0,
                fxColors: fxColors
            }
        };
    }

    /**
     * Create Fire sequencer status message
     * Format matches web UI (fire-display.js)
     */
    createFireStatusMessage(deviceId, state) {
        const bpm = String(state.bpm || 128);
        const currentRow = String(state.currentRow || 0).padStart(2, '0');
        const totalRows = String(state.totalRows || 64);
        const playGlyph = state.playing ? '\u25B6' : '\u25A0';  // ▶ or ■
        const status = state.playing ? 'PLAY' : 'STOP';

        // Header: Scene name + linked sequencer (or standalone)
        const sceneName = state.sceneName || 'Fire';
        const linkedName = state.linkedSequencer || null;
        const header = linkedName ? `${sceneName} > ${linkedName}` : sceneName;

        // Fire grid offset (visible window)
        const gridOffset = state.gridOffset || 0;
        const gridEnd = gridOffset + 15;
        const gridView = `${String(gridOffset).padStart(2, '0')}-${String(gridEnd).padStart(2, '0')}`;

        // Track indicators with markup for graphical rendering
        const trackMutes = state.trackMutes || [false, false, false, false];
        const trackSolos = state.trackSolos || [false, false, false, false];
        let trackLine = '';
        for (let i = 0; i < 4; i++) {
            if (trackSolos[i]) {
                trackLine += `S${i+1} `;  // Solo - plain text
            } else if (trackMutes[i]) {
                trackLine += `[M${i+1}]`;  // Muted - boxed
            } else {
                trackLine += `T${i+1} `;   // Normal - plain text
            }
        }

        return {
            type: 'display_message',
            deviceId,
            deviceType: 'fire',
            lines: [
                header,
                `${playGlyph} ${status}  Pos:${currentRow}/${totalRows}  BPM:${bpm}`,
                `View:${gridView}`,
                trackLine.trim()
            ],
            metadata: {
                category: 'status',
                priority: 'normal',
                trackMutes,
                trackSolos
            }
        };
    }

    /**
     * Create a notification message
     * @param {string} deviceId - Device binding ID
     * @param {string} text - Notification text
     * @param {number} duration - Auto-dismiss duration in ms (null = permanent)
     * @returns {Object} DisplayMessage object
     */
    createNotification(deviceId, text, duration = 2000) {
        // Split text into lines (max 20 chars per line)
        const lines = [];
        const words = text.split(' ');
        let currentLine = '';

        for (let word of words) {
            if ((currentLine + word).length > 20) {
                if (currentLine) lines.push(currentLine.trim().padEnd(20));
                currentLine = word + ' ';
            } else {
                currentLine += word + ' ';
            }
        }
        if (currentLine) lines.push(currentLine.trim().padEnd(20));

        // Limit to 4 lines
        while (lines.length < 2) lines.push(' '.repeat(20));
        const displayLines = lines.slice(0, 4);

        return {
            type: 'display_message',
            deviceId,
            deviceType: 'unknown',
            lines: displayLines,
            metadata: {
                category: 'notification',
                priority: 'high',
                duration: duration
            }
        };
    }
}

// Make available globally
window.DisplayMessageManager = DisplayMessageManager;
