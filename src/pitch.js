/**
 * Compute RMS of the buffer, used for silence detection.
 */
export function computeRMS(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const v = buffer[i];
    sum += v * v;
  }
  return Math.sqrt(sum / buffer.length);
}

/**
 * Detect pitch (Hz) using the YIN algorithm. Returns null if no reliable pitch is found.
 * @param {Float32Array} buffer - Time-domain mono signal
 * @param {number} sampleRate - Sample rate
 * @param {{minFreq?:number, maxFreq?:number, threshold?:number}} [options]
 */
export function detectPitchYIN(buffer, sampleRate, options = {}) {
  const minFreq = options.minFreq ?? 50;     // Adjust if needed
  const maxFreq = options.maxFreq ?? 2000;   // Adjust if needed
  const threshold = options.threshold ?? 0.1;

  const bufSize = buffer.length;
  if (bufSize < 512) return null;

  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  const tauMax = Math.min(bufSize - 3, Math.floor(sampleRate / minFreq));
  if (tauMin >= tauMax) return null;

  // Difference function d(tau)
  const yin = new Float32Array(tauMax + 1);
  yin[0] = 1;

  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0, n = bufSize - tau; i < n; i++) {
      const diff = buffer[i] - buffer[i + tau];
      sum += diff * diff;
    }
    yin[tau] = sum;
  }

  // CMND (cumulative mean normalized difference) function
  let runningSum = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    runningSum += yin[tau];
    yin[tau] = (yin[tau] * tau) / (runningSum || 1);
  }
  yin[0] = 1;

  // Find first minimum under threshold
  let tauEstimate = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (yin[tau] < threshold) {
      // Local minimum (walk right while decreasing)
      while (tau + 1 <= tauMax && yin[tau + 1] < yin[tau]) {
        tau++;
      }
      tauEstimate = tau;
      break;
    }
  }
  if (tauEstimate === -1) {
    // Fallback to global minimum
    let minVal = Infinity;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (yin[tau] < minVal) {
        minVal = yin[tau];
        tauEstimate = tau;
      }
    }
    if (tauEstimate === -1) return null;
  }

  // Parabolic interpolation for better precision
  let betterTau = tauEstimate;
  if (tauEstimate > 1 && tauEstimate < tauMax) {
    const a = yin[tauEstimate - 1];
    const b = yin[tauEstimate];
    const c = yin[tauEstimate + 1];
    const denom = 2 * (2 * b - a - c);
    if (denom !== 0) {
      betterTau = tauEstimate + (c - a) / denom;
    }
  }

  const freq = sampleRate / betterTau;
  if (!isFinite(freq) || freq <= 0) return null;
  if (freq < minFreq || freq > maxFreq) return null;
  return freq;
}
