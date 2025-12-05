import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

const CONFIG = {
  inferenceSize: 512
};

const RESOLUTION_PRESETS = {
  uhd: { width: 3840, height: 2160, label: '4K (3840 x 2160)' },
  fullhd: { width: 1920, height: 1080, label: 'フルHD (1920 x 1080)' },
  hd: { width: 1280, height: 720, label: 'HD (1280 x 720)' }
};
const BACKEND_LABELS = {
  webgl: 'WebGL (GPU優先)',
  cpu: 'CPU'
};

const videoEl = document.getElementById('preview-video');
const statusEl = document.getElementById('status');
const captureBtn = document.getElementById('shutter-btn');
const overlayCanvas = document.getElementById('overlay-canvas');
const overlayCtx = overlayCanvas.getContext('2d');
const debugToggleBtn = document.getElementById('debug-toggle');
const debugPanel = document.getElementById('debug-panel');
const fpsLabel = document.getElementById('fps-label');
const memoryLabel = document.getElementById('memory-label');
const resolutionSelect = document.getElementById('resolution-select');
const backendSelect = document.getElementById('backend-select');
const statusContainer = statusEl.parentElement;

const inferenceCanvas = new OffscreenCanvas(CONFIG.inferenceSize, CONFIG.inferenceSize);
const inferenceCtx = inferenceCanvas.getContext('2d', { willReadFrequently: true });

const captureCanvas = new OffscreenCanvas(1, 1);
const captureCtx = captureCanvas.getContext('2d');

let model = null;
let isDetecting = false;
let latestPredictions = [];
let videoAspect = 1;
let debugEnabled = false;
let lastFrameTimestamp = 0;
let lastDebugUpdate = 0;
const fpsSamples = [];
const FPS_SAMPLE_COUNT = 30;
let activeStream = null;
let setupInProgress = false;
let loopStarted = false;

function getSelectedResolution() {
  return RESOLUTION_PRESETS[resolutionSelect.value] ?? RESOLUTION_PRESETS.uhd;
}

function getSelectedBackendLabel() {
  return BACKEND_LABELS[backendSelect.value] ?? backendSelect.value;
}

function setControlsEnabled(enabled) {
  resolutionSelect.disabled = !enabled;
  backendSelect.disabled = !enabled;
}

function stopActiveStream() {
  if (!activeStream) return;
  activeStream.getTracks().forEach(track => track.stop());
  activeStream = null;
}

async function prepareModel() {
  const selectedBackend = backendSelect.value;
  if (model) {
    model.dispose?.();
    model = null;
  }
  latestPredictions = [];
  isDetecting = false;

  statusEl.textContent = `モデル読み込み中...（${getSelectedBackendLabel()}）`;
  await tf.setBackend(selectedBackend);
  await tf.ready();
  model = await cocoSsd.load();
}

async function startCamera() {
  const { width, height, label } = getSelectedResolution();
  stopActiveStream();
  latestPredictions = [];
  isDetecting = false;

  statusEl.textContent = `カメラ準備中...（${label}）`;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      width: { ideal: width },
      height: { ideal: height },
      facingMode: 'environment'
    }
  });

  activeStream = stream;
  videoEl.srcObject = stream;

  await new Promise(resolve => {
    videoEl.onloadedmetadata = () => {
      const { width: actualWidth, height: actualHeight } = stream.getVideoTracks()[0].getSettings();
      console.log('Camera:', actualWidth, 'x', actualHeight, 'backend:', backendSelect.value);

      if (videoEl.videoWidth && videoEl.videoHeight) {
        videoAspect = videoEl.videoWidth / videoEl.videoHeight;
      } else {
        videoAspect = width / height;
      }
      resizeOverlay();
      resolve();
    };
  });
}

async function applySettings({ reloadBackend = false } = {}) {
  if (setupInProgress) return;
  setupInProgress = true;
  setControlsEnabled(false);
  statusContainer.classList.remove('hidden');

  try {
    if (reloadBackend || !model) {
      await prepareModel();
    }
    await startCamera();

    statusContainer.classList.add('hidden');
    if (!loopStarted) {
      loopStarted = true;
      requestAnimationFrame(mainLoop);
    }
  } catch (err) {
    console.error('Error:', err);
    statusEl.textContent = 'エラー: ' + err.message;
  } finally {
    setupInProgress = false;
    setControlsEnabled(true);
  }
}

function resizeOverlay() {
  const containerAspect = window.innerWidth / window.innerHeight;
  if (containerAspect > videoAspect) {
    overlayCanvas.width = window.innerWidth;
    overlayCanvas.height = window.innerWidth / videoAspect;
  } else {
    overlayCanvas.height = window.innerHeight;
    overlayCanvas.width = window.innerHeight * videoAspect;
  }
  overlayCanvas.style.left = `${(window.innerWidth - overlayCanvas.width) / 2}px`;
  overlayCanvas.style.top = `${(window.innerHeight - overlayCanvas.height) / 2}px`;
}

function mainLoop(now) {
  if (videoEl.readyState >= videoEl.HAVE_CURRENT_DATA) {
    if (model && !isDetecting) {
      isDetecting = true;
      runInference();
    }
    drawOverlay();
    if (debugEnabled) updateDebugStats(now || performance.now());
  }
  requestAnimationFrame(mainLoop);
}

async function runInference() {
  inferenceCtx.drawImage(videoEl, 0, 0, CONFIG.inferenceSize, CONFIG.inferenceSize);

  try {
    latestPredictions = await model.detect(inferenceCanvas);
  } catch (e) {
    console.error('Inference Error:', e);
  }
  isDetecting = false;
}

function drawOverlay() {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!latestPredictions.length) return;

  const scaleX = overlayCanvas.width / CONFIG.inferenceSize;
  const scaleY = overlayCanvas.height / CONFIG.inferenceSize;

  overlayCtx.strokeStyle = '#00FFFF';
  overlayCtx.fillStyle = '#00FFFF';
  overlayCtx.lineWidth = 2;
  overlayCtx.font = '16px sans-serif';

  for (const { bbox, class: cls, score } of latestPredictions) {
    const [x, y, w, h] = bbox;
    const sx = x * scaleX, sy = y * scaleY, sw = w * scaleX, sh = h * scaleY;

    overlayCtx.strokeRect(sx, sy, sw, sh);

    const text = `${cls} (${Math.round(score * 100)}%)`;
    const tw = overlayCtx.measureText(text).width + 8;
    const ty = sy > 20 ? sy - 20 : sy;

    overlayCtx.fillRect(sx, ty, tw, 20);
    overlayCtx.fillStyle = '#000';
    overlayCtx.fillText(text, sx + 4, ty + 14);
    overlayCtx.fillStyle = '#00FFFF';
  }
}

captureBtn.addEventListener('click', async () => {
  if (videoEl.readyState < videoEl.HAVE_CURRENT_DATA) return;

  statusContainer.classList.remove('hidden');
  statusEl.textContent = '撮影処理中...';

  captureCanvas.width = videoEl.videoWidth;
  captureCanvas.height = videoEl.videoHeight;
  captureCtx.drawImage(videoEl, 0, 0);

  const blob = await captureCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: `capture_${Date.now()}.jpg`
  });
  a.click();
  URL.revokeObjectURL(url);

  statusEl.textContent = `保存完了: ${captureCanvas.width}x${captureCanvas.height}`;
  setTimeout(() => statusContainer.classList.add('hidden'), 2000);
});

function updateDebugStats(now) {
  if (lastFrameTimestamp) {
    const delta = now - lastFrameTimestamp;
    if (delta > 0) {
      fpsSamples.push(1000 / delta);
      if (fpsSamples.length > FPS_SAMPLE_COUNT) fpsSamples.shift();
    }
  }
  lastFrameTimestamp = now;

  if (now - lastDebugUpdate < 250) return;
  lastDebugUpdate = now;

  const fps = fpsSamples.length
    ? fpsSamples.reduce((sum, value) => sum + value, 0) / fpsSamples.length
    : 0;
  fpsLabel.textContent = `FPS: ${fps.toFixed(1)}`;

  const mem = performance.memory;
  if (mem && mem.usedJSHeapSize && mem.jsHeapSizeLimit) {
    const used = mem.usedJSHeapSize / 1048576;
    const limit = mem.jsHeapSizeLimit / 1048576;
    memoryLabel.textContent = `メモリ: ${used.toFixed(1)}MB / ${limit.toFixed(0)}MB`;
  } else {
    memoryLabel.textContent = 'メモリ: 未対応';
  }
}

debugToggleBtn.addEventListener('click', () => {
  debugEnabled = !debugEnabled;
  debugPanel.classList.toggle('hidden', !debugEnabled);
  debugToggleBtn.textContent = debugEnabled ? 'デバッグ表示 OFF' : 'デバッグ表示 ON';

  if (!debugEnabled) {
    fpsSamples.length = 0;
    lastFrameTimestamp = 0;
    lastDebugUpdate = 0;
    fpsLabel.textContent = 'FPS: --';
    memoryLabel.textContent = 'メモリ: --';
  }
});

resolutionSelect.addEventListener('change', () => applySettings({ reloadBackend: false }));
backendSelect.addEventListener('change', () => applySettings({ reloadBackend: true }));
window.addEventListener('resize', resizeOverlay);

applySettings({ reloadBackend: true });
