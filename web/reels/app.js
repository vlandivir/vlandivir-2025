(() => {
  const API_BASE = '/reels-api';
  const KEY_STORAGE = 'reels-api-key';
  const POLL_INTERVAL_MS = 4000;
  const LIST_PAGE_SIZE = 10;

  // The page is unlisted: /reels/<secret>[/<reelId>]. The same secret is the
  // read key for the API.
  const PAGE_KEY = decodeURIComponent(location.pathname.split('/')[2] || '');
  const BASE_PATH = `/reels/${encodeURIComponent(PAGE_KEY)}`;

  const state = {
    reels: [],
    selected: null, // reel object
    editMode: false,
    filters: { author: '', status: '', query: '' },
    listLimit: LIST_PAGE_SIZE,
    pollTimer: null,
  };

  const el = (id) => document.getElementById(id);
  const recentList = el('recent-list');
  const editToggle = el('edit-toggle');
  const addForm = el('add-form');
  const searchInput = el('search-input');
  const sidePanel = el('side-panel');
  const drawerOverlay = el('drawer-overlay');
  const player = el('player');

  const pageHeaders = { 'x-reels-page-key': PAGE_KEY };

  const isMobile = () => window.matchMedia('(max-width: 899px)').matches;

  // --- Mobile drawer ---

  function openDrawer() {
    sidePanel.classList.add('open');
    drawerOverlay.classList.remove('hidden');
  }

  function closeDrawer() {
    sidePanel.classList.remove('open');
    drawerOverlay.classList.add('hidden');
  }

  el('drawer-open').addEventListener('click', openDrawer);
  el('drawer-close').addEventListener('click', closeDrawer);
  drawerOverlay.addEventListener('click', closeDrawer);

  // --- Loading ---

  async function loadReels() {
    const response = await fetch(`${API_BASE}/reels`, { headers: pageHeaders });
    if (response.status === 401) {
      el('access-denied').classList.remove('hidden');
      return;
    }
    if (!response.ok) return;
    state.reels = await response.json();
    renderList();
    openReelFromUrl();
    schedulePolling();
    if (isMobile() && !state.selected) openDrawer();
  }

  // --- Selection (player on the left, details in the panel) ---

  function selectReel(reel, { fromUrl = false } = {}) {
    state.selected = reel;
    renderPlayer();
    renderDetails();
    renderList(); // highlight the selected row
    if (!fromUrl) {
      history.replaceState(null, '', `${BASE_PATH}/${reel.id}`);
    }
    if (isMobile()) closeDrawer(); // show the player
  }

  function clearSelection() {
    state.selected = null;
    renderPlayer();
    renderDetails();
    renderList();
    history.replaceState(null, '', BASE_PATH);
  }

  function openReelFromUrl() {
    const match = /^\/reels\/[^/]+\/(\d+)\/?$/.exec(location.pathname);
    if (!match) return false;
    const reel = state.reels.find((r) => r.id === Number(match[1]));
    if (reel) selectReel(reel, { fromUrl: true });
    return Boolean(reel);
  }

  window.addEventListener('popstate', () => {
    if (!openReelFromUrl()) clearSelection();
  });

  // Mobile-only buttons in the details block depend on the breakpoint
  window
    .matchMedia('(max-width: 899px)')
    .addEventListener('change', renderDetails);

  // --- Player pane ---

  function renderPlayer() {
    const empty = el('player-empty');
    const status = el('player-status');
    const reel = state.selected;

    if (!reel) {
      player.pause();
      player.removeAttribute('src');
      player.classList.add('hidden');
      status.classList.add('hidden');
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');

    if (reel.status === 'ready' && reel.videoUrl) {
      status.classList.add('hidden');
      if (player.getAttribute('src') !== reel.videoUrl) {
        player.src = reel.videoUrl;
        if (reel.coverUrl) player.poster = reel.coverUrl;
      }
      player.classList.remove('hidden');
      return;
    }

    player.pause();
    player.removeAttribute('src');
    player.classList.add('hidden');
    status.textContent =
      reel.status === 'pending'
        ? '⏳ Ролик обрабатывается — видео появится здесь'
        : '⚠️ Не удалось обработать ролик';
    status.classList.remove('hidden');
  }

  // --- Details panel ---

  function formatDuration(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '';
    const total = Math.round(seconds);
    const minutes = Math.floor(total / 60);
    const rest = String(total % 60).padStart(2, '0');
    return `${minutes}:${rest}`;
  }

  function renderDetails() {
    const details = el('reel-details');
    const empty = el('empty-state');
    details.innerHTML = '';

    if (!state.selected) {
      details.classList.add('hidden');
      empty.classList.remove('hidden');
      return;
    }
    details.classList.remove('hidden');
    empty.classList.add('hidden');

    const reel = state.selected;

    const kicker = document.createElement('p');
    kicker.className = 'details-kicker';
    kicker.textContent =
      reel.status === 'pending'
        ? '⏳ Обрабатывается…'
        : reel.status === 'error'
          ? '⚠️ Ошибка обработки'
          : 'Reel';
    details.appendChild(kicker);

    const title = document.createElement('h2');
    title.textContent = reel.title || reel.shortcode;
    details.appendChild(title);

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
    if (reel.source === 'map') addPart('📍 с карты');
    details.appendChild(metaLine);

    if (reel.status === 'error' && reel.error) {
      const error = document.createElement('p');
      error.className = 'details-error';
      error.textContent = reel.error;
      details.appendChild(error);
    }

    if (reel.description) {
      const description = document.createElement('p');
      description.className = 'details-description';
      description.textContent = reel.description;
      details.appendChild(description);
    }

    const actions = document.createElement('div');
    actions.className = 'details-actions';

    if (isMobile()) {
      const showButton = document.createElement('button');
      showButton.className = 'mini-btn';
      showButton.textContent = '▶️ Показать видео';
      showButton.addEventListener('click', closeDrawer);
      actions.appendChild(showButton);
    }

    const link = document.createElement('a');
    link.className = 'mini-btn instagram-btn';
    link.href = reel.instagramUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Instagram';
    actions.appendChild(link);

    const shareButton = document.createElement('button');
    shareButton.className = 'mini-btn';
    shareButton.textContent = '🔗 Поделиться';
    shareButton.addEventListener('click', () => shareReel(reel, shareButton));
    actions.appendChild(shareButton);

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

    details.appendChild(actions);
  }

  async function shareReel(reel, button) {
    const url = `${location.origin}${BASE_PATH}/${reel.id}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: reel.title || reel.shortcode, url });
        return;
      } catch {
        // user cancelled the share sheet — fall back to copying
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      const original = button.textContent;
      button.textContent = '✓ Скопировано';
      setTimeout(() => {
        button.textContent = original;
      }, 1500);
    } catch {
      window.prompt('Ссылка:', url);
    }
  }

  // --- Reels list (covers, meta, filters, pagination) ---

  function reelDate(reel) {
    return new Date(reel.publishedAt || reel.createdAt);
  }

  function matchesFilters(reel) {
    if (state.filters.author && reel.author !== state.filters.author) {
      return false;
    }
    if (state.filters.status && reel.status !== state.filters.status) {
      return false;
    }
    if (state.filters.query) {
      const haystack = [reel.title, reel.description, reel.author]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(state.filters.query)) return false;
    }
    return true;
  }

  function renderList() {
    updateAuthorFilter();
    recentList.innerHTML = '';

    const filtered = state.reels
      .filter(matchesFilters)
      .sort((a, b) => reelDate(b) - reelDate(a));

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'recent-empty';
      empty.textContent = state.reels.length
        ? 'Ничего не найдено'
        : 'Пока пусто — включите режим редактирования и добавьте первую ссылку';
      recentList.appendChild(empty);
      el('list-more').classList.add('hidden');
      return;
    }

    filtered.slice(0, state.listLimit).forEach((reel) => {
      recentList.appendChild(buildListItem(reel));
    });

    const moreButton = el('list-more');
    const remaining = filtered.length - state.listLimit;
    moreButton.classList.toggle('hidden', remaining <= 0);
    if (remaining > 0) {
      moreButton.textContent = `Показать ещё (${remaining})`;
    }
  }

  function buildListItem(reel) {
    const item = document.createElement('button');
    item.className = 'recent-item';
    if (state.selected?.id === reel.id) item.classList.add('selected');

    if (reel.coverUrl) {
      const cover = document.createElement('img');
      cover.className = 'recent-cover';
      cover.src = reel.coverUrl;
      cover.alt = '';
      cover.loading = 'lazy';
      item.appendChild(cover);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'recent-cover recent-cover-placeholder';
      placeholder.textContent =
        reel.status === 'error' ? '⚠️' : reel.status === 'pending' ? '⏳' : '🎬';
      item.appendChild(placeholder);
    }

    const body = document.createElement('div');
    body.className = 'recent-body';

    const name = document.createElement('div');
    name.className = 'recent-name';
    name.textContent = reel.title || reel.shortcode;
    body.appendChild(name);

    const metaLine = document.createElement('div');
    metaLine.className = 'recent-meta';
    const parts = [];
    if (reel.status === 'pending') parts.push('⏳ обработка');
    if (reel.status === 'error') parts.push('⚠️ ошибка');
    if (reel.author) parts.push('@' + reel.author);
    parts.push(reelDate(reel).toLocaleDateString('ru-RU'));
    if (reel.duration) parts.push(formatDuration(reel.duration));
    if (typeof reel.meta?.likeCount === 'number') {
      parts.push(`❤ ${reel.meta.likeCount}`);
    }
    if (reel.source === 'map') parts.push('📍 с карты');
    metaLine.textContent = parts.join(' · ');
    body.appendChild(metaLine);

    item.appendChild(body);
    item.addEventListener('click', () => selectReel(reel));
    return item;
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
    state.listLimit = LIST_PAGE_SIZE;
    renderList();
  });

  el('filter-status').addEventListener('change', (event) => {
    state.filters.status = event.target.value;
    state.listLimit = LIST_PAGE_SIZE;
    renderList();
  });

  searchInput.addEventListener('input', () => {
    state.filters.query = searchInput.value.trim().toLowerCase();
    state.listLimit = LIST_PAGE_SIZE;
    renderList();
  });

  el('list-more').addEventListener('click', () => {
    state.listLimit += LIST_PAGE_SIZE;
    renderList();
  });

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
          if (state.selected?.id === reel.id) state.selected = fresh;
        } catch {
          // transient network error — retry on the next tick
        }
      }),
    );
    renderList();
    renderPlayer();
    renderDetails();
    schedulePolling();
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
    el('edit-hint').classList.toggle('hidden', !enabled);
    renderDetails(); // retry/delete buttons appear or disappear
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
      state.reels = [
        created,
        ...state.reels.filter((r) => r.id !== created.id),
      ];
      input.value = '';
      renderList();
      selectReel(created);
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
    if (state.selected?.id === reel.id) state.selected = restarted;
    renderList();
    renderPlayer();
    renderDetails();
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
    if (state.selected?.id === reel.id) {
      clearSelection();
    } else {
      renderList();
    }
  }

  loadReels();
})();
