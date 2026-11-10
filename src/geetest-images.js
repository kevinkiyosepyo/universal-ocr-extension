import { visible, captureElement, loadImage, fingerprint, assertControl } from './challenge-dom.js';

// DOM contracts observed on GeeTest's official v4 icon-popup-en.html and
// nine-popup-en.html demos. Nine mode verifies on the final requested click.
const all = (root, selector) => [...root.querySelectorAll(selector)].filter(visible);
const text = node => node?.innerText?.trim().replace(/\s+/g, ' ') || '';
const one = (items, label) => { if (items.length > 1) throw new Error(`More than one Geetest ${label} is visible.`);return items[0]; };
const captures = new WeakMap();
const source = node => node instanceof HTMLImageElement ? node.currentSrc || node.src : getComputedStyle(node).backgroundImage;
const rect = node => { const { x, y, width, height } = node.getBoundingClientRect();return { x, y, width, height }; };
const marks = challenge => [...challenge.image.querySelectorAll('.geetest_square_mark')];
const selected = tile => Boolean(tile.querySelector('.geetest_item_ghost.geetest_selected'));

export function geetestImagesSnapshot(doc = document) {
  const candidates = all(doc, '.geetest_box').filter(root => all(root, '.geetest_click, .geetest_nine').length);
  const root = one(candidates, 'image widget');if (!root) return null;
  const header = one(all(root, '.geetest_header .geetest_text_tips'), 'instruction');
  const references = all(root, '.geetest_header .geetest_ques_tips img');
  if (!header || !references.length || references.some(image => !image.complete || !image.naturalWidth)) return null;
  const instruction = text(header), scene = one(all(root, '.geetest_click .geetest_bg'), 'icon scene');
  if (scene) {
    if (!/^Select in this order[.!]?$/i.test(instruction) || references.length < 1 || references.length > 5) throw new Error('This Geetest icon instruction is unsupported.');
    const verify = one(all(root, '.geetest_click .geetest_submit'), 'OK control');
    if (!verify || text(verify) !== 'OK' || !getComputedStyle(scene).backgroundImage.startsWith('url(')) return null;
    return { provider: 'geetest-v4', name: 'Geetest ordered icons', mode: 'geetest-images', variant: 'ordered-icons', type: 'points', root, image: scene, header, references, verify, instruction, expectedCount: references.length };
  }
  const window = one(all(root, '.geetest_nine .geetest_window'), 'image grid');if (!window) return null;
  const match = instruction.match(/^Select ([1-9]) images? with$/i);
  if (!match || references.length !== 1) throw new Error('This Geetest image-grid instruction is unsupported.');
  const tiles = all(window, '.geetest_item');
  if (tiles.length !== 9 || tiles.some((tile, index) => !tile.classList.contains('geetest_' + index))) throw new Error('This Geetest grid is not the inspected 3 × 3 layout.');
  const images = tiles.map(tile => one(all(tile, '.geetest_item_img'), 'tile image'));
  if (images.some(image => !image || !getComputedStyle(image).backgroundImage.startsWith('url('))) return null;
  return { provider: 'geetest-v4', name: 'Geetest image grid', mode: 'geetest-images', variant: 'nine-grid', type: 'points', root, image: window, header, references, tiles, images, instruction, expectedCount: Number(match[1]), autoChecks: true };
}

function geometry(challenge) {
  const fresh = geetestImagesSnapshot(challenge.root.ownerDocument);
  if (!fresh || fresh.root !== challenge.root || fresh.image !== challenge.image || fresh.verify !== challenge.verify || fresh.instruction !== challenge.instruction || fresh.variant !== challenge.variant || fresh.references.length !== challenge.references.length || fresh.references.some((node, index) => node !== challenge.references[index]) || fresh.tiles?.some((node, index) => node !== challenge.tiles[index])) throw new Error('The Geetest image challenge changed.');
  const nodes = challenge.variant === 'nine-grid' ? challenge.tiles : [challenge.image];
  return { variant: challenge.variant, instruction: challenge.instruction, boxes: nodes.map(rect), references: challenge.references.map(node => ({ source: source(node), box: rect(node) })),
    images: (challenge.images || [challenge.image]).map(node => ({ source: source(node), size: getComputedStyle(node).backgroundSize, position: getComputedStyle(node).backgroundPosition })),
    verify: challenge.verify && rect(challenge.verify) };
}
const sameGeometry = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function sharedGrid(challenge, fetchImage, cache) {
  const sources = challenge.images.map(image => source(image));
  if (new Set(sources).size !== 1) throw new Error('This Geetest grid does not use the supported shared image sheet.');
  for (let index = 0; index < 9; index++) {
    const style = getComputedStyle(challenge.images[index]), position = style.backgroundPosition.split(/\s+/).map(parseFloat);
    if (style.backgroundSize !== '300% auto' || style.backgroundRepeat !== 'repeat' || position[0] !== -(index % 3) * 100 || position[1] !== -Math.floor(index / 3) * 100) throw new Error('This Geetest image-sheet layout is unsupported.');
  }
  // The SDK repeats a 3×3 sheet at negative percentage positions. Capture its
  // full immutable pixels instead of treating negative positions as a crop.
  const url = sources[0].match(/^url\(["']?(.*?)["']?\)$/)?.[1];
  if (!url) throw new Error('The Geetest grid image is unavailable.');
  if (!cache.has(url)) {
    cache.set(url, await loadImage(url.startsWith('blob:') || url.startsWith('data:image/') ? url : await fetchImage(url)));
    if (cache.size > 24) cache.delete(cache.keys().next().value);
  }
  const image = cache.get(url), tile = challenge.images[0];
  if (image.width > 1200 || image.height > 1200 || Math.abs(image.width / image.height - tile.offsetWidth / tile.offsetHeight) > .04) throw new Error('The Geetest grid image geometry is unsupported.');
  return image;
}

async function compose(challenge, fetchImage, cache) {
  const scene = challenge.variant === 'nine-grid' ? await sharedGrid(challenge, fetchImage, cache) : await loadImage(await captureElement(challenge.image, fetchImage, cache));
  const references = await Promise.all(challenge.references.map(async image => loadImage(await captureElement(image, fetchImage, cache))));
  const width = 600, headerHeight = 120, sceneHeight = Math.round(scene.height / scene.width * width);
  if (sceneHeight < 180 || sceneHeight > 1000) throw new Error('The Geetest scene aspect ratio is unsupported.');
  const canvas = document.createElement('canvas');canvas.width = width;canvas.height = headerHeight + sceneHeight;
  const context = canvas.getContext('2d');context.fillStyle = '#fff';context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#111';context.font = 'bold 16px sans-serif';context.textAlign = 'center';
  for (let i = 0; i < references.length; i++) {
    const image = references[i], center = (i + .5) * width / references.length, scale = Math.min(72 / image.width, 72 / image.height);
    context.fillText(challenge.variant === 'nine-grid' ? 'REFERENCE OBJECT' : String(i + 1), center, 20);
    context.drawImage(image, center - image.width * scale / 2, 28, image.width * scale, image.height * scale);
  }
  context.drawImage(scene, 0, headerHeight, width, sceneHeight);
  const prompt = challenge.variant === 'nine-grid'
    ? `The TOP band shows the reference object. Below it is a 3 by 3 grid of photographs. Select exactly ${challenge.expectedCount} grid cells containing that object category. Return exactly ${challenge.expectedCount} points at the CENTERS OF THOSE GRID CELLS in the BOTTOM grid. Never return a point in the reference band. If ambiguous, return no points and confidence 0.`
    : `The TOP band shows ${challenge.expectedCount} numbered reference icons, in order from left to right. In the BOTTOM scene find the corresponding objects, allowing different colors and rotations. Return exactly ${challenge.expectedCount} center points in reference order, one for each target in the BOTTOM scene. Never click a reference icon in the top band. If ambiguous, return no points and confidence 0.`;
  return { task: { type: 'points', image: canvas.toDataURL('image/png'), prompt }, mapping: { headerHeight, sceneHeight, width, height: canvas.height } };
}

export async function captureGeetestImages(challenge, fetchImage, cache = new Map()) {
  const before = geometry(challenge);
  if (challenge.variant === 'nine-grid' ? challenge.tiles.some(selected) : marks(challenge).length) throw new Error('The Geetest image challenge already has selections. Review them manually.');
  const composed = await compose(challenge, fetchImage, cache);
  if (!sameGeometry(before, geometry(challenge))) throw new Error('The Geetest challenge changed during capture.');
  const value = await fingerprint(JSON.stringify({ task: composed.task, geometry: before }));
  captures.set(challenge, { ...composed, before, fetchImage, cache });
  return { task: composed.task, fingerprint: value };
}

function selections(challenge, solution) {
  const baseline = captures.get(challenge);if (!baseline) throw new Error('Capture the Geetest challenge before applying a result.');
  if (!Number.isFinite(solution.confidence) || solution.confidence < .85) throw new Error('The Geetest image prediction is uncertain.');
  if (!Array.isArray(solution.points) || solution.points.length !== challenge.expectedCount) throw new Error(`Exactly ${challenge.expectedCount} Geetest targets are required.`);
  const { height, headerHeight, sceneHeight } = baseline.mapping;
  const points = solution.points.map(point => {
    const x = point?.x, y = (point?.y * height - headerHeight) / sceneHeight;
    if (![x, y].every(value => Number.isFinite(value) && value > 0 && value < 1)) throw new Error('A Geetest prediction is outside the target scene.');
    return { x, y };
  });
  if (challenge.variant === 'nine-grid') {
    const cells = points.map(point => {
      const col = Math.floor(point.x * 3), row = Math.floor(point.y * 3);
      if (Math.abs(point.x - (col + .5) / 3) > .14 || Math.abs(point.y - (row + .5) / 3) > .14) throw new Error('A Geetest grid prediction is too close to a cell boundary.');
      return row * 3 + col;
    });
    if (new Set(cells).size !== cells.length) throw new Error('The Geetest prediction repeats a grid cell.');
    return { points, cells };
  }
  if (points.some((point, index) => points.slice(0, index).some(other => Math.hypot(point.x - other.x, point.y - other.y) < .05))) throw new Error('The Geetest predicted icon centers overlap.');
  return { points };
}

export function previewGeetestImages(challenge, solution) {
  const targets = selections(challenge, solution);
  return targets.cells ? `Select Geetest grid cells ${targets.cells.map(index => index + 1).join(', ')} (1–9, row by row). The last click requests verification.`
    : `Click Geetest icons in order: ${targets.points.map(point => `(${Math.round(point.x * 100)}%,${Math.round(point.y * 100)}%)`).join(', ')} from the image’s top-left, then OK.`;
}

export async function applyGeetestImages(challenge, solution, current) {
  const targets = selections(challenge, solution), baseline = captures.get(challenge), applied = [];
  const guard = async () => {
    if (!await current()) throw new Error('Geetest image selection was stopped.');
    if (!sameGeometry(baseline.before, geometry(challenge))) throw new Error('The Geetest image challenge changed.');
    if (JSON.stringify((await compose(challenge, baseline.fetchImage, baseline.cache)).task) !== JSON.stringify(baseline.task)) throw new Error('The Geetest image pixels changed.');
    if (!await current()) throw new Error('Geetest image selection was stopped.');
    if (!sameGeometry(baseline.before, geometry(challenge))) throw new Error('The Geetest image challenge changed.');
    if (challenge.variant === 'nine-grid') {
      if (challenge.tiles.some((tile, index) => selected(tile) !== applied.includes(index))) throw new Error('The Geetest grid selection state changed.');
    } else {
      const box = challenge.image.getBoundingClientRect(), observed = marks(challenge);
      if (observed.length !== applied.length || observed.some((mark, index) => {
        const point = targets.points[index];
        return mark.parentElement !== challenge.image || text(mark.querySelector('.geetest_mark_no')) !== String(index + 1)
          || !/^-?[\d.]+%$/.test(mark.style.left) || !/^-?[\d.]+%$/.test(mark.style.top)
          || Math.abs(parseFloat(mark.style.left) / 100 - point.x) * box.width > 3
          || Math.abs(parseFloat(mark.style.top) / 100 - point.y) * box.height > 3;
      })) throw new Error('The Geetest icon selection state changed.');
    }
  };
  await guard();
  for (let index = 0; index < targets.points.length; index++) {
    await guard();
    const tileIndex = targets.cells?.[index], control = targets.cells ? challenge.tiles[tileIndex] : challenge.image;
    assertControl(control, challenge.root);
    const box = control.getBoundingClientRect(), point = targets.cells ? { x: .5, y: .5 } : targets.points[index];
    const clientX = box.x + point.x * box.width, clientY = box.y + point.y * box.height;
    const hit = control.ownerDocument.elementFromPoint(clientX, clientY);
    if (targets.cells ? !(hit === control || control.contains(hit)) : hit !== control) throw new Error('The Geetest target is obscured or outside the visible page.');
    const data = { bubbles: true, cancelable: true, composed: true, clientX, clientY, screenX: window.screenX + clientX, screenY: window.screenY + clientY, button: 0, detail: 1, view: window };
    // The official widget tracks mouse movement as part of its click sequence.
    for (const type of ['mousemove', 'mousedown', 'mouseup', 'click']) control.dispatchEvent(new MouseEvent(type, { ...data, buttons: type === 'mousedown' ? 1 : 0 }));
    applied.push(targets.cells ? tileIndex : index);
    // Official icon mode ignores rapid subsequent selections; 550 ms spacing
    // was observed to preserve every marker, with no need to retry a click.
    if (index < targets.points.length - 1 || challenge.verify) await new Promise(resolve => setTimeout(resolve, 550));
  }
  if (challenge.verify) {
    await guard();assertControl(challenge.verify, challenge.root);
    if (!challenge.verify.matches('.geetest_click .geetest_submit') || challenge.verify.classList.contains('geetest_disable') || text(challenge.verify) !== 'OK') throw new Error('Geetest has not enabled its OK control.');
    const box = challenge.verify.getBoundingClientRect(), hit = challenge.verify.ownerDocument.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    if (!(hit === challenge.verify || challenge.verify.contains(hit))) throw new Error('The Geetest OK control is obscured.');
    challenge.verify.click();
  }
  captures.delete(challenge);
}
