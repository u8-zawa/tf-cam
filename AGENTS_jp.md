# Repository Guidelines

## プロジェクト構成とモジュール配置
- `index.html` は Vite エントリ。バンドラ設定は `vite.config.js`。
- コアロジック: `src/index.js`（TensorFlow + COCO-SSD + Webcam）。UI スタイル: `src/style.css`。
- 静的アセット: `public/`。ビルド成果物: `dist/`（`npm run build` 後に生成）。
- 新規機能は `src/` に追加し、肥大化しがちな `index.js` は機能単位に分割を検討。

## ビルド・テスト・開発コマンド
- `npm run dev` — Vite 開発サーバー（HMR）。
- `npm run build` — 本番ビルドを `dist/` に出力。
- `npm run preview` — ビルド成果物のローカル確認用サーバー。
- `npm`（`package-lock` 有り）を Node 18+ で使用し、リポジトリルートで実行。

## コーディングスタイルと命名
- JavaScript は ES Modules、`const`/`let`、セミコロン有り、インデント 2 スペース、camelCase。
- UI 文言は現状日本語。フロー内で言語を混在させない。
- 複雑な座標変換やキャンバス操作は短いコメントで意図を明記。
- TensorFlow / モデルの import はトップで揃え、DOM 取得とイベント登録はモジュール冒頭に配置。

## テスト指針
- 自動テスト未整備。`npm run preview` を用い、実機ブラウザで撮影・検出フローを手動確認。
- テスト追加時は隣接配置または `tests/` を作成し、`*.test.js` を推奨。
- 手動確認は PR にブラウザ・デバイス・解像度・結果を記録し、回帰の再現手順を残す。

## コミットとプルリクエスト
- コミットメッセージは命令形・短文でスコープ明確に（例: `Add overlay resize guard`, `Refine capture status copy`）。`WIP` は避ける。
- PR は変更概要、テスト結果（手動環境）、UI 変更はスクリーンショット/GIF を添付。
- 課題リンクを明記し、リスク領域（カメラ権限、モデルロード失敗、低スペック端末でのパフォーマンス）を共有。
- 大規模リファクタと機能追加は分けてレビュー負荷を抑える。

## セキュリティと設定のヒント
- カメラアクセスは HTTPS または `localhost` 必須。`npm run dev` での自己署名証明書は信頼済みに設定。
- 撮影したメディアはリポジトリに含めない（`.gitignore` で除外）。
- `getUserMedia` の戻り解像度が想定外の場合に備え、入力サイズを検証してから処理する。
