// Regroove Effects - WASM ONLY VERSION
// NO FALLBACK - Requires compiled WebAssembly

import { wakeLockManager } from './external/wakelock.js';

class AudioEffectsProcessor {
  constructor() {
    this.audioContext = null;
    this.sourceNode = null;
    this.analyser = null;
    this.isPlaying = false;
    this.audioBuffer = null;
    this.micStream = null;
    this.selectedMicDeviceId = null;
    this.masterGain = null;
    this.playbackRate = 1.0; // Tempo control

    this.wasmModule = null;
    this.workletNode = null;

    // Stereo peaks from worklet for VU meter
    this.stereoPeaks = { left: 0, right: 0 };

    // Streaming playback
    this.mediaElementSource = null;
    this.audioElement = null;
    this.isStreaming = false;

    // Video playback
    this.videoElement = null;
    this.isVideo = false;

    // MOD/MED player
    this.modMedModule = null;
    this.modMedPlayer = null;
    this.modMedScriptNode = null;
    this.isModMedPlaying = false;
    this.modMedAnimationFrame = null;

    // Playlist management
    this.playlist = [];
    this.currentTrackIndex = 0;
  }

  async init() {
    console.log("🚀 Initializing Regroove Effects (WASM ONLY)");

    this.audioContext = new (
      window.AudioContext || window.webkitAudioContext
    )();

    // Create master gain node
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 1.0; // Unity gain (0 dB)

    // Create analyser
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;

    // Audio graph: worklet → masterGain → analyser → destination
    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination);

    await this.initWasm();

    console.log("✅ WASM READY - Using Real C Code!");

    await this.enumerateDevices();
  }

  async initWasm() {
    console.log("📡 Loading WASM files...");

    // Load both the JS and WASM files from main thread
    const [jsResponse, wasmResponse] = await Promise.all([
      fetch("players/regroove-effects.js"),
      fetch("players/regroove-effects.wasm"),
    ]);

    if (!jsResponse.ok || !wasmResponse.ok) {
      throw new Error("❌ WASM files not found! Run: cd web && ./build.sh");
    }

    console.log("📦 Reading WASM...");
    const jsCode = await jsResponse.text();
    const wasmBytes = await wasmResponse.arrayBuffer();

    console.log("🎛️ Registering AudioWorklet...");
    await this.audioContext.audioWorklet.addModule(
      "worklets/audio-worklet-processor.js",
    );

    console.log("🔧 Creating worklet...");
    this.workletNode = new AudioWorkletNode(
      this.audioContext,
      "wasm-effects-processor",
    );

    // Wait for worklet to ask for WASM
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Worklet timeout")),
        10000,
      );

      this.workletNode.port.onmessage = (e) => {
        if (e.data.type === "needWasm") {
          console.log("📨 Sending WASM to worklet...");
          this.workletNode.port.postMessage(
            {
              type: "wasmBytes",
              data: {
                jsCode: jsCode,
                wasmBytes: wasmBytes,
              },
            },
            [wasmBytes],
          );
        } else if (e.data.type === "ready") {
          clearTimeout(timeout);
          console.log("✅ Worklet ready!");
          resolve();
        } else if (e.data.type === "error") {
          clearTimeout(timeout);
          reject(new Error(`Worklet: ${e.data.error}`));
        } else if (e.data.type === "peakLevel") {
          // Update M1 TRIM LED indicator
          this.updateTrimLED(e.data.level);
        } else if (e.data.type === "stereoPeaks") {
          // Update stereo peaks for VU meter
          this.stereoPeaks.left = e.data.left;
          this.stereoPeaks.right = e.data.right;
        }
      };
    });

    this.workletNode.connect(this.masterGain);

    console.log("🎉 COMPLETE!");
    console.log("🔊 Audio: Source → WASM → Master Gain → Speakers");
  }

  async initModMedPlayer() {
    console.log("📡 Loading Deck Player WASM (MOD/MED/AHX/SID)...");

    try {
      const createDeckPlayerModule =
        await import("./players/deck-player.js").then((m) => m.default);
      this.modMedModule = await createDeckPlayerModule();

      console.log(
        "Module keys:",
        Object.keys(this.modMedModule).filter((k) => !k.startsWith("_")),
      );
      console.log("Has HEAPU8:", !!this.modMedModule.HEAPU8);
      console.log("Has wasmMemory:", !!this.modMedModule.wasmMemory);
      console.log("Has _malloc:", typeof this.modMedModule._malloc);

      this.modMedPlayer = this.modMedModule._deck_player_create_wasm(
        this.audioContext.sampleRate,
      );

      console.log("✅ Deck Player ready (MOD/MED/AHX/SID)!");
      return true;
    } catch (error) {
      console.warn("⚠️ Deck Player not available:", error.message);
      return false;
    }
  }

  async enumerateDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === "audioinput");
      const audioOutputs = devices.filter((d) => d.kind === "audiooutput");

      // Populate input device selector
      const inputSelector = document.getElementById("micDeviceList");
      inputSelector.innerHTML = '<option value="">Default Microphone</option>';

      audioInputs.forEach((device) => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent =
          device.label || `Microphone ${inputSelector.options.length}`;
        inputSelector.appendChild(option);
      });

      if (audioInputs.length > 0) {
        // Show mic selector by default (no file loaded yet)
        document.getElementById("audioSourceInfo").style.display = "block";
        document.getElementById("micDeviceList").style.display = "block";
        document.getElementById("currentFileName").style.display = "none";
      }

      inputSelector.onchange = () => {
        this.selectedMicDeviceId = inputSelector.value || null;
        console.log(
          "🎤 Selected input device:",
          inputSelector.options[inputSelector.selectedIndex].text,
        );
      };

      // Populate output device selector
      const outputSelector = document.getElementById("outputDeviceList");
      outputSelector.innerHTML =
        '<option value="">Default Output Device</option>';

      audioOutputs.forEach((device) => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent =
          device.label || `Speaker ${outputSelector.options.length}`;
        outputSelector.appendChild(option);
      });

      outputSelector.onchange = async () => {
        const deviceId = outputSelector.value || "";
        await this.setOutputDevice(deviceId);
        console.log(
          "🔊 Selected output device:",
          outputSelector.options[outputSelector.selectedIndex].text,
        );
      };
    } catch (error) {
      console.warn("Could not enumerate devices:", error);
    }
  }

  async setOutputDevice(deviceId) {
    try {
      // setSinkId is supported on AudioContext.destination in modern browsers
      if (typeof this.audioContext.setSinkId === "function") {
        await this.audioContext.setSinkId(deviceId);
        console.log(`✅ Output routed to: ${deviceId || "default"}`);
      } else if (
        this.audioElement &&
        typeof this.audioElement.setSinkId === "function"
      ) {
        // Fallback: set sink on audio element for streaming playback
        await this.audioElement.setSinkId(deviceId);
        console.log(
          `✅ Audio element output routed to: ${deviceId || "default"}`,
        );
      } else {
        console.warn("⚠️ setSinkId not supported in this browser");
      }
    } catch (error) {
      console.error("❌ Failed to set output device:", error);
    }
  }

  toggleEffect(name, enabled) {
    this.workletNode.port.postMessage({
      type: "toggle",
      data: { name, enabled },
    });
  }

  setParameter(effectName, paramName, value) {
    this.workletNode.port.postMessage({
      type: "setParam",
      data: { effect: effectName, param: paramName, value },
    });
  }

  setMasterGain(value) {
    // value is 0-127 from fader
    // Map to 0-100% linearly (0 = 0%, 127 = 100%)
    const percentage = (value / 127) * 100;
    const gainLinear = value / 127; // 0.0 to 1.0

    this.masterGain.gain.value = gainLinear;

    return percentage;
  }

  setTempo(value) {
    // value is 0-127 from fader
    // 64 = 100% (neutral)
    // 0 = 90% (10% slower)
    // 127 = 110% (10% faster)

    // Map with exact center at 64 = 100%
    let percentage;
    if (value <= 64) {
      // 0-64 maps to 90-100%
      percentage = 90 + (value / 64) * 10;
    } else {
      // 65-127 maps to 100-110%
      percentage = 100 + ((value - 64) / 63) * 10;
    }
    const playbackRate = percentage / 100;

    // Apply tempo to streaming audio
    if (this.audioElement && this.isStreaming) {
      this.audioElement.playbackRate = playbackRate;
    }

    // For buffered audio (BufferSource), we can't change tempo on the fly
    // It would require restarting with a new playback rate
    // We'll just store it for the next time play() is called
    this.playbackRate = playbackRate;

    return percentage;
  }

  updateTrimLED(peakLevel) {
    const led = document.getElementById("trim-drive-led");
    if (!led) return;

    // LED glows based on peak level (matching plugin behavior)
    // Starts glowing at 0.5 (-6dB), full red at 1.0+ (0dB/clipping)
    const threshold = 0.5;
    let glow = (peakLevel - threshold) / (1.0 - threshold);
    glow = Math.max(0, Math.min(glow, 1)); // Clamp 0-1

    // Fill the circle based on glow level
    if (glow > 0.01) {
      const r = Math.round(180 + glow * 75); // 180 -> 255
      led.style.backgroundColor = `rgb(${r}, 0, 0)`;
      const shadowIntensity = 3 + glow * 8;
      led.style.boxShadow = `
                0 0 ${shadowIntensity}px rgba(255, 0, 0, ${glow * 0.8}),
                inset 0 0 3px rgba(255, 255, 255, ${glow * 0.3})
            `;
    } else {
      // Dark/off state
      led.style.backgroundColor = "#300";
      led.style.boxShadow = "inset 0 1px 2px rgba(0,0,0,0.5)";
    }
  }

  async detectTrackerFormat(file) {
    // Read first 1084 bytes to detect format by magic bytes
    // Supports: MOD, MED, AHX, SID
    const buffer = await file.slice(0, 1084).arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // MOD: Check offset 1080 for signature (M.K., M!K!, FLT4, FLT8, etc.)
    if (bytes.length >= 1084) {
      const sig = String.fromCharCode(
        bytes[1080],
        bytes[1081],
        bytes[1082],
        bytes[1083],
      );
      if (
        sig === "M.K." ||
        sig === "M!K!" ||
        sig === "FLT4" ||
        sig === "FLT8" ||
        sig === "6CHN" ||
        sig === "8CHN" ||
        sig.endsWith("CHN")
      ) {
        console.log("✅ Detected: ProTracker MOD");
        return true;
      }
    }

    // MED/MMD: Check offset 0 for 'MMD0', 'MMD1', 'MMD2', 'MMD3'
    if (bytes.length >= 4) {
      const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
      if (
        sig === "MMD0" ||
        sig === "MMD1" ||
        sig === "MMD2" ||
        sig === "MMD3"
      ) {
        console.log("✅ Detected: OctaMED MMD" + sig.charAt(3));
        return true;
      }
    }

    // AHX/HVL: Check offset 0 for 'THX'
    if (bytes.length >= 3) {
      const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
      if (sig === "THX") {
        console.log("✅ Detected: AHX/HVL");
        return true;
      }
    }

    // SID: Check offset 0 for 'PSID' or 'RSID'
    if (bytes.length >= 4) {
      const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
      if (sig === "PSID" || sig === "RSID") {
        console.log("✅ Detected: Commodore 64 SID");
        return true;
      }
    }

    return false;
  }

  async loadAudioFile(file) {
    if (!file) {
      console.error('❌ No file provided to loadAudioFile');
      return;
    }

    console.log(
      `📂 Loading: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`,
    );

    // Detect tracker files by reading file header (magic bytes)
    const isTracker = await this.detectTrackerFormat(file);
    if (isTracker) {
      await this.loadModMedFile(file);
      return;
    }

    // Skip UI updates if we're in a playlist (keeps currentFileName visible)
    const inPlaylist = this.playlist.length > 1;
    this.cleanupAudioElement(inPlaylist);

    // Detect if file is video based on extension or MIME type
    const videoExtensions = ['.mp4', '.webm', '.ogv', '.mov', '.avi', '.mkv', '.m4v'];
    const isVideoExt = videoExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
    const isVideoMime = file.type && file.type.startsWith('video/');
    const isVideo = isVideoExt || isVideoMime;
    this.isVideo = isVideo;

    if (isVideo) {
      console.log('🎬 Detected video file');
      this.videoElement = document.createElement('video');
      this.videoElement.loop = true;
      this.audioElement = this.videoElement; // Use video element as audio source
      console.log('✅ Created video element:', this.videoElement);
      console.log('✅ Set audioElement to videoElement:', this.audioElement);
    } else {
      this.audioElement = new Audio();
      this.audioElement.loop = true;
      console.log('✅ Created audio element:', this.audioElement);
    }

    if (!this.audioElement) {
      console.error('❌ CRITICAL: audioElement is null after creation!');
      throw new Error('Failed to create audio/video element');
    }

    // Try blob URL first, fallback to data URL for immutable systems
    try {
      console.log(`📎 Setting src on ${isVideo ? 'video' : 'audio'} element...`);
      this.audioElement.src = URL.createObjectURL(file);
      console.log('✅ Blob URL set successfully');

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Blob URL timeout")),
          2000,
        );
        this.audioElement.oncanplay = () => {
          clearTimeout(timeout);
          resolve();
        };
        this.audioElement.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("Blob URL failed"));
        };
        this.audioElement.load();
      });

      console.log(`✅ Loaded via blob URL: ${file.name}`);
    } catch (error) {
      console.warn("Blob URL failed, using data URL fallback:", error.message);

      // Fallback: Read file as ArrayBuffer and convert to data URL
      const arrayBuffer = await file.arrayBuffer();
      const blob = new Blob([arrayBuffer], { type: file.type || "audio/wav" });
      const reader = new FileReader();

      const dataUrl = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      this.audioElement.src = dataUrl;

      await new Promise((resolve, reject) => {
        this.audioElement.oncanplay = resolve;
        this.audioElement.onerror = reject;
        this.audioElement.load();
      });

      console.log(`✅ Loaded via data URL: ${file.name}`);
    }

    this.isStreaming = true;
    this.loadedFile = file; // Store for offline rendering

    // Show file name, hide mic selector
    document.getElementById("audioSourceInfo").style.display = "block";
    document.getElementById("micDeviceList").style.display = "none";
    document.getElementById("currentFileName").style.display = "block";
    const fileNameText = document.getElementById("fileNameText");
    fileNameText.textContent = file.name;

    // Add video indicator and popup button if it's a video file
    if (this.isVideo) {
      console.log('📺 Video file loaded - click "Pop-out Video" button to view');
      fileNameText.innerHTML = `${file.name} <button id="videoPopupBtn" style="margin-left: 10px; padding: 3px 8px; font-size: 0.85em; cursor: pointer; background: #CF1A37; color: white; border: none; border-radius: 3px;">📺 Pop-out Video</button>`;

      // Attach event listener to video popup button
      setTimeout(() => {
        const videoBtn = document.getElementById('videoPopupBtn');
        if (videoBtn) {
          videoBtn.addEventListener('click', () => {
            console.log('🎬 Opening video popup window...');
            popOutVideo(this.videoElement);
          });
        }
      }, 0);
    }

    // Show RENDER button, hide TEST SIGNAL selector
    document.getElementById("renderBtn").style.display = "inline-block";
    document.getElementById("testSignal").style.display = "none";

    // Update page title
    document.title = `RFX: ${file.name}`;
  }

  cleanupAudioElement(skipUIUpdate = false) {
    if (this.mediaElementSource) {
      this.mediaElementSource.disconnect();
      this.mediaElementSource = null;
    }
    if (this.audioElement) {
      this.audioElement.pause();
      if (this.audioElement.src) {
        URL.revokeObjectURL(this.audioElement.src);
      }
      this.audioElement = null;
    }
    if (this.videoElement) {
      this.videoElement = null;
    }
    this.isStreaming = false;
    this.isVideo = false;
    this.loadedFile = null;

    // Skip UI updates when switching tracks within a playlist
    if (skipUIUpdate) {
      return;
    }

    // Hide RENDER button, show TEST SIGNAL selector
    document.getElementById("renderBtn").style.display = "none";
    document.getElementById("testSignal").style.display = "inline-block";

    // Hide file name, show mic selector (if available)
    // Note: Don't hide playlist nav buttons here - they're controlled by playlist state
    const micDeviceList = document.getElementById("micDeviceList");
    if (micDeviceList && micDeviceList.options.length > 0) {
      document.getElementById("audioSourceInfo").style.display = "block";
      document.getElementById("micDeviceList").style.display = "block";
      document.getElementById("currentFileName").style.display = "none";
    } else {
      document.getElementById("audioSourceInfo").style.display = "none";
    }

    // Reset page title
    document.title = "Regroove Effects Tester";
  }

  async loadModMedFile(file) {
    console.log(`🎵 Loading tracker file: ${file.name}`);

    // Initialize WASM player if not already done
    if (!this.modMedModule) {
      const success = await this.initModMedPlayer();
      if (!success) {
        console.error("❌ Failed to initialize Deck Player");
        return;
      }
    }

    // Clean up any existing playback
    this.cleanupAudioElement();
    this.cleanupModMedPlayer();

    // Read file data
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Get memory buffer (try wasmMemory first, then HEAPU8)
    const memoryBuffer = this.modMedModule.wasmMemory
      ? this.modMedModule.wasmMemory.buffer
      : this.modMedModule.HEAPU8.buffer;

    // Allocate memory in WASM and copy file data
    const dataPtr = this.modMedModule._malloc(uint8Array.length);
    const heap = new Uint8Array(memoryBuffer);
    heap.set(uint8Array, dataPtr);

    // Allocate filename string
    const filenameBytes = new TextEncoder().encode(file.name + "\0");
    const filenamePtr = this.modMedModule._malloc(filenameBytes.length);
    heap.set(filenameBytes, filenamePtr);

    // Load into player
    console.log(
      `Loading ${uint8Array.length} bytes at ptr 0x${dataPtr.toString(16)}`,
    );
    const success = this.modMedModule._deck_player_load_from_memory(
      this.modMedPlayer,
      dataPtr,
      uint8Array.length,
      filenamePtr,
    );

    console.log("Load result:", success);

    // Free temporary memory
    this.modMedModule._free(dataPtr);
    this.modMedModule._free(filenamePtr);

    if (!success) {
      console.error("❌ Failed to load tracker file");
      return;
    }

    // Get file info
    const typeNamePtr = this.modMedModule._deck_player_get_type_name_wasm(
      this.modMedPlayer,
    );
    let typeName = "";
    if (typeNamePtr) {
      const heap8 = new Uint8Array(memoryBuffer);
      const typeNameBytes = [];
      let i = 0;
      while (heap8[typeNamePtr + i] !== 0) {
        typeNameBytes.push(heap8[typeNamePtr + i]);
        i++;
      }
      typeName = new TextDecoder().decode(new Uint8Array(typeNameBytes));
    }
    const numChannels = this.modMedModule._deck_player_get_num_channels_wasm(
      this.modMedPlayer,
    );
    const songLength = this.modMedModule._deck_player_get_song_length_wasm(
      this.modMedPlayer,
    );

    console.log(`✅ Loaded ${typeName}: ${file.name}`);
    console.log(
      `   Channels: ${numChannels}, Song length: ${songLength} positions`,
    );

    // Update UI
    document.getElementById("modmedTypeName").textContent =
      `${typeName}: ${file.name}`;
    document.getElementById("modmedSongLength").textContent =
      songLength > 0 ? String(songLength).padStart(2, "0") : "--";
    document.getElementById("audioSourceInfo").style.display = "block";
    document.getElementById("micDeviceList").style.display = "none";
    document.getElementById("currentFileName").style.display = "none";

    // Show MOD/MED controls
    document.getElementById("modmedControls").style.display = "block";

    // Create channel mute buttons
    const channelMutesContainer = document.getElementById("modmedChannelMutes");
    channelMutesContainer.innerHTML = "";
    for (let i = 0; i < numChannels; i++) {
      const button = document.createElement("button");
      button.className = "modmed-channel-button";
      button.textContent = `${i + 1}`;
      button.dataset.channel = i;
      button.onclick = () => {
        const muted = this.modMedModule._deck_player_get_channel_mute_wasm(
          this.modMedPlayer,
          i,
        );
        this.modMedModule._deck_player_set_channel_mute_wasm(
          this.modMedPlayer,
          i,
          muted ? 0 : 1,
        );
        button.classList.toggle("muted", !muted);
      };
      channelMutesContainer.appendChild(button);
    }

    // Wire up pattern navigation buttons
    document.getElementById("modmedPrevPattern").onclick = () => {
      this.modMedModule._deck_player_prev_pattern(this.modMedPlayer);
    };
    document.getElementById("modmedNextPattern").onclick = () => {
      this.modMedModule._deck_player_next_pattern(this.modMedPlayer);
    };

    let loopPattern = false;
    document.getElementById("modmedLoopPattern").onclick = () => {
      loopPattern = !loopPattern;
      this.modMedModule._deck_player_set_loop_pattern(
        this.modMedPlayer,
        loopPattern ? 1 : 0,
      );
      document
        .getElementById("modmedLoopPattern")
        .classList.toggle("active", loopPattern);
    };

    // Create audio processing node
    const bufferSize = 4096;
    this.modMedScriptNode = this.audioContext.createScriptProcessor(
      bufferSize,
      0,
      2,
    );

    const audioBufferPtr =
      this.modMedModule._deck_create_audio_buffer(bufferSize);

    // Zero the buffer initially
    const memBuf = this.modMedModule.wasmMemory
      ? this.modMedModule.wasmMemory.buffer
      : this.modMedModule.HEAPU8.buffer;
    const initialBuffer = new Float32Array(
      memBuf,
      audioBufferPtr,
      bufferSize * 2,
    );
    initialBuffer.fill(0);

    this.modMedScriptNode.onaudioprocess = (e) => {
      const leftOut = e.outputBuffer.getChannelData(0);
      const rightOut = e.outputBuffer.getChannelData(1);
      const actualBufferSize = leftOut.length;

      if (!this.isModMedPlaying) {
        // Output silence if not playing
        leftOut.fill(0);
        rightOut.fill(0);
        return;
      }

      // Get fresh memory buffer reference
      const currentMemBuffer = this.modMedModule.wasmMemory
        ? this.modMedModule.wasmMemory.buffer
        : this.modMedModule.HEAPU8.buffer;

      // Generate audio from WASM player
      // Apply tempo via pitch: pitch = 1.0 / playbackRate
      // Lower pitch (< 1.0) = lower sample rate to player = faster playback
      // Higher pitch (> 1.0) = higher sample rate to player = slower playback
      const pitch = 1.0 / this.playbackRate;
      const adjustedSampleRate = this.audioContext.sampleRate * pitch;

      this.modMedModule._deck_player_process_f32(
        this.modMedPlayer,
        audioBufferPtr,
        actualBufferSize,
        adjustedSampleRate,
      );

      // Copy planar stereo data to output buffers
      // C outputs: LEFT in first half, RIGHT in second half
      const audioData = new Float32Array(
        currentMemBuffer,
        audioBufferPtr,
        actualBufferSize * 2,
      );

      // Copy planar data directly
      for (let i = 0; i < actualBufferSize; i++) {
        leftOut[i] = audioData[i]; // First half = LEFT
        rightOut[i] = audioData[actualBufferSize + i]; // Second half = RIGHT
      }
    };

    // Connect to audio graph
    this.modMedScriptNode.connect(this.workletNode);

    // Start UI update loop
    this.updateModMedUI();

    // Update page title
    document.title = `RFX: ${file.name}`;

    // Enable play button
    updatePlaybackButtons();

    console.log("✅ Deck Player ready");
  }

  cleanupModMedPlayer() {
    // Stop playback
    if (this.isModMedPlaying) {
      this.stopModMed();
    }

    // Cancel animation frame
    if (this.modMedAnimationFrame) {
      cancelAnimationFrame(this.modMedAnimationFrame);
      this.modMedAnimationFrame = null;
    }

    // Disconnect audio node
    if (this.modMedScriptNode) {
      this.modMedScriptNode.disconnect();
      this.modMedScriptNode = null;
    }

    // Hide UI
    const modmedControls = document.getElementById("modmedControls");
    if (modmedControls) {
      modmedControls.style.display = "none";
    }
  }

  playModMed() {
    if (!this.modMedPlayer) return;

    this.modMedModule._deck_player_start_wasm(this.modMedPlayer);
    this.isModMedPlaying = true;
    this.isPlaying = true;
    console.log("▶️ MOD/MED playback started");
  }

  stopModMed() {
    if (!this.modMedPlayer) return;

    this.modMedModule._deck_player_stop_wasm(this.modMedPlayer);
    this.isModMedPlaying = false;
    this.isPlaying = false;
    console.log("⏹ MOD/MED playback stopped");
  }

  updateModMedUI() {
    if (!this.modMedPlayer || !this.isModMedPlaying) {
      // Schedule next update even if not playing (for UI responsiveness)
      if (this.modMedPlayer) {
        this.modMedAnimationFrame = requestAnimationFrame(() =>
          this.updateModMedUI(),
        );
      }
      return;
    }

    // Get current position
    const order = this.modMedModule._deck_player_get_current_order(
      this.modMedPlayer,
    );
    const row = this.modMedModule._deck_player_get_current_row(
      this.modMedPlayer,
    );
    const bpm = this.modMedModule._deck_player_get_bpm_wasm(this.modMedPlayer);

    // Update display
    document.getElementById("modmedOrderPos").textContent = order
      .toString()
      .padStart(2, "0");
    document.getElementById("modmedRowPos").textContent = row
      .toString()
      .padStart(3, "0");
    document.getElementById("modmedBpm").textContent = bpm
      .toString()
      .padStart(3, " ");

    // Schedule next update
    this.modMedAnimationFrame = requestAnimationFrame(() =>
      this.updateModMedUI(),
    );
  }

  async startMicrophone() {
    // Stop any playing audio first
    if (this.sourceNode && this.sourceNode.stop) {
      try {
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch (e) {
        // Already stopped
      }
      this.sourceNode = null;
    }

    // Stop any existing microphone
    if (this.micStream) {
      this.stopMicrophone();
    }

    // CRITICAL: Resume AudioContext (browsers suspend it until user interaction)
    if (this.audioContext.state !== "running") {
      console.log(`⚠️ AudioContext state: ${this.audioContext.state}`);
      await this.audioContext.resume();
      console.log(`✅ AudioContext resumed: ${this.audioContext.state}`);
    }

    // Request stereo audio input
    const constraints = {
      audio: {
        deviceId: this.selectedMicDeviceId
          ? { exact: this.selectedMicDeviceId }
          : undefined,
        channelCount: 2, // Request stereo
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    };

    console.log("🎤 Starting microphone...");
    this.micStream = await navigator.mediaDevices.getUserMedia(constraints);

    // Log actual track settings
    const track = this.micStream.getAudioTracks()[0];
    const settings = track.getSettings();
    console.log(
      `   Track settings: ${settings.channelCount} channels @ ${settings.sampleRate}Hz`,
    );

    const source = this.audioContext.createMediaStreamSource(this.micStream);

    // CRITICAL: Preserve stereo channels
    source.channelCount = 2;
    source.channelCountMode = "explicit";
    source.channelInterpretation = "speakers";

    this.sourceNode = source;

    console.log("🔗 Mic → WASM");
    console.log(`   Source channels: ${source.channelCount}`);
    this.sourceNode.connect(this.workletNode);

    this.isPlaying = true;
    console.log("✅ Microphone active");
    console.log(`   AudioContext: ${this.audioContext.state}`);
    console.log(`   Sample rate: ${this.audioContext.sampleRate}Hz`);
  }

  stopMicrophone() {
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    this.isPlaying = false;
    console.log("⏹ Microphone stopped");

    // Reset Drive LED when microphone stops
    this.updateTrimLED(0);
  }

  pause() {
    if (!this.isPlaying) return;

    // Handle MOD/MED playback
    if (this.modMedPlayer && this.isModMedPlaying) {
      this.stopModMed();
      console.log("⏸ Paused (MOD/MED)");
      return;
    }

    if (this.isStreaming && this.audioElement) {
      // Pause streaming audio
      this.audioElement.pause();
      this.isPlaying = false;
      console.log("⏸ Paused (streaming)");
    } else if (this.sourceNode) {
      // For buffer sources, we can't truly pause - just suspend the context
      this.audioContext.suspend();
      this.isPlaying = false;
      console.log("⏸ Paused (buffer)");
    }
  }

  async resume() {
    if (this.isPlaying) return;

    // Handle MOD/MED playback
    if (this.modMedPlayer && this.modMedScriptNode) {
      this.playModMed();
      console.log("▶️ Resumed (MOD/MED)");
      return;
    }

    if (this.isStreaming && this.audioElement) {
      // Resume streaming audio
      await this.audioElement.play();
      this.isPlaying = true;
      console.log("▶️ Resumed (streaming)");
    } else if (this.audioBuffer) {
      // Resume buffer playback
      await this.audioContext.resume();
      this.isPlaying = true;
      console.log("▶️ Resumed (buffer)");
    }
  }

  async play() {
    // Stop microphone if active
    if (this.micStream) {
      this.stopMicrophone();
    }

    // Stop any existing playback
    if (this.sourceNode && this.sourceNode.stop) {
      try {
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch (e) {
        // Already stopped
      }
    }

    // Resume AudioContext if suspended
    if (this.audioContext.state !== "running") {
      await this.audioContext.resume();
      console.log("✅ AudioContext resumed");
    }

    // Handle MOD/MED playback
    if (this.modMedPlayer && this.modMedScriptNode) {
      this.playModMed();
      return;
    }

    if (this.isStreaming && this.audioElement) {
      console.log("▶️ Streaming playback...");

      if (!this.mediaElementSource) {
        this.mediaElementSource = this.audioContext.createMediaElementSource(
          this.audioElement,
        );
        console.log("🔗 Stream → WASM → Speakers");
        this.mediaElementSource.connect(this.workletNode);
      }

      // Set up ended event for playlist auto-advance
      this.audioElement.onended = async () => {
        console.log("⏹ Stream ended");

        // If in playlist mode, auto-advance to next track
        if (this.playlist.length > 1) {
          console.log("📋 Auto-advancing to next track...");
          await playNextTrack();
          updatePlaybackButtons();
        } else {
          this.isPlaying = false;
          updatePlaybackButtons();
        }
      };

      // Apply tempo (playback rate)
      this.audioElement.playbackRate = this.playbackRate;
      // Set loop based on playlist mode
      this.audioElement.loop = this.playlist.length <= 1;

      await this.audioElement.play();
      this.isPlaying = true;
      console.log(
        `✅ Streaming at ${(this.playbackRate * 100).toFixed(1)}% tempo`,
      );
      console.log(`   Playlist mode: ${this.playlist.length > 1 ? "YES (no loop)" : "NO (loop)"}`);

      // Request wake lock to keep screen on during playback
      wakeLockManager.request();
    } else if (this.audioBuffer) {
      console.log("▶️ Playing (looped)...");
      console.log(
        `   Buffer: ${this.audioBuffer.duration.toFixed(1)}s, ${this.audioBuffer.numberOfChannels}ch`,
      );
      console.log(`   AudioContext state: ${this.audioContext.state}`);
      console.log(`   WorkletNode: ${this.workletNode ? "READY" : "MISSING!"}`);

      this.sourceNode = this.audioContext.createBufferSource();
      this.sourceNode.buffer = this.audioBuffer;

      // Only loop if NOT in playlist mode
      this.sourceNode.loop = this.playlist.length <= 1;
      this.sourceNode.playbackRate.value = this.playbackRate; // Apply tempo

      console.log(
        "🔗 Audio graph: BufferSource → WorkletNode → Analyser → Speakers",
      );
      console.log(
        `   Worklet connected to: ${this.workletNode.numberOfOutputs} outputs`,
      );
      console.log(`   Playlist mode: ${this.playlist.length > 1 ? "YES (no loop)" : "NO (loop)"}`);
      this.sourceNode.connect(this.workletNode);

      this.sourceNode.start(0);
      this.isPlaying = true;
      this.startTime = this.audioContext.currentTime;
      console.log(
        `✅ Playback started at ${this.startTime.toFixed(3)}s, ${(this.playbackRate * 100).toFixed(1)}% tempo`,
      );

      // Request wake lock to keep screen on during playback
      wakeLockManager.request();

      this.sourceNode.onended = async () => {
        console.log("⏹ Track ended");

        // If in playlist mode, auto-advance to next track
        if (this.playlist.length > 1) {
          console.log("📋 Auto-advancing to next track...");
          await playNextTrack();
          updatePlaybackButtons();
        } else {
          this.isPlaying = false;
          updatePlaybackButtons();
        }
      };
    }
  }

  generateTestSignal(type) {
    console.log(`🔊 Generating ${type} signal...`);

    // Clean up any loaded audio file first
    this.cleanupAudioElement();

    const duration = 5;
    const sampleRate = this.audioContext.sampleRate;
    const buffer = this.audioContext.createBuffer(
      2,
      duration * sampleRate,
      sampleRate,
    );

    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);

      if (type === "sine") {
        const freq = 440;
        for (let i = 0; i < data.length; i++) {
          data[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.5;
        }
      } else if (type === "noise") {
        for (let i = 0; i < data.length; i++) {
          data[i] = (Math.random() * 2 - 1) * 0.3;
        }
      } else if (type === "sweep") {
        const startFreq = 20;
        const endFreq = 20000;
        const logRatio = Math.log(endFreq / startFreq);

        // Exponential sweep with continuous phase
        for (let i = 0; i < data.length; i++) {
          const t = i / sampleRate;
          const progress = t / duration;

          // Phase accumulation for exponential sweep (integral of frequency)
          // phase(t) = 2π * f0 * T / ln(f1/f0) * [(f1/f0)^(t/T) - 1]
          const phase =
            ((2 * Math.PI * startFreq * duration) / logRatio) *
            (Math.exp(logRatio * progress) - 1);

          data[i] = Math.sin(phase) * 0.3;
        }
      }
    }

    this.audioBuffer = buffer;
    console.log("✅ Test signal ready");
  }

  stop() {
    // Handle MOD/MED playback
    if (this.modMedPlayer && this.isModMedPlaying) {
      this.stopModMed();
      return;
    }

    // Clear playlist when stopping
    this.playlist = [];
    this.currentTrackIndex = 0;

    // Clean up audio file/stream
    this.cleanupAudioElement();

    if (this.sourceNode && this.sourceNode.stop) {
      try {
        // Create a fade-out gain node
        const fadeGain = this.audioContext.createGain();
        const fadeTime = 0.05;
        const now = this.audioContext.currentTime;

        // Reconnect through fade gain
        this.sourceNode.disconnect();
        this.sourceNode.connect(fadeGain);
        fadeGain.connect(this.workletNode);

        // Fade out
        fadeGain.gain.setValueAtTime(1.0, now);
        fadeGain.gain.linearRampToValueAtTime(0, now + fadeTime);

        // Stop after fade
        setTimeout(
          () => {
            try {
              if (this.sourceNode) {
                this.sourceNode.stop();
                this.sourceNode.disconnect();
                this.sourceNode = null;
              }
              fadeGain.disconnect();
            } catch (e) {
              // Ignore - already stopped
            }
          },
          fadeTime * 1000 + 10,
        );
      } catch (e) {
        // Fallback - just stop immediately
        try {
          this.sourceNode.stop();
          this.sourceNode.disconnect();
          this.sourceNode = null;
        } catch (e2) {
          // Ignore
        }
      }
    }
    this.stopMicrophone();
    this.isPlaying = false;

    // Release wake lock when playback stops
    wakeLockManager.release();

    // Clear audio buffer (for test signals)
    this.audioBuffer = null;

    // Reset Drive LED when playback stops
    this.updateTrimLED(0);
  }

  getCurrentPosition() {
    if (this.audioElement && this.isStreaming) {
      return {
        current: this.audioElement.currentTime,
        duration: this.audioElement.duration || 0,
      };
    }
    if (this.audioBuffer && this.isPlaying && this.startTime !== undefined) {
      const elapsed = this.audioContext.currentTime - this.startTime;
      const position = elapsed % this.audioBuffer.duration;
      return {
        current: position,
        duration: this.audioBuffer.duration,
      };
    }
    return { current: 0, duration: 0 };
  }

  seek(time) {
    // Only streaming audio (audioElement) supports seeking
    if (this.audioElement && this.isStreaming) {
      this.audioElement.currentTime = time;
      console.log(`⏩ Seeked to ${time.toFixed(1)}s`);
    } else if (this.audioBuffer && this.isPlaying) {
      // For buffered audio, we need to restart from the new position
      const wasPlaying = this.isPlaying;
      this.stop();
      if (wasPlaying) {
        this.sourceNode = this.audioContext.createBufferSource();
        this.sourceNode.buffer = this.audioBuffer;
        this.sourceNode.loop = true;
        this.sourceNode.playbackRate.value = this.playbackRate; // Apply tempo
        this.sourceNode.connect(this.workletNode);
        this.sourceNode.start(0, time % this.audioBuffer.duration);
        this.isPlaying = true;
        this.startTime = this.audioContext.currentTime - time;
        console.log(`⏩ Seeked to ${time.toFixed(1)}s (restarted buffer)`);
      }
    }
  }

  getAnalyserData() {
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteTimeDomainData(dataArray);
    return dataArray;
  }

  async renderToWav() {
    if (!this.loadedFile) {
      console.error("❌ No file loaded to render!");
      return;
    }

    try {
      console.log("🎬 Starting offline render...");

      // Decode the audio file
      const arrayBuffer = await this.loadedFile.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

      const sampleRate = audioBuffer.sampleRate;
      const duration = audioBuffer.duration;
      const channels = audioBuffer.numberOfChannels;

      console.log(
        `📊 Input: ${duration.toFixed(2)}s, ${sampleRate}Hz, ${channels}ch`,
      );

      // Create offline context
      const offlineContext = new OfflineAudioContext(
        channels,
        audioBuffer.length,
        sampleRate,
      );

      // Load WASM into offline context
      console.log("📡 Loading worklet into offline context...");
      try {
        // Fetch the worklet code and create a blob URL for offline context
        const workletResponse = await fetch(
          "worklets/audio-worklet-processor.js",
        );
        const workletCode = await workletResponse.text();
        const workletBlob = new Blob([workletCode], {
          type: "application/javascript",
        });
        const workletURL = URL.createObjectURL(workletBlob);

        await offlineContext.audioWorklet.addModule(workletURL);
        URL.revokeObjectURL(workletURL);
      } catch (err) {
        console.error("❌ Failed to load worklet module:", err);
        throw new Error("Failed to load audio worklet: " + err.message);
      }

      // Create worklet node
      const offlineWorklet = new AudioWorkletNode(
        offlineContext,
        "wasm-effects-processor",
      );

      // Send WASM to offline worklet
      const [jsResponse, wasmResponse] = await Promise.all([
        fetch("players/regroove-effects.js"),
        fetch("players/regroove-effects.wasm"),
      ]);
      const jsCode = await jsResponse.text();
      const wasmBytes = await wasmResponse.arrayBuffer();

      await new Promise((resolve) => {
        offlineWorklet.port.onmessage = (e) => {
          if (e.data.type === "needWasm") {
            offlineWorklet.port.postMessage(
              {
                type: "wasmBytes",
                data: {
                  jsCode: jsCode,
                  wasmBytes: wasmBytes,
                },
              },
              [wasmBytes],
            );
          } else if (e.data.type === "ready") {
            resolve();
          }
        };
      });

      // Copy all effect parameters from live worklet to offline worklet
      const state = await new Promise((resolve) => {
        const handler = (e) => {
          if (e.data.type === "state") {
            this.workletNode.port.removeEventListener("message", handler);
            console.log("📊 Got state:", e.data.state);
            resolve(e.data.state);
          }
        };
        this.workletNode.port.addEventListener("message", handler);
        this.workletNode.port.postMessage({ type: "getState" });
      });

      console.log("📤 Sending state to offline worklet...");

      // Wait for confirmation that state was applied
      await new Promise((resolve) => {
        const handler = (e) => {
          if (e.data.type === "stateApplied") {
            offlineWorklet.port.removeEventListener("message", handler);
            console.log("✅ Offline worklet state applied");
            resolve();
          }
        };
        offlineWorklet.port.addEventListener("message", handler);
        offlineWorklet.port.postMessage({ type: "setState", state });
      });

      // Create source and connect
      const source = offlineContext.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = this.playbackRate; // Apply tempo
      source.connect(offlineWorklet);
      offlineWorklet.connect(offlineContext.destination);

      // Render
      source.start();
      console.log(
        `🎵 Rendering at ${(this.playbackRate * 100).toFixed(1)}% tempo`,
      );
      const renderedBuffer = await offlineContext.startRendering();

      console.log("✅ Rendering complete!");

      // Convert to WAV
      const wavBlob = this.audioBufferToWav(renderedBuffer);

      // Download
      const fileName = this.loadedFile.name.replace(
        /\.[^.]+$/,
        "_processed.wav",
      );
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);

      console.log(`💾 Downloaded: ${fileName}`);
    } catch (error) {
      console.error("❌ Render error:", error);
    }
  }

  audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;

    const data = [];
    for (let i = 0; i < buffer.length; i++) {
      for (let channel = 0; channel < numChannels; channel++) {
        let sample = buffer.getChannelData(channel)[i];
        // Clamp
        sample = Math.max(-1, Math.min(1, sample));
        // Convert to 16-bit PCM
        sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        data.push(sample);
      }
    }

    const dataLength = data.length * bytesPerSample;
    const buffer_array = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer_array);

    // Write WAV header
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataLength, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true); // byte rate
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, "data");
    view.setUint32(40, dataLength, true);

    // Write audio data
    let offset = 44;
    for (let i = 0; i < data.length; i++) {
      view.setInt16(offset, data[i], true);
      offset += 2;
    }

    return new Blob([buffer_array], { type: "audio/wav" });
  }
}

// UI Controller
const processor = new AudioEffectsProcessor();
let visualizerAnimationId = null;

// ============================================================================
// Visualization Components - EXTRACTED from inline code
// ============================================================================
// BEFORE: 173 lines of inline drawVUMeter() + 40 lines of inline drawVisualizer() + 26 lines of inline drawSpectrum()
// AFTER: Using extracted component classes from /web/components/
// Result: ~239 lines of inline code → simple component API calls
// 100% identical rendering to original code
// ============================================================================
let vuMeterComponent = null;
let waveformComponent = null;
let spectrumComponent = null;
let freqBarsComponent = null;
let showFreqViz = false; // Toggle between VU meter and freq-viz

// MODEL 1 input effects (all enabled by default)
// Display order: TRIM → HPF → SCULPT → LPF
const model1EffectDefinitions = [
  {
    name: "model1_trim",
    title: "Trim",
    params: ["drive"],
    enabledByDefault: true,
  },
  {
    name: "model1_hpf",
    title: "Contour (HPF)",
    params: ["cutoff"],
    enabledByDefault: true,
  },
  {
    name: "model1_sculpt",
    title: "Sculpt (Cut/Boost)",
    params: ["frequency", "gain"],
    enabledByDefault: true,
  },
  {
    name: "model1_lpf",
    title: "Contour (LPF)",
    params: ["cutoff"],
    enabledByDefault: true,
  },
];

// Standard effects (with on/off toggle)
const effectDefinitions = [
  { name: "distortion", title: "Distortion", params: ["drive", "mix"] },
  {
    name: "limiter",
    title: "Limiter",
    params: ["threshold", "release", "ceiling", "lookahead"],
  },
  { name: "filter", title: "Filter", params: ["cutoff", "resonance"] },
  { name: "eq", title: "EQ", params: ["low", "mid", "high"] },
  {
    name: "compressor",
    title: "Compressor",
    params: ["threshold", "ratio", "attack", "release", "makeup"],
  },
  { name: "delay", title: "Delay", params: ["time", "feedback", "mix"] },
  { name: "reverb", title: "Reverb", params: ["size", "damping", "mix"] },
  { name: "phaser", title: "Phaser", params: ["rate", "depth", "feedback"] },
  { name: "stereo_widen", title: "Stereo Widening", params: ["width", "mix"] },
  { name: "ring_mod", title: "Ring Modulator", params: ["frequency", "mix"] },
  { name: "pitchshift", title: "Pitch Shift", params: ["pitch", "mix"] },
  {
    name: "lofi",
    title: "Lo-Fi",
    params: [
      "bit_depth",
      "sample_rate_ratio",
      "filter_cutoff",
      "saturation",
      "noise_level",
      "wow_flutter_depth",
      "wow_flutter_rate",
    ],
  },
];

function createModel1UI() {
  const container = document.getElementById("model1-effects");
  if (!container) return;

  model1EffectDefinitions.forEach((def) => {
    const card = document.createElement("div");
    card.className = "effect-card";
    card.id = `effect-${def.name}`;

    const header = document.createElement("div");
    header.className = "effect-header";

    const title = document.createElement("div");
    title.className = "effect-title";
    title.textContent = def.title;

    // Add toggle switch for all MODEL 1 effects
    const toggle = document.createElement("div");
    const enabledByDefault = def.enabledByDefault || false;
    toggle.className = enabledByDefault
      ? "toggle-switch active"
      : "toggle-switch";
    toggle.dataset.enabled = enabledByDefault ? "true" : "false";
    toggle.onclick = () => {
      const enabled = toggle.dataset.enabled !== "true";
      toggle.dataset.enabled = enabled;
      processor.toggleEffect(def.name, enabled);
      toggle.classList.toggle("active", enabled);
      card.classList.toggle("enabled", enabled);

      // CRITICAL: Re-send current parameter values when enabling
      if (enabled) {
        def.params.forEach((paramName) => {
          const knob = document.getElementById(`${def.name}-${paramName}-knob`);
          if (knob) {
            const value = parseFloat(knob.getAttribute("value")) / 100;
            processor.setParameter(def.name, paramName, value);
            console.log(
              `[Toggle] Restoring ${def.name}.${paramName} = ${value}`,
            );
          }
        });
      }
    };
    header.appendChild(toggle);
    if (enabledByDefault) {
      card.classList.add("enabled");
    }

    header.appendChild(title);
    card.appendChild(header);

    // Create knobs container for parameters
    const knobsContainer = document.createElement("div");
    knobsContainer.style.cssText =
      "display: flex; gap: 10px; margin-top: 10px; flex-wrap: wrap; justify-content: center;";

    def.params.forEach((paramName, idx) => {
      // Set defaults based on effect and parameter
      let defaultValue = 50;
      if (def.name === "model1_trim" && paramName === "drive") {
        defaultValue = 70; // 0.7 = neutral, no drive
      } else if (def.name === "model1_hpf" && paramName === "cutoff") {
        defaultValue = 0; // FLAT (20Hz)
      } else if (def.name === "model1_lpf" && paramName === "cutoff") {
        defaultValue = 100; // FLAT (20kHz)
      } else if (def.name === "model1_sculpt") {
        if (paramName === "frequency") {
          defaultValue = 50; // Mid frequency
        } else if (paramName === "gain") {
          defaultValue = 50; // 0dB (neutral)
        }
      }

      // Container for knob + LED
      const knobWrapper = document.createElement("div");
      const isTrim = def.name === "model1_trim" && paramName === "drive";
      knobWrapper.style.cssText = isTrim
        ? "display: flex; flex-direction: row; align-items: center; gap: 20px;"
        : "display: flex; flex-direction: column; align-items: center;";

      // Use pad-knob component for each parameter
      const knob = document.createElement("pad-knob");
      knob.id = `${def.name}-${paramName}-knob`;
      // For TRIM effect, label it as "TRIM" not "DRIVE"
      knob.setAttribute("label", isTrim ? "TRIM" : paramName.toUpperCase());
      knob.setAttribute("cc", String(idx + 1));
      knob.setAttribute("value", String(defaultValue));
      knob.setAttribute("default", String(defaultValue));
      knob.setAttribute("min", "0");
      knob.setAttribute("max", "100");
      knob.style.cssText = "width: 100px; height: 140px;";

      // Listen for value changes
      knob.addEventListener("cc-change", (e) => {
        const value = e.detail.value / 100;
        processor.setParameter(def.name, paramName, value);
      });

      knobWrapper.appendChild(knob);

      // Add LED indicator for TRIM drive
      if (isTrim) {
        const ledContainer = document.createElement("div");
        ledContainer.style.cssText =
          "display: flex; flex-direction: column; align-items: center; gap: 5px;";

        const led = document.createElement("div");
        led.id = "trim-drive-led";
        led.style.cssText = `
                    width: 18px;
                    height: 18px;
                    border-radius: 50%;
                    background-color: #300;
                    border: 2px solid #666;
                    box-shadow: inset 0 1px 2px rgba(0,0,0,0.5);
                    transition: background-color 0.05s, box-shadow 0.05s;
                `;

        const ledLabel = document.createElement("div");
        ledLabel.textContent = "DRIVE";
        ledLabel.style.cssText =
          "color: #aaa; font-size: 11px; font-weight: bold; margin-top: 2px;";

        ledContainer.appendChild(led);
        ledContainer.appendChild(ledLabel);
        knobWrapper.appendChild(ledContainer);

        // Store LED reference for later updates
        window.trimDriveLED = led;
      }

      knobsContainer.appendChild(knobWrapper);
    });

    card.appendChild(knobsContainer);
    container.appendChild(card);
  });

  // Set default values for Model 1 effects
  processor.setParameter("model1_trim", "drive", 0.7);
  processor.setParameter("model1_hpf", "cutoff", 0.0); // FLAT (20Hz)
  processor.setParameter("model1_lpf", "cutoff", 1.0); // FLAT (20kHz)
  processor.setParameter("model1_sculpt", "frequency", 0.5); // Mid frequency
  processor.setParameter("model1_sculpt", "gain", 0.5); // 0dB neutral
}

// Essential effects (Distortion, EQ, Filter, Reverb)
const essentialEffects = ["distortion", "eq", "filter", "reverb"];

// Split effect definitions
const essentialEffectDefinitions = effectDefinitions.filter(def => 
  essentialEffects.includes(def.name)
);

const additionalEffectDefinitions = effectDefinitions.filter(def => 
  !essentialEffects.includes(def.name)
);

function createEffectUI() {
  createEffectsForContainer("essential-effects", essentialEffectDefinitions);
  createEffectsForContainer("additional-effects", additionalEffectDefinitions);
}

function createEffectsForContainer(containerId, definitions) {
  const container = document.getElementById(containerId);
  if (!container) return;

  definitions.forEach((def) => {
    const card = document.createElement("div");
    card.className = "effect-card";
    card.id = `effect-${def.name}`;

    const header = document.createElement("div");
    header.className = "effect-header";

    const title = document.createElement("div");
    title.className = "effect-title";
    title.textContent = def.title;

    const toggle = document.createElement("div");
    toggle.className = "toggle-switch";
    toggle.dataset.enabled = "false";
    toggle.onclick = () => {
      const enabled = toggle.dataset.enabled !== "true";
      toggle.dataset.enabled = enabled;
      processor.toggleEffect(def.name, enabled);
      toggle.classList.toggle("active", enabled);
      card.classList.toggle("enabled", enabled);

      // CRITICAL: Re-send current parameter values when enabling
      if (enabled) {
        def.params.forEach((paramName) => {
          const knob = document.getElementById(`${def.name}-${paramName}-knob`);
          if (knob) {
            const value = parseFloat(knob.getAttribute("value")) / 100; // 0-1 normalized
            processor.setParameter(def.name, paramName, value);
            console.log(
              `[Toggle] Restoring ${def.name}.${paramName} = ${value}`,
            );
          }
        });
      }
    };

    header.appendChild(title);
    header.appendChild(toggle);
    card.appendChild(header);

    // Create knobs container for parameters
    const knobsContainer = document.createElement("div");
    knobsContainer.style.cssText =
      "display: flex; gap: 10px; margin-top: 10px; flex-wrap: wrap; justify-content: center;";

    def.params.forEach((paramName, idx) => {
      let defaultValue = 50;

      // Special defaults for lofi to start clean/transparent
      if (def.name === "lofi") {
        if (paramName === "bit_depth")
          defaultValue = 100; // 16-bit (clean)
        else if (paramName === "sample_rate_ratio")
          defaultValue = 100; // 100% (no reduction)
        else if (paramName === "filter_cutoff")
          defaultValue = 100; // 20kHz (no filtering)
        else if (paramName === "saturation")
          defaultValue = 0; // No saturation
        else if (paramName === "noise_level")
          defaultValue = 0; // No noise
        else if (paramName === "wow_flutter_depth")
          defaultValue = 0; // No wow/flutter
        else if (paramName === "wow_flutter_rate") defaultValue = 50; // Mid-range (doesn't matter if depth=0)
      }

      // Use pad-knob component for each parameter
      const knob = document.createElement("pad-knob");
      knob.id = `${def.name}-${paramName}-knob`;
      knob.setAttribute("label", paramName.toUpperCase());
      knob.setAttribute("cc", String(idx + 1));
      knob.setAttribute("value", String(defaultValue));
      knob.setAttribute("default", String(defaultValue));
      knob.setAttribute("min", "0");
      knob.setAttribute("max", "100");
      knob.style.cssText = "width: 100px; height: 140px;";

      // Listen for value changes
      knob.addEventListener("cc-change", (e) => {
        const value = e.detail.value / 100; // 0-1 normalized
        processor.setParameter(def.name, paramName, value);
      });

      knobsContainer.appendChild(knob);
    });

    card.appendChild(knobsContainer);

    container.appendChild(card);
  });
}

function drawSpectrum() {
  if (!spectrumComponent) return;
  spectrumComponent.draw(processor.analyser);
}

function drawVUMeter() {
  if (!vuMeterComponent) return;

  // Get stereo peaks from worklet
  const leftPeak = processor.stereoPeaks.left;
  const rightPeak = processor.stereoPeaks.right;

  // Update and draw - component handles all the rendering!
  vuMeterComponent.update(leftPeak, rightPeak);
  vuMeterComponent.draw();
}

function drawFreqViz() {
  if (!freqBarsComponent || !processor.analyser) return;

  // Get frequency data
  const bufferLength = processor.analyser.frequencyBinCount;
  const frequencyData = new Uint8Array(bufferLength);
  processor.analyser.getByteFrequencyData(frequencyData);

  // Calculate frequency bands from raw analyser data
  const sampleRate = processor.audioContext.sampleRate;
  const nyquist = sampleRate / 2;
  const binWidth = nyquist / bufferLength;

  // Define frequency ranges (Hz)
  const bassMax = 250;
  const midMax = 2000;

  // Calculate bins for each range
  const bassBins = Math.floor(bassMax / binWidth);
  const midBins = Math.floor(midMax / binWidth);

  // Calculate average amplitude for each band
  let bassSum = 0, midSum = 0, highSum = 0;
  let bassCount = 0, midCount = 0, highCount = 0;

  for (let i = 0; i < bufferLength; i++) {
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

function updatePlaybackPosition() {
  const pos = processor.getCurrentPosition();
  const progressContainer = document.getElementById("playbackProgress");

  if (pos.duration > 0) {
    progressContainer.style.visibility = "visible";

    const formatTime = (seconds) => {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    document.getElementById("currentTime").textContent = formatTime(
      pos.current,
    );
    document.getElementById("totalTime").textContent = formatTime(pos.duration);
    document.getElementById("progressBar").style.width =
      `${(pos.current / pos.duration) * 100}%`;
  } else {
    progressContainer.style.visibility = "hidden";
  }
}

async function drawVisualizer() {
  // Initialize visualization components (WASM-backed)
  if (!vuMeterComponent) {
    vuMeterComponent = new VUMeterCanvas("vumeter");
    await vuMeterComponent.init(); // Initialize WASM (tests shared C code!)
  }
  if (!waveformComponent) {
    waveformComponent = new WaveformDisplayCanvas("visualizer");
    // Waveform uses direct oscilloscope mode (no WASM init needed for draw())
    // But WASM is available for optional buffered mode
  }
  if (!spectrumComponent) {
    spectrumComponent = new SpectrumAnalyzerCanvas("spectrum");
  }
  if (!freqBarsComponent) {
    freqBarsComponent = new FrequencyBarsCanvas("freq-viz-player");
  }

  // Resize canvases
  const spectrumCanvas = document.getElementById("spectrum");
  if (spectrumCanvas) {
    spectrumCanvas.width = spectrumCanvas.offsetWidth;
    spectrumCanvas.height = spectrumCanvas.offsetHeight;
  }

  const vuCanvas = document.getElementById("vumeter");
  if (vuCanvas) {
    vuCanvas.width = vuCanvas.offsetWidth;
    vuCanvas.height = vuCanvas.offsetHeight;
  }

  const freqVizCanvas = document.getElementById("freq-viz-player");
  if (freqVizCanvas) {
    freqVizCanvas.width = freqVizCanvas.offsetWidth;
    freqVizCanvas.height = freqVizCanvas.offsetHeight;
  }

  // Setup toggle button
  const toggleBtn = document.getElementById("toggleVuFreq");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      showFreqViz = !showFreqViz;
      const vuCanvas = document.getElementById("vumeter");
      const freqVizCanvas = document.getElementById("freq-viz-player");

      // Close any open popups for the old mode
      if (showFreqViz) {
        // Switching to freq-viz, close VU meter popup if open
        if (window.popupWindows && window.popupWindows.has('vumeter')) {
          const popupData = window.popupWindows.get('vumeter');
          if (popupData.window && !popupData.window.closed) {
            popupData.window.close();
          }
          window.popupWindows.delete('vumeter');
        }
        vuCanvas.style.display = "none";
        freqVizCanvas.style.display = "block";
        toggleBtn.textContent = "FREQ ⇄ VU";

        // Resize freq-viz canvas when showing it
        freqVizCanvas.width = freqVizCanvas.offsetWidth;
        freqVizCanvas.height = freqVizCanvas.offsetHeight;
      } else {
        // Switching to VU meter, close freq-viz popup if open
        if (window.popupWindows && window.popupWindows.has('freq-viz-player')) {
          const popupData = window.popupWindows.get('freq-viz-player');
          if (popupData.window && !popupData.window.closed) {
            popupData.window.close();
          }
          window.popupWindows.delete('freq-viz-player');
        }
        vuCanvas.style.display = "block";
        freqVizCanvas.style.display = "none";
        toggleBtn.textContent = "VU ⇄ FREQ";

        // Resize VU canvas when showing it
        vuCanvas.width = vuCanvas.offsetWidth;
        vuCanvas.height = vuCanvas.offsetHeight;
      }
    });
  }

  // Animation loop
  const draw = () => {
    visualizerAnimationId = requestAnimationFrame(draw);

    // Get analyser data
    const dataArray = processor.getAnalyserData();

    // Update all visualizations using extracted components
    if (waveformComponent && dataArray) {
      waveformComponent.draw(dataArray);
    }

    drawSpectrum();

    // Draw VU meter or freq-viz based on toggle
    if (showFreqViz) {
      drawFreqViz();
    } else {
      drawVUMeter();
    }

    updatePlaybackPosition();

    // Draw to popup windows if open
    if (window.popupWindows && window.popupWindows.size > 0) {
      window.popupWindows.forEach((popupData, canvasId) => {
        if (popupData.window.closed) {
          window.popupWindows.delete(canvasId);
          return;
        }
        
        const popupCtx = popupData.canvas.getContext('2d');
        const popupCanvas = popupData.canvas;

        if (canvasId === 'visualizer' && dataArray && waveformComponent) {
          // Use the waveform component to draw to popup canvas
          const originalCanvas = waveformComponent.canvas;
          const originalCtx = waveformComponent.ctx;
          
          waveformComponent.canvas = popupCanvas;
          waveformComponent.ctx = popupCtx;
          waveformComponent.draw(dataArray);
          
          waveformComponent.canvas = originalCanvas;
          waveformComponent.ctx = originalCtx;
        } else if (canvasId === 'spectrum' && spectrumComponent) {
          // Use the spectrum component to draw to popup canvas
          const originalCanvas = spectrumComponent.canvas;
          const originalCtx = spectrumComponent.ctx;
          
          spectrumComponent.canvas = popupCanvas;
          spectrumComponent.ctx = popupCtx;
          spectrumComponent.draw(processor.analyser);
          
          spectrumComponent.canvas = originalCanvas;
          spectrumComponent.ctx = originalCtx;
        } else if (canvasId === 'vumeter' && vuMeterComponent) {
          // Use the VU meter component to draw to popup canvas
          const originalCanvas = vuMeterComponent.canvas;
          const originalCtx = vuMeterComponent.ctx;

          vuMeterComponent.canvas = popupCanvas;
          vuMeterComponent.ctx = popupCtx;
          vuMeterComponent.draw();

          vuMeterComponent.canvas = originalCanvas;
          vuMeterComponent.ctx = originalCtx;
        } else if (canvasId === 'freq-viz-player' && freqBarsComponent) {
          // Draw frequency bars to popup canvas
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
          popupCtx.fillStyle = "#0a0a0a";
          popupCtx.fillRect(0, 0, popupCanvas.width, popupCanvas.height);

          const drawRoundedBar = (x, height, gradient) => {
            const y = padding + barAreaHeight - height;
            const cornerRadius = 2;
            popupCtx.fillStyle = gradient;
            popupCtx.beginPath();
            popupCtx.moveTo(x + cornerRadius, y);
            popupCtx.lineTo(x + barWidth - cornerRadius, y);
            popupCtx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + cornerRadius);
            popupCtx.lineTo(x + barWidth, padding + barAreaHeight - cornerRadius);
            popupCtx.quadraticCurveTo(x + barWidth, padding + barAreaHeight, x + barWidth - cornerRadius, padding + barAreaHeight);
            popupCtx.lineTo(x + cornerRadius, padding + barAreaHeight);
            popupCtx.quadraticCurveTo(x, padding + barAreaHeight, x, padding + barAreaHeight - cornerRadius);
            popupCtx.lineTo(x, y + cornerRadius);
            popupCtx.quadraticCurveTo(x, y, x + cornerRadius, y);
            popupCtx.closePath();
            popupCtx.fill();
          };

          // Use already-smoothed current bands
          const cb = freqBarsComponent.currentBands;

          // Bass bar
          const bassHeight = Math.max(2, cb.bass * barAreaHeight);
          const gradient1 = popupCtx.createLinearGradient(0, padding + barAreaHeight, 0, padding + barAreaHeight - bassHeight);
          gradient1.addColorStop(0, '#CF1A37');
          gradient1.addColorStop(1, '#ff3333');
          drawRoundedBar(barX[0], bassHeight, gradient1);

          // Mid bar
          const midHeight = Math.max(2, cb.mid * barAreaHeight);
          const gradient2 = popupCtx.createLinearGradient(0, padding + barAreaHeight, 0, padding + barAreaHeight - midHeight);
          gradient2.addColorStop(0, '#CF1A37');
          gradient2.addColorStop(1, '#ff3333');
          drawRoundedBar(barX[1], midHeight, gradient2);

          // High bar
          const highHeight = Math.max(2, cb.high * barAreaHeight);
          const gradient3 = popupCtx.createLinearGradient(0, padding + barAreaHeight, 0, padding + barAreaHeight - highHeight);
          gradient3.addColorStop(0, '#CF1A37');
          gradient3.addColorStop(1, '#ff3333');
          drawRoundedBar(barX[2], highHeight, gradient3);

          // Labels
          popupCtx.fillStyle = '#666';
          popupCtx.font = '10px Arial';
          popupCtx.textAlign = 'center';
          const labelY = padding + barAreaHeight + labelHeight / 2 + 3;
          popupCtx.fillText('Bass', barX[0] + barWidth / 2, labelY);
          popupCtx.fillText('Mid', barX[1] + barWidth / 2, labelY);
          popupCtx.fillText('High', barX[2] + barWidth / 2, labelY);
        }
      });
    }
  };

  draw();
}

function updatePlaybackButtons() {
  const hasAudio =
    processor.audioBuffer !== null ||
    processor.isStreaming ||
    processor.modMedPlayer;
  const playBtn = document.getElementById("playBtn");
  const stopBtn = document.getElementById("stopBtn");

  if (processor.isPlaying) {
    playBtn.textContent = "⏸ Pause";
    playBtn.disabled = false;
  } else {
    playBtn.textContent = "▶ Play";
    playBtn.disabled = !hasAudio;
  }

  stopBtn.disabled = !processor.isPlaying;
}

// =======================================
// PLAYLIST MANAGEMENT
// =======================================

async function loadPlaylist(files) {
  console.log(`📋 Loading playlist with ${files.length} files`);

  // Clean up any existing playback (including MOD/MED)
  processor.stop();
  processor.cleanupModMedPlayer();

  // Store files in playlist
  processor.playlist = files;
  processor.currentTrackIndex = 0;

  // Update playlist UI
  updatePlaylistUI();

  // Load first track
  await processor.loadAudioFile(files[0]);
}

function updatePlaylistUI() {
  const playlistSection = document.getElementById('playlistSection');
  const totalTracks = document.getElementById('totalTracks');
  const playlistTrackList = document.getElementById('playlistTrackList');
  const playlistNavButtons = document.getElementById('playlistNavButtons');

  if (processor.playlist.length > 1) {
    // Show playlist UI and navigation buttons
    playlistSection.style.display = 'block';
    playlistNavButtons.style.display = 'flex';
    totalTracks.textContent = processor.playlist.length;

    // Build track list
    playlistTrackList.innerHTML = '';
    processor.playlist.forEach((file, index) => {
      const trackItem = document.createElement('div');
      trackItem.style.cssText = `
        padding: 8px 12px;
        margin-bottom: 5px;
        background: ${index === processor.currentTrackIndex ? 'rgba(207, 26, 55, 0.2)' : 'var(--bg-secondary)'};
        border: 1px solid ${index === processor.currentTrackIndex ? '#CF1A37' : 'var(--border)'};
        border-radius: 3px;
        cursor: pointer;
        transition: background 0.2s;
        display: flex;
        align-items: center;
        gap: 10px;
      `;

      // Track number
      const trackNum = document.createElement('span');
      trackNum.textContent = `${index + 1}.`;
      trackNum.style.cssText = `
        color: var(--text-secondary);
        font-weight: bold;
        min-width: 30px;
        font-family: monospace;
      `;

      // Track name
      const trackName = document.createElement('span');
      trackName.textContent = file.name;
      trackName.style.cssText = `
        color: ${index === processor.currentTrackIndex ? '#CF1A37' : 'var(--text-primary)'};
        font-weight: ${index === processor.currentTrackIndex ? 'bold' : 'normal'};
        flex: 1;
      `;

      trackItem.appendChild(trackNum);
      trackItem.appendChild(trackName);

      // Click to play track
      trackItem.addEventListener('click', async () => {
        if (index !== processor.currentTrackIndex) {
          // Stop current playback WITHOUT full cleanup (we're switching tracks, not stopping)
          if (processor.modMedPlayer && processor.isModMedPlaying) {
            processor.stopModMed();
          }
          if (processor.audioElement) {
            processor.audioElement.pause();
          }
          if (processor.sourceNode && processor.sourceNode.stop) {
            try {
              processor.sourceNode.stop();
              processor.sourceNode.disconnect();
              processor.sourceNode = null;
            } catch (e) {
              // Already stopped
            }
          }
          processor.isPlaying = false;

          processor.currentTrackIndex = index;
          // Don't call updatePlaylistUI() here - it will be called after loading
          await processor.loadAudioFile(processor.playlist[index]);
          updatePlaylistUI(); // Update after file is loaded
          await processor.play();
          updatePlaybackButtons(); // Sync button states
        }
      });

      // Hover effect
      trackItem.addEventListener('mouseenter', () => {
        if (index !== processor.currentTrackIndex) {
          trackItem.style.background = 'rgba(207, 26, 55, 0.1)';
        }
      });
      trackItem.addEventListener('mouseleave', () => {
        if (index !== processor.currentTrackIndex) {
          trackItem.style.background = 'var(--bg-secondary)';
        }
      });

      playlistTrackList.appendChild(trackItem);
    });
  } else {
    // Hide playlist UI and navigation buttons for single file
    playlistSection.style.display = 'none';
    playlistNavButtons.style.display = 'none';
  }
}

// Setup playlist collapse functionality
function setupPlaylistCollapse() {
  const playlistSectionTitle = document.getElementById('playlistSectionTitle');
  const playlistContent = document.getElementById('playlistContent');
  const playlistToggle = document.getElementById('playlistToggle');
  let isCollapsed = false;

  playlistSectionTitle.addEventListener('click', () => {
    isCollapsed = !isCollapsed;

    if (isCollapsed) {
      playlistContent.style.maxHeight = '0';
      playlistToggle.style.transform = 'rotate(-90deg)';
      playlistToggle.textContent = '▶';
    } else {
      playlistContent.style.maxHeight = '400px';
      playlistToggle.style.transform = 'rotate(0deg)';
      playlistToggle.textContent = '▼';
    }
  });
}

async function playNextTrack() {
  if (processor.playlist.length === 0) return;

  // Stop current playback WITHOUT full cleanup (we're switching tracks, not stopping)
  if (processor.modMedPlayer && processor.isModMedPlaying) {
    processor.stopModMed();
  }
  if (processor.audioElement) {
    processor.audioElement.pause();
  }
  if (processor.sourceNode && processor.sourceNode.stop) {
    try {
      processor.sourceNode.stop();
      processor.sourceNode.disconnect();
      processor.sourceNode = null;
    } catch (e) {
      // Already stopped
    }
  }
  processor.isPlaying = false;

  processor.currentTrackIndex = (processor.currentTrackIndex + 1) % processor.playlist.length;
  console.log(`⏭️ Next track: ${processor.currentTrackIndex + 1}/${processor.playlist.length}`);

  updatePlaylistUI();
  await processor.loadAudioFile(processor.playlist[processor.currentTrackIndex]);

  // Auto-play next track
  await processor.play();
  updatePlaybackButtons();
}

async function playPrevTrack() {
  if (processor.playlist.length === 0) return;

  // Stop current playback WITHOUT full cleanup (we're switching tracks, not stopping)
  if (processor.modMedPlayer && processor.isModMedPlaying) {
    processor.stopModMed();
  }
  if (processor.audioElement) {
    processor.audioElement.pause();
  }
  if (processor.sourceNode && processor.sourceNode.stop) {
    try {
      processor.sourceNode.stop();
      processor.sourceNode.disconnect();
      processor.sourceNode = null;
    } catch (e) {
      // Already stopped
    }
  }
  processor.isPlaying = false;

  processor.currentTrackIndex = (processor.currentTrackIndex - 1 + processor.playlist.length) % processor.playlist.length;
  console.log(`⏮️ Previous track: ${processor.currentTrackIndex + 1}/${processor.playlist.length}`);

  updatePlaylistUI();
  await processor.loadAudioFile(processor.playlist[processor.currentTrackIndex]);

  // Auto-play previous track
  await processor.play();
  updatePlaybackButtons();
}

// Event Listeners
document.getElementById("audioFile").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files);
  if (files.length > 0) {
    try {
      // Stop microphone if active when loading new audio
      if (processor.micStream) {
        processor.stopMicrophone();
      }
      processor.stop();

      // Load playlist (multiple files) or single file
      if (files.length > 1) {
        await loadPlaylist(files);
      } else {
        // Single file - clear playlist and load normally
        processor.playlist = [];
        processor.currentTrackIndex = 0;
        updatePlaylistUI();
        await processor.loadAudioFile(files[0]);
      }

      updatePlaybackButtons();
    } catch (error) {
      console.error("Error loading file(s):", error);
    }
  }
  // Clear the input value to allow reloading the same file
  e.target.value = "";
});

document.getElementById("micBtn").addEventListener("click", async () => {
  try {
    if (processor.micStream) {
      processor.stopMicrophone();
    } else {
      await processor.startMicrophone();
    }
    updatePlaybackButtons();
  } catch (error) {
    console.error("Mic error:", error);
  }
});

document.getElementById("playBtn").addEventListener("click", async () => {
  if (processor.isPlaying) {
    processor.pause();
  } else {
    // Check if we need to start from beginning or just resume
    const hasBeenStopped =
      (processor.audioBuffer && !processor.sourceNode) ||
      (processor.isStreaming &&
        processor.audioElement &&
        processor.audioElement.paused);

    if (hasBeenStopped || (!processor.sourceNode && !processor.audioElement)) {
      await processor.play();
    } else {
      await processor.resume();
    }
  }
  updatePlaybackButtons();
});

document.getElementById("stopBtn").addEventListener("click", () => {
  processor.stop();
  updatePlaybackButtons();
  updatePlaylistUI(); // Hide playlist UI and nav buttons
});

document.getElementById("renderBtn").addEventListener("click", async () => {
  await processor.renderToWav();
});

document.getElementById("testSignal").addEventListener("change", (e) => {
  if (e.target.value) {
    // Stop microphone if active (generating test signal is like loading a file)
    if (processor.micStream) {
      processor.stopMicrophone();
    }
    processor.generateTestSignal(e.target.value);

    // Show test signal name
    document.getElementById("audioSourceInfo").style.display = "block";
    document.getElementById("micDeviceList").style.display = "none";
    document.getElementById("currentFileName").style.display = "block";
    document.getElementById("fileNameText").textContent =
      `Test: ${e.target.value}`;

    // Update page title
    document.title = `RFX: Test ${e.target.value}`;

    updatePlaybackButtons();
    e.target.value = "";
  }
});

// Drag/click to seek on progress bar
(function () {
  const progressContainer = document.getElementById("playbackProgress");
  const progressBarBg = progressContainer.querySelector(
    'div[style*="background: var(--bg-tertiary)"]',
  );
  let isDragging = false;

  function seekToPosition(clientX) {
    if (!progressBarBg) return;

    const rect = progressBarBg.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));

    const pos = processor.getCurrentPosition();
    if (pos.duration > 0) {
      const seekTime = percentage * pos.duration;
      processor.seek(seekTime);
    }
  }

  // Mouse events
  progressContainer.addEventListener("mousedown", (e) => {
    isDragging = true;
    seekToPosition(e.clientX);
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (isDragging) {
      seekToPosition(e.clientX);
    }
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
  });

  // Touch events
  progressContainer.addEventListener("touchstart", (e) => {
    isDragging = true;
    seekToPosition(e.touches[0].clientX);
    e.preventDefault();
  });

  document.addEventListener("touchmove", (e) => {
    if (isDragging) {
      seekToPosition(e.touches[0].clientX);
    }
  });

  document.addEventListener("touchend", () => {
    isDragging = false;
  });
})();

// Playlist navigation buttons (top)
document.getElementById("btnPrevTrackTop").addEventListener("click", async () => {
  await playPrevTrack();
  updatePlaybackButtons();
});

document.getElementById("btnNextTrackTop").addEventListener("click", async () => {
  await playNextTrack();
  updatePlaybackButtons();
});

// Initialize
(async () => {
  try {
    await processor.init();
    createModel1UI();
    createEffectUI();
    await drawVisualizer();

    // Setup master gain fader after processor is initialized
    const gainFader = document.getElementById("gainFader");
    const gainValue = document.getElementById("gainValue");

    gainFader.addEventListener("change", (e) => {
      const value = parseFloat(e.target.value);
      const percentage = processor.setMasterGain(value);

      // Update display
      gainValue.textContent = `${percentage.toFixed(0)}%`;
    });

    // Set initial volume value (127 = 100%)
    processor.setMasterGain(127);
    gainValue.textContent = "100%";

    // Setup tempo fader
    const tempoFader = document.getElementById("tempoFader");
    const tempoValue = document.getElementById("tempoValue");

    tempoFader.addEventListener("change", (e) => {
      const value = parseFloat(e.target.value);
      const percentage = processor.setTempo(value);

      // Show as delta from 100%
      const delta = percentage - 100;
      const sign = delta > 0 ? "+" : "";
      tempoValue.textContent = `${sign}${delta.toFixed(1)}%`;
    });

    // Set initial tempo value (64 = 100% neutral)
    processor.setTempo(64);
    tempoValue.textContent = "0.0%";
    
    // Setup fullscreen functionality
    setupSectionFullscreen();

    // Setup playlist collapse
    setupPlaylistCollapse();
  } catch (error) {
    console.error("INIT ERROR:", error);
    console.error("Stack:", error.stack);
  }
})();

// Setup fullscreen functionality for sections
function setupSectionFullscreen() {
  const sections = [
    { btnId: 'btnModel1Fullscreen', sectionId: 'model1Section' },
    { btnId: 'btnEssentialFullscreen', sectionId: 'essentialEffectsSection' },
    { btnId: 'btnAdditionalFullscreen', sectionId: 'additionalEffectsSection' }
  ];

  sections.forEach(({ btnId, sectionId }) => {
    const btn = document.getElementById(btnId);
    const section = document.getElementById(sectionId);
    
    if (!btn || !section) return;

    // Button click to enter fullscreen
    btn.addEventListener('click', () => {
      if (section.requestFullscreen) {
        section.requestFullscreen();
      } else if (section.webkitRequestFullscreen) {
        section.webkitRequestFullscreen();
      } else if (section.msRequestFullscreen) {
        section.msRequestFullscreen();
      }
    });

    // Handle clicks on the exit button (::after pseudo-element)
    section.addEventListener('click', (e) => {
      if (!document.fullscreenElement) return;
      
      // Check if click is in the top-right corner (exit button area)
      const rect = section.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      
      // Exit button is at top-right: 10px from top, 10px from right, 32x32px
      if (clickX >= rect.width - 42 && clickX <= rect.width - 10 &&
          clickY >= 10 && clickY <= 42) {
        document.exitFullscreen();
      }
    });
  });

  console.log('[Fullscreen] Section fullscreen buttons enabled');
}
