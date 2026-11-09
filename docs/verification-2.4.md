# Version 2.4 verification

This release adds an experimental TikTok adapter based on the provider's current public SDK, repairs the Geetest v3 popup layout, and improves local recognition performance. It does not establish universal CAPTCHA coverage or successful TikTok Careers verification.

## TikTok evidence and scope

The [public TikTok homepage](https://www.tiktok.com/) declares a [regional CAPTCHA loader](https://lf16-tiktok-web.tiktokcdn-us.com/obj/tiktok-web-tx/tiktok/webapp/main/minimal-player/webapp-desktop/static/js/async/captcha-ttp2.4cf5b6ec.js). That loader references [SDK 2.33.11](https://lf16-cdn-tos.tiktokcdn-us.com/obj/static-tx/bric-captcha/core-captcha/ttp2/2.33.11/2.0.0.403/captcha.js). Its [UI chunk](https://lf16-cdn-tos.tiktokcdn-us.com/obj/static-tx/bric-captcha/core-captcha/ttp2/2.33.11/2.0.0.403/static/js/488.aa37bc38e4a87c5b37fa.js) supplies the DOM contract used here. The TTP2 and Singapore copies of that UI chunk were byte-identical, with SHA-256 `422256fd4b0d98f1e6b3cf61dd504ee56e69f50b318aa867135b89cf0c6217d6`.

Implemented scope:

- The current `.captcha-verify-container` and `#captcha-verify-container-main-page` layout.
- Blob-image capture, puzzle matching, and the SDK's HTML drag-event path on the puzzle-piece wrapper. Its disabled inner slider button is not mistaken for a disabled wrapper.
- Concentric-circle alignment at the two inspected SDK sizes. A conservative seam matcher compares adjacent visible edges and maps relative rotation to the SDK’s opposing inner/outer rotations.
- The exact English same-shape-pair instruction, two distinct center points, and the widget's Confirm button.
- Review mode, image/layout freshness checks, cancellation, existing-selection preservation, confidence thresholds, and provider receipt waiting. Unsupported instructions, ambiguous ring boundaries, CSS-scaled layouts, and already-moved controls stop before input.

These are SDK-derived fixture tests. The adapter uses untrusted DOM events; the provider may reject them. The Browser Input package does not change TikTok's input path. Different-shape selection, ordered objects, localized instructions, and other SDK modes remain unintegrated. Circle matching has generated known-angle, independent-resolution, noise, and ambiguity tests; no actual TikTok ring image has been verified, so source continuity and provider acceptance remain unverified.

The supplied public Careers listing and its 29 directly linked scripts did not expose a CAPTCHA contract. The existing signed-in Careers session could not be inspected through the required native route because the Mac was locked. No application page was changed, no application was submitted, and no TikTok live acceptance is claimed.

## Geetest v3 live test

The [official v3 slider demo](https://demos.geetest.com/slide-en.html) places its canvases and slider in sibling containers. The previous selector incorrectly required the canvas to be inside the slider. The adapter now scopes both to their own widget, and a regression covers the observed popup structure. Hidden stale success markers are ignored.

After that fix, an explicit Browser Input probe reached local recognition. The matcher took 81 ms and returned confidence 0.4285; the extension stopped without dragging. The entire recognition attempt took 1.058 seconds. There was no provider success marker, no form-submit attempt, and no blocked form navigation. This is an unsuccessful acceptance test, not a verified provider integration.

## Performance and reliability

- Starting an already healthy local companion skips both model warmups. A repeat start on this Mac completed in 0.290 seconds. The regression makes zero mock inference calls; the previous implementation made five.
- Text preprocessing creates fallback variants only when needed. A narrow 50 × 1400 input no longer expands to 900 × 25200 pixels for its final fallback; that path remains bounded at 50 × 1400.
- Rotation reuses polar samples and rejects inputs with insufficient texture, transparency, or multiple indistinguishable orientations. In a paired local benchmark (three warmups and nine measured runs), the median fell from 25.32 ms to 0.72 ms.
- Template matching rejects textureless pieces and spatially separate competing matches. An exact-anchor seed and bounded scoring preserve exhaustive fallback while reducing the same small-image benchmark from 8.72 ms to 3.04 ms. A separate 900 × 600 scene with a 100 × 100 piece matched in 30 ms. These are selected local inputs, not universal latency guarantees.

The existing `rotate` task still requires a complete upright reference of the same content. The new `rotate-ring` task separately compares neighboring circle boundaries, with the displayed inner/outer diameter ratio supplied explicitly.

## Other provider limits

The [compatibility matrix](COMPATIBILITY.md) remains authoritative. AWS WAF needs a configured test deployment; Binance has no suitable identified official test page or widget contract. reCAPTCHA v3 uses its provider-issued score/token workflow. MTCaptcha, Geetest, Tencent sliders, hCaptcha matching shapes, and TikTok do not gain a live-acceptance claim from passing local fixtures.

Previously confirmed public-demo results remain limited to the documented reCAPTCHA v2 session, CaptchaFox object slider, and Procaptcha native flow. No previous uncertain job application was retried.

## Reproduction

All **187 deterministic checks passed**: 44 Node/API checks, 21 browser OCR checks, 14 automation checks, 12 grid checks, 12 direct hCaptcha-point checks, 33 widget checks, 34 Browser Input checks, 15 grouped direct TikTok checks, and 2 Firefox checks. Firefox lint reported zero errors, zero notices, and six existing bundled-code/Android-version warnings. Android support is not claimed.

Local fixture checks and explicit public-demo probes are separate. Raw reports and screenshots stay in ignored `output/` directories; provider response tokens, account data, and browser profiles are not published.

```sh
npm ci
npx playwright install chromium firefox
npm run package
npm run test:tiktok
npm run test:widgets
npm run test:browser-input
node scripts/probe-widget-demo.mjs geetest-v3 --browser-input
```
