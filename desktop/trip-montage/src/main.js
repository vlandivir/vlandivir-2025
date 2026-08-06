import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import * as api from './api.js';

const els = {
  status: document.getElementById('status'),
  userLabel: document.getElementById('userLabel'),
  loginBtn: document.getElementById('loginBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  loginView: document.getElementById('loginView'),
  tripsView: document.getElementById('tripsView'),
  tripsList: document.getElementById('tripsList'),
  refreshTripsBtn: document.getElementById('refreshTripsBtn'),
  albumView: document.getElementById('albumView'),
  albumTitle: document.getElementById('albumTitle'),
  backBtn: document.getElementById('backBtn'),
  gallery: document.getElementById('gallery'),
  cacheStats: document.getElementById('cacheStats'),
  cacheClearBtn: document.getElementById('cacheClearBtn'),
  createProjectForm: document.getElementById('createProjectForm'),
  projectNameInput: document.getElementById('projectNameInput'),
  projectsList: document.getElementById('projectsList'),
  projectDetail: document.getElementById('projectDetail'),
  trimDialog: document.getElementById('trimDialog'),
  trimTitle: document.getElementById('trimTitle'),
  trimDownloadStatus: document.getElementById('trimDownloadStatus'),
  trimVideo: document.getElementById('trimVideo'),
  trimStartInput: document.getElementById('trimStartInput'),
  trimEndInput: document.getElementById('trimEndInput'),
  markStartBtn: document.getElementById('markStartBtn'),
  markEndBtn: document.getElementById('markEndBtn'),
  saveTrimBtn: document.getElementById('saveTrimBtn'),
  resetTrimBtn: document.getElementById('resetTrimBtn'),
};

/** @type {{ id: string, secret: string, title: string } | null} */
let currentTrip = null;
/** @type {any[]} */
let mediaItems = [];
/** @type {any[]} */
let projects = [];
/** @type {any | null} */
let activeProject = null;
/** @type {number | null} */
let selectedClipId = null;
/** @type {{ clipId: number, mediaId: string, localPath: string } | null} */
let trimContext = null;

function showStatus(message, isError = false) {
  els.status.hidden = !message;
  els.status.textContent = message || '';
  els.status.classList.toggle('is-error', Boolean(isError));
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function formatDurationMs(ms) {
  if (ms == null || Number.isNaN(ms)) return '';
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function padIndex(i, total) {
  const width = Math.max(2, String(total).length);
  return String(i).padStart(width, '0');
}

function sanitizeFilename(name) {
  return String(name || 'clip')
    .replace(/[^\w.\-()+ ]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

async function refreshCacheStats() {
  try {
    const stats = await invoke('get_cache_stats');
    els.cacheStats.textContent = `Кэш: ${stats.files} файл. · ${formatBytes(stats.bytes)}`;
  } catch {
    els.cacheStats.textContent = '';
  }
}

function setAuthedUi(user) {
  const signedIn = Boolean(user);
  els.loginBtn.hidden = signedIn;
  els.logoutBtn.hidden = !signedIn;
  els.userLabel.textContent = signedIn
    ? user.name || user.email || ''
    : '';
  els.loginView.hidden = signedIn;
  els.tripsView.hidden = !signedIn;
  if (!signedIn) {
    els.albumView.hidden = true;
    currentTrip = null;
  }
}

async function bootstrap() {
  try {
    const base = await invoke('get_api_base');
    api.setApiBase(base);
    const saved = await invoke('get_session_token');
    if (saved) {
      api.setToken(saved);
      const me = await api.fetchMe();
      if (me?.authenticated) {
        setAuthedUi(me);
        await loadTrips();
        await refreshCacheStats();
        return;
      }
    }
  } catch (error) {
    api.setToken(null);
    await invoke('clear_session_token').catch(() => {});
    showStatus(error.message || String(error), true);
  }
  setAuthedUi(null);
}

async function login() {
  showStatus('Откройте браузер и войдите через Google…');
  els.loginBtn.disabled = true;
  try {
    const token = await invoke('login_with_google');
    api.setToken(token);
    const me = await api.fetchMe();
    if (!me?.authenticated) throw new Error('Login failed');
    setAuthedUi(me);
    showStatus(`Вошли как ${me.email}`);
    await loadTrips();
  } catch (error) {
    showStatus(error.message || String(error), true);
    setAuthedUi(null);
  } finally {
    els.loginBtn.disabled = false;
  }
}

async function logout() {
  api.setToken(null);
  await invoke('clear_session_token');
  setAuthedUi(null);
  showStatus('Вы вышли');
}

async function loadTrips() {
  showStatus('Загружаю альбомы…');
  const data = await api.listAdminTrips();
  els.tripsList.innerHTML = '';
  for (const trip of data.trips || []) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'trip-row';
    btn.innerHTML = `<span><strong>${escapeHtml(trip.title)}</strong><span class="muted">${trip.mediaCount} медиа · ${trip.projectCount} проект.</span></span>`;
    btn.addEventListener('click', () => void openTrip(trip));
    els.tripsList.appendChild(btn);
  }
  showStatus((data.trips || []).length ? '' : 'Альбомов пока нет');
}

async function openTrip(tripSummary) {
  showStatus('Открываю альбом…');
  currentTrip = await api.getTrip(tripSummary.secret);
  els.albumTitle.textContent = currentTrip.title;
  els.tripsView.hidden = true;
  els.albumView.hidden = false;
  const mediaData = await api.listMedia(currentTrip.secret);
  mediaItems = (mediaData.media || []).filter((m) => !m.deleted);
  renderGallery();
  await loadProjects();
  await refreshCacheStats();
  showStatus('');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderGallery() {
  els.gallery.innerHTML = '';
  for (const item of mediaItems) {
    const card = document.createElement('article');
    card.className = 'trip-card';

    const mediaBtn = document.createElement('button');
    mediaBtn.type = 'button';
    mediaBtn.className =
      'trip-card__media' + (item.kind === 'video' ? ' is-video' : '');
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = item.originalFilename || '';
    img.src = item.thumbUrl || item.url;
    mediaBtn.appendChild(img);
    mediaBtn.addEventListener('click', () => {
      if (item.kind === 'video') void openMediaViewer(item);
    });

    const footer = document.createElement('div');
    footer.className = 'trip-card__footer';
    const meta = document.createElement('div');
    meta.className = 'trip-card__meta';
    meta.innerHTML = `<strong title="${escapeHtml(item.originalFilename || '')}">${escapeHtml(item.originalFilename || item.id)}</strong><span>${item.kind}${item.durationMs ? ' · ' + formatDurationMs(item.durationMs) : ''} · ${formatBytes(Number(item.size || 0))}</span>`;

    const actions = document.createElement('div');
    actions.className = 'trip-card__actions';
    if (item.kind === 'video' && activeProject) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'mini-btn';
      add.textContent = 'В проект';
      add.addEventListener('click', () => void addMediaToProject(item.id));
      actions.appendChild(add);
    }

    footer.append(meta, actions);
    card.append(mediaBtn, footer);
    els.gallery.appendChild(card);
  }
}

async function openMediaViewer(item) {
  // Photos stay remote-thumb only; videos lazy-download for scrubbing.
  selectedClipId = null;
  trimContext = null;
  els.trimTitle.textContent = item.originalFilename || 'Видео';
  els.trimStartInput.value = '';
  els.trimEndInput.value = '';
  els.trimDownloadStatus.textContent = 'Загружаю в локальный кэш…';
  els.trimVideo.removeAttribute('src');
  els.trimDialog.showModal();
  try {
    const cached = await invoke('ensure_media_cached', {
      mediaId: item.id,
      url: item.url,
    });
    els.trimDownloadStatus.textContent = cached.downloaded
      ? `Скачано ${formatBytes(cached.bytes)}`
      : `Из кэша · ${formatBytes(cached.bytes)}`;
    els.trimVideo.src = convertFileSrc(cached.path);
    trimContext = {
      clipId: 0,
      mediaId: item.id,
      localPath: cached.path,
    };
    await refreshCacheStats();
  } catch (error) {
    els.trimDownloadStatus.textContent = error.message || String(error);
  }
}

async function loadProjects() {
  if (!currentTrip) return;
  projects = await api.listProjects(currentTrip.secret);
  if (
    activeProject &&
    !projects.some((p) => p.id === activeProject.id)
  ) {
    activeProject = null;
  }
  renderProjects();
  if (activeProject) {
    await openProject(activeProject.id);
  } else if (projects[0]) {
    await openProject(projects[0].id);
  } else {
    els.projectDetail.hidden = true;
    els.projectDetail.innerHTML = '';
    renderGallery();
  }
}

function renderProjects() {
  els.projectsList.innerHTML = '';
  if (!projects.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Пока нет проектов';
    els.projectsList.appendChild(empty);
    return;
  }
  for (const project of projects) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
      'project-row' + (activeProject?.id === project.id ? ' is-active' : '');
    btn.innerHTML = `<strong>${escapeHtml(project.name)}</strong><span class="muted">${project.clipCount} клип.</span>`;
    btn.addEventListener('click', () => void openProject(project.id));
    els.projectsList.appendChild(btn);
  }
}

async function openProject(projectId) {
  activeProject = await api.getProject(currentTrip.secret, projectId);
  selectedClipId = null;
  renderProjects();
  renderProjectDetail();
  renderGallery();
}

function renderProjectDetail() {
  const root = els.projectDetail;
  root.innerHTML = '';
  if (!activeProject) {
    root.hidden = true;
    return;
  }
  root.hidden = false;

  const head = document.createElement('div');
  head.className = 'clip-actions';
  const rename = document.createElement('button');
  rename.type = 'button';
  rename.className = 'mini-btn';
  rename.textContent = 'Переименовать';
  rename.addEventListener('click', () => void renameActiveProject());
  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'primary-btn';
  exportBtn.textContent = 'Export в папку';
  exportBtn.disabled = !activeProject.clips?.length;
  exportBtn.addEventListener('click', () => void exportActiveProject(exportBtn));
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'mini-btn danger-btn';
  del.textContent = 'Удалить';
  del.addEventListener('click', () => void deleteActiveProject());
  head.append(rename, exportBtn, del);
  root.appendChild(head);

  const summary = document.createElement('p');
  summary.className = 'muted';
  summary.textContent = activeProject.clips?.length
    ? `${activeProject.clips.length} клип.`
    : 'Клипов пока нет — нажмите «В проект» на видео';
  root.appendChild(summary);

  const list = document.createElement('div');
  list.className = 'clip-list';
  (activeProject.clips || []).forEach((clip, index) => {
    list.appendChild(buildClipRow(clip, index));
  });
  root.appendChild(list);
}

function buildClipRow(clip, index) {
  const media = clip.media || {};
  const row = document.createElement('article');
  row.className =
    'clip-row' + (selectedClipId === clip.id ? ' is-selected' : '');

  const idx = document.createElement('span');
  idx.className = 'clip-index';
  idx.textContent = padIndex(index + 1, activeProject.clips.length);

  const body = document.createElement('div');
  body.innerHTML = `<strong>${escapeHtml(media.originalFilename || clip.mediaId)}</strong><div class="muted">${clip.trimStartSec != null || clip.trimEndSec != null ? `trim ${clip.trimStartSec ?? 0}–${clip.trimEndSec ?? '…'}с` : 'без обрезки'}</div>`;

  const actions = document.createElement('div');
  actions.className = 'clip-actions';

  const trimBtn = document.createElement('button');
  trimBtn.type = 'button';
  trimBtn.className = 'mini-btn';
  trimBtn.textContent = 'Обрезка';
  trimBtn.addEventListener('click', () => void openClipTrim(clip));

  const up = document.createElement('button');
  up.type = 'button';
  up.className = 'mini-btn';
  up.textContent = '↑';
  up.disabled = index === 0;
  up.addEventListener('click', () => void moveClip(index, -1));

  const down = document.createElement('button');
  down.type = 'button';
  down.className = 'mini-btn';
  down.textContent = '↓';
  down.disabled = index >= activeProject.clips.length - 1;
  down.addEventListener('click', () => void moveClip(index, 1));

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'mini-btn danger-btn';
  remove.textContent = 'Убрать';
  remove.addEventListener('click', () => void removeClipFromProject(clip.id));

  actions.append(trimBtn, up, down, remove);
  row.append(idx, body, actions);
  return row;
}

async function addMediaToProject(mediaId) {
  if (!activeProject || !currentTrip) return;
  try {
    await api.addClip(currentTrip.secret, activeProject.id, mediaId);
    await openProject(activeProject.id);
    await loadProjects();
    showStatus('Клип добавлен');
  } catch (error) {
    showStatus(error.message || String(error), true);
  }
}

async function removeClipFromProject(clipId) {
  if (!activeProject || !currentTrip) return;
  if (!confirm('Убрать клип из проекта?')) return;
  await api.removeClip(currentTrip.secret, activeProject.id, clipId);
  await openProject(activeProject.id);
  await loadProjects();
}

async function moveClip(index, delta) {
  if (!activeProject) return;
  const ids = activeProject.clips.map((c) => c.id);
  const target = index + delta;
  if (target < 0 || target >= ids.length) return;
  const tmp = ids[index];
  ids[index] = ids[target];
  ids[target] = tmp;
  activeProject = await api.reorderClips(
    currentTrip.secret,
    activeProject.id,
    ids,
  );
  renderProjectDetail();
}

async function openClipTrim(clip) {
  selectedClipId = clip.id;
  const media = clip.media || mediaItems.find((m) => m.id === clip.mediaId);
  if (!media?.url) {
    showStatus('Нет URL медиа', true);
    return;
  }
  els.trimTitle.textContent = media.originalFilename || `Клип ${clip.id}`;
  els.trimStartInput.value =
    clip.trimStartSec != null ? String(clip.trimStartSec) : '';
  els.trimEndInput.value =
    clip.trimEndSec != null ? String(clip.trimEndSec) : '';
  els.trimDownloadStatus.textContent = 'Загружаю в локальный кэш…';
  els.trimVideo.removeAttribute('src');
  els.trimDialog.showModal();
  try {
    const cached = await invoke('ensure_media_cached', {
      mediaId: clip.mediaId,
      url: media.url,
    });
    els.trimDownloadStatus.textContent = cached.downloaded
      ? `Скачано ${formatBytes(cached.bytes)}`
      : `Из кэша · ${formatBytes(cached.bytes)}`;
    els.trimVideo.src = convertFileSrc(cached.path);
    trimContext = {
      clipId: clip.id,
      mediaId: clip.mediaId,
      localPath: cached.path,
    };
    await refreshCacheStats();
    renderProjectDetail();
  } catch (error) {
    els.trimDownloadStatus.textContent = error.message || String(error);
  }
}

async function saveTrimBounds() {
  if (!trimContext?.clipId || !activeProject || !currentTrip) {
    showStatus('Откройте клип проекта для сохранения trim', true);
    return;
  }
  const startRaw = els.trimStartInput.value.trim();
  const endRaw = els.trimEndInput.value.trim();
  const trimStartSec = startRaw === '' ? null : Number(startRaw);
  const trimEndSec = endRaw === '' ? null : Number(endRaw);
  if (
    (trimStartSec != null && Number.isNaN(trimStartSec)) ||
    (trimEndSec != null && Number.isNaN(trimEndSec))
  ) {
    showStatus('Некорректные границы', true);
    return;
  }
  await api.updateClipTrim(
    currentTrip.secret,
    activeProject.id,
    trimContext.clipId,
    trimStartSec,
    trimEndSec,
  );
  await openProject(activeProject.id);
  showStatus('Границы сохранены (обрезание при export)');
}

async function resetTrimBounds() {
  if (!trimContext?.clipId || !activeProject || !currentTrip) return;
  els.trimStartInput.value = '';
  els.trimEndInput.value = '';
  await api.updateClipTrim(
    currentTrip.secret,
    activeProject.id,
    trimContext.clipId,
    null,
    null,
  );
  await openProject(activeProject.id);
  showStatus('Обрезка сброшена');
}

async function renameActiveProject() {
  const name = prompt('Новое имя проекта', activeProject?.name || '');
  if (!name?.trim()) return;
  await api.renameProject(currentTrip.secret, activeProject.id, name.trim());
  await loadProjects();
}

async function deleteActiveProject() {
  if (!confirm(`Удалить проект «${activeProject.name}»?`)) return;
  await api.deleteProject(currentTrip.secret, activeProject.id);
  activeProject = null;
  await loadProjects();
}

async function exportActiveProject(button) {
  if (!activeProject?.clips?.length) return;
  const outputDir = await open({
    directory: true,
    multiple: false,
    title: 'Папка для CapCut клипов',
  });
  if (!outputDir) return;

  button.disabled = true;
  const original = button.textContent;
  try {
    showStatus('Готовлю клипы (ленивая загрузка + ffmpeg)…');
    const exportClips = [];
    const total = activeProject.clips.length;
    for (let i = 0; i < total; i++) {
      const clip = activeProject.clips[i];
      const media = clip.media || {};
      button.textContent = `Кэш ${i + 1}/${total}`;
      const cached = await invoke('ensure_media_cached', {
        mediaId: clip.mediaId,
        url: media.url,
      });
      const base = sanitizeFilename(
        (media.originalFilename || `clip-${clip.id}`).replace(/\.[^.]+$/, ''),
      );
      exportClips.push({
        media_id: clip.mediaId,
        source_path: cached.path,
        trim_start_sec: clip.trimStartSec ?? null,
        trim_end_sec: clip.trimEndSec ?? null,
        output_name: `${padIndex(i + 1, total)}-${base}.mp4`,
      });
    }

    button.textContent = 'ffmpeg…';
    const out = await invoke('export_clips', {
      clips: exportClips,
      outputDir,
    });
    showStatus(`Готово: ${out}`);
    await invoke('open_in_finder', { path: out });
    await refreshCacheStats();
  } catch (error) {
    showStatus(error.message || String(error), true);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

els.loginBtn.addEventListener('click', () => void login());
els.logoutBtn.addEventListener('click', () => void logout());
els.refreshTripsBtn.addEventListener('click', () => void loadTrips().catch((e) => showStatus(e.message, true)));
els.backBtn.addEventListener('click', () => {
  els.albumView.hidden = true;
  els.tripsView.hidden = false;
  currentTrip = null;
});
els.cacheClearBtn.addEventListener('click', () => {
  void (async () => {
    if (!confirm('Удалить локальный кэш видео?')) return;
    await invoke('clear_media_cache');
    await refreshCacheStats();
    showStatus('Кэш очищен');
  })();
});
els.createProjectForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void (async () => {
    const name = els.projectNameInput.value.trim();
    if (!name || !currentTrip) return;
    await api.createProject(currentTrip.secret, name);
    els.projectNameInput.value = '';
    await loadProjects();
  })().catch((e) => showStatus(e.message, true));
});
els.markStartBtn.addEventListener('click', () => {
  els.trimStartInput.value = els.trimVideo.currentTime.toFixed(1);
});
els.markEndBtn.addEventListener('click', () => {
  els.trimEndInput.value = els.trimVideo.currentTime.toFixed(1);
});
els.saveTrimBtn.addEventListener('click', () => {
  void saveTrimBounds().catch((e) => showStatus(e.message, true));
});
els.resetTrimBtn.addEventListener('click', () => {
  void resetTrimBounds().catch((e) => showStatus(e.message, true));
});

void listen('export-progress', (event) => {
  const p = event.payload;
  showStatus(p?.message || 'Export…');
});

void bootstrap();
