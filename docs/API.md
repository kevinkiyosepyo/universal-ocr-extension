# Local solver API

Start `npm start`. The service binds to `127.0.0.1:47821`; its pairing key is generated in `.local/api-key` with owner-only permissions. Do not commit this directory. The extension accepts an alternative HTTPS endpoint implementing this same protocol; it is not compatible with commercial CAPTCHA service APIs.

`shared/client.js` exports `SolverClient` for Node and browser extension code. `examples/client.py` provides a dependency-free Python client. Browser screenshots can be passed through `examples/browser-ocr.mjs` or `examples/selenium_ocr.py`. Reuse the calling workflow's authorized browser and submission controls.

```js
import { SolverClient } from './shared/client.js';
const client = new SolverClient({ key: process.env.OCR_API_KEY });
const result = await client.solve({
  type: 'ocr', image: pngBuffer.toString('base64'),
  settings: { language: 'eng', mode: 'line', characters: 'digits', removeSpaces: true },
});
```

## Tasks

Every image is base64 or a `data:image/...;base64,...` URL, at most 15 MB and 20 megapixels. Remote image URLs are rejected. `requestId` is an optional idempotency key for task creation.

| Type | Additional fields | Result |
| --- | --- | --- |
| `ocr` | `image`, optional `settings` | `text`, `confidence` |
| `captcha-text` | `image`: a single tightly cropped code; optional `minLength` (1–32) | `text`, `confidence`; dedicated OCR also reports `confidenceBasis: "variant-agreement"` |
| `grid` | `image`, `prompt`, `rows`, `columns` (1–6 each), optional `layout` (`tiles` or `scene`) | `selected`: zero-based row-major cell indexes |
| `points` | `image`, `prompt`; optional `strategy: "horizontal-pair"` for a two-object slider canvas | `points`: normalized `{x, y}` |
| `bbox` | `image`, `prompt` | `boxes`: normalized `{x, y, width, height}` |
| `slider` | `image`: original background, `reference`: piece | Original pixel `x`, `y`, dimensions, and normalized top-left coordinates |
| `puzzle` | `image`, transparent `reference` at the same scale, optional normalized `y` | Pixel/normalized position, alpha bounds, correlation, separation, and matching method |
| `rotate` | `image`: rotated content, `reference`: upright matching content | `clockwiseDegrees` |
| `rotate-ring` | `image`: outer circular image, `reference`: inner disk, `radiusRatio`: displayed inner/outer diameter ratio (0.2–0.9) | Relative inner `clockwiseDegrees`, `normalizedDrag`, `confidence`, `boundaryError` |
| `pow` | `prefix`, `difficulty` (0–24) | Decimal `nonce` and SHA-256 `hash` |

Confidence is a heuristic or model estimate in 0–1, not a calibrated success probability. OCR uses seven bundled Tesseract languages. Distorted text uses GLM-OCR with up to four image treatments, stopping after two exact readings agree. A score of 0.9 denotes agreement, not 90% accuracy. Grids, general points, and boxes use Qwen. The horizontal-pair strategy first measures two separated foreground regions without model inference; overlapping objects fall back to visual analysis. Piece matching expects an unscrambled matching piece and background at the same scale, each no larger than 1200 × 1200. Rotation compares circular image content; it does not infer which way an arbitrary object should face. Generic SHA-256 proof of work is not a Prosopo, AWS, or other provider protocol.

## Routes and lifecycle

`rotate-ring` compares the visible neighboring edges of a concentric ring and disk. Sources must be square, with at least 64 pixels per side. It requires a continuous textured scene across the seam and rejects weak, repeating, transparent, or unrelated boundaries. It does not establish provider acceptance. The ratio describes displayed geometry, not the source images' pixel dimensions.

- `GET /health`: engine and model availability.
- `POST /v1/tasks`: returns HTTP 202 with a task ID and state.
- `GET /v1/tasks/{id}`: `queued`, `running`, `succeeded`, `failed`, or `cancelled`; successful records include `solution`.
- `DELETE /v1/tasks/{id}`: cancels running work and deletes its record.
- `GET /v1/metrics`: in-memory aggregate counters for this service process.

The JavaScript client consumes completed creation responses immediately; otherwise polling starts after 60 ms and grows to a 300 ms cap. It applies bounded exponential backoff to transport/429/5xx failures, propagates cancellation, and deletes task records after completion. Workers have a 180-second limit; proof of work has a 25-second limit. Records expire after ten minutes, checked every 30 seconds. Identical grid tasks reuse a two-minute, 64-entry memory cache keyed by the normalized task hash. Only selections and confidence are cached, never image bytes or tokens. Metrics expose `cacheHits`; cache use does not establish provider acceptance. Queue length and record count are bounded. Images are held in process memory while needed and are not written to service logs. A reverse proxy or a custom endpoint can have its own logging policy.

## Request authentication

Sign every request, including GET and DELETE. Headers:

- `X-OCR-Timestamp`: Unix time in milliseconds, within 60 seconds of the service clock.
- `X-OCR-Nonce`: a fresh UUID per HTTP request.
- `X-OCR-Signature`: lowercase hex HMAC-SHA256 with the pairing key over the following UTF-8 string:

```text
TIMESTAMP\nNONCE\nUPPERCASE_METHOD\nURL_PATH\nSHA256_HEX_OF_EXACT_BODY
```

An empty body hashes as an empty byte sequence. Reused nonces are rejected. The signature binds the method, path, and exact bytes, but provides no encryption: use HTTPS for remote endpoints. The packaged server accepts loopback Host headers and extension origins, rejects ordinary webpage origins, does not fetch supplied image URLs, and refuses redirects to another service. Keep the key private. Anyone with it can use the local task API.

## Configuration

| Variable | Default |
| --- | --- |
| `OCR_PORT` | `47821` |
| `OCR_API_KEY` | Generated private key file |
| `OCR_OLLAMA_ENDPOINT` | `http://127.0.0.1:11435` |
| `OCR_VISION_MODEL` | `qwen3-vl:4b-instruct` |
| `OCR_TEXT_MODEL` | `glm-ocr:q8_0` |

`npm run vision` starts a separate loopback Ollama process using `.local/models`, leaving the normal Ollama instance and model store unchanged. `npm run vision:pull` downloads the model into that store. An HTTPS reverse proxy for a remote installation must preserve the loopback Host value toward the service and the original signed path.

`npm run setup:local` performs first-run model download and starts both services. `npm run start:all` starts and warms them afterward. The launcher never terminates a pre-existing service it did not start.

`OCR_TEXT_MODEL` must use the GLM-OCR `Text Recognition:` interface. Set it to an empty string to retain the older vision-model code reader. `/health` reports `vision` and `text` availability separately. Use `npm run setup:local` after upgrading to download the dedicated text model.
