/**
 * Fire Sequencer Display Integration
 * Adds FireOLEDAdapter support to Fire Sequencer Scene
 *
 * Usage: Include this file after fire-sequencer-scene.js
 * This extends the FireSequencerScene class with display capabilities
 */

(function() {
    // Wait for FireSequencerScene to be available
    if (!window.FireSequencerScene) {
        console.error('[FireDisplay] FireSequencerScene not found');
        return;
    }

    // Store original constructor
    const OriginalConstructor = window.FireSequencerScene.prototype.constructor;
    const originalRender = window.FireSequencerScene.prototype.render;
    const originalCleanup = window.FireSequencerScene.prototype.cleanup;

    /**
     * Initialize Fire display
     */
    window.FireSequencerScene.prototype.initializeFireDisplay = function() {
        if (!window.FireOLEDAdapter) {
            console.warn('[FireDisplay] FireOLEDAdapter not loaded');
            return;
        }

        // Get render mode from scene config (defaults to 'text')
        const renderMode = this.scene.renderMode || 'text';


        // Create virtual Fire OLED adapter
        this.fireDisplayAdapter = new window.FireOLEDAdapter(
            { id: 'fire-virtual', deviceId: 0 },
            'virtual',
            renderMode
        );

        // Start display update timer
        this.displayUpdateTimer = setInterval(() => {
            this.updateFireDisplay();
        }, 100); // Update every 100ms

        console.log(`[FireDisplay] Initialized Fire OLED display with render mode: ${renderMode}`);
    };

    /**
     * Update Fire display with current state
     */
    window.FireSequencerScene.prototype.updateFireDisplay = function() {
        if (!this.fireDisplayAdapter) return;

        // Get current state
        const state = this.getDisplayState();

        // Create display message
        const message = {
            type: 'display_message',
            deviceId: 'fire-virtual',
            deviceType: 'fire',
            lines: [
                `Fire Sequencer`,
                `Track ${state.track}: ${state.status}`,
                `BPM: ${state.bpm}  Step: ${state.step}/${state.steps}`,
                `Offset: ${state.offset}  Mode: ${state.mode}`
            ],
            metadata: { category: 'status', priority: 'normal' }
        };

        // Send to Fire OLED adapter
        this.fireDisplayAdapter.sendMessage(message);
    };

    /**
     * Get current display state
     */
    window.FireSequencerScene.prototype.getDisplayState = function() {
        // Determine which track is active (based on track mutes/solos)
        let activeTrack = 1;
        for (let i = 0; i < this.trackSolos.length; i++) {
            if (this.trackSolos[i]) {
                activeTrack = i + 1;
                break;
            }
        }

        // Determine status
        let status = 'Ready';
        if (this.isLinkedMode()) {
            const linkedSeq = this.getLinkedSequencer();
            if (linkedSeq && linkedSeq.isPlaying && linkedSeq.isPlaying()) {
                status = 'Playing';
            }
        }

        // Determine mode
        let mode = this.userMode ? 'User' : 'Normal';

        return {
            track: activeTrack,
            status: status,
            bpm: 128, // Could be linked to actual BPM if available
            step: this.currentStep >= 0 ? this.currentStep + 1 : 0,
            steps: 16,
            offset: this.gridOffset,
            mode: mode
        };
    };

    /**
     * Send custom message to Fire display
     */
    window.FireSequencerScene.prototype.sendFireDisplayMessage = function(lines) {
        if (!this.fireDisplayAdapter) return;

        const message = {
            type: 'display_message',
            deviceId: 'fire-virtual',
            deviceType: 'fire',
            lines: Array.isArray(lines) ? lines : [lines],
            metadata: { category: 'notification', priority: 'high', duration: 2000 }
        };

        this.fireDisplayAdapter.sendMessage(message);
    };

    /**
     * Clear Fire display
     */
    window.FireSequencerScene.prototype.clearFireDisplay = function() {
        if (!this.fireDisplayAdapter) return;
        this.fireDisplayAdapter.clear();
    };

    /**
     * Extended render function
     */
    window.FireSequencerScene.prototype.render = function() {
        // Call original render
        originalRender.call(this);

        // Initialize Fire display after render
        if (!this.fireDisplayAdapter) {
            this.initializeFireDisplay();
        }
    };

    /**
     * Extended cleanup function
     */
    window.FireSequencerScene.prototype.cleanup = function() {
        // Stop display updates
        if (this.displayUpdateTimer) {
            clearInterval(this.displayUpdateTimer);
            this.displayUpdateTimer = null;
        }

        // Clear display
        if (this.fireDisplayAdapter) {
            this.fireDisplayAdapter.clear();
            this.fireDisplayAdapter = null;
        }

        // Call original cleanup
        originalCleanup.call(this);
    };

    console.log('[FireDisplay] Fire sequencer display integration loaded');
})();
