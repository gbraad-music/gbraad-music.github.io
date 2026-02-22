/**
 * Spectrum Analyzer - Canvas Renderer for Web
 * EXTRACTED from effects.js - Preserves existing working implementation
 *
 * This wraps the existing drawSpectrum() function into a reusable component class.
 * All visual details and REGROOVE branding preserved exactly.
 *
 * Usage:
 *   const spectrum = new SpectrumAnalyzerCanvas('spectrum-canvas');
 *
 *   // Get frequency data from your analyser
 *   const analyser = audioContext.createAnalyser();
 *   spectrum.draw(analyser);
 *
 * Copyright (C) 2025
 * SPDX-License-Identifier: ISC
 */

class SpectrumAnalyzerCanvas {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            throw new Error(`Canvas element '${canvasId}' not found`);
        }

        this.ctx = this.canvas.getContext('2d');
        this.animationId = null;
        this.isAnimating = false;
    }

    /**
     * Draw spectrum from analyser - EXACT code from effects.js lines 1490-1516
     * @param {AnalyserNode} analyser - Web Audio API AnalyserNode
     */
    draw(analyser) {
        const ctx = this.ctx;
        const canvas = this.canvas;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        analyser.getByteFrequencyData(dataArray);

        // Background (lines 1500-1501)
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const barWidth = (canvas.width / bufferLength) * 2.5;
        let barHeight;
        let x = 0;

        // Draw bars - REGROOVE RED (lines 1507-1515)
        for (let i = 0; i < bufferLength; i++) {
            barHeight = (dataArray[i] / 255) * canvas.height;

            // REGROOVE signature red
            ctx.fillStyle = `rgb(207, 26, 55)`;

            ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }
    }

    /**
     * Start continuous animation loop
     * @param {AnalyserNode} analyser - Web Audio API AnalyserNode
     */
    startAnimation(analyser) {
        if (this.isAnimating) return;

        this.isAnimating = true;

        const animate = () => {
            if (!this.isAnimating) return;

            this.animationId = requestAnimationFrame(animate);
            this.draw(analyser);
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
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SpectrumAnalyzerCanvas;
}
