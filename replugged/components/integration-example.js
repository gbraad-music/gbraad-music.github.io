/**
 * Integration Example - Using EXTRACTED Visualization Components
 *
 * These components are EXTRACTED from the existing effects.js code, preserving
 * all the working visual details, smoothing constants, and REGROOVE branding.
 *
 * To use:
 * 1. Include components in your HTML:
 *    <script src="components/vu-meter.js"></script>
 *    <script src="components/waveform-display.js"></script>
 *    <script src="components/spectrum-analyzer.js"></script>
 *
 * 2. Replace inline function calls with component instances
 *
 * Copyright (C) 2025
 * SPDX-License-Identifier: ISC
 */

// ============================================================================
// Initialize Visualization Components
// ============================================================================

let vuMeterComponent = null;
let waveformComponent = null;
let spectrumComponent = null;

function initializeVisualizationComponents() {
    // VU Meter - analog needle style (EXTRACTED from effects.js drawVUMeter)
    const vuCanvas = document.getElementById('vumeter');
    if (vuCanvas) {
        vuMeterComponent = new VUMeterCanvas('vumeter');
        // All REGROOVE branding and smoothing constants preserved from original
    }

    // Waveform Display - oscilloscope style (EXTRACTED from effects.js drawVisualizer)
    const waveformCanvas = document.getElementById('visualizer');
    if (waveformCanvas) {
        waveformComponent = new WaveformDisplayCanvas('visualizer');
        // REGROOVE red (#CF1A37) and grid preserved from original
    }

    // Spectrum Analyzer (EXTRACTED from effects.js drawSpectrum)
    const spectrumCanvas = document.getElementById('spectrum');
    if (spectrumCanvas) {
        spectrumComponent = new SpectrumAnalyzerCanvas('spectrum');
        // REGROOVE red bars preserved from original
    }
}

// Call this when page loads
// initializeVisualizationComponents();

// ============================================================================
// Integration with Existing effects.js Code
// ============================================================================

/**
 * BEFORE (old code in effects.js lines 1518-1691):
 *
 * function drawVUMeter() {
 *     const canvas = document.getElementById('vumeter');
 *     if (!canvas) return;
 *     const ctx = canvas.getContext('2d');
 *     const leftPeak = processor.stereoPeaks.left;
 *     const rightPeak = processor.stereoPeaks.right;
 *     // ... 173 lines of drawing code
 * }
 */

/**
 * AFTER (using extracted component):
 */
function drawVUMeter() {
    if (!vuMeterComponent) return;

    // Get peaks from processor (existing code)
    const leftPeak = processor.stereoPeaks.left;
    const rightPeak = processor.stereoPeaks.right;

    // Update and draw - that's it!
    vuMeterComponent.update(leftPeak, rightPeak);
    vuMeterComponent.draw();
}

/**
 * BEFORE (old code in effects.js lines 1714-1789):
 *
 * function drawVisualizer() {
 *     const canvas = document.getElementById('visualizer');
 *     const ctx = canvas.getContext('2d');
 *     canvas.width = canvas.offsetWidth;
 *     canvas.height = canvas.offsetHeight;
 *
 *     const draw = () => {
 *         visualizerAnimationId = requestAnimationFrame(draw);
 *         const dataArray = processor.getAnalyserData();
 *         // ... drawing code
 *     };
 *     draw();
 * }
 */

/**
 * AFTER (using extracted component):
 */
function drawVisualizer() {
    if (!waveformComponent) return;

    // Start animation loop with data callback
    waveformComponent.startAnimation(() => processor.getAnalyserData());

    // Or if you want manual control:
    // const dataArray = processor.getAnalyserData();
    // waveformComponent.draw(dataArray);
}

/**
 * BEFORE (old code in effects.js lines 1490-1516):
 *
 * function drawSpectrum() {
 *     const canvas = document.getElementById('spectrum');
 *     if (!canvas) return;
 *     const ctx = canvas.getContext('2d');
 *     const bufferLength = processor.analyser.frequencyBinCount;
 *     // ... drawing code
 * }
 */

/**
 * AFTER (using extracted component):
 */
function drawSpectrum() {
    if (!spectrumComponent) return;

    // Pass analyser directly
    spectrumComponent.draw(processor.analyser);

    // Or start continuous animation:
    // spectrumComponent.startAnimation(processor.analyser);
}

// ============================================================================
// Full Example with AudioWorklet
// ============================================================================

/**
 * Complete integration example showing how components work with
 * existing AudioEffectsProcessor from effects.js
 */
function setupVisualizationWithProcessor(processor) {
    // Initialize components
    const vuMeter = new VUMeterCanvas('vumeter');
    const waveform = new WaveformDisplayCanvas('visualizer');
    const spectrum = new SpectrumAnalyzerCanvas('spectrum');

    // Animation loop (replaces the inline draw() function)
    function animate() {
        requestAnimationFrame(animate);

        // Update VU meter with stereo peaks from processor
        vuMeter.update(processor.stereoPeaks.left, processor.stereoPeaks.right);
        vuMeter.draw();

        // Update waveform with analyser data
        const dataArray = processor.getAnalyserData();
        if (dataArray) {
            waveform.draw(dataArray);
        }

        // Update spectrum
        if (processor.analyser) {
            spectrum.draw(processor.analyser);
        }
    }

    animate();
}

// ============================================================================
// Canvas Resize Helper
// ============================================================================

/**
 * Helper to resize canvases when window resizes or fullscreen changes
 * Note: Waveform component auto-resizes on each draw, but VU meter and
 * spectrum may need manual resize events.
 */
function resizeCanvases() {
    // VU Meter
    const vuCanvas = document.getElementById('vumeter');
    if (vuCanvas) {
        vuCanvas.width = vuCanvas.offsetWidth;
        vuCanvas.height = vuCanvas.offsetHeight;
    }

    // Spectrum
    const spectrumCanvas = document.getElementById('spectrum');
    if (spectrumCanvas) {
        spectrumCanvas.width = spectrumCanvas.offsetWidth;
        spectrumCanvas.height = spectrumCanvas.offsetHeight;
    }

    // Visualizer auto-resizes on draw
}

// Listen for resize events
window.addEventListener('resize', resizeCanvases);

// Listen for fullscreen changes
document.addEventListener('fullscreenchange', () => {
    setTimeout(resizeCanvases, 100);  // Small delay for browser to settle
});

// ============================================================================
// Benefits of Using EXTRACTED Components
// ============================================================================

/*
✅ **100% Identical Visuals**: Exact same rendering as existing code
✅ **Proven Code**: Uses battle-tested implementation from effects.js
✅ **Less Code**: Function calls are now 2-3 lines instead of 100+
✅ **Reusable**: Same components work across multiple projects
✅ **REGROOVE Branding**: All signature red (#CF1A37) preserved
✅ **Same Constants**: VU_SMOOTHING (0.7), VU_DECAY_RATE (0.95), etc.
✅ **Same Visual Details**: Arc radii, needle shadows, pivot points, grid style

Code reduction:
- Old drawVUMeter(): 173 lines
- New drawVUMeter(): 4 lines (using extracted component class)

- Old drawVisualizer(): ~75 lines
- New drawVisualizer(): 1-2 lines

- Old drawSpectrum(): ~26 lines
- New drawSpectrum(): 1-2 lines
*/
