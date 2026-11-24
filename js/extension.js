// ==================================================
//  Mobile UI Adjustment
// ==================================================
const isMobileDevice = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
if (isMobileDevice) {
    document.getElementById('main-message').textContent = 'Tap the dino to play';
    document.querySelector('.tab[data-mode="keyboard"]').textContent = 'Tap Only';
}

// ==================================================
//  Config
// ==================================================
const KEY_CODE_SPACE_BAR = 32;
const KEY_CODE_ARROW_DOWN = 40;
function dispatchKey(type, key) {
    document.dispatchEvent(new KeyboardEvent(type, { keyCode: key }));
}

const MIN_DETECTION_CONFIDENCE = 0.7; // Good interval: 0.7 - 0.75

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
let model, gestureEstimator, Camera;
let cameraSession = null;
let cameraTask = Promise.resolve();
let gestureDuckActive = false;
const videoElement = document.getElementById('camera-video');
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

function runGestureDetection(results) {
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];

        const videoWidth = videoElement.videoWidth;
        const videoHeight = videoElement.videoHeight;
        const convertedLandmarks = landmarks.map(pt => [
            (1 - pt.x) * videoWidth,
            pt.y * videoHeight,
            pt.z
        ]);

        const est = gestureEstimator.estimate(convertedLandmarks, MIN_DETECTION_CONFIDENCE * 10);
        applyGesture(getDetectedGesture(est.gestures));
    } else {
        handleMissingHand();
    }
}

// ==================================================
//  Camera and Model Lifecycle
// ==================================================
const MEDIAPIPE_HANDS_VERSION = '0.4.1675469240';

async function setupModel(session) {
    // Load the AI libraries only when gesture control is selected.
    const [handsModule, cameraModule, fp] = await Promise.all([
        import('@mediapipe/hands'),
        import('@mediapipe/camera_utils'),
        import('fingerpose')
    ]);
    if (cameraSession !== session) return;

    messageElement.textContent = 'Info: Loading model';
    const { Hands } = handsModule;
    Camera = cameraModule.Camera;
    gestureEstimator = createGestureEstimator(fp);
    model = new Hands({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@${MEDIAPIPE_HANDS_VERSION}/${file}` });
    model.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: MIN_DETECTION_CONFIDENCE,
        minTrackingConfidence: MIN_DETECTION_CONFIDENCE
    });
}

function stopCameraTracks() {
    if (videoElement.srcObject) {
        videoElement.srcObject.getTracks().forEach(track => track.stop());
        videoElement.srcObject = null;
    }
}

async function stopCameraUtility(session) {
    try {
        if (session.camera) await session.camera.stop();
    } catch (err) {
        console.error('Error stopping camera:', err);
    } finally {
        stopCameraTracks();
    }
}

async function releaseCamera(session) {
    // Wait for startup before stopping again: permission may have resolved late.
    if (session.stopTask) await session.stopTask;
    else if (session.camera) await stopCameraUtility(session);
    if (session.inFlight) await session.inFlight.catch(() => {});
    if (session.track) session.track.removeEventListener('ended', session.onEnded);

    // Reuse the model after normal stops, but recreate it after a processing error.
    if (session.resetModel && model) {
        try {
            await model.close();
        } catch (err) {
            console.error('Error closing model:', err);
        }
        model = null;
    }
}

function stopCamera(message = 'Info: Stopping camera') {
    const session = cameraSession;
    cameraSession = null;
    if (!session) return;

    messageElement.textContent = message;
    // Stop an active stream immediately. A pending permission request is cleaned
    // up when it settles, before another session can begin.
    if (session.started) session.stopTask = stopCameraUtility(session);
    if (session.camera) stopCameraTracks();
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
    const session = { camera: null, started: false, inFlight: null, resetModel: false };
    cameraSession = session;
    messageElement.textContent = 'Info: Loading detection tools';

    cameraTask = cameraTask.then(async () => {
        if (cameraSession !== session) return;
        try {
            if (model == null) {
                session.resetModel = true;
                await setupModel(session);
                if (cameraSession !== session) return;
                session.resetModel = false;
            }
            model.onResults(results => {
                if (cameraSession === session) runGestureDetection(results);
            });

            messageElement.textContent = 'Info: Setting up camera';
            session.camera = new Camera(videoElement, {
                onFrame: async () => {
                    if (cameraSession !== session || session.inFlight) return;
                    try {
                        session.inFlight = window.gestureBenchmark
                            ? window.gestureBenchmark.measure(() => model.send({ image: videoElement }))
                            : model.send({ image: videoElement });
                        await session.inFlight;
                    } catch (err) {
                        if (cameraSession === session) {
                            session.resetModel = true;
                            failCamera(session, 'Info: Error processing camera frame', err);
                        }
                    } finally {
                        session.inFlight = null;
                    }
                }
            });

            messageElement.textContent = 'Info: Loading detection tools';
            await session.camera.start();
            session.started = true;
            if (cameraSession !== session) return;
            session.track = videoElement.srcObject?.getVideoTracks()[0];
            if (!session.track || session.track.readyState !== 'live') {
                throw new Error('Camera stream is not active');
            }
            session.onEnded = () => failCamera(session, 'Info: Camera disconnected');
            session.track.addEventListener('ended', session.onEnded);
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
    if (event.persisted && controlMode === 'gesture') startCamera();
});



// ==================================================
//  Game hack
// ==================================================
const togglePanelBtn = document.getElementById('togglePanel');
const cheatPanel = document.getElementById('cheatPanel');
const tabs = document.querySelectorAll('.tab');
const cameraCard = document.querySelector('.camera-card');
const cameraCardContent = cameraCard.querySelector('.card-content');
const cameraContainer = document.querySelector('.camera-container');
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
        cameraContainer.classList.add('floating');
        document.body.appendChild(cameraContainer);
    } else {
        cheatPanel.classList.remove('hidden');
        cheatPanel.classList.add('visible');
        cameraContainer.classList.remove('floating');
        cameraCardContent.appendChild(cameraContainer);
    }
    isPanelVisible = !isPanelVisible;
    Runner.instance_.setArcadeModeContainerScale();
});

// Control mode switching
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        controlMode = tab.dataset.mode;

        if (controlMode === 'gesture') {
            cameraCard.classList.remove('hidden');
            cameraContainer.classList.remove('hidden');

            startCamera();
        } else {
            cameraCard.classList.add('hidden');
            cameraContainer.classList.add('hidden');
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



// ==================================================
//  More settings
// ==================================================
const hideTextToggle = document.getElementById('hideText');
const textWrapper = document.querySelector('.text-wrapper');

hideTextToggle.addEventListener('change', () => {
    if (hideTextToggle.checked) {
        textWrapper.classList.add('hidden');
    } else {
        textWrapper.classList.remove('hidden');
    }
});
