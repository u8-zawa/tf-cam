export const MODE_CARD = 'card';
export const MODE_DOCUMENT = 'document';
export const MODE_RECEIPT = 'receipt';

export const RESOLUTIONS = {
  HD: { width: 1280, height: 720 },
  FULL_HD: { width: 1920, height: 1080 },
  WQHD: { width: 2560, height: 1440 },
  UHD_4K: { width: 3840, height: 2160 }
};

export const CONFIG = {
  inferenceSize: 192,
  targetWidth: RESOLUTIONS.UHD_4K.width,
  targetHeight: RESOLUTIONS.UHD_4K.height,
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
    cornerColor: 'rgba(255, 255, 255, 0.9)',
    cornerLength: 24,
    cornerWidth: 3,
    cornerRadius: 8,
    fillColor: 'rgba(255, 255, 255, 0.05)',
    labelBgColor: 'rgba(0, 0, 0, 0.6)',
    labelTextColor: '#FFFFFF',
    labelFont: '500 12px system-ui, sans-serif',
    labelPadding: { x: 10, y: 6 },
    labelRadius: 12,
    labelGap: 8
  },
  status: {
    autoHideDelayMs: 2000
  },
  receipt: {
    defaultRatio: 2
  }
};
