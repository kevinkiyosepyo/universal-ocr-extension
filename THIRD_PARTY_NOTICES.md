# Third-party components

Universal OCR is an independent implementation. No CaptchaSonic program code,
release binaries, artwork, or branding is included.

- Tesseract.js 7.0.0 — Apache License 2.0 — https://github.com/naptha/tesseract.js
- Tesseract.js Core 7.0.0 (Tesseract and Leptonica WebAssembly engine) — Apache License 2.0, with embedded component notices — https://github.com/naptha/tesseract.js-core
- Language packages `@tesseract.js-data/{eng,spa,fra,deu,jpn,kor,chi_sim}` 1.0.0 — package metadata declares MIT; the trained-data repository is Apache License 2.0 (included in `licenses/tessdata-LICENSE`) — https://github.com/naptha/tessdata
- bmp-js — MIT — https://github.com/shaozilee/bmp-js
- idb-keyval — Apache License 2.0 — https://github.com/jakearchibald/idb-keyval
- is-url — MIT — https://github.com/segmentio/is-url
- regenerator-runtime — MIT — https://github.com/facebook/regenerator
- wasm-feature-detect — Apache License 2.0 — https://github.com/GoogleChromeLabs/wasm-feature-detect
- zlibjs — MIT — https://github.com/imaya/zlib.js

License files supplied by runtime dependencies are copied into `dist/licenses`
by the build. Build and test tools (esbuild, sharp, and Playwright) are not
shipped as part of the extension. Their licenses are included in their npm
packages. Exact dependency versions and integrity hashes are recorded in
`package-lock.json`.
