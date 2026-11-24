// ==================================================
//  Performance Benchmark
// ==================================================
const BENCHMARK_WARMUP_DURATION = 5000;
const BENCHMARK_MEASUREMENT_DURATION = 30000;

function mean(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function percentile(values, p) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.ceil(p * sorted.length) - 1];
}

export function summarizeBenchmark(samples, measurementStart, measurementEnd) {
    const completed = samples.filter(sample => sample.end >= measurementStart && sample.end < measurementEnd);
    const successful = completed.filter(sample => sample.succeeded);
    const times = successful.filter(sample => sample.start >= measurementStart).map(sample => sample.end - sample.start);
    const ends = successful.map(sample => sample.end).sort((a, b) => a - b);
    const intervals = ends.slice(1).map((end, i) => end - ends[i]);

    // Media time is a proxy for repeated input, not a decoded-frame identifier.
    const timedCalls = completed.filter(sample => sample.start >= measurementStart).sort((a, b) => a.start - b.start);
    let comparableVideoTimes = 0, repeatedVideoTimes = 0;
    for (let i = 1; i < timedCalls.length; i++) {
        const previous = timedCalls[i - 1], current = timedCalls[i];
        if (!previous.succeeded || !current.succeeded || !Number.isFinite(previous.videoTime) || !Number.isFinite(current.videoTime)) continue;
        comparableVideoTimes++;
        if (current.videoTime === previous.videoTime) repeatedVideoTimes++;
    }

    return {
        completedCalls: successful.length,
        failedCalls: completed.length - successful.length,
        latencySamples: times.length,
        processingFps: successful.length / ((measurementEnd - measurementStart) / 1000),
        meanCallMs: mean(times),
        p50CallMs: percentile(times, 0.5),
        p95CallMs: percentile(times, 0.95),
        meanFrameIntervalMs: mean(intervals),
        comparableVideoTimes,
        repeatedVideoTimes: comparableVideoTimes ? repeatedVideoTimes : null
    };
}

export async function startBenchmark() {
    if (window.gestureBenchmark) throw new Error('A benchmark is already running');
    const video = document.getElementById('camera-video') || document.getElementById('camera');
    const stream = video?.srcObject;
    const track = stream?.getVideoTracks()[0];
    if (!track || track.readyState !== 'live' || video.readyState < 2 || video.paused || document.hidden) {
        throw new Error('Enable the camera and keep the page visible before starting the benchmark');
    }

    const implementation = video.id === 'camera-video' ? 'MediaPipe Hands' : 'TensorFlow.js Handpose';
    const measurementStart = performance.now() + BENCHMARK_WARMUP_DURATION;
    const measurementEnd = measurementStart + BENCHMARK_MEASUREMENT_DURATION;
    const samples = [];
    const invalidReasons = new Set();
    const settings = track.getSettings();
    const dimensions = { width: video.videoWidth, height: video.videoHeight };
    let inFlight = 0;

    function checkCamera() {
        if (document.hidden) invalidReasons.add('Page hidden');
        if (video.srcObject !== stream || track.readyState !== 'live' || video.paused) {
            invalidReasons.add('Camera stopped or changed');
        }
        if (video.videoWidth !== dimensions.width || video.videoHeight !== dimensions.height) {
            invalidReasons.add('Video dimensions changed');
        }
    }

    const benchmark = {
        async measure(callback) {
            const start = performance.now();
            if (start >= measurementEnd) return await callback();
            checkCamera();
            const videoTime = video.currentTime;
            if (inFlight > 0) invalidReasons.add('Overlapping processing calls');
            inFlight++;
            let succeeded = false;
            try {
                const result = await callback();
                succeeded = true;
                return result;
            } finally {
                inFlight--;
                samples.push({ start, end: performance.now(), succeeded, videoTime });
            }
        }
    };

    window.gestureBenchmark = benchmark;
    document.addEventListener('visibilitychange', checkCamera);
    track.addEventListener('ended', checkCamera);
    const cameraCheck = setInterval(checkCamera, 250);
    try {
        await new Promise(resolve => setTimeout(resolve, BENCHMARK_WARMUP_DURATION + BENCHMARK_MEASUREMENT_DURATION));
        checkCamera();
        const summary = summarizeBenchmark(samples, measurementStart, measurementEnd);
        if (!summary.completedCalls) invalidReasons.add('No completed processing calls');
        if (summary.failedCalls) invalidReasons.add('Processing calls failed');
        const result = {
            implementation,
            api: video.id === 'camera-video' ? 'Hands.send' : 'Handpose.estimateHands',
            valid: invalidReasons.size === 0,
            invalidReasons: [...invalidReasons],
            warmupMs: BENCHMARK_WARMUP_DURATION,
            measurementMs: BENCHMARK_MEASUREMENT_DURATION,
            video: dimensions,
            cameraFrameRate: settings.frameRate ?? null,
            backend: window.tf?.getBackend?.() ?? 'Not exposed',
            userAgent: navigator.userAgent,
            hardwareConcurrency: navigator.hardwareConcurrency ?? null,
            ...summary
        };
        console.log('Hand tracking benchmark:', result);
        return result;
    } finally {
        clearInterval(cameraCheck);
        document.removeEventListener('visibilitychange', checkCamera);
        track.removeEventListener('ended', checkCamera);
        if (window.gestureBenchmark === benchmark) delete window.gestureBenchmark;
    }
}
