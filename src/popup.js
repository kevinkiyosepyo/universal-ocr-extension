const status = document.querySelector('#popup-status');
async function act(message) {
  document.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  status.textContent = message.type === 'CAPTURE' ? 'Preparing capture…' : '';
  try {
    const response = await chrome.runtime.sendMessage(message);
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
