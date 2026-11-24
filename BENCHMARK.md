# Hand Tracking Benchmark

Measure hand-tracking processing throughput and API call latency without changing the camera configuration or game controls. The benchmark is opt-in and uses the existing processing loop; it does not start a camera or trigger additional inference.

## Run a benchmark

1. Start the Vite development server (`npm run dev`). Open the main page or `/legacy/index.html`.
2. Enable gesture control and allow the camera and model to initialize. Keep the tab visible.
3. Open the browser developer console (preferably docked). Run the following command:

```js
await (await import('/js/benchmark.js')).startBenchmark()
```

The helper warms up for 5 seconds and records a 30-second window, then prints and returns a result object. Save each result before running again. Reload between implementations and after invalid runs. Use the development server; the diagnostic module is not a production entry point.

## Test conditions

Use the same device, browser, power mode, lighting, camera, hand position and game state. For an inference-only baseline, leave the game idle with the camera running; keep an open palm out of view and use a consistent non-jumping hand pose (e.g. scissors). Run five trials per implementation. Record actual video dimensions, negotiated camera frame rate, browser version, device/CPU/GPU, model versions, and backend. Do not force a new camera resolution for the baseline. Test other resolutions and model complexity as separate experiments. If comparing active gameplay, run a separate standardized scenario.

Reject runs marked invalid; check for overlapping calls, camera changes, hidden pages and failed inference. The monitor cannot detect every possible transient interruption. Record invalid trials and their reasons before repeating.

## Metrics

| Field | Meaning |
|---|---|
| `processingFps` | Successful API completions per second in the 30-second window |
| `completedCalls` / `failedCalls` | Successful and failed API calls ending within the window |
| `latencySamples` | Successful calls that started and ended within the window |
| `meanCallMs` | Average elapsed call duration |
| `p50CallMs` / `p95CallMs` | Nearest-rank latency percentiles |
| `meanFrameIntervalMs` | Mean interval between successful completions |
| `comparableVideoTimes` | Adjacent successful in-window calls with finite video media times |
| `repeatedVideoTimes` | Comparable pairs with equal video media times (null when no pairs are comparable) |

MediaPipe measures `Hands.send()` and TensorFlow.js measures `Handpose.estimateHands()`. These API boundaries differ: MediaPipe can include result callback processing, while TensorFlow.js classification happens after the measured call. Do not interpret these numbers as identical pure-model inference durations, camera FPS, game FPS, or gesture-to-action latency. Successful calls with no detected hand count toward throughput. Failed calls do not. A call beginning during warm-up may count toward throughput but not latency. Calls ending after measurement are excluded.

Equal `video.currentTime` values are a diagnostic proxy for repeated input, not proof that identical decoded frames were processed. Browser timer precision can affect this count. Use a fresh trial for each configuration.

Use the browser Performance panel separately to inspect rendering, long tasks, scripting, and garbage collection. Measure startup, end-to-end gesture latency, recognition accuracy, CPU/GPU load, and memory as separate experiments; this helper does not measure those metrics.

## Calculation tests

Run `node --test tests/benchmark.test.js` to verify the measurement calculations and mocked lifecycle. These tests do not require a camera or model download.

## Results

Report the median of the five valid per-run values for each metric, with raw run results retained. Do not treat unmeasured fields as zero. Compare only equivalent conditions and state any differences in negotiated resolution or backend.

| Implementation | Run | Actual resolution | Backend | Processing FPS | Mean (ms) | P50 (ms) | P95 (ms) |
|---|---|---|---|---:|---:|---:|---:|
| MediaPipe Hands | 1–5 | — | — | — | — | — | — |
| TensorFlow.js Handpose | 1–5 | — | — | — | — | — | — |
