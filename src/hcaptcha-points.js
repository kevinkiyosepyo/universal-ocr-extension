import { visible, loadImage, assertControl } from './challenge-dom.js';

const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const text = element => element?.innerText?.trim().replace(/\s+/g, ' ') || '';
const controls = root => [...root.querySelectorAll('.button-submit')].filter(visible);

// Canvas presence alone does not identify a point task. Prefer the visible DOM
// instruction. If absent, the caller may OCR the canvas header, but a transparent
// or unreadable header cannot enable this mode. Other modes remain unsupported.
export function hcaptchaPointsSnapshot() {
  if ([...document.querySelectorAll('.task-grid')].some(visible)) return null;
  const roots = [...document.querySelectorAll('.challenge-container, .challenge-view')].filter(visible);
  const canvases = [...new Set(roots.flatMap(root => [...root.querySelectorAll('canvas')].filter(visible)))];
  if (!canvases.length) return null;
  const prompts = [...document.querySelectorAll('.prompt-text, .challenge-container .prompt, .challenge-view .prompt')].filter(visible);
  const instructions = [...new Set(prompts.map(text).filter(Boolean))];
  if (instructions.length > 1) throw new Error('The hCaptcha canvas instruction is ambiguous.');
  const instruction = instructions[0];
  if (instruction && !/^Click the (ONE|TWO|THREE|FOUR|FIVE|SIX|[1-6]) matching shapes[.!]?$/i.test(instruction)) throw new Error('This hCaptcha canvas instruction is unsupported.');
  if (canvases.length !== 1) throw new Error('More than one hCaptcha canvas is visible. Open one challenge at a time.');
  const image = canvases[0], verify = controls(document);
  if (!verify.length) return null;
  if (verify.length !== 1) throw new Error('The hCaptcha verification control is ambiguous.');
  // The live footer is outside .challenge-container. Both controls must share
  // a root, but no generic form button is eligible as the provider control.
  let root = image.parentElement;
  while (root && !root.contains(verify[0])) root = root.parentElement;
  if (!root) return null;
  const challenge = { type: 'points', mode: 'point-click', provider: 'hcaptcha', name: 'hCaptcha matching shapes', root, image, verify: verify[0], needsInstruction: !instruction };
  return instruction ? resolvePointInstruction(challenge, instruction) : challenge;
}

export function capturePointHeader(challenge) {
  const source = challenge.image;
  if (!visible(source) || !(source instanceof HTMLCanvasElement) || source.width < 30 || source.height < 30 || source.width > 2400 || source.height > 2400) throw new Error('The hCaptcha instruction canvas is unavailable.');
  const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = Math.ceil(source.height / 4);
  canvas.getContext('2d').drawImage(source, 0, 0);
  return canvas.toDataURL('image/png');
}

export function resolvePointInstruction(challenge, reading) {
  const instruction = typeof reading === 'string' ? reading.trim().replace(/\s+/g, ' ') : '';
  const match = instruction.match(/^Click the (ONE|TWO|THREE|FOUR|FIVE|SIX|[1-6]) matching shapes[.!]?$/i);
  if (!match) throw new Error('This hCaptcha canvas instruction is unsupported or could not be read reliably.');
  const expectedCount = words[match[1].toLowerCase()] || Number(match[1]);
  return { ...challenge, needsInstruction: false, instructionSource: challenge.instructionSource || (challenge.needsInstruction ? 'canvas' : 'dom'), instruction, expectedCount,
    prompt: `${instruction} Return exactly ${expectedCount} center points, one per matching shape. Match shape geometry even when the colors differ. If the matches are ambiguous, return no points and confidence 0.` };
}

export function pointSelection(challenge, solution) {
  if (!Number.isFinite(solution.confidence) || solution.confidence < .8) throw new Error('The matching shapes could not be identified reliably.');
  const points = solution.points;
  if (!Array.isArray(points) || points.length !== challenge.expectedCount || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x <= 0 || point.x >= 1 || point.y <= 0 || point.y >= 1)) throw new Error(`Exactly ${challenge.expectedCount} valid shape centers are required.`);
  if (points.some((point, i) => points.slice(0, i).some(other => Math.hypot(point.x - other.x, point.y - other.y) < .065))) throw new Error('The predicted shape centers overlap. Review the challenge manually.');
  return points.map(({ x, y }) => ({ x, y }));
}

async function pixels(image) {
  const decoded = await loadImage(image), canvas = document.createElement('canvas');
  canvas.width = decoded.naturalWidth; canvas.height = decoded.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(decoded, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}
function currentPixels(challenge, baseline) {
  const canvas = document.createElement('canvas'); canvas.width = baseline.width; canvas.height = baseline.height;
  const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(challenge.image, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}
function samePixels(before, after, selected) {
  if (before.width !== after.width || before.height !== after.height) return false;
  // The observed provider rings grow to about 22 layout pixels in radius.
  // Mask a bounded 26-pixel disk for their stroke/animation, only around points
  // already clicked. Every changed pixel outside those disks still stops input.
  const radius = 26;
  for (let i = 0; i < before.data.length; i += 4) {
    if (before.data[i] === after.data[i] && before.data[i + 1] === after.data[i + 1] && before.data[i + 2] === after.data[i + 2] && before.data[i + 3] === after.data[i + 3]) continue;
    const x = i / 4 % before.width, y = Math.floor(i / 4 / before.width);
    if (!selected.some(point => Math.hypot(x - point.x * before.width, y - point.y * before.height) <= radius)) return false;
  }
  return true;
}
export async function pointSceneMatches(challenge, expectedImage, selectedPoints = []) {
  if (!challenge.image.isConnected || !visible(challenge.image)) return false;
  const baseline = await pixels(expectedImage);
  return samePixels(baseline, currentPixels(challenge, baseline), selectedPoints);
}

export async function applyPointSelection(challenge, solution, current, expectedImage) {
  const points = pointSelection(challenge, solution), baseline = await pixels(expectedImage), applied = [];
  if (!/^Skip$/i.test(text(challenge.verify))) throw new Error('The hCaptcha canvas already has selections. Review it manually.');
  const bounds = canvasBounds(challenge.image);
  const check = () => {
    const fresh = hcaptchaPointsSnapshot();
    if (!fresh || fresh.root !== challenge.root || fresh.image !== challenge.image || (fresh.instruction && fresh.instruction !== challenge.instruction) || (challenge.instructionSource === 'dom' && fresh.needsInstruction) || fresh.verify !== challenge.verify) throw new Error('The point challenge changed while selecting.');
    assertControl(challenge.image, challenge.root);
    const rect = canvasBounds(challenge.image);
    if (['x', 'y', 'width', 'height'].some(key => Math.abs(rect[key] - bounds[key]) > 1)) throw new Error('The point challenge moved while selecting.');
    if (!samePixels(baseline, currentPixels(challenge, baseline), applied)) throw new Error('The point challenge changed while selecting.');
    return rect;
  };
  for (const point of points) {
    if (!await current()) throw new Error('Point selection was stopped.');
    const rect = check();
    const clientX = rect.x + point.x * rect.width, clientY = rect.y + point.y * rect.height;
    if (document.elementFromPoint(clientX, clientY) !== challenge.image) throw new Error('The point challenge is obscured or outside the visible page.');
    const data = { bubbles: true, cancelable: true, composed: true, clientX, clientY, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true, view: window };
    for (const type of ['pointermove', 'mousemove', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const options = { ...data, buttons: type.endsWith('down') ? 1 : 0 };
      challenge.image.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, options) : new MouseEvent(type, options));
    }
    applied.push(point);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }
  if (!await current()) throw new Error('Point selection was stopped.');
  check();
  assertControl(challenge.verify, challenge.root);
  if (!challenge.verify.matches('.button-submit') || !/^(Verify|Next)$/i.test(text(challenge.verify))) throw new Error('The widget did not accept the point selections. Review it manually.');
  const verifyBounds = challenge.verify.getBoundingClientRect(), hit = document.elementFromPoint(verifyBounds.x + verifyBounds.width / 2, verifyBounds.y + verifyBounds.height / 2);
  if (!hit || !challenge.verify.contains(hit)) throw new Error('The hCaptcha verification control is obscured or outside the visible page.');
  challenge.verify.click();
  return points;
}

function canvasBounds(image) {
  for (let node = image; node instanceof Element; node = node.parentElement || node.getRootNode().host) {
    const style = getComputedStyle(node), matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
    if (!matrix.is2D || matrix.a <= 0 || matrix.d <= 0 || Math.abs(matrix.b) > 1e-7 || Math.abs(matrix.c) > 1e-7 || style.perspective !== 'none' || (style.rotate && !['none', '0deg'].includes(style.rotate)) || (style.scale && style.scale !== 'none' && style.scale.split(/\s+/).some(value => !Number.isFinite(Number(value)) || Number(value) <= 0))) throw new Error('Rotated, reflected, or perspective hCaptcha canvases are unsupported.');
  }
  return image.getBoundingClientRect();
}
