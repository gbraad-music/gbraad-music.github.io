/**
 * MIDI Input Router for Meister
 * Routes MIDI input messages to outputs or devices with channel mapping
 */

export class InputRouter {
    constructor(controller) {
        this.controller = controller;
        this.routes = new Map(); // Map of input ID -> route config
        this.activeRoutes = new Map(); // Map of input ID -> current active target (for switching)

        this.loadRoutes();
    }

    /**
     * Set route configuration for a MIDI input
     */
    setRoute(inputName, config) {
        const route = {
            inputName: inputName,
            mode: config.mode || 'off', // 'pass_through', 'device', 'off'
            targets: config.targets || [], // Array of target configs for switching
            activeTargetIndex: config.activeTargetIndex ?? 0 // Current active target
        };

        this.routes.set(inputName, route);
        this.activeRoutes.set(inputName, route.activeTargetIndex);
        this.saveRoutes();
    }

    /**
     * Get route configuration for a MIDI input
     */
    getRoute(inputName) {
        return this.routes.get(inputName);
    }

    /**
     * Switch to next target for an input
     */
    switchTarget(inputName) {
        const route = this.routes.get(inputName);
        if (!route || route.targets.length === 0) {
            console.warn(`[InputRouter] No route configured for input ${inputName}`);
            return null;
        }

        // Cycle to next target
        const nextIndex = (route.activeTargetIndex + 1) % route.targets.length;
        route.activeTargetIndex = nextIndex;
        this.activeRoutes.set(inputName, nextIndex);
        this.saveRoutes();

        const target = route.targets[nextIndex];
        console.log(`[InputRouter] Switched input "${inputName}" to target: ${JSON.stringify(target)}`);

        return target;
    }

    /**
     * Set specific target for an input by index
     */
    setActiveTarget(inputName, targetIndex) {
        const route = this.routes.get(inputName);
        if (!route || !route.targets[targetIndex]) {
            console.warn(`[InputRouter] Invalid target index ${targetIndex} for input ${inputName}`);
            return null;
        }

        route.activeTargetIndex = targetIndex;
        this.activeRoutes.set(inputName, targetIndex);
        this.saveRoutes();

        const target = route.targets[targetIndex];
        console.log(`[InputRouter] Set input "${inputName}" to target: ${JSON.stringify(target)}`);

        return target;
    }

    /**
     * Get current active target for an input
     */
    getActiveTarget(inputName) {
        const route = this.routes.get(inputName);
        if (!route || route.targets.length === 0) {
            return null;
        }

        return route.targets[route.activeTargetIndex];
    }

    /**
     * Route a MIDI message from an input
     */
    routeMessage(inputName, midiData) {
        const route = this.routes.get(inputName);
        if (!route || route.mode === 'off') {
            return; // No routing configured
        }

        const target = this.getActiveTarget(inputName);
        if (!target) {
            return; // No active target
        }

        const status = midiData[0];
        const isSystemMessage = (status >= 0xF0);

        // System messages (clock, SPP, etc.) are never routed - handled separately
        if (isSystemMessage) {
            return;
        }

        if (route.mode === 'pass_through') {
            this.routeToOutput(target.outputName, midiData);
        } else if (route.mode === 'device') {
            this.routeToDevice(target.deviceId, midiData, target.channelMode);
        }
    }

    /**
     * Route to output (pass-through, unchanged)
     */
    routeToOutput(outputName, midiData) {
        if (!this.controller.midiAccess) return;

        const output = this.controller.midiAccess.outputs.get(outputName);
        if (output) {
            output.send(midiData);
        } else {
            console.warn(`[InputRouter] Output ${outputName} not found`);
        }
    }

    /**
     * Route to device (with channel mapping)
     */
    routeToDevice(deviceId, midiData, channelMode) {
        if (!this.controller.deviceManager) return;

        const device = this.controller.deviceManager.getDevice(deviceId);
        if (!device) {
            console.warn(`[InputRouter] Device ${deviceId} not found`);
            return;
        }

        // Get output for this device
        const output = this.controller.deviceManager.getMidiOutput(deviceId);
        if (!output) {
            console.warn(`[InputRouter] No output for device ${deviceId}`);
            return;
        }

        const status = midiData[0];
        const messageType = status & 0xF0;
        const inputChannel = status & 0x0F;

        // Clone the data
        const routedData = Array.from(midiData);

        // Remap channel for channel messages
        if (messageType >= 0x80 && messageType <= 0xE0) {
            if (channelMode === 'omni') {
                // Keep original channel
                // No change needed
            } else if (channelMode === 'device') {
                // Map to device's configured channel
                routedData[0] = messageType | device.midiChannel;
            }
        }

        output.send(routedData);
    }

    /**
     * Save routes to localStorage
     */
    saveRoutes() {
        const routesData = Array.from(this.routes.entries()).map(([id, route]) => ({
            inputName: id,
            ...route
        }));

        localStorage.setItem('meisterInputRoutes', JSON.stringify(routesData));
    }

    /**
     * Load routes from localStorage
     */
    loadRoutes() {
        try {
            const saved = localStorage.getItem('meisterInputRoutes');
            if (saved) {
                const routesData = JSON.parse(saved);
                routesData.forEach(route => {
                    this.routes.set(route.inputName, {
                        inputName: route.inputName,
                        mode: route.mode,
                        targets: route.targets || [],
                        activeTargetIndex: route.activeTargetIndex ?? 0
                    });
                    this.activeRoutes.set(route.inputName, route.activeTargetIndex ?? 0);
                });
                console.log(`[InputRouter] Loaded ${this.routes.size} route(s)`);
            }
        } catch (e) {
            console.error('[InputRouter] Failed to load routes:', e);
        }
    }

    /**
     * Get all routes
     */
    getAllRoutes() {
        return Array.from(this.routes.values());
    }

    /**
     * Remove a route
     */
    removeRoute(inputName) {
        if (this.routes.delete(inputName)) {
            this.activeRoutes.delete(inputName);
            this.saveRoutes();
            console.log(`[InputRouter] Removed route for input ${inputName}`);
        }
    }
}
