/**
 * Trigger Pad Component
 * Square button pad for transport and control functions
 */

class TriggerPad extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.isPressed = false;
    }

    static get observedAttributes() {
        return ['label', 'note', 'sysex', 'active'];
    }

    connectedCallback() {
        this.render();
        this.setupEventListeners();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue !== newValue && name === 'active') {
            this.updateActive();
        }
    }

    render() {
        const label = this.getAttribute('label') || 'PAD';
        const note = this.getAttribute('note') || '';
        const active = this.hasAttribute('active');

        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: block;
                    aspect-ratio: 1;
                    user-select: none;
                    -webkit-user-select: none;
                    touch-action: none;
                }

                .trigger-pad {
                    width: 100%;
                    height: 100%;
                    background: #2a2a2a;
                    border: 2px solid #3a3a3a;
                    border-radius: 4px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    transition: all 0.1s;
                    padding: 8px;
                    box-sizing: border-box;
                }

                .trigger-pad:hover {
                    border-color: #0066FF;
                    background: #333;
                }

                .trigger-pad.active {
                    background: #CF1A37;
                    border-color: #ff3333;
                    transform: scale(0.95);
                }

                .trigger-pad:active {
                    transform: scale(0.9);
                }

                .trigger-pad-label {
                    font-size: 14px;
                    font-weight: bold;
                    text-transform: uppercase;
                    color: #ffffff;
                    margin-bottom: 4px;
                    text-align: center;
                }

                .trigger-pad-note {
                    font-size: 9px;
                    opacity: 0.7;
                    color: #aaa;
                }
            </style>

            <div class="trigger-pad${active ? ' active' : ''}">
                <div class="trigger-pad-label">${label}</div>
                ${note ? `<div class="trigger-pad-note">${note}</div>` : ''}
            </div>
        `;
    }

    updateActive() {
        const pad = this.shadowRoot.querySelector('.trigger-pad');
        if (pad) {
            const active = this.hasAttribute('active');
            if (active) {
                pad.classList.add('active');
            } else {
                pad.classList.remove('active');
            }
        }
    }

    setupEventListeners() {
        const pad = this.shadowRoot.querySelector('.trigger-pad');

        const handlePress = () => {
            if (this.isPressed) return;
            this.isPressed = true;

            // Visual feedback
            this.setAttribute('active', '');

            // Dispatch custom event
            const sysex = this.getAttribute('sysex');
            const note = this.getAttribute('note');

            this.dispatchEvent(new CustomEvent('pad-trigger', {
                detail: { sysex, note, pressed: true },
                bubbles: true,
                composed: true
            }));
        };

        const handleRelease = () => {
            if (!this.isPressed) return;
            this.isPressed = false;

            // Remove visual feedback
            this.removeAttribute('active');

            // Dispatch release event
            const sysex = this.getAttribute('sysex');
            const note = this.getAttribute('note');

            this.dispatchEvent(new CustomEvent('pad-trigger', {
                detail: { sysex, note, pressed: false },
                bubbles: true,
                composed: true
            }));
        };

        // Mouse events
        pad.addEventListener('mousedown', handlePress);
        document.addEventListener('mouseup', handleRelease);

        // Touch events
        pad.addEventListener('touchstart', (e) => {
            e.preventDefault();
            handlePress();
        }, { passive: false });

        document.addEventListener('touchend', handleRelease);
        document.addEventListener('touchcancel', handleRelease);
    }
}

customElements.define('trigger-pad', TriggerPad);
