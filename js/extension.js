import { Hands } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import * as fp from 'fingerpose';

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
const STABLE_DETECTION_FRAME_COUNT = 2; // Frame-based Stability Filter
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



// ==================================================
//  Gesture Detection
// ==================================================
let model, camera, gestureEstimator;
const { GestureEstimator: GE } = fp;
const videoElement = document.getElementById('camera-video');
const messageElement = document.getElementById('camera-message');
// const canvas = document.getElementById('canvas');
// const ctx = canvas.getContext('2d');

function drawLandmarks(landmarks) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'red';
    for (let { x, y } of landmarks) {
        // Mirror x because video is flipped (canvas isn't)
        ctx.beginPath();
        ctx.arc((1 - x) * canvas.width, y * canvas.height, 5, 0, 2 * Math.PI);
        ctx.fill();
    }
}

const gestureHistory = [];
function filterStableGesture(newGesture) {
    if (!newGesture) return 'none';

    gestureHistory.push(newGesture);
    if (gestureHistory.length > STABLE_DETECTION_FRAME_COUNT) gestureHistory.shift();

    const mostFrequentGesture = gestureHistory.reduce((acc, g) => ((acc[g] = (acc[g] || 0) + 1), acc), {});

    return Object.keys(mostFrequentGesture).reduce((a, b) =>
        mostFrequentGesture[a] > mostFrequentGesture[b] ? a : b
    );
}

function runGestureDetection(results) {
    // canvas.width = videoElement.videoWidth;
    // canvas.height = videoElement.videoHeight;

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        // drawLandmarks(landmarks);

        const convertedLandmarks = landmarks.map(pt => [
            // (1 - pt.x) * canvas.width,
            // pt.y * canvas.height,
            (1 - pt.x) * videoElement.videoWidth,
            pt.y * videoElement.videoHeight,
            pt.z
        ]);

        const est = gestureEstimator.estimate(convertedLandmarks, MIN_DETECTION_CONFIDENCE * 10);
        if (est.gestures.length > 0) {
            const best = est.gestures.reduce((a, b) => (a.confidence > b.confidence ? a : b));
            const detectedGesture = filterStableGesture(best.name);

            switch (detectedGesture) {
                case 'paper':
                    dispatchKey('keyup', KEY_CODE_ARROW_DOWN); // Ensure no duck
                    dispatchKey('keydown', KEY_CODE_SPACE_BAR); // Jump
                    messageElement.textContent = 'Gesture: Paper (jump)';
                    break;
                case 'rock':
                    dispatchKey('keydown', KEY_CODE_ARROW_DOWN); // Duck
                    messageElement.textContent = 'Gesture: Rock (duck)';
                    break;
                case 'scissors':
                    dispatchKey('keyup', KEY_CODE_ARROW_DOWN); // Stop ducking
                    messageElement.textContent = 'Gesture: Scissors (run)';
                    break;
                default:
                    messageElement.textContent = 'Gesture: None';
                    break;
            }
        }
    } else {
        // ctx.clearRect(0, 0, canvas.width, canvas.height);
        dispatchKey('keyup', KEY_CODE_ARROW_DOWN);
        messageElement.textContent = 'Gesture: None';
    }
}

function startCamera() {
    try {
        messageElement.textContent = 'Info: Loading detection tools';
        camera.start();
    } catch (err) {
        messageElement.textContent = 'Info: Error accessing camera';
        console.error('Error accessing camera:', err);
    }
}

function stopCamera() {
    messageElement.textContent = 'Info: Stopping camera';

    if (videoElement.srcObject) {
        videoElement.srcObject.getTracks().forEach(track => track.stop());
        videoElement.srcObject = null;
    } else {
        messageElement.textContent = 'Info: No active camera';
        console.log('No camera stream to stop.');
    }
}

function setupModel() {
    messageElement.textContent = 'Info: Loading model';

    gestureEstimator = new GE([Rock, Paper, Scissors]);
    model = new Hands({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
    model.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: MIN_DETECTION_CONFIDENCE,
        minTrackingConfidence: MIN_DETECTION_CONFIDENCE
    });
    model.onResults(runGestureDetection);

    messageElement.textContent = 'Info: Setting up camera';
    camera = new Camera(videoElement, {
        onFrame: async () => await model.send({ image: videoElement })
    });
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    stopCamera();
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
let cameraStream = null;
let gestureInterval = null;
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

            if (model == null) {
                setupModel();
            }
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