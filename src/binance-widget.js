import { visible, captureElement, loadImage, fingerprint, assertControl } from './challenge-dom.js';

// Public BCaptcha SDK: bin.bnbstatic.com/static/js/se/captcha/v1/captcha.min.js
// (created 2026-06-03). The SDK submits its own verification on mouse release.
const all = (root, selector) => [...root.querySelectorAll(selector)].filter(visible);
const roots = doc => all(doc, '.bcapc-popup .bs-modal, .bcapc-popup .bs-checkbox-modal, .bcapc-popup .bcap-modal');
const captures = new WeakMap();
const one = (items, name) => {
  if (items.length > 1) throw new Error(`More than one Binance ${name} is visible.`);
  return items[0];
};
const rectangle = element => {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
};
const sameRect = (a, b) => ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) < .5);
const background = element => {
  const style = getComputedStyle(element);
  return { image: style.backgroundImage, size: style.backgroundSize, position: style.backgroundPosition };
};

export function binanceSnapshot(doc = document) {
  const root = one(roots(doc), 'widget');
  if (root?.matches('.bcap-modal')) return gridSnapshot(root);
  if (!root || !root.matches('.bs-modal')) return null;
  if (all(root, '.bs-tipmessage-container').length) return null;
  const image = one(all(root, '.bs-main-image[_id="im"]'), 'puzzle background');
  const reference = one(all(root, '.bs-slide-image[_id="shim"]'), 'puzzle piece');
  const handle = one(all(root, '.bs-slide-thumb[_id="slth"]'), 'slider');
  const track = one(all(root, '.bs-slide-container[_id="sl"]'), 'slider track');
  if (!image || !reference || !handle || !track || !image.contains(reference) || !track.contains(handle)) return null;
  // The SDK announces readiness before its 300ms piece entrance finishes.
  // Wait for that exact animation; a manually moved slider still fails capture.
  if (reference.getAnimations().some(animation => animation.animationName === 'SlideShowAnimation' && animation.playState === 'running')) return null;
  const a = background(image).image, b = background(reference).image;
  if (!a.startsWith('url(') || a !== b) return null;
  return { provider: 'binance', name: 'Binance', mode: 'binance', type: 'puzzle', root, image, reference, handle, track };
}

export function binanceManagedSnapshot(doc = document) {
  const root = one(roots(doc), 'widget');
  if (!root?.matches('.bs-checkbox-modal')) return null;
  const control = one(all(root, '.bs-checkbox-box[_action="check"][role="checkbox"][aria-checked="false"]'), 'checkbox');
  if (!control || control.matches('.bs-checkbox-loading, .bs-checkbox-failure') || control.closest('.bs-checkbox-disabled')) return null;
  return { provider: 'binance', name: 'Binance', root, control };
}

function state(challenge) {
  const { root, image, reference, handle, track } = challenge;
  if (roots(root.ownerDocument).length !== 1 || ![root, image, reference, handle, track].every(visible) || !root.contains(image) || !image.contains(reference) || !root.contains(track) || !track.contains(handle)) throw new Error('The Binance challenge changed or is unavailable.');
  if (all(root, '.bs-tipmessage-container').length || handle.matches('.bs-validate-fail, .bs-validate-success')) throw new Error('The Binance challenge is no longer ready for input.');
  for (const element of [image, reference, handle, track]) {
    const rect = element.getBoundingClientRect();
    if (Math.abs(rect.width - element.offsetWidth) > .5 || Math.abs(rect.height - element.offsetHeight) > .5) throw new Error('Scaled Binance challenge layouts are unsupported.');
  }
  return { image: background(image), reference: background(reference), imageRect: rectangle(image), pieceRect: rectangle(reference), handleRect: rectangle(handle), trackRect: rectangle(track) };
}

function sameState(before, after, moving = false) {
  return JSON.stringify(before.image) === JSON.stringify(after.image) && JSON.stringify(before.reference) === JSON.stringify(after.reference) && sameRect(before.imageRect, after.imageRect) && sameRect(before.trackRect, after.trackRect) &&
    ['pieceRect', 'handleRect'].every(name => (moving ? ['y', 'width', 'height'] : ['x', 'y', 'width', 'height']).every(key => Math.abs(before[name][key] - after[name][key]) < .5));
}

async function taskImage(challenge, fetchImage, cache) {
  return { type: 'puzzle', image: await captureElement(challenge.image, fetchImage, cache), reference: await captureElement(challenge.reference, fetchImage, cache), y: 0 };
}

export async function captureBinance(challenge, fetchImage, cache = new Map()) {
  if (challenge.type === 'grid') return captureGrid(challenge, fetchImage, cache);
  const before = state(challenge);
  if (Math.abs(before.pieceRect.x - before.imageRect.x) > .5 || Math.abs(before.pieceRect.y - before.imageRect.y) > .5 || Math.abs(parseFloat(getComputedStyle(challenge.handle).left)) > .5) throw new Error('The Binance puzzle has already moved. Refresh it or finish manually.');
  const task = await taskImage(challenge, fetchImage, cache);
  if (!sameState(before, state(challenge))) throw new Error('The Binance challenge changed during capture.');
  const hash = await fingerprint(JSON.stringify({ provider: 'binance', task, before }));
  captures.set(challenge, { before, task, fetchImage, cache });
  return { task, fingerprint: hash };
}

function drag(challenge, solution) {
  if (!Number.isFinite(solution.confidence) || solution.confidence < .85 || !Number.isFinite(solution.normalizedX) || solution.normalizedX <= 0 || solution.normalizedX >= 1) throw new Error('The Binance puzzle position is uncertain or invalid.');
  const image = rectangle(challenge.image), piece = rectangle(challenge.reference), handle = rectangle(challenge.handle), track = rectangle(challenge.track);
  const distance = solution.normalizedX * image.width;
  if (distance < 1 || distance > track.width - piece.width || distance + piece.width > image.width + .5) throw new Error('The Binance puzzle position is outside its slider range.');
  return { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2, distance };
}

export function previewBinance(challenge, solution) {
  if (challenge.type === 'grid') {
    gridState(challenge);
    return `Binance page ${challenge.page} of ${challenge.pages}: select cells ${indices(solution).map(index => index + 1).join(', ') || 'none'}, then ${challenge.page < challenge.pages ? 'Next' : 'Verify'}. No cells have been selected.`;
  }
  state(challenge);
  return `Move the Binance slider ${Math.round(drag(challenge, solution).distance)} pixels right. Releasing it requests CAPTCHA verification.`;
}

export async function applyBinance(challenge, solution, current) {
  if (challenge.type === 'grid') return applyGrid(challenge, solution, current);
  const baseline = captures.get(challenge);
  if (!baseline) throw new Error('Capture the Binance challenge before applying a result.');
  let progress = 0;
  const check = () => {
    const latest = state(challenge);
    if (!sameState(baseline.before, latest, true) || Math.abs(latest.pieceRect.x - baseline.before.pieceRect.x - progress) > 1 || Math.abs(latest.handleRect.x - baseline.before.handleRect.x - progress) > 1) throw new Error('The Binance challenge changed or the slider did not move.');
    if (binanceFailure(challenge.root.ownerDocument)) throw new Error('Binance rejected verification.');
  };
  const guard = async () => {
    if (!await current()) throw new Error('The Binance action was stopped.');
    check();
    const task = await taskImage(challenge, baseline.fetchImage, baseline.cache);
    if (JSON.stringify(task) !== JSON.stringify(baseline.task)) throw new Error('The Binance image changed.');
    if (!await current()) throw new Error('The Binance action was stopped.');
    check();
  };
  await guard();
  const { x, y, distance } = drag(challenge, solution), doc = challenge.root.ownerDocument;
  assertControl(challenge.handle, challenge.root);
  const hit = doc.elementFromPoint(x, y);
  if (!hit || !challenge.handle.contains(hit)) throw new Error('The Binance slider is obscured.');
  const send = (target, type, clientX, buttons) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: doc.defaultView, clientX, clientY: y, button: 0, buttons }));
  send(challenge.handle, 'mousedown', x, 1);
  for (let step = 1; step <= 16; step++) {
    await guard();
    progress = distance * step / 16;
    send(doc, 'mousemove', x + progress, 1);
    await new Promise(resolve => setTimeout(resolve, 16));
  }
  await guard();
  // Mouseup and touchcancel both invoke SDK verification. Never send either
  // during cleanup after Stop, a refresh, or a failed guard.
  send(doc, 'mouseup', x + distance, 0);
  captures.delete(challenge);
}

export function binanceVerified(doc = document) {
  for (const root of roots(doc)) {
    if (root.matches('.bs-modal') && all(root, '.bs-slide-thumb.bs-validate-success').length) return true;
    if (root.matches('.bs-checkbox-modal') && all(root, '.bs-checkbox-box.bs-checkbox-success[aria-checked="true"]').length) return true;
    if (root.matches('.bcap-modal') && banner(root, '.bcap-success-message')) return true;
  }
  return false;
}

export function binanceFailure(doc = document) {
  for (const root of roots(doc)) {
    if (all(root, '.bs-slide-thumb.bs-validate-fail, .bs-checkbox-box.bs-checkbox-failure, .bs-checkbox-errortext-visible').length) return 'Binance rejected verification. No success was confirmed.';
    if (all(root, '.bs-tipmessage-text').some(element => !/^loading\b/i.test(element.innerText.trim()))) return 'The Binance challenge reported an error or expired.';
    if (root.matches('.bcap-modal') && (banner(root, '.bcap-error-message') || all(root, '.bcap-image-area-tipmessage').length || all(root, '.bcap-tipmessage-container').some(element => element.innerText.trim() && !/^loading\b/i.test(element.innerText.trim())))) return 'Binance rejected the image selection or reported an error.';
  }
  return null;
}

const text = element => element?.textContent?.trim().replace(/\s+/g, ' ') || '';
const contained = (inner, outer) => inner.x >= outer.x - .5 && inner.y >= outer.y - .5 && inner.x + inner.width <= outer.x + outer.width + .5 && inner.y + inner.height <= outer.y + outer.height + .5;
function banner(root, selector) {
  const area = root.querySelector('.bcap-image-area-container');
  // The SDK sets this exact inline target only after the provider response.
  // Observe it immediately: the 200ms CSS transition can still be clipped when
  // the style mutation fires, and the entire widget disappears after 500ms.
  return visible(area) && all(root, selector).some(element => area.contains(element) && element.style.bottom === '0px');
}
function gridSnapshot(root) {
  if (all(root, '.bcap-tipmessage-container, .bcap-image-area-loading, .bcap-image-area-tipmessage').length || banner(root, '.bcap-success-message') || banner(root, '.bcap-error-message')) return null;
  const area = one(all(root, '.bcap-image-area-container'), 'image area');
  const container = one(all(root, '.bcap-image-table-container'), 'grid container');
  if (!area || !container || !area.contains(container)) return null;
  const tables = [...container.querySelectorAll('.bcap-image-table')];
  if (!tables.length) return null;
  if (tables.length > 2 || tables.some((table, index) => !table.classList.contains(`page${index + 1}`))) throw new Error('Unsupported Binance grid pages.');
  const image = one(tables.filter(table => visible(table) && contained(rectangle(table), rectangle(area))), 'active grid');
  if (!image) return null; // Both pages are clipped during the SDK transition.
  const page = tables.indexOf(image) + 1, tiles = [...image.querySelectorAll('.bcap-image-cell-container[_action="imageSelect"]')];
  const verify = one(all(root, '.bcap-verify-button[_action="verify"][_id="vb"]'), 'Verify control');
  const title = one(all(root, '.bcap-text-message-title'), 'instruction'), label = one(all(root, '.bcap-text-message-title2#tagLabel'), 'target');
  if (!verify || !title || !label || !text(title) || !text(label)) return null;
  if (tiles.length !== 9 || tiles.some((tile, index) => tile.getAttribute('_id') !== `${page}${index}` || !visible(tile))) throw new Error('Unsupported Binance grid cells.');
  const prompt = `${text(title)} ${text(label)}`;
  if (prompt.length > 2000) throw new Error('The Binance grid instruction is unavailable.');
  return { provider: 'binance', name: 'Binance', mode: 'binance', type: 'grid', root, area, container, image, tiles, verify, title, label, prompt, page, pages: tables.length, rows: 3, columns: 3, layout: 'tiles' };
}
function gridState(challenge) {
  const latest = gridSnapshot(challenge.root);
  if (roots(challenge.root.ownerDocument).length !== 1 || !latest || latest.root !== challenge.root || latest.image !== challenge.image || latest.verify !== challenge.verify || latest.prompt !== challenge.prompt || latest.page !== challenge.page || latest.pages !== challenge.pages || latest.tiles.some((tile, index) => tile !== challenge.tiles[index])) throw new Error('The Binance grid changed or is unavailable.');
  const tiles = challenge.tiles.map(rectangle), images = challenge.tiles.map(tile => one(all(tile, '.bcap-image-cell-image'), 'cell image'));
  if (images.some(image => !image)) throw new Error('The Binance grid image is unavailable.');
  const size = tiles[0].width;
  if (size < 40 || size > 200 || tiles.some((rect, index) => Math.abs(rect.width - size) > .5 || Math.abs(rect.height - size) > .5 || Math.abs(rect.y - tiles[Math.floor(index / 3) * 3].y) > .5 || Math.abs(rect.x - tiles[index % 3].x) > .5 || !contained(rect, rectangle(challenge.area)))) throw new Error('Unsupported Binance grid geometry.');
  if (tiles[1].x <= tiles[0].x + size - .5 || tiles[3].y <= tiles[0].y + size - .5) throw new Error('Overlapping Binance grid cells are unsupported.');
  return { area: rectangle(challenge.area), table: rectangle(challenge.image), verify: rectangle(challenge.verify), tiles, images, backgrounds: images.map(background) };
}
const sameGrid = (before, after) => sameRect(before.area, after.area) && sameRect(before.table, after.table) && sameRect(before.verify, after.verify) && before.tiles.every((rect, index) => sameRect(rect, after.tiles[index])) && JSON.stringify(before.backgrounds) === JSON.stringify(after.backgrounds);
const selection = challenge => challenge.tiles.map(tile => tile.hasAttribute('selected') || tile.classList.contains('selected'));
async function gridTask(challenge, fetchImage, cache) {
  const state = gridState(challenge), canvas = document.createElement('canvas'); canvas.width = canvas.height = 384;
  const context = canvas.getContext('2d');
  for (let index = 0; index < 9; index++) context.drawImage(await loadImage(await captureElement(state.images[index], fetchImage, cache)), index % 3 * 128, Math.floor(index / 3) * 128, 128, 128);
  return { type: 'grid', image: canvas.toDataURL('image/png'), prompt: challenge.prompt, rows: 3, columns: 3, layout: 'tiles' };
}
async function captureGrid(challenge, fetchImage, cache) {
  const before = gridState(challenge);
  if (selection(challenge).some(Boolean)) throw new Error('The Binance grid already has selections. Review them manually.');
  const task = await gridTask(challenge, fetchImage, cache);
  if (!sameGrid(before, gridState(challenge)) || selection(challenge).some(Boolean)) throw new Error('The Binance grid changed during capture.');
  const geometry = { area: before.area, table: before.table, verify: before.verify, tiles: before.tiles };
  const hash = await fingerprint(JSON.stringify({ provider: 'binance', task, page: challenge.page, pages: challenge.pages, geometry }));
  captures.set(challenge, { before, task, fetchImage, cache }); return { task, fingerprint: hash };
}
function indices(solution) {
  if (!Number.isFinite(solution.confidence) || solution.confidence < .85 || !Array.isArray(solution.selected) || solution.selected.length > 9 || new Set(solution.selected).size !== solution.selected.length || solution.selected.some(index => !Number.isInteger(index) || index < 0 || index >= 9)) throw new Error('The Binance image selection is uncertain or invalid.');
  return [...solution.selected].sort((a, b) => a - b);
}
function clickGridControl(challenge, element) {
  assertControl(element, challenge.root);
  const box = rectangle(element), x = box.x + box.width / 2, y = box.y + box.height / 2, hit = element.ownerDocument.elementFromPoint(x, y);
  if (!hit || !element.contains(hit)) throw new Error('The Binance grid control is obscured.');
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: element.ownerDocument.defaultView, clientX: x, clientY: y, button: 0 }));
}
async function applyGrid(challenge, solution, current) {
  const baseline = captures.get(challenge);
  if (!baseline) throw new Error('Capture the Binance grid before applying a result.');
  const wanted = indices(solution), expected = challenge.tiles.map(() => false);
  const check = () => {
    if (!sameGrid(baseline.before, gridState(challenge)) || selection(challenge).some((value, index) => value !== expected[index])) throw new Error('The Binance grid layout or selection changed.');
    if (binanceFailure(challenge.root.ownerDocument)) throw new Error('Binance rejected verification.');
  };
  const guard = async () => {
    if (!await current()) throw new Error('The Binance action was stopped.'); check();
    if (JSON.stringify(await gridTask(challenge, baseline.fetchImage, baseline.cache)) !== JSON.stringify(baseline.task)) throw new Error('The Binance grid image changed.');
    if (!await current()) throw new Error('The Binance action was stopped.'); check();
  };
  for (const index of wanted) { await guard(); clickGridControl(challenge, challenge.tiles[index]); expected[index] = true; }
  await guard(); clickGridControl(challenge, challenge.verify); captures.delete(challenge);
  return { nextPage: challenge.page < challenge.pages, page: challenge.page, pages: challenge.pages };
}
