/**
 * Parameter Manager
 * Handles exporting and importing device parameters
 */

class ParameterManager {
    constructor() {
        this.currentDevice = null;
        this.currentParameters = {};
    }

    // Set current device
    setDevice(device) {
        this.currentDevice = device;
        this.currentParameters = {};
    }

    // Capture current parameter values from UI
    captureCurrentParameters() {
        if (!this.currentDevice) {
            console.warn('[ParamMgr] No device selected');
            return null;
        }

        const parameters = {
            deviceId: this.currentDevice.id,
            deviceName: this.currentDevice.name,
            timestamp: new Date().toISOString(),
            version: 1,
            controls: {}
        };

        // Collect all knob, select, and toggle values
        document.querySelectorAll('pad-knob, select[data-cc], input[type="checkbox"][data-cc]').forEach(control => {
            let cc, value, type, nrpnInfo = null;

            if (control.tagName === 'PAD-KNOB') {
                value = parseInt(control.getAttribute('value'));

                // Check if NRPN
                if (control.dataset.nrpnMsb !== undefined) {
                    type = 'nrpn';
                    nrpnInfo = {
                        msb: parseInt(control.dataset.nrpnMsb),
                        lsb: parseInt(control.dataset.nrpnLsb),
                        is14bit: control.dataset.is14bit === 'true'
                    };
                    cc = `nrpn:${nrpnInfo.msb}:${nrpnInfo.lsb}`;
                } else {
                    type = 'cc';
                    cc = parseInt(control.getAttribute('cc'));
                }
            } else if (control.tagName === 'SELECT') {
                type = 'cc';
                cc = parseInt(control.getAttribute('data-cc'));
                value = parseInt(control.value);
            } else if (control.type === 'checkbox') {
                type = 'cc';
                cc = parseInt(control.getAttribute('data-cc'));
                value = control.checked ? 127 : 0;
            }

            if (cc !== undefined && value !== undefined) {
                const key = type === 'nrpn' ? cc : `cc${cc}`;
                parameters.controls[key] = {
                    type,
                    value,
                    ...(nrpnInfo && { nrpn: nrpnInfo })
                };
            }
        });

        this.currentParameters = parameters;
        return parameters;
    }

    // Export parameters to JSON file
    exportToFile() {
        const params = this.captureCurrentParameters();
        if (!params) {
            alert('No device selected or no parameters to export');
            return;
        }

        const filename = `${params.deviceId}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        const json = JSON.stringify(params, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);

        console.log('[ParamMgr] Exported parameters to', filename);
        return filename;
    }

    // Import parameters from JSON file
    async importFromFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    const params = JSON.parse(e.target.result);

                    // Validate
                    if (!params.deviceId || !params.controls) {
                        throw new Error('Invalid parameter file format');
                    }

                    // Check if device matches
                    if (this.currentDevice && params.deviceId !== this.currentDevice.id) {
                        const proceed = confirm(
                            `This file is for "${params.deviceName}" but current device is "${this.currentDevice.name}". Load anyway?`
                        );
                        if (!proceed) {
                            reject(new Error('Device mismatch'));
                            return;
                        }
                    }

                    this.applyParameters(params);
                    resolve(params);
                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    // Apply parameters to UI and send to device
    applyParameters(params, sendToDevice = true) {
        let applied = 0;
        let failed = 0;

        Object.entries(params.controls).forEach(([key, control]) => {
            try {
                if (control.type === 'nrpn') {
                    // NRPN control
                    const knob = document.querySelector(
                        `pad-knob[data-nrpn-msb="${control.nrpn.msb}"][data-nrpn-lsb="${control.nrpn.lsb}"]`
                    );
                    if (knob) {
                        knob.setAttribute('value', control.value);
                        if (sendToDevice && window.sendNRPN) {
                            window.sendNRPN(control.nrpn.msb, control.nrpn.lsb, control.value, control.nrpn.is14bit);
                        }
                        applied++;
                    } else {
                        failed++;
                    }
                } else if (control.type === 'cc') {
                    const cc = parseInt(key.replace('cc', ''));

                    // Try knob
                    let element = document.querySelector(`pad-knob[cc="${cc}"]`);
                    if (element) {
                        element.setAttribute('value', control.value);
                        if (sendToDevice && window.sendCC) {
                            window.sendCC(cc, control.value);
                        }
                        applied++;
                        return;
                    }

                    // Try select
                    element = document.querySelector(`select[data-cc="${cc}"]`);
                    if (element) {
                        element.value = control.value;
                        if (sendToDevice && window.sendCC) {
                            window.sendCC(cc, control.value);
                        }
                        applied++;
                        return;
                    }

                    // Try checkbox
                    element = document.querySelector(`input[type="checkbox"][data-cc="${cc}"]`);
                    if (element) {
                        element.checked = control.value > 63;
                        if (sendToDevice && window.sendCC) {
                            window.sendCC(cc, control.value);
                        }
                        applied++;
                        return;
                    }

                    failed++;
                }
            } catch (error) {
                console.error('[ParamMgr] Failed to apply', key, error);
                failed++;
            }
        });

        console.log(`[ParamMgr] Applied ${applied} parameters, ${failed} failed`);
        return { applied, failed, total: applied + failed };
    }

    // Export to clipboard
    async exportToClipboard() {
        const params = this.captureCurrentParameters();
        if (!params) {
            alert('No device selected or no parameters to export');
            return;
        }

        try {
            await navigator.clipboard.writeText(JSON.stringify(params, null, 2));
            console.log('[ParamMgr] Copied parameters to clipboard');
            return true;
        } catch (error) {
            console.error('[ParamMgr] Failed to copy to clipboard:', error);
            return false;
        }
    }

    // Import from clipboard
    async importFromClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            const params = JSON.parse(text);

            if (!params.deviceId || !params.controls) {
                throw new Error('Invalid parameter format in clipboard');
            }

            this.applyParameters(params);
            console.log('[ParamMgr] Loaded parameters from clipboard');
            return params;
        } catch (error) {
            console.error('[ParamMgr] Failed to import from clipboard:', error);
            throw error;
        }
    }
}

// Export global instance
window.parameterManager = new ParameterManager();
