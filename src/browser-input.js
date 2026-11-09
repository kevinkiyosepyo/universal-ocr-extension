import { api } from './platform.js';

const debug = () => globalThis.chrome?.debugger;
const call = (method, ...args) => new Promise((resolve, reject) => {
  if (!debug()) return reject(new Error('Install the Chromium Browser Input build to use browser input.'));
  debug()[method](...args, result => { const error = chrome.runtime.lastError; error ? reject(new Error(error.message)) : resolve(result); });
});

// Only pointer events are exposed. No arbitrary CDP commands, JavaScript,
// cookies, network interception, or browser fingerprint changes are allowed.
export async function browserPointer(tabId, request, current) {
  const { x, y, distance = 0 } = request;
  if (![x, y, distance].every(Number.isFinite) || x < 0 || y < 0 || x > 10000 || y > 10000 || distance < 0 || distance > 1200) throw new Error('Invalid browser pointer coordinates.');
  if (!await api.permissions.contains({ permissions: ['debugger'] })) throw new Error('The Browser Input build and its debugger permission are required.');
  const target = { tabId };
  let pressed = false, released = false;
  await current();
  await call('attach', target, '1.3');
  const mouse = (type, px, down) => call('sendCommand', target, 'Input.dispatchMouseEvent', { type, x: px, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: down ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1 });
  try {
    await current();
    await mouse('mouseMoved', x, false);
    await mouse('mousePressed', x, true); pressed = true;
    if (distance) for (let i = 1; i <= 20; i++) {
      await current();
      await mouse('mouseMoved', x + distance * i / 20, true);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await current();
    await mouse('mouseReleased', x + distance, false); released = true;
  } finally {
    if (pressed && !released) {
      await mouse('mouseMoved', x, true).catch(() => {});
      await mouse('mouseReleased', x, false).catch(() => {});
    }
    await call('detach', target).catch(() => {});
  }
}
