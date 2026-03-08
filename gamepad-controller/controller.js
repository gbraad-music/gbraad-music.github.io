// MIDI
let midiAccess = null;
let webrtcMidi = null;

// Multi-controller support
let controllerConfigs = {}; // { gamepadId: { midiDeviceId, preset, channel, enabled } }
let activeGamepads = {}; // { index: gamepad }
let activeTriggerConfig = null; // Config for trigger pads { midiDeviceId, preset, channel }
let wakeLock = null;
let triggerPadsInstance = null; // TriggerPads component instance

// Button/axis states per controller
const controllerStates = {}; // { gamepadId: { buttons: {}, axes: {} } }

// Request wake lock to keep page active
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('[WakeLock] Screen wake lock active');
            
            wakeLock.addEventListener('release', () => {
                console.log('[WakeLock] Screen wake lock released');
            });
        }
    } catch (err) {
        console.log('[WakeLock] Not supported or failed:', err.message);
    }
}

// Re-request wake lock when page becomes visible
document.addEventListener('visibilitychange', async () => {
    if (wakeLock !== null && document.visibilityState === 'visible') {
        await requestWakeLock();
    }
});

// Presets
const presets = {
    default: {
        name: 'Default Layout',
        buttons: {
            0: { note: 60, name: 'A', label: 'A' },      // C4
            1: { note: 62, name: 'B', label: 'B' },      // D4
            2: { note: 64, name: 'X', label: 'X' },      // E4
            3: { note: 65, name: 'Y', label: 'Y' },      // F4
            4: { note: 67, name: 'LB', label: 'LB' },     // G4
            5: { note: 69, name: 'RB', label: 'RB' },     // A4
            6: { note: 71, name: 'LT Btn', label: 'LT' }, // B4
            7: { note: 72, name: 'RT Btn', label: 'RT' }, // C5
            8: { note: 74, name: 'Back', label: 'Back' },   // D5
            9: { note: 76, name: 'Start', label: 'Start' },  // E5
            10: { note: 77, name: 'L3', label: 'L3' },    // F5
            11: { note: 79, name: 'R3', label: 'R3' },    // G5
            12: { note: 48, name: 'D-Up', label: '↑' },  // C3
            13: { note: 50, name: 'D-Down', label: '↓' },// D3
            14: { note: 52, name: 'D-Left', label: '←' },// E3
            15: { note: 53, name: 'D-Right', label: '→' }// F3
        },
        axes: {
            0: { cc: 2, name: 'Left Stick X' },
            1: { cc: 3, name: 'Left Stick Y' },
            2: { cc: 4, name: 'Right Stick X' },
            3: { cc: 5, name: 'Right Stick Y' }
        }
    },
    drums: {
        name: 'Drum Kit',
        buttons: {
            0: { note: 38, name: 'A (Snare)', label: 'SNARE' },      // Acoustic Snare
            1: { note: 42, name: 'B (HH Closed)', label: 'HH CLO' },  // Closed Hi-Hat
            2: { note: 46, name: 'X (HH Open)', label: 'HH OPN' },    // Open Hi-Hat
            3: { note: 39, name: 'Y (Clap)', label: 'CLAP' },       // Hand Clap
            4: { note: 49, name: 'LB (Crash L)', label: 'CRASH L' },   // Crash Cymbal 1
            5: { note: 57, name: 'RB (Crash R)', label: 'CRASH R' },   // Crash Cymbal 2
            6: { note: 51, name: 'LT (Ride)', label: 'RIDE 1' },      // Ride Cymbal 1
            7: { note: 59, name: 'RT (Ride)', label: 'RIDE 2' },      // Ride Cymbal 2
            8: { note: 37, name: 'Back (Side)', label: 'SIDE' },    // Side Stick
            9: { note: 54, name: 'Start (Tamb)', label: 'TAMB' },   // Tambourine
            10: { note: 44, name: 'L3 (Pedal)', label: 'PEDAL' },    // Pedal Hi-Hat
            11: { note: 52, name: 'R3 (China)', label: 'CHINA' },    // Chinese Cymbal
            12: { note: 36, name: 'D-Up (Kick)', label: 'KICK' },   // Bass Drum 1
            13: { note: 45, name: 'D-Dn (Tom L)', label: 'TOM L' },  // Low Tom
            14: { note: 47, name: 'D-Lt (Tom M)', label: 'TOM M' },  // Low-Mid Tom
            15: { note: 48, name: 'D-Rt (Tom H)', label: 'TOM H' }   // Hi-Mid Tom
        },
        axes: {
            0: { cc: 1, name: 'Left Stick X (Mod)' },
            1: { cc: 7, name: 'Left Stick Y (Vol)' },
            2: { cc: 10, name: 'Right Stick X (Pan)' },
            3: { cc: 11, name: 'Right Stick Y (Expr)' }
        }
    }
};

// Expose presets globally for pop-out windows
window.presets = presets;

// Current preset (for trigger pads display only)
let currentPreset = 'default';
let buttonMappings = {};
let axisMappings = {};

// Load controller configs from localStorage
function loadControllerConfigs() {
    try {
        const saved = localStorage.getItem('controllerConfigs');
        if (saved) {
            controllerConfigs = JSON.parse(saved);
            console.log('[Config] Loaded controller configs:', controllerConfigs);
        }
        const savedTrigger = localStorage.getItem('activeTriggerConfig');
        if (savedTrigger) {
            activeTriggerConfig = JSON.parse(savedTrigger);
        }
    } catch (e) {
        console.error('[Config] Failed to load:', e);
    }
}

// Save controller configs to localStorage
function saveControllerConfigs() {
    try {
        localStorage.setItem('controllerConfigs', JSON.stringify(controllerConfigs));
        localStorage.setItem('activeTriggerConfig', JSON.stringify(activeTriggerConfig || null));
        console.log('[Config] Saved controller configs');
    } catch (e) {
        console.error('[Config] Failed to save:', e);
    }
}

// Initialize MIDI
async function initMIDI() {
    console.log('[DEBUG] initMIDI() called');
    try {
        console.log('[DEBUG] Requesting MIDI access...');
        midiAccess = await navigator.requestMIDIAccess();
        console.log('[MIDI] Access granted', midiAccess);
        
        loadControllerConfigs();
        
        document.getElementById('midiStatus').innerHTML = 'MIDI: <span class="connected">Ready</span>';
        
        console.log('[DEBUG] MIDI outputs available:', Array.from(midiAccess.outputs.values()).map(o => o.name));
        
        midiAccess.onstatechange = () => {
            console.log('[DEBUG] MIDI state changed');
            updateControllerManager();
            updateTriggerMidiDeviceList();
        };
        
        console.log('[DEBUG] Calling updateControllerManager()');
        updateControllerManager();
        
        console.log('[DEBUG] Calling updateTriggerMidiDeviceList()');
        updateTriggerMidiDeviceList();
        
        console.log('[DEBUG] Calling setupTriggerPadControls()');
        setupTriggerPadControls();
        
        console.log('[DEBUG] MIDI initialization complete');
    } catch (error) {
        console.error('[MIDI] Failed to access:', error);
        document.getElementById('midiStatus').innerHTML = 'MIDI: <span style="color: #ff3333;">Not Available</span>';
    }
}

// Get MIDI device by ID
function getMIDIDevice(deviceId) {
    if (!midiAccess || !deviceId) return null;
    return midiAccess.outputs.get(deviceId);
}

// Send MIDI from specific controller
function sendNoteOnFromController(gamepadId, note, velocity) {
    const config = controllerConfigs[gamepadId];
    if (!config || !config.enabled) return;
    
    const device = getMIDIDevice(config.midiDeviceId);
    if (!device) return;
    
    sendToDevice(device, note, velocity, config.channel, true);
    console.log('[Controller]', gamepadId, '-> Note On:', note, 'vel:', velocity, 'ch:', config.channel + 1);
}

function sendNoteOffFromController(gamepadId, note) {
    const config = controllerConfigs[gamepadId];
    if (!config || !config.enabled) return;
    
    const device = getMIDIDevice(config.midiDeviceId);
    if (!device) return;
    
    sendToDevice(device, note, 0, config.channel, false);
}

function sendCCFromController(gamepadId, cc, value) {
    const config = controllerConfigs[gamepadId];
    if (!config || !config.enabled) return;
    
    const device = getMIDIDevice(config.midiDeviceId);
    if (!device) return;
    
    sendCCToDevice(device, cc, value, config.channel);
}

// Send note to specific device
function sendToDevice(device, note, velocity, channel, isNoteOn) {
    if (!device) return;
    
    if (channel === -1) {
        for (let i = 0; i < 16; i++) {
            const status = (isNoteOn ? 0x90 : 0x80) | (i & 0x0F);
            device.send([status, note & 0x7F, velocity & 0x7F]);
        }
    } else {
        const status = (isNoteOn ? 0x90 : 0x80) | (channel & 0x0F);
        device.send([status, note & 0x7F, velocity & 0x7F]);
    }
}

// Send CC to specific device
function sendCCToDevice(device, cc, value, channel) {
    if (!device) return;
    
    if (channel === -1) {
        for (let i = 0; i < 16; i++) {
            const status = 0xB0 | (i & 0x0F);
            device.send([status, cc & 0x7F, value & 0x7F]);
        }
    } else {
        const status = 0xB0 | (channel & 0x0F);
        device.send([status, cc & 0x7F, value & 0x7F]);
    }
}

// Scan for controllers
function scanControllers() {
    const gamepads = navigator.getGamepads();
    let foundCount = 0;
    
    for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]) {
            const gp = gamepads[i];
            activeGamepads[gp.index] = gp;
            foundCount++;
            
            // Initialize state tracking with unique ID
            const uniqueId = `${gp.id}__idx${gp.index}`;
            if (!controllerStates[uniqueId]) {
                controllerStates[uniqueId] = { buttons: {}, axes: {} };
            }
        }
    }
    
    if (foundCount > 0) {
        console.log('[Controllers] Found', foundCount, 'controller(s)');
        updateControllerStatus();
        updateControllerManager();
        startPolling();
    } else {
        nbDialog.alert('No controllers detected. Please connect a gamepad and try again.');
    }
}

// Update controller status display
function updateControllerStatus() {
    const count = Object.keys(activeGamepads).length;
    const status = document.getElementById('controllerStatus');
    
    if (count > 0) {
        status.innerHTML = `Controller: <span class="connected">${count} Connected</span>`;
        status.classList.add('connected');
        document.getElementById('connectBtn').textContent = `${count} Controller(s) Connected`;
        document.getElementById('connectBtn').classList.add('connected');
    } else {
        status.innerHTML = 'Controller: <span>Not Connected</span>';
        status.classList.remove('connected');
        document.getElementById('connectBtn').textContent = 'Connect Controllers';
        document.getElementById('connectBtn').classList.remove('connected');
    }
}

// Start polling all controllers
let pollInterval = null;
let pollingActive = false;

function startPolling() {
    if (pollingActive) return;
    
    console.log('[Controller] Starting background-safe polling');
    pollingActive = true;
    
    // Use high-frequency setInterval - browsers typically allow 4ms minimum
    // This continues even when page is hidden (though may be slightly throttled)
    pollInterval = setInterval(() => {
        if (pollingActive) {
            pollAllControllers();
        }
    }, 4); // 250 Hz - very fast, browsers will clamp to ~60Hz minimum
}

function stopPolling() {
    console.log('[Controller] Stopping polling');
    pollingActive = false;
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
}

// Poll all active controllers
function pollAllControllers() {
    const gamepads = navigator.getGamepads();
    
    for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i] && activeGamepads[i]) {
            pollController(gamepads[i]);
        }
    }
}

// Poll individual controller
function pollController(gamepad) {
    const uniqueId = `${gamepad.id}__idx${gamepad.index}`;
    
    // Skip if pop-out window is handling this controller
    if (popoutControllers.has(uniqueId)) {
        return;
    }
    
    const config = controllerConfigs[uniqueId];
    if (!config || !config.enabled) return;
    
    const preset = presets[config.preset];
    if (!preset) return;
    
    const state = controllerStates[uniqueId];
    
    // Poll buttons
    gamepad.buttons.forEach((button, index) => {
        const pressed = button.pressed;
        const wasPressed = state.buttons[index];
        
        if (pressed && !wasPressed) {
            const mapping = preset.buttons[index];
            if (mapping) {
                const velocity = Math.round(button.value * 127) || 100;
                sendNoteOnFromController(uniqueId, mapping.note, velocity);
            }
        } else if (!pressed && wasPressed) {
            const mapping = preset.buttons[index];
            if (mapping) {
                sendNoteOffFromController(uniqueId, mapping.note);
            }
        }
        
        state.buttons[index] = pressed;
    });
    
    // Poll axes
    gamepad.axes.forEach((value, index) => {
        const mapping = preset.axes[index];
        if (!mapping) return;
        
        const midiValue = Math.round((value + 1) * 63.5);
        const lastValue = state.axes[index] || 64;
        
        if (Math.abs(midiValue - lastValue) > 1) {
            sendCCFromController(uniqueId, mapping.cc, midiValue);
            state.axes[index] = midiValue;
        }
    });
}

// Connect button
document.getElementById('connectBtn').addEventListener('click', () => {
    scanControllers();
});

// Gamepad API events
window.addEventListener('gamepadconnected', (e) => {
    const uniqueId = `${e.gamepad.id}__idx${e.gamepad.index}`;
    console.log('[Controller] Connected:', e.gamepad.id, `(#${e.gamepad.index + 1})`);
    activeGamepads[e.gamepad.index] = e.gamepad;
    
    if (!controllerStates[uniqueId]) {
        controllerStates[uniqueId] = { buttons: {}, axes: {} };
    }
    
    updateControllerStatus();
    updateControllerManager();
    startPolling();
});

window.addEventListener('gamepaddisconnected', (e) => {
    const uniqueId = `${e.gamepad.id}__idx${e.gamepad.index}`;
    console.log('[Controller] Disconnected:', e.gamepad.id, `(#${e.gamepad.index + 1})`);
    delete activeGamepads[e.gamepad.index];
    
    updateControllerStatus();
    
    if (Object.keys(activeGamepads).length === 0 && pollInterval) {
        stopPolling();
    }
});

// WebRTC MIDI buttons
document.getElementById('webrtcBtn').addEventListener('click', toggleWebRTCConfig);
document.getElementById('btnGenerateAnswer').addEventListener('click', generateWebRTCAnswer);
document.getElementById('btnCopyAnswer').addEventListener('click', copyAnswerToClipboard);
document.getElementById('btnDisconnectWebRTC').addEventListener('click', disconnectWebRTCMIDI);

function toggleWebRTCConfig() {
    const config = document.getElementById('webrtc-config');
    config.style.display = config.style.display === 'none' ? 'block' : 'none';
}

async function generateWebRTCAnswer() {
    try {
        const offerInput = document.getElementById('webrtc-offer-input');
        const answerOutput = document.getElementById('webrtc-answer-output');
        const statusEl = document.getElementById('webrtc-status');

        const offerText = offerInput.value.trim();
        if (!offerText) {
            statusEl.textContent = '❌ Please paste an offer first';
            statusEl.style.color = '#ff0000';
            return;
        }

        // Check if BrowserMIDIRTC is available
        if (!window.BrowserMIDIRTC) {
            throw new Error('BrowserMIDIRTC not loaded yet - please wait');
        }

        console.log('[WebRTC MIDI] Creating receiver...');
        statusEl.textContent = '🔄 Connecting...';
        statusEl.style.color = '#ffaa00';

        // Create WebRTC MIDI receiver
        webrtcMidi = new window.BrowserMIDIRTC('receiver');
        await webrtcMidi.initialize();
        console.log('[WebRTC MIDI] Receiver initialized');

        // Handle incoming MIDI messages - forward to gamepad poll handler
        webrtcMidi.onMIDIMessage = (message) => {
            console.log('[WebRTC MIDI] Received:', message);
            if (message.data && message.data.length >= 3) {
                const [status, data1, data2] = message.data;
                const messageType = status & 0xF0;
                const channel = status & 0x0F;

                if (messageType === 0x90 && data2 > 0) {
                    // Note On
                    handleMIDIInput({ note: data1, velocity: data2, channel });
                } else if (messageType === 0x80 || (messageType === 0x90 && data2 === 0)) {
                    // Note Off
                    handleMIDINoteOff({ note: data1, channel });
                }
            }
        };

        // Handle connection state changes
        webrtcMidi.onConnectionStateChange = (state) => {
            console.log('[WebRTC MIDI] Connection state:', state);
            if (state === 'connected') {
                statusEl.textContent = '✅ Connected - MIDI is flowing!';
                statusEl.style.color = '#00ff00';
            } else if (state === 'disconnected' || state === 'failed') {
                statusEl.textContent = '❌ Connection failed or disconnected';
                statusEl.style.color = '#ff0000';
            }
        };

        // Handle offer and get answer
        const answer = await webrtcMidi.handleOffer(offerText);

        // Display answer
        answerOutput.value = answer;
        statusEl.textContent = '🔵 Waiting for bridge to connect...';
        statusEl.style.color = '#0066FF';
        console.log('[WebRTC MIDI] Answer generated');

    } catch (error) {
        console.error('[WebRTC MIDI] Error:', error);
        const statusEl = document.getElementById('webrtc-status');
        statusEl.textContent = '❌ Error: ' + error.message;
        statusEl.style.color = '#ff0000';
    }
}

function copyAnswerToClipboard() {
    const answerOutput = document.getElementById('webrtc-answer-output');
    answerOutput.select();
    navigator.clipboard.writeText(answerOutput.value).then(() => {
        console.log('[WebRTC MIDI] Answer copied to clipboard');
    }).catch(err => {
        console.error('[WebRTC MIDI] Failed to copy:', err);
    });
}

function disconnectWebRTCMIDI() {
    if (webrtcMidi) {
        webrtcMidi.close();
        webrtcMidi = null;
    }
    const statusEl = document.getElementById('webrtc-status');
    statusEl.textContent = '⚪ Not Connected';
    statusEl.style.color = '#666';
    document.getElementById('webrtc-offer-input').value = '';
    document.getElementById('webrtc-answer-output').value = '';
    console.log('[WebRTC MIDI] Disconnected');
}

// Helper to handle MIDI input from WebRTC
function handleMIDIInput(data) {
    // WebRTC MIDI passthrough - not used for controller routing
    console.log('[WebRTC MIDI] Input:', data);
}

function handleMIDINoteOff(data) {
    console.log('[WebRTC MIDI] Note Off:', data);
}

// Build button grid visualization (now using TriggerPads component)
function buildButtonGrid() {
    // Destroy existing instance if present
    if (triggerPadsInstance) {
        triggerPadsInstance.destroy();
    }
    
    // Get MIDI output if configured
    let midiOutput = null;
    if (activeTriggerConfig && activeTriggerConfig.midiDeviceId) {
        midiOutput = getMIDIDevice(activeTriggerConfig.midiDeviceId);
    }
    
    // Create new TriggerPads instance
    const preset = presets[currentPreset] || presets.default;
    const channel = activeTriggerConfig ? activeTriggerConfig.channel : 0;
    
    triggerPadsInstance = new TriggerPads('buttonGrid', {
        midiOutput: midiOutput,
        preset: preset,
        channel: channel,
        interactive: true,
        onNoteOn: (note, velocity, channel) => {
            console.log(`[Trigger Pads] Note On: ${note} vel: ${velocity} ch: ${channel + 1}`);
        },
        onNoteOff: (note, channel) => {
            console.log(`[Trigger Pads] Note Off: ${note} ch: ${channel + 1}`);
        }
    });
}

// Build axis display
function buildAxisDisplay() {
    const display = document.getElementById('axisDisplay');
    display.innerHTML = '';
    
    // Create left stick joystick
    const leftStick = document.createElement('div');
    leftStick.className = 'axis-item';
    leftStick.innerHTML = `
        <div class="axis-label">Left Stick (CC${axisMappings[0].cc}/${axisMappings[1].cc})</div>
        <div class="joystick-pad" id="leftStick">
            <div class="joystick-stick"></div>
        </div>
        <div class="axis-value" id="axis-0">X: 64, Y: 64</div>
    `;
    display.appendChild(leftStick);
    
    // Create right stick joystick
    const rightStick = document.createElement('div');
    rightStick.className = 'axis-item';
    rightStick.innerHTML = `
        <div class="axis-label">Right Stick (CC${axisMappings[2].cc}/${axisMappings[3].cc})</div>
        <div class="joystick-pad" id="rightStick">
            <div class="joystick-stick"></div>
        </div>
        <div class="axis-value" id="axis-2">X: 64, Y: 64</div>
    `;
    display.appendChild(rightStick);
    
    // Setup interactions
    setupJoystickInteraction(document.getElementById('leftStick'), 0, 1);
    setupJoystickInteraction(document.getElementById('rightStick'), 2, 3);
}

// Build mapping configuration UI
function buildMappingConfigs() {
    // Button mappings
    const buttonContainer = document.getElementById('buttonMappings');
    buttonContainer.innerHTML = '';
    
    Object.keys(buttonMappings).forEach(index => {
        const mapping = buttonMappings[index];
        const div = document.createElement('div');
        div.className = 'mapping-config';
        div.innerHTML = `
            <span class="mapping-label">${mapping.name}</span>
            <span>→</span>
            <span>Note</span>
            <input type="number" min="0" max="127" value="${mapping.note}" data-type="button" data-index="${index}" />
        `;
        buttonContainer.appendChild(div);
    });
    
    // Axis mappings
    const axisContainer = document.getElementById('axisMappings');
    axisContainer.innerHTML = '';
    
    Object.keys(axisMappings).forEach(index => {
        const mapping = axisMappings[index];
        const div = document.createElement('div');
        div.className = 'mapping-config';
        div.innerHTML = `
            <span class="mapping-label">${mapping.name}</span>
            <span>→</span>
            <span>CC</span>
            <input type="number" min="0" max="127" value="${mapping.cc}" data-type="axis" data-index="${index}" />
        `;
        axisContainer.appendChild(div);
    });
    
    // Add change listeners
    document.querySelectorAll('input[data-type]').forEach(input => {
        input.addEventListener('change', (e) => {
            const type = e.target.dataset.type;
            const index = parseInt(e.target.dataset.index);
            const value = parseInt(e.target.value);
            
            if (type === 'button') {
                buttonMappings[index].note = value;
                console.log('[Config] Button', index, 'mapped to note', value);
            } else if (type === 'axis') {
                axisMappings[index].cc = value;
                console.log('[Config] Axis', index, 'mapped to CC', value);
            }
        });
    });
}

// Update button visual (not used for controllers, only trigger pads)
function updateButtonVisual(index, active) {
    // Placeholder for trigger pad visual feedback if needed
}

// Toggle collapsible sections
function toggleSection(titleElement) {
    titleElement.classList.toggle('collapsed');
    const content = titleElement.nextElementSibling;
    content.classList.toggle('collapsed');
}

// Load preset
function loadPreset(presetName) {
    const preset = presets[presetName];
    if (!preset) return;
    
    currentPreset = presetName;
    buttonMappings = JSON.parse(JSON.stringify(preset.buttons));
    axisMappings = JSON.parse(JSON.stringify(preset.axes));
    
    // Update UI - highlight active preset button
    document.querySelectorAll('.preset-button').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Find and activate the clicked button
    const buttons = document.querySelectorAll('.preset-button');
    buttons.forEach(btn => {
        if ((presetName === 'default' && btn.textContent.includes('Default')) ||
            (presetName === 'drums' && btn.textContent.includes('Drum'))) {
            btn.classList.add('active');
        }
    });
    
    // Rebuild mapping displays (but keep them collapsed)
    buildButtonGrid();
    buildAxisDisplay();
    buildMappingConfigs();
    
    console.log('[Preset] Loaded:', preset.name);
}

// Touch/mouse interaction for buttons (with trigger config support)
function setupButtonInteraction(btn, index) {
    let isPressed = false;
    
    const handlePress = (e) => {
        e.preventDefault();
        if (isPressed) return;
        isPressed = true;
        
        const mapping = buttonMappings[index];
        if (mapping) {
            sendNoteOnFromTrigger(mapping.note, 100);
            btn.classList.add('active');
        }
    };

    const handleRelease = (e) => {
        e.preventDefault();
        if (!isPressed) return;
        isPressed = false;
        
        const mapping = buttonMappings[index];
        if (mapping) {
            sendNoteOffFromTrigger(mapping.note);
            btn.classList.remove('active');
        }
    };

    btn.addEventListener('mousedown', handlePress);
    btn.addEventListener('mouseup', handleRelease);
    btn.addEventListener('mouseleave', handleRelease);
    btn.addEventListener('touchstart', handlePress);
    btn.addEventListener('touchend', handleRelease);
    btn.addEventListener('touchcancel', handleRelease);
}

// Send note on from trigger pads
function sendNoteOnFromTrigger(note, velocity) {
    if (!activeTriggerConfig || !activeTriggerConfig.midiDeviceId) {
        console.log('[Trigger Pads] Not configured');
        return;
    }
    
    const device = getMIDIDevice(activeTriggerConfig.midiDeviceId);
    if (!device) {
        console.log('[Trigger Pads] Device not found');
        return;
    }
    
    sendToDevice(device, note, velocity, activeTriggerConfig.channel, true);
}

// Send note off from trigger pads
function sendNoteOffFromTrigger(note) {
    if (!activeTriggerConfig || !activeTriggerConfig.midiDeviceId) return;
    
    const device = getMIDIDevice(activeTriggerConfig.midiDeviceId);
    if (!device) return;
    
    sendToDevice(device, note, 0, activeTriggerConfig.channel, false);
}

// Touch/mouse interaction for joysticks (with trigger config support)
function setupJoystickInteraction(pad, xIndex, yIndex) {
    const stick = pad.querySelector('.joystick-stick');
    let isActive = false;

    const updateStick = (clientX, clientY) => {
        const rect = pad.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        
        let x = clientX - rect.left - centerX;
        let y = clientY - rect.top - centerY;
        
        const distance = Math.sqrt(x * x + y * y);
        const maxDistance = centerX - 15;
        if (distance > maxDistance) {
            x = (x / distance) * maxDistance;
            y = (y / distance) * maxDistance;
        }
        
        stick.style.left = `${centerX + x}px`;
        stick.style.top = `${centerY + y}px`;
        
        const axisX = x / maxDistance;
        const axisY = y / maxDistance;
        
        const xMapping = axisMappings[xIndex];
        const yMapping = axisMappings[yIndex];
        
        if (xMapping) {
            const midiX = Math.round((axisX + 1) * 63.5);
            sendCCFromTrigger(xMapping.cc, midiX);
        }
        if (yMapping) {
            const midiY = Math.round((axisY + 1) * 63.5);
            sendCCFromTrigger(yMapping.cc, midiY);
        }
    };

    const handleStart = (e) => {
        e.preventDefault();
        isActive = true;
        pad.classList.add('active');
        const touch = e.touches ? e.touches[0] : e;
        updateStick(touch.clientX, touch.clientY);
    };

    const handleMove = (e) => {
        if (!isActive) return;
        e.preventDefault();
        const touch = e.touches ? e.touches[0] : e;
        updateStick(touch.clientX, touch.clientY);
    };

    const handleEnd = (e) => {
        if (!isActive) return;
        e.preventDefault();
        isActive = false;
        pad.classList.remove('active');
        
        stick.style.left = '50%';
        stick.style.top = '50%';
        
        const xMapping = axisMappings[xIndex];
        const yMapping = axisMappings[yIndex];
        
        if (xMapping) sendCCFromTrigger(xMapping.cc, 64);
        if (yMapping) sendCCFromTrigger(yMapping.cc, 64);
    };

    pad.addEventListener('mousedown', handleStart);
    pad.addEventListener('mousemove', handleMove);
    pad.addEventListener('mouseup', handleEnd);
    pad.addEventListener('mouseleave', handleEnd);
    pad.addEventListener('touchstart', handleStart);
    pad.addEventListener('touchmove', handleMove);
    pad.addEventListener('touchend', handleEnd);
    pad.addEventListener('touchcancel', handleEnd);
}

// Send CC from trigger pads
function sendCCFromTrigger(cc, value) {
    if (!activeTriggerConfig || !activeTriggerConfig.midiDeviceId) return;
    
    const device = getMIDIDevice(activeTriggerConfig.midiDeviceId);
    if (!device) return;
    
    sendCCToDevice(device, cc, value, activeTriggerConfig.channel);
}

// Fullscreen functionality for Trigger Pads
function setupFullscreen() {
    const controllerVisual = document.querySelector('.controller-visual');
    if (!controllerVisual) return;

    // Click to enter fullscreen (only on background area when NOT in fullscreen)
    controllerVisual.addEventListener('click', (e) => {
        // Only allow entering fullscreen if clicking directly on the container background
        if (e.target !== controllerVisual) return;
        
        // Don't do anything if already in fullscreen
        if (document.fullscreenElement === controllerVisual) return;

        // Enter fullscreen
        if (controllerVisual.requestFullscreen) {
            controllerVisual.requestFullscreen();
        } else if (controllerVisual.webkitRequestFullscreen) {
            controllerVisual.webkitRequestFullscreen();
        } else if (controllerVisual.msRequestFullscreen) {
            controllerVisual.msRequestFullscreen();
        }
    });

    // Handle clicks on the exit button (::after pseudo-element)
    controllerVisual.addEventListener('click', (e) => {
        if (!document.fullscreenElement) return;
        
        // Check if click is in the top-right corner (exit button area)
        const rect = controllerVisual.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        
        // Exit button is at top-right: 10px from top, 10px from right, 32x32px
        if (clickX >= rect.width - 42 && clickX <= rect.width - 10 &&
            clickY >= 10 && clickY <= 42) {
            document.exitFullscreen();
        }
    });

    // Show hint only when hovering the background (not pads) and not in fullscreen
    controllerVisual.addEventListener('mousemove', (e) => {
        if (document.fullscreenElement) return;
        
        const style = window.getComputedStyle(controllerVisual, '::after');
        if (e.target === controllerVisual) {
            controllerVisual.style.setProperty('--hint-opacity', '1');
        } else {
            controllerVisual.style.setProperty('--hint-opacity', '0');
        }
    });

    controllerVisual.title = 'Click background for fullscreen';
    console.log('[Fullscreen] Trigger Pads fullscreen enabled - click X to exit');

    // Initial info update
    updateFullscreenInfo();
}

// Update fullscreen info display
function updateFullscreenInfo() {
    const deviceSelect = document.getElementById('triggerMidiDevice');
    const presetSelect = document.getElementById('triggerPreset');
    const channelSelect = document.getElementById('triggerChannel');

    const fsInfoDevice = document.getElementById('fsInfoDevice');
    const fsInfoPreset = document.getElementById('fsInfoPreset');
    const fsInfoChannel = document.getElementById('fsInfoChannel');

    if (fsInfoDevice && deviceSelect) {
        fsInfoDevice.textContent = deviceSelect.options[deviceSelect.selectedIndex]?.text || '-';
    }
    if (fsInfoPreset && presetSelect) {
        fsInfoPreset.textContent = presetSelect.options[presetSelect.selectedIndex]?.text || '-';
    }
    if (fsInfoChannel && channelSelect) {
        const channelText = channelSelect.options[channelSelect.selectedIndex]?.text || '-';
        fsInfoChannel.textContent = channelText;
    }
}

// Controller Manager UI
function updateControllerManager() {
    const container = document.getElementById('controllerManager');
    if (!container || !midiAccess) return;
    
    container.innerHTML = '';
    
    const midiOutputs = Array.from(midiAccess.outputs.values());
    if (midiOutputs.length === 0) {
        container.innerHTML = '<div class="info">No MIDI devices found. Please connect a MIDI device.</div>';
        return;
    }
    
    // Get unique controller IDs from connected gamepads
    const gamepads = navigator.getGamepads();
    const controllers = [];
    for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]) {
            const uniqueId = `${gamepads[i].id}__idx${gamepads[i].index}`;
            controllers.push({ uniqueId, name: gamepads[i].id, index: gamepads[i].index });
        }
    }
    
    if (controllers.length === 0) {
        container.innerHTML = '<div class="info">No controllers connected. Click "Connect Controllers" above to scan.</div>';
        return;
    }
    
    // Display each controller with its config
    controllers.forEach(({ uniqueId, name, index }) => {
        const controllerId = uniqueId;
        const config = controllerConfigs[controllerId] || { 
            midiDeviceId: '', 
            preset: 'default', 
            channel: 0, 
            enabled: false 
        };
        
        const controllerCard = document.createElement('div');
        controllerCard.className = 'device-card';
        controllerCard.innerHTML = `
            <div class="device-header" style="display: flex; align-items: center; gap: 8px;">
                <label class="device-enable" style="display: flex; align-items: center; gap: 8px; margin: 0;">
                    <input type="checkbox" data-controller-id="${controllerId}" ${config.enabled ? 'checked' : ''}>
                </label>
                <span class="device-name" style="flex: 1;">🎮 ${name}${controllers.filter(c => c.name === name).length > 1 ? ` #${index + 1}` : ''}</span>
                <button onclick="openPopoutController('${controllerId}')" style="padding: 6px 12px; background: #CF1A37; border: 1px solid #FF1A37; border-radius: 4px; color: white; cursor: pointer; font-size: 12px; white-space: nowrap;">🪟 Pop-Out</button>
            </div>
            <div class="device-config ${config.enabled ? '' : 'disabled'}">
                <div class="device-row">
                    <label>MIDI Device</label>
                    <select data-controller-id="${controllerId}" data-config="midiDeviceId">
                        <option value="">Select Output...</option>
                        ${midiOutputs.map(output => 
                            `<option value="${output.id}" ${config.midiDeviceId === output.id ? 'selected' : ''}>${output.name}</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="device-row">
                    <label>Preset</label>
                    <select data-controller-id="${controllerId}" data-config="preset">
                        <option value="default" ${config.preset === 'default' ? 'selected' : ''}>🎮 Default Layout</option>
                        <option value="drums" ${config.preset === 'drums' ? 'selected' : ''}>🥁 Drum Kit</option>
                    </select>
                </div>
                <div class="device-row">
                    <label>Channel</label>
                    <select data-controller-id="${controllerId}" data-config="channel">
                        ${Array.from({length: 16}, (_, i) => 
                            `<option value="${i}" ${config.channel === i ? 'selected' : ''}>Ch ${i + 1}${i === 9 ? ' (Drums)' : ''}</option>`
                        ).join('')}
                        <option value="-1" ${config.channel === -1 ? 'selected' : ''}>Omni (All)</option>
                    </select>
                </div>
            </div>
        `;
        
        container.appendChild(controllerCard);
    });
    
    // Setup event listeners for controllers
    container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const controllerId = e.target.dataset.controllerId;
            if (!controllerConfigs[controllerId]) {
                controllerConfigs[controllerId] = { midiDeviceId: '', preset: 'default', channel: 0, enabled: false };
            }
            controllerConfigs[controllerId].enabled = e.target.checked;
            saveControllerConfigs();
            updateControllerManager();
            console.log('[Controller]', controllerId, 'enabled:', e.target.checked);
        });
    });
    
    container.querySelectorAll('select[data-config]').forEach(select => {
        select.addEventListener('change', (e) => {
            const controllerId = e.target.dataset.controllerId;
            const configKey = e.target.dataset.config;
            
            if (!controllerConfigs[controllerId]) {
                controllerConfigs[controllerId] = { midiDeviceId: '', preset: 'default', channel: 0, enabled: false };
            }
            
            if (configKey === 'channel') {
                controllerConfigs[controllerId].channel = parseInt(e.target.value);
            } else {
                controllerConfigs[controllerId][configKey] = e.target.value;
            }
            
            saveControllerConfigs();
            console.log('[Controller]', controllerId, configKey, ':', e.target.value);
        });
    });
}

// Setup trigger pad controls
function setupTriggerPadControls() {
    console.log('[DEBUG] setupTriggerPadControls() called');
    const triggerMidiDevice = document.getElementById('triggerMidiDevice');
    const triggerPreset = document.getElementById('triggerPreset');
    const triggerChannel = document.getElementById('triggerChannel');
    
    console.log('[DEBUG] Elements found:', {
        triggerMidiDevice: !!triggerMidiDevice,
        triggerPreset: !!triggerPreset,
        triggerChannel: !!triggerChannel
    });
    
    // Populate MIDI devices when available
    if (midiAccess) {
        console.log('[DEBUG] MIDI access available, updating device list');
        updateTriggerMidiDeviceList();
    } else {
        console.warn('[DEBUG] MIDI access NOT available yet');
    }
    
    // Load saved config
    if (activeTriggerConfig) {
        console.log('[DEBUG] Loading saved config:', activeTriggerConfig);
        if (triggerMidiDevice && activeTriggerConfig.midiDeviceId) {
            triggerMidiDevice.value = activeTriggerConfig.midiDeviceId;
        }
        if (triggerPreset && activeTriggerConfig.preset) {
            triggerPreset.value = activeTriggerConfig.preset;
            loadPreset(activeTriggerConfig.preset);
        }
        if (triggerChannel && activeTriggerConfig.channel !== undefined) {
            triggerChannel.value = activeTriggerConfig.channel;
        }
    } else {
        console.log('[DEBUG] No saved config found');
    }
    
    // Setup listeners
    if (triggerMidiDevice) {
        triggerMidiDevice.addEventListener('change', (e) => {
            console.log('[DEBUG] MIDI device changed:', e.target.value);
            if (!activeTriggerConfig) activeTriggerConfig = { midiDeviceId: '', preset: 'default', channel: 0 };
            activeTriggerConfig.midiDeviceId = e.target.value;
            saveControllerConfigs();
            
            // Update TriggerPads component
            if (triggerPadsInstance) {
                const device = getMIDIDevice(e.target.value);
                triggerPadsInstance.setMidiOutput(device);
            }

            updateFullscreenInfo();
            console.log('[Trigger Pads] MIDI Device:', e.target.value);
        });
    }
    
    if (triggerPreset) {
        triggerPreset.addEventListener('change', (e) => {
            console.log('[DEBUG] Preset changed:', e.target.value);
            if (!activeTriggerConfig) activeTriggerConfig = { midiDeviceId: '', preset: 'default', channel: 0 };
            activeTriggerConfig.preset = e.target.value;
            loadPreset(e.target.value);
            saveControllerConfigs();
            
            // Update TriggerPads component
            if (triggerPadsInstance) {
                const preset = presets[e.target.value] || presets.default;
                triggerPadsInstance.setPreset(preset);
            }

            updateFullscreenInfo();
            console.log('[Trigger Pads] Preset:', e.target.value);
        });
    }
    
    if (triggerChannel) {
        triggerChannel.addEventListener('change', (e) => {
            console.log('[DEBUG] Channel changed:', e.target.value);
            if (!activeTriggerConfig) activeTriggerConfig = { midiDeviceId: '', preset: 'default', channel: 0 };
            activeTriggerConfig.channel = parseInt(e.target.value);
            saveControllerConfigs();
            
            // Update TriggerPads component
            if (triggerPadsInstance) {
                triggerPadsInstance.setChannel(parseInt(e.target.value));
            }

            updateFullscreenInfo();
            console.log('[Trigger Pads] Channel:', e.target.value);
        });
    }
    
    console.log('[DEBUG] setupTriggerPadControls() complete');
}

// Update trigger MIDI device list
function updateTriggerMidiDeviceList() {
    console.log('[DEBUG] updateTriggerMidiDeviceList() called');
    const triggerMidiDevice = document.getElementById('triggerMidiDevice');
    console.log('[DEBUG] triggerMidiDevice element:', triggerMidiDevice);
    
    if (!triggerMidiDevice) {
        console.error('[DEBUG] triggerMidiDevice element NOT FOUND in DOM!');
        return;
    }
    
    if (!midiAccess) {
        console.error('[DEBUG] midiAccess is null!');
        return;
    }
    
    const currentValue = triggerMidiDevice.value;
    console.log('[DEBUG] Current value:', currentValue);
    
    triggerMidiDevice.innerHTML = '<option value="">Select Output...</option>';
    
    const outputs = Array.from(midiAccess.outputs.values());
    console.log('[DEBUG] MIDI outputs:', outputs.length, outputs.map(o => o.name));
    
    outputs.forEach(output => {
        const option = document.createElement('option');
        option.value = output.id;
        option.textContent = output.name;
        triggerMidiDevice.appendChild(option);
        console.log('[DEBUG] Added option:', output.name, output.id);
    });
    
    // Restore selection
    if (currentValue) {
        triggerMidiDevice.value = currentValue;
        console.log('[DEBUG] Restored value:', currentValue);
    } else if (activeTriggerConfig && activeTriggerConfig.midiDeviceId) {
        triggerMidiDevice.value = activeTriggerConfig.midiDeviceId;
        console.log('[DEBUG] Restored from config:', activeTriggerConfig.midiDeviceId);
    }
    
    console.log('[DEBUG] Final dropdown HTML:', triggerMidiDevice.innerHTML.substring(0, 200));
}

// Initialize on load
console.log('[DEBUG] Script loaded, setting up load listener');
window.addEventListener('load', () => {
    console.log('[DEBUG] Window load event fired');
    console.log('[DEBUG] DOM ready, calling initMIDI()');
    
    // Initialize scene manager
    sceneManager.init();
    
    initMIDI();
    loadPreset('default');
    requestWakeLock();
    setTimeout(setupFullscreen, 500);
    
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./service-worker.js')
            .then(reg => console.log('[PWA] Service Worker registered', reg.scope))
            .catch(err => console.log('[PWA] Service Worker registration failed', err));
    }
});

console.log('[DEBUG] Script fully loaded');

// Scene Management
const sceneManager = {
    currentScene: 'trigger-pads',
    
    init() {
        console.log('[Scene] Initializing scene manager');
        
        // Menu button
        document.getElementById('menu-btn')?.addEventListener('click', () => {
            this.openMenu();
        });
        
        // Close menu button
        document.getElementById('close-menu')?.addEventListener('click', () => {
            this.closeMenu();
        });
        
        // Overlay click
        document.getElementById('nav-overlay')?.addEventListener('click', () => {
            this.closeMenu();
        });

        // Credits button
        document.getElementById('showCreditsBtn')?.addEventListener('click', () => {
            this.showCredits();
        });

        // Credits modal close
        document.getElementById('creditsClose')?.addEventListener('click', () => {
            this.closeCredits();
        });

        document.getElementById('creditsOverlay')?.addEventListener('click', () => {
            this.closeCredits();
        });

        // Nav items
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const scene = e.currentTarget.dataset.scene;
                this.switchScene(scene);
            });
        });
    },
    
    openMenu() {
        document.getElementById('nav-menu')?.classList.add('open');
        document.getElementById('nav-overlay')?.classList.add('active');
    },
    
    closeMenu() {
        document.getElementById('nav-menu')?.classList.remove('open');
        document.getElementById('nav-overlay')?.classList.remove('active');
    },

    showCredits() {
        document.getElementById('creditsOverlay')?.classList.add('active');
        document.getElementById('creditsModal')?.classList.add('active');
        this.closeMenu();
    },

    closeCredits() {
        document.getElementById('creditsOverlay')?.classList.remove('active');
        document.getElementById('creditsModal')?.classList.remove('active');
    },
    
    switchScene(sceneName) {
        console.log('[Scene] Switching to:', sceneName);
        
        // Hide all scenes
        document.querySelectorAll('.scene').forEach(scene => {
            scene.classList.remove('active');
        });
        
        // Show selected scene
        const targetScene = document.getElementById(`scene-${sceneName}`);
        if (targetScene) {
            targetScene.classList.add('active');
        }
        
        // Update nav items
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.scene === sceneName) {
                item.classList.add('active');
            }
        });
        
        // Update scene indicator
        const indicator = document.getElementById('scene-indicator');
        if (indicator) {
            const names = {
                'trigger-pads': 'TRIGGER PADS',
                'setup': 'SETUP',
                'presets': 'PRESETS'
            };
            indicator.textContent = names[sceneName] || sceneName.toUpperCase();
        }
        
        // Update preset name display if on presets scene
        if (sceneName === 'presets') {
            setupPresetSelector();
        }
        
        this.currentScene = sceneName;
        this.closeMenu();
    }
};


// Preset Manager
const presetManager = {
    // Export current preset to .rcp file
    exportPreset(presetName) {
        const preset = presets[presetName];
        if (!preset) {
            console.error('[Preset] Preset not found:', presetName);
            return;
        }
        
        const exportData = {
            version: 1,
            name: presetName,
            displayName: preset.name,
            buttons: preset.buttons,
            axes: preset.axes,
            exportedAt: new Date().toISOString()
        };
        
        const json = JSON.stringify(exportData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `${presetName}.rcp`;
        a.click();
        
        URL.revokeObjectURL(url);
        console.log('[Preset] Exported:', presetName);
    },
    
    // Import preset from .rcp file
    importPreset(file) {
        const reader = new FileReader();
        
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                // Validate structure
                if (!data.version || !data.name || !data.buttons || !data.axes) {
                    throw new Error('Invalid preset file format');
                }
                
                // Add to presets
                presets[data.name] = {
                    name: data.displayName || data.name,
                    buttons: data.buttons,
                    axes: data.axes
                };
                
                console.log('[Preset] Imported:', data.name);
                
                // Update UI
                this.updatePresetSelectors();
                
                // Load the imported preset
                loadPreset(data.name);
                
                nbDialog.alert(`Preset "${data.displayName || data.name}" imported successfully!`);
            } catch (error) {
                console.error('[Preset] Import failed:', error);
                nbDialog.alert('Failed to import preset: ' + error.message);
            }
        };
        
        reader.readAsText(file);
    },
    
    // Export all presets
    exportAllPresets() {
        const exportData = {
            version: 1,
            presets: presets,
            exportedAt: new Date().toISOString()
        };
        
        const json = JSON.stringify(exportData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = 'midi-controller-presets.rcp';
        a.click();
        
        URL.revokeObjectURL(url);
        console.log('[Preset] Exported all presets');
    },
    
    // Import multiple presets
    importPresets(file) {
        const reader = new FileReader();
        
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                if (!data.version || !data.presets) {
                    throw new Error('Invalid presets file format');
                }
                
                // Merge presets
                Object.assign(presets, data.presets);
                
                console.log('[Preset] Imported multiple presets');
                
                // Update UI
                this.updatePresetSelectors();
                
                nbDialog.alert(`Imported ${Object.keys(data.presets).length} preset(s) successfully!`);
            } catch (error) {
                console.error('[Preset] Import failed:', error);
                nbDialog.alert('Failed to import presets: ' + error.message);
            }
        };
        
        reader.readAsText(file);
    },
    
    // Update all preset selectors in UI
    updatePresetSelectors() {
        // Update trigger preset selector
        const triggerPreset = document.getElementById('triggerPreset');
        if (triggerPreset) {
            const currentValue = triggerPreset.value;
            triggerPreset.innerHTML = '';
            
            Object.keys(presets).forEach(key => {
                const option = document.createElement('option');
                option.value = key;
                option.textContent = presets[key].name;
                triggerPreset.appendChild(option);
            });
            
            if (currentValue && presets[currentValue]) {
                triggerPreset.value = currentValue;
            }
        }
        
        // Update preset selector on presets page
        const presetSelector = document.getElementById('preset-selector');
        if (presetSelector) {
            const currentValue = presetSelector.value;
            presetSelector.innerHTML = '';
            
            Object.keys(presets).forEach(key => {
                const option = document.createElement('option');
                option.value = key;
                option.textContent = presets[key].name;
                presetSelector.appendChild(option);
            });
            
            if (currentValue && presets[currentValue]) {
                presetSelector.value = currentValue;
            } else if (currentPreset) {
                presetSelector.value = currentPreset;
            }
        }
        
        // Update controller preset selectors
        document.querySelectorAll('select[data-config="preset"]').forEach(select => {
            const currentValue = select.value;
            select.innerHTML = '';
            
            Object.keys(presets).forEach(key => {
                const option = document.createElement('option');
                option.value = key;
                option.textContent = presets[key].name;
                select.appendChild(option);
            });
            
            if (currentValue && presets[currentValue]) {
                select.value = currentValue;
            }
        });
    },
    
    // Create new preset
    createNewPreset(name, displayName) {
        if (presets[name]) {
            nbDialog.alert('Preset already exists!');
            return false;
        }
        
        // Create from default template
        presets[name] = {
            name: displayName,
            buttons: JSON.parse(JSON.stringify(presets.default.buttons)),
            axes: JSON.parse(JSON.stringify(presets.default.axes))
        };
        
        this.updatePresetSelectors();
        loadPreset(name);
        
        console.log('[Preset] Created new preset:', name);
        return true;
    },
    
    // Delete preset
    deletePreset(name) {
        if (name === 'default' || name === 'drums') {
            nbDialog.alert('Cannot delete built-in presets!');
            return false;
        }
        
        if (!presets[name]) {
            nbDialog.alert('Preset not found!');
            return false;
        }
        
        nbDialog.confirm(`Delete preset "${presets[name].name}"?`, (confirmed) => {
            if (confirmed) {
                delete presets[name];
                this.updatePresetSelectors();
                loadPreset('default');
                console.log('[Preset] Deleted preset:', name);
            }
        });
        
        return true;
    }
};


// Helper functions for preset management
function handlePresetImport(file) {
    if (!file) return;
    
    // Check if it's a single preset or multiple
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (data.presets) {
                presetManager.importPresets(file);
            } else {
                presetManager.importPreset(file);
            }
        } catch (error) {
            nbDialog.alert('Invalid preset file!');
        }
    };
    reader.readAsText(file);
    
    // Reset input
    document.getElementById('import-preset').value = '';
}

function showNewPresetDialog() {
    nbDialog.prompt('Enter preset ID (lowercase, no spaces):', '', (name) => {
        if (!name) return;
        
        const cleanName = name.toLowerCase().replace(/\s+/g, '-');
        
        nbDialog.prompt('Enter preset display name:', '', (displayName) => {
            if (!displayName) return;
            
            if (presetManager.createNewPreset(cleanName, displayName)) {
                nbDialog.alert(`Preset "${displayName}" created! You can now customize it below.`);
            }
        });
    });
}


// Setup preset selector on presets page
function setupPresetSelector() {
    const presetSelector = document.getElementById('preset-selector');
    if (!presetSelector) return;
    
    console.log('[Preset] Setting up preset selector');
    
    // Populate with all presets
    presetSelector.innerHTML = '';
    Object.keys(presets).forEach(key => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = presets[key].name;
        presetSelector.appendChild(option);
    });
    
    // Set current preset
    if (currentPreset) {
        presetSelector.value = currentPreset;
    }
    
    // Listen for changes
    presetSelector.addEventListener('change', (e) => {
        const newPreset = e.target.value;
        console.log('[Preset] Switching to:', newPreset);
        loadPreset(newPreset);
    });
}


// Pop-out controller window - INDEPENDENT with own MIDI
let popoutWindows = {}; // { controllerId: window }
let popoutControllers = new Set(); // Controllers with active pop-out

function openPopoutController(controllerId) {
    // Check if already open for this controller
    if (popoutWindows[controllerId] && !popoutWindows[controllerId].closed) {
        popoutWindows[controllerId].focus();
        console.log('[PopOut] Controller window already open for', controllerId);
        return;
    }
    
    // Get the controller config
    const config = controllerConfigs[controllerId];
    if (!config) {
        nbDialog.alert('Controller not configured! Please configure it in Controller Manager first.');
        return;
    }
    
    console.log('[PopOut] Opening independent window for controller:', controllerId);
    
    // Build URL with config params
    const params = new URLSearchParams({
        controllerId: controllerId,
        midiDeviceId: config.midiDeviceId || '',
        preset: config.preset || 'default',
        channel: config.channel !== undefined ? config.channel : 9
    });
    
    // Open the pop-out with parameters
    const popup = window.open(
        `./controller-popout.html?${params.toString()}`,
        `midi_controller_${controllerId.replace(/\s+/g, '_')}`,
        'width=500,height=500,resizable=yes'
    );
    
    if (!popup) {
        nbDialog.alert('Pop-up blocked! Please allow pop-ups for this site.');
        console.error('[PopOut] Popup was blocked');
        return;
    }
    
    popoutWindows[controllerId] = popup;
    
    // Monitor pop-out closure
    const checkClosed = setInterval(() => {
        if (popup.closed) {
            clearInterval(checkClosed);
            popoutControllers.delete(controllerId);
            delete popoutWindows[controllerId];
            console.log('[PopOut] Window closed, resuming main page polling for:', controllerId);
        }
    }, 1000);
}

// Listen for messages from pop-out windows
window.addEventListener('message', (event) => {
    if (event.data.type === 'controllerPopoutOpened') {
        const controllerId = event.data.controllerId;
        popoutControllers.add(controllerId);
        console.log('[PopOut] Disabling main page polling for:', controllerId);
    } else if (event.data.type === 'controllerPopoutClosed') {
        const controllerId = event.data.controllerId;
        popoutControllers.delete(controllerId);
        console.log('[PopOut] Re-enabling main page polling for:', controllerId);
    }
});
