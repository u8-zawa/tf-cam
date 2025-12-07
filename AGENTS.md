# Repository Guidelines

## Project Structure & Module Organization
- `src/main.js` orchestrates mode switching, overlay drawing, and capture flow.
- `src/config.js` stores inference sizing, camera targets, and mode constants; add config here rather than hard-coding.
- Core logic lives in `src/core/`: `camera.js` (getUserMedia, overlay sizing, capture/save), `detector.js` (TFLite model load + inference), and `autoCapture.js` (guide rectangles, IoU checks, auto-trigger).
- UI helpers sit in `src/ui/status.js`; styling is in `src/style.css` using Tailwind @layer components.
- Assets and the TFLite model reside in `public/model/1.tflite`; `vite.config.js` handles HTTPS dev server, COOP/COEP headers, and copies `tflite_web_api*` from dependencies.

## Build, Test, and Development Commands
- `npm install` to fetch dependencies.
- `npm run dev` starts the HTTPS Vite dev server (camera permissions require HTTPS). Access via LAN is enabled by default.
- `npm run build` creates a production bundle with console/debugger removal and copies the TFLite Web API artifacts.
- `npm run preview` serves the built bundle with the same COOP/COEP headers as production for WebGL/wasm.
- `npm run build:gh` builds with `--base /tf-cam/` for GitHub Pages publishing.

## Coding Style & Naming Conventions
- Use modern ESM (`type: module`), `const`/`let`, async/await, and prefer pure functions for shared logic.
- Follow the existing 2-space indentation and keep file-level responsibilities clear (config vs. core vs. UI).
- Name modes with the provided constants (`MODE_CARD`, `MODE_DOCUMENT`, `MODE_RECEIPT`); keep new mode-specific settings in `CONFIG`.
- Keep DOM queries and side effects localized; avoid global mutations outside the modules that already manage them.
- Tailwind utilities live in `src/style.css`; add component-level styles within `@layer components` to avoid leakage.

## Testing Guidelines
- No automated test suite yet; use `npm run build` as a smoke check for bundling/terser issues.
- Manual flow to verify: start `npm run dev`, allow camera access, switch through card/document/receipt modes, adjust receipt length slider, confirm overlay alignment and that auto-capture saves images with the expected crop.
- If changing detection logic, test both WebGL and CPU backends by toggling GPU availability in the browser and ensure `public/model/1.tflite` is reachable.

## Commit & Pull Request Guidelines
- Commit messages in this repo have used short descriptive summaries (often Japanese, e.g., `main.js を作成`); follow that style or use concise imperative English with clear scope.
- Keep commits focused; avoid combining refactors with behavior changes unless tightly coupled.
- PRs should include a short description, affected areas (camera, detector, UI), and manual test notes; add screenshots or GIFs when UI changes affect guides or overlays.
- Link issues when applicable and call out any follow-up work (e.g., model updates or config changes).

## Security & Configuration Notes
- Camera access requires HTTPS and user consent; the dev server already serves over HTTPS with a self-signed cert.
- COOP/COEP headers are enforced; ensure any new assets (e.g., wasm) remain compatible with those settings and are added to `assetsInclude` if needed.
