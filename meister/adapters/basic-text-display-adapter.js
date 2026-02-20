/**
 * Basic Text Display Adapter
 * For Regroove, Samplecrate, and other devices with simple text LCDs
 * Supports 2-4 line displays (20 chars per line)
 */

class BasicTextDisplayAdapter {
    constructor(deviceBinding, rows = 2, cols = 20) {
        this.device = deviceBinding;
        this.cols = cols;
        this.rows = rows;  // Initial: 2 lines (upgradeable to 4)
        this.buffer = Array(this.rows).fill('').map(() => ' '.repeat(this.cols));
        console.log(`[BasicTextDisplay] Initialized ${rows}×${cols} for device:`, deviceBinding.id || deviceBinding.deviceId);
    }

    /**
     * Send DisplayMessage to device
     * @param {Object} message - DisplayMessage object
     */
    sendMessage(message) {
        // Limit to available rows on device
        const linesToSend = message.lines.slice(0, this.rows);

        // Convert to SysEx
        const sysex = this.buildDisplayTextSysEx(linesToSend, message.metadata);

        // Send via MIDI
        const output = this.getMidiOutput();
        if (output) {
            output.send(sysex);
            console.log(`[BasicTextDisplay] Sent ${linesToSend.length} lines to device`);
        } else {
            console.warn('[BasicTextDisplay] No MIDI output available');
        }

        // Update internal buffer
        this.updateBuffer(linesToSend);
    }

    /**
     * Build DISPLAY_TEXT SysEx message (0xA0)
     */
    buildDisplayTextSysEx(lines, metadata = {}) {
        const deviceId = this.device.deviceId || 0;
        const sysex = [0xF0, 0x7D, deviceId, 0xA0];

        // Flags: bit 0 = clear before write
        const clearFlag = metadata.clear !== false ? 0x01 : 0x00;
        sysex.push(clearFlag);

        // Line count
        sysex.push(lines.length);

        // For each line
        lines.forEach((line, idx) => {
            const text = this.formatLine(line);
            sysex.push(idx);           // Line number
            sysex.push(0);             // Column offset
            sysex.push(text.length);   // Text length

            // ASCII text bytes
            for (let i = 0; i < text.length; i++) {
                sysex.push(text.charCodeAt(i));
            }
        });

        sysex.push(0xF7);
        return new Uint8Array(sysex);
    }

    /**
     * Format line to fit display (truncate or pad to column width)
     */
    formatLine(text) {
        if (!text) return ' '.repeat(this.cols);
        // Truncate or pad to column width
        return (text + ' '.repeat(this.cols)).substring(0, this.cols);
    }

    /**
     * Update internal buffer
     */
    updateBuffer(lines) {
        lines.forEach((line, idx) => {
            if (idx < this.rows) {
                this.buffer[idx] = this.formatLine(line);
            }
        });
    }

    /**
     * Get current buffer contents
     */
    getBuffer() {
        return [...this.buffer];
    }

    /**
     * Clear display
     */
    clear() {
        const deviceId = this.device.deviceId || 0;
        const sysex = new Uint8Array([
            0xF0, 0x7D, deviceId, 0xA0,
            0x01,  // Flags: clear
            0x00,  // Line count: 0 (clear only)
            0xF7
        ]);

        const output = this.getMidiOutput();
        if (output) {
            output.send(sysex);
            console.log('[BasicTextDisplay] Display cleared');
        }

        // Clear internal buffer
        this.buffer = Array(this.rows).fill('').map(() => ' '.repeat(this.cols));
    }

    /**
     * Upgrade display capabilities
     */
    setDisplayCapabilities(rows, cols) {
        this.rows = rows;
        this.cols = cols;
        this.buffer = Array(this.rows).fill('').map(() => ' '.repeat(this.cols));
        console.log(`[BasicTextDisplay] Upgraded to ${rows}×${cols} display`);
    }

    /**
     * Get MIDI output for this device
     */
    getMidiOutput() {
        // If device has deviceManager reference, use it
        if (window.deviceManager && this.device.id) {
            const output = window.deviceManager.getMidiOutput(this.device.id);
            if (output) return output;
        }

        // Fallback: try device binding directly
        if (this.device.midiOutput) {
            return this.device.midiOutput;
        }

        // Fallback: global controller MIDI output
        if (window.controller && window.controller.midiOutput) {
            return window.controller.midiOutput;
        }

        return null;
    }
}

// Make available globally
window.BasicTextDisplayAdapter = BasicTextDisplayAdapter;
