export const PROVIDER_ORIGINS = {
  'recaptcha-v2': [
  'https://www.google.com/*', 'https://recaptcha.google.com/*',
  'https://www.recaptcha.net/*', 'https://www.gstatic.com/*',
  ],
  hcaptcha: ['https://*.hcaptcha.com/*', 'https://*.hcaptcha.net/*'],
  mtcaptcha: ['https://*.mtcaptcha.com/*'],
  'text-captcha': [],
  'geetest-v3': ['https://*.geetest.com/*', 'https://*.geevisit.com/*'],
  'geetest-v4': ['https://*.geetest.com/*', 'https://*.geevisit.com/*'],
  tencent: ['https://turing.captcha.qcloud.com/*', 'https://ca.turing.captcha.qcloud.com/*', 'https://captcha.gtimg.com/*'],
  prosopo: ['https://*.prosopo.io/*'],
  captchafox: ['https://*.captchafox.com/*'],
};
export const DEFAULT_PROVIDERS = ['recaptcha-v2', 'hcaptcha'];
export const CHALLENGE_ORIGINS = [...new Set(Object.values(PROVIDER_ORIGINS).flat())];
export function challengeProviders(values = DEFAULT_PROVIDERS) {
  if (!Array.isArray(values) || !values.length || values.some(id => !Object.hasOwn(PROVIDER_ORIGINS, id))) throw new Error('This provider has no challenge adapter.');
  return [...new Set(values)];
}
export const challengeOrigins = providers => [...new Set(challengeProviders(providers).flatMap(id => PROVIDER_ORIGINS[id]))];

export function providerURL(value, providers = Object.keys(PROVIDER_ORIGINS)) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    return (providers.includes('recaptcha-v2') && ['www.google.com', 'recaptcha.google.com', 'www.recaptcha.net'].includes(url.hostname) && url.pathname.startsWith('/recaptcha/')) ||
      (providers.includes('hcaptcha') && /(^|\.)hcaptcha\.(com|net)$/.test(url.hostname)) ||
      (providers.includes('mtcaptcha') && /(^|\.)mtcaptcha\.com$/.test(url.hostname)) ||
      (providers.some(id => id === 'geetest-v3' || id === 'geetest-v4') && /(^|\.)(geetest|geevisit)\.com$/.test(url.hostname)) ||
      (providers.includes('tencent') && ['turing.captcha.qcloud.com', 'ca.turing.captcha.qcloud.com', 'captcha.gtimg.com'].includes(url.hostname)) ||
      (providers.includes('prosopo') && /(^|\.)prosopo\.io$/.test(url.hostname)) ||
      (providers.includes('captchafox') && /(^|\.)captchafox\.com$/.test(url.hostname));
  } catch { return false; }
}

export function imageURL(value, siteOrigin, providers = Object.keys(PROVIDER_ORIGINS)) {
  try {
    const url = new URL(value);
    if (url.username || url.password || !['https:', 'http:'].includes(url.protocol)) return false;
    return url.origin === siteOrigin || providerURL(value, providers) ||
      (providers.includes('recaptcha-v2') && url.protocol === 'https:' && url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/recaptcha/'));
  } catch { return false; }
}

export function gridChanges(selected, current, count) {
  if (!Array.isArray(selected) || !selected.every(index => Number.isInteger(index) && index >= 0 && index < count)) throw new Error('Invalid grid selection.');
  const wanted = new Set(selected);
  return Array.from({ length: count }, (_, index) => index).filter(index => wanted.has(index) !== Boolean(current[index]));
}

export function gridShape(tiles) {
  const rows = [];
  for (const tile of tiles) {
    const rect = tile.getBoundingClientRect();
    let row = rows.find(item => Math.abs(item.top - rect.top) < rect.height / 3);
    if (!row) { row = { top: rect.top, cells: [] }; rows.push(row); }
    row.cells.push({ tile, left: rect.left });
  }
  rows.sort((a, b) => a.top - b.top);
  const columns = rows[0]?.cells.length;
  if (!columns || rows.some(row => row.cells.length !== columns) || rows.length < 2 || rows.length > 6 || columns < 2 || columns > 6) throw new Error('This challenge is not a supported rectangular image grid.');
  return { rows: rows.length, columns, tiles: rows.flatMap(row => row.cells.sort((a, b) => a.left - b.left).map(cell => cell.tile)) };
}
