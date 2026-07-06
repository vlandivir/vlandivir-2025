(() => {
  const API_BASE = '/reels-api';
  const KEY_STORAGE = 'reels-api-key';
  const POLL_INTERVAL_MS = 4000;

  // The page is unlisted: /reels/<secret>. The same secret is the read key
  // for the API.
  const PAGE_KEY = decodeURIComponent(location.pathname.split('/')[2] || '');

  const state = {
    reels: [],
    editMode: false,
    filters: { author: '', status: '' },
    openedId: null,
    pollTimer: null,
  };

  const el = (id) => document.getElementById(id);
  const grid = el('reels-grid');
  const editToggle = el('edit-toggle');
  const addForm = el('add-form');
  const backdrop = el('modal-backdrop');

  const pageHeaders = { 'x-reels-page-key': PAGE_KEY };

  // --- Loading ---

  async function loadReels() {
    const response = await fetch(`${API_BASE}/reels`, { headers: pageHeaders });
    if (response.status === 401) {
      el('access-denied').classList.remove('hidden');
      return;
    }
    if (!response.ok) return;
    state.reels = await response.json();
    renderGrid();
    schedulePolling();
  }

  // --- Polling: pending reels are being processed by yt-dlp on the server ---

  function schedulePolling() {
    clearTimeout(state.pollTimer);
    if (!state.reels.some((reel) => reel.status === 'pending')) return;
    state.pollTimer = setTimeout(pollPending, POLL_INTERVAL_MS);
  }

  async function pollPending() {
    const pending = state.reels.filter((reel) => reel.status === 'pending');
    await Promise.all(
      pending.map(async (reel) => {
        try {
          const response = await fetch(`${API_BASE}/reels/${reel.id}`, {
            headers: pageHeaders,
          });
          if (!response.ok) return;
          const fresh = await response.json();
          const index = state.reels.findIndex((r) => r.id === reel.id);
          if (index !== -1) state.reels[index] = fresh;
        } catch {
          // transient network error — retry on the next tick
        }
      }),
    );
    renderGrid();
    if (state.openedId !== null) {
      const opened = state.reels.find((r) => r.id === state.openedId);
      if (opened) renderModal(opened);
    }
    schedulePolling();
  }

  // --- Grid ---

  function matchesFilters(reel) {
    if (state.filters.author && reel.author !== state.filters.author) {
      return false;
    }
    if (state.filters.status && reel.status !== state.filters.status) {
      return false;
    }
    return true;
  }

  function renderGrid() {
    updateAuthorFilter();
    grid.innerHTML = '';

    const filtered = state.reels.filter(matchesFilters);
    el('empty-state').classList.toggle('hidden', filtered.length > 0);

    filtered.forEach((reel) => grid.appendChild(buildCard(reel)));
  }

  function formatDuration(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '';
    const total = Math.round(seconds);
    const minutes = Math.floor(total / 60);
    const rest = String(total % 60).padStart(2, '0');
    return `${minutes}:${rest}`;
  }

  function buildCard(reel) {
    const card = document.createElement('button');
    card.className = 'reel-card';

    const cover = document.createElement('div');
    cover.className = 'reel-cover';
    if (reel.coverUrl) {
      const img = document.createElement('img');
      img.src = reel.coverUrl;
      img.alt = '';
      img.loading = 'lazy';
      cover.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'reel-cover-placeholder';
      placeholder.textContent = reel.status === 'error' ? '⚠️' : '🎬';
      cover.appendChild(placeholder);
    }
    if (reel.status === 'pending') {
      const badge = document.createElement('span');
      badge.className = 'reel-status';
      badge.textContent = '⏳ обработка';
      cover.appendChild(badge);
    } else if (reel.status === 'error') {
      const badge = document.createElement('span');
      badge.className = 'reel-status';
      badge.textContent = '⚠️ ошибка';
      cover.appendChild(badge);
    }
    if (reel.duration) {
      const duration = document.createElement('span');
      duration.className = 'reel-duration';
      duration.textContent = formatDuration(reel.duration);
      cover.appendChild(duration);
    }
    card.appendChild(cover);

    const body = document.createElement('div');
    body.className = 'reel-body';

    const name = document.createElement('div');
    name.className = 'reel-name';
    name.textContent = reel.title || reel.shortcode;
    body.appendChild(name);

    const metaLine = document.createElement('div');
    metaLine.className = 'reel-meta';
    const parts = [];
    if (reel.author) parts.push('@' + reel.author);
    const date = reel.publishedAt || reel.createdAt;
    parts.push(new Date(date).toLocaleDateString('ru-RU'));
    metaLine.textContent = parts.join(' · ');
    body.appendChild(metaLine);

    card.appendChild(body);
    card.addEventListener('click', () => openModal(reel));
    return card;
  }

  function updateAuthorFilter() {
    const select = el('filter-author');
    const current = select.value;
    const authors = [
      ...new Set(state.reels.map((reel) => reel.author).filter(Boolean)),
    ].sort();

    select.innerHTML = '';
    const all = document.createElement('option');
    all.value = '';
    all.textContent = 'Все авторы';
    select.appendChild(all);
    authors.forEach((author) => {
      const option = document.createElement('option');
      option.value = author;
      option.textContent = '@' + author;
      select.appendChild(option);
    });
    if (authors.includes(current)) select.value = current;
  }

  el('filter-author').addEventListener('change', (event) => {
    state.filters.author = event.target.value;
    renderGrid();
  });

  el('filter-status').addEventListener('change', (event) => {
    state.filters.status = event.target.value;
    renderGrid();
  });

  // --- Detail modal ---

  function openModal(reel) {
    state.openedId = reel.id;
    renderModal(reel);
    backdrop.classList.remove('hidden');
  }

  function closeModal() {
    state.openedId = null;
    backdrop.classList.add('hidden');
    el('reel-modal-content').innerHTML = ''; // stops the <video>
  }

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
  });

  function renderModal(reel) {
    const container = el('reel-modal-content');
    container.innerHTML = '';

    const kicker = document.createElement('p');
    kicker.className = 'details-kicker';
    kicker.textContent =
      reel.status === 'pending'
        ? '⏳ Обрабатывается…'
        : reel.status === 'error'
          ? '⚠️ Ошибка обработки'
          : 'Reel';
    container.appendChild(kicker);

    const title = document.createElement('h2');
    title.textContent = reel.title || reel.shortcode;
    container.appendChild(title);

    const metaLine = document.createElement('div');
    metaLine.className = 'details-meta';
    if (reel.author) {
      const author = document.createElement('a');
      author.href = `https://www.instagram.com/${reel.author}/`;
      author.target = '_blank';
      author.rel = 'noopener';
      author.textContent = '@' + reel.author;
      metaLine.appendChild(author);
    }
    const addPart = (text) => {
      const span = document.createElement('span');
      span.textContent = text;
      metaLine.appendChild(span);
    };
    if (reel.publishedAt) {
      addPart(
        new Date(reel.publishedAt).toLocaleDateString('ru-RU', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }),
      );
    }
    if (reel.duration) addPart(formatDuration(reel.duration));
    if (typeof reel.meta?.viewCount === 'number') {
      addPart(`👁 ${reel.meta.viewCount.toLocaleString('ru-RU')}`);
    }
    if (typeof reel.meta?.likeCount === 'number') {
      addPart(`❤ ${reel.meta.likeCount.toLocaleString('ru-RU')}`);
    }
    if (typeof reel.meta?.commentCount === 'number') {
      addPart(`💬 ${reel.meta.commentCount.toLocaleString('ru-RU')}`);
    }
    container.appendChild(metaLine);

    if (reel.videoUrl) {
      const player = document.createElement('div');
      player.className = 'details-player';
      const video = document.createElement('video');
      video.src = reel.videoUrl;
      video.controls = true;
      video.playsInline = true;
      if (reel.coverUrl) video.poster = reel.coverUrl;
      player.appendChild(video);
      container.appendChild(player);
    }

    if (reel.status === 'error' && reel.error) {
      const error = document.createElement('p');
      error.className = 'details-error';
      error.textContent = reel.error;
      container.appendChild(error);
    }

    if (reel.description) {
      const description = document.createElement('p');
      description.className = 'details-description';
      description.textContent = reel.description;
      container.appendChild(description);
    }

    const actions = document.createElement('div');
    actions.className = 'details-actions';

    const link = document.createElement('a');
    link.className = 'mini-btn instagram-btn';
    link.href = reel.instagramUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Instagram';
    actions.appendChild(link);

    if (state.editMode && reel.status === 'error') {
      const retryButton = document.createElement('button');
      retryButton.className = 'mini-btn';
      retryButton.textContent = '🔄 Повторить';
      retryButton.addEventListener('click', () => retryReel(reel));
      actions.appendChild(retryButton);
    }

    if (state.editMode) {
      const deleteButton = document.createElement('button');
      deleteButton.className = 'mini-btn danger-btn';
      deleteButton.textContent = 'Удалить';
      deleteButton.addEventListener('click', () => deleteReel(reel));
      actions.appendChild(deleteButton);
    }

    const closeButton = document.createElement('button');
    closeButton.className = 'mini-btn';
    closeButton.textContent = 'Закрыть';
    closeButton.addEventListener('click', closeModal);
    actions.appendChild(closeButton);

    container.appendChild(actions);
  }

  // --- Edit mode (same key flow as the places page) ---

  function getApiKey() {
    return localStorage.getItem(KEY_STORAGE) || '';
  }

  async function verifyKey(key) {
    const response = await fetch(`${API_BASE}/key-check`, {
      method: 'POST',
      headers: { 'x-reels-api-key': key },
    });
    return response.ok;
  }

  async function ensureKey() {
    let key = getApiKey();
    if (key && (await verifyKey(key))) return true;
    key = window.prompt('Введите ключ редактирования:') || '';
    if (!key) return false;
    if (!(await verifyKey(key))) {
      alert('Неверный ключ');
      return false;
    }
    localStorage.setItem(KEY_STORAGE, key);
    return true;
  }

  editToggle.addEventListener('click', async () => {
    if (state.editMode) {
      setEditMode(false);
      return;
    }
    if (await ensureKey()) setEditMode(true);
  });

  function setEditMode(enabled) {
    state.editMode = enabled;
    editToggle.classList.toggle('active', enabled);
    addForm.classList.toggle('hidden', !enabled);
    if (state.openedId !== null) {
      const opened = state.reels.find((r) => r.id === state.openedId);
      if (opened) renderModal(opened); // retry/delete buttons appear
    }
  }

  // --- Adding a reel ---

  addForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = el('add-url');
    const submit = el('add-submit');
    const instagramUrl = input.value.trim();
    if (!instagramUrl) return;

    submit.disabled = true;
    submit.textContent = 'Добавляю…';
    try {
      const response = await fetch(`${API_BASE}/reels`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-reels-api-key': getApiKey(),
        },
        body: JSON.stringify({ instagramUrl }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        alert(error?.message || 'Не удалось добавить');
        return;
      }
      const created = await response.json();
      state.reels = [created, ...state.reels.filter((r) => r.id !== created.id)];
      input.value = '';
      renderGrid();
      schedulePolling();
    } finally {
      submit.disabled = false;
      submit.textContent = 'Добавить';
    }
  });

  async function retryReel(reel) {
    const response = await fetch(`${API_BASE}/reels/${reel.id}/retry`, {
      method: 'POST',
      headers: { 'x-reels-api-key': getApiKey() },
    });
    if (!response.ok) {
      alert('Не удалось перезапустить');
      return;
    }
    const restarted = await response.json();
    const index = state.reels.findIndex((r) => r.id === reel.id);
    if (index !== -1) state.reels[index] = restarted;
    renderGrid();
    renderModal(restarted);
    schedulePolling();
  }

  async function deleteReel(reel) {
    if (!confirm(`Удалить «${reel.title || reel.shortcode}»?`)) return;
    const response = await fetch(`${API_BASE}/reels/${reel.id}`, {
      method: 'DELETE',
      headers: { 'x-reels-api-key': getApiKey() },
    });
    if (!response.ok) {
      alert('Не удалось удалить');
      return;
    }
    state.reels = state.reels.filter((r) => r.id !== reel.id);
    closeModal();
    renderGrid();
  }

  loadReels();
})();
