import * as tf from '@tensorflow/tfjs';
import * as tflite from '@tensorflow/tfjs-tflite';

const CONFIG = {
  inferenceSize: 192,
  targetWidth: 3840,
  targetHeight: 2160
};

const TFLITE_MODEL_URL = `${import.meta.env.BASE_URL}model/1.tflite`;
const PREFERRED_BACKENDS = ['webgl', 'cpu'];

const AUTO_CAPTURE_CONFIG = {
  enabled: true,
  minScore: 0.7,
  iouThreshold: 0.9,
  requiredMs: 1500
};

// 推論を間引く間隔（ms）
// 16ms = 60fps なので「80〜120ms 程度」が体感と負荷のバランスが良い
const DETECTION_INTERVAL_MS = 100;

const videoEl = document.getElementById('preview-video');
const statusEl = document.getElementById('status');
const captureBtn = document.getElementById('shutter-btn');
const overlayCanvas = document.getElementById('overlay-canvas');
const overlayCtx = overlayCanvas.getContext('2d');
const cardGuideEl = document.getElementById('card-guide');
const documentGuideEl = document.getElementById('document-guide');
const receiptGuideEl = document.getElementById('receipt-guide');

const MODE_CARD = 'card';
const MODE_DOCUMENT = 'document';
const MODE_RECEIPT = 'receipt';
let currentGuideMode = MODE_CARD;

const cardModeBtn = document.getElementById('mode-card-btn');
const documentModeBtn = document.getElementById('mode-document-btn');
const receiptModeBtn = document.getElementById('mode-receipt-btn');
const receiptControl = document.getElementById('receipt-control');
const receiptRange = document.getElementById('receipt-length-range');
const inferenceCanvas = new OffscreenCanvas(CONFIG.inferenceSize, CONFIG.inferenceSize);
const inferenceCtx = inferenceCanvas.getContext('2d', { willReadFrequently: true });

const captureCanvas = new OffscreenCanvas(1, 1);
const captureCtx = captureCanvas.getContext('2d');

let model = null;
let isDetecting = false;
let latestPredictions = [];
let videoAspect = 1;
let alignStartTime = null;
let autoCapturing = false;
let lastDetectionTime = 0;
let guideRectOnCanvas = null;
const statusState = {
  visible: false,
  text: ''
};

function setMode(mode) {
  currentGuideMode = mode;

  if (cardGuideEl) cardGuideEl.classList.toggle('hidden', mode !== MODE_CARD);
  if (documentGuideEl) documentGuideEl.classList.toggle('hidden', mode !== MODE_DOCUMENT);
  if (receiptGuideEl) receiptGuideEl.classList.toggle('hidden', mode !== MODE_RECEIPT);

  if (receiptControl) receiptControl.classList.toggle('hidden', mode !== MODE_RECEIPT);

  const active = 'px-3 py-1 rounded-full text-xs font-semibold bg-white text-black/80 shadow-md border-transparent';
  const inactive = 'px-3 py-1 rounded-full text-xs font-semibold bg-white/20 text-white/80 border border-white/40 shadow-none';
  if (cardModeBtn) cardModeBtn.className = mode === MODE_CARD ? active : inactive;
  if (documentModeBtn) documentModeBtn.className = mode === MODE_DOCUMENT ? active : inactive;
  if (receiptModeBtn) receiptModeBtn.className = mode === MODE_RECEIPT ? active : inactive;

  // ガイド枠の座標キャッシュを更新
  updateGuideRectCache();
}

function showStatus(text) {
  if (!statusEl) return;

  const wrapper = statusEl.parentElement;
  if (!wrapper) return;

  // 同じテキストなら何もしない
  if (statusState.visible && statusState.text === text) return;

  statusState.visible = true;
  statusState.text = text;

  wrapper.classList.remove('hidden');
  statusEl.textContent = text;
}

function hideStatus() {
  if (!statusEl) return;
  const wrapper = statusEl.parentElement;
  if (!wrapper) return;

  if (!statusState.visible) return;

  statusState.visible = false;
  statusState.text = '';

  wrapper.classList.add('hidden');
}

function rectIoU(a, b) {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;

  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);

  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;

  if (inter <= 0) return 0;

  const areaA = a.w * a.h;
  const areaB = b.w * b.h;
  const union = areaA + areaB - inter;

  return union > 0 ? inter / union : 0;
}

async function initBackend() {
  for (const name of PREFERRED_BACKENDS) {
    try {
      const ok = await tf.setBackend(name);
      if (!ok) {
        console.warn(`tf.setBackend(${name}) returned false`);
        continue;
      }
      await tf.ready();
      console.log(`✅ Using TF.js backend: ${name}`);
      return name;
    } catch (e) {
      console.warn(`⚠️ Failed to init backend: ${name}`, e);
    }
  }

  throw new Error(`利用可能な TensorFlow.js バックエンドがありません: ${PREFERRED_BACKENDS.join(', ')}`);
}

async function loadTfliteModel() {
  console.log('loading tflite model:', TFLITE_MODEL_URL);

  const backend = await initBackend();
  console.log('selected backend:', backend);

  const net = await tflite.loadTFLiteModel(TFLITE_MODEL_URL);

  tf.tidy(() => {
    const dummy = tf.ones(
      [1, CONFIG.inferenceSize, CONFIG.inferenceSize, 3],
      'int32'
    );
    net.predict(dummy);
  });

  console.log('tflite model loaded');
  return net;
}

async function initCamera() {
  try {
    showStatus('モデル読み込み中...');

    const [loadedModel, stream] = await Promise.all([
      loadTfliteModel(),
      navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: CONFIG.targetWidth },
          height: { ideal: CONFIG.targetHeight },
          facingMode: 'environment'
        }
      })
    ]);

    model = loadedModel;
    videoEl.srcObject = stream;

    videoEl.onloadedmetadata = () => {
      const track = stream.getVideoTracks()[0];
      const { width, height } = track.getSettings();

      console.log('Camera:', width, 'x', height);

      videoAspect = videoEl.videoWidth / videoEl.videoHeight || (width / height);

      resizeOverlay();

      hideStatus();
      requestAnimationFrame(mainLoop);
    };

    window.addEventListener('resize', () => {
      resizeOverlay();
    });
  } catch (err) {
    console.error('Error:', err);
    showStatus(`エラー: ${err.message}`);
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

  updateGuideRectCache();
}

function updateGuideRectCache() {
  let activeGuideEl = null;
  if (currentGuideMode === MODE_CARD) {
    activeGuideEl = cardGuideEl;
  } else if (currentGuideMode === MODE_DOCUMENT) {
    activeGuideEl = documentGuideEl;
  } else if (currentGuideMode === MODE_RECEIPT) {
    activeGuideEl = receiptGuideEl;
  }

  if (!activeGuideEl || !overlayCanvas) {
    guideRectOnCanvas = null;
    return;
  }

  const guideRect = activeGuideEl.getBoundingClientRect();
  const canvasRect = overlayCanvas.getBoundingClientRect();

  const x = guideRect.left - canvasRect.left;
  const y = guideRect.top - canvasRect.top;
  const w = guideRect.width;
  const h = guideRect.height;

  if (w <= 0 || h <= 0) {
    guideRectOnCanvas = null;
    return;
  }

  guideRectOnCanvas = { x, y, w, h };
}

function getGuideRectOnCanvas() {
  return guideRectOnCanvas;
}

function mainLoop(now) {
  if (videoEl.readyState >= videoEl.HAVE_CURRENT_DATA) {
    if (model && !isDetecting && (now - lastDetectionTime) >= DETECTION_INTERVAL_MS) {
      isDetecting = true;
      lastDetectionTime = now;
      runInference();
    }
    drawOverlay();
  }

  requestAnimationFrame(mainLoop);
}

function runTfliteDetection(net, sourceCanvas) {
  return tf.tidy(() => {
    const input = tf.browser
      .fromPixels(sourceCanvas)                            // [H, W, 3]
      .resizeBilinear([CONFIG.inferenceSize, CONFIG.inferenceSize])
      .expandDims(0)                                       // [1, 192, 192, 3]
      .toInt();                                            // 多くの TFLite OD モデルは int32/uint8

    const res = net.predict(input);

    const boxesTensor = res['TFLite_Detection_PostProcess'];
    const classesTensor = res['TFLite_Detection_PostProcess:1'];
    const scoresTensor = res['TFLite_Detection_PostProcess:2'];
    const numTensor = res['TFLite_Detection_PostProcess:3'];

    const boxes = boxesTensor.dataSync();    // [N,4] が 1 次元に並んでいる
    const classes = classesTensor.dataSync();
    const scores = scoresTensor.dataSync();
    const numDetections = numTensor.dataSync()[0]; // scalar

    const preds = [];
    const size = CONFIG.inferenceSize;

    for (let i = 0; i < numDetections; i++) {
      const score = scores[i];
      if (score < AUTO_CAPTURE_CONFIG.minScore) continue;

      const base = i * 4;
      const ymin = boxes[base + 0];
      const xmin = boxes[base + 1];
      const ymax = boxes[base + 2];
      const xmax = boxes[base + 3];

      const x = xmin * size;
      const y = ymin * size;
      const w = (xmax - xmin) * size;
      const h = (ymax - ymin) * size;

      preds.push({
        bbox: [x, y, w, h],
        class: `cls_${classes[i]}`,
        score
      });
    }

    return preds;
  });
}

async function runInference() {
  inferenceCtx.drawImage(videoEl, 0, 0, CONFIG.inferenceSize, CONFIG.inferenceSize);

  try {
    latestPredictions = runTfliteDetection(model, inferenceCanvas);
    checkAutoCapture();
  } catch (e) {
    console.error('Inference Error:', e);
  } finally {
    isDetecting = false;
  }
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
    const sx = x * scaleX;
    const sy = y * scaleY;
    const sw = w * scaleX;
    const sh = h * scaleY;

    overlayCtx.strokeRect(sx, sy, sw, sh);

    const text = `${cls} (${Math.round(score * 100)}%)`;
    const tw = overlayCtx.measureText(text).width + 8;
    const ty = sy > 24 ? sy - 24 : sy + 4;

    overlayCtx.fillRect(sx, ty, tw, 20);
    overlayCtx.fillStyle = '#000';
    overlayCtx.fillText(text, sx + 4, ty + 14);
    overlayCtx.fillStyle = '#00FFFF';
  }
}


function checkAutoCapture() {
  if (!AUTO_CAPTURE_CONFIG.enabled) return;
  if (!latestPredictions.length) {
    alignStartTime = null;
    hideStatus();
    return;
  }

  const guideRect = getGuideRectOnCanvas();
  if (!guideRect) {
    alignStartTime = null;
    hideStatus();
    return;
  }

  const scaleX = overlayCanvas.width / CONFIG.inferenceSize;
  const scaleY = overlayCanvas.height / CONFIG.inferenceSize;

  let bestIoU = 0;
  let bestPred = null;

  for (const pred of latestPredictions) {
    if (pred.score < AUTO_CAPTURE_CONFIG.minScore) continue;

    const [x, y, w, h] = pred.bbox;
    const rectOnCanvas = {
      x: x * scaleX,
      y: y * scaleY,
      w: w * scaleX,
      h: h * scaleY
    };

    const iou = rectIoU(guideRect, rectOnCanvas);
    if (iou > bestIoU) {
      bestIoU = iou;
      bestPred = pred;
    }
  }

  if (!bestPred || bestIoU < AUTO_CAPTURE_CONFIG.iouThreshold) {
    alignStartTime = null;
    hideStatus();
    return;
  }

  const now = performance.now();
  if (alignStartTime === null) {
    alignStartTime = now;
    showStatus('枠に合わせています...');
  } else {
    const elapsed = now - alignStartTime;
    const remaining = Math.max(0, AUTO_CAPTURE_CONFIG.requiredMs - elapsed);
    const remainSec = (remaining / 1000).toFixed(1);

    showStatus(`自動撮影まで ${remainSec} 秒`);

    if (elapsed >= AUTO_CAPTURE_CONFIG.requiredMs && !autoCapturing) {
      autoCapturing = true;
      console.log('auto capture triggered, IoU =', bestIoU, 'score =', bestPred.score);

      triggerCapture('auto', bestPred.bbox).finally(() => {
        autoCapturing = false;
        alignStartTime = null;
      });
    }
  }
}

async function triggerCapture(mode = 'manual', cropBbox = null) {
  if (videoEl.readyState < videoEl.HAVE_CURRENT_DATA) return;

  showStatus(mode === 'auto' ? '自動撮影中...' : '撮影処理中...');

  const videoW = videoEl.videoWidth;
  const videoH = videoEl.videoHeight;

  if (mode === 'auto' && cropBbox) {
    const [bx, by, bw, bh] = cropBbox;

    const scaleX = videoW / CONFIG.inferenceSize;
    const scaleY = videoH / CONFIG.inferenceSize;

    const sx = Math.max(0, bx * scaleX);
    const sy = Math.max(0, by * scaleY);
    const sw = Math.min(videoW - sx, bw * scaleX);
    const sh = Math.min(videoH - sy, bh * scaleY);

    captureCanvas.width = sw;
    captureCanvas.height = sh;

    captureCtx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, sw, sh);

  } else {
    captureCanvas.width = videoW;
    captureCanvas.height = videoH;
    captureCtx.drawImage(videoEl, 0, 0);
  }

  const blob = await captureCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: `capture_${Date.now()}_${mode}.jpg`
  });
  a.click();
  URL.revokeObjectURL(url);

  statusEl.textContent = `保存完了 (${mode === 'auto' ? '自動' : '手動'}): ${captureCanvas.width}x${captureCanvas.height}`;
  setTimeout(() => statusEl.parentElement.classList.add('hidden'), 2000);
}

captureBtn.addEventListener('click', () => {
  if (autoCapturing) return;
  triggerCapture('manual');
});

cardModeBtn.addEventListener('click', () => setMode(MODE_CARD));
documentModeBtn.addEventListener('click', () => setMode(MODE_DOCUMENT));
receiptModeBtn.addEventListener('click', () => setMode(MODE_RECEIPT));

if (receiptRange && receiptGuideEl) {
  receiptRange.addEventListener('input', (e) => {
    const ratio = Number(e.target.value) || 2;
    receiptGuideEl.style.setProperty('--receipt-ratio', ratio);

    updateGuideRectCache();
  });

  receiptGuideEl.style.setProperty('--receipt-ratio', receiptRange.value || 2);
}

setMode(currentGuideMode);
initCamera();
