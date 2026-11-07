export const LANGUAGES = {
  eng: 'English', spa: 'Spanish', fra: 'French', deu: 'German',
  jpn: 'Japanese', kor: 'Korean', chi_sim: 'Chinese (simplified)',
};

export const DEFAULTS = Object.freeze({
  language: 'eng', mode: 'sparse', processing: 'auto',
  characters: 'all', whitelist: '', removeSpaces: false,
});

export function sanitizeSettings(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  return {
    language: Object.hasOwn(LANGUAGES, value.language) ? value.language : 'eng',
    mode: ['sparse', 'block', 'line', 'word'].includes(value.mode) ? value.mode : 'sparse',
    processing: ['auto', 'original', 'contrast'].includes(value.processing) ? value.processing : 'auto',
    characters: ['all', 'digits', 'alphanumeric', 'custom'].includes(value.characters) ? value.characters : 'all',
    whitelist: typeof value.whitelist === 'string' ? value.whitelist.slice(0, 256) : '',
    removeSpaces: value.removeSpaces === true,
  };
}

export function recognitionParameters(settings) {
  const clean = sanitizeSettings(settings);
  const allowed = {
    all: '', digits: '0123456789',
    alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    custom: clean.whitelist,
  };
  return {
    tessedit_pageseg_mode: { sparse: '11', block: '6', line: '7', word: '8' }[clean.mode],
    tessedit_char_whitelist: allowed[clean.characters],
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
  };
}

export function cleanText(text, settings) {
  const normalized = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  return settings.removeSpaces ? normalized.replace(/\s+/gu, '') : normalized;
}
