(() => {
  const API_BASE = '/map-api';
  const KEY_STORAGE = 'serbia-map-api-key';
  const SERBIA_CENTER = [44.2, 20.9];
  const SERBIA_BOUNDS = L.latLngBounds([41.5, 18.0], [46.5, 23.5]);

  const map = L.map('map', {
    center: SERBIA_CENTER,
    zoom: 7,
    maxBounds: SERBIA_BOUNDS.pad(0.5),
    minZoom: 6,
  });

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  const state = {
    points: [],
    markers: new Map(), // point id -> Leaflet marker
    editMode: false,
    editingPoint: null, // point being edited, null = creating
    pendingLatLng: null,
  };

  const el = (id) => document.getElementById(id);
  const searchInput = el('search-input');
  const searchResults = el('search-results');
  const editToggle = el('edit-toggle');
  const editHint = el('edit-hint');
  const backdrop = el('modal-backdrop');
  const pointFormModal = el('point-form-modal');
  const reelModal = el('reel-modal');
  const reelContainer = el('reel-container');
  const pointForm = el('point-form');

  // --- Points ---

  async function loadPoints() {
    const response = await fetch(`${API_BASE}/points`);
    if (!response.ok) return;
    state.points = await response.json();
    state.points.forEach(addMarker);
  }

  function addMarker(point) {
    const marker = L.marker([point.latitude, point.longitude]).addTo(map);
    marker.bindPopup(() => buildPopup(point), { maxWidth: 280 });
    state.markers.set(point.id, marker);
  }

  function removeMarker(pointId) {
    const marker = state.markers.get(pointId);
    if (marker) {
      map.removeLayer(marker);
      state.markers.delete(pointId);
    }
    state.points = state.points.filter((p) => p.id !== pointId);
  }

  function buildPopup(point) {
    const container = document.createElement('div');

    const title = document.createElement('div');
    title.className = 'popup-title';
    title.textContent = point.name;
    container.appendChild(title);

    if (point.description) {
      const description = document.createElement('div');
      description.className = 'popup-description';
      description.textContent = point.description;
      container.appendChild(description);
    }

    const actions = document.createElement('div');
    actions.className = 'popup-actions';

    if (point.instagramUrl) {
      const embedUrl = instagramEmbedUrl(point.instagramUrl);
      if (embedUrl) {
        const reelButton = document.createElement('button');
        reelButton.className = 'popup-reel-button';
        reelButton.textContent = '▶ Смотреть reel';
        reelButton.addEventListener('click', () => openReel(embedUrl));
        actions.appendChild(reelButton);
      }
      const link = document.createElement('a');
      link.className = 'popup-edit-button';
      link.href = point.instagramUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Instagram ↗';
      actions.appendChild(link);
    }

    if (state.editMode) {
      const editButton = document.createElement('button');
      editButton.className = 'popup-edit-button';
      editButton.textContent = 'Изменить';
      editButton.addEventListener('click', () => openPointForm(point));
      actions.appendChild(editButton);

      const deleteButton = document.createElement('button');
      deleteButton.className = 'popup-delete-button';
      deleteButton.textContent = 'Удалить';
      deleteButton.addEventListener('click', () => deletePoint(point));
      actions.appendChild(deleteButton);
    }

    if (actions.childElementCount > 0) {
      container.appendChild(actions);
    }

    return container;
  }

  // --- Instagram embed ---

  function instagramEmbedUrl(url) {
    const match = /instagram\.com\/(reel|p|tv)\/([A-Za-z0-9_-]+)/.exec(url);
    if (!match) return null;
    return `https://www.instagram.com/${match[1]}/${match[2]}/embed/`;
  }

  function openReel(embedUrl) {
    reelContainer.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.src = embedUrl;
    iframe.allow = 'autoplay; encrypted-media';
    iframe.allowFullscreen = true;
    reelContainer.appendChild(iframe);
    backdrop.classList.remove('hidden');
    reelModal.classList.remove('hidden');
  }

  function closeModals() {
    backdrop.classList.add('hidden');
    pointFormModal.classList.add('hidden');
    reelModal.classList.add('hidden');
    reelContainer.innerHTML = '';
    state.editingPoint = null;
    state.pendingLatLng = null;
  }

  el('reel-close').addEventListener('click', closeModals);
  el('form-cancel').addEventListener('click', closeModals);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeModals();
  });

  // --- Edit mode ---

  function getApiKey() {
    return localStorage.getItem(KEY_STORAGE) || '';
  }

  async function verifyKey(key) {
    const response = await fetch(`${API_BASE}/key-check`, {
      method: 'POST',
      headers: { 'x-map-api-key': key },
    });
    return response.ok;
  }

  editToggle.addEventListener('click', async () => {
    if (state.editMode) {
      setEditMode(false);
      return;
    }

    let key = getApiKey();
    if (!key || !(await verifyKey(key))) {
      key = window.prompt('Введите ключ редактирования:') || '';
      if (!key) return;
      if (!(await verifyKey(key))) {
        alert('Неверный ключ');
        return;
      }
      localStorage.setItem(KEY_STORAGE, key);
    }
    setEditMode(true);
  });

  function setEditMode(enabled) {
    state.editMode = enabled;
    editToggle.classList.toggle('active', enabled);
    editHint.classList.toggle('hidden', !enabled);
    // Rebuild open popups so edit buttons appear/disappear
    map.closePopup();
  }

  map.on('click', (event) => {
    if (!state.editMode) return;
    state.editingPoint = null;
    state.pendingLatLng = event.latlng;
    openPointForm(null, event.latlng);
  });

  // --- Point form ---

  function openPointForm(point, latlng) {
    map.closePopup();
    state.editingPoint = point;
    el('form-title').textContent = point
      ? 'Редактировать точку'
      : 'Новая точка';
    el('form-name').value = point ? point.name : '';
    el('form-description').value = point?.description || '';
    el('form-instagram').value = point?.instagramUrl || '';
    const coords = point
      ? { lat: point.latitude, lng: point.longitude }
      : latlng;
    state.pendingLatLng = coords;
    el('form-coords').textContent =
      `Координаты: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
    backdrop.classList.remove('hidden');
    pointFormModal.classList.remove('hidden');
    el('form-name').focus();
  }

  pointForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const body = {
      name: el('form-name').value,
      description: el('form-description').value,
      instagramUrl: el('form-instagram').value,
      latitude: state.pendingLatLng.lat,
      longitude: state.pendingLatLng.lng,
    };

    const editing = state.editingPoint;
    const url = editing
      ? `${API_BASE}/points/${editing.id}`
      : `${API_BASE}/points`;
    const response = await fetch(url, {
      method: editing ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-map-api-key': getApiKey(),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      alert(error?.message || 'Не удалось сохранить точку');
      return;
    }

    const saved = await response.json();
    if (editing) {
      removeMarker(editing.id);
    }
    state.points.push(saved);
    addMarker(saved);
    closeModals();
  });

  async function deletePoint(point) {
    if (!confirm(`Удалить точку «${point.name}»?`)) return;

    const response = await fetch(`${API_BASE}/points/${point.id}`, {
      method: 'DELETE',
      headers: { 'x-map-api-key': getApiKey() },
    });

    if (!response.ok) {
      alert('Не удалось удалить точку');
      return;
    }

    map.closePopup();
    removeMarker(point.id);
  }

  // --- Search ---

  let searchTimer = null;

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const query = searchInput.value.trim();
    if (query.length < 2) {
      hideSearchResults();
      return;
    }
    searchTimer = setTimeout(() => runSearch(query), 400);
  });

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideSearchResults();
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.search-box')) hideSearchResults();
  });

  async function runSearch(query) {
    const lowerQuery = query.toLowerCase();
    const localMatches = state.points.filter(
      (p) =>
        p.name.toLowerCase().includes(lowerQuery) ||
        (p.description || '').toLowerCase().includes(lowerQuery),
    );

    let geoMatches = [];
    try {
      const params = new URLSearchParams({
        format: 'jsonv2',
        countrycodes: 'rs',
        limit: '6',
        q: query,
      });
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?${params}`,
        { headers: { Accept: 'application/json' } },
      );
      if (response.ok) {
        geoMatches = await response.json();
      }
    } catch {
      // network error — show only local matches
    }

    renderSearchResults(localMatches, geoMatches);
  }

  function renderSearchResults(localMatches, geoMatches) {
    searchResults.innerHTML = '';

    localMatches.slice(0, 5).forEach((point) => {
      const item = document.createElement('button');
      item.className = 'search-result';
      item.innerHTML = '<span class="result-tag">📍</span>';
      item.appendChild(document.createTextNode(point.name));
      item.addEventListener('click', () => {
        hideSearchResults();
        map.flyTo([point.latitude, point.longitude], 14);
        const marker = state.markers.get(point.id);
        if (marker) setTimeout(() => marker.openPopup(), 600);
      });
      searchResults.appendChild(item);
    });

    geoMatches.forEach((place) => {
      const item = document.createElement('button');
      item.className = 'search-result';
      item.innerHTML = '<span class="result-tag">🔎</span>';
      item.appendChild(document.createTextNode(place.display_name));
      item.addEventListener('click', () => {
        hideSearchResults();
        map.flyTo([Number(place.lat), Number(place.lon)], 13);
      });
      searchResults.appendChild(item);
    });

    if (!searchResults.childElementCount) {
      const empty = document.createElement('div');
      empty.className = 'search-result';
      empty.textContent = 'Ничего не найдено';
      searchResults.appendChild(empty);
    }

    searchResults.classList.remove('hidden');
  }

  function hideSearchResults() {
    searchResults.classList.add('hidden');
    searchResults.innerHTML = '';
  }

  loadPoints();
})();
