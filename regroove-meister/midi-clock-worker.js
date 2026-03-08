// MIDI Clock Worker - Runs timing loop in separate thread
// This prevents UI rendering from blocking the clock!

let clockInterval = null;
let pulseCount = 0;
let isRunning = false;
let currentBPM = 120;
let currentInterval = 0;

self.onmessage = function(e) {
    const { cmd, bpm } = e.data;

    if (cmd === 'start') {
        if (isRunning) {
            self.postMessage({ type: 'error', message: 'Clock already running' });
            return;
        }

        startClock(bpm);
    } else if (cmd === 'stop') {
        stopClock();
    } else if (cmd === 'setBPM') {
        // Update BPM dynamically without stopping
        if (isRunning) {
            updateBPM(bpm);
        }
    }
};

function startClock(bpm) {
    const PULSES_PER_QUARTER_NOTE = 24;
    const msPerBeat = 60000 / bpm;
    currentInterval = msPerBeat / PULSES_PER_QUARTER_NOTE;
    currentBPM = bpm;

    self.postMessage({
        type: 'started',
        bpm: bpm,
        interval: currentInterval.toFixed(2)
    });

    isRunning = true;
    pulseCount = 0;
    let nextPulseTime = performance.now();

    const clockTick = () => {
        if (!isRunning) return;

        pulseCount++;

        // Tell main thread to send MIDI pulse
        self.postMessage({
            type: 'pulse',
            count: pulseCount
        });

        // Schedule next pulse with drift compensation (uses currentInterval for dynamic BPM)
        nextPulseTime += currentInterval;
        const delay = Math.max(0, nextPulseTime - performance.now());

        clockInterval = setTimeout(clockTick, delay);
    };

    // Start immediately
    clockInterval = setTimeout(clockTick, 0);
}

function updateBPM(bpm) {
    if (!isRunning) return;

    const PULSES_PER_QUARTER_NOTE = 24;
    const msPerBeat = 60000 / bpm;
    currentInterval = msPerBeat / PULSES_PER_QUARTER_NOTE;
    currentBPM = bpm;

    self.postMessage({
        type: 'bpmChanged',
        bpm: bpm,
        interval: currentInterval.toFixed(2)
    });
}

function stopClock() {
    if (clockInterval) {
        clearTimeout(clockInterval);
        clockInterval = null;
    }
    isRunning = false;

    self.postMessage({
        type: 'stopped',
        totalPulses: pulseCount
    });
}
