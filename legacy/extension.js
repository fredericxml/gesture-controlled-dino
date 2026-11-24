// ==================================================
//  Config
// ==================================================
const KEY_CODE_SPACE_BAR = 32;
const KEY_CODE_ARROW_DOWN = 40;
function dispatchKey(type, key) {
    document.dispatchEvent(new KeyboardEvent(type, {keyCode: key}));
}

const MIN_DETECTION_CONFIDENCE = 7; // Good interval: 7 - 7.5
const STABLE_DETECTION_FRAME_COUNT = 2; // Frame-based Stability Filter
const { GestureDescription, Finger, FingerCurl } = window.fp;

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
let model, gestureEstimator;
const { GestureEstimator: GE } = window.fp;
const cameraElement = document.getElementById('camera');
const messageElement = document.getElementById('camera-message');
// const canvas = document.getElementById('canvas');
// const ctx = canvas.getContext('2d');

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

function drawLandmarks(landmarks) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'red';
    for (let [x, y] of landmarks) {
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, 2 * Math.PI);
        ctx.fill();
    }
}

async function runGestureDetection() {
    messageElement.textContent = 'Gesture: None';
    const predictions = await model.estimateHands(cameraElement, true);

    if (predictions.length > 0) {
        const { landmarks } = predictions[0];
        // drawLandmarks(landmarks);

        const est = gestureEstimator.estimate(landmarks, MIN_DETECTION_CONFIDENCE);
        if (est.gestures.length > 0) {
            const best = est.gestures.reduce((a, b) => (a.confidence > b.confidence ? a : b));
            const detectedGesture = filterStableGesture(best.name);
            
            if (detectedGesture === 'paper') {
                dispatchKey('keyup', KEY_CODE_ARROW_DOWN);
                dispatchKey('keydown', KEY_CODE_SPACE_BAR);
                messageElement.textContent = 'Gesture: Paper (jump)';
            } else if (detectedGesture === 'rock') {
                dispatchKey('keydown', KEY_CODE_ARROW_DOWN);
                messageElement.textContent = 'Gesture: Rock (duck)';
            } else if (detectedGesture === 'scissors') {
                dispatchKey('keyup', KEY_CODE_ARROW_DOWN);
                messageElement.textContent = 'Gesture: Scissors (run)';
            }
        }
    } else {
        dispatchKey('keyup', KEY_CODE_ARROW_DOWN);
        // ctx.clearRect(0, 0, canvas.width, canvas.height);
        messageElement.textContent = 'Gesture: None';
    }
    requestAnimationFrame(runGestureDetection);
}

async function setupCamera() {
    try {
        messageElement.textContent = 'Info: Setting up camera';
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
        cameraElement.srcObject = cameraStream;

        return new Promise(resolve => {
            cameraElement.onloadedmetadata = () => {
                // canvas.width = cameraElement.videoWidth;
                // canvas.height = cameraElement.videoHeight;
                resolve(cameraElement);
            };
        });
    } catch (err) {
        messageElement.textContent = 'Info: Error accessing camera';
        console.error('Error accessing camera:', err);
    }
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
}

async function setupModel() {
    await tf.ready();
    const webglVersion = tf.ENV.get('WEBGL_VERSION');

    if (webglVersion > 0) {
        await tf.setBackend('webgl');
        messageElement.textContent = 'Info: Using WebGL backend';
        console.log(`Using WebGL v${webglVersion} backend`);
    }
    else {
        messageElement.textContent = 'Info: Loading WASM backend';

        await new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.22.0/dist/tf-backend-wasm.min.js';

            script.onload = async () => {
                await tf.setBackend('wasm');
                messageElement.textContent = 'Info: Using WASM backend';
                resolve();
            };
            document.head.appendChild(script);
        });
    }
    
    messageElement.textContent = 'Info: Loading model';
    gestureEstimator = new GE([Rock, Paper, Scissors]);
    model = await handpose.load();
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

            if (model == null) {
                setupModel().then(() => {
                    setupCamera().then(() => {
                        if (cameraStream == null) return;
                        runGestureDetection();
                    });
                });
            } else {
                setupCamera().then(() => {
                    if (cameraStream == null) return;
                    runGestureDetection();
                });
            }
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
        Runner.prototype.gameOver = function() {};
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