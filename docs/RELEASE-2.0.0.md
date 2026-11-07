Universal OCR 2.0.0 adds an independent local recognition service and an extension dashboard:

- Seven-language offline OCR, page capture, editable text, and original-document insertion.
- Local grid, point, and bounding-box analysis with Qwen3-VL-4B-Instruct; piece matching, rotation comparison, and generic proof of work.
- Opt-in exact-origin rules, bounded retries, confidence thresholds, global pause, and local activity outcomes.
- Signed service requests, task cancellation, custom HTTPS endpoints, light/dark themes, and optional proxy controls.
- Chromium, Edge, and Firefox MV3 packages. Firefox builds are unsigned temporary add-ons.

Validation: 56 automated fixture checks passed, plus standalone Node/Python client checks. No job application was submitted or retried. See README for installation and companion-service setup.

This release is not full CaptchaSonic feature parity. Provider detection and generic image tools do not establish end-to-end CAPTCHA acceptance. Full automatic solving across the listed job-site providers, provider-issued tokens/scores, and proprietary challenge protocols are not implemented or live-verified. The repository's compatibility matrix documents each gap.
