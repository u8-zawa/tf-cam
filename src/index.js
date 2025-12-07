import * as tf from '@tensorflow/tfjs';
import * as tflite from '@tensorflow/tfjs-tflite';

const CONFIG = {
  inferenceSize: 192,
  targetWidth: 3840,
  targetHeight: 2160
};

const TFLITE_MODEL_URL = `${import.meta.env.BASE_URL}model/1.tflite`;

const AUTO_CAPTURE_CONFIG = {
  enabled: true,
  minScore: 0.7,
  iouThreshold: 0.9,
  requiredMs: 1500
};

const videoEl = document.getElementById('preview-video');
const statusEl = document.getElementById('status');
const captureBtn = document.getElementById('shutter-btn');
const overlayCanvas = document.getElementById('overlay-canvas');
const overlayCtx = overlayCanvas.getContext('2d');
const cardGuideEl = document.getElementById('card-guide');

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

async function loadTfliteModel() {
  console.log('loading tflite model:', TFLITE_MODEL_URL);

  await tf.setBackend('webgl');
  await tf.ready();

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
    statusEl.parentElement.classList.remove('hidden');
    statusEl.textContent = 'モデル読み込み中...';

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
      const { width, height } = stream.getVideoTracks()[0].getSettings();
      console.log('Camera:', width, 'x', height);

      videoAspect = videoEl.videoWidth / videoEl.videoHeight;
      resizeOverlay();

      statusEl.parentElement.classList.add('hidden');
      requestAnimationFrame(mainLoop);
    };

    window.addEventListener('resize', resizeOverlay);
  } catch (err) {
    console.error('Error:', err);
    statusEl.textContent = 'エラー: ' + err.message;
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

function mainLoop() {
  if (videoEl.readyState >= videoEl.HAVE_CURRENT_DATA) {
    if (model && !isDetecting) {
      isDetecting = true;
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

    const boxes = res['TFLite_Detection_PostProcess'].arraySync()[0];       // [N, 4]
    const scores = res['TFLite_Detection_PostProcess:2'].arraySync()[0];    // [N]
    const classes = res['TFLite_Detection_PostProcess:1'].arraySync()[0];   // [N]
    const numDetections = res['TFLite_Detection_PostProcess:3'].arraySync()[0]; // [1] -> scalar

    const preds = [];

    for (let i = 0; i < numDetections; i++) {
      const score = scores[i];
      if (score < 0.7) continue;

      const [ymin, xmin, ymax, xmax] = boxes[i];

      const x = xmin * CONFIG.inferenceSize;
      const y = ymin * CONFIG.inferenceSize;
      const w = (xmax - xmin) * CONFIG.inferenceSize;
      const h = (ymax - ymin) * CONFIG.inferenceSize;

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

function getGuideRectOnCanvas() {
  if (!cardGuideEl) return null;

  const guideRect = cardGuideEl.getBoundingClientRect();
  const canvasRect = overlayCanvas.getBoundingClientRect();

  const x = guideRect.left - canvasRect.left;
  const y = guideRect.top - canvasRect.top;
  const w = guideRect.width;
  const h = guideRect.height;

  if (w <= 0 || h <= 0) return null;

  return { x, y, w, h };
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

function checkAutoCapture() {
  if (!AUTO_CAPTURE_CONFIG.enabled) return;
  if (!latestPredictions.length) {
    alignStartTime = null;
    return;
  }

  const guideRect = getGuideRectOnCanvas();
  if (!guideRect) {
    alignStartTime = null;
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
    if (alignStartTime !== null) {
      console.log('alignment lost, IoU =', bestIoU);
    }
    alignStartTime = null;
    return;
  }

  const now = performance.now();
  if (alignStartTime === null) {
    alignStartTime = now;
    statusEl.parentElement.classList.remove('hidden');
    statusEl.textContent = '枠に合わせています...';
  } else {
    const elapsed = now - alignStartTime;
    const remaining = Math.max(0, AUTO_CAPTURE_CONFIG.requiredMs - elapsed);
    const remainSec = (remaining / 1000).toFixed(1);

    statusEl.parentElement.classList.remove('hidden');
    statusEl.textContent = `自動撮影まで ${remainSec} 秒`;

    if (elapsed >= AUTO_CAPTURE_CONFIG.requiredMs && !autoCapturing) {
      autoCapturing = true;
      console.log('auto capture triggered, IoU =', bestIoU, 'score =', bestPred.score);

      triggerCapture('auto').finally(() => {
        autoCapturing = false;
        alignStartTime = null;
      });
    }
  }
}

async function triggerCapture(mode = 'manual') {
  if (videoEl.readyState < videoEl.HAVE_CURRENT_DATA) return;

  statusEl.parentElement.classList.remove('hidden');
  statusEl.textContent = mode === 'auto' ? '自動撮影中...' : '撮影処理中...';

  captureCanvas.width = videoEl.videoWidth;
  captureCanvas.height = videoEl.videoHeight;
  captureCtx.drawImage(videoEl, 0, 0);

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

initCamera();
