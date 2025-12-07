# tf-cam

TensorFlow Lite でカード/ドキュメント/レシート枠を検出して撮影するカメラ Web アプリ。

## Quick start

- インストール: `npm install`
- 開発サーバー: `npm run dev`（HTTPS で起動。カメラアクセスを許可）
- ビルド: `npm run build`
- ビルド確認: `npm run preview`

## Project layout

- `src/main.js` モード切り替え、オーバーレイ描画、撮影フローのオーケストレーション。
- `src/core/` カメラ制御、TFLite のロード/推論、自動撮影ロジック。
- `src/config.js` 共通設定とモード定数。
- `src/ui/status.js` ステータス表示、`src/style.css` Tailwind の @layer スタイル。
- モデル: `public/model/1.tflite`（`vite.config.js` で `tflite_web_api*` をコピー）。

## Notes

- 開発サーバーはデフォルトで HTTPS + COOP/COEP（`vite.config.js`）。追加アセットはクロスオリジン分離に対応させる。

## License notice

本アプリケーションでは、TensorFlow が Apache License 2.0 の下で提供する
「[mobile_object_localizer_v1](https://www.kaggle.com/models/google/mobile-object-localizer-v1/tfLite)」モデルを使用しています。
© The TensorFlow Authors
https://www.apache.org/licenses/LICENSE-2.0
