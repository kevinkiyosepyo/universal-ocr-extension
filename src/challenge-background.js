import { api } from './platform.js';
import { SolverClient } from '../shared/client.js';
import { validateTask, imageBase64 } from '../shared/protocol.js';
import { recordActivity } from './automation-background.js';
import { CHALLENGE_ORIGINS, providerURL, imageURL } from './challenge-common.js';

const prefix = 'challenge-session:';
const running = new Map();
let mutations = Promise.resolve();
let navigationListening = false;
const locked = (callback) => { const task = mutations.catch(() => {}).then(callback); mutations = task; return task; };
const read = async (tabId) => (await api.storage.session.get(prefix + tabId))[prefix + tabId];
async function save(session) { await api.storage.session.set({ [prefix + session.tabId]: session }); }
async function notify(session) {
  await api.tabs.sendMessage(session.tabId, { type: 'CHALLENGE_STATUS', session: publicSession(session) }, { frameId: 0 }).catch(() => {});
}
const publicSession = (session) => {
  if (!session) return;
  const expired = session.active && session.expiresAt <= Date.now();
  return { id: session.id, tabId: session.tabId, active: session.active && !expired, state: expired ? 'expired' : session.state, detail: expired ? 'Session expired. Start again to continue.' : session.detail, autoVerify: session.autoVerify, startedAt: session.startedAt, expiresAt: session.expiresAt, rounds: session.rounds };
};
async function stop(tabId, detail = 'Stopped.') {
  const session = await read(tabId);
  if (!session) return;
  session.active = false; session.state = 'stopped'; session.detail = detail;
  for (const [id, controller] of running) if (id.startsWith(session.id + ':')) controller.abort(new Error(detail));
  await save(session); await notify(session);
  return publicSession(session);
}
async function check(message, sender, hello = false) {
  if (!sender.tab || sender.id !== api.runtime.id) throw new Error('Start assistance from the extension.');
  const session = await read(sender.tab.id);
  if (!session?.active || session.expiresAt < Date.now()) throw new Error('Assistance is stopped or expired.');
  const tab = await api.tabs.get(sender.tab.id);
  if (tab.url !== session.url) throw new Error('The source page changed. Start a new session.');
  const origin = new URL(sender.url).origin;
  if (origin !== session.origin && !providerURL(sender.url)) throw new Error('This frame is not part of the supported challenge.');
  if (typeof message.nonce !== 'string' || !/^[a-f0-9-]{36}$/.test(message.nonce)) throw new Error('Invalid document identity.');
  if (!hello) {
    const bound = session.frames[sender.frameId];
    if (message.sessionId !== session.id || bound?.nonce !== message.nonce || bound?.documentId !== sender.documentId) throw new Error('The challenge document changed.');
  }
  return session;
}
async function inject(session) {
  const frames = await api.webNavigation.getAllFrames({ tabId: session.tabId });
  for (const frame of frames || []) {
    if (frame.frameId !== 0 && !providerURL(frame.url)) continue;
    await api.scripting.executeScript({ target: { tabId: session.tabId, frameIds: [frame.frameId] }, files: ['challenge-content.js'] }).catch(() => {});
  }
}
async function register() {
  if (!navigationListening) {
    api.webNavigation.onCommitted.addListener(details => { if (details.frameId === 0) void locked(() => stop(details.tabId, 'The page navigated. Start a new session on the new page.')); });
    navigationListening = true;
  }
  const ids = (await api.scripting.getRegisteredContentScripts()).filter(item => item.id === 'ocr-challenge-frames').map(item => item.id);
  if (ids.length) await api.scripting.unregisterContentScripts({ ids });
  const matches = [];
  for (const origin of CHALLENGE_ORIGINS) if (await api.permissions.contains({ origins: [origin] })) matches.push(origin);
  if (matches.length) await api.scripting.registerContentScripts([{ id: 'ocr-challenge-frames', matches, allFrames: true, js: ['challenge-content.js'], runAt: 'document_idle', persistAcrossSessions: false }]);
}

export async function challengeRoute(message, sender, isUI) {
  if (isUI) {
    if (message.type === 'CHALLENGE_GET') return publicSession(await read(message.tabId));
    if (message.type === 'CHALLENGE_STOP') return locked(() => stop(message.tabId));
    if (message.type === 'CHALLENGE_START') {
      const tab = await api.tabs.get(message.tabId);
      if (!tab.active || !/^https?:/.test(tab.url)) throw new Error('Open the page containing the challenge first.');
      if (message.sourceURL !== tab.url) throw new Error('The page changed. Reopen the extension and start again.');
      if (!await api.permissions.contains({ permissions: ['webNavigation'], origins: CHALLENGE_ORIGINS })) throw new Error('Grant challenge-frame access first.');
      const { service } = await api.storage.local.get('service');
      if (!service?.key) throw new Error('Connect the local recognition service in Settings first.');
      const health = await new SolverClient(service).request('health', { retries: 0, signal: AbortSignal.timeout(6000) });
      if (!health.vision.available && !health.detector?.available) throw new Error('Start the local recognition models before assisting a challenge.');
      return locked(async () => {
        await stop(tab.id, 'Replaced by a new session.');
        const session = { id: crypto.randomUUID(), tabId: tab.id, url: tab.url, origin: new URL(tab.url).origin, active: true, state: 'waiting', detail: 'Waiting for a visible image challenge.', startedAt: Date.now(), expiresAt: Date.now() + 180_000, autoVerify: message.autoVerify === true, frames: {}, rounds: 0 };
        await save(session); await register(); await inject(session); return publicSession(session);
      });
    }
    throw new Error('Unknown challenge action.');
  }
  if (message.type === 'CHALLENGE_HELLO') return locked(async () => {
    const session = await check(message, sender, true);
    session.frames[sender.frameId] = { nonce: message.nonce, documentId: sender.documentId };
    await save(session); return publicSession(session);
  });
  const session = await check(message, sender);
  if (message.type === 'CHALLENGE_POLL') return publicSession(session);
  if (message.type === 'CHALLENGE_STOP') return locked(() => stop(sender.tab.id));
  if (message.type === 'CHALLENGE_FETCH') {
    if (typeof message.url !== 'string' || !imageURL(message.url, session.origin)) throw new Error('The image is outside the permitted challenge hosts.');
    const response = await fetch(message.url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10_000), cache: 'no-store' });
    if (!response.ok || !/^image\/(png|jpeg|webp|gif|bmp)(;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('The challenge image could not be downloaded.');
    const reader = response.body.getReader(); let length = 0; const chunks = [];
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 4_000_000) throw new Error('Challenge image exceeds 4 MB.'); chunks.push(value); } }
    finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    await check(message, sender);
    return `data:${response.headers.get('content-type').split(';')[0]};base64,${btoa(binary)}`;
  }
  if (message.type === 'CHALLENGE_REPORT') {
    if (!['recognizing', 'selecting', 'waiting-images', 'review', 'verifying', 'widget-verified', 'unsupported', 'failed'].includes(message.state)) throw new Error('Invalid challenge state.');
    return locked(async () => {
      const current = await check(message, sender);
      current.state = message.state; current.detail = String(message.detail || '').slice(0, 180);
      if (['widget-verified', 'unsupported', 'failed'].includes(message.state)) current.active = false;
      await save(current); await notify(current);
      if (['review', 'widget-verified', 'unsupported', 'failed'].includes(message.state)) await recordActivity({ type: 'challenge', state: message.state, site: new URL(current.url).hostname, detail: current.detail });
      return publicSession(current);
    });
  }
  if (message.type === 'CHALLENGE_SOLVE') {
    const task = validateTask(message.task);
    if (task.type !== 'grid') throw new Error('This adapter supports image grids.');
    imageBase64(task.image);
    const id = `${session.id}:${sender.frameId}`;
    if (running.has(id)) throw new Error('This challenge already has a running task.');
    await locked(async () => { const current = await check(message, sender); if (current.rounds >= 12) throw new Error('The challenge reached its round limit. Complete it manually.'); current.rounds++; await save(current); });
    const controller = new AbortController(); running.set(id, controller); const started = Date.now();
    try {
      const { service } = await api.storage.local.get('service');
      const result = await new SolverClient(service).solve(task, { signal: controller.signal, timeout: 60_000 });
      await check(message, sender);
      await recordActivity({ type: 'challenge', state: 'recognized', site: new URL(session.url).hostname, durationMs: Date.now() - started, confidence: result.confidence });
      return result;
    } finally { running.delete(id); }
  }
  throw new Error('Unknown challenge action.');
}

api.tabs.onRemoved.addListener(tabId => { void locked(async () => { await stop(tabId); await api.storage.session.remove(prefix + tabId); }); });
api.tabs.onUpdated.addListener((tabId, change) => { if (change.url) void locked(() => stop(tabId, 'The page navigated. Start a new session on the new page.')); });
