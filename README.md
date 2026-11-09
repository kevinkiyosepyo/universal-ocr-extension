# Universal OCR

An independent, private browser extension and local recognition service. Read text from images and page regions, analyze visual challenges, and configure automation for specific sites. No paid CAPTCHA subscription is required for the implemented local tools.

![Universal OCR workbench](docs/workbench.png)

Version 2.1 adds an image-grid adapter for reCAPTCHA v2 and hCaptcha, including replacement tiles, multi-round challenges, and optional verification. One live Google demo session completed successfully. This is not full CaptchaSonic parity: other proprietary challenge modes and provider-issued scores are not implemented. See the [capability matrix](docs/COMPATIBILITY.md) and [measured results](docs/verification-2.1.md).

The referenced [CaptchaSonic repository](https://github.com/Captcha-Sonic/CaptchaSonic-Extension) contains documentation and release assets, but no extension source at the inspected commit. This project includes none of its code, binaries, artwork, or branding.

## Install the extension

1. Download and extract the v2.1.0 ZIP for your browser from [Releases](https://github.com/kevinkiyosepyo/universal-ocr-extension/releases/tag/v2.1.0).
2. **Chrome / Brave / Chromium:** open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the extracted folder containing `manifest.json`.
3. **Edge:** use `edge://extensions` and the Edge package with the same steps.
4. **Firefox 140+:** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select the extracted `manifest.json`. This unsigned private build must be reloaded after restarting Firefox; permanent installation requires Mozilla signing.
5. Pin **Universal OCR**. Its popup opens text capture, provider detection, and the visual tools / site-rule dashboard.

Chromium requires Chrome 116 APIs or newer. Edge shares the Chromium implementation; a separate Edge runtime has not been tested. Firefox text recognition has been tested in the real browser. Mobile browser installation and touch automation have not been validated.

## Read text immediately

The extension packages Tesseract, WebAssembly, and seven language models. Text OCR works offline without a service, key, or runtime model download.

- **Select a region**, capture the visible page, or use **Alt / Option + Shift + O**.
- Upload, paste, or drop a PNG, JPEG, WebP, BMP, or still GIF into the text workspace.
- Choose English, Spanish, French, German, Japanese, Korean, or simplified Chinese.
- For short codes, choose Single line / Single word, restrict characters, and remove spaces.
- Edit, copy, save, or insert the result into a text field on the original document. Insertion does not submit forms and refuses a document that has navigated since capture.
- **Visual tools** in the text workspace transfers the captured image into the visual workbench.

OCR works best on printed text. Handwriting, distorted text, unusual fonts, and cluttered backgrounds can require correction. Confidence is an estimate, not a guarantee.

## Start all local tools

Install Node.js 22+ and [Ollama](https://ollama.com/). From this checkout, run once:

```sh
npm ci
npm run setup:local
```

The first setup downloads `qwen3-vl:4b-instruct` (about 3.3 GB), starts the companion, and warms the model. Subsequent starts need one command:

```sh
npm run start:all
```

Keep that terminal open. Ctrl+C stops only processes this command started. Models stay in `.local/models`; vision uses port 11435, separate from the normal Ollama instance on 11434. If updating an already running checkout, stop the old companion first.

Pair once in extension **Settings**: URL `http://127.0.0.1:47821`, Pairing key from `.local/api-key`, then **Save connection** and **Test connection**. On macOS, copy the key with `pbcopy < .local/api-key`. The key is never printed or committed.

For ordinary text OCR, no service is needed. `npm start` remains available for starting only the companion; `npm run vision` starts only Ollama. See [API configuration](docs/API.md) for custom models and endpoints.

## Assist an image CAPTCHA

1. Open the image challenge on the page. The extension does not initiate a hidden CAPTCHA or submit an application.
2. Open the extension and choose **Assist visible image challenge**. Grant the requested site, Google/hCaptcha frame, and navigation access.
3. By default, the extension selects images and asks you to review and press **Verify**. The optional **Press CAPTCHA Verify automatically** checkbox enables verification too. Completing a CAPTCHA may continue a form action the page already has pending.
4. Use **Stop** in the page panel or popup at any time. Navigation, expiration, uncertain recognition, and refused clicks also stop the session.

The adapter reads the provider's prompt and rendered images, preserves sprite geometry, waits for replacement tiles and sliding tables, and watches for a checked widget. It does not manufacture or insert provider tokens. A checked widget is not proof of a completed application or server-side transaction. It cannot guarantee acceptance on every site.

The visual workbench also offers **Read distorted text (vision)**. Crop tightly around one code. Low-confidence readings are marked uncertain. The supplied 193 × 226 collage contains tiny, ambiguous characters and is not a reliable accuracy benchmark. Ordinary text OCR and vision code reading are separate tools.

Other workbench tools include grid, point, and bounding-box analysis; matching an unscrambled piece at its original scale; reference-based circular rotation; and generic SHA-256 proof of work.

## Configure a site rule

Open **Site rules**, add an exact page or frame origin and CSS selectors, choose a task, then save and grant access to that site. Enable the global automation switch and reload the target page.

OCR rules use the bundled browser engine. Distorted-text, grid, point, and slider rules use the configured service. Rules have confidence thresholds, bounded attempts per image, changed-image checks, and a pause switch. Activities distinguish **recognized**, **applied**, and **verified**. Verification requires a visible success selector; an applied result alone is not success.

Optional verification clicks are limited to a non-submit button labeled **Verify** or **Check**. Application Submit controls are rejected. Partial interactions are not automatically replayed. DOM events remain untrusted; widgets that require trusted mouse input can reject them. Cross-origin image canvases may require screenshot capture instead of a direct image selector.

For job applications, preserve the original application session and existing submission journal. A CAPTCHA after Submit does not establish an employer receipt. This build did not retry any of the reported uncertain applications.

## Settings and privacy

- Light, dark, and system themes are shared across extension pages.
- Site access is optional and requested only for configured origins. Automation defaults to paused, with no rules.
- HTTP service connections are limited to localhost; remote endpoints require HTTPS. Explicitly selected images are transmitted to the configured service. The service uses the configured Ollama endpoint for visual tasks. The packaged default endpoints are local.
- Requests use timestamped HMAC signatures, fresh nonces, replay protection, and bounded retries. The key lives in extension local storage, not sync storage.
- Activity is stored locally, capped at 200 events, and omits images and recognized text. Clear it in Activity. The service logs no image bodies or results and retains task records only temporarily. A grid-result cache holds at most 64 hashed-image keys and selections for two minutes; it stores no images or provider tokens.
- Capture handoffs use browser session storage and a ten-minute expiry check. Opening a handoff consumes it; closing/reloading a workspace releases its image and result. Browser exit clears session storage.
- Optional proxy controls affect the current browser profile. They let you select a supplied proxy, move to the next one, check an HTTPS health URL, and restore the prior browser configuration. Localhost is bypassed. Embedded proxy credentials and automatic timed rotation are not supported.
- Browser-internal pages and extension stores restrict capture. Upload a screenshot there. Local file pages may require Allow access to file URLs.

## Build and verify

```sh
npm ci
npm run check
npm run build:all
npx playwright install chromium firefox
npm run test:browser
npm run test:automation
npm run test:challenges
npm run test:firefox
npm run lint:firefox
npm run test:vision  # requires the running local vision model
npm run package
```

Builds go to `dist/`, `dist-firefox/`, and `dist-edge/`. ZIPs and SHA-256 checksums go to `artifacts/`. Linux browser checks need Playwright's browser system dependencies and CJK fonts (`npx playwright install --with-deps chromium firefox`, then install `fonts-noto-cjk`).

Tests cover real OCR, geometry, settings, authenticated API requests, Unicode transport, cancellation, idempotency, image comparison, browser rule execution, application-submit rejection, stale-document protection, themes, proxy restoration, and real local vision inference. Browser tests use disposable profiles and synthetic fixtures. Firefox uses a temporary add-on and a test-only DOM driver because Playwright cannot instrument its extension-process tabs. No test opens or submits real applications. See [verification evidence and limits](docs/verification.md).

## Source map

| Path | Purpose |
| --- | --- |
| `src/background.js`, `src/content.js` | Page capture, frozen region selection, original-document field insertion |
| `src/ocr.js`, `src/image.js` | Bundled OCR, image processing, cancellation |
| `src/control.js`, `public/control.html` | Workbench, rules, activity, compatibility, settings |
| `src/automation-background.js`, `src/automation.js` | Permission-scoped rules and browser actions |
| `src/providers.js`, `src/proxy.js` | Provider detection and optional proxy controls |
| `src/challenge-*.js` | One-tab provider sessions, frame access, image capture, grid selection, and verification |
| `shared/` | Protocol validation, request signing, polling client |
| `server/` | Loopback HTTP service, bounded worker queue, OCR / visual engines |
| `examples/` | Node, Python, Playwright / Puppeteer, and Selenium integration |
| `scripts/` | Browser builds, packaging, local model setup, smoke tests |

Dependency versions and integrity hashes are pinned in `package-lock.json`. See [third-party notices](THIRD_PARTY_NOTICES.md).
