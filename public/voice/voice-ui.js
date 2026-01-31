/**
 * --- INFRASTRUCTURE LAYER ---
 * IndexedDB Wrapper for persistent storage in browser
 */
class StorageService {
  constructor(dbName = 'VoiceMemoDB', storeName = 'recordings') {
    this.dbName = dbName;
    this.storeName = storeName;
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id', autoIncrement: true });
        }
      };
      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve();
      };
      request.onerror = (e) => reject(e);
    });
  }

  async save(blob, meta = {}) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const record = { blob, date: new Date(), ...meta };
      const request = store.add(record);
      request.onsuccess = () => resolve({ id: request.result, ...record });
      request.onerror = () => reject(request.error);
    });
  }

  async getAll() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async delete(id) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async update(id, blob, meta = {}) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const data = getRequest.result;
        if (!data) {
          reject(new Error(`Record with id ${id} not found`));
          return;
        }
        const updatedRecord = { ...data, blob, ...meta, date: new Date() };
        const putRequest = store.put(updatedRecord);
        putRequest.onsuccess = () => resolve(updatedRecord);
        putRequest.onerror = () => reject(putRequest.error);
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }
}

/**
 * --- BUSINESS LOGIC LAYER ---
 * Handles Web Audio API, Recording, and Effects Chain
 */
class AudioEngine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.stream = null;
    this.mediaRecorder = null;
    this.chunks = [];
    this.currentBlob = null;
    this.audioBuffer = null;
    this.sourceNode = null;
    this.trimStart = 0; // in seconds
    this.trimEnd = 0;   // in seconds
    this.duration = 0;  // in seconds

    this.isPlaying = false;
    this.playbackStartTime = 0;
    this.playbackOffset = 0; // The offset where playback started (relative to start of buffer)

    // Nodes for FX Chain
    this.playSource = null;
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);

    // EQ Nodes
    this.eqLow = this.ctx.createBiquadFilter();
    this.eqLow.type = 'lowshelf';
    this.eqLow.frequency.value = 320;

    this.eqMid = this.ctx.createBiquadFilter();
    this.eqMid.type = 'peaking';
    this.eqMid.frequency.value = 1000;

    this.eqHigh = this.ctx.createBiquadFilter();
    this.eqHigh.type = 'highshelf';
    this.eqHigh.frequency.value = 3200;

    // Echo Nodes
    this.delayNode = this.ctx.createDelay();
    this.feedbackNode = this.ctx.createGain();
    this.delayNode.connect(this.feedbackNode);
    this.feedbackNode.connect(this.delayNode);
    this.echoGain = this.ctx.createGain();
    this.echoGain.gain.value = 0; // default off

    // Reverb Nodes
    this.convolver = this.ctx.createConvolver();
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0; // default off
    this._generateImpulseResponse(); // Generate synthetic reverb

    // Analysis
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
  }

  async getDevices() {
    await navigator.mediaDevices.getUserMedia({ audio: true }); // Request permission first
    return navigator.mediaDevices.enumerateDevices();
  }

  async startRecording(deviceId, constraints) {
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    const audioConstraints = {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: constraints.echo,
      noiseSuppression: constraints.noise,
      autoGainControl: constraints.agc
    };

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });

    // Visualizer connection
    const source = this.ctx.createMediaStreamSource(this.stream);
    source.connect(this.analyser);

    this.mediaRecorder = new MediaRecorder(this.stream);
    this.chunks = [];

    this.mediaRecorder.ondataavailable = (e) => this.chunks.push(e.data);
    this.mediaRecorder.start();
  }

  async stopRecording() {
    return new Promise((resolve) => {
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: 'audio/webm' }); // Browser default
        this.currentBlob = blob;
        this.stream.getTracks().forEach(track => track.stop());
        resolve(blob);
      };
      this.mediaRecorder.stop();
    });
  }

  async mergeBlobs(blob1, blob2) {
    const buffer1 = await blob1.arrayBuffer();
    const buffer2 = await blob2.arrayBuffer();
    let audioBuffer1, audioBuffer2;

    try {
      audioBuffer1 = await this.ctx.decodeAudioData(buffer1);
    } catch (e) {
      console.error("Error decoding buffer1", e);
      // If buffer1 is invalid, just return blob2 as a WAV
      audioBuffer2 = await this.ctx.decodeAudioData(buffer2);
      return this._bufferToWav(audioBuffer2);
    }

    try {
      audioBuffer2 = await this.ctx.decodeAudioData(buffer2);
    } catch (e) {
      console.error("Error decoding buffer2", e);
      // If buffer2 is invalid, return audioBuffer1 as WAV
      return this._bufferToWav(audioBuffer1);
    }

    const totalLength = audioBuffer1.length + audioBuffer2.length;
    const mergedBuffer = this.ctx.createBuffer(
      audioBuffer1.numberOfChannels,
      totalLength,
      audioBuffer1.sampleRate
    );

    for (let i = 0; i < audioBuffer1.numberOfChannels; i++) {
      const chanData = mergedBuffer.getChannelData(i);
      chanData.set(audioBuffer1.getChannelData(i));
      chanData.set(audioBuffer2.getChannelData(i), audioBuffer1.length);
    }

    return this._bufferToWav(mergedBuffer);
  }

  async setBlob(blob) {
    this.currentBlob = blob;
    const arrayBuffer = await blob.arrayBuffer();
    this.audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
    this.duration = this.audioBuffer.duration;
    this.trimStart = 0;
    this.trimEnd = this.duration;
  }

  // Prepare audio graph for playback with effects
  async setupPlayback() {
    if (!this.audioBuffer) return;

    // Stop previous
    if (this.playSource) try { this.playSource.stop(); } catch(e){}

    this.playSource = this.ctx.createBufferSource();
    this.playSource.buffer = this.audioBuffer;
    this.playSource.loop = false; // Changed to false for easier trim testing

    // --- FX CHAIN ---
    // Source -> EQ -> Split(Dry, Echo, Reverb) -> Master

    const startNode = this.playSource;
    this.playSource.connect(this.eqLow);
    this.eqLow.connect(this.eqMid);
    this.eqMid.connect(this.eqHigh);

    // 2. Output of EQ goes to:
    // A. Master (Dry)
    this.eqHigh.connect(this.masterGain);

    // B. Echo
    this.eqHigh.connect(this.delayNode);
    this.delayNode.connect(this.echoGain);
    this.echoGain.connect(this.masterGain);

    // C. Reverb
    this.eqHigh.connect(this.convolver);
    this.convolver.connect(this.reverbGain);
    this.reverbGain.connect(this.masterGain);

    // Connect to visualizer for playback UI
    this.masterGain.connect(this.analyser);
  }

  play(startTimeOffset = null) {
    this.setupPlayback().then(() => {
      const offset = startTimeOffset !== null ? startTimeOffset : this.playbackOffset;
      const duration = Math.max(0, this.trimEnd - offset);

      if (duration <= 0) {
        this.isPlaying = false;
        this.playbackOffset = this.trimEnd;
        return;
      }

      const currentSource = this.playSource;
      this.playbackOffset = offset;
      this.playbackStartTime = this.ctx.currentTime;
      this.isPlaying = true;

      currentSource.start(0, offset, duration);
      currentSource.onended = () => {
        if (this.playSource === currentSource) {
          if (this.isPlaying) {
            this.playbackOffset = this.trimEnd;
            this.isPlaying = false;
          }
        }
      };
    });
  }

  stop() {
    if (this.isPlaying) {
      this.playbackOffset = this.getCurrentTime();
      this.isPlaying = false;
    }
    if (this.playSource) {
      try {
        this.playSource.onended = null;
        this.playSource.stop();
      } catch (e) {}
    }
  }

  getCurrentTime() {
    if (!this.isPlaying) return this.playbackOffset;
    const elapsed = this.ctx.currentTime - this.playbackStartTime;
    return Math.min(this.trimEnd, this.playbackOffset + elapsed);
  }

  // Effect Setters
  setEQ(low, mid, high) {
    this.eqLow.gain.value = low;
    this.eqMid.gain.value = mid;
    this.eqHigh.gain.value = high;
  }

  setEcho(active, time, feedback) {
    this.echoGain.gain.value = active ? 1 : 0;
    this.delayNode.delayTime.value = time;
    this.feedbackNode.gain.value = feedback;
  }

  setReverb(active, mix) {
    this.reverbGain.gain.value = active ? mix : 0;
  }

  _generateImpulseResponse() {
    // Simple white noise burst for reverb
    const rate = this.ctx.sampleRate;
    const length = rate * 2.0; // 2 seconds
    const impulse = this.ctx.createBuffer(2, length, rate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
      const decay = Math.pow(1 - i / length, 2); // Linear decay
      left[i] = (Math.random() * 2 - 1) * decay;
      right[i] = (Math.random() * 2 - 1) * decay;
    }
    this.convolver.buffer = impulse;
  }

  // Export Logic
  async getProcessedWav() {
    if (!this.audioBuffer) return null;

    const startSample = Math.floor(this.trimStart * this.audioBuffer.sampleRate);
    const endSample = Math.floor(this.trimEnd * this.audioBuffer.sampleRate);
    const length = Math.max(0, endSample - startSample);

    const trimmedBuffer = this.ctx.createBuffer(
      this.audioBuffer.numberOfChannels,
      length,
      this.audioBuffer.sampleRate
    );

    for (let i = 0; i < this.audioBuffer.numberOfChannels; i++) {
      const data = this.audioBuffer.getChannelData(i).subarray(startSample, endSample);
      trimmedBuffer.copyToChannel(data, i);
    }

    return this._bufferToWav(trimmedBuffer);
  }

  _bufferToWav(abuffer) {
    const numOfChan = abuffer.numberOfChannels;
    const length = abuffer.length * numOfChan * 2 + 44;
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);
    const channels = [];
    let i;
    let sample;
    let offset = 0;
    let pos = 0;

    // write WAV header
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"

    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16); // length = 16
    setUint16(1); // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(abuffer.sampleRate);
    setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2); // block-align
    setUint16(16); // 16-bit (hardcoded in this demp)

    setUint32(0x61746164); // "data" - chunk
    setUint32(length - pos - 4); // chunk length

    // Write interleaved data
    for (i = 0; i < abuffer.numberOfChannels; i++) channels.push(abuffer.getChannelData(i));

    while (pos < abuffer.length) {
      for (i = 0; i < numOfChan; i++) {
        sample = Math.max(-1, Math.min(1, channels[i][pos])); // clamp
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; // scale to 16-bit signed int
        view.setInt16(44 + offset, sample, true);
        offset += 2;
      }
      pos++;
    }

    return new Blob([buffer], { type: 'audio/wav' });

    function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
    function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }
  }
}

/**
 * --- UI LAYER ---
 * Handles DOM interactions
 */
class UIManager {
  constructor(audioEngine, storageService) {
    this.audio = audioEngine;
    this.storage = storageService;
    this.isRecording = false;
    this.timerInterval = null;
    this.startTime = 0;
    this.recordingData = []; // Buffer for scrolling waveform
    this.isAppending = false; // Track if we are in append mode

    this.dom = {
      views: {
        record: document.getElementById('view-record'),
        editor: document.getElementById('view-editor'),
        settings: document.getElementById('modal-settings')
      },
      btns: {
        record: document.getElementById('btn-record-toggle'),
        settings: document.getElementById('btn-settings'),
        closeSettings: document.getElementById('btn-close-settings'),
        play: document.getElementById('btn-play-pause'),
        save: document.getElementById('btn-save'),
        saveWav: document.getElementById('btn-save-wav'),
        saveMp3: document.getElementById('btn-save-mp3'),
        discard: document.getElementById('btn-discard'),
        closeEditor: document.getElementById('btn-close-editor')
      },
      settings: {
        input: document.getElementById('input-source'),
        agc: document.getElementById('chk-agc'),
        noise: document.getElementById('chk-noise'),
        echo: document.getElementById('chk-echo')
      },
      timer: document.getElementById('timer'),
      canvas: document.getElementById('live-visualizer'),
      recordingsList: document.getElementById('recordings-list'),
      playbackCanvas: document.getElementById('playback-visualizer'),
      trim: {
        start: document.getElementById('trim-start'),
        end: document.getElementById('trim-end'),
        overlayLeft: document.getElementById('trim-overlay-left'),
        overlayRight: document.getElementById('trim-overlay-right'),
        cursor: document.getElementById('playback-cursor'),
        container: document.getElementById('editor-timeline')
      }
    };

    this.canvasCtx = this.dom.canvas.getContext('2d');
    this.playbackCtx = this.dom.playbackCanvas.getContext('2d');
    this.selectedRecordingId = null;
    this.loadRecordings();
    this.bindEvents();
    this.initTrimDragging();
    this.initTimelineInteraction();
    this.startEditorLoop();
  }

  initTimelineInteraction() {
    this.dom.trim.container.onmousedown = (e) => {
      // Skip if clicking on handles
      if (e.target.classList.contains('trim-handle')) return;

      const rect = this.dom.trim.container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = (x / rect.width) * this.audio.duration;

      // Ensure within trim bounds
      const seekTime = Math.max(this.audio.trimStart, Math.min(this.audio.trimEnd, time));

      const wasPlaying = this.audio.isPlaying;
      if (wasPlaying) {
        this.audio.stop();
        this.audio.play(seekTime);
      } else {
        this.audio.playbackOffset = seekTime;
      }
    };
  }

  startEditorLoop() {
    const loop = () => {
      if (!this.dom.views.editor.classList.contains('hidden')) {
        this.updatePlaybackUI();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  updatePlaybackUI() {
    const w = this.dom.playbackCanvas.offsetWidth;
    const currentTime = this.audio.getCurrentTime();
    const cursorPx = (currentTime / this.audio.duration) * w;
    this.dom.trim.cursor.style.left = `${cursorPx}px`;
  }

  async loadRecordings() {
    const recordings = await this.storage.getAll();
    this.dom.recordingsList.innerHTML = '';
    recordings.sort((a, b) => b.date - a.date).forEach(rec => {
      const item = document.createElement('div');
      item.className = 'recording-item';
      if (this.selectedRecordingId === rec.id) item.classList.add('selected');

      const dateStr = new Date(rec.date).toLocaleString();
      const displayName = rec.name || `Запись #${rec.id}`;

      item.innerHTML = `
        <div class="recording-info">
          <div class="recording-name-container">
            <span class="recording-name" id="name-${rec.id}">${displayName}</span>
            <button class="btn btn-rename" onclick="event.stopPropagation(); window.app.startRename(${rec.id})">✏️</button>
          </div>
          <div class="recording-date">${dateStr}</div>
        </div>
        <div class="recording-actions">
          <button class="btn btn-action btn-primary" onclick="event.stopPropagation(); window.app.editRecording(${rec.id})">Редактировать</button>
          <button class="btn btn-action btn-danger" onclick="event.stopPropagation(); window.app.deleteRecording(${rec.id})">🗑️</button>
        </div>
      `;
      item.onclick = () => this.selectRecording(rec);
      this.dom.recordingsList.appendChild(item);
    });
  }

  startRename(id) {
    const nameSpan = document.getElementById(`name-${id}`);
    if (!nameSpan) return;

    const currentName = nameSpan.innerText;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentName;
    input.className = 'edit-name-input';

    const saveRename = async () => {
      if (input._saving) return;
      input._saving = true;
      const newName = input.value.trim();
      if (newName && newName !== currentName) {
        const recordings = await this.storage.getAll();
        const rec = recordings.find(r => r.id === id);
        if (rec) {
          await this.storage.update(id, rec.blob, { name: newName });
        }
      }
      this.loadRecordings();
    };

    input.onkeydown = (e) => {
      if (e.key === 'Enter') saveRename();
      if (e.key === 'Escape') this.loadRecordings();
    };

    input.onblur = saveRename;

    nameSpan.replaceWith(input);
    input.focus();
    input.select();
  }

  async selectRecording(rec) {
    if (this.selectedRecordingId === rec.id) {
      this.selectedRecordingId = null;
    } else {
      this.selectedRecordingId = rec.id;
      await this.audio.setBlob(rec.blob);
      this.audio.playbackOffset = 0;
    }
    this.loadRecordings();
  }

  editRecording(id) {
    this.storage.getAll().then(async (recordings) => {
      const rec = recordings.find(r => r.id === id);
      if (!rec) return;

      this.selectedRecordingId = id;
      await this.audio.setBlob(rec.blob);

      this.dom.views.record.classList.add('hidden');
      this.dom.views.editor.classList.remove('hidden');

      // Wait for reflow so getBoundingClientRect() is correct
      requestAnimationFrame(() => {
        this.initEditorControls();
        this.drawFullWaveform();
        this.updateTrimUI();

        // Reset playback state
        this.audio.stop();
        this.audio.playbackOffset = this.audio.trimStart;
      });
    });
  }

  async deleteRecording(id) {
    if (confirm('Удалить запись?')) {
      await this.storage.delete(id);
      if (this.selectedRecordingId === id) this.selectedRecordingId = null;
      this.loadRecordings();
    }
  }

  drawFullWaveform() {
    const buffer = this.audio.audioBuffer;
    if (!buffer) return;

    const canvas = this.dom.playbackCanvas;
    const ctx = this.playbackCtx;

    // Update canvas resolution to match display size
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    canvas.width = rect.width;
    canvas.height = rect.height;

    const w = canvas.width;
    const h = canvas.height;
    const data = buffer.getChannelData(0);
    const step = Math.ceil(data.length / w);
    const amp = h / 2;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a84ff';

    for (let i = 0; i < w; i++) {
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step; j++) {
        const datum = data[(i * step) + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
    }
  }

  updateTrimUI() {
    const w = this.dom.playbackCanvas.offsetWidth;
    const startPx = (this.audio.trimStart / this.audio.duration) * w;
    const endPx = (this.audio.trimEnd / this.audio.duration) * w;

    this.dom.trim.start.style.left = `${startPx}px`;
    this.dom.trim.end.style.left = `${endPx - 10}px`;

    this.dom.trim.overlayLeft.style.width = `${startPx}px`;
    this.dom.trim.overlayRight.style.left = `${endPx}px`;
    this.dom.trim.overlayRight.style.width = `${w - endPx}px`;
  }

  initTrimDragging() {
    const handleDrag = (e, type) => {
      const rect = this.dom.trim.container.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const time = (x / rect.width) * this.audio.duration;

      if (type === 'start') {
        this.audio.trimStart = Math.min(time, this.audio.trimEnd - 0.1);
        if (this.audio.playbackOffset < this.audio.trimStart) {
          this.audio.playbackOffset = this.audio.trimStart;
        }
      } else {
        this.audio.trimEnd = Math.max(time, this.audio.trimStart + 0.1);
        if (this.audio.playbackOffset > this.audio.trimEnd) {
          this.audio.playbackOffset = this.audio.trimEnd;
        }
      }
      this.updateTrimUI();
    };

    const addListeners = (el, type) => {
      const onMouseMove = (e) => handleDrag(e, type);
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      el.onmousedown = (e) => {
        e.preventDefault();
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      };
    };

    addListeners(this.dom.trim.start, 'start');
    addListeners(this.dom.trim.end, 'end');
  }

  bindEvents() {
    window.addEventListener('resize', () => {
      if (!this.dom.views.editor.classList.contains('hidden')) {
        this.drawFullWaveform();
        this.updateTrimUI();
        this.updatePlaybackUI();
      }
    });

    this.dom.btns.settings.onclick = () => {
      this.populateDevices();
      this.dom.views.settings.classList.remove('hidden');
    };

    this.dom.btns.closeSettings.onclick = () => {
      this.dom.views.settings.classList.add('hidden');
    };

    this.dom.btns.record.onclick = () => this.toggleRecording();


    this.dom.btns.play.onclick = () => {
      if (this.audio.isPlaying) {
        this.audio.stop();
      } else {
        // If we reached the end, start from the beginning of trim
        const currentTime = this.audio.getCurrentTime();
        const startFrom = (currentTime >= this.audio.trimEnd - 0.05) ? this.audio.trimStart : currentTime;
        this.audio.play(startFrom);
      }
    };

    this.dom.btns.discard.onclick = () => {
      this.dom.views.editor.classList.add('hidden');
      this.dom.views.record.classList.remove('hidden');
      this.audio.stop();
      this.loadRecordings();
    };

    this.dom.btns.closeEditor.onclick = () => {
      this.dom.views.editor.classList.add('hidden');
      this.dom.views.record.classList.remove('hidden');
      this.audio.stop();
      this.loadRecordings();
    };

    this.dom.btns.save.onclick = async () => {
      if (!this.selectedRecordingId) return;
      const blob = await this.audio.getProcessedWav();
      await this.storage.update(this.selectedRecordingId, blob);

      const originalText = this.dom.btns.save.innerText;
      this.dom.btns.save.innerText = '✅ Сохранено';
      setTimeout(() => {
        this.dom.btns.save.innerText = originalText;
      }, 2000);

      this.loadRecordings();
    };

    this.dom.btns.saveWav.onclick = async () => {
      const blob = await this.audio.getProcessedWav();
      this.download(blob, 'recording.wav');
    };

    this.dom.btns.saveMp3.onclick = async () => {
      const wavBlob = await this.audio.getProcessedWav();
      this.convertToMp3(wavBlob);
    };
  }

  async populateDevices() {
    const devices = await this.audio.getDevices();
    const select = this.dom.settings.input;
    select.innerHTML = '';
    devices.filter(d => d.kind === 'audioinput').forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.text = d.label || `Microphone ${select.length + 1}`;
      select.appendChild(opt);
    });
  }

  async toggleRecording() {
    if (this.isRecording) {
      // Stop
      this.isRecording = false;
      clearInterval(this.timerInterval);
      this.dom.btns.record.classList.remove('recording');
      const newBlob = await this.audio.stopRecording();
      this.recordingData = []; // Clear visualizer buffer

      if (this.isAppending && this.selectedRecordingId) {
        // Append mode
        const recordings = await this.storage.getAll();
        const existing = recordings.find(r => r.id === this.selectedRecordingId);
        if (existing) {
          const mergedBlob = await this.audio.mergeBlobs(existing.blob, newBlob);
          await this.storage.update(this.selectedRecordingId, mergedBlob);
          // Refresh AudioEngine with new combined blob
          await this.audio.setBlob(mergedBlob);
        }
      } else {
        // New recording mode
        const saved = await this.storage.save(newBlob);
        this.selectedRecordingId = saved.id;
      }
      this.isAppending = false;
      await this.loadRecordings();
    } else {
      // Start
      this.isRecording = true;
      this.isAppending = !!this.selectedRecordingId;

      const constraints = {
        agc: this.dom.settings.agc.checked,
        noise: this.dom.settings.noise.checked,
        echo: this.dom.settings.echo.checked
      };
      const deviceId = this.dom.settings.input.value !== 'default' ? this.dom.settings.input.value : undefined;

      await this.audio.startRecording(deviceId, constraints);

      this.dom.btns.record.classList.add('recording');

      // Handle offset for timer if appending
      let initialOffset = 0;
      if (this.isAppending) {
        initialOffset = this.audio.duration * 1000;
      }

      this.startTime = Date.now() - initialOffset;
      this.timerInterval = setInterval(() => this.updateTimer(), 100);
      this.drawVisualizer();
    }
  }

  updateTimer() {
    const diff = Date.now() - this.startTime;
    const totalSeconds = Math.floor(diff / 1000);
    const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const secs = (totalSeconds % 60).toString().padStart(2, '0');
    const dec = Math.floor((diff % 1000) / 100);
    this.dom.timer.innerText = `${mins}:${secs}.${dec}`;
  }

drawVisualizer() {
  if (!this.isRecording) return;
  requestAnimationFrame(() => this.drawVisualizer());

  const bufferLength = this.audio.analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  this.audio.analyser.getByteTimeDomainData(dataArray);

  // Calculate peak for the current frame
  let max = 0;
  for (let i = 0; i < bufferLength; i++) {
    const v = Math.abs(dataArray[i] - 128) / 128;
    if (v > max) max = v;
  }
  this.recordingData.push(max);
  if (this.recordingData.length > 1000) this.recordingData.shift(); // Prevent memory leak

  const ctx = this.canvasCtx;
  const w = this.dom.canvas.width;
  const h = this.dom.canvas.height;
  const midX = w / 2;
  const midY = h / 2;

  ctx.clearRect(0, 0, w, h);

  // Draw scrolling waveform
  // We want the current point to be at midX
  // Everything to the left is history
  const barWidth = 2;
  const gap = 1;
  const step = barWidth + gap;

  ctx.fillStyle = '#0a84ff'; // Changed to blue to match editor waveform

  // Draw historical data moving left from center
  for (let i = 0; i < this.recordingData.length; i++) {
    const val = this.recordingData[this.recordingData.length - 1 - i];
    const x = midX - i * step;
    if (x < -barWidth) break;

    const barHeight = Math.max(2, val * h);
    ctx.fillRect(x, midY - barHeight / 2, barWidth, barHeight);
  }

  // Draw future data (blank or placeholders)
  // Actually the user said it "comes appearing in the middle and goes left"
  // So we don't need anything to the right of midX?
  // Let's re-read: "it will appear in the middle and go left, like a red thread is being cut into waves and smoothly goes left"
  // "Красная нить" usually refers to the vertical line.

  // Red line in the middle (current recording point)
  ctx.strokeStyle = '#ff3b30'; // Changing to red as requested ("red thread")
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(midX, 0);
  ctx.lineTo(midX, h);
  ctx.stroke();
}

  initEditorControls() {
    // Bind slider events to Audio Engine
    const getVal = (id) => parseFloat(document.getElementById(id).value);
    const getCheck = (id) => document.getElementById(id).checked;

    const updateEQ = () => this.audio.setEQ(
      getCheck('fx-eq-active') ? getVal('fx-eq-low') : 0,
      getCheck('fx-eq-active') ? getVal('fx-eq-mid') : 0,
      getCheck('fx-eq-active') ? getVal('fx-eq-high') : 0
    );

    ['fx-eq-low', 'fx-eq-mid', 'fx-eq-high', 'fx-eq-active'].forEach(id => {
      document.getElementById(id).oninput = updateEQ;
    });

    const updateEcho = () => this.audio.setEcho(
      getCheck('fx-echo-active'),
      getVal('fx-echo-time'),
      getVal('fx-echo-feedback')
    );

    ['fx-echo-time', 'fx-echo-feedback', 'fx-echo-active'].forEach(id => {
      document.getElementById(id).oninput = updateEcho;
    });

    const updateReverb = () => this.audio.setReverb(
      getCheck('fx-reverb-active'),
      getVal('fx-reverb-mix')
    );
    ['fx-reverb-mix', 'fx-reverb-active'].forEach(id => {
      document.getElementById(id).oninput = updateReverb;
    });
  }

  download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
  }

  // MP3 Conversion using lamejs
  async convertToMp3(wavBlob) {
    if (typeof lamejs === 'undefined') {
      alert("Библиотека MP3 (lamejs) не загрузилась. Проверьте интернет.");
      return;
    }

    const arrayBuffer = await wavBlob.arrayBuffer();
    const audioCtx = new AudioContext();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    const mp3Encoder = new lamejs.Mp3Encoder(1, audioBuffer.sampleRate, 128); // Mono, rate, 128kbps
    const samples = audioBuffer.getChannelData(0);

    // Convert float -1..1 to int16
    const sampleBlockSize = 1152;
    const mp3Data = [];
    const int16Samples = new Int16Array(samples.length);
    for(let i=0; i<samples.length; i++) {
      int16Samples[i] = samples[i] < 0 ? samples[i] * 0x8000 : samples[i] * 0x7FFF;
    }

    let remaining = int16Samples.length;
    for (let i = 0; i < remaining; i += sampleBlockSize) {
      const leftChunk = int16Samples.subarray(i, i + sampleBlockSize);
      const mp3buf = mp3Encoder.encodeBuffer(leftChunk);
      if (mp3buf.length > 0) mp3Data.push(mp3buf);
    }

    const endBuf = mp3Encoder.flush();
    if (endBuf.length > 0) mp3Data.push(endBuf);

    const mp3Blob = new Blob(mp3Data, { type: 'audio/mp3' });
    this.download(mp3Blob, 'recording.mp3');
  }
}

/**
 * --- ENTRY POINT ---
 */
window.addEventListener('DOMContentLoaded', async () => {
  const storage = new StorageService();
  await storage.init();

  const audio = new AudioEngine();
  const app = new UIManager(audio, storage);
  window.app = app; // Expose for global access (onclick)

  // Resume audio context on first interaction (browser policy)
  document.body.addEventListener('click', () => {
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
  }, { once: true });
});
