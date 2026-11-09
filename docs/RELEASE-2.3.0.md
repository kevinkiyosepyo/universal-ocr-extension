# Universal OCR 2.3.0

Scaled challenge widgets could produce incorrect sprite crops, and short-lived success markers could disappear between polls. This release preserves image detail before mapping slider coordinates and records Tencent success markers during the active session.

An experimental hCaptcha matching-shapes adapter now reads the supported instruction, validates the exact point count, checks for stale images before each click, and waits for provider verification or the next round. It preserves existing selections and stops on uncertain recognition, changed scenes, cancellation, and missing receipts. PopularCaptcha is now correctly described as CaptchaSonic's hCaptcha-style family.

Tencent's official demo completed native checkbox verification without showing a puzzle; this does not verify our slider adapter. MTCaptcha remained unaccepted even with native typing. hCaptcha recognition and live acceptance remain limited. AWS WAF, Binance, reCAPTCHA v3, and the deferred TikTok integration are not complete.

Choose Browser Input for the previously verified Procaptcha/CaptchaFox workflows. Its debugger permission and session opt-in remain separate from the ordinary Chromium/Edge/Firefox packages. Update the source checkout, restart the local service, and reload the extension. No new default model is required.

See [verification details](verification-2.3.md) and the [provider matrix](COMPATIBILITY.md).
