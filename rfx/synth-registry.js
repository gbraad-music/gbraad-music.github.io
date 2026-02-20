/**
 * Synth Registry - Auto-discovery and management system for web synths
 * Inspired by LV2 plugin architecture
 */

class SynthRegistry {
    static synths = new Map();
    static engineIdMap = new Map(); // Map engine ID to synth ID

    /**
     * Register a synth with metadata
     * @param {Object} descriptor - Synth descriptor
     * @param {string} descriptor.id - Unique synth ID (e.g., 'rgsid')
     * @param {string} descriptor.name - Short name (e.g., 'RGSID')
     * @param {string} descriptor.displayName - Full display name
     * @param {string} descriptor.description - Description
     * @param {number} descriptor.engineId - WASM engine ID
     * @param {Class} descriptor.class - Synth class constructor
     * @param {Object} descriptor.wasmFiles - WASM file paths
     * @param {string} descriptor.category - Category (synthesizer, sampler, etc.)
     * @param {Function} descriptor.getParameterInfo - Function returning parameter metadata
     */
    static register(descriptor) {
        if (!descriptor.id) {
            throw new Error('Synth descriptor must have an id');
        }
        if (this.synths.has(descriptor.id)) {
            console.warn(`[SynthRegistry] Synth '${descriptor.id}' already registered, overwriting`);
        }

        // Validate required fields
        const required = ['name', 'displayName', 'engineId', 'class'];
        for (const field of required) {
            if (!(field in descriptor)) {
                throw new Error(`Synth descriptor '${descriptor.id}' missing required field: ${field}`);
            }
        }

        this.synths.set(descriptor.id, descriptor);
        this.engineIdMap.set(descriptor.engineId, descriptor.id);

        console.log(`[SynthRegistry] Registered synth: ${descriptor.id} (engine ${descriptor.engineId})`);
    }

    /**
     * Get synth descriptor by ID
     */
    static get(id) {
        return this.synths.get(id);
    }

    /**
     * Get synth descriptor by engine ID
     */
    static getByEngineId(engineId) {
        const id = this.engineIdMap.get(engineId);
        return id ? this.synths.get(id) : null;
    }

    /**
     * Get all registered synths
     */
    static getAll() {
        return Array.from(this.synths.values());
    }

    /**
     * Get synths by category
     */
    static getByCategory(category) {
        return this.getAll().filter(s => s.category === category);
    }

    /**
     * Check if synth is registered
     */
    static has(id) {
        return this.synths.has(id);
    }

    /**
     * Unregister a synth
     */
    static unregister(id) {
        const descriptor = this.synths.get(id);
        if (descriptor) {
            this.engineIdMap.delete(descriptor.engineId);
            this.synths.delete(id);
            console.log(`[SynthRegistry] Unregistered synth: ${id}`);
        }
    }

    /**
     * Clear all registered synths
     */
    static clear() {
        this.synths.clear();
        this.engineIdMap.clear();
    }

    /**
     * Get a list of synth IDs
     */
    static getIds() {
        return Array.from(this.synths.keys());
    }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SynthRegistry;
}
