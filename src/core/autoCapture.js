import { CONFIG, MODE_CARD, MODE_DOCUMENT, MODE_RECEIPT } from '../config.js';
import { showStatus, hideStatus } from '../ui/status.js';

let guideRectOnCanvas = null;
let alignStartTime = null;
let autoCapturing = false;

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
 * ガイド枠の DOM 位置をキャンバス座標系に変換してキャッシュ
 */
export function updateGuideRectCache(
  currentMode,
  { cardGuideEl, documentGuideEl, receiptGuideEl },
  overlayCanvas
) {
  let activeGuideEl = null;
  if (currentMode === MODE_CARD) {
    activeGuideEl = cardGuideEl;
  } else if (currentMode === MODE_DOCUMENT) {
    activeGuideEl = documentGuideEl;
  } else if (currentMode === MODE_RECEIPT) {
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

export function getGuideRectOnCanvas() {
  return guideRectOnCanvas;
}

export function isAutoCapturing() {
  return autoCapturing;
}

/**
 * 自動撮影ロジック
 * @param {Array} predictions - TFLiteの推論結果
 * @param {HTMLCanvasElement | OffscreenCanvas} overlayCanvas
 * @param {(mode: 'auto', bbox: number[]) => Promise<void>} triggerCapture
 */
export function handleAutoCapture(predictions, overlayCanvas, triggerCapture) {
  if (!CONFIG.autoCapture.enabled) return;

  if (!predictions || !predictions.length) {
    alignStartTime = null;
    hideStatus();
    return;
  }

  const guideRect = guideRectOnCanvas;
  if (!guideRect || !overlayCanvas) {
    alignStartTime = null;
    hideStatus();
    return;
  }

  const scaleX = overlayCanvas.width / CONFIG.inferenceSize;
  const scaleY = overlayCanvas.height / CONFIG.inferenceSize;

  let bestIoU = 0;
  let bestPred = null;

  for (const pred of predictions) {
    if (pred.score < CONFIG.autoCapture.minScore) continue;

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

  if (!bestPred || bestIoU < CONFIG.autoCapture.iouThreshold) {
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
    const remaining = Math.max(0, CONFIG.autoCapture.requiredMs - elapsed);
    const remainSec = (remaining / 1000).toFixed(1);

    showStatus(`自動撮影まで ${remainSec} 秒`);

    if (elapsed >= CONFIG.autoCapture.requiredMs && !autoCapturing) {
      autoCapturing = true;
      console.log('auto capture triggered, IoU =', bestIoU, 'score =', bestPred.score);

      Promise.resolve(triggerCapture('auto', bestPred.bbox))
        .catch((e) => {
          console.error('自動撮影中にエラーが発生しました:', e);
        })
        .finally(() => {
          autoCapturing = false;
          alignStartTime = null;
        });
    }
  }
}
