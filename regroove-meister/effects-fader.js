/**
 * Effects Fader Component
 * Vertical slider for effects parameters with reset button
 * Matches tempo-fader structure exactly
 */

import './fader-components.js';

// Get BaseFader from fader-components
const BaseFader = customElements.get('tempo-fader').__proto__;

class EffectsFader extends BaseFader {
    constructor() {
        super();
        this.render();
    }

    static get observedAttributes() {
        return ['label', 'value', 'min', 'max', 'default'];
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue === newValue) return;

        // Only re-render if structure changes (label, min, max, default)
        // For value changes, just update the slider without re-rendering
        if (name === 'value') {
            const slider = this.shadowRoot?.getElementById('param-slider');
            if (slider) {
                slider.setAttribute('value', newValue);
            }
        } else {
            this.render();
        }
    }

    render() {
        const label = this.getAttribute('label') || '';
        const value = parseInt(this.getAttribute('value') || '64');
        const min = parseInt(this.getAttribute('min') || '0');
        const max = parseInt(this.getAttribute('max') || '127');
        const defaultValue = parseInt(this.getAttribute('default') || '64');

        // Simplified structure without panning controls
        this.shadowRoot.innerHTML = `
            <style>${this.getBaseStyles()}</style>
            <div class="fader-label">${label}</div>
            <div class="slider-container">
                <svg-slider id="param-slider" min="${min}" max="${max}" value="${value}" width="60"></svg-slider>
            </div>
            <button class="fader-button" id="reset-btn">R</button>
        `;

        this.setupEventListeners(defaultValue);
    }

    setupEventListeners(defaultValue) {
        const slider = this.shadowRoot.getElementById('param-slider');
        const resetBtn = this.shadowRoot.getElementById('reset-btn');

        slider?.addEventListener('input', (e) => {
            const value = e.detail?.value ?? e.target?.value;
            this.setAttribute('value', value);

            // Mark that we're actively changing the parameter
            this.dataset.paramChanging = 'true';
            clearTimeout(this._paramChangeTimeout);
            this._paramChangeTimeout = setTimeout(() => {
                delete this.dataset.paramChanging;
            }, 300); // 300ms debounce to prevent state updates during drag

            this.dispatchEvent(new CustomEvent('change', {
                detail: { value: parseInt(value) },
                bubbles: true,
                composed: true
            }));
        });

        resetBtn?.addEventListener('click', () => {
            this.setAttribute('value', defaultValue);
            this.dispatchEvent(new CustomEvent('reset', {
                detail: { value: defaultValue },
                bubbles: true,
                composed: true
            }));
        });
    }
}

// Register custom element
customElements.define('effects-fader', EffectsFader);

export default EffectsFader;
