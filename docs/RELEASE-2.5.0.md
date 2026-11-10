# Universal OCR 2.5.0

Adds native reCAPTCHA v3 actions, AWS WAF image grids and split-image sliders, Binance sliders/native checkboxes/one- and two-page grids, and Geetest v4 ordered-icon and reference-grid modes. Google's official v3 demo passed through the full extension in 425 ms with a verified score of 0.9. Other sites' v3 responses remain explicitly unverified until their own backend handles them.

Puzzle matching now combines repeated-texture evidence with a unique cutout contour when needed. Existing confidence gates remain in place. Provider actions wait for opening animations, preserve existing input, and stop on stale images or cancellation. Two cancellation races affecting late Verify and native requests are corrected.

Coverage remains partial. AWS has SDK-derived tests but no live acceptance. Binance standalone sliders were accepted, while full-extension probes were rejected; live grid acceptance is unverified. Geetest image recognition remains unreliable. See the [verification report](verification-2.5.md) and [provider matrix](COMPATIBILITY.md) for exact scope. No application or account form was submitted.

Update the source checkout, restart the local companion, and reload the extension. The default local models are unchanged. Ordinary Chromium, Edge, and Firefox packages retain optional site access; Browser Input remains a separate package with explicit debugger permission.
