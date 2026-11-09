# Universal OCR 2.4.0

TikTok's current SDK uses blob images and HTML drag events that the previous detector did not handle. This release adds an experimental slider, circle-rotation, and English same-shape-pair adapters, with review mode, stale-image checks, cancellation, protected form controls, and exact SDK success-marker detection. SDK-derived browser fixtures pass; live TikTok and Careers acceptance remain unverified.

Geetest v3 capture now handles the observed popup layout where the canvas and slider are siblings. The official demo reached recognition but stopped on low confidence before dragging; it did not verify successfully.

Repeat starts of a healthy companion skip redundant model warmups. Text preprocessing creates fallbacks only when needed and bounds tall images. Rotation reuses samples and rejects ambiguous orientations; template matching checks for competing locations before reporting confidence.

This remains partial CAPTCHA coverage. See the [provider matrix](COMPATIBILITY.md) and [verification evidence](verification-2.4.md) for supported modes, live results, and outstanding integrations. No job application was submitted or retried.

Update the source checkout, restart the local companion, and reload the extension. The default models are unchanged. Ordinary Chromium, Edge, and Firefox packages do not require debugger access; the separate Browser Input package retains its explicit opt-in for supported sliders and native checkboxes.
