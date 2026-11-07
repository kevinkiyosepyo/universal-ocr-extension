import { api } from './platform.js';
const media = matchMedia('(prefers-color-scheme: dark)');
let preference = 'system';
const apply = () => { document.documentElement.dataset.theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference; };
api.storage.local.get('theme').then(({ theme }) => { preference = ['dark', 'light'].includes(theme) ? theme : 'system'; apply(); const select = document.querySelector('#theme'); if (select) select.value = preference; });
media.addEventListener('change', apply);
api.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.theme) { preference = changes.theme.newValue || 'system'; apply(); } });
document.querySelector('#theme')?.addEventListener('change', (event) => { void api.storage.local.set({ theme: event.target.value }); });
