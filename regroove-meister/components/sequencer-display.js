/**
 * Sequencer Display Web Component
 * Shows regular sequencer scene status in real-time
 */

class SequencerDisplay extends HTMLElement {
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
                .seq-display-container {
                    width: 100%;
                    height: 100%;
                    background: #0a0a0a;
                    border: 3px solid #4a9eff;
                    border-radius: 6px;
                    padding: 12px;
                    font-family: Arial, sans-serif;
                    box-sizing: border-box;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                .seq-header {
                    font-size: 11px;
                    color: #4a9eff;
                    font-weight: bold;
                    text-transform: uppercase;
                    border-bottom: 1px solid #4a9eff;
                    padding-bottom: 4px;
                }
                .seq-content {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    font-size: 13px;
                }
                .seq-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .seq-label {
                    color: #888;
                    font-size: 11px;
                }
                .seq-value {
                    color: #88ddff;
                    font-weight: bold;
                    font-size: 14px;
                    line-height: 1.5;
                }
                .seq-playing {
                    color: #44ff44;
                }
                .seq-stopped {
                    color: #666;
                }
                .seq-mutes {
                    display: flex;
                    gap: 4px;
                    font-size: 11px;
                }
                .seq-track {
                    padding: 2px 6px;
                    background: #1a1a1a;
                    border-radius: 2px;
                    border: 1px solid #333;
                }
                .seq-track.muted {
                    background: #ff4400;
                    color: #000;
                    font-weight: bold;
                }
                .seq-track.solo {
                    background: #ffcc00;
                    color: #000;
                    font-weight: bold;
                }
                .offline {
                    color: #888;
                    font-style: italic;
                }
            </style>
            <div class="seq-display-container">
                <div class="seq-header" id="seq-header">Sequencer</div>
                <div class="seq-content" id="seq-content">
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
        const content = this.shadowRoot.getElementById('seq-content');
        const header = this.shadowRoot.getElementById('seq-header');

        if (!window.meisterController?.sceneManager) {
            content.innerHTML = '<div class="offline">Scene manager not ready</div>';
            return;
        }

        const scene = window.meisterController.sceneManager.scenes.get(this.sceneId);
        if (!scene || scene.type !== 'sequencer') {
            content.innerHTML = '<div class="offline">Scene not found</div>';
            return;
        }

        const sequencer = scene.sequencerInstance;
        if (!sequencer || !sequencer.engine) {
            content.innerHTML = '<div class="offline">Sequencer not initialized</div>';
            return;
        }

        // Update header with scene name
        header.textContent = scene.name || 'Sequencer';

        const engine = sequencer.engine;
        const playing = engine.playing;
        const bpm = engine.bpm || 120;
        const currentRow = engine.currentRow || 0;
        const patternRows = engine.pattern?.rows || 64;
        const playbackLength = engine.playbackLength || 64;

        // Build display content
        let html = '';

        // Status row
        html += `
            <div class="seq-row">
                <span class="seq-label">Status:</span>
                <span class="seq-value ${playing ? 'seq-playing' : 'seq-stopped'}">
                    ${playing ? '▶ PLAYING' : '■ STOPPED'}
                </span>
            </div>
        `;

        // BPM row
        html += `
            <div class="seq-row">
                <span class="seq-label">BPM:</span>
                <span class="seq-value">${bpm}</span>
            </div>
        `;

        // Position row
        html += `
            <div class="seq-row">
                <span class="seq-label">Position:</span>
                <span class="seq-value">${currentRow.toString().padStart(2, '0')} / ${playbackLength}</span>
            </div>
        `;

        // Pattern size row
        html += `
            <div class="seq-row">
                <span class="seq-label">Pattern:</span>
                <span class="seq-value">${patternRows} rows</span>
            </div>
        `;

        // Track mutes/solo row
        const trackMutes = engine.trackMutes || [false, false, false, false];
        html += `
            <div class="seq-row">
                <span class="seq-label">Tracks:</span>
                <div class="seq-mutes">
                    ${trackMutes.map((muted, i) => {
                        const solo = engine.isTrackSoloed ? engine.isTrackSoloed(i) : false;
                        let className = 'seq-track';
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
customElements.define('sequencer-display', SequencerDisplay);

// Make available globally
window.SequencerDisplay = SequencerDisplay;
