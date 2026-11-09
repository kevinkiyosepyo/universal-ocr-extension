# Version 2.2 verification

Measured on an Apple M4 Mac with 16 GB RAM, November 8–9, 2026. Public-demo tests used disposable Chrome for Testing profiles. They used provider-owned challenges and real local engines; no paid solving service was used. Application tabs, the deferred iCIMS/TikTok flows, and prior uncertain submissions were not touched.

## Live provider results

| Flow | Observed outcome | Timing and limits |
| --- | --- | --- |
| [Procaptcha proof of work](https://demo.prosopo.io/pow-explicit.html) | Provider response present; extension reached `widget-verified` | 2.534 seconds with Browser Input; ordinary DOM clicks did not start verification |
| [CaptchaFox object slider](https://captchafox.com/#demo) | Three completed runs reached `widget-verified` with a provider response | 44.493 s before optimization, 28.328 s during development, 8.918 s in the final tested path; different challenges, not a controlled speed benchmark |
| [Geetest v4 slider](https://gt4.geetest.com/demov4/slide-float-en.html) | Provider rejected verification | Both DOM-event and Browser Input runs failed; accurate image matching alone did not establish acceptance |
| [MTCaptcha demo](https://service.mtcaptcha.com/mtcv1/demo/index.html) | Acceptance not confirmed | Tests exposed omitted letters, inconsistent readings, and rejected codes; remains partial |
| [Tencent slider](https://intl.cloud.tencent.com/zh/products/captcha) | Rendered DOM and sprite geometry inspected | Browser adapter tested locally; live completion not performed in this report |

The successful Procaptcha and CaptchaFox runs recorded zero form-submit events. The Procaptcha demo itself displays a client-side “Form submitted” message on its success callback, with blank demo fields. No account or application was submitted. The acceptance probe now also blocks top-level `form.submit()` calls and non-GET form navigations. A widget response still does not prove that any site's backend accepted an application.

Browser Input is a separate Chromium package with a required `debugger` permission and an unchecked per-session opt-in. The runtime exposes only bounded pointer operations for recognized providers in the selected top-level tab. It does not expose arbitrary DevTools commands, read cookies, change fingerprints, or inject provider response tokens. It detaches after each action. Firefox and nested-frame pointer input are not supported.

## Corrected text regression and performance

The user supplied the expected reading **JMKR**. Qwen3-VL 4B returned **JMR** despite claiming 95% confidence; a minimum-length hint produced another incorrect answer. An 8B model also missed the letter, so it was not adopted.

The new GLM-OCR path reads grayscale and padded variants, then up to two additional variants if necessary. It requires two exact, case-sensitive readings to agree before automatic use. Inconsistent or malformed output remains uncertain. The agreement score is a heuristic, not an accuracy percentage; identical mistakes remain possible, as the live MTCaptcha failures demonstrate.

Actual authenticated service tests (`npm run test:text-code`):

| Expected/result | Time |
| --- | --- |
| JMKR | 3.551 s, including model loading |
| K7P4XR | 0.500 s, model loaded |
| mP7k | 0.502 s, model loaded |
| 82AH | 0.501 s, model loaded |

A separate warmed JMKR call took about 0.7 seconds. These are four regression cases, not a general CAPTCHA accuracy benchmark. Switching between the vision and text models may reload a model on a memory-constrained machine.

Other changes reduce unnecessary work:

- Cached task creation results return without an extra GET; uncached polling starts at 60 ms and grows to a 300 ms cap.
- Geetest/Tencent puzzle matching uses local texture correlation and, when appropriate, corroborating alpha-outline contrast instead of a vision model. Ambiguous candidates stop before dragging.
- CaptchaFox first measures two separated foreground regions. Overlapping objects fall back to the vision model. The fastest accepted run used one recognition round, about 1.0 second for recognition and 8.9 seconds including widget startup, stabilization, input, and provider verification.
- After a slider action, the adapter waits for a provider response instead of re-analyzing the moved objects.

The headed acceptance harness uses the real browser viewport. Its earlier emulated viewport clipped Chrome's visible-tab screenshots; those failed runs were not counted as successes.

## Reproduction and checks

All **118 checks passed**: 28 unit/API checks, 21 browser OCR checks, 14 site-automation checks, 12 grid checks, 16 widget checks, 17 Browser Input checks, 2 Firefox checks, 4 actual text-model regressions, and 4 actual vision-model checks. Firefox lint reported zero errors and six warnings: five bundled Function-constructor warnings and one Firefox Android minimum-version warning. Android support is not claimed.

All four 2.2.0 ZIPs passed version and SHA-256 checks. Only the Browser Input package requests the debugger permission.

```sh
npm ci
npm run setup:local
npm run check
npm run test:browser
npm run test:automation
npm run test:challenges
npm run test:widgets
npm run test:browser-input
npm run test:text-code
npm run test:vision
npm run build:firefox
npm run lint:firefox
npm run test:firefox
npm run package
```

The widget suite checks field preservation, ambiguity, stale images, cancellation, a bounded missing-character retry, native response markers, Geetest canvas and CSS layouts, Tencent sprites with nonzero offsets, cropped CaptchaFox capture, and delayed verification. Browser Input checks real trusted pointer events, cancellation during a drag, and debugger detachment. Local fixtures test mechanics; they do not stand in for provider acceptance.

Real-model and public-demo tests are deliberately separate from CI's deterministic fixture runs. A public demo can change or refuse a session, so the probe reports observed acceptance instead of asserting guaranteed success. Explicitly invoked probes keep their test windows open for inspection; ordinary smoke-test profiles close after completion.

```sh
node scripts/probe-widget-demo.mjs prosopo --browser-input
node scripts/probe-widget-demo.mjs captchafox --browser-input
node scripts/probe-widget-demo.mjs geetest-v4 --browser-input
node scripts/probe-widget-demo.mjs mtcaptcha
```

Local screenshots, cropped inputs, and timestamped reports are written under ignored `output/` directories. Pairing keys, browser profiles, full provider responses, and application data are not committed. See the [capability matrix](COMPATIBILITY.md) for the remaining unsupported or unverified modes.
