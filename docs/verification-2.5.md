# Version 2.5 verification

This release adds provider-specific adapters and distinguishes native token issuance, puzzle correctness, and confirmed provider verification. It does not establish full CaptchaSonic parity or universal acceptance.

## reCAPTCHA v3

The adapter calls the documented `grecaptcha.ready` / `execute` API using an explicitly declared key and action. It never invents tokens or calls arbitrary page callbacks. Google's [official score demo](https://recaptcha-demo.appspot.com/recaptcha-v3-request-scores.php) is the only built-in backend verification endpoint.

The full extension session passed that demo: server success was true, score was **0.9**, action was `examples/v3scores`, and hostname matched. Session time was **425 ms**, with zero forms and zero submit attempts. The earlier direct-module test also passed in 369 ms. These are individual observations, not a promised score or latency on other sites.

A generic supported page ends at `token-issued`, explicitly unverified by its backend. The response token never enters extension results, activity, or storage. Site-specific callbacks and Enterprise remain outside this adapter's scope. Cancellation includes requests stopped before injected execution starts.

## AWS WAF

The adapter follows the [public AWS SDK](https://9175c2fd4189.edge.captcha-sdk.awswaf.com/9175c2fd4189/jsapi.js), inspected at SHA-256 `8ba87bc0d5928dc77f5e3c6e524ec0b11db776ad801a120ded20121d03b80cf4`.

Implemented modes are English 9/12/16-cell image grids and bifurcated image sliders. The latter aligns the specified object's top and bottom halves, including cyclic horizontal movement. Grid captures remove four-pixel gutters; guarded input preserves prior selections and refuses changed images, transforms, overlays, and host form controls. Confirm is restricted to the exact provider-owned form, with native navigation prevented. Reset challenges can proceed to another bounded round.

The SDK displays its correct-puzzle screen before token issuance finishes. The extension therefore reports `puzzle-correct`, never a token or application receipt based on that screen. A shadow-root observer preserves brief receipts. Path-dot and audio puzzles are unsupported.

No live AWS acceptance is claimed. The advertised public test paths inspected were unwired, removed, no longer CAPTCHA pages, or unavailable. A page embedding an application-update endpoint was excluded. No AWS resources or accounts were created. The [official AWS sample](https://github.com/aws-samples/aws-waf-captcha-react-demo) still requires a configured deployment.

## Binance

The [current public BCaptcha SDK](https://bin.bnbstatic.com/static/js/se/captcha/v1/captcha.min.js?v=20261109) exposes slider, native-checkbox, and one/two-page image-grid contracts. These now have adapters, including sprite reconstruction, entrance-animation waiting, guarded Next/Verify handling, and exact SDK success/error markers. A shifted offscreen page cannot receive grid selections. A slider release or dismissed popup alone never means acceptance.

Two standalone official SDK slider tests emitted verification-success callbacks and showed the success marker. Full-extension probes, however, were rejected. The latest diagnostic received HTTP 200 with an API-success envelope but `result=3`, `result_new=6`, and no token: the SDK displayed verification failure. This is an actual provider rejection, not a networking failure or accepted CAPTCHA.

The passing CLI and failing raw-browser probes also used different browser versions and automation environments. That difference does not establish the cause. No fingerprint-spoofing flags were added. Live full-extension, image-grid, and checkbox acceptance remain unverified. No account form was submitted or login continuation invoked.

Repeated logo textures exposed a matcher weakness. A new independent contour hypothesis corroborates the piece's texture near a unique cutout boundary. It recovered two previously ambiguous saved scenes at confidence 0.912 and 0.945, around 80 ms CPU time each, without lowering the adapter's threshold. Regressions reject missing, competing, or texture-inconsistent contours. Confidence remains a heuristic rather than a calibrated success probability.

## Geetest image modes

New v4 adapters cover [ordered reference icons](https://gt4.geetest.com/demov4/icon-popup-en.html) and [3×3 reference-image grids](https://gt4.geetest.com/demov4/nine-popup-en.html). Captures include the reference images and reconstruct the grid's repeating percentage-positioned sprite. Predictions are mapped back to exact scene points or unique cells. The last grid selection can trigger verification, so it receives the same cancellation and freshness guards as an explicit OK control.

These modes pass local direct and full-extension fixture checks. The final ordered-icon demo produced all three numbered selections and used the scoped OK control, but the provider rejected the model answer despite confidence 0.93. Inference took 11.5 seconds; the attempt took 13.8 seconds. The final grid run returned no points at confidence zero in 8.1 seconds and sent no input. Ordered clicks require a 550 ms interval and complete movement/coordinate events; missing or moved markers stop the sequence. No live acceptance is claimed. The existing slider acceptance limits, Geetest v3 click modes, and other game/audio modes remain in the [compatibility matrix](COMPATIBILITY.md).

## Reliability and reproduction

The extension checks cancellation again after asynchronous status reporting and atomically registers native actions with session state. No verification should follow Stop merely because it was queued behind a report or tab lookup. Local tests exercise stale images, already-selected controls, page changes, model uncertainty, scoped form controls, and late responses.

The initial Node 25.9 grid run encountered a V8 module-lexer crash. Its retry passed, and the same suite was checked with installed Node 24 LTS. The required pinned Firefox browser was installed before its smoke test. LTS Node versions are recommended.

All **251 deterministic checks passed**: 50 Node/API checks, 21 browser OCR checks, 14 automation checks, 12 grid checks, 4 grid-cancellation checks, 12 hCaptcha-point checks, 15 TikTok checks, 33 widget checks, 34 Browser Input checks, 10 AWS grid checks, 5 AWS split-image checks, 10 Binance checks, 7 native-v3 checks, 10 Geetest-image checks, 12 provider-route checks, and 2 Firefox checks. Firefox lint reported zero errors, zero notices, and six existing bundled-code/Android-version warnings. Android is not claimed. The four ZIPs passed CRC and SHA-256 checks, version/permission checks, and byte comparisons against their build directories.

Raw diagnostic images and reports remain in ignored `output/` directories. Tokens, account data, authorization headers, and provider request payloads are not published. No job application was submitted or retried.

```sh
npm ci
npx playwright install chromium firefox
npm run package
npm run test:recaptcha-v3
npm run test:aws-waf
npm run test:aws-waf-slide
npm run test:binance
npm run test:geetest-images
npm run test:provider-routes
node scripts/probe-recaptcha-v3.mjs --extension
node scripts/probe-binance.mjs
```

Public probes are explicit opt-in commands; they are not part of CI. Passing fixture checks does not upgrade any provider's live status.
