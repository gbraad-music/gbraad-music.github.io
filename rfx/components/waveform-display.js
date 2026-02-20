/**
 * Waveform Display - Canvas Renderer for Web (WASM-Backed)
 * Uses shared C code from /common/audio_viz/waveform.h via WASM
 *
 * This is a THIN RENDERING LAYER - ring buffer logic is in shared C code:
 * - Ring buffer management (tested in VST3/Rack)
 * - Zoom and pan state (tested in VST3/Rack)
 * - Sample storage (tested in VST3/Rack)
 *
 * Canvas rendering ONLY - REGROOVE branding preserved exactly.
 *
 * Usage:
 *   const waveform = new WaveformDisplayCanvas('visualizer-canvas');
 *   await waveform.init(); // Load WASM
 *
 *   // Option 1: Direct oscilloscope mode (analyser data)
 *   waveform.draw(analyserDataArray);
 *
 *   // Option 2: Buffered mode (uses WASM ring buffer)
 *   waveform.writeAudio(leftSample, rightSample);
 *   waveform.drawBuffer();
 *
 * Copyright (C) 2025
 * SPDX-License-Identifier: ISC
 */

class WaveformDisplayCanvas {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            throw new Error(`Canvas element '${canvasId}' not found`);
        }

        this.ctx = this.canvas.getContext('2d');
        this.Module = null;
        this.waveformPtr = null;
        this.isReady = false;
        this.animationId = null;
        this.isAnimating = false;
    }

    /**
     * Initialize WASM module and create waveform buffer
     * MUST be called before use
     */
    async init(bufferSize = 4800, channelMode = null, sampleRate = 48000) {
        // Dynamically import WASM module
        const AudioVizModule = (await import('../external/audio-viz.js')).default;
        this.Module = await AudioVizModule();

        // Get channel mode enum (default to MONO)
        const mode = channelMode !== null ? channelMode : this.Module._get_waveform_channel_mono();

        // Create waveform buffer instance using shared C code
        this.waveformPtr = this.Module._waveform_create(bufferSize, mode, sampleRate);

        if (!this.waveformPtr) {
            throw new Error('Failed to create waveform WASM instance');
        }

        this.isReady = true;
        console.log('[Waveform] Initialized with WASM - testing shared C code!');
    }

    /**
     * Write audio sample to WASM ring buffer (for buffered mode)
     * Calls shared C code for buffer management
     */
    writeAudio(leftSample, rightSample = null) {
        if (!this.isReady || !this.waveformPtr) return;

        if (rightSample !== null) {
            // Stereo
            this.Module._waveform_write_stereo_sample(this.waveformPtr, leftSample, rightSample);
        } else {
            // Mono
            this.Module._waveform_write_mono_sample(this.waveformPtr, leftSample);
        }
    }

    /**
     * Draw waveform from analyser data (oscilloscope mode)
     * Direct rendering without WASM buffer - for real-time scope
     * @param {Uint8Array|Float32Array} dataArray - Time domain data from analyser
     */
    draw(dataArray) {
        const ctx = this.ctx;
        const canvas = this.canvas;

        // Auto-resize canvas to match container
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;

        const bufferLength = dataArray.length;

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

    /**
     * Draw waveform from WASM ring buffer (buffered mode)
     * Gets buffer data from shared C code
     */
    drawBuffer() {
        if (!this.isReady || !this.waveformPtr) return;

        const ctx = this.ctx;
        const canvas = this.canvas;

        // Auto-resize canvas
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;

        // Get buffer data from WASM
        const bufferSize = this.Module._waveform_get_buffer_size(this.waveformPtr);
        const bufferPtr = this.Module._waveform_get_buffer_left(this.waveformPtr);

        if (!bufferPtr || bufferSize === 0) return;

        // Read buffer from WASM memory
        const buffer = new Float32Array(
            this.Module.HEAPF32.buffer,
            bufferPtr,
            bufferSize
        );

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

        const sliceWidth = canvas.width / bufferSize;
        let x = 0;

        for (let i = 0; i < bufferSize; i++) {
            const sample = buffer[i];
            const y = canvas.height / 2 - (sample * canvas.height / 2);

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }

            x += sliceWidth;
        }

        ctx.stroke();
    }

    /**
     * Start continuous animation loop (oscilloscope mode)
     * @param {Function} getDataCallback - Function that returns analyser data array
     */
    startAnimation(getDataCallback) {
        if (this.isAnimating) return;

        this.isAnimating = true;

        const animate = () => {
            if (!this.isAnimating) return;

            this.animationId = requestAnimationFrame(animate);

            const dataArray = getDataCallback();
            if (dataArray) {
                this.draw(dataArray);
            }
        };

        animate();
    }

    /**
     * Stop animation loop
     */
    stopAnimation() {
        this.isAnimating = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    /**
     * Clear WASM buffer
     */
    clear() {
        if (!this.isReady || !this.waveformPtr) return;
        this.Module._waveform_clear_wasm(this.waveformPtr);
    }

    /**
     * Destroy WASM instance
     */
    destroy() {
        if (this.waveformPtr) {
            this.Module._waveform_destroy_wasm(this.waveformPtr);
            this.waveformPtr = null;
        }
        this.isReady = false;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WaveformDisplayCanvas;
}
