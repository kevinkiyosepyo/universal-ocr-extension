import { api } from './platform.js';
import { snapshot, captureGrid, captureElement, fingerprint, selected, clickTile, verifyChallenge, verifiedWidget, rejectedWidget } from './challenge-dom.js';
import { gridChanges } from './challenge-common.js';
import { widgetSnapshot, captureWidget, applyText, applyPuzzle, puzzleDrag, widgetVerified, widgetFailure, managedSnapshot, startManaged, textFeedback } from './challenge-widgets.js';
import { capturePointHeader, resolvePointInstruction, pointSelection, applyPointSelection, pointSceneMatches } from './hcaptcha-points.js';
import { captureTikTok, applyTikTok, previewTikTok } from './tiktok-widget.js';

if (globalThis.__universalChallenge) {
  void globalThis.__universalChallenge();
} else {
  const nonce = crypto.randomUUID();
  let session, busy = false, timer, stopped = true, generation = 0, hud, status;
  let lastFingerprint, lastActionAt = 0, lastVerified, lastStable, stableAt = 0, staleCount = 0, managed, textAttempt, widgetPendingAt = 0;
  let successSeen = false, successObserver;
  let pointAttempt;
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
      const stop = document.createElement('button'); stop.textContent = 'Stop'; stop.addEventListener('click', () => { void send('CHALLENGE_STOP').catch(() => {}); stopped = true; generation++; resetSuccessObserver(); status.textContent = 'Stopped.'; });
      const close = document.createElement('button'); close.textContent = 'Dismiss'; close.style.marginLeft = '8px'; close.addEventListener('click', () => { void send('CHALLENGE_STOP').catch(() => {}); stopped = true; generation++; resetSuccessObserver(); hud.remove(); hud = null; });
      box.append(title, status, stop, close);
      const sheet = new CSSStyleSheet(); sheet.replaceSync(style.textContent); shadow.adoptedStyleSheets = [sheet];
      shadow.append(box); document.documentElement.append(hud);
    }
    status.textContent = (value.detail || value.state) + (value.preview ? '\n' + value.preview : '');
  }
  async function report(state, detail, preview) { const value = await send('CHALLENGE_REPORT', { state, detail, preview }); show(value); return value; }
  function resetSuccessObserver() {
    successObserver?.disconnect(); successObserver = undefined; successSeen = false;
  }
  function observeProviderSuccess() {
    const observed = session.providers.filter(provider => ['tencent', 'tiktok'].includes(provider));
    if (!observed.length) return;
    const expected = generation, id = session.id;
    // Provider dialogs can remove their success marker before the next poll.
    // Latch only an observed marker from this active session; no DOM writes or
    // reporting occur in this callback, so HUD changes cannot cause a loop.
    successObserver = new MutationObserver(() => {
      if (stopped || generation !== expected || session?.id !== id || !session.active || successSeen) return;
      if (widgetVerified(observed)) successSeen = true;
    });
    successObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
  }
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
      if (successSeen || verifiedWidget(session.providers) || widgetVerified(session.providers)) { await report('widget-verified', 'The widget reports verification complete. This is not an application receipt.'); stopped = true; resetSuccessObserver(); return; }
      const failed = widgetFailure(session.providers); if (failed) throw new Error(failed);
      if (pointAttempt && Date.now() - pointAttempt.at > 12_000) throw new Error('The provider has not confirmed the point selection. Review the challenge manually.');
      if (widgetPendingAt && Date.now() - widgetPendingAt > 12_000) throw new Error('The provider has not confirmed verification. Review the challenge manually.');
      // A drag changes the captured pixels. Wait for its receipt instead of
      // analyzing the moved objects as if they were a brand-new challenge.
      if (widgetPendingAt && !textAttempt) return;
      const native = managedSnapshot(session.providers);
      if (native && !managed) {
        managed = { startedAt: Date.now(), control: native.control, started: session.autoVerify };
        if (session.autoVerify) {
          if (!await current(expected)) return;
          await startManaged(native, session.browserInput ? pointer => send('CHALLENGE_POINTER', { provider: native.provider, pointer }) : undefined);
          await report('verifying', `Waiting for ${native.name} to run its own verification and return a response…`);
        } else await report('review', `The ${native.name} widget is ready. Click its checkbox to start verification.`);
        return;
      }
      if (managed?.started && !lastActionAt && Date.now() - managed.startedAt > 30_000) throw new Error('The provider has not confirmed verification. Complete any challenge it shows manually.');
      const widget = widgetSnapshot(session.providers);
      if (widget) { if (widget.mode === 'tiktok') await handleTikTok(widget, expected); else if (widget.mode === 'point-click') await handlePoints(widget, expected); else await handleWidget(widget, expected); return; }
      const challenge = snapshot();
      if (!challenge) return;
      if (!session.providers.includes(challenge.provider)) return;
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
      const solution = await send('CHALLENGE_SOLVE', { provider: challenge.provider, task: { type: 'grid', image: captured.image, rows: challenge.rows, columns: challenge.columns, layout: challenge.layout, prompt: challenge.prompt } });
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
      if (!stopped && generation === expected) { await report('failed', error.message).catch(() => {}); stopped = true; resetSuccessObserver(); show({ detail: error.message }); }
    } finally { busy = false; }
  }
  async function handlePoints(challenge, expected) {
    if (pointAttempt) {
      if (await pointSceneMatches(challenge, pointAttempt.image, pointAttempt.points)) {
        return;
      }
      if (!/^Skip$/i.test(challenge.verify.innerText.trim())) return;
      pointAttempt = null;
    }
    const image = await captureElement(challenge.image), hash = await fingerprint(image);
    if (!await current(expected)) return;
    if (hash !== lastStable) { lastStable = hash; stableAt = Date.now(); return; }
    if (Date.now() - stableAt < 650 || hash === lastFingerprint) return;
    await report('recognizing', 'Reading the hCaptcha instruction and matching shapes…');
    const unchanged = async () => {
      if (!await current(expected)) return false;
      const latest = widgetSnapshot(session.providers);
      const same = latest?.mode === 'point-click' && latest.image === challenge.image && latest.verify === challenge.verify && (!latest.instruction || !challenge.instruction || latest.instruction === challenge.instruction) && await pointSceneMatches(latest, image);
      if (!same && ++staleCount >= 4) throw new Error('The challenge keeps changing. Wait for it to settle and start again.');
      return same;
    };
    if (challenge.needsInstruction) {
      const reading = await send('CHALLENGE_SOLVE', { provider: 'hcaptcha', task: { type: 'ocr', image: capturePointHeader(challenge) } });
      if (!await unchanged()) return;
      challenge = resolvePointInstruction(challenge, reading.text);
    }
    const solution = await send('CHALLENGE_SOLVE', { provider: 'hcaptcha', task: { type: 'points', image, prompt: challenge.prompt } });
    if (!await unchanged()) return;
    const points = pointSelection(challenge, solution);
    staleCount = 0; lastFingerprint = hash; lastActionAt = Date.now();
    if (!session.autoVerify) {
      await report('review', 'Review the shape centers as percentages of the challenge image. No points were clicked.', points.map(p => `(${Math.round(p.x * 100)}%, ${Math.round(p.y * 100)}%)`).join(' '));
      return;
    }
    await applyPointSelection(challenge, solution, () => current(expected), image);
    pointAttempt = { image, points, at: Date.now() };
    await report('verifying', 'Points selected. Waiting for the provider or the next challenge round…');
  }
  async function handleTikTok(challenge, expected) {
    const capture = value => captureTikTok(value, url => send('CHALLENGE_FETCH', { url }), cache);
    const captured = await capture(challenge);
    if (!await current(expected)) return;
    if (lastStable !== captured.fingerprint) { lastStable = captured.fingerprint; stableAt = Date.now(); return; }
    if (Date.now() - stableAt < 350 || lastFingerprint === captured.fingerprint) return;
    await report('recognizing', 'Reading the TikTok challenge…');
    const solution = await send('CHALLENGE_SOLVE', { provider: 'tiktok', task: captured.task });
    if (!await current(expected)) return;
    const latest = widgetSnapshot(session.providers);
    const same = latest?.mode === 'tiktok' && latest.root === challenge.root && latest.image === challenge.image && latest.handle === challenge.handle && latest.verify === challenge.verify && (await capture(latest)).fingerprint === captured.fingerprint;
    if (!await current(expected)) return;
    if (!same) {
      if (++staleCount >= 4) throw new Error('The challenge keeps changing. Wait for it to settle and start again.');
      return;
    }
    const preview = previewTikTok(latest, solution);
    staleCount = 0; lastFingerprint = captured.fingerprint; lastActionAt = Date.now();
    if (!session.autoVerify) { await report('review', 'TikTok result ready for review. No input was applied.', preview); return; }
    await applyTikTok(latest, solution, () => current(expected));
    widgetPendingAt = Date.now(); lastVerified = captured.fingerprint;
    await report('verifying', 'Answer applied. Waiting for TikTok to confirm verification…');
  }
  async function handleWidget(challenge, expected) {
    const capture = value => captureWidget(value, url => send('CHALLENGE_FETCH', { url }), cache, rect => send('CHALLENGE_CAPTURE', { provider: value.provider, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, viewport: { width: innerWidth, height: innerHeight } }));
    const captured = await capture(challenge);
    if (!await current(expected)) return;
    if (lastStable !== captured.fingerprint) { lastStable = captured.fingerprint; stableAt = Date.now(); return; }
    // Screen captures are rate-limited and briefly cached. Require a fresh
    // frame before treating an animated widget as stable.
    if (Date.now() - stableAt < (challenge.screen ? 900 : 350)) return;
    let retrying = false;
    if (lastVerified === captured.fingerprint) {
      const feedback = textFeedback(challenge);
      if (feedback === 'short' && textAttempt?.count === 1 && Date.now() - lastActionAt > 800 && challenge.input.value === textAttempt.text) {
        retrying = true;
        captured.task.minLength = textAttempt.text.length + 1;
      } else if (feedback === 'rejected') throw new Error('The provider rejected the recognized code. Complete this challenge manually.');
      else {
      if (Date.now() - lastActionAt > 12_000) throw new Error('The provider has not confirmed verification. Review the challenge manually.');
      return;
      }
    }
    if (lastFingerprint === captured.fingerprint && !retrying) return;
    await report('recognizing', retrying ? 'The provider reported missing characters. Checking the code once more…' : `Reading the ${challenge.name} challenge…`);
    const solution = await send('CHALLENGE_SOLVE', { provider: challenge.provider, task: captured.task });
    if (!await current(expected)) return;
    const latest = widgetSnapshot(session.providers);
    if (!latest || latest.provider !== challenge.provider || latest.input !== challenge.input || latest.handle !== challenge.handle || (await capture(latest)).fingerprint !== captured.fingerprint) {
      if (++staleCount >= 4) throw new Error('The challenge keeps changing. Wait for it to settle and start again.');
      return;
    }
    staleCount = 0;
    if (solution.confidence < .8) throw new Error('Recognition is uncertain. Complete this challenge manually.');
    lastFingerprint = captured.fingerprint; lastActionAt = Date.now();
    if (!session.autoVerify) {
      if (latest.handle) await report('review', `Puzzle position ready. Move the slider ${Math.round(puzzleDrag(latest, solution).distance)} pixels to the right. Releasing it may complete verification.`);
      else await report('review', 'Review the recognized code, then enter it in the CAPTCHA field.', solution.text);
      return;
    }
    if (!await current(expected)) return;
    if (latest.handle) await applyPuzzle(latest, solution, () => current(expected), session.browserInput ? pointer => send('CHALLENGE_POINTER', { provider: latest.provider, pointer }) : undefined);
    else {
      applyText(latest, solution, retrying ? textAttempt.text : undefined);
      textAttempt = { text: solution.text, count: retrying ? 2 : 1 };
    }
    if (latest.autoChecks || latest.handle) {
      widgetPendingAt = Date.now();
      lastVerified = captured.fingerprint;
      await report('verifying', 'Answer applied. Waiting for the widget to confirm verification…');
    } else await report('review', 'Code entered. Review it before continuing; verification is not confirmed.');
  }
  async function start() {
    resetSuccessObserver(); clearInterval(timer); generation++; stopped = false; pointAttempt = null; lastFingerprint = lastVerified = lastStable = managed = textAttempt = null; lastActionAt = stableAt = staleCount = widgetPendingAt = 0; cache.clear();
    const expected = generation;
    try {
      const next = await send('CHALLENGE_HELLO');
      if (expected !== generation || stopped) return;
      session = next; observeProviderSuccess(); show(session); timer = setInterval(tick, 400); void tick();
    } catch { if (expected === generation) { stopped = true; resetSuccessObserver(); } }
  }
  api.runtime.onMessage.addListener(message => { if (message.type === 'CHALLENGE_STATUS') { if (session?.id === message.session.id) { show(message.session); if (!message.session.active) { stopped = true; generation++; clearInterval(timer); resetSuccessObserver(); } } } });
  window.addEventListener('pagehide', () => { stopped = true; generation++; clearInterval(timer); resetSuccessObserver(); });
  globalThis.__universalChallenge = start; void start();
}
