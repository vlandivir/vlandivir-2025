const SF = window.SubsFonts;
const DB_NAME = SF.DB_NAME;
const VIDEO_STORE = SF.VIDEO_STORE;
const STYLE_STORE = SF.STYLE_STORE;
const CUE_STORE = SF.CUE_STORE;
const POSITION_STORE = SF.POSITION_STORE;
const DEFAULT_POSITIONS = [
  { id: 'position-bottom-center', name: 'Снизу по центру', x: 540, y: 1700, alignment: 2, legacy: 'bottom-center' },
  { id: 'position-bottom-left', name: 'Снизу слева', x: 140, y: 1700, alignment: 1, legacy: 'bottom-left' },
  { id: 'position-top-center', name: 'Сверху по центру', x: 540, y: 220, alignment: 8, legacy: 'top-center' },
  { id: 'position-middle-center', name: 'По центру кадра', x: 540, y: 960, alignment: 5, legacy: 'middle-center' },
];
const SUBS_ASSET_BASE_URL = new URL(
  '.',
  document.currentScript?.src || window.location.href,
);
const JASSUB_MODULE_URL = new URL(
  'vendor/jassub/jassub.js',
  SUBS_ASSET_BASE_URL,
).href;
const JASSUB_WORKER_URL = new URL(
  'vendor/jassub/worker/worker.js',
  SUBS_ASSET_BASE_URL,
).href;
const JASSUB_WASM_URL = new URL(
  'vendor/jassub/wasm/jassub-worker.wasm',
  SUBS_ASSET_BASE_URL,
).href;
const JASSUB_MODERN_WASM_URL = new URL(
  'vendor/jassub/wasm/jassub-worker-modern.wasm',
  SUBS_ASSET_BASE_URL,
).href;
const SUBS_FONTS_BASE_URL = new URL('fonts/', SUBS_ASSET_BASE_URL);
const JASSUB_DEFAULT_FONT_URL = new URL(
  'vendor/jassub/default.woff2',
  SUBS_ASSET_BASE_URL,
).href;
const STYLE_PREVIEW_TEXT = 'Preview Превью Događaj';

function subsFontUrl(fileName) {
  return new URL(fileName, SUBS_FONTS_BASE_URL).href;
}

const SUBTITLE_FONTS = SF.SUBTITLE_FONTS;
const BUNDLED_FONT_FAMILIES = SF.VALID_FAMILIES;

let enabledFontFamilies = [...SF.DEFAULT_ENABLED_FAMILIES];

function getPickerSubtitleFonts() {
  return SF.getFontsForFamilies(enabledFontFamilies);
}

function getJassubSubtitleFonts() {
  const usedFamilies = cachedStyles
    .map((style) => style.font)
    .filter((font) => typeof font === 'string' && font.trim());
  const families = [...new Set([...enabledFontFamilies, ...usedFamilies])];
  return SF.getFontsForFamilies(families);
}

function buildJassubFontConfig() {
  const availableFonts = { 'liberation sans': JASSUB_DEFAULT_FONT_URL };

  for (const font of getJassubSubtitleFonts()) {
    const family = font.family.toLowerCase();
    availableFonts[family] = subsFontUrl(font.regular);
    availableFonts[`${family} bold`] = subsFontUrl(font.bold);
  }

  return {
    availableFonts,
    fonts: [...new Set(Object.values(availableFonts))],
  };
}

async function loadEnabledFontFamilies() {
  enabledFontFamilies = await SF.readEnabledFontFamilies();
}

function populateStyleFontOptions() {
  if (!styleFontInput) return;

  const currentValue = styleFontInput.value;
  const pickerFonts = getPickerSubtitleFonts().sort((a, b) =>
    a.family.localeCompare(b.family, 'ru', { sensitivity: 'base' }),
  );
  styleFontInput.replaceChildren();

  if (pickerFonts.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Выберите шрифты на /font';
    option.disabled = true;
    option.selected = true;
    styleFontInput.append(option);
    styleFontInput.disabled = true;
    return;
  }

  styleFontInput.disabled = false;

  for (const font of pickerFonts) {
    const option = document.createElement('option');
    option.value = font.family;
    option.textContent = font.family;
    styleFontInput.append(option);
  }

  const hasCurrent = pickerFonts.some((font) => font.family === currentValue);
  const fallback = pickerFonts.some((font) => font.family === 'Montserrat')
    ? 'Montserrat'
    : pickerFonts[0].family;
  styleFontInput.value = hasCurrent ? currentValue : fallback;
}

async function reloadFontPickerFromDb() {
  const previous = enabledFontFamilies.join('\0');
  await loadEnabledFontFamilies();
  if (previous === enabledFontFamilies.join('\0')) return;

  populateStyleFontOptions();
  await destroyJassubRenderer();
  await renderJassubPreview();
}

const BASE_COLORS = [
  { name: 'Белый и черный', value: '#ffffff', split: true },
  { name: 'Желтый', value: '#eab308' },
  { name: 'Теплый', value: '#e07a5f' },
  { name: 'Красный', value: '#ef4444' },
  { name: 'Оранжевый', value: '#f97316' },
  { name: 'Зеленый', value: '#22c55e' },
  { name: 'Синий', value: '#3b82f6' },
  { name: 'Фиолетовый', value: '#8b5cf6' },
  { name: 'Розовый', value: '#ec4899' },
];
const VIDEO_ICONS = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7z" /><path d="M13 5h4v14h-4z" /></svg>',
  volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16 9a4 4 0 0 1 0 6" /></svg>',
  muted: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="m17 9 4 4" /><path d="m21 9-4 4" /></svg>',
};
const EDIT_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" />
    <path d="m14 7 3 3" />
  </svg>
`;

const form = document.querySelector('#uploadForm');
const input = document.querySelector('#videoInput');
const fileMeta = document.querySelector('#fileMeta');
const uploadButton = document.querySelector('#uploadButton');
const uploadStatus = document.querySelector('#uploadStatus');
const progress = document.querySelector('#uploadProgress');
const progressBar = document.querySelector('#uploadProgressBar');
const linksList = document.querySelector('#linksList');
const emptyState = document.querySelector('#emptyState');
const clearLinksButton = document.querySelector('#clearLinksButton');
const currentVideoSection = document.querySelector('#currentVideoSection');
const currentVideo = document.querySelector('#currentVideo');
const currentVideoMeta = document.querySelector('#currentVideoMeta');
const videoSubtitleOverlay = document.querySelector('#videoSubtitleOverlay');
const videoPlayButton = document.querySelector('#videoPlayButton');
const videoSeekInput = document.querySelector('#videoSeekInput');
const videoTimeLabel = document.querySelector('#videoTimeLabel');
const videoMuteButton = document.querySelector('#videoMuteButton');
const styleForm = document.querySelector('#styleForm');
const styleNameInput = document.querySelector('#styleNameInput');
const styleLivePreviewText = document.querySelector('#styleLivePreviewText');
const styleLivePreviewMeta = document.querySelector('#styleLivePreviewMeta');
const styleLivePreviewColors = document.querySelector('#styleLivePreviewColors');
const styleFontInput = document.querySelector('#styleFontInput');
const styleFontSizeInput = document.querySelector('#styleFontSizeInput');
const styleFontVariantInput = document.querySelector('#styleFontVariantInput');
const stylePrimaryColorInput = document.querySelector('#stylePrimaryColorInput');
const styleSecondaryColorInput = document.querySelector('#styleSecondaryColorInput');
const styleOutlineColorInput = document.querySelector('#styleOutlineColorInput');
const styleBackColorInput = document.querySelector('#styleBackColorInput');
const stylePositionInput = document.querySelector('#stylePositionInput');
const styleSubmitButton = document.querySelector('#styleSubmitButton');
const cancelStyleEditButton = document.querySelector('#cancelStyleEditButton');
const styleList = document.querySelector('#styleList');
const stylesEmptyState = document.querySelector('#stylesEmptyState');
const positionForm = document.querySelector('#positionForm');
const positionNameInput = document.querySelector('#positionNameInput');
const positionXInput = document.querySelector('#positionXInput');
const positionYInput = document.querySelector('#positionYInput');
const positionAlignmentInput = document.querySelector('#positionAlignmentInput');
const alignControlButtons = document.querySelectorAll('[data-align-cell]');
const positionSubmitButton = document.querySelector('#positionSubmitButton');
const cancelPositionEditButton = document.querySelector('#cancelPositionEditButton');
const positionList = document.querySelector('#positionList');
const positionsEmptyState = document.querySelector('#positionsEmptyState');
const cueForm = document.querySelector('#cueForm');
const cueTextInput = document.querySelector('#cueTextInput');
const cueStartInput = document.querySelector('#cueStartInput');
const cueEndInput = document.querySelector('#cueEndInput');
const cueStyleInput = document.querySelector('#cueStyleInput');
const cueMotionDxInput = document.querySelector('#cueMotionDxInput');
const cueMotionDyInput = document.querySelector('#cueMotionDyInput');
const cueMotionStartMsInput = document.querySelector('#cueMotionStartMsInput');
const cueMotionMsInput = document.querySelector('#cueMotionMsInput');
const cueSubmitButton = document.querySelector('#cueSubmitButton');
const cancelCueEditButton = document.querySelector('#cancelCueEditButton');
const cueList = document.querySelector('#cueList');
const cuesEmptyState = document.querySelector('#cuesEmptyState');
const previewMeta = document.querySelector('#previewMeta');
const assOutput = document.querySelector('#assOutput');
const downloadAssButton = document.querySelector('#downloadAssButton');
const refreshPreviewButton = document.querySelector('#refreshPreviewButton');

let cachedStyles = [];
let cachedCues = [];
let cachedPositions = [];
let jassubModulePromise;
let jassubRenderer;
let jassubTrack = '';
let jassubRenderToken = 0;
let useDomSubtitleFallback = false;
let editingStyleId;
let editingCueId;
let editingPositionId;

function openDb() {
  return SF.openDb();
}

async function readStore(storeName) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putRecord(storeName, record) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function deleteRecord(storeName, id) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function clearStore(storeName) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function readVideos() {
  const videos = await readStore(VIDEO_STORE);
  return videos.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function saveVideo(video) {
  return putRecord(VIDEO_STORE, video);
}

function clearVideos() {
  return clearStore(VIDEO_STORE);
}

async function readStyles() {
  const styles = await readStore(STYLE_STORE);
  return styles.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function saveStyle(style) {
  return putRecord(STYLE_STORE, style);
}

function deleteStyle(id) {
  return deleteRecord(STYLE_STORE, id);
}

async function readPositions() {
  const positions = await readStore(POSITION_STORE);
  return positions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function savePosition(position) {
  return putRecord(POSITION_STORE, position);
}

function deletePosition(id) {
  return deleteRecord(POSITION_STORE, id);
}

async function readCues() {
  const cues = await readStore(CUE_STORE);
  return cues.sort((a, b) => parseTimeToSeconds(a.start) - parseTimeToSeconds(b.start));
}

function saveCue(cue) {
  return putRecord(CUE_STORE, cue);
}

function deleteCue(id) {
  return deleteRecord(CUE_STORE, id);
}

function createId(prefix) {
  if (window.crypto?.randomUUID) {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const unit = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** unit;
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function renderVideos(videos) {
  linksList.replaceChildren();
  emptyState.hidden = videos.length > 0;
  clearLinksButton.hidden = videos.length === 0;

  for (const video of videos) {
    const item = document.createElement('article');
    item.className = 'link-item';

    const title = document.createElement('h3');
    title.textContent = video.originalName || video.hash;

    const meta = document.createElement('p');
    const createdAt = new Date(video.createdAt).toLocaleString('ru-RU');
    meta.textContent = `${createdAt} · ${formatBytes(video.size)} · ${
      video.mimeType || 'video'
    }`;

    const pageLink = document.createElement('a');
    pageLink.className = 'link-item__url';
    pageLink.href = video.pageUrl;
    pageLink.textContent =
      video.absolutePageUrl || new URL(video.pageUrl, window.location.origin).href;

    const videoLink = document.createElement('a');
    videoLink.className = 'secondary-link link-item__video';
    videoLink.href = video.videoUrl;
    videoLink.target = '_blank';
    videoLink.rel = 'noopener noreferrer';
    videoLink.textContent = 'Открыть файл';

    item.append(title, meta, pageLink, videoLink);
    linksList.append(item);
  }
}

function positionLabel(position) {
  if (!position) return 'Снизу по центру';
  if (typeof position === 'object') return `${position.name} · ${position.x}, ${position.y}`;

  const matchedPosition = getPositionById(position) || getPositionByLegacy(position);
  return matchedPosition
    ? `${matchedPosition.name} · ${matchedPosition.x}, ${matchedPosition.y}`
    : position;
}

function getStyleById(id) {
  return cachedStyles.find((style) => style.id === id);
}

function getPositionById(id) {
  return cachedPositions.find((position) => position.id === id);
}

function getPositionByLegacy(legacy) {
  return cachedPositions.find((position) => position.legacy === legacy);
}

function defaultPosition() {
  return cachedPositions[0] || DEFAULT_POSITIONS[0];
}

function parseTimeToSeconds(value) {
  const trimmed = value.trim().replace(',', '.');
  if (/^\d+(?:\.\d{1,3})?$/.test(trimmed)) {
    return Number(trimmed);
  }

  const match = trimmed.match(/^(?:(\d+):)?([0-5]?\d):([0-5]?\d(?:\.\d{1,3})?)$/);
  if (!match) return Number.NaN;

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  return hours * 3600 + minutes * 60 + seconds;
}

function formatTimeInput(value) {
  const seconds = parseTimeToSeconds(value);
  if (!Number.isFinite(seconds)) return value.trim();

  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function formatAssTime(value) {
  const totalSeconds = parseTimeToSeconds(value);
  if (!Number.isFinite(totalSeconds)) return value.trim();

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`;
}

function formatVideoTime(value) {
  if (!Number.isFinite(value)) return '0:00';

  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function isNoneColor(color) {
  return color === 'none';
}

function colorToAss(color) {
  if (isNoneColor(color)) return '&HFF000000';

  const normalized = color.replace('#', '').padStart(6, '0');
  const red = normalized.slice(0, 2);
  const green = normalized.slice(2, 4);
  const blue = normalized.slice(4, 6);
  return `&H00${blue}${green}${red}`.toUpperCase();
}

function hexToRgb(hex) {
  const normalized = hex.replace('#', '').padStart(6, '0');
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function rgbToHex([red, green, blue]) {
  return `#${[red, green, blue]
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

function mixColor(color, target, amount) {
  const sourceRgb = hexToRgb(color);
  const targetRgb = hexToRgb(target);
  return rgbToHex(
    sourceRgb.map((channel, index) => channel + (targetRgb[index] - channel) * amount),
  );
}

function isAchromaticColor(color) {
  const [red, green, blue] = hexToRgb(color);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  return max - min < 24;
}

function getShades(baseColor) {
  if (baseColor === '#ffffff' || baseColor === '#000000') {
    return [
      '#ffffff',
      '#e0e0e0',
      '#c2c2c2',
      '#a3a3a3',
      '#858585',
      '#666666',
      '#474747',
      '#292929',
      '#000000',
    ];
  }

  if (baseColor === '#eab308') {
    return [
      '#fefce8',
      '#fef9c3',
      '#fef08a',
      '#fde047',
      '#facc15',
      '#eab308',
      '#ca8a04',
      '#a16207',
      '#713f12',
    ];
  }

  if (baseColor === '#e07a5f') {
    return [
      '#fff1eb',
      '#ffe0d4',
      '#ffcbb8',
      '#f5a88a',
      '#ec9274',
      '#e07a5f',
      '#c4614a',
      '#a34d3b',
      '#7d3a2d',
    ];
  }

  return [
    mixColor(baseColor, '#ffffff', 0.72),
    mixColor(baseColor, '#ffffff', 0.55),
    mixColor(baseColor, '#ffffff', 0.38),
    mixColor(baseColor, '#ffffff', 0.2),
    baseColor,
    mixColor(baseColor, '#000000', 0.16),
    mixColor(baseColor, '#000000', 0.32),
    mixColor(baseColor, '#000000', 0.48),
    mixColor(baseColor, '#000000', 0.64),
  ];
}

function findClosestBaseColor(color) {
  if (!color || isNoneColor(color)) return BASE_COLORS[0];
  if (isAchromaticColor(color)) return BASE_COLORS[0];

  const rgb = hexToRgb(color);
  return BASE_COLORS.reduce((closest, baseColor) => {
    const baseRgb = hexToRgb(baseColor.value);
    const distance = baseRgb.reduce((sum, channel, index) => {
      const delta = channel - rgb[index];
      return sum + delta * delta;
    }, 0);
    return distance < closest.distance ? { baseColor, distance } : closest;
  }, { baseColor: BASE_COLORS[0], distance: Number.POSITIVE_INFINITY }).baseColor;
}

function setColorInputValue(input, value) {
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function closeColorPicker(pickerElement) {
  if (!pickerElement) return;
  pickerElement.classList.remove('is-open');
  pickerElement
    .querySelector('.color-picker__trigger')
    ?.setAttribute('aria-expanded', 'false');
}

function closeOtherColorPickers(activePicker) {
  document.querySelectorAll('.color-picker.is-open').forEach((picker) => {
    if (picker !== activePicker) {
      closeColorPicker(picker);
    }
  });
}

function closeAllColorPickers() {
  document.querySelectorAll('.color-picker.is-open').forEach(closeColorPicker);
}

function initializeColorPickers() {
  const pickerElements = document.querySelectorAll('[data-color-picker]');

  for (const pickerElement of pickerElements) {
    const input = document.querySelector(`#${pickerElement.dataset.colorPicker}`);
    if (!input) continue;

    const allowNone = pickerElement.dataset.allowNone === 'true';
    let selectedBase = findClosestBaseColor(input.value);

    const triggerButton = document.createElement('button');
    triggerButton.className = 'color-picker__trigger';
    triggerButton.type = 'button';
    triggerButton.setAttribute('aria-expanded', 'false');

    const selectedSwatch = document.createElement('span');
    selectedSwatch.className = 'color-picker__selected-swatch';

    const selectedLabel = document.createElement('span');
    selectedLabel.className = 'color-picker__selected-label';

    triggerButton.append(selectedSwatch, selectedLabel);

    const panel = document.createElement('div');
    panel.className = 'color-picker__panel';

    const baseGrid = document.createElement('div');
    baseGrid.className = 'color-picker__grid';

    const shadeGrid = document.createElement('div');
    shadeGrid.className = 'color-picker__grid color-picker__grid--shades';

    const resetButton = document.createElement('button');
    resetButton.className = 'color-picker__reset';
    resetButton.type = 'button';
    resetButton.title = 'Не рисовать';
    resetButton.setAttribute('aria-label', 'Не рисовать');
    resetButton.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </svg>
    `;
    resetButton.addEventListener('click', (event) => {
      event.stopPropagation();
      setColorInputValue(input, 'none');
      renderPicker();
    });

    panel.append(baseGrid, shadeGrid);
    if (allowNone) {
      const pickerRow = document.createElement('div');
      pickerRow.className = 'color-picker__row';
      pickerRow.append(triggerButton, resetButton);
      pickerElement.append(pickerRow, panel);
    } else {
      pickerElement.append(triggerButton, panel);
    }

    triggerButton.addEventListener('click', (event) => {
      event.stopPropagation();
      closeOtherColorPickers(pickerElement);
      pickerElement.classList.add('is-open');
      triggerButton.setAttribute('aria-expanded', 'true');
    });

    pickerElement.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    function renderButton(color, label, onClick, isActive, options = {}) {
      const button = document.createElement('button');
      button.className = 'color-picker__swatch';
      button.type = 'button';
      button.title = options.split ? `${label} — белый и черный` : label;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      if (options.split) {
        button.classList.add('color-picker__swatch--split');
      } else {
        button.style.background = color;
      }
      if (isActive) button.classList.add('is-active');
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        onClick();
      });
      button.addEventListener('dblclick', (event) => {
        event.stopPropagation();
        event.preventDefault();
        onClick();
        closeColorPicker(pickerElement);
      });
      return button;
    }

    function renderPicker() {
      const value = input.value;
      const isNone = isNoneColor(value);
      const shades = getShades(selectedBase.value);

      selectedSwatch.style.background = isNone ? 'transparent' : value;
      selectedSwatch.classList.toggle('is-none', isNone);
      selectedLabel.textContent = isNone ? 'не рисовать' : value.toUpperCase();
      triggerButton.setAttribute('aria-label', `Выбрать цвет: ${selectedLabel.textContent}`);
      resetButton.classList.toggle('is-active', isNone);

      baseGrid.replaceChildren(
        ...BASE_COLORS.map((baseColor) =>
          renderButton(
            baseColor.value,
            baseColor.name,
            () => {
              selectedBase = baseColor;
              setColorInputValue(input, baseColor.value);
              renderPicker();
            },
            !isNone && selectedBase.value === baseColor.value,
            { split: baseColor.split },
          ),
        ),
      );

      shadeGrid.replaceChildren(
        ...shades.map((shade, index) =>
          renderButton(
            shade,
            `Оттенок ${index + 1}`,
            () => {
              setColorInputValue(input, shade);
              renderPicker();
            },
            !isNone && value.toLowerCase() === shade,
          ),
        ),
      );
    }

    input.addEventListener('change', () => {
      selectedBase = findClosestBaseColor(input.value);
      renderPicker();
    });
    renderPicker();
  }

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.color-picker')) return;
    closeAllColorPickers();
  });
}

function escapeAssText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\\n/g, '\\N')
    .split('\n')
    .join('\\N');
}

function stripAssMarkup(text) {
  return String(text || '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\N/g, '\n')
    .replace(/\\n/g, '\n')
    .trim();
}

function sanitizeAssName(name) {
  return name.replace(/,/g, ' ').trim() || 'Default';
}

function normalizeCueMotion(cue) {
  if (!cue) return null;

  const motionMs = Math.round(Number(cue.motionMs));
  const motionStartMs = Math.max(0, Math.round(Number(cue.motionStartMs) || 0));
  const motionDx = Math.round(Number(cue.motionDx) || 0);
  const motionDy = Math.round(Number(cue.motionDy) || 0);

  if (!Number.isFinite(motionMs) || motionMs <= 0) return null;
  if (motionDx === 0 && motionDy === 0) return null;

  return { motionDx, motionDy, motionStartMs, motionMs };
}

function readCueMotionFromForm() {
  const motionMs = Math.round(Number(cueMotionMsInput?.value));
  const motionStartMs = Math.max(0, Math.round(Number(cueMotionStartMsInput?.value) || 0));
  const motionDx = Math.round(Number(cueMotionDxInput?.value) || 0);
  const motionDy = Math.round(Number(cueMotionDyInput?.value) || 0);

  if (!Number.isFinite(motionMs) || motionMs <= 0) {
    return {
      motionDx: 0,
      motionDy: 0,
      motionStartMs: 0,
      motionMs: 0,
    };
  }

  return { motionDx, motionDy, motionStartMs, motionMs };
}

function formatCueMotionLabel(cue) {
  const motion = normalizeCueMotion(cue);
  if (!motion) return '';

  const endMs = motion.motionStartMs + motion.motionMs;
  return ` · move Δ${motion.motionDx},${motion.motionDy} ${motion.motionStartMs}→${endMs}мс`;
}

function buildCuePositionPrefix(style, cue) {
  const x = Math.round(style.position.x);
  const y = Math.round(style.position.y);
  const motion = normalizeCueMotion(cue);

  if (!motion) {
    return `{\\pos(${x},${y})}`;
  }

  const endX = x + motion.motionDx;
  const endY = y + motion.motionDy;
  const moveStartMs = motion.motionStartMs;
  const moveEndMs = motion.motionStartMs + motion.motionMs;
  return `{\\move(${x},${y},${endX},${endY},${moveStartMs},${moveEndMs})}`;
}

function setCurrentVideoMetaLink(url, fallbackText = '') {
  if (!currentVideoMeta) return;

  if (!url) {
    currentVideoMeta.removeAttribute('href');
    currentVideoMeta.textContent = fallbackText;
    currentVideoMeta.hidden = !fallbackText;
    return;
  }

  currentVideoMeta.href = url;
  currentVideoMeta.textContent = url;
  currentVideoMeta.hidden = false;
}

function formatPreviewFontFamily(fontName) {
  const family = (fontName || 'Montserrat').trim();
  if (!BUNDLED_FONT_FAMILIES.has(family)) {
    return `${family}, Montserrat, sans-serif`;
  }

  return `"${family}", Montserrat, sans-serif`;
}

function normalizeFontVariant(value) {
  if (value === 'regular' || value === 'bold' || value === 'italic') {
    return value;
  }

  return 'regular';
}

function fontVariantLabel(value) {
  return {
    regular: 'Regular',
    bold: 'Bold',
    italic: 'Italic',
  }[normalizeFontVariant(value)];
}

function normalizeStyle(style) {
  const primaryColor = style.primaryColor || style.color || '#ffffff';
  const resolvedPosition =
    getPositionById(style.positionId) ||
    getPositionByLegacy(style.position) ||
    defaultPosition();

  return {
    ...style,
    name: style.name || 'Default',
    font: style.font || 'Montserrat',
    fontSize: Number(style.fontSize) || 72,
    fontVariant: normalizeFontVariant(style.fontVariant),
    primaryColor: isNoneColor(primaryColor) ? '#ffffff' : primaryColor,
    secondaryColor: style.secondaryColor ?? '#000000',
    outlineColor: style.outlineColor ?? '#10181c',
    backColor: style.backColor ?? '#000000',
    positionId: resolvedPosition.id,
    position: resolvedPosition,
  };
}

function applySubtitlePreviewStyle(element, style, scale = 1) {
  const normalizedStyle = normalizeStyle(style || {});
  const fontSize = Math.max(14, Math.round(normalizedStyle.fontSize * scale));
  const shadows = [];

  element.style.color = normalizedStyle.primaryColor;
  element.style.fontFamily = formatPreviewFontFamily(normalizedStyle.font);
  element.style.fontSize = `${fontSize}px`;
  element.style.fontStyle = normalizedStyle.fontVariant === 'italic' ? 'italic' : 'normal';
  element.style.fontWeight = normalizedStyle.fontVariant === 'bold' ? '900' : '400';
  element.style.background = isNoneColor(normalizedStyle.backColor)
    ? 'transparent'
    : normalizedStyle.backColor;
  element.style.padding = isNoneColor(normalizedStyle.backColor) ? '0' : '0.08em 0.18em';
  element.style.borderRadius = isNoneColor(normalizedStyle.backColor) ? '0' : '4px';

  if (!isNoneColor(normalizedStyle.outlineColor)) {
    const outlineSize = Math.max(1, Math.round(fontSize / 18));
    shadows.push(
      `${outlineSize}px 0 0 ${normalizedStyle.outlineColor}`,
      `-${outlineSize}px 0 0 ${normalizedStyle.outlineColor}`,
      `0 ${outlineSize}px 0 ${normalizedStyle.outlineColor}`,
      `0 -${outlineSize}px 0 ${normalizedStyle.outlineColor}`,
      `${outlineSize}px ${outlineSize}px 0 ${normalizedStyle.outlineColor}`,
    );
  }

  if (!isNoneColor(normalizedStyle.backColor)) {
    shadows.push(`0 ${Math.max(1, Math.round(fontSize / 12))}px 0 rgba(0, 0, 0, 0.28)`);
  }

  element.style.textShadow = shadows.join(', ');
}

function readStyleFormDraft() {
  return normalizeStyle({
    name: styleNameInput.value.trim() || 'Default',
    font: styleFontInput.value || 'Montserrat',
    fontSize: Number(styleFontSizeInput.value) || 72,
    fontVariant: styleFontVariantInput.value,
    primaryColor: stylePrimaryColorInput.value,
    secondaryColor: styleSecondaryColorInput.value,
    outlineColor: styleOutlineColorInput.value,
    backColor: styleBackColorInput.value,
    positionId: stylePositionInput.value || defaultPosition().id,
  });
}

function createStylePreviewColor(label, value) {
  const item = document.createElement('span');
  item.className = 'style-live-preview__color';

  const swatch = document.createElement('span');
  swatch.className = 'style-live-preview__swatch';
  swatch.classList.toggle('is-none', isNoneColor(value));
  swatch.style.background = isNoneColor(value) ? 'transparent' : value;

  const text = document.createElement('span');
  text.textContent = `${label}: ${isNoneColor(value) ? 'none' : value.toUpperCase()}`;

  item.append(swatch, text);
  return item;
}

function renderStyleLivePreview() {
  if (!styleLivePreviewText || !styleLivePreviewMeta || !styleLivePreviewColors) return;

  const style = readStyleFormDraft();
  styleLivePreviewText.textContent = STYLE_PREVIEW_TEXT;
  applySubtitlePreviewStyle(styleLivePreviewText, style, 0.42);
  styleLivePreviewMeta.textContent = `${style.font} · ${fontVariantLabel(style.fontVariant)} · ${style.fontSize}px`;
  styleLivePreviewColors.replaceChildren(
    createStylePreviewColor('Primary', style.primaryColor),
    createStylePreviewColor('Secondary', style.secondaryColor),
    createStylePreviewColor('Outline', style.outlineColor),
    createStylePreviewColor('Back', style.backColor),
  );
}

function renderAlignControl() {
  const selectedAlign = positionAlignmentInput.value || '2';
  alignControlButtons.forEach((button) => {
    const isActive = button.dataset.alignCell === selectedAlign;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function generateAss() {
  const styles = cachedStyles.length
    ? cachedStyles
    : [
        {
          id: 'default',
          name: 'Default',
          font: 'Montserrat',
          fontSize: 72,
          fontVariant: 'regular',
          primaryColor: '#ffffff',
          secondaryColor: '#000000',
          outlineColor: '#10181c',
          backColor: '#000000',
          positionId: defaultPosition().id,
        },
      ];

  const styleLines = styles.map((rawStyle) => {
    const style = normalizeStyle(rawStyle);
    const name = sanitizeAssName(style.name);
    return [
      `Style: ${name}`,
      style.font,
      style.fontSize,
      colorToAss(style.primaryColor),
      colorToAss(style.secondaryColor),
      colorToAss(style.outlineColor),
      colorToAss(style.backColor),
      style.fontVariant === 'bold' ? -1 : 0,
      style.fontVariant === 'italic' ? -1 : 0,
      0,
      0,
      100,
      100,
      0,
      0,
      1,
      isNoneColor(style.outlineColor) ? 0 : 4,
      isNoneColor(style.backColor) ? 0 : 2,
      24,
      24,
      120,
      style.position.alignment,
      1,
    ].join(',');
  });

  const cueLines = cachedCues.map((cue) => {
    const style = normalizeStyle(getStyleById(cue.styleId) || {});
    const positionPrefix = buildCuePositionPrefix(style, cue);
    return [
      'Dialogue: 0',
      formatAssTime(cue.start),
      formatAssTime(cue.end),
      sanitizeAssName(style.name),
      '',
      0,
      0,
      0,
      '',
      `${positionPrefix}${escapeAssText(cue.text)}`,
    ].join(',');
  });

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'PlayResX: 1080',
    'PlayResY: 1920',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, MarginL, MarginR, MarginV, Alignment, Encoding',
    ...styleLines,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...cueLines,
    '',
  ].join('\n');
}

function renderStyleOptions() {
  cueStyleInput.replaceChildren();

  for (const style of cachedStyles) {
    const option = document.createElement('option');
    option.value = style.id;
    option.textContent = style.name;
    cueStyleInput.append(option);
  }

  cueStyleInput.disabled = cachedStyles.length === 0;
}

function renderPositionOptions() {
  const currentValue = stylePositionInput.value;
  stylePositionInput.replaceChildren();

  for (const position of cachedPositions) {
    const option = document.createElement('option');
    option.value = position.id;
    option.textContent = `${position.name} (${position.x}, ${position.y})`;
    stylePositionInput.append(option);
  }

  stylePositionInput.disabled = cachedPositions.length === 0;
  if (cachedPositions.some((position) => position.id === currentValue)) {
    stylePositionInput.value = currentValue;
  } else if (cachedPositions[0]) {
    stylePositionInput.value = cachedPositions[0].id;
  }
  renderStyleLivePreview();
}

function renderPositions() {
  positionList.replaceChildren();
  positionsEmptyState.hidden = cachedPositions.length > 0;

  for (const position of cachedPositions) {
    const item = document.createElement('article');
    item.className = 'position-item';

    const body = document.createElement('div');
    const title = document.createElement('h4');
    title.textContent = position.name;
    const meta = document.createElement('p');
    meta.textContent = `x ${position.x} · y ${position.y} · align ${position.alignment}`;
    body.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'item-actions';

    const editButton = document.createElement('button');
    editButton.className = 'icon-button edit-button';
    editButton.type = 'button';
    editButton.title = 'Редактировать позицию';
    editButton.innerHTML = EDIT_ICON;
    editButton.addEventListener('click', () => {
      startPositionEdit(position);
    });

    const removeButton = document.createElement('button');
    removeButton.className = 'icon-button';
    removeButton.type = 'button';
    removeButton.title = 'Удалить позицию';
    removeButton.textContent = '×';
    removeButton.disabled = cachedPositions.length <= 1;
    removeButton.addEventListener('click', async () => {
      if (cachedPositions.length <= 1) return;
      if (editingPositionId === position.id) resetPositionForm();

      const fallback = cachedPositions.find((item) => item.id !== position.id);
      await deletePosition(position.id);
      await Promise.all(
        (await readStyles())
          .filter((style) => style.positionId === position.id)
          .map((style) => saveStyle({ ...style, positionId: fallback.id })),
      );
      await destroyJassubRenderer();
      await refreshEditor();
    });

    actions.append(editButton, removeButton);
    item.append(body, actions);
    positionList.append(item);
  }

  renderPositionOptions();
}

function renderStyles() {
  styleList.replaceChildren();
  stylesEmptyState.hidden = cachedStyles.length > 0;

  for (const rawStyle of cachedStyles) {
    const style = normalizeStyle(rawStyle);
    const item = document.createElement('article');
    item.className = 'style-item';

    const swatch = document.createElement('span');
    swatch.className = 'style-swatch';
    swatch.style.background = style.primaryColor;

    const body = document.createElement('div');
    const title = document.createElement('h4');
    title.textContent = style.name;
    const meta = document.createElement('p');
    meta.textContent = `${style.font} · ${fontVariantLabel(style.fontVariant)} · ${style.fontSize}px · ${positionLabel(style.position)}`;

    const preview = document.createElement('p');
    preview.className = 'style-item__preview';
    preview.textContent = STYLE_PREVIEW_TEXT;
    applySubtitlePreviewStyle(preview, style, 0.34);

    body.append(title, preview, meta);

    const actions = document.createElement('div');
    actions.className = 'item-actions';

    const editButton = document.createElement('button');
    editButton.className = 'icon-button edit-button';
    editButton.type = 'button';
    editButton.title = 'Редактировать стиль';
    editButton.innerHTML = EDIT_ICON;
    editButton.addEventListener('click', () => {
      startStyleEdit(style);
    });

    const removeButton = document.createElement('button');
    removeButton.className = 'icon-button';
    removeButton.type = 'button';
    removeButton.title = 'Удалить стиль';
    removeButton.textContent = '×';
    removeButton.addEventListener('click', async () => {
      if (editingStyleId === style.id) resetStyleForm();
      await deleteStyle(style.id);
      cachedCues = cachedCues.filter((cue) => cue.styleId !== style.id);
      await Promise.all(
        (await readCues())
          .filter((cue) => cue.styleId === style.id)
          .map((cue) => deleteCue(cue.id)),
      );
      await refreshEditor();
    });

    actions.append(editButton, removeButton);
    item.append(swatch, body, actions);
    styleList.append(item);
  }

  renderStyleOptions();
}

function renderCues() {
  cueList.replaceChildren();
  cuesEmptyState.hidden = cachedCues.length > 0;

  for (const cue of cachedCues) {
    const style = normalizeStyle(getStyleById(cue.styleId) || {});
    const item = document.createElement('article');
    item.className = 'cue-item';

    const time = document.createElement('p');
    time.className = 'cue-item__time';
    time.textContent = `${formatTimeInput(cue.start)} → ${formatTimeInput(cue.end)}`;

    const text = document.createElement('p');
    text.className = 'cue-item__text';
    text.textContent = stripAssMarkup(cue.text) || cue.text;
    applySubtitlePreviewStyle(text, style, 0.34);

    const meta = document.createElement('p');
    meta.className = 'cue-item__meta';
    meta.textContent = style.name
      ? `${style.name} · ${positionLabel(style.position)}${formatCueMotionLabel(cue)}`
      : 'Стиль удален';

    const actions = document.createElement('div');
    actions.className = 'item-actions';

    const editButton = document.createElement('button');
    editButton.className = 'icon-button edit-button';
    editButton.type = 'button';
    editButton.title = 'Редактировать реплику';
    editButton.innerHTML = EDIT_ICON;
    editButton.addEventListener('click', () => {
      startCueEdit(cue);
    });

    const removeButton = document.createElement('button');
    removeButton.className = 'icon-button';
    removeButton.type = 'button';
    removeButton.title = 'Удалить реплику';
    removeButton.textContent = '×';
    removeButton.addEventListener('click', async () => {
      if (editingCueId === cue.id) resetCueForm();
      await deleteCue(cue.id);
      await refreshEditor();
    });

    actions.append(editButton, removeButton);
    item.append(time, text, meta, actions);
    cueList.append(item);
  }
}

function resetStyleForm() {
  editingStyleId = undefined;
  styleForm.reset();
  styleFontInput.value = 'Montserrat';
  styleFontSizeInput.value = '72';
  styleFontVariantInput.value = 'regular';
  setColorInputValue(stylePrimaryColorInput, '#ffffff');
  setColorInputValue(styleSecondaryColorInput, '#000000');
  setColorInputValue(styleOutlineColorInput, '#10181c');
  setColorInputValue(styleBackColorInput, '#000000');
  stylePositionInput.value = defaultPosition().id;
  styleSubmitButton.textContent = 'Добавить стиль';
  cancelStyleEditButton.hidden = true;
  renderStyleLivePreview();
}

function resetCueForm() {
  editingCueId = undefined;
  cueForm.reset();
  if (cueMotionDxInput) cueMotionDxInput.value = '';
  if (cueMotionDyInput) cueMotionDyInput.value = '';
  if (cueMotionStartMsInput) cueMotionStartMsInput.value = '';
  if (cueMotionMsInput) cueMotionMsInput.value = '';
  cueSubmitButton.textContent = 'Добавить реплику';
  cancelCueEditButton.hidden = true;
}

function resetPositionForm() {
  editingPositionId = undefined;
  positionForm.reset();
  positionXInput.value = '540';
  positionYInput.value = '1700';
  positionAlignmentInput.value = '2';
  renderAlignControl();
  positionSubmitButton.textContent = 'Добавить позицию';
  cancelPositionEditButton.hidden = true;
}

function startStyleEdit(style) {
  const normalizedStyle = normalizeStyle(style);
  editingStyleId = normalizedStyle.id;
  styleNameInput.value = normalizedStyle.name;
  styleFontInput.value = normalizedStyle.font;
  styleFontSizeInput.value = String(normalizedStyle.fontSize);
  styleFontVariantInput.value = normalizedStyle.fontVariant;
  setColorInputValue(stylePrimaryColorInput, normalizedStyle.primaryColor);
  setColorInputValue(styleSecondaryColorInput, normalizedStyle.secondaryColor);
  setColorInputValue(styleOutlineColorInput, normalizedStyle.outlineColor);
  setColorInputValue(styleBackColorInput, normalizedStyle.backColor);
  stylePositionInput.value = normalizedStyle.positionId;
  styleSubmitButton.textContent = 'Сохранить стиль';
  cancelStyleEditButton.hidden = false;
  renderStyleLivePreview();
  styleNameInput.focus();
}

function startCueEdit(cue) {
  editingCueId = cue.id;
  cueTextInput.value = cue.text;
  cueStartInput.value = formatTimeInput(cue.start);
  cueEndInput.value = formatTimeInput(cue.end);
  cueStyleInput.value = cue.styleId;
  const motion = normalizeCueMotion(cue);
  if (cueMotionDxInput) cueMotionDxInput.value = motion ? String(motion.motionDx) : '';
  if (cueMotionDyInput) cueMotionDyInput.value = motion ? String(motion.motionDy) : '';
  if (cueMotionStartMsInput) {
    cueMotionStartMsInput.value =
      motion && motion.motionStartMs > 0 ? String(motion.motionStartMs) : '';
  }
  if (cueMotionMsInput) {
    cueMotionMsInput.value = motion ? String(motion.motionMs) : '';
  }
  cueSubmitButton.textContent = 'Сохранить реплику';
  cancelCueEditButton.hidden = false;
  cueTextInput.focus();
}

function startPositionEdit(position) {
  editingPositionId = position.id;
  positionNameInput.value = position.name;
  positionXInput.value = String(position.x);
  positionYInput.value = String(position.y);
  positionAlignmentInput.value = String(position.alignment);
  renderAlignControl();
  positionSubmitButton.textContent = 'Сохранить позицию';
  cancelPositionEditButton.hidden = false;
  positionNameInput.focus();
}

function currentPreviewCue() {
  if (cachedCues.length === 0) return undefined;

  const videoTime = currentVideo?.currentTime || 0;
  const activeCue = cachedCues.find((cue) => {
    const start = parseTimeToSeconds(cue.start);
    const end = parseTimeToSeconds(cue.end);
    return (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      videoTime >= start &&
      videoTime <= end
    );
  });

  return currentVideo?.src ? activeCue : cachedCues[0];
}

function updatePreviewMeta(status) {
  const cue = currentPreviewCue();
  const style = cue ? getStyleById(cue.styleId) : undefined;
  renderVideoSubtitleOverlay(cue, style);

  if (status) {
    previewMeta.textContent = status;
    return;
  }
  if (!cue) {
    previewMeta.textContent = currentVideo?.src
      ? 'На текущем времени нет реплики'
      : 'Загрузите видео для превью';
    return;
  }

  previewMeta.textContent = currentVideo?.src
    ? `JASSUB · ${formatTimeInput(cue.start)} → ${formatTimeInput(cue.end)} · ${style?.name || 'Default'}`
    : 'Загрузите видео для превью';
}

function renderVideoSubtitleOverlay(cue, style) {
  if (!useDomSubtitleFallback || !currentVideo?.src || !cue) {
    videoSubtitleOverlay.hidden = true;
    videoSubtitleOverlay.textContent = '';
    return;
  }

  videoSubtitleOverlay.hidden = false;
  const normalizedStyle = normalizeStyle(style || {});
  videoSubtitleOverlay.className = `video-subtitle-overlay video-subtitle-overlay--${
    normalizedStyle.position.legacy || 'bottom-center'
  }`;
  videoSubtitleOverlay.textContent = stripAssMarkup(cue.text) || cue.text;
  applySubtitlePreviewStyle(videoSubtitleOverlay, normalizedStyle, 0.5);
}

function loadJassubModule() {
  if (!jassubModulePromise) {
    jassubModulePromise = import(JASSUB_MODULE_URL).then(
      (module) => module.default || module.JASSUB || module,
    );
  }

  return jassubModulePromise;
}

async function destroyJassubRenderer() {
  const renderer = jassubRenderer;
  jassubRenderer = undefined;
  jassubTrack = '';

  if (renderer?.destroy) {
    await renderer.destroy();
  }
}

async function repaintJassubFrame() {
  if (!jassubRenderer || !currentVideo.videoWidth || !currentVideo.videoHeight) {
    return;
  }

  await jassubRenderer.ready;
  await jassubRenderer.resize(true);
  await jassubRenderer.manualRender({
    expectedDisplayTime: performance.now(),
    width: currentVideo.videoWidth,
    height: currentVideo.videoHeight,
    mediaTime: currentVideo.currentTime || 0,
  });
}

async function renderJassubPreview() {
  const token = ++jassubRenderToken;
  const ass = assOutput.value || generateAss();

  if (!currentVideo?.src) {
    await destroyJassubRenderer();
    useDomSubtitleFallback = false;
    updatePreviewMeta('Загрузите видео для превью');
    return;
  }

  if (cachedCues.length === 0) {
    await destroyJassubRenderer();
    useDomSubtitleFallback = false;
    updatePreviewMeta('Добавьте реплики для превью');
    return;
  }

  try {
    if (!jassubRenderer) {
      updatePreviewMeta('JASSUB загружает renderer...');
      const JASSUB = await loadJassubModule();
      if (token !== jassubRenderToken) return;

      const fontConfig = buildJassubFontConfig();
      jassubRenderer = new JASSUB({
        video: currentVideo,
        subContent: ass,
        workerUrl: JASSUB_WORKER_URL,
        wasmUrl: JASSUB_WASM_URL,
        modernWasmUrl: JASSUB_MODERN_WASM_URL,
        defaultFont: 'liberation sans',
        fonts: fontConfig.fonts,
        availableFonts: fontConfig.availableFonts,
        queryFonts: false,
      });
      await jassubRenderer.ready;
      await jassubRenderer.renderer.setTrack(ass);
      jassubTrack = ass;
      if (token !== jassubRenderToken) return;
      await repaintJassubFrame();
    } else if (ass !== jassubTrack) {
      await jassubRenderer.ready;
      await jassubRenderer.renderer.setTrack(ass);
      jassubTrack = ass;
      await repaintJassubFrame();
    }

    useDomSubtitleFallback = false;
    updatePreviewMeta();
  } catch (error) {
    await destroyJassubRenderer();
    useDomSubtitleFallback = true;
    console.error(error);
    updatePreviewMeta(
      error instanceof Error
        ? `JASSUB: ${error.message}`
        : 'JASSUB не смог отрендерить субтитры',
    );
  }
}

function renderAssOutput() {
  const ass = generateAss();
  assOutput.value = ass;
  downloadAssButton.disabled = cachedCues.length === 0;
}

function updateVideoControls() {
  const duration = Number.isFinite(currentVideo.duration) ? currentVideo.duration : 0;
  const currentTime = Number.isFinite(currentVideo.currentTime) ? currentVideo.currentTime : 0;

  videoPlayButton.innerHTML = currentVideo.paused
    ? VIDEO_ICONS.play
    : VIDEO_ICONS.pause;
  videoPlayButton.setAttribute(
    'aria-label',
    currentVideo.paused ? 'Воспроизвести' : 'Пауза',
  );
  videoMuteButton.innerHTML = currentVideo.muted
    ? VIDEO_ICONS.muted
    : VIDEO_ICONS.volume;
  videoMuteButton.setAttribute(
    'aria-label',
    currentVideo.muted ? 'Включить звук' : 'Выключить звук',
  );
  videoSeekInput.max = String(duration);
  if (document.activeElement !== videoSeekInput) {
    videoSeekInput.value = String(currentTime);
  }
  videoTimeLabel.textContent = `${formatVideoTime(currentTime)} / ${formatVideoTime(duration)}`;
}

function renderExport() {
  renderAssOutput();
  void renderJassubPreview();
}

async function ensureDefaultStyle() {
  const styles = await readStyles();
  if (styles.length > 0) return;

  await saveStyle({
    id: createId('style'),
    name: 'Default',
    font: 'Montserrat',
    fontSize: 72,
    fontVariant: 'regular',
    primaryColor: '#ffffff',
    secondaryColor: '#000000',
    outlineColor: '#10181c',
    backColor: '#000000',
    positionId: defaultPosition().id,
    createdAt: new Date().toISOString(),
  });
}

async function ensureDefaultPositions() {
  const positions = await readPositions();
  if (positions.length > 0) return;

  await Promise.all(
    DEFAULT_POSITIONS.map((position, index) =>
      savePosition({
        ...position,
        createdAt: new Date(Date.now() + index).toISOString(),
      }),
    ),
  );
}

async function refreshEditor() {
  cachedPositions = await readPositions();
  cachedStyles = await readStyles();
  cachedCues = await readCues();
  renderPositions();
  renderStyles();
  renderCues();
  renderExport();
}

function uploadVideo(file) {
  const formData = new FormData();
  formData.append('video', file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/subs-api/videos');
    xhr.responseType = 'json';

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;

      progress.hidden = false;
      const percent = Math.round((event.loaded / event.total) * 100);
      progressBar.style.width = `${percent}%`;
      uploadStatus.textContent = `Загрузка: ${percent}%`;
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response);
        return;
      }

      reject(new Error(xhr.response?.message || 'Upload failed'));
    };

    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(formData);
  });
}

async function refreshList() {
  renderVideos(await readVideos());
}

async function loadCurrentVideo() {
  const match = window.location.pathname.match(
    /^\/subs\/([a-f0-9]{24})\/?$/,
  );
  if (!match) return;

  const hash = match[1];
  const response = await fetch(`/subs-api/videos/${hash}`);
  if (!response.ok) {
    setCurrentVideoMetaLink(null, 'Не удалось получить данные по этой ссылке.');
    currentVideoSection.hidden = false;
    return;
  }

  const video = await response.json();
  await destroyJassubRenderer();
  currentVideo.src = video.videoUrl;
  setCurrentVideoMetaLink(video.absolutePageUrl);
  currentVideoSection.hidden = false;
  updateVideoControls();
  void renderJassubPreview();

  const saved = await readVideos();
  if (!saved.some((item) => item.hash === hash)) {
    await saveVideo({
      ...video,
      originalName: `Видео ${hash}`,
      mimeType: 'video',
      size: 0,
      createdAt: new Date().toISOString(),
    });
  }
}

input.addEventListener('change', () => {
  const file = input.files?.[0];
  uploadButton.disabled = !file;
  fileMeta.textContent = file
    ? `${file.name} · ${formatBytes(file.size)} · ${file.type || 'video'}`
    : 'MP4, MOV, WebM или другой video/* файл';
  uploadStatus.textContent = '';
  progress.hidden = true;
  progressBar.style.width = '0%';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const file = input.files?.[0];
  if (!file) return;

  uploadButton.disabled = true;
  uploadStatus.textContent = 'Подготовка загрузки...';

  try {
    const uploaded = await uploadVideo(file);
    await saveVideo(uploaded);
    await refreshList();
    uploadStatus.textContent = `Готово: ${uploaded.absolutePageUrl}`;
    window.history.replaceState(null, '', uploaded.pageUrl);
    await loadCurrentVideo();
  } catch (error) {
    uploadStatus.textContent =
      error instanceof Error ? error.message : 'Не удалось загрузить видео';
  } finally {
    uploadButton.disabled = false;
  }
});

clearLinksButton.addEventListener('click', async () => {
  await clearVideos();
  await refreshList();
});

currentVideo.addEventListener('timeupdate', () => {
  updateVideoControls();
  updatePreviewMeta();
  if (currentVideo.paused) void repaintJassubFrame();
});
currentVideo.addEventListener('seeked', () => {
  updateVideoControls();
  updatePreviewMeta();
  void repaintJassubFrame();
});
currentVideo.addEventListener('loadedmetadata', () => {
  updateVideoControls();
  updatePreviewMeta();
  void renderJassubPreview();
});
currentVideo.addEventListener('loadeddata', () => {
  updateVideoControls();
  void repaintJassubFrame();
});
currentVideo.addEventListener('play', () => {
  updateVideoControls();
  void repaintJassubFrame();
});
currentVideo.addEventListener('pause', updateVideoControls);
currentVideo.addEventListener('volumechange', updateVideoControls);

videoPlayButton.addEventListener('click', () => {
  if (currentVideo.paused) {
    void currentVideo.play();
  } else {
    currentVideo.pause();
  }
});

videoSeekInput.addEventListener('input', () => {
  currentVideo.currentTime = Number(videoSeekInput.value) || 0;
  updateVideoControls();
  void repaintJassubFrame();
});

videoMuteButton.addEventListener('click', () => {
  currentVideo.muted = !currentVideo.muted;
});

[
  styleNameInput,
  styleFontInput,
  styleFontSizeInput,
  styleFontVariantInput,
  stylePrimaryColorInput,
  styleSecondaryColorInput,
  styleOutlineColorInput,
  styleBackColorInput,
  stylePositionInput,
].forEach((inputElement) => {
  inputElement.addEventListener('input', renderStyleLivePreview);
  inputElement.addEventListener('change', renderStyleLivePreview);
});

styleForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const existingStyle = editingStyleId ? getStyleById(editingStyleId) : undefined;
  await saveStyle({
    id: editingStyleId || createId('style'),
    name: styleNameInput.value.trim(),
    font: styleFontInput.value,
    fontSize: Number(styleFontSizeInput.value) || 72,
    fontVariant: styleFontVariantInput.value,
    primaryColor: stylePrimaryColorInput.value,
    secondaryColor: styleSecondaryColorInput.value,
    outlineColor: styleOutlineColorInput.value,
    backColor: styleBackColorInput.value,
    positionId: stylePositionInput.value,
    createdAt: existingStyle?.createdAt || new Date().toISOString(),
  });

  resetStyleForm();
  await destroyJassubRenderer();
  await refreshEditor();
});

cueForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!cueStyleInput.value) return;

  const existingCue = editingCueId
    ? cachedCues.find((cue) => cue.id === editingCueId)
    : undefined;
  const motion = readCueMotionFromForm();
  await saveCue({
    id: editingCueId || createId('cue'),
    text: cueTextInput.value.trim(),
    start: formatTimeInput(cueStartInput.value),
    end: formatTimeInput(cueEndInput.value),
    styleId: cueStyleInput.value,
    motionDx: motion.motionDx,
    motionDy: motion.motionDy,
    motionStartMs: motion.motionStartMs,
    motionMs: motion.motionMs,
    createdAt: existingCue?.createdAt || new Date().toISOString(),
  });

  resetCueForm();
  await refreshEditor();
});

cancelStyleEditButton.addEventListener('click', resetStyleForm);
cancelCueEditButton.addEventListener('click', resetCueForm);
cancelPositionEditButton.addEventListener('click', resetPositionForm);
alignControlButtons.forEach((button) => {
  button.addEventListener('click', () => {
    positionAlignmentInput.value = button.dataset.alignCell;
    renderAlignControl();
  });
});

positionForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const existingPosition = editingPositionId
    ? cachedPositions.find((position) => position.id === editingPositionId)
    : undefined;
  await savePosition({
    id: editingPositionId || createId('position'),
    name: positionNameInput.value.trim(),
    x: Math.round(Number(positionXInput.value) || 0),
    y: Math.round(Number(positionYInput.value) || 0),
    alignment: Number(positionAlignmentInput.value) || 2,
    createdAt: existingPosition?.createdAt || new Date().toISOString(),
  });

  resetPositionForm();
  await destroyJassubRenderer();
  await refreshEditor();
});

downloadAssButton.addEventListener('click', () => {
  const blob = new Blob([assOutput.value], {
    type: 'text/plain;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'subtitles.ass';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

refreshPreviewButton.addEventListener('click', () => {
  void renderJassubPreview();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void reloadFontPickerFromDb();
  }
});

async function init() {
  await loadEnabledFontFamilies();
  populateStyleFontOptions();
  initializeColorPickers();
  renderAlignControl();
  updateVideoControls();
  await loadCurrentVideo();
  await ensureDefaultPositions();
  cachedPositions = await readPositions();
  await ensureDefaultStyle();
  await refreshList();
  await refreshEditor();
}

init().catch((error) => {
  uploadStatus.textContent =
    error instanceof Error ? error.message : 'Ошибка IndexedDB';
});
