export const CONFIG = {
  inferenceSize: 192,
  targetWidth: 3840,
  targetHeight: 2160,
  detectionIntervalMs: 100,
  model: {
    url: `${import.meta.env.BASE_URL}model/1.tflite`,
    preferredBackends: ['webgl', 'cpu']
  },
  autoCapture: {
    enabled: true,
    minScore: 0.7,
    iouThreshold: 0.9,
    requiredMs: 1500
  },
  overlayStyle: {
    boxColor: '#00FFFF',
    labelTextColor: '#000000',
    lineWidth: 2,
    font: '16px sans-serif'
  },
  status: {
    autoHideDelayMs: 2000
  },
  receipt: {
    defaultRatio: 2
  }
};

export const MODE_CARD = 'card';
export const MODE_DOCUMENT = 'document';
export const MODE_RECEIPT = 'receipt';
