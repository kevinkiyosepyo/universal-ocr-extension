# Capability and provider status

This is an independent implementation, not a copy of CaptchaSonic's private solver backend. The upstream public repository at commit `6162d947cebe0aeeebb57d1345f6ec7f63406930` exposes marketing documentation and release assets, not its advertised source tree.

## Implemented tools

- Local Universal OCR: seven languages, screenshot regions, uploads/paste/drop, editable results, field insertion, code character filters, rotation and cleanup.
- Local visual analysis: grid-cell selection, click-point localization, and bounding boxes using a separately installed vision model.
- Image comparison: template piece matching and circular rotation against a known upright reference.
- Generic SHA-256 proof of work.
- Optional site rules: exact-origin matching, OCR field filling, grid clicks, image points, slider movement, confidence thresholds, bounded retries, changed-image checks, challenge verification, global pause, and local activity outcomes.
- Signed custom-endpoint protocol, bounded worker queue, cancellation, model health checks.
- Light/dark/system themes; optional proxy selection, next-proxy switching, health checks, and restoration.
- Chromium and Edge MV3 packages; Firefox MV3 background-page package.

## Provider matrix

“Detection” means selector-based identification in accessible page frames. It is not proof that a challenge can be completed. Generic tools require image input or a site-specific rule. We do not count image recognition as provider acceptance.

| Advertised provider / feature | Implemented here | Still missing |
| --- | --- | --- |
| Universal OCR | Local general-purpose text recognition | Reliable reading of every distorted CAPTCHA / handwriting |
| BLS / text CAPTCHA | Dedicated local code reader, unambiguous field pairing, optional insertion | Distortion errors remain; no verified BLS integration |
| PopularCaptcha image / grid / bbox / multi | CaptchaSonic's hCaptcha-style API family; existing hCaptcha grids, experimental static matching-shapes clicks, and generic image tools | Live acceptance and other click / drag / video / provider-token workflows |
| reCAPTCHA v2 visible | Grid adapter, sprite capture, dynamic replacements, multi-round verification; one successful 2.1 public-demo session | Reliable acceptance across sites; audio / non-grid modes |
| reCAPTCHA v2 invisible | Detection distinguished from v3; existing adapter can see a visible image grid | Trigger and callback flows remain unverified; no form Submit trigger |
| reCAPTCHA v3 | Score-script / action-button detection | Site-specific provider score and token workflow; no local token generation |
| AWS WAF | Widget detection and generic image comparison | Provider adapter and an available test deployment |
| Geetest v3 | Reconstructed canvas slider adapter, local browser tests | Live acceptance and click / non-slider modes |
| Geetest v4 | CSS image capture, alpha-aware texture/outline matcher, guarded slider drag | Official demo rejected verification, including browser-input test; non-slider modes |
| MTCaptcha | Image capture, dedicated OCR, field insertion, one bounded missing-character retry | Fresh public-demo acceptance was not confirmed; model errors remain |
| CaptchaFox | Native checkbox, cropped canvas capture, object slider, fast foreground path and vision fallback | Official object-slider demo passed; other modes and sites unverified |
| Tencent | Current sprite-slider DOM adapter, including scaled-layout tests; official demo completed native checkbox verification without a puzzle | Live slider acceptance and non-slider adapters |
| TikTok | Detection and generic image tools | Integration deferred; not tested in this release |
| Prosopo / Procaptcha | Native proof-of-work flow; official demo passed with a provider response | Image, icon-order, puzzle, and invisible modes unverified |
| Binance | Widget detection and generic image tools | Provider-specific adapter and a test page |
| hCaptcha | Image-grid and static matching-shapes adapters, with fixture-tested selections / verification | Live acceptance; drawing, motion, spatial and other non-grid modes |
| Cloudflare Turnstile | Widget/script detection | Provider-managed verification tokens |


The ordinary extension dispatches untrusted DOM events, which some widgets reject. The separate Chromium Browser Input build uses Chrome pointer events for supported top-level sliders and native checkboxes, with explicit session opt-in and a required debugger permission. Procaptcha and CaptchaFox acceptance was verified with that build. Cross-origin image canvases may be unreadable; region capture and browser screenshot integration supply visible pixels instead. Capturing a challenge does not authorize submitting a job application.

## Job application verification scope

Read-only inspection in the existing authorized Chrome profile on November 7, 2026 found public listings at the supplied Alaska Airlines iCIMS and TikTok Careers URLs. Neither public listing exposed the saved challenge. No Apply, Verify, or Submit action was performed. The referenced saved batch-result files were not found in the available local Documents workspace. Therefore no successful live CAPTCHA completion on iCIMS, TikTok, Ashby, or Lever is claimed.

The eight user-reported post-submit outcomes remain unconfirmed. This build did not reopen those applications, retry a submission, or infer receipt from a cleared challenge. The rule engine rejects application Submit controls. Existing application history and one-shot submission procedures remain authoritative.

## Reference contracts

- [reCAPTCHA v3](https://developers.google.com/recaptcha/docs/v3): provider-issued scores and tokens.
- [Ollama chat API](https://docs.ollama.com/api/chat) and [vision](https://docs.ollama.com/capabilities/vision): local multimodal inference.
- [Qwen3-VL](https://github.com/QwenLM/Qwen3-VL): image grounding model and coordinate examples.
- [Firefox background scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background): MV3 background documents.
- [Chrome proxy settings](https://developer.chrome.com/docs/extensions/reference/api/proxy) and [Firefox proxy settings](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/proxy/settings).

## November 8, 2026 follow-up

The user deferred iCIMS work. Development focused on their common CAPTCHA examples. Both supplied grid examples matched the expected selections in the final image benchmark. A real Google reCAPTCHA demo reached its checked state after 11 recognition rounds; earlier runs exposed a sliding-table bug and one run reached its time limit. This single observed success is not a success-rate estimate. See [2.1 verification](verification-2.1.md).


## Version 2.2 evidence

See [the 2.2 verification report](verification-2.2.md) for successful and unsuccessful runs. A passed fixture tests adapter behavior, not a provider's production acceptance. No claim of universal CAPTCHA coverage is made.

### Provider research correction

CaptchaSonic's own [hCaptcha recognition documentation](https://captchasonic.com/en/docs/recognition/hcaptcha) uses `PopularCaptchaImage`, and its [PopularCaptcha token documentation](https://captchasonic.com/en/docs/token/popular-captcha) identifies the family as hCaptcha-style challenges. The earlier claim that its identity was unknown was incorrect. This maps the grid subset to the existing hCaptcha adapter; it does not establish support for every advertised mode.

AWS's [integration instructions](https://docs.aws.amazon.com/waf/latest/developerguide/waf-js-captcha-api.html) require a configured integration URL and a key authorized for the client domain. Its [official example](https://github.com/aws-samples/aws-waf-captcha-react-demo) requires deployment rather than providing a shared hosted demo. No suitable official Binance CAPTCHA demo or SDK contract was found in the follow-up search. These remain integration blockers, not successful tests.

Additional primary references: [MTCaptcha](https://docs.mtcaptcha.com/), [Geetest](https://docs.geetest.com/captcha/guide), [Procaptcha rendering](https://docs.prosopo.io/en/basics/client-side-rendering/), [CaptchaFox widget API](https://docs.captchafox.com/en/widget-api), [invisible reCAPTCHA v2](https://developers.google.com/recaptcha/docs/invisible), and [GLM-OCR](https://ollama.com/library/glm-ocr).
