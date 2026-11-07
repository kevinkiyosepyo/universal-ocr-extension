import { DEFAULTS, LANGUAGES, sanitizeSettings } from './settings.js';
import { cropImage, decodeImage, fileDataURL, rotateImage } from './image.js';
import { recognize } from './ocr.js';

const $ = (id) => document.getElementById(id);
const settingIds = Object.keys(DEFAULTS);
let sourceImage = '', sourcePage = null, sourceName = '';
let busy = false, loading = false, controller;

function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
function settings() {
  return sanitizeSettings(Object.fromEntries(settingIds.map((id) => [id, id === 'removeSpaces' ? $(id).checked : $(id).value])));
}
function refresh() {
  const locked = busy || loading;
  $('recognize').disabled = !sourceImage || locked;
  $('recognize').hidden = busy;
  $('cancel').hidden = !busy;
  $('progress-area').hidden = !busy;
  $('rotate').disabled = !sourceImage || locked;
  $('choose').disabled = locked; $('file').disabled = locked;
  $('dropzone').setAttribute('aria-disabled', String(locked));
  $('clear').disabled = locked || (!sourceImage && !$('result').value);
  settingIds.forEach((id) => { $(id).disabled = locked; });
  $('custom-set').hidden = $('characters').value !== 'custom';
  const text = $('result').value;
  $('copy').disabled = !text.trim() || locked;
  $('download').disabled = !text.trim() || locked;
  $('insert').disabled = !sourcePage || !text.trim() || locked;
  $('insert').title = sourcePage ? 'Choose a field on the source page' : 'Available for text captured from a webpage';
  $('char-count').textContent = `${text.length.toLocaleString()} characters`;
}

async function setSource(image, name, page = null) {
  const decoded = await decodeImage(image);
  sourceImage = image; sourcePage = page; sourceName = name;
  $('preview').src = image; $('preview').hidden = false; $('empty-source').hidden = true;
  $('source-name').textContent = name;
  $('dimensions').textContent = `${decoded.naturalWidth} × ${decoded.naturalHeight}`;
  $('result').value = ''; $('metrics').textContent = '';
  refresh();
}

async function loadFile(file) {
  if (busy || loading || !file) return;
  loading = true; refresh();
  let loaded = false;
  try {
    await setSource(await fileDataURL(file), file.name || 'Pasted image'); loaded = true;
    status('Image ready.');
  } catch (error) { status(error.message, true); }
  finally { loading = false; $('file').value = ''; refresh(); }
  if (loaded) await readText();
}

async function readText() {
  if (!sourceImage || busy || loading) return;
  const options = settings();
  if (options.characters === 'custom' && !options.whitelist) { status('Enter the characters to recognize, or choose Any character.', true); $('whitelist').focus(); return; }
  busy = true; controller = new AbortController(); $('progress').value = 0;
  $('result').value = ''; $('metrics').textContent = ''; refresh();
  const labels = {
    'loading tesseract core': 'Starting the OCR engine',
    'initializing tesseract': 'Starting the OCR engine',
    'loading language traineddata': `Loading ${LANGUAGES[options.language]}`,
    'initializing api': 'Preparing recognition',
    'recognizing text': 'Reading text',
  };
  try {
    const result = await recognize(sourceImage, options, {
      signal: controller.signal,
      onProgress: (progress) => {
        const label = labels[progress.status] || progress.status || 'Reading text';
        const percent = Math.round((progress.progress || 0) * 100);
        status(`${label}${percent > 0 ? ` · ${percent}%` : '…'}`);
        const base = progress.status === 'recognizing text' ? 0.3 : 0;
        $('progress').value = Math.max($('progress').value, base + (progress.progress || 0) * (base ? 0.7 : 0.25));
      },
    });
    $('result').value = result.text;
    $('metrics').textContent = `${result.confidence}% confidence · ${(result.elapsedMs / 1000).toFixed(1)}s`;
    status(result.text
      ? (result.confidence < 65 ? 'Some text may be uncertain. Review the result, or try another layout or cleanup setting.' : 'Text is ready. Edit it, copy it, or insert it into the source page.')
      : 'No text found. Try a tighter crop, Single line layout, or a different image cleanup setting.');
  } catch (error) { status(error.message || 'Recognition failed. Please retry.', !controller.signal.aborted); }
  finally { busy = false; controller = null; refresh(); }
}

$('recognize').addEventListener('click', readText);
$('cancel').addEventListener('click', () => controller?.abort(new Error('Recognition cancelled. You can try again.')));
$('result').addEventListener('input', refresh);
$('choose').addEventListener('click', () => $('file').click());
$('dropzone').addEventListener('click', () => { if (!busy && !loading) $('file').click(); });
$('dropzone').addEventListener('keydown', (event) => {
  if (['Enter', ' '].includes(event.key) && !busy && !loading) { event.preventDefault(); $('file').click(); }
});
$('file').addEventListener('change', () => loadFile($('file').files[0]));
document.addEventListener('paste', (event) => {
  const file = [...(event.clipboardData?.files || [])].find((item) => item.type.startsWith('image/'));
  if (file) { event.preventDefault(); void loadFile(file); }
});
document.addEventListener('dragover', (event) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
document.addEventListener('drop', (event) => { if (event.dataTransfer?.files.length) event.preventDefault(); });
$('dropzone').addEventListener('dragover', (event) => { event.preventDefault(); if (!busy) $('dropzone').classList.add('dragging'); });
$('dropzone').addEventListener('dragleave', () => $('dropzone').classList.remove('dragging'));
$('dropzone').addEventListener('drop', (event) => {
  event.preventDefault(); $('dropzone').classList.remove('dragging');
  if (event.dataTransfer.files.length > 1) status('Reading the first image. Choose images one at a time.');
  void loadFile(event.dataTransfer.files[0]);
});
$('rotate').addEventListener('click', async () => {
  if (busy || loading || !sourceImage) return;
  loading = true; refresh();
  try { await setSource(await rotateImage(sourceImage), sourceName, sourcePage); status('Image rotated. Select Read text to recognize it again.'); }
  catch (error) { status(error.message, true); }
  finally { loading = false; refresh(); }
});
$('clear').addEventListener('click', () => {
  if (busy || loading) return;
  sourceImage = ''; sourcePage = null; sourceName = '';
  $('preview').removeAttribute('src'); $('preview').hidden = true; $('empty-source').hidden = false;
  $('source-name').textContent = 'No image selected'; $('dimensions').textContent = '';
  $('result').value = ''; $('metrics').textContent = ''; refresh(); status('Workspace cleared.');
});
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('result').value); status('Text copied to clipboard.'); }
  catch { $('result').focus(); $('result').select(); status('Press Ctrl+C or ⌘C to copy the selected text.'); }
});
$('download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([$('result').value], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'recognized-text.txt'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000); status('Text file saved.');
});
$('insert').addEventListener('click', async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'INSERT_TEXT', source: sourcePage, text: $('result').value });
    if (!response?.ok) throw new Error(response?.error || 'Could not open the source page.');
    status('Choose a text field on the source page. Press Esc there to cancel.');
  } catch (error) { status(error.message, true); }
});
for (const id of settingIds) {
  $(id).addEventListener(id === 'whitelist' ? 'input' : 'change', () => {
    refresh();
    void chrome.storage.local.set({ settings: settings() }).catch(() => status('Settings could not be saved. They still apply in this tab.', true));
  });
}

async function init() {
  loading = true; refresh();
  try {
    const stored = sanitizeSettings((await chrome.storage.local.get('settings')).settings);
    for (const id of settingIds) { if (id === 'removeSpaces') $(id).checked = stored[id]; else $(id).value = stored[id]; }
    const captureId = location.hash.slice(1);
    const initialError = new URL(location.href).searchParams.get('error');
    if (initialError) status(initialError, true);
    if (captureId) {
      const response = await chrome.runtime.sendMessage({ type: 'CLAIM_CAPTURE', id: captureId });
      if (!response?.ok) throw new Error(response?.error || 'Capture unavailable.');
      const capture = response.value;
      await setSource(await cropImage(capture.image, capture.crop, capture.viewport), capture.source.title, capture.source);
      history.replaceState(null, '', location.pathname);
    }
  } catch (error) { status(error.message, true); }
  finally { loading = false; refresh(); }
  if (sourceImage) await readText();
}
void init();
