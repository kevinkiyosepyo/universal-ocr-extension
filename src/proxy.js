import { api } from './platform.js';

export function parseProxy(value) {
  const url = new URL(value);
  if (!['http:', 'https:', 'socks4:', 'socks5:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) throw new Error('Use http://host:port, https://host:port, or socks5://host:port. Embedded credentials are not supported.');
  const port = Number(url.port || ({ 'http:': 80, 'https:': 443, 'socks4:': 1080, 'socks5:': 1080 }[url.protocol]));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid proxy port.');
  return { scheme: url.protocol.slice(0, -1), host: url.hostname, port };
}

export async function proxyRoute(message) {
  if (!await api.permissions.contains({ permissions: ['proxy'] })) throw new Error('Grant the optional proxy permission first.');
  if (!api.proxy?.settings) throw new Error('This browser does not expose proxy settings.');
  const firefox = typeof globalThis.browser !== 'undefined' && !globalThis.chrome?.offscreen;
  const get = () => api.proxy.settings.get({ incognito: false });
  if (message.type === 'PROXY_STATUS') return get();
  if (message.type === 'PROXY_DISABLE') { await api.proxy.settings.clear({ scope: 'regular' }); await api.storage.local.set({ proxyActive: false }); return get(); }
  if (message.type === 'PROXY_SAVE') {
    const list = String(message.list || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (list.length > 30) throw new Error('Save at most 30 proxies.');
    list.forEach(parseProxy);
    await api.storage.local.set({ proxies: list }); return { count: list.length };
  }
  if (message.type === 'PROXY_APPLY' || message.type === 'PROXY_NEXT') {
    const { proxies = [], proxyIndex = -1 } = await api.storage.local.get(['proxies', 'proxyIndex']);
    const index = message.type === 'PROXY_NEXT' ? (proxyIndex + 1) % proxies.length : Number(message.index || 0);
    if (!proxies[index]) throw new Error('Save a proxy first.');
    const server = parseProxy(proxies[index]);
    const bypass = ['localhost', '127.0.0.1', '[::1]'];
    const current = await get();
    if (current.levelOfControl === 'controlled_by_other_extensions' || current.levelOfControl === 'not_controllable') throw new Error('Another extension or browser policy controls the proxy.');
    const value = firefox ? {
      proxyType: 'manual', passthrough: bypass.join(', '),
      ...(server.scheme.startsWith('socks') ? { socks: `${server.host}:${server.port}`, socksVersion: server.scheme === 'socks4' ? 4 : 5 } : { http: `${server.scheme}://${server.host}:${server.port}`, ssl: `${server.scheme}://${server.host}:${server.port}` }),
    } : { mode: 'fixed_servers', rules: { singleProxy: server, bypassList: bypass } };
    await api.proxy.settings.set({ value, scope: 'regular' });
    await api.storage.local.set({ proxyIndex: index, proxyActive: true }); return get();
  }
  if (message.type === 'PROXY_CHECK') {
    const url = new URL(message.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use an HTTPS health-check URL.');
    if (!await api.permissions.contains({ origins: [`${url.protocol}//${url.hostname}/*`] })) throw new Error('Grant access to the health-check host first.');
    const start = performance.now();
    const response = await fetch(url.href, { method: 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000) });
    await response.body?.cancel();
    return { ok: response.ok, status: response.status, latencyMs: Math.round(performance.now() - start) };
  }
  throw new Error('Unknown proxy action.');
}
