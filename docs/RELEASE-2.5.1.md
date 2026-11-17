# Version 2.5.1

Challenge preview no longer clicks reCAPTCHA or hCaptcha grid cells. It displays numbered suggestions without continuing the page's verification callbacks. Completion remains a separate opt-in and can resume a site's pending form.

The patch stops stale grid clicks after image, prompt, control, or selection changes; scopes checked-widget receipts to provider frames; strengthens hCaptcha point guards; distinguishes Enterprise detection; and validates model readiness when reusing the local companion.

Real job-site inspection did not establish CAPTCHA acceptance. The observed Greenhouse form used invisible Enterprise verification; the inspected Lever form had no active image challenge, and the original Alaska Airlines role had expired. The saved hCaptcha shape sample still produced an uncertain result. See [verification](verification-2.5.1.md) and [compatibility](COMPATIBILITY.md) for evidence and limits.

Validation: 58 Node/API checks and 62 focused browser checks passed locally. Chromium, Edge, Firefox, and Browser Input packages are included.
