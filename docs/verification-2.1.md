# Version 2.1 verification — November 8, 2026

## Live provider result

The extension completed one image challenge session on [Google's official reCAPTCHA demo](https://www.google.com/recaptcha/api2/demo). The widget's checkbox reached `aria-checked="true"`; no demo form Submit button was clicked. The run began with a fire-hydrant prompt and required 11 recognition rounds, including replacement images and subsequent challenge sets. It took about 150 seconds from session start to the observed checked state.

Earlier attempts found a real sliding-table transition bug; that bug is now covered by a regression fixture. Another attempt hit the test time limit without verification. The successful run is evidence of one functioning live workflow, not a measured success rate or a guarantee for other sites. hCaptcha's image-grid adapter has fixture coverage only. The user deferred iCIMS testing, and no job applications were opened, submitted, or retried in this follow-up.

The public-demo probe uses a disposable Chrome profile and closes its test window after showing the final result for 12 seconds. This is test cleanup, not behavior of the installed extension. The extension never closes the user's tab.

## Recognition samples

The user supplied two grid screenshots and a small text-CAPTCHA collage. The grid images were cropped to exclude the prompt and controls. Expected cell selections were visually reviewed. Their original files and local benchmark outputs remain outside Git.

| Sample | Expected and observed result | Final run after restarting and warming the model |
| --- | --- | --- |
| Supplied bus grid | Zero-based cells `1, 5, 6` | 8.1 seconds |
| Supplied traffic-light grid | Zero-based cells `0, 4` | 8.1 seconds |
| Generated distorted `K7P4XR` | Exact text | 8.1 seconds |
| Generated distorted `m3n8qa` | Exact text | 8.1 seconds |
| Generated distorted `9M4BR` | Exact text | 9.8 seconds |

These are small-sample measurements on an Apple M4 with 16 GB RAM, using local Qwen3-VL-4B-Instruct, with the result cache disabled and no competing model job. They are recognition timings, not full CAPTCHA-completion times. An earlier warm run took 0.8–2.9 seconds on the same five samples; that speed did not reproduce in the final restarted run. Cold loading, system load, image complexity, provider delays, and extra rounds can increase latency substantially. The final configuration disables the Flash Attention setting tested here, which was slower on this Mac.

The 193 × 226 text collage contains 14 tiny examples. Several readings were ambiguous or wrong; a sampled code was returned as `X6WDN` with only 75% model confidence. It has no reliable supplied answer key, so it is explicitly ungraded and excluded from pass counts. Low-resolution/noisy text still requires review. Confidence is not calibrated accuracy.

The general vision model initially confused a passenger minivan with a bus; explicit object-category guidance corrected the supplied test. Two smaller road-object detectors and a specialized OCR model were evaluated but omitted because they reduced accuracy on these examples. No additional detector dependencies or weights are shipped.

## Automated checks

The verification suite covers:

- 19 Node checks: OCR, image geometry, protocol validation, signing, cancellation, queue behavior, URL boundaries, and grid updates.
- 21 Chromium text-workspace checks.
- 14 Chromium workbench, rule, proxy, and navigation checks.
- 12 provider-workflow checks: cross-origin frames, image sprites, 4×4 scenes, dynamic replacements, multi-round challenges, sliding old/new tables, hCaptcha backgrounds, manual review, Submit refusal, cancellation, navigation, expiry, stale start URLs, and cached results.
- 2 real Firefox OCR checks.
- 4 real local-vision checks: distorted text, grids, points, and boxes.

The provider-workflow suite uses a deterministic recognition stub to isolate browser behavior. The recognition benchmark and local-vision suite use the actual model. The live demo uses the built extension, authenticated service, real model, and real provider widget. These kinds of evidence are kept separate.

`npm run benchmark -- path/to/samples.json` measures caller-supplied files with the result cache disabled. A sample contains `name`, `file` (relative to the manifest), optional `crop`, `task`, and optional `expected`. Samples without an expected answer are reported as ungraded.

## Remaining boundaries

- No provider-issued v3 score, hidden token generation, fingerprint spoofing, or application submission is implemented.
- hCaptcha drawing, motion and spatial puzzles, audio challenges, and proprietary slider protocols need separate adapters.
- The extension uses DOM events. A widget can refuse them; the adapter stops when selection state does not match.
- Provider requests and image layouts can change. Unsupported formats stop instead of reporting a successful solve.
- Site rules are opt-in and global automation starts paused. Provider assistance lasts at most three minutes or 12 recognition rounds and is tied to the original tab and document.
- A two-minute, 64-entry grid-result cache improves repeated-image latency. It retains only a task hash, cell selections, and confidence, never images or provider tokens.
