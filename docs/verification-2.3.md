# Version 2.3 verification

Follow-up tests on November 9, 2026 used official public demos and disposable browser profiles. No account or application was submitted. No paid solving API, test-key shortcut, injected provider token, or fingerprint modification was used.

## Changes

- Tencent and Geetest sprite capture now preserves layout-resolution pixels before mapping normalized positions back to rendered bounds. The half-scale Tencent regression moves 74.5 rendered pixels, rather than losing texture detail in a downscaled capture. Rotated/skewed/reflected layouts stop before input.
- Tencent success markers are observed during the current session, so a marker removed before the next 400 ms poll is still recognized. Stop/restart clears the observation.
- hCaptcha static “Click the … matching shapes” challenges have a separate experimental adapter. It accepts only the exact supported instruction, validates one through six distinct points, checks the unchanged scene before each click, and uses only the provider's Verify/Next control. A bounded 26-layout-pixel region permits selection rings; changes outside those regions invalidate the result.
- Instructions come from the DOM where available. OCR can read an opaque canvas header if the DOM instruction is absent; a transparent or unreadable header does not enable the adapter. Review mode makes no point clicks. Existing selections are preserved. Missing verification times out even if the widget disappears.
- The PopularCaptcha status now correctly identifies CaptchaSonic's hCaptcha-style API family. This corrects the earlier unknown-provider description; it does not establish support for every advertised mode.

## Live observations

| Provider | Observation | What it establishes |
| --- | --- | --- |
| Tencent official slider demo | The native checkbox displayed verification success without presenting a puzzle; zero form-submit attempts | The demo's native path worked. The extension slider adapter was not exercised, so live slider acceptance remains unverified. |
| MTCaptcha official demo | Three fresh readings entered through native keyboard input were unaccepted | Changing keyboard-event handling is not a demonstrated fix. |
| hCaptcha official demo | The provider presented static matching-shapes challenges; initial tests exposed footer-layout and selection-ring differences | Those adapter issues were fixed and covered by regressions. Recognition accuracy and provider acceptance are separate requirements. |

The MTCaptcha diagnostic recognized OVFA, PVOJ, and FPBB in 5.111, 0.770, and 0.769 seconds. Each solve request returned HTTP 200 with `isVerified: false`; the provider gave no specific rejection reason. The last test verified that the image source had not changed before typing. These readings are not confirmed ground truth, so they are not accuracy successes.

The 4B vision model also returned an incorrect set of shape centers with high self-reported confidence in a difficult saved hCaptcha example. Model confidence is not a correctness probability. No universal accuracy or speed claim is made.

After the footer and selection-ring fixes, a fresh 4B live run stopped with confidence zero before any point click. It took 13.158 seconds overall, including 8.889 seconds of recognition. No provider response was present and no form submission was attempted.

A larger `qwen3-vl:8b-instruct` model was evaluated on the same saved difficult example as the 4B model. The 4B call took 20.235 seconds including loading; the 8B call exceeded the engine's 150-second timeout without a usable result. Ollama reported a 10 GB working size with 30% CPU / 70% GPU processing on this 16 GB Mac. The larger model was not adopted, and the default remains the 4B vision model plus the dedicated GLM text reader. This was a limited comparison, not a general model benchmark.

## External blockers

AWS's [official API instructions](https://docs.aws.amazon.com/waf/latest/developerguide/waf-js-captcha-api.html) require an integration URL and a key authorized for the client domain. The [AWS sample](https://github.com/aws-samples/aws-waf-captcha-react-demo) requires an AWS deployment; no shared no-account hosted demo was identified. No infrastructure was deployed.

No suitable official Binance CAPTCHA demo or published widget contract was found. Its integration remains incomplete. reCAPTCHA v3 still requires its provider-issued score/token workflow; generic image recognition cannot implement that protocol. TikTok remains deferred, as requested.

## Reproduction

All **140 deterministic checks passed**: 28 unit/API checks, 21 browser OCR checks, 14 automation checks, 12 grid checks, 25 widget checks, 26 Browser Input checks, 12 direct point checks, and 2 Firefox checks. Firefox lint reported zero errors and six existing bundled-code/Android-version warnings; Android support is not claimed.

```sh
npm ci
npx playwright install chromium firefox
npm run check
npm run test:points
npm run test:widgets
npm run test:browser-input
npm run test:challenges
npm run package
```

Direct point tests include real OCR, cross-origin frames, scaling, existing selections, wrong point counts, bounds, overlapping points, cancellation, and changes outside selection rings. Full-extension tests also cover two challenge rounds, review mode, Stop during inference, transient success markers, and missing provider receipts.

Explicit public-demo probes remain separate from deterministic CI fixtures:

```sh
node scripts/probe-widget-demo.mjs tencent --browser-input
node scripts/probe-widget-demo.mjs hcaptcha
```

The Tencent probe distinguishes native verification without a puzzle from exercising the slider adapter. Reports, screenshots, and diagnostic image inputs remain under ignored `output/` directories; no credentials, browser profiles, or full provider response tokens are committed.
