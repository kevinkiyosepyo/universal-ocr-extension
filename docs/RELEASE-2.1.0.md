Universal OCR 2.1.0 adds one-click image-grid assistance and simpler local startup.

- reCAPTCHA v2 grid workflow: prompt/image capture, sprite reconstruction, replacement tiles, multi-round and sliding-table handling, selected-state checks, and optional Verify.
- Experimental hCaptcha image-grid adapter; fixture tested, live acceptance not verified.
- Distorted-code recognition using the local vision model, with uncertain-result warnings and optional field rules.
- One command (`npm run start:all`) starts and warms the local service; first-time setup uses `npm run setup:local`.
- Bounded grid-result caching, smaller image labels, deterministic decoding, and clearer object-category instructions.
- Tab/document binding, Stop, navigation cancellation, bounded rounds, and separate widget-verification reporting.

One live Google reCAPTCHA demo completed in 11 recognition rounds (about 150 seconds). Both supplied image-grid examples and three generated distorted-code samples matched their expected answers. Recognition on those five samples took about 8–10 seconds in the final run after restarting and warming the model. An earlier 0.8–2.9-second result did not reproduce in that run. Complete challenges can take much longer, and the tiny text collage still produced ambiguous readings.

See `docs/verification-2.1.md` for the test scope and limitations. iCIMS work was deferred as requested. No job application was opened, submitted, or retried. This release does not implement every advertised CaptchaSonic provider or guarantee acceptance on every site.
