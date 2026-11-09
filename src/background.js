import { api, documentTarget } from './platform.js';
import { automationRoute, syncRules } from './automation-background.js';
import { proxyRoute } from './proxy.js';
import { challengeRoute } from './challenge-background.js';
const CAPTURE_PREFIX = 'capture:';
const CAPTURE_TTL = 10 * 60 * 1000;
const uiSender = (sender) => sender.id === api.runtime.id && sender.url?.startsWith(api.runtime.getURL(''));
const failMessage = (error) => error?.message || 'The action could not be completed.';

async function purgeExpired() {
  const values = await api.storage.session.get(null);
  const expired = Object.entries(values).filter(([key, value]) => key.startsWith(CAPTURE_PREFIX) && Date.now() - value.createdAt > CAPTURE_TTL).map(([key]) => key);
  if (expired.length) await api.storage.session.remove(expired);
}

async function openWorkspace(id = '', error = '') {
  const url = new URL(api.runtime.getURL('workspace.html'));
  if (id) url.hash = id;
  if (error) url.searchParams.set('error', error);
  return api.tabs.create({ url: url.href });
}

async function activeTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('Open a webpage first.');
  return tab;
}

async function capture(mode, suppliedTab) {
  await purgeExpired();
  const tab = suppliedTab ?? await activeTab();
  if (!/^(https?|file):/i.test(tab.url || '')) {
    throw new Error('Capture works on ordinary webpages. For browser pages or PDFs, upload or paste a screenshot in the workspace.');
  }
  let injection;
  try {
    [injection] = await api.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch {
    throw new Error('This page does not allow capture. Try an ordinary webpage, or upload a screenshot in the workspace.');
  }
  const viewport = await api.tabs.sendMessage(tab.id, { type: 'VIEWPORT' }, documentTarget(injection));
  const before = await api.tabs.get(tab.id);
  if (!before.active) throw new Error('Keep the source tab active while capturing.');
  const image = await api.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const after = await api.tabs.get(tab.id);
  if (!after.active || after.url !== before.url) throw new Error('The page changed during capture. Please try again.');
  if (image.length > 7_000_000) throw new Error('This capture is too large. Reduce the browser window size and retry.');
  const id = crypto.randomUUID();
  const record = {
    id, image, viewport, createdAt: Date.now(), state: mode === 'region' ? 'selecting' : 'ready',
    source: { tabId: tab.id, documentId: injection.documentId, documentNonce: viewport.documentNonce, frameId: injection.frameId || 0, windowId: tab.windowId, title: (tab.title || 'Page capture').slice(0, 200) },
  };
  const key = CAPTURE_PREFIX + id;
  try {
    const previous = await api.storage.session.get(null);
    const abandoned = Object.entries(previous).filter(([name, value]) => name.startsWith(CAPTURE_PREFIX) && value.state === 'selecting' && value.source.tabId === tab.id).map(([name]) => name);
    if (abandoned.length) await api.storage.session.remove(abandoned);
    await api.storage.session.set({ [key]: record });
    if (mode === 'region') {
      const response = await api.tabs.sendMessage(tab.id, { type: 'SELECT_REGION', id, image, viewport }, documentTarget(injection));
      if (!response?.ok) throw new Error(response?.error || 'The page resized. Capture again.');
    } else {
      await openWorkspace(id);
    }
  } catch (error) {
    await api.storage.session.remove(key);
    throw error;
  }
}

async function regionMessage(message, sender) {
  if (sender.id !== api.runtime.id || !sender.tab || typeof message.id !== 'string') throw new Error('Invalid capture request.');
  const key = CAPTURE_PREFIX + message.id;
  const record = (await api.storage.session.get(key))[key];
  if (!record || record.state !== 'selecting' || record.source.tabId !== sender.tab.id || record.source.documentId !== sender.documentId || record.source.documentNonce !== message.documentNonce) {
    throw new Error('This capture expired. Start a new selection.');
  }
  if (message.type === 'REGION_CANCEL') { await api.storage.session.remove(key); return; }
  if (Date.now() - record.createdAt > CAPTURE_TTL) { await api.storage.session.remove(key); throw new Error('This capture expired. Start a new selection.'); }
  const rect = message.rect;
  if (![rect?.x, rect?.y, rect?.width, rect?.height].every(Number.isFinite) || rect.width < 4 || rect.height < 4 || rect.x < 0 || rect.y < 0 ||
      rect.x + rect.width > record.viewport.width + 1 || rect.y + rect.height > record.viewport.height + 1) {
    throw new Error('Select a larger region inside the page.');
  }
  await api.storage.session.set({ [key]: { ...record, crop: rect, state: 'ready' } });
  await openWorkspace(message.id);
}

async function route(message, sender) {
  if (message?.type?.startsWith('CHALLENGE_')) return challengeRoute(message, sender, uiSender(sender));
  if (['REGION_DONE', 'REGION_CANCEL'].includes(message?.type)) return regionMessage(message, sender);
  if (['RULES_FOR_PAGE', 'AUTO_SOLVE', 'AUTO_REPORT', 'SAVE_RULE', 'DELETE_RULE', 'SET_AUTOMATION', 'SAVE_SERVICE', 'SERVICE_HEALTH', 'SOLVE_TASK', 'CANCEL_TASK', 'CLEAR_ACTIVITY', 'SCAN_PAGE'].includes(message?.type)) return automationRoute(message, sender, uiSender(sender));
  if (!uiSender(sender)) throw new Error('This action must be started from Universal OCR.');
  if (message.type?.startsWith('PROXY_')) return proxyRoute(message);
  switch (message.type) {
    case 'OPEN_VISUAL': {
      if (typeof message.image !== 'string' || !message.image.startsWith('data:image/') || message.image.length > 7_000_000) throw new Error('The image is too large for transfer. Save it and upload it in the workbench.');
      await api.storage.session.set({ visualInput: { image: message.image, createdAt: Date.now() } });
      return api.tabs.create({ url: api.runtime.getURL('control.html#visual') });
    }
    case 'OPEN_CONTROL': return api.tabs.create({ url: api.runtime.getURL('control.html') });
    case 'OPEN_WORKSPACE': return openWorkspace();
    case 'CAPTURE': return capture(message.mode === 'viewport' ? 'viewport' : 'region');
    case 'CLAIM_CAPTURE': {
      if (typeof message.id !== 'string') throw new Error('Invalid capture.');
      const key = CAPTURE_PREFIX + message.id;
      const record = (await api.storage.session.get(key))[key];
      if (!record || record.state !== 'ready' || Date.now() - record.createdAt > CAPTURE_TTL) {
        await api.storage.session.remove(key);
        throw new Error('This capture has expired or was already opened. Capture again, or choose an image.');
      }
      await api.storage.session.remove(key);
      return record;
    }
    case 'INSERT_TEXT': {
      if (!Number.isInteger(message.source?.tabId) || typeof message.source?.documentNonce !== 'string' || typeof message.text !== 'string' || !message.text.trim() || message.text.length > 100_000) {
        throw new Error('There is no text or source page to insert into.');
      }
      try {
        const tab = await api.tabs.get(message.source.tabId);
        const response = await api.tabs.sendMessage(tab.id, { type: 'CHOOSE_FIELD', text: message.text, documentNonce: message.source.documentNonce }, documentTarget(message.source));
        if (!response?.ok) throw new Error('Source unavailable.');
        await api.tabs.update(tab.id, { active: true });
        await api.windows.update(tab.windowId, { focused: true });
      } catch {
        throw new Error('The source page was closed or changed. Capture again, or copy the text.');
      }
      return;
    }
    default: throw new Error('Unknown action.');
  }
}

api.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target === 'engine') return;
  route(message, sender).then((value) => respond({ ok: true, value }), (error) => respond({ ok: false, error: failMessage(error) }));
  return true;
});

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.removeAll().then(() => {
    api.contextMenus.create({ id: 'ocr-region', title: 'Read text in a region…', contexts: ['page', 'image', 'video', 'selection', 'frame'] });
  }).catch(() => {});
  void syncRules().catch(() => {});
});
api.runtime.onStartup.addListener(() => { void syncRules().catch(() => {}); });
api.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'ocr-region') void capture('region', tab).catch((error) => openWorkspace('', failMessage(error)));
});
api.commands.onCommand.addListener((command) => {
  if (command === 'capture-region') void capture('region').catch((error) => openWorkspace('', failMessage(error)));
});
