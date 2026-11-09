import { api } from './platform.js';
import './theme.js';
import { PROVIDERS, validateRule } from './providers.js';
import { endpointURL, validateTask } from '../shared/protocol.js';
const $ = (id) => document.getElementById(id);
const notice = (text, error = false) => { $('notice').textContent = text; $('notice').classList.toggle('error', error); };
const send = async (message) => { const result = await api.runtime.sendMessage(message); if (!result?.ok) throw new Error(result?.error || 'The extension did not respond.'); return result.value; };
const protect = (callback) => async (event) => { event?.preventDefault(); try { await callback(event); } catch (error) { notice(error.message, true); } };
const pattern = (value) => { const url = new URL(value); return `${url.protocol}//${url.hostname}/*`; };
const node = (tag, text, className = '') => { const el = document.createElement(tag); el.textContent = text; el.className = className; return el; };
function navigate() { const name = location.hash.slice(1) || 'visual'; const valid = ['visual', 'rules', 'activity', 'providers', 'settings'].includes(name) ? name : 'visual'; document.querySelectorAll('.tool-panel').forEach((panel) => { panel.hidden = panel.id !== valid; }); document.querySelectorAll('nav a').forEach((link) => { if (link.hash === `#${valid}`) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }); notice(''); }
window.addEventListener('hashchange', navigate); navigate();

let mainImage, referenceImage, running, generation = 0, lastTask;
function taskFields() {
  const type = $('task-type').value;
  $('prompt-field').hidden = !['grid', 'points', 'bbox'].includes(type);
  document.querySelectorAll('.grid-field').forEach((el) => { el.hidden = type !== 'grid'; });
  document.querySelectorAll('.pow-field').forEach((el) => { el.hidden = type !== 'pow'; });
  $('reference-field').hidden = !['slider', 'rotate'].includes(type); $('image-field').hidden = type === 'pow';
  $('task-hint').textContent = { 'captcha-text': 'Reads a single distorted code using the local vision model. Crop tightly around the code. Review ambiguous letters and digits.', ocr: 'Reads locally with the bundled English model. The text workspace offers seven languages and image cleanup.', grid: 'Requires the local vision service. Cell numbers start at 1 in the overlay; the API uses zero-based indexes.', points: 'Requires the local vision service. Locations are estimates; inspect the highlighted points.', bbox: 'Requires the local vision service. Boxes use normalized image coordinates.', slider: 'Matches an uns scrambled piece against the original background. Both images must use the same pixel scale, at most 1200 × 1200.', rotate: 'Compares circular image content against an upright reference. Symmetric or unrelated images can be ambiguous.', pow: 'Computes SHA-256(prefix + decimal nonce) with the requested leading zero bits. This is a generic protocol, not a provider token.' }[type].replace('uns scrambled', 'unscrambled');
  $('solution-panel').hidden = true; $('task-overlay').replaceChildren();
}
$('task-type').addEventListener('change', taskFields); taskFields();
async function loadImage(file, reference = false) {
  if (running) throw new Error('Cancel the current task before changing its image.');
  if (!file || !['image/png', 'image/jpeg', 'image/webp', 'image/bmp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, WebP, or BMP image.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Images must be 15 MB or smaller.');
  const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('The image could not be read.')); reader.readAsDataURL(file); });
  const image = new Image(); image.src = data; await image.decode();
  if (image.naturalWidth * image.naturalHeight > 20_000_000) throw new Error('Images must be 20 megapixels or smaller.');
  if (reference) { referenceImage = data; $('reference-preview').src = data; } else { mainImage = data; $('task-preview').src = data; }
  $('solution-panel').hidden = true; $('task-overlay').replaceChildren(); notice('Image ready.');
}
$('task-image').addEventListener('change', protect(() => loadImage($('task-image').files[0])));
$('task-reference').addEventListener('change', protect(() => loadImage($('task-reference').files[0], true)));
document.addEventListener('paste', (event) => { if ($('visual').hidden || !event.clipboardData?.files.length) return; event.preventDefault(); void loadImage(event.clipboardData.files[0]).catch((error) => notice(error.message, true)); });
$('image-field').addEventListener('dragover', (event) => event.preventDefault());
$('image-field').addEventListener('drop', protect((event) => loadImage(event.dataTransfer.files[0])));
function overlay(solution, task) {
  const svg = $('task-overlay'); svg.replaceChildren();
  const shape = (name, attrs) => { const element = document.createElementNS('http://www.w3.org/2000/svg', name); for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value)); svg.append(element); return element; };
  const rect = (x, y, width, height) => shape('rect', { x: x * 1000, y: y * 1000, width: width * 1000, height: height * 1000, fill: '#12b76a44', stroke: '#087f4c', 'stroke-width': 5, 'vector-effect': 'non-scaling-stroke' });
  if (task.type === 'grid') for (const index of solution.selected) { const x = index % task.columns / task.columns, y = Math.floor(index / task.columns) / task.rows; rect(x, y, 1 / task.columns, 1 / task.rows); shape('text', { x: x * 1000 + 15, y: y * 1000 + 50, fill: '#073e2a', 'font-size': 42, 'font-weight': 700 }).textContent = index + 1; }
  for (const point of solution.points || []) shape('circle', { cx: point.x * 1000, cy: point.y * 1000, r: 16, fill: '#e5484d99', stroke: '#fff', 'stroke-width': 4, 'vector-effect': 'non-scaling-stroke' });
  for (const box of solution.boxes || []) rect(box.x, box.y, box.width, box.height);
  if (task.type === 'slider') rect(solution.normalizedX, solution.normalizedY, solution.width / solution.backgroundWidth, solution.height / solution.backgroundHeight);
}
$('visual-form').addEventListener('submit', protect(async () => {
  const task = { type: $('task-type').value, image: mainImage, reference: referenceImage, prompt: $('task-prompt').value, layout: $('task-grid-layout').value, rows: Number($('task-rows').value), columns: Number($('task-columns').value), prefix: $('task-prefix').value, difficulty: Number($('task-difficulty').value) };
  validateTask(task); const id = crypto.randomUUID(), current = ++generation, started = performance.now(); running = id; lastTask = task;
  $('analyze').disabled = true; $('task-type').disabled = true; $('cancel-task').hidden = false; $('solution-panel').hidden = true; $('task-overlay').replaceChildren(); notice('Analyzing on your configured engine…');
  try {
    const result = await send({ type: 'SOLVE_TASK', id, task }); if (generation !== current) return;
    $('solution').value = ['ocr', 'captcha-text'].includes(task.type) ? result.text : JSON.stringify(result, null, 2);
    $('solution-summary').textContent = `${((performance.now() - started) / 1000).toFixed(1)} seconds${Number.isFinite(result.confidence) ? ` · ${Math.round(result.confidence * 100)}% estimated confidence` : ''}.`;
    overlay(result, task); $('solution-panel').hidden = false; notice(task.type === 'captcha-text' && result.confidence < .8 ? 'Uncertain reading. Check every character before using it.' : 'Analysis complete. Review the result.', task.type === 'captcha-text' && result.confidence < .8);
  } finally { if (running === id) { running = null; $('analyze').disabled = false; $('task-type').disabled = false; $('cancel-task').hidden = true; } }
}));
$('cancel-task').addEventListener('click', protect(async () => { if (running) await send({ type: 'CANCEL_TASK', id: running }); notice('Task cancelled.'); }));
$('clear-task').addEventListener('click', protect(async () => { if (running) await send({ type: 'CANCEL_TASK', id: running }); generation++; mainImage = referenceImage = lastTask = null; $('task-preview').removeAttribute('src'); $('reference-preview').removeAttribute('src'); $('task-image').value = $('task-reference').value = $('solution').value = ''; $('solution-panel').hidden = true; $('task-overlay').replaceChildren(); notice('Workbench cleared.'); }));
$('copy-solution').addEventListener('click', protect(async () => { await navigator.clipboard.writeText($('solution').value); notice('Result copied.'); }));
$('save-solution').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([$('solution').value], { type: ['ocr', 'captcha-text'].includes(lastTask?.type) ? 'text/plain' : 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `recognition.${['ocr', 'captcha-text'].includes(lastTask?.type) ? 'txt' : 'json'}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });

const ruleFields = { name: 'name', origin: 'origin', type: 'type', imageSelector: 'image', inputSelector: 'input', tileSelector: 'tiles', referenceSelector: 'reference', handleSelector: 'handle', prompt: 'prompt', successSelector: 'success', submitSelector: 'submit', rows: 'rows', columns: 'columns', minConfidence: 'confidence', maxAttempts: 'attempts' };
function editRule(rule) { $('rule-id').value = rule.id; for (const [key, suffix] of Object.entries(ruleFields)) $(`rule-${suffix}`).value = rule[key] ?? ''; $('rule-enabled').checked = rule.enabled; $('rule-auto-submit').checked = rule.autoSubmit; $('rule-language').value = rule.settings.language || 'eng'; $('rule-layout').value = rule.settings.mode || 'line'; $('rule-characters').value = rule.settings.characters || 'all'; $('rule-no-spaces').checked = rule.settings.removeSpaces; $('rule-editor').open = true; }
$('rule-reset').addEventListener('click', () => { $('rule-form').reset(); $('rule-id').value = ''; });
$('rule-form').addEventListener('submit', protect(async () => {
  const value = { id: $('rule-id').value, enabled: $('rule-enabled').checked, autoSubmit: $('rule-auto-submit').checked, settings: { language: $('rule-language').value, mode: $('rule-layout').value, characters: $('rule-characters').value, removeSpaces: $('rule-no-spaces').checked } };
  for (const [key, suffix] of Object.entries(ruleFields)) value[key] = $(`rule-${suffix}`).value;
  const rule = validateRule(value);
  for (const key of ['imageSelector', 'inputSelector', 'tileSelector', 'referenceSelector', 'handleSelector', 'submitSelector', 'successSelector']) if (rule[key]) { try { document.querySelector(rule[key]); } catch { throw new Error(`Invalid CSS selector: ${rule[key]}`); } }
  if (rule.enabled && !await api.permissions.request({ origins: [pattern(rule.origin)] })) throw new Error('Site access was not granted.');
  await send({ type: 'SAVE_RULE', rule }); $('rule-id').value = rule.id; notice('Rule saved. Enable automation and reload the target page.'); await refresh();
}));
$('automation-enabled').addEventListener('change', protect(async () => { await send({ type: 'SET_AUTOMATION', enabled: $('automation-enabled').checked }); await refresh(); notice($('automation-enabled').checked ? 'Automation enabled. Reload target pages to attach the rules.' : 'Automation paused.'); }));
async function refresh() {
  const { rules = [], automationEnabled = false, activity = [] } = await api.storage.local.get(['rules', 'automationEnabled', 'activity']);
  $('automation-enabled').checked = automationEnabled; $('automation-state').textContent = automationEnabled ? 'Enabled' : 'Paused'; $('rule-list').replaceChildren();
  if (!rules.length) $('rule-list').append(node('p', 'No rules yet. Create a rule below to get started.', 'muted'));
  for (const rule of rules) { const row = node('article', ''); const description = node('div', ''); description.append(node('h3', rule.name), node('p', `${rule.origin} · ${rule.type} · ${rule.enabled ? 'Enabled' : 'Disabled'}`, 'muted')); const actions = node('div', '', 'button-row'); const edit = node('button', 'Edit', 'secondary'), remove = node('button', 'Delete', 'text-button'); edit.addEventListener('click', () => editRule(rule)); remove.addEventListener('click', protect(async () => { await send({ type: 'DELETE_RULE', id: rule.id }); await refresh(); })); actions.append(edit, remove); row.append(description, actions); $('rule-list').append(row); }
  $('activity-stats').replaceChildren(); for (const [label, state] of [['Recognized', 'recognized'], ['Applied', 'applied'], ['Verified', 'verified'], ['Failed', 'failed']]) { const stat = node('div', '', 'stat'); stat.append(node('b', activity.filter((item) => item.state === state).length), node('span', label)); $('activity-stats').append(stat); }
  $('activity-rows').replaceChildren(); for (const item of activity) { const row = node('tr', ''); for (const value of [new Date(item.at).toLocaleTimeString(), item.site || 'Workbench', item.type, item.state + (item.detail ? ` · ${item.detail}` : ''), `${Math.round(item.confidence * 100)}%`, item.durationMs ? `${(item.durationMs / 1000).toFixed(1)}s` : '—']) row.append(node('td', value)); $('activity-rows').append(row); }
}
$('clear-activity').addEventListener('click', protect(async () => { await send({ type: 'CLEAR_ACTIVITY' }); await refresh(); }));
for (const provider of PROVIDERS) { const row = node('tr', ''); for (const value of [provider.name, 'Selectors available', ['recaptcha-v2', 'hcaptcha'].includes(provider.id) ? 'Image-grid adapter with replacement and multi-round handling; other challenge modes need manual completion' : provider.mode === 'ocr-rule' ? 'OCR rules; configure and verify on your site' : provider.mode === 'provider-token' ? 'Provider-issued token; not implemented locally' : 'Detection + generic image tools; live solving unverified']) row.append(node('td', value)); $('provider-rows').append(row); }
const popular = node('tr', ''); for (const value of ['PopularCaptcha', 'No stable public widget contract', 'Generic grid, points, and boxes; provider adapter not implemented']) popular.append(node('td', value)); $('provider-rows').prepend(popular);
$('service-form').addEventListener('submit', protect(async () => { const endpoint = endpointURL($('service-endpoint').value); if (!await api.permissions.request({ origins: [pattern(endpoint)] })) throw new Error('Service access was not granted.'); await send({ type: 'SAVE_SERVICE', endpoint: endpoint.href, key: $('service-key').value }); notice('Connection saved.'); }));
$('service-test').addEventListener('click', protect(async () => { $('service-result').textContent = 'Connecting…'; try { const health = await send({ type: 'SERVICE_HEALTH' }); $('service-result').textContent = `Connected · v${health.version} · Vision ${health.vision.available ? 'ready' : 'model not available'} · ${health.running} running, ${health.queued} queued`; } catch (error) { $('service-result').textContent = error.message; throw error; } }));
$('proxy-form').addEventListener('submit', protect(async () => { if (!await api.permissions.request({ permissions: ['proxy'] })) throw new Error('Proxy permission was not granted.'); const result = await send({ type: 'PROXY_SAVE', list: $('proxy-list').value }); $('proxy-result').textContent = `Saved ${result.count} proxies. Browser settings are unchanged until you choose Use first.`; }));
for (const [id, type] of [['proxy-apply', 'PROXY_APPLY'], ['proxy-next', 'PROXY_NEXT'], ['proxy-disable', 'PROXY_DISABLE']]) $(id).addEventListener('click', protect(async () => { $('proxy-result').textContent = JSON.stringify(await send({ type }), null, 2); }));
$('proxy-check').addEventListener('click', protect(async () => { const url = new URL($('proxy-url').value); if (url.protocol !== 'https:') throw new Error('Use an HTTPS URL.'); if (!await api.permissions.request({ origins: [pattern(url)] })) throw new Error('Health-check access was not granted.'); $('proxy-result').textContent = JSON.stringify(await send({ type: 'PROXY_CHECK', url: url.href }), null, 2); }));
const { service, proxies } = await api.storage.local.get(['service', 'proxies']); if (service) { $('service-endpoint').value = service.endpoint; $('service-key').value = service.key; } if (proxies) $('proxy-list').value = proxies.join('\n');
const pending = (await api.storage.session.get('visualInput')).visualInput; if (pending) { await api.storage.session.remove('visualInput'); if (Date.now() - pending.createdAt < 600_000) { mainImage = pending.image; $('task-preview').src = mainImage; notice('Captured image ready. Choose a task.'); } }
api.storage.onChanged.addListener((changes, area) => { if (area === 'local' && (changes.activity || changes.rules || changes.automationEnabled)) void refresh(); });
await refresh();
