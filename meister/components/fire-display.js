/**
 * Fire Display Web Component
 * Shows Fire sequencer scene status in real-time
 */

class FireDisplay extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.updateTimer = null;
    }

    connectedCallback() {
        this.sceneId = this.getAttribute('scene-id');
        this.render();
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
                .fire-display-container {
                    width: 100%;
                    height: 100%;
                    background: #0a0a0a;
                    border: 3px solid #ff4400;
                    border-radius: 6px;
                    font-family: Arial, sans-serif;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                .fire-header {
                    font-size: 11px;
                    color: #ff4400;
                    font-weight: bold;
                    text-transform: uppercase;
                    border-bottom: 1px solid #ff4400;
                    padding: 8px 12px 4px 12px;
                }
                .fire-content {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    font-size: 13px;
                    padding: 0 12px 12px 12px;
                }
                .fire-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .fire-label {
                    color: #888;
                    font-size: 11px;
                }
                .fire-value {
                    color: #ff8844;
                    font-weight: bold;
                    font-size: 14px;
                    line-height: 1.5;
                }
                .fire-playing {
                    color: #44ff44;
                }
                .fire-stopped {
                    color: #666;
                }
                .fire-mutes {
                    display: flex;
                    gap: 4px;
                    font-size: 11px;
                }
                .fire-track {
                    padding: 2px 6px;
                    background: #1a1a1a;
                    border-radius: 2px;
                    border: 1px solid #333;
                }
                .fire-track.muted {
                    background: #ff4400;
                    color: #000;
                    font-weight: bold;
                }
                .fire-track.solo {
                    background: #ffcc00;
                    color: #000;
                    font-weight: bold;
                }
                .offline {
                    color: #666;
                    font-style: italic;
                }
            </style>
            <div class="fire-display-container">
                <div class="fire-header" id="fire-header">Fire Sequencer</div>
                <div class="fire-content" id="fire-content">
                    <div class="offline">Waiting for scene...</div>
                </div>
            </div>
        `;
    }

    startUpdates() {
        // Update at 10fps (100ms interval)
        this.updateTimer = setInterval(() => {
            this.updateDisplay();
        }, 100);

        // Initial update
        this.updateDisplay();
    }

    updateDisplay() {
        const content = this.shadowRoot.getElementById('fire-content');
        const header = this.shadowRoot.getElementById('fire-header');

        if (!window.meisterController?.sceneManager) {
            content.innerHTML = '<div class="offline">Scene manager not ready</div>';
            return;
        }

        const scene = window.meisterController.sceneManager.scenes.get(this.sceneId);
        if (!scene) {
            content.innerHTML = '<div class="offline">Scene not found</div>';
            return;
        }

        if (scene.type !== 'fire-sequencer') {
            content.innerHTML = `<div class="offline">Wrong scene type: ${scene.type}</div>`;
            return;
        }

        // Update header with scene name
        header.textContent = scene.name || 'Fire Sequencer';

        // Try to get linked sequencer - works even if fireInstance not created yet
        let sequencer = null;

        // First try via fireInstance if it exists
        if (scene.fireInstance && scene.fireInstance.getLinkedSequencer) {
            sequencer = scene.fireInstance.getLinkedSequencer();
        }

        // Fallback: get linked sequencer directly from scene config
        if (!sequencer && scene.linkedSequencer) {
            const linkedScene = window.meisterController.sceneManager.scenes.get(scene.linkedSequencer);
            if (linkedScene && linkedScene.sequencerInstance) {
                sequencer = linkedScene.sequencerInstance;
            }
        }

        if (!sequencer || !sequencer.engine) {
            content.innerHTML = '<div class="offline">No linked sequencer found</div>';
            return;
        }

        const engine = sequencer.engine;
        const playing = engine.playing;
        const bpm = engine.bpm || 120;
        const currentRow = engine.currentRow || 0;
        const patternRows = engine.pattern?.rows || 64;

        // Build display content
        let html = '';

        // Status row
        html += `
            <div class="fire-row">
                <span class="fire-label">Status:</span>
                <span class="fire-value ${playing ? 'fire-playing' : 'fire-stopped'}">
                    ${playing ? '▶ PLAYING' : '■ STOPPED'}
                </span>
            </div>
        `;

        // BPM row
        html += `
            <div class="fire-row">
                <span class="fire-label">BPM:</span>
                <span class="fire-value">${bpm}</span>
            </div>
        `;

        // Position row
        html += `
            <div class="fire-row">
                <span class="fire-label">Position:</span>
                <span class="fire-value">${currentRow.toString().padStart(2, '0')} / ${patternRows}</span>
            </div>
        `;

        // Grid offset row (Fire's visible window) - only show if fireInstance exists
        if (scene.fireInstance) {
            const gridOffset = scene.fireInstance.gridOffset || 0;
            html += `
                <div class="fire-row">
                    <span class="fire-label">Fire View:</span>
                    <span class="fire-value">${gridOffset.toString().padStart(2, '0')}-${(gridOffset + 15).toString().padStart(2, '0')}</span>
                </div>
            `;
        }

        // Track mutes/solo row
        const trackMutes = engine.trackMutes || [false, false, false, false];
        html += `
            <div class="fire-row">
                <span class="fire-label">Tracks:</span>
                <div class="fire-mutes">
                    ${trackMutes.map((muted, i) => {
                        const solo = engine.isTrackSoloed ? engine.isTrackSoloed(i) : false;
                        let className = 'fire-track';
                        if (solo) className += ' solo';
                        else if (muted) className += ' muted';
                        return `<span class="${className}">T${i + 1}</span>`;
                    }).join('')}
                </div>
            </div>
        `;

        content.innerHTML = html;
    }
}

// Register web component
customElements.define('fire-display', FireDisplay);

// Make available globally
window.FireDisplay = FireDisplay;
