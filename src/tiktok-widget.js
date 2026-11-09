import { visible, captureElement, fingerprint, assertControl } from './challenge-dom.js';

// Observed public TikTok SDK 2.33.11, UI chunk 488.aa37bc38e4a87c5b37fa.js.
// These selectors describe that SDK, not a verified TikTok Careers integration.
const all = (root, selector) => [...root.querySelectorAll(selector)].filter(visible);
const text = element => element?.innerText?.trim().replace(/\s+/g, ' ') || '';
const roots = doc => all(doc, '.captcha-verify-container #captcha-verify-container-main-page');
const captures = new WeakMap();
const one = (values, label) => {
  if (values.length > 1) throw new Error(`More than one TikTok ${label} is visible.`);
  return values[0];
};
const instruction = root => root.innerText.split(/\n/).map(value => value.trim().replace(/\s+/g, ' ')).find(value => /^Select 2 objects that are the same shape[.!]?$/i.test(value));
const marks = root => all(root, 'div.cap-absolute.cap-cursor-pointer');
const source = image => image.currentSrc || image.src;
const loaded = image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
const passPath = 'M24 46a22 22 0 1 0 0-44 22 22 0 0 0 0 44Zm10.4-30.67c.59.38.76 1.16.4 1.75l-11 17.58a2.51 2.51 0 0 1-4.04.34l-7.33-8.39c-.47-.5-.41-1.33.11-1.78l1.92-1.67c.51-.45 1.3-.4 1.77.13l5.1 5.82 9.2-14.71c.35-.6 1.13-.77 1.73-.4l2.13 1.33Z';
const rectangle = element => {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
};
const sameRect = (a, b) => ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) < .5);

export function tiktokSnapshot(doc = document) {
  const root = one(roots(doc), 'widget');
  if (!root) return null;
  const images = all(root, 'img');
  const circles = images.filter(image => getComputedStyle(image).clipPath === 'circle(50%)');
  if (circles.length >= 2) {
    if (circles.length !== 2 || images.length !== 2) throw new Error('This TikTok circle layout is unsupported.');
    if (!circles.every(loaded)) return null;
    const [image, reference] = circles.sort((a, b) => b.offsetWidth - a.offsetWidth);
    const slider = one(all(root, '#captcha_slide_button.secsdk-captcha-drag-icon'), 'slider');
    const handle = slider?.closest('div[draggable="true"]'), track = handle?.parentElement;
    if (!slider || !handle || !track || !root.contains(track)) return null;
    return { provider: 'tiktok', name: 'TikTok', mode: 'tiktok', type: 'rotate-ring', root, image, reference, slider, handle, track };
  }
  const image = one(all(root, 'img#captcha-verify-image'), 'puzzle background');
  if (image) {
    const reference = one(images.filter(item => item !== image && item.closest('div[draggable="true"]')), 'puzzle piece');
    const handle = reference?.closest('div[draggable="true"]');
    const slider = one(all(root, '#captcha_slide_button.secsdk-captcha-drag-icon'), 'slider');
    if (!reference || !handle || !slider || !loaded(image) || !loaded(reference)) return null;
    // The SDK's inner slider button is disabled even when its draggable parent
    // is active. Drag the puzzle's own wrapper, which has the same submit path.
    if (!root.contains(handle) || !visible(handle)) return null;
    return { provider: 'tiktok', name: 'TikTok', mode: 'tiktok', type: 'puzzle', root, image, reference, handle };
  }
  const pointImage = one(all(root, 'img.cap-cursor-pointer'), 'object image');
  if (pointImage) {
    if (!loaded(pointImage)) return null;
    const prompt = instruction(root);
    if (!prompt) throw new Error('This TikTok object-selection instruction is unsupported. Only the English same-shape pair is integrated.');
    const verify = one(all(root, 'button').filter(button => text(button) === 'Confirm'), 'Confirm button');
    if (!verify) return null;
    return { provider: 'tiktok', name: 'TikTok', mode: 'tiktok', type: 'points', root, image: pointImage, verify,
      instruction: prompt, expectedCount: 2,
      prompt: `${prompt} Return exactly two center points, one per matching object. Compare shape geometry even when colors or orientations differ. If ambiguous, return no points and confidence 0.` };
  }
  // Loading and result screens have no supported image. Never reinterpret a
  // spinner, delegated provider, or dismissed dialog as successful verification.
  return null;
}

function circleGeometry(challenge) {
  const { image, reference, slider, handle, track, root } = challenge;
  if (!visible(reference) || !loaded(reference) || !root.contains(reference) || !visible(handle) || !visible(slider) || !visible(track) || !root.contains(handle) || slider.closest('div[draggable="true"]') !== handle || handle.parentElement !== track || image.parentElement !== reference.parentElement) throw new Error('The TikTok circle controls changed.');
  const inspect = element => {
    const size = element.offsetWidth, style = getComputedStyle(element);
    if (element.offsetHeight !== size || element.naturalWidth !== element.naturalHeight || style.clipPath !== 'circle(50%)' || style.objectFit !== 'fill') throw new Error('This TikTok circle geometry is unsupported.');
    for (let node = element.parentElement; node; node = node.parentElement) {
      const s = getComputedStyle(node), matrix = new DOMMatrixReadOnly(s.transform);
      if (!matrix.is2D || Math.abs(matrix.a - 1) > 1e-6 || Math.abs(matrix.d - 1) > 1e-6 || Math.abs(matrix.b) > 1e-6 || Math.abs(matrix.c) > 1e-6 || (s.scale !== 'none' && s.scale !== '1') || (s.rotate !== 'none' && s.rotate !== '0deg') || s.perspective !== 'none') throw new Error('Scaled or transformed TikTok circle layouts are unsupported.');
    }
    const matrix = new DOMMatrixReadOnly(style.transform), origin = style.transformOrigin.split(' ').map(parseFloat);
    if (!matrix.is2D || Math.abs(matrix.a - matrix.d) > 1e-6 || Math.abs(matrix.b + matrix.c) > 1e-6 || Math.abs(matrix.a ** 2 + matrix.b ** 2 - 1) > 1e-5 || Math.abs(matrix.e) > 1e-6 || Math.abs(matrix.f) > 1e-6 || Math.abs(origin[0] - size / 2) > .5 || Math.abs(origin[1] - size / 2) > .5 || (style.scale !== 'none' && style.scale !== '1') || (style.rotate !== 'none' && style.rotate !== '0deg')) throw new Error('This TikTok circle transform is unsupported.');
    const rect = element.getBoundingClientRect(), expectedSize = size * (Math.abs(matrix.a) + Math.abs(matrix.b));
    if (Math.abs(rect.width - expectedSize) > .5 || Math.abs(rect.height - expectedSize) > .5) throw new Error('Scaled TikTok circle layouts are unsupported.');
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, size, angle: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI };
  };
  const outer = inspect(image), inner = inspect(reference), sliderRect = rectangle(slider), trackRect = rectangle(track);
  if (![[210, 128], [170, 105]].some(([a, b]) => outer.size === a && inner.size === b) || Math.hypot(outer.x - inner.x, outer.y - inner.y) > .5 || Math.abs(outer.angle + inner.angle) > .1 || slider.offsetWidth !== 64 || Math.abs(sliderRect.width - 64) > .5 || Math.abs(trackRect.width - track.offsetWidth) > .5 || track.offsetWidth <= 64) throw new Error('This TikTok circle geometry is unsupported or changed.');
  return { outer, inner, sliderRect, trackRect, radiusRatio: inner.size / outer.size };
}

function state(challenge) {
  const { root, image, reference, handle, verify, type } = challenge;
  if (!visible(root) || !visible(image) || !root.contains(image) || !loaded(image)) throw new Error('The TikTok challenge changed or is no longer available.');
  if (roots(root.ownerDocument).length !== 1) throw new Error('The TikTok challenge is ambiguous or changed.');
  if (type === 'rotate-ring') return { image: source(image), reference: source(reference), ring: circleGeometry(challenge) };
  if (type === 'puzzle' && (!visible(reference) || !loaded(reference) || !root.contains(reference) || reference.closest('div[draggable="true"]') !== handle || !visible(handle))) throw new Error('The TikTok puzzle control changed.');
  if (type === 'points' && (!root.contains(verify) || !visible(verify) || instruction(root) !== challenge.instruction || text(verify) !== 'Confirm')) throw new Error('The TikTok instruction or Confirm control changed.');
  // This SDK divides viewport client coordinates by layout offsetWidth and
  // assigns drag deltas directly to layout pixels. CSS scaling is unsupported.
  for (const element of [image, reference].filter(Boolean)) {
    const rect = element.getBoundingClientRect();
    if (Math.abs(rect.width - element.offsetWidth) > .5 || Math.abs(rect.height - element.offsetHeight) > .5) throw new Error('Scaled TikTok challenge layouts are unsupported. Restore the original page layout.');
  }
  return { image: source(image), reference: reference && source(reference), imageRect: rectangle(image), pieceRect: reference && rectangle(reference), instruction: type === 'points' ? instruction(root) : '' };
}

function sameState(before, after, moving = false) {
  if (before.ring) {
    if (!after.ring || before.image !== after.image || before.reference !== after.reference) return false;
    const a = before.ring, b = after.ring;
    return ['outer', 'inner'].every(key => ['x', 'y', 'size'].every(axis => Math.abs(a[key][axis] - b[key][axis]) < .5) && (moving || Math.abs(a[key].angle - b[key].angle) < .1)) && sameRect(a.trackRect, b.trackRect) &&
      (moving ? ['y', 'width', 'height'].every(key => Math.abs(a.sliderRect[key] - b.sliderRect[key]) < .5) : sameRect(a.sliderRect, b.sliderRect));
  }
  return before.image === after.image && before.reference === after.reference && before.instruction === after.instruction && sameRect(before.imageRect, after.imageRect) &&
    (!before.pieceRect || (moving
      ? ['y', 'width', 'height'].every(key => Math.abs(before.pieceRect[key] - after.pieceRect[key]) < .5)
      : sameRect(before.pieceRect, after.pieceRect)));
}

async function captureTask(challenge, fetchImage, cache) {
  if (challenge.type === 'rotate-ring') {
    // Draw the immutable blob pixels, not the rotated display boxes. Only the
    // inspected ring branch may bypass captureElement's transform rejection.
    const raw = image => {
      if (!loaded(image) || !source(image).startsWith('blob:') || image.naturalWidth < 64 || image.naturalWidth > 1200 || image.naturalWidth !== image.naturalHeight) throw new Error('TikTok circle images must be loaded square blob images between 64 and 1200 pixels.');
      const canvas = image.ownerDocument.createElement('canvas');canvas.width = image.naturalWidth;canvas.height = image.naturalHeight;
      canvas.getContext('2d').drawImage(image, 0, 0);return canvas.toDataURL('image/png');
    };
    return { type: challenge.type, image: raw(challenge.image), reference: raw(challenge.reference), radiusRatio: challenge.reference.offsetWidth / challenge.image.offsetWidth };
  }
  const task = { type: challenge.type, image: await captureElement(challenge.image, fetchImage, cache) };
  if (challenge.type === 'puzzle') {
    task.reference = await captureElement(challenge.reference, fetchImage, cache);
    const bg = challenge.image.getBoundingClientRect(), piece = challenge.reference.getBoundingClientRect();
    task.y = (piece.top - bg.top) / bg.height;
    if (task.y < 0 || task.y > 1 || piece.bottom > bg.bottom + 1) throw new Error('The TikTok puzzle piece is outside its background.');
  } else task.prompt = challenge.prompt;
  return task;
}

export async function captureTikTok(challenge, fetchImage, cache = new Map()) {
  const before = state(challenge);
  if (challenge.type === 'rotate-ring' && (Math.abs(before.ring.outer.angle) > .1 || Math.abs(before.ring.inner.angle) > .1 || Math.abs(before.ring.sliderRect.x - before.ring.trackRect.x) > .5)) throw new Error('The TikTok circle slider has already moved. Refresh the challenge or finish it manually.');
  if (challenge.type === 'puzzle' && Math.abs(before.pieceRect.x - before.imageRect.x) > .5) throw new Error('The TikTok puzzle piece has already moved. Refresh the challenge or finish it manually.');
  if (challenge.type === 'points' && marks(challenge.root).length) throw new Error('The TikTok challenge already has selections. Review them manually.');
  const task = await captureTask(challenge, fetchImage, cache);
  if (!sameState(before, state(challenge))) throw new Error('The TikTok challenge changed during capture.');
  const value = await fingerprint('tiktok\n' + JSON.stringify({ task, geometry: before }));
  captures.set(challenge, { before, task, fingerprint: value, fetchImage, cache });
  return { task, fingerprint: value };
}

function points(solution) {
  if (!Number.isFinite(solution.confidence) || solution.confidence < .85) throw new Error('The TikTok object pair could not be identified reliably.');
  if (!Array.isArray(solution.points) || solution.points.length !== 2 || solution.points.some(point => !Number.isFinite(point?.x) || !Number.isFinite(point?.y) || point.x <= 0 || point.x >= 1 || point.y <= 0 || point.y >= 1)) throw new Error('Exactly two valid TikTok object centers are required.');
  if (Math.hypot(solution.points[0].x - solution.points[1].x, solution.points[0].y - solution.points[1].y) < .065) throw new Error('The TikTok object centers overlap.');
  return solution.points;
}

function drag(challenge, solution) {
  if (!Number.isFinite(solution.confidence) || solution.confidence < .85 || !Number.isFinite(solution.normalizedX) || solution.normalizedX < 0 || solution.normalizedX > 1) throw new Error('The TikTok puzzle position is uncertain or invalid.');
  const bg = challenge.image.getBoundingClientRect(), piece = challenge.reference.getBoundingClientRect();
  const distance = solution.normalizedX * bg.width - (piece.left - bg.left);
  // Current SDK image dragging clamps to layoutWidth - 50. Account for any
  // positive CSS scale; the piece itself must also remain inside the image.
  const scale = bg.width / challenge.image.offsetWidth;
  const max = Math.min(bg.width - 50 * scale, bg.width - piece.width);
  if (distance <= 0 || distance > max || solution.normalizedX * bg.width + piece.width > bg.width + .5) throw new Error('The TikTok puzzle position is outside the drag range.');
  return { x: piece.x + piece.width / 2, y: piece.y + piece.height / 2, distance };
}

function ringDrag(challenge, solution) {
  if (!Number.isFinite(solution.confidence) || solution.confidence < .85 || !Number.isFinite(solution.clockwiseDegrees) || solution.clockwiseDegrees < 0 || solution.clockwiseDegrees >= 360) throw new Error('The TikTok circle alignment is uncertain or invalid.');
  const geometry = circleGeometry(challenge), span = geometry.trackRect.width - geometry.sliderRect.width;
  return { x: geometry.sliderRect.x + geometry.sliderRect.width / 2, y: geometry.sliderRect.y + geometry.sliderRect.height / 2, distance: solution.clockwiseDegrees / 360 * span, span };
}

export function previewTikTok(challenge, solution) {
  state(challenge);
  if (challenge.type === 'rotate-ring') return `TikTok circle alignment ready: move the slider ${Math.round(ringDrag(challenge, solution).distance)} pixels right. Releasing it requests verification.`;
  if (challenge.type === 'puzzle') return `TikTok puzzle position ready: drag the piece ${Math.round(drag(challenge, solution).distance)} pixels right. Releasing it requests verification.`;
  const selected = points(solution).map(point => `(${Math.round(point.x * 100)}%, ${Math.round(point.y * 100)}%)`);
  return `TikTok same-shape pair: ${selected.join(' and ')} from the image’s top-left. Select both, then Confirm.`;
}

export async function applyTikTok(challenge, solution, current) {
  const baseline = captures.get(challenge);
  if (!baseline) throw new Error('Capture the TikTok challenge before applying a result.');
  let ringProgress = 0;
  const guardRingProgress = () => {
    const ring = circleGeometry(challenge), span = ring.trackRect.width - ring.sliderRect.width;
    if (Math.abs(ring.inner.angle - 180 * ringProgress) > 1 || Math.abs(ring.outer.angle + 180 * ringProgress) > 1 || Math.abs(ring.sliderRect.x - baseline.before.ring.sliderRect.x - ringProgress * span) > 1) throw new Error('The TikTok circle movement changed or did not update.');
  };
  const guard = async (moving = false, selected = 0) => {
    if (!await current()) throw new Error('The TikTok action was stopped.');
    const failure = tiktokFailure(challenge.root.ownerDocument);
    if (failure) throw new Error(failure);
    if (!sameState(baseline.before, state(challenge), moving)) throw new Error('The TikTok challenge changed.');
    if (challenge.type === 'rotate-ring' && moving) guardRingProgress();
    const task = await captureTask(challenge, baseline.fetchImage, baseline.cache);
    if (JSON.stringify(task) !== JSON.stringify(baseline.task)) throw new Error('The TikTok image changed.');
    if (!await current()) throw new Error('The TikTok action was stopped.');
    if (!sameState(baseline.before, state(challenge), moving)) throw new Error('The TikTok challenge changed.');
    if (challenge.type === 'rotate-ring' && moving) guardRingProgress();
    if (challenge.type === 'points' && marks(challenge.root).length !== selected) throw new Error('The TikTok challenge already has selections or the selection state changed.');
  };
  await guard();
  if (challenge.type === 'puzzle' || challenge.type === 'rotate-ring') {
    const ring = challenge.type === 'rotate-ring';
    const { x, y, distance, span } = ring ? ringDrag(challenge, solution) : drag(challenge, solution);
    assertControl(challenge.handle, challenge.root);
    const hit = challenge.root.ownerDocument.elementFromPoint(x, y);
    if (ring ? !(hit === challenge.slider || challenge.slider.contains(hit)) : hit !== challenge.reference) throw new Error('The TikTok drag control is obscured.');
    const dataTransfer = new DataTransfer();
    const dispatch = (type, px) => challenge.handle.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: px, clientY: y, dataTransfer, view: window }));
    dispatch('dragstart', x);
    for (let i = 1; i <= 16; i++) {
      await guard(true);
      dispatch('drag', x + distance * i / 16);
      if (ring) ringProgress = distance * i / 16 / span;
      await new Promise(resolve => setTimeout(resolve, 16));
    }
    await guard(true);
    // The SDK submits in dragend, even for a cancelled/rejected drag. Do not
    // dispatch it in finally: Stop/refresh must never request verification.
    dispatch('dragend', x + distance);
  } else {
    const selected = points(solution);
    assertControl(challenge.image, challenge.root);
    if (challenge.image.closest('a,button,input')) throw new Error('Unsupported TikTok image control.');
    if (challenge.verify.form && challenge.verify.type === 'submit') throw new Error('Application submission controls are not supported.');
    for (let index = 0; index < selected.length; index++) {
      await guard(false, index);
      const rect = challenge.image.getBoundingClientRect(), point = selected[index];
      const clientX = rect.x + point.x * rect.width, clientY = rect.y + point.y * rect.height;
      if (challenge.root.ownerDocument.elementFromPoint(clientX, clientY) !== challenge.image) throw new Error('The TikTok object image is obscured at the predicted point.');
      challenge.image.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0 }));
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    await guard(false, selected.length);
    assertControl(challenge.verify, challenge.root);
    if (text(challenge.verify) !== 'Confirm') throw new Error('The TikTok Confirm control changed.');
    challenge.verify.click();
  }
  captures.delete(challenge);
}

// The pass-only branch in UI chunk 488 renders vendor module 1793's iRZ icon.
// Match its exact vector signature in the visible provider root, not a generic
// green icon, a dismissed dialog, or the fact that an action was dispatched.
export function tiktokVerified(doc = document) {
  return roots(doc).some(root => all(root, 'svg[viewBox="0 0 48 48"]').some(svg =>
    [...svg.querySelectorAll('path')].some(path => path.getAttribute('d') === passPath && path.getAttribute('fill')?.toLowerCase() === '#0be09b') &&
    Boolean(svg.querySelector('circle[cx="24"][cy="24"][r="22"][fill="#fff"]'))));
}

export function tiktokFailure(doc = document) {
  const errors = /^(?:Unable to verify\. Please try again\.|Couldn[’']t verify|Verification expired\. Please try again\.|Too many attempts\. Please try again later\.|Can[’']t complete verification\.)$/i;
  for (const root of roots(doc)) {
    if (all(root, '*').some(element => errors.test(text(element)))) return 'TikTok rejected verification or the challenge expired. No success was confirmed.';
  }
  return null;
}
