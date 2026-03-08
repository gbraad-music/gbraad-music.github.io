/**
 * Display Widget Web Component
 * Grid-placeable display element that shows device status
 */

class DisplayWidget extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.adapter = null;
        this.updateTimer = null;
    }

    static get observedAttributes() {
        return ['device-id', 'device-type', 'update-interval', 'display-mode', 'deck-id'];
    }

    connectedCallback() {
        this.deviceId = this.getAttribute('device-id');
        this.deviceType = this.getAttribute('device-type') || 'unknown';
        this.updateInterval = parseInt(this.getAttribute('update-interval')) || 100;
        this.displayMode = this.getAttribute('display-mode') || 'auto'; // 'auto', 'poll', 'push'
        this.deckId = parseInt(this.getAttribute('deck-id')) || null;

        // console.log(`[DisplayWidget] Connected: deviceId=${this.deviceId}, deviceType=${this.deviceType}, deckId=${this.deckId}, displayMode=${this.displayMode}`);

        this.render();
        this.applyDeckStyling();
        this.setupAdapter();
        this.startUpdates();

        // Forward contextmenu events to parent (for pad editing)
        this.shadowRoot.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            // Dispatch new contextmenu event on the host element
            const event = new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: e.clientX,
                clientY: e.clientY
            });
            this.dispatchEvent(event);
        });
    }

    disconnectedCallback() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
        }

        // Unregister from display manager
        if (window.displayManager && this.deviceId) {
            window.displayManager.unregisterDisplay(this.deviceId);
        }
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue !== newValue && this.isConnected) {
            if (name === 'update-interval') {
                this.updateInterval = parseInt(newValue) || 100;
                this.restartUpdates();
            }
        }
    }

    render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: block;
                    width: 100%;
                    height: 100%;
                    user-select: none;
                }
                .display-container {
                    width: 100%;
                    height: 100%;
                    background: #0a0a0a;
                    border: 3px solid #333;
                    border-radius: 8px;
                    padding: 0;
                    font-family: Arial, sans-serif;
                    font-size: 12px;
                    color: #ffffff;
                    box-sizing: border-box;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }
                .display-container.deck-a {
                    border-color: #FF0000;
                }
                .display-container.deck-b {
                    border-color: #0000FF;
                }
                .display-header {
                    background: rgba(255, 255, 255, 0.05);
                    padding: 8px 12px;
                    font-weight: bold;
                    font-size: 11px;
                    letter-spacing: 1px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                }
                .display-content {
                    line-height: 1.4;
                    flex: 1;
                    overflow-y: auto;
                    color: #ffffff;
                    padding: 12px;
                }
                .line {
                    white-space: pre;
                    font-family: Arial, sans-serif;
                    color: #ffffff;
                }
                .status {
                    color: #4a9eff;
                }
                .notification {
                    color: #ffcc00;
                    font-weight: bold;
                }
                .error {
                    color: #ff4444;
                    font-weight: bold;
                }
                .offline {
                    color: #888;
                    font-style: italic;
                    font-family: Arial, sans-serif;
                }
            </style>
            <div class="display-container" id="display-container">
                <div class="display-header" id="display-header"></div>
                <div class="display-content" id="display-content">
                    <div class="offline">Waiting for data...</div>
                </div>
            </div>
        `;
    }

    applyDeckStyling() {
        const container = this.shadowRoot.getElementById('display-container');
        const header = this.shadowRoot.getElementById('display-header');

        if (!container || !header) return;

        // Apply deck-specific styling
        if (this.deckId === 1) {
            container.classList.add('deck-a');
            header.textContent = 'DECK A';
        } else if (this.deckId === 2) {
            container.classList.add('deck-b');
            header.textContent = 'DECK B';
        } else if (this.deviceType === 'fire') {
            // Keep Fire display styling
            header.textContent = this.deviceId?.toUpperCase() || 'FIRE';
        } else {
            // Generic device header
            header.textContent = this.deviceId?.toUpperCase() || 'DEVICE';
        }
    }

    setupAdapter() {
        const container = this.shadowRoot.getElementById('display-content');
        if (!container) return;

        // Create WebDisplayAdapter with direct element reference (shadow DOM fix)
        this.adapter = new window.WebDisplayAdapter(container);

        // Register with display manager
        if (window.displayManager) {
            window.displayManager.registerDisplay(this.deviceId, this.deviceType, this.adapter);
            // console.log(`[DisplayWidget] Registered with manager: ${this.deviceId}`);
        } else {
            console.warn('[DisplayWidget] DisplayMessageManager not found');
        }
    }

    startUpdates() {
        if (this.displayMode === 'push') {
            // Push mode: only update when explicitly told
            return;
        }

        // Poll mode or auto mode: periodically update
        this.updateTimer = setInterval(() => {
            this.updateDisplay();
        }, this.updateInterval);

        // Initial update
        this.updateDisplay();
    }

    restartUpdates() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }
        this.startUpdates();
    }

    updateDisplay() {
        // console.log(`[DisplayWidget] updateDisplay called for deviceId=${this.deviceId}, deckId=${this.deckId}`);

        if (!window.deviceManager || !window.displayManager) {
            // console.log(`[DisplayWidget] Missing managers: deviceManager=${!!window.deviceManager}, displayManager=${!!window.displayManager}`);
            return;
        }

        // Get device from device manager
        const device = window.deviceManager.getDevice(this.deviceId);
        // console.log(`[DisplayWidget] Device lookup for ${this.deviceId}:`, device);
        if (!device) {
            // console.log(`[DisplayWidget] Device not found, showing offline`);
            this.showOffline();
            return;
        }

        // Check if this is a physical device or virtual
        // Mixxx is always virtual (no hardware display)
        const isPhysical = (device.type !== 'mixxx') && (device.midiOutputName || device.deviceId !== undefined);

        // console.log(`[DisplayWidget] Device type=${device.type}, isPhysical=${isPhysical}, displayMode=${this.displayMode}`);

        if (isPhysical && this.displayMode === 'poll') {
            // Request display content from physical device via GET_DISPLAY
            if (window.displayMessageReceiver) {
                window.displayMessageReceiver.requestDisplayContent(this.deviceId);
            }
            // Response will be handled by DisplayMessageReceiver and forwarded to this widget
        } else {
            // For virtual devices, build status message locally
            const state = this.getVirtualDeviceState();
            // console.log(`[DisplayWidget] Virtual device state:`, state);

            if (state) {
                const message = window.displayManager.createStatusMessage(
                    this.deviceId,
                    this.deviceType,
                    state
                );

                // console.log(`[DisplayWidget] Created message:`, message);

                if (message && this.adapter) {
                    // console.log(`[DisplayWidget] Sending message to adapter`);
                    this.adapter.sendMessage(message);
                } else {
                    console.warn(`[DisplayWidget] No message or adapter: message=${!!message}, adapter=${!!this.adapter}`);
                }
            } else {
                console.warn(`[DisplayWidget] No state returned from getVirtualDeviceState`);
            }
        }
    }

    getVirtualDeviceState() {
        // Query virtual device state from various sources

        // Try Mixxx deck state
        if (this.deviceType === 'mixxx' && this.deckId) {
            const controller = window.meisterController;
            // console.log(`[DisplayWidget] Getting Mixxx state for ${this.deviceId}, deckId=${this.deckId}, controller exists=${!!controller}, mixxxDeckState exists=${!!controller?.mixxxDeckState}, mixxxDeckState size=${controller?.mixxxDeckState?.size}`);

            if (controller?.mixxxDeckState) {
                // console.log(`[DisplayWidget] mixxxDeckState keys:`, Array.from(controller.mixxxDeckState.keys()));
                const deviceState = controller.mixxxDeckState.get(this.deviceId);
                // console.log(`[DisplayWidget] deviceState for ${this.deviceId}:`, deviceState);

                if (deviceState && deviceState.decks) {
                    const deckState = deviceState.decks[this.deckId - 1]; // Convert 1-based to 0-based
                    // console.log(`[DisplayWidget] deckState for deck ${this.deckId}:`, deckState);

                    if (deckState) {
                        const state = {
                            deck: this.deckId,
                            playing: deckState.playing,
                            looping: deckState.looping,
                            sync: deckState.sync,
                            cue: deckState.cue,
                            pfl: deckState.pfl,
                            mute: deckState.mute,
                            fx1: deckState.fx1,
                            fx2: deckState.fx2,
                            fx3: deckState.fx3,
                            fx4: deckState.fx4,
                            bpm: deckState.bpm,
                            volume: deckState.volume,
                            position: deckState.position,
                            duration: deckState.duration,
                            eqHigh: deckState.eqHigh,
                            eqMid: deckState.eqMid,
                            eqLow: deckState.eqLow
                        };
                        // console.log(`[DisplayWidget] Returning state:`, state);
                        return state;
                    }
                }
            }
            // Fallback for Mixxx when no state yet
            // console.log(`[DisplayWidget] No state found, using fallback`);
            return {
                deck: this.deckId,
                playing: false,
                looping: false,
                sync: false,
                cue: false,
                pfl: false,
                mute: false,
                bpm: 0,
                volume: 0,
                position: 0
            };
        }

        // Try sequencer engine
        if (window.sequencerEngine) {
            const state = window.sequencerEngine.getState?.();
            if (state) {
                return {
                    bpm: state.bpm || 128,
                    playing: state.playing || false,
                    order: state.currentOrder || 0,
                    pattern: state.currentPattern || 0,
                    row: state.currentRow || 0,
                    channelMutes: this.formatChannelMutes(state.channelMutes)
                };
            }
        }

        // Try device-specific state
        if (this.deviceType === 'fire') {
            return {
                bpm: 128,
                track: 1,
                step: 1,
                steps: 16,
                playing: false
            };
        }

        // Default fallback
        return {
            bpm: 128,
            playing: false,
            order: 0,
            pattern: 0,
            row: 0,
            channelMutes: '----'
        };
    }

    formatChannelMutes(mutes) {
        if (!mutes) return '----';
        if (Array.isArray(mutes)) {
            return mutes.slice(0, 4).map(m => m ? 'M' : '-').join('');
        }
        return String(mutes).substring(0, 4).padEnd(4, '-');
    }

    showOffline() {
        const content = this.shadowRoot.getElementById('display-content');
        if (content) {
            content.innerHTML = '<div class="offline">Device offline</div>';
        }
    }

    // Public API: manually trigger update
    refresh() {
        this.updateDisplay();
    }

    // Public API: send a custom message
    showMessage(message) {
        if (this.adapter) {
            this.adapter.sendMessage(message);
        }
    }
}

// Register web component
customElements.define('display-widget', DisplayWidget);

// Make available globally
window.DisplayWidget = DisplayWidget;
