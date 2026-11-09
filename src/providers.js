export const PROVIDERS = [
  { id: 'turnstile', name: 'Cloudflare Turnstile', selectors: ['.cf-turnstile', 'iframe[src*="challenges.cloudflare.com"]', 'script[src*="challenges.cloudflare.com/turnstile"]'], hosts: ['challenges.cloudflare.com'], mode: 'provider-token' },
  { id: 'recaptcha-v2', name: 'reCAPTCHA v2', selectors: ['.g-recaptcha:not([data-action])', 'iframe[src*="recaptcha"][src*="anchor"]', '.rc-imageselect'], hosts: ['google.com', 'recaptcha.net'], mode: 'widget' },
  { id: 'recaptcha-v3', name: 'reCAPTCHA v3', selectors: ['.g-recaptcha[data-action]', 'script[src*="/recaptcha/api.js"]', 'script[src*="/recaptcha/enterprise.js"]'], hosts: ['google.com', 'recaptcha.net'], mode: 'provider-token' },
  { id: 'hcaptcha', name: 'hCaptcha / grids and matching shapes', selectors: ['.h-captcha', 'iframe[src*="hcaptcha.com"]'], hosts: ['hcaptcha.com'], mode: 'widget' },
  { id: 'aws-waf', name: 'AWS WAF CAPTCHA', selectors: ['#aws-waf-captcha-container', 'script[src*="captcha-sdk.awswaf.com"]', 'iframe[src*="awswaf.com"]'], hosts: ['awswaf.com'], mode: 'widget' },
  { id: 'geetest-v3', name: 'Geetest v3', selectors: ['.geetest_panel', '.geetest_holder', '.geetest_slider'], hosts: ['geetest.com'], mode: 'widget' },
  { id: 'geetest-v4', name: 'Geetest v4', selectors: ['.geetest_box', '.geetest_captcha', '[class*="geetest_ques"]'], hosts: ['geetest.com', 'geevisit.com'], mode: 'widget' },
  { id: 'bls-text', name: 'BLS / text images', selectors: ['img[id*="captcha" i]', 'img[src*="captcha" i]', 'canvas[id*="captcha" i]'], hosts: [], mode: 'ocr-rule' },
  { id: 'mtcaptcha', name: 'mtCaptcha', selectors: ['.mtcaptcha', 'iframe[src*="mtcaptcha.com"]'], hosts: ['mtcaptcha.com'], mode: 'widget' },
  { id: 'captchafox', name: 'CaptchaFox', selectors: ['.captchafox', '.cf-checkbox-box', 'input[name="cf-captcha-response"]', 'iframe[src*="captchafox.com"]', 'script[src*="captchafox.com"]'], hosts: ['captchafox.com'], mode: 'widget' },
  { id: 'tencent', name: 'Tencent CAPTCHA', selectors: ['#tCaptchaDyMainWrap', '#tcaptcha_iframe', 'iframe[src*="captcha.gtimg.com"]', 'iframe[src*="turing.captcha.qcloud.com"]'], hosts: ['captcha.gtimg.com', 'turing.captcha.qcloud.com', 'ca.turing.captcha.qcloud.com'], mode: 'widget' },
  { id: 'tiktok', name: 'TikTok CAPTCHA', selectors: ['#captcha-verify-container', '.captcha_verify_container', '[class*="secsdk-captcha"]'], hosts: ['tiktok.com'], mode: 'widget' },
  { id: 'prosopo', name: 'Prosopo / Procaptcha', selectors: ['.procaptcha', '.prosopo-checkbox', '.prosopo-widget__content', 'iframe[src*="prosopo"]', 'script[src*="procaptcha"]'], hosts: ['prosopo.io'], mode: 'provider-token' },
  { id: 'binance', name: 'Binance CAPTCHA', selectors: ['#bcap-root', '[class*="bcap-"]', 'iframe[src*="captcha"][src*="binance"]'], hosts: ['binance.com'], mode: 'widget' },
];

export function scoreScript(value) {
  try { const url = new URL(value), render = url.searchParams.get('render'); return url.protocol === 'https:' && !url.username && !url.password && ['www.google.com', 'www.recaptcha.net', 'recaptcha.google.com'].includes(url.hostname) && /^\/recaptcha\/(api|enterprise)\.js$/.test(url.pathname) && Boolean(render && !['explicit', 'onload'].includes(render)); }
  catch { return false; }
}

export function scanProviders(document) {
  return PROVIDERS.flatMap((provider) => {
    const matches = [];
    for (const selector of provider.selectors) for (const element of document.querySelectorAll(selector)) {
      if (provider.id === 'recaptcha-v3' && element.tagName === 'SCRIPT' && !scoreScript(element.src)) continue;
      if (matches.some((entry) => entry.element === element)) continue;
      const rect = element.getBoundingClientRect();
      matches.push({ element, selector, visible: rect.width > 0 && rect.height > 0 });
    }
    return matches.length ? [{ id: provider.id, name: provider.name, mode: provider.mode, count: matches.length, visible: matches.some((item) => item.visible), selectors: [...new Set(matches.map((item) => item.selector))], status: 'detected' }] : [];
  });
}

export function matchOrigin(url, origin) { try { return new URL(url).origin === new URL(origin).origin; } catch { return false; } }

export function validateRule(value) {
  if (!value || typeof value !== 'object') throw new Error('Invalid automation rule.');
  const url = new URL(value.origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Rules need an HTTP or HTTPS site origin.');
  const selector = (name, required = true) => {
    const entry = typeof value[name] === 'string' ? value[name].trim() : '';
    if ((required && !entry) || entry.length > 500) throw new Error(`Enter a valid ${name}.`);
    return entry;
  };
  const type = ['ocr', 'captcha-text', 'grid', 'points', 'slider'].includes(value.type) ? value.type : 'ocr';
  const number = (name, fallback, min, max, integer = false) => { const n = Number(value[name] ?? fallback); if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new Error(`Invalid ${name}.`); return n; };
  return {
    id: typeof value.id === 'string' && /^[a-z0-9-]{1,64}$/i.test(value.id) ? value.id : crypto.randomUUID(),
    name: String(value.name || url.hostname).slice(0, 100), origin: url.origin, enabled: value.enabled === true, type,
    imageSelector: selector('imageSelector'), inputSelector: selector('inputSelector', ['ocr', 'captcha-text'].includes(type)),
    tileSelector: selector('tileSelector', type === 'grid'), handleSelector: selector('handleSelector', type === 'slider'),
    referenceSelector: selector('referenceSelector', type === 'slider'), submitSelector: selector('submitSelector', value.autoSubmit === true),
    successSelector: selector('successSelector', false), prompt: String(value.prompt || '').slice(0, 2000),
    rows: number('rows', 3, 1, 6, true), columns: number('columns', 3, 1, 6, true),
    autoSubmit: value.autoSubmit === true, minConfidence: number('minConfidence', 0.8, 0, 1),
    maxAttempts: number('maxAttempts', 2, 1, 5, true),
    settings: value.settings && typeof value.settings === 'object' ? value.settings : {},
  };
}
