// RX7 Construct - DX7 Patch Editor
// Based on DX7 voice format and mmontag/dx7-synth-js

// DX7 Patch Structure (155 bytes packed)
const defaultPatch = {
    name: 'INIT VOICE',
    algorithm: 1,
    feedback: 0,
    lfoSpeed: 35,
    lfoDelay: 0,
    lfoPitchModDepth: 0,
    lfoAmpModDepth: 0,
    lfoPitchModSens: 3,
    lfoWaveform: 0,
    lfoSync: 1,
    pitchEnvRates: [99, 99, 99, 99],
    pitchEnvLevels: [50, 50, 50, 50],
    operators: []
};

// Initialize 6 operators (DX7 has 6 → 1)
// Note: operators[0]=op6, operators[5]=op1 (stored in reverse order like DX7 SysEx)
// Only operator 1 (operators[5]) is enabled by default for simple sine wave
for (let i = 0; i < 6; i++) {
    const isOp1 = (i === 5); // operators[5] is operator 1
    defaultPatch.operators.push({
        rates: [99, 99, 99, 99],  // Fast attack/decay, instant sustain/release
        levels: [99, 99, 99, 0],   // Full level until release
        keyScaleBreakpoint: 39, // C3
        keyScaleDepthL: 0,
        keyScaleDepthR: 0,
        keyScaleCurveL: 0,
        keyScaleCurveR: 0,
        keyScaleRate: 0,
        detune: 0,
        lfoAmpModSens: 0,
        velocitySens: 0,
        volume: isOp1 ? 99 : 0,  // Only operator 1 audible
        oscMode: 0, // 0 = ratio, 1 = fixed
        freqCoarse: 1,
        freqFine: 0,
        enabled: isOp1  // Only operator 1 enabled
    });
}

let currentPatch = JSON.parse(JSON.stringify(defaultPatch));
let cartridge = null; // Loaded cartridge (32 voices)
let cartridgeSysex = null; // Raw SysEx data for synth engine
let selectedSlot = -1;

// Audio system
let audioContext = null;
let rx7WorkletNode = null;
let gainNode = null;
let audioReady = false;

// MIDI and keyboard
let midiManager = null;
let keyboardEnabled = false;
let activeNotes = new Set();
let currentOctave = 4; // C4

// Live update
let liveUpdateEnabled = false;
let updateTimeout = null;

// Simple notification system
function showNotification(message, type = 'info') {
    const notif = document.createElement('div');
    notif.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background: ${type === 'error' ? '#ff3333' : type === 'success' ? '#33ff33' : '#be3b65'};
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

// DX7 Algorithm Definitions (all 32 algorithms)
// Format: { outputMix: [ops that go to output], modulationMatrix: [for each op, list of ops that modulate it] }
const DX7_ALGORITHMS = [
    // Algorithm 1
    { outputMix: [0, 2], modulationMatrix: [[1], [], [3], [4], [5], [5]] },
    // Algorithm 2
    { outputMix: [0, 2], modulationMatrix: [[1], [1], [3], [4], [5], []] },
    // Algorithm 3
    { outputMix: [0, 3], modulationMatrix: [[1], [2], [], [4], [5], [5]] },
    // Algorithm 4
    { outputMix: [0, 3], modulationMatrix: [[1], [2], [], [4], [5], [3]] },
    // Algorithm 5
    { outputMix: [0, 2, 4], modulationMatrix: [[1], [], [3], [], [5], [5]] },
    // Algorithm 6
    { outputMix: [0, 2, 4], modulationMatrix: [[1], [], [3], [], [5], [4]] },
    // Algorithm 7
    { outputMix: [0, 2], modulationMatrix: [[1], [], [3, 4], [], [5], [5]] },
    // Algorithm 8
    { outputMix: [0, 2], modulationMatrix: [[1], [], [3, 4], [3], [5], []] },
    // Algorithm 9
    { outputMix: [0, 2], modulationMatrix: [[1], [1], [3, 4], [], [5], []] },
    // Algorithm 10
    { outputMix: [0, 3], modulationMatrix: [[1], [2], [2], [4, 5], [], []] },
    // Algorithm 11
    { outputMix: [0, 3], modulationMatrix: [[1], [2], [], [4, 5], [], [5]] },
    // Algorithm 12
    { outputMix: [0, 2], modulationMatrix: [[1], [1], [3, 4, 5], [], [], []] },
    // Algorithm 13
    { outputMix: [0, 2], modulationMatrix: [[1], [], [3, 4, 5], [], [], [5]] },
    // Algorithm 14
    { outputMix: [0, 2], modulationMatrix: [[1], [], [3], [4, 5], [], [5]] },
    // Algorithm 15
    { outputMix: [0, 2], modulationMatrix: [[1], [1], [3], [4, 5], [], []] },
    // Algorithm 16
    { outputMix: [0], modulationMatrix: [[1, 2, 4], [], [3], [], [5], [5]] },
    // Algorithm 17
    { outputMix: [0], modulationMatrix: [[1, 2, 4], [1], [3], [], [5], []] },
    // Algorithm 18
    { outputMix: [0], modulationMatrix: [[1, 2, 3], [], [2], [4], [5], []] },
    // Algorithm 19
    { outputMix: [0, 3, 4], modulationMatrix: [[1], [2], [], [5], [5], [5]] },
    // Algorithm 20
    { outputMix: [0, 1, 3], modulationMatrix: [[2], [2], [2], [4, 5], [], []] },
    // Algorithm 21
    { outputMix: [0, 1, 3, 4], modulationMatrix: [[2], [2], [2], [5], [5], []] },
    // Algorithm 22
    { outputMix: [0, 2, 3, 4], modulationMatrix: [[1], [], [5], [5], [5], [5]] },
    // Algorithm 23
    { outputMix: [0, 1, 3, 4], modulationMatrix: [[], [2], [], [5], [5], [5]] },
    // Algorithm 24
    { outputMix: [0, 1, 2, 3, 4], modulationMatrix: [[], [], [5], [5], [5], [5]] },
    // Algorithm 25
    { outputMix: [0, 1, 2, 3, 4], modulationMatrix: [[], [], [], [5], [5], [5]] },
    // Algorithm 26
    { outputMix: [0, 1, 3], modulationMatrix: [[], [2], [], [4, 5], [], [5]] },
    // Algorithm 27
    { outputMix: [0, 1, 3], modulationMatrix: [[], [2], [2], [4, 5], [], []] },
    // Algorithm 28
    { outputMix: [0, 2, 5], modulationMatrix: [[1], [], [3], [4], [4], []] },
    // Algorithm 29
    { outputMix: [0, 1, 2, 4], modulationMatrix: [[], [], [3], [], [5], [5]] },
    // Algorithm 30
    { outputMix: [0, 1, 2, 5], modulationMatrix: [[], [], [3], [4], [4], []] },
    // Algorithm 31
    { outputMix: [0, 1, 2, 3, 4], modulationMatrix: [[], [], [], [], [5], [5]] },
    // Algorithm 32
    { outputMix: [0, 1, 2, 3, 4, 5], modulationMatrix: [[], [], [], [], [], [5]] }
];

function renderAlgorithmDiagram() {
    const svg = document.getElementById('algorithm-svg');
    const algIdx = currentPatch.algorithm - 1;
    const alg = DX7_ALGORITHMS[algIdx];

    svg.innerHTML = '';

    const opWidth = 32;
    const opHeight = 22;

    // Calculate depth for each operator (how many levels from output)
    const depths = new Array(6).fill(0);
    const calculated = new Set();

    function calculateDepth(opIdx, depth = 0) {
        if (calculated.has(opIdx)) return;
        calculated.add(opIdx);
        depths[opIdx] = Math.max(depths[opIdx], depth);

        // Recursively calculate depth for modulators
        const modulators = alg.modulationMatrix[opIdx];
        for (const modIdx of modulators) {
            if (modIdx !== opIdx) { // Skip self-modulation
                calculateDepth(modIdx, depth + 1);
            }
        }
    }

    // Start from carriers
    for (const carrierIdx of alg.outputMix) {
        calculateDepth(carrierIdx, 0);
    }

    // Group operators by depth
    const maxDepth = Math.max(...depths);
    const layers = {};
    for (let i = 0; i <= maxDepth; i++) {
        layers[i] = [];
    }
    for (let i = 0; i < 6; i++) {
        layers[depths[i]].push(i);
    }

    // Calculate positions
    const positions = [];
    const layerSpacing = 35;
    const opSpacing = 45;
    const startY = 20;
    const svgWidth = 200;

    for (let depth = 0; depth <= maxDepth; depth++) {
        const ops = layers[depth];
        const y = startY + (maxDepth - depth) * layerSpacing;
        const totalWidth = (ops.length - 1) * opSpacing;
        const startX = (svgWidth - totalWidth) / 2;

        ops.forEach((opIdx, i) => {
            positions[opIdx] = {
                x: startX + i * opSpacing,
                y: y
            };
        });
    }

    // Define arrowhead marker
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'arrowhead');
    marker.setAttribute('markerWidth', '8');
    marker.setAttribute('markerHeight', '8');
    marker.setAttribute('refX', '4');
    marker.setAttribute('refY', '2.5');
    marker.setAttribute('orient', 'auto');
    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute('points', '0 0, 4 2.5, 0 5');
    polygon.setAttribute('fill', '#5a979a');
    marker.appendChild(polygon);
    defs.appendChild(marker);
    svg.appendChild(defs);

    // Draw connections
    for (let opIdx = 0; opIdx < 6; opIdx++) {
        const modulators = alg.modulationMatrix[opIdx];
        const targetPos = positions[opIdx];

        for (const modIdx of modulators) {
            if (modIdx === opIdx) {
                // Self-modulation (feedback)
                const pos = positions[opIdx];
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                const x = pos.x;
                const y = pos.y + opHeight / 2;
                path.setAttribute('d', `M ${x - opWidth/2} ${y} C ${x - opWidth/2 - 15} ${y - 12}, ${x - opWidth/2 - 15} ${y + 12}, ${x - opWidth/2} ${y}`);
                path.setAttribute('stroke', '#be3b65');
                path.setAttribute('stroke-width', '1.5');
                path.setAttribute('fill', 'none');
                svg.appendChild(path);
            } else {
                const sourcePos = positions[modIdx];

                // Draw curved line
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                const x1 = sourcePos.x;
                const y1 = sourcePos.y + opHeight;
                const x2 = targetPos.x;
                const y2 = targetPos.y;

                // Control point for smooth curve
                const midY = (y1 + y2) / 2;

                path.setAttribute('d', `M ${x1} ${y1} Q ${x1} ${midY}, ${x2} ${y2}`);
                path.setAttribute('stroke', '#5a979a');
                path.setAttribute('stroke-width', '1.5');
                path.setAttribute('fill', 'none');
                path.setAttribute('marker-end', 'url(#arrowhead)');
                svg.appendChild(path);
            }
        }
    }

    // Draw output indicators
    for (const carrierIdx of alg.outputMix) {
        const pos = positions[carrierIdx];
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', pos.x);
        line.setAttribute('y1', pos.y + opHeight);
        line.setAttribute('x2', pos.x);
        line.setAttribute('y2', pos.y + opHeight + 12);
        line.setAttribute('stroke', '#be3b65');
        line.setAttribute('stroke-width', '2.5');
        svg.appendChild(line);

        // Output triangle
        const triangle = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        const tx = pos.x;
        const ty = pos.y + opHeight + 12;
        triangle.setAttribute('points', `${tx},${ty} ${tx-4},${ty+6} ${tx+4},${ty+6}`);
        triangle.setAttribute('fill', '#be3b65');
        svg.appendChild(triangle);
    }

    // Draw operator boxes
    for (let opIdx = 0; opIdx < 6; opIdx++) {
        const op = currentPatch.operators[opIdx];
        const pos = positions[opIdx];
        const isCarrier = alg.outputMix.includes(opIdx);

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', pos.x - opWidth / 2);
        rect.setAttribute('y', pos.y);
        rect.setAttribute('width', opWidth);
        rect.setAttribute('height', opHeight);
        rect.setAttribute('fill', op.enabled ? (isCarrier ? '#be3b65' : '#5a979a') : '#2a2a2a');
        rect.setAttribute('stroke', op.enabled ? '#fff' : '#555');
        rect.setAttribute('stroke-width', '1.5');
        rect.setAttribute('rx', '3');

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', pos.x);
        text.setAttribute('y', pos.y + opHeight / 2 + 4);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', op.enabled ? '#fff' : '#777');
        text.setAttribute('font-size', '11');
        text.setAttribute('font-weight', 'bold');
        text.textContent = `${opIdx + 1}`;

        svg.appendChild(rect);
        svg.appendChild(text);
    }

    // Algorithm label
    const algText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    algText.setAttribute('x', svgWidth / 2);
    algText.setAttribute('y', 192);
    algText.setAttribute('text-anchor', 'middle');
    algText.setAttribute('fill', '#7a5a9a');
    algText.setAttribute('font-size', '11');
    algText.setAttribute('font-weight', 'bold');
    algText.textContent = `Algorithm ${currentPatch.algorithm}`;
    svg.appendChild(algText);
}

// Rebuild cartridge SysEx from in-memory cartridge array
function rebuildCartridgeSysEx() {
    if (!cartridge || cartridge.length !== 32) {
        console.error('[RX7] Cannot rebuild cartridge: invalid cartridge data');
        return;
    }

    // DX7 cartridge format: F0 43 00 09 20 00 [4096 bytes = 32 × 128] [checksum] F7
    const sysex = new Uint8Array(4104);

    // SysEx header
    sysex[0] = 0xF0; // Start
    sysex[1] = 0x43; // Yamaha
    sysex[2] = 0x00; // Sub-status and channel
    sysex[3] = 0x09; // Format: 32 voices
    sysex[4] = 0x20; // Byte count MSB
    sysex[5] = 0x00; // Byte count LSB

    // Pack all 32 voices
    for (let voiceIdx = 0; voiceIdx < 32; voiceIdx++) {
        const voice = cartridge[voiceIdx];
        let offset = 6 + (voiceIdx * 128);

        // Pack 6 operators (stored in order 6→1, each is 17 bytes in packed format)
        for (let i = 5; i >= 0; i--) {
            const op = voice.operators[i];

            // EG rates (4 bytes)
            sysex[offset++] = op.rates[0] & 0x7F;
            sysex[offset++] = op.rates[1] & 0x7F;
            sysex[offset++] = op.rates[2] & 0x7F;
            sysex[offset++] = op.rates[3] & 0x7F;

            // EG levels (4 bytes)
            sysex[offset++] = op.levels[0] & 0x7F;
            sysex[offset++] = op.levels[1] & 0x7F;
            sysex[offset++] = op.levels[2] & 0x7F;
            sysex[offset++] = op.levels[3] & 0x7F;

            // Keyboard scaling
            sysex[offset++] = op.keyScaleBreakpoint & 0x7F;
            sysex[offset++] = op.keyScaleDepthL & 0x7F;
            sysex[offset++] = op.keyScaleDepthR & 0x7F;

            // Packed byte: Left Curve (bits 0-1) + Right Curve (bits 2-3)
            sysex[offset++] = ((op.keyScaleCurveR & 0x03) << 2) | (op.keyScaleCurveL & 0x03);

            // Packed byte: Rate Scaling (bits 0-2) + Detune (bits 3-6, offset by 7)
            sysex[offset++] = ((op.detune + 7) & 0x0F) << 3 | (op.keyScaleRate & 0x07);

            // Packed byte: AM Sens (bits 0-1) + Velocity Sens (bits 2-4)
            sysex[offset++] = ((op.velocitySens & 0x07) << 2) | (op.lfoAmpModSens & 0x03);

            // Output level
            sysex[offset++] = op.volume & 0x7F;

            // Packed byte: Osc Mode (bit 0) + Freq Coarse (bits 1-5)
            sysex[offset++] = ((op.freqCoarse & 0x1F) << 1) | (op.oscMode & 0x01);

            // Frequency fine
            sysex[offset++] = op.freqFine & 0x7F;
        }

        // Pitch EG rates (4 bytes)
        sysex[offset++] = voice.pitchEnvRates[0] & 0x7F;
        sysex[offset++] = voice.pitchEnvRates[1] & 0x7F;
        sysex[offset++] = voice.pitchEnvRates[2] & 0x7F;
        sysex[offset++] = voice.pitchEnvRates[3] & 0x7F;

        // Pitch EG levels (4 bytes)
        sysex[offset++] = voice.pitchEnvLevels[0] & 0x7F;
        sysex[offset++] = voice.pitchEnvLevels[1] & 0x7F;
        sysex[offset++] = voice.pitchEnvLevels[2] & 0x7F;
        sysex[offset++] = voice.pitchEnvLevels[3] & 0x7F;

        // Algorithm byte: bits 0-4 = algorithm (0-31)
        sysex[offset++] = (voice.algorithm - 1) & 0x1F;

        // Feedback byte: bits 0-2 = feedback (0-7)
        sysex[offset++] = voice.feedback & 0x07;

        // LFO (5 bytes)
        sysex[offset++] = voice.lfoSpeed & 0x7F;
        sysex[offset++] = voice.lfoDelay & 0x7F;
        sysex[offset++] = voice.lfoPitchModDepth & 0x7F;
        sysex[offset++] = voice.lfoAmpModDepth & 0x7F;

        // LFO Wave/Sync byte: bit 0 = sync, bits 1-3 = waveform, bits 4-6 = pitch mod sens
        sysex[offset++] = ((voice.lfoPitchModSens & 0x07) << 4) |
                          ((voice.lfoWaveform & 0x07) << 1) |
                          (voice.lfoSync & 0x01);

        // Transpose (1 byte)
        sysex[offset++] = 24; // C3

        // Voice name (10 ASCII characters)
        const name = voice.name.padEnd(10, ' ');
        for (let i = 0; i < 10; i++) {
            sysex[offset++] = name.charCodeAt(i) & 0x7F;
        }
    }

    // Calculate checksum (sum of all 4096 data bytes & 0x7F, then 2's complement)
    let checksum = 0;
    for (let i = 6; i < 4102; i++) {
        checksum += sysex[i];
    }
    sysex[4102] = (~checksum + 1) & 0x7F;

    // End of SysEx
    sysex[4103] = 0xF7;

    // Update global cartridge SysEx
    cartridgeSysex = sysex;
    console.log('[RX7] Rebuilt cartridge SysEx:', sysex.length, 'bytes');
}

function renderOperators() {
    const container = document.getElementById('operators-container');
    container.innerHTML = '';

    // Render operators 1 → 6
    // Note: In SysEx, operators are stored 6→1, so operators[0]=op6, operators[5]=op1
    // Loop from 5 to 0 to display op1 (operators[5]) first
    for (let i = 5; i >= 0; i--) {
        const op = currentPatch.operators[i];
        const opNum = 6 - i; // operators[5]=op1, operators[4]=op2, ..., operators[0]=op6

        const card = document.createElement('div');
        card.className = `operator-card ${op.enabled ? 'enabled' : ''}`;
        card.innerHTML = `
            <div class="operator-header">
                <div class="operator-title">Operator ${opNum}</div>
                <div class="operator-toggle">
                    <label>On/Off</label>
                    <div class="toggle-checkbox ${op.enabled ? 'active' : ''}" data-op="${i}"></div>
                </div>
            </div>

            <div class="operator-params">
                <!-- Level & Modulation -->
                <div class="param-group">
                    <div class="param-group-title">Level</div>
                    <div class="param-control">
                        <label>Output Level</label>
                        <input type="range" min="0" max="99" value="${op.volume}"
                               data-op="${i}" data-param="volume">
                        <span>${op.volume}</span>
                    </div>
                    <div class="param-control">
                        <label>Vel Sens (0-7)</label>
                        <input type="range" min="0" max="7" value="${op.velocitySens}"
                               data-op="${i}" data-param="velocitySens">
                        <span>${op.velocitySens}</span>
                    </div>
                    <div class="param-control">
                        <label>AM Sens (0-3)</label>
                        <input type="range" min="0" max="3" value="${op.lfoAmpModSens}"
                               data-op="${i}" data-param="lfoAmpModSens">
                        <span>${op.lfoAmpModSens}</span>
                    </div>
                </div>

                <!-- Frequency -->
                <div class="param-group">
                    <div class="param-group-title">Frequency</div>
                    <div class="param-control">
                        <label>Mode</label>
                        <select data-op="${i}" data-param="oscMode">
                            <option value="0" ${op.oscMode === 0 ? 'selected' : ''}>Ratio</option>
                            <option value="1" ${op.oscMode === 1 ? 'selected' : ''}>Fixed</option>
                        </select>
                    </div>
                    <div class="param-control">
                        <label>Coarse</label>
                        <input type="range" min="0" max="${op.oscMode === 0 ? 31 : 3}"
                               value="${op.freqCoarse}" data-op="${i}" data-param="freqCoarse">
                        <span>${op.freqCoarse}</span>
                    </div>
                    <div class="param-control">
                        <label>Fine</label>
                        <input type="range" min="0" max="99" value="${op.freqFine}"
                               data-op="${i}" data-param="freqFine">
                        <span>${op.freqFine}</span>
                    </div>
                    <div class="param-control">
                        <label>Detune</label>
                        <input type="range" min="-7" max="7" value="${op.detune}"
                               data-op="${i}" data-param="detune">
                        <span>${op.detune}</span>
                    </div>
                </div>

                <!-- Envelope -->
                <div class="param-group">
                    <div class="param-group-title">Envelope</div>
                    <div class="eg-sliders">
                        ${[0, 1, 2, 3].map(egIdx => `
                            <div class="eg-slider">
                                <label>R${egIdx + 1}</label>
                                <input type="range" min="0" max="99" value="${op.rates[egIdx]}"
                                       data-op="${i}" data-param="rate${egIdx}" orient="vertical">
                                <span>${op.rates[egIdx]}</span>
                            </div>
                        `).join('')}
                    </div>
                    <div class="eg-sliders" style="margin-top: 10px;">
                        ${[0, 1, 2, 3].map(egIdx => `
                            <div class="eg-slider">
                                <label>L${egIdx + 1}</label>
                                <input type="range" min="0" max="99" value="${op.levels[egIdx]}"
                                       data-op="${i}" data-param="level${egIdx}" orient="vertical">
                                <span>${op.levels[egIdx]}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;

        container.appendChild(card);
    }

    // Attach event listeners
    attachEventListeners();
}

function attachEventListeners() {
    // Toggle switches
    document.querySelectorAll('.toggle-checkbox').forEach(toggle => {
        toggle.addEventListener('click', (e) => {
            const opIdx = parseInt(e.target.dataset.op);
            currentPatch.operators[opIdx].enabled = !currentPatch.operators[opIdx].enabled;
            renderOperators();
            renderAlgorithmDiagram();
            schedulePatchUpdate();
        });
    });

    // Parameter controls
    document.querySelectorAll('[data-op][data-param]').forEach(input => {
        input.addEventListener('input', (e) => {
            const opIdx = parseInt(e.target.dataset.op);
            const param = e.target.dataset.param;
            let value = input.type === 'range' || input.type === 'number'
                ? parseInt(input.value)
                : parseInt(input.value);

            // Handle nested params (rates, levels)
            if (param.startsWith('rate')) {
                const idx = parseInt(param.replace('rate', ''));
                currentPatch.operators[opIdx].rates[idx] = value;
            } else if (param.startsWith('level')) {
                const idx = parseInt(param.replace('level', ''));
                currentPatch.operators[opIdx].levels[idx] = value;
            } else {
                currentPatch.operators[opIdx][param] = value;
            }

            // Update display value
            const nextSibling = input.nextElementSibling;
            if (nextSibling && nextSibling.tagName === 'SPAN') {
                nextSibling.textContent = value;
            }

            // Re-render if oscMode changed (affects coarse range)
            if (param === 'oscMode') {
                renderOperators();
            }

            // Schedule live update
            schedulePatchUpdate();
        });
    });
}

function attachGlobalListeners() {
    // Patch name
    document.getElementById('patch-name').addEventListener('input', (e) => {
        currentPatch.name = e.target.value.slice(0, 10).toUpperCase();
        schedulePatchUpdate();
    });

    // Algorithm
    document.getElementById('algorithm').addEventListener('input', (e) => {
        currentPatch.algorithm = Math.max(1, Math.min(32, parseInt(e.target.value)));
        renderAlgorithmDiagram();
        schedulePatchUpdate();
    });

    // Feedback
    const feedbackInput = document.getElementById('feedback');
    feedbackInput.addEventListener('input', (e) => {
        currentPatch.feedback = parseInt(e.target.value);
        document.getElementById('feedback-value').textContent = e.target.value;
        schedulePatchUpdate();
    });

    // LFO parameters
    ['speed', 'delay', 'pm-depth', 'am-depth', 'pm-sens'].forEach(param => {
        const input = document.getElementById(`lfo-${param}`);
        const valueSpan = document.getElementById(`lfo-${param}-value`);
        input.addEventListener('input', (e) => {
            const camelParam = param.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
                .replace('pmDepth', 'PitchModDepth')
                .replace('amDepth', 'AmpModDepth')
                .replace('pmSens', 'PitchModSens');
            currentPatch[`lfo${camelParam.charAt(0).toUpperCase() + camelParam.slice(1)}`] = parseInt(e.target.value);
            valueSpan.textContent = e.target.value;
            schedulePatchUpdate();
        });
    });

    document.getElementById('lfo-waveform').addEventListener('change', (e) => {
        currentPatch.lfoWaveform = parseInt(e.target.value);
        schedulePatchUpdate();
    });

    document.getElementById('lfo-sync').addEventListener('change', (e) => {
        currentPatch.lfoSync = parseInt(e.target.value);
        schedulePatchUpdate();
    });

    // Pitch EG
    for (let i = 1; i <= 4; i++) {
        ['r', 'l'].forEach(type => {
            const input = document.getElementById(`pitch-eg-${type}${i}`);
            const valueSpan = document.getElementById(`pitch-eg-${type}${i}-value`);
            input.addEventListener('input', (e) => {
                const arrayName = type === 'r' ? 'pitchEnvRates' : 'pitchEnvLevels';
                currentPatch[arrayName][i - 1] = parseInt(e.target.value);
                valueSpan.textContent = e.target.value;
                schedulePatchUpdate();
            });
        });
    }

    // Action buttons
    document.getElementById('load-cart-btn').addEventListener('click', loadCartridge);
    document.getElementById('save-cart-btn').addEventListener('click', saveCartridge);
    document.getElementById('load-voice-btn').addEventListener('click', loadVoiceToSlot);
    document.getElementById('save-voice-btn').addEventListener('click', saveVoice);
    document.getElementById('reset-btn').addEventListener('click', resetPatch);
}

async function loadCartridge() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.syx';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const sysexData = new Uint8Array(event.target.result);
                console.log('[RX7] Loaded cartridge file:', file.name, sysexData.length, 'bytes');

                // Validate SysEx header
                if (sysexData[0] !== 0xF0 || sysexData[1] !== 0x43) {
                    showNotification('Invalid SysEx format', 'error');
                    return;
                }

                // Initialize audio if needed
                if (!audioContext || !rx7WorkletNode) {
                    console.log('[RX7] Initializing audio to load cartridge...');
                    const success = await initAudio();
                    if (!success) {
                        showNotification('Failed to initialize audio', 'error');
                        return;
                    }

                    // Wait for synth to be ready
                    if (!audioReady) {
                        let attempts = 0;
                        while (!audioReady && attempts < 50) {
                            await new Promise(resolve => setTimeout(resolve, 100));
                            attempts++;
                        }
                        if (!audioReady) {
                            showNotification('Synth engine not ready', 'error');
                            return;
                        }
                    }
                }

                // Store cartridge SysEx for later patch selection
                cartridgeSysex = sysexData;

                // Send cartridge SysEx to synth engine for parsing
                console.log('[RX7] Sending cartridge to synth engine...');
                rx7WorkletNode.port.postMessage({
                    type: 'loadSysex',
                    data: {
                        sysexData: sysexData,
                        patchNum: 0  // Start with first patch
                    }
                });

                // Extract voice names for cartridge browser UI (just for display)
                const voices = extractVoiceNames(sysexData);
                if (voices.length > 0) {
                    cartridge = voices;
                    selectedSlot = 0;

                    // Parse and load first voice into UI
                    const parsedVoice = parseVoiceFromCartridge(sysexData, 0);
                    if (parsedVoice) {
                        currentPatch = parsedVoice;
                        updateUIFromPatch();
                        console.log('[RX7] Auto-selected first patch:', parsedVoice.name);
                    }

                    // Update cartridge info
                    const cartInfo = document.getElementById('cartridge-info');
                    cartInfo.textContent = `${file.name} - ${voices.length} voices loaded`;
                    cartInfo.style.color = '#5a979a';

                    renderCartridge();
                    showNotification(`Loaded ${voices.length} voices from ${file.name}`, 'success');
                } else {
                    showNotification('Cartridge loaded (names not available)', 'success');
                }

            } catch (err) {
                showNotification(`Error: ${err.message}`, 'error');
                console.error('[RX7] Cartridge load error:', err);
            }
        };
        reader.readAsArrayBuffer(file);
    };
    input.click();
}

// Extract voice names from cartridge for UI display (engine does the real parsing)
function extractVoiceNames(sysexData) {
    const voices = [];

    // DX7 cartridge: F0 43 00 09 20 00 [4096 bytes = 32 × 128] checksum F7
    if (sysexData.length >= 4104 && sysexData[3] === 0x09) {
        let offset = 6;
        for (let v = 0; v < 32; v++) {
            // Each voice is 128 bytes
            // 6 operators × 17 bytes = 102 bytes
            // Pitch EG = 8 bytes
            // Algorithm at byte 110 (offset + 102 + 8)
            const algorithm = (sysexData[offset + 110] & 0x1F) + 1;
            // Name is at bytes 118-127 (offset + 118)
            const nameOffset = offset + 118;
            const nameBytes = sysexData.slice(nameOffset, nameOffset + 10);
            const name = String.fromCharCode(...nameBytes).trim() || `Voice ${v + 1}`;
            voices.push({ name, index: v, algorithm });
            offset += 128;
        }
    }
    // Single voice: F0 43 00 00 01 1B [155 bytes] checksum F7
    else if (sysexData.length >= 163 && sysexData[3] === 0x00) {
        // Single voice format is different (unpacked)
        // Algorithm is at offset 6 + 134
        const algorithm = (sysexData[6 + 134] & 0x1F) + 1;
        // Name is at bytes 151-160 (offset 6 + 145)
        const nameBytes = sysexData.slice(151, 161);
        const name = String.fromCharCode(...nameBytes).trim() || 'Voice 1';
        voices.push({ name, index: 0, algorithm });
    }

    return voices;
}

function saveVoice() {
    const sysex = patchToSingleVoiceSysEx();
    const blob = new Blob([sysex], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentPatch.name.replace(/\s+/g, '_')}.syx`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification(`Saved voice: ${currentPatch.name}.syx (163 bytes)`, 'success');
}

function saveCartridge() {
    if (!cartridgeSysex) {
        showNotification('No cartridge loaded - cannot save', 'error');
        return;
    }

    const blob = new Blob([cartridgeSysex], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cartridge.syx';
    a.click();
    URL.revokeObjectURL(url);
    showNotification('Saved cartridge: 32 voices (4104 bytes)', 'success');
}

function loadVoiceToSlot() {
    if (selectedSlot < 0) {
        showNotification('Please select a cartridge slot first', 'error');
        return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.syx';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const sysexData = new Uint8Array(event.target.result);
                console.log('[RX7] Loading voice file:', file.name, sysexData.length, 'bytes');

                // Parse single voice format
                const voice = parseSingleVoiceSysEx(sysexData);
                if (!voice) {
                    showNotification('Invalid voice SysEx format', 'error');
                    return;
                }

                // Update the cartridge at the selected slot
                if (!cartridge) {
                    cartridge = createBuiltInCartridge();
                }
                cartridge[selectedSlot] = voice;

                // Update current patch and UI
                currentPatch = JSON.parse(JSON.stringify(voice));
                updateUIFromPatch();

                // Rebuild cartridge SysEx with the new voice
                rebuildCartridgeSysEx();

                // Send to synth engine
                if (rx7WorkletNode && audioReady) {
                    rx7WorkletNode.port.postMessage({
                        type: 'selectPatch',
                        data: {
                            sysexData: cartridgeSysex,
                            patchNum: selectedSlot
                        }
                    });
                }

                renderCartridge();
                showNotification(`Loaded ${voice.name} into slot ${selectedSlot + 1}`, 'success');

            } catch (err) {
                showNotification(`Error: ${err.message}`, 'error');
                console.error('[RX7] Voice load error:', err);
            }
        };
        reader.readAsArrayBuffer(file);
    };
    input.click();
}

function resetPatch() {
    currentPatch = JSON.parse(JSON.stringify(defaultPatch));
    document.getElementById('patch-name').value = currentPatch.name;
    document.getElementById('algorithm').value = currentPatch.algorithm;
    document.getElementById('feedback').value = currentPatch.feedback;
    renderOperators();
    renderAlgorithmDiagram();
    showNotification('Patch reset to INIT VOICE', 'info');
}

function loadSysEx() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.syx';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = new Uint8Array(event.target.result);
                parseDX7SysEx(data);
                showNotification(`Loaded: ${file.name}`, 'success');
            } catch (err) {
                showNotification(`Error: ${err.message}`, 'error');
            }
        };
        reader.readAsArrayBuffer(file);
    };
    input.click();
}

function parseDX7SysEx(data) {
    // DX7 single voice format: F0 43 00 00 01 1B [155 bytes] [checksum] F7
    // For now, just show a placeholder
    showNotification('SysEx parsing not yet implemented', 'error');
}

function saveSysEx() {
    // Build DX7 SysEx
    showNotification('SysEx export not yet implemented', 'error');
}

// Built-in preset cartridge (8 voices, expand to 32 if needed)
function createBuiltInCartridge() {
    const voices = [];

    // Fill all 32 slots with INIT VOICE
    for (let i = 0; i < 32; i++) {
        const voice = JSON.parse(JSON.stringify(defaultPatch));
        voice.name = `INIT ${i + 1}`;
        voices.push(voice);
    }

    return voices;
}

function renderCartridge() {
    const grid = document.getElementById('cartridge-grid');
    grid.innerHTML = '';

    const voices = cartridge || createBuiltInCartridge();

    voices.forEach((voice, index) => {
        const slot = document.createElement('div');
        slot.className = 'preset-slot';
        if (index === selectedSlot) {
            slot.classList.add('selected');
        }

        slot.innerHTML = `
            <div class="preset-slot-number">${String(index + 1).padStart(2, '0')}</div>
            <div class="preset-slot-name">${voice.name}</div>
            <div class="preset-slot-info">Alg ${voice.algorithm}</div>
        `;

        slot.addEventListener('click', () => {
            selectedSlot = index;
            loadVoiceFromSlot(index);
            renderCartridge(); // Re-render to update selection
        });

        grid.appendChild(slot);
    });
}

function loadVoiceFromSlot(index) {
    if (!rx7WorkletNode || !audioReady) {
        showNotification('Audio engine not ready', 'error');
        return;
    }

    const voices = cartridge || createBuiltInCartridge();
    const voice = voices[index];

    console.log('[RX7] Selecting patch', index, 'from cartridge');

    // If we have cartridge SysEx loaded, parse the voice and update UI
    if (cartridgeSysex) {
        // Parse the voice from cartridge SysEx
        const parsedVoice = parseVoiceFromCartridge(cartridgeSysex, index);
        if (parsedVoice) {
            // Update currentPatch
            currentPatch = parsedVoice;

            // Update all UI controls
            updateUIFromPatch();
        }

        // Send to synth engine
        rx7WorkletNode.port.postMessage({
            type: 'selectPatch',
            data: {
                sysexData: cartridgeSysex,
                patchNum: index
            }
        });
    } else {
        // Built-in cartridge - already has parsed data
        currentPatch = JSON.parse(JSON.stringify(voice));
        updateUIFromPatch();

        const sysex = patchToSysEx();
        rx7WorkletNode.port.postMessage({
            type: 'loadSysex',
            data: {
                sysexData: sysex,
                patchNum: 0
            }
        });
    }

    showNotification(`Selected: ${voice.name} (Slot ${index + 1})`, 'success');
}

// Parse DX7 single voice SysEx (163 bytes, unpacked format)
function parseSingleVoiceSysEx(sysexData) {
    // Validate header: F0 43 00 00 01 1B [155 bytes] [checksum] F7
    if (sysexData.length < 163 || sysexData[0] !== 0xF0 || sysexData[1] !== 0x43 || sysexData[3] !== 0x00) {
        console.error('[RX7] Invalid single voice SysEx format');
        return null;
    }

    const voice = {
        name: '',
        algorithm: 1,
        feedback: 0,
        lfoSpeed: 35,
        lfoDelay: 0,
        lfoPitchModDepth: 0,
        lfoAmpModDepth: 0,
        lfoPitchModSens: 3,
        lfoWaveform: 0,
        lfoSync: 1,
        pitchEnvRates: [99, 99, 99, 99],
        pitchEnvLevels: [50, 50, 50, 50],
        operators: []
    };

    let offset = 6; // Start after header

    // Parse 6 operators (each 21 bytes in unpacked format, stored 6→1)
    for (let op = 0; op < 6; op++) {
        const opData = {
            rates: [
                sysexData[offset + 0],
                sysexData[offset + 1],
                sysexData[offset + 2],
                sysexData[offset + 3]
            ],
            levels: [
                sysexData[offset + 4],
                sysexData[offset + 5],
                sysexData[offset + 6],
                sysexData[offset + 7]
            ],
            keyScaleBreakpoint: sysexData[offset + 8],
            keyScaleDepthL: sysexData[offset + 9],
            keyScaleDepthR: sysexData[offset + 10],
            keyScaleCurveL: sysexData[offset + 11] & 0x03,
            keyScaleCurveR: sysexData[offset + 12] & 0x03,
            keyScaleRate: sysexData[offset + 13] & 0x07,
            lfoAmpModSens: sysexData[offset + 14] & 0x03,
            velocitySens: sysexData[offset + 15] & 0x07,
            volume: sysexData[offset + 16],
            oscMode: sysexData[offset + 17] & 0x01,
            freqCoarse: sysexData[offset + 18] & 0x1F,
            freqFine: sysexData[offset + 19],
            detune: (sysexData[offset + 20] & 0x0F) - 7,
            enabled: sysexData[offset + 16] > 0 // Enabled if volume > 0
        };
        voice.operators.push(opData);
        offset += 21; // Each operator is 21 bytes in unpacked format
    }

    // Pitch EG (8 bytes)
    voice.pitchEnvRates = [
        sysexData[offset + 0],
        sysexData[offset + 1],
        sysexData[offset + 2],
        sysexData[offset + 3]
    ];
    voice.pitchEnvLevels = [
        sysexData[offset + 4],
        sysexData[offset + 5],
        sysexData[offset + 6],
        sysexData[offset + 7]
    ];
    offset += 8;

    // Algorithm (1 byte, 0-31)
    voice.algorithm = (sysexData[offset] & 0x1F) + 1;
    offset += 1;

    // Feedback (1 byte, 0-7)
    voice.feedback = sysexData[offset] & 0x07;
    offset += 1;

    // Oscillator sync (1 byte, skip)
    offset += 1;

    // LFO (7 bytes - unpacked)
    voice.lfoSpeed = sysexData[offset + 0];
    voice.lfoDelay = sysexData[offset + 1];
    voice.lfoPitchModDepth = sysexData[offset + 2];
    voice.lfoAmpModDepth = sysexData[offset + 3];
    voice.lfoSync = sysexData[offset + 4] & 0x01;
    voice.lfoWaveform = sysexData[offset + 5] & 0x07;
    voice.lfoPitchModSens = sysexData[offset + 6] & 0x07;
    offset += 7;

    // Transpose (1 byte, skip)
    offset += 1;

    // Voice name (10 ASCII chars)
    const nameBytes = sysexData.slice(offset, offset + 10);
    voice.name = String.fromCharCode(...nameBytes).trim();

    console.log('[RX7] Parsed single voice:', voice.name, 'Algorithm:', voice.algorithm, 'Feedback:', voice.feedback);
    return voice;
}

// Parse a single voice from DX7 cartridge SysEx
function parseVoiceFromCartridge(sysexData, voiceIndex) {
    if (!sysexData || sysexData.length < 4104 || sysexData[3] !== 0x09) {
        console.error('[RX7] Invalid cartridge data');
        return null;
    }

    const voice = {
        name: '',
        algorithm: 1,
        feedback: 0,
        lfoSpeed: 35,
        lfoDelay: 0,
        lfoPitchModDepth: 0,
        lfoAmpModDepth: 0,
        lfoPitchModSens: 3,
        lfoWaveform: 0,
        lfoSync: 1,
        pitchEnvRates: [99, 99, 99, 99],
        pitchEnvLevels: [50, 50, 50, 50],
        operators: []
    };

    // Each voice is 128 bytes, starting at offset 6
    let offset = 6 + (voiceIndex * 128);

    // Parse 6 operators (stored in order 6→1, each is 17 bytes in packed format)
    for (let op = 0; op < 6; op++) {
        // Unpack byte 11: Left Curve (bits 0-1) + Right Curve (bits 2-3)
        const curveByte = sysexData[offset + 11];
        const leftCurve = curveByte & 0x03;
        const rightCurve = (curveByte >> 2) & 0x03;

        // Unpack byte 12: Rate Scaling (bits 0-2) + Detune (bits 3-6)
        const rsDetuneByte = sysexData[offset + 12];
        const keyScaleRate = rsDetuneByte & 0x07;
        const detune = ((rsDetuneByte >> 3) & 0x0F) - 7; // Detune is 4 bits, offset by 7

        // Unpack byte 13: AM Sens (bits 0-1) + Velocity Sens (bits 2-4)
        const amVelByte = sysexData[offset + 13];
        const lfoAmpModSens = amVelByte & 0x03;
        const velocitySens = (amVelByte >> 2) & 0x07;

        // Unpack byte 15: Osc Mode (bit 0) + Freq Coarse (bits 1-5)
        const oscByte = sysexData[offset + 15];
        const oscMode = oscByte & 0x01;
        const freqCoarse = (oscByte >> 1) & 0x1F; // Actually it's the whole byte shifted? Let me check

        const opData = {
            rates: [
                sysexData[offset + 0],
                sysexData[offset + 1],
                sysexData[offset + 2],
                sysexData[offset + 3]
            ],
            levels: [
                sysexData[offset + 4],
                sysexData[offset + 5],
                sysexData[offset + 6],
                sysexData[offset + 7]
            ],
            keyScaleBreakpoint: sysexData[offset + 8],
            keyScaleDepthL: sysexData[offset + 9],
            keyScaleDepthR: sysexData[offset + 10],
            keyScaleCurveL: leftCurve,
            keyScaleCurveR: rightCurve,
            keyScaleRate: keyScaleRate,
            lfoAmpModSens: lfoAmpModSens,
            velocitySens: velocitySens,
            volume: sysexData[offset + 14],
            oscMode: oscMode,
            freqCoarse: freqCoarse,
            freqFine: sysexData[offset + 16],
            detune: detune,
            enabled: sysexData[offset + 14] > 0 // Enabled if volume > 0
        };
        voice.operators.push(opData);
        offset += 17; // Each operator is 17 bytes in packed format
    }

    // Pitch EG (8 bytes)
    voice.pitchEnvRates = [
        sysexData[offset + 0],
        sysexData[offset + 1],
        sysexData[offset + 2],
        sysexData[offset + 3]
    ];
    voice.pitchEnvLevels = [
        sysexData[offset + 4],
        sysexData[offset + 5],
        sysexData[offset + 6],
        sysexData[offset + 7]
    ];
    offset += 8;

    // Algorithm byte: bits 0-4 = algorithm (0-31), bits 5-7 = oscillator key sync
    voice.algorithm = (sysexData[offset] & 0x1F) + 1; // Stored as 0-31, display as 1-32
    offset += 1;

    // Feedback byte: bits 0-2 = feedback (0-7)
    voice.feedback = sysexData[offset] & 0x07;
    offset += 1;

    // LFO (5 bytes)
    voice.lfoSpeed = sysexData[offset + 0];
    voice.lfoDelay = sysexData[offset + 1];
    voice.lfoPitchModDepth = sysexData[offset + 2];
    voice.lfoAmpModDepth = sysexData[offset + 3];

    // LFO Wave/Sync byte: bit 0 = sync, bits 1-3 = waveform, bits 4-6 = pitch mod sens
    const lfoWaveByte = sysexData[offset + 4];
    voice.lfoSync = lfoWaveByte & 0x01; // Bit 0
    voice.lfoWaveform = (lfoWaveByte >> 1) & 0x07; // Bits 1-3
    voice.lfoPitchModSens = (lfoWaveByte >> 4) & 0x07; // Bits 4-6
    offset += 5;

    // Transpose (1 byte, skip)
    offset += 1;

    // Voice name (10 ASCII chars)
    const nameBytes = sysexData.slice(offset, offset + 10);
    voice.name = String.fromCharCode(...nameBytes).trim();

    console.log('[RX7] Parsed voice:', voice.name, 'Algorithm:', voice.algorithm, 'Feedback:', voice.feedback);
    console.log('[RX7] Op1 (operators[5]):', voice.operators[5]);
    console.log('[RX7] LFO:', { speed: voice.lfoSpeed, waveform: voice.lfoWaveform, sync: voice.lfoSync });
    return voice;
}

// Update all UI controls from currentPatch
function updateUIFromPatch() {
    // Patch name
    document.getElementById('patch-name').value = currentPatch.name;

    // Algorithm & feedback
    document.getElementById('algorithm').value = currentPatch.algorithm;
    document.getElementById('feedback').value = currentPatch.feedback;
    document.getElementById('feedback-value').textContent = currentPatch.feedback;

    // LFO
    document.getElementById('lfo-speed').value = currentPatch.lfoSpeed;
    document.getElementById('lfo-speed-value').textContent = currentPatch.lfoSpeed;
    document.getElementById('lfo-delay').value = currentPatch.lfoDelay;
    document.getElementById('lfo-delay-value').textContent = currentPatch.lfoDelay;
    document.getElementById('lfo-pm-depth').value = currentPatch.lfoPitchModDepth;
    document.getElementById('lfo-pm-depth-value').textContent = currentPatch.lfoPitchModDepth;
    document.getElementById('lfo-am-depth').value = currentPatch.lfoAmpModDepth;
    document.getElementById('lfo-am-depth-value').textContent = currentPatch.lfoAmpModDepth;
    document.getElementById('lfo-pm-sens').value = currentPatch.lfoPitchModSens;
    document.getElementById('lfo-pm-sens-value').textContent = currentPatch.lfoPitchModSens;
    document.getElementById('lfo-waveform').value = currentPatch.lfoWaveform;
    document.getElementById('lfo-sync').value = currentPatch.lfoSync;

    // Pitch envelope
    for (let i = 0; i < 4; i++) {
        document.getElementById(`pitch-eg-r${i + 1}`).value = currentPatch.pitchEnvRates[i];
        document.getElementById(`pitch-eg-r${i + 1}-value`).textContent = currentPatch.pitchEnvRates[i];
        document.getElementById(`pitch-eg-l${i + 1}`).value = currentPatch.pitchEnvLevels[i];
        document.getElementById(`pitch-eg-l${i + 1}-value`).textContent = currentPatch.pitchEnvLevels[i];
    }

    // Update operator UI
    renderOperators();
    renderAlgorithmDiagram();

    console.log('[RX7] UI updated from patch');
}

// Convert currentPatch to DX7 Single Voice SysEx format (163 bytes)
function patchToSingleVoiceSysEx() {
    // DX7 single voice format: F0 43 00 00 01 1B [155 bytes] [checksum] F7
    const sysex = new Uint8Array(163);

    // SysEx header
    sysex[0] = 0xF0; // Start
    sysex[1] = 0x43; // Yamaha
    sysex[2] = 0x00; // Sub-status and channel
    sysex[3] = 0x00; // Format: 1 voice
    sysex[4] = 0x01; // Byte count MSB
    sysex[5] = 0x1B; // Byte count LSB (155 bytes = 0x9B, but stored as 0x01 0x1B)

    let offset = 6;

    // Pack 6 operators (in order 6→1, each 21 bytes in UNPACKED format)
    for (let i = 5; i >= 0; i--) {
        const op = currentPatch.operators[i];

        // EG rates (4 bytes)
        sysex[offset++] = op.rates[0] & 0x7F;
        sysex[offset++] = op.rates[1] & 0x7F;
        sysex[offset++] = op.rates[2] & 0x7F;
        sysex[offset++] = op.rates[3] & 0x7F;

        // EG levels (4 bytes)
        sysex[offset++] = op.levels[0] & 0x7F;
        sysex[offset++] = op.levels[1] & 0x7F;
        sysex[offset++] = op.levels[2] & 0x7F;
        sysex[offset++] = op.levels[3] & 0x7F;

        // Keyboard scaling (5 bytes - unpacked)
        sysex[offset++] = op.keyScaleBreakpoint & 0x7F;
        sysex[offset++] = op.keyScaleDepthL & 0x7F;
        sysex[offset++] = op.keyScaleDepthR & 0x7F;
        sysex[offset++] = op.keyScaleCurveL & 0x03;
        sysex[offset++] = op.keyScaleCurveR & 0x03;

        // Rate scaling (1 byte)
        sysex[offset++] = op.keyScaleRate & 0x07;

        // Modulation sensitivity (2 bytes - unpacked)
        sysex[offset++] = op.lfoAmpModSens & 0x03;
        sysex[offset++] = op.velocitySens & 0x07;

        // Output level (1 byte)
        sysex[offset++] = op.volume & 0x7F;

        // Frequency (3 bytes - unpacked)
        sysex[offset++] = op.oscMode & 0x01;
        sysex[offset++] = op.freqCoarse & 0x1F;
        sysex[offset++] = op.freqFine & 0x7F;

        // Detune (1 byte, offset by 7)
        sysex[offset++] = (op.detune + 7) & 0x0F;
    }

    // Pitch EG rates (4 bytes)
    sysex[offset++] = currentPatch.pitchEnvRates[0] & 0x7F;
    sysex[offset++] = currentPatch.pitchEnvRates[1] & 0x7F;
    sysex[offset++] = currentPatch.pitchEnvRates[2] & 0x7F;
    sysex[offset++] = currentPatch.pitchEnvRates[3] & 0x7F;

    // Pitch EG levels (4 bytes)
    sysex[offset++] = currentPatch.pitchEnvLevels[0] & 0x7F;
    sysex[offset++] = currentPatch.pitchEnvLevels[1] & 0x7F;
    sysex[offset++] = currentPatch.pitchEnvLevels[2] & 0x7F;
    sysex[offset++] = currentPatch.pitchEnvLevels[3] & 0x7F;

    // Algorithm (1 byte, 0-31)
    sysex[offset++] = (currentPatch.algorithm - 1) & 0x1F;

    // Feedback (1 byte, 0-7)
    sysex[offset++] = currentPatch.feedback & 0x07;

    // Oscillator sync (1 byte)
    sysex[offset++] = 0; // Osc key sync off

    // LFO (6 bytes - unpacked)
    sysex[offset++] = currentPatch.lfoSpeed & 0x7F;
    sysex[offset++] = currentPatch.lfoDelay & 0x7F;
    sysex[offset++] = currentPatch.lfoPitchModDepth & 0x7F;
    sysex[offset++] = currentPatch.lfoAmpModDepth & 0x7F;
    sysex[offset++] = currentPatch.lfoSync & 0x01;
    sysex[offset++] = currentPatch.lfoWaveform & 0x07;
    sysex[offset++] = currentPatch.lfoPitchModSens & 0x07;

    // Transpose (1 byte)
    sysex[offset++] = 24; // C3

    // Voice name (10 ASCII characters)
    const name = currentPatch.name.padEnd(10, ' ');
    for (let i = 0; i < 10; i++) {
        sysex[offset++] = name.charCodeAt(i) & 0x7F;
    }

    // Calculate checksum (sum of data bytes & 0x7F, then 2's complement)
    let checksum = 0;
    for (let i = 6; i < offset; i++) {
        checksum += sysex[i];
    }
    sysex[offset++] = (~checksum + 1) & 0x7F;

    // End of SysEx
    sysex[offset++] = 0xF7;

    return sysex;
}

// Convert currentPatch to DX7 Cartridge SysEx format (current patch repeated 32 times for synth engine)
function patchToSysEx() {
    // DX7 cartridge format: F0 43 00 09 20 00 [4096 bytes = 32 × 128] [checksum] F7
    const sysex = new Uint8Array(4104);

    // SysEx header for cartridge
    sysex[0] = 0xF0; // Start
    sysex[1] = 0x43; // Yamaha
    sysex[2] = 0x00; // Sub-status and channel
    sysex[3] = 0x09; // Format: 32 voices
    sysex[4] = 0x20; // Byte count MSB (0x20 = 32)
    sysex[5] = 0x00; // Byte count LSB (0x00)

    // Pack current patch into slot 0 (and repeat for all 32 slots)
    for (let voice = 0; voice < 32; voice++) {
        let offset = 6 + (voice * 128);

        // Pack 6 operators (stored in order 6→1, each is 17 bytes in packed format)
        for (let i = 5; i >= 0; i--) {
            const op = currentPatch.operators[i];

            // EG rates (4 bytes)
            sysex[offset++] = op.rates[0] & 0x7F;
            sysex[offset++] = op.rates[1] & 0x7F;
            sysex[offset++] = op.rates[2] & 0x7F;
            sysex[offset++] = op.rates[3] & 0x7F;

            // EG levels (4 bytes)
            sysex[offset++] = op.levels[0] & 0x7F;
            sysex[offset++] = op.levels[1] & 0x7F;
            sysex[offset++] = op.levels[2] & 0x7F;
            sysex[offset++] = op.levels[3] & 0x7F;

            // Keyboard scaling
            sysex[offset++] = op.keyScaleBreakpoint & 0x7F;
            sysex[offset++] = op.keyScaleDepthL & 0x7F;
            sysex[offset++] = op.keyScaleDepthR & 0x7F;

            // Packed byte: Left Curve (bits 0-1) + Right Curve (bits 2-3)
            sysex[offset++] = ((op.keyScaleCurveR & 0x03) << 2) | (op.keyScaleCurveL & 0x03);

            // Packed byte: Rate Scaling (bits 0-2) + Detune (bits 3-6, offset by 7)
            sysex[offset++] = ((op.detune + 7) & 0x0F) << 3 | (op.keyScaleRate & 0x07);

            // Packed byte: AM Sens (bits 0-1) + Velocity Sens (bits 2-4)
            sysex[offset++] = ((op.velocitySens & 0x07) << 2) | (op.lfoAmpModSens & 0x03);

            // Output level
            sysex[offset++] = op.volume & 0x7F;

            // Packed byte: Osc Mode (bit 0) + Freq Coarse (bits 1-5)
            sysex[offset++] = ((op.freqCoarse & 0x1F) << 1) | (op.oscMode & 0x01);

            // Frequency fine
            sysex[offset++] = op.freqFine & 0x7F;
        }

        // Pitch EG rates (4 bytes)
        sysex[offset++] = currentPatch.pitchEnvRates[0] & 0x7F;
        sysex[offset++] = currentPatch.pitchEnvRates[1] & 0x7F;
        sysex[offset++] = currentPatch.pitchEnvRates[2] & 0x7F;
        sysex[offset++] = currentPatch.pitchEnvRates[3] & 0x7F;

        // Pitch EG levels (4 bytes)
        sysex[offset++] = currentPatch.pitchEnvLevels[0] & 0x7F;
        sysex[offset++] = currentPatch.pitchEnvLevels[1] & 0x7F;
        sysex[offset++] = currentPatch.pitchEnvLevels[2] & 0x7F;
        sysex[offset++] = currentPatch.pitchEnvLevels[3] & 0x7F;

        // Algorithm byte: bits 0-4 = algorithm (0-31), bits 5-7 = oscillator key sync
        sysex[offset++] = (currentPatch.algorithm - 1) & 0x1F;

        // Feedback byte: bits 0-2 = feedback (0-7)
        sysex[offset++] = currentPatch.feedback & 0x07;

        // LFO (5 bytes)
        sysex[offset++] = currentPatch.lfoSpeed & 0x7F;
        sysex[offset++] = currentPatch.lfoDelay & 0x7F;
        sysex[offset++] = currentPatch.lfoPitchModDepth & 0x7F;
        sysex[offset++] = currentPatch.lfoAmpModDepth & 0x7F;

        // LFO Wave/Sync byte: bit 0 = sync, bits 1-3 = waveform, bits 4-6 = pitch mod sens
        sysex[offset++] = ((currentPatch.lfoPitchModSens & 0x07) << 4) |
                          ((currentPatch.lfoWaveform & 0x07) << 1) |
                          (currentPatch.lfoSync & 0x01);

        // Transpose (1 byte)
        sysex[offset++] = 24; // C3

        // Voice name (10 ASCII characters)
        const name = currentPatch.name.padEnd(10, ' ');
        for (let i = 0; i < 10; i++) {
            sysex[offset++] = name.charCodeAt(i) & 0x7F;
        }
    }

    // Calculate checksum (sum of all 4096 data bytes & 0x7F, then 2's complement)
    let checksum = 0;
    for (let i = 6; i < 4102; i++) {
        checksum += sysex[i];
    }
    sysex[4102] = (~checksum + 1) & 0x7F;

    // End of SysEx
    sysex[4103] = 0xF7;

    console.log('Generated SysEx:', sysex.length, 'bytes', sysex);
    return sysex;
}

// Audio initialization
async function initAudio() {
    try {
        document.getElementById('audio-status').textContent = 'Audio: Loading...';

        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });

        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        // Load WASM files
        const [jsText, wasmBytes] = await Promise.all([
            fetch('../rfxsynths/rx7synth.js').then(r => r.text()),
            fetch('../rfxsynths/rx7synth.wasm').then(r => r.arrayBuffer())
        ]);

        // Create AudioWorklet using shared synth-worklet-processor
        console.log('Loading shared synth-worklet-processor');
        try {
            await audioContext.audioWorklet.addModule('../replugged/worklets/synth-worklet-processor.js');
            console.log('Synth worklet module loaded successfully');
        } catch (err) {
            console.error('Failed to load synth worklet module:', err);
            throw err;
        }

        console.log('Creating AudioWorkletNode: synth-worklet-processor');
        try {
            rx7WorkletNode = new AudioWorkletNode(audioContext, 'synth-worklet-processor', {
                outputChannelCount: [2]
            });
            console.log('AudioWorkletNode created successfully');
            console.log('  numberOfOutputs:', rx7WorkletNode.numberOfOutputs);
            console.log('  channelCount:', rx7WorkletNode.channelCount);
            console.log('  context:', rx7WorkletNode.context);
        } catch (err) {
            console.error('Failed to create AudioWorkletNode:', err);
            throw err;
        }

        // Handle worklet messages
        rx7WorkletNode.port.onmessage = (e) => {
            if (e.data.type === 'needWasm') {
                console.log('[RX7] Worklet requested WASM, sending...');
                rx7WorkletNode.port.postMessage({
                    type: 'wasmBytes',
                    data: {
                        jsCode: jsText,
                        wasmBytes: new Uint8Array(wasmBytes),
                        engineId: 707,  // RGDX7 engine ID
                        sampleRate: audioContext.sampleRate
                    }
                });
            } else if (e.data.type === 'ready') {
                audioReady = true;
                const sr = audioContext.sampleRate;
                document.getElementById('audio-status').textContent = `RX7 Engine: ${sr}Hz ✓`;
                document.getElementById('audio-status').style.color = '#5a979a';
                console.log('[RX7] Synth engine ready!');

                // Load the first built-in patch if no cartridge is loaded
                if (!cartridgeSysex && selectedSlot === -1) {
                    selectedSlot = 0;
                    const voices = createBuiltInCartridge();
                    currentPatch = JSON.parse(JSON.stringify(voices[0]));
                    updateUIFromPatch();
                    sendPatchToSynth();
                    renderCartridge();
                    console.log('[RX7] Auto-loaded first patch');
                }
            } else if (e.data.type === 'error') {
                audioReady = false;
                document.getElementById('audio-status').textContent = 'RX7 Engine: Error';
                document.getElementById('audio-status').style.color = '#ff3333';
                const errorMsg = e.data.message || e.data.data?.message || e.data.error || 'Unknown error';
                showNotification('Audio error: ' + errorMsg, 'error');
                console.error('Worklet error:', e.data);
            }
        };

        // Create gain node for volume control
        gainNode = audioContext.createGain();
        gainNode.gain.value = 0.8;

        // Connect: worklet -> gain -> destination
        rx7WorkletNode.connect(gainNode);
        gainNode.connect(audioContext.destination);

        console.log('Audio chain:', 'RX7Worklet -> Gain (0.8) -> Output');
        console.log('RX7 Worklet node:', rx7WorkletNode);
        console.log('Gain node:', gainNode);
        console.log('AudioContext.destination:', audioContext.destination);
        console.log('AudioContext.state:', audioContext.state);

        // Verify worklet is processing
        setTimeout(() => {
            console.log('5 seconds after init - checking if worklet is processing...');
        }, 5000);

        return true;
    } catch (err) {
        console.error('Failed to initialize audio:', err);
        document.getElementById('audio-status').textContent = 'Audio: Error';
        document.getElementById('audio-status').style.color = '#ff3333';
        showNotification('Audio init failed: ' + err.message, 'error');
        return false;
    }
}

// Preview current patch
async function previewPatch() {
    console.log('=== PREVIEW PATCH CALLED ===');

    // Initialize audio if not done yet
    if (!audioContext || !rx7WorkletNode) {
        console.log('[RX7] Audio not initialized, initializing now...');
        const success = await initAudio();
        if (!success) {
            showNotification('Failed to initialize audio', 'error');
            return;
        }
    }

    // Wait for synth engine to be ready
    if (!audioReady) {
        console.log('[RX7] Waiting for synth engine to be ready...');
        document.getElementById('audio-status').textContent = 'Audio: Loading engine...';

        // Wait up to 5 seconds for ready
        let attempts = 0;
        while (!audioReady && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }

        if (!audioReady) {
            showNotification('Synth engine failed to initialize', 'error');
            return;
        }
    }

    console.log('AudioContext state:', audioContext.state);

    // Always send current edited patch
    console.log('[RX7] Converting current patch to SysEx...');
    const sysex = patchToSysEx();
    console.log('Generated SysEx:', sysex.length, 'bytes', sysex);

    rx7WorkletNode.port.postMessage({
        type: 'loadSysex',
        data: {
            sysexData: sysex,
            patchNum: 0
        }
    });

    // Wait for patch to load
    await new Promise(resolve => setTimeout(resolve, 200));

    // Play a C4 note
    const midiNote = 60;
    const velocity = 100;

    console.log('Playing RX7 note', midiNote, 'velocity', velocity);
    console.log('Gain node value:', gainNode.gain.value);
    rx7WorkletNode.port.postMessage({ type: 'noteOn', data: { note: midiNote, velocity } });

    // Stop after 2 seconds
    setTimeout(() => {
        console.log('Stopping note', midiNote);
        rx7WorkletNode.port.postMessage({ type: 'noteOff', data: { note: midiNote } });
    }, 2000);
}

function stopPreview() {
    if (rx7WorkletNode) {
        console.log('[RX7] Stopping all notes');
        rx7WorkletNode.port.postMessage({ type: 'allNotesOff' });
    }
}

// Initialize
function init() {
    renderOperators();
    renderAlgorithmDiagram();
    renderCartridge();
    attachGlobalListeners();

    // Preview buttons
    document.getElementById('preview-btn').addEventListener('click', previewPatch);
    document.getElementById('stop-btn').addEventListener('click', stopPreview);

    // Cartridge browser toggle
    document.getElementById('cartridgeToggle').addEventListener('click', () => {
        const container = document.getElementById('cartridgeContainer');
        const toggle = document.getElementById('cartridgeToggle');
        container.classList.toggle('visible');
        toggle.textContent = container.classList.contains('visible') ? '▼' : '▶';
    });

    // Live update toggle - set initial state
    const liveUpdateBtn = document.getElementById('live-update-toggle');
    liveUpdateBtn.style.background = '#2a2a2a';
    liveUpdateBtn.style.border = '2px solid #2a2a2a';
    liveUpdateBtn.style.color = '#888';

    liveUpdateBtn.addEventListener('click', (e) => {
        liveUpdateEnabled = !liveUpdateEnabled;
        const btn = e.target;

        if (liveUpdateEnabled) {
            btn.classList.add('active');
            btn.style.background = '#7a5a9a';
            btn.style.border = '2px solid #7a5a9a';
            btn.style.color = 'white';
            if (audioReady) {
                sendPatchToSynth();
            }
        } else {
            btn.classList.remove('active');
            btn.style.background = '#2a2a2a';
            btn.style.border = '2px solid #2a2a2a';
            btn.style.color = '#888';
        }

        console.log('[RX7] Live update:', liveUpdateEnabled ? 'enabled' : 'disabled');
    });

    // Computer keyboard toggle - set initial state
    const keyboardBtn = document.getElementById('keyboard-toggle');
    keyboardBtn.style.background = '#2a2a2a';
    keyboardBtn.style.border = '2px solid #2a2a2a';
    keyboardBtn.style.color = '#888';

    keyboardBtn.addEventListener('click', (e) => {
        keyboardEnabled = !keyboardEnabled;
        const btn = e.target;
        const octaveDisplay = document.getElementById('octave-display');

        if (keyboardEnabled) {
            btn.classList.add('active');
            btn.style.background = '#5a979a';
            btn.style.border = '2px solid #5a979a';
            btn.style.color = 'white';
            octaveDisplay.style.display = 'inline';
            octaveDisplay.textContent = `Oct: ${currentOctave}`;
        } else {
            btn.classList.remove('active');
            btn.style.background = '#2a2a2a';
            btn.style.border = '2px solid #2a2a2a';
            btn.style.color = '#888';
            octaveDisplay.style.display = 'none';
            // Stop all notes when disabling
            activeNotes.forEach(note => stopNote(note));
            activeNotes.clear();
        }

        console.log('[RX7] Keyboard input:', keyboardEnabled ? 'enabled' : 'disabled');
    });

    // Initialize MIDI
    initMIDI();

    // Setup computer keyboard
    setupKeyboardInput();

    console.log('RX7 Construct initialized');
}

// Computer keyboard mapping (ASDFGHJKL = white keys, WE TYU = black keys)
const keyboardMap = {
    // White keys (C D E F G A B C)
    'a': 0,   // C
    's': 2,   // D
    'd': 4,   // E
    'f': 5,   // F
    'g': 7,   // G
    'h': 9,   // A
    'j': 11,  // B
    'k': 12,  // C (next octave)
    'l': 14,  // D
    ';': 16,  // E

    // Black keys
    'w': 1,   // C#
    'e': 3,   // D#
    't': 6,   // F#
    'y': 8,   // G#
    'u': 10   // A#
};

function setupKeyboardInput() {
    document.addEventListener('keydown', (e) => {
        if (!keyboardEnabled || !audioReady) return;
        if (e.repeat) return;

        // Ignore if typing in input fields
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        const key = e.key.toLowerCase();

        // Octave control (Z/X keys)
        if (key === 'z') {
            currentOctave = Math.max(0, currentOctave - 1);
            document.getElementById('octave-display').textContent = `Oct: ${currentOctave}`;
            console.log('[RX7] Octave down:', currentOctave);
            return;
        }
        if (key === 'x') {
            currentOctave = Math.min(8, currentOctave + 1);
            document.getElementById('octave-display').textContent = `Oct: ${currentOctave}`;
            console.log('[RX7] Octave up:', currentOctave);
            return;
        }

        if (keyboardMap.hasOwnProperty(key)) {
            const offset = keyboardMap[key];
            const midiNote = (currentOctave * 12) + offset;

            if (midiNote >= 0 && midiNote <= 127 && !activeNotes.has(midiNote)) {
                playNote(midiNote, 100);
                activeNotes.add(midiNote);
            }
        }
    });

    document.addEventListener('keyup', (e) => {
        if (!keyboardEnabled) return;

        // Ignore if typing in input fields
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        const key = e.key.toLowerCase();
        if (keyboardMap.hasOwnProperty(key)) {
            const offset = keyboardMap[key];
            const midiNote = (currentOctave * 12) + offset;

            if (activeNotes.has(midiNote)) {
                stopNote(midiNote);
                activeNotes.delete(midiNote);
            }
        }
    });
}

async function initMIDI() {
    try {
        midiManager = new MIDIManager();
        const success = await midiManager.initialize();

        if (success) {
            updateMIDIInputList();
            document.getElementById('midi-status').textContent = 'MIDI ready';
            document.getElementById('midi-status').style.color = '#5a979a';

            // Setup MIDI input selector
            document.getElementById('midi-input').addEventListener('change', (e) => {
                if (e.target.value) {
                    midiManager.connectInput(e.target.value);
                    document.getElementById('midi-status').textContent = 'Connected';
                    document.getElementById('midi-status').style.color = '#5a979a';
                } else {
                    document.getElementById('midi-status').textContent = 'Not connected';
                    document.getElementById('midi-status').style.color = '#888';
                }
            });

            // Setup MIDI message handler
            midiManager.on('noteon', (data) => {
                if (audioReady) {
                    playNote(data.note, data.velocity);
                }
            });

            midiManager.on('noteoff', (data) => {
                if (audioReady) {
                    stopNote(data.note);
                }
            });

            console.log('[RX7] MIDI initialized');
        } else {
            document.getElementById('midi-status').textContent = 'Not available';
            document.getElementById('midi-status').style.color = '#888';
        }
    } catch (err) {
        console.error('[RX7] MIDI init failed:', err);
    }
}

function updateMIDIInputList() {
    const select = document.getElementById('midi-input');
    const inputs = midiManager.getInputs();

    select.innerHTML = '<option value="">No MIDI Input</option>';
    inputs.forEach(input => {
        const option = document.createElement('option');
        option.value = input.id;
        option.textContent = input.name;
        select.appendChild(option);
    });
}

function playNote(note, velocity) {
    if (!rx7WorkletNode || !audioReady) return;
    rx7WorkletNode.port.postMessage({ type: 'noteOn', data: { note, velocity } });
}

function stopNote(note) {
    if (!rx7WorkletNode || !audioReady) return;
    rx7WorkletNode.port.postMessage({ type: 'noteOff', data: { note } });
}

// Send current patch to synth engine
function sendPatchToSynth() {
    if (!rx7WorkletNode || !audioReady) {
        console.log('[RX7] Cannot send patch: audioReady=', audioReady, 'worklet=', !!rx7WorkletNode);
        return;
    }

    const sysex = patchToSysEx();
    console.log('[RX7] Encoding patch:', currentPatch.name, 'Alg:', currentPatch.algorithm, 'Feedback:', currentPatch.feedback);
    console.log('[RX7] Op1 before encoding (operators[5]):', currentPatch.operators[5]);
    console.log('[RX7] LFO before encoding:', { speed: currentPatch.lfoSpeed, waveform: currentPatch.lfoWaveform, sync: currentPatch.lfoSync });

    rx7WorkletNode.port.postMessage({
        type: 'loadSysex',
        data: {
            sysexData: sysex,
            patchNum: 0
        }
    });
}

// Debounced patch update for live editing
function schedulePatchUpdate() {
    if (!liveUpdateEnabled) return;

    // Clear existing timeout
    if (updateTimeout) {
        clearTimeout(updateTimeout);
    }

    // Schedule update after 150ms of no changes
    updateTimeout = setTimeout(() => {
        sendPatchToSynth();
        console.log('[RX7] Live update: patch sent to synth');
    }, 150);
}

// Start when DOM is ready
window.addEventListener('load', () => {
    init();
});
