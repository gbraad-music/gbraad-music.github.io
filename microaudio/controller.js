/**
 * microAudio 722 MIDI Controller
 * WebMIDI-based controller for the KORG microAudio 722
 */

let midiAccess = null;
let selectedOutput = null;
let midiChannel = 0; // Default channel 1 (0-indexed)
let lastLogMessage = '';
let lastLogCount = 0;
let lastDataDump = null; // Store the last received data dump

// Initialize WebMIDI
async function initMIDI() {
    try {
        midiAccess = await navigator.requestMIDIAccess({ sysex: true });
        console.log('[MIDI] WebMIDI initialized successfully');
        updateMIDIStatus('Ready', true);
        populateMIDIOutputs();
        setupMIDIInputs();

        // Auto-detect and connect to microAudio 722
        setTimeout(() => {
            autoDetectDevice();
        }, 500);

        // Listen for MIDI device changes
        midiAccess.onstatechange = (e) => {
            console.log('[MIDI] Device state changed:', e.port.name, e.port.state);
            populateMIDIOutputs();
            setupMIDIInputs();
            setTimeout(() => autoDetectDevice(), 500);
        };
    } catch (error) {
        console.error('[MIDI] Failed to initialize WebMIDI:', error);
        updateMIDIStatus('Not Supported', false);
    }
}

// Setup MIDI input listeners
function setupMIDIInputs() {
    if (!midiAccess) return;

    const inputs = Array.from(midiAccess.inputs.values());
    console.log(`[MIDI] Found ${inputs.length} input(s)`);

    inputs.forEach(input => {
        input.onmidimessage = (event) => handleMIDIMessage(event, input.name);
        console.log(`[MIDI] Listening to input: ${input.name}`);
    });
}

// Handle incoming MIDI messages
function handleMIDIMessage(event, deviceName = '') {
    const data = Array.from(event.data);
    const hex = data.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

    // Don't log raw parameter change messages if filtering is on
    const filterRepeat = document.getElementById('filterRepeat')?.checked ?? true;
    if (filterRepeat && data[0] === 0xF0 && data[1] === 0x42 && data[6] === 0x41) {
        // This is a Parameter Change message - skip logging the raw bytes
        // The parsed version will be logged below if it's not filtered
    } else {
        const devicePrefix = deviceName ? `[${deviceName}] ` : '';
        logMIDI(`${devicePrefix}RX: ${hex}`, 'receive');
    }

    // Parse SysEx messages
    if (data[0] === 0xF0) {
        if (data[1] === 0x7E && data[3] === 0x06 && data[4] === 0x02) {
            // Device Inquiry Reply
            // Format: F0 7E 0g 06 02 42 75 01 mm 00 ... F7
            // mm = Member ID: 00 = microAudio 22, 08 = microAudio 722
            const deviceChannel = data[2];
            const manufacturerId = data[5]; // Should be 0x42 (KORG)
            const familyLSB = data[6]; // Should be 0x75
            const familyMSB = data[7]; // Should be 0x01
            const memberLSB = data[8]; // 00 or 08

            logMIDI('✓ Device Inquiry Reply received!', 'success');

            if (manufacturerId === 0x42 && familyLSB === 0x75) {
                if (memberLSB === 0x08) {
                    logMIDI('✅ Detected: KORG microAudio 722', 'success');
                    // Auto-connect to this device
                    autoConnectDevice(deviceName);
                } else if (memberLSB === 0x00) {
                    logMIDI('✅ Detected: KORG microAudio 22', 'success');
                    // Auto-connect to this device
                    autoConnectDevice(deviceName);
                } else {
                    logMIDI(`Detected: KORG microAudio (Member ID: ${memberLSB.toString(16)})`, 'info');
                }
            } else {
                logMIDI(`Device: Mfr=${manufacturerId.toString(16)} Family=${familyLSB.toString(16)}`, 'info');
            }
        } else if (data[1] === 0x42 && data[2] === 0x50 && data[3] === 0x01) {
            // Search Device Reply
            logMIDI('Search Device Reply received!', 'info');
            const memberLSB = data[8];
            if (memberLSB === 0x08) {
                logMIDI('✓ Detected: microAudio 722', 'success');
            }
        } else if (data[1] === 0x42 && data.length >= 7) {
            // KORG SysEx message
            const channel = data[2] & 0x0F;
            const funcId = data[6];

            if (funcId === 0x41) {
                // Parameter Change message
                const paramId = data[7];
                const subId = data[8];
                const valueLSB = data[9];
                const valueMSB = data[10];

                const paramNames = {
                    0x40: 'LFO Rate Indicator',
                    0x41: 'Noise Gate Sens Indicator',
                    0x42: 'Fx Sens Indicator'
                };

                const paramName = paramNames[paramId] || `Param ${paramId.toString(16)}`;
                logMIDI(`Parameter Change: ${paramName} = LSB:${valueLSB} MSB:${valueMSB}`, 'info');
            } else if (funcId === 0x42) {
                // Mode Data response
                const mode = data[7];
                const modeName = mode === 0 ? 'Normal Mode' : 'Plugin Mode';
                logMIDI(`✓ Current Mode: ${modeName}`, 'success');

                if (mode === 1) {
                    logMIDI('⚠️ Device is in Plugin Mode - CC messages may not work! Try "Set Normal Mode"', 'error');
                }
            } else if (funcId === 0x01) {
                // Plugin Mode In/Out response
                const mode = data[7];
                const modeName = mode === 0 ? 'Normal Mode' : 'Plugin Mode';
                logMIDI(`✓ Mode changed to: ${modeName}`, 'success');
            } else if (funcId === 0x40) {
                // Data Dump response
                logMIDI('✓ Received Data Dump', 'success');

                // Store the raw dump for later modification
                lastDataDump = data;

                // The data is 7-bit encoded, need to decode
                const dumpData = data.slice(7, -1); // Skip header and F7
                logMIDI(`Data Dump: ${dumpData.length} bytes received`, 'info');

                // Decode the 7-bit packed data
                const decodedData = decode7bit(dumpData);

                if (decodedData.length >= 52) {
                    logMIDI('📥 Syncing UI with device state...', 'info');

                    // Offset 48 = Global MIDI Channel (0-15)
                    const globalChannel = decodedData[48];
                    logMIDI(`📍 Global MIDI Channel: ${globalChannel + 1}`, 'info');

                    // Auto-set our channel to match
                    const channelSelect = document.getElementById('midiChannel');
                    if (channelSelect && channelSelect.value != globalChannel) {
                        channelSelect.value = globalChannel;
                        midiChannel = globalChannel;
                        logMIDI(`✅ Auto-set controller to Channel ${globalChannel + 1}`, 'success');
                    }

                    // Offset 49 = Routing (0 = MIDI IF, 1 = Control)
                    const routing = decodedData[49];
                    const routingName = routing === 0 ? 'MIDI IF' : 'Control';
                    logMIDI(`📍 Current Routing: ${routingName}`, routing === 0 ? 'success' : 'error');

                    if (routing === 1) {
                        logMIDI('⚠️ Routing is set to "Control" - CC messages will be ignored!', 'error');
                        logMIDI('💡 Click "Fix Routing" button below to change to "MIDI IF"', 'info');

                        // Show the fix button
                        const fixBtn = document.getElementById('fixRouting');
                        if (fixBtn) fixBtn.style.display = 'block';
                    } else {
                        logMIDI('✓ Routing is correctly set to "MIDI IF"', 'success');
                        const fixBtn = document.getElementById('fixRouting');
                        if (fixBtn) fixBtn.style.display = 'none';
                    }

                    // Sync all UI controls with device state
                    syncUIFromDump(decodedData);
                    logMIDI('✅ UI synced with device settings', 'success');
                }
            }
        }
    }
}

// Log MIDI messages to UI
function logMIDI(message, type = 'info') {
    const logEl = document.getElementById('midiLog');
    if (!logEl) return;

    const filterRepeat = document.getElementById('filterRepeat')?.checked ?? true;

    // Filter ALL Parameter Change messages (they're just indicators, not responses to our CC)
    if (filterRepeat && message.includes('Parameter Change:')) {
        return;
    }

    // Filter raw RX messages that are parameter changes (F0 42 ... 41 ...)
    if (filterRepeat && type === 'receive' && message.includes('F0 42') && message.includes('41')) {
        return;
    }

    // Filter other repetitive messages
    if (filterRepeat && message === lastLogMessage && type === 'receive') {
        lastLogCount++;
        // Update the last line with count
        const lastLine = logEl.lastChild;
        if (lastLine) {
            const baseMessage = lastLogMessage;
            lastLine.textContent = lastLine.textContent.split(' (x')[0] + ` (x${lastLogCount + 1})`;
        }
        return;
    } else {
        lastLogMessage = message;
        lastLogCount = 0;
    }

    logEl.style.display = 'block';

    const timestamp = new Date().toLocaleTimeString();
    const color = {
        'send': '#0066FF',
        'receive': '#00FF00',
        'info': '#FFAA00',
        'success': '#00FF00',
        'error': '#FF0000'
    }[type] || '#AAAAAA';

    const line = document.createElement('div');
    line.style.color = color;
    line.textContent = `[${timestamp}] ${message}`;
    logEl.appendChild(line);

    // Auto-scroll to bottom
    logEl.scrollTop = logEl.scrollHeight;

    // Keep only last 100 lines
    while (logEl.children.length > 100) {
        logEl.removeChild(logEl.firstChild);
    }
}

// Update MIDI status display
function updateMIDIStatus(status, connected) {
    const statusEl = document.querySelector('#midiStatus');
    const span = statusEl.querySelector('span');
    span.textContent = status;

    if (connected) {
        statusEl.classList.add('connected');
    } else {
        statusEl.classList.remove('connected');
    }
}

// Populate MIDI output dropdown
function populateMIDIOutputs() {
    const select = document.getElementById('midiOutput');
    const currentValue = select.value;

    select.innerHTML = '<option value="">Select MIDI Output...</option>';

    if (midiAccess) {
        const outputs = Array.from(midiAccess.outputs.values());
        outputs.forEach(output => {
            const option = document.createElement('option');
            option.value = output.id;
            option.textContent = output.name;
            select.appendChild(option);
        });

        // Restore previous selection if still available
        if (currentValue && outputs.find(o => o.id === currentValue)) {
            select.value = currentValue;
        }
    }
}

// Send MIDI CC message
function sendCC(cc, value) {
    if (!selectedOutput) {
        console.warn('[MIDI] No output selected');
        return;
    }

    // MIDI CC message: [status, cc, value]
    // Status byte: 0xB0 + channel (0-15)
    const status = 0xB0 + midiChannel;
    const message = [status, cc, value];

    try {
        selectedOutput.send(message);
        const hex = message.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
        logMIDI(`TX: ${hex} (CC${cc}=${value}, Ch${midiChannel + 1})`, 'send');
        console.log(`[MIDI] Sent CC${cc} = ${value} on channel ${midiChannel + 1}`);
    } catch (error) {
        console.error('[MIDI] Failed to send message:', error);
        logMIDI(`Error: ${error.message}`, 'error');
    }
}

// Update connection indicator in banner
function updateConnectionIndicator(connected, deviceName = '') {
    const indicator = document.getElementById('connectionIndicator');
    const indicatorText = indicator?.querySelector('.indicator-text');

    if (indicator) {
        if (connected) {
            indicator.classList.add('connected');
            if (indicatorText) {
                indicatorText.textContent = deviceName || 'Connected';
            }
        } else {
            indicator.classList.remove('connected');
            if (indicatorText) {
                indicatorText.textContent = 'Disconnected';
            }
        }
    }
}

// Handle MIDI output selection
document.getElementById('midiOutput').addEventListener('change', (e) => {
    const outputId = e.target.value;
    if (outputId && midiAccess) {
        selectedOutput = midiAccess.outputs.get(outputId);
        console.log('[MIDI] Selected output:', selectedOutput.name);
        updateMIDIStatus(`Connected: ${selectedOutput.name}`, true);
        updateConnectionIndicator(true, selectedOutput.name);
    } else {
        selectedOutput = null;
        updateMIDIStatus('Ready', false);
        updateConnectionIndicator(false);
    }
});

// Handle MIDI channel selection
document.getElementById('midiChannel').addEventListener('change', (e) => {
    midiChannel = parseInt(e.target.value);
    console.log(`[MIDI] Channel changed to ${midiChannel + 1}`);
});

// Handle knob changes
document.addEventListener('cc-change', (e) => {
    const { cc, value } = e.detail;
    sendCC(cc, value);
});

// Handle select dropdowns
document.querySelectorAll('select[data-cc]').forEach(select => {
    select.addEventListener('change', (e) => {
        const cc = parseInt(e.target.dataset.cc);
        const value = parseInt(e.target.value);
        sendCC(cc, value);
    });
});

// Send Device Inquiry (Universal SysEx)
function sendDeviceInquiry() {
    if (!selectedOutput) {
        console.warn('[MIDI] No output selected');
        logMIDI('Error: No output selected', 'error');
        return;
    }

    // Device Inquiry: F0 7E nn 06 01 F7
    // nn = MIDI channel (0-F for channels 1-16, or 7F for any channel)
    const inquiry = [0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7];

    try {
        selectedOutput.send(inquiry);
        const hex = inquiry.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
        logMIDI(`TX: ${hex} (Device Inquiry)`, 'send');
        console.log('[MIDI] Sent Device Inquiry');
    } catch (error) {
        console.error('[MIDI] Failed to send Device Inquiry:', error);
        logMIDI(`Error: ${error.message}`, 'error');
    }
}

// Send Search Device Request (KORG specific)
function sendSearchDevice() {
    if (!selectedOutput) {
        console.warn('[MIDI] No output selected');
        logMIDI('Error: No output selected', 'error');
        return;
    }

    // Search Device: F0 42 50 00 dd F7
    // dd = Echo Back ID (arbitrary)
    const search = [0xF0, 0x42, 0x50, 0x00, 0x55, 0xF7];

    try {
        selectedOutput.send(search);
        const hex = search.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
        logMIDI(`TX: ${hex} (Search Device)`, 'send');
        console.log('[MIDI] Sent Search Device Request');
    } catch (error) {
        console.error('[MIDI] Failed to send Search Device:', error);
        logMIDI(`Error: ${error.message}`, 'error');
    }
}

// Request current mode (Normal or Plugin)
function sendModeRequest() {
    if (!selectedOutput) {
        console.warn('[MIDI] No output selected');
        logMIDI('Error: No output selected', 'error');
        return;
    }

    // Mode Request: F0 42 4g 00 01 75 12 F7
    // g = Global MIDI Channel (0 = Ch 1)
    const modeRequest = [0xF0, 0x42, 0x40, 0x00, 0x01, 0x75, 0x12, 0xF7];

    try {
        selectedOutput.send(modeRequest);
        const hex = modeRequest.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
        logMIDI(`TX: ${hex} (Mode Request)`, 'send');
        console.log('[MIDI] Sent Mode Request');
    } catch (error) {
        console.error('[MIDI] Failed to send Mode Request:', error);
        logMIDI(`Error: ${error.message}`, 'error');
    }
}

// Set Plugin Mode (00 = Out/Normal, 01 = In/Plugin)
function setPluginMode(mode) {
    if (!selectedOutput) {
        console.warn('[MIDI] No output selected');
        logMIDI('Error: No output selected', 'error');
        return;
    }

    // Plugin Mode Request: F0 42 4g 00 01 75 00 nn F7
    // g = Global MIDI Channel, nn = 00 (Normal) or 01 (Plugin)
    const pluginMode = [0xF0, 0x42, 0x40, 0x00, 0x01, 0x75, 0x00, mode, 0xF7];

    try {
        selectedOutput.send(pluginMode);
        const hex = pluginMode.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
        const modeName = mode === 0 ? 'Normal' : 'Plugin';
        logMIDI(`TX: ${hex} (Set ${modeName} Mode)`, 'send');
        console.log(`[MIDI] Set ${modeName} Mode`);
    } catch (error) {
        console.error('[MIDI] Failed to set Plugin Mode:', error);
        logMIDI(`Error: ${error.message}`, 'error');
    }
}

// Request Data Dump
function requestDataDump() {
    if (!selectedOutput) {
        console.warn('[MIDI] No output selected');
        logMIDI('Error: No output selected', 'error');
        return;
    }

    // Data Dump Request: F0 42 4g 00 01 75 10 F7
    const dataDumpReq = [0xF0, 0x42, 0x40, 0x00, 0x01, 0x75, 0x10, 0xF7];

    try {
        selectedOutput.send(dataDumpReq);
        const hex = dataDumpReq.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
        logMIDI(`TX: ${hex} (Data Dump Request)`, 'send');
        console.log('[MIDI] Sent Data Dump Request');
    } catch (error) {
        console.error('[MIDI] Failed to send Data Dump Request:', error);
        logMIDI(`Error: ${error.message}`, 'error');
    }
}

// Sync UI controls with data from device dump
function syncUIFromDump(decodedData) {
    // Silence change events temporarily to avoid sending CC back
    const originalSendCC = window.sendCC;
    let silentMode = true;

    // Filter Section
    if (decodedData[0] !== undefined) {
        const cutoffKnob = document.querySelector('pad-knob[cc="21"]');
        if (cutoffKnob) cutoffKnob.setAttribute('value', decodedData[0]);
    }

    if (decodedData[4] !== undefined) {
        const resonanceKnob = document.querySelector('pad-knob[cc="25"]');
        if (resonanceKnob) resonanceKnob.setAttribute('value', decodedData[4]);
    }

    if (decodedData[5] !== undefined) {
        const filterType = document.getElementById('filterType');
        if (filterType) filterType.value = decodedData[5];
        const filterNames = ['LPF', 'Bypass', 'HPF'];
        logMIDI(`  Filter Type: ${filterNames[decodedData[5]] || decodedData[5]}`, 'info');
    }

    if (decodedData[1] !== undefined) {
        const inUsbSelect = document.getElementById('inUsbSelect');
        if (inUsbSelect) inUsbSelect.value = decodedData[1] === 0 ? '0' : '127';
    }

    if (decodedData[2] !== undefined) {
        const inputChannel = document.getElementById('inputChannel');
        if (inputChannel) inputChannel.value = decodedData[2];
    }

    if (decodedData[3] !== undefined) {
        const usbChannel = document.getElementById('usbChannel');
        if (usbChannel) usbChannel.value = decodedData[3];
    }

    // LFO Section
    if (decodedData[6] !== undefined) {
        const lfoRateKnob = document.querySelector('pad-knob[cc="27"]');
        if (lfoRateKnob) lfoRateKnob.setAttribute('value', decodedData[6]);
    }

    if (decodedData[8] !== undefined) {
        const lfoIntensityKnob = document.querySelector('pad-knob[cc="29"]');
        if (lfoIntensityKnob) lfoIntensityKnob.setAttribute('value', decodedData[8]);
    }

    if (decodedData[10] !== undefined) {
        const lfoWave = document.getElementById('lfoWave');
        if (lfoWave) lfoWave.value = decodedData[10];
    }

    if (decodedData[7] !== undefined) {
        const lfoSync = document.getElementById('lfoSync');
        if (lfoSync) lfoSync.value = decodedData[7] === 0 ? '0' : '127';
    }

    if (decodedData[13] !== undefined) {
        const lfoRateRange = document.getElementById('lfoRateRange');
        if (lfoRateRange) lfoRateRange.value = decodedData[13] === 0 ? '0' : '127';
    }

    if (decodedData[9] !== undefined) {
        const lfoEnvSelect = document.getElementById('lfoEnvSelect');
        if (lfoEnvSelect) lfoEnvSelect.value = decodedData[9] === 0 ? '0' : '127';
    }

    // Envelope Section
    if (decodedData[11] !== undefined) {
        const envInputGainKnob = document.querySelector('pad-knob[cc="33"]');
        if (envInputGainKnob) envInputGainKnob.setAttribute('value', decodedData[11]);
    }

    if (decodedData[12] !== undefined) {
        const envRateKnob = document.querySelector('pad-knob[cc="58"]');
        if (envRateKnob) envRateKnob.setAttribute('value', decodedData[12]);
    }

    // FX Routing & Link
    if (decodedData[16] !== undefined) {
        const fxRouting = document.getElementById('fxRouting');
        if (fxRouting) fxRouting.value = decodedData[16] === 0 ? '0' : '127';
    }

    if (decodedData[51] !== undefined) {
        const stereoLink = document.getElementById('stereoLink');
        if (stereoLink) stereoLink.value = decodedData[51] === 0 ? '0' : '127';
    }

    // Channel 1 Noise Gate
    if (decodedData[26] !== undefined) {
        const ch1GateSensKnob = document.querySelector('pad-knob[cc="37"]');
        if (ch1GateSensKnob) ch1GateSensKnob.setAttribute('value', decodedData[26]);
    }

    if (decodedData[27] !== undefined) {
        const ch1GateReleaseKnob = document.querySelector('pad-knob[cc="38"]');
        if (ch1GateReleaseKnob) ch1GateReleaseKnob.setAttribute('value', decodedData[27]);
    }

    if (decodedData[24] !== undefined) {
        const ch1GateOnOff = document.getElementById('ch1GateOnOff');
        if (ch1GateOnOff) ch1GateOnOff.value = decodedData[24] === 0 ? '0' : '127';
    }

    if (decodedData[25] !== undefined) {
        const ch1GateType = document.getElementById('ch1GateType');
        if (ch1GateType) ch1GateType.value = decodedData[25] === 0 ? '0' : '127';
    }

    // Channel 2 Noise Gate
    if (decodedData[30] !== undefined) {
        const ch2GateSensKnob = document.querySelector('pad-knob[cc="41"]');
        if (ch2GateSensKnob) ch2GateSensKnob.setAttribute('value', decodedData[30]);
    }

    if (decodedData[31] !== undefined) {
        const ch2GateReleaseKnob = document.querySelector('pad-knob[cc="42"]');
        if (ch2GateReleaseKnob) ch2GateReleaseKnob.setAttribute('value', decodedData[31]);
    }

    if (decodedData[28] !== undefined) {
        const ch2GateOnOff = document.getElementById('ch2GateOnOff');
        if (ch2GateOnOff) ch2GateOnOff.value = decodedData[28] === 0 ? '0' : '127';
    }

    if (decodedData[29] !== undefined) {
        const ch2GateType = document.getElementById('ch2GateType');
        if (ch2GateType) ch2GateType.value = decodedData[29] === 0 ? '0' : '127';
    }

    // Channel 1 Comp/Limiter
    if (decodedData[35] !== undefined) {
        const ch1CompAttackKnob = document.querySelector('pad-knob[cc="46"]');
        if (ch1CompAttackKnob) ch1CompAttackKnob.setAttribute('value', decodedData[35]);
    }

    if (decodedData[36] !== undefined) {
        const ch1CompSensKnob = document.querySelector('pad-knob[cc="47"]');
        if (ch1CompSensKnob) ch1CompSensKnob.setAttribute('value', decodedData[36]);
    }

    if (decodedData[32] !== undefined) {
        const ch1CompSelect = document.getElementById('ch1CompSelect');
        if (ch1CompSelect) ch1CompSelect.value = decodedData[32] === 0 ? '0' : '127';
    }

    if (decodedData[33] !== undefined) {
        const ch1CompOnOff = document.getElementById('ch1CompOnOff');
        if (ch1CompOnOff) ch1CompOnOff.value = decodedData[33] === 0 ? '0' : '127';
    }

    if (decodedData[34] !== undefined) {
        const ch1CompType = document.getElementById('ch1CompType');
        if (ch1CompType) ch1CompType.value = decodedData[34] === 0 ? '0' : '127';
    }

    // Channel 2 Comp/Limiter
    if (decodedData[40] !== undefined) {
        const ch2CompAttackKnob = document.querySelector('pad-knob[cc="51"]');
        if (ch2CompAttackKnob) ch2CompAttackKnob.setAttribute('value', decodedData[40]);
    }

    if (decodedData[41] !== undefined) {
        const ch2CompSensKnob = document.querySelector('pad-knob[cc="52"]');
        if (ch2CompSensKnob) ch2CompSensKnob.setAttribute('value', decodedData[41]);
    }

    if (decodedData[37] !== undefined) {
        const ch2CompSelect = document.getElementById('ch2CompSelect');
        if (ch2CompSelect) ch2CompSelect.value = decodedData[37] === 0 ? '0' : '127';
    }

    if (decodedData[38] !== undefined) {
        const ch2CompOnOff = document.getElementById('ch2CompOnOff');
        if (ch2CompOnOff) ch2CompOnOff.value = decodedData[38] === 0 ? '0' : '127';
    }

    if (decodedData[39] !== undefined) {
        const ch2CompType = document.getElementById('ch2CompType');
        if (ch2CompType) ch2CompType.value = decodedData[39] === 0 ? '0' : '127';
    }
}

// Decode 7-bit packed MIDI data to 8-bit
function decode7bit(encodedData) {
    const decoded = [];
    for (let i = 0; i < encodedData.length; i += 8) {
        const msbByte = encodedData[i];
        for (let j = 0; j < 7 && (i + j + 1) < encodedData.length; j++) {
            const lsb = encodedData[i + j + 1];
            const msb = (msbByte >> (6 - j)) & 1;
            decoded.push((msb << 7) | lsb);
        }
    }
    return decoded;
}

// Encode 8-bit data to 7-bit packed MIDI data
function encode7bit(data) {
    const encoded = [];
    for (let i = 0; i < data.length; i += 7) {
        let msbByte = 0;
        const group = [];
        for (let j = 0; j < 7 && (i + j) < data.length; j++) {
            const byte = data[i + j];
            msbByte |= ((byte >> 7) & 1) << (6 - j);
            group.push(byte & 0x7F);
        }
        encoded.push(msbByte);
        encoded.push(...group);
    }
    return encoded;
}

// Fix Routing setting by modifying and resending data dump
function fixRouting() {
    if (!selectedOutput) {
        logMIDI('Error: No output selected', 'error');
        return;
    }

    if (!lastDataDump) {
        logMIDI('Error: No data dump available. Click "Request Settings Dump" first.', 'error');
        return;
    }

    logMIDI('🔧 Modifying Routing to "MIDI IF"...', 'info');

    // Decode the dump
    const dumpData = lastDataDump.slice(7, -1);
    const decoded = decode7bit(dumpData);

    // Modify offset 49 (Routing) to 0 (MIDI IF)
    decoded[49] = 0;

    // Re-encode
    const encoded = encode7bit(decoded);

    // Build new data dump message
    const dataDump = [0xF0, 0x42, 0x40, 0x00, 0x01, 0x75, 0x40, ...encoded, 0xF7];

    try {
        // Send the modified data dump
        selectedOutput.send(dataDump);
        logMIDI('✓ Sent modified data dump', 'send');

        // Wait a bit, then send write request
        setTimeout(() => {
            const writeReq = [0xF0, 0x42, 0x40, 0x00, 0x01, 0x75, 0x11, 0xF7];
            selectedOutput.send(writeReq);
            logMIDI('✓ Sent write request', 'send');
            logMIDI('✅ Routing should now be set to "MIDI IF"! Try adjusting controls.', 'success');

            // Hide the fix button
            const fixBtn = document.getElementById('fixRouting');
            if (fixBtn) fixBtn.style.display = 'none';
        }, 100);

    } catch (error) {
        logMIDI(`Error: ${error.message}`, 'error');
    }
}

// Auto-detect microAudio device on startup
async function autoDetectDevice() {
    if (!midiAccess) {
        return;
    }

    const outputs = Array.from(midiAccess.outputs.values());
    if (outputs.length === 0) {
        return;
    }

    console.log('[MIDI] Auto-detecting microAudio device...');

    // Send Device Inquiry to all outputs
    const inquiry = [0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7];

    for (const output of outputs) {
        try {
            output.send(inquiry);
        } catch (error) {
            console.error(`[MIDI] Failed to query ${output.name}:`, error);
        }
    }
}

// Auto-connect to the detected device
function autoConnectDevice(inputDeviceName) {
    if (!midiAccess) return;

    // Find matching output by name (input and output usually have same/similar names)
    const outputs = Array.from(midiAccess.outputs.values());

    // Try exact match first
    let matchingOutput = outputs.find(output => output.name === inputDeviceName);

    // If no exact match, try partial match (e.g., "microAUDIO" matches "microAUDIO")
    if (!matchingOutput) {
        matchingOutput = outputs.find(output =>
            output.name.toLowerCase().includes('microaudio') &&
            !output.name.toLowerCase().includes('midiout2')
        );
    }

    if (matchingOutput) {
        // Select in dropdown
        const select = document.getElementById('midiOutput');
        if (select) {
            select.value = matchingOutput.id;
            selectedOutput = matchingOutput;
            updateMIDIStatus(`Connected: ${matchingOutput.name}`, true);
            updateConnectionIndicator(true, matchingOutput.name);
        }

        logMIDI(`✅ Auto-connected to: ${matchingOutput.name}`, 'success');
        console.log('[MIDI] Auto-connected to:', matchingOutput.name);

        // Auto-request settings dump to sync UI
        setTimeout(() => {
            requestDataDump();
        }, 1000);
    }
}

// Scan all MIDI outputs to find microAudio 722
async function scanAllDevices() {
    if (!midiAccess) {
        logMIDI('Error: MIDI not initialized', 'error');
        return;
    }

    const outputs = Array.from(midiAccess.outputs.values());
    if (outputs.length === 0) {
        logMIDI('Error: No MIDI outputs found', 'error');
        return;
    }

    logMIDI(`🔍 Scanning ${outputs.length} MIDI output(s)...`, 'info');

    // Send Device Inquiry to all outputs
    const inquiry = [0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7];

    for (const output of outputs) {
        try {
            output.send(inquiry);
            logMIDI(`Sent inquiry to: ${output.name}`, 'info');
        } catch (error) {
            logMIDI(`Failed to send to ${output.name}: ${error.message}`, 'error');
        }
    }

    logMIDI('✓ Scan complete. Check for replies above.', 'success');
}

// Menu toggle functionality
function setupMenu() {
    const menuBtn = document.getElementById('menu-btn');
    const closeMenu = document.getElementById('close-menu');
    const navMenu = document.getElementById('nav-menu');
    const navOverlay = document.getElementById('nav-overlay');

    function openMenu() {
        navMenu.classList.add('active');
        navOverlay.classList.add('active');
    }

    function closeMenuFunc() {
        navMenu.classList.remove('active');
        navOverlay.classList.remove('active');
    }

    menuBtn?.addEventListener('click', openMenu);
    closeMenu?.addEventListener('click', closeMenuFunc);
    navOverlay?.addEventListener('click', closeMenuFunc);

    // Close menu on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeMenuFunc();
        }
    });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    console.log('[Controller] Initializing microAudio 722 Controller');
    setupMenu();
    initMIDI();

    // Hook up test buttons
    document.getElementById('testDeviceInquiry')?.addEventListener('click', () => {
        sendDeviceInquiry();
    });

    document.getElementById('testSearchDevice')?.addEventListener('click', () => {
        sendSearchDevice();
    });

    document.getElementById('testModeRequest')?.addEventListener('click', () => {
        sendModeRequest();
    });

    document.getElementById('setNormalMode')?.addEventListener('click', () => {
        setPluginMode(0); // 0 = Normal Mode
    });

    document.getElementById('clearLog')?.addEventListener('click', () => {
        const logEl = document.getElementById('midiLog');
        if (logEl) {
            logEl.innerHTML = '';
            logEl.style.display = 'none';
        }
        lastLogMessage = '';
        lastLogCount = 0;
    });

    document.getElementById('requestDataDump')?.addEventListener('click', () => {
        requestDataDump();
    });

    document.getElementById('scanAllDevices')?.addEventListener('click', () => {
        scanAllDevices();
    });

    document.getElementById('fixRouting')?.addEventListener('click', () => {
        fixRouting();
    });
});
