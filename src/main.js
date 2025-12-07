import {
  CONFIG,
  MODE_CARD,
  MODE_DOCUMENT,
  MODE_RECEIPT
} from './config.js';
import { showStatus } from './ui/status.js';
import {
  initCamera,
  getVideoElement,
  getOverlayCanvas,
  resizeOverlay,
  triggerCapture
} from './core/camera.js';
import {
  initDetector,
  runDetection
} from './core/detector.js';
import {
  updateGuideRectCache,
  handleAutoCapture,
  isAutoCapturing
} from './core/autoCapture.js';

// ガイド枠・モードボタン・レシート関連 DOM
const cardGuideEl = document.getElementById('card-guide');
const documentGuideEl = document.getElementById('document-guide');
const receiptGuideEl = document.getElementById('receipt-guide');

const cardModeBtn = document.getElementById('mode-card-btn');
const documentModeBtn = document.getElementById('mode-document-btn');
const receiptModeBtn = document.getElementById('mode-receipt-btn');
const receiptControl = document.getElementById('receipt-control');
const receiptRange = document.getElementById('receipt-length-range');
const captureBtn = document.getElementById('shutter-btn');

let currentGuideMode = MODE_CARD;
let latestPredictions = [];
let isDetecting = false;
let lastDetectionTime = 0;

function getGuideElements() {
  return {
    cardGuideEl,
    documentGuideEl,
    receiptGuideEl
  };
}

function setMode(mode) {
  currentGuideMode = mode;

  if (cardGuideEl) cardGuideEl.classList.toggle('hidden', mode !== MODE_CARD);
  if (documentGuideEl) documentGuideEl.classList.toggle('hidden', mode !== MODE_DOCUMENT);
  if (receiptGuideEl) receiptGuideEl.classList.toggle('hidden', mode !== MODE_RECEIPT);

  if (receiptControl) {
    receiptControl.classList.toggle('hidden', mode !== MODE_RECEIPT);
  }

  const active =
    'px-3 py-1 rounded-full text-xs font-semibold bg-white text-black/80 shadow-md border-transparent';
  const inactive =
    'px-3 py-1 rounded-full text-xs font-semibold bg-white/20 text-white/80 border border-white/40 shadow-none';

  if (cardModeBtn) cardModeBtn.className = mode === MODE_CARD ? active : inactive;
  if (documentModeBtn) documentModeBtn.className = mode === MODE_DOCUMENT ? active : inactive;
  if (receiptModeBtn) receiptModeBtn.className = mode === MODE_RECEIPT ? active : inactive;

  const overlayCanvas = getOverlayCanvas();
  updateGuideRectCache(currentGuideMode, getGuideElements(), overlayCanvas);
}

function setupModeButtons() {
  if (cardModeBtn) {
    cardModeBtn.addEventListener('click', () => setMode(MODE_CARD));
  }
  if (documentModeBtn) {
    documentModeBtn.addEventListener('click', () => setMode(MODE_DOCUMENT));
  }
  if (receiptModeBtn) {
    receiptModeBtn.addEventListener('click', () => setMode(MODE_RECEIPT));
  }
}

function setupReceiptControl() {
  if (!receiptRange || !receiptGuideEl) return;

  receiptRange.addEventListener('input', (e) => {
    const ratio = Number(e.target.value) || CONFIG.receipt.defaultRatio;
    receiptGuideEl.style.setProperty('--receipt-ratio', ratio);
    const overlayCanvas = getOverlayCanvas();
    updateGuideRectCache(currentGuideMode, getGuideElements(), overlayCanvas);
  });

  const initialRatio = receiptRange.value || CONFIG.receipt.defaultRatio;
  receiptGuideEl.style.setProperty('--receipt-ratio', initialRatio);
}

function setupCaptureButton() {
  if (captureBtn) {
    captureBtn.addEventListener('click', () => {
      if (isAutoCapturing()) return;
      triggerCapture('manual');
    });
  } else {
    console.warn('#shutter-btn 要素が見つかりません');
  }
}

function drawOverlay(predictions) {
  const overlayCanvas = getOverlayCanvas();
  if (!overlayCanvas) return;

  const overlayCtx = overlayCanvas.getContext('2d');
  if (!overlayCtx) return;

  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!predictions || !predictions.length) return;

  const scaleX = overlayCanvas.width / CONFIG.inferenceSize;
  const scaleY = overlayCanvas.height / CONFIG.inferenceSize;

  const style = CONFIG.overlayStyle;
  overlayCtx.strokeStyle = style.boxColor;
  overlayCtx.fillStyle = style.boxColor;
  overlayCtx.lineWidth = style.lineWidth;
  overlayCtx.font = style.font;

  for (const { bbox, class: cls, score } of predictions) {
    const [x, y, w, h] = bbox;
    const sx = x * scaleX;
    const sy = y * scaleY;
    const sw = w * scaleX;
    const sh = h * scaleY;

    overlayCtx.strokeRect(sx, sy, sw, sh);

    const text = `${cls} (${Math.round(score * 100)}%)`;
    const tw = overlayCtx.measureText(text).width + 8;
    const ty = sy > 24 ? sy - 24 : sy + 4;

    // ラベル背景
    overlayCtx.fillRect(sx, ty, tw, 20);
    overlayCtx.fillStyle = style.labelTextColor;
    overlayCtx.fillText(text, sx + 4, ty + 14);
    overlayCtx.fillStyle = style.boxColor;
  }
}

function mainLoop(now) {
  const videoEl = getVideoElement();
  if (!videoEl) return;

  if (videoEl.readyState >= videoEl.HAVE_CURRENT_DATA) {
    if (
      !isDetecting &&
      (now - lastDetectionTime) >= CONFIG.detectionIntervalMs
    ) {
      isDetecting = true;
      lastDetectionTime = now;

      runDetection(videoEl)
        .then((preds) => {
          latestPredictions = preds || [];
          const overlayCanvas = getOverlayCanvas();
          handleAutoCapture(latestPredictions, overlayCanvas, triggerCapture);
        })
        .catch((e) => {
          console.error('Inference Error:', e);
          showStatus('推論中にエラーが発生しました。しばらくしてから再試行してください。');
        })
        .finally(() => {
          isDetecting = false;
        });
    }

    drawOverlay(latestPredictions);
  }

  requestAnimationFrame(mainLoop);
}

async function bootstrap() {
  // UI 初期化
  setMode(currentGuideMode);
  setupModeButtons();
  setupReceiptControl();
  setupCaptureButton();

  try {
    showStatus('モデル読み込み中...');

    await Promise.all([
      initDetector(),
      initCamera()
    ]);

    const overlayCanvas = getOverlayCanvas();
    updateGuideRectCache(currentGuideMode, getGuideElements(), overlayCanvas);

    window.addEventListener('resize', () => {
      resizeOverlay();
      const canvas = getOverlayCanvas();
      updateGuideRectCache(currentGuideMode, getGuideElements(), canvas);
    });

    requestAnimationFrame(mainLoop);
  } catch (e) {
    console.error('初期化中にエラーが発生しました:', e);
    // エラー表示は initCamera / initDetector 内の showStatus / alert に任せる
  }
}

bootstrap();
