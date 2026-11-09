export const CHALLENGE_ORIGINS = [
  'https://www.google.com/*', 'https://recaptcha.google.com/*',
  'https://www.recaptcha.net/*', 'https://www.gstatic.com/*',
  'https://*.hcaptcha.com/*', 'https://*.hcaptcha.net/*',
];

export function providerURL(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    return (['www.google.com', 'recaptcha.google.com', 'www.recaptcha.net'].includes(url.hostname) && url.pathname.startsWith('/recaptcha/')) ||
      /(^|\.)hcaptcha\.(com|net)$/.test(url.hostname);
  } catch { return false; }
}

export function imageURL(value, siteOrigin) {
  try {
    const url = new URL(value);
    if (url.username || url.password || !['https:', 'http:'].includes(url.protocol)) return false;
    return url.origin === siteOrigin || providerURL(value) ||
      (url.protocol === 'https:' && url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/recaptcha/'));
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
