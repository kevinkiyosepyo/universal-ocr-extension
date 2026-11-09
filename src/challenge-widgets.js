import { visible, captureElement, fingerprint, assertControl } from './challenge-dom.js';
import { hcaptchaPointsSnapshot } from './hcaptcha-points.js';

const all = (root, selector) => [...root.querySelectorAll(selector)].filter(visible);
const unique = (items, description) => {
  if (items.length > 1) throw new Error(`More than one ${description} is visible. Open one challenge at a time.`);
  return items[0];
};
export function widgetSnapshot(providers) {
  if (providers.includes('hcaptcha')) {
    const points = hcaptchaPointsSnapshot();
    if (points) return points;
  }
  if (providers.includes('captchafox')) {
    const root = unique(all(document, '.cf-slide'), 'CaptchaFox slider');
    if (root) {
      const handle = unique(all(root, '.cf-slider__button[role="slider"]'), 'slider handle'), image = unique(all(root, '.cf-slide__canvas'), 'object canvas');
      if (handle && image) return { type: 'points', provider: 'captchafox', name: 'CaptchaFox', root, image, handle, screen: true, strategy: 'horizontal-pair', prompt: 'This is a horizontal slider with two objects. Return exactly two points: the center of the left moving object, then the center of the stationary target to its right. If there are not exactly two distinguishable objects, return an empty list and confidence 0.' };
    }
  }
  if (providers.includes('tencent')) {
    const root = unique(all(document, '#tCaptchaDyMainWrap'), 'Tencent widget');
    if (root) {
      const image = unique(all(root, '.tencent-captcha-dy__verify-bg-img'), 'background'), reference = unique(all(root, '.tencent-captcha-dy__fg-item'), 'piece'), handle = unique(all(root, '.tencent-captcha-dy__slider-block'), 'slider handle');
      if (image && reference && handle) return { type: 'puzzle', provider: 'tencent', name: 'Tencent', root, image, reference, handle };
    }
  }
  if (providers.includes('geetest-v3')) {
    const root = unique(all(document, '.geetest_panel .geetest_slider, .geetest_holder.geetest_wind .geetest_slider'), 'Geetest v3 slider');
    if (root) {
      const image = unique(all(root, 'canvas.geetest_canvas_bg'), 'background'), reference = unique(all(root, 'canvas.geetest_canvas_slice'), 'piece'), handle = unique(all(root, '.geetest_slider_button'), 'slider handle');
      // The provider's canvases already contain its reconstructed image;
      // decoding the network sprite a second time would scramble it again.
      if (image && reference && handle) return { type: 'puzzle', provider: 'geetest-v3', name: 'Geetest v3', root, image, reference, handle };
    }
  }
  if (providers.includes('geetest-v4')) {
    const root = unique(all(document, '.geetest_box .geetest_slide'), 'Geetest slider');
    if (root) {
      const image = unique(all(root, '.geetest_bg'), 'background'), reference = unique(all(root, '.geetest_slice_bg'), 'piece'), handle = unique(all(root, '.geetest_btn'), 'slider handle');
      if (image && reference && handle) return { type: 'puzzle', provider: 'geetest-v4', name: 'Geetest v4', root, image, reference, handle };
    }
  }
  if (providers.includes('mtcaptcha')) {
    const root = unique(all(document, '.mtcap-main'), 'MTCaptcha widget');
    if (root) {
      const image = unique(all(root, '.mtcap-image'), 'text image'), input = unique(all(root, 'input.mtcap-inputtext'), 'answer field');
      if (image && input && !input.disabled && !input.readOnly) return { type: 'captcha-text', provider: 'mtcaptcha', name: 'MTCaptcha', root, image, input, autoChecks: true };
    }
  }
  if (providers.includes('text-captcha')) {
    const images = all(document, 'img[id*="captcha" i], img[src*="captcha" i], canvas[id*="captcha" i]').filter(element => !element.closest('.mtcap-main,.rc-imageselect-target,.geetest_panel,.geetest_box'));
    const image = unique(images, 'text CAPTCHA image');
    if (image) {
      const root = image.closest('form') || image.parentElement;
      const inputs = all(root, 'input[id*="captcha" i],input[name*="captcha" i],input[autocomplete="off"][aria-label*="captcha" i]').filter(input => ['text', 'search', 'tel', 'number'].includes(input.type) && !input.disabled && !input.readOnly);
      const input = unique(inputs, 'CAPTCHA answer field');
      if (input) return { type: 'captcha-text', provider: 'text-captcha', name: 'Text CAPTCHA', root, image, input, autoChecks: false };
    }
  }
  return null;
}

export function widgetVerified(providers) {
  if (providers.includes('tencent') && all(document, '#tCaptchaDyMainWrap .tencent-captcha-dy__verify-status-img--success').length) return true;
  for (const [provider, name] of [['prosopo', 'procaptcha-response'], ['captchafox', 'cf-captcha-response']]) {
    if (providers.includes(provider) && [...document.querySelectorAll(`input[name="${name}"],textarea[name="${name}"]`)].some(input => input.value.length > 0)) return true;
  }
  if (providers.some(id => id.startsWith('geetest-'))) {
    return Boolean(document.querySelector('.geetest_captcha.geetest_success, .geetest_holder.geetest_success, .geetest_holder.geetest_success_animate'));
  }
  return false;
}

export function widgetFailure(providers) {
  if (providers.includes('captchafox') && all(document, '.cf-challenge__status').some(el => /try again|incorrect|failed|error/i.test(el.innerText))) return 'CaptchaFox rejected verification. No success was confirmed.';
  if (providers.some(id => id.startsWith('geetest-'))) {
    const root = all(document, '.geetest_captcha, .geetest_holder').find(el => /captcha forbidden|network error|try again/i.test(el.innerText));
    if (root) return 'Geetest rejected verification or reported a network error. No success was confirmed.';
  }
  if (providers.includes('tencent') && all(document, '#tCaptchaDyMainWrap .tencent-captcha-dy__verify-error-tip').length) return 'Tencent rejected the puzzle position.';
  return null;
}

export function managedSnapshot(providers) {
  if (providers.includes('captchafox')) {
    const checkbox = unique(all(document, '.cf-checkbox-box[role="checkbox"]'), 'CaptchaFox checkbox');
    if (checkbox) return { provider: 'captchafox', name: 'CaptchaFox', root: checkbox.parentElement, control: checkbox };
  }
  if (providers.includes('prosopo')) {
    const host = unique(all(document, '.prosopo-checkbox'), 'Procaptcha widget');
    if (host?.shadowRoot) {
      const checkbox = unique(all(host.shadowRoot, 'input[type="checkbox"]'), 'Procaptcha checkbox');
      if (checkbox) return { provider: 'prosopo', name: 'Procaptcha', root: host.shadowRoot, control: checkbox };
    }
  }
  return null;
}
export async function startManaged(challenge, pointer) {
  assertControl(challenge.control, challenge.root);
  if (challenge.control.checked || challenge.control.getAttribute('aria-checked') === 'true') throw new Error('The widget is already processing. Wait for it to finish.');
  const rect = challenge.control.getBoundingClientRect();
  if (pointer) return pointer({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  const data = { bubbles: true, cancelable: true, composed: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true, view: window };
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) challenge.control.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, { ...data, buttons: type.endsWith('down') ? 1 : 0 }) : new MouseEvent(type, { ...data, buttons: type.endsWith('down') ? 1 : 0 }));
  challenge.control.click();
}

export async function captureWidget(challenge, fetchImage, cache, captureScreen) {
  const image = challenge.screen ? await captureScreen(challenge.image.getBoundingClientRect()) : await captureElement(challenge.image, fetchImage, cache);
  const task = { type: challenge.type, image };
  if (challenge.prompt) task.prompt = challenge.prompt;
  if (challenge.strategy) task.strategy = challenge.strategy;
  if (challenge.type === 'puzzle') {
    task.reference = await captureElement(challenge.reference, fetchImage, cache);
    const bg = challenge.image.getBoundingClientRect(), piece = challenge.reference.getBoundingClientRect();
    task.y = Math.max(0, (piece.top - bg.top) / bg.height);
  }
  return { task, fingerprint: await fingerprint(challenge.provider + '\n' + JSON.stringify(task)) };
}

export function puzzleDrag(challenge, solution) {
  const bg = challenge.image.getBoundingClientRect(), handle = challenge.handle.getBoundingClientRect();
  if (challenge.type === 'points' && challenge.provider === 'captchafox') {
    if (solution.points?.length !== 2 || solution.points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) || Math.abs(solution.points[0].y - solution.points[1].y) > .18) throw new Error('The two slider objects could not be located reliably.');
    const distance = (solution.points[1].x - solution.points[0].x) * bg.width;
    if (distance <= 0 || distance > bg.width - handle.width) throw new Error('The target is outside the slider range.');
    return { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2, distance };
  }
  const piece = challenge.reference.getBoundingClientRect();
  if (!Number.isFinite(solution.normalizedX) || solution.normalizedX < 0 || solution.normalizedX > 1) throw new Error('Invalid puzzle position.');
  const distance = solution.normalizedX * bg.width - (piece.left - bg.left);
  const x = handle.left + handle.width / 2, y = handle.top + handle.height / 2;
  const right = solution.pieceBounds ? (solution.pieceBounds.left + solution.pieceBounds.width) * bg.width / solution.backgroundWidth : piece.width;
  if (distance < 0 || distance > bg.width - right + 4) throw new Error('The piece position is outside the slider.');
  return { x, y, distance };
}

export async function applyPuzzle(challenge, solution, current, pointer) {
  assertControl(challenge.handle, challenge.root);
  const { x, y, distance } = puzzleDrag(challenge, solution);
  if (pointer) { if (!await current()) throw new Error('The puzzle drag was stopped.'); return pointer({ x, y, distance }); }
  const event = (target, type, px, down) => {
    const data = { bubbles: true, cancelable: true, clientX: px, clientY: y, button: 0, buttons: down ? 1 : 0, pointerId: 1, pointerType: 'mouse', isPrimary: true, view: window };
    target.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, data) : new MouseEvent(type, data));
  };
  const handle = challenge.handle;
  let released = false;
  try {
    event(handle, 'pointerdown', x, true); event(handle, 'mousedown', x, true);
    // One linear drag, not a synthetic human-behavior/fingerprint bypass.
    for (let i = 1; i <= 16; i++) {
      if (!await current() || !handle.isConnected || !challenge.image.isConnected) throw new Error('The puzzle drag was stopped.');
      const px = x + distance * i / 16;
      event(handle, 'pointermove', px, true); event(handle, 'mousemove', px, true);
      await new Promise(resolve => setTimeout(resolve, 16));
    }
    if (!await current()) throw new Error('The puzzle drag was stopped.');
    event(handle, 'pointerup', x + distance, false); event(handle, 'mouseup', x + distance, false); released = true;
  } finally {
    if (!released) {
      // Cancel at the starting position; never release a stopped drag over the
      // predicted answer, since mouseup can itself complete the CAPTCHA.
      event(handle, 'pointercancel', x, false); event(handle, 'mousemove', x, true); event(handle, 'mouseup', x, false);
    }
  }
}

export function textFeedback(challenge) {
  if (challenge.provider !== 'mtcaptcha') return null;
  const message = all(challenge.root, '.mtcap-msg').map(element => element.textContent.trim()).join(' ');
  if (/characters? missing|too short|please complete/i.test(message)) return 'short';
  if (/incorrect|invalid|wrong|try again/i.test(message)) return 'rejected';
  return null;
}
export function applyText(challenge, solution, previous) {
  assertControl(challenge.input, challenge.root);
  const text = solution.text;
  if (!text || typeof text !== 'string' || /\s/.test(text) || text.length > 128 || (challenge.input.maxLength > 0 && text.length > challenge.input.maxLength)) throw new Error('The recognized code does not fit the answer field.');
  // Respect existing answers. Never replace user input or submit the form.
  if (challenge.input.value && challenge.input.value !== text && challenge.input.value !== previous) throw new Error('The answer field already contains text. Review it manually.');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(challenge.input, text);
  challenge.input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  challenge.input.dispatchEvent(new Event('change', { bubbles: true }));
  if (challenge.autoChecks) {
    challenge.input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    challenge.input.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
  }
}
