/**
 * Synth Registry - Auto-discovery and management system for web synths
 * Inspired by LV2 plugin architecture
 */

class SynthRegistry {
    static synths = new Map();
    static engineIdMap = new Map(); // Map engine ID to synth ID
    static manifest = null; // Loaded from synth-manifest.json
    static loadedScripts = new Set(); // Track loaded scripts
    static loadingPromises = new Map(); // Track in-progress loads

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

    /**
     * Load synth manifest
     */
    static async loadManifest() {
        if (this.manifest) return this.manifest;

        try {
            const response = await fetch('../replugged/synth-manifest.json');
            this.manifest = await response.json();
            console.log(`[SynthRegistry] Loaded manifest with ${this.manifest.synths.length} synths`);
            return this.manifest;
        } catch (error) {
            console.error('[SynthRegistry] Failed to load manifest:', error);
            throw error;
        }
    }

    /**
     * Dynamically load a synth class by ID
     * @param {string} id - Synth ID (e.g., 'rg909', 'rg1piano')
     * @returns {Promise<Class>} - Synth class constructor
     */
    static async loadSynthClass(id) {
        // Check if already loading
        if (this.loadingPromises.has(id)) {
            return this.loadingPromises.get(id);
        }

        // Load manifest if needed
        if (!this.manifest) {
            await this.loadManifest();
        }

        // Find synth in manifest
        const synthInfo = this.manifest.synths.find(s => s.id === id);
        if (!synthInfo) {
            throw new Error(`Synth '${id}' not found in manifest`);
        }

        // Check if already loaded (check registry instead of window)
        const registered = this.get(id);
        if (registered && registered.class) {
            console.log(`[SynthRegistry] ${synthInfo.className} already loaded`);
            return registered.class;
        }

        // Create loading promise
        const loadPromise = new Promise((resolve, reject) => {
            if (this.loadedScripts.has(synthInfo.script)) {
                // Script loaded, check if registered
                const registered = this.get(id);
                if (registered && registered.class) {
                    resolve(registered.class);
                } else {
                    reject(new Error(`Script ${synthInfo.script} loaded but ${id} not registered`));
                }
                return;
            }

            console.log(`[SynthRegistry] Loading ${synthInfo.className} from ${synthInfo.script}`);

            const script = document.createElement('script');
            // Add cache-busting parameter
            script.src = synthInfo.script + '?v=' + Date.now();
            script.async = true;

            script.onload = () => {
                this.loadedScripts.add(synthInfo.script);
                // Registration is synchronous, just give browser a tick to execute
                setTimeout(() => {
                    const registered = this.get(id);
                    if (registered && registered.class) {
                        console.log(`[SynthRegistry] ✓ Loaded ${synthInfo.className}`);
                        resolve(registered.class);
                    } else {
                        console.error(`[SynthRegistry] Script loaded but synth not registered. SynthRegistry defined: ${typeof SynthRegistry !== 'undefined'}`);
                        console.error(`[SynthRegistry] Checking for class ${synthInfo.className} on window:`, typeof window[synthInfo.className]);
                        reject(new Error(`Script loaded but ${id} did not register itself. Check console for details.`));
                    }
                }, 0);
            };

            script.onerror = () => {
                reject(new Error(`Failed to load script: ${synthInfo.script}`));
            };

            document.head.appendChild(script);
        });

        this.loadingPromises.set(id, loadPromise);

        try {
            const SynthClass = await loadPromise;
            this.loadingPromises.delete(id);
            return SynthClass;
        } catch (error) {
            this.loadingPromises.delete(id);
            throw error;
        }
    }

    /**
     * Get or load synth class
     * @param {string} id - Synth ID
     * @returns {Promise<Class>} - Synth class constructor
     */
    static async getSynthClass(id) {
        // Try to get from manifest
        if (!this.manifest) {
            await this.loadManifest();
        }

        const synthInfo = this.manifest.synths.find(s => s.id === id);
        if (!synthInfo) {
            throw new Error(`Synth '${id}' not found in manifest`);
        }

        // Check if already registered
        const registered = this.get(id);
        if (registered && registered.class) {
            return registered.class;
        }

        // Load dynamically
        return await this.loadSynthClass(id);
    }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SynthRegistry;
}

// Expose globally for dynamic loading
if (typeof window !== 'undefined') {
    window.SynthRegistry = SynthRegistry;
}
