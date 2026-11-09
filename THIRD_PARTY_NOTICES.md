# Third-party components

Universal OCR is an independent implementation. No CaptchaSonic program code,
release binaries, artwork, or branding is included.

- webextension-polyfill 0.12.0 — Mozilla Public License 2.0 — https://github.com/mozilla/webextension-polyfill
- Sharp 0.35.5 (companion service only) — Apache License 2.0; libvips notices supplied by its packages — https://github.com/lovell/sharp
- GLM-OCR (optional separate model download) — MIT model license — https://huggingface.co/zai-org/GLM-OCR
- Qwen3-VL-4B-Instruct (optional separate model download) — Apache License 2.0 — https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct
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
by the build. Build and test tools (esbuild, web-ext, and Playwright) are not
shipped as part of the extension. Their licenses are included in their npm
packages. Exact dependency versions and integrity hashes are recorded in
`package-lock.json`.

The vision and text models are downloaded separately by Ollama and are not included in extension ZIPs. The local service uses Sharp; its npm distribution supplies the image-library licenses. No image assets from job application pages are bundled.
