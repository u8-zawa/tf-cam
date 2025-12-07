import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl';
import '@tensorflow/tfjs-backend-cpu';
import * as tflite from '@tensorflow/tfjs-tflite';
import { CONFIG } from '../config.js';

let model = null;
let inferenceCanvas = null;
let inferenceCtx = null;

function initInferenceCanvas() {
  if (inferenceCanvas && inferenceCtx) return;

  if (typeof OffscreenCanvas !== 'undefined') {
    inferenceCanvas = new OffscreenCanvas(CONFIG.inferenceSize, CONFIG.inferenceSize);
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = CONFIG.inferenceSize;
    canvas.height = CONFIG.inferenceSize;
    inferenceCanvas = canvas;
  }

  inferenceCtx = inferenceCanvas.getContext('2d', { willReadFrequently: true });
  if (!inferenceCtx) {
    console.error('2D コンテキストを取得できませんでした (inferenceCanvas)');
  }
}

async function initBackend() {
  for (const name of CONFIG.model.preferredBackends) {
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

  throw new Error(
    `利用可能な TensorFlow.js バックエンドがありません: ${CONFIG.model.preferredBackends.join(', ')}`
  );
}

async function loadTfliteModel() {
  console.log('loading tflite model:', CONFIG.model.url);

  const backend = await initBackend();
  console.log('selected backend:', backend);

  const net = await tflite.loadTFLiteModel(CONFIG.model.url);

  // ダミー入力でウォームアップ
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

function runTfliteDetection(net, sourceCanvas) {
  return tf.tidy(() => {
    const size = CONFIG.inferenceSize;
    const imageData = inferenceCtx.getImageData(0, 0, size, size);
    const imageTensor = tf.browser.fromPixels(imageData);
    const batched = tf.expandDims(imageTensor, 0);
    const input = tf.cast(batched, 'int32');

    const res = net.predict(input);

    const boxesTensor = res['TFLite_Detection_PostProcess'];
    const scoresTensor = res['TFLite_Detection_PostProcess:2'];
    const numTensor = res['TFLite_Detection_PostProcess:3'];

    const boxes = boxesTensor.dataSync();
    const scores = scoresTensor.dataSync();
    const numDetections = numTensor.dataSync()[0];

    const preds = [];

    for (let i = 0; i < numDetections; i++) {
      const score = scores[i];
      if (score < CONFIG.autoCapture.minScore) continue;

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
        score
      });
    }

    return preds;
  });
}

export async function initDetector() {
  initInferenceCanvas();
  model = await loadTfliteModel();
  return model;
}

export async function runDetection(videoEl) {
  if (!model) {
    console.warn('Detector model is not initialized');
    return [];
  }
  if (!inferenceCanvas || !inferenceCtx || !videoEl) {
    return [];
  }

  inferenceCtx.drawImage(videoEl, 0, 0, CONFIG.inferenceSize, CONFIG.inferenceSize);

  try {
    return runTfliteDetection(model, inferenceCanvas);
  } catch (e) {
    console.error('Inference Error:', e);
    throw e;
  }
}
