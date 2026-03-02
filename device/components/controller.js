/**
 * Generic MIDI Device Controller
 * Dynamically generates UI from device definitions
 */

let midiAccess = null;
let selectedOutput = null;
let midiChannel = 0;
let deviceId = 0;  // For devices that use SysEx device IDs (like Regroove)
let deviceLoader = null;
let lastLogMessage = '';
let lastLogCount = 0;

// MIDI Learn state
let midiLearnMode = false;
let midiLearnTarget = null;  // { element, cc, label, isNRPN, nrpnMsb, nrpnLsb, is14bit }
let midiLearnInputFilter = null;  // Selected MIDI input for learning (null = any)

// Hardware MIDI controller mappings
let hardwareMappings = {};  // { hardwareCC: {targetCC or targetNRPN, targetLabel, isNRPN, ...} }

// Motion sequencer
let motionSequencer = null;

// Track held parameters (prevent motion override)
const heldParameters = new Set();
const holdTimeouts = new Map();

// Auto-sync interval
let autoSyncInterval = null;
let autoSyncEnabled = true;

// Flag to prevent UI regeneration during focus sync
let isFocusSync = false;

// Debounce sync requests (prevent duplicate calls within 2 seconds)
let lastSyncRequest = 0;

// Prevent duplicate auto-connection
let hasAutoConnected = false;
let lastDeviceInquiryTime = 0;
let processingDeviceInquiry = false;
let autoDetectInProgress = false;

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    console.log('[Controller] Initializing Generic MIDI Controller');

    // Load device definitions
    deviceLoader = new DeviceLoader();
    await deviceLoader.loadAllDevices();

    // Populate device selector
    populateDeviceSelector();

    // Setup menu and MIDI
    setupMenu();
    initMIDI();

    // Sync when window gains focus
    let lastFocusSync = 0;
    window.addEventListener('focus', () => {
        if (!selectedOutput) return;

        const device = deviceLoader.getCurrentDevice();
        if (!device || !device.bulkDumpFormat) return;

        // Throttle to once per 3 seconds
        const now = Date.now();
        if (now - lastFocusSync < 3000) return;
        lastFocusSync = now;

        // Just sync parameters, don't send device inquiry
        syncFromDevice(true); // Silent mode
    });

    // Initialize motion sequencer
    motionSequencer = document.getElementById('motionSequencer');

    // Setup event listeners
    document.getElementById('deviceSelect')?.addEventListener('change', handleDeviceChange);
    document.getElementById('midiOutput')?.addEventListener('change', handleMIDIOutputChange);
    document.getElementById('midiChannel')?.addEventListener('change', handleChannelChange);
    document.getElementById('scanDevices')?.addEventListener('click', scanAllDevices);
    document.getElementById('testDeviceInquiry')?.addEventListener('click', sendDeviceInquiry);
    document.getElementById('syncFromDevice')?.addEventListener('click', () => syncFromDevice());
    document.getElementById('autoSyncCheckbox')?.addEventListener('change', toggleAutoSync);
    document.getElementById('clearLog')?.addEventListener('click', clearLog);
    document.getElementById('midiLearnBtn')?.addEventListener('click', toggleMIDILearn);
    document.getElementById('clearMappingsBtn')?.addEventListener('click', clearHardwareMappings);
    document.getElementById('learnInputSelect')?.addEventListener('change', handleLearnInputChange);

    // Listen for CC change events
    document.addEventListener('cc-change', (e) => {
        const { cc, value } = e.detail;
        const element = e.target;

        // Check if this is an NRPN control
        if (element.dataset && element.dataset.nrpnMsb !== undefined) {
            const msb = parseInt(element.dataset.nrpnMsb);
            const lsb = parseInt(element.dataset.nrpnLsb);
            const is14bit = element.dataset.is14bit === 'true';
            const nrpnId = `nrpn:${msb}:${lsb}`;

            // Mark as held
            heldParameters.add(nrpnId);
            if (holdTimeouts.has(nrpnId)) {
                clearTimeout(holdTimeouts.get(nrpnId));
            }
            holdTimeouts.set(nrpnId, setTimeout(() => {
                heldParameters.delete(nrpnId);
                holdTimeouts.delete(nrpnId);
            }, 200));

            sendNRPN(msb, lsb, value, is14bit);

            // Record NRPN motion if sequencer is recording
            if (motionSequencer && motionSequencer.pattern?.recordingMotion) {
                motionSequencer.recordMotion(nrpnId, value);
            }
        } else {
            // Regular CC control
            // Mark as held
            heldParameters.add(cc);
            if (holdTimeouts.has(cc)) {
                clearTimeout(holdTimeouts.get(cc));
            }
            holdTimeouts.set(cc, setTimeout(() => {
                heldParameters.delete(cc);
                holdTimeouts.delete(cc);
            }, 200));

            // Check if this control has custom SysEx (like Regroove effects)
            if (element.dataset && element.dataset.sysex) {
                sendKnobSysEx(element.dataset.sysex, cc, value);
            } else {
                sendCC(cc, value);
            }

            // Broadcast to all windows (including popups)
            uiSyncChannel.postMessage({ type: 'cc-update', cc, value });

            // Record motion if sequencer is recording
            if (motionSequencer && motionSequencer.pattern?.recordingMotion) {
                motionSequencer.recordMotion(cc, value);
            }
        }
    });
});

// Populate device selector dropdown
function populateDeviceSelector() {
    const select = document.getElementById('deviceSelect');
    if (!select) return;

    select.innerHTML = '<option value="">Select a device...</option>';

    const devices = deviceLoader.getAllDevices();
    devices.forEach(device => {
        const option = document.createElement('option');
        option.value = device.id;
        option.textContent = device.name;
        select.appendChild(option);
    });
}

// Handle device selection change
function handleDeviceChange(e) {
    const deviceId = e.target.value;
    if (!deviceId) {
        clearDeviceUI();
        return;
    }

    const previousDevice = deviceLoader.getCurrentDevice();
    deviceLoader.setCurrentDevice(deviceId);
    const device = deviceLoader.getCurrentDevice();

    // Store device info globally for motion sequencer export
    window.currentDeviceId = device.id;
    window.currentDeviceName = device.name;

    console.log('[Controller] Selected device:', device.name);
    logMIDI(`Selected device: ${device.name}`, 'info');

    // Generate UI for the device
    generateDeviceUI(device);

    // Setup motion sequencer for this device
    setupMotionSequencer(device);

    // Update parameter manager with current device
    if (window.parameterManager) {
        window.parameterManager.setDevice(device);
    }

    // Always sync from device if it has bulk dump support
    if (selectedOutput && device.bulkDumpFormat) {
        setTimeout(() => {
            syncFromDevice();
            // Only start auto-sync if device has deviceInquiry
            if (device.deviceInquiry) {
                startAutoSync();
            }
        }, 1000);
    }
}

// Generate UI from device definition
function generateDeviceUI(device) {
    const container = document.getElementById('deviceControls');
    if (!container) return;

    // Clear existing content
    container.innerHTML = '';

    // Create sections
    device.sections.forEach(section => {
        const sectionEl = createSection(section);
        container.appendChild(sectionEl);
    });

    console.log(`[Controller] Generated UI for ${device.name}`);
}

// Track popup windows
const sectionPopups = new Map();

// BroadcastChannel for cross-window UI sync
const uiSyncChannel = new BroadcastChannel('midi-ui-sync');
uiSyncChannel.onmessage = (event) => {
    if (event.data.type === 'popup-cc-change') {
        // Popup changed a knob - send MIDI and update all windows
        const { cc, value } = event.data;

        // Mark as held parameter
        heldParameters.add(cc);
        if (holdTimeouts.has(cc)) {
            clearTimeout(holdTimeouts.get(cc));
        }
        holdTimeouts.set(cc, setTimeout(() => {
            heldParameters.delete(cc);
            holdTimeouts.delete(cc);
        }, 200));

        // Send MIDI
        sendCC(cc, value, false);

        // Record motion if sequencer is recording
        if (motionSequencer && motionSequencer.pattern?.recordingMotion) {
            motionSequencer.recordMotion(cc, value);
        }

        // Update main window UI
        const knob = document.querySelector(`pad-knob[cc="${cc}"]`);
        if (knob) {
            knob.setAttribute('value', value);
        }
        const select = document.querySelector(`select[data-cc="${cc}"]`);
        if (select) {
            select.value = value;
        }
        // Update xy-pad (check both x-cc and y-cc)
        const xyPadX = document.querySelector(`xy-pad[x-cc="${cc}"]`);
        if (xyPadX) {
            xyPadX.setAttribute('x-value', value);
        }
        const xyPadY = document.querySelector(`xy-pad[y-cc="${cc}"]`);
        if (xyPadY) {
            xyPadY.setAttribute('y-value', value);
        }

        // Broadcast update to all OTHER windows (popups)
        uiSyncChannel.postMessage({ type: 'cc-update', cc, value });
    } else if (event.data.type === 'popup-pad-trigger') {
        // Popup triggered a pad - send MIDI and update all windows
        const { label, sysex, toggle, pressed } = event.data;

        // Find the main pad
        const mainPad = document.querySelector(`trigger-pad[label="${label}"]`);
        if (mainPad) {
            // Simulate the pad trigger by calling the same logic
            if (!selectedOutput) return;

            // For toggle pads, only trigger on press
            if (toggle && !pressed) return;
            // For non-toggle pads, only send on press
            if (!toggle && !pressed) return;

            if (sysex) {
                let sysexStr = sysex.trim();

                // Handle toggle value substitution
                if (toggle && mainPad.dataset.toggle) {
                    const currentState = parseInt(mainPad.dataset.toggleState || '0');
                    const newState = currentState === 0 ? 1 : 0;
                    mainPad.dataset.toggleState = newState.toString();

                    sysexStr = sysexStr.replace('{VALUE}', newState.toString(16).toUpperCase().padStart(2, '0'));

                    // Update visual state in main window
                    if (newState === 1) {
                        mainPad.setAttribute('active', '');
                    } else {
                        mainPad.removeAttribute('active');
                    }

                    // Broadcast state to all popups
                    uiSyncChannel.postMessage({ type: 'pad-state-update', label, active: newState === 1 });
                }

                // Replace templates
                sysexStr = sysexStr.replace(/\{DEVICE_ID\}/g, deviceId.toString(16).toUpperCase().padStart(2, '0'));
                sysexStr = sysexStr.replace(/\{CC(\d+)\}/g, (match, ccNum) => {
                    const knob = document.querySelector(`pad-knob[cc="${ccNum}"]`);
                    const value = knob ? parseInt(knob.getAttribute('value')) || 64 : 64;
                    return value.toString(16).toUpperCase().padStart(2, '0');
                });
                sysexStr = sysexStr.replace(/\{VALUE\}/g, '00');

                // Parse and send
                const bytes = sysexStr.split(' ').map(b => parseInt(b, 16));
                selectedOutput.send(bytes);
                logMIDI(`TX Pad ${label}: ${sysexStr}`, 'send');
            }
        }
    } else if (event.data.type === 'cc-update') {
        // Another window sent an update - just update UI
        const { cc, value } = event.data;
        // Update knob
        const knob = document.querySelector(`pad-knob[cc="${cc}"]`);
        if (knob) {
            knob.setAttribute('value', value);
        }
        // Update select
        const select = document.querySelector(`select[data-cc="${cc}"]`);
        if (select) {
            select.value = value;
        }
        // Update xy-pad (check both x-cc and y-cc)
        const xyPadX = document.querySelector(`xy-pad[x-cc="${cc}"]`);
        if (xyPadX) {
            xyPadX.setAttribute('x-value', value);
        }
        const xyPadY = document.querySelector(`xy-pad[y-cc="${cc}"]`);
        if (xyPadY) {
            xyPadY.setAttribute('y-value', value);
        }
    }
};


// Pop out section to new window
function popOutSection(mainSection, sectionDef) {
    const sectionId = sectionDef.title.replace(/\s+/g, '-');

    // Don't open duplicate popups
    if (sectionPopups.has(sectionId) && !sectionPopups.get(sectionId).closed) {
        sectionPopups.get(sectionId).focus();
        return;
    }

    const popup = window.open('', `section_${sectionId}`, 'width=500,height=600,resizable=yes,scrollbars=yes,location=no,menubar=no,status=no,toolbar=no');
    if (!popup) {
        alert('Pop-up blocked! Please allow pop-ups for this site.');
        return;
    }

    popup.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>${sectionDef.title} - MIDI Controller</title>
            <link rel="stylesheet" href="style.css">
            <script src="components/pad-knob.js"></script>
            <script src="components/trigger-pad.js"></script>
            <script src="components/xy-pad.js"></script>
            <script>
                // Setup BroadcastChannel to receive UI updates
                const uiSyncChannel = new BroadcastChannel('midi-ui-sync');
                uiSyncChannel.onmessage = (event) => {
                    if (event.data.type === 'cc-update') {
                        const { cc, value } = event.data;
                        // Update knob
                        const knob = document.querySelector(\`pad-knob[cc="\${cc}"]\`);
                        if (knob) {
                            knob.setAttribute('value', value);
                        }
                        // Update select
                        const select = document.querySelector(\`select[data-cc="\${cc}"]\`);
                        if (select) {
                            select.value = value;
                        }
                        // Update xy-pad (check both x-cc and y-cc)
                        const xyPadX = document.querySelector(\`xy-pad[x-cc="\${cc}"]\`);
                        if (xyPadX) {
                            xyPadX.setAttribute('x-value', value);
                        }
                        const xyPadY = document.querySelector(\`xy-pad[y-cc="\${cc}"]\`);
                        if (xyPadY) {
                            xyPadY.setAttribute('y-value', value);
                        }
                    }
                    if (event.data.type === 'pad-state-update') {
                        const { label, active } = event.data;
                        // Update pad active state
                        const pad = document.querySelector(\`trigger-pad[label="\${label}"]\`);
                        if (pad) {
                            if (active) {
                                pad.setAttribute('active', '');
                            } else {
                                pad.removeAttribute('active');
                            }
                        }
                    }
                };
            </script>
        </head>
        <body style="margin: 0; padding: 20px; background: #0a0a0a;">
            <div id="popupContent" class="section"></div>
        </body>
        </html>
    `);
    popup.document.close();

    // Wait for popup to load
    popup.addEventListener('load', () => {
        const popupContent = popup.document.getElementById('popupContent');

        // Add title
        const titleEl = popup.document.createElement('div');
        titleEl.className = 'section-title';
        titleEl.textContent = sectionDef.title;
        popupContent.appendChild(titleEl);

        // Create controls container
        const controlsContainer = popup.document.createElement('div');

        // Separate knobs, pads, xy-pads, and other controls
        const knobs = sectionDef.controls.filter(c => c.type === 'knob' || c.type === 'knob-14bit' || c.type === 'nrpn');
        const pads = sectionDef.controls.filter(c => c.type === 'pad');
        const xyPads = sectionDef.controls.filter(c => c.type === 'xy-pad');
        const others = sectionDef.controls.filter(c => c.type !== 'knob' && c.type !== 'knob-14bit' && c.type !== 'nrpn' && c.type !== 'pad' && c.type !== 'xy-pad');

        // Add knobs in a grid
        if (knobs.length > 0) {
            const knobGrid = popup.document.createElement('div');
            knobGrid.className = 'knob-grid';
            knobGrid.style.gridTemplateColumns = `repeat(${Math.min(knobs.length, 4)}, 1fr)`;

            knobs.forEach(controlDef => {
                const knob = popup.document.createElement('pad-knob');
                knob.setAttribute('label', controlDef.label);
                knob.setAttribute('cc', controlDef.cc);
                knob.setAttribute('min', controlDef.min || 0);
                knob.setAttribute('max', controlDef.max || 127);
                knob.setAttribute('default', controlDef.default || 64);

                // Get current value from main section
                const mainKnob = mainSection.querySelector(`pad-knob[cc="${controlDef.cc}"]`);
                if (mainKnob) {
                    const currentValue = mainKnob.getAttribute('value');
                    if (currentValue) {
                        knob.setAttribute('value', currentValue);
                    }
                }

                // Send via BroadcastChannel to trigger MIDI send in main window
                knob.addEventListener('cc-change', (e) => {
                    const channel = new BroadcastChannel('midi-ui-sync');
                    channel.postMessage({
                        type: 'popup-cc-change',
                        cc: e.detail.cc,
                        value: e.detail.value
                    });
                    channel.close();
                });

                knobGrid.appendChild(knob);
            });

            controlsContainer.appendChild(knobGrid);
        }

        // Add pads in a grid
        if (pads.length > 0) {
            const padGrid = popup.document.createElement('div');
            padGrid.className = 'knob-grid';
            padGrid.style.gridTemplateColumns = `repeat(${Math.min(pads.length, 4)}, 1fr)`;
            padGrid.style.marginTop = knobs.length > 0 ? '15px' : '0';

            pads.forEach(controlDef => {
                const pad = popup.document.createElement('trigger-pad');
                pad.setAttribute('label', controlDef.label);

                if (controlDef.note) {
                    pad.setAttribute('note', controlDef.note);
                }

                if (controlDef.sysex) {
                    pad.setAttribute('sysex', controlDef.sysex);
                }

                // Store toggle state if this is a toggle pad
                if (controlDef.toggle) {
                    pad.dataset.toggle = 'true';
                    pad.dataset.toggleState = '0';

                    // Get current state from main section
                    const mainPad = mainSection.querySelector(`trigger-pad[label="${controlDef.label}"]`);
                    if (mainPad && mainPad.dataset.toggleState) {
                        pad.dataset.toggleState = mainPad.dataset.toggleState;
                        if (mainPad.dataset.toggleState === '1') {
                            pad.setAttribute('active', '');
                        }
                    }
                }

                // Send via BroadcastChannel to trigger MIDI send in main window
                pad.addEventListener('pad-trigger', (e) => {
                    const channel = new BroadcastChannel('midi-ui-sync');
                    channel.postMessage({
                        type: 'popup-pad-trigger',
                        label: controlDef.label,
                        sysex: controlDef.sysex,
                        toggle: controlDef.toggle,
                        pressed: e.detail.pressed
                    });
                    channel.close();
                });

                padGrid.appendChild(pad);
            });

            controlsContainer.appendChild(padGrid);
        }

        // Add XY pads in a grid
        if (xyPads.length > 0) {
            const xyPadGrid = popup.document.createElement('div');
            xyPadGrid.className = 'knob-grid';
            xyPadGrid.style.gridTemplateColumns = `repeat(${Math.min(xyPads.length, 2)}, 1fr)`;
            xyPadGrid.style.marginTop = (knobs.length > 0 || pads.length > 0) ? '15px' : '0';

            xyPads.forEach(controlDef => {
                const xyPad = popup.document.createElement('xy-pad');
                xyPad.setAttribute('label', controlDef.label);
                xyPad.setAttribute('x-cc', controlDef.xCC);
                xyPad.setAttribute('y-cc', controlDef.yCC);

                // Get current values from main section
                const mainXYPad = mainSection.querySelector(`xy-pad[x-cc="${controlDef.xCC}"][y-cc="${controlDef.yCC}"]`);
                if (mainXYPad) {
                    const xValue = mainXYPad.getAttribute('x-value') || controlDef.xDefault || 64;
                    const yValue = mainXYPad.getAttribute('y-value') || controlDef.yDefault || 64;
                    xyPad.setAttribute('x-value', xValue);
                    xyPad.setAttribute('y-value', yValue);
                } else {
                    xyPad.setAttribute('x-value', controlDef.xDefault || 64);
                    xyPad.setAttribute('y-value', controlDef.yDefault || 64);
                }

                // Send via BroadcastChannel to trigger MIDI send in main window
                xyPad.addEventListener('cc-change', (e) => {
                    const channel = new BroadcastChannel('midi-ui-sync');
                    channel.postMessage({
                        type: 'popup-cc-change',
                        cc: e.detail.cc,
                        value: e.detail.value
                    });
                    channel.close();
                });

                xyPadGrid.appendChild(xyPad);
            });

            controlsContainer.appendChild(xyPadGrid);
        }

        // Add other controls
        if (others.length > 0) {
            const controlRow = popup.document.createElement('div');
            controlRow.className = 'control-row';

            others.forEach(controlDef => {
                if (controlDef.type === 'select') {
                    const label = popup.document.createElement('label');
                    label.textContent = controlDef.label;

                    const select = popup.document.createElement('select');
                    select.setAttribute('data-cc', controlDef.cc);

                    controlDef.options.forEach(opt => {
                        const option = popup.document.createElement('option');
                        option.value = opt.value;
                        option.textContent = opt.label;
                        select.appendChild(option);
                    });

                    // Get current value
                    const mainSelect = mainSection.querySelector(`select[data-cc="${controlDef.cc}"]`);
                    if (mainSelect) {
                        select.value = mainSelect.value;
                    } else {
                        select.value = controlDef.default || 0;
                    }

                    // Send via BroadcastChannel to trigger MIDI send in main window
                    select.addEventListener('change', (e) => {
                        const cc = parseInt(e.target.getAttribute('data-cc'));
                        const value = parseInt(e.target.value);
                        const channel = new BroadcastChannel('midi-ui-sync');
                        channel.postMessage({
                            type: 'popup-cc-change',
                            cc: cc,
                            value: value
                        });
                        channel.close();
                    });

                    label.appendChild(select);
                    controlRow.appendChild(label);
                }
            });

            controlsContainer.appendChild(controlRow);
        }

        popupContent.appendChild(controlsContainer);

        sectionPopups.set(sectionId, popup);

        // Handle popup close
        popup.addEventListener('beforeunload', () => {
            sectionPopups.delete(sectionId);
        });
    });
}

// Toggle fullscreen for a section
function toggleSectionFullscreen(section) {
    if (!document.fullscreenElement) {
        section.requestFullscreen().catch(err => {
            console.error(`Error attempting to enable fullscreen: ${err.message}`);
        });
    } else {
        document.exitFullscreen();
    }
}

// Create a section element
function createSection(sectionDef) {
    const section = document.createElement('div');
    section.className = 'section';

    // Section header with title and fullscreen button
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.className = 'section-title';

    const title = document.createElement('span');
    title.textContent = sectionDef.title;

    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.gap = '10px';

    const popoutBtn = document.createElement('button');
    popoutBtn.textContent = '⧉';
    popoutBtn.style.cssText = 'background: transparent; border: none; color: #0066FF; padding: 0; cursor: pointer; font-size: 16px; margin: 0;';
    popoutBtn.title = 'Pop out to new window';
    popoutBtn.onclick = () => popOutSection(section, sectionDef);

    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.textContent = '⛶';
    fullscreenBtn.style.cssText = 'background: transparent; border: none; color: #0066FF; padding: 0; cursor: pointer; font-size: 16px; margin: 0;';
    fullscreenBtn.title = 'Toggle fullscreen';
    fullscreenBtn.onclick = () => toggleSectionFullscreen(section);

    buttonContainer.appendChild(popoutBtn);
    buttonContainer.appendChild(fullscreenBtn);

    header.appendChild(title);
    header.appendChild(buttonContainer);
    section.appendChild(header);

    // Controls container
    const controlsContainer = document.createElement('div');

    // Separate knobs, pads, xy-pads, and other controls
    const knobs = sectionDef.controls.filter(c => c.type === 'knob' || c.type === 'knob-14bit' || c.type === 'nrpn');
    const pads = sectionDef.controls.filter(c => c.type === 'pad');
    const xyPads = sectionDef.controls.filter(c => c.type === 'xy-pad');
    const others = sectionDef.controls.filter(c => c.type !== 'knob' && c.type !== 'knob-14bit' && c.type !== 'nrpn' && c.type !== 'pad' && c.type !== 'xy-pad');

    // Add knobs in a grid
    if (knobs.length > 0) {
        const knobGrid = document.createElement('div');
        knobGrid.className = 'knob-grid';
        knobGrid.style.gridTemplateColumns = `repeat(${Math.min(knobs.length, 4)}, 1fr)`;

        knobs.forEach(controlDef => {
            const control = createControl(controlDef);
            if (control) knobGrid.appendChild(control);
        });

        controlsContainer.appendChild(knobGrid);
    }

    // Add pads in a grid
    if (pads.length > 0) {
        const padGrid = document.createElement('div');
        padGrid.className = 'knob-grid';
        padGrid.style.gridTemplateColumns = `repeat(${Math.min(pads.length, 4)}, 1fr)`;
        padGrid.style.marginTop = knobs.length > 0 ? '15px' : '0';

        pads.forEach(controlDef => {
            const control = createControl(controlDef);
            if (control) padGrid.appendChild(control);
        });

        controlsContainer.appendChild(padGrid);
    }

    // Add XY pads in a grid
    if (xyPads.length > 0) {
        const xyPadGrid = document.createElement('div');
        xyPadGrid.className = 'knob-grid';
        xyPadGrid.style.gridTemplateColumns = `repeat(${Math.min(xyPads.length, 2)}, 1fr)`;
        xyPadGrid.style.marginTop = (knobs.length > 0 || pads.length > 0) ? '15px' : '0';

        xyPads.forEach(controlDef => {
            const control = createControl(controlDef);
            if (control) xyPadGrid.appendChild(control);
        });

        controlsContainer.appendChild(xyPadGrid);
    }

    // Add other controls
    if (others.length > 0) {
        const controlRow = document.createElement('div');
        controlRow.className = 'control-row';
        controlRow.style.marginTop = (knobs.length > 0 || pads.length > 0 || xyPads.length > 0) ? '15px' : '0';

        others.forEach(controlDef => {
            const control = createControl(controlDef);
            if (control) controlRow.appendChild(control);
        });

        controlsContainer.appendChild(controlRow);
    }

    section.appendChild(controlsContainer);
    return section;
}

// Create a control element based on type
function createControl(controlDef) {
    switch (controlDef.type) {
        case 'knob':
        case 'knob-14bit':
            return createKnob(controlDef);
        case 'nrpn':
            return createNRPNKnob(controlDef);
        case 'pad':
            return createPad(controlDef);
        case 'xy-pad':
            return createXYPad(controlDef);
        case 'select':
            return createSelect(controlDef);
        case 'device-id-select':
            return createDeviceIdSelect(controlDef);
        case 'toggle':
            return createToggle(controlDef);
        default:
            console.warn('[Controller] Unknown control type:', controlDef.type);
            return null;
    }
}

// Create a knob control
function createKnob(def) {
    const knob = document.createElement('pad-knob');
    knob.setAttribute('label', def.label);
    knob.setAttribute('cc', def.cc);
    knob.setAttribute('min', def.min || 0);
    knob.setAttribute('max', def.max || 127);
    knob.setAttribute('value', def.default || 64);
    knob.setAttribute('default', def.default || 64);

    if (def.sublabel) {
        knob.setAttribute('sublabel', def.sublabel);
    }

    // Store SysEx template if defined (for devices like Regroove that use SysEx instead of CC)
    if (def.sysex) {
        knob.dataset.sysex = def.sysex;
    }

    // Add MIDI learn click handler
    knob.addEventListener('click', (e) => {
        if (midiLearnMode) {
            setMIDILearnTarget(knob, def.cc, def.label);
            e.stopPropagation();
        }
    });

    return knob;
}

// Create an NRPN knob control
function createNRPNKnob(def) {
    const knob = document.createElement('pad-knob');
    knob.setAttribute('label', def.label);
    knob.setAttribute('cc', '0');  // Dummy CC, won't be used
    knob.setAttribute('min', def.min || 0);
    knob.setAttribute('max', def.max || 16383);
    knob.setAttribute('value', def.default || 8192);
    knob.setAttribute('default', def.default || 8192);

    // Store NRPN info as data attributes (will be checked in cc-change handler)
    knob.dataset.nrpnMsb = def.nrpn.msb;
    knob.dataset.nrpnLsb = def.nrpn.lsb;
    knob.dataset.is14bit = def.nrpn.is14bit !== false;  // Default to 14-bit

    if (def.sublabel) {
        knob.setAttribute('sublabel', def.sublabel);
    }

    // MIDI learn for NRPN
    knob.addEventListener('click', (e) => {
        if (midiLearnMode) {
            setMIDILearnTarget(knob, null, def.label, {
                isNRPN: true,
                nrpnMsb: def.nrpn.msb,
                nrpnLsb: def.nrpn.lsb,
                is14bit: def.nrpn.is14bit !== false
            });
            e.stopPropagation();
        }
    });

    return knob;
}

// Create a select control
function createSelect(def) {
    const container = document.createElement('div');
    container.style.marginBottom = '10px';

    const label = document.createElement('label');
    label.style.fontSize = '11px';
    label.style.color = 'var(--text-secondary)';
    label.style.display = 'block';
    label.textContent = def.label + ':';

    const select = document.createElement('select');
    select.style.marginTop = '5px';
    select.setAttribute('data-cc', def.cc);

    def.options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        select.appendChild(option);
    });

    // Set default value
    if (def.default !== undefined) {
        select.value = def.default;
    }

    // Add change listener
    select.addEventListener('change', (e) => {
        const cc = parseInt(select.getAttribute('data-cc'));
        const value = parseInt(e.target.value);
        sendCC(cc, value);

        // Broadcast to all windows (including popups)
        uiSyncChannel.postMessage({ type: 'cc-update', cc, value });
    });

    label.appendChild(select);
    container.appendChild(label);
    return container;
}

// Create a toggle control
function createToggle(def) {
    const container = document.createElement('div');
    container.style.marginBottom = '10px';

    const label = document.createElement('label');
    label.style.fontSize = '11px';
    label.style.color = 'var(--text-secondary)';
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '8px';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.setAttribute('data-cc', def.cc);
    checkbox.checked = (def.default || 0) > 0;

    // Add change listener
    checkbox.addEventListener('change', (e) => {
        const cc = parseInt(checkbox.getAttribute('data-cc'));
        const value = e.target.checked ? (def.onValue || 127) : (def.offValue || 0);
        sendCC(cc, value);
    });

    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(def.label));
    container.appendChild(label);
    return container;
}

// Create a device ID selector control
function createDeviceIdSelect(def) {
    const container = document.createElement('div');
    container.style.marginBottom = '10px';

    const label = document.createElement('label');
    label.style.fontSize = '11px';
    label.style.color = 'var(--text-secondary)';
    label.style.display = 'block';
    label.textContent = def.label + ':';

    const select = document.createElement('select');
    select.style.marginTop = '5px';
    select.id = 'deviceIdSelect';

    // Add device ID options (0-127, plus broadcast)
    for (let i = 0; i <= 127; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = i === 127 ? `${i} (Broadcast)` : `${i}`;
        select.appendChild(option);
    }

    // Set default value
    const defaultId = def.default !== undefined ? def.default : 0;
    select.value = defaultId;
    deviceId = defaultId;

    // Add change listener
    select.addEventListener('change', (e) => {
        deviceId = parseInt(e.target.value);
        console.log('[Controller] Device ID changed to:', deviceId);
    });

    label.appendChild(select);
    container.appendChild(label);
    return container;
}

// Create a trigger pad control
function createPad(def) {
    const pad = document.createElement('trigger-pad');
    pad.setAttribute('label', def.label);

    if (def.note) {
        pad.setAttribute('note', def.note);
    }

    if (def.sysex) {
        pad.setAttribute('sysex', def.sysex);
    }

    // Store toggle state if this is a toggle pad
    if (def.toggle) {
        pad.dataset.toggle = 'true';
        pad.dataset.toggleState = '0';
    }

    // Handle pad trigger events
    pad.addEventListener('pad-trigger', (e) => {
        const { sysex, pressed } = e.detail;

        // For toggle pads, only trigger on press (not release)
        if (def.toggle && !pressed) {
            return;
        }

        // For non-toggle pads, only send on press (transport controls)
        if (!def.toggle && !pressed) {
            return;
        }

        if (!selectedOutput) {
            console.warn('[Controller] No MIDI output selected');
            return;
        }

        if (sysex) {
            // Parse SysEx string
            let sysexStr = sysex.trim();

            // Handle toggle value substitution
            if (def.toggle) {
                const currentState = parseInt(pad.dataset.toggleState);
                const newState = currentState === 0 ? 1 : 0;
                pad.dataset.toggleState = newState.toString();

                // Replace {VALUE} with toggle state
                sysexStr = sysexStr.replace('{VALUE}', newState.toString(16).toUpperCase().padStart(2, '0'));

                // Update visual state
                if (newState === 1) {
                    pad.setAttribute('active', '');
                } else {
                    pad.removeAttribute('active');
                }
            }

            // Replace {DEVICE_ID} template with current device ID
            sysexStr = sysexStr.replace(/\{DEVICE_ID\}/g, deviceId.toString(16).toUpperCase().padStart(2, '0'));

            // Replace {CCxx} templates with current CC values
            sysexStr = sysexStr.replace(/\{CC(\d+)\}/g, (match, ccNum) => {
                const knob = document.querySelector(`pad-knob[cc="${ccNum}"]`);
                const value = knob ? parseInt(knob.getAttribute('value')) || 64 : 64;
                return value.toString(16).toUpperCase().padStart(2, '0');
            });

            // Replace {VALUE} in non-toggle pads (for effects)
            sysexStr = sysexStr.replace(/\{VALUE\}/g, '00');

            // Parse hex string to byte array
            const bytes = sysexStr.split(' ').map(b => parseInt(b, 16));

            // Send SysEx
            selectedOutput.send(bytes);
            logMIDI(`TX Pad ${def.label}: ${sysexStr}`, 'send');
        }
    });

    return pad;
}

// Create an XY pad control
function createXYPad(def) {
    const xyPad = document.createElement('xy-pad');
    xyPad.setAttribute('label', def.label);
    xyPad.setAttribute('x-cc', def.xCC);
    xyPad.setAttribute('y-cc', def.yCC);
    xyPad.setAttribute('x-value', def.xDefault !== undefined ? def.xDefault : 64);
    xyPad.setAttribute('y-value', def.yDefault !== undefined ? def.yDefault : 64);

    return xyPad;
}

// Clear device UI
function clearDeviceUI() {
    const container = document.getElementById('deviceControls');
    if (!container) return;

    container.innerHTML = `
        <div class="section" style="grid-column: 1 / -1; text-align: center;">
            <p style="color: var(--text-secondary); font-size: 0.9em;">
                Select a device from the menu (☰) to get started
            </p>
        </div>
    `;
}

// Initialize WebMIDI
async function initMIDI() {
    try {
        midiAccess = await navigator.requestMIDIAccess({ sysex: true });
        console.log('[MIDI] WebMIDI initialized successfully');
        updateMIDIStatus('Ready', true);
        populateMIDIOutputs();
        setupMIDIInputs();

        // Auto-detect devices
        setTimeout(() => autoDetectDevice(), 500);

        // Listen for MIDI device changes
        midiAccess.onstatechange = (e) => {
            console.log('[MIDI] Device state changed:', e.port.name, e.port.state);
            populateMIDIOutputs();
            setupMIDIInputs();
            // Don't auto-detect on state changes - only on initial load
            // State changes during init will trigger multiple times unnecessarily
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
    console.log(`[MIDI] Setting up ${inputs.length} MIDI input(s)`);

    inputs.forEach((input, index) => {
        input.onmidimessage = (event) => handleMIDIMessage(event, input.name);
        console.log(`[MIDI] Input ${index + 1}/${inputs.length}: ${input.name} (ID: ${input.id})`);
    });

    // Populate learn input selector
    populateMIDILearnInputs();
}

// Populate MIDI learn input selector
function populateMIDILearnInputs() {
    if (!midiAccess) return;

    const select = document.getElementById('learnInputSelect');
    if (!select) return;

    select.innerHTML = '<option value="">Any Input</option>';

    const inputs = Array.from(midiAccess.inputs.values());
    inputs.forEach(input => {
        const option = document.createElement('option');
        option.value = input.name;
        option.textContent = input.name;
        select.appendChild(option);
    });

    console.log(`[MIDI] Populated learn input selector with ${inputs.length} input(s)`);
}

// Handle learn input selection change
function handleLearnInputChange(e) {
    midiLearnInputFilter = e.target.value || null;
    console.log('[MIDI Learn] Input filter:', midiLearnInputFilter || 'Any Input');
}

// Handle incoming MIDI messages
function handleMIDIMessage(event, deviceName = '') {
    const data = Array.from(event.data);

    // DISABLED: Incoming message logging to prevent UI slowdown
    // Uncomment below to enable logging for debugging
    /*
    const hex = data.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    const devicePrefix = deviceName ? `[${deviceName}] ` : '';
    logMIDI(`${devicePrefix}RX: ${hex}`, 'receive');
    */

    // Parse CC messages
    const status = data[0] & 0xF0;
    if (status === 0xB0) {  // Control Change
        const cc = data[1];
        const value = data[2];

        // Update UI from device CC feedback
        const knob = document.querySelector(`pad-knob[cc="${cc}"]`);
        if (knob) {
            knob.setAttribute('value', value);
        }

        const select = document.querySelector(`select[data-cc="${cc}"]`);
        if (select) {
            select.value = value;
        }

        const checkbox = document.querySelector(`input[type="checkbox"][data-cc="${cc}"]`);
        if (checkbox) {
            checkbox.checked = value > 63;
        }

        // Update xy-pad (check both x-cc and y-cc)
        const xyPadX = document.querySelector(`xy-pad[x-cc="${cc}"]`);
        if (xyPadX) {
            xyPadX.setAttribute('x-value', value);
        }
        const xyPadY = document.querySelector(`xy-pad[y-cc="${cc}"]`);
        if (xyPadY) {
            xyPadY.setAttribute('y-value', value);
        }

        // Record to motion sequencer if recording
        if (motionSequencer && motionSequencer.pattern?.recordingMotion) {
            motionSequencer.recordMotion(cc, value);
        }

        // Also handle hardware controller mapping
        handleHardwareCC(cc, value, deviceName);
    }

    // Parse SysEx messages
    if (data[0] === 0xF0) {
        // Handle Device Inquiry Reply
        if (data[1] === 0x7E && data[3] === 0x06 && data[4] === 0x02) {
            // Ignore if already auto-connected OR already processing
            if (!hasAutoConnected && !processingDeviceInquiry) {
                // Set flag IMMEDIATELY
                processingDeviceInquiry = true;

                const manufacturerId = data[5];
                const familyLSB = data[6];
                const familyMSB = data[7];
                const memberLSB = data[8];

                logMIDI('Device Inquiry Reply received!', 'success');

                // Try to match device
                const matchedDevice = deviceLoader.findDeviceByInquiry(
                    manufacturerId,
                    [familyLSB, familyMSB],
                    memberLSB
                );

                if (matchedDevice) {
                    logMIDI(`Detected: ${matchedDevice.name}`, 'success');
                    autoConnectDevice(deviceName, matchedDevice);
                } else {
                    logMIDI(`Device: Mfr=${manufacturerId.toString(16)} Family=${familyLSB.toString(16)}${familyMSB.toString(16)} Member=${memberLSB.toString(16)}`, 'info');
                    // Reset flag if device not matched (allow retry)
                    setTimeout(() => {
                        processingDeviceInquiry = false;
                    }, 100);
                }
            }
            // DON'T return - continue processing other SysEx messages
        }

        // KORG bulk parameter dump - device-specific parsing
        if (data[1] === 0x42 && data[6] === 0x40) {
            // Only process 0x40 (DATA DUMP), ignore 0x41 (PARAMETER CHANGE)
            const device = deviceLoader.getCurrentDevice();
            if (device && device.bulkDumpFormat) {
                const ccValues = parseBulkDump(data, device.bulkDumpFormat);
                if (ccValues) {
                    applyBulkDumpValues(ccValues);
                }
            }
        }
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

// Parse bulk dump using device-specific format
function parseBulkDump(data, format) {
    // Verify header matches
    const header = format.header.map(h => parseInt(h));

    for (let i = 0; i < header.length; i++) {
        if (data[i] !== header[i]) {
            // Header mismatch - likely an error response (0x41) or different message type
            return null;
        }
    }

    // Extract raw data (skip header and F7 footer)
    const dumpData = data.slice(format.dataOffset, -1);

    // Decode 7-bit if needed
    let decodedData = dumpData;
    if (format.encoding === '7bit') {
        decodedData = decode7bit(dumpData);
    }

    // Extract CC values using ccMap
    const ccValues = {};
    const binaryOffsets = new Set(format.binaryToMidi || []);

    Object.entries(format.ccMap).forEach(([cc, bytePos]) => {
        if (decodedData[bytePos] !== undefined) {
            let value = decodedData[bytePos];
            // Convert binary 0/1 to MIDI 0/127 for specific byte offsets
            // If value is 0, keep it 0; otherwise convert to 127
            if (binaryOffsets.has(bytePos)) {
                value = value === 0 ? 0 : 127;
            }
            ccValues[cc] = value;
        }
    });

    return ccValues;
}

// Apply bulk dump CC values to UI
function applyBulkDumpValues(ccValues) {
    // Disable transitions on all knobs during bulk update
    const allKnobs = document.querySelectorAll('pad-knob');
    allKnobs.forEach(k => k.classList.add('no-transition'));

    Object.entries(ccValues).forEach(([cc, value]) => {
        const ccNum = parseInt(cc);

        const knob = document.querySelector(`pad-knob[cc="${ccNum}"]`);
        if (knob) {
            knob.setAttribute('value', value);
        }

        const select = document.querySelector(`select[data-cc="${ccNum}"]`);
        if (select) {
            select.value = value;
        }

        const checkbox = document.querySelector(`input[type="checkbox"][data-cc="${ccNum}"]`);
        if (checkbox) {
            checkbox.checked = value > 63;
        }

        // Update xy-pad (check both x-cc and y-cc)
        const xyPadX = document.querySelector(`xy-pad[x-cc="${ccNum}"]`);
        if (xyPadX) {
            xyPadX.setAttribute('x-value', value);
        }
        const xyPadY = document.querySelector(`xy-pad[y-cc="${ccNum}"]`);
        if (xyPadY) {
            xyPadY.setAttribute('y-value', value);
        }
    });

    // Re-enable transitions after updates complete
    requestAnimationFrame(() => {
        allKnobs.forEach(k => k.classList.remove('no-transition'));
    });
}

// Handle CC from hardware controllers
function handleHardwareCC(cc, value, deviceName) {
    // MIDI Learn mode - bind hardware CC to target control
    if (midiLearnMode && midiLearnTarget) {
        // Check if this input is filtered
        if (midiLearnInputFilter && deviceName !== midiLearnInputFilter) {
            // Ignore messages from non-selected inputs during MIDI learn
            return;
        }
        if (midiLearnTarget.isNRPN) {
            // Map CC to NRPN
            hardwareMappings[cc] = {
                isNRPN: true,
                targetNRPNMsb: midiLearnTarget.nrpnMsb,
                targetNRPNLsb: midiLearnTarget.nrpnLsb,
                is14bit: midiLearnTarget.is14bit,
                targetLabel: midiLearnTarget.label,
                hardwareDevice: deviceName
            };

            logMIDI(` Learned: ${deviceName} CC${cc} → ${midiLearnTarget.label} (NRPN ${midiLearnTarget.nrpnMsb}:${midiLearnTarget.nrpnLsb})`, 'success');
        } else {
            // Map CC to CC
            hardwareMappings[cc] = {
                isNRPN: false,
                targetCC: midiLearnTarget.cc,
                targetLabel: midiLearnTarget.label,
                hardwareDevice: deviceName
            };

            logMIDI(` Learned: ${deviceName} CC${cc} → ${midiLearnTarget.label} (CC${midiLearnTarget.cc})`, 'success');
        }

        updateMappingsList();

        // Exit MIDI learn mode
        toggleMIDILearn();
        return;
    }

    // Normal mode - apply mapped CC if mapping exists
    if (hardwareMappings[cc]) {
        const mapping = hardwareMappings[cc];

        if (mapping.isNRPN) {
            // Scale 7-bit CC (0-127) to 14-bit NRPN (0-16383) or 7-bit (0-127)
            let scaledValue;
            if (mapping.is14bit) {
                // Scale to 14-bit: value * 129 (gives 0→0, 127→16383)
                scaledValue = Math.round((value * 16383) / 127);
            } else {
                // Keep as 7-bit
                scaledValue = value;
            }

            const nrpnId = `nrpn:${mapping.targetNRPNMsb}:${mapping.targetNRPNLsb}`;

            // Mark as held
            heldParameters.add(nrpnId);
            if (holdTimeouts.has(nrpnId)) {
                clearTimeout(holdTimeouts.get(nrpnId));
            }
            holdTimeouts.set(nrpnId, setTimeout(() => {
                heldParameters.delete(nrpnId);
                holdTimeouts.delete(nrpnId);
            }, 200));

            // Update UI control
            const knob = document.querySelector(
                `pad-knob[data-nrpn-msb="${mapping.targetNRPNMsb}"][data-nrpn-lsb="${mapping.targetNRPNLsb}"]`
            );
            if (knob) {
                knob.setAttribute('value', scaledValue);
            }

            // Send NRPN
            sendNRPN(mapping.targetNRPNMsb, mapping.targetNRPNLsb, scaledValue, mapping.is14bit);

            // Record motion if sequencer is recording
            if (motionSequencer && motionSequencer.pattern?.recordingMotion) {
                motionSequencer.recordMotion(nrpnId, scaledValue);
            }
        } else {
            // Regular CC mapping
            // Mark as held
            heldParameters.add(mapping.targetCC);
            if (holdTimeouts.has(mapping.targetCC)) {
                clearTimeout(holdTimeouts.get(mapping.targetCC));
            }
            holdTimeouts.set(mapping.targetCC, setTimeout(() => {
                heldParameters.delete(mapping.targetCC);
                holdTimeouts.delete(mapping.targetCC);
            }, 200));

            // Update UI control
            const knob = document.querySelector(`pad-knob[cc="${mapping.targetCC}"]`);
            if (knob) {
                knob.setAttribute('value', value);
            }

            // Update select if exists
            const select = document.querySelector(`select[data-cc="${mapping.targetCC}"]`);
            if (select) {
                select.value = value;
            }

            // Update checkbox if exists
            const checkbox = document.querySelector(`input[type="checkbox"][data-cc="${mapping.targetCC}"]`);
            if (checkbox) {
                checkbox.checked = value > 63;
            }

            // Update xy-pad (check both x-cc and y-cc)
            const xyPadX = document.querySelector(`xy-pad[x-cc="${mapping.targetCC}"]`);
            if (xyPadX) {
                xyPadX.setAttribute('x-value', value);
            }
            const xyPadY = document.querySelector(`xy-pad[y-cc="${mapping.targetCC}"]`);
            if (xyPadY) {
                xyPadY.setAttribute('y-value', value);
            }

            // Send to device
            sendCC(mapping.targetCC, value);

            // Record motion if sequencer is recording
            if (motionSequencer && motionSequencer.pattern?.recordingMotion) {
                motionSequencer.recordMotion(mapping.targetCC, value);
            }
        }
    }
}

// Populate MIDI outputs dropdown
function populateMIDIOutputs() {
    if (!midiAccess) return;

    const select = document.getElementById('midiOutput');
    if (!select) return;

    select.innerHTML = '<option value="">Select MIDI Output...</option>';

    const outputs = Array.from(midiAccess.outputs.values());
    outputs.forEach(output => {
        const option = document.createElement('option');
        option.value = output.id;
        option.textContent = output.name;
        select.appendChild(option);
    });

    console.log(`[MIDI] Found ${outputs.length} output(s)`);
}

// Handle MIDI output selection
function handleMIDIOutputChange(e) {
    const outputId = e.target.value;
    if (outputId && midiAccess) {
        selectedOutput = midiAccess.outputs.get(outputId);
        updateMIDIStatus(`Connected: ${selectedOutput.name}`, true);
        updateConnectionIndicator(true, selectedOutput.name);

        const device = deviceLoader.getCurrentDevice();
        if (device && device.bulkDumpFormat) {
            setTimeout(() => {
                syncFromDevice();
                startAutoSync();
            }, 500);
        }
    } else {
        selectedOutput = null;
        updateMIDIStatus('Ready', false);
        updateConnectionIndicator(false);
        stopAutoSync();
    }
}

// Handle MIDI channel change
function handleChannelChange(e) {
    midiChannel = parseInt(e.target.value);
    console.log('[MIDI] Changed to channel:', midiChannel + 1);
}

// Expose sendCC and sendNRPN globally for parameter manager
window.sendCC = sendCC;
window.sendNRPN = sendNRPN;

// Send MIDI CC message
function sendCC(cc, value, log = false) {
    if (!selectedOutput) return;

    const status = 0xB0 + midiChannel;
    const message = [status, cc, value];

    try {
        selectedOutput.send(message);
        if (log) {
            const hex = message.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
            logMIDI(`TX: ${hex} (CC${cc}=${value}, Ch${midiChannel + 1})`, 'send');
        }
    } catch (error) {
        if (log) {
            logMIDI(`Error: ${error.message}`, 'error');
        }
    }
}

// Send NRPN message
function sendNRPN(msb, lsb, value, is14bit = true, log = false) {
    if (!selectedOutput) return;

    const status = 0xB0 + midiChannel;

    try {
        // Send NRPN parameter number
        selectedOutput.send([status, 99, msb]);   // NRPN MSB
        selectedOutput.send([status, 98, lsb]);   // NRPN LSB

        if (is14bit) {
            // 14-bit value (0-16383)
            const valueMSB = (value >> 7) & 0x7F;  // Upper 7 bits
            const valueLSB = value & 0x7F;          // Lower 7 bits

            selectedOutput.send([status, 38, valueLSB]);  // Data Entry LSB
            selectedOutput.send([status, 6, valueMSB]);   // Data Entry MSB

            if (log) {
                logMIDI(`TX: NRPN MSB=${msb} LSB=${lsb} Value=${value} (14-bit)`, 'send');
            }
        } else {
            // 7-bit value (0-127)
            selectedOutput.send([status, 6, value]);  // Data Entry MSB only

            if (log) {
                logMIDI(`TX: NRPN MSB=${msb} LSB=${lsb} Value=${value} (7-bit)`, 'send');
            }
        }
    } catch (error) {
        if (log) {
            logMIDI(`Error: ${error.message}`, 'error');
        }
    }
}

// Send SysEx message for knob controls (used by Regroove effects)
function sendKnobSysEx(sysexTemplate, cc, value) {
    if (!selectedOutput) return;

    try {
        // Start with the template
        let sysexStr = sysexTemplate.trim();

        // Replace {DEVICE_ID} with current device ID
        sysexStr = sysexStr.replace(/\{DEVICE_ID\}/g, deviceId.toString(16).toUpperCase().padStart(2, '0'));

        // Replace {VALUE} with the knob's current value
        sysexStr = sysexStr.replace(/\{VALUE\}/g, value.toString(16).toUpperCase().padStart(2, '0'));

        // Replace {CCxx} templates with other knob values
        sysexStr = sysexStr.replace(/\{CC(\d+)\}/g, (match, ccNum) => {
            const knob = document.querySelector(`pad-knob[cc="${ccNum}"]`);
            const knobValue = knob ? parseInt(knob.getAttribute('value')) || 64 : 64;
            return knobValue.toString(16).toUpperCase().padStart(2, '0');
        });

        // Parse hex string to byte array
        const bytes = sysexStr.split(' ').map(b => parseInt(b, 16));

        // Send SysEx
        selectedOutput.send(bytes);
        logMIDI(`TX SysEx CC${cc}: ${sysexStr}`, 'send');
    } catch (error) {
        logMIDI(`SysEx Error: ${error.message}`, 'error');
    }
}

// Request all parameter values from device
function syncFromDevice(silent = false) {
    // Debounce: prevent duplicate sync requests within 2 seconds
    const now = Date.now();
    if (now - lastSyncRequest < 2000) return;
    lastSyncRequest = now;

    const device = deviceLoader.getCurrentDevice();
    if (!device) {
        if (!silent) logMIDI('No device selected', 'error');
        return;
    }

    if (!device.bulkDumpFormat) {
        if (!silent) logMIDI('Device does not support bulk dump', 'error');
        return;
    }

    if (!selectedOutput) {
        if (!silent) logMIDI('No MIDI output selected', 'error');
        return;
    }

    if (!silent) {
        logMIDI('Requesting parameter dump from device...', 'info');
    }

    // KORG Current Program Data Dump Request
    // Format: F0 42 4g 00 01 75 10 F7 (4g = 0x40 + global channel)
    // Get manufacturer ID from bulkDumpFormat header or deviceInquiry
    let manufacturerId;
    if (device.deviceInquiry && device.deviceInquiry.manufacturerId) {
        manufacturerId = parseInt(device.deviceInquiry.manufacturerId);
    } else if (device.bulkDumpFormat.header && device.bulkDumpFormat.header.length > 1) {
        manufacturerId = parseInt(device.bulkDumpFormat.header[1]);
    } else {
        if (!silent) logMIDI('Cannot determine manufacturer ID', 'error');
        return;
    }
    const channel = device.globalChannel ? 0 : midiChannel; // Use channel 0 for global channel devices
    const sysex = [
        0xF0,
        manufacturerId,
        0x40 + channel, // FIXED: Was 0x30, should be 0x40 for KORG SysEx
        0x00,
        0x01,
        0x75,
        0x10,
        0xF7
    ];

    if (!silent) {
        const hex = sysex.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
        logMIDI(`TX Dump Request: ${hex}`, 'send');
    }
    selectedOutput.send(sysex);
}

// Start auto-sync interval
function startAutoSync() {
    // Don't restart if already running
    if (autoSyncInterval) {
        return;
    }

    const device = deviceLoader.getCurrentDevice();
    if (!device || !device.bulkDumpFormat || !selectedOutput || !autoSyncEnabled) {
        return;
    }

    // Use device-specific interval (0 = disabled)
    const interval = device.bulkDumpFormat.autoSyncInterval;
    if (!interval || interval === 0) {
        return;
    }

    autoSyncInterval = setInterval(() => {
        syncFromDevice(true); // Silent mode
    }, interval);
}

// Stop auto-sync interval
function stopAutoSync() {
    if (autoSyncInterval) {
        clearInterval(autoSyncInterval);
        autoSyncInterval = null;
    }
}

// Toggle auto-sync
function toggleAutoSync() {
    autoSyncEnabled = !autoSyncEnabled;

    const checkbox = document.getElementById('autoSyncCheckbox');
    if (checkbox) {
        checkbox.checked = autoSyncEnabled;
    }

    if (autoSyncEnabled) {
        startAutoSync();
        logMIDI('Auto-sync enabled (every 3 seconds)', 'info');
    } else {
        stopAutoSync();
        logMIDI('Auto-sync disabled', 'info');
    }
}

// Send Device Inquiry
function sendDeviceInquiry() {
    if (!selectedOutput) {
        logMIDI('Error: No output selected', 'error');
        return;
    }

    const inquiry = [0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7];

    try {
        selectedOutput.send(inquiry);
        const hex = inquiry.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
        logMIDI(`TX: ${hex} (Device Inquiry)`, 'send');
    } catch (error) {
        console.error('[MIDI] Failed to send Device Inquiry:', error);
        logMIDI(`Error: ${error.message}`, 'error');
    }
}

// Auto-detect device on startup
async function autoDetectDevice() {
    if (!midiAccess) return;
    if (hasAutoConnected) return;
    if (autoDetectInProgress) return;

    autoDetectInProgress = true;

    const outputs = Array.from(midiAccess.outputs.values());
    if (outputs.length === 0) {
        autoDetectInProgress = false;
        return;
    }

    const inquiry = [0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7];

    // Send ONE inquiry on the first output (0x7F = broadcast to all devices)
    try {
        outputs[0].send(inquiry);
        logMIDI('TX: F0 7E 7F 06 01 F7 (Device Inquiry)', 'send');
    } catch (error) {
        console.error('[MIDI] Failed to send Device Inquiry:', error);
    }

    // Reset flag after 2 seconds (enough time for device to respond)
    setTimeout(() => {
        autoDetectInProgress = false;
    }, 2000);
}

// Auto-connect to detected device
function autoConnectDevice(inputDeviceName, matchedDevice) {
    if (!midiAccess) return;

    // Prevent duplicate auto-connection - SET FLAG IMMEDIATELY
    if (hasAutoConnected) return;
    hasAutoConnected = true; // SET THIS IMMEDIATELY to block concurrent calls

    const outputs = Array.from(midiAccess.outputs.values());
    let matchingOutput = outputs.find(output => output.name === inputDeviceName);

    if (!matchingOutput) {
        matchingOutput = outputs.find(output =>
            output.name.toLowerCase().includes(matchedDevice.id.split('-')[0])
        );
    }

    if (matchingOutput) {
        const select = document.getElementById('midiOutput');
        if (select) {
            select.value = matchingOutput.id;
            selectedOutput = matchingOutput;
            updateMIDIStatus(`Connected: ${matchingOutput.name}`, true);
            updateConnectionIndicator(true, matchingOutput.name);
        }

        logMIDI(`Auto-connected to: ${matchingOutput.name}`, 'success');

        // Auto-select device in device dropdown
        const deviceSelect = document.getElementById('deviceSelect');
        if (deviceSelect && matchedDevice) {
            if (isFocusSync) {
                // Focus sync - just request dump without regenerating UI
                if (matchedDevice.deviceInquiry) {
                    setTimeout(() => {
                        syncFromDevice(false);
                    }, 1000);
                }
            } else {
                // Normal connection - set up device and UI
                deviceSelect.value = matchedDevice.id;
                deviceLoader.setCurrentDevice(matchedDevice.id);
                generateDeviceUI(matchedDevice);
                setupMotionSequencer(matchedDevice);

                // Auto-sync from device
                if (matchedDevice.deviceInquiry) {
                    setTimeout(() => {
                        syncFromDevice();
                        startAutoSync();
                    }, 1000);
                }
            }
        }

        logMIDI(`Auto-connected to: ${matchingOutput.name}`, 'success');
    }
}

// Scan all devices
async function scanAllDevices() {
    if (!midiAccess) {
        logMIDI('Error: MIDI not initialized', 'error');
        return;
    }

    // Reset auto-connection flags to allow re-detection
    hasAutoConnected = false;
    processingDeviceInquiry = false;
    autoDetectInProgress = false;

    const outputs = Array.from(midiAccess.outputs.values());
    if (outputs.length === 0) {
        logMIDI('Error: No MIDI outputs found', 'error');
        return;
    }

    logMIDI(`Scanning ${outputs.length} MIDI output(s)...`, 'info');

    const inquiry = [0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7];

    for (const output of outputs) {
        try {
            output.send(inquiry);
            logMIDI(`Sent inquiry to: ${output.name}`, 'info');
        } catch (error) {
            logMIDI(`Failed to send to ${output.name}: ${error.message}`, 'error');
        }
    }

    logMIDI(' Scan complete. Check for replies above.', 'success');
}

// Update MIDI status display
function updateMIDIStatus(message, connected) {
    const statusEl = document.querySelector('#midiStatus span');
    if (statusEl) {
        statusEl.textContent = message;
        statusEl.style.color = connected ? '#00FF00' : '#AAAAAA';
    }
}

// Update connection indicator
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

// Log MIDI messages to UI
function logMIDI(message, type = 'info') {
    const logEl = document.getElementById('midiLog');
    if (!logEl) return;

    const filterRepeat = document.getElementById('filterRepeat')?.checked ?? true;

    if (filterRepeat && message.includes('Parameter Change:')) {
        return;
    }

    if (filterRepeat && type === 'receive' && message.includes('F0 42') && message.includes('41')) {
        return;
    }

    if (filterRepeat && message === lastLogMessage && type === 'receive') {
        lastLogCount++;
        const lastLine = logEl.lastChild;
        if (lastLine) {
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

    logEl.scrollTop = logEl.scrollHeight;

    while (logEl.children.length > 100) {
        logEl.removeChild(logEl.firstChild);
    }
}

// Clear log
function clearLog() {
    const logEl = document.getElementById('midiLog');
    if (logEl) {
        logEl.innerHTML = '';
        logEl.style.display = 'none';
    }
    lastLogMessage = '';
    lastLogCount = 0;
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

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeMenuFunc();
        }
    });
}

// Toggle MIDI Learn mode
function toggleMIDILearn() {
    midiLearnMode = !midiLearnMode;

    const btn = document.getElementById('midiLearnBtn');
    const indicator = document.getElementById('learnIndicator');

    if (midiLearnMode) {
        btn?.classList.add('active');
        if (indicator) {
            indicator.style.display = 'block';
            indicator.textContent = ' MIDI Learn Active - Click a control, then move a hardware knob/fader';
        }
        logMIDI(' MIDI Learn mode activated', 'info');
    } else {
        btn?.classList.remove('active');
        if (indicator) indicator.style.display = 'none';
        midiLearnTarget = null;

        // Remove highlights from all knobs
        document.querySelectorAll('pad-knob').forEach(knob => {
            knob.style.outline = '';
        });

        logMIDI('MIDI Learn mode deactivated', 'info');
    }
}

// Set MIDI learn target
function setMIDILearnTarget(element, cc, label, nrpnInfo = null) {
    if (nrpnInfo) {
        // NRPN target
        midiLearnTarget = {
            element,
            label,
            isNRPN: true,
            nrpnMsb: nrpnInfo.nrpnMsb,
            nrpnLsb: nrpnInfo.nrpnLsb,
            is14bit: nrpnInfo.is14bit
        };
    } else {
        // Regular CC target
        midiLearnTarget = {
            element,
            cc,
            label,
            isNRPN: false
        };
    }

    // Remove previous highlights
    document.querySelectorAll('pad-knob').forEach(knob => {
        knob.style.outline = '';
    });

    // Highlight selected control
    element.style.outline = '2px solid #ff6600';

    const indicator = document.getElementById('learnIndicator');
    if (indicator) {
        if (nrpnInfo) {
            indicator.textContent = ` Learning: ${label} (NRPN ${nrpnInfo.nrpnMsb}:${nrpnInfo.nrpnLsb}) - Move a hardware control...`;
        } else {
            indicator.textContent = ` Learning: ${label} (CC${cc}) - Move a hardware control...`;
        }
    }

    if (nrpnInfo) {
        logMIDI(` Target: ${label} (NRPN ${nrpnInfo.nrpnMsb}:${nrpnInfo.nrpnLsb}) - waiting for hardware input...`, 'info');
    } else {
        logMIDI(` Target: ${label} (CC${cc}) - waiting for hardware input...`, 'info');
    }
}

// Clear hardware mappings
function clearHardwareMappings() {
    hardwareMappings = {};
    updateMappingsList();
    logMIDI(' Cleared all hardware mappings', 'success');
}

// Update mappings list in UI
function updateMappingsList() {
    const list = document.getElementById('mappingsList');
    if (!list) return;

    const mappings = Object.entries(hardwareMappings);

    if (mappings.length === 0) {
        list.innerHTML = '<div style="color: #555; font-size: 10px;">No hardware mappings</div>';
        return;
    }

    list.innerHTML = mappings.map(([hwCC, mapping]) => {
        const device = mapping.hardwareDevice || 'Hardware';
        let targetInfo;
        if (mapping.isNRPN) {
            targetInfo = `NRPN ${mapping.targetNRPNMsb}:${mapping.targetNRPNLsb}`;
        } else {
            targetInfo = `CC${mapping.targetCC}`;
        }
        return `
            <div style="font-size: 10px; color: #888; padding: 4px; background: #0f0f0f; margin-bottom: 2px; border-radius: 2px;">
                ${device} CC${hwCC} → ${mapping.targetLabel} (${targetInfo})
            </div>
        `;
    }).join('');
}

// Setup motion sequencer for current device
function setupMotionSequencer(device) {
    if (!motionSequencer) return;

    // Collect all available parameters from device (CC and NRPN)
    const availableParams = [];
    device.sections.forEach(section => {
        section.controls.forEach(control => {
            if (control.cc !== undefined) {
                availableParams.push({
                    cc: control.cc,
                    label: control.label,
                    type: 'cc'
                });
            } else if (control.nrpn !== undefined) {
                availableParams.push({
                    cc: `nrpn:${control.nrpn.msb}:${control.nrpn.lsb}`,
                    label: control.label,
                    type: 'nrpn',
                    nrpn: control.nrpn
                });
            }
        });
    });

    // Setup sequencer with callback that handles both CC and NRPN
    motionSequencer.setAvailableParameters(availableParams);
    motionSequencer.setMIDICallback((id, value) => {
        // Skip if parameter is currently being held
        if (heldParameters.has(id)) {
            return;
        }

        if (typeof id === 'string' && id.startsWith('nrpn:')) {
            // Extract NRPN MSB:LSB from id
            const parts = id.split(':');
            const msb = parseInt(parts[1]);
            const lsb = parseInt(parts[2]);

            // Find the parameter definition to get is14bit
            const param = availableParams.find(p => p.cc === id);
            const is14bit = param?.nrpn?.is14bit !== false;

            sendNRPN(msb, lsb, value, is14bit);

            // Update UI knob AFTER sending
            const knob = document.querySelector(`pad-knob[data-nrpn-msb="${msb}"][data-nrpn-lsb="${lsb}"]`);
            if (knob) {
                knob.setAttribute('value', value);
            }
        } else {
            // Regular CC
            sendCC(id, value);

            // Update UI AFTER sending
            const knob = document.querySelector(`pad-knob[cc="${id}"]`);
            if (knob) {
                knob.setAttribute('value', value);
            }

            const select = document.querySelector(`select[data-cc="${id}"]`);
            if (select) {
                select.value = value;
            }

            const checkbox = document.querySelector(`input[type="checkbox"][data-cc="${id}"]`);
            if (checkbox) {
                checkbox.checked = value > 63;
            }

            // Update xy-pad (check both x-cc and y-cc)
            const xyPadX = document.querySelector(`xy-pad[x-cc="${id}"]`);
            if (xyPadX) {
                xyPadX.setAttribute('x-value', value);
            }
            const xyPadY = document.querySelector(`xy-pad[y-cc="${id}"]`);
            if (xyPadY) {
                xyPadY.setAttribute('y-value', value);
            }
        }
    });
}
