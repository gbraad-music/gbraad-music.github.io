// Generic Synth UI Base - Parameter Sync Functionality
// Use this in any synth UI component to enable knob sync

export function setupParameterSync(component, paramMapping) {
    /**
     * Setup bidirectional parameter sync between custom UI and dynamic knobs
     *
     * @param {HTMLElement} component - The custom element (this)
     * @param {Object} paramMapping - Map of parameter indices to names
     *   Example: { 13: 'cutoff', 14: 'resonance', 16: 'attack' }
     */

    // Listen for parameter changes from external knobs
    const paramChangeHandler = (e) => {
        // Ignore events we emit ourselves
        if (e.detail.source === 'ui') return;

        const { paramName, value } = e.detail;

        // Find the parameter index for this name
        const paramIndex = Object.keys(paramMapping).find(
            key => paramMapping[key] === paramName
        );

        if (paramIndex) {
            // Call the component's update method
            if (component.updateParameter) {
                component.updateParameter(parseInt(paramIndex), value);
            }
        }
    };

    // Store handler so it can be cleaned up
    component._paramChangeHandler = paramChangeHandler;
    window.addEventListener('rfx:paramChanged', paramChangeHandler);
}

export function cleanupParameterSync(component) {
    /**
     * Remove parameter sync event listeners
     * Call this in disconnectedCallback()
     */
    if (component._paramChangeHandler) {
        window.removeEventListener('rfx:paramChanged', component._paramChangeHandler);
        component._paramChangeHandler = null;
    }
}

export function emitParameterChange(paramIndex, paramName, value) {
    /**
     * Emit parameter change event to sync with knobs
     * Call this whenever a UI control changes a parameter
     */
    window.dispatchEvent(new CustomEvent('rfx:paramChanged', {
        detail: { paramName, value, source: 'ui' }
    }));
}
