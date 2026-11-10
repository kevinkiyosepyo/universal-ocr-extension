import { visible, fingerprint } from './challenge-dom.js';

// Contract observed in the public AWS SDK, SHA-256
// 8ba87bc0d5928dc77f5e3c6e524ec0b11db776ad801a120ded20121d03b80cf4.
// SDK-derived fixtures establish DOM behavior, not live token issuance.
const all = (root, selector) => [...root.querySelectorAll(selector)].filter(visible);
const one = (values, label) => {
  if (values.length > 1) throw new Error(`More than one AWS WAF ${label} is visible.`);
  return values[0];
};
const text = element => element?.textContent?.trim().replace(/\s+/g, ' ') || '';
const captures = new WeakMap();
const rect = element => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; };
const sameRect = (a, b) => ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) < .5);
const officialScript = doc => [...doc.scripts].some(script => {
  try { const url = new URL(script.src); return url.protocol === 'https:' && /(?:^|\.)awswaf\.com$/.test(url.hostname) && /\/(?:jsapi|captcha)\.js$/.test(url.pathname); }
  catch { return false; }
});
const roots = doc => {
  const embedded = all(doc, 'awswaf-captcha').filter(host => host.shadowRoot).map(host => ({ host, root: host.shadowRoot }));
  const interstitial = officialScript(doc) ? all(doc, '#captcha-container').filter(host => host.querySelector('#root')).map(host => ({ host, root: host })) : [];
  return [...embedded, ...interstitial];
};
const controls = canvas => [...canvas.children].filter(node => node.matches('button[type="button"][role="checkbox"][aria-checked]'));
const selected = challenge => challenge.tiles.map(tile => tile.getAttribute('aria-checked') === 'true');
function axisAligned(image) {
  for (let node = image; node instanceof Element; node = node.parentElement || node.getRootNode().host) {
    const style = getComputedStyle(node), matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
    if (!matrix.is2D || matrix.a <= 0 || matrix.d <= 0 || Math.abs(matrix.b) > 1e-7 || Math.abs(matrix.c) > 1e-7 || style.perspective !== 'none' || (style.rotate && !['none', '0deg'].includes(style.rotate)) || (style.scale && style.scale !== 'none' && style.scale.split(/\s+/).some(value => !Number.isFinite(Number(value)) || Number(value) <= 0))) throw new Error('Rotated, reflected, or perspective AWS WAF images are unsupported.');
  }
}

function validate(challenge) {
  const { host, root, modal, form, image, verify, promptElement, tiles, rows, columns } = challenge;
  axisAligned(image);
  if (!visible(host) || !visible(image) || !root.contains(modal) || !modal.contains(image) || modal.parentElement?.closest('.amzn-captcha-modal') || roots(host.ownerDocument).length !== 1) throw new Error('The AWS WAF grid changed or is unavailable.');
  if (form.parentElement !== modal || image.closest('form') !== form || verify.form !== form || verify.parentElement?.closest('form') !== form || form.hasAttribute('action') || form.hasAttribute('method') || form.hasAttribute('target') || verify.hasAttribute('formaction') || verify.hasAttribute('formtarget') || verify.getRootNode() !== root.getRootNode()) throw new Error('The AWS WAF provider-only verification form changed.');
  if (!verify.matches('button#amzn-btn-verify-internal[type="submit"]') || !visible(verify) || verify.disabled || text(verify) !== 'Confirm') throw new Error('The AWS WAF Confirm control is unavailable.');
  const status = awsWafStatus(host.ownerDocument);
  if (status?.state === 'failed') throw new Error(status.detail);
  if (challenge.subtype === 'bifurcated') {
    if (!visible(challenge.handle) || challenge.handle.parentElement !== challenge.track || !form.contains(challenge.track) || image.closest('.element') !== challenge.element || text(promptElement) !== challenge.instruction || !/^Slide the image to complete .+/.test(challenge.instruction)) throw new Error('The AWS WAF slider instruction or control changed.');
    const box = rect(image), track = rect(challenge.track), handle = rect(challenge.handle);
    if (image.width < 200 || image.width > 1200 || Math.abs(image.height * 2 - image.width) > 1 || Math.abs(box.width - image.width) > .5 || Math.abs(box.height - image.height) > .5 || Math.abs(track.width - box.width) > .5 || handle.width <= 5 || handle.width >= track.width || Math.abs(handle.width - challenge.handle.offsetWidth) > .5) throw new Error('Scaled or unsupported AWS WAF slider geometry.');
    return { box, track, handle };
  }
  if (controls(image).length !== tiles.length || controls(image).some((tile, i) => tile !== tiles[i] || !['true', 'false'].includes(tile.getAttribute('aria-checked')))) throw new Error('The AWS WAF selection controls changed.');
  if (text(promptElement) !== challenge.prompt || !/^Choose all .+/.test(challenge.prompt)) throw new Error('The AWS WAF instruction changed.');
  const box = rect(image), size = (image.width - 4 * (columns - 1)) / columns;
  if (image.width < 200 || image.width > 1200 || size < 40 || Math.abs(image.height - (rows * size + 4 * (rows - 1))) > 1) throw new Error('Unsupported AWS WAF grid dimensions.');
  if (Math.abs(box.width - image.width) > .5 || Math.abs(box.height - image.height) > .5) throw new Error('Scaled AWS WAF grids are unsupported. Restore the original page layout.');
  return { box, size };
}

export function awsWafSnapshot(doc = document) {
  const found = one(roots(doc), 'widget');
  if (!found) return null;
  const modal = one(all(found.root, '.amzn-captcha-modal'), 'challenge');
  if (!modal) return null;
  const image = one(all(modal, 'canvas').filter(canvas => controls(canvas).length), 'grid');
  if (!image) {
    const canvas = one(all(modal, 'canvas#canvas'), 'split-image canvas'), element = canvas?.closest('.element');
    if (canvas && element?.querySelector('input#zoomTargetObject[type="checkbox"]')) {
      const handle = one(all(element, 'img[alt="Slider"]'), 'slider handle'), promptElement = element.querySelector('p > span'), instruction = text(promptElement);
      const verify = one(all(modal, '#amzn-btn-verify-internal'), 'Confirm button'), form = canvas.closest('form');
      if (!handle || !verify || !form) return null;
      if (!/^Slide the image to complete .+/.test(instruction)) throw new Error('Only the English AWS WAF split-image instruction is integrated.');
      const challenge = { provider: 'aws-waf', name: 'AWS WAF', mode: 'aws-waf', subtype: 'bifurcated', type: 'points', ...found, modal, form, image: canvas, element, handle, track: handle.parentElement, verify, promptElement, instruction,
        prompt: `${instruction}. The image has a fixed TOP half and a horizontally displaced BOTTOM half. Return exactly TWO points in this order: the center of the indicated object's TOP half, then the center of its matching BOTTOM half. Only identify the specified object, not distractors. The bottom half wraps horizontally when dragged. If either half is ambiguous or cut off at an image edge, return no points and confidence 0.` };
      validate(challenge); return challenge;
    }
    if (all(modal, 'canvas,input').length) throw new Error('This AWS WAF puzzle mode is unsupported. Only static English image grids and split-image sliders are integrated.');
    return null;
  }
  const tiles = controls(image), count = tiles.length;
  if (![9, 12, 16].includes(count) || image.children.length !== count) throw new Error('Unsupported AWS WAF grid layout.');
  const columns = count <= 12 ? 3 : 4, rows = count === 9 ? 3 : 4;
  const scene = image.parentElement?.parentElement, promptElement = scene?.firstElementChild;
  const prompt = text(promptElement);
  if (!promptElement || !/^Choose all .+/.test(prompt) || !promptElement.querySelector('em')) throw new Error('Only the English AWS WAF image-grid instruction is integrated.');
  const verify = one(all(modal, '#amzn-btn-verify-internal'), 'Confirm button'), form = image.closest('form');
  if (!verify || !form) return null;
  const challenge = { provider: 'aws-waf', name: 'AWS WAF', mode: 'aws-waf', type: 'grid', ...found, modal, form, image, verify, tiles, columns, rows, promptElement, prompt, layout: 'tiles' };
  validate(challenge);
  return challenge;
}

function tilePixels(challenge, index, checked) {
  const { columns, image } = challenge, size = (image.width - 4 * (columns - 1)) / columns;
  const x = index % columns * (size + 4), y = Math.floor(index / columns) * (size + 4);
  const padding = checked ? size / 8 : 0, width = checked ? size * .75 : size;
  // Exclude the selection outline; its fractional stroke can cover the first
  // thumbnail pixels. Both reference and selected image use the same inset.
  const inset = width * .04, copy = document.createElement('canvas'); copy.width = copy.height = 24;
  copy.getContext('2d').drawImage(image, x + padding + inset, y + padding + inset, width - 2 * inset, width - 2 * inset, 0, 0, 24, 24);
  return copy.getContext('2d').getImageData(0, 0, 24, 24).data;
}
function originalPixels(challenge, index) {
  const size = (challenge.image.width - 4 * (challenge.columns - 1)) / challenge.columns;
  return challenge.image.getContext('2d').getImageData(Math.ceil(index % challenge.columns * (size + 4)), Math.ceil(Math.floor(index / challenge.columns) * (size + 4)), Math.floor(size), Math.floor(size)).data;
}
const identical = (before, after) => before.length === after.length && before.every((value, i) => value === after[i]);
function similar(before, after) {
  let absolute = 0, squares = 0, count = 0;
  for (let i = 0; i < before.length; i += 4) for (let c = 0; c < 3; c++) { const difference = before[i + c] - after[i + c]; absolute += Math.abs(difference); squares += difference * difference; count++; }
  return absolute / count <= 6 && Math.sqrt(squares / count) <= 12;
}
function hitTest(challenge, x, y) {
  let hit = challenge.host.ownerDocument.elementFromPoint(x, y);
  while (hit?.shadowRoot) { const inner = hit.shadowRoot.elementFromPoint(x, y); if (!inner || inner === hit) break; hit = inner; }
  return hit;
}

export async function captureAwsWaf(challenge) {
  const before = validate(challenge);
  if (challenge.subtype === 'bifurcated') {
    if (Math.abs(before.handle.x - before.track.x) > .5) throw new Error('The AWS WAF slider has already moved. Refresh it or finish it manually.');
    const original = document.createElement('canvas'); original.width = challenge.image.width; original.height = challenge.image.height; original.getContext('2d').drawImage(challenge.image, 0, 0);
    const task = { type: 'points', image: original.toDataURL('image/png'), prompt: challenge.prompt }, value = await fingerprint('aws-waf-slide\n' + JSON.stringify({ task, geometry: before }));
    if (!sameRect(before.box, validate(challenge).box) || task.image !== challenge.image.toDataURL('image/png')) throw new Error('The AWS WAF slider changed during capture.');
    captures.set(challenge, { before, original }); return { task, fingerprint: value };
  }
  if (selected(challenge).some(Boolean)) throw new Error('The AWS WAF grid already has selections. Review them manually.');
  const canvas = document.createElement('canvas'), size = Math.round(before.size);
  canvas.width = size * challenge.columns; canvas.height = size * challenge.rows;
  const context = canvas.getContext('2d'), tiles = [];
  for (let index = 0; index < challenge.tiles.length; index++) {
    const x = index % challenge.columns, y = Math.floor(index / challenge.columns);
    context.drawImage(challenge.image, x * (before.size + 4), y * (before.size + 4), before.size, before.size, x * size, y * size, size, size);
    tiles.push({ original: originalPixels(challenge, index), thumbnail: tilePixels(challenge, index, false) });
  }
  const task = { type: 'grid', image: canvas.toDataURL('image/png'), rows: challenge.rows, columns: challenge.columns, layout: 'tiles', prompt: challenge.prompt };
  const value = await fingerprint('aws-waf\n' + JSON.stringify(task));
  if (!sameRect(before.box, validate(challenge).box) || selected(challenge).some(Boolean)) throw new Error('The AWS WAF grid changed during capture.');
  if (tiles.some((pixels, i) => !identical(pixels.original, originalPixels(challenge, i)))) throw new Error('The AWS WAF grid image changed during capture.');
  captures.set(challenge, { before, tiles });
  return { task, fingerprint: value };
}

function indices(challenge, solution) {
  if (!Number.isFinite(solution.confidence) || solution.confidence < .85 || !Array.isArray(solution.selected) || !solution.selected.length || solution.selected.length > challenge.tiles.length || new Set(solution.selected).size !== solution.selected.length || solution.selected.some(index => !Number.isInteger(index) || index < 0 || index >= challenge.tiles.length)) throw new Error('The AWS WAF grid selection is uncertain or invalid.');
  return [...solution.selected].sort((a, b) => a - b);
}

export function previewAwsWaf(challenge, solution) {
  validate(challenge);
  if (challenge.subtype === 'bifurcated') return `AWS WAF: move the split-image slider ${Math.round(slideDistance(challenge, solution))} pixels right, then Confirm. The slider has not moved.`;
  return `AWS WAF: select cells ${indices(challenge, solution).map(index => index + 1).join(', ')}, counted from the top-left, then Confirm. No cells have been selected.`;
}

export async function applyAwsWaf(challenge, solution, current) {
  const baseline = captures.get(challenge);
  if (!baseline) throw new Error('Capture the AWS WAF grid before applying a result.');
  if (challenge.subtype === 'bifurcated') return applySlide(challenge, solution, current, baseline);
  const wanted = indices(challenge, solution), expected = challenge.tiles.map(() => false);
  const check = () => {
    const geometry = validate(challenge), actual = selected(challenge);
    if (!sameRect(geometry.box, baseline.before.box) || actual.some((checked, i) => checked !== expected[i])) throw new Error('The AWS WAF selection or layout changed.');
    for (let i = 0; i < actual.length; i++) {
      const same = actual[i] ? similar(baseline.tiles[i].thumbnail, tilePixels(challenge, i, true)) : identical(baseline.tiles[i].original, originalPixels(challenge, i));
      if (!same) throw new Error('The AWS WAF grid image changed.');
    }
  };
  const guard = async () => { if (!await current()) throw new Error('The AWS WAF action was stopped.'); check(); };
  for (const index of wanted) {
    await guard();
    check();
    const { box, size } = validate(challenge), x = box.x + index % challenge.columns * (size + 4) + size / 2, y = box.y + Math.floor(index / challenge.columns) * (size + 4) + size / 2;
    if (hitTest(challenge, x, y) !== challenge.image) throw new Error('The AWS WAF grid is obscured.');
    challenge.image.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }));
    expected[index] = true;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  await guard();
  check();
  confirm(challenge);
}

function confirm(challenge) {
  validate(challenge);
  const box = rect(challenge.verify);
  const hit = hitTest(challenge, box.x + box.width / 2, box.y + box.height / 2);
  if (hit !== challenge.verify && !challenge.verify.contains(hit)) throw new Error('The AWS WAF Confirm control is obscured.');
  // This exact provider-owned form intercepts submit to verify the puzzle.
  // Prevent native navigation even if the SDK handler disappears mid-action;
  // do not suppress propagation to the provider's actual verification handler.
  const preventNavigation = event => event.preventDefault();
  challenge.form.addEventListener('submit', preventNavigation, true);
  try { challenge.verify.click(); } finally { challenge.form.removeEventListener('submit', preventNavigation, true); captures.delete(challenge); }
}

function slideDistance(challenge, solution) {
  const points = solution.points;
  if (!Number.isFinite(solution.confidence) || solution.confidence < .9 || !Array.isArray(points) || points.length !== 2 || points.some(point => !Number.isFinite(point?.x) || !Number.isFinite(point?.y) || point.x <= .02 || point.x >= .98 || point.y <= 0 || point.y >= 1) || points[0].y >= .5 || points[1].y <= .5) throw new Error('The two AWS WAF object halves are uncertain or invalid.');
  const { track, handle } = validate(challenge), fraction = (points[0].x - points[1].x + 1) % 1;
  if (fraction < .005 || fraction > .995) throw new Error('The AWS WAF object appears already aligned. Review it manually.');
  return fraction * (track.width - handle.width);
}

function slidePixels(challenge, baseline, distance) {
  const geometry = validate(challenge), { image } = challenge;
  const before = baseline.before;
  if (!sameRect(geometry.box, before.box) || !sameRect(geometry.track, before.track) || Math.abs(geometry.handle.x - before.handle.x - distance) > 1 || ['y', 'width', 'height'].some(key => Math.abs(geometry.handle[key] - before.handle[key]) > .5)) throw new Error('The AWS WAF slider layout or progress changed.');
  // MouseEvent client coordinates are integer-rounded by some engines. Validate
  // progress against the requested step, then compare the actually drawn shift.
  const shift = Math.trunc((geometry.handle.x - before.handle.x) * geometry.track.width / (geometry.track.width - geometry.handle.width));
  const half = image.height / 2, actualTop = image.getContext('2d').getImageData(0, 0, image.width, Math.floor(half)).data, originalTop = baseline.original.getContext('2d').getImageData(0, 0, image.width, Math.floor(half)).data;
  if (!identical(actualTop, originalTop)) throw new Error('The AWS WAF slider image changed.');
  const expected = document.createElement('canvas'); expected.width = image.width; expected.height = image.height;
  const context = expected.getContext('2d'), width = image.width - shift;
  context.drawImage(baseline.original, 0, 0);
  if (shift) context.drawImage(baseline.original, width, half, shift, half, 0, half, shift, half);
  context.drawImage(baseline.original, 0, half, width, half, shift, half, width, half);
  const sample = source => source.getContext('2d').getImageData(0, Math.ceil(half), image.width, Math.floor(half)).data;
  if (!similar(sample(expected), sample(image))) throw new Error('The AWS WAF slider image changed or did not follow the drag.');
  return geometry;
}

async function applySlide(challenge, solution, current, baseline) {
  const distance = slideDistance(challenge, solution), start = baseline.before.handle, x = start.x + start.width / 2, y = start.y + start.height / 2;
  let progress = 0, released = false;
  const guard = async () => { if (!await current()) throw new Error('The AWS WAF drag was stopped.'); slidePixels(challenge, baseline, progress); };
  const event = (target, type, clientX) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1 }));
  await guard();
  if (hitTest(challenge, x, y) !== challenge.handle) throw new Error('The AWS WAF slider handle is obscured.');
  try {
    event(challenge.handle, 'mousedown', x);
    for (let step = 1; step <= 16; step++) {
      await guard(); slidePixels(challenge, baseline, progress);
      progress = distance * step / 16; event(challenge.host.ownerDocument.body, 'mousemove', x + progress);
      await new Promise(resolve => setTimeout(resolve, 16));
    }
    await guard(); slidePixels(challenge, baseline, progress);
    event(challenge.host.ownerDocument.body, 'mouseup', x + progress); released = true;
    await guard(); slidePixels(challenge, baseline, progress); confirm(challenge);
  } finally {
    if (!released) { event(challenge.host.ownerDocument.body, 'mousemove', x); event(challenge.host.ownerDocument.body, 'mouseup', x); }
  }
}

export function awsWafStatus(doc = document) {
  const found = roots(doc);
  if (found.length !== 1) return null;
  const { root } = found[0];
  const alert = all(root, '.amzn-captcha-modal [role="alert"]').find(element => text(element));
  if (alert) return { state: 'failed', detail: `AWS WAF reported: ${text(alert).slice(0, 180)} No verification was confirmed.` };
  const screen = root.querySelector('#root');
  if (screen && !all(root, '.amzn-captcha-modal').length && all(screen, 'img[alt="Success"]').length && /That is correct/.test(text(screen)) && /Success!/.test(text(screen))) {
    // The SDK displays this before submitCaptcha/getToken resolves. Its success
    // screen is deliberately not a provider-token or application receipt.
    return { state: 'puzzle-correct', detail: 'AWS WAF accepted the puzzle. Token issuance and any application outcome are unconfirmed.' };
  }
  return null;
}

// Return an explicit disposer; the caller binds its lifetime to one session.
// Watching the document alone cannot see mutations inside an open shadow root.
export function observeAwsWafStatus(callback, doc = document) {
  const watched = new Set(), observers = [];
  let stopped = false, lastStatus;
  const scan = () => {
    if (stopped) return;
    for (const { root } of roots(doc)) if (!watched.has(root)) {
      watched.add(root);
      const observer = new MutationObserver(scan); observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'alt'] }); observers.push(observer);
    }
    const status = awsWafStatus(doc);
    const key = status && JSON.stringify(status);
    if (status && key !== lastStatus) { lastStatus = key; callback(status); }
  };
  const observer = new MutationObserver(scan); observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] }); observers.push(observer);
  scan();
  return () => { stopped = true; for (const item of observers) item.disconnect(); watched.clear(); };
}
