/**
 * Reusable Trigger Pads Component
 * Creates a 4x4 grid of trigger pads that can send MIDI notes
 */

class TriggerPads {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            throw new Error(`Container element '${containerId}' not found`);
        }
        
        this.midiOutput = options.midiOutput || null;
        this.preset = options.preset || this.getDefaultPreset();
        this.channel = options.channel !== undefined ? options.channel : 0;
        this.onNoteOn = options.onNoteOn || null;
        this.onNoteOff = options.onNoteOff || null;
        this.interactive = options.interactive !== false; // true by default
        
        this.buttonStates = {};
        this.build();
    }
    
    getDefaultPreset() {
        return {
            name: 'Default Layout',
            buttons: {
                0: { note: 60, label: 'C3' }, 1: { note: 62, label: 'D3' }, 2: { note: 64, label: 'E3' }, 3: { note: 65, label: 'F3' },
                4: { note: 67, label: 'G3' }, 5: { note: 69, label: 'A3' }, 6: { note: 71, label: 'B3' }, 7: { note: 72, label: 'C4' },
                8: { note: 74, label: 'D4' }, 9: { note: 76, label: 'E4' }, 10: { note: 77, label: 'F4' }, 11: { note: 79, label: 'G4' },
                12: { note: 81, label: 'A4' }, 13: { note: 83, label: 'B4' }, 14: { note: 84, label: 'C5' }, 15: { note: 86, label: 'D5' }
            }
        };
    }
    
    build() {
        this.container.innerHTML = '';
        this.container.className = 'trigger-pads-grid';
        
        for (let i = 0; i < 16; i++) {
            const btn = document.createElement('div');
            btn.className = 'trigger-pad';
            btn.dataset.index = i;
            
            const buttonConfig = this.preset.buttons[i];
            if (buttonConfig) {
                const label = buttonConfig.label || buttonConfig.name || `Note ${buttonConfig.note}`;
                btn.innerHTML = `
                    <div class="trigger-pad-label">${label}</div>
                    <div class="trigger-pad-note">Note ${buttonConfig.note}</div>
                `;
            } else {
                btn.innerHTML = `<div class="trigger-pad-label">-</div>`;
                btn.style.opacity = '0.3';
            }
            
            if (this.interactive && buttonConfig) {
                this.setupInteraction(btn, i);
            }
            
            this.container.appendChild(btn);
        }
    }
    
    setupInteraction(btn, index) {
        const pressButton = () => {
            if (this.buttonStates[index]) return;
            this.buttonStates[index] = true;
            btn.classList.add('active');
            this.sendNoteOn(index);
        };
        
        const releaseButton = () => {
            if (!this.buttonStates[index]) return;
            this.buttonStates[index] = false;
            btn.classList.remove('active');
            this.sendNoteOff(index);
        };
        
        // Mouse events
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            pressButton();
        });
        
        btn.addEventListener('mouseup', releaseButton);
        btn.addEventListener('mouseleave', releaseButton);
        
        // Touch events
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            pressButton();
        });
        
        btn.addEventListener('touchend', (e) => {
            e.preventDefault();
            releaseButton();
        });
        
        btn.addEventListener('touchcancel', (e) => {
            e.preventDefault();
            releaseButton();
        });
    }
    
    sendNoteOn(index) {
        const buttonConfig = this.preset.buttons[index];
        if (!buttonConfig) return;
        
        const note = buttonConfig.note;
        const velocity = buttonConfig.velocity || 127;
        
        if (this.midiOutput) {
            const statusByte = 0x90 | (this.channel & 0x0F);
            const message = [statusByte, note, velocity];
            this.midiOutput.send(message);
        }
        
        if (this.onNoteOn) {
            this.onNoteOn(note, velocity, this.channel);
        }
    }
    
    sendNoteOff(index) {
        const buttonConfig = this.preset.buttons[index];
        if (!buttonConfig) return;
        
        const note = buttonConfig.note;
        
        if (this.midiOutput) {
            const statusByte = 0x80 | (this.channel & 0x0F);
            const message = [statusByte, note, 0];
            this.midiOutput.send(message);
        }
        
        if (this.onNoteOff) {
            this.onNoteOff(note, this.channel);
        }
    }
    
    // Update from external controller
    triggerButton(index, pressed) {
        const btn = this.container.querySelector(`[data-index="${index}"]`);
        if (!btn) return;
        
        if (pressed) {
            if (this.buttonStates[index]) return;
            this.buttonStates[index] = true;
            btn.classList.add('active');
            this.sendNoteOn(index);
        } else {
            if (!this.buttonStates[index]) return;
            this.buttonStates[index] = false;
            btn.classList.remove('active');
            this.sendNoteOff(index);
        }
    }
    
    // Update configuration
    setMidiOutput(midiOutput) {
        this.midiOutput = midiOutput;
    }
    
    setPreset(preset) {
        this.preset = preset;
        this.build();
    }
    
    setChannel(channel) {
        this.channel = channel;
    }
    
    destroy() {
        // Release all buttons
        for (let i = 0; i < 16; i++) {
            if (this.buttonStates[i]) {
                this.sendNoteOff(i);
            }
        }
        this.container.innerHTML = '';
    }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TriggerPads;
}
