/**
 * Non-blocking dialog system for Meister
 * Replaces blocking prompt/alert/confirm calls
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
        if (this.dialogContainer) return; // Already created
        this.dialogContainer = document.createElement('div');
        this.dialogContainer.id = 'nb-dialog-container';
        this.dialogContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
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
                background: #1a1a1a;
                border: 2px solid #4a4a4a;
                border-radius: 8px;
                padding: 20px;
                min-width: 300px;
                max-width: 500px;
                color: #fff;
                font-family: 'Arial', sans-serif;
            ">
                <div style="margin-bottom: 20px; line-height: 1.5;">${message}</div>
                <div style="text-align: right;">
                    <button id="nb-alert-ok" style="
                        padding: 8px 20px;
                        background: #4a9eff;
                        color: #fff;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
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
            if (e.key === 'Enter') {
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
                background: #1a1a1a;
                border: 2px solid #4a4a4a;
                border-radius: 8px;
                padding: 20px;
                min-width: 300px;
                max-width: 500px;
                color: #fff;
                font-family: 'Arial', sans-serif;
            ">
                <div style="margin-bottom: 20px; line-height: 1.5;">${message}</div>
                <div style="text-align: right; display: flex; gap: 10px; justify-content: flex-end;">
                    <button id="nb-confirm-cancel" style="
                        padding: 8px 20px;
                        background: #4a4a4a;
                        color: #fff;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
                    ">Cancel</button>
                    <button id="nb-confirm-ok" style="
                        padding: 8px 20px;
                        background: #4a9eff;
                        color: #fff;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
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
    prompt(message, defaultValue, callback) {
        const content = `
            <div style="
                background: #1a1a1a;
                border: 2px solid #4a4a4a;
                border-radius: 8px;
                padding: 20px;
                min-width: 300px;
                max-width: 500px;
                color: #fff;
                font-family: 'Arial', sans-serif;
            ">
                <div style="margin-bottom: 15px; line-height: 1.5;">${message}</div>
                <input type="text" id="nb-prompt-input" value="${defaultValue || ''}" style="
                    width: 100%;
                    padding: 8px;
                    background: #0a0a0a;
                    color: #fff;
                    border: 1px solid #4a4a4a;
                    border-radius: 4px;
                    margin-bottom: 15px;
                    font-family: 'Arial', sans-serif;
                    box-sizing: border-box;
                ">
                <div style="text-align: right; display: flex; gap: 10px; justify-content: flex-end;">
                    <button id="nb-prompt-cancel" style="
                        padding: 8px 20px;
                        background: #4a4a4a;
                        color: #fff;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
                    ">Cancel</button>
                    <button id="nb-prompt-ok" style="
                        padding: 8px 20px;
                        background: #4a9eff;
                        color: #fff;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
                    ">OK</button>
                </div>
            </div>
        `;

        this.show(content);

        const input = document.getElementById('nb-prompt-input');
        const okBtn = document.getElementById('nb-prompt-ok');
        const cancelBtn = document.getElementById('nb-prompt-cancel');

        input.focus();
        input.select();

        const submit = () => {
            const value = input.value;
            this.hide();
            callback(value);
        };

        const cancel = () => {
            this.hide();
            callback(null);
        };

        okBtn.addEventListener('click', submit);
        cancelBtn.addEventListener('click', cancel);

        // Allow Enter/Escape keys
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
            }
        });
    }
}

// Create global instance
window.nbDialog = new NonBlockingDialog();
