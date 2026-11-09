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
| BLS / text CAPTCHA | Bundled OCR, local vision code reading, configurable field rules | Reliable reading of every distortion; verified BLS integration |
| PopularCaptcha image / grid / bbox / multi | Generic image, grid, point, and box tools | Public stable widget contract, provider adapter, live acceptance |
| reCAPTCHA v2 | Grid adapter, sprite capture, dynamic replacements, multi-round verification; one successful public-demo session | Reliable acceptance across sites; audio / non-grid modes |
| reCAPTCHA v3 / invisible | Script/widget detection | Provider-issued score and signed token generation |
| AWS WAF | Widget detection and generic image comparison | AWS challenge protocol and live acceptance |
| Geetest v3 / v4 | Widget detection, generic piece and point tools | Scrambled image reconstruction, protocol-specific dragging, live acceptance |
| mtCaptcha | Widget detection, generic OCR | Live provider integration |
| CaptchaFox | Widget detection | Live provider integration |
| Tencent | Widget detection and generic piece/point tools | Provider-specific workflow and live acceptance |
| TikTok | Widget detection, piece matching and reference-based rotation | Native challenge integration, live acceptance |
| Prosopo / Procaptcha | Widget detection and generic SHA-256 primitive | Actual provider proof-of-work protocol and signed tokens |
| Binance | Widget detection and generic image tools | Provider-specific workflow and live acceptance |
| hCaptcha | Image-grid adapter and fixture-tested selections / verification | Live acceptance; drawing, motion, spatial and other non-grid modes |
| Cloudflare Turnstile | Widget/script detection | Provider-managed verification tokens |

A JavaScript extension dispatches untrusted DOM events. Widgets that require trusted browser input can reject them. Cross-origin image canvases may be unreadable; region capture and browser screenshot integration supply visible pixels instead. Capturing a challenge does not authorize submitting a job application.

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
