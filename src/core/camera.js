import { CONFIG } from '../config.js';
import { showStatus, hideStatus } from '../ui/status.js';

const videoEl = document.getElementById('preview-video');
const overlayCanvas = document.getElementById('overlay-canvas');

let videoAspect = 1;

let captureCanvas = null;
let captureCtx = null;

function ensureCaptureCanvas() {
  if (captureCanvas && captureCtx) return;

  captureCanvas = document.createElement('canvas');
  captureCtx = captureCanvas.getContext('2d');
  if (!captureCtx) {
    console.error('2D コンテキストを取得できませんでした (captureCanvas)');
  }
}

async function canvasToBlob(canvas, options) {
  const opts = options || { type: 'image/jpeg', quality: 0.95 };

  if (typeof canvas.convertToBlob === 'function') {
    return await canvas.convertToBlob(opts);
  }

  if (typeof canvas.toBlob === 'function') {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('画像の生成に失敗しました'));
          }
        },
        opts.type || 'image/jpeg',
        opts.quality
      );
    });
  }

  throw new Error('このブラウザは画像保存に対応していません');
}

export function getVideoElement() {
  return videoEl;
}

export function getOverlayCanvas() {
  return overlayCanvas;
}

export function getVideoAspect() {
  return videoAspect;
}

/**
 * カメラを初期化し、メタデータ読み込み完了まで待つ
 */
export async function initCamera() {
  if (!videoEl) {
    console.error('#preview-video 要素が見つかりません');
    alert('カメラのプレビュー領域が見つかりません。ページを再読み込みしてください。');
    throw new Error('preview-video not found');
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const msg = 'このブラウザはカメラ取得に対応していません。別のブラウザをお試しください。';
    console.error(msg);
    showStatus(msg);
    alert(msg);
    throw new Error('getUserMedia not supported');
  }

  try {
    showStatus('カメラ起動中...');

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: CONFIG.targetWidth },
        height: { ideal: CONFIG.targetHeight },
        facingMode: 'environment'
      }
    });

    videoEl.srcObject = stream;
    const waitMetadata = new Promise((resolve) => {
      if (
        videoEl.readyState >= HTMLMediaElement.HAVE_METADATA &&
        videoEl.videoWidth &&
        videoEl.videoHeight
      ) {
        resolve();
        return;
      }

      const handler = () => {
        const track = stream.getVideoTracks()[0];
        const { width, height } = track.getSettings();

        console.log('Camera:', width, 'x', height);

        videoAspect = (videoEl.videoWidth && videoEl.videoHeight)
          ? videoEl.videoWidth / videoEl.videoHeight
          : (width && height ? width / height : 1);

        resizeOverlay();
        videoEl.removeEventListener('loadedmetadata', handler);
        resolve();
      };

      videoEl.addEventListener('loadedmetadata', handler, { once: true });
    });

    const playPromise = videoEl.play().catch((err) => {
      console.warn('video.play() に失敗しました:', err);
    });

    await Promise.all([waitMetadata, playPromise]);
    hideStatus();
  } catch (err) {
    console.error('Error:', err);
    const message = err && err.message ? err.message : String(err);
    showStatus(`エラー: ${message}`);
    alert(
      'カメラの起動に失敗しました。カメラの権限や他のアプリの使用状況を確認してから、ページを再読み込みしてください。\n\n詳細: ' +
      message
    );
    throw err;
  }
}

/**
 * ビデオアスペクト比に応じてオーバーレイキャンバスをリサイズ
 */
export function resizeOverlay() {
  if (!overlayCanvas || !videoEl) return;

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

/**
 * 画像を撮影して Blob (URL 経由でダウンロード) する
 */
export async function triggerCapture(mode = 'manual', cropBbox = null) {
  if (!videoEl || videoEl.readyState < videoEl.HAVE_CURRENT_DATA) return;

  ensureCaptureCanvas();
  if (!captureCanvas || !captureCtx) {
    console.error('captureCanvas / captureCtx が初期化されていません');
    return;
  }

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

  try {
    const blob = await canvasToBlob(captureCanvas, {
      type: 'image/jpeg',
      quality: 0.95
    });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `capture_${Date.now()}_${mode}.jpg`
    });
    a.click();
    URL.revokeObjectURL(url);

    showStatus(
      `保存完了 (${mode === 'auto' ? '自動' : '手動'}): ${captureCanvas.width}x${captureCanvas.height}`
    );
    setTimeout(() => {
      hideStatus();
    }, CONFIG.status.autoHideDelayMs);
  } catch (e) {
    console.error('保存処理中にエラーが発生しました:', e);
    showStatus('保存処理中にエラーが発生しました。');
    alert('保存処理中にエラーが発生しました。ストレージの空き容量などをご確認ください。');
  }
}
