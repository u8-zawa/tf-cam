# tf-cam

```txt
src/
  config.js               // 定数・モード定義
  main.js                 // エントリーポイント（全体のオーケストレーション）
  core/
    camera.js             // カメラ制御・キャプチャ
    detector.js           // TFLiteモデルロード・推論
    autoCapture.js        // 自動撮影ロジック（ガイドとIoU判定）
  ui/
    status.js             // ステータス表示・DOM操作
```
