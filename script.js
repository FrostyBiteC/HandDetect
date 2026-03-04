/**
 * Human Detection System
 * Real-time face, hand, and body detection using Human.js
 */

import { Human } from './human/dist/human.esm.js';

// ============================================
// Configuration
// ============================================

const config = {
    // Model paths
    modelBasePath: './human/models/',
    
    // Detection configuration
    face: {
        enabled: true,
        detector: {
            enabled: true,
            rotation: true,
            maxDetected: 5,
        },
        mesh: {
            enabled: true,
        },
        iris: {
            enabled: true,
        },
        description: {
            enabled: false,
        },
        emotion: {
            enabled: true,
        },
    },
    hand: {
        enabled: true,
        maxDetected: 2,
        landmarks: true,
    },
    body: {
        enabled: true,
        maxDetected: 5,
        modelPath: 'movenet-lightning.json',
    },
    object: {
        enabled: false,
    },
    gesture: {
        enabled: true,
    },
    // Backend configuration
    backend: 'webgl',
    // Filter settings
    filter: {
        enabled: false,
    },
    // Logging
    debug: false,
};

// ============================================
// State Management
// ============================================

const state = {
    human: null,
    video: null,
    canvas: null,
    ctx: null,
    isCameraRunning: false,
    isModelsLoaded: false,
    facingMode: 'user', // 'user' = front camera, 'environment' = back camera
    stream: null,
    fps: 0,
    frameCount: 0,
    lastTime: performance.now(),
    animationId: null,
};

// ============================================
// DOM Elements
// ============================================

const elements = {
    video: null,
    canvas: null,
    statusIndicator: null,
    statusText: null,
    fpsValue: null,
    faceCount: null,
    handCount: null,
    bodyCount: null,
    humanVersion: null,
    modelStatus: null,
    backendInfo: null,
    resolutionInfo: null,
    loadingOverlay: null,
    loadingDetail: null,
    btnCamera: null,
    btnFlip: null,
};

// ============================================
// Utility Functions
// ============================================

function getElement(id) {
    return document.getElementById(id);
}

function log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[${timestamp}]`;
    switch (type) {
        case 'error':
            console.error(prefix, message);
            break;
        case 'warn':
            console.warn(prefix, message);
            break;
        default:
            console.log(prefix, message);
    }
}

// ============================================
// UI Updates
// ============================================

function updateStatus(status, text) {
    if (!elements.statusIndicator || !elements.statusText) return;
    
    elements.statusIndicator.className = 'status-indicator';
    elements.statusText.textContent = text;
    
    switch (status) {
        case 'initializing':
            elements.statusIndicator.classList.add('initializing');
            break;
        case 'ready':
            elements.statusIndicator.classList.add('ready');
            break;
        case 'active':
            elements.statusIndicator.classList.add('active');
            break;
        default:
            elements.statusIndicator.classList.add('initializing');
    }
}

function updateFPS(fps) {
    if (elements.fpsValue) {
        elements.fpsValue.textContent = Math.round(fps);
    }
}

function updateDetectionCounts(result) {
    if (!result) return;
    
    const faceCount = result.face?.length || 0;
    const handCount = result.hand?.length || 0;
    const bodyCount = result.body?.length || 0;
    
    if (elements.faceCount) elements.faceCount.textContent = faceCount;
    if (elements.handCount) elements.handCount.textContent = handCount;
    if (elements.bodyCount) elements.bodyCount.textContent = bodyCount;
}

function updateTelemetry() {
    if (state.human) {
        if (elements.humanVersion) {
            elements.humanVersion.textContent = state.human.version || 'Unknown';
        }
        if (elements.backendInfo) {
            elements.backendInfo.textContent = state.human.config?.backend || 'webgl';
        }
    }
}

function updateResolution() {
    if (state.video && elements.resolutionInfo) {
        const width = state.video.videoWidth;
        const height = state.video.videoHeight;
        if (width && height) {
            elements.resolutionInfo.textContent = `${width}x${height}`;
        }
    }
}

function setLoadingDetail(text) {
    if (elements.loadingDetail) {
        elements.loadingDetail.textContent = text;
    }
}

function hideLoadingOverlay() {
    if (elements.loadingOverlay) {
        elements.loadingOverlay.classList.add('hidden');
    }
}

function showLoadingOverlay() {
    if (elements.loadingOverlay) {
        elements.loadingOverlay.classList.remove('hidden');
    }
}

function updateButtonStates() {
    if (elements.btnCamera) {
        elements.btnCamera.disabled = !state.isModelsLoaded;
        const btnText = elements.btnCamera.querySelector('.btn-text');
        const btnIcon = elements.btnCamera.querySelector('.btn-icon');
        
        if (state.isCameraRunning) {
            if (btnText) btnText.textContent = 'STOP CAMERA';
            if (btnIcon) btnIcon.textContent = '⏹';
            elements.btnCamera.classList.add('active');
        } else {
            if (btnText) btnText.textContent = 'START CAMERA';
            if (btnIcon) btnIcon.textContent = '▶';
            elements.btnCamera.classList.remove('active');
        }
    }
    
    if (elements.btnFlip) {
        elements.btnFlip.disabled = !state.isCameraRunning;
    }
}

// ============================================
// Camera Functions
// ============================================

async function startCamera() {
    try {
        log('Starting camera...');
        
        const constraints = {
            audio: false,
            video: {
                facingMode: state.facingMode,
                width: { ideal: 1280 },
                height: { ideal: 720 },
            },
        };
        
        state.stream = await navigator.mediaDevices.getUserMedia(constraints);
        state.video.srcObject = state.stream;
        
        await new Promise((resolve) => {
            state.video.onloadedmetadata = () => {
                resolve();
            };
        });
        
        await state.video.play();
        
        // Set canvas dimensions to match video
        state.canvas.width = state.video.videoWidth;
        state.canvas.height = state.video.videoHeight;
        
        updateResolution();
        state.isCameraRunning = true;
        updateStatus('active', 'Active');
        updateButtonStates();
        
        // Start processing loop
        startProcessingLoop();
        
        log('Camera started successfully');
    } catch (error) {
        log(`Failed to start camera: ${error.message}`, 'error');
        alert(`Camera access error: ${error.message}\n\nPlease ensure you have granted camera permissions.`);
    }
}

function stopCamera() {
    log('Stopping camera...');
    
    // Stop processing loop
    if (state.animationId) {
        cancelAnimationFrame(state.animationId);
        state.animationId = null;
    }
    
    // Stop all tracks in the stream
    if (state.stream) {
        state.stream.getTracks().forEach(track => track.stop());
        state.stream = null;
    }
    
    state.video.srcObject = null;
    state.isCameraRunning = false;
    
    // Clear canvas
    if (state.ctx) {
        state.ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
    }
    
    // Reset counters
    updateDetectionCounts({ face: [], hand: [], body: [] });
    updateFPS(0);
    
    updateStatus('ready', 'Ready');
    updateButtonStates();
    
    log('Camera stopped');
}

function flipCamera() {
    if (!state.isCameraRunning) return;
    
    state.facingMode = state.facingMode === 'user' ? 'environment' : 'user';
    log(`Switching to ${state.facingMode === 'user' ? 'front' : 'back'} camera...`);
    
    // Toggle flip class on video for mirroring
    if (state.facingMode === 'user') {
        state.video.classList.add('flipped');
    } else {
        state.video.classList.remove('flipped');
    }
    
    // Stop and restart camera with new facing mode
    stopCamera();
    startCamera();
}

// ============================================
// Processing Loop
// ============================================

async function processFrame() {
    if (!state.isCameraRunning || !state.human) return;
    
    try {
        // Perform detection
        const result = await state.human.detect(state.video);
        
        // Clear canvas
        state.ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
        
        // Draw video frame (optional - can skip if canvas is transparent)
        // state.ctx.drawImage(state.video, 0, 0, state.canvas.width, state.canvas.height);
        
        // Draw detection results
        await state.human.draw.all(state.canvas, result);
        
        // Update detection counters
        updateDetectionCounts(result);
        
        // Calculate FPS
        state.frameCount++;
        const currentTime = performance.now();
        const elapsed = currentTime - state.lastTime;
        
        if (elapsed >= 1000) {
            state.fps = (state.frameCount * 1000) / elapsed;
            updateFPS(state.fps);
            state.frameCount = 0;
            state.lastTime = currentTime;
        }
    } catch (error) {
        log(`Processing error: ${error.message}`, 'error');
    }
}

function startProcessingLoop() {
    const loop = async () => {
        if (!state.isCameraRunning) return;
        
        await processFrame();
        state.animationId = requestAnimationFrame(loop);
    };
    
    loop();
}

// ============================================
// Initialization
// ============================================

async function initializeHuman() {
    try {
        log('Initializing Human...');
        setLoadingDetail('Initializing Human library...');
        
        state.human = new Human(config);
        
        setLoadingDetail('Loading neural models...');
        await state.human.load();
        
        log('Models loaded successfully');
        setLoadingDetail('Warming up models...');
        
        // Warmup with a dummy canvas
        const warmupCanvas = document.createElement('canvas');
        warmupCanvas.width = 256;
        warmupCanvas.height = 256;
        const warmupCtx = warmupCanvas.getContext('2d');
        warmupCtx.fillStyle = '#000000';
        warmupCtx.fillRect(0, 0, 256, 256);
        await state.human.detect(warmupCanvas);
        
        state.isModelsLoaded = true;
        
        if (elements.modelStatus) {
            elements.modelStatus.textContent = 'Loaded';
            elements.modelStatus.style.color = 'var(--success-green)';
        }
        
        updateTelemetry();
        updateStatus('ready', 'Ready');
        updateButtonStates();
        hideLoadingOverlay();
        
        log('Human initialized successfully');
    } catch (error) {
        log(`Initialization error: ${error.message}`, 'error');
        setLoadingDetail(`Error: ${error.message}`);
        if (elements.modelStatus) {
            elements.modelStatus.textContent = 'Error';
            elements.modelStatus.style.color = 'var(--error-red)';
        }
    }
}

function cacheElements() {
    elements.video = getElement('input-video');
    elements.canvas = getElement('output-canvas');
    elements.statusIndicator = getElement('status-indicator');
    elements.statusText = getElement('status-text');
    elements.fpsValue = getElement('fps-value');
    elements.faceCount = getElement('face-count');
    elements.handCount = getElement('hand-count');
    elements.bodyCount = getElement('body-count');
    elements.humanVersion = getElement('human-version');
    elements.modelStatus = getElement('model-status');
    elements.backendInfo = getElement('backend-info');
    elements.resolutionInfo = getElement('resolution-info');
    elements.loadingOverlay = getElement('loading-overlay');
    elements.loadingDetail = getElement('loading-detail');
    elements.btnCamera = getElement('btn-camera');
    elements.btnFlip = getElement('btn-flip');
}

function setupEventListeners() {
    // Camera button
    if (elements.btnCamera) {
        elements.btnCamera.addEventListener('click', () => {
            if (state.isCameraRunning) {
                stopCamera();
            } else {
                startCamera();
            }
        });
    }
    
    // Flip camera button
    if (elements.btnFlip) {
        elements.btnFlip.addEventListener('click', flipCamera);
    }
    
    // Handle window resize
    window.addEventListener('resize', () => {
        if (state.isCameraRunning && state.video && state.canvas) {
            state.canvas.width = state.video.videoWidth;
            state.canvas.height = state.video.videoHeight;
        }
    });
    
    // Handle page visibility change (pause when tab hidden)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && state.isCameraRunning) {
            // Optional: pause processing when tab is hidden
            // stopCamera();
        }
    });
}

function init() {
    log('Initializing Human Detection System...');
    
    // Cache DOM elements
    cacheElements();
    
    // Set initial state
    state.video = elements.video;
    state.canvas = elements.canvas;
    
    if (state.canvas) {
        state.ctx = state.canvas.getContext('2d');
    }
    
    // Initialize video with flipped class for front camera
    if (state.video) {
        state.video.classList.add('flipped');
    }
    
    // Setup event listeners
    setupEventListeners();
    
    // Update initial UI state
    updateStatus('initializing', 'Initializing...');
    updateButtonStates();
    
    // Initialize Human library
    initializeHuman();
}

// ============================================
// Start Application
// ============================================

// Wait for DOM to be ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
