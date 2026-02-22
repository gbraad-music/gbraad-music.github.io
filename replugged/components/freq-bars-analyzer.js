/**
 * Frequency Bars Analyzer - Canvas Renderer for Web
 * Displays Bass, Mid, High frequency bands as vertical bars
 *
 * Converted from DIV-based implementation to canvas for PIP support
 *
 * Usage:
 *   const freqBars = new FrequencyBarsCanvas('freq-viz-canvas');
 *
 *   // Update with frequency bands (0-1 normalized)
 *   freqBars.draw({ bass: 0.5, mid: 0.7, high: 0.3 });
 *
 * Copyright (C) 2025
 * SPDX-License-Identifier: ISC
 */

class FrequencyBarsCanvas {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            throw new Error(`Canvas element '${canvasId}' not found`);
        }

        this.ctx = this.canvas.getContext('2d');
        this.animationId = null;
        this.isAnimating = false;

        // Store last bands for animation loop
        this.lastBands = { bass: 0, mid: 0, high: 0 };

        // Smoothing - interpolate towards target values (mimics CSS transition: 0.1s)
        this.currentBands = { bass: 0, mid: 0, high: 0 };
        this.targetBands = { bass: 0, mid: 0, high: 0 };
        this.smoothingFactor = 0.15; // Smoother decay (lower = more gradual)
    }

    /**
     * Draw frequency bars - matches original DIV-based styling
     * @param {Object} bands - Frequency bands { bass: 0-1, mid: 0-1, high: 0-1 }
     */
    draw(bands) {
        if (!bands) return;

        this.lastBands = bands;

        // Update target bands (what we're smoothing towards)
        this.targetBands = { ...bands };

        // Interpolate current towards target (mimics CSS transition)
        this.currentBands.bass += (this.targetBands.bass - this.currentBands.bass) * this.smoothingFactor;
        this.currentBands.mid += (this.targetBands.mid - this.currentBands.mid) * this.smoothingFactor;
        this.currentBands.high += (this.targetBands.high - this.currentBands.high) * this.smoothingFactor;

        const ctx = this.ctx;
        const canvas = this.canvas;

        // Background matching other scopes (pure black)
        ctx.fillStyle = "#0a0a0a";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Padding around bars (matching original 10px padding)
        const padding = 10;
        const innerWidth = canvas.width - padding * 2;
        const innerHeight = canvas.height - padding * 2;

        // Reserve space for labels at bottom
        const labelHeight = 20;
        const barAreaHeight = innerHeight - labelHeight;

        const barGap = 10;
        const barWidth = (innerWidth - barGap * 2) / 3;
        const barX = [
            padding + barGap / 2,
            padding + barWidth + barGap * 1.5,
            padding + barWidth * 2 + barGap * 2.5
        ];

        // Draw bars with rounded corners
        const drawRoundedBar = (x, height, gradient) => {
            const y = padding + barAreaHeight - height;
            const cornerRadius = 2;

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.moveTo(x + cornerRadius, y);
            ctx.lineTo(x + barWidth - cornerRadius, y);
            ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + cornerRadius);
            ctx.lineTo(x + barWidth, padding + barAreaHeight - cornerRadius);
            ctx.quadraticCurveTo(x + barWidth, padding + barAreaHeight, x + barWidth - cornerRadius, padding + barAreaHeight);
            ctx.lineTo(x + cornerRadius, padding + barAreaHeight);
            ctx.quadraticCurveTo(x, padding + barAreaHeight, x, padding + barAreaHeight - cornerRadius);
            ctx.lineTo(x, y + cornerRadius);
            ctx.quadraticCurveTo(x, y, x + cornerRadius, y);
            ctx.closePath();
            ctx.fill();
        };

        // Bass bar (use smoothed currentBands, not raw bands)
        const bassHeight = Math.max(2, this.currentBands.bass * barAreaHeight); // min-height 2px
        const gradient1 = ctx.createLinearGradient(0, padding + barAreaHeight, 0, padding + barAreaHeight - bassHeight);
        gradient1.addColorStop(0, '#CF1A37');
        gradient1.addColorStop(1, '#ff3333');
        drawRoundedBar(barX[0], bassHeight, gradient1);

        // Mid bar (use smoothed currentBands, not raw bands)
        const midHeight = Math.max(2, this.currentBands.mid * barAreaHeight); // min-height 2px
        const gradient2 = ctx.createLinearGradient(0, padding + barAreaHeight, 0, padding + barAreaHeight - midHeight);
        gradient2.addColorStop(0, '#CF1A37');
        gradient2.addColorStop(1, '#ff3333');
        drawRoundedBar(barX[1], midHeight, gradient2);

        // High bar (use smoothed currentBands, not raw bands)
        const highHeight = Math.max(2, this.currentBands.high * barAreaHeight); // min-height 2px
        const gradient3 = ctx.createLinearGradient(0, padding + barAreaHeight, 0, padding + barAreaHeight - highHeight);
        gradient3.addColorStop(0, '#CF1A37');
        gradient3.addColorStop(1, '#ff3333');
        drawRoundedBar(barX[2], highHeight, gradient3);

        // Labels below bars (matching original position)
        ctx.fillStyle = '#666';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        const labelY = padding + barAreaHeight + labelHeight / 2 + 3;
        ctx.fillText('Bass', barX[0] + barWidth / 2, labelY);
        ctx.fillText('Mid', barX[1] + barWidth / 2, labelY);
        ctx.fillText('High', barX[2] + barWidth / 2, labelY);
    }

    /**
     * Start continuous animation loop
     * @param {Function} getBandsCallback - Function that returns { bass, mid, high }
     */
    startAnimation(getBandsCallback) {
        if (this.isAnimating) return;

        this.isAnimating = true;

        const animate = () => {
            if (!this.isAnimating) return;

            this.animationId = requestAnimationFrame(animate);
            const bands = getBandsCallback();
            if (bands) {
                this.draw(bands);
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
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FrequencyBarsCanvas;
}
