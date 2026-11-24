import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startBenchmark, summarizeBenchmark } from '../js/benchmark.js';

// ==================================================
//  Benchmark Calculations
// ==================================================
test('counts completions and excludes boundary-crossing latency samples', () => {
    const result = summarizeBenchmark([
        { start: 90, end: 110, succeeded: true },
        { start: 120, end: 140, succeeded: true },
        { start: 150, end: 180, succeeded: true },
        { start: 185, end: 190, succeeded: false },
        { start: 190, end: 200, succeeded: true }
    ], 100, 200);
    assert.deepEqual(result, {
        completedCalls: 3, failedCalls: 1, latencySamples: 2, processingFps: 30,
        meanCallMs: 25, p50CallMs: 20, p95CallMs: 30, meanFrameIntervalMs: 35,
        comparableVideoTimes: 0, repeatedVideoTimes: null
    });
});

test('empty results do not invent latency measurements', () => {
    const result = summarizeBenchmark([], 100, 200);
    assert.equal(result.processingFps, 0);
    assert.equal(result.meanCallMs, null);
    assert.equal(result.p95CallMs, null);
});

// ==================================================
//  Benchmark Lifecycle (Mock Camera)
// ==================================================
test('opt-in monitor records errors, overlap, and removes hooks after measurement', async () => {
    let clock = 0;
    let finish;
    let intervalCleared = false;
    const track = new EventTarget();
    track.readyState = 'live';
    track.getSettings = () => ({ frameRate: 30 });
    const stream = { getVideoTracks: () => [track] };
    const video = { id: 'camera-video', srcObject: stream, readyState: 4, paused: false, videoWidth: 640, videoHeight: 480, currentTime: 1 };
    const page = new EventTarget();
    page.hidden = false;
    page.getElementById = () => video;
    const globals = {
        window: {}, document: page, navigator: { userAgent: 'Test', hardwareConcurrency: 4 },
        performance: { now: () => clock },
        setTimeout: callback => { finish = callback; return 1; },
        setInterval: () => 2,
        clearInterval: () => { intervalCleared = true; }
    };
    const originals = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    try {
        for (const [key, value] of Object.entries(globals)) {
            Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
        }
        const run = startBenchmark();
        await assert.rejects(startBenchmark(), /already running/);
        clock = 5000;
        let resolveCall;
        const first = window.gestureBenchmark.measure(() => new Promise(resolve => { resolveCall = resolve; }));
        const error = new Error('Mock inference error');
        clock = 5010;
        await assert.rejects(window.gestureBenchmark.measure(() => Promise.reject(error)), err => err === error);
        clock = 5020;
        resolveCall('unchanged result');
        assert.equal(await first, 'unchanged result');
        page.hidden = true;
        page.dispatchEvent(new Event('visibilitychange'));
        page.hidden = false;
        clock = 35000;
        finish();
        const result = await run;
        assert.equal(result.completedCalls, 1);
        assert.equal(result.failedCalls, 1);
        assert.equal(result.meanCallMs, 20);
        assert.equal(result.valid, false);
        assert.ok(result.invalidReasons.includes('Page hidden'));
        assert.ok(result.invalidReasons.includes('Overlapping processing calls'));
        assert.ok(result.invalidReasons.includes('Processing calls failed'));
        assert.equal(window.gestureBenchmark, undefined);
        assert.equal(intervalCleared, true);
    } finally {
        for (const [key, descriptor] of Object.entries(originals)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    }
});


test('counts repeated media timestamps only between adjacent successful in-window calls', () => {
    const result = summarizeBenchmark([
        { start: 90, end: 105, succeeded: true, videoTime: 1 },
        { start: 110, end: 120, succeeded: true, videoTime: 1 },
        { start: 125, end: 135, succeeded: true, videoTime: 1 },
        { start: 140, end: 150, succeeded: true, videoTime: 2 },
        { start: 155, end: 160, succeeded: false, videoTime: 2 },
        { start: 165, end: 170, succeeded: true, videoTime: 2 },
        { start: 175, end: 180, succeeded: true },
        { start: 185, end: 195, succeeded: true, videoTime: 2 }
    ], 100, 200);
    assert.equal(result.comparableVideoTimes, 2);
    assert.equal(result.repeatedVideoTimes, 1);
});
