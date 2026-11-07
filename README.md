# Universal OCR

An independent, private browser extension and local recognition service. Read text from images and page regions, analyze visual challenges, and configure automation for specific sites. No paid CAPTCHA subscription is required for the implemented local tools.

![Universal OCR workbench](docs/workbench.png)

**This is not full CaptchaSonic solver parity.** Universal OCR and the local image tools work. Provider-specific end-to-end CAPTCHA solving on iCIMS, TikTok, Ashby, Lever, and the other advertised providers remains unverified or unimplemented. Detection is never presented as a successful solve. See the precise [capability matrix](docs/COMPATIBILITY.md).

The referenced [CaptchaSonic repository](https://github.com/Captcha-Sonic/CaptchaSonic-Extension) contains documentation and release assets, but no extension source at the inspected commit. This project includes none of its code, binaries, artwork, or branding.

## Install the extension

1. Download and extract the v2.0.0 ZIP for your browser from [Releases](https://github.com/kevinkiyosepyo/universal-ocr-extension/releases/tag/v2.0.0).
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

## Start the companion service

Requires Node.js 22+. From this checkout:

```sh
npm ci
npm start
```

In extension **Settings**, use `http://127.0.0.1:47821` and copy the contents of `.local/api-key` into Pairing key. Choose **Save connection**, then **Test connection**. The key is created on first start with owner-only permissions. Do not publish it.

The service supports OCR, piece matching, rotation comparison, and SHA-256 proof of work. Grid selection, click points, and bounding boxes also need [Ollama](https://ollama.com/) and a local vision model. In separate terminals:

```sh
npm run vision
```

```sh
npm run vision:pull
```

The one-time `qwen3-vl:4b-instruct` download is about 3.3 GB. Models stay in `.local/models`; this setup uses port 11435 and does not change the normal Ollama instance on 11434. Keep `npm start` and `npm run vision` running while using visual analysis. On CPU-only machines recognition can take longer. See [API configuration and examples](docs/API.md) to select a different model or endpoint.

The visual workbench shows selected cells, points, and boxes as overlays. Slider comparison needs an original, unscrambled background and matching piece at the same scale, at most 1200 × 1200. Rotation needs a matching upright reference. Generic proof of work is not a provider token service.

## Configure a site rule

Open **Site rules**, add an exact page or frame origin and CSS selectors, choose a task, then save and grant access to that site. Enable the global automation switch and reload the target page.

OCR rules use the bundled browser engine. Grid, point, and slider rules use the configured service. Rules have confidence thresholds, bounded attempts per image, changed-image checks, and a pause switch. Activities distinguish **recognized**, **applied**, and **verified**. Verification requires a visible success selector; an applied result alone is not success.

Optional verification clicks are limited to a non-submit button labeled **Verify** or **Check**. Application Submit controls are rejected. Partial interactions are not automatically replayed. DOM events remain untrusted; widgets that require trusted mouse input can reject them. Cross-origin image canvases may require screenshot capture instead of a direct image selector.

For job applications, preserve the original application session and existing submission journal. A CAPTCHA after Submit does not establish an employer receipt. This build did not retry any of the reported uncertain applications.

## Settings and privacy

- Light, dark, and system themes are shared across extension pages.
- Site access is optional and requested only for configured origins. Automation defaults to paused, with no rules.
- HTTP service connections are limited to localhost; remote endpoints require HTTPS. Explicitly selected images are transmitted to the configured service. The service uses the configured Ollama endpoint for visual tasks. The packaged default endpoints are local.
- Requests use timestamped HMAC signatures, fresh nonces, replay protection, and bounded retries. The key lives in extension local storage, not sync storage.
- Activity is stored locally, capped at 200 events, and omits images and recognized text. Clear it in Activity. The service logs no image bodies or results and retains task records only temporarily.
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
| `shared/` | Protocol validation, request signing, polling client |
| `server/` | Loopback HTTP service, bounded worker queue, OCR / visual engines |
| `examples/` | Node, Python, Playwright / Puppeteer, and Selenium integration |
| `scripts/` | Browser builds, packaging, local model setup, smoke tests |

Dependency versions and integrity hashes are pinned in `package-lock.json`. See [third-party notices](THIRD_PARTY_NOTICES.md).
