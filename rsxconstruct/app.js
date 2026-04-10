// RS1 Construct - Modular Synth Preset Designer
import { rs1PresetsData } from '../data/rsx/presets_data.js';

let nextOpId = 0;
const operators = [];
const MAX_OPERATORS = 4;

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

// Audio context for preview
let audioContext = null;
let rs1Synth = null;
let waveformScrollInterval = null;
let currentWaveformData = null;

// Operator types
const opTypes = [
    { id: 'RSX_OP_SINE', name: 'Sine', hasFreq: true, hasParams: false, isModifier: false },
    { id: 'RSX_OP_SAW', name: 'Saw', hasFreq: true, hasParams: false, isModifier: false },
    { id: 'RSX_OP_SQUARE', name: 'Square', hasFreq: true, hasParams: true, param: 'pulse_width', isModifier: false },
    { id: 'RSX_OP_TRIANGLE', name: 'Triangle', hasFreq: true, hasParams: false, isModifier: false },
    { id: 'RSX_OP_NOISE', name: 'Noise', hasFreq: false, hasParams: false, isModifier: false },
    { id: 'RSX_OP_FILTER_LP', name: 'LP Filter', hasFreq: false, hasParams: true, param: 'filter', isModifier: true },
    { id: 'RSX_OP_FILTER_HP', name: 'HP Filter', hasFreq: false, hasParams: true, param: 'filter', isModifier: true },
    { id: 'RSX_OP_RESONATOR', name: 'Resonator', hasFreq: true, hasParams: true, param: 'resonator', isModifier: false }
];

// Mix modes
const mixModes = [
    { id: 'RSX_MIX_ADD', name: 'Add' },
    { id: 'RSX_MIX_MUL', name: 'Ring Mod' }
];

// Global settings
const preset = {
    name: 'Custom',
    masterVolume: 0.8
};

// Operator template
function createOperator() {
    return {
        id: nextOpId++,
        type: 'RSX_OP_SAW',
        startTime: 0.0,
        duration: 0.0,  // 0 = until note off
        frequency: 0.0,
        fixedPitch: false,
        level: 1.0,
        envelope: {
            attack: 0.01,
            decay: 0.3,
            sustain: 0.7,
            release: 0.5
        },
        params: {
            pulseWidth: 0.5,
            filterCutoff: 0.5,
            filterResonance: 0.3,
            resonatorResonance: 4.0,
            resonatorBandwidth: 1.0
        },
        inputOp: -1,
        mixMode: 'RSX_MIX_ADD'
    };
}

// DOM elements
const canvas = document.getElementById('waveform');
const ctx = canvas.getContext('2d');
const operatorsContainer = document.getElementById('operators-container');
const graphSvg = document.getElementById('operator-graph');

// Initialize with one operator
operators.push(createOperator());

renderUI();
updateCode();

// Event listeners
document.getElementById('add-op-btn').addEventListener('click', () => {
    if (operators.length < MAX_OPERATORS) {
        operators.push(createOperator());
        renderUI();
        updateCode();
        
    }
});

document.getElementById('preview-btn').addEventListener('click', playPreview);
document.getElementById('save-btn').addEventListener('click', savePreset);
document.getElementById('load-btn').addEventListener('click', loadPresetFile);
document.getElementById('save-local-btn').addEventListener('click', savePresetLocal);
document.getElementById('load-local-btn').addEventListener('click', loadPresetLocal);
document.getElementById('delete-local-btn').addEventListener('click', deletePresetLocal);
document.getElementById('preset-name').addEventListener('input', (e) => {
    preset.name = e.target.value;
    updateCode();
});
document.getElementById('master-volume').addEventListener('input', (e) => {
    preset.masterVolume = parseFloat(e.target.value);
    document.getElementById('master-volume-val').textContent = preset.masterVolume.toFixed(2);
    updateCode();
});

// Load preset template from dropdown
document.getElementById('load-preset-btn').addEventListener('click', async () => {
    const selector = document.getElementById('preset-selector');
    await loadPresetFromBinary(selector.value);
});

// Update saved presets dropdown on page load
updateSavedPresetsDropdown();

// Create operator UI
function createOperatorUI(op, index) {
    const card = document.createElement('div');
    const opType = opTypes.find(t => t.id === op.type);
    card.className = opType.isModifier ? 'op-card modifier' : 'op-card';
    card.dataset.opId = op.id;

    // Only expand first operator by default
    const isExpanded = index === 0;
    if (!isExpanded) {
        card.classList.add('collapsed');
    }

    const hasFreqControls = opType.hasFreq;
    const hasParamControls = opType.hasParams;

    card.innerHTML = `
        <div class="op-header" style="cursor: pointer;">
            <div class="op-title">
                <h3><span class="collapse-indicator">${isExpanded ? '▼' : '▶'}</span> Operator ${index + 1}</h3>
                <span class="op-type-label">${opType.name}</span>
            </div>
            <div class="op-controls">
                ${operators.length > 1 ? '<button class="icon-button remove-btn" title="Remove">×</button>' : ''}
            </div>
        </div>
        <div class="op-body" style="${isExpanded ? '' : 'display: none;'}">
            <div class="type-selector">
                ${opTypes.map(t => `
                    <button class="type-btn ${op.type === t.id ? 'active' : ''}" data-type="${t.id}">${t.name}</button>
                `).join('')}
            </div>

            <div class="param-section">
                <h4>Timing</h4>
                <div class="param-group">
                    <label>
                        <span>Start Time: <strong class="start-time-val">${op.startTime.toFixed(3)}</strong> s</span>
                        <input type="range" class="start-time" min="0" max="1" value="${op.startTime}" step="0.001">
                    </label>
                    <label>
                        <span>Duration: <strong class="duration-val">${op.duration === 0 ? '∞' : op.duration.toFixed(3)}</strong> s</span>
                        <input type="range" class="duration" min="0" max="2" value="${op.duration}" step="0.01">
                    </label>
                </div>
            </div>

            ${hasFreqControls ? `
            <div class="param-section">
                <h4>Pitch</h4>
                <div class="param-group">
                    <label>
                        <span>Frequency: <strong class="frequency-val">${op.frequency.toFixed(1)}</strong> ${op.fixedPitch ? 'Hz' : 'semitones'}</span>
                        <input type="range" class="frequency" min="${op.fixedPitch ? '20' : '-24'}" max="${op.fixedPitch ? '2000' : '24'}" value="${op.frequency}" step="${op.fixedPitch ? '1' : '0.1'}">
                    </label>
                    <label style="display: flex; align-items: center; gap: 5px;">
                        <input type="checkbox" class="fixed-pitch" ${op.fixedPitch ? 'checked' : ''}>
                        <span>Fixed Pitch (Hz)</span>
                    </label>
                </div>
            </div>
            ` : ''}

            <div class="param-section">
                <h4>Amplitude</h4>
                <div class="param-group">
                    <label>
                        <span>Level: <strong class="level-val">${op.level.toFixed(2)}</strong></span>
                        <input type="range" class="level" min="0" max="2" value="${op.level}" step="0.01">
                    </label>
                </div>
            </div>

            <div class="param-section">
                <h4>Envelope (ADSR)</h4>
                <div class="param-group">
                    <label>
                        <span>Attack: <strong class="attack-val">${op.envelope.attack.toFixed(3)}</strong> s</span>
                        <input type="range" class="attack" min="0" max="1" value="${op.envelope.attack}" step="0.001">
                    </label>
                    <label>
                        <span>Decay: <strong class="decay-val">${op.envelope.decay.toFixed(3)}</strong> s</span>
                        <input type="range" class="decay" min="0" max="2" value="${op.envelope.decay}" step="0.01">
                    </label>
                    <label>
                        <span>Sustain: <strong class="sustain-val">${op.envelope.sustain.toFixed(2)}</strong></span>
                        <input type="range" class="sustain" min="0" max="1" value="${op.envelope.sustain}" step="0.01">
                    </label>
                    <label>
                        <span>Release: <strong class="release-val">${op.envelope.release.toFixed(3)}</strong> s</span>
                        <input type="range" class="release" min="0" max="2" value="${op.envelope.release}" step="0.01">
                    </label>
                </div>
            </div>

            ${hasParamControls && opType.param === 'pulse_width' ? `
            <div class="param-section">
                <h4>Pulse Width</h4>
                <div class="param-group">
                    <label>
                        <span>Width: <strong class="pulse-width-val">${op.params.pulseWidth.toFixed(2)}</strong></span>
                        <input type="range" class="pulse-width" min="0" max="1" value="${op.params.pulseWidth}" step="0.01">
                    </label>
                </div>
            </div>
            ` : ''}

            ${hasParamControls && opType.param === 'filter' ? `
            <div class="param-section">
                <h4>Filter</h4>
                <div class="param-group">
                    <label>
                        <span>Cutoff: <strong class="filter-cutoff-val">${op.params.filterCutoff.toFixed(2)}</strong></span>
                        <input type="range" class="filter-cutoff" min="0" max="1" value="${op.params.filterCutoff}" step="0.01">
                    </label>
                    <label>
                        <span>Resonance: <strong class="filter-resonance-val">${op.params.filterResonance.toFixed(2)}</strong></span>
                        <input type="range" class="filter-resonance" min="0" max="1" value="${op.params.filterResonance}" step="0.01">
                    </label>
                </div>
            </div>
            ` : ''}

            ${hasParamControls && opType.param === 'resonator' ? `
            <div class="param-section">
                <h4>Resonator (909-style)</h4>
                <div class="param-group">
                    <label>
                        <span>Q/Resonance: <strong class="resonator-resonance-val">${(op.params.resonatorResonance || 4.0).toFixed(1)}</strong></span>
                        <input type="range" class="resonator-resonance" min="0.5" max="20" value="${op.params.resonatorResonance || 4.0}" step="0.1">
                    </label>
                    <label>
                        <span>Bandwidth: <strong class="resonator-bandwidth-val">${(op.params.resonatorBandwidth || 1.0).toFixed(2)}</strong></span>
                        <input type="range" class="resonator-bandwidth" min="0.1" max="2" value="${op.params.resonatorBandwidth || 1.0}" step="0.05">
                    </label>
                </div>
            </div>
            ` : ''}

            <div class="param-section">
                <h4>Routing</h4>
                <div class="param-group">
                    <label>
                        <span>Input Operator</span>
                        <select class="input-op">
                            <option value="-1" ${op.inputOp === -1 ? 'selected' : ''}>None</option>
                            ${operators.map((_, i) => i < index ? `
                                <option value="${i}" ${op.inputOp === i ? 'selected' : ''}>Operator ${i + 1}</option>
                            ` : '').join('')}
                        </select>
                    </label>
                    <label>
                        <span>Mix Mode</span>
                        <select class="mix-mode" ${op.inputOp === -1 ? 'disabled' : ''}>
                            ${mixModes.map(m => `
                                <option value="${m.id}" ${op.mixMode === m.id ? 'selected' : ''}>${m.name}</option>
                            `).join('')}
                        </select>
                    </label>
                </div>
            </div>
        </div>
    `;

    return card;
}

// Create output (master volume) UI card
function createOutputUI() {
    const card = document.createElement('div');
    card.className = 'op-card';
    card.id = 'output-card';

    card.innerHTML = `
        <div class="op-header" style="cursor: pointer;">
            <div class="op-title">
                <h3><span class="collapse-indicator">▼</span> Output</h3>
                <span class="op-type-label">Master</span>
            </div>
        </div>
        <div class="op-body">
            <div class="param-section">
                <h4>Master Volume</h4>
                <div class="param-group">
                    <label>
                        <span>Volume: <strong id="master-volume-val">${preset.masterVolume.toFixed(2)}</strong></span>
                        <input type="range" id="master-volume" min="0" max="1" value="${preset.masterVolume}" step="0.01">
                    </label>
                </div>
            </div>
        </div>
    `;

    // Collapse/expand
    const opHeader = card.querySelector('.op-header');
    opHeader.addEventListener('click', () => {
        card.classList.toggle('collapsed');
        const opBody = card.querySelector('.op-body');
        const indicator = card.querySelector('.collapse-indicator');
        if (card.classList.contains('collapsed')) {
            opBody.style.display = 'none';
            indicator.textContent = '▶';
        } else {
            opBody.style.display = '';
            indicator.textContent = '▼';
        }
    });

    // Master volume slider
    const volSlider = card.querySelector('#master-volume');
    const volVal = card.querySelector('#master-volume-val');
    volSlider.addEventListener('input', (e) => {
        preset.masterVolume = parseFloat(e.target.value);
        volVal.textContent = preset.masterVolume.toFixed(2);
        updateCode();
    });

    return card;
}

// Render all operators
function renderUI() {
    operatorsContainer.innerHTML = '';

    // Add output card first
    const outputCard = createOutputUI();
    operatorsContainer.appendChild(outputCard);

    // Add operator cards
    operators.forEach((op, index) => {
        const card = createOperatorUI(op, index);
        operatorsContainer.appendChild(card);
        attachOperatorEvents(card, op, index);
    });

    // Update add button state
    document.getElementById('add-op-btn').disabled = operators.length >= MAX_OPERATORS;
}

// Attach events to operator card
function attachOperatorEvents(card, op, index) {
    // Type buttons
    card.querySelectorAll('.type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            op.type = btn.dataset.type;
            renderUI();
            updateCode();
            
        });
    });

    // Remove button
    const removeBtn = card.querySelector('.remove-btn');
    if (removeBtn) {
        removeBtn.addEventListener('click', () => {
            operators.splice(index, 1);
            // Update routing references
            operators.forEach(o => {
                if (o.inputOp >= index) {
                    o.inputOp = Math.max(-1, o.inputOp - 1);
                }
            });
            renderUI();
            updateCode();
            
        });
    }

    // Collapse/expand operator
    const opHeader = card.querySelector('.op-header');
    if (opHeader) {
        opHeader.addEventListener('click', (e) => {
            // Don't toggle if clicking the remove button
            if (e.target.classList.contains('remove-btn')) return;

            const opBody = card.querySelector('.op-body');
            const indicator = card.querySelector('.collapse-indicator');
            const isCollapsed = card.classList.toggle('collapsed');

            if (isCollapsed) {
                opBody.style.display = 'none';
                indicator.textContent = '▶';
            } else {
                opBody.style.display = '';
                indicator.textContent = '▼';
            }
        });
    }

    // Sliders and inputs
    const attachSlider = (className, prop, subProp = null, formatter = (v) => v) => {
        const slider = card.querySelector(`.${className}`);
        const valueDisplay = card.querySelector(`.${className}-val`);
        if (slider) {
            slider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                if (subProp) {
                    op[prop][subProp] = value;
                } else {
                    op[prop] = value;
                }
                valueDisplay.textContent = formatter(value);
                updateCode();
                
            });
        }
    };

    attachSlider('start-time', 'startTime', null, v => v.toFixed(3));
    attachSlider('duration', 'duration', null, v => v === 0 ? '∞' : v.toFixed(3));
    attachSlider('frequency', 'frequency', null, v => v.toFixed(1));
    attachSlider('level', 'level', null, v => v.toFixed(2));
    attachSlider('attack', 'envelope', 'attack', v => v.toFixed(3));
    attachSlider('decay', 'envelope', 'decay', v => v.toFixed(3));
    attachSlider('sustain', 'envelope', 'sustain', v => v.toFixed(2));
    attachSlider('release', 'envelope', 'release', v => v.toFixed(3));
    attachSlider('pulse-width', 'params', 'pulseWidth', v => v.toFixed(2));
    attachSlider('filter-cutoff', 'params', 'filterCutoff', v => v.toFixed(2));
    attachSlider('filter-resonance', 'params', 'filterResonance', v => v.toFixed(2));

    // Initialize resonator params if they don't exist
    if (op.params.resonatorResonance === undefined) op.params.resonatorResonance = 4.0;
    if (op.params.resonatorBandwidth === undefined) op.params.resonatorBandwidth = 1.0;

    attachSlider('resonator-resonance', 'params', 'resonatorResonance', v => v.toFixed(1));
    attachSlider('resonator-bandwidth', 'params', 'resonatorBandwidth', v => v.toFixed(2));

    // Fixed pitch checkbox
    const fixedPitchCheck = card.querySelector('.fixed-pitch');
    if (fixedPitchCheck) {
        fixedPitchCheck.addEventListener('change', (e) => {
            op.fixedPitch = e.target.checked;
            // Reset frequency to sensible default
            op.frequency = op.fixedPitch ? 440.0 : 0.0;
            renderUI();
            updateCode();
            
        });
    }

    // Input operator select
    const inputOpSelect = card.querySelector('.input-op');
    const mixModeSelect = card.querySelector('.mix-mode');

    if (inputOpSelect) {
        inputOpSelect.addEventListener('change', (e) => {
            op.inputOp = parseInt(e.target.value);
            // Enable/disable mix mode based on input selection
            if (mixModeSelect) {
                mixModeSelect.disabled = (op.inputOp === -1);
            }
            updateCode();
            drawOperatorGraph();
            
        });
    }

    // Mix mode select
    if (mixModeSelect) {
        mixModeSelect.addEventListener('change', (e) => {
            op.mixMode = e.target.value;
            updateCode();
            
        });
    }
}

// Draw operator graph (SVG)
function updateCode() {
    drawOperatorGraph();
}

let selectedElement = null;  // Track selected element for parameter display

function drawOperatorGraph() {
    const width = 1000;  // Fixed width

    // Clear SVG
    graphSvg.innerHTML = '';
    graphSvg.setAttribute('width', width);

    if (operators.length === 0) {
        const minHeight = 150;
        graphSvg.setAttribute('height', minHeight);
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', width / 2);
        text.setAttribute('y', minHeight / 2);
        text.setAttribute('fill', '#666');
        text.setAttribute('font-size', '16');
        text.setAttribute('font-family', 'monospace');
        text.setAttribute('text-anchor', 'middle');
        text.textContent = 'No operators';
        graphSvg.appendChild(text);
        return;
    }

    // Draw legend at top (horizontal layout)
    const legendY = 15;
    const legendItems = [
        { label: 'Source', stroke: '#4a4aff' },
        { label: 'Mixer', stroke: '#ff4a4a' },
        { label: 'Filter', stroke: '#4aff4a' },
        { label: 'Output', stroke: '#ffaa00' }
    ];

    let legendX = 50;
    legendItems.forEach((item, i) => {
        // Box
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', legendX);
        rect.setAttribute('y', legendY);
        rect.setAttribute('width', 16);
        rect.setAttribute('height', 16);
        rect.setAttribute('fill', 'none');
        rect.setAttribute('stroke', item.stroke);
        rect.setAttribute('stroke-width', item.label === 'Output' ? '3' : '2');
        graphSvg.appendChild(rect);

        // Label
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', legendX + 24);
        text.setAttribute('y', legendY + 12);
        text.setAttribute('fill', '#aaa');
        text.setAttribute('font-size', '11');
        text.setAttribute('font-family', 'monospace');
        text.textContent = item.label;
        graphSvg.appendChild(text);

        legendX += 100;
    });

    // Calculate layout by dependency level
    const boxWidth = 140;
    const boxHeight = 80;
    const colSpacing = 180;
    const rowSpacing = 40;
    const startX = 50;
    const startY = 50;  // Start below legend

    // Organize operators into columns by dependency
    const columns = [];
    const opLevels = new Array(operators.length).fill(-1);

    // Calculate dependency level for each operator
    const calculateLevel = (idx) => {
        if (opLevels[idx] !== -1) return opLevels[idx];
        const op = operators[idx];
        if (op.inputOp === -1) {
            opLevels[idx] = 0;
            return 0;
        }
        opLevels[idx] = calculateLevel(op.inputOp) + 1;
        return opLevels[idx];
    };

    operators.forEach((op, idx) => calculateLevel(idx));

    // Group operators by level
    const maxLevel = Math.max(...opLevels);
    for (let level = 0; level <= maxLevel; level++) {
        columns[level] = [];
    }
    operators.forEach((op, idx) => {
        columns[opLevels[idx]].push(idx);
    });

    // Calculate positions for each operator
    const opPositions = [];
    let maxOpY = startY;
    columns.forEach((col, colIdx) => {
        col.forEach((opIdx, rowIdx) => {
            const y = startY + rowIdx * (boxHeight + rowSpacing);
            opPositions[opIdx] = {
                x: startX + colIdx * colSpacing,
                y: y
            };
            maxOpY = Math.max(maxOpY, y + boxHeight);
        });
    });

    // Find output operators
    const outputOps = [];
    operators.forEach((op, idx) => {
        const isUsedAsInput = operators.some(o => o.inputOp === idx);
        if (!isUsedAsInput) {
            outputOps.push(idx);
        }
    });

    // Output block position (aligned with first operator row)
    const outputX = startX + (maxLevel + 1) * colSpacing + 30;
    const outputY = startY + 10;
    const outputWidth = 120;
    const outputHeight = 60;

    // Calculate final SVG height (max of operators or output, plus padding)
    const graphHeight = Math.max(maxOpY, outputY + outputHeight) + 20;
    graphSvg.setAttribute('height', graphHeight);

    // Draw connections first (behind boxes)
    operators.forEach((op, idx) => {
        if (op.inputOp >= 0 && op.inputOp < operators.length) {
            const fromPos = opPositions[op.inputOp];
            const toPos = opPositions[idx];
            const fromX = fromPos.x + boxWidth;
            const fromY = fromPos.y + boxHeight / 2;
            const toX = toPos.x;
            const toY = toPos.y + boxHeight / 2;

            // Line
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', fromX);
            line.setAttribute('y1', fromY);
            line.setAttribute('x2', toX);
            line.setAttribute('y2', toY);
            line.setAttribute('stroke', '#CF1A37');
            line.setAttribute('stroke-width', '2');
            graphSvg.appendChild(line);

            // Arrow head
            const angle = Math.atan2(toY - fromY, toX - fromX);
            const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            const points = [
                [toX, toY],
                [toX - 10 * Math.cos(angle - 0.3), toY - 10 * Math.sin(angle - 0.3)],
                [toX - 10 * Math.cos(angle + 0.3), toY - 10 * Math.sin(angle + 0.3)]
            ].map(p => p.join(',')).join(' ');
            arrow.setAttribute('points', points);
            arrow.setAttribute('fill', '#CF1A37');
            graphSvg.appendChild(arrow);
        }
    });

    // Connections to output block
    outputOps.forEach((opIdx) => {
        const fromPos = opPositions[opIdx];
        const fromX = fromPos.x + boxWidth;
        const fromY = fromPos.y + boxHeight / 2;
        const toX = outputX;
        const toY = outputY + outputHeight / 2;

        // Line
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', fromX);
        line.setAttribute('y1', fromY);
        line.setAttribute('x2', toX);
        line.setAttribute('y2', toY);
        line.setAttribute('stroke', '#ffaa00');
        line.setAttribute('stroke-width', '3');
        graphSvg.appendChild(line);

        // Arrow head
        const angle = Math.atan2(toY - fromY, toX - fromX);
        const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        const points = [
            [toX, toY],
            [toX - 10 * Math.cos(angle - 0.3), toY - 10 * Math.sin(angle - 0.3)],
            [toX - 10 * Math.cos(angle + 0.3), toY - 10 * Math.sin(angle + 0.3)]
        ].map(p => p.join(',')).join(' ');
        arrow.setAttribute('points', points);
        arrow.setAttribute('fill', '#ffaa00');
        graphSvg.appendChild(arrow);
    });

    // Draw operator boxes
    operators.forEach((op, idx) => {
        const pos = opPositions[idx];
        const x = pos.x;
        const y = pos.y;

        const opType = opTypes.find(t => t.id === op.type);
        const isSource = op.inputOp === -1;
        const isModifier = opType && opType.isModifier;

        // Create group for operator
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('cursor', 'pointer');
        group.setAttribute('data-op-idx', idx);

        // Box background
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', boxWidth);
        rect.setAttribute('height', boxHeight);
        rect.setAttribute('fill', isModifier ? '#1a3a1a' : (isSource ? '#1a1a2a' : '#2a1a1a'));
        rect.setAttribute('stroke', isSource ? '#4a4aff' : (isModifier ? '#4aff4a' : '#ff4a4a'));
        rect.setAttribute('stroke-width', '2');
        rect.setAttribute('rx', '4');
        group.appendChild(rect);

        // Op number
        const opNum = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        opNum.setAttribute('x', x + 8);
        opNum.setAttribute('y', y + 20);
        opNum.setAttribute('fill', '#fff');
        opNum.setAttribute('font-size', '14');
        opNum.setAttribute('font-weight', 'bold');
        opNum.setAttribute('font-family', 'monospace');
        opNum.textContent = `Operator ${idx + 1}`;
        group.appendChild(opNum);

        // Op type
        const opTypeName = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        opTypeName.setAttribute('x', x + 8);
        opTypeName.setAttribute('y', y + 38);
        opTypeName.setAttribute('fill', '#CF1A37');
        opTypeName.setAttribute('font-size', '12');
        opTypeName.setAttribute('font-family', 'monospace');
        opTypeName.textContent = opType ? opType.name : 'Unknown';
        group.appendChild(opTypeName);

        // Frequency or params
        if (opType && opType.hasFreq) {
            const freqText = op.fixedPitch ? `${op.frequency.toFixed(0)}Hz` : `${op.frequency >= 0 ? '+' : ''}${op.frequency.toFixed(1)}st`;
            const freq = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            freq.setAttribute('x', x + 8);
            freq.setAttribute('y', y + 52);
            freq.setAttribute('fill', '#aaa');
            freq.setAttribute('font-size', '10');
            freq.setAttribute('font-family', 'monospace');
            freq.textContent = freqText;
            group.appendChild(freq);
        } else if (opType && opType.param === 'resonator') {
            const q = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            q.setAttribute('x', x + 8);
            q.setAttribute('y', y + 52);
            q.setAttribute('fill', '#aaa');
            q.setAttribute('font-size', '10');
            q.setAttribute('font-family', 'monospace');
            q.textContent = `Q=${op.params.resonatorResonance.toFixed(1)}`;
            group.appendChild(q);
        } else if (opType && opType.param === 'filter') {
            const cut = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            cut.setAttribute('x', x + 8);
            cut.setAttribute('y', y + 52);
            cut.setAttribute('fill', '#aaa');
            cut.setAttribute('font-size', '10');
            cut.setAttribute('font-family', 'monospace');
            cut.textContent = `Cut=${op.params.filterCutoff.toFixed(2)}`;
            group.appendChild(cut);
        }

        // Level
        const level = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        level.setAttribute('x', x + 8);
        level.setAttribute('y', y + 66);
        level.setAttribute('fill', '#aaa');
        level.setAttribute('font-size', '10');
        level.setAttribute('font-family', 'monospace');
        level.textContent = `Lvl=${op.level.toFixed(2)}`;
        group.appendChild(level);

        // Click handler - expand operator card in designer
        group.addEventListener('click', (e) => {
            e.stopPropagation();
            expandOperatorCard(idx);
        });

        graphSvg.appendChild(group);
    });

    // Draw output block
    const outputGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    outputGroup.setAttribute('cursor', 'pointer');
    outputGroup.setAttribute('data-output', 'true');

    const outputRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    outputRect.setAttribute('x', outputX);
    outputRect.setAttribute('y', outputY);
    outputRect.setAttribute('width', outputWidth);
    outputRect.setAttribute('height', outputHeight);
    outputRect.setAttribute('fill', '#2a2a0a');
    outputRect.setAttribute('stroke', '#ffaa00');
    outputRect.setAttribute('stroke-width', '3');
    outputRect.setAttribute('rx', '4');
    outputGroup.appendChild(outputRect);

    const outputLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    outputLabel.setAttribute('x', outputX + outputWidth / 2);
    outputLabel.setAttribute('y', outputY + 25);
    outputLabel.setAttribute('fill', '#ffaa00');
    outputLabel.setAttribute('font-size', '16');
    outputLabel.setAttribute('font-weight', 'bold');
    outputLabel.setAttribute('font-family', 'monospace');
    outputLabel.setAttribute('text-anchor', 'middle');
    outputLabel.textContent = 'OUTPUT';
    outputGroup.appendChild(outputLabel);

    const outputCount = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    outputCount.setAttribute('x', outputX + outputWidth / 2);
    outputCount.setAttribute('y', outputY + 45);
    outputCount.setAttribute('fill', '#aaa');
    outputCount.setAttribute('font-size', '11');
    outputCount.setAttribute('font-family', 'monospace');
    outputCount.setAttribute('text-anchor', 'middle');
    outputCount.textContent = `${outputOps.length} source${outputOps.length !== 1 ? 's' : ''}`;
    outputGroup.appendChild(outputCount);

    // Click handler - expand output card in designer
    outputGroup.addEventListener('click', (e) => {
        e.stopPropagation();
        expandOutputCard();
    });

    graphSvg.appendChild(outputGroup);

}

// Expand operator card in designer section when clicked in graph
function expandOperatorCard(opIdx) {
    // Find the operator card (skip output card which is first)
    const allCards = operatorsContainer.querySelectorAll('.op-card');
    const operatorCards = Array.from(allCards).filter(card => !card.id || card.id !== 'output-card');
    const card = operatorCards[opIdx];

    if (!card) return;

    // Expand if collapsed
    if (card.classList.contains('collapsed')) {
        card.classList.remove('collapsed');
        const opBody = card.querySelector('.op-body');
        const indicator = card.querySelector('.collapse-indicator');
        if (opBody) opBody.style.display = '';
        if (indicator) indicator.textContent = '▼';
    }

    // Scroll to card
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Highlight briefly
    card.style.outline = '3px solid #CF1A37';
    setTimeout(() => {
        card.style.outline = '';
    }, 1000);
}

// Expand output card in designer section when clicked in graph
function expandOutputCard() {
    const card = document.getElementById('output-card');
    if (!card) return;

    // Expand if collapsed
    if (card.classList.contains('collapsed')) {
        card.classList.remove('collapsed');
        const opBody = card.querySelector('.op-body');
        const indicator = card.querySelector('.collapse-indicator');
        if (opBody) opBody.style.display = '';
        if (indicator) indicator.textContent = '▼';
    }

    // Scroll to card
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Highlight briefly
    card.style.outline = '3px solid #CF1A37';
    setTimeout(() => {
        card.style.outline = '';
    }, 1000);
}

// Toggle operator details (legacy - for details panel display)

// Save preset as binary file
async function savePreset() {
    if (!rs1Synth) {
        showNotification('Load synth first (click Preview)');
        return;
    }

    try {
        const M = rs1Synth.Module;

        // Upload current preset
        uploadPresetToSynth();

        // Get serialized size
        const size = M._regroove_synth_bank_serialize_size();

        // Allocate buffer
        const bufferPtr = M._malloc(size);

        // Serialize
        M._regroove_synth_bank_serialize(bufferPtr);

        // Read binary data
        const binaryData = new Uint8Array(rs1Synth.memory.buffer, bufferPtr, size);
        const data = new Uint8Array(binaryData);

        // Free buffer
        M._free(bufferPtr);

        // Create blob and download
        const blob = new Blob([data], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${preset.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}.rs1`;
        a.click();
        URL.revokeObjectURL(url);

    } catch (error) {
        showNotification('Error saving preset: ' + error.message);
    }
}

// Load preset from binary file
async function loadPresetFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.rs1';

    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            if (!rs1Synth) {
                await loadWASMModule();
            }

            const arrayBuffer = await file.arrayBuffer();
            const data = new Uint8Array(arrayBuffer);

            const M = rs1Synth.Module;
            const inst = rs1Synth.instance;

            // Allocate buffer
            const bufferPtr = M._malloc(data.length);

            // Copy data
            const heap = new Uint8Array(rs1Synth.memory.buffer, bufferPtr, data.length);
            heap.set(data);

            // Deserialize
            const result = M._regroove_synth_bank_deserialize(bufferPtr, data.length);

            // Free buffer
            M._free(bufferPtr);

            if (result !== 0) {
                throw new Error('Failed to deserialize preset');
            }

            // Apply to synth
            M._regroove_synth_bank_apply(inst);

            showNotification('Preset loaded successfully!');
            updateCode();

        } catch (error) {
            showNotification('Error loading preset: ' + error.message);
        }
    };

    input.click();
}

// Update saved presets dropdown
function updateSavedPresetsDropdown() {
    const selector = document.getElementById('saved-presets-selector');
    if (!selector) {
        console.error('saved-presets-selector not found');
        return;
    }

    const savedPresets = JSON.parse(localStorage.getItem('rsxconstruct_presets') || '{}');
    const presetNames = Object.keys(savedPresets).sort();

    selector.innerHTML = '';

    if (presetNames.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '-- No saved presets --';
        selector.appendChild(option);
    } else {
        presetNames.forEach(name => {
            const state = savedPresets[name];
            const option = document.createElement('option');
            option.value = name;
            option.textContent = `${name} (${state.operators?.length || 0} ops)`;
            selector.appendChild(option);
        });
    }
}

// Save preset to localStorage by name
function savePresetLocal() {
    const presetName = preset.name.trim();
    if (!presetName) {
        showNotification('Please enter a preset name', 'error');
        return;
    }

    const state = {
        preset: preset,
        operators: operators,
        nextOpId: nextOpId,
        savedAt: new Date().toISOString()
    };

    // Get list of saved presets
    const savedPresets = JSON.parse(localStorage.getItem('rsxconstruct_presets') || '{}');
    savedPresets[presetName] = state;
    localStorage.setItem('rsxconstruct_presets', JSON.stringify(savedPresets));

    updateSavedPresetsDropdown();

    // Select the newly saved preset
    document.getElementById('saved-presets-selector').value = presetName;

    showNotification(`Preset "${presetName}" saved`, 'success');
}

// Load preset from localStorage dropdown
function loadPresetLocal() {
    const selector = document.getElementById('saved-presets-selector');
    const presetName = selector.value;

    if (!presetName) {
        showNotification('No preset selected', 'error');
        return;
    }

    const savedPresets = JSON.parse(localStorage.getItem('rsxconstruct_presets') || '{}');
    const state = savedPresets[presetName];

    if (!state) {
        showNotification('Preset not found', 'error');
        return;
    }

    loadPresetFromState(state);
    showNotification(`Preset "${presetName}" loaded`, 'success');
}

// Delete currently selected preset
let deleteConfirmTimeout = null;
function deletePresetLocal() {
    const selector = document.getElementById('saved-presets-selector');
    const presetName = selector.value;

    if (!presetName) {
        showNotification('No preset selected', 'error');
        return;
    }

    // Double-click confirmation
    const deleteBtn = document.getElementById('delete-local-btn');
    if (deleteConfirmTimeout) {
        // Second click - actually delete
        clearTimeout(deleteConfirmTimeout);
        deleteConfirmTimeout = null;
        deleteBtn.textContent = 'Delete';

        const savedPresets = JSON.parse(localStorage.getItem('rsxconstruct_presets') || '{}');
        delete savedPresets[presetName];
        localStorage.setItem('rsxconstruct_presets', JSON.stringify(savedPresets));

        updateSavedPresetsDropdown();
        showNotification(`Preset "${presetName}" deleted`, 'info');
    } else {
        // First click - ask for confirmation
        deleteBtn.textContent = 'Confirm';
        showNotification(`Click Confirm to delete "${presetName}"`, 'error');
        deleteConfirmTimeout = setTimeout(() => {
            deleteConfirmTimeout = null;
            deleteBtn.textContent = 'Delete';
        }, 3000);
    }
}

// Load preset from state object
function loadPresetFromState(state) {
    preset.name = state.preset.name;
    preset.masterVolume = state.preset.masterVolume;
    operators.length = 0;
    operators.push(...state.operators);
    nextOpId = state.nextOpId;

    // Update UI controls
    document.getElementById('preset-name').value = preset.name;

    renderUI();
    updateCode();
}

// Load preset from binary .rs1 file
// Load preset from dropdown
// Presets are auto-generated from C code by tools/rsxrender/generate_preset_jsdata.c
async function loadPresetFromBinary(type) {
    loadPreset(type);
}

// Load preset from imported preset library
// Presets are auto-generated from C code - see rs1PresetsData
function loadPreset(type) {
    operators.length = 0;
    nextOpId = 0;

    // Load from imported preset library
    const presetData = rs1PresetsData[type];
    if (!presetData) {
        showNotification(`Preset "${type}" not found`, 'error');
        return;
    }

    // Apply preset data
    preset.name = presetData.name;
    preset.masterVolume = presetData.masterVolume;

    // Clone operators and assign IDs
    presetData.operators.forEach(op => {
        operators.push({
            id: nextOpId++,
            ...op
        });
    });

    document.getElementById('preset-name').value = preset.name;
    document.getElementById('master-volume').value = preset.masterVolume;
    document.getElementById('master-volume-val').textContent = preset.masterVolume.toFixed(2);

    renderUI();
    updateCode();
      // Save the loaded preset
}
// Load WASM Module
async function loadWASMModule() {
    if (rs1Synth && rs1Synth.Module) {
        return;
    }

    // Create audioContext if needed (for sample rate)
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    // Fetch JS code and WASM binary (force no cache)
    const [jsResponse, wasmResponse] = await Promise.all([
        fetch('../rfxsynths/rgresonate1-synth.js', { cache: 'no-store' }),
        fetch('../rfxsynths/rgresonate1-synth.wasm', { cache: 'no-store' })
    ]);

    const moduleCode = await jsResponse.text();
    const wasmBytes = await wasmResponse.arrayBuffer();

    // Patch code to capture wasmMemory
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

    // Create synth instance with correct sample rate (engine_id=0, sample_rate)
    const synthPtr = Module._regroove_synth_create(0, audioContext.sampleRate);

    if (!synthPtr) {
        throw new Error('Failed to create RS1 synth instance');
    }

    rs1Synth = {
        Module: Module,
        instance: synthPtr,
        memory: wasmMemory
    };
}

// Upload preset to WASM synth
function uploadPresetToSynth() {
    if (!rs1Synth) return;

    const M = rs1Synth.Module;
    const inst = rs1Synth.instance;

    // Clear bank and create chromatic preset
    M._regroove_synth_bank_clear();
    M._regroove_synth_bank_add_preset(0);  // Chromatic (fixed_note=0)
    M._regroove_synth_bank_select_preset(0);

    // Set global preset parameters
    // Convert JavaScript string to C string
    const encoder = new TextEncoder();
    const nameBytes = encoder.encode(preset.name + '\0');
    const namePtr = M._malloc(nameBytes.length);
    const nameHeap = new Uint8Array(rs1Synth.memory.buffer, namePtr, nameBytes.length);
    nameHeap.set(nameBytes);
    M._regroove_synth_preset_set_name(namePtr);
    M._free(namePtr);

    M._regroove_synth_preset_set_master_volume(preset.masterVolume);

    // Map operator type names to enum values
    const opTypeMap = {
        'RSX_OP_SINE': 0,
        'RSX_OP_SAW': 1,
        'RSX_OP_SQUARE': 2,
        'RSX_OP_TRIANGLE': 3,
        'RSX_OP_NOISE': 4,
        'RSX_OP_FILTER_LP': 5,
        'RSX_OP_FILTER_HP': 6,
        'RSX_OP_RESONATOR': 7
    };

    const mixModeMap = {
        'RSX_MIX_ADD': 0,
        'RSX_MIX_MUL': 1
    };

    // Add operators
    operators.forEach((op, idx) => {
        const opTypeValue = opTypeMap[op.type] || 0;
        M._regroove_synth_preset_add_operator(opTypeValue);

        // Timing
        M._regroove_synth_preset_set_operator_timing(idx, op.startTime, op.duration);

        // Pitch
        const opType = opTypes.find(t => t.id === op.type);
        if (opType && opType.hasFreq) {
            M._regroove_synth_preset_set_operator_pitch(idx, op.frequency, op.fixedPitch ? 1 : 0);
        }

        // Level
        M._regroove_synth_preset_set_operator_level(idx, op.level);

        // Envelope
        M._regroove_synth_preset_set_operator_envelope(idx,
            op.envelope.attack, op.envelope.decay,
            op.envelope.sustain, op.envelope.release);

        // Type-specific params
        if (opType && opType.hasParams) {
            if (opType.param === 'pulse_width') {
                M._regroove_synth_preset_set_operator_pulse_width(idx, op.params.pulseWidth);
            } else if (opType.param === 'filter') {
                M._regroove_synth_preset_set_operator_filter(idx,
                    op.params.filterCutoff, op.params.filterResonance);
            } else if (opType.param === 'resonator') {
                M._regroove_synth_preset_set_operator_resonator(idx,
                    op.params.resonatorResonance, op.params.resonatorBandwidth);
            }
        }

        // Routing
        const mixModeValue = mixModeMap[op.mixMode] || 0;
        M._regroove_synth_preset_set_operator_routing(idx, op.inputOp, mixModeValue);
    });

    // Apply preset to synth
    M._regroove_synth_bank_apply(inst);
}

// Audio preview
async function playPreview() {
    try {
        // Stop any existing scroll animation
        if (waveformScrollInterval) {
            clearInterval(waveformScrollInterval);
            waveformScrollInterval = null;
        }

        // Load WASM module if needed (will create audioContext)
        await loadWASMModule();

        const M = rs1Synth.Module;
        const inst = rs1Synth.instance;
        const sampleRate = audioContext.sampleRate;

        // Stop all voices BEFORE uploading preset
        M._regroove_synth_all_notes_off(inst);

        // Drain voices
        const drainBuf = M._malloc(128 * 2 * 4);
        for (let i = 0; i < 50; i++) {
            M._regroove_synth_process_f32(inst, drainBuf, 128, sampleRate);
        }
        M._free(drainBuf);

        // Upload preset AFTER draining
        uploadPresetToSynth();

        // Reset synth to clear any residual state
        M._regroove_synth_reset(inst);

        // Duration: 2 seconds
        const duration = 2.0;
        const numSamples = Math.floor(sampleRate * duration);

        // Trigger note (C4 = MIDI 60)
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
            const chunkHeap = new Float32Array(rs1Synth.memory.buffer, chunkBufferPtr, chunkSize * 2);
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

        // Store waveform data
        currentWaveformData = {
            data: channelData,
            numSamples: numSamples,
            sampleRate: sampleRate
        };

        // Play
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);

        // Setup scrolling waveform visualization
        const windowSamples = sampleRate * 0.1; // 100ms window
        let scrollPosition = 0;
        let isPlaying = true;

        const drawWaveformWindow = (scrollPosition) => {
            const vizData = new Uint8Array(800);
            const startSample = Math.floor(scrollPosition);
            const endSample = Math.min(startSample + windowSamples, numSamples);

            for (let i = 0; i < 800; i++) {
                const idx = startSample + Math.floor((i / 800) * (endSample - startSample));
                if (idx < numSamples) {
                    vizData[i] = Math.floor((channelData[idx] + 1) * 128);
                } else {
                    vizData[i] = 128;
                }
            }
            drawWaveform(vizData);
        };

        const updateWaveform = () => {
            if (!isPlaying) return;

            drawWaveformWindow(scrollPosition);

            // Move window forward
            scrollPosition += (sampleRate / 60);

            // Update scrollbar
            const scrollbar = document.getElementById('waveform-scroll');
            if (scrollbar) {
                scrollbar.value = (scrollPosition / numSamples) * 100;
            }

            // Stop at end
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

        // Start scrolling
        waveformScrollInterval = setInterval(updateWaveform, 1000 / 60);

        // Setup manual scrubbing
        const scrollbar = document.getElementById('waveform-scroll');
        if (scrollbar) {
            scrollbar.oninput = (e) => {
                if (!isPlaying && currentWaveformData) {
                    const position = (parseFloat(e.target.value) / 100) * currentWaveformData.numSamples;
                    drawWaveformWindow(position);
                }
            };
        }

        source.onended = () => {
            isPlaying = false;
            if (waveformScrollInterval) {
                clearInterval(waveformScrollInterval);
                waveformScrollInterval = null;
            }
            // Reset to start position
            const scrollbar = document.getElementById('waveform-scroll');
            if (scrollbar) {
                scrollbar.value = 0;
                drawWaveformWindow(0);
            }
        };

        source.start();

    } catch (error) {
        console.error('Preview error:', error);
        showNotification('Error playing preview: ' + error.message);
    }
}

// Draw waveform window (Uint8Array format like ahxconstruct)
function drawWaveform(dataArray) {
    const bufferLength = dataArray.length;
    const width = canvas.width;
    const height = canvas.height;

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
        const y = (height / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }

    // Waveform - REGROOVE RED
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#CF1A37';
    ctx.beginPath();

    const sliceWidth = width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * height / 2;

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }

        x += sliceWidth;
    }

    ctx.stroke();

    // Center line
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
}
