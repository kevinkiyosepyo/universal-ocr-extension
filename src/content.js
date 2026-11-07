import { api } from './platform.js';
import { selectionRect } from './geometry.js';

// The script is injected only after an extension action. Reuse its listener on repeated captures.
if (!globalThis.__universalOCRInstalled) {
  globalThis.__universalOCRInstalled = true;
  const documentNonce = crypto.randomUUID();
  let dispose = () => {};

  function surface() {
    dispose();
    const host = document.createElement('div');
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      *{box-sizing:border-box} .tip{position:fixed;top:20px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:18px;background:#132f30;color:#fff;padding:13px 18px;border-radius:12px;font:14px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;box-shadow:0 6px 32px #0003;pointer-events:auto;max-width:calc(100vw - 30px)}
      button{font:inherit;background:#ffffff20;border:1px solid #ffffff40;color:#fff;border-radius:6px;padding:4px 9px;cursor:pointer}
      .screen{position:fixed;inset:0;pointer-events:auto;cursor:crosshair;touch-action:none;user-select:none;overflow:hidden;background:#fff}
      .screen img{width:100%;height:100%;display:block;pointer-events:none} .box{position:fixed;border:2px solid #27d4b0;background:transparent;box-shadow:0 0 0 99999px #001f2460;pointer-events:none}
      .outline{position:fixed;border:3px solid #00a383;border-radius:4px;background:#00a38312;pointer-events:none}
    `;
    root.append(style); document.documentElement.append(host);
    const controller = new AbortController();
    const cleanup = () => { controller.abort(); root.replaceChildren(); host.remove(); };
    dispose = cleanup;
    return { root, cleanup, signal: controller.signal };
  }

  function tip(root, text, close) {
    const bar = document.createElement('div'); bar.className = 'tip'; bar.setAttribute('role', 'status');
    const label = document.createElement('span'); label.textContent = text;
    const button = document.createElement('button'); button.textContent = 'Cancel'; button.addEventListener('click', close);
    bar.append(label, button); root.append(bar);
    return { bar, label, button };
  }

  function toast(text) {
    const { root, cleanup } = surface();
    const ui = tip(root, text, cleanup); ui.button.textContent = 'Close';
    setTimeout(cleanup, 5000);
  }

  function selectRegion({ id, image, viewport }) {
    if (innerWidth !== viewport.width || innerHeight !== viewport.height) return { ok: false, error: 'The window resized during capture. Try again.' };
    const { root, cleanup, signal } = surface();
    let completed = false;
    const cancel = () => {
      if (completed) return;
      completed = true; cleanup();
      void api.runtime.sendMessage({ type: 'REGION_CANCEL', id, documentNonce }).catch(() => {});
    };
    dispose = cancel;
    const screen = document.createElement('div'); screen.className = 'screen';
    const snapshot = document.createElement('img'); snapshot.src = image; snapshot.draggable = false; snapshot.alt = '';
    const box = document.createElement('div'); box.className = 'box'; box.hidden = true;
    screen.append(snapshot, box); root.append(screen);
    const ui = tip(root, 'Drag around the text. Press Esc to cancel.', cancel);
    let start;
    const rectAt = (event) => selectionRect(start, { x: event.clientX, y: event.clientY }, viewport);
    screen.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault(); start = { x: event.clientX, y: event.clientY };
      screen.setPointerCapture(event.pointerId); box.hidden = false;
      Object.assign(box.style, { left: `${start.x}px`, top: `${start.y}px`, width: '0px', height: '0px' });
    }, { signal });
    screen.addEventListener('pointermove', (event) => {
      if (!start) return;
      const rect = rectAt(event);
      Object.assign(box.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    }, { signal });
    screen.addEventListener('pointerup', async (event) => {
      if (!start || completed) return;
      const rect = rectAt(event); start = null;
      if (rect.width < 4 || rect.height < 4) { ui.label.textContent = 'Drag a larger box around the text.'; return; }
      completed = true; cleanup();
      try {
        const response = await api.runtime.sendMessage({ type: 'REGION_DONE', id, rect, documentNonce });
        if (!response?.ok) toast(response?.error || 'Capture failed. Please try again.');
      } catch { toast('Capture failed. Reopen Universal OCR and retry.'); }
    }, { signal });
    screen.addEventListener('wheel', (event) => event.preventDefault(), { passive: false, signal });
    window.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); } }, { capture: true, signal });
    window.addEventListener('resize', cancel, { once: true, signal });
    window.addEventListener('pagehide', cancel, { once: true, signal });
    return { ok: true };
  }

  function editable(target) {
    const element = target instanceof Element ? target.closest('input, textarea, [contenteditable="true"], [contenteditable=""]') : null;
    if (!element || element.disabled || element.readOnly || element.getAttribute('aria-disabled') === 'true' || element.getAttribute('aria-readonly') === 'true') return null;
    if (element instanceof HTMLInputElement && !['text', 'search', 'email', 'url', 'tel', 'number'].includes(element.type)) return null;
    return element;
  }

  function chooseField(text) {
    const { root, cleanup, signal } = surface();
    const outline = document.createElement('div'); outline.className = 'outline'; outline.hidden = true; root.append(outline);
    const ui = tip(root, 'Click a text field to insert the result. Esc cancels.', cleanup);
    document.addEventListener('pointermove', (event) => {
      const field = editable(event.composedPath()[0]); outline.hidden = !field;
      if (!field) return;
      const rect = field.getBoundingClientRect();
      Object.assign(outline.style, { top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    }, { capture: true, signal });
    document.addEventListener('click', (event) => {
      const field = editable(event.composedPath()[0]);
      if (!field) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const value = field instanceof HTMLInputElement ? text.replace(/\r?\n/g, ' ') : text;
      if (field instanceof HTMLInputElement && field.type === 'number' && !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) {
        ui.label.textContent = 'This field accepts numbers. Choose another field or edit the result.'; return;
      }
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        const prototype = field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, value);
      } else { field.textContent = value; }
      field.focus();
      field.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: value }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      cleanup(); toast('Text inserted.');
    }, { capture: true, signal });
    window.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cleanup(); } }, { capture: true, signal });
    return { ok: true };
  }

  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== api.runtime.id) return;
    if (message.type === 'VIEWPORT') {
      dispose();
      requestAnimationFrame(() => requestAnimationFrame(() => respond({ width: innerWidth, height: innerHeight, documentNonce })));
      return true;
    }
    if (message.type === 'SELECT_REGION') respond(selectRegion(message));
    if (message.type === 'CHOOSE_FIELD') respond(message.documentNonce === documentNonce ? chooseField(message.text) : { ok: false, error: 'The source document changed.' });
  });
}
