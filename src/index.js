import { detectPitchYIN, computeRMS } from './pitch.js';

export class MicPitch {
  /**
   * @param {{
   *  minFreq?:number,
   *  maxFreq?:number,
   *  threshold?:number,
   *  fftSize?:number,
   *  updateIntervalMs?:number,
   *  smoothing?:number,
   *  averageSeconds?:number,
   *  minRms?:number,
   *  deviceId?:string        // Selected audio input device ID
   * }} [options]
   */
  constructor(options = {}) {
    this.options = {
      minFreq: 50,
      maxFreq: 2000,
      threshold: 0.1,
      fftSize: 2048,
      updateIntervalMs: 50,
      smoothing: 0.25,
      averageSeconds: 1.0,
      minRms: 0.01,
      ...options,
    };

    this._ctx = null;
    this._stream = null;
    this._source = null;
    this._analyser = null;
    this._buffer = null;

    this._timer = null;
    this._listeners = new Set();

    this._emaFreq = null;
    this._history = []; // { t:number, f:number|null }
    this._running = false;

    // Currently selected input device
    this._deviceId = this.options.deviceId ?? null;
  }

  get running() {
    return this._running;
  }

  onFrequency(cb) {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }

  offFrequency(cb) {
    this._listeners.delete(cb);
  }

  async start() {
    if (this._running) return;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error('Web Audio API not available');

    this._ctx = new AudioCtx();
    this._analyser = this._ctx.createAnalyser();
    this._analyser.fftSize = this.options.fftSize;
    this._analyser.smoothingTimeConstant = 0;
    this._buffer = new Float32Array(this._analyser.fftSize);

    await this._replaceStream(); // Open and connect stream based on current deviceId

    this._running = true;
    this._loop();
  }

  stop() {
    if (!this._running) return;

    clearInterval(this._timer);
    this._timer = null;

    try {
      this._source && this._source.disconnect();
    } catch {}
    this._analyser = null;

    if (this._stream) {
      for (const t of this._stream.getTracks()) t.stop();
      this._stream = null;
    }

    if (this._ctx) {
      this._ctx.close().catch(() => {});
      this._ctx = null;
    }

    this._buffer = null;
    this._emaFreq = null;
    this._history = [];
    this._running = false;
  }

  // List available audio input devices
  async listInputDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return [];
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter(d => d.kind === 'audioinput');
    return inputs.map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Microphone ${i + 1}`,
      groupId: d.groupId,
    }));
  }

  // Select and (if running) immediately switch to the specified device
  async setDevice(deviceId) {
    this._deviceId = deviceId || null;
    if (this._running) {
      await this._replaceStream();
    }
  }

  // Create a new media stream based on current deviceId
  async _createStream() {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: this._deviceId ? { exact: this._deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
      video: false,
    });
  }

  // Swap old stream for a new one without recreating AudioContext/Analyser
  async _replaceStream() {
    const newStream = await this._createStream();

    try {
      this._source && this._source.disconnect();
    } catch {}

    if (this._stream) {
      for (const t of this._stream.getTracks()) t.stop();
    }
    this._stream = newStream;

    if (this._ctx && this._analyser) {
      this._source = this._ctx.createMediaStreamSource(this._stream);
      this._source.connect(this._analyser);
    }
  }

  /**
   * Get the average frequency (Hz) within the recent window (default: averageSeconds).
   * Returns null if there is no valid data.
   * @param {number} [seconds]
   */
  getAverageFrequency(seconds = this.options.averageSeconds) {
    const now = performance.now();
    const cutoff = now - seconds * 1000;
    let sum = 0;
    let count = 0;
    for (let i = this._history.length - 1; i >= 0; i--) {
      const item = this._history[i];
      if (item.t < cutoff) break;
      if (item.f != null && isFinite(item.f)) {
        sum += item.f;
        count++;
      }
    }
    return count ? sum / count : null;
  }

  _emit(freq) {
    for (const cb of this._listeners) {
      try { cb(freq); } catch {}
    }
  }

  _loop() {
    const { updateIntervalMs, minFreq, maxFreq, threshold, smoothing, minRms } = this.options;

    const tick = () => {
      if (!this._analyser || !this._buffer) return;

      this._analyser.getFloatTimeDomainData(this._buffer);
      const sr = this._ctx.sampleRate;

      const rms = computeRMS(this._buffer);
      let freq = null;

      if (rms >= minRms) {
        freq = detectPitchYIN(this._buffer, sr, { minFreq, maxFreq, threshold });
      }

      // Exponential smoothing
      if (freq != null) {
        if (this._emaFreq == null) {
          this._emaFreq = freq;
        } else if (smoothing > 0) {
          const alpha = Math.min(Math.max(smoothing, 0), 1);
          this._emaFreq = alpha * freq + (1 - alpha) * this._emaFreq;
        } else {
          this._emaFreq = freq;
        }
      } else {
        // Clear EMA during silence so the UI can show "no pitch"
        this._emaFreq = null;
      }

      const now = performance.now();
      this._history.push({ t: now, f: this._emaFreq });

      // Trim outdated history
      const cutoff = now - Math.max(1, this.options.averageSeconds) * 1000 - 200;
      while (this._history.length && this._history[0].t < cutoff) {
        this._history.shift();
      }

      this._emit(this._emaFreq);
    };

    this._timer = setInterval(tick, Math.max(10, updateIntervalMs));
  }
}

// Expose to global in browsers to allow direct <script type="module"> usage
(() => {
  if (typeof globalThis === 'undefined') return;
  const g = globalThis;
  try {
    // New globals aligned with package name
    if (!g.MicPitch) g.MicPitch = MicPitch;

    g.Mic = g.Mic || {};
    if (!g.Mic.Pitch) g.Mic.Pitch = MicPitch;
    if (!g.Mic.detectPitchYIN) g.Mic.detectPitchYIN = detectPitchYIN;
    if (!g.Mic.computeRMS) g.Mic.computeRMS = computeRMS;
  } catch {}
})();

// Named exports for tree-shaking; keep default export
export { detectPitchYIN, computeRMS };
export default MicPitch;
