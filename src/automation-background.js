import { api } from './platform.js';
import { validateRule, matchOrigin, PROVIDERS } from './providers.js';
import { SolverClient } from '../shared/client.js';
import { endpointURL, imageBase64 } from '../shared/protocol.js';
import { recognize } from './ocr.js';

let engineCreating, logQueue = Promise.resolve();
const inflight = new Map();
export const permissionPattern = (origin) => `${new URL(origin).protocol}//${new URL(origin).hostname}/*`;
export async function recordActivity(event) {
  const safe = { at: Date.now(), type: String(event.type || 'ocr').slice(0, 30), state: String(event.state || 'unknown').slice(0, 30), site: String(event.site || '').slice(0, 200), durationMs: Math.max(0, Number(event.durationMs) || 0), confidence: Number(event.confidence) || 0, detail: String(event.detail || '').slice(0, 160) };
  logQueue = logQueue.then(async () => {
    const { activity = [] } = await api.storage.local.get('activity');
    await api.storage.local.set({ activity: [safe, ...activity].slice(0, 200) });
  }).catch(() => {});
  return logQueue;
}

async function localOCR(image, settings, signal, id) {
  imageBase64(image);
  if (typeof document !== 'undefined') return recognize(image, settings, { signal });
  if (!engineCreating) {
    engineCreating = (async () => {
      const contexts = await api.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [api.runtime.getURL('engine.html')] });
      if (!contexts.length) await api.offscreen.createDocument({ url: 'engine.html', reasons: ['WORKERS'], justification: 'Run the locally bundled OCR worker for enabled site rules.' });
    })().finally(() => { engineCreating = null; });
  }
  await engineCreating;
  const cancel = () => { void api.runtime.sendMessage({ target: 'engine', type: 'CANCEL_OCR', id }).catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    if (signal?.aborted) throw signal.reason;
    const response = await new Promise((resolve, reject) => {
      const aborted = () => reject(signal.reason);
      signal?.addEventListener('abort', aborted, { once: true });
      api.runtime.sendMessage({ target: 'engine', type: 'LOCAL_OCR', id, image, settings }).then(resolve, reject).finally(() => signal?.removeEventListener('abort', aborted));
    });
    if (!response?.ok) throw new Error(response?.error || 'Local OCR failed.');
    return response.value;
  } finally { signal?.removeEventListener('abort', cancel); }
}

let registrationQueue = Promise.resolve();
export function syncRules() { registrationQueue = registrationQueue.catch(() => {}).then(registerRules); return registrationQueue; }
async function registerRules() {
  const { rules = [], automationEnabled = false } = await api.storage.local.get(['rules', 'automationEnabled']);
  const registered = await api.scripting.getRegisteredContentScripts();
  const ours = registered.filter((script) => script.id.startsWith('ocr-rule-')).map((script) => script.id);
  if (ours.length) await api.scripting.unregisterContentScripts({ ids: ours });
  if (!automationEnabled) return;
  const patterns = [...new Set(rules.filter((rule) => rule.enabled).map((rule) => permissionPattern(rule.origin)))];
  for (let i = 0; i < patterns.length; i++) {
    if (await api.permissions.contains({ origins: [patterns[i]] })) await api.scripting.registerContentScripts([{ id: `ocr-rule-${i}`, matches: [patterns[i]], allFrames: true, js: ['automation.js'], runAt: 'document_idle', persistAcrossSessions: true }]);
  }
}

export async function automationRoute(message, sender, isUI) {
  const state = await api.storage.local.get(['rules', 'automationEnabled', 'service']);
  const rules = state.rules || [];
  if (message.type === 'RULES_FOR_PAGE') {
    if (!sender.tab || sender.id !== api.runtime.id || !state.automationEnabled) return [];
    return rules.filter((rule) => rule.enabled && matchOrigin(sender.url, rule.origin));
  }
  if (message.type === 'AUTO_SOLVE' || message.type === 'AUTO_REPORT') {
    const rule = rules.find((entry) => entry.id === message.ruleId && entry.enabled && matchOrigin(sender.url, entry.origin));
    if (!sender.tab || sender.id !== api.runtime.id || !state.automationEnabled || !rule) throw new Error('Automation is not enabled for this page.');
    if (message.type === 'AUTO_REPORT') {
      if (!['applied', 'verified', 'stale', 'below-threshold', 'failed'].includes(message.state)) throw new Error('Invalid activity state.');
      await recordActivity({ type: rule.type, state: message.state, site: new URL(rule.origin).hostname, detail: message.detail, confidence: message.confidence }); return;
    }
    const id = `${sender.tab.id}:${sender.frameId}:${rule.id}`;
    if (inflight.has(id)) throw new Error('This rule already has a running task.');
    const controller = new AbortController(); inflight.set(id, controller);
    const start = Date.now();
    try {
      let result;
      if (rule.type === 'ocr') {
        const local = await localOCR(message.image, rule.settings, controller.signal, id);
        result = { text: local.text, confidence: local.confidence / 100 };
      } else {
        if (!state.service?.key) throw new Error('Connect your local solver in Settings to use visual rules.');
        result = await new SolverClient(state.service).solve({ type: rule.type, image: message.image, reference: message.reference, prompt: rule.prompt, rows: rule.rows, columns: rule.columns }, { signal: controller.signal });
      }
      await recordActivity({ type: rule.type, state: 'recognized', site: new URL(rule.origin).hostname, confidence: result.confidence, durationMs: Date.now() - start });
      return result;
    } catch (error) {
      await recordActivity({ type: rule.type, state: 'failed', site: new URL(rule.origin).hostname, detail: error.code || 'RECOGNITION_FAILED', durationMs: Date.now() - start }); throw error;
    } finally { inflight.delete(id); }
  }
  if (!isUI) throw new Error('Open the extension to change settings.');
  switch (message.type) {
    case 'SAVE_RULE': {
      const rule = validateRule(message.rule);
      if (rule.enabled && !await api.permissions.contains({ origins: [permissionPattern(rule.origin)] })) throw new Error('Grant access to this site before enabling the rule.');
      await api.storage.local.set({ rules: [...rules.filter((item) => item.id !== rule.id), rule] }); await syncRules(); return rule;
    }
    case 'DELETE_RULE': await api.storage.local.set({ rules: rules.filter((item) => item.id !== message.id) }); await syncRules(); return;
    case 'SET_AUTOMATION':
      await api.storage.local.set({ automationEnabled: message.enabled === true });
      if (!message.enabled) for (const [id, controller] of inflight) if (/^\d+:\d+:/.test(id)) controller.abort(new Error('Automation stopped.'));
      await syncRules(); return;
    case 'SAVE_SERVICE': {
      const endpoint = endpointURL(message.endpoint).href;
      if (typeof message.key !== 'string' || (message.key && message.key.length < 24)) throw new Error('The service key must be at least 24 characters.');
      const service = { endpoint, key: message.key.slice(0, 500) };
      await api.storage.local.set({ service }); return;
    }
    case 'SERVICE_HEALTH': return new SolverClient(state.service).request('health', { signal: AbortSignal.timeout(6000), retries: 0 });
    case 'SOLVE_TASK': {
      const id = message.id || crypto.randomUUID();
      if (inflight.has(id)) throw new Error('This task is already running.');
      const controller = new AbortController(); inflight.set(id, controller); const start = Date.now();
      try {
        let result;
        if (message.task.type === 'ocr') { const value = await localOCR(message.task.image, message.task.settings, controller.signal, id); result = { text: value.text, confidence: value.confidence / 100 }; }
        else { if (!state.service?.key) throw new Error('Connect a local solver in Settings first.'); result = await new SolverClient(state.service).solve(message.task, { signal: controller.signal }); }
        await recordActivity({ type: message.task.type, state: 'recognized', confidence: result.confidence, durationMs: Date.now() - start }); return result;
      } catch (error) { await recordActivity({ type: message.task.type, state: 'failed', detail: error.code || 'FAILED', durationMs: Date.now() - start }); throw error; }
      finally { inflight.delete(id); }
    }
    case 'CANCEL_TASK': inflight.get(message.id)?.abort(new Error('Task cancelled.')); return;
    case 'CLEAR_ACTIVITY': await api.storage.local.set({ activity: [] }); return;
    case 'SCAN_PAGE': {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('Open a webpage first.');
      const inspect = (catalog) => catalog.flatMap((provider) => {
        const matches = provider.selectors.filter((selector) => document.querySelector(selector));
        return matches.length ? [{ id: provider.id, name: provider.name, mode: provider.mode, selectors: matches, origin: location.origin, status: 'detected' }] : [];
      });
      let results;
      try { results = await api.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: inspect, args: [PROVIDERS] }); }
      catch { results = await api.scripting.executeScript({ target: { tabId: tab.id }, func: inspect, args: [PROVIDERS] }); }
      return results.flatMap((result) => result.result || []);
    }
    default: throw new Error('Unknown automation action.');
  }
}

api.tabs.onRemoved.addListener((tabId) => { for (const [id, controller] of inflight) if (id.startsWith(`${tabId}:`)) controller.abort(new Error('Page closed.')); });
api.permissions.onRemoved.addListener(() => { void syncRules().catch(() => {}); });
