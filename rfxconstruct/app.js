// RFX Construct - Drum Synthesis Designer with Multiple Oscillators
let nextOscId = 0;
const oscillators = [];

// Audio context for preview
let audioContext = null;

// Oscillator template
function createOscillator() {
    return {
        id: nextOscId++,
        enabled: true,
        collapsed: false,
        waveform: 'sine',
        startFreq: 180,
        endFreq: 50,
        sweepTime: 20,
        decayTime: 100,
        amplitude: 0.85,
        blendMode: 'add'
    };
}

// Global saturation
const globalParams = {
    satAmount: 3.5,
    satScale: 0.7
};

// DOM elements
const canvas = document.getElementById('waveform');
const ctx = canvas.getContext('2d');
const codeOutput = document.getElementById('code-output');
const oscillatorsContainer = document.getElementById('oscillators-container');

// Waveform generators
const waveforms = {
    sine: (phase) => Math.sin(phase * 2 * Math.PI),
    triangle: (phase) => Math.abs(phase * 4 - 2) - 1,
    square: (phase) => phase < 0.5 ? -1 : 1,
    saw: (phase) => phase * 2 - 1,
    noise: () => Math.random() * 2 - 1
};

// Create oscillator UI
function createOscillatorUI(osc) {
    const card = document.createElement('div');
    card.className = 'osc-card';
    card.dataset.oscId = osc.id;

    card.innerHTML = `
        <div class="osc-header">
            <div class="osc-title">
                <h3>Oscillator ${osc.id + 1}</h3>
                <label style="display: flex; align-items: center; gap: 5px; font-size: 0.8em;">
                    <input type="checkbox" class="osc-enabled" ${osc.enabled ? 'checked' : ''}>
                    <span>Enabled</span>
                </label>
            </div>
            <div class="osc-controls">
                <button class="icon-button collapse-btn" title="Collapse">−</button>
                ${oscillators.length > 1 ? '<button class="icon-button remove-btn" title="Remove">×</button>' : ''}
            </div>
        </div>
        <div class="osc-body">
            <div class="waveform-selector">
                <button class="wave-btn ${osc.waveform === 'sine' ? 'active' : ''}" data-wave="sine">Sine</button>
                <button class="wave-btn ${osc.waveform === 'triangle' ? 'active' : ''}" data-wave="triangle">Tri</button>
                <button class="wave-btn ${osc.waveform === 'square' ? 'active' : ''}" data-wave="square">Sqr</button>
                <button class="wave-btn ${osc.waveform === 'saw' ? 'active' : ''}" data-wave="saw">Saw</button>
                <button class="wave-btn ${osc.waveform === 'noise' ? 'active' : ''}" data-wave="noise">Noise</button>
            </div>
            <div class="param-group">
                ${osc.waveform !== 'noise' ? `
                <label>
                    <span>Start Frequency: <strong class="start-freq-val">${osc.startFreq}</strong> Hz</span>
                    <input type="range" class="start-freq" min="50" max="400" value="${osc.startFreq}" step="1">
                </label>
                <label>
                    <span>End Frequency: <strong class="end-freq-val">${osc.endFreq}</strong> Hz</span>
                    <input type="range" class="end-freq" min="20" max="150" value="${osc.endFreq}" step="1">
                </label>
                <label>
                    <span>Sweep Time: <strong class="sweep-time-val">${osc.sweepTime}</strong> ms</span>
                    <input type="range" class="sweep-time" min="5" max="50" value="${osc.sweepTime}" step="1">
                </label>
                ` : ''}
                <label>
                    <span>Decay Time: <strong class="decay-time-val">${osc.decayTime}</strong> ms</span>
                    <input type="range" class="decay-time" min="5" max="200" value="${osc.decayTime}" step="1">
                </label>
                <label>
                    <span>Amplitude: <strong class="amplitude-val">${osc.amplitude}</strong></span>
                    <input type="range" class="amplitude" min="0" max="2" value="${osc.amplitude}" step="0.01">
                </label>
            </div>
            <div class="blend-mode">
                <label>
                    Blend Mode
                    <select class="blend-select">
                        <option value="add" ${osc.blendMode === 'add' ? 'selected' : ''}>Add</option>
                        <option value="multiply" ${osc.blendMode === 'multiply' ? 'selected' : ''}>Multiply</option>
                        <option value="ringmod" ${osc.blendMode === 'ringmod' ? 'selected' : ''}>Ring Modulation</option>
                    </select>
                </label>
            </div>
        </div>
    `;

    // Event listeners
    const enabledCheck = card.querySelector('.osc-enabled');
    enabledCheck.addEventListener('change', (e) => {
        osc.enabled = e.target.checked;
        update();
    });

    const collapseBtn = card.querySelector('.collapse-btn');
    collapseBtn.addEventListener('click', () => {
        osc.collapsed = !osc.collapsed;
        card.classList.toggle('collapsed');
        collapseBtn.textContent = osc.collapsed ? '+' : '−';
    });

    const removeBtn = card.querySelector('.remove-btn');
    if (removeBtn) {
        removeBtn.addEventListener('click', () => {
            const index = oscillators.findIndex(o => o.id === osc.id);
            if (index > -1) {
                oscillators.splice(index, 1);
                renderOscillators();
                update();
            }
        });
    }

    // Waveform selector
    card.querySelectorAll('.wave-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            osc.waveform = btn.dataset.wave;
            renderOscillators();
            update();
        });
    });

    // Parameters
    const bindSlider = (selector, param, valSelector) => {
        const slider = card.querySelector(selector);
        const valueSpan = card.querySelector(valSelector);
        if (slider && valueSpan) {
            slider.addEventListener('input', (e) => {
                osc[param] = parseFloat(e.target.value);
                valueSpan.textContent = osc[param];
                update();
            });
        }
    };

    bindSlider('.start-freq', 'startFreq', '.start-freq-val');
    bindSlider('.end-freq', 'endFreq', '.end-freq-val');
    bindSlider('.sweep-time', 'sweepTime', '.sweep-time-val');
    bindSlider('.decay-time', 'decayTime', '.decay-time-val');
    bindSlider('.amplitude', 'amplitude', '.amplitude-val');

    const blendSelect = card.querySelector('.blend-select');
    blendSelect.addEventListener('change', (e) => {
        osc.blendMode = e.target.value;
        update();
    });

    return card;
}

// Render all oscillators
function renderOscillators() {
    oscillatorsContainer.innerHTML = '';
    oscillators.forEach(osc => {
        oscillatorsContainer.appendChild(createOscillatorUI(osc));
    });
}

// Generate waveform samples
function generateWaveform(sampleRate = 48000) {
    const maxDuration = Math.max(...oscillators.map(o => o.decayTime)) / 1000;
    const numSamples = Math.floor(maxDuration * sampleRate);
    const samples = new Float32Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        let sample = 0;
        let firstSample = 0;

        oscillators.forEach((osc, idx) => {
            if (!osc.enabled) return;

            const decaySec = osc.decayTime / 1000;
            if (t >= decaySec) return;

            let oscSample = 0;

            if (osc.waveform === 'noise') {
                // Noise envelope
                const tau = decaySec / 3;
                const env = Math.exp(-t / tau);
                oscSample = waveforms.noise() * env * osc.amplitude;
            } else {
                // Swept oscillator
                const sweepTimeSec = osc.sweepTime / 1000;
                const sweepT = Math.min(t / sweepTimeSec, 1.0);
                const freqRatio = osc.startFreq / osc.endFreq;
                let freq = osc.endFreq * Math.pow(freqRatio, 1.0 - sweepT);

                if (t > sweepTimeSec) {
                    const slowT = (t - sweepTimeSec) / (decaySec - sweepTimeSec);
                    freq = osc.endFreq * Math.pow(1.2, 1.0 - Math.min(slowT, 1.0));
                }

                const phase = ((freq * t) % 1.0);
                const wave = waveforms[osc.waveform](phase);

                const tau = decaySec / 3;
                const env = Math.exp(-t / tau);

                oscSample = wave * env * osc.amplitude;
            }

            // Blend modes
            if (idx === 0) {
                firstSample = oscSample;
                sample = oscSample;
            } else {
                switch (osc.blendMode) {
                    case 'add':
                        sample += oscSample;
                        break;
                    case 'multiply':
                        sample *= (1.0 + oscSample);
                        break;
                    case 'ringmod':
                        sample = firstSample * oscSample;
                        break;
                }
            }
        });

        // Global saturation
        sample = Math.tanh(sample * globalParams.satAmount) * globalParams.satScale;
        samples[i] = sample;
    }

    return samples;
}

// Play audio preview
function playPreview() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    const samples = generateWaveform(audioContext.sampleRate);
    const buffer = audioContext.createBuffer(1, samples.length, audioContext.sampleRate);
    const channelData = buffer.getChannelData(0);
    channelData.set(samples);

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start();
}

// Draw waveform
function drawWaveform(samples) {
    const width = canvas.width;
    const height = canvas.height;

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1;

    for (let i = 0; i <= 4; i++) {
        const y = (height / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }

    for (let i = 0; i <= 10; i++) {
        const x = (width / 10) * i;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }

    // Center line
    ctx.strokeStyle = '#333';
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Waveform
    ctx.strokeStyle = '#CF1A37';
    ctx.lineWidth = 2;
    ctx.beginPath();

    const step = Math.max(1, Math.floor(samples.length / width));

    for (let i = 0; i < samples.length; i += step) {
        const x = (i / samples.length) * width;
        const y = height / 2 - (samples[i] * height / 2.5);

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }

    ctx.stroke();

    // Time markers
    ctx.fillStyle = '#666';
    ctx.font = '10px monospace';
    const totalMs = Math.max(...oscillators.map(o => o.decayTime));
    for (let i = 0; i <= 10; i++) {
        const x = (width / 10) * i;
        const timeMs = (totalMs / 10) * i;
        ctx.fillText(timeMs.toFixed(0) + 'ms', x + 2, height - 5);
    }
}

// Generate C code
function generateCode() {
    let code = `// Drum Synthesis - Generated by RFX Construct\n// ${oscillators.length} oscillator(s)\n\n`;

    code += `// Global saturation: ${globalParams.satAmount}x, output: ${globalParams.satScale}\n\n`;

    oscillators.forEach((osc, idx) => {
        code += `// Oscillator ${idx + 1}: ${osc.waveform} (${osc.enabled ? 'enabled' : 'disabled'})\n`;
        if (osc.waveform !== 'noise') {
            code += `// Start: ${osc.startFreq}Hz, End: ${osc.endFreq}Hz, Sweep: ${osc.sweepTime}ms\n`;
        }
        code += `// Decay: ${osc.decayTime}ms, Amplitude: ${osc.amplitude}, Blend: ${osc.blendMode}\n\n`;
    });

    code += `// Implementation example:\n`;
    code += `float t = voice->sweep_pos;\n`;
    code += `float sample = 0.0f;\n`;
    code += `float first_sample = 0.0f;\n\n`;

    oscillators.forEach((osc, idx) => {
        if (!osc.enabled) return;

        code += `// Oscillator ${idx + 1}\n{\n`;

        if (osc.waveform === 'noise') {
            code += `    float decay${idx} = ${(osc.decayTime / 1000).toFixed(4)}f;\n`;
            code += `    if (t < decay${idx}) {\n`;
            code += `        float env = expf(-t / (decay${idx} / 3.0f));\n`;
            code += `        float noise = (rand() / (float)RAND_MAX) * 2.0f - 1.0f;\n`;
            code += `        float osc${idx} = noise * env * ${osc.amplitude.toFixed(2)}f;\n`;
        } else {
            code += `    float sweep${idx} = ${(osc.sweepTime / 1000).toFixed(4)}f;\n`;
            code += `    float decay${idx} = ${(osc.decayTime / 1000).toFixed(4)}f;\n`;
            code += `    if (t < decay${idx}) {\n`;
            code += `        float sweepT = fminf(t / sweep${idx}, 1.0f);\n`;
            code += `        float freq = ${osc.endFreq.toFixed(1)}f * powf(${(osc.startFreq / osc.endFreq).toFixed(2)}f, 1.0f - sweepT);\n`;
            code += `        float phase = fmodf(freq * t, 1.0f);\n`;

            switch (osc.waveform) {
                case 'sine':
                    code += `        float wave = sinf(phase * 2.0f * M_PI);\n`;
                    break;
                case 'triangle':
                    code += `        float wave = fabsf(phase * 4.0f - 2.0f) - 1.0f;\n`;
                    break;
                case 'square':
                    code += `        float wave = (phase < 0.5f) ? -1.0f : 1.0f;\n`;
                    break;
                case 'saw':
                    code += `        float wave = phase * 2.0f - 1.0f;\n`;
                    break;
            }

            code += `        float env = expf(-t / (decay${idx} / 3.0f));\n`;
            code += `        float osc${idx} = wave * env * ${osc.amplitude.toFixed(2)}f;\n`;
        }

        if (idx === 0) {
            code += `        first_sample = osc${idx};\n`;
            code += `        sample = osc${idx};\n`;
        } else {
            switch (osc.blendMode) {
                case 'add':
                    code += `        sample += osc${idx};\n`;
                    break;
                case 'multiply':
                    code += `        sample *= (1.0f + osc${idx});\n`;
                    break;
                case 'ringmod':
                    code += `        sample = first_sample * osc${idx};\n`;
                    break;
            }
        }

        code += `    }\n}\n\n`;
    });

    code += `// Global saturation\n`;
    code += `sample = tanhf(sample * ${globalParams.satAmount.toFixed(1)}f) * ${globalParams.satScale.toFixed(2)}f;\n`;

    return code;
}

// Update visualization and code
function update() {
    const samples = generateWaveform();
    drawWaveform(samples);
    codeOutput.textContent = generateCode();
}

// Initialize with default oscillator
oscillators.push(createOscillator());
oscillators[0].waveform = 'sine';
oscillators[0].startFreq = 180;
oscillators[0].endFreq = 50;
renderOscillators();
update();

// Add oscillator button
document.getElementById('add-osc-btn').addEventListener('click', () => {
    oscillators.push(createOscillator());
    renderOscillators();
    update();
});

// Global saturation sliders
document.getElementById('sat-amount').addEventListener('input', (e) => {
    globalParams.satAmount = parseFloat(e.target.value);
    document.getElementById('sat-amount-val').textContent = globalParams.satAmount;
    update();
});

document.getElementById('sat-scale').addEventListener('input', (e) => {
    globalParams.satScale = parseFloat(e.target.value);
    document.getElementById('sat-scale-val').textContent = globalParams.satScale;
    update();
});

// Reset button
document.getElementById('reset-btn').addEventListener('click', () => {
    oscillators.length = 0;
    oscillators.push(createOscillator());
    globalParams.satAmount = 3.5;
    globalParams.satScale = 0.7;
    document.getElementById('sat-amount').value = 3.5;
    document.getElementById('sat-amount-val').textContent = 3.5;
    document.getElementById('sat-scale').value = 0.7;
    document.getElementById('sat-scale-val').textContent = 0.7;
    renderOscillators();
    update();
});

// Copy button
document.getElementById('copy-btn').addEventListener('click', () => {
    const code = codeOutput.textContent;
    navigator.clipboard.writeText(code).then(() => {
        const btn = document.getElementById('copy-btn');
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
    });
});

// Add preview button (will be added in HTML)
if (document.getElementById('preview-btn')) {
    document.getElementById('preview-btn').addEventListener('click', playPreview);
}
