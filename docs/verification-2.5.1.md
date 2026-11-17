# Version 2.5.1 verification

This patch improves control integrity and preview behavior. It does not establish reliable reCAPTCHA/hCaptcha acceptance across job sites.

## Job-site observations

The November 17, 2026 inspection used native UI in the existing orange-K Kevin / Work Chrome profile. Fresh tabs were used; no application answers, attachments, Submit actions, or CAPTCHA completions were dispatched. The eight previously uncertain submissions were not reopened or retried.

- A current Match Group application on Lever displayed an empty form. Focusing the empty location field did not expose an image challenge during inspection.
- The original Alaska Airlines internship link reported that the job was no longer posted. Its sign-in link led to the iCIMS username stage, with no visible CAPTCHA at that stage. No login continuation was performed.
- A current Human Interest application on Greenhouse displayed an invisible `recaptcha.net/recaptcha/enterprise/anchor` frame. There was no visible image challenge. Its Enterprise integration is outside the standard native-v3 adapter's verified scope.

These are inspection results, not full-extension acceptance tests. Universal OCR was not listed in the observed Chrome extension menu; installation/enabling in that profile was not established. No new extension permissions were granted. Later native actions were interrupted when the user changed Chrome, and no alternate profile or debugging connection was used.

## Changes verified locally

- Review mode now emits numbered grid suggestions without clicking cells. A regression fixture that submits when its final cell is clicked stays at zero input and zero submission attempts. Text, point, slider, and native-action previews retain their input-free behavior.
- Grid capture checks image decoding, overlapping replacement images, DOM generation, source pixels, prompt, tile order, Verify ownership, and selection state. A mid-selection replacement stops old clicks and requires a fresh stable capture. Repeated changes stop the bounded session.
- Checked boxes only count as reCAPTCHA/hCaptcha success when they are visible provider widgets in provider child frames. Unrelated or hidden host-page checkboxes cannot create a false success.
- hCaptcha point input rechecks the instruction, canvas layout, pixels, controls, and overlay hit testing after asynchronous waits, including immediately before Verify.
- Enterprise detection is distinct from standard reCAPTCHA v2/v3 and is used by the actual extension scan route. Detection does not enable Enterprise completion.
- Companion reuse now checks the requested model names and model availability. An unhealthy or differently configured existing service produces an explicit error instead of a misleading Ready message.
- The horizontal-pair shortcut rejects demonstrated stacked-fragment and extra-object false positives while preserving the saved CaptchaFox result. It is not a general hCaptcha shape solver.

The regressions use local fixtures and mock recognition where appropriate. They do not send live provider verification or job-application requests. The preview regression was also checked against the old behavior in memory: the old path clicked three cells and reached the simulated submission callback; the fixed path did neither.

## Local recognition service

The original companion was restarted on `127.0.0.1:47821`, with project Ollama on `127.0.0.1:11435`. Signed health checks confirmed the configured Qwen3-VL 4B and GLM-OCR models; the pairing key was preserved.

Two saved user-provided grid examples were recognized correctly through the restarted service: bus cells `[1,5,6]` in 9.384 seconds and traffic-light cells `[0,4]` in 8.717 seconds (zero-based indices). These are two known samples, not an accuracy estimate or live provider acceptance.

The saved hCaptcha matching-shapes challenge returned no points and confidence zero in both an original-image run and a transparent-border crop experiment. The runs took 19.441 and 7.908 seconds respectively; cold/warm ordering confounds the timing comparison. Cropping did not improve accuracy and was not adopted. The local model remains a significant limitation for complex hCaptcha tasks.

## Automated checks

All 58 Node/API checks and 62 focused browser checks passed locally: 12 full-extension grid workflows, 10 DOM guard groups, 7 preview groups, 5 cancellation/replacement controller groups, 14 point groups, 7 direct provider-detection groups, and 7 packaged scan/popup groups. These counts include the targeted tests described above; they do not include live provider acceptance.

## Reproduction

Use Node 22 or 24 LTS. New focused commands are `npm run test:challenge-dom`, `npm run test:challenge-preview`, `npm run test:provider-detection`, and `npm run test:provider-scan`. Existing challenge, Stop, points, launcher, and full extension checks remain in CI. Raw images, private browser state, and local diagnostic reports remain outside the published source.
