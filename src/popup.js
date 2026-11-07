import './theme.js';
import { api } from './platform.js';
const status = document.querySelector('#popup-status');
async function act(message) {
  document.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  status.textContent = message.type === 'CAPTURE' ? 'Preparing capture…' : '';
  try {
    const response = await api.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || 'The action could not be completed.');
    window.close();
  } catch (error) {
    status.textContent = error.message;
    status.classList.add('error');
    document.querySelectorAll('button').forEach((button) => { button.disabled = false; });
  }
}
document.querySelector('#region').addEventListener('click', () => act({ type: 'CAPTURE', mode: 'region' }));
document.querySelector('#viewport').addEventListener('click', () => act({ type: 'CAPTURE', mode: 'viewport' }));
document.querySelector('#workspace').addEventListener('click', () => act({ type: 'OPEN_WORKSPACE' }));

document.querySelector('#control').addEventListener('click', () => act({ type: 'OPEN_CONTROL' }));
document.querySelector('#scan').addEventListener('click', async () => { status.classList.remove('error'); status.textContent = 'Inspecting accessible frames…'; try { const response = await api.runtime.sendMessage({ type: 'SCAN_PAGE' }); if (!response?.ok) throw new Error(response?.error); const names = [...new Set(response.value.map((item) => item.name))]; status.textContent = names.length ? `Detected: ${names.join(', ')}. Open Visual tools for capabilities.` : 'No known widget detected in accessible frames. A challenge may appear later in the flow.'; } catch (error) { status.textContent = error.message; status.classList.add('error'); } });
