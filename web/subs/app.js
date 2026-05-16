const DB_NAME = 'subs-project';
const DB_VERSION = 1;
const STORE_NAME = 'videos';

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

let dbPromise;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'hash' });
        store.createIndex('createdAt', 'createdAt');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

async function readVideos() {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const videos = request.result.sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
      resolve(videos);
    };
    request.onerror = () => reject(request.error);
  });
}

async function saveVideo(video) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(video);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function clearVideos() {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
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

async function init() {
  await loadCurrentVideo();
  await refreshList();
}

init().catch((error) => {
  uploadStatus.textContent =
    error instanceof Error ? error.message : 'Ошибка IndexedDB';
});
