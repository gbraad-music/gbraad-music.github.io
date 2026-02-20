import { wakeLockManager } from './external/wakelock.js';

let audioContext;
let midiManager;
let webrtcMidi = null;
let currentSynth = null;
let drumSynth = null;
let ahxDrumSynth = null;
let slicerSynth = null;
let sfzPlayer = null;
let sharedAnalyzer = null;
let masterGainNode = null;
let isAudible = true;
let keyboardOctave = 3; // C3 default
let keyboardChannel = 0; // Channel 1 (synth) default
let activeKeys = new Set();
let pianoKeyboard = null;

// UI elements
const midiInput = document.getElementById("midiInput");
const midiStatus = document.getElementById("midiStatus");
const synthStatus = document.getElementById("synthStatus");
const freqVizCanvas = document.getElementById("freq-viz");
const waveformCanvas = document.getElementById("waveform");
const spectrumCanvas = document.getElementById("spectrum");

// Visualization components
let freqBarsComponent = null;

// Initialize
async function init() {
  // Create AudioContext
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  console.log(
    "[Synth Test] AudioContext created:",
    audioContext.sampleRate,
    "Hz",
  );

  // Create master gain node for volume control
  masterGainNode = audioContext.createGain();
  masterGainNode.gain.value = 1.0;
  masterGainNode.connect(audioContext.destination);

  // Initialize MIDI
  midiManager = new MIDIManager();
  const success = await midiManager.initialize();

  if (success) {
    updateMIDIInputList();
    midiStatus.innerHTML = "MIDI: <span>Ready</span>";
  } else {
    midiStatus.innerHTML =
      'MIDI: <span style="color: #ff3333;">Not Available</span>';
  }

  // MIDI input selection
  midiInput.addEventListener("change", (e) => {
    if (e.target.value) {
      midiManager.connectInput(e.target.value);
      midiStatus.innerHTML = 'MIDI: <span class="connected">Connected</span>';
      midiStatus.classList.add("connected");
    }
  });

  // WebRTC MIDI buttons
  document
    .getElementById("webrtcBtn")
    .addEventListener("click", toggleWebRTCConfig);
  document
    .getElementById("btnGenerateAnswer")
    .addEventListener("click", generateWebRTCAnswer);
  document
    .getElementById("btnCopyAnswer")
    .addEventListener("click", copyAnswerToClipboard);
  document
    .getElementById("btnDisconnectWebRTC")
    .addEventListener("click", disconnectWebRTCMIDI);

  // Setup MIDI handlers (always listen to MIDI manager)
  setupMIDIHandlers();

  // Initialize synth engines
  document
    .getElementById("btnInitSimple")
    .addEventListener("click", () => initializeSynth("simple"));
  document
    .getElementById("btnInitRGResonate1")
    .addEventListener("click", () => initializeSynth("rgresonate1"));
  document
    .getElementById("btnInitRGAHX")
    .addEventListener("click", () => initializeSynth("rgahx"));
  document
    .getElementById("btnInitRGSID")
    .addEventListener("click", () => initializeSynth("rgsid"));
  document
    .getElementById("btnInitRG1Piano")
    .addEventListener("click", () => initializeSynth("rg1piano"));
  document
    .getElementById("btnInitRGSFZ")
    .addEventListener("click", initializeRGSFZ);
  document
    .getElementById("btnInitRGSlicer")
    .addEventListener("click", initializeRGSlicer);

  // Initialize drum
  document
    .getElementById("btnInitDrum")
    .addEventListener("click", initializeDrum);
  document
    .getElementById("btnInitAHXDrum")
    .addEventListener("click", initializeAHXDrum);

  // Render drums
  document
    .getElementById("btnRenderDrums")
    .addEventListener("click", renderAllDrums);

  // RGAHX parameter controls (now auto-generated, no setup needed!)
  // setupRGAHXControls(); // OLD - manual controls

  // RGSID parameter controls (now auto-generated, no setup needed!)
  // setupRGSIDControls(); // OLD - manual controls

  // Drum pads with multi-touch support
  document.querySelectorAll(".drum-pad").forEach((pad) => {
    let isPressed = false;
    let activeTouches = new Set();

    const handlePress = (e) => {
      e.preventDefault();
      const note = parseInt(pad.dataset.note);
      
      if (e.type === 'touchstart') {
        // Track each touch independently for multi-touch
        for (let i = 0; i < e.changedTouches.length; i++) {
          const touch = e.changedTouches[i];
          if (!activeTouches.has(touch.identifier)) {
            activeTouches.add(touch.identifier);
            if (activeTouches.size === 1) {
              triggerDrum(note);
              pad.classList.add("active");
            }
          }
        }
      } else {
        // Mouse event
        if (!isPressed) {
          isPressed = true;
          triggerDrum(note);
          pad.classList.add("active");
        }
      }
    };

    const handleRelease = (e) => {
      e.preventDefault();
      
      if (e.type === 'touchend' || e.type === 'touchcancel') {
        // Remove touches that ended
        for (let i = 0; i < e.changedTouches.length; i++) {
          const touch = e.changedTouches[i];
          activeTouches.delete(touch.identifier);
        }
        // Only deactivate visual when all touches are gone
        if (activeTouches.size === 0) {
          pad.classList.remove("active");
        }
      } else {
        // Mouse event
        isPressed = false;
        pad.classList.remove("active");
      }
    };

    pad.addEventListener("mousedown", handlePress);
    pad.addEventListener("mouseup", handleRelease);
    pad.addEventListener("mouseleave", handleRelease);
    pad.addEventListener("touchstart", handlePress, { passive: false });
    pad.addEventListener("touchend", handleRelease, { passive: false });
    pad.addEventListener("touchcancel", handleRelease, { passive: false });
  });

  // On-screen keyboard
  document
    .getElementById("keyboardToggle")
    .addEventListener("click", toggleKeyboard);
  document
    .getElementById("octaveDown")
    .addEventListener("click", () => changeOctave(-1));
  document
    .getElementById("octaveUp")
    .addEventListener("click", () => changeOctave(1));
  document.getElementById("keyboardChannel").addEventListener("change", (e) => {
    keyboardChannel = parseInt(e.target.value);
    console.log("[Keyboard] Channel changed to:", keyboardChannel + 1);

    // Auto-adjust octave for drum channel (channel 10 = drums on C1-D2)
    if (keyboardChannel === 9) {
      // Channel 10 (drums) - set to C1 octave for drum notes 36-50
      keyboardOctave = 1;
      document.getElementById("octaveDisplay").textContent = "C1";
      buildKeyboard();
      console.log("[Keyboard] Auto-adjusted to C1 octave for drums");
    } else if (keyboardOctave === 1) {
      // Switching away from drums - restore to C3
      keyboardOctave = 3;
      document.getElementById("octaveDisplay").textContent = "C3";
      buildKeyboard();
      console.log("[Keyboard] Restored to C3 octave for synth");
    }
  });

  // Build keyboard
  buildKeyboard();

  // Request wake lock to keep screen on during performance
  await wakeLockManager.request();
  console.log("[Synth Test] Wake lock requested for performance mode");

  // Start visualization
  requestAnimationFrame(visualize);
}

function updateMIDIInputList() {
  const inputs = midiManager.getInputs();
  midiInput.innerHTML = '<option value="">Select MIDI Input...</option>';
  inputs.forEach((input) => {
    const option = document.createElement("option");
    option.value = input.id;
    option.textContent = input.name;
    midiInput.appendChild(option);
  });
}

async function initializeSynth(engine) {
  // Resume AudioContext if needed
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  // Destroy existing synth
  if (currentSynth) {
    currentSynth.destroy();
    currentSynth = null;
  }

  // Create shared analyzer if not exists
  if (!sharedAnalyzer) {
    sharedAnalyzer = new FrequencyAnalyzer(audioContext, {
      fftSize: 8192,
      smoothing: 0.8,
      updateRate: 50,
      sourceName: "midi-synth",
      enableDecay: true,
    });
    sharedAnalyzer.start();
    console.log("[Synth Test] Created shared frequency analyzer");

    // Listen to frequency events
    sharedAnalyzer.on("*", (event) => {
      if (event.type === "frequency" && event.data && event.data.bands) {
        updateFrequencyBars(event.data.bands);
      }
    });
  }

  // Create synth based on engine parameter
  if (engine === "rgresonate1") {
    currentSynth = new RGResonate1Synth(audioContext);
  } else if (engine === "rgahx") {
    currentSynth = new RGAHXSynth(audioContext);
  } else if (engine === "rgsid") {
    currentSynth = new RGSIDSynth(audioContext);
  } else if (engine === "rg1piano") {
    currentSynth = new RG1PianoSynth(audioContext);
  } else if (engine === "rgslicer") {
    currentSynth = new RGSlicerSynth(audioContext);
    slicerSynth = currentSynth; // Keep reference for WAV loading
  } else {
    currentSynth = new MIDIAudioSynth(audioContext);
  }

  await currentSynth.initialize();

  // Connect auto-generated UI to synth instance
  if (engine === "rgahx") {
    const synthUI = document.getElementById("rgahxControls");
    setTimeout(() => {
      synthUI.setSynthInstance(currentSynth);
      console.log("[RGAHX] Auto-generated UI connected to synth instance");
    }, 500);
  } else if (engine === "rgsid") {
    const synthUI = document.getElementById("rgsidControls");
    setTimeout(() => {
      synthUI.setSynthInstance(currentSynth);
      console.log("[RGSID] Auto-generated UI connected to synth instance");
    }, 500);
  } else if (engine === "rgslicer") {
    const synthUI = document.getElementById("rgslicerControls");
    setTimeout(() => {
      synthUI.setSynthInstance(currentSynth);
      console.log("[RGSlicer] Auto-generated UI connected to synth instance");
    }, 500);
  }

  // Connect synth to shared analyzer
  currentSynth.masterGain.connect(sharedAnalyzer.inputGain);
  console.log("[Synth Test] Connected synth to shared analyzer");

  // Connect analyzer to master gain (volume control)
  sharedAnalyzer.connectTo(masterGainNode);

  let engineName = "Simple";
  if (engine === "rgresonate1") engineName = "RGResonate1";
  else if (engine === "rgahx") engineName = "RGAHX";
  else if (engine === "rgsid") engineName = "RGSID";
  else if (engine === "rg1piano") engineName = "RG1Piano";
  else if (engine === "rgslicer") engineName = "RGSlicer";

  synthStatus.innerHTML = `Synth: <span>${engineName}</span>`;

  // Update button states - Remove all active classes first
  document.getElementById("btnInitSimple").classList.remove("active");
  document.getElementById("btnInitRGResonate1").classList.remove("active");
  document.getElementById("btnInitRGAHX").classList.remove("active");
  document.getElementById("btnInitRGSID").classList.remove("active");
  document.getElementById("btnInitRG1Piano").classList.remove("active");
  document.getElementById("btnInitRGSFZ").classList.remove("active");
  document.getElementById("btnInitRGSlicer").classList.remove("active");

  // Add active class to current engine
  if (engine === "simple") {
    document.getElementById("btnInitSimple").classList.add("active");
  } else if (engine === "rgresonate1") {
    document.getElementById("btnInitRGResonate1").classList.add("active");
  } else if (engine === "rgahx") {
    document.getElementById("btnInitRGAHX").classList.add("active");
  } else if (engine === "rgsid") {
    document.getElementById("btnInitRGSID").classList.add("active");
  } else if (engine === "rg1piano") {
    document.getElementById("btnInitRG1Piano").classList.add("active");
  } else if (engine === "rgsfz") {
    document.getElementById("btnInitRGSFZ").classList.add("active");
  } else if (engine === "rgslicer") {
    document.getElementById("btnInitRGSlicer").classList.add("active");
  }

  // Show/hide engine-specific controls
  document.getElementById("rgahxControls").style.display =
    engine === "rgahx" ? "block" : "none";
  document.getElementById("plistEditor").style.display =
    engine === "rgahx" ? "block" : "none";
  document.getElementById("rgsidControls").style.display =
    engine === "rgsid" ? "block" : "none";
  document.getElementById("rgslicerControls").style.display =
    engine === "rgslicer" ? "block" : "none";
  document.getElementById("rgslicerWavControls").style.display =
    engine === "rgslicer" ? "block" : "none";

  // Don't call setAudible(true) - already connected through analyzer
  // (Calling setAudible would create dual path: analyzer + speakerGain = 2x volume!)
}

async function initializeDrum() {
  // Resume AudioContext if needed
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  // Destroy existing drum engines if switching
  if (drumSynth) {
    drumSynth.destroy();
    drumSynth = null;
  }
  if (ahxDrumSynth) {
    ahxDrumSynth.destroy();
    ahxDrumSynth = null;
  }

  drumSynth = new RG909Drum(audioContext);
  await drumSynth.initialize();

  // Create shared analyzer if not exists
  if (!sharedAnalyzer) {
    sharedAnalyzer = new FrequencyAnalyzer(audioContext, {
      fftSize: 8192,
      smoothing: 0.8,
      updateRate: 50,
      sourceName: "midi-synth",
      enableDecay: true,
    });
    sharedAnalyzer.start();
    console.log("[Synth Test] Created shared frequency analyzer");

    // Listen to frequency events
    sharedAnalyzer.on("*", (event) => {
      if (event.type === "frequency" && event.data && event.data.bands) {
        updateFrequencyBars(event.data.bands);
      }
    });
  }

  // Connect drum to shared analyzer
  drumSynth.masterGain.connect(sharedAnalyzer.inputGain);
  console.log("[Synth Test] Connected drum to shared analyzer");

  // Connect analyzer to master gain (volume control)
  sharedAnalyzer.connectTo(masterGainNode);

  // Don't call setAudible(true) - already connected through analyzer
  // (Calling setAudible would create dual path: analyzer + speakerGain = 2x volume!)

  // Update button states
  document.getElementById("btnInitDrum").classList.add("active");
  document.getElementById("btnInitAHXDrum").classList.remove("active");
  document.getElementById("btnRenderDrums").disabled = false;
}

async function initializeAHXDrum() {
  // Resume AudioContext if needed
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  // Destroy existing drum engines if switching
  if (drumSynth) {
    drumSynth.destroy();
    drumSynth = null;
  }
  if (ahxDrumSynth) {
    ahxDrumSynth.destroy();
    ahxDrumSynth = null;
  }

  ahxDrumSynth = new RGAHXDrum(audioContext);
  await ahxDrumSynth.initialize();

  // Create shared analyzer if not exists
  if (!sharedAnalyzer) {
    sharedAnalyzer = new FrequencyAnalyzer(audioContext, {
      fftSize: 8192,
      smoothing: 0.8,
      updateRate: 50,
      sourceName: "midi-synth",
      enableDecay: true,
    });
    sharedAnalyzer.start();
    console.log("[Synth Test] Created shared frequency analyzer");

    // Listen to frequency events
    sharedAnalyzer.on("*", (event) => {
      if (event.type === "frequency" && event.data && event.data.bands) {
        updateFrequencyBars(event.data.bands);
      }
    });
  }

  // Connect AHX drum to shared analyzer
  ahxDrumSynth.masterGain.connect(sharedAnalyzer.inputGain);
  console.log("[Synth Test] Connected RGAHX drum to shared analyzer");

  // Connect analyzer to master gain (volume control)
  sharedAnalyzer.connectTo(masterGainNode);

  // Update button states
  document.getElementById("btnInitDrum").classList.remove("active");
  document.getElementById("btnInitAHXDrum").classList.add("active");
}

function toggleWebRTCConfig() {
  const config = document.getElementById("webrtc-config");
  config.style.display = config.style.display === "none" ? "block" : "none";
}

async function generateWebRTCAnswer() {
  try {
    const offerInput = document.getElementById("webrtc-offer-input");
    const answerOutput = document.getElementById("webrtc-answer-output");
    const statusEl = document.getElementById("webrtc-status");

    const offerText = offerInput.value.trim();
    if (!offerText) {
      statusEl.textContent = "❌ Please paste an offer first";
      statusEl.style.color = "#ff0000";
      return;
    }

    // Check if BrowserMIDIRTC is available
    if (!window.BrowserMIDIRTC) {
      throw new Error("BrowserMIDIRTC not loaded yet - please wait");
    }

    console.log("[WebRTC MIDI] Creating receiver...");
    statusEl.textContent = "🔄 Connecting...";
    statusEl.style.color = "#ffaa00";

    // Create WebRTC MIDI receiver
    webrtcMidi = new window.BrowserMIDIRTC("receiver");
    await webrtcMidi.initialize();
    console.log("[WebRTC MIDI] Receiver initialized");

    // Handle incoming MIDI messages
    webrtcMidi.onMIDIMessage = (message) => {
      console.log("[WebRTC MIDI] Received:", message);
      // Forward to MIDI manager
      if (midiManager && message.data) {
        const midiData = new Uint8Array(message.data);
        const event = {
          data: midiData,
          timeStamp: message.timestamp || performance.now(),
        };
        midiManager._handleMIDIMessage(event);
      }
    };

    // Handle connection state changes
    webrtcMidi.onConnectionStateChange = (state) => {
      console.log("[WebRTC MIDI] Connection state:", state);
      if (state === "connected") {
        statusEl.textContent = "✅ Connected - MIDI is flowing!";
        statusEl.style.color = "#00ff00";
        midiStatus.querySelector("span").textContent = "WebRTC Connected";
        midiStatus.style.color = "#00ff00";
      } else if (state === "disconnected" || state === "failed") {
        statusEl.textContent = "❌ Connection failed or disconnected";
        statusEl.style.color = "#ff0000";
        midiStatus.querySelector("span").textContent = "WebRTC Disconnected";
        midiStatus.style.color = "#ff0000";
      }
    };

    // Handle offer and get answer
    const answer = await webrtcMidi.handleOffer(offerText);

    // Display answer
    answerOutput.value = answer;
    statusEl.textContent = "🔵 Waiting for bridge to connect...";
    statusEl.style.color = "#0066FF";
    console.log("[WebRTC MIDI] Answer generated");
  } catch (error) {
    console.error("[WebRTC MIDI] Error:", error);
    const statusEl = document.getElementById("webrtc-status");
    statusEl.textContent = "❌ Error: " + error.message;
    statusEl.style.color = "#ff0000";
  }
}

function copyAnswerToClipboard() {
  const answerOutput = document.getElementById("webrtc-answer-output");
  answerOutput.select();
  navigator.clipboard
    .writeText(answerOutput.value)
    .then(() => {
      console.log("[WebRTC MIDI] Answer copied to clipboard");
    })
    .catch((err) => {
      console.error("[WebRTC MIDI] Failed to copy:", err);
    });
}

function disconnectWebRTCMIDI() {
  if (webrtcMidi) {
    webrtcMidi.close();
    webrtcMidi = null;
  }
  const statusEl = document.getElementById("webrtc-status");
  statusEl.textContent = "⚪ Not Connected";
  statusEl.style.color = "#666";
  document.getElementById("webrtc-offer-input").value = "";
  document.getElementById("webrtc-answer-output").value = "";
  midiStatus.querySelector("span").textContent = "Not Connected";
  midiStatus.style.color = "";
  console.log("[WebRTC MIDI] Disconnected");
}

function setupMIDIHandlers() {
  // Handle note on from regular MIDI
  midiManager.on("noteon", (data) => {
    console.log("[MIDI] Note ON:", data, "Channel:", data.channel);

    // Route to SFZ player if loaded (takes priority)
    if (sfzPlayer && sfzPlayer.regions.length > 0) {
      sfzPlayer.handleNoteOn(data.note, data.velocity);
      console.log("[MIDI] Routed to SFZ");
    }
    // MIDI Channel 10 (index 9) routes to drums (GM standard)
    else if (data.channel === 9 && (drumSynth || ahxDrumSynth)) {
      const activeDrum = ahxDrumSynth || drumSynth;
      activeDrum.triggerDrum(data.note, data.velocity);
      highlightDrumPad(data.note);
    } else if (currentSynth) {
      // Use handleMidi if available (SID synth with channel routing)
      if (currentSynth.handleMidi) {
        const status = 0x90 | data.channel; // Note On + channel
        currentSynth.handleMidi(status, data.note, data.velocity);
      } else {
        currentSynth.handleNoteOn(data.note, data.velocity);
      }
    }

    // Also handle drum notes by note number (36-49) if not on channel 10 and no SFZ
    if (
      !sfzPlayer &&
      data.channel !== 9 &&
      (drumSynth || ahxDrumSynth) &&
      data.note >= 36 &&
      data.note <= 49
    ) {
      const activeDrum = ahxDrumSynth || drumSynth;
      activeDrum.triggerDrum(data.note, data.velocity);
      highlightDrumPad(data.note);
    }
  });

  // Handle note off from regular MIDI
  midiManager.on("noteoff", (data) => {
    console.log("[MIDI] Note OFF:", data, "Channel:", data.channel);

    // Send note off to SFZ player if loaded
    if (sfzPlayer && sfzPlayer.regions.length > 0) {
      sfzPlayer.handleNoteOff(data.note, data.velocity);
    }
    // Only send note off to synth (drums don't need note off)
    else if (data.channel !== 9 && currentSynth) {
      // Use handleMidi if available (SID synth with channel routing)
      if (currentSynth.handleMidi) {
        const status = 0x80 | data.channel; // Note Off + channel
        currentSynth.handleMidi(status, data.note, 0);
      } else {
        currentSynth.handleNoteOff(data.note);
      }
    }
  });
}

function highlightDrumPad(note) {
  // Find drum pad with matching note
  const pad = document.querySelector(`.drum-pad[data-note="${note}"]`);
  if (pad) {
    pad.classList.add("active");
    setTimeout(() => {
      pad.classList.remove("active");
    }, 100);
  }
}

function triggerDrum(note) {
  if (!drumSynth && !ahxDrumSynth) {
    console.warn("[Synth Test] Drum not initialized");
    return;
  }
  const activeDrum = ahxDrumSynth || drumSynth;
  activeDrum.triggerDrum(note, 127);
  highlightDrumPad(note);
}

async function toggleAudible() {
  // Resume AudioContext if needed
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  isAudible = !isAudible;

  if (currentSynth) {
    await currentSynth.setAudible(isAudible);
  }

  if (drumSynth) {
    await drumSynth.setAudible(isAudible);
  }

  document.getElementById("btnMute").textContent = isAudible
    ? "Mute"
    : "Unmute";
}

function stopAllNotes() {
  if (currentSynth && currentSynth.stopAll) {
    currentSynth.stopAll();
  }
}

function updateFrequencyBars(bands) {
  if (freqBarsComponent) {
    freqBarsComponent.draw(bands);
  }
}

function visualize() {
  requestAnimationFrame(visualize);

  if (!sharedAnalyzer) return;

  const analyser = sharedAnalyzer.getAnalyser();
  if (!analyser) return;

  // Waveform
  const waveformCtx = waveformCanvas.getContext("2d");
  const waveformData = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(waveformData);

  waveformCtx.fillStyle = "#0a0a0a";
  waveformCtx.fillRect(0, 0, waveformCanvas.width, waveformCanvas.height);

  waveformCtx.lineWidth = 2;
  waveformCtx.strokeStyle = "#CF1A37";
  waveformCtx.beginPath();

  const sliceWidth = waveformCanvas.width / waveformData.length;
  let x = 0;

  for (let i = 0; i < waveformData.length; i++) {
    const v = waveformData[i] / 128.0;
    const y = (v * waveformCanvas.height) / 2;

    if (i === 0) {
      waveformCtx.moveTo(x, y);
    } else {
      waveformCtx.lineTo(x, y);
    }

    x += sliceWidth;
  }

  waveformCtx.lineTo(waveformCanvas.width, waveformCanvas.height / 2);
  waveformCtx.stroke();

  // Spectrum
  const spectrumCtx = spectrumCanvas.getContext("2d");
  const frequencyData = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(frequencyData);

  spectrumCtx.fillStyle = "#0a0a0a";
  spectrumCtx.fillRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);

  const barWidth = (spectrumCanvas.width / frequencyData.length) * 2.5;
  let barX = 0;

  for (let i = 0; i < frequencyData.length; i++) {
    const barHeight = (frequencyData[i] / 255) * spectrumCanvas.height;

    // REGROOVE signature red
    spectrumCtx.fillStyle = `rgb(207, 26, 55)`;
    spectrumCtx.fillRect(
      barX,
      spectrumCanvas.height - barHeight,
      barWidth,
      barHeight,
    );

    barX += barWidth + 1;
  }

  // Frequency Bars (Bass, Mid, High) - calculate directly from analyser
  if (freqBarsComponent) {
    // Calculate frequency bands from raw analyser data
    const nyquist = audioContext.sampleRate / 2;
    const binCount = frequencyData.length;
    const binWidth = nyquist / binCount;

    // Define frequency ranges (Hz)
    const bassMax = 250;
    const midMax = 2000;
    const highMax = nyquist;

    // Calculate bins for each range
    const bassBins = Math.floor(bassMax / binWidth);
    const midBins = Math.floor(midMax / binWidth);

    // Calculate average amplitude for each band
    let bassSum = 0, midSum = 0, highSum = 0;
    let bassCount = 0, midCount = 0, highCount = 0;

    for (let i = 0; i < binCount; i++) {
      if (i < bassBins) {
        bassSum += frequencyData[i];
        bassCount++;
      } else if (i < midBins) {
        midSum += frequencyData[i];
        midCount++;
      } else {
        highSum += frequencyData[i];
        highCount++;
      }
    }

    const bands = {
      bass: bassCount > 0 ? (bassSum / bassCount) / 255 : 0,
      mid: midCount > 0 ? (midSum / midCount) / 255 : 0,
      high: highCount > 0 ? (highSum / highCount) / 255 : 0
    };

    // Draw frequency bars every frame (smooth & responsive)
    freqBarsComponent.draw(bands);
  }

  // Draw to popup windows if open
  if (window.popupWindows && window.popupWindows.size > 0) {
    window.popupWindows.forEach((popupData, canvasId) => {
      // Check if popup is still open
      if (popupData.window.closed) {
        window.popupWindows.delete(canvasId);
        return;
      }

      const ctx = popupData.canvas.getContext('2d');

      if (canvasId === 'waveform') {
        // Draw waveform to popup canvas
        ctx.fillStyle = "#0a0a0a";
        ctx.fillRect(0, 0, popupData.canvas.width, popupData.canvas.height);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#CF1A37";
        ctx.beginPath();
        const sw = popupData.canvas.width / waveformData.length;
        let px = 0;
        for (let i = 0; i < waveformData.length; i++) {
          const v = waveformData[i] / 128.0;
          const py = (v * popupData.canvas.height) / 2;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          px += sw;
        }
        ctx.lineTo(popupData.canvas.width, popupData.canvas.height / 2);
        ctx.stroke();
      } else if (canvasId === 'spectrum') {
        // Draw spectrum to popup canvas
        ctx.fillStyle = "#0a0a0a";
        ctx.fillRect(0, 0, popupData.canvas.width, popupData.canvas.height);
        const bw = (popupData.canvas.width / frequencyData.length) * 2.5;
        let bx = 0;
        for (let i = 0; i < frequencyData.length; i++) {
          const bh = (frequencyData[i] / 255) * popupData.canvas.height;
          ctx.fillStyle = `rgb(207, 26, 55)`;
          ctx.fillRect(bx, popupData.canvas.height - bh, bw, bh);
          bx += bw + 1;
        }
      } else if (canvasId === 'freq-viz') {
        // Draw frequency bars to popup canvas using component
        if (freqBarsComponent) {
          // Use the already-smoothed current bands (don't re-smooth for popup)
          const popupCanvas = popupData.canvas;
          const padding = 10;
          const innerWidth = popupCanvas.width - padding * 2;
          const innerHeight = popupCanvas.height - padding * 2;
          const labelHeight = 20;
          const barAreaHeight = innerHeight - labelHeight;
          const barGap = 10;
          const barWidth = (innerWidth - barGap * 2) / 3;
          const barX = [
            padding + barGap / 2,
            padding + barWidth + barGap * 1.5,
            padding + barWidth * 2 + barGap * 2.5
          ];

          // Clear background
          ctx.fillStyle = "#0a0a0a";
          ctx.fillRect(0, 0, popupCanvas.width, popupCanvas.height);

          const drawRoundedBar = (x, height, gradient) => {
            const y = padding + barAreaHeight - height;
            const cornerRadius = 2;
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.moveTo(x + cornerRadius, y);
            ctx.lineTo(x + barWidth - cornerRadius, y);
            ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + cornerRadius);
            ctx.lineTo(x + barWidth, padding + barAreaHeight - cornerRadius);
            ctx.quadraticCurveTo(x + barWidth, padding + barAreaHeight, x + barWidth - cornerRadius, padding + barAreaHeight);
            ctx.lineTo(x + cornerRadius, padding + barAreaHeight);
            ctx.quadraticCurveTo(x, padding + barAreaHeight, x, padding + barAreaHeight - cornerRadius);
            ctx.lineTo(x, y + cornerRadius);
            ctx.quadraticCurveTo(x, y, x + cornerRadius, y);
            ctx.closePath();
            ctx.fill();
          };

          // Use already-smoothed current bands
          const cb = freqBarsComponent.currentBands;

          // Bass bar
          const bassHeight = Math.max(2, cb.bass * barAreaHeight);
          const gradient1 = ctx.createLinearGradient(0, padding + barAreaHeight, 0, padding + barAreaHeight - bassHeight);
          gradient1.addColorStop(0, '#CF1A37');
          gradient1.addColorStop(1, '#ff3333');
          drawRoundedBar(barX[0], bassHeight, gradient1);

          // Mid bar
          const midHeight = Math.max(2, cb.mid * barAreaHeight);
          const gradient2 = ctx.createLinearGradient(0, padding + barAreaHeight, 0, padding + barAreaHeight - midHeight);
          gradient2.addColorStop(0, '#CF1A37');
          gradient2.addColorStop(1, '#ff3333');
          drawRoundedBar(barX[1], midHeight, gradient2);

          // High bar
          const highHeight = Math.max(2, cb.high * barAreaHeight);
          const gradient3 = ctx.createLinearGradient(0, padding + barAreaHeight, 0, padding + barAreaHeight - highHeight);
          gradient3.addColorStop(0, '#CF1A37');
          gradient3.addColorStop(1, '#ff3333');
          drawRoundedBar(barX[2], highHeight, gradient3);

          // Labels
          ctx.fillStyle = '#666';
          ctx.font = '10px Arial';
          ctx.textAlign = 'center';
          const labelY = padding + barAreaHeight + labelHeight / 2 + 3;
          ctx.fillText('Bass', barX[0] + barWidth / 2, labelY);
          ctx.fillText('Mid', barX[1] + barWidth / 2, labelY);
          ctx.fillText('High', barX[2] + barWidth / 2, labelY);
        }
      }
    });
  }
}

// WAV file encoding
function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  // WAV header
  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM format
  view.setUint16(20, 1, true); // Mono
  view.setUint16(22, 1, true); // Channels
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  // Convert float samples to 16-bit PCM
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

// Render a single drum sound
async function renderDrumSound(note, drumName, duration = 2.0) {
  // Use AudioContext's native sample rate to avoid resampling artifacts
  const sampleRate = audioContext.sampleRate;
  const totalFrames = Math.floor(duration * sampleRate);

  // Load and patch WASM module to expose memory (same as worklet processor)
  const jsResponse = await fetch("synths/rg909-drum.js");
  const jsCode = await jsResponse.text();
  const wasmResponse = await fetch("synths/rg909-drum.wasm");
  const wasmBytes = await wasmResponse.arrayBuffer();

  // Patch to expose wasmMemory
  const modifiedCode = jsCode.replace(
    ";return moduleRtn",
    ";globalThis.__wasmMemoryRender=wasmMemory;return moduleRtn",
  );

  // Load module with patched code in isolated scope
  let PatchedRG909Module;
  (function () {
    eval(modifiedCode);
    PatchedRG909Module = RG909Module;
  })();

  const RG909Module = await PatchedRG909Module({
    wasmBinary: wasmBytes,
  });

  // Get memory reference
  const wasmMemory = globalThis.__wasmMemoryRender;
  delete globalThis.__wasmMemoryRender;

  console.log("[Render] WASM module loaded with memory access");

  // Create synth instance
  const synthPtr = RG909Module._rg909_create(sampleRate);

  // Trigger the drum
  RG909Module._rg909_trigger_drum(synthPtr, note, 127, sampleRate);

  // Allocate buffer for rendering
  const framesPerBlock = 128;
  const bufferPtr = RG909Module._malloc(framesPerBlock * 2 * 4); // stereo float32

  // Output buffer (stereo)
  const outputLeft = new Float32Array(totalFrames);
  const outputRight = new Float32Array(totalFrames);

  // Render in blocks
  let currentFrame = 0;
  while (currentFrame < totalFrames) {
    const framesToRender = Math.min(framesPerBlock, totalFrames - currentFrame);

    // Process audio
    RG909Module._rg909_process_f32(
      synthPtr,
      bufferPtr,
      framesToRender,
      sampleRate,
    );

    // Access heap using memory reference (same as worklet)
    const heapF32 = new Float32Array(
      wasmMemory.buffer,
      bufferPtr,
      framesToRender * 2,
    );

    // Read samples from heap
    for (let i = 0; i < framesToRender; i++) {
      outputLeft[currentFrame + i] = heapF32[i * 2];
      outputRight[currentFrame + i] = heapF32[i * 2 + 1];
    }

    currentFrame += framesToRender;
  }

  // Cleanup
  RG909Module._free(bufferPtr);
  RG909Module._rg909_destroy(synthPtr);

  // Mix stereo to mono for comparison
  const monoSamples = new Float32Array(totalFrames);
  for (let i = 0; i < totalFrames; i++) {
    monoSamples[i] = (outputLeft[i] + outputRight[i]) / 2;
  }

  // Encode to WAV
  const wavBuffer = encodeWAV(monoSamples, sampleRate);
  const blob = new Blob([wavBuffer], { type: "audio/wav" });

  return {
    name: drumName,
    blob: blob,
    url: URL.createObjectURL(blob),
  };
}

// Render all drums
async function renderAllDrums() {
  const renderBtn = document.getElementById("btnRenderDrums");
  const statusDiv = document.getElementById("renderStatus");

  renderBtn.disabled = true;
  statusDiv.innerHTML = "Rendering drums...";

  const drums = [
    { note: 36, name: "BD_BassDrum" },
    { note: 38, name: "SD_Snare" },
    { note: 37, name: "RS_Rimshot" },
    { note: 39, name: "HC_HandClap" },
    { note: 41, name: "LT_TomLow" },
    { note: 47, name: "MT_TomMid" },
    { note: 50, name: "HT_TomHigh" },
  ];

  try {
    const renderedFiles = [];

    for (let i = 0; i < drums.length; i++) {
      const drum = drums[i];
      statusDiv.innerHTML = `Rendering ${drum.name}... (${i + 1}/${drums.length})`;

      const result = await renderDrumSound(drum.note, drum.name);
      renderedFiles.push(result);

      console.log(`[Render] Completed: ${drum.name}`);
    }

    // Create download links
    statusDiv.innerHTML = `
                    <div style="color: #00FF00; margin-bottom: 10px;">
                        [DONE] All drums rendered successfully! Click links below to download:
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px;">
                        ${renderedFiles
                          .map(
                            (file) => `
                            <a href="${file.url}" download="RG909_${file.name}.wav"
                               style="color: #0066FF; text-decoration: none; padding: 5px; background: #2a2a2a; border-radius: 3px; text-align: center;">
                                ${file.name}
                            </a>
                        `,
                          )
                          .join("")}
                    </div>
                `;
  } catch (error) {
    console.error("[Render] Error:", error);
    statusDiv.innerHTML = `<span style="color: #ff3333;">Render failed: ${error.message}</span>`;
  } finally {
    renderBtn.disabled = false;
  }
}

// On-screen keyboard functions
function toggleKeyboard() {
  const container = document.getElementById("keyboardContainer");
  const toggle = document.getElementById("keyboardToggle");

  if (container.classList.contains("visible")) {
    container.classList.remove("visible");
    toggle.textContent = "⌨️ Show Keyboard";
    toggle.classList.remove("active");
  } else {
    container.classList.add("visible");
    toggle.textContent = "⌨️ Hide Keyboard";
    toggle.classList.add("active");
  }
}

function changeOctave(delta) {
  keyboardOctave += delta;
  if (keyboardOctave < 0) keyboardOctave = 0;
  if (keyboardOctave > 8) keyboardOctave = 8;

  const octaveDisplay = document.getElementById("octaveDisplay");
  const noteNames = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];
  octaveDisplay.textContent = "C" + keyboardOctave;

  // Update keyboard octave
  if (pianoKeyboard) {
    pianoKeyboard.setBaseOctave(keyboardOctave);
  }
}

function buildKeyboard() {
  // Destroy existing keyboard if it exists
  if (pianoKeyboard) {
    pianoKeyboard.destroy();
  }

  // Create new PianoKeyboard component
  pianoKeyboard = new PianoKeyboard("pianoKeyboard", {
    octaves: 2,
    baseOctave: keyboardOctave,
    showLabels: true,
    enableTouch: true,
    enableMouse: true,
  });

  // Connect keyboard events to synth
  pianoKeyboard.addEventListener("noteon", (e) => {
    playKeyboardNote(e.detail.note, e.detail.velocity, false);
  });

  pianoKeyboard.addEventListener("noteoff", (e) => {
    playKeyboardNote(e.detail.note, 0, true);
  });
}

function playKeyboardNote(note, velocity, isNoteOff = false) {
  if (isNoteOff) {
    // Note off
    activeKeys.delete(note);

    // Send note off to SFZ player if loaded
    if (sfzPlayer && sfzPlayer.regions.length > 0) {
      sfzPlayer.handleNoteOff(note, velocity);
    }
    // Only send note off to synth (not drums)
    else if (keyboardChannel !== 9 && currentSynth) {
      currentSynth.handleNoteOff(note);
    }
  } else {
    // Note on
    activeKeys.add(note);

    // Update last note display
    const noteNames = [
      "C",
      "C#",
      "D",
      "D#",
      "E",
      "F",
      "F#",
      "G",
      "G#",
      "A",
      "A#",
      "B",
    ];
    const octave = Math.floor((note - 12) / 12);
    const noteName = noteNames[(note - 12) % 12];
    document.getElementById("lastNote").textContent =
      `${noteName}${octave} (Ch ${keyboardChannel + 1}) Vel ${velocity}`;

    // Route to SFZ player if loaded (takes priority)
    if (sfzPlayer && sfzPlayer.regions.length > 0) {
      sfzPlayer.handleNoteOn(note, velocity);
      console.log("[Keyboard] SFZ note:", note, "velocity:", velocity);
    }
    // Route to drums or synth based on channel
    else if (keyboardChannel === 9) {
      // Channel 10 (drums)
      if (drumSynth || ahxDrumSynth) {
        const activeDrum = ahxDrumSynth || drumSynth;
        activeDrum.triggerDrum(note, velocity);
        highlightDrumPad(note);
        console.log("[Keyboard] Drum note:", note, "velocity:", velocity);
      }
    } else {
      // Other channels (synth)
      if (currentSynth) {
        currentSynth.handleNoteOn(note, velocity);
        console.log(
          "[Keyboard] Synth note:",
          note,
          "velocity:",
          velocity,
          "channel:",
          keyboardChannel + 1,
        );
      }
    }
  }
}

// RGSFZ Sampler (WASM-based SFZ player)
// ===========================================
// RGSlicer Initialization and Handlers
// ===========================================

async function initializeRGSlicer() {
  await initializeSynth("rgslicer");

  // Listen for slice info events from worklet
  if (slicerSynth) {
    slicerSynth.on("sliceInfo", (data) => {
      const { numSlices, slices } = data;
      console.log(`[RGSlicer] Received slice info: ${numSlices} slices`);

      const slicerInfo = document.getElementById("slicerInfo");
      let infoHTML =
        slicerInfo.textContent.split("\n").slice(0, 3).join("\n") + "\n";
      infoHTML += `Slices: ${numSlices}\n\n`;

      if (numSlices > 0 && slices) {
        infoHTML += `Slice Mapping (MIDI notes 36-99):\n`;
        for (let i = 0; i < Math.min(numSlices, 10); i++) {
          if (slices[i]) {
            const note = 36 + i;
            const noteName = [
              "C",
              "C#",
              "D",
              "D#",
              "E",
              "F",
              "F#",
              "G",
              "G#",
              "A",
              "A#",
              "B",
            ][(note - 12) % 12];
            const octave = Math.floor((note - 12) / 12);
            infoHTML += `  ${i}: Note ${note} (${noteName}${octave}) - Offset ${slices[i].offset}, Length ${slices[i].length}\n`;
          }
        }
        if (numSlices > 10) {
          infoHTML += `  ... and ${numSlices - 10} more slices\n`;
        }
      }

      slicerInfo.textContent = infoHTML;
      document.getElementById("slicerWavFileName").textContent = document
        .getElementById("slicerWavFileName")
        .textContent.replace("(loading...)", `(${numSlices} slices)`);
    });
  }
}

document.getElementById("btnLoadSlicerWav").addEventListener("click", () => {
  document.getElementById("slicerWavInput").click();
});

// Parse WAV CUE points from raw file data
function parseWavCuePoints(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  let offset = 12; // Skip RIFF header (12 bytes)
  const cuePoints = [];

  while (offset < view.byteLength - 8) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === "cue ") {
      const numCuePoints = view.getUint32(offset + 8, true);
      console.log(`[RGSlicer] Found ${numCuePoints} CUE points in WAV file`);

      for (let i = 0; i < numCuePoints; i++) {
        const cueOffset = offset + 12 + i * 24;
        const cueId = view.getUint32(cueOffset, true);
        const position = view.getUint32(cueOffset + 20, true); // sample offset

        cuePoints.push({ id: cueId, position: position, label: "" });
      }
    } else if (chunkId === "LIST") {
      const listType = String.fromCharCode(
        view.getUint8(offset + 8),
        view.getUint8(offset + 9),
        view.getUint8(offset + 10),
        view.getUint8(offset + 11),
      );

      if (listType === "adtl") {
        // Parse labels
        let listOffset = offset + 12;
        const listEnd = offset + 8 + chunkSize;

        while (listOffset < listEnd - 8) {
          const subChunkId = String.fromCharCode(
            view.getUint8(listOffset),
            view.getUint8(listOffset + 1),
            view.getUint8(listOffset + 2),
            view.getUint8(listOffset + 3),
          );
          const subChunkSize = view.getUint32(listOffset + 4, true);

          if (subChunkId === "labl") {
            const cueId = view.getUint32(listOffset + 8, true);
            let label = "";
            for (
              let i = 0;
              i < subChunkSize - 5 && listOffset + 12 + i < listEnd;
              i++
            ) {
              const char = view.getUint8(listOffset + 12 + i);
              if (char === 0) break;
              label += String.fromCharCode(char);
            }

            const cue = cuePoints.find((c) => c.id === cueId);
            if (cue) cue.label = label;
          }

          listOffset += 8 + subChunkSize + (subChunkSize % 2);
        }
      }
    }

    offset += 8 + chunkSize + (chunkSize % 2);
  }

  return cuePoints;
}

document
  .getElementById("slicerWavInput")
  .addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      console.log("[RGSlicer] Loading WAV:", file.name);
      document.getElementById("slicerWavFileName").textContent =
        `Loading ${file.name}...`;

      // Read WAV file as raw ArrayBuffer first (to extract CUE points)
      const arrayBuffer = await file.arrayBuffer();

      // Parse CUE points BEFORE decoding
      const cuePoints = parseWavCuePoints(arrayBuffer);
      if (cuePoints.length > 0) {
        console.log(
          `[RGSlicer] Found ${cuePoints.length} CUE points:`,
          cuePoints,
        );
      } else {
        console.log("[RGSlicer] No CUE points found - will auto-slice");
      }

      // Now decode audio
      const audioBuffer = await audioContext.decodeAudioData(
        arrayBuffer.slice(0),
      );

      // Convert to mono int16 PCM
      const channelData = audioBuffer.getChannelData(0);
      const pcmData = new Int16Array(channelData.length);
      for (let i = 0; i < channelData.length; i++) {
        pcmData[i] = Math.max(-32768, Math.min(32767, channelData[i] * 32768));
      }

      // Check if slicer synth is initialized
      if (!slicerSynth || !slicerSynth.wasmReady) {
        throw new Error("RGSlicer not initialized or WASM not ready");
      }

      // Load WAV into slicer (sends to worklet with CUE points)
      await slicerSynth.loadWavFile(pcmData, audioBuffer.sampleRate, cuePoints);

      console.log(
        `[RGSlicer] Loaded ${file.name}: ${pcmData.length} samples @ ${audioBuffer.sampleRate} Hz`,
      );

      // Display basic info (slice details will come from worklet event)
      const slicerInfo = document.getElementById("slicerInfo");
      slicerInfo.style.display = "block";

      let infoHTML = `Loaded: ${file.name}\n`;
      infoHTML += `Sample Rate: ${audioBuffer.sampleRate} Hz\n`;
      infoHTML += `Length: ${pcmData.length} samples (${(pcmData.length / audioBuffer.sampleRate).toFixed(2)}s)\n`;
      infoHTML += `Waiting for slice info from WASM...\n`;

      slicerInfo.textContent = infoHTML;
      document.getElementById("slicerWavFileName").textContent =
        `${file.name} (loading...)`;
    } catch (error) {
      console.error("[RGSlicer] WAV load error:", error);
      document.getElementById("slicerWavFileName").textContent =
        `Error: ${error.message}`;
      alert("Failed to load WAV file: " + error.message);
    }
  });

// ===========================================
// RGSFZ Initialization and Handlers
// ===========================================

async function initializeRGSFZ() {
  // Resume AudioContext if needed
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  // Destroy existing synth if switching
  if (currentSynth) {
    currentSynth.destroy();
    currentSynth = null;
  }
  if (sfzPlayer) {
    sfzPlayer.destroy();
    sfzPlayer = null;
  }

  try {
    sfzPlayer = new RGSFZSynth(audioContext);
    await sfzPlayer.initialize();

    // Connect to shared analyzer
    if (!sharedAnalyzer) {
      sharedAnalyzer = new FrequencyAnalyzer(audioContext, {
        fftSize: 8192,
        smoothing: 0.8,
        updateRate: 50,
        sourceName: "midi-synth",
        enableDecay: true,
      });
      sharedAnalyzer.start();

      sharedAnalyzer.on("*", (event) => {
        if (event.type === "frequency" && event.data && event.data.bands) {
          updateFrequencyBars(event.data.bands);
        }
      });
    }

    sfzPlayer.masterGain.connect(sharedAnalyzer.inputGain);
    sharedAnalyzer.connectTo(masterGainNode);

    // Show RGSFZ controls
    document.getElementById("rgsfzControls").style.display = "block";

    // Update button states - Remove all active classes first
    document.getElementById("btnInitSimple").classList.remove("active");
    document.getElementById("btnInitRGResonate1").classList.remove("active");
    document.getElementById("btnInitRGAHX").classList.remove("active");
    document.getElementById("btnInitRGSID").classList.remove("active");
    document.getElementById("btnInitRG1Piano").classList.remove("active");
    document.getElementById("btnInitRGSFZ").classList.remove("active");
    document.getElementById("btnInitRGSlicer").classList.remove("active");
    // Add active class to RGSFZ
    document.getElementById("btnInitRGSFZ").classList.add("active");

    console.log("[RGSFZ] Initialized successfully");
  } catch (error) {
    console.error("[RGSFZ] Initialization error:", error);
    alert("Failed to initialize RGSFZ: " + error.message);
  }
}

document.getElementById("btnLoadSFZ").addEventListener("click", () => {
  document.getElementById("sfzFileInput").click();
});

document
  .getElementById("sfzFileInput")
  .addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      console.log("[RGSFZ] Loading SFZ:", file.name);
      document.getElementById("sfzFileName").textContent =
        `Loading ${file.name}...`;

      // Parse SFZ file
      const sfzText = await file.text();
      sfzPlayer.parseSFZ(sfzText);

      const info = sfzPlayer.getInfo();
      console.log("[RGSFZ] Parsed", info.regions, "regions");

      // Display regions (show full sample paths for debugging)
      const regionsDiv = document.getElementById("sfzRegions");
      regionsDiv.style.display = "block";
      regionsDiv.innerHTML = sfzPlayer.regions
        .map((r, i) => {
          return `Region ${i + 1}: "${r.sample}" [${r.lokey}-${r.hikey}] vel[${r.lovel}-${r.hivel}] pitch=${r.pitch_keycenter}`;
        })
        .join("\n");

      console.log(
        "[RGSFZ] SFZ regions:",
        sfzPlayer.regions.map((r) => r.sample),
      );

      document.getElementById("sfzFileName").textContent =
        `${file.name} (${info.regions} regions)`;

      // Enable WAV loading button
      document.getElementById("btnLoadWAVs").disabled = false;

      console.log("[RGSFZ] SFZ parsed - Now load WAV samples");
    } catch (error) {
      console.error("[RGSFZ] SFZ load error:", error);
      document.getElementById("sfzFileName").textContent =
        `Error: ${error.message}`;
    }
  });

// WAV sample loading
document.getElementById("btnLoadWAVs").addEventListener("click", () => {
  document.getElementById("wavFilesInput").click();
});

document
  .getElementById("wavFilesInput")
  .addEventListener("change", async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    try {
      console.log("[RGSFZ] Loading", files.length, "WAV files...");
      document.getElementById("wavLoadStatus").textContent =
        `Loading ${files.length} files...`;

      let loadedCount = 0;

      // Helper: normalize filename for matching (handle spaces, case, etc.)
      const normalizeFilename = (name) => {
        return name.trim().toLowerCase();
      };

      // Create a map of normalized filename -> file for matching
      const fileMap = new Map();
      files.forEach((file) => {
        const filename = file.name;
        const normalized = normalizeFilename(filename);

        // Store multiple variations
        fileMap.set(normalized, file);
        fileMap.set(normalizeFilename(filename.replace(/\//g, "\\")), file);

        console.log("[RGSFZ] Available file:", filename);
      });

      // Try to load samples for each region
      for (let i = 0; i < sfzPlayer.regions.length; i++) {
        const region = sfzPlayer.regions[i];

        // Extract just the filename from the sample path
        const samplePath = region.sample;
        const filename = samplePath.split(/[\/\\]/).pop();
        const normalizedSample = normalizeFilename(filename);
        const normalizedPath = normalizeFilename(samplePath);

        // Try multiple matching strategies
        const wavFile =
          fileMap.get(normalizedSample) ||
          fileMap.get(normalizedPath) ||
          fileMap.get(normalizeFilename(samplePath.replace(/\//g, "\\")));

        if (wavFile) {
          const arrayBuffer = await wavFile.arrayBuffer();
          await sfzPlayer.loadRegionSample(i, arrayBuffer);
          loadedCount++;
          console.log("[RGSFZ] Matched:", filename, "→", wavFile.name);
        } else {
          console.warn(
            "[RGSFZ] Sample not found:",
            samplePath,
            "(normalized:",
            normalizedSample,
            ")",
          );
        }
      }

      document.getElementById("wavLoadStatus").textContent =
        `Loaded ${loadedCount}/${sfzPlayer.regions.length} samples`;
      document.getElementById("wavLoadStatus").style.color = "#00ff00";

      console.log("[RGSFZ] Loaded", loadedCount, "samples - Ready to play!");
    } catch (error) {
      console.error("[RGSFZ] WAV load error:", error);
      document.getElementById("wavLoadStatus").textContent =
        `Error: ${error.message}`;
      document.getElementById("wavLoadStatus").style.color = "#ff3333";
    }

    // Clear file input
    e.target.value = "";
  });

// ========================================================================
// RGAHX PList Editor
// ========================================================================

const NOTE_NAMES = [
  "---",
  "C-1",
  "C#1",
  "D-1",
  "D#1",
  "E-1",
  "F-1",
  "F#1",
  "G-1",
  "G#1",
  "A-1",
  "A#1",
  "B-1",
  "C-2",
  "C#2",
  "D-2",
  "D#2",
  "E-2",
  "F-2",
  "F#2",
  "G-2",
  "G#2",
  "A-2",
  "A#2",
  "B-2",
  "C-3",
  "C#3",
  "D-3",
  "D#3",
  "E-3",
  "F-3",
  "F#3",
  "G-3",
  "G#3",
  "A-3",
  "A#3",
  "B-3",
  "C-4",
  "C#4",
  "D-4",
  "D#4",
  "E-4",
  "F-4",
  "F#4",
  "G-4",
  "G#4",
  "A-4",
  "A#4",
  "B-4",
  "C-5",
  "C#5",
  "D-5",
  "D#5",
  "E-5",
  "F-5",
  "F#5",
  "G-5",
  "G#5",
  "A-5",
  "A#5",
  "B-5",
];

// Toggle PList editor visibility
document.getElementById("btnTogglePList").addEventListener("click", () => {
  const content = document.getElementById("plistContent");
  const btn = document.getElementById("btnTogglePList");
  if (content.style.display === "none") {
    content.style.display = "block";
    btn.textContent = "Hide PList ▲";
    updatePListTable();
  } else {
    content.style.display = "none";
    btn.textContent = "Show PList ▼";
  }
});

// Add PList entry
document.getElementById("btnAddPListEntry").addEventListener("click", () => {
  if (!currentSynth || !currentSynth.workletNode) {
    console.warn("[PList] No synth active");
    return;
  }
  currentSynth.workletNode.port.postMessage({
    type: "plist_add_entry",
  });
  setTimeout(updatePListTable, 50);
});

// Remove PList entry
document.getElementById("btnRemovePListEntry").addEventListener("click", () => {
  if (!currentSynth || !currentSynth.workletNode) return;
  currentSynth.workletNode.port.postMessage({
    type: "plist_remove_entry",
  });
  setTimeout(updatePListTable, 50);
});

// Clear PList
document.getElementById("btnClearPList").addEventListener("click", () => {
  if (!currentSynth || !currentSynth.workletNode) return;
  if (confirm("Clear all PList entries?")) {
    currentSynth.workletNode.port.postMessage({
      type: "plist_clear",
    });
    setTimeout(updatePListTable, 50);
  }
});

// PList speed change
document.getElementById("plistSpeed").addEventListener("change", (e) => {
  if (!currentSynth || !currentSynth.workletNode) return;
  currentSynth.workletNode.port.postMessage({
    type: "plist_set_speed",
    data: { speed: parseInt(e.target.value) },
  });
});

// Listen for PList state updates from worklet
window.addEventListener("plist_state", (event) => {
  handlePListStateUpdate(event.detail);
});

// Update PList table from synth state
function updatePListTable() {
  if (!currentSynth || !currentSynth.workletNode) return;

  currentSynth.workletNode.port.postMessage({
    type: "plist_get_state",
  });
}

// Handle PList state updates from worklet
function handlePListStateUpdate(data) {
  const { length, speed, entries } = data;

  // Update UI
  document.getElementById("plistLength").textContent = `Length: ${length}`;
  document.getElementById("plistSpeed").value = speed;

  // Update table
  const tbody = document.getElementById("plistTableBody");
  tbody.innerHTML = "";

  for (let i = 0; i < length; i++) {
    const entry = entries[i] || {
      note: 0,
      fixed: false,
      waveform: 0,
      fx: [0, 0],
      fx_param: [0, 0],
    };
    const row = document.createElement("tr");
    row.style.background = i % 2 === 0 ? "#0a0a0a" : "#0f0f0f";
    row.style.borderBottom = "1px solid #2a2a2a";

    row.innerHTML = `
                    <td style="padding: 6px;">${i}</td>
                    <td style="padding: 6px;">
                        <select data-index="${i}" data-field="note" style="width: 70px; background: #2a2a2a; color: #fff; border: 1px solid #3a3a3a; padding: 4px; font-size: 11px;">
                            ${NOTE_NAMES.map((n, idx) => `<option value="${idx}" ${entry.note === idx ? "selected" : ""}>${n}</option>`).join("")}
                        </select>
                    </td>
                    <td style="padding: 6px; text-align: center;">
                        <input type="checkbox" data-index="${i}" data-field="fixed" ${entry.fixed ? "checked" : ""}>
                    </td>
                    <td style="padding: 6px;">
                        <input type="number" data-index="${i}" data-field="waveform" min="0" max="3" value="${entry.waveform}" style="width: 50px; background: #2a2a2a; color: #fff; border: 1px solid #3a3a3a; padding: 4px; font-size: 11px;">
                    </td>
                    <td style="padding: 6px;">
                        <input type="number" data-index="${i}" data-field="fx0" min="0" max="7" value="${entry.fx[0]}" style="width: 50px; background: #2a2a2a; color: #fff; border: 1px solid #3a3a3a; padding: 4px; font-size: 11px;">
                    </td>
                    <td style="padding: 6px;">
                        <input type="number" data-index="${i}" data-field="fx0_param" min="0" max="255" value="${entry.fx_param[0]}" style="width: 60px; background: #2a2a2a; color: #fff; border: 1px solid #3a3a3a; padding: 4px; font-size: 11px;">
                    </td>
                    <td style="padding: 6px;">
                        <input type="number" data-index="${i}" data-field="fx1" min="0" max="7" value="${entry.fx[1]}" style="width: 50px; background: #2a2a2a; color: #fff; border: 1px solid #3a3a3a; padding: 4px; font-size: 11px;">
                    </td>
                    <td style="padding: 6px;">
                        <input type="number" data-index="${i}" data-field="fx1_param" min="0" max="255" value="${entry.fx_param[1]}" style="width: 60px; background: #2a2a2a; color: #fff; border: 1px solid #3a3a3a; padding: 4px; font-size: 11px;">
                    </td>
                `;

    tbody.appendChild(row);
  }

  // Add event listeners to all inputs
  tbody.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("change", (e) => {
      const index = parseInt(e.target.dataset.index);
      const field = e.target.dataset.field;
      let value =
        e.target.type === "checkbox"
          ? e.target.checked
            ? 1
            : 0
          : parseInt(e.target.value);

      if (!currentSynth || !currentSynth.workletNode) return;

      // Get current entry values
      const row = e.target.closest("tr");
      const note = parseInt(row.querySelector('[data-field="note"]').value);
      const fixed = row.querySelector('[data-field="fixed"]').checked ? 1 : 0;
      const waveform = parseInt(
        row.querySelector('[data-field="waveform"]').value,
      );
      const fx0 = parseInt(row.querySelector('[data-field="fx0"]').value);
      const fx0_param = parseInt(
        row.querySelector('[data-field="fx0_param"]').value,
      );
      const fx1 = parseInt(row.querySelector('[data-field="fx1"]').value);
      const fx1_param = parseInt(
        row.querySelector('[data-field="fx1_param"]').value,
      );

      currentSynth.workletNode.port.postMessage({
        type: "plist_set_entry",
        data: {
          index,
          note,
          fixed,
          waveform,
          fx0,
          fx0_param,
          fx1,
          fx1_param,
        },
      });
    });
  });
}

// Export .ahxp
document.getElementById("btnExportAHXP").addEventListener("click", () => {
  if (!currentSynth || !currentSynth.workletNode) {
    console.error("[PList] No synth active");
    return;
  }

  const presetName = document.getElementById("presetName").value || "MyPreset";

  currentSynth.workletNode.port.postMessage({
    type: "plist_export",
    presetName,
  });
});

// Export to compact text format
document.getElementById("btnExportText").addEventListener("click", () => {
  if (!currentSynth) {
    console.error("[PList] No synth active");
    return;
  }

  const presetName = document.getElementById("presetName").value || "MyPreset";

  // Request export from worklet
  currentSynth.workletNode.port.postMessage({
    type: "plist_export_text",
    presetName,
  });
});

// Import .ahxp
document.getElementById("btnImportAHXP").addEventListener("click", () => {
  document.getElementById("ahxpFileInput").click();
});

document
  .getElementById("ahxpFileInput")
  .addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      if (!currentSynth || !currentSynth.workletNode) {
        console.error("[PList] No synth active");
        return;
      }

      const arrayBuffer = await file.arrayBuffer();
      const view = new DataView(arrayBuffer);

      // Read header (16 bytes)
      const magic = String.fromCharCode(
        view.getUint8(0),
        view.getUint8(1),
        view.getUint8(2),
        view.getUint8(3),
      );
      if (magic !== "AHXP") {
        console.error("[PList] Invalid .ahxp file - wrong magic");
        return;
      }

      const version = view.getUint32(4, true);
      console.log(`[PList] Loading .ahxp version ${version}`);

      // Skip to preset data (after 16-byte header)
      let offset = 16;

      // Read preset name (64 bytes)
      offset += 64;

      // Read author (64 bytes)
      offset += 64;

      // Read description (256 bytes)
      offset += 256;

      // Read AhxInstrumentParams
      // We need to extract parameter values and PList separately
      // Send full buffer to worklet (it will parse the header)
      const buffer = new Uint8Array(arrayBuffer);

      currentSynth.workletNode.port.postMessage({
        type: "plist_import",
        data: { buffer },
      });

      console.log(`[PList] Sent .ahxp to worklet (${buffer.length} bytes)`);
    } catch (error) {
      console.error("[PList] .ahxp import error:", error);
    }

    e.target.value = "";
  });

// Import .txt
document.getElementById("btnImportText").addEventListener("click", () => {
  document.getElementById("presetFileInput").click();
});

document
  .getElementById("presetFileInput")
  .addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      if (!currentSynth || !currentSynth.workletNode) {
        console.error(
          "[PList] No synth active - please initialize RGAHX first",
        );
        return;
      }

      const text = await file.text();

      // Parse text format preset
      const lines = text.split("\n");
      let speed = 6;
      const entries = [];
      const parameters = {};

      for (const line of lines) {
        const trimmed = line.trim();

        // Parse parameters
        if (trimmed.startsWith("Param")) {
          const match = trimmed.match(/Param(\d+)=([\d.]+)/);
          if (match) {
            const index = parseInt(match[1]);
            const value = parseFloat(match[2]);
            parameters[index] = value;
          }
        }

        if (trimmed.startsWith("Speed=")) {
          speed = parseInt(trimmed.split("=")[1]);
        } else if (/^\d+:/.test(trimmed)) {
          // Parse entry line: "0: C-3 Fixed Wave=1 Filter=10 Volume=64"
          const parts = trimmed.split(" ");
          const noteStr = parts[1];
          const fixed = parts.includes("Fixed");

          // Parse note
          let note = 0;
          const noteIdx = NOTE_NAMES.indexOf(noteStr);
          if (noteIdx >= 0) {
            note = noteIdx;
          }

          // Parse waveform
          let waveform = 0;
          const wavePart = parts.find((p) => p.startsWith("Wave="));
          if (wavePart) {
            waveform = parseInt(wavePart.split("=")[1]);
          }

          // Parse FX commands
          let fx0 = 0,
            fx0_param = 0,
            fx1 = 0,
            fx1_param = 0;
          const FX_NAMES = [
            "Filter",
            "Porta",
            "Modul",
            "Volume",
            "Speed",
            "Jump",
            "Reso",
            "Square",
          ];

          // Find first FX
          for (let i = 0; i < FX_NAMES.length; i++) {
            const fxPart = parts.find((p) => p.startsWith(FX_NAMES[i] + "="));
            if (fxPart && fx0 === 0) {
              fx0 = i;
              fx0_param = parseInt(fxPart.split("=")[1]);
              break;
            }
          }

          // Find second FX (skip the one we already found)
          for (let i = 0; i < FX_NAMES.length; i++) {
            if (i === fx0) continue;
            const fxPart = parts.find((p) => p.startsWith(FX_NAMES[i] + "="));
            if (fxPart) {
              fx1 = i;
              fx1_param = parseInt(fxPart.split("=")[1]);
              break;
            }
          }

          entries.push({
            note,
            fixed,
            waveform,
            fx0,
            fx0_param,
            fx1,
            fx1_param,
          });
        }
      }

      console.log("[PList] Parsed preset:", { parameters, speed, entries });

      // Apply parameters
      for (const index in parameters) {
        currentSynth.workletNode.port.postMessage({
          type: "setParam",
          data: { index: parseInt(index), value: parameters[index] },
        });
      }

      // Send all PList data in a single batch
      currentSynth.workletNode.port.postMessage({
        type: "plist_import_batch",
        data: {
          speed,
          entries,
        },
      });

      console.log(
        `[PList] Text preset imported: ${entries.length} entries loaded`,
      );
    } catch (error) {
      console.error("[PList] Import error:", error);
    }

    e.target.value = "";
  });

// Listen for preset import result
window.addEventListener("preset_imported", (event) => {
  const { success, error, parameters } = event.detail;
  if (success) {
    console.log("✅ [PList] Binary preset imported successfully");

    // Update UI parameters
    if (parameters && currentSynth) {
      const synthUI = document.getElementById("rgahxControls");
      if (synthUI && synthUI.updateUIFromParameters) {
        // Convert from array of {index, value} to array of values
        const valueArray = [];
        for (const p of parameters) {
          valueArray[p.index] = p.value;
        }
        synthUI.updateUIFromParameters(valueArray);
        console.log("[PList] UI parameters updated");
      }
    }
  } else {
    console.error("❌ [PList] Binary preset import failed:", error);
  }
});

// Initialize on load
window.addEventListener("load", () => {
  init();

  // Initialize visualization components
  if (freqVizCanvas) {
    freqBarsComponent = new FrequencyBarsCanvas('freq-viz');
    console.log('[Synth] Frequency bars component initialized');
  }

  // Resize canvases
  if (freqVizCanvas) {
    freqVizCanvas.width = freqVizCanvas.offsetWidth;
    freqVizCanvas.height = freqVizCanvas.offsetHeight;
  }
  if (waveformCanvas) {
    waveformCanvas.width = waveformCanvas.offsetWidth;
    waveformCanvas.height = waveformCanvas.offsetHeight;
  }
  if (spectrumCanvas) {
    spectrumCanvas.width = spectrumCanvas.offsetWidth;
    spectrumCanvas.height = spectrumCanvas.offsetHeight;
  }

  // Start visualization loop
  visualize();

  // Setup volume control
  const synthGainFader = document.getElementById("synthGainFader");
  const synthGainValue = document.getElementById("synthGainValue");

  if (synthGainFader) {
    synthGainFader.addEventListener("input", (e) => {
      const value = parseInt(e.target.value);
      const gain = value / 127.0;
      if (masterGainNode) {
        masterGainNode.gain.value = gain;
      }
      synthGainValue.textContent = Math.round(gain * 100) + "%";
    });
    // Initialize display
    synthGainValue.textContent = "100%";
  }

  // Setup output device selector
  const synthOutputDeviceList = document.getElementById(
    "synthOutputDeviceList",
  );
  if (
    synthOutputDeviceList &&
    navigator.mediaDevices &&
    navigator.mediaDevices.enumerateDevices
  ) {
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        const audioOutputs = devices.filter(
          (device) => device.kind === "audiooutput",
        );
        synthOutputDeviceList.innerHTML =
          '<option value="">Default Output</option>';
        audioOutputs.forEach((device) => {
          const option = document.createElement("option");
          option.value = device.deviceId;
          option.textContent =
            device.label || `Output ${device.deviceId.slice(0, 8)}`;
          synthOutputDeviceList.appendChild(option);
        });
      })
      .catch((err) => {
        console.warn("[Synth] Could not enumerate audio devices:", err);
      });

    synthOutputDeviceList.addEventListener("change", async (e) => {
      const deviceId = e.target.value;
      if (audioContext && audioContext.setSinkId) {
        try {
          await audioContext.setSinkId(deviceId || "");
          console.log(
            "[Synth] Audio output changed to:",
            deviceId || "default",
          );
        } catch (err) {
          console.error("[Synth] Failed to change audio output:", err);
        }
      } else {
        console.warn("[Synth] setSinkId not supported in this browser");
      }
    });
  }

  // Setup fullscreen for drum pads
  setupDrumPadsFullscreen();
  
  // Setup fullscreen for keyboard
  setupKeyboardFullscreen();
});

// Setup fullscreen functionality for drum pads
function setupDrumPadsFullscreen() {
  const drumPads = document.querySelector('.drum-pads');
  const btnFullscreen = document.getElementById('btnDrumFullscreen');
  if (!drumPads || !btnFullscreen) return;

  // Button click to enter fullscreen
  btnFullscreen.addEventListener('click', () => {
    if (drumPads.requestFullscreen) {
      drumPads.requestFullscreen();
    } else if (drumPads.webkitRequestFullscreen) {
      drumPads.webkitRequestFullscreen();
    } else if (drumPads.msRequestFullscreen) {
      drumPads.msRequestFullscreen();
    }
  });

  // Handle clicks on the exit button (::after pseudo-element)
  drumPads.addEventListener('click', (e) => {
    if (!document.fullscreenElement) return;
    
    // Check if click is in the top-right corner (exit button area)
    const rect = drumPads.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    
    // Exit button is at top-right: 10px from top, 10px from right, 32x32px
    if (clickX >= rect.width - 42 && clickX <= rect.width - 10 &&
        clickY >= 10 && clickY <= 42) {
      document.exitFullscreen();
    }
  });

  console.log('[Fullscreen] Drum pads fullscreen button enabled');
}

// Setup fullscreen functionality for keyboard
function setupKeyboardFullscreen() {
  const keyboardContainer = document.getElementById('keyboardContainer');
  const btnFullscreen = document.getElementById('btnKeyboardFullscreen');
  if (!keyboardContainer || !btnFullscreen) return;

  // Button click to enter fullscreen
  btnFullscreen.addEventListener('click', () => {
    if (keyboardContainer.requestFullscreen) {
      keyboardContainer.requestFullscreen();
    } else if (keyboardContainer.webkitRequestFullscreen) {
      keyboardContainer.webkitRequestFullscreen();
    } else if (keyboardContainer.msRequestFullscreen) {
      keyboardContainer.msRequestFullscreen();
    }
  });

  // Handle clicks on the exit button (::after pseudo-element)
  keyboardContainer.addEventListener('click', (e) => {
    if (!document.fullscreenElement) return;
    
    // Check if click is in the top-right corner (exit button area)
    const rect = keyboardContainer.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    
    // Exit button is at top-right: 10px from top, 10px from right, 32x32px
    if (clickX >= rect.width - 42 && clickX <= rect.width - 10 &&
        clickY >= 10 && clickY <= 42) {
      document.exitFullscreen();
    }
  });

  console.log('[Fullscreen] Keyboard fullscreen button enabled');
}
