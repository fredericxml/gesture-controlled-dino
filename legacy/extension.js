import '../js/dino.js';

// ==================================================
//  Config
// ==================================================
const KEY_CODE_SPACE_BAR = 32;
const KEY_CODE_ARROW_DOWN = 40;
function dispatchKey(type, key) {
    document.dispatchEvent(new KeyboardEvent(type, { keyCode: key }));
}

const MIN_DETECTION_CONFIDENCE = 7; // Good interval: 7 - 7.5
function createGestureEstimator(fp) {
    const { GestureDescription, Finger, FingerCurl } = fp;

    // Define rock gestures
    const Rock = new GestureDescription('rock');
    [Finger.Index, Finger.Middle, Finger.Ring, Finger.Pinky].forEach(f => Rock.addCurl(f, FingerCurl.FullCurl));
    Rock.addCurl(Finger.Thumb, FingerCurl.HalfCurl);
    Rock.addCurl(Finger.Thumb, FingerCurl.NoCurl);

    // Define paper gestures
    const Paper = new GestureDescription('paper');
    Finger.all.forEach(f => Paper.addCurl(f, FingerCurl.NoCurl));

    // Define scissors gestures
    const Scissors = new GestureDescription('scissors');
    [Finger.Index, Finger.Middle].forEach(f => {
        Scissors.addCurl(f, FingerCurl.NoCurl);
        Scissors.addCurl(f, FingerCurl.HalfCurl);
    });
    [Finger.Ring, Finger.Pinky].forEach(f => {
        Scissors.addCurl(f, FingerCurl.FullCurl);
        Scissors.addCurl(f, FingerCurl.HalfCurl);
    });

    return new fp.GestureEstimator([Rock, Paper, Scissors]);
}



// ==================================================
//  Gesture Detection
// ==================================================
let model, gestureEstimator;
let cameraSession = null;
let cameraTask = Promise.resolve();
let gestureDuckActive = false;
let wasmBackendLoaded = false;
const cameraElement = document.getElementById('camera');
const messageElement = document.getElementById('camera-message');

// Select the highest-confidence gesture; prefer the last candidate on a tie.
function getDetectedGesture(gestures) {
    if (gestures.length === 0) return 'none';

    return gestures.reduce((a, b) => (a.confidence > b.confidence ? a : b)).name;
}

function updateGestureMessage(message) {
    if (messageElement.textContent !== message) messageElement.textContent = message;
}

function releaseGestureDuck() {
    if (gestureDuckActive) {
        dispatchKey('keyup', KEY_CODE_ARROW_DOWN);
        gestureDuckActive = false;
    }
}

function applyGesture(gesture) {
    switch (gesture) {
        case 'paper':
            // Repeated key events preserve continuous jumping and interactions
            // with keyboard controls and auto-play.
            dispatchKey('keyup', KEY_CODE_ARROW_DOWN);
            gestureDuckActive = false;
            dispatchKey('keydown', KEY_CODE_SPACE_BAR);
            updateGestureMessage('Gesture: Paper (jump)');
            break;
        case 'rock':
            // Repeated duck events also trigger the game's airborne speed drop.
            dispatchKey('keydown', KEY_CODE_ARROW_DOWN);
            gestureDuckActive = true;
            updateGestureMessage('Gesture: Rock (duck)');
            break;
        case 'scissors':
            dispatchKey('keyup', KEY_CODE_ARROW_DOWN);
            gestureDuckActive = false;
            updateGestureMessage('Gesture: Scissors (run)');
            break;
        default:
            releaseGestureDuck();
            updateGestureMessage('Gesture: None');
            break;
    }
}

function handleMissingHand() {
    // Release the down key whenever no hand is detected.
    dispatchKey('keyup', KEY_CODE_ARROW_DOWN);
    gestureDuckActive = false;
    updateGestureMessage('Gesture: None');
}

async function runGestureDetection(session) {
    if (cameraSession !== session) return;
    session.frameId = null;
    try {
        session.inFlight = window.gestureBenchmark
            ? window.gestureBenchmark.measure(() => model.estimateHands(cameraElement, true))
            : model.estimateHands(cameraElement, true);
        const predictions = await session.inFlight;
        if (cameraSession !== session) return;

        if (predictions.length > 0) {
            const { landmarks } = predictions[0];

            const est = gestureEstimator.estimate(landmarks, MIN_DETECTION_CONFIDENCE);
            applyGesture(getDetectedGesture(est.gestures));
        } else {
            handleMissingHand();
        }
        if (cameraSession === session) {
            session.frameId = requestAnimationFrame(() => runGestureDetection(session));
        }
    } catch (err) {
        if (cameraSession === session) {
            session.resetModel = true;
            failCamera(session, 'Info: Error processing camera frame', err);
        }
    } finally {
        session.inFlight = null;
    }
}

// ==================================================
//  Camera and Model Lifecycle
// ==================================================
function updateCameraMessage(session, message) {
    if (cameraSession === session) messageElement.textContent = message;
}

async function setupModel(session) {
    if (!window.fp || typeof tf === 'undefined' || typeof handpose === 'undefined') {
        throw new Error('Hand-tracking libraries failed to load');
    }
    await tf.ready();
    if (cameraSession !== session) return;
    const webglVersion = tf.ENV.get('WEBGL_VERSION');

    if (webglVersion > 0) {
        if (!await tf.setBackend('webgl')) throw new Error('WebGL backend initialization failed');
        updateCameraMessage(session, 'Info: Using WebGL backend');
        console.log(`Using WebGL v${webglVersion} backend`);
    }
    else {
        updateCameraMessage(session, 'Info: Loading WASM backend');

        if (!wasmBackendLoaded) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.22.0/dist/tf-backend-wasm.min.js';
                script.onload = () => {
                    wasmBackendLoaded = true;
                    resolve();
                };
                script.onerror = () => {
                    script.remove();
                    reject(new Error('Failed to load WASM backend'));
                };
                document.head.appendChild(script);
            });
        }
        if (cameraSession !== session) return;
        if (!await tf.setBackend('wasm')) throw new Error('WASM backend initialization failed');
        updateCameraMessage(session, 'Info: Using WASM backend');
    }

    if (cameraSession !== session) return;
    updateCameraMessage(session, 'Info: Loading model');
    gestureEstimator = createGestureEstimator(window.fp);
    model = await handpose.load();
}

function stopCameraTracks(session) {
    if (session.stream) {
        session.stream.getTracks().forEach(track => track.stop());
        if (cameraElement.srcObject === session.stream) cameraElement.srcObject = null;
        session.stream = null;
    }
}

async function releaseCamera(session) {
    stopCameraTracks(session);
    if (session.inFlight) await session.inFlight.catch(() => {});
    if (session.track) session.track.removeEventListener('ended', session.onEnded);
    // Retain models without a public disposal API rather than leaking another
    // model allocation on every retry.
    if (session.resetModel && model && typeof model.dispose === 'function') {
        try {
            await model.dispose();
            model = null;
        } catch (err) {
            console.error('Error disposing model:', err);
        }
    }
}

function stopCamera(message = 'Info: Stopping camera') {
    const session = cameraSession;
    cameraSession = null;
    if (!session) return;

    messageElement.textContent = message;
    session.cancel();
    if (session.frameId !== null) cancelAnimationFrame(session.frameId);
    stopCameraTracks(session);
    releaseGestureDuck();
    cameraTask = cameraTask.then(() => releaseCamera(session));
}

function failCamera(session, message, err) {
    if (cameraSession !== session) return;
    console.error(message, err);
    stopCamera(message);
}

function startCamera() {
    if (cameraSession) return cameraTask;
    const session = { stream: null, frameId: null, inFlight: null, resetModel: false };
    session.cancelled = new Promise(resolve => { session.cancel = resolve; });
    cameraSession = session;
    messageElement.textContent = 'Info: Loading detection tools';

    cameraTask = cameraTask.then(async () => {
        if (cameraSession !== session) return;
        try {
            if (model == null) await setupModel(session);
            if (cameraSession !== session) return;

            messageElement.textContent = 'Info: Setting up camera';
            session.stream = await navigator.mediaDevices.getUserMedia({ video: true });
            if (cameraSession !== session) {
                stopCameraTracks(session);
                return;
            }
            session.track = session.stream.getVideoTracks()[0];
            if (!session.track || session.track.readyState !== 'live') {
                throw new Error('Camera stream is not active');
            }
            session.onEnded = () => failCamera(session, 'Info: Camera disconnected');
            session.track.addEventListener('ended', session.onEnded);
            cameraElement.srcObject = session.stream;

            // play() resolves when the video is playing; stop also unblocks this wait.
            await Promise.race([cameraElement.play(), session.cancelled]);
            if (cameraSession !== session) return;
            runGestureDetection(session);
        } catch (err) {
            failCamera(session, 'Info: Error accessing camera or loading model', err);
        }
    });
    return cameraTask;
}

// Release the camera on page exit and restore it when returning from cache.
window.addEventListener('pagehide', () => {
    stopCamera();
});
window.addEventListener('pageshow', event => {
    if (event.persisted && controlMode === 'camera') startCamera();
});



// ==================================================
//  Game hack
// ==================================================
const togglePanelBtn = document.getElementById('togglePanel');
const cheatPanel = document.getElementById('cheatPanel');
const tabs = document.querySelectorAll('.tab');
const cameraCard = document.querySelector('.camera-card');
const scoreInput = document.getElementById('scoreInput');
const setScoreBtn = document.getElementById('setScoreBtn');
const speedButtons = document.querySelectorAll('[data-speed]');
const jumpButtons = document.querySelectorAll('[data-jump]');
const godModeToggle = document.getElementById('godMode');
const walkInAirToggle = document.getElementById('walkInAir');
const autoPlayToggle = document.getElementById('autoPlay');

// Game state
let controlMode = 'keyboard';
let currentSpeed = 'normal';
let currentJumpHeight = 'normal';
let isPanelVisible = false;

// Toggle panel visibility
togglePanelBtn.addEventListener('click', () => {
    if (isPanelVisible) {
        cheatPanel.classList.remove('visible');
        cheatPanel.classList.add('hidden');
        isPanelVisible = false;
    } else {
        cheatPanel.classList.remove('hidden');
        cheatPanel.classList.add('visible');
        isPanelVisible = true;
    }
    Runner.instance_.setArcadeModeContainerScale();
});

// Control mode switching
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        controlMode = tab.dataset.mode;

        if (controlMode === 'camera') {
            cameraCard.classList.remove('hidden');

            startCamera();
        } else {
            cameraCard.classList.add('hidden');
            stopCamera();
        }
    });
});

// Set score
setScoreBtn.addEventListener('click', () => {
    const score = Math.min(parseInt(scoreInput.value) || 0, 99999);
    Runner.instance_.distanceRan = score / Runner.instance_.distanceMeter.config.COEFFICIENT;
});

// Speed buttons
function getSpeedValue(value) {
    if (value === 'slow') {
        return 1;
    } else if (value === 'fast') {
        return 100;
    }
    return 10;
}
speedButtons.forEach(button => {
    button.addEventListener('click', () => {
        speedButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');

        // Update speed
        currentSpeed = getSpeedValue(button.dataset.speed);
        Runner.instance_.setSpeed(currentSpeed);

        console.log(`Speed set to: ${button.textContent} (${currentSpeed})`);
    });
});

// Jump height buttons
function getJumpValue(value) {
    if (value === 'high') {
        return 20;
    }
    return 10;
}
jumpButtons.forEach(button => {
    button.addEventListener('click', () => {
        jumpButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');

        // Update jump height
        currentJumpHeight = getJumpValue(button.dataset.jump);
        Runner.instance_.tRex.setJumpVelocity(currentJumpHeight);

        console.log(`Jump height set to: ${button.textContent} (${currentJumpHeight})`);
    });
});

// God mode toggle
const originalGameOverFunction = Runner.prototype.gameOver;
const normalSpeedButton = document.querySelector('[data-speed="normal"]');
godModeToggle.addEventListener('change', () => {
    console.log(`God mode: ${godModeToggle.checked ? 'ON' : 'OFF'}`);

    if (godModeToggle.checked) {
        Runner.prototype.gameOver = function () { };
    } else {
        Runner.prototype.gameOver = function () {
            originalGameOverFunction.call(this);

            speedButtons.forEach(btn => btn.classList.remove('active'));
            if (normalSpeedButton) {
                normalSpeedButton.classList.add('active');
            }
        };
    }
});

// Walk in air toggle
walkInAirToggle.addEventListener('change', () => {
    console.log(`Walk in air: ${walkInAirToggle.checked ? 'ON' : 'OFF'}`);

    if (walkInAirToggle.checked) {
        Runner.instance_.tRex.groundYPos = 0;
    } else {
        Runner.instance_.tRex.groundYPos = 93;
    }
    dispatchKey('keydown', KEY_CODE_SPACE_BAR);
});

// Auto-play toggle
let autoPlayInterval = null;
autoPlayToggle.addEventListener('change', () => {
    console.log(`Auto-play: ${autoPlayToggle.checked ? 'ON' : 'OFF'}`);

    if (autoPlayToggle.checked) {
        autoPlayInterval = setInterval(function () {
            const CANVAS_HEIGHT = Runner.instance_.dimensions.HEIGHT
            const DINO_HEIGHT = Runner.instance_.tRex.config.HEIGHT

            const obstacle = Runner.instance_.horizon.obstacles[0]
            const speed = Runner.instance_.currentSpeed

            if (obstacle) {
                const w = obstacle.width
                const x = obstacle.xPos // Measured from left of canvas
                const y = obstacle.yPos // Measured from top of canvas
                const yFromBottom = CANVAS_HEIGHT - y - obstacle.typeConfig.height
                const isObstacleNearby = x < 25 * speed - w / 2

                if (isObstacleNearby) {
                    if (yFromBottom > DINO_HEIGHT) {
                        // Pterodactyl going from above, do nothing
                    } else if (y > CANVAS_HEIGHT / 2) {
                        // Jump
                        dispatchKey('keyup', KEY_CODE_ARROW_DOWN)
                        dispatchKey('keydown', KEY_CODE_SPACE_BAR)
                    } else {
                        // Duck
                        dispatchKey('keydown', KEY_CODE_ARROW_DOWN)
                    }
                }
            }
        }, Runner.instance_.msPerFrame);
    } else {
        clearInterval(autoPlayInterval);
    }
});
