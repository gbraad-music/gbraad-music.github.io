// AHX Construct - Performance List Designer

// Waveform display (simplified canvas renderer)
class WaveformDisplayCanvas {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
    }

    draw(dataArray) {
        const ctx = this.ctx;
        const canvas = this.canvas;
        const bufferLength = dataArray.length;

        // Background
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Grid
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 1;
        for (let i = 0; i < 5; i++) {
            const y = (canvas.height / 4) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
        }

        // Waveform - REGROOVE RED
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#CF1A37';
        ctx.beginPath();

        const sliceWidth = canvas.width / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = v * canvas.height / 2;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }

            x += sliceWidth;
        }

        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.stroke();
    }
}

// Preset data
const preset = {
    waveform: 3,  // Noise
    wavelength: 5,
    volume: 64,
    envelope: {
        attack_time: 1,
        attack_volume: 64,
        decay_time: 17,
        decay_volume: 15,
        sustain_time: 4,
        release_time: 20,
        release_volume: 0
    },
    plist: {
        speed: 1,
        entries: []
    }
};

// PList entry template
function createPListEntry() {
    return {
        note: 45,
        fixed: 1,
        waveform: 0,  // 0=no change, 1=tri, 2=saw, 3=square, 4=noise
        fx1: 0,
        fx1_param: 0,
        fx2: 0,
        fx2_param: 0
    };
}

// Audio context and synth
let audioContext = null;
let ahxSynth = null;
let waveformDisplay = null;
let analyser = null;
let dataArray = null;
let currentPlayingSource = null;
let waveformScrollInterval = null;
let currentWaveformData = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize waveform display
    waveformDisplay = new WaveformDisplayCanvas('waveform');

    // Setup parameter bindings
    setupPresetControls();
    setupPListControls();

    // Add initial entries (kick preset)
    loadKickPreset();

    // Update display
    updateUI();
    updateCodeOutput();

    console.log('[AHX Construct] Initialized');
});

// Setup preset parameter controls
function setupPresetControls() {
    // Waveform
    const waveformSelect = document.getElementById('preset-waveform');
    waveformSelect.addEventListener('change', (e) => {
        preset.waveform = parseInt(e.target.value);
        updateCodeOutput();
    });

    // Bind sliders
    bindSlider('preset-wavelength', 'wavelength', 'preset-wavelength-val');
    bindSlider('preset-volume', 'volume', 'preset-volume-val');
    bindSlider('preset-atime', 'envelope.attack_time', 'preset-atime-val');
    bindSlider('preset-avol', 'envelope.attack_volume', 'preset-avol-val');
    bindSlider('preset-dtime', 'envelope.decay_time', 'preset-dtime-val');
    bindSlider('preset-dvol', 'envelope.decay_volume', 'preset-dvol-val');
    bindSlider('preset-stime', 'envelope.sustain_time', 'preset-stime-val');
    bindSlider('preset-rtime', 'envelope.release_time', 'preset-rtime-val');
    bindSlider('preset-rvol', 'envelope.release_volume', 'preset-rvol-val');
}

// Setup PList controls
function setupPListControls() {
    // Speed
    bindSlider('plist-speed', 'plist.speed', 'plist-speed-val');

    // Add entry button
    document.getElementById('add-entry-btn').addEventListener('click', () => {
        preset.plist.entries.push(createPListEntry());
        updateUI();
        updateCodeOutput();
    });

    // Preset buttons
    document.getElementById('load-kick-btn').addEventListener('click', loadKickPreset);
    document.getElementById('load-snare-btn').addEventListener('click', loadSnarePreset);
    document.getElementById('load-arp-btn').addEventListener('click', loadArpPreset);

    // Preview button
    document.getElementById('preview-btn').addEventListener('click', playPreview);

    // Export button
    document.getElementById('export-ahxp-btn').addEventListener('click', exportAHXP);

    // Copy button
    document.getElementById('copy-btn').addEventListener('click', copyCode);
}

// Bind slider to preset property
function bindSlider(sliderId, presetPath, valueId) {
    const slider = document.getElementById(sliderId);
    const valueSpan = document.getElementById(valueId);

    if (!slider || !valueSpan) return;

    slider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        valueSpan.textContent = value;

        // Set value in preset (handle nested paths)
        const parts = presetPath.split('.');
        let obj = preset;
        for (let i = 0; i < parts.length - 1; i++) {
            obj = obj[parts[i]];
        }
        obj[parts[parts.length - 1]] = value;

        updateCodeOutput();
    });
}

// Update UI - render PList table
function updateUI() {
    const tbody = document.getElementById('plist-entries');
    tbody.innerHTML = '';

    preset.plist.entries.forEach((entry, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${index}</td>
            <td><input type="number" class="entry-note" data-index="${index}" value="${entry.note}" min="0" max="60"></td>
            <td><input type="checkbox" class="entry-fixed" data-index="${index}" ${entry.fixed ? 'checked' : ''}></td>
            <td>
                <select class="entry-waveform" data-index="${index}">
                    <option value="0" ${entry.waveform === 0 ? 'selected' : ''}>-</option>
                    <option value="1" ${entry.waveform === 1 ? 'selected' : ''}>Tri</option>
                    <option value="2" ${entry.waveform === 2 ? 'selected' : ''}>Saw</option>
                    <option value="3" ${entry.waveform === 3 ? 'selected' : ''}>Sqr</option>
                    <option value="4" ${entry.waveform === 4 ? 'selected' : ''}>Noise</option>
                </select>
            </td>
            <td><input type="number" class="entry-fx1" data-index="${index}" value="${entry.fx1}" min="0" max="7"></td>
            <td><input type="number" class="entry-fx1param" data-index="${index}" value="${entry.fx1_param}" min="0" max="255"></td>
            <td><input type="number" class="entry-fx2" data-index="${index}" value="${entry.fx2}" min="0" max="7"></td>
            <td><input type="number" class="entry-fx2param" data-index="${index}" value="${entry.fx2_param}" min="0" max="255"></td>
            <td><button class="remove-entry" data-index="${index}">×</button></td>
        `;
        tbody.appendChild(row);
    });

    // Bind entry controls
    tbody.querySelectorAll('.entry-note').forEach(input => {
        input.addEventListener('input', (e) => {
            const index = parseInt(e.target.dataset.index);
            preset.plist.entries[index].note = parseInt(e.target.value);
            updateCodeOutput();
        });
    });

    tbody.querySelectorAll('.entry-fixed').forEach(input => {
        input.addEventListener('change', (e) => {
            const index = parseInt(e.target.dataset.index);
            preset.plist.entries[index].fixed = e.target.checked ? 1 : 0;
            updateCodeOutput();
        });
    });

    tbody.querySelectorAll('.entry-waveform').forEach(select => {
        select.addEventListener('change', (e) => {
            const index = parseInt(e.target.dataset.index);
            preset.plist.entries[index].waveform = parseInt(e.target.value);
            updateCodeOutput();
        });
    });

    tbody.querySelectorAll('.entry-fx1').forEach(input => {
        input.addEventListener('input', (e) => {
            const index = parseInt(e.target.dataset.index);
            preset.plist.entries[index].fx1 = parseInt(e.target.value);
            updateCodeOutput();
        });
    });

    tbody.querySelectorAll('.entry-fx1param').forEach(input => {
        input.addEventListener('input', (e) => {
            const index = parseInt(e.target.dataset.index);
            preset.plist.entries[index].fx1_param = parseInt(e.target.value);
            updateCodeOutput();
        });
    });

    tbody.querySelectorAll('.entry-fx2').forEach(input => {
        input.addEventListener('input', (e) => {
            const index = parseInt(e.target.dataset.index);
            preset.plist.entries[index].fx2 = parseInt(e.target.value);
            updateCodeOutput();
        });
    });

    tbody.querySelectorAll('.entry-fx2param').forEach(input => {
        input.addEventListener('input', (e) => {
            const index = parseInt(e.target.dataset.index);
            preset.plist.entries[index].fx2_param = parseInt(e.target.value);
            updateCodeOutput();
        });
    });

    tbody.querySelectorAll('.remove-entry').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            preset.plist.entries.splice(index, 1);
            updateUI();
            updateCodeOutput();
        });
    });
}

// Update code output
function updateCodeOutput() {
    const code = generateCCode();
    document.getElementById('code-output').textContent = code;
}

// Generate C code
function generateCCode() {
    let code = '// Auto-generated AHX Preset\n';
    code += '#ifndef PRESET_CUSTOM_H\n';
    code += '#define PRESET_CUSTOM_H\n\n';
    code += '#include "../../synth/ahx_preset.h"\n\n';

    // PList entries
    code += 'static AhxPListEntry preset_custom_plist_entries[] = {\n';
    preset.plist.entries.forEach((entry, index) => {
        code += `    {${entry.note}, ${entry.fixed}, ${entry.waveform}, {${entry.fx1}, ${entry.fx2}}, {${entry.fx1_param}, ${entry.fx2_param}}}`;
        if (index < preset.plist.entries.length - 1) code += ',';
        code += '\n';
    });
    code += '};\n\n';

    // PList
    code += 'static AhxPList preset_custom_plist = {\n';
    code += `    .speed = ${preset.plist.speed},\n`;
    code += `    .length = ${preset.plist.entries.length},\n`;
    code += '    .entries = preset_custom_plist_entries\n';
    code += '};\n\n';

    // Preset params
    code += 'static AhxInstrumentParams preset_custom_params = {\n';
    code += `    .waveform = ${preset.waveform},\n`;
    code += `    .wave_length = ${preset.wavelength},\n`;
    code += `    .volume = ${preset.volume},\n`;
    code += '    .envelope = {\n';
    code += `        .attack_frames = ${preset.envelope.attack_time},\n`;
    code += `        .attack_volume = ${preset.envelope.attack_volume},\n`;
    code += `        .decay_frames = ${preset.envelope.decay_time},\n`;
    code += `        .decay_volume = ${preset.envelope.decay_volume},\n`;
    code += `        .sustain_frames = ${preset.envelope.sustain_time},\n`;
    code += `        .release_frames = ${preset.envelope.release_time},\n`;
    code += `        .release_volume = ${preset.envelope.release_volume}\n`;
    code += '    },\n';
    code += '    .filter_lower = 0,\n';
    code += '    .filter_upper = 0,\n';
    code += '    .filter_speed = 0,\n';
    code += '    .filter_enabled = 0,\n';
    code += '    .square_lower = 32,\n';
    code += '    .square_upper = 32,\n';
    code += '    .square_speed = 1,\n';
    code += '    .square_enabled = 0,\n';
    code += '    .vibrato_delay = 0,\n';
    code += '    .vibrato_depth = 0,\n';
    code += '    .vibrato_speed = 0,\n';
    code += '    .hard_cut_release = 0,\n';
    code += '    .hard_cut_frames = 0,\n';
    code += '    .speed_multiplier = 3,\n';
    code += '    .plist = &preset_custom_plist\n';
    code += '};\n\n';
    code += '#endif // PRESET_CUSTOM_H\n';

    return code;
}

// Load kick preset
function loadKickPreset() {
    preset.waveform = 3;
    preset.wavelength = 5;
    preset.volume = 64;
    preset.envelope = {
        attack_time: 1,
        attack_volume: 64,
        decay_time: 17,
        decay_volume: 15,
        sustain_time: 4,
        release_time: 20,
        release_volume: 0
    };
    preset.plist = {
        speed: 1,
        entries: [
            {note: 45, fixed: 1, waveform: 4, fx1: 0, fx1_param: 0, fx2: 3, fx2_param: 32},
            {note: 56, fixed: 1, waveform: 3, fx1: 0, fx1_param: 0, fx2: 0, fx2_param: 0},
            {note: 54, fixed: 1, waveform: 0, fx1: 0, fx1_param: 0, fx2: 0, fx2_param: 0},
            {note: 52, fixed: 1, waveform: 0, fx1: 0, fx1_param: 0, fx2: 0, fx2_param: 0},
            {note: 50, fixed: 1, waveform: 1, fx1: 2, fx1_param: 32, fx2: 4, fx2_param: 0},
            {note: 0, fixed: 0, waveform: 0, fx1: 2, fx1_param: 32, fx2: 0, fx2_param: 0},
            {note: 0, fixed: 0, waveform: 0, fx1: 5, fx1_param: 5, fx2: 0, fx2_param: 0}
        ]
    };

    // Update UI controls
    document.getElementById('preset-waveform').value = preset.waveform;
    document.getElementById('preset-wavelength').value = preset.wavelength;
    document.getElementById('preset-volume').value = preset.volume;
    document.getElementById('plist-speed').value = preset.plist.speed;

    updateUI();
    updateCodeOutput();
}

// Load snare preset
function loadSnarePreset() {
    preset.waveform = 3;
    preset.wavelength = 5;
    preset.volume = 64;
    preset.envelope = {
        attack_time: 1,
        attack_volume: 64,
        decay_time: 10,
        decay_volume: 20,
        sustain_time: 5,
        release_time: 15,
        release_volume: 0
    };
    preset.plist = {
        speed: 1,
        entries: [
            {note: 50, fixed: 1, waveform: 4, fx1: 0, fx1_param: 0, fx2: 0, fx2_param: 0}
        ]
    };

    // Update UI controls
    document.getElementById('preset-waveform').value = preset.waveform;
    document.getElementById('preset-wavelength').value = preset.wavelength;
    document.getElementById('preset-volume').value = preset.volume;
    document.getElementById('plist-speed').value = preset.plist.speed;

    updateUI();
    updateCodeOutput();
}

// Load arp preset (from arp.ahxp)
async function loadPresetFromFile(url) {
    try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);

        // Parse AHXP format (skip header, go to PList at end)
        const headerSize = 0x190 + 32; // Based on binary structure
        const plistOffset = headerSize;

        const speed = data[plistOffset];
        const length = data[plistOffset + 1];

        const entries = [];
        let offset = plistOffset + 2;
        for (let i = 0; i < length; i++) {
            entries.push({
                note: data[offset++],
                fixed: data[offset++],
                waveform: data[offset++],
                fx1: data[offset++],
                fx1_param: data[offset++],
                fx2: data[offset++],
                fx2_param: data[offset++]
            });
        }

        // Read preset params from header
        preset.waveform = data[0x190];
        preset.wavelength = data[0x191];
        preset.volume = data[0x192];
        preset.envelope = {
            attack_time: data[0x193],
            attack_volume: data[0x194],
            decay_time: data[0x195],
            decay_volume: data[0x196],
            sustain_time: data[0x197],
            release_time: data[0x198],
            release_volume: data[0x199]
        };
        preset.plist = { speed, entries };

        updateUI();
        updateCodeOutput();
    } catch (err) {
        showNotification('Failed to load preset: ' + err.message, 'error');
    }
}

function loadArpPreset() {
    preset.waveform = 2; // Square
    preset.wavelength = 3;
    preset.volume = 64;
    preset.envelope = {
        attack_time: 1,
        attack_volume: 64,
        decay_time: 1,
        decay_volume: 64,
        sustain_time: 1,
        release_time: 1,
        release_volume: 64
    };
    preset.plist = {
        speed: 7,
        entries: [
            {note: 1, fixed: 0, waveform: 3, fx1: 6, fx1_param: 0x22, fx2: 0, fx2_param: 0x34},
            {note: 0, fixed: 0, waveform: 0, fx1: 6, fx1_param: 0x0A, fx2: 3, fx2_param: 0x30},
            {note: 1, fixed: 0, waveform: 2, fx1: 6, fx1_param: 0x22, fx2: 4, fx2_param: 0xFF},
            {note: 0, fixed: 0, waveform: 0, fx1: 6, fx1_param: 0x0A, fx2: 0, fx2_param: 0x00},
            {note: 54, fixed: 1, waveform: 1, fx1: 6, fx1_param: 0x22, fx2: 0, fx2_param: 0x00},
            {note: 0, fixed: 0, waveform: 0, fx1: 6, fx1_param: 0x0A, fx2: 0, fx2_param: 0x00},
            {note: 1, fixed: 0, waveform: 3, fx1: 6, fx1_param: 0x22, fx2: 0, fx2_param: 0x00},
            {note: 0, fixed: 0, waveform: 0, fx1: 6, fx1_param: 0x0A, fx2: 0, fx2_param: 0x00},
            {note: 1, fixed: 0, waveform: 2, fx1: 6, fx1_param: 0x22, fx2: 0, fx2_param: 0x00},
            {note: 0, fixed: 0, waveform: 0, fx1: 6, fx1_param: 0x0A, fx2: 0, fx2_param: 0x00},
            {note: 54, fixed: 1, waveform: 2, fx1: 6, fx1_param: 0x22, fx2: 0, fx2_param: 0x00},
            {note: 0, fixed: 0, waveform: 0, fx1: 6, fx1_param: 0x0A, fx2: 0, fx2_param: 0x00},
            {note: 1, fixed: 0, waveform: 3, fx1: 6, fx1_param: 0x22, fx2: 0, fx2_param: 0x00},
            {note: 0, fixed: 0, waveform: 0, fx1: 6, fx1_param: 0x0A, fx2: 0, fx2_param: 0x00},
            {note: 1, fixed: 0, waveform: 1, fx1: 6, fx1_param: 0x22, fx2: 0, fx2_param: 0x00},
            {note: 0, fixed: 0, waveform: 0, fx1: 6, fx1_param: 0x0A, fx2: 0, fx2_param: 0x00},
            {note: 54, fixed: 1, waveform: 3, fx1: 6, fx1_param: 0x22, fx2: 0, fx2_param: 0x00},
            {note: 0, fixed: 0, waveform: 0, fx1: 6, fx1_param: 0x0A, fx2: 0, fx2_param: 0x00},
            {note: 1, fixed: 0, waveform: 0, fx1: 6, fx1_param: 0x22, fx2: 0, fx2_param: 0x00},
            {note: 0, fixed: 0, waveform: 0, fx1: 6, fx1_param: 0x0A, fx2: 5, fx2_param: 0x02},
            {note: 0, fixed: 0, waveform: 0, fx1: 0, fx1_param: 0x00, fx2: 0, fx2_param: 0x00},
            {note: 0, fixed: 0, waveform: 0, fx1: 0, fx1_param: 0x00, fx2: 0, fx2_param: 0x00},
            {note: 0, fixed: 0, waveform: 0, fx1: 0, fx1_param: 0x00, fx2: 0, fx2_param: 0x00},
            {note: 0, fixed: 0, waveform: 0, fx1: 0, fx1_param: 0x00, fx2: 0, fx2_param: 0x00},
            {note: 0, fixed: 0, waveform: 0, fx1: 0, fx1_param: 0x00, fx2: 0, fx2_param: 0x00},
            {note: 0, fixed: 0, waveform: 0, fx1: 0, fx1_param: 0x00, fx2: 0, fx2_param: 0x00},
            {note: 0, fixed: 0, waveform: 0, fx1: 0, fx1_param: 0x00, fx2: 0, fx2_param: 0x00},
            {note: 0, fixed: 0, waveform: 0, fx1: 0, fx1_param: 0x00, fx2: 0, fx2_param: 0x00}
        ]
    };

    // Update UI controls
    document.getElementById('preset-waveform').value = preset.waveform;
    document.getElementById('preset-wavelength').value = preset.wavelength;
    document.getElementById('preset-volume').value = preset.volume;
    document.getElementById('plist-speed').value = preset.plist.speed;

    updateUI();
    updateCodeOutput();
}

// Load WASM module helper (exactly like synth-worklet-processor.js)
async function loadWASMModule() {
    if (ahxSynth && ahxSynth.Module) {
        return;
    }

    // Fetch JS code and WASM binary
    const [jsResponse, wasmResponse] = await Promise.all([
        fetch('../rfxsynths/rgahxsynth.js'),
        fetch('../rfxsynths/rgahxsynth.wasm')
    ]);

    const moduleCode = await jsResponse.text();
    const wasmBytes = await wasmResponse.arrayBuffer();

    // Patch code to capture wasmMemory (exactly like worklet)
    const modifiedCode = moduleCode.replace(
        ';return moduleRtn',
        ';globalThis.__wasmMemory=wasmMemory;return moduleRtn'
    );

    // Eval in function scope with fake CommonJS
    const fakeExports = {};
    const fakeModule = { exports: fakeExports };

    (function(module, exports) {
        eval(modifiedCode);
    })(fakeModule, fakeExports);

    // Get module factory
    const ModuleFactory = fakeModule.exports || fakeModule.exports.default;

    // Create module with WASM binary
    const Module = await ModuleFactory({
        wasmBinary: new Uint8Array(wasmBytes)
    });

    // Capture memory reference
    const wasmMemory = globalThis.__wasmMemory;
    delete globalThis.__wasmMemory;

    // Create synth instance (engine=1 for AHX, sample_rate)
    const synthPtr = Module._regroove_synth_create(1, audioContext.sampleRate);

    if (!synthPtr) {
        throw new Error('Failed to create synth instance');
    }

    ahxSynth = {
        Module: Module,
        instance: synthPtr,
        memory: wasmMemory
    };
}

// Play audio preview using RGAHX WASM synth
async function playPreview() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    // Stop any currently playing preview
    if (currentPlayingSource) {
        try {
            currentPlayingSource.stop();
        } catch (e) {}
        currentPlayingSource = null;
    }

    // Stop any existing scroll animation
    if (waveformScrollInterval) {
        clearInterval(waveformScrollInterval);
        waveformScrollInterval = null;
    }

    try {
        // Check if preset has PList entries
        if (!preset.plist || !preset.plist.entries || preset.plist.entries.length === 0) {
            throw new Error('No PList entries - load a preset first');
        }

        // Load WASM module if needed
        await loadWASMModule();

        const M = ahxSynth.Module;
        const inst = ahxSynth.instance;

        // Stop all voices BEFORE uploading preset
        M._regroove_synth_all_notes_off(inst);

        // Wait for voices to finish release by processing some frames
        const sampleRate = audioContext.sampleRate;
        const drainBuf = M._malloc(128 * 2 * 4);
        for (let i = 0; i < 50; i++) {
            M._regroove_synth_process_f32(inst, drainBuf, 128, sampleRate);
        }
        M._free(drainBuf);

        // Upload preset AFTER draining (builds PList directly in synth - includes clear_plist)
        uploadPresetToSynth();

        // Duration: 3 seconds
        const duration = 3.0;
        const numSamples = Math.floor(sampleRate * duration);

        // Trigger note
        M._regroove_synth_note_on(inst, 60, 127);

        // Render preview
        const chunkSize = 128;
        const buffer = audioContext.createBuffer(1, numSamples, sampleRate);
        const channelData = buffer.getChannelData(0);

        // Allocate buffer for rendering
        const chunkBufferPtr = M._malloc(chunkSize * 2 * 4);

        let offset = 0;
        while (offset < numSamples) {
            const framesToRender = Math.min(chunkSize, numSamples - offset);

            // Render chunk
            M._regroove_synth_process_f32(inst, chunkBufferPtr, framesToRender, sampleRate);

            // Copy left channel to output
            const chunkHeap = new Float32Array(ahxSynth.memory.buffer, chunkBufferPtr, chunkSize * 2);
            for (let i = 0; i < framesToRender; i++) {
                channelData[offset + i] = chunkHeap[i * 2];
            }

            offset += framesToRender;
        }

        // Free WASM memory
        M._free(chunkBufferPtr);

        // Ensure audio context is running
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        // Play
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        source.start();

        // Track current source
        currentPlayingSource = source;

        // Visualize with scrolling close-up view
        if (waveformDisplay) {
            // Store full waveform data
            currentWaveformData = {
                data: channelData,
                sampleRate: sampleRate,
                numSamples: numSamples
            };

            // Window size: 0.2 seconds (close-up view)
            const windowDuration = 0.2;
            const windowSamples = Math.floor(windowDuration * sampleRate);

            // Function to draw waveform at specific position
            const drawWaveformWindow = (scrollPosition) => {
                const vizData = new Uint8Array(2048);
                const startSample = Math.floor(scrollPosition);
                const endSample = Math.min(startSample + windowSamples, numSamples);

                for (let i = 0; i < 2048; i++) {
                    const idx = startSample + Math.floor((i / 2048) * (endSample - startSample));
                    if (idx < numSamples) {
                        vizData[i] = Math.floor((channelData[idx] + 1) * 128);
                    } else {
                        vizData[i] = 128; // Center line
                    }
                }
                waveformDisplay.draw(vizData);
            };

            // Start auto-scrolling during playback
            let scrollPosition = 0;
            let isPlaying = true;

            const updateWaveform = () => {
                if (!isPlaying) return;

                drawWaveformWindow(scrollPosition);

                // Move window forward (scroll at playback speed)
                scrollPosition += (sampleRate / 60); // 60 FPS update

                // Update scrollbar position
                const scrollbar = document.getElementById('waveform-scroll');
                if (scrollbar) {
                    scrollbar.value = (scrollPosition / numSamples) * 100;
                }

                // Stop when we reach the end
                if (scrollPosition >= numSamples) {
                    isPlaying = false;
                    if (waveformScrollInterval) {
                        clearInterval(waveformScrollInterval);
                        waveformScrollInterval = null;
                    }
                }
            };

            // Initial draw
            updateWaveform();

            // Start scrolling at 60 FPS during playback
            waveformScrollInterval = setInterval(updateWaveform, 1000 / 60);

            // Setup manual scrollbar control (for after playback)
            const scrollbar = document.getElementById('waveform-scroll');
            if (scrollbar) {
                scrollbar.oninput = (e) => {
                    if (!isPlaying && currentWaveformData) {
                        const position = (parseFloat(e.target.value) / 100) * currentWaveformData.numSamples;
                        drawWaveformWindow(position);
                    }
                };
            }

            // Stop auto-scroll when playback ends
            source.onended = () => {
                isPlaying = false;
                if (currentPlayingSource === source) {
                    currentPlayingSource = null;
                }
                if (waveformScrollInterval) {
                    clearInterval(waveformScrollInterval);
                    waveformScrollInterval = null;
                }
            };
        }
    } catch (err) {
        showNotification('Preview failed: ' + err.message, 'error');
    }
}

// Upload preset to WASM synth
function uploadPresetToSynth() {
    if (!ahxSynth) return;

    const M = ahxSynth.Module;
    const inst = ahxSynth.instance;

    // Check if functions exist
    if (typeof M._regroove_synth_set_parameter_int !== 'function') {
        return;
    }

    try {
        // Set basic parameters
        M._regroove_synth_set_parameter_int(inst, 0, preset.waveform); // Waveform
        M._regroove_synth_set_parameter_int(inst, 1, preset.wavelength); // Wave Length
        M._regroove_synth_set_parameter_int(inst, 2, preset.volume); // Volume

        // Envelope
        M._regroove_synth_set_parameter_int(inst, 3, preset.envelope.attack_time);
        M._regroove_synth_set_parameter_int(inst, 4, preset.envelope.attack_volume);
        M._regroove_synth_set_parameter_int(inst, 5, preset.envelope.decay_time);
        M._regroove_synth_set_parameter_int(inst, 6, preset.envelope.decay_volume);
        M._regroove_synth_set_parameter_int(inst, 7, preset.envelope.sustain_time);
        M._regroove_synth_set_parameter_int(inst, 8, preset.envelope.release_time);
        M._regroove_synth_set_parameter_int(inst, 9, preset.envelope.release_volume);

        // Clear PList if function exists
        if (typeof M._regroove_synth_clear_plist === 'function') {
            M._regroove_synth_clear_plist(inst);
        }

        // Add PList entries
        if (typeof M._regroove_synth_add_plist_entry === 'function' &&
            typeof M._regroove_synth_set_plist_entry === 'function') {
            preset.plist.entries.forEach((entry, index) => {
                // Add blank entry first
                M._regroove_synth_add_plist_entry(inst);
                // Set entry data (fx1 -> fx0, fx2 -> fx1 in C code)
                M._regroove_synth_set_plist_entry(
                    inst,
                    index,
                    entry.note,
                    entry.fixed,
                    entry.waveform,
                    entry.fx1,      // C fx0
                    entry.fx1_param,
                    entry.fx2,      // C fx1
                    entry.fx2_param
                );
            });
        }

        // Set PList speed AFTER adding entries (so plist exists)
        if (typeof M._regroove_synth_set_plist_speed === 'function') {
            M._regroove_synth_set_plist_speed(inst, preset.plist.speed);
        }
    } catch (err) {
        throw err;
    }
}

// Simple notification system (nbdialog replacement)
function showNotification(message, type = 'info') {
    const notif = document.createElement('div');
    notif.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background: ${type === 'error' ? '#ff3333' : type === 'success' ? '#33ff33' : '#CF1A37'};
        color: ${type === 'success' ? '#000' : '#fff'};
        padding: 12px 20px;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        z-index: 10000;
        font-size: 14px;
        max-width: 300px;
    `;
    notif.textContent = message;
    document.body.appendChild(notif);

    setTimeout(() => {
        notif.style.transition = 'opacity 0.3s';
        notif.style.opacity = '0';
        setTimeout(() => notif.remove(), 300);
    }, 3000);
}

// Export AHXP file
async function exportAHXP() {
    try {
        // Load WASM module if needed
        await loadWASMModule();

        // Upload preset to WASM
        uploadPresetToSynth();

        // Check if export function exists
        if (typeof ahxSynth.Module._regroove_synth_export_preset !== 'function') {
            throw new Error('Export function not available in WASM module');
        }

        // Export preset
        // Allocate name string
        const nameStr = "AHX Preset\0";
        const namePtr = ahxSynth.Module._malloc(nameStr.length);
        new Uint8Array(ahxSynth.memory.buffer, namePtr, nameStr.length).set(
            new TextEncoder().encode(nameStr)
        );

        const sizePtr = ahxSynth.Module._malloc(4);
        const dataPtr = ahxSynth.Module._regroove_synth_export_preset(ahxSynth.instance, namePtr, sizePtr);

        ahxSynth.Module._free(namePtr);

        if (!dataPtr) {
            ahxSynth.Module._free(sizePtr);
            throw new Error('Failed to export preset from synth');
        }

        const size = new Uint32Array(ahxSynth.memory.buffer, sizePtr, 1)[0];

        // Copy data before freeing
        const data = new Uint8Array(size);
        data.set(new Uint8Array(ahxSynth.memory.buffer, dataPtr, size));

        // Free WASM memory
        ahxSynth.Module._regroove_synth_free_preset_buffer(dataPtr);
        ahxSynth.Module._free(sizePtr);

        // Create blob and download
        const blob = new Blob([data], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'preset_custom.ahxp';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showNotification('AHXP file downloaded!', 'success');
    } catch (err) {
        showNotification('Export failed: ' + err.message, 'error');
    }
}


// Copy code
function copyCode() {
    const code = document.getElementById('code-output').textContent;
    navigator.clipboard.writeText(code).then(() => {
        showNotification('Code copied to clipboard!', 'success');
    }).catch(err => {
        console.error('Failed to copy:', err);
        showNotification('Failed to copy code', 'error');
    });
}
