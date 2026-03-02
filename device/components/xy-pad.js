/**
 * XY Pad Component
 * Two-dimensional control pad for X/Y CC parameters
 */

class XYPad extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.isDragging = false;
    }

    static get observedAttributes() {
        return ['label', 'x-cc', 'y-cc', 'x-value', 'y-value'];
    }

    connectedCallback() {
        this.render();
        this.setupEventListeners();
        this.setupFullscreenDetection();
    }

    setupFullscreenDetection() {
        const check = () => {
            const section = this.closest('.section');
            const isFullscreen = section && (
                document.fullscreenElement === section ||
                document.webkitFullscreenElement === section ||
                document.mozFullScreenElement === section
            );
            const isPopout = window.opener !== null;

            if (isFullscreen || isPopout) {
                // Check if there are other controls in the same section
                const hasSelects = section?.querySelector('select[data-cc]') !== null;
                const hasKnobs = section?.querySelectorAll('pad-knob').length > 0;
                const hasCheckboxes = section?.querySelector('input[type="checkbox"][data-cc]') !== null;
                const hasOtherXYPads = section?.querySelectorAll('xy-pad').length > 1;
                const hasOtherControls = hasSelects || hasKnobs || hasCheckboxes || hasOtherXYPads;

                if (isFullscreen) {
                    this.setAttribute('fullscreen', '');
                    this.classList.remove('popout');
                } else {
                    this.classList.add('popout');
                    this.removeAttribute('fullscreen');
                }

                // Add 'solo' class if this is the only control
                if (!hasOtherControls) {
                    this.classList.add('solo');
                } else {
                    this.classList.remove('solo');
                }

                this.style.height = '100%';
            } else {
                this.removeAttribute('fullscreen');
                this.classList.remove('popout');
                this.classList.remove('solo');
                this.style.height = '';
            }
        };

        document.addEventListener('fullscreenchange', check);
        document.addEventListener('webkitfullscreenchange', check);
        document.addEventListener('mozfullscreenchange', check);

        // Check immediately in case we're in a popup
        check();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue !== newValue) {
            if (name === 'x-value' || name === 'y-value') {
                this.updateDotPosition();
            }
        }
    }

    render() {
        const label = this.getAttribute('label') || 'XY';
        const xValue = this.getAttribute('x-value') !== null ? parseInt(this.getAttribute('x-value')) : 64;
        const yValue = this.getAttribute('y-value') !== null ? parseInt(this.getAttribute('y-value')) : 64;

        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: block;
                    width: 100%;
                    user-select: none;
                    -webkit-user-select: none;
                    touch-action: none;
                }

                .xy-container {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    width: 100%;
                }

                .xy-label {
                    font-size: 11px;
                    font-weight: bold;
                    text-transform: uppercase;
                    text-align: center;
                    color: #ffffff;
                    letter-spacing: 1px;
                    flex-shrink: 0;
                }

                .xy-pad {
                    position: relative;
                    width: 100%;
                    aspect-ratio: 4 / 3;
                    background: linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%);
                    border: 2px solid #3a3a3a;
                    border-radius: 4px;
                    cursor: crosshair;
                    overflow: hidden;
                }

                /* When in fullscreen mode or popout, fill available space */
                :host([fullscreen]) .xy-container,
                :host(.popout) .xy-container {
                    height: 100%;
                }

                :host([fullscreen]) .xy-pad,
                :host(.popout) .xy-pad {
                    aspect-ratio: auto;
                    width: 100%;
                    height: calc(100vh - 230px);
                }

                /* When XY-pad is the only control (solo), use more space */
                :host([fullscreen].solo) .xy-pad,
                :host(.popout.solo) .xy-pad {
                    height: calc(100vh - 140px);
                }

                .xy-pad:hover {
                    border-color: #CF1A37;
                }

                .xy-grid {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background-image:
                        linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px),
                        linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px);
                    background-size: 25% 25%;
                    pointer-events: none;
                }

                .xy-crosshair {
                    position: absolute;
                    pointer-events: none;
                }

                .xy-crosshair-h {
                    position: absolute;
                    left: 0;
                    right: 0;
                    height: 1px;
                    background: rgba(207, 26, 55, 0.3);
                }

                .xy-crosshair-v {
                    position: absolute;
                    top: 0;
                    bottom: 0;
                    width: 1px;
                    background: rgba(207, 26, 55, 0.3);
                }

                .xy-dot {
                    position: absolute;
                    width: 16px;
                    height: 16px;
                    background: #CF1A37;
                    border: 2px solid #ffffff;
                    border-radius: 50%;
                    transform: translate(-50%, -50%);
                    pointer-events: none;
                    box-shadow: 0 0 10px rgba(207, 26, 55, 0.5);
                    transition: background 0.1s;
                }

                .xy-pad:active .xy-dot {
                    background: #ff3333;
                    box-shadow: 0 0 15px rgba(255, 51, 51, 0.8);
                }

                .xy-values {
                    display: flex;
                    justify-content: space-between;
                    font-size: 9px;
                    color: #888;
                    padding: 0 4px;
                }

                .xy-value {
                    font-family: monospace;
                }

                .xy-value-label {
                    color: #666;
                    margin-right: 4px;
                }
            </style>

            <div class="xy-container">
                <div class="xy-label">${label}</div>
                <div class="xy-pad" id="pad">
                    <div class="xy-grid"></div>
                    <div class="xy-crosshair">
                        <div class="xy-crosshair-h" id="crosshairH"></div>
                        <div class="xy-crosshair-v" id="crosshairV"></div>
                    </div>
                    <div class="xy-dot" id="dot"></div>
                </div>
                <div class="xy-values">
                    <div><span class="xy-value-label">X:</span><span class="xy-value" id="xValueDisplay">${xValue}</span></div>
                    <div><span class="xy-value-label">Y:</span><span class="xy-value" id="yValueDisplay">${yValue}</span></div>
                </div>
            </div>
        `;

        this.updateDotPosition();
    }

    updateDotPosition() {
        const dot = this.shadowRoot.getElementById('dot');
        const crosshairH = this.shadowRoot.getElementById('crosshairH');
        const crosshairV = this.shadowRoot.getElementById('crosshairV');
        const xValueDisplay = this.shadowRoot.getElementById('xValueDisplay');
        const yValueDisplay = this.shadowRoot.getElementById('yValueDisplay');

        if (!dot) return;

        const xValue = this.getAttribute('x-value') !== null ? parseInt(this.getAttribute('x-value')) : 64;
        const yValue = this.getAttribute('y-value') !== null ? parseInt(this.getAttribute('y-value')) : 64;

        // X: 0 = left (0%), 127 = right (100%)
        // Y: 0 = bottom (100%), 127 = top (0%) - inverted for natural feel
        const xPercent = (xValue / 127) * 100;
        const yPercent = (1 - (yValue / 127)) * 100;

        dot.style.left = `${xPercent}%`;
        dot.style.top = `${yPercent}%`;

        if (crosshairH) crosshairH.style.top = `${yPercent}%`;
        if (crosshairV) crosshairV.style.left = `${xPercent}%`;

        if (xValueDisplay) xValueDisplay.textContent = xValue;
        if (yValueDisplay) yValueDisplay.textContent = yValue;
    }

    setupEventListeners() {
        const pad = this.shadowRoot.getElementById('pad');

        const updateFromPosition = (clientX, clientY) => {
            if (!this.isDragging) return;

            const rect = pad.getBoundingClientRect();

            // Calculate position relative to pad
            let x = clientX - rect.left;
            let y = clientY - rect.top;

            // Clamp to bounds
            x = Math.max(0, Math.min(rect.width, x));
            y = Math.max(0, Math.min(rect.height, y));

            // Convert to MIDI values (0-127)
            const xValue = Math.round((x / rect.width) * 127);
            const yValue = Math.round((1 - (y / rect.height)) * 127); // Inverted Y

            // Clamp MIDI values
            const clampedX = Math.max(0, Math.min(127, xValue));
            const clampedY = Math.max(0, Math.min(127, yValue));

            // Update attributes
            this.setAttribute('x-value', clampedX);
            this.setAttribute('y-value', clampedY);

            // Dispatch events
            const xCC = parseInt(this.getAttribute('x-cc'));
            const yCC = parseInt(this.getAttribute('y-cc'));

            if (!isNaN(xCC)) {
                this.dispatchEvent(new CustomEvent('cc-change', {
                    detail: { cc: xCC, value: clampedX },
                    bubbles: true,
                    composed: true
                }));
            }

            if (!isNaN(yCC)) {
                this.dispatchEvent(new CustomEvent('cc-change', {
                    detail: { cc: yCC, value: clampedY },
                    bubbles: true,
                    composed: true
                }));
            }
        };

        const handleStart = (e) => {
            this.isDragging = true;
            const touch = e.touches ? e.touches[0] : e;
            updateFromPosition(touch.clientX, touch.clientY);
        };

        const handleMove = (e) => {
            if (!this.isDragging) return;
            e.preventDefault();
            const touch = e.touches ? e.touches[0] : e;
            updateFromPosition(touch.clientX, touch.clientY);
        };

        const handleEnd = () => {
            this.isDragging = false;
        };

        // Mouse events
        pad.addEventListener('mousedown', handleStart);
        document.addEventListener('mousemove', handleMove);
        document.addEventListener('mouseup', handleEnd);

        // Touch events
        pad.addEventListener('touchstart', handleStart, { passive: false });
        document.addEventListener('touchmove', handleMove, { passive: false });
        document.addEventListener('touchend', handleEnd);
        document.addEventListener('touchcancel', handleEnd);
    }
}

customElements.define('xy-pad', XYPad);
