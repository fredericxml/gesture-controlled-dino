# Changelog

## v1.0.1 — Stability & Performance Update

### Fixed

- Serialize camera sessions and prevent stale inference results from dispatching game controls after switching modes.
- Stop camera tracks and cancel pending legacy animation frames when gesture control is disabled.
- Handle camera permission, stream disconnection, model initialization, inference, WASM loading, and missing legacy hand-tracking libraries.
- Release gesture-controlled ducking when a hand pose is no longer recognized or the camera stops.
- Pin MediaPipe runtime assets to the locked package version.
- Load the legacy game controller through a Vite module entry so its local dependencies can be bundled.

### Improved

- Load MediaPipe and Fingerpose dependencies on demand on the main page.
- Remove redundant gesture voting, status text assignments, and repeated video dimension reads while retaining recognized gesture event sequences.
- Remove unused landmark drawing code and obsolete comments.

### Added

- Opt-in hand-tracking benchmark for processing throughput and API call latency.
- Automated tests for benchmark calculations, camera lifecycle, gesture handling, runtime behavior, entry points, and release metadata.

Performance improvements have not yet been quantified with real-camera measurements. See [BENCHMARK.md](./BENCHMARK.md) for the measurement protocol.
