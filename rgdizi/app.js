let audioContext;
let synthNode;
let gainNode;

// Computer keyboard state
let keyboardEnabled = false;
let currentOctave = 5;
const activeComputerKeys = new Set();
window.flutterActive = false;
window.vibratoActive = false;

// Piano keyboard
let pianoKeyboard = null;

// MIDI state
let midiAccess = null;
let selectedMidiInput = null;

const keyboardMap = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
};

async function init() {
  audioContext = new AudioContext({ sampleRate: 48000 });
  document.getElementById("status").innerHTML =
    '<span style="color: orange;">⏳ Loading...</span>';

  try {
    await audioContext.audioWorklet.addModule("../replugged/worklets/dizi-worklet.js");

    synthNode = new AudioWorkletNode(audioContext, "dizi-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    synthNode.port.onmessage = (e) => {
      if (e.data.type === "needWasm") {
        fetch("../rfxsynths/rgdizi-synth.wasm")
          .then((r) => r.arrayBuffer())
          .then((wasmBytes) => {
            fetch("../rfxsynths/rgdizi-synth.js")
              .then((r) => r.text())
              .then((jsCode) => {
                synthNode.port.postMessage({
                  type: "wasmData",
                  data: {
                    jsCode,
                    wasmBytes,
                    sampleRate: audioContext.sampleRate,
                  },
                });
              });
          });
      } else if (e.data.type === "ready") {
        document.getElementById("status").innerHTML =
          '<span style="color: #0f0;">✅ Ready! Play notes</span>';
        updateNoise();
        updateDamping();
        updateJetRefl();
        updateEndRefl();
        updateDimoIntensity();
        updateDimoFreq();
        updateFlutter();
        updateVibrato();
        updatePitchBendFromSlider(64); // Initialize pitch bend at center
        updateEnvelope();
      } else if (e.data.type === "error") {
        document.getElementById("status").innerHTML =
          '<span style="color: red;">❌ Error: ' + e.data.error + "</span>";
      }
    };

    gainNode = audioContext.createGain();
    gainNode.gain.value = 1.0;

    synthNode.connect(gainNode);
    gainNode.connect(audioContext.destination);

    initPianoKeyboard();
  } catch (err) {
    document.getElementById("status").innerHTML =
      '<span style="color: red;">❌ Failed: ' + err.message + "</span>";
  }
}

// Parameter updates
function updateNoise() {
  const value = parseFloat(document.getElementById("noise-gain").value);
  document.getElementById("val-noise").textContent = value.toFixed(2);
  if (synthNode)
    synthNode.port.postMessage({ type: "setNoiseLevel", data: { value } });
}

function updateDamping() {
  const value = parseFloat(document.getElementById("damping").value);
  document.getElementById("val-damping").textContent = value.toFixed(2);
  if (synthNode)
    synthNode.port.postMessage({ type: "setDamping", data: { value } });
}

function updateJetRefl() {
  const value = parseFloat(document.getElementById("jet-refl").value);
  document.getElementById("val-jet-refl").textContent = value.toFixed(2);
  if (synthNode)
    synthNode.port.postMessage({ type: "setJetReflection", data: { value } });
}

function updateEndRefl() {
  const value = parseFloat(document.getElementById("end-refl").value);
  document.getElementById("val-end-refl").textContent = value.toFixed(2);
  if (synthNode)
    synthNode.port.postMessage({ type: "setEndReflection", data: { value } });
}

function updateDimoIntensity() {
  const value = parseFloat(document.getElementById("dimo-intensity").value);
  document.getElementById("val-dimo-intensity").textContent = value.toFixed(1);
  if (synthNode)
    synthNode.port.postMessage({ type: "setDimoIntensity", data: { value } });
}

function updateDimoFreq() {
  const value = parseFloat(document.getElementById("dimo-freq").value);
  document.getElementById("val-dimo-freq").textContent =
    value.toFixed(0) + " Hz";
  if (synthNode)
    synthNode.port.postMessage({ type: "setDimoFrequency", data: { value } });
}

function updateFlutter() {
  const depth = parseFloat(document.getElementById("flutter-depth").value);
  const rate = parseFloat(document.getElementById("flutter-rate").value);
  document.getElementById("val-flutter-depth").textContent = depth.toFixed(2);
  document.getElementById("val-flutter-rate").textContent =
    rate.toFixed(0) + " Hz";
  if (synthNode)
    synthNode.port.postMessage({ type: "setFlutter", data: { rate, depth } });
}

function updateVibrato() {
  const depth = parseFloat(document.getElementById("vibrato-depth").value);
  const rate = parseFloat(document.getElementById("vibrato-rate").value);
  document.getElementById("val-vibrato-depth").textContent =
    depth.toFixed(0) + " cents";
  document.getElementById("val-vibrato-rate").textContent =
    rate.toFixed(1) + " Hz";
  if (synthNode)
    synthNode.port.postMessage({ type: "setVibrato", data: { rate, depth } });
}

function updatePitchBendFromSlider(sliderValue) {
  // Convert 0-127 slider to -2 to +2 semitones (64 = center/0)
  const semitones = ((sliderValue - 64) / 64) * 2.0;
  document.getElementById("pitchBendValue").textContent = semitones.toFixed(2);
  if (synthNode)
    synthNode.port.postMessage({ type: "setPitchBend", data: { value: semitones } });
}

function resetPitchBend() {
  const slider = document.getElementById("pitchBendSlider");
  if (slider) {
    slider.value = 64;
    updatePitchBendFromSlider(64);
  }
}

function updateEnvelope() {
  const attack = parseFloat(document.getElementById("env-attack").value);
  const decay = parseFloat(document.getElementById("env-decay").value);
  const sustain = parseFloat(document.getElementById("env-sustain").value);
  const release = parseFloat(document.getElementById("env-release").value);

  // Format display values
  document.getElementById("val-attack").textContent =
    attack < 1 ? (attack * 1000).toFixed(0) + " ms" : attack.toFixed(2) + " s";
  document.getElementById("val-decay").textContent =
    decay < 1 ? (decay * 1000).toFixed(0) + " ms" : decay.toFixed(2) + " s";
  document.getElementById("val-sustain").textContent =
    (sustain * 100).toFixed(0) + "%";
  document.getElementById("val-release").textContent =
    release < 1
      ? (release * 1000).toFixed(0) + " ms"
      : release.toFixed(2) + " s";

  if (synthNode) {
    synthNode.port.postMessage({ type: "setAttack", data: { value: attack } });
    synthNode.port.postMessage({ type: "setDecay", data: { value: decay } });
    synthNode.port.postMessage({
      type: "setSustain",
      data: { value: sustain },
    });
    synthNode.port.postMessage({
      type: "setRelease",
      data: { value: release },
    });
  }
}

// Virtual keyboard
function initPianoKeyboard() {
  pianoKeyboard = new PianoKeyboard("pianoKeyboard", {
    octaves: 3,
    baseOctave: currentOctave,
    showLabels: true,
  });

  // Handle note on
  pianoKeyboard.addEventListener("noteon", (e) => {
    if (synthNode) {
      synthNode.port.postMessage({
        type: "noteOn",
        data: { note: e.detail.note, velocity: e.detail.velocity },
      });
      updateLastNote(e.detail.note);
    }
  });

  // Handle note off
  pianoKeyboard.addEventListener("noteoff", (e) => {
    if (synthNode) {
      synthNode.port.postMessage({
        type: "noteOff",
        data: { note: e.detail.note },
      });
    }
  });

  updateOctaveDisplay();
}

function updateOctaveDisplay() {
  const octaveNum = currentOctave;
  const noteName = "C" + octaveNum;
  document.getElementById("octaveDisplay").textContent = noteName;
}

function updateLastNote(note) {
  const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(note / 12) - 1;
  const noteName = noteNames[note % 12];
  document.getElementById("lastNote").textContent = `${noteName}${octave} (${note})`;
}

// Computer keyboard input
function setupKeyboardInput() {
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    const key = e.key.toLowerCase();

    // Flutter (R or Space)
    if ((key === "r" || key === " ") && !e.repeat && synthNode) {
      if (!window.flutterActive) {
        window.flutterActive = true;
        const depth = parseFloat(
          document.getElementById("flutter-depth").value,
        );
        const rate = parseFloat(document.getElementById("flutter-rate").value);
        synthNode.port.postMessage({
          type: "setFlutter",
          data: { rate, depth: Math.max(0.6, depth) },
        });
      }
      e.preventDefault();
      return;
    }

    // Vibrato (V key)
    if (key === "v" && !e.repeat && synthNode) {
      if (!window.vibratoActive) {
        window.vibratoActive = true;
        const depth = parseFloat(
          document.getElementById("vibrato-depth").value,
        );
        const rate = parseFloat(document.getElementById("vibrato-rate").value);
        synthNode.port.postMessage({
          type: "setVibrato",
          data: { rate, depth: Math.max(20, depth) },
        });
      }
      e.preventDefault();
      return;
    }

    if (!keyboardEnabled || !synthNode) return;
    if (e.repeat) return;

    // Octave controls
    if (key === "z" && currentOctave > 0) {
      currentOctave--;
      if (pianoKeyboard) pianoKeyboard.setBaseOctave(currentOctave);
      updateOctaveDisplay();
      return;
    }
    if (key === "x" && currentOctave < 8) {
      currentOctave++;
      if (pianoKeyboard) pianoKeyboard.setBaseOctave(currentOctave);
      updateOctaveDisplay();
      return;
    }

    if (keyboardMap.hasOwnProperty(key)) {
      const offset = keyboardMap[key];
      const midiNote = currentOctave * 12 + offset;
      if (
        midiNote >= 0 &&
        midiNote <= 127 &&
        !activeComputerKeys.has(midiNote)
      ) {
        synthNode.port.postMessage({
          type: "noteOn",
          data: { note: midiNote, velocity: 100 },
        });
        activeComputerKeys.add(midiNote);
        updateLastNote(midiNote);
      }
    }
  });

  document.addEventListener("keyup", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    const key = e.key.toLowerCase();

    // Flutter release
    if ((key === "r" || key === " ") && window.flutterActive && synthNode) {
      window.flutterActive = false;
      const rate = parseFloat(document.getElementById("flutter-rate").value);
      synthNode.port.postMessage({
        type: "setFlutter",
        data: { rate, depth: 0.0 },
      });
      return;
    }

    // Vibrato release
    if (key === "v" && window.vibratoActive && synthNode) {
      window.vibratoActive = false;
      const rate = parseFloat(document.getElementById("vibrato-rate").value);
      synthNode.port.postMessage({
        type: "setVibrato",
        data: { rate, depth: 0.0 },
      });
      return;
    }

    if (!keyboardEnabled) return;

    if (keyboardMap.hasOwnProperty(key)) {
      const offset = keyboardMap[key];
      const midiNote = currentOctave * 12 + offset;
      if (activeComputerKeys.has(midiNote)) {
        synthNode.port.postMessage({
          type: "noteOff",
          data: { note: midiNote },
        });
        activeComputerKeys.delete(midiNote);
      }
    }
  });
}

// Keyboard toggle
document.getElementById("keyboard-toggle").addEventListener("click", () => {
  keyboardEnabled = !keyboardEnabled;
  const btn = document.getElementById("keyboard-toggle");
  if (keyboardEnabled) {
    btn.classList.add("active");
  } else {
    btn.classList.remove("active");
    activeComputerKeys.forEach((note) => {
      synthNode.port.postMessage({ type: "noteOff", data: { note } });
    });
    activeComputerKeys.clear();
  }
});

document.getElementById("octaveDown").addEventListener("click", () => {
  if (currentOctave > 0) {
    currentOctave--;
    if (pianoKeyboard) pianoKeyboard.setBaseOctave(currentOctave);
    updateOctaveDisplay();
  }
});

document.getElementById("octaveUp").addEventListener("click", () => {
  if (currentOctave < 8) {
    currentOctave++;
    if (pianoKeyboard) pianoKeyboard.setBaseOctave(currentOctave);
    updateOctaveDisplay();
  }
});

// Fullscreen keyboard
document.getElementById("btnKeyboardFullscreen").addEventListener("click", () => {
  const container = document.getElementById("keyboardContainer");
  if (container.requestFullscreen) {
    container.requestFullscreen();
  } else if (container.webkitRequestFullscreen) {
    container.webkitRequestFullscreen();
  } else if (container.mozRequestFullScreen) {
    container.mozRequestFullScreen();
  }
});

// Exit fullscreen when clicking the X button (::after pseudo-element)
document.getElementById("keyboardContainer").addEventListener("click", (e) => {
  const container = document.getElementById("keyboardContainer");
  if (document.fullscreenElement === container) {
    // Check if click is in the top-right corner area (where X button is)
    const rect = container.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // X button is at top: 10px, right: 10px, size: 32x32
    if (clickX >= rect.width - 42 && clickX <= rect.width - 10 &&
        clickY >= 10 && clickY <= 42) {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
      }
    }
  }
});

// Vibrato button (toggle)
const vibratoBtn = document.getElementById("btn-vibrato");

const activateVibrato = () => {
  if (!window.vibratoActive && synthNode) {
    window.vibratoActive = true;
    const depth = parseFloat(document.getElementById("vibrato-depth").value);
    const rate = parseFloat(document.getElementById("vibrato-rate").value);
    synthNode.port.postMessage({
      type: "setVibrato",
      data: { rate, depth: Math.max(20, depth) },
    });
    vibratoBtn.classList.add("active");
  }
};

const deactivateVibrato = () => {
  if (window.vibratoActive && synthNode) {
    window.vibratoActive = false;
    const rate = parseFloat(document.getElementById("vibrato-rate").value);
    synthNode.port.postMessage({
      type: "setVibrato",
      data: { rate, depth: 0.0 },
    });
    vibratoBtn.classList.remove("active");
  }
};

vibratoBtn.addEventListener("mousedown", activateVibrato);
vibratoBtn.addEventListener("mouseup", deactivateVibrato);
vibratoBtn.addEventListener("mouseleave", deactivateVibrato);
vibratoBtn.addEventListener("touchstart", (e) => { e.preventDefault(); activateVibrato(); });
vibratoBtn.addEventListener("touchend", (e) => { e.preventDefault(); deactivateVibrato(); });

// Flutter button (toggle)
const flutterBtn = document.getElementById("btn-flutter");

const activateFlutter = () => {
  if (!window.flutterActive && synthNode) {
    window.flutterActive = true;
    const depth = parseFloat(document.getElementById("flutter-depth").value);
    const rate = parseFloat(document.getElementById("flutter-rate").value);
    synthNode.port.postMessage({
      type: "setFlutter",
      data: { rate, depth: Math.max(0.6, depth) },
    });
    flutterBtn.classList.add("active");
  }
};

const deactivateFlutter = () => {
  if (window.flutterActive && synthNode) {
    window.flutterActive = false;
    const rate = parseFloat(document.getElementById("flutter-rate").value);
    synthNode.port.postMessage({
      type: "setFlutter",
      data: { rate, depth: 0.0 },
    });
    flutterBtn.classList.remove("active");
  }
};

flutterBtn.addEventListener("mousedown", activateFlutter);
flutterBtn.addEventListener("mouseup", deactivateFlutter);
flutterBtn.addEventListener("mouseleave", deactivateFlutter);
flutterBtn.addEventListener("touchstart", (e) => { e.preventDefault(); activateFlutter(); });
flutterBtn.addEventListener("touchend", (e) => { e.preventDefault(); deactivateFlutter(); });

// Collapsible sections
document.getElementById("dimoToggle").addEventListener("click", function () {
  const panel = document.getElementById("dimoPanel");
  if (panel.style.display === "none") {
    panel.style.display = "block";
    this.textContent = "▼";
  } else {
    panel.style.display = "none";
    this.textContent = "▶";
  }
});

document
  .getElementById("advancedToggle")
  .addEventListener("click", function () {
    const panel = document.getElementById("advancedPanel");
    if (panel.style.display === "none") {
      panel.style.display = "block";
      this.textContent = "▼";
    } else {
      panel.style.display = "none";
      this.textContent = "▶";
    }
  });

document
  .getElementById("keyboardToggle")
  .addEventListener("click", function () {
    const panel = document.getElementById("keyboardPanel");
    if (panel.style.display === "none") {
      panel.style.display = "block";
      this.textContent = "▼";
    } else {
      panel.style.display = "none";
      this.textContent = "▶";
    }
  });

// MIDI setup
function setupMIDI() {
  if (navigator.requestMIDIAccess) {
    navigator.requestMIDIAccess().then(onMIDISuccess, onMIDIFailure);
  }
}

function onMIDISuccess(access) {
  midiAccess = access;
  const midiSelect = document.getElementById("midiInput");

  // Populate MIDI input list
  for (let input of midiAccess.inputs.values()) {
    const option = document.createElement("option");
    option.value = input.id;
    option.textContent = input.name;
    midiSelect.appendChild(option);
  }

  // Listen for MIDI input selection
  midiSelect.addEventListener("change", (e) => {
    if (selectedMidiInput) {
      selectedMidiInput.onmidimessage = null;
    }
    if (e.target.value) {
      selectedMidiInput = midiAccess.inputs.get(e.target.value);
      selectedMidiInput.onmidimessage = onMIDIMessage;
      document.getElementById("midiStatus").textContent =
        `Connected: ${selectedMidiInput.name}`;
      document.getElementById("midiStatus").style.color = "#0f0";
    } else {
      selectedMidiInput = null;
      document.getElementById("midiStatus").textContent = "Not Connected";
      document.getElementById("midiStatus").style.color = "";
    }
  });

  console.log("MIDI ready!");
}

function onMIDIFailure() {
  console.log("Could not access MIDI devices.");
}

function onMIDIMessage(message) {
  if (!synthNode) return;

  const [status, data1, data2] = message.data;
  const command = status & 0xf0;

  // Note On
  if (command === 0x90 && data2 > 0) {
    synthNode.port.postMessage({
      type: "noteOn",
      data: { note: data1, velocity: data2 },
    });
    updateLastNote(data1);
  }
  // Note Off
  else if (command === 0x80 || (command === 0x90 && data2 === 0)) {
    synthNode.port.postMessage({ type: "noteOff", data: { note: data1 } });
  }
  // Pitch Bend
  else if (command === 0xe0) {
    const pitchBendValue = (data2 << 7) | data1;
    const semitones = ((pitchBendValue - 8192) / 8192) * 2.0;
    synthNode.port.postMessage({
      type: "setPitchBend",
      data: { value: semitones },
    });
    // Update slider (convert semitones back to 0-127 range)
    const sliderValue = ((semitones / 2.0) * 64) + 64;
    const pitchBendSlider = document.getElementById("pitchBendSlider");
    if (pitchBendSlider) {
      pitchBendSlider.value = sliderValue;
    }
    document.getElementById("pitchBendValue").textContent = semitones.toFixed(2);
  }
  // CC 1 (Mod Wheel) - vibrato depth
  else if (command === 0xb0 && data1 === 1) {
    const depth = (data2 / 127) * 50;
    synthNode.port.postMessage({
      type: "setVibrato",
      data: {
        rate: parseFloat(document.getElementById("vibrato-rate").value),
        depth: depth,
      },
    });
    document.getElementById("vibrato-depth").value = depth;
    document.getElementById("val-vibrato-depth").textContent =
      depth.toFixed(0) + " cents";
  }
}

// Attach event listeners for all controls
function setupControlListeners() {
  // Envelope controls
  document.getElementById("env-attack").addEventListener("input", updateEnvelope);
  document.getElementById("env-decay").addEventListener("input", updateEnvelope);
  document.getElementById("env-sustain").addEventListener("input", updateEnvelope);
  document.getElementById("env-release").addEventListener("input", updateEnvelope);

  // Performance controls
  document.getElementById("vibrato-depth").addEventListener("input", updateVibrato);
  document.getElementById("vibrato-rate").addEventListener("input", updateVibrato);
  document.getElementById("flutter-depth").addEventListener("input", updateFlutter);
  document.getElementById("flutter-rate").addEventListener("input", updateFlutter);

  // Dimo controls
  document.getElementById("dimo-intensity").addEventListener("input", updateDimoIntensity);
  document.getElementById("dimo-freq").addEventListener("input", updateDimoFreq);

  // Advanced controls
  document.getElementById("noise-gain").addEventListener("input", updateNoise);
  document.getElementById("damping").addEventListener("input", updateDamping);
  document.getElementById("jet-refl").addEventListener("input", updateJetRefl);
  document.getElementById("end-refl").addEventListener("input", updateEndRefl);

  // Pitch bend slider (svg-slider component)
  const pitchBendSlider = document.getElementById("pitchBendSlider");
  if (pitchBendSlider) {
    pitchBendSlider.addEventListener("change", (e) => {
      updatePitchBendFromSlider(e.detail.value);
    });
    pitchBendSlider.addEventListener("dblclick", resetPitchBend);
  }
}

// Initialize
window.addEventListener("load", () => {
  setupControlListeners();
  setupKeyboardInput();
  setupMIDI();
  document.body.addEventListener(
    "click",
    () => {
      if (!audioContext) init();
    },
    { once: true },
  );
});
