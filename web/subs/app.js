const DB_NAME = 'subs-project';
const DB_VERSION = 2;
const VIDEO_STORE = 'videos';
const STYLE_STORE = 'styles';
const CUE_STORE = 'cues';

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
const styleForm = document.querySelector('#styleForm');
const styleNameInput = document.querySelector('#styleNameInput');
const styleFontInput = document.querySelector('#styleFontInput');
const styleColorInput = document.querySelector('#styleColorInput');
const stylePositionInput = document.querySelector('#stylePositionInput');
const styleList = document.querySelector('#styleList');
const stylesEmptyState = document.querySelector('#stylesEmptyState');
const cueForm = document.querySelector('#cueForm');
const cueTextInput = document.querySelector('#cueTextInput');
const cueStartInput = document.querySelector('#cueStartInput');
const cueEndInput = document.querySelector('#cueEndInput');
const cueStyleInput = document.querySelector('#cueStyleInput');
const cueList = document.querySelector('#cueList');
const cuesEmptyState = document.querySelector('#cuesEmptyState');

let dbPromise;
let cachedStyles = [];
let cachedCues = [];

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
  return cues.sort((a, b) => a.start.localeCompare(b.start));
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

    const removeButton = document.createElement('button');
    removeButton.className = 'icon-button';
    removeButton.type = 'button';
    removeButton.title = 'Удалить стиль';
    removeButton.textContent = '×';
    removeButton.addEventListener('click', async () => {
      await deleteStyle(style.id);
      cachedCues = cachedCues.filter((cue) => cue.styleId !== style.id);
      await Promise.all(
        (await readCues())
          .filter((cue) => cue.styleId === style.id)
          .map((cue) => deleteCue(cue.id)),
      );
      await refreshEditor();
    });

    item.append(swatch, body, removeButton);
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
    time.textContent = `${cue.start} → ${cue.end}`;

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

    const removeButton = document.createElement('button');
    removeButton.className = 'icon-button';
    removeButton.type = 'button';
    removeButton.title = 'Удалить реплику';
    removeButton.textContent = '×';
    removeButton.addEventListener('click', async () => {
      await deleteCue(cue.id);
      await refreshEditor();
    });

    item.append(time, text, meta, removeButton);
    cueList.append(item);
  }
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
  currentVideo.src = video.videoUrl;
  currentVideoMeta.textContent = video.absolutePageUrl;
  currentVideoSection.hidden = false;

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

styleForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  await saveStyle({
    id: createId('style'),
    name: styleNameInput.value.trim(),
    font: styleFontInput.value,
    color: styleColorInput.value,
    position: stylePositionInput.value,
    createdAt: new Date().toISOString(),
  });

  styleForm.reset();
  styleColorInput.value = '#ffffff';
  await refreshEditor();
});

cueForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!cueStyleInput.value) return;

  await saveCue({
    id: createId('cue'),
    text: cueTextInput.value.trim(),
    start: cueStartInput.value.trim(),
    end: cueEndInput.value.trim(),
    styleId: cueStyleInput.value,
    createdAt: new Date().toISOString(),
  });

  cueForm.reset();
  await refreshEditor();
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
