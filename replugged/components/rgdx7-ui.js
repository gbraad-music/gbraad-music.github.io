/**
 * RGDX7 Synth UI Component
 * UI for DX7 FM synthesizer with SysEx loading and patch selection
 */

import { setupParameterSync, cleanupParameterSync, emitParameterChange } from './synth-ui-base.js';

class RGDX7UI extends HTMLElement {
    constructor() {
        super();
        this.synthInstance = null;
        this.currentPatch = 0;
        this.patchNames = Array(32).fill('INIT VOICE');
    }

    connectedCallback() {
        this.render();
        this.setupEventListeners();

        // Setup parameter sync
        const paramMapping = {
            0: 'patch',
            1: 'volume',
            2: 'algorithm',
            3: 'feedback',
            4: 'lfoSpeed',
            5: 'lfoDelay',
            6: 'lfoPitchDepth',
            7: 'lfoAmpDepth'
        };
        setupParameterSync(this, paramMapping);
    }

    disconnectedCallback() {
        cleanupParameterSync(this);
    }

    set synth(instance) {
        this.synthInstance = instance;
    }

    render() {
        this.innerHTML = `
            <style>
                .rgdx7-container {
                    padding: 20px;
                    background: #1a1a1a;
                    border-radius: 8px;
                    color: #fff;
                    font-family: 'Segoe UI', sans-serif;
                }

                .rgdx7-container .rgdx7-header {
                    font-size: 20px;
                    font-weight: bold;
                    color: #be3b65;
                    margin: 0 0 20px 0;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                }

                .rgdx7-container .rgdx7-section {
                    margin-bottom: 20px;
                }

                .rgdx7-container .rgdx7-section h3 {
                    margin: 0 0 10px 0;
                    font-size: 14px;
                    color: #5a979a;
                    text-transform: uppercase;
                }

                .rgdx7-container .sysex-loader {
                    display: flex;
                    gap: 10px;
                    align-items: center;
                }

                .rgdx7-container .file-input-wrapper {
                    position: relative;
                    overflow: hidden;
                    display: inline-block;
                }

                .rgdx7-container .file-input-wrapper input[type=file] {
                    position: absolute;
                    left: -9999px;
                }

                .rgdx7-container .file-button {
                    padding: 10px 20px;
                    background: #5a979a;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                }

                .rgdx7-container .file-button:hover {
                    background: #6cb3b7;
                }

                .rgdx7-container .file-status {
                    color: #888;
                    font-size: 12px;
                }

                .rgdx7-container .patch-selector {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 5px;
                }

                .rgdx7-container .patch-button {
                    padding: 8px;
                    background: #333;
                    border: 2px solid #5a979a;
                    color: #fff;
                    cursor: pointer;
                    text-align: left;
                    border-radius: 4px;
                    transition: all 0.2s;
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }

                .rgdx7-container .patch-num {
                    font-size: 10px;
                    color: #5a979a;
                    font-weight: bold;
                }

                .rgdx7-container .patch-name {
                    font-size: 11px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .rgdx7-container .patch-button:hover {
                    background: #5a979a;
                    border-color: #6cb3b7;
                }

                .rgdx7-container .patch-button.selected {
                    background: #5a979a;
                    border-color: #5a979a;
                    font-weight: bold;
                }

                .rgdx7-container .patch-info {
                    margin-top: 10px;
                    padding: 10px;
                    background: #222;
                    border-radius: 4px;
                    font-size: 12px;
                }
            </style>

            <div class="rgdx7-container">
                <h2 class="rgdx7-header">RX7 - FM Synthesizer</h2>

                <div class="rgdx7-section">
                    <h3>SysEx Cartridge</h3>
                    <div class="sysex-loader">
                        <div class="file-input-wrapper">
                            <button class="file-button">Load .syx File</button>
                            <input type="file" id="sysexFile" accept=".syx" />
                        </div>
                        <span class="file-status" id="fileStatus">No cartridge loaded</span>
                    </div>
                </div>

                <div class="rgdx7-section" id="patchSection" style="display: none;">
                    <h3>Patch Selection (0-31)</h3>
                    <div class="patch-selector" id="patchSelector">
                        <!-- Patch buttons will be generated here -->
                    </div>
                </div>
            </div>
        `;
    }

    setupEventListeners() {
        const fileInput = this.querySelector('#sysexFile');
        const fileButton = this.querySelector('.file-button');
        
        fileButton.addEventListener('click', () => fileInput.click());
        
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const arrayBuffer = await file.arrayBuffer();
            this.loadSysexFile(arrayBuffer);
        });
    }

    async loadSysexFile(arrayBuffer) {
        if (!this.synthInstance) {
            console.error('[RGDX7UI] No synth instance');
            return;
        }

        const success = await this.synthInstance.loadSysex(arrayBuffer);

        if (success) {
            // Extract patch names from SysEx cartridge
            this.extractPatchNames(arrayBuffer);

            const fileStatus = this.querySelector('#fileStatus');
            fileStatus.textContent = `Loaded (${arrayBuffer.byteLength} bytes)`;
            fileStatus.style.color = '#5a979a';

            // Show patch selector
            this.querySelector('#patchSection').style.display = 'block';
            this.generatePatchButtons();

            // Select first patch
            this.selectPatch(0);
        }
    }

    extractPatchNames(arrayBuffer) {
        const data = new Uint8Array(arrayBuffer);

        // DX7 cartridge format:
        // - 6 byte header (F0 43 00 09 20 00)
        // - 32 patches × 128 bytes each
        // - Each patch has voice name at bytes 118-127 (10 ASCII chars)

        if (data.length >= 4104) {
            // CART mode - 32 patches
            for (let i = 0; i < 32; i++) {
                const nameOffset = 6 + (i * 128) + 118;
                const nameBytes = data.slice(nameOffset, nameOffset + 10);
                this.patchNames[i] = String.fromCharCode(...nameBytes).trim();
            }
        } else if (data.length >= 136) {
            // SINGLE mode - 1 patch
            const nameOffset = 6 + 118;
            const nameBytes = data.slice(nameOffset, nameOffset + 10);
            this.patchNames[0] = String.fromCharCode(...nameBytes).trim();
        }
    }

    generatePatchButtons() {
        const patchSelector = this.querySelector('#patchSelector');
        patchSelector.innerHTML = '';

        for (let i = 0; i < 32; i++) {
            const button = document.createElement('button');
            button.className = 'patch-button';
            button.innerHTML = `<div class="patch-num">${i}</div><div class="patch-name">${this.patchNames[i]}</div>`;
            button.dataset.patch = i;

            if (i === this.currentPatch) {
                button.classList.add('selected');
            }

            button.addEventListener('click', () => {
                this.selectPatch(i);
            });

            patchSelector.appendChild(button);
        }
    }

    selectPatch(patchNum) {
        this.currentPatch = patchNum;

        if (this.synthInstance) {
            this.synthInstance.selectPatch(patchNum);
        }

        // Update UI
        const buttons = this.querySelectorAll('.patch-button');
        buttons.forEach((btn, i) => {
            btn.classList.toggle('selected', i === patchNum);
        });

        // Emit parameter change
        emitParameterChange(0, 'patch', patchNum, this);
    }

    updateParameter(paramIndex, value) {
        // Called when parameters change from external knobs
        if (paramIndex === 0) {
            this.selectPatch(Math.floor(value));
        }
    }
}

customElements.define('rgdx7-ui', RGDX7UI);

export { RGDX7UI };
