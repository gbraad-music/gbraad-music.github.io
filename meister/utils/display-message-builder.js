/**
 * Display Message Builder Utilities
 * Helper functions for creating DisplayMessage objects
 */

class DisplayMessageBuilder {
    /**
     * Create a basic text display message
     * @param {string} deviceId - Device ID
     * @param {Array<string>} lines - Text lines (max 4, up to 20 chars each)
     * @param {Object} options - Additional options
     * @returns {Object} DisplayMessage
     */
    static createTextMessage(deviceId, lines, options = {}) {
        return {
            type: 'display_message',
            deviceId,
            deviceType: options.deviceType || 'unknown',
            lines: lines.map(line => this.formatLine(line, options.cols || 20)),
            graphics: options.graphics || null,
            metadata: {
                category: options.category || 'status',
                priority: options.priority || 'normal',
                duration: options.duration || null,
                clear: options.clear !== false
            }
        };
    }

    /**
     * Create a notification message
     * @param {string} deviceId - Device ID
     * @param {string} text - Notification text
     * @param {number} duration - Auto-dismiss duration in ms
     * @returns {Object} DisplayMessage
     */
    static createNotification(deviceId, text, duration = 2000) {
        const lines = this.wrapText(text, 20, 4);
        return this.createTextMessage(deviceId, lines, {
            category: 'notification',
            priority: 'high',
            duration
        });
    }

    /**
     * Create an error message
     * @param {string} deviceId - Device ID
     * @param {string} errorText - Error text
     * @returns {Object} DisplayMessage
     */
    static createError(deviceId, errorText) {
        const lines = this.wrapText('ERROR: ' + errorText, 20, 4);
        return this.createTextMessage(deviceId, lines, {
            category: 'error',
            priority: 'high',
            duration: 5000
        });
    }

    /**
     * Create a progress bar message
     * @param {string} deviceId - Device ID
     * @param {string} label - Progress label
     * @param {number} progress - Progress value (0.0 - 1.0)
     * @param {Object} options - Additional options
     * @returns {Object} DisplayMessage
     */
    static createProgressBar(deviceId, label, progress, options = {}) {
        const barWidth = options.barWidth || 18;
        const line = options.line || 1;
        const col = options.col || 1;

        return {
            type: 'display_message',
            deviceId,
            deviceType: options.deviceType || 'unknown',
            lines: [
                label.padEnd(20),
                ' '.repeat(20),
                ' '.repeat(20),
                ' '.repeat(20)
            ],
            graphics: [
                {
                    type: 'bar',
                    line: line,
                    col: col,
                    width: barWidth,
                    value: Math.max(0, Math.min(1, progress))
                }
            ],
            metadata: {
                category: options.category || 'status',
                priority: options.priority || 'normal'
            }
        };
    }

    /**
     * Create a centered text message
     * @param {string} deviceId - Device ID
     * @param {string} text - Text to center
     * @param {Object} options - Additional options
     * @returns {Object} DisplayMessage
     */
    static createCentered(deviceId, text, options = {}) {
        const cols = options.cols || 20;
        const padding = Math.floor((cols - text.length) / 2);
        const centeredText = ' '.repeat(Math.max(0, padding)) + text;

        return this.createTextMessage(deviceId, [centeredText], options);
    }

    /**
     * Create a two-column layout message
     * @param {string} deviceId - Device ID
     * @param {Object} leftRight - { left: string, right: string }
     * @param {Object} options - Additional options
     * @returns {Object} DisplayMessage
     */
    static createTwoColumn(deviceId, leftRight, options = {}) {
        const cols = options.cols || 20;
        const midPoint = Math.floor(cols / 2);

        const left = (leftRight.left || '').substring(0, midPoint).padEnd(midPoint);
        const right = (leftRight.right || '').substring(0, midPoint);
        const line = left + right;

        return this.createTextMessage(deviceId, [line], options);
    }

    /**
     * Create a key-value display message
     * @param {string} deviceId - Device ID
     * @param {Object} keyValues - { key1: value1, key2: value2, ... }
     * @param {Object} options - Additional options
     * @returns {Object} DisplayMessage
     */
    static createKeyValue(deviceId, keyValues, options = {}) {
        const cols = options.cols || 20;
        const separator = options.separator || ': ';
        const lines = [];

        for (let [key, value] of Object.entries(keyValues)) {
            const line = `${key}${separator}${value}`;
            lines.push(this.formatLine(line, cols));
            if (lines.length >= 4) break;
        }

        return this.createTextMessage(deviceId, lines, options);
    }

    /**
     * Create a menu display message
     * @param {string} deviceId - Device ID
     * @param {Array<string>} items - Menu items
     * @param {number} selectedIndex - Selected item index
     * @param {Object} options - Additional options
     * @returns {Object} DisplayMessage
     */
    static createMenu(deviceId, items, selectedIndex, options = {}) {
        const cols = options.cols || 20;
        const maxItems = options.maxItems || 4;
        const marker = options.marker || '>';

        const lines = items.slice(0, maxItems).map((item, idx) => {
            const prefix = idx === selectedIndex ? marker + ' ' : '  ';
            return this.formatLine(prefix + item, cols);
        });

        return this.createTextMessage(deviceId, lines, {
            ...options,
            category: 'menu'
        });
    }

    /**
     * Create a loading/spinner message
     * @param {string} deviceId - Device ID
     * @param {string} text - Loading text
     * @param {number} frame - Animation frame (0-3)
     * @returns {Object} DisplayMessage
     */
    static createLoading(deviceId, text, frame = 0) {
        const spinners = ['|', '/', '-', '\\'];
        const spinner = spinners[frame % spinners.length];
        const line = `${spinner} ${text}`;

        return this.createTextMessage(deviceId, [line], {
            category: 'status',
            priority: 'normal'
        });
    }

    // ===== Helper Functions =====

    /**
     * Format a line to fit column width
     * @param {string} text - Text to format
     * @param {number} cols - Column width
     * @returns {string} Formatted line
     */
    static formatLine(text, cols = 20) {
        if (!text) return ' '.repeat(cols);
        return (text + ' '.repeat(cols)).substring(0, cols);
    }

    /**
     * Wrap text to multiple lines
     * @param {string} text - Text to wrap
     * @param {number} cols - Column width
     * @param {number} maxLines - Maximum number of lines
     * @returns {Array<string>} Wrapped lines
     */
    static wrapText(text, cols = 20, maxLines = 4) {
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';

        for (let word of words) {
            if ((currentLine + word).length > cols) {
                if (currentLine) {
                    lines.push(this.formatLine(currentLine.trim(), cols));
                    if (lines.length >= maxLines) break;
                }
                currentLine = word + ' ';
            } else {
                currentLine += word + ' ';
            }
        }

        if (currentLine && lines.length < maxLines) {
            lines.push(this.formatLine(currentLine.trim(), cols));
        }

        // Pad to at least 2 lines
        while (lines.length < 2) {
            lines.push(' '.repeat(cols));
        }

        return lines;
    }

    /**
     * Truncate text with ellipsis
     * @param {string} text - Text to truncate
     * @param {number} maxLength - Maximum length
     * @returns {string} Truncated text
     */
    static truncate(text, maxLength = 20) {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength - 3) + '...';
    }

    /**
     * Pad text (left, right, or center)
     * @param {string} text - Text to pad
     * @param {number} width - Target width
     * @param {string} align - Alignment: 'left', 'right', 'center'
     * @returns {string} Padded text
     */
    static pad(text, width = 20, align = 'left') {
        if (text.length >= width) return text.substring(0, width);

        if (align === 'right') {
            return text.padStart(width, ' ');
        } else if (align === 'center') {
            const padding = width - text.length;
            const leftPad = Math.floor(padding / 2);
            return ' '.repeat(leftPad) + text + ' '.repeat(padding - leftPad);
        } else {
            return text.padEnd(width, ' ');
        }
    }

    /**
     * Create a horizontal bar using characters
     * @param {number} length - Bar length
     * @param {string} char - Character to use
     * @returns {string} Bar string
     */
    static createCharBar(length, char = '=') {
        return char.repeat(length);
    }
}

// Make available globally
window.DisplayMessageBuilder = DisplayMessageBuilder;
