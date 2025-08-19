# mic-pitch — Web tuner pitch detection library

A lightweight JS library based on Web Audio and the YIN algorithm to detect the fundamental frequency (pitch) from microphone input. Suitable as the core for a tuner.

## Install

```bash
npm install mic-pitch
# or: pnpm add mic-pitch / yarn add mic-pitch
```

## Quick Start (bundlers/ESM)

```html
<script type="module">
  import FrequencyTuner, { detectPitchYIN, computeRMS } from 'mic-pitch';

  const tuner = new FrequencyTuner({
    minFreq: 50,
    maxFreq: 2000,
    smoothing: 0.25,
    averageSeconds: 1.0,
  });

  tuner.onFrequency((f) => {
    console.log('current:', f, 'avg:', tuner.getAverageFrequency());
  });

  async function start() {
    await tuner.start();
  }
  function stop() {
    tuner.stop();
  }
</script>
```

## Browser (no bundler)

Option A: import the file directly (module)
```html
<script type="module" src="/path/to/src/index.js"></script>
<script type="module">
  // exposed on globalThis by the library:
  const tuner = new window.FrequencyTuner();
  // or:
  // const tuner = new window.Frequency.Tuner();
  tuner.onFrequency(f => console.log(f));
  tuner.start();
</script>
```

Option B: via ESM CDN
```html
<script type="module">
  import FrequencyTuner from 'https://esm.sh/mic-pitch';
  const tuner = new FrequencyTuner();
  tuner.start();
</script>
```

Notes:
- Requires HTTPS or localhost to access the microphone.
- It is recommended to disable echo cancellation, noise suppression, and auto gain control (already set in code) to improve accuracy.
- `onFrequency` callback provides the current (EMA smoothed) frequency in Hz; `null` when there is no reliable pitch.
- `getAverageFrequency()` returns the average frequency within the configured time window (Hz).

## Options
- minFreq/maxFreq: Frequency search range. A proper range improves performance and accuracy.
- threshold: YIN threshold, default 0.1. Smaller values are more sensitive but can cause false detections.
- smoothing: Exponential moving average coefficient α (0–1) for stability.
- averageSeconds: Time window (in seconds) for averaging.
- updateIntervalMs: Detection interval in milliseconds.
- minRms: Silence threshold (RMS).

## License
MIT
