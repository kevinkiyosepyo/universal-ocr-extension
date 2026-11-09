# Universal OCR 2.2.0

The distorted-text reader could confidently omit characters. This release adds a dedicated local text model with agreement checks; the supplied **JMKR** regression now passes, including case. Warm text-code requests in the four-case regression took about half a second.

Procaptcha's native proof-of-work demo and CaptchaFox's object-slider demo now pass through the extension's **Browser Input** build. The latest accepted runs took approximately 2.5 and 9 seconds respectively. These observations are not guarantees for other sites or challenge modes.

New adapters cover MTCaptcha text fields, Geetest v3/v4 sliders, Tencent sprite sliders, and CaptchaFox protected-canvas capture. They preserve existing text, stop on stale/uncertain results, and wait for provider verification. Geetest and MTCaptcha did not confirm acceptance in live tests and remain partial. Tencent and Geetest v3 have local browser coverage, without live acceptance. TikTok remains deferred. PopularCaptcha, AWS WAF, Binance, and reCAPTCHA v3 still lack a completed provider integration.

Choose the ordinary Chromium, Edge, or Firefox package for OCR and DOM-based tools. The separate **Browser Input** Chromium package adds Chrome's required debugger permission. It is needed for the verified Procaptcha/CaptchaFox workflows and must be explicitly enabled for each session. Do not install both Chromium variants at once. No form-submit button is used by challenge assistance, though completing a CAPTCHA can resume a form already pending on the site.

After upgrading, run `npm run setup:local` once to download `glm-ocr:q8_0` alongside the existing vision model. Stop the old local-service terminal first, then start with `npm run start:all` and reload the extension. Models run locally; no paid API is required.

See [verification evidence and limits](verification-2.2.md) and the [provider matrix](COMPATIBILITY.md).
