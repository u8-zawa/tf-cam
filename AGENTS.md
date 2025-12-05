# Repository Guidelines

## Project Structure & Module Organization
- `index.html` bootstraps the Vite app; `vite.config.js` holds bundler tweaks.
- `src/index.js` contains the TensorFlow COCO-SSD webcam logic; `src/style.css` styles the overlay UI.
- `public/` stores static assets copied as-is; `dist/` is generated output after `npm run build`.
- Keep new runtime code in `src/`, and prefer feature-focused modules over growing `index.js`.

## Build, Test, and Development Commands
- `npm run dev` — start Vite dev server with HMR.
- `npm run build` — production bundle to `dist/`.
- `npm run preview` — serve the built bundle for a local smoke test.
- Use `npm` (package-lock present) from Node 18+; run commands from the repo root.

## Coding Style & Naming Conventions
- JavaScript uses ES modules, `const`/`let`, semicolons, 2-space indent, and camelCase for variables/functions.
- Keep UI text localized (current UI uses Japanese strings); avoid mixing locales within a flow.
- Favor small, pure functions; document non-obvious math or canvas transforms with short comments.
- Import TensorFlow/model packages at top-level; keep DOM queries and event wiring near module top for readability.

## Testing Guidelines
- No automated test suite yet; run `npm run preview` and exercise the capture/detection flow in a real browser/device.
- When adding tests, colocate lightweight unit tests beside modules or create `tests/` with clear fixtures; name files `*.test.js`.
- Record manual steps (browser, device, resolution) in PR descriptions for regressions affecting camera or canvas sizing.

## Commit & Pull Request Guidelines
- Commits: imperative mood and scoped where possible (e.g., `Add overlay resize guard`, `Refine capture status copy`); avoid "WIP".
- PRs: include summary of behavior changes, testing notes (manual devices/browsers), and screenshots or GIFs for UI impacts.
- Link related issues and describe risk areas (camera permissions, model load failures, performance on low-end devices).
- Keep diffs focused; split large refactors from feature changes when feasible.

## Security & Configuration Tips
- Camera access requires HTTPS or `localhost`; ensure self-signed certs are trusted when using `npm run dev` with SSL.
- Avoid checking in captured media; prefer `.gitignore` or temporary dirs for test outputs.
- Validate incoming media dimensions before processing to prevent crashes if `getUserMedia` returns unexpected sizes.
