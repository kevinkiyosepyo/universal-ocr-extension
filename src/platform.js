import browser from 'webextension-polyfill';
export const api = browser;
export function documentTarget(source) { return source.documentId ? { documentId: source.documentId } : { frameId: source.frameId || 0 }; }
