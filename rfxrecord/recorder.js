// RegrooveFX Recorder - Multi-take audio recorder

class AudioRecorder {
  constructor() {
    this.audioContext = null;
    this.inputStream = null;
    this.inputSource = null;
    this.analyser = null;
    this.monitorGain = null;
    this.inputGain = null;
    this.isMonitoring = false;
    this.isRecording = false;
    this.selectedInputDeviceId = null;

    // MediaRecorder for recording
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.recordingStartTime = null;
    this.durationTimer = null;

    // Takes storage
    this.takes = [];
    this.takeCounter = 1;

    // Peaks for VU meter
    this.stereoPeaks = { left: 0, right: 0 };
    this.peakDetectionRunning = false;

    // IndexedDB for persistent storage
    this.db = null;
    this.dbName = 'RFXRecorderDB';
    this.dbVersion = 1;

    // Playback nodes
    this.playbackSource = null;
    this.playbackGain = null;
  }

  async init() {
    console.log("[Recorder] Initializing...");

    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // Create gain nodes
    this.inputGain = this.audioContext.createGain();
    this.inputGain.gain.value = 1.0;

    this.monitorGain = this.audioContext.createGain();
    this.monitorGain.gain.value = 0.5; // 50% monitor volume by default

    // Create analyser for visualization
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;

    // Create playback gain (for take playback)
    this.playbackGain = this.audioContext.createGain();
    this.playbackGain.gain.value = 1.0;

    // Initialize IndexedDB for persistent storage
    await this.initDatabase();

    // Load saved takes from IndexedDB
    await this.loadTakesFromDB();

    console.log("[Recorder] Ready");

    await this.enumerateDevices();

    // Initialize visualizations after analyser is created
    setTimeout(() => {
      if (typeof window.initVisualizations === 'function') {
        window.initVisualizations();
      }
    }, 100);
  }

  async initDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.error('Failed to open IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('[DB] IndexedDB opened');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create object store for takes
        if (!db.objectStoreNames.contains('takes')) {
          const objectStore = db.createObjectStore('takes', { keyPath: 'id' });
          objectStore.createIndex('timestamp', 'timestamp', { unique: false });
          console.log('[DB] Created "takes" object store');
        }
      };
    });
  }

  async loadTakesFromDB() {
    if (!this.db) {
      console.warn('Database not initialized');
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['takes'], 'readonly');
      const objectStore = transaction.objectStore('takes');
      const request = objectStore.getAll();

      request.onsuccess = () => {
        const savedTakes = request.result;

        if (savedTakes && savedTakes.length > 0) {
          console.log(`[DB] Loading ${savedTakes.length} saved take(s)...`);

          this.takes = savedTakes.map(take => ({
            ...take,
            blob: new Blob([take.audioData], { type: take.mimeType }),
            url: URL.createObjectURL(new Blob([take.audioData], { type: take.mimeType })),
            timestamp: new Date(take.timestamp)
          }));

          // Update takeCounter to avoid ID conflicts
          const maxId = Math.max(...this.takes.map(t => t.id), 0);
          this.takeCounter = maxId + 1;

          this.updateTakesList();

          // Show notification
          const totalSize = this.takes.reduce((sum, t) => sum + t.blob.size, 0);
          const sizeMB = (totalSize / (1024 * 1024)).toFixed(1);
          console.log(`[DB] Loaded ${this.takes.length} take(s) from storage (${sizeMB} MB)`);

          // Update takes section title to show loaded status
          const totalTakes = document.getElementById('totalTakes');
          if (totalTakes) {
            totalTakes.textContent = this.takes.length;
          }
        } else {
          console.log('[DB] No saved takes found');
        }

        resolve();
      };

      request.onerror = () => {
        console.error('Failed to load takes:', request.error);
        reject(request.error);
      };
    });
  }

  async saveTakeToDB(take) {
    if (!this.db) {
      console.warn('Database not initialized, cannot save take');
      return;
    }

    return new Promise((resolve, reject) => {
      // Convert blob to ArrayBuffer first
      const reader = new FileReader();

      reader.onload = () => {
        // Create transaction AFTER blob is read
        const transaction = this.db.transaction(['takes'], 'readwrite');
        const objectStore = transaction.objectStore('takes');

        const takeData = {
          id: take.id,
          name: take.name,
          duration: take.duration,
          timestamp: take.timestamp.toISOString(),
          mimeType: take.mimeType,
          audioData: reader.result // ArrayBuffer
        };

        const request = objectStore.put(takeData);

        request.onsuccess = () => {
          console.log(`[DB] Saved ${take.name}`);
          resolve();
        };

        request.onerror = () => {
          console.error('[DB] Failed to save take:', request.error);
          reject(request.error);
        };
      };

      reader.onerror = () => {
        console.error('[DB] Failed to read blob:', reader.error);
        reject(reader.error);
      };

      reader.readAsArrayBuffer(take.blob);
    });
  }

  async deleteTakeFromDB(takeId) {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['takes'], 'readwrite');
      const objectStore = transaction.objectStore('takes');
      const request = objectStore.delete(takeId);

      request.onsuccess = () => {
        console.log(`[DB] Deleted take ${takeId}`);
        resolve();
      };

      request.onerror = () => {
        console.error('Failed to delete take:', request.error);
        reject(request.error);
      };
    });
  }

  async clearAllTakesFromDB() {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['takes'], 'readwrite');
      const objectStore = transaction.objectStore('takes');
      const request = objectStore.clear();

      request.onsuccess = () => {
        console.log('[DB] Cleared all takes');
        resolve();
      };

      request.onerror = () => {
        console.error('Failed to clear takes:', request.error);
        reject(request.error);
      };
    });
  }

  async updateTakeNameInDB(takeId, newName) {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['takes'], 'readwrite');
      const objectStore = transaction.objectStore('takes');
      const request = objectStore.get(takeId);

      request.onsuccess = () => {
        const takeData = request.result;
        if (takeData) {
          takeData.name = newName;
          const updateRequest = objectStore.put(takeData);

          updateRequest.onsuccess = () => {
            console.log(`[DB] Updated take name`);
            resolve();
          };

          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          resolve(); // Take not found, that's okay
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  async enumerateDevices() {
    try {
      // Request permission first
      await navigator.mediaDevices.getUserMedia({ audio: true });

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');

      const inputList = document.getElementById('inputDeviceList');
      if (inputList) {
        inputList.innerHTML = '<option value="">Default Input</option>';
        audioInputs.forEach(device => {
          const option = document.createElement('option');
          option.value = device.deviceId;
          option.textContent = device.label || `Microphone ${device.deviceId.substr(0, 8)}`;
          inputList.appendChild(option);
        });

        inputList.addEventListener('change', async (e) => {
          this.selectedInputDeviceId = e.target.value || null;
          if (this.isMonitoring) {
            await this.stopMonitoring();
            await this.startMonitoring();
          }
        });
      }

      console.log(`Found ${audioInputs.length} audio input device(s)`);
    } catch (err) {
      console.error('Error enumerating devices:', err);
    }
  }

  getAudioConstraints() {
    const echoCancellation = document.getElementById('echoCancellationCheckbox')?.checked || false;
    const noiseSuppression = document.getElementById('noiseSuppressionCheckbox')?.checked || false;
    const autoGainControl = document.getElementById('autoGainControlCheckbox')?.checked || false;

    const constraints = {
      audio: {
        echoCancellation,
        noiseSuppression,
        autoGainControl,
        sampleRate: 48000,
        channelCount: 2
      }
    };

    if (this.selectedInputDeviceId) {
      constraints.audio.deviceId = { exact: this.selectedInputDeviceId };
    }

    return constraints;
  }

  async startMonitoring() {
    if (this.isMonitoring) {
      console.log("[Recorder] Already monitoring");
      return;
    }

    try {
      // Resume AudioContext if suspended (browsers auto-suspend)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
        console.log("[Recorder] AudioContext resumed");
      }

      const constraints = this.getAudioConstraints();
      console.log("[Recorder] Starting monitoring with constraints:", constraints);

      this.inputStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.inputSource = this.audioContext.createMediaStreamSource(this.inputStream);

      // Audio graph: inputSource → inputGain → analyser
      //                                      ↓
      //                              monitorGain → destination
      this.inputSource.connect(this.inputGain);
      this.inputGain.connect(this.analyser);
      this.inputGain.connect(this.monitorGain);
      this.monitorGain.connect(this.audioContext.destination);

      this.isMonitoring = true;
      this.updateUI();

      // Start peak detection for VU meter
      this.startPeakDetection();

      console.log("[Recorder] Monitoring started");
    } catch (err) {
      console.error("[Recorder] Failed to start monitoring:", err);
      if (window.showNotification) {
        window.showNotification("Failed to access microphone: " + err.message, 'error');
      }
    }
  }

  async stopMonitoring() {
    if (!this.isMonitoring) return;

    if (this.isRecording) {
      await this.stopRecording();
    }

    if (this.inputSource) {
      this.inputSource.disconnect();
      this.inputSource = null;
    }

    if (this.inputStream) {
      this.inputStream.getTracks().forEach(track => track.stop());
      this.inputStream = null;
    }

    this.isMonitoring = false;
    this.updateUI();

    console.log("[Recorder] Monitoring stopped");
  }

  startPeakDetection() {
    if (this.peakDetectionRunning) return;
    this.peakDetectionRunning = true;

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

    const detectPeaks = () => {
      if (!this.isMonitoring) {
        this.peakDetectionRunning = false;
        return;
      }

      this.analyser.getByteTimeDomainData(dataArray);

      // Simple peak detection (convert to -1 to +1 range)
      let peakL = 0;
      let peakR = 0;

      for (let i = 0; i < dataArray.length; i++) {
        const sample = Math.abs((dataArray[i] / 128.0) - 1.0);
        // Alternate between left and right for stereo simulation
        if (i % 2 === 0) {
          peakL = Math.max(peakL, sample);
        } else {
          peakR = Math.max(peakR, sample);
        }
      }

      this.stereoPeaks.left = peakL;
      this.stereoPeaks.right = peakR;

      requestAnimationFrame(detectPeaks);
    };

    detectPeaks();
  }

  async startRecording() {
    if (!this.isMonitoring) {
      if (window.showNotification) {
        window.showNotification("Please start monitoring first", 'error');
      }
      return;
    }

    if (this.isRecording) {
      console.log("Already recording");
      return;
    }

    try {
      // Get selected format
      const formatSelect = document.getElementById('audioFormatSelect');
      const mimeType = formatSelect ? formatSelect.value : 'audio/webm;codecs=opus';

      // Check if format is supported
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        console.warn(`${mimeType} not supported, falling back to default`);
      }

      this.recordedChunks = [];

      // Create MediaRecorder from the input stream
      const options = MediaRecorder.isTypeSupported(mimeType) ? { mimeType } : {};
      this.mediaRecorder = new MediaRecorder(this.inputStream, options);

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this.saveRecording();
      };

      this.mediaRecorder.start(100); // Collect data every 100ms
      this.isRecording = true;
      this.recordingStartTime = Date.now();
      this.startDurationTimer();
      this.updateUI();

      // Update recording button on visualizer
      const visualizer = document.getElementById('mainVisualizer');
      if (visualizer) {
        visualizer.dataset.recording = 'true';
        if (visualizer.recordBtn) {
          visualizer.recordBtn.dataset.recording = 'true';
          visualizer.recordBtn.title = 'Stop Recording';
        }
      }

      console.log("[Recorder] Recording started");
    } catch (err) {
      console.error("[Recorder] Failed to start recording:", err);
      if (window.showNotification) {
        window.showNotification("Failed to start recording: " + err.message, 'error');
      }
    }
  }

  async stopRecording() {
    if (!this.isRecording) return;

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    this.isRecording = false;
    this.stopDurationTimer();
    this.updateUI();

    // Update recording button on visualizer
    const visualizer = document.getElementById('mainVisualizer');
    if (visualizer) {
      visualizer.dataset.recording = 'false';
      if (visualizer.recordBtn) {
        visualizer.recordBtn.dataset.recording = 'false';
        visualizer.recordBtn.title = 'Start Recording';
      }
    }

    console.log("[Recorder] Recording stopped");
  }

  startDurationTimer() {
    const progressBar = document.getElementById('recordingProgressBar');
    const progressFill = document.getElementById('recordingProgressFill');

    // Show progress bar during recording
    if (progressBar) {
      progressBar.style.display = 'block';
    }

    const updateDuration = () => {
      if (!this.isRecording) return;

      const elapsed = Date.now() - this.recordingStartTime;
      const minutes = Math.floor(elapsed / 60000);
      const seconds = Math.floor((elapsed % 60000) / 1000);

      const durationElement = document.getElementById('recordingDuration');
      if (durationElement) {
        durationElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      }

      // Update progress bar (loops every 10 seconds for visual feedback)
      if (progressFill) {
        const loopSeconds = elapsed / 1000 % 10; // Loop every 10 seconds
        const percentage = (loopSeconds / 10) * 100;
        progressFill.style.width = `${percentage}%`;
      }

      this.durationTimer = setTimeout(updateDuration, 100);
    };

    updateDuration();
  }

  stopDurationTimer() {
    if (this.durationTimer) {
      clearTimeout(this.durationTimer);
      this.durationTimer = null;
    }

    // Hide and reset progress bar
    const progressBar = document.getElementById('recordingProgressBar');
    const progressFill = document.getElementById('recordingProgressFill');

    if (progressBar) {
      progressBar.style.display = 'none';
    }
    if (progressFill) {
      progressFill.style.width = '0%';
    }
  }

  async saveRecording() {
    if (this.recordedChunks.length === 0) {
      console.warn("No recorded data");
      return;
    }

    const blob = new Blob(this.recordedChunks, { type: this.recordedChunks[0].type });
    const duration = Date.now() - this.recordingStartTime;

    const take = {
      id: this.takeCounter++,
      name: `Take ${this.takes.length + 1}`,
      blob,
      duration,
      timestamp: new Date(),
      url: URL.createObjectURL(blob),
      mimeType: blob.type
    };

    this.takes.push(take);
    this.recordedChunks = [];

    // Save to IndexedDB
    await this.saveTakeToDB(take);

    this.updateTakesList();

    // Ensure takes section is visible and scroll to show new take
    const takesContent = document.getElementById('takesContent');
    const takesList = document.getElementById('takesList');
    if (takesContent && takesContent.style.maxHeight === '0px') {
      // Expand the section if it's collapsed
      takesContent.style.maxHeight = takesContent.scrollHeight + 'px';
      const toggle = document.getElementById('takesToggle');
      if (toggle) toggle.style.transform = 'rotate(0deg)';
    }
    // Scroll to top to show the new take (newest first)
    if (takesList) {
      setTimeout(() => {
        takesList.scrollTop = 0;
      }, 100);
    }

    console.log(`[Recorder] Saved ${take.name} (${(blob.size / 1024).toFixed(1)} KB)`);
  }

  updateTakesList() {
    const takesList = document.getElementById('takesList');
    const totalTakes = document.getElementById('totalTakes');
    const storageInfo = document.getElementById('storageInfo');
    const exportAllBtn = document.getElementById('exportAllBtn');
    const clearAllBtn = document.getElementById('clearAllTakesBtn');

    if (totalTakes) {
      totalTakes.textContent = this.takes.length;
    }

    // Update storage info
    if (storageInfo) {
      if (this.takes.length > 0) {
        const totalSize = this.takes.reduce((sum, t) => sum + t.blob.size, 0);
        const sizeMB = (totalSize / (1024 * 1024)).toFixed(1);
        storageInfo.textContent = `${sizeMB} MB stored locally in browser`;
      } else {
        storageInfo.textContent = 'Stored locally in browser';
      }
    }

    if (this.takes.length > 0) {
      if (exportAllBtn) exportAllBtn.style.display = 'block';
      if (clearAllBtn) clearAllBtn.style.display = 'block';
    } else {
      if (exportAllBtn) exportAllBtn.style.display = 'none';
      if (clearAllBtn) clearAllBtn.style.display = 'none';
    }

    if (!takesList) return;

    if (this.takes.length === 0) {
      takesList.innerHTML = `
        <div style="color: var(--text-secondary); text-align: center; padding: 20px;">
          No recordings yet. Click "Record" to start your first take.
        </div>
      `;
      return;
    }

    takesList.innerHTML = this.takes.slice().reverse().map((take, index) => {
      const minutes = Math.floor(take.duration / 60000);
      const seconds = Math.floor((take.duration % 60000) / 1000);
      const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      const sizeStr = (take.blob.size / 1024).toFixed(1) + ' KB';
      const timeStr = take.timestamp.toLocaleTimeString();

      return `
        <div class="take-item" style="display: flex; gap: 12px; padding: 12px; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 4px; margin-bottom: 8px; align-items: center;">
          <!-- Play/Pause Button -->
          <button class="play-take-btn" data-take-id="${take.id}"
                  style="padding: 8px 0; font-size: 1.2em; background: #CF1A37; border: none; color: white; cursor: pointer; border-radius: 3px; line-height: 1; width: 46px; flex-shrink: 0; text-align: center;"
                  title="Play/Pause">&#9654;</button>

          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <input type="text"
                     class="take-name-input"
                     data-take-id="${take.id}"
                     value="${take.name}"
                     style="background: transparent; border: none; color: var(--text-primary); font-weight: bold; font-size: 0.95em; padding: 2px 4px; cursor: text; width: 120px;"
                     title="Click to rename">
              <span style="color: var(--text-secondary); font-size: 0.75em;">${timeStr}</span>
            </div>
            <div style="display: flex; gap: 12px; align-items: center; color: var(--text-secondary); font-size: 0.8em; margin-top: 4px; margin-bottom: 8px;">
              <span>Duration: ${durationStr}</span>
              <span>Size: ${sizeStr}</span>
            </div>
            <!-- Playback Progress Bar -->
            <div style="cursor: pointer; margin-top: 6px;" class="take-progress-container" data-take-id="${take.id}" title="Click to seek">
              <div style="display: flex; justify-content: space-between; font-size: 0.7em; color: var(--text-secondary); margin-bottom: 2px;">
                <span class="take-current-time" data-take-id="${take.id}">0:00</span>
                <span>${durationStr}</span>
              </div>
              <div style="background: var(--bg-tertiary); height: 6px; border: 1px solid var(--border); position: relative; border-radius: 2px;">
                <div class="take-progress-bar" data-take-id="${take.id}" style="background: #CF1A37; height: 100%; width: 0%; transition: width 0.1s; pointer-events: none; border-radius: 2px;"></div>
              </div>
            </div>
          </div>
          <div style="display: flex; gap: 6px; flex-direction: row; align-items: center;">
            <button class="delete-take-btn" data-take-id="${take.id}"
                    style="padding: 8px 0; font-size: 1.1em; background: #1a1a1a; border: 1px solid #2a2a2a; color: #aaa; cursor: pointer; border-radius: 3px; width: 40px; text-align: center;"
                    title="Delete this take">×</button>
            <button class="download-take-btn" data-take-id="${take.id}"
                    style="padding: 8px 0; font-size: 1.1em; background: #CF1A37; border: none; color: white; cursor: pointer; border-radius: 3px; width: 40px; text-align: center;"
                    title="Download this take">⬇</button>
          </div>
        </div>
      `;
    }).join('');

    // Add event listeners for download buttons
    takesList.querySelectorAll('.download-take-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const takeId = parseInt(e.target.dataset.takeId);
        this.downloadTake(takeId);
      });
    });

    // Add event listeners for delete buttons
    takesList.querySelectorAll('.delete-take-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const takeId = parseInt(e.target.dataset.takeId);
        if (window.showConfirm) {
          const confirmed = await window.showConfirm('Delete this take? This cannot be undone.', 'Delete Take');
          if (confirmed) {
            await this.deleteTake(takeId);
          }
        } else {
          if (confirm('Delete this take? This cannot be undone.')) {
            await this.deleteTake(takeId);
          }
        }
      });
    });

    // Add event listeners for rename inputs
    takesList.querySelectorAll('.take-name-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const takeId = parseInt(e.target.dataset.takeId);
        this.renameTake(takeId, e.target.value);
      });

      // Select all on focus
      input.addEventListener('focus', (e) => {
        e.target.select();
      });
    });

    // Add event listeners for play buttons
    takesList.querySelectorAll('.play-take-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const takeId = parseInt(e.target.dataset.takeId);
        this.togglePlayTake(takeId, btn);
      });
    });

    // Add event listeners for progress bar seeking
    takesList.querySelectorAll('.take-progress-container').forEach(container => {
      container.addEventListener('click', (e) => {
        const takeId = parseInt(e.currentTarget.dataset.takeId);
        const take = this.takes.find(t => t.id === takeId);
        if (!take || !take.audioElement) return;

        // Get the progress bar background element (the one with the border)
        const progressBarBg = container.querySelector('div:nth-child(2)');
        if (!progressBarBg) return;

        const rect = progressBarBg.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const width = rect.width;
        const percentage = Math.max(0, Math.min(1, clickX / width));

        if (take.audioElement.duration && isFinite(take.audioElement.duration)) {
          take.audioElement.currentTime = take.audioElement.duration * percentage;
        }
      });

      // Add visual feedback on hover
      container.style.cursor = 'pointer';
    });

    // Recalculate takes section height if expanded
    const takesContent = document.getElementById('takesContent');
    if (takesContent && takesContent.style.maxHeight && takesContent.style.maxHeight !== '0px') {
      // Update max-height to accommodate new content
      setTimeout(() => {
        takesContent.style.maxHeight = takesContent.scrollHeight + 'px';
      }, 10);
    }
  }

  async togglePlayTake(takeId, button) {
    const take = this.takes.find(t => t.id === takeId);
    if (!take) return;

    // Resume AudioContext if needed (for playback without monitoring)
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    // Stop all other playing takes
    this.takes.forEach(t => {
      const otherBtn = document.querySelector(`.play-take-btn[data-take-id="${t.id}"]`);
      if (t.id !== takeId && t.audioElement && !t.audioElement.paused) {
        t.audioElement.pause();
        t.audioElement.currentTime = 0;
        if (otherBtn) {
          otherBtn.innerHTML = '&#9654;'; // Play symbol
        }
      }
    });

    // Create audio element if it doesn't exist
    if (!take.audioElement) {
      take.audioElement = new Audio(take.url);

      // Route through Web Audio API for visualization
      if (!take.mediaElementSource) {
        take.mediaElementSource = this.audioContext.createMediaElementSource(take.audioElement);
        // Audio graph: audioElement → analyser → playbackGain → destination
        take.mediaElementSource.connect(this.analyser);
        take.mediaElementSource.connect(this.playbackGain);
        this.playbackGain.connect(this.audioContext.destination);
      }
    }

    const audio = take.audioElement;

    // Toggle playback
    if (audio.paused) {
      audio.play();
      button.innerHTML = '&#9612;&#9612;'; // Pause symbol (two vertical bars)

      // Update progress bar
      this.startProgressUpdate(takeId, audio);

      audio.onended = () => {
        button.innerHTML = '&#9654;'; // Play symbol
        audio.currentTime = 0;
        this.updateTakeProgress(takeId, 0);
      };
    } else {
      audio.pause();
      button.innerHTML = '&#9654;'; // Play symbol
    }
  }

  startProgressUpdate(takeId, audio) {
    if (!audio) return;

    const update = () => {
      if (audio.paused || audio.ended) return;

      const progress = audio.duration > 0 ? (audio.currentTime / audio.duration) * 100 : 0;
      this.updateTakeProgress(takeId, progress);

      // Update time display
      const currentTimeEl = document.querySelector(`.take-current-time[data-take-id="${takeId}"]`);
      if (currentTimeEl) {
        const minutes = Math.floor(audio.currentTime / 60);
        const seconds = Math.floor(audio.currentTime % 60);
        currentTimeEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      }

      requestAnimationFrame(update);
    };

    update();
  }

  updateTakeProgress(takeId, percentage) {
    const progressBar = document.querySelector(`.take-progress-bar[data-take-id="${takeId}"]`);
    if (progressBar) {
      progressBar.style.width = `${percentage}%`;
    }
  }

  downloadTake(takeId) {
    const take = this.takes.find(t => t.id === takeId);
    if (!take) return;

    const ext = take.mimeType.includes('webm') ? 'webm' :
                take.mimeType.includes('mp4') ? 'm4a' :
                take.mimeType.includes('ogg') ? 'ogg' : 'audio';

    const filename = `${take.name.replace(/[^a-z0-9]/gi, '_')}.${ext}`;

    const a = document.createElement('a');
    a.href = take.url;
    a.download = filename;
    a.click();

    console.log(`[Recorder] Downloaded: ${filename}`);
  }

  async deleteTake(takeId) {
    const index = this.takes.findIndex(t => t.id === takeId);
    if (index === -1) return;

    const take = this.takes[index];

    // Stop and clean up audio element if it exists
    if (take.audioElement) {
      take.audioElement.pause();
      take.audioElement.src = '';
    }

    URL.revokeObjectURL(take.url);
    this.takes.splice(index, 1);

    // Delete from IndexedDB
    await this.deleteTakeFromDB(takeId);

    this.updateTakesList();
    console.log(`[Recorder] Deleted: ${take.name}`);
  }

  async renameTake(takeId, newName) {
    const take = this.takes.find(t => t.id === takeId);
    if (!take) return;

    take.name = newName || `Take ${takeId}`;

    // Update in IndexedDB
    await this.updateTakeNameInDB(takeId, take.name);

    console.log(`[Recorder] Renamed to: ${take.name}`);
  }

  exportAll() {
    if (this.takes.length === 0) {
      if (window.showNotification) {
        window.showNotification("No takes to export", 'error');
      }
      return;
    }

    this.takes.forEach(take => {
      this.downloadTake(take.id);
    });

    console.log(`[Recorder] Exported ${this.takes.length} take(s)`);
  }

  async clearAllTakes() {
    if (window.showConfirm) {
      const confirmed = await window.showConfirm(
        `Delete all ${this.takes.length} take(s)? This cannot be undone.`,
        'Clear All Takes'
      );
      if (!confirmed) {
        return;
      }
    } else {
      if (!confirm(`Delete all ${this.takes.length} take(s)? This cannot be undone.`)) {
        return;
      }
    }

    this.takes.forEach(take => {
      // Stop and clean up audio elements
      if (take.audioElement) {
        take.audioElement.pause();
        take.audioElement.src = '';
      }
      URL.revokeObjectURL(take.url);
    });

    this.takes = [];

    // Clear from IndexedDB
    await this.clearAllTakesFromDB();

    this.updateTakesList();

    console.log("[Recorder] All takes cleared");
  }

  setMonitorGain(value) {
    // value is 0-127, convert to 0-1
    const gain = value / 127;
    this.monitorGain.gain.value = gain;

    const monitorValue = document.getElementById('monitorValue');
    if (monitorValue) {
      monitorValue.textContent = `${Math.round(gain * 100)}%`;
    }
  }

  setInputGain(value) {
    // value is 0-127, convert to 0-2 (allowing boost)
    const gain = (value / 127) * 2;
    this.inputGain.gain.value = gain;

    const inputGainValue = document.getElementById('inputGainValue');
    if (inputGainValue) {
      inputGainValue.textContent = `${Math.round(gain * 100)}%`;
    }
  }

  updateUI() {
    const startMonitorBtn = document.getElementById('startMonitorBtn');
    const stopMonitorBtn = document.getElementById('stopMonitorBtn');
    const recordBtn = document.getElementById('recordBtn');
    const stopRecordBtn = document.getElementById('stopRecordBtn');
    const statusText = document.getElementById('statusText');
    const visualizer = document.getElementById('mainVisualizer');

    if (startMonitorBtn) startMonitorBtn.disabled = this.isMonitoring;
    if (stopMonitorBtn) stopMonitorBtn.disabled = !this.isMonitoring;
    if (recordBtn) recordBtn.disabled = !this.isMonitoring || this.isRecording;
    if (stopRecordBtn) stopRecordBtn.disabled = !this.isRecording;

    // Update viz record button state
    if (visualizer && visualizer.recordBtn) {
      visualizer.recordBtn.disabled = !this.isMonitoring;
      visualizer.recordBtn.style.opacity = this.isMonitoring ? '1' : '0.5';
      visualizer.recordBtn.style.cursor = this.isMonitoring ? 'pointer' : 'not-allowed';
    }

    if (statusText) {
      if (this.isRecording) {
        statusText.textContent = 'Recording';
        statusText.style.color = '#CF1A37';
      } else if (this.isMonitoring) {
        statusText.textContent = 'Monitoring';
        statusText.style.color = '#00ff00';
      } else {
        statusText.textContent = 'Ready';
        statusText.style.color = 'var(--text-primary)';
      }
    }
  }
}

// Initialize recorder
const recorder = new AudioRecorder();
window.recorder = recorder;

document.addEventListener('DOMContentLoaded', async () => {
  await recorder.init();

  // Set up button handlers
  document.getElementById('startMonitorBtn')?.addEventListener('click', () => {
    recorder.startMonitoring();
  });

  document.getElementById('stopMonitorBtn')?.addEventListener('click', () => {
    recorder.stopMonitoring();
  });

  document.getElementById('recordBtn')?.addEventListener('click', () => {
    recorder.startRecording();
  });

  document.getElementById('stopRecordBtn')?.addEventListener('click', () => {
    recorder.stopRecording();
  });

  document.getElementById('exportAllBtn')?.addEventListener('click', () => {
    recorder.exportAll();
  });

  document.getElementById('clearAllTakesBtn')?.addEventListener('click', () => {
    recorder.clearAllTakes();
  });

  // Set up fader handlers
  const monitorFader = document.getElementById('monitorFader');
  if (monitorFader) {
    monitorFader.addEventListener('input', (e) => {
      recorder.setMonitorGain(parseInt(e.target.value));
    });
    // Initialize display
    recorder.setMonitorGain(64);
  }

  const inputGainFader = document.getElementById('inputGainFader');
  if (inputGainFader) {
    inputGainFader.addEventListener('input', (e) => {
      recorder.setInputGain(parseInt(e.target.value));
    });
    // Initialize display
    recorder.setInputGain(127);
  }

  // Collapsible takes section
  const takesSectionTitle = document.getElementById('takesSectionTitle');
  const takesContent = document.getElementById('takesContent');
  const takesToggle = document.getElementById('takesToggle');

  if (takesSectionTitle && takesContent && takesToggle) {
    takesSectionTitle.addEventListener('click', () => {
      const isCollapsed = takesContent.style.maxHeight === '0px';

      if (isCollapsed) {
        takesContent.style.maxHeight = takesContent.scrollHeight + 'px';
        takesToggle.style.transform = 'rotate(0deg)';
      } else {
        takesContent.style.maxHeight = '0px';
        takesToggle.style.transform = 'rotate(-90deg)';
      }
    });

    // Start expanded
    takesContent.style.maxHeight = takesContent.scrollHeight + 'px';
  }

  // Initialize visualizations - call after recorder init completes
  // (will be called automatically from init())
});

// Visualization components
let waveformComponent = null;
let spectrumComponent = null;
let vuMeterComponent = null;
let freqBarsComponent = null;

window.initVisualizations = async function() {
  console.log('[Visualizations] Initializing...');

  // Resize canvases
  const resizeCanvas = (id) => {
    const canvas = document.getElementById(id);
    if (canvas) {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    }
  };

  resizeCanvas('visualizer');
  resizeCanvas('spectrum');
  resizeCanvas('vumeter');
  resizeCanvas('freqbars');

  // Initialize components
  try {
    if (!waveformComponent && typeof WaveformDisplayCanvas !== 'undefined') {
      waveformComponent = new WaveformDisplayCanvas('visualizer');
      console.log('[Visualizations] Waveform ready');
      startWaveformAnimation();
    }

    if (!spectrumComponent && typeof SpectrumAnalyzerCanvas !== 'undefined') {
      spectrumComponent = new SpectrumAnalyzerCanvas('spectrum');
      console.log('[Visualizations] Spectrum ready');
      startSpectrumAnimation();
    }

    if (!vuMeterComponent && typeof VUMeterCanvas !== 'undefined') {
      vuMeterComponent = new VUMeterCanvas('vumeter');
      await vuMeterComponent.init();
      console.log('[Visualizations] VU Meter ready');
      startVUMeterAnimation();
    }

    if (!freqBarsComponent && typeof FrequencyBarsCanvas !== 'undefined') {
      freqBarsComponent = new FrequencyBarsCanvas('freqbars');
      console.log('[Visualizations] Frequency Bars ready');
      startFreqBarsAnimation();
    }
  } catch (err) {
    console.error('[Visualizations] Init error:', err);
  }
};

function startWaveformAnimation() {
  if (!waveformComponent) return;

  const animate = () => {
    if (!recorder.analyser) {
      requestAnimationFrame(animate);
      return;
    }

    const bufferLength = recorder.analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);
    recorder.analyser.getByteTimeDomainData(dataArray);
    waveformComponent.draw(dataArray);

    requestAnimationFrame(animate);
  };

  animate();
}

function startSpectrumAnimation() {
  if (!spectrumComponent) return;

  const animate = () => {
    if (!recorder.analyser) {
      requestAnimationFrame(animate);
      return;
    }

    // SpectrumAnalyzerCanvas.draw() expects the analyser node itself
    spectrumComponent.draw(recorder.analyser);

    requestAnimationFrame(animate);
  };

  animate();
}

function startVUMeterAnimation() {
  if (!vuMeterComponent) return;

  const animate = () => {
    const leftPeak = recorder.stereoPeaks.left;
    const rightPeak = recorder.stereoPeaks.right;
    vuMeterComponent.draw(leftPeak, rightPeak);

    requestAnimationFrame(animate);
  };

  animate();
}

function startFreqBarsAnimation() {
  if (!freqBarsComponent) return;

  const animate = () => {
    if (!recorder.analyser) {
      requestAnimationFrame(animate);
      return;
    }

    // Get frequency data
    const bufferLength = recorder.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    recorder.analyser.getByteFrequencyData(dataArray);

    // Calculate frequency bands (bass, mid, high)
    const bassEnd = Math.floor(bufferLength * 0.1);
    const midEnd = Math.floor(bufferLength * 0.4);

    let bassSum = 0, midSum = 0, highSum = 0;

    for (let i = 0; i < bassEnd; i++) {
      bassSum += dataArray[i];
    }
    for (let i = bassEnd; i < midEnd; i++) {
      midSum += dataArray[i];
    }
    for (let i = midEnd; i < bufferLength; i++) {
      highSum += dataArray[i];
    }

    const bassAvg = bassSum / bassEnd / 255;
    const midAvg = midSum / (midEnd - bassEnd) / 255;
    const highAvg = highSum / (bufferLength - midEnd) / 255;

    freqBarsComponent.draw({
      bass: bassAvg,
      mid: midAvg,
      high: highAvg
    });

    requestAnimationFrame(animate);
  };

  animate();
}

export { recorder };
