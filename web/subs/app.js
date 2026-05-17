const DB_NAME = 'subs-project';
const DB_VERSION = 2;
const VIDEO_STORE = 'videos';
const STYLE_STORE = 'styles';
const CUE_STORE = 'cues';
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
const styleForm = document.querySelector('#styleForm');
const styleNameInput = document.querySelector('#styleNameInput');
const styleFontInput = document.querySelector('#styleFontInput');
const styleColorInput = document.querySelector('#styleColorInput');
const stylePositionInput = document.querySelector('#stylePositionInput');
const styleSubmitButton = document.querySelector('#styleSubmitButton');
const cancelStyleEditButton = document.querySelector('#cancelStyleEditButton');
const styleList = document.querySelector('#styleList');
const stylesEmptyState = document.querySelector('#stylesEmptyState');
const cueForm = document.querySelector('#cueForm');
const cueTextInput = document.querySelector('#cueTextInput');
const cueStartInput = document.querySelector('#cueStartInput');
const cueEndInput = document.querySelector('#cueEndInput');
const cueStyleInput = document.querySelector('#cueStyleInput');
const cueSubmitButton = document.querySelector('#cueSubmitButton');
const cancelCueEditButton = document.querySelector('#cancelCueEditButton');
const cueList = document.querySelector('#cueList');
const cuesEmptyState = document.querySelector('#cuesEmptyState');
const previewMeta = document.querySelector('#previewMeta');
const assOutput = document.querySelector('#assOutput');
const downloadAssButton = document.querySelector('#downloadAssButton');
const refreshPreviewButton = document.querySelector('#refreshPreviewButton');

let dbPromise;
let cachedStyles = [];
let cachedCues = [];
let jassubModulePromise;
let jassubRenderer;
let jassubTrack = '';
let jassubRenderToken = 0;
let useDomSubtitleFallback = false;
let editingStyleId;
let editingCueId;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VIDEO_STORE)) {
        const store = db.createObjectStore(VIDEO_STORE, { keyPath: 'hash' });
        store.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains(STYLE_STORE)) {
        const store = db.createObjectStore(STYLE_STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains(CUE_STORE)) {
        const store = db.createObjectStore(CUE_STORE, { keyPath: 'id' });
        store.createIndex('start', 'start');
        store.createIndex('styleId', 'styleId');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
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
  return {
    'bottom-center': 'Снизу по центру',
    'bottom-left': 'Снизу слева',
    'top-center': 'Сверху по центру',
    'middle-center': 'По центру кадра',
  }[position] || position;
}

function getStyleById(id) {
  return cachedStyles.find((style) => style.id === id);
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

function colorToAss(color) {
  const normalized = color.replace('#', '').padStart(6, '0');
  const red = normalized.slice(0, 2);
  const green = normalized.slice(2, 4);
  const blue = normalized.slice(4, 6);
  return `&H00${blue}${green}${red}`.toUpperCase();
}

function assAlignment(position) {
  return {
    'bottom-left': 1,
    'bottom-center': 2,
    'middle-center': 5,
    'top-center': 8,
  }[position] || 2;
}

function escapeAssText(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[{}]/g, ''))
    .join('\\N');
}

function sanitizeAssName(name) {
  return name.replace(/,/g, ' ').trim() || 'Default';
}

function generateAss() {
  const styles = cachedStyles.length
    ? cachedStyles
    : [
        {
          id: 'default',
          name: 'Default',
          font: 'Inter',
          color: '#ffffff',
          position: 'bottom-center',
        },
      ];

  const styleLines = styles.map((style) => {
    const name = sanitizeAssName(style.name);
    return [
      `Style: ${name}`,
      style.font,
      72,
      colorToAss(style.color),
      '&H80000000',
      '&H0010181C',
      '&H00000000',
      -1,
      0,
      0,
      0,
      100,
      100,
      0,
      0,
      1,
      4,
      2,
      24,
      24,
      120,
      assAlignment(style.position),
      1,
    ].join(',');
  });

  const cueLines = cachedCues.map((cue) => {
    const style = getStyleById(cue.styleId);
    return [
      'Dialogue: 0',
      formatAssTime(cue.start),
      formatAssTime(cue.end),
      sanitizeAssName(style?.name || 'Default'),
      '',
      0,
      0,
      0,
      '',
      escapeAssText(cue.text),
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

function renderStyles() {
  styleList.replaceChildren();
  stylesEmptyState.hidden = cachedStyles.length > 0;

  for (const style of cachedStyles) {
    const item = document.createElement('article');
    item.className = 'style-item';

    const swatch = document.createElement('span');
    swatch.className = 'style-swatch';
    swatch.style.background = style.color;

    const body = document.createElement('div');
    const title = document.createElement('h4');
    title.textContent = style.name;
    const meta = document.createElement('p');
    meta.textContent = `${style.font} · ${positionLabel(style.position)}`;
    body.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'item-actions';

    const editButton = document.createElement('button');
    editButton.className = 'icon-button edit-button';
    editButton.type = 'button';
    editButton.title = 'Редактировать стиль';
    editButton.textContent = 'Изм.';
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
    const style = getStyleById(cue.styleId);
    const item = document.createElement('article');
    item.className = 'cue-item';

    const time = document.createElement('p');
    time.className = 'cue-item__time';
    time.textContent = `${formatTimeInput(cue.start)} → ${formatTimeInput(cue.end)}`;

    const text = document.createElement('p');
    text.className = 'cue-item__text';
    text.textContent = cue.text;
    if (style) {
      text.style.color = style.color;
      text.style.fontFamily = style.font;
    }

    const meta = document.createElement('p');
    meta.className = 'cue-item__meta';
    meta.textContent = style
      ? `${style.name} · ${positionLabel(style.position)}`
      : 'Стиль удален';

    const actions = document.createElement('div');
    actions.className = 'item-actions';

    const editButton = document.createElement('button');
    editButton.className = 'icon-button edit-button';
    editButton.type = 'button';
    editButton.title = 'Редактировать реплику';
    editButton.textContent = 'Изм.';
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
  styleColorInput.value = '#ffffff';
  styleSubmitButton.textContent = 'Добавить стиль';
  cancelStyleEditButton.hidden = true;
}

function resetCueForm() {
  editingCueId = undefined;
  cueForm.reset();
  cueSubmitButton.textContent = 'Добавить реплику';
  cancelCueEditButton.hidden = true;
}

function startStyleEdit(style) {
  editingStyleId = style.id;
  styleNameInput.value = style.name;
  styleFontInput.value = style.font;
  styleColorInput.value = style.color;
  stylePositionInput.value = style.position;
  styleSubmitButton.textContent = 'Сохранить стиль';
  cancelStyleEditButton.hidden = false;
  styleNameInput.focus();
}

function startCueEdit(cue) {
  editingCueId = cue.id;
  cueTextInput.value = cue.text;
  cueStartInput.value = formatTimeInput(cue.start);
  cueEndInput.value = formatTimeInput(cue.end);
  cueStyleInput.value = cue.styleId;
  cueSubmitButton.textContent = 'Сохранить реплику';
  cancelCueEditButton.hidden = false;
  cueTextInput.focus();
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
  videoSubtitleOverlay.className = `video-subtitle-overlay video-subtitle-overlay--${
    style?.position || 'bottom-center'
  }`;
  videoSubtitleOverlay.textContent = cue.text;
  videoSubtitleOverlay.style.color = style?.color || '#ffffff';
  videoSubtitleOverlay.style.fontFamily = style?.font || 'Inter';
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

      jassubRenderer = new JASSUB({
        video: currentVideo,
        subContent: ass,
        workerUrl: JASSUB_WORKER_URL,
        wasmUrl: JASSUB_WASM_URL,
        modernWasmUrl: JASSUB_MODERN_WASM_URL,
        defaultFont: 'liberation sans',
        fonts: [new URL('vendor/jassub/default.woff2', SUBS_ASSET_BASE_URL).href],
        queryFonts: 'local',
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
    font: 'Inter',
    color: '#ffffff',
    position: 'bottom-center',
    createdAt: new Date().toISOString(),
  });
}

async function refreshEditor() {
  cachedStyles = await readStyles();
  cachedCues = await readCues();
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
    currentVideoMeta.textContent = 'Не удалось получить данные по этой ссылке.';
    currentVideoSection.hidden = false;
    return;
  }

  const video = await response.json();
  await destroyJassubRenderer();
  currentVideo.src = video.videoUrl;
  currentVideoMeta.textContent = video.absolutePageUrl;
  currentVideoSection.hidden = false;
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
  updatePreviewMeta();
  if (currentVideo.paused) void repaintJassubFrame();
});
currentVideo.addEventListener('seeked', () => {
  updatePreviewMeta();
  void repaintJassubFrame();
});
currentVideo.addEventListener('loadedmetadata', () => {
  updatePreviewMeta();
  void renderJassubPreview();
});
currentVideo.addEventListener('loadeddata', () => {
  void repaintJassubFrame();
});
currentVideo.addEventListener('play', () => {
  void repaintJassubFrame();
});

styleForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const existingStyle = editingStyleId ? getStyleById(editingStyleId) : undefined;
  await saveStyle({
    id: editingStyleId || createId('style'),
    name: styleNameInput.value.trim(),
    font: styleFontInput.value,
    color: styleColorInput.value,
    position: stylePositionInput.value,
    createdAt: existingStyle?.createdAt || new Date().toISOString(),
  });

  resetStyleForm();
  await refreshEditor();
});

cueForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!cueStyleInput.value) return;

  const existingCue = editingCueId
    ? cachedCues.find((cue) => cue.id === editingCueId)
    : undefined;
  await saveCue({
    id: editingCueId || createId('cue'),
    text: cueTextInput.value.trim(),
    start: formatTimeInput(cueStartInput.value),
    end: formatTimeInput(cueEndInput.value),
    styleId: cueStyleInput.value,
    createdAt: existingCue?.createdAt || new Date().toISOString(),
  });

  resetCueForm();
  await refreshEditor();
});

cancelStyleEditButton.addEventListener('click', resetStyleForm);
cancelCueEditButton.addEventListener('click', resetCueForm);

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

async function init() {
  await loadCurrentVideo();
  await ensureDefaultStyle();
  await refreshList();
  await refreshEditor();
}

init().catch((error) => {
  uploadStatus.textContent =
    error instanceof Error ? error.message : 'Ошибка IndexedDB';
});
