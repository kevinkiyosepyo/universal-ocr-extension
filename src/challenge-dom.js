import { gridShape } from './challenge-common.js';

export const visible = (element) => {
  if (!element?.isConnected) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 2 || rect.height <= 2) return false;
  for (let node = element; node instanceof Element; node = node.parentElement || node.getRootNode().host) {
    const style = getComputedStyle(node);
    if (style.visibility === 'hidden' || style.visibility === 'collapse' || style.display === 'none' || Number(style.opacity) === 0) return false;
  }
  return true;
};
const first = (selector) => [...document.querySelectorAll(selector)].find(visible);
export function snapshot() {
  const recaptcha = first('.rc-imageselect-target');
  if (recaptcha) {
    const bounds = recaptcha.getBoundingClientRect();
    const tables = [...recaptcha.querySelectorAll('table')].filter(table => {
      if (!visible(table)) return false;
      const rect = table.getBoundingClientRect();
      return rect.left >= bounds.left - 5 && rect.right <= bounds.right + 5 && rect.top >= bounds.top - 5 && rect.bottom <= bounds.bottom + 5;
    });
    // During round transitions Google keeps two sliding tables in the DOM.
    // Neither partial table is a stable challenge to analyze or click.
    if (tables.length !== 1) return null;
    const tiles = [...tables[0].querySelectorAll('td')].filter(tile => visible(tile) && tile.querySelector('img,canvas'));
    if (!tiles.length) return null;
    const shape = gridShape(tiles);
    const description = first('.rc-imageselect-desc-wrapper');
    const prompt = description?.innerText?.trim();
    if (!prompt) throw new Error('The challenge instruction is unavailable.');
    return { provider: 'recaptcha-v2', ...shape, prompt, dynamic: /once there are none left|keep selecting|new images/i.test(prompt), layout: shape.rows === 4 ? 'scene' : 'tiles', verify: document.querySelector('#recaptcha-verify-button'), root: recaptcha };
  }
  const hcaptcha = first('.challenge-container .task-grid, .challenge-view .task-grid, .task-grid');
  if (hcaptcha) {
    const tiles = [...hcaptcha.querySelectorAll('.task-image')].filter(visible);
    if (!tiles.length) return null;
    const prompt = first('.prompt-text, .challenge-container .prompt, .challenge-view .prompt')?.innerText?.trim();
    if (!prompt) throw new Error('The challenge instruction is unavailable.');
    return { provider: 'hcaptcha', ...gridShape(tiles), prompt, dynamic: false, layout: 'tiles', verify: first('.button-submit'), root: hcaptcha };
  }
  // Canvas modes are identified by the point adapter's instruction check.
  // A canvas can mount before its footer; wait for a complete widget.
  return null;
}
export function verifiedWidget(providers) {
  return (providers.includes('recaptcha-v2') && Boolean(document.querySelector('#recaptcha-anchor[aria-checked="true"]'))) ||
    (providers.includes('hcaptcha') && Boolean(document.querySelector('#checkbox[aria-checked="true"]'))) ||
    (providers.includes('mtcaptcha') && [...document.querySelectorAll('input.mtcaptcha-verifiedtoken')].some(input => input.value.length > 0));
}
export function rejectedWidget() {
  return Boolean(first('.rc-imageselect-incorrect-response, .rc-imageselect-error-select-more, .rc-imageselect-error-dynamic-more'));
}
export function selected(tile) {
  return tile.matches('.rc-imageselect-tileselected, .rc-imageselect-dynamic-selected, .selected, [aria-pressed="true"], [aria-checked="true"]') || Boolean(tile.querySelector('[aria-pressed="true"], [aria-checked="true"]'));
}
export function assertControl(element, root) {
  if (!visible(element) || element.disabled || (root && !root.contains(element))) throw new Error('The challenge control is unavailable.');
  const control = element.closest('button,input,a,[role=button]');
  if (control?.form && control.type === 'submit') throw new Error('Application submission controls are not supported.');
  if (/\b(application|apply|submit application)\b/i.test(control?.getAttribute('aria-label') || control?.textContent || '')) throw new Error('Application submission controls are not supported.');
}
export function clickTile(tile, root) { assertControl(tile, root); tile.click(); }
export function verifyChallenge(challenge) {
  assertControl(challenge.verify);
  // These exact controls live inside a recognized provider document. Never use
  // a generic Submit selector or call application callbacks / token setters.
  if (!challenge.verify.matches('#recaptcha-verify-button, .button-submit')) throw new Error('Unsupported challenge Verify control.');
  challenge.verify.click();
}
function descriptor(tile) {
  const rect = tile.getBoundingClientRect();
  let element = tile.querySelector('img, canvas');
  if (!element) element = [tile, ...tile.querySelectorAll('*')].find(node => getComputedStyle(node).backgroundImage.startsWith('url('));
  if (!element) throw new Error('The challenge image has an unsupported rendering format.');
  const style = getComputedStyle(element), imageRect = element.getBoundingClientRect();
  const src = element instanceof HTMLImageElement ? element.currentSrc || element.src : style.backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
  return { element, src, width: rect.width, height: rect.height, left: imageRect.left - rect.left, top: imageRect.top - rect.top, imageWidth: imageRect.width, imageHeight: imageRect.height, backgroundSize: style.backgroundSize, backgroundPosition: style.backgroundPosition };
}
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image(), timer = setTimeout(() => { image.src = ''; reject(new Error('The challenge image timed out.')); }, 10_000);
    image.onload = () => { clearTimeout(timer); if (image.naturalWidth * image.naturalHeight > 20_000_000) reject(new Error('The challenge image is too large.')); else resolve(image); }; image.onerror = () => { clearTimeout(timer); reject(new Error('The challenge image could not be decoded.')); }; image.src = src;
  });
}
export async function fingerprint(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// Preserve layout pixels so a shrinking CSS transform does not discard texture.
// Normalized matching coordinates map back to rendered bounds during input.
function imageLayout(element, style) {
  for (let node = element; node instanceof Element; node = node.parentElement || node.getRootNode().host) {
    const transform = getComputedStyle(node);
    if (transform.transform !== 'none') {
      const matrix = new DOMMatrixReadOnly(transform.transform);
      if (!matrix.is2D || Math.abs(matrix.b) > 1e-7 || Math.abs(matrix.c) > 1e-7 || matrix.a <= 0 || matrix.d <= 0) throw new Error('Rotated, skewed, or reflected challenge images are unsupported.');
    }
    if (transform.perspective !== 'none' || (transform.rotate && transform.rotate !== 'none' && transform.rotate !== '0deg')) throw new Error('Rotated or perspective challenge images are unsupported.');
    if (transform.scale && transform.scale !== 'none' && transform.scale.split(/\s+/).some(value => !Number.isFinite(Number(value)) || Number(value) <= 0)) throw new Error('Reflected challenge images are unsupported.');
  }
  const dimension = (axis, edges) => {
    const value = parseFloat(style[axis]);
    return value + (style.boxSizing === 'border-box' ? 0 : edges.reduce((sum, edge) => sum + parseFloat(style['padding' + edge]) + parseFloat(style['border' + edge + 'Width']), 0));
  };
  const width = dimension('width', ['Left', 'Right']), height = dimension('height', ['Top', 'Bottom']);
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error('The challenge image layout could not be measured.');
  return { width, height };
}

// Capture the image layout box, including CSS sprites. Keep alpha
// for puzzle masks and use untransformed CSS pixels for both images.
export async function captureElement(element, fetchImage, cache = new Map()) {
  if (!visible(element)) throw new Error('The challenge image is not visible.');
  const style = getComputedStyle(element), layout = imageLayout(element, style);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(layout.width); canvas.height = Math.round(layout.height);
  if (canvas.width > 1200 || canvas.height > 1200) throw new Error('The challenge image exceeds 1200 pixels per side.');
  const context = canvas.getContext('2d');
  if (element instanceof HTMLCanvasElement) context.drawImage(element, 0, 0, canvas.width, canvas.height);
  else {
    const src = element instanceof HTMLImageElement ? element.currentSrc || element.src : style.backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
    if (!src) throw new Error('The challenge image has not loaded.');
    if (!cache.has(src)) {
      const data = src.startsWith('data:image/') || src.startsWith('blob:') ? src : await fetchImage(src);
      cache.set(src, await loadImage(data));
      if (cache.size > 16) cache.delete(cache.keys().next().value);
    }
    const image = cache.get(src);
    if (element instanceof HTMLImageElement) {
      if (!element.complete || !element.naturalWidth) throw new Error('The challenge image is still loading.');
      if (!['fill', 'contain', 'cover'].includes(style.objectFit)) throw new Error('Unsupported challenge image sizing.');
      if (style.objectFit === 'fill') context.drawImage(image, 0, 0, canvas.width, canvas.height);
      else {
        const scale = Math[style.objectFit === 'cover' ? 'max' : 'min'](canvas.width / image.width, canvas.height / image.height);
        const w = image.width * scale, h = image.height * scale;
        if (style.objectPosition !== '50% 50%') throw new Error('Unsupported challenge image alignment.');
        context.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      }
    } else {
      const box = backgroundGeometry({ imageWidth: layout.width, imageHeight: layout.height, left: 0, top: 0, backgroundSize: style.backgroundSize, backgroundPosition: style.backgroundPosition }, image);
      context.scale(canvas.width / layout.width, canvas.height / layout.height);
      context.drawImage(image, box.x, box.y, box.width, box.height);
    }
  }
  return canvas.toDataURL('image/png');
}
function backgroundGeometry(item, image) {
  let width = image.width, height = image.height;
  const boxWidth = item.imageWidth, boxHeight = item.imageHeight;
  const size = item.backgroundSize.split(' ');
  if (['cover', 'contain'].includes(size[0])) {
    const ratio = Math[size[0] === 'cover' ? 'max' : 'min'](boxWidth / width, boxHeight / height); width *= ratio; height *= ratio;
  } else {
    const length = (value, box, natural) => value?.endsWith('%') ? parseFloat(value) * box / 100 : value?.endsWith('px') ? parseFloat(value) : natural;
    const oldWidth = width, oldHeight = height;
    width = length(size[0], boxWidth, width); height = length(size[1], boxHeight, height);
    if (size.length === 1 || size[1] === 'auto') height = oldHeight * width / oldWidth;
    if (size[0] === 'auto' && size[1] && size[1] !== 'auto') width = oldWidth * height / oldHeight;
  }
  const pos = item.backgroundPosition.split(' ');
  const offset = (value, space) => value?.endsWith('%') ? parseFloat(value) * space / 100 : value?.endsWith('px') ? parseFloat(value) : 0;
  return { x: item.left + offset(pos[0], boxWidth - width), y: item.top + offset(pos[1], boxHeight - height), width, height };
}
export async function captureGrid(challenge, fetchImage, cache = new Map()) {
  const descriptors = challenge.tiles.map(descriptor);
  const urls = [...new Set(descriptors.map(item => item.src).filter(Boolean))];
  for (const src of cache.keys()) if (!urls.includes(src)) cache.delete(src);
  await Promise.all(urls.map(async src => {
    if (!cache.has(src)) {
      const data = src.startsWith('data:image/') || src.startsWith('blob:') ? src : await fetchImage(src);
      cache.set(src, await loadImage(data));
    }
  }));
  // Preserve the visible crop of sprite images, including replacement tiles.
  // Fixed cells prevent scaled selection borders from changing model geometry.
  const cell = 128, canvas = document.createElement('canvas'); canvas.width = cell * challenge.columns; canvas.height = cell * challenge.rows;
  const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < descriptors.length; index++) {
    const item = descriptors[index], source = item.element instanceof HTMLCanvasElement ? item.element : cache.get(item.src);
    if (!source) throw new Error('The challenge image has not loaded.');
    const box = item.element instanceof HTMLImageElement || item.element instanceof HTMLCanvasElement ? { x: item.left, y: item.top, width: item.imageWidth, height: item.imageHeight } : backgroundGeometry(item, source);
    context.save(); context.translate((index % challenge.columns) * cell, Math.floor(index / challenge.columns) * cell);
    context.beginPath(); context.rect(0, 0, cell, cell); context.clip();
    if (challenge.provider === 'recaptcha-v2' && item.element instanceof HTMLImageElement) {
      if (item.element.matches('.rc-image-tile-33, .rc-image-tile-44')) {
        const width = source.width / challenge.columns, height = source.height / challenge.rows;
        context.drawImage(source, index % challenge.columns * width, Math.floor(index / challenge.columns) * height, width, height, 0, 0, cell, cell);
      } else context.drawImage(source, 0, 0, cell, cell);
    } else context.drawImage(source, box.x * cell / item.width, box.y * cell / item.height, box.width * cell / item.width, box.height * cell / item.height);
    context.restore();
  }
  const image = canvas.toDataURL('image/png');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(challenge.prompt + '\n' + image));
  const fingerprint = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return { image, fingerprint };
}
