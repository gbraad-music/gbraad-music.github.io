/**
 * Akai Fire OLED Display Adapter
 * Dual-mode: Virtual (browser UI) OR Physical (actual Fire hardware via USB MIDI)
 * Based on DrivenByMoss FireDisplay.java and SEGGER blog
 */

class FireOLEDAdapter {
    constructor(deviceBinding, mode = 'virtual', renderMode = 'text') {
        this.device = deviceBinding;
        this.mode = mode;  // 'virtual' or 'physical'
        this.renderMode = renderMode;  // 'text' or 'graphic'
        this.width = 128;
        this.height = 64;

        // Create rendering canvas (used for both modes)
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.ctx = this.canvas.getContext('2d');

        // Fire OLED protocol constants (from DrivenByMoss/SEGGER)
        this.FIRE_HEADER = [0xF0, 0x47, 0x7F, 0x43];  // AKAI Fire SysEx header
        this.WRITE_OLED = 0x0E;                        // Write OLED command
        this.STRIPE_SIZE = 147;                        // Bytes per stripe
        this.NUM_STRIPES = 8;                          // 8 stripes of 8 pixels each

        // Bit mutation table (from FireDisplay.java)
        this.BIT_MUTATE = [
            [13, 19, 25, 31, 37, 43, 49],
            [0,  20, 26, 32, 38, 44, 50],
            [1,  7,  27, 33, 39, 45, 51],
            [2,  8,  14, 34, 40, 46, 52],
            [3,  9,  15, 21, 41, 47, 53],
            [4,  10, 16, 22, 28, 48, 54],
            [5,  11, 17, 23, 29, 35, 55],
            [6,  12, 18, 24, 30, 36, 42]
        ];

        // Display buffer (for tracking changes)
        this.oledBitmap = Array(this.NUM_STRIPES).fill(null).map(() => new Array(this.STRIPE_SIZE).fill(0));
        this.oldOledBitmap = Array(this.NUM_STRIPES).fill(null).map(() => new Array(this.STRIPE_SIZE).fill(0));
        this.lastSend = Date.now();

        console.log(`[FireOLED] Initialized in ${mode} mode, renderMode: ${renderMode}, for device:`, deviceBinding.id || 'fire');
    }

    /**
     * Send DisplayMessage to Fire OLED
     * @param {Object} message - DisplayMessage object
     */
    sendMessage(message) {
        // Step 1: Render DisplayMessage to canvas (text + graphics)
        this.renderToCanvas(message);

        // Step 2: Always update virtual display (webpage)
        this.updateVirtualDisplay();

        // Step 3: If physical mode, also send to hardware
        if (this.mode === 'physical') {
            this.sendToPhysicalFire();
        }
    }

    /**
     * Set rendering mode
     * @param {string} renderMode - 'text' or 'graphic'
     */
    setRenderMode(renderMode) {
        if (renderMode !== 'text' && renderMode !== 'graphic') {
            console.error(`[FireOLED] Invalid render mode: ${renderMode}. Use 'text' or 'graphic'`);
            return;
        }
        this.renderMode = renderMode;
        console.log(`[FireOLED] Render mode changed to: ${renderMode}`);
    }

    /**
     * Toggle rendering mode between text and graphic
     */
    toggleRenderMode() {
        this.renderMode = this.renderMode === 'text' ? 'graphic' : 'text';
        console.log(`[FireOLED] Render mode toggled to: ${this.renderMode}`);
        return this.renderMode;
    }

    /**
     * Render DisplayMessage to canvas
     */
    renderToCanvas(message) {
        // Clear canvas
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.width, this.height);

        if (this.renderMode === 'text') {
            // Text rendering mode (default)
            this.renderAsText(message);
        } else if (this.renderMode === 'graphic') {
            // Graphic rendering mode (for testing physical Fire behavior)
            this.renderAsGraphic(message);
        }
    }

    /**
     * Render as text (default mode) with graphical enhancements
     */
    renderAsText(message) {
        this.ctx.font = '8px monospace';
        this.ctx.imageSmoothingEnabled = false;

        if (message.lines.length > 0) {
            // Header text (LEFT aligned)
            const header = message.lines[0] || '';
            this.ctx.fillStyle = '#FFF';
            this.ctx.fillText(header, 2, 8);

            // GRAPHICAL: Separator line below header
            this.ctx.fillRect(0, 10, this.width, 1);

            // Line 2: Status, position, BPM (y=20)
            if (message.lines[1]) {
                this.ctx.fillText(message.lines[1], 2, 20);
            }

            // Line 3: View (y=30)
            if (message.lines[2]) {
                this.ctx.fillText(message.lines[2], 2, 30);
            }

            // Line 4: Track indicators with boxes (y=45, raised up)
            if (message.lines[3]) {
                this.renderTrackIndicators(message.lines[3], 47, message.metadata);
            }
        }

        // Render graphics primitives
        if (message.graphics) {
            message.graphics.forEach(gfx => {
                this.renderGraphic(gfx);
            });
        }
    }

    /**
     * Render as graphic (bitmap mode for testing)
     * This mode renders text as graphical bitmaps similar to how physical Fire would display it
     */
    renderAsGraphic(message) {
        this.ctx.font = '8px monospace';
        this.ctx.imageSmoothingEnabled = false;

        if (message.lines.length > 0) {
            // Header text (LEFT aligned)
            const header = message.lines[0] || '';
            this.ctx.fillStyle = '#FFF';
            this.ctx.fillText(header, 2, 8);

            // GRAPHICAL: Separator line below header
            this.ctx.fillRect(0, 10, this.width, 1);

            // Line 2: Status, position, BPM (y=20)
            if (message.lines[1]) {
                this.ctx.fillText(message.lines[1], 2, 20);
            }

            // Line 3: View (y=30)
            if (message.lines[2]) {
                this.ctx.fillText(message.lines[2], 2, 30);
            }

            // Line 4: Track indicators with boxes (y=45, raised up)
            if (message.lines[3]) {
                this.renderTrackIndicators(message.lines[3], 47, message.metadata);
            }
        }

        // Render graphics primitives
        if (message.graphics) {
            message.graphics.forEach(gfx => {
                this.renderGraphic(gfx);
            });
        }
    }

    /**
     * Render track indicators with boxes for all tracks
     */
    renderTrackIndicators(trackLine, baselineY, metadata) {
        const trackMutes = metadata?.trackMutes || [false, false, false, false];
        const trackSolos = metadata?.trackSolos || [false, false, false, false];

        let x = 5;  // Starting x position (moved 3 pixels right from 2)
        const boxWidth = 28;  // Box width
        const boxHeight = 12;  // Box height
        const spacing = 2;
        const boxY = baselineY - 9;  // Box top position

        for (let i = 0; i < 4; i++) {
            const label = trackSolos[i] ? `S${i+1}` : trackMutes[i] ? `M${i+1}` : `T${i+1}`;

            if (trackMutes[i]) {
                // MUTED: Rounded white border, black interior, WHITE text
                this.drawRoundedBox(x, boxY, boxWidth, boxHeight, 2);
                this.ctx.fillStyle = '#FFF';
                this.ctx.fillText(label, x + 9, baselineY);  // Text moved 3px right
            } else {
                // NORMAL/ACTIVE/SOLO: Solid WHITE rounded box, BLACK text
                this.drawSolidRoundedBox(x, boxY, boxWidth, boxHeight, 2);
                this.ctx.fillStyle = '#000';
                this.ctx.fillText(label, x + 9, baselineY);
            }

            x += boxWidth + spacing;
        }
    }

    /**
     * Draw solid rounded corner rectangle (WHITE filled)
     */
    drawSolidRoundedBox(x, y, width, height, radius) {
        this.ctx.fillStyle = '#FFF';

        // Main rectangle (minus corners)
        this.ctx.fillRect(x + radius, y, width - 2 * radius, height);  // Horizontal strip
        this.ctx.fillRect(x, y + radius, width, height - 2 * radius);  // Vertical strip

        // Rounded corners (approximate with pixels)
        // Top-left
        this.ctx.fillRect(x + 1, y + 1, radius - 1, radius - 1);
        // Top-right
        this.ctx.fillRect(x + width - radius, y + 1, radius - 1, radius - 1);
        // Bottom-left
        this.ctx.fillRect(x + 1, y + height - radius, radius - 1, radius - 1);
        // Bottom-right
        this.ctx.fillRect(x + width - radius, y + height - radius, radius - 1, radius - 1);
    }

    /**
     * Draw hollow rounded corner rectangle (white border, black interior)
     */
    drawRoundedBox(x, y, width, height, radius) {
        // First draw solid white rounded box
        this.drawSolidRoundedBox(x, y, width, height, radius);

        // Then draw black interior (leave 2px border)
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(x + 2, y + 2, width - 4, height - 4);
    }

    /**
     * Update virtual Fire display in browser UI
     */
    updateVirtualDisplay() {
        const fireLCD = document.getElementById('fire-lcd-display');
        if (!fireLCD) {
            // Scene not active - skip silently to avoid affecting playback timing
            return;
        }

        // Get or create display canvas in LCD element
        let displayCanvas = fireLCD.querySelector('canvas');
        if (!displayCanvas) {
            displayCanvas = document.createElement('canvas');
            displayCanvas.width = this.width;
            displayCanvas.height = this.height;
            displayCanvas.style.width = '256px';  // 2x scaling
            displayCanvas.style.height = '128px';
            displayCanvas.style.imageRendering = 'pixelated';
            displayCanvas.style.background = '#000';
            fireLCD.innerHTML = '';
            fireLCD.appendChild(displayCanvas);
        }

        // Copy our rendered canvas to display canvas
        const ctx = displayCanvas.getContext('2d');
        ctx.drawImage(this.canvas, 0, 0);
    }

    /**
     * Send to physical Fire hardware via OLED SysEx
     */
    sendToPhysicalFire() {
        // Encode canvas to Fire OLED bitmap format
        const imageData = this.ctx.getImageData(0, 0, this.width, this.height);
        this.encodeToOLEDBitmap(imageData);

        // Convert to Fire SysEx packets and send
        const packets = this.buildFireSysExPackets();
        const output = this.getMidiOutput();

        if (!output) {
            // Warn only once to avoid flooding console (affects playback timing)
            if (!this.noOutputWarned) {
                console.warn('[FireOLED] No MIDI output available for physical Fire (reconnect via settings)');
                this.noOutputWarned = true;
            }
            return;
        }

        // Reset warning flag when output is available
        this.noOutputWarned = false;

        for (let packet of packets) {
            output.send(packet);
        }
    }

    /**
     * Encode canvas to Fire OLED bitmap format
     * Based on FireDisplay.java algorithm
     */
    encodeToOLEDBitmap(imageData) {
        // Unwind 128x64 arrangement into 8 stripes of 8 pixels high
        for (let stripe = 0; stripe < this.NUM_STRIPES; stripe++) {
            for (let y = 0; y < this.height / 8; y++) {
                for (let x = 0; x < this.width; x++) {
                    // Row = stripe * 8 + y (stripe 0 = rows 0-7, stripe 1 = rows 8-15, etc.)
                    const pixelIndex = ((stripe * 8 + y) * this.width + x) * 4;
                    const red = imageData.data[pixelIndex];      // Canvas is RGBA, not BGRA
                    const green = imageData.data[pixelIndex + 1];
                    const blue = imageData.data[pixelIndex + 2];

                    const xpos = x + 128 * Math.floor(y / 8);
                    const ypos = y % 8;

                    // Re-map by tiling 7x8 block of translated pixels (BIT_MUTATE table)
                    const remapBit = this.BIT_MUTATE[ypos][xpos % 7];
                    const idx = Math.floor(xpos / 7) * 8 + Math.floor(remapBit / 7);

                    // Monochrome threshold (any color = white pixel)
                    if (blue + green + red > 127 * 3) {
                        this.oledBitmap[stripe][idx] |= (1 << (remapBit % 7));
                    } else {
                        this.oledBitmap[stripe][idx] &= ~(1 << (remapBit % 7));
                    }
                }
            }
        }
    }

    /**
     * Build Fire OLED SysEx packets
     * Format: F0 47 7F 43 0E <len_hi> <len_lo> <stripe_start> <stripe_end> <col_start> <col_end> <bitmap_data> F7
     */
    buildFireSysExPackets() {
        const packets = [];
        const now = Date.now();

        for (let stripe = 0; stripe < this.NUM_STRIPES; stripe++) {
            // Check if stripe changed (or force refresh every 3 seconds to prevent sleep)
            const changed = this.oledBitmap[stripe].some((val, i) =>
                val !== this.oldOledBitmap[stripe][i]
            );

            if (!changed && now - this.lastSend < 3000) {
                continue;  // Skip unchanged stripe
            }

            // Build Fire OLED SysEx packet
            // Payload length = 4 (stripe/column params) + 147 (bitmap) = 151 bytes
            const PACKET_SIZE = 4 + this.STRIPE_SIZE;  // 151
            const lenMSB = Math.floor(PACKET_SIZE / 128);  // 151 / 128 = 1
            const lenLSB = PACKET_SIZE % 128;              // 151 % 128 = 23

            const packet = [
                ...this.FIRE_HEADER,      // F0 47 7F 43 (AKAI Fire)
                this.WRITE_OLED,          // 0E (Write OLED command)
                lenMSB, lenLSB,           // Payload length (151 = MSB:1, LSB:23)
                stripe, stripe,           // Start/end stripe (8-pixel band)
                0x00, 0x7F,               // Start/end column (0-127)
                ...this.oledBitmap[stripe], // 147 bytes of bitmap data
                0xF7                       // SysEx end
            ];

            packets.push(new Uint8Array(packet));

            // Update old bitmap for change tracking
            this.oldOledBitmap[stripe] = [...this.oledBitmap[stripe]];
        }

        if (packets.length > 0) {
            this.lastSend = now;
        }

        return packets;
    }

    /**
     * Render graphics primitive
     */
    renderGraphic(gfx) {
        if (gfx.type === 'bar') {
            const x = gfx.col * 6;  // Approx char width
            const y = gfx.line * 14;
            const w = gfx.width * 6;
            const fillWidth = w * gfx.value;

            this.ctx.strokeStyle = '#FFF';
            this.ctx.strokeRect(x, y + 8, w, 4);
            this.ctx.fillStyle = '#FFF';
            this.ctx.fillRect(x + 1, y + 9, fillWidth - 2, 2);
        }
    }

    /**
     * Clear display
     */
    clear() {
        // Clear canvas
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.width, this.height);

        // Reset bitmap
        this.oledBitmap = Array(this.NUM_STRIPES).fill(null).map(() => new Array(this.STRIPE_SIZE).fill(0));

        // Update display
        if (this.mode === 'virtual') {
            this.updateVirtualDisplay();
        } else if (this.mode === 'physical') {
            this.sendToPhysicalFire();
        }
    }

    /**
     * Get MIDI output for this device
     */
    getMidiOutput() {
        // Check if this.device is a Device Manager device object (has midiOutputName)
        if (this.device.midiOutputName && window.meisterController && window.meisterController.midiAccess) {
            // This is a Device Manager device - get output by name
            const midiAccess = window.meisterController.midiAccess;
            for (let output of midiAccess.outputs.values()) {
                if (output.name === this.device.midiOutputName) {
                    return output;
                }
            }
        }

        // Legacy: device binding with controller reference
        if (this.device.controller && this.device.controller.midiAccess) {
            const midiAccess = this.device.controller.midiAccess;

            // Use Device Manager to get MIDI output (midiInputDevice is the device ID)
            if (this.device.midiInputDevice && this.device.controller.deviceManager) {
                const deviceManager = this.device.controller.deviceManager;
                const device = deviceManager.getDevice(this.device.midiInputDevice);
                if (device) {
                    const output = deviceManager.getMidiOutput(device.id);
                    if (output) {
                        return output;
                    }
                }
            }

            // Fallback to controller's default output
            return this.device.controller.midiOutput;
        }

        // Fallback: global controller MIDI output
        if (window.meisterController && window.meisterController.midiOutput) {
            return window.meisterController.midiOutput;
        }

        return null;
    }
}

// Make available globally
window.FireOLEDAdapter = FireOLEDAdapter;
