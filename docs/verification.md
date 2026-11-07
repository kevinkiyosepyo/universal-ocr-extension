# Verification

Validated on November 7, 2026, using the packaged Manifest V3 extension in
isolated Chromium 158 on macOS. The browser profile used synthetic fixtures;
no account login or third-party CAPTCHA was involved.

## Automated checks

- 9 Node tests passed, including real local OCR, crop geometry at 2× pixel
  density and fractional zoom, large-image limits, glyph scaling, and settings.
- 20 browser checks passed with network access disabled. They cover all seven
  local language models, short numeric codes, whitelist reset, dark-background
  cleanup, original/high-contrast modes, text export, rotation, blank images,
  rejected files, cancellation/retry, clearing, and context-menu registration.
- No external HTTP requests or uncaught page errors occurred during the
  browser suite. `npm audit --omit=dev` reported zero vulnerabilities.

## Real browser interactions

- The native Alt/Option + Shift + O shortcut opened the region selector.
- A selected region of a rendered canvas at 2× pixel density produced
  `572948` with 96% estimated confidence.
- Inserting that result updated the selected input to `572948`, triggered one
  input event and one change event, and caused zero form submissions.
- Navigating the original tab to a new document prevented insertion into the
  stale document and displayed a recoverable error.
- Restarting region selection replaced the previous selection. Escape
  cancelled it. The actual toolbar popup captured the whole visible page and
  recognized its headings, labels, and printed code (93% estimated confidence).

These fixtures verify implementation and representative readable text, not
accuracy on every font, handwritten document, or distorted CAPTCHA. Chrome,
Edge, and Brave share the supported Chromium APIs; this run used Chromium,
not independent branded-browser test runs.

Run `npm run check`, then `npx playwright install chromium` and
`npm run test:browser` to reproduce the automated checks. The browser script
generates its own images and writes a JSON report and screenshot to the ignored
`output/playwright/smoke/` directory. Run `npm run demo` for the manual fixture.
