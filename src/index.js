import '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

const CONFIG = {
  inferenceSize: 512,
  targetWidth: 3840,
  targetHeight: 2160
};

const AUTO_CAPTURE_CONFIG = {
  enabled: true,          // 自動撮影ON/OFF
  minScore: 0.5,          // このスコア以上のbboxだけ採用
  iouThreshold: 0.6,      // ガイド枠とのIoUがこの値以上で「一致」とみなす
  requiredMs: 1500        // このミリ秒以上一致していたら自動撮影
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

// 自動撮影用の状態
let alignStartTime = null;   // ガイドと一致し始めた時刻
let autoCapturing = false;   // 自動撮影中フラグ

async function initCamera() {
  try {
    statusEl.parentElement.classList.remove('hidden');
    statusEl.textContent = 'モデル読み込み中...';

    const [loadedModel, stream] = await Promise.all([
      cocoSsd.load(),
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

async function runInference() {
  inferenceCtx.drawImage(videoEl, 0, 0, CONFIG.inferenceSize, CONFIG.inferenceSize);

  try {
    latestPredictions = await model.detect(inferenceCanvas);
    checkAutoCapture();   // ★ 推論のたびに自動撮影判定
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

/**
 * ガイドフレーム（cardGuideEl）の位置を「overlayCanvas座標系」で取得
 */
function getGuideRectOnCanvas() {
  if (!cardGuideEl) return null;

  const guideRect = cardGuideEl.getBoundingClientRect();
  const canvasRect = overlayCanvas.getBoundingClientRect();

  // ガイド枠とキャンバスは画面上の別要素なので、
  // キャンバス左上を(0,0)とした相対座標に変換
  const x = guideRect.left - canvasRect.left;
  const y = guideRect.top - canvasRect.top;
  const w = guideRect.width;
  const h = guideRect.height;

  // キャンバス外に大きくはみ出している場合は無効
  if (w <= 0 || h <= 0) return null;

  return { x, y, w, h };
}

/**
 * 2つの矩形のIoU（Intersection over Union）を計算
 */
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

/**
 * ガイド枠と推論結果のbboxを比較して、
 * 一定時間以上良い位置にあれば自動撮影を行う
 */
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

  // 一番スコアの高いbboxを1つ選んで比較（クラスは問わない）
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
    // 位置がずれたらカウントリセット
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
      // 一度だけ自動撮影を走らせる
      autoCapturing = true;
      console.log('auto capture triggered, IoU =', bestIoU, 'score =', bestPred.score);

      triggerCapture('auto').finally(() => {
        autoCapturing = false;
        alignStartTime = null;
      });
    }
  }
}

/**
 * フレームを撮影して保存する共通処理
 * mode: 'manual' | 'auto'
 */
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

// 手動シャッター
captureBtn.addEventListener('click', () => {
  if (autoCapturing) return; // 自動撮影中はスキップ
  triggerCapture('manual');
});

initCamera();
