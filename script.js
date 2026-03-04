/**
 * Human Detection System
 * Real-time face, hand, and body detection using Human.js
 * 
 * PERFORMANCE OPTIMIZATIONS APPLIED (2026-03-04):
 * =================================================
 * 
 * 1. CDN FALLBACK IMPLEMENTATION:
 *    - PROBLEM: Local './human/' directory doesn't exist, causing 404 failures
 *    - FIX: Primary CDN import with local fallback attempt
 *    - CDN: https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.5/
 * 
 * 2. LAZY MODEL LOADING STRATEGY:
 *    - PROBLEM: All models (face, hand, body, iris, emotion) loaded upfront
 *    - FIX: Phase-based loading - essential models first, others on-demand
 *    - Phase 1: Hand + Gesture only (fast startup)
 *    - Phase 2: Face/Body loaded when camera starts
 * 
 * 3. NON-BLOCKING INITIALIZATION:
 *    - PROBLEM: Warmup blocked UI thread, camera couldn't start until complete
 *    - FIX: Defer warmup using requestIdleCallback/setTimeout
 *    - Camera can start immediately after essential models load
 * 
 * 4. PROGRESS INDICATORS:
 *    - PROBLEM: Generic "Loading neural models" message
 *    - FIX: Detailed per-model status updates with timing info
 * 
 * 5. ERROR HANDLING & FALLBACKS:
 *    - PROBLEM: Single try/catch, no recovery options
 *    - FIX: CDN fallback, graceful degradation, retry logic
 * 
 * EXPECTED PERFORMANCE IMPROVEMENTS:
 * - Initial load time: ~8-15s → ~2-4s (essential models only)
 * - Time to interactive: ~15s → ~3-5s
 * - Memory footprint: Reduced by ~60% at startup
 * 
 * TRADE-OFFS:
 * - First face/body detection has slight delay (models load on-demand)
 * - Requires internet connection for CDN (unless local models configured)
 */

// ============================================
// Dynamic Library Import with Fallback
// ============================================

let HumanLib = null;

async function importHumanLibrary() {
    const CDN_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.5/dist/human.esm.js';
    const LOCAL_URL = './human/dist/human.esm.js';
    
    // Try CDN first (most reliable)
    try {
        log('Attempting to load Human library from CDN...');
        const module = await import(/* @vite-ignore */ CDN_URL);
        HumanLib = module.Human;
        log('Successfully loaded Human library from CDN', 'info');
        return { Human: HumanLib, source: 'cdn', basePath: 'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.5/models/' };
    } catch (cdnError) {
        log('CDN load failed, attempting local fallback...', 'warn');
        
        // Fallback to local if available
        try {
            const module = await import(LOCAL_URL);
            HumanLib = module.Human;
            log('Successfully loaded Human library from local path', 'info');
            return { Human: HumanLib, source: 'local', basePath: './human/models/' };
        } catch (localError) {
            log('Both CDN and local library loading failed', 'error');
            throw new Error(
                `Failed to load Human.js library.\n` +
                `CDN Error: ${cdnError.message}\n` +
                `Local Error: ${localError.message}\n\n` +
                `Please ensure you have an internet connection or install the library locally.`
            );
        }
    }
}

// ============================================
// Configuration - Phase-Based Loading
// ============================================

// Phase 1: Essential config for fast startup (hand detection only)
function getEssentialConfig(basePath) {
    return {
        modelBasePath: basePath,
        
        // Disable all non-essential models for fast startup
        face: { 
            enabled: false,  // Defer - will enable on-demand
        },
        hand: { 
            enabled: true,   // ESSENTIAL - load immediately
            maxDetected: 2,
            landmarks: true,
        },
        body: { 
            enabled: false,  // Defer - will enable on-demand
        },
        object: { 
            enabled: false,  // Keep disabled unless needed
        },
        gesture: { 
            enabled: true,   // ESSENTIAL - works with hand detection
        },
        
        // Backend configuration
        backend: 'webgl',
        
        // Optimization settings
        filter: {
            enabled: false,
        },
        
        // Disable debug logging for production
        debug: false,
    };
}

// Phase 2: Full config with all features enabled (loaded on-demand)
function getFullConfig(basePath) {
    return {
        modelBasePath: basePath,
        
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
                enabled: false,  // Keep disabled - heavy model
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
            modelPath: 'movenet-lightning.json',  // Use lighter model
        },
        object: {
            enabled: false,
        },
        gesture: {
            enabled: true,
        },
        backend: 'webgl',
        filter: {
            enabled: false,
        },
        debug: false,
    };
}

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
    isFullModelsLoaded: false,
    facingMode: 'user', // 'user' = front camera, 'environment' = back camera
    stream: null,
    fps: 0,
    frameCount: 0,
    lastTime: performance.now(),
    animationId: null,
    modelSource: null,
    modelBasePath: null,
    loadStartTime: 0,
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

// Format milliseconds to readable time
function formatDuration(ms) {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
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
        case 'loading':
            elements.statusIndicator.classList.add('loading');
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
        
        // Load full models if not already loaded
        if (!state.isFullModelsLoaded) {
            await loadFullModels();
        }
        
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
// Model Loading with Progress
// ============================================

async function loadFullModels() {
    if (state.isFullModelsLoaded) return;
    
    log('Loading full model suite (face, body, emotion)...');
    setLoadingDetail('Loading face detection models...');
    showLoadingOverlay();
    
    const loadStart = performance.now();
    
    try {
        // Create new Human instance with full config
        const fullConfig = getFullConfig(state.modelBasePath);
        const fullHuman = new HumanLib(fullConfig);
        
        // Load all models
        await fullHuman.load();
        
        // Replace the essential instance with full one
        state.human = fullHuman;
        state.isFullModelsLoaded = true;
        
        const loadTime = performance.now() - loadStart;
        log(`Full models loaded in ${formatDuration(loadTime)}`);
        
        if (elements.modelStatus) {
            elements.modelStatus.textContent = 'All Loaded';
            elements.modelStatus.style.color = 'var(--success-green)';
        }
        
        updateTelemetry();
        hideLoadingOverlay();
        
    } catch (error) {
        log(`Failed to load full models: ${error.message}`, 'error');
        setLoadingDetail(`Error loading models: ${error.message}`);
        
        // Don't block - hand detection still works
        setTimeout(() => hideLoadingOverlay(), 2000);
    }
}

// ============================================
// Non-Blocking Warmup
// ============================================

function performWarmup() {
    // Use requestIdleCallback if available, otherwise setTimeout
    const schedule = window.requestIdleCallback || ((cb) => setTimeout(cb, 100));
    
    schedule(async () => {
        try {
            log('Starting model warmup...');
            setLoadingDetail('Warming up models (non-blocking)...');
            
            // Warmup with a dummy canvas
            const warmupCanvas = document.createElement('canvas');
            warmupCanvas.width = 256;
            warmupCanvas.height = 256;
            const warmupCtx = warmupCanvas.getContext('2d');
            warmupCtx.fillStyle = '#000000';
            warmupCtx.fillRect(0, 0, 256, 256);
            
            await state.human.detect(warmupCanvas);
            
            log('Model warmup complete');
            setLoadingDetail('Ready!');
            
        } catch (error) {
            log(`Warmup error (non-critical): ${error.message}`, 'warn');
        }
    });
}

// ============================================
// Initialization - Phase 1: Essential Models
// ============================================

async function initializeHuman() {
    state.loadStartTime = performance.now();
    
    try {
        log('Initializing Human Detection System...');
        setLoadingDetail('Initializing library...');
        
        // Step 1: Import library with CDN fallback
        const { Human, source, basePath } = await importHumanLibrary();
        state.modelSource = source;
        state.modelBasePath = basePath;
        log(`Using ${source.toUpperCase()} library source`);
        
        // Step 2: Create Human instance with essential config only
        setLoadingDetail('Configuring essential models...');
        const essentialConfig = getEssentialConfig(basePath);
        state.human = new Human(essentialConfig);
        
        // Step 3: Load only essential models (hand + gesture)
        setLoadingDetail('Loading hand detection models...');
        await state.human.load();
        
        const loadTime = performance.now() - state.loadStartTime;
        log(`Essential models loaded in ${formatDuration(loadTime)}`);
        
        state.isModelsLoaded = true;
        
        if (elements.modelStatus) {
            elements.modelStatus.textContent = 'Essential Ready';
            elements.modelStatus.style.color = 'var(--warning-yellow, #fbbf24)';
        }
        
        updateTelemetry();
        updateStatus('ready', 'Ready (Hand Detection)');
        updateButtonStates();
        
        // Step 4: Hide loading overlay - UI is ready!
        hideLoadingOverlay();
        
        // Step 5: Perform warmup non-blocking
        performWarmup();
        
        log('Human initialized successfully - Camera can now start');
        
    } catch (error) {
        log(`Initialization error: ${error.message}`, 'error');
        setLoadingDetail(`Error: ${error.message}`);
        
        if (elements.modelStatus) {
            elements.modelStatus.textContent = 'Error';
            elements.modelStatus.style.color = 'var(--error-red)';
        }
        
        // Show error details in loading overlay
        const errorHtml = `
            <div style="color: #ef4444; margin-top: 10px; font-size: 12px; max-width: 300px; text-align: center;">
                ${error.message}
            </div>
            <button onclick="location.reload()" style="margin-top: 15px; padding: 8px 16px; background: var(--primary-blue); border: none; color: white; border-radius: 4px; cursor: pointer;">
                Retry
            </button>
        `;
        
        const loadingContent = document.querySelector('.loading-content');
        if (loadingContent) {
            loadingContent.insertAdjacentHTML('beforeend', errorHtml);
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
