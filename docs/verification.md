# Verification — version 2.0.0

Checked November 7, 2026 on macOS ARM64. These are fixture results, not live CAPTCHA-provider success rates.

| Check | Result |
| --- | --- |
| Node tests | 16 passed: geometry, settings, real OCR, API signatures/replay/foreign origins, Unicode split across transport chunks, queue idempotency and conflicting requests, cancellation, image comparison, rule validation |
| Chromium offline OCR smoke | 21 checks passed, including real recognition in all seven bundled languages, cleanup, export, cancellation/restart, invalid inputs, workbench image handoff, and no external HTTP requests |
| Chromium automation smoke | 14 checks passed: real offscreen OCR, themes, signed service connection and task lifecycle, exact-site rule execution, challenge verification, separate activity outcomes, rejection of application Submit, Pause, stale document refusal, proxy settings/restoration, health-check UI, plain-text clipboard behavior, provider detection, and compatibility status |
| Firefox 159 runtime | 2 checks passed: real bundled OCR in workspace and background-page OCR through the visual workbench |
| Local Qwen3-VL-4B-Instruct | 3 actual inference checks passed through the signed task API and worker queue: grid selection, point localization, bounding-box localization |
| Standalone clients | Node and dependency-free Python clients both recognized `572948` through the running companion service |
| Production dependency audit | No known vulnerabilities reported by `npm audit --omit=dev` |
| Firefox manifest/code lint | 0 errors; 6 warnings described below |
| Build outputs | Chromium, Firefox, and Edge ZIPs with SHA-256 checksums |

The 56 automated checks above comprise 16 Node tests, 21 Chromium OCR checks, 14 Chromium automation checks, 2 Firefox checks, and 3 local-model checks. Client checks and lint/build validation are additional.

## Real visual inference results

The tested Ollama model manifest digest was `84f7ed8042fa7cdbd902f7dcb7d0370e032095047cc3244179f263b77b5bc318`.

The model received synthetic fixtures, not predetermined answers. A labeled 3 × 3 grid contained red circles in cells 0, 4, and 8; the model returned exactly `[0,4,8]`. In a separate 600 × 400 image, the red circle center was `(0.25,0.5)`; the returned point was `(0.25,0.498)`. The blue rectangle's expected box was approximately `(0.667,0.2,0.2,0.25)`; the returned box was `(0.667,0.2,0.25,0.3)`, within the test's 0.1-coordinate tolerance but visibly oversized. Estimated model confidence is therefore not a calibrated accuracy score.

The warm API runs took approximately 1.2, 2.0, and 2.8 seconds on this machine. Cold model loading took longer. These examples establish working inference, schema validation, and coordinate mapping; they do not establish broad recognition accuracy on photographs or distorted CAPTCHA images.

## Browser test isolation

Tests load actual built extension code into newly created profiles. The automation fixture build grants only loopback and a synthetic health-check host, plus proxy permission, to avoid interactive permission prompts during CI. Proxy changes affect only that disposable profile. The production manifest retains optional permissions.

Firefox is installed as a temporary add-on through a loopback debugging connection in an isolated profile. A test-only extension module drives the actual DOM because Playwright's Firefox transport cannot instrument extension-process tabs. These modules are not shipped in release packages. No real user profile is instrumented by tests.

Earlier v1 native-browser checks also covered high-DPI frozen region capture, field insertion with one input/change event and zero form submissions, stale-source refusal, and whole-viewport OCR. Version 2 adds a document nonce and a fresh automated stale-document regression. A separate Edge runtime, Firefox capture/proxy workflows, and mobile browsers have not been exercised.

## Remaining checks and lint notes

- Live provider workflows and acceptance on iCIMS, TikTok, Ashby, Lever, and the advertised CAPTCHA providers remain unverified or unimplemented; see [Compatibility](COMPATIBILITY.md).
- Native read-only inspection reached the supplied public Alaska Airlines and TikTok job listings, without exposing a challenge. No application action or uncertain submission was replayed.
- Firefox lint reports five `Function`-constructor warnings in bundled Tesseract/regenerator dependency code, plus one Firefox Android minimum-version warning. The extension CSP does not enable JavaScript `unsafe-eval`, and the real OCR checks pass with that CSP. Mobile support is not claimed. These are not Mozilla store-approval results.
- The web-ext development-tool dependency chain reports three low-severity audit entries concerning the same transitive `deepmerge` advisory. These tools are not shipped in the browser ZIPs or installed with production-only service dependencies; the production dependency audit is clean.

Reports and screenshots are written under ignored `output/` directories. The scripts in `scripts/` reproduce them. The local vision smoke requires the separately downloaded model and running Ollama process; CI runs the Node and browser suites without that download.
