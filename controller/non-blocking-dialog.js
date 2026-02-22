/**
 * Non-blocking dialog system for MIDI Controller
 * Prevents blocking MIDI messages with alert/confirm/prompt
 */

class NonBlockingDialog {
    constructor() {
        this.dialogContainer = null;
        if (document.body) {
            this.createContainer();
        } else {
            document.addEventListener('DOMContentLoaded', () => this.createContainer());
        }
    }

    createContainer() {
        if (this.dialogContainer) return;
        this.dialogContainer = document.createElement('div');
        this.dialogContainer.id = 'nb-dialog-container';
        this.dialogContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;
        document.body.appendChild(this.dialogContainer);
    }

    show(content) {
        if (!this.dialogContainer) this.createContainer();
        if (!this.dialogContainer) return;
        this.dialogContainer.innerHTML = content;
        this.dialogContainer.style.display = 'flex';
    }

    hide() {
        if (!this.dialogContainer) return;
        this.dialogContainer.style.display = 'none';
        this.dialogContainer.innerHTML = '';
    }

    /**
     * Non-blocking alert replacement
     */
    alert(message, callback) {
        const content = `
            <div style="
                background: var(--bg-secondary, #1a1a1a);
                border: 2px solid #0066FF;
                border-radius: 8px;
                padding: 25px;
                min-width: 300px;
                max-width: 500px;
                color: var(--text-primary, #fff);
                font-family: inherit;
                box-shadow: 0 10px 40px rgba(0, 102, 255, 0.3);
            ">
                <div style="margin-bottom: 20px; line-height: 1.5; font-size: 14px;">${message}</div>
                <div style="text-align: right;">
                    <button id="nb-alert-ok" style="
                        padding: 10px 25px;
                        background: #0066FF;
                        color: #fff;
                        border: 1px solid #3388FF;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
                        font-size: 14px;
                    ">OK</button>
                </div>
            </div>
        `;

        this.show(content);

        const okBtn = document.getElementById('nb-alert-ok');
        okBtn.addEventListener('click', () => {
            this.hide();
            if (callback) callback();
        });

        // Allow Enter key to close
        const handleKey = (e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
                this.hide();
                document.removeEventListener('keydown', handleKey);
                if (callback) callback();
            }
        };
        document.addEventListener('keydown', handleKey);
    }

    /**
     * Non-blocking confirm replacement
     */
    confirm(message, callback) {
        const content = `
            <div style="
                background: var(--bg-secondary, #1a1a1a);
                border: 2px solid #0066FF;
                border-radius: 8px;
                padding: 25px;
                min-width: 300px;
                max-width: 500px;
                color: var(--text-primary, #fff);
                font-family: inherit;
                box-shadow: 0 10px 40px rgba(0, 102, 255, 0.3);
            ">
                <div style="margin-bottom: 20px; line-height: 1.5; font-size: 14px;">${message}</div>
                <div style="text-align: right; display: flex; gap: 10px; justify-content: flex-end;">
                    <button id="nb-confirm-cancel" style="
                        padding: 10px 25px;
                        background: var(--bg-tertiary, #2a2a2a);
                        color: #fff;
                        border: 1px solid #3a3a3a;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
                        font-size: 14px;
                    ">Cancel</button>
                    <button id="nb-confirm-ok" style="
                        padding: 10px 25px;
                        background: #0066FF;
                        color: #fff;
                        border: 1px solid #3388FF;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
                        font-size: 14px;
                    ">OK</button>
                </div>
            </div>
        `;

        this.show(content);

        const okBtn = document.getElementById('nb-confirm-ok');
        const cancelBtn = document.getElementById('nb-confirm-cancel');

        okBtn.addEventListener('click', () => {
            this.hide();
            callback(true);
        });

        cancelBtn.addEventListener('click', () => {
            this.hide();
            callback(false);
        });

        // Allow Enter/Escape keys
        const handleKey = (e) => {
            if (e.key === 'Enter') {
                this.hide();
                document.removeEventListener('keydown', handleKey);
                callback(true);
            } else if (e.key === 'Escape') {
                this.hide();
                document.removeEventListener('keydown', handleKey);
                callback(false);
            }
        };
        document.addEventListener('keydown', handleKey);
    }

    /**
     * Non-blocking prompt replacement
     */
    prompt(message, defaultValue = '', callback) {
        const content = `
            <div style="
                background: var(--bg-secondary, #1a1a1a);
                border: 2px solid #0066FF;
                border-radius: 8px;
                padding: 25px;
                min-width: 350px;
                max-width: 500px;
                color: var(--text-primary, #fff);
                font-family: inherit;
                box-shadow: 0 10px 40px rgba(0, 102, 255, 0.3);
            ">
                <div style="margin-bottom: 15px; line-height: 1.5; font-size: 14px;">${message}</div>
                <input type="text" id="nb-prompt-input" value="${defaultValue}" style="
                    width: 100%;
                    padding: 10px;
                    margin-bottom: 20px;
                    background: var(--bg-primary, #0f0f0f);
                    color: var(--text-primary, #fff);
                    border: 1px solid var(--bg-tertiary, #2a2a2a);
                    border-radius: 4px;
                    font-size: 14px;
                    box-sizing: border-box;
                ">
                <div style="text-align: right; display: flex; gap: 10px; justify-content: flex-end;">
                    <button id="nb-prompt-cancel" style="
                        padding: 10px 25px;
                        background: var(--bg-tertiary, #2a2a2a);
                        color: #fff;
                        border: 1px solid #3a3a3a;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
                        font-size: 14px;
                    ">Cancel</button>
                    <button id="nb-prompt-ok" style="
                        padding: 10px 25px;
                        background: #0066FF;
                        color: #fff;
                        border: 1px solid #3388FF;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
                        font-size: 14px;
                    ">OK</button>
                </div>
            </div>
        `;

        this.show(content);

        const input = document.getElementById('nb-prompt-input');
        const okBtn = document.getElementById('nb-prompt-ok');
        const cancelBtn = document.getElementById('nb-prompt-cancel');

        // Focus input
        setTimeout(() => input.focus(), 100);

        okBtn.addEventListener('click', () => {
            const value = input.value;
            this.hide();
            callback(value);
        });

        cancelBtn.addEventListener('click', () => {
            this.hide();
            callback(null);
        });

        // Allow Enter/Escape keys
        const handleKey = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const value = input.value;
                this.hide();
                document.removeEventListener('keydown', handleKey);
                callback(value);
            } else if (e.key === 'Escape') {
                this.hide();
                document.removeEventListener('keydown', handleKey);
                callback(null);
            }
        };
        document.addEventListener('keydown', handleKey);
    }
}

// Global instance
const nbDialog = new NonBlockingDialog();
