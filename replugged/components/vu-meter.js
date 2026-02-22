/**
 * VU Meter - Canvas Renderer for Web (WASM-Backed)
 * Uses shared C code from /common/audio_viz/vu_meter.h via WASM
 *
 * This is a THIN RENDERING LAYER - all DSP logic is in the shared C code:
 * - Peak hold and decay (tested in VST3/Rack)
 * - dB conversion (tested in VST3/Rack)
 * - Ballistics and smoothing (tested in VST3/Rack)
 *
 * Canvas rendering ONLY - REGROOVE branding preserved exactly.
 *
 * Usage:
 *   const vuMeter = new VUMeterCanvas('vumeter-canvas');
 *   await vuMeter.init(); // Load WASM
 *
 *   // In audio callback:
 *   vuMeter.update(leftPeak, rightPeak);
 *
 *   // In animation loop:
 *   vuMeter.draw();
 *
 * Copyright (C) 2025
 * SPDX-License-Identifier: ISC
 */

class VUMeterCanvas {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            throw new Error(`Canvas element '${canvasId}' not found`);
        }

        this.ctx = this.canvas.getContext('2d');
        this.Module = null;
        this.vuPtr = null;
        this.isReady = false;
        this.lastUpdateTime = performance.now();
    }

    /**
     * Initialize WASM module and create VU meter instance
     * MUST be called before use
     */
    async init(sampleRate = 48000, mode = null) {
        // Dynamically import WASM module
        const AudioVizModule = (await import('../external/audio-viz.js')).default;
        this.Module = await AudioVizModule();

        // Get mode enum (default to VU_MODE_PEAK)
        const vuMode = mode !== null ? mode : this.Module._get_vu_meter_mode_peak();

        // Create VU meter instance using shared C code
        this.vuPtr = this.Module._vu_meter_create(sampleRate, vuMode);

        if (!this.vuPtr) {
            throw new Error('Failed to create VU meter WASM instance');
        }

        this.isReady = true;
        console.log('[VUMeter] Initialized with WASM - testing shared C code!');
    }

    /**
     * Update VU meter with new peak values
     * Calls shared C code for DSP processing
     * @param {number} leftPeak - Left channel peak (0.0-1.0)
     * @param {number} rightPeak - Right channel peak (0.0-1.0)
     */
    update(leftPeak, rightPeak) {
        if (!this.isReady || !this.vuPtr) {
            console.warn('[VUMeter] update() called but not ready:', { isReady: this.isReady, vuPtr: this.vuPtr });
            return;
        }

        // Calculate time delta since last update
        const now = performance.now();
        const timeDeltaMs = now - this.lastUpdateTime;
        this.lastUpdateTime = now;

        // Call WASM function with peak values and time delta
        // This properly handles frame-rate updates with correct decay
        this.Module._vu_meter_update_peaks(this.vuPtr, leftPeak, rightPeak, timeDeltaMs);
    }

    /**
     * Draw the VU meter - Canvas rendering ONLY
     * Gets processed values from WASM (shared C code)
     */
    draw() {
        if (!this.isReady || !this.vuPtr) return;

        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        // Get dB values from shared C code
        const leftDb = this.Module._vu_meter_get_peak_left_db(this.vuPtr);
        const rightDb = this.Module._vu_meter_get_peak_right_db(this.vuPtr);

        // Convert dB to needle position (0.0 - 1.0)
        // Map -20dB to 0.0 (bottom), 0dBFS to 1.0 (top/RED)
        const dbToNeedle = (db) => Math.max(0, Math.min(1, (db + 20) / 20));
        const leftNeedle = dbToNeedle(leftDb);
        const rightNeedle = dbToNeedle(rightDb);

        // ===== CANVAS RENDERING (preserved from original) =====

        // Clear canvas
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, width, height);

        // Dimensions
        const pivotY = height / 2;
        const arcRadius = Math.min(width * 0.45, height * 0.6);
        const needleLength = arcRadius * 0.85;

        // ===== LEFT METER (pivot on left edge) =====
        const leftPivotX = width * 0.05;

        // Draw left arc scale
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(leftPivotX, pivotY, arcRadius, Math.PI / 2, -Math.PI / 2, true);
        ctx.stroke();

        // Scale marks for left
        ctx.lineWidth = 1.5;
        for (let i = 0; i <= 10; i++) {
            const angle = Math.PI / 2 - (Math.PI * i / 10);
            const x1 = leftPivotX + arcRadius * Math.cos(angle);
            const y1 = pivotY + arcRadius * Math.sin(angle);
            const x2 = leftPivotX + (arcRadius - 8) * Math.cos(angle);
            const y2 = pivotY + (arcRadius - 8) * Math.sin(angle);

            // Red zone for top ticks - REGROOVE RED
            ctx.strokeStyle = i >= 8 ? '#CF1A37' : '#666';

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        }

        // LEFT needle
        const leftAngle = Math.PI / 2 - leftNeedle * Math.PI;
        ctx.save();
        ctx.translate(leftPivotX, pivotY);
        ctx.rotate(leftAngle);

        // Needle shadow
        ctx.strokeStyle = 'rgba(207, 26, 55, 0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(needleLength, 0);
        ctx.stroke();

        // Needle - REGROOVE RED
        ctx.strokeStyle = '#CF1A37';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(needleLength, 0);
        ctx.stroke();

        // Needle tip
        ctx.fillStyle = '#CF1A37';
        ctx.beginPath();
        ctx.arc(needleLength, 0, 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

        // Pivot point
        ctx.fillStyle = '#666';
        ctx.beginPath();
        ctx.arc(leftPivotX, pivotY, 6, 0, Math.PI * 2);
        ctx.fill();

        // ===== RIGHT METER (pivot on right edge) =====
        const rightPivotX = width * 0.95;

        // Draw right arc scale
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(rightPivotX, pivotY, arcRadius, Math.PI / 2, Math.PI * 3 / 2);
        ctx.stroke();

        // Scale marks for right
        ctx.lineWidth = 1.5;
        for (let i = 0; i <= 10; i++) {
            const angle = Math.PI / 2 + (Math.PI * i / 10);
            const x1 = rightPivotX + arcRadius * Math.cos(angle);
            const y1 = pivotY + arcRadius * Math.sin(angle);
            const x2 = rightPivotX + (arcRadius - 8) * Math.cos(angle);
            const y2 = pivotY + (arcRadius - 8) * Math.sin(angle);

            // Red zone for top ticks - REGROOVE RED
            ctx.strokeStyle = i >= 8 ? '#CF1A37' : '#666';

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        }

        // RIGHT needle
        const rightAngle = Math.PI / 2 + rightNeedle * Math.PI;
        ctx.save();
        ctx.translate(rightPivotX, pivotY);
        ctx.rotate(rightAngle);

        // Needle shadow
        ctx.strokeStyle = 'rgba(207, 26, 55, 0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(needleLength, 0);
        ctx.stroke();

        // Needle - REGROOVE RED
        ctx.strokeStyle = '#CF1A37';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(needleLength, 0);
        ctx.stroke();

        // Needle tip
        ctx.fillStyle = '#CF1A37';
        ctx.beginPath();
        ctx.arc(needleLength, 0, 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

        // Pivot point
        ctx.fillStyle = '#666';
        ctx.beginPath();
        ctx.arc(rightPivotX, pivotY, 6, 0, Math.PI * 2);
        ctx.fill();
    }

    /**
     * Reset meter state (calls shared C code)
     */
    reset() {
        if (!this.isReady || !this.vuPtr) return;
        this.Module._vu_meter_reset_peaks(this.vuPtr);
    }

    /**
     * Destroy WASM instance
     */
    destroy() {
        if (this.vuPtr) {
            this.Module._vu_meter_destroy_wasm(this.vuPtr);
            this.vuPtr = null;
        }
        this.isReady = false;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = VUMeterCanvas;
}
