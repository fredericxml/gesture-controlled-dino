import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// ==================================================
//  Mock Camera and Model
// ==================================================
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function makeStream() {
    const track = new EventTarget();
    track.readyState = 'live';
    track.stop = () => { track.readyState = 'ended'; };
    return { track, getTracks: () => [track], getVideoTracks: () => [track] };
}

async function flush() {
    await new Promise(resolve => setImmediate(resolve));
}

function createController(legacy, options = {}) {
    const video = { srcObject: null, videoWidth: 640, videoHeight: 480, play: options.play || (() => Promise.resolve()) };
    let widthReads = 0, heightReads = 0;
    if (!legacy) Object.defineProperties(video, {
        videoWidth: { get() { widthReads++; return 640; } },
        videoHeight: { get() { heightReads++; return 480; } }
    });
    const dependencyLoads = [], estimatedLandmarks = [];
    let messageText = '';
    const messageWrites = [];
    const message = {
        get textContent() { return messageText; },
        set textContent(value) { messageText = value; messageWrites.push(value); }
    };
    const events = [], cameras = [], requests = [], frames = new Map(), scripts = [], pageEvents = {};
    let nextFrame = 0, selectedGesture = 'rock', handVisible = true, loads = 0, closes = 0;
    const fp = {
        GestureDescription: class { addCurl() {} },
        Finger: { Index: 1, Middle: 2, Ring: 3, Pinky: 4, Thumb: 0, all: [0, 1, 2, 3, 4] },
        FingerCurl: { FullCurl: 2, HalfCurl: 1, NoCurl: 0 },
        GestureEstimator: class {
            estimate(landmarks) {
                estimatedLandmarks.push(landmarks.map(point => Array.from(point)));
                const gestures = Array.isArray(selectedGesture) ? selectedGesture : selectedGesture ? [{ name: selectedGesture, confidence: 9 }] : [];
                return { gestures };
            }
        }
    };
    let onResults;
    const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    const prediction = [{ landmarks: [] }];
    const model = {
        setOptions() {}, onResults(callback) { onResults = callback; },
        send: () => options.send ? options.send(onResults) : Promise.resolve().then(() => onResults({ multiHandLandmarks: handVisible ? [landmarks] : [] })),
        estimateHands: () => options.estimate ? options.estimate() : Promise.resolve(handVisible ? prediction : []),
        close: async () => { closes++; }, dispose: async () => { closes++; }
    };
    class Hands {
        constructor(config) { loads++; this.locateFile = config.locateFile; Object.assign(this, model); }
    }
    class Camera {
        constructor(element, config) { this.element = element; this.onFrame = config.onFrame; this.stopCalls = 0; cameras.push(this); }
        async start() {
            const stream = await requestStream();
            this.element.srcObject = stream;
        }
        async stop() { this.stopCalls++; this.element.srcObject?.getTracks().forEach(track => track.stop()); }
    }
    function requestStream() {
        const request = deferred(); requests.push(request); return request.promise;
    }
    function loadDependency(name) {
        dependencyLoads.push(name);
        const modules = { '@mediapipe/hands': { Hands }, '@mediapipe/camera_utils': { Camera }, fingerpose: fp };
        return options.loadDependency ? options.loadDependency(name, modules[name]) : Promise.resolve(modules[name]);
    }
    const sandbox = {
        loadDependency, Hands, Camera, fp, window: { fp: options.missingFingerpose ? undefined : fp, addEventListener: (event, callback) => { pageEvents[event] = callback; } },
        navigator: { userAgent: 'Mock desktop', mediaDevices: { getUserMedia: requestStream } },
        document: {
            getElementById: id => id === 'camera-message' ? message : video,
            dispatchEvent: event => events.push([event.type, event.keyCode]),
            createElement: () => ({ remove() { this.removed = true; } }),
            head: { appendChild: script => scripts.push(script) }
        },
        KeyboardEvent: class { constructor(type, init) { this.type = type; this.keyCode = init.keyCode; } },
        tf: { ready: async () => {}, ENV: { get: () => options.webglVersion ?? 2 }, setBackend: options.setBackend || (async () => true) },
        handpose: { load: async () => { loads++; return model; } },
        requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; },
        cancelAnimationFrame: id => frames.delete(id),
        console: { log() {}, error() {} }
    };
    const source = readFileSync(new URL(legacy ? '../legacy/extension.js' : '../js/extension.js', import.meta.url), 'utf8');
    const controller = source.split('// ==================================================\n//  Game hack')[0].replace(/^import .*;\n/gm, '').replace(/\bimport\(/g, 'loadDependency(');
    const api = runInNewContext(controller + `\nlet controlMode = '${legacy ? 'camera' : 'gesture'}';\n({ startCamera, stopCamera, settled: () => cameraTask, model: () => model, active: () => !!cameraSession })`, sandbox);
    return { ...api, video, message, messageWrites, dependencyLoads, estimatedLandmarks, get widthReads() { return widthReads; }, get heightReads() { return heightReads; }, events, cameras, requests, frames, scripts, pageEvents, get loads() { return loads; }, get closes() { return closes; }, setGesture: gesture => { selectedGesture = gesture; }, setHandVisible: visible => { handVisible = visible; },
        async nextFrame() { const [id, callback] = frames.entries().next().value; frames.delete(id); await callback(); } };
}

// ==================================================
//  Camera Lifecycle
// ==================================================
for (const legacy of [false, true]) {
    const name = legacy ? 'TensorFlow.js' : 'MediaPipe';
    test(`${name}: repeated starts and late permission are serialized`, async () => {
        const app = createController(legacy);
        app.startCamera(); app.startCamera();
        await flush();
        assert.equal(app.requests.length, 1);
        app.stopCamera(); app.startCamera();
        await flush();
        assert.equal(app.requests.length, 1);
        const old = makeStream(); app.requests[0].resolve(old);
        await flush();
        assert.equal(old.track.readyState, 'ended');
        assert.equal(app.requests.length, 2);
        const current = makeStream(); app.requests[1].resolve(current);
        await app.settled(); await flush();
        assert.equal(app.video.srcObject, current);
        assert.equal(app.loads, 1);
        assert.equal(app.active(), true);
        app.stopCamera(); await app.settled();
        assert.equal(current.track.readyState, 'ended');
        assert.equal(app.video.srcObject, null);
        assert.equal(app.frames.size, 0);
        if (!legacy) assert.equal(app.cameras[1].stopCalls, 1);
    });

    test(`${name}: permission denial allows retry`, async () => {
        const app = createController(legacy);
        app.startCamera(); await flush();
        app.requests[0].reject(new Error('Denied'));
        await app.settled(); await flush(); await app.settled();
        assert.equal(app.active(), false);
        assert.match(app.message.textContent, /Error/);
        app.startCamera(); await flush();
        app.requests[1].resolve(makeStream()); await app.settled();
        assert.equal(app.active(), true);
        app.stopCamera(); await app.settled();
    });

    test(`${name}: late inference cannot dispatch controls or schedule another loop`, async () => {
        const pending = deferred();
        const app = createController(legacy, legacy ? { estimate: () => pending.promise } : { send: callback => pending.promise.then(() => callback({ multiHandLandmarks: [[{ x: 0, y: 0, z: 0 }]] })) });
        app.startCamera(); await flush(); app.requests[0].resolve(makeStream()); await app.settled();
        if (!legacy) app.cameras[0].onFrame();
        await flush(); app.stopCamera(); app.startCamera();
        await flush(); assert.equal(app.requests.length, 1);
        pending.resolve([{ landmarks: [] }]); await flush();
        assert.equal(app.events.length, 0);
        assert.equal(app.frames.size, 0);
        assert.equal(app.requests.length, 2);
        app.stopCamera(); app.requests[1].resolve(makeStream()); await app.settled();
    });

    test(`${name}: inference failure stops stream and permits model retry`, async () => {
        const error = new Error('Mock inference failure');
        const app = createController(legacy, legacy ? { estimate: () => Promise.reject(error) } : { send: () => Promise.reject(error) });
        app.startCamera(); await flush(); const stream = makeStream(); app.requests[0].resolve(stream); await app.settled();
        if (!legacy) await app.cameras[0].onFrame();
        await flush(); await app.settled();
        assert.equal(app.active(), false);
        assert.equal(stream.track.readyState, 'ended');
        assert.equal(app.frames.size, 0);
        assert.match(app.message.textContent, /Error processing/);
        assert.equal(app.closes, 1);
        assert.equal(app.model(), null);
    });

    test(`${name}: held gestures still repeat; mode exit releases gesture duck`, async () => {
        const app = createController(legacy);
        app.setGesture('paper'); app.startCamera(); await flush(); app.requests[0].resolve(makeStream()); await app.settled(); await flush();
        if (!legacy) await app.cameras[0].onFrame();
        if (legacy) await app.nextFrame(); else await app.cameras[0].onFrame();
        assert.equal(app.events.filter(([type, key]) => type === 'keydown' && key === 32).length, 2);
        app.setGesture('rock');
        if (legacy) await app.nextFrame(); else await app.cameras[0].onFrame();
        assert.deepEqual(app.events.at(-1), ['keydown', 40]);
        app.stopCamera(); await app.settled();
        assert.deepEqual(app.events.at(-1), ['keyup', 40]);
    });

    test(`${name}: disconnected track stops the session`, async () => {
        const app = createController(legacy);
        app.startCamera(); await flush(); const stream = makeStream(); app.requests[0].resolve(stream); await app.settled(); await flush();
        stream.track.readyState = 'ended'; stream.track.dispatchEvent(new Event('ended'));
        await app.settled();
        assert.equal(app.active(), false);
        assert.equal(app.video.srcObject, null);
        assert.equal(app.frames.size, 0);
        assert.match(app.message.textContent, /disconnected/);
    });
}

test('MediaPipe: runtime assets use the installed package version', async () => {
    const app = createController(false);
    app.startCamera(); await flush();
    assert.match(app.model().locateFile('hands_solution_wasm_bin.wasm'), /@mediapipe\/hands@0\.4\.1675469240\//);
    app.stopCamera(); app.requests[0].resolve(makeStream()); await app.settled();
});

test('TensorFlow.js: failed WASM script is handled and can retry', async () => {
    const app = createController(true, { webglVersion: 0 });
    app.startCamera(); await flush();
    assert.equal(app.scripts.length, 1); app.scripts[0].onerror();
    await flush(); await app.settled();
    assert.equal(app.active(), false);
    assert.equal(app.scripts[0].removed, true);
    assert.equal(app.requests.length, 0);
    app.startCamera(); await flush();
    assert.equal(app.scripts.length, 2); app.scripts[1].onload();
    await flush(); assert.equal(app.requests.length, 1);
    app.stopCamera(); app.requests[0].resolve(makeStream()); await app.settled();
});

test('TensorFlow.js: stop cancels a pending video play wait', async () => {
    const play = deferred();
    const app = createController(true, { play: () => play.promise });
    app.startCamera(); await flush(); const stream = makeStream(); app.requests[0].resolve(stream); await flush();
    app.stopCamera(); await app.settled();
    assert.equal(stream.track.readyState, 'ended');
    assert.equal(app.video.srcObject, null);
    assert.equal(app.frames.size, 0);
});

test('MediaPipe: concurrent frame callbacks do not overlap inference', async () => {
    const pending = deferred();
    let calls = 0;
    const app = createController(false, { send: () => { calls++; return pending.promise; } });
    app.startCamera(); await flush(); app.requests[0].resolve(makeStream()); await app.settled();
    const first = app.cameras[0].onFrame();
    await app.cameras[0].onFrame();
    assert.equal(calls, 1);
    pending.resolve(); await first;
    app.stopCamera(); await app.settled();
});

for (const legacy of [false, true]) {
    const name = legacy ? 'TensorFlow.js' : 'MediaPipe';
    test(`${name}: page exit stops camera and cached page can restart`, async () => {
        const app = createController(legacy);
        app.startCamera(); await flush(); const stream = makeStream(); app.requests[0].resolve(stream); await app.settled();
        app.pageEvents.pagehide(); await app.settled();
        assert.equal(stream.track.readyState, 'ended');
        app.pageEvents.pageshow({ persisted: true }); await flush();
        assert.equal(app.requests.length, 2);
        app.requests[1].resolve(makeStream()); await app.settled();
        assert.equal(app.active(), true);
        assert.equal(app.loads, 1);
        app.stopCamera(); await app.settled();
    });
}

test('TensorFlow.js: unsuccessful backend initialization prevents camera start', async () => {
    const app = createController(true, { setBackend: async () => false });
    app.startCamera(); await flush(); await app.settled();
    assert.equal(app.requests.length, 0);
    assert.equal(app.active(), false);
    assert.match(app.message.textContent, /Error/);
});


// ==================================================
//  Gesture and Control Regression
// ==================================================
async function startGestureController(legacy) {
    const app = createController(legacy);
    app.startCamera(); await flush();
    app.requests[0].resolve(makeStream()); await app.settled(); await flush();
    app.events.length = 0;
    app.messageWrites.length = 0;
    return app;
}

async function gestureFrame(app, legacy, gesture, visible = true) {
    app.setGesture(gesture);
    app.setHandVisible(visible);
    if (legacy) await app.nextFrame(); else await app.cameras[0].onFrame();
}

for (const legacy of [false, true]) {
    const name = legacy ? 'TensorFlow.js' : 'MediaPipe';
    test(`${name}: recognized gestures preserve original per-frame key events`, async () => {
        const app = await startGestureController(legacy);
        const gestures = ['paper', 'rock', 'scissors'];
        const expected = {
            paper: [['keyup', 40], ['keydown', 32]],
            rock: [['keydown', 40]],
            scissors: [['keyup', 40]]
        };
        // Cover all ordered triples, including repeated and alternating poses.
        for (const first of gestures) {
            for (const second of gestures) {
                for (const third of gestures) {
                    for (const gesture of [first, second, third]) {
                        app.events.length = 0;
                        await gestureFrame(app, legacy, gesture);
                        assert.deepEqual(app.events, expected[gesture]);
                    }
                }
            }
        }
        app.stopCamera(); await app.settled();
    });

    test(`${name}: best confidence wins and ties favor the last candidate`, async () => {
        const app = await startGestureController(legacy);
        await gestureFrame(app, legacy, [{ name: 'paper', confidence: 9 }, { name: 'rock', confidence: 8 }]);
        assert.equal(app.message.textContent, 'Gesture: Paper (jump)');
        await gestureFrame(app, legacy, [{ name: 'paper', confidence: 9 }, { name: 'rock', confidence: 9 }]);
        assert.equal(app.message.textContent, 'Gesture: Rock (duck)');
        app.stopCamera(); await app.settled();
    });

    test(`${name}: repeated recognized gestures do not rewrite status text`, async () => {
        const app = await startGestureController(legacy);
        await gestureFrame(app, legacy, 'paper');
        app.messageWrites.length = 0;
        app.events.length = 0;
        for (let i = 0; i < 5; i++) await gestureFrame(app, legacy, 'paper');
        assert.equal(app.messageWrites.length, 0);
        assert.equal(app.events.filter(([type, key]) => type === 'keydown' && key === 32).length, 5);
        await gestureFrame(app, legacy, 'rock');
        assert.deepEqual(app.messageWrites, ['Gesture: Rock (duck)']);
        app.stopCamera(); await app.settled();
    });

    test(`${name}: unrecognized pose clears stale status and releases gesture duck once`, async () => {
        const app = await startGestureController(legacy);
        await gestureFrame(app, legacy, 'rock');
        app.events.length = 0;
        await gestureFrame(app, legacy, null);
        assert.equal(app.message.textContent, 'Gesture: None');
        assert.deepEqual(app.events, [['keyup', 40]]);
        await gestureFrame(app, legacy, null);
        assert.deepEqual(app.events, [['keyup', 40]]);
        await gestureFrame(app, legacy, 'paper');
        assert.deepEqual(app.events.slice(-2), [['keyup', 40], ['keydown', 32]]);
        app.stopCamera(); await app.settled();
    });

    test(`${name}: missing hand preserves original release events and immediate reacquisition`, async () => {
        const app = await startGestureController(legacy);
        await gestureFrame(app, legacy, 'rock');
        app.events.length = 0;
        await gestureFrame(app, legacy, 'rock', false);
        await gestureFrame(app, legacy, 'rock', false);
        assert.deepEqual(app.events, [['keyup', 40], ['keyup', 40]]);
        assert.equal(app.message.textContent, 'Gesture: None');
        await gestureFrame(app, legacy, 'rock');
        assert.deepEqual(app.events.at(-1), ['keydown', 40]);
        assert.equal(app.message.textContent, 'Gesture: Rock (duck)');
        app.stopCamera(); await app.settled();
    });
}


// ==================================================
//  Runtime Optimization
// ==================================================
test('MediaPipe: AI dependencies are deferred until camera mode and reused on restart', async () => {
    const app = createController(false);
    assert.deepEqual(app.dependencyLoads, []);
    assert.equal(app.loads, 0);
    app.startCamera(); await flush();
    assert.deepEqual(app.dependencyLoads, ['@mediapipe/hands', '@mediapipe/camera_utils', 'fingerpose']);
    app.requests[0].resolve(makeStream()); await app.settled();
    app.stopCamera(); await app.settled();
    app.startCamera(); await flush();
    app.requests[1].resolve(makeStream()); await app.settled();
    assert.equal(app.dependencyLoads.length, 3);
    assert.equal(app.loads, 1);
    app.stopCamera(); await app.settled();
});

test('MediaPipe: leaving gesture mode during dependency loading does not start a stale camera', async () => {
    const pending = deferred();
    const app = createController(false, { loadDependency: (name, module) => pending.promise.then(() => module) });
    app.startCamera(); await flush();
    assert.equal(app.requests.length, 0);
    app.stopCamera(); app.startCamera();
    pending.resolve(); await flush();
    assert.equal(app.requests.length, 1);
    assert.equal(app.loads, 1);
    app.requests[0].resolve(makeStream()); await app.settled();
    app.stopCamera(); await app.settled();
});

test('MediaPipe: dependency loading failure is handled without requesting camera permission', async () => {
    const app = createController(false, { loadDependency: () => Promise.reject(new Error('Mock module failure')) });
    await app.startCamera(); await app.settled();
    assert.equal(app.active(), false);
    assert.equal(app.requests.length, 0);
    assert.match(app.message.textContent, /Error accessing camera or loading model/);
});

test('MediaPipe: coordinate conversion reads dimensions once per frame and retains original values', async () => {
    const app = await startGestureController(false);
    await app.cameras[0].onFrame();
    assert.equal(app.widthReads, 1);
    assert.equal(app.heightReads, 1);
    assert.equal(app.estimatedLandmarks[0].length, 21);
    for (const point of app.estimatedLandmarks[0]) assert.deepEqual(Array.from(point), [320, 240, 0]);
    await app.cameras[0].onFrame();
    assert.equal(app.widthReads, 2);
    assert.equal(app.heightReads, 2);
    app.stopCamera(); await app.settled();
});

// ==================================================
//  Legacy Dependency Loading
// ==================================================
test('TensorFlow.js: missing Fingerpose is handled when gesture mode starts', async () => {
    const app = createController(true, { missingFingerpose: true });
    assert.equal(app.active(), false);
    app.startCamera();
    await app.settled();
    await flush();
    await app.settled();
    assert.equal(app.active(), false);
    assert.equal(app.requests.length, 0);
    assert.match(app.message.textContent, /Error accessing camera or loading model/);
});
