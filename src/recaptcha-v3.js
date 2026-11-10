// This function is intentionally self-contained: the extension executes it in
// the page's MAIN world to call Google's documented grecaptcha.ready/execute.
// A token is never returned to extension storage or passed to an arbitrary
// page callback, which could submit an account/application form.
export async function recaptchaV3Native(request = {}) {
  const slot = Symbol.for('universal-ocr.recaptcha-v3.requests');
  const registry = globalThis[slot] ||= new Map();
  const cancelledSlot = Symbol.for('universal-ocr.recaptcha-v3.cancelled');
  const cancelled = globalThis[cancelledSlot] ||= new Map();
  for (const [key, until] of cancelled) if (until <= Date.now()) cancelled.delete(key);
  const id = request.requestId;
  if (request.op === 'cancel') {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error('A valid v3 request identity is required.');
    // MAIN-world execute injection can arrive after a Stop injection. Retain a
    // bounded tombstone so that delayed work cannot start under that identity.
    cancelled.set(id, Date.now() + 60000);
    while (cancelled.size > 128) cancelled.delete(cancelled.keys().next().value);
    const active = registry.get(id);
    active?.abort(new Error('reCAPTCHA v3 was stopped.'));
    return { cancelled: Boolean(active), pendingPrevented: true };
  }
  const demoOrigin = 'https://recaptcha-demo.appspot.com';
  const demoPath = '/recaptcha-v3-request-scores.php';
  const siteKeyValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{20,200}$/.test(value);
  const actionValid = value => typeof value === 'string' && /^[A-Za-z0-9/_]{1,100}$/.test(value);
  const inspect = () => {
    if (!/^https?:$/.test(location.protocol) || location.username || location.password) throw new Error('Open an HTTP or HTTPS page containing reCAPTCHA v3.');
    const scripts = [...document.scripts].flatMap(script => {
      try {
        const url = new URL(script.src);
        if (url.protocol !== 'https:' || url.username || url.password || !['www.google.com', 'www.recaptcha.net', 'recaptcha.google.com'].includes(url.hostname)) return [];
        if (url.pathname === '/recaptcha/enterprise.js') throw new Error('reCAPTCHA Enterprise requires its own site-specific integration.');
        if (url.pathname !== '/recaptcha/api.js') return [];
        const key = url.searchParams.get('render');
        return [{ key: siteKeyValid(key) ? key : null }];
      } catch (error) {
        if (error.message?.startsWith('reCAPTCHA Enterprise')) throw error;
        return [];
      }
    });
    if (!scripts.length) throw new Error('No standard reCAPTCHA API script is present.');
    const keys = [...new Set(scripts.map(script => script.key).filter(Boolean))];
    if (!keys.length) throw new Error('Programmatic v3 execution requires an explicit site key in the API script render parameter.');
    const declared = [...document.querySelectorAll('.g-recaptcha[data-sitekey][data-action]')].map(element => ({
      siteKey: element.getAttribute('data-sitekey'), action: element.getAttribute('data-action'), callbackPresent: element.hasAttribute('data-callback'),
    }));
    const isDemo = location.origin === demoOrigin && location.pathname === demoPath;
    const candidates = isDemo ? keys.map(siteKey => ({ siteKey, action: 'examples/v3scores', callbackPresent: false })) : declared;
    if (!candidates.length) throw new Error('The v3 action is not explicitly declared. Its site-specific callback must be integrated before execution.');
    if (candidates.some(candidate => !siteKeyValid(candidate.siteKey) || !actionValid(candidate.action))) throw new Error('The declared reCAPTCHA v3 key or action is invalid.');
    const unique = [...new Map(candidates.map(candidate => [candidate.siteKey + '\n' + candidate.action, candidate])).values()];
    if (unique.length !== 1 || keys.length > 1 || (keys.length === 1 && keys[0] !== unique[0].siteKey)) throw new Error('Multiple or conflicting reCAPTCHA v3 keys/actions are present.');
    return { provider: 'recaptcha-v3', sourceURL: location.href, siteKey: unique[0].siteKey, action: unique[0].action,
      verification: isDemo ? 'official-demo' : 'token-only', callbackPresent: candidates.some(candidate => candidate.callbackPresent) };
  };
  const plan = inspect();
  if (request.op === 'inspect') return plan;
  if (request.op !== 'execute') throw new Error('Unsupported reCAPTCHA v3 operation.');
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error('A unique v3 request identity is required.');
  if (cancelled.has(id)) throw new Error('reCAPTCHA v3 was stopped before execution.');
  const samePlan = (a, b) => ['provider', 'sourceURL', 'siteKey', 'action', 'verification', 'callbackPresent'].every(key => a?.[key] === b?.[key]);
  if (!samePlan(plan, request.expected)) throw new Error('The reCAPTCHA v3 page, key, or action changed. Inspect it again.');
  if (registry.size) throw new Error('A reCAPTCHA v3 request is already running on this page.');
  const controller = new AbortController(), signal = controller.signal, startedAt = Date.now();
  registry.set(id, controller);
  const timeoutMs = Number.isInteger(request.timeoutMs) ? Math.min(30000, Math.max(100, request.timeoutMs)) : 20000;
  const timer = setTimeout(() => controller.abort(new Error('reCAPTCHA v3 timed out.')), timeoutMs);
  let token = '';
  const current = () => {
    if (signal.aborted) throw signal.reason;
    if (!samePlan(plan, inspect())) throw new Error('The reCAPTCHA v3 page, key, or action changed.');
  };
  const bounded = promise => new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
  const result = (state, extra = {}) => ({ provider: 'recaptcha-v3', state, action: plan.action, elapsedMs: Date.now() - startedAt, ...extra });
  try {
    current();
    const api = globalThis.grecaptcha;
    if (typeof api?.ready !== 'function' || typeof api?.execute !== 'function') throw new Error('The reCAPTCHA v3 client has not loaded.');
    await bounded(new Promise((resolve, reject) => { try { api.ready(resolve); } catch (error) { reject(error); } }));
    current();
    token = await bounded(api.execute(plan.siteKey, { action: plan.action }));
    current();
    if (typeof token !== 'string' || token.length < 20 || token.length > 20000 || /\s/.test(token)) throw new Error('The provider did not return a valid response token.');
    if (plan.verification !== 'official-demo') return result('token-issued', { serverVerified: false });

    // This is Google's public verification-only demo endpoint, reviewed in
    // google/recaptcha/examples/recaptcha-v3-verify.php. Never guess an endpoint
    // or invoke a host-page callback; either could submit a protected action.
    const endpoint = new URL('/recaptcha-v3-verify.php', demoOrigin);
    endpoint.searchParams.set('action', plan.action);
    endpoint.searchParams.set('token', token);
    const response = await bounded(fetch(endpoint.href, { signal, method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error' }));
    token = '';
    current();
    if (!response.ok || !/application\/json/i.test(response.headers.get('Content-Type') || '')) throw new Error('The v3 verification endpoint did not return a JSON receipt.');
    const body = await bounded(response.text());
    if (body.length > 10000) throw new Error('The v3 verification receipt is too large.');
    let receipt;
    try { receipt = JSON.parse(body); } catch { throw new Error('The v3 verification receipt is invalid JSON.'); }
    current();
    const errors = receipt?.['error-codes'];
    if (!receipt || typeof receipt.success !== 'boolean' || !Array.isArray(errors) || errors.some(value => typeof value !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(value))) throw new Error('The v3 verification receipt is malformed.');
    const sanitized = { success: receipt.success, errorCodes: errors };
    if (receipt.score !== undefined) {
      if (!Number.isFinite(receipt.score) || receipt.score < 0 || receipt.score > 1) throw new Error('The v3 verification score is invalid.');
      sanitized.score = receipt.score;
    }
    if (receipt.action !== undefined) {
      if (receipt.action !== plan.action) throw new Error('The v3 receipt action does not match the requested action.');
      sanitized.action = receipt.action;
    }
    if (receipt.hostname !== undefined) {
      if (receipt.hostname !== location.hostname) throw new Error('The v3 receipt hostname does not match this page.');
      sanitized.hostname = receipt.hostname;
    }
    if (receipt.challenge_ts !== undefined) {
      const timestamp = Date.parse(receipt.challenge_ts), age = Date.now() - timestamp;
      if (!Number.isFinite(timestamp) || age < -10000 || age > 120000) throw new Error('The v3 verification receipt is expired or has an invalid timestamp.');
      sanitized.challengeTimestamp = receipt.challenge_ts;
    }
    if (receipt.success && (sanitized.score === undefined || sanitized.action === undefined || sanitized.hostname === undefined || sanitized.challengeTimestamp === undefined || errors.length)) throw new Error('The successful v3 receipt is missing required verification details.');
    const accepted = receipt.success && receipt.score >= .5;
    return result(accepted ? 'server-verified' : 'rejected', { serverVerified: accepted, receipt: sanitized });
  } finally {
    token = '';
    clearTimeout(timer);
    registry.delete(id);
  }
}
