import { api } from './platform.js';

if (!globalThis.__universalAutomation) {
  globalThis.__universalAutomation = true;
  const attempts = new Map();
  let busy = false, timer;
  const send = async (message) => { const response = await api.runtime.sendMessage(message); if (!response?.ok) throw new Error(response?.error || 'Extension unavailable.'); return response.value; };
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (element) => { const rect = element.getBoundingClientRect(); return rect.width > 1 && rect.height > 1 && getComputedStyle(element).visibility !== 'hidden'; };
  const get = (selector) => { try { return selector ? document.querySelector(selector) : null; } catch { throw new Error(`Invalid selector: ${selector}`); } };
  async function imageData(element) {
    if (!(element instanceof HTMLImageElement || element instanceof HTMLCanvasElement)) throw new Error('The image selector must point to an img or canvas element.');
    if (element instanceof HTMLImageElement) await element.decode();
    const width = element.naturalWidth || element.width, height = element.naturalHeight || element.height;
    if (!width || !height || width * height > 20_000_000) throw new Error('Image is empty or too large.');
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(element, 0, 0);
    try { return canvas.toDataURL('image/png'); } catch { throw new Error('This cross-origin image cannot be read directly. Use region capture, or serve the image with CORS enabled.'); }
  }
  async function digest(image) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(image)))].map((x) => x.toString(16).padStart(2, '0')).join(''); }
  function setText(field, text) {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) || field.disabled || field.readOnly || (field instanceof HTMLInputElement && !['text', 'search', 'tel', 'email', 'url'].includes(field.type))) throw new Error('The output selector must point to an editable text input or textarea.');
    const prototype = field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, text);
    field.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: text, inputType: 'insertText' }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function checkControl(target) {
    const control = target.closest('button,input,a,[role=button]');
    if (!control) return;
    const label = (control.getAttribute('aria-label') || control.textContent || control.value || '').trim();
    if ((control.form && control.type === 'submit') || /\b(submit|apply)\b|application/i.test(label)) throw new Error('Application submission is not supported.');
  }
  function pointEvent(target, type, x, y, down) {
    target.dispatchEvent(new PointerEvent(type.replace('mouse', 'pointer'), { bubbles: true, composed: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', buttons: down ? 1 : 0, button: 0 }));
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true, clientX: x, clientY: y, buttons: down ? 1 : 0, button: 0 }));
  }
  async function apply(rule, solution, image, onAction) {
    if (rule.type === 'ocr') { if (!solution.text?.trim()) throw new Error('No text recognized.'); const field = get(rule.inputSelector); if (!field) throw new Error('Text field is unavailable.'); onAction(); setText(field, solution.text); }
    if (rule.type === 'grid') {
      const tiles = [...document.querySelectorAll(rule.tileSelector)];
      if (tiles.length !== rule.rows * rule.columns) throw new Error('Tile count does not match the configured grid.');
      if (solution.selected.some((index) => !tiles[index] || !visible(tiles[index]))) throw new Error('A selected tile is unavailable.');
      onAction();
      for (const index of solution.selected) { if (!tiles[index] || !visible(tiles[index])) throw new Error('A selected tile disappeared.'); checkControl(tiles[index]); tiles[index].click(); await pause(90); }
    }
    if (rule.type === 'points') {
      const rect = image.getBoundingClientRect();
      for (const point of solution.points) {
        const x = rect.left + point.x * rect.width, y = rect.top + point.y * rect.height;
        const target = document.elementFromPoint(x, y);
        if (!target || !(target === image || image.contains(target))) throw new Error('The image is covered by another element.');
        checkControl(target); onAction(); pointEvent(target, 'mousedown', x, y, true); pointEvent(target, 'mouseup', x, y, false);
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y })); await pause(90);
      }
    }
    if (rule.type === 'slider') {
      const handle = get(rule.handleSelector); if (!handle || !visible(handle)) throw new Error('Slider handle is not visible.');
      const rect = handle.getBoundingClientRect(), background = image.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const piece = get(rule.referenceSelector)?.getBoundingClientRect();
      if (!piece) throw new Error('Piece disappeared.');
      const distance = solution.normalizedX * background.width - (piece.left - background.left);
      checkControl(handle); onAction(); pointEvent(handle, 'mousedown', x, y, true);
      for (let step = 1; step <= 24; step++) { pointEvent(handle, 'mousemove', x + distance * step / 24, y, true); await pause(16); }
      pointEvent(handle, 'mouseup', x + distance, y, false);
    }
    if (rule.autoSubmit && rule.submitSelector) { const button = get(rule.submitSelector); if (!button || !visible(button) || button.disabled) throw new Error('Verify control is unavailable.'); const label = (button.getAttribute('aria-label') || button.textContent || button.value || '').trim(); if ((button.form && button.type === 'submit') || !/^(verify|check)(\b|$)/i.test(label) || /application|apply|submit/i.test(label)) throw new Error('Only a challenge Verify or Check button may be clicked. Application submission is not supported.'); button.click(); }
  }
  async function tick() {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const rules = await send({ type: 'RULES_FOR_PAGE' });
      for (const rule of rules) {
        let state;
        try {
          state = attempts.get(rule.id);
          if (state?.captureError && Date.now() < state.next) continue;
          const image = get(rule.imageSelector);
          if (!image || !visible(image)) continue;
          const data = await imageData(image), fingerprint = await digest(data);
          state = attempts.get(rule.id);
          if (!state || state.fingerprint !== fingerprint) { state = { fingerprint, count: 0, applied: false, next: 0 }; attempts.set(rule.id, state); }
          if (state.applied || state.count >= rule.maxAttempts || Date.now() < state.next) continue;
          state.count++;
          const solution = await send({ type: 'AUTO_SOLVE', ruleId: rule.id, image: data, reference: rule.referenceSelector ? await imageData(get(rule.referenceSelector)) : undefined });
          if (!image.isConnected || await digest(await imageData(image)) !== fingerprint) { await send({ type: 'AUTO_REPORT', ruleId: rule.id, state: 'stale' }); continue; }
          if (solution.confidence < rule.minConfidence) { state.next = Date.now() + 2500; await send({ type: 'AUTO_REPORT', ruleId: rule.id, state: 'below-threshold', confidence: solution.confidence }); continue; }
          // Re-check the rule after long recognition so the stop switch takes effect before actions.
          const current = await send({ type: 'RULES_FOR_PAGE' });
          if (!current.some((entry) => entry.id === rule.id && JSON.stringify(entry) === JSON.stringify(rule))) continue;
          await apply(rule, solution, image, () => { state.actionStarted = true; }); state.applied = true;
          await send({ type: 'AUTO_REPORT', ruleId: rule.id, state: 'applied', confidence: solution.confidence });
          if (rule.successSelector) {
            for (let step = 0; step < 10; step++) { await pause(300); const success = get(rule.successSelector); if (success && visible(success)) { await send({ type: 'AUTO_REPORT', ruleId: rule.id, state: 'verified', confidence: solution.confidence }); break; } }
          }
        } catch (error) {
          if (state?.actionStarted) state.applied = true;
          if (state) state.next = Date.now() + Math.min(8000, 600 * 2 ** state.count);
          if (!state || !state.reported) { if (!state) { state = { count: rule.maxAttempts, next: Date.now() + 8000, fingerprint: null, captureError: true }; attempts.set(rule.id, state); } state.reported = true; await send({ type: 'AUTO_REPORT', ruleId: rule.id, state: 'failed', detail: error.message }).catch(() => {}); }
        }
      }
    } catch { /* Paused, removed, or no matching rule. */ }
    finally { busy = false; }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(tick, 350); };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'class', 'style'] });
  setInterval(tick, 1500); schedule();
}
