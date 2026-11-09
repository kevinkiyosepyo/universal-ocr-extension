import { api } from './platform.js';
import { snapshot, captureGrid, selected, clickTile, verifyChallenge, verifiedWidget, rejectedWidget } from './challenge-dom.js';
import { gridChanges } from './challenge-common.js';

if (globalThis.__universalChallenge) {
  void globalThis.__universalChallenge();
} else {
  const nonce = crypto.randomUUID();
  let session, busy = false, timer, stopped = true, generation = 0, hud, status;
  let lastFingerprint, lastActionAt = 0, lastVerified, lastStable, stableAt = 0, staleCount = 0;
  const cache = new Map();
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const send = async (type, payload = {}) => {
    const response = await api.runtime.sendMessage({ type, nonce, sessionId: session?.id, ...payload });
    if (!response?.ok) throw new Error(response?.error || 'The extension is unavailable.');
    return response.value;
  };
  function show(value) {
    if (window !== window.top) return;
    if (!hud) {
      hud = document.createElement('div'); hud.id = 'universal-ocr-assistance';
      const shadow = hud.attachShadow({ mode: 'closed' });
      const style = document.createElement('style'); style.textContent = ':host{all:initial;position:fixed;bottom:16px;right:16px;z-index:2147483647}section{font:14px/1.4 system-ui;color:#163d31;background:#f3faf5;border:1px solid #98b8a9;border-radius:12px;padding:14px;box-shadow:0 3px 20px #0002;max-width:300px}p{margin:6px 0 12px}button{font:inherit;cursor:pointer;border:1px solid #7a9d8d;border-radius:6px;padding:6px 12px;background:white;color:#163d31}';
      const box = document.createElement('section'), title = document.createElement('strong'); title.textContent = 'Challenge assistance';
      status = document.createElement('p'); status.setAttribute('role', 'status');
      const stop = document.createElement('button'); stop.textContent = 'Stop'; stop.addEventListener('click', () => { void send('CHALLENGE_STOP').catch(() => {}); stopped = true; generation++; status.textContent = 'Stopped.'; });
      const close = document.createElement('button'); close.textContent = 'Dismiss'; close.style.marginLeft = '8px'; close.addEventListener('click', () => { void send('CHALLENGE_STOP').catch(() => {}); stopped = true; generation++; hud.remove(); hud = null; });
      box.append(title, status, stop, close);
      const sheet = new CSSStyleSheet(); sheet.replaceSync(style.textContent); shadow.adoptedStyleSheets = [sheet];
      shadow.append(box); document.documentElement.append(hud);
    }
    status.textContent = value.detail || value.state;
  }
  async function report(state, detail) { const value = await send('CHALLENGE_REPORT', { state, detail }); show(value); return value; }
  async function current(expected) {
    if (stopped || generation !== expected || document.hidden) return false;
    const value = await send('CHALLENGE_POLL');
    if (stopped || generation !== expected || document.hidden) return false;
    session = value; return session.active;
  }
  async function tick() {
    if (stopped || busy || document.hidden) return;
    busy = true; const expected = generation;
    try {
      if (!await current(expected)) return;
      if (verifiedWidget()) { await report('widget-verified', 'The widget reports verification complete. This is not an application receipt.'); stopped = true; return; }
      const challenge = snapshot();
      if (!challenge) return;
      const captured = await captureGrid(challenge, url => send('CHALLENGE_FETCH', { url }), cache);
      if (!await current(expected)) return;
      if (lastStable !== captured.fingerprint) { lastStable = captured.fingerprint; stableAt = Date.now(); return; }
      if (Date.now() - stableAt < 650) return;
      if (lastVerified === captured.fingerprint) {
        if (rejectedWidget()) throw new Error('The provider did not accept this selection. Complete the challenge manually.');
        if (Date.now() - lastActionAt > 12_000) throw new Error('Verification was not confirmed. The application outcome is unchanged.');
        return;
      }
      if (lastFingerprint === captured.fingerprint) {
        if (challenge.dynamic && Date.now() - lastActionAt > 10_000) throw new Error('Selected images did not refresh. Complete the challenge manually.');
        return;
      }
      await report('recognizing', `Reading the ${challenge.rows} × ${challenge.columns} ${challenge.provider === 'hcaptcha' ? 'hCaptcha' : 'reCAPTCHA'} grid…`);
      const solution = await send('CHALLENGE_SOLVE', { task: { type: 'grid', image: captured.image, rows: challenge.rows, columns: challenge.columns, layout: challenge.layout, prompt: challenge.prompt } });
      if (!await current(expected)) return;
      const latest = snapshot();
      if (!latest || (await captureGrid(latest, url => send('CHALLENGE_FETCH', { url }), cache)).fingerprint !== captured.fingerprint) { if (++staleCount >= 4) throw new Error('The challenge keeps changing. Wait for it to settle and start again.'); return; }
      staleCount = 0;
      if (solution.confidence < .75) throw new Error('Recognition is uncertain. Complete this challenge manually.');
      const changes = gridChanges(solution.selected, latest.tiles.map(selected), latest.tiles.length);
      await report('selecting', `Selecting ${solution.selected.length} matching ${solution.selected.length === 1 ? 'square' : 'squares'}…`);
      for (const index of changes) {
        if (!await current(expected)) return;
        if (!latest.root.isConnected || !latest.tiles[index].isConnected) throw new Error('The challenge changed while selecting.');
        // For replacement grids, never toggle an already selected tile off.
        if (latest.dynamic && selected(latest.tiles[index])) continue;
        clickTile(latest.tiles[index], latest.root); await pause(90);
      }
      lastFingerprint = captured.fingerprint; lastActionAt = Date.now();
      if (latest.dynamic && solution.selected.length) { await report('waiting-images', 'Waiting for replacement images…'); return; }
      // Static grids must reflect the requested selection before Verify.
      if (!latest.dynamic && gridChanges(solution.selected, latest.tiles.map(selected), latest.tiles.length).length) throw new Error('The widget did not accept automatic clicks. Select the images manually.');
      if (session.autoVerify) {
        if (!await current(expected)) return;
        await report('verifying', 'Waiting for the provider to verify the challenge…');
        verifyChallenge(latest); lastVerified = captured.fingerprint;
      } else {
        await report('review', 'Selections ready. Review the grid, then press its Verify or Next button.');
        // Keep observing: manual Verify may display the next challenge round.
      }
    } catch (error) {
      if (!stopped && generation === expected) { await report('failed', error.message).catch(() => {}); stopped = true; show({ detail: error.message }); }
    } finally { busy = false; }
  }
  async function start() {
    clearInterval(timer); generation++; stopped = false; lastFingerprint = lastVerified = lastStable = null; lastActionAt = stableAt = staleCount = 0; cache.clear();
    try { session = await send('CHALLENGE_HELLO'); show(session); timer = setInterval(tick, 400); void tick(); }
    catch { stopped = true; }
  }
  api.runtime.onMessage.addListener(message => { if (message.type === 'CHALLENGE_STATUS') { if (session?.id === message.session.id) { show(message.session); if (!message.session.active) { stopped = true; generation++; clearInterval(timer); } } } });
  window.addEventListener('pagehide', () => { stopped = true; generation++; clearInterval(timer); });
  globalThis.__universalChallenge = start; void start();
}
