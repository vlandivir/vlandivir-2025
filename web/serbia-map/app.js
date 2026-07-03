(() => {
  const API_BASE = '/map-api';
  const KEY_STORAGE = 'serbia-map-api-key';
  const SERBIA_CENTER = [44.2, 20.9];
  const SERBIA_BOUNDS = L.latLngBounds([41.5, 18.0], [46.5, 23.5]);
  const LIST_PAGE_SIZE = 10;
  const MAX_TRACK_POINTS = 5000;

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

  const TRACK_STYLE = { color: '#e0417f', weight: 4, opacity: 0.85 };
  const TRACK_SELECTED_STYLE = { color: '#b01c5a', weight: 6, opacity: 1 };
  const TRACK_PREVIEW_STYLE = {
    color: '#2a6df4',
    weight: 4,
    opacity: 0.7,
    dashArray: '6 8',
  };

  const state = {
    points: [],
    tracks: [],
    markers: new Map(), // point id -> Leaflet marker
    trackLayers: new Map(), // track id -> Leaflet polyline
    selected: null, // { kind: 'point' | 'track', feature }
    editMode: false,
    draftMarker: null, // temporary marker from a pasted Google Maps link
    draftTrackLayer: null, // preview polyline for a GPX being added
    // Current form target: kind 'point' | 'track', editing = existing feature
    // being changed (null = creating), latlng for new points, trackPoints for
    // new tracks.
    form: null,
    filters: { kind: '', author: '' },
    listLimit: LIST_PAGE_SIZE,
  };

  const el = (id) => document.getElementById(id);
  const searchInput = el('search-input');
  const searchResults = el('search-results');
  const editToggle = el('edit-toggle');
  const editHint = el('edit-hint');
  const backdrop = el('modal-backdrop');
  const pointForm = el('point-form');
  const recentList = el('recent-list');
  const gpxButton = el('gpx-upload');
  const gpxInput = el('gpx-file-input');
  const sidePanel = el('side-panel');
  const drawerOverlay = el('drawer-overlay');

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

  async function loadFeatures() {
    const [pointsResponse, tracksResponse] = await Promise.all([
      fetch(`${API_BASE}/points`),
      fetch(`${API_BASE}/tracks`),
    ]);
    if (pointsResponse.ok) {
      state.points = await pointsResponse.json();
      state.points.forEach(addMarker);
    }
    if (tracksResponse.ok) {
      state.tracks = await tracksResponse.json();
      state.tracks.forEach(addTrackLayer);
    }
    renderRecentPanel();
    openFeatureFromUrl();
  }

  // --- Selection (details are rendered in the side panel) ---

  function selectFeature(kind, feature, { fly = false } = {}) {
    if (state.selected?.kind === 'track') {
      state.trackLayers.get(state.selected.feature.id)?.setStyle(TRACK_STYLE);
    }
    state.selected = { kind, feature };
    if (kind === 'track') {
      state.trackLayers.get(feature.id)?.setStyle(TRACK_SELECTED_STYLE);
    }
    renderDetails();
    history.replaceState(null, '', `/serbia-map/${kind}/${feature.id}`);
    if (fly) flyToFeature(kind, feature);
    if (isMobile()) openDrawer();
  }

  function clearSelection() {
    if (state.selected?.kind === 'track') {
      state.trackLayers.get(state.selected.feature.id)?.setStyle(TRACK_STYLE);
    }
    state.selected = null;
    renderDetails();
    history.replaceState(null, '', '/serbia-map/');
  }

  function flyToFeature(kind, feature) {
    if (kind === 'track') {
      map.flyToBounds(L.latLngBounds(feature.points).pad(0.2));
    } else {
      map.flyTo([feature.latitude, feature.longitude], 14);
    }
  }

  function featureUrl(kind, feature) {
    return `${location.origin}/serbia-map/${kind}/${feature.id}`;
  }

  function openFeatureFromUrl() {
    // Path form (/serbia-map/point/3) with legacy hash (#p=3) fallback
    const pathMatch = /^\/serbia-map\/(point|track)\/(\d+)\/?$/.exec(
      location.pathname,
    );
    const hashMatch = /^#(p|t)=(\d+)$/.exec(location.hash);
    let kind;
    let id;
    if (pathMatch) {
      kind = pathMatch[1];
      id = Number(pathMatch[2]);
    } else if (hashMatch) {
      kind = hashMatch[1] === 'p' ? 'point' : 'track';
      id = Number(hashMatch[2]);
    } else {
      return;
    }
    const source = kind === 'point' ? state.points : state.tracks;
    const feature = source.find((f) => f.id === id);
    if (feature) selectFeature(kind, feature, { fly: true });
  }

  window.addEventListener('hashchange', openFeatureFromUrl);
  window.addEventListener('popstate', openFeatureFromUrl);

  // --- Details panel ---

  function renderDetails() {
    const details = el('feature-details');
    const empty = el('empty-state');
    details.innerHTML = '';

    if (!state.selected) {
      details.classList.add('hidden');
      empty.classList.remove('hidden');
      return;
    }
    details.classList.remove('hidden');
    empty.classList.add('hidden');

    const { kind, feature } = state.selected;

    const kicker = document.createElement('p');
    kicker.className = 'details-kicker';
    kicker.textContent =
      kind === 'track'
        ? `Трек · ${trackDistanceKm(feature.points)} км`
        : 'Точка на карте';
    details.appendChild(kicker);

    const title = document.createElement('h2');
    title.textContent = feature.name;
    details.appendChild(title);

    if (feature.description) {
      const description = document.createElement('p');
      description.className = 'details-description';
      description.textContent = feature.description;
      details.appendChild(description);
    }

    if (feature.instagramUrl) {
      const metaLine = document.createElement('div');
      metaLine.className = 'details-insta-meta';
      metaLine.id = 'details-insta-meta';
      renderInstagramMetaLine(metaLine, feature.instagramMeta);
      details.appendChild(metaLine);
      refreshInstagramMeta(kind, feature);
    }

    if (feature.instagramUrl) {
      const embedUrl = instagramEmbedUrl(feature.instagramUrl);
      if (embedUrl) {
        const player = document.createElement('iframe');
        player.className = 'details-player';
        player.src = embedUrl;
        player.allow = 'autoplay; encrypted-media; picture-in-picture';
        player.allowFullscreen = true;
        player.setAttribute('scrolling', 'no');
        details.appendChild(player);
        sizePlayer(player, details);
      }
    }

    const actions = document.createElement('div');
    actions.className = 'details-actions';

    const showButton = document.createElement('button');
    showButton.className = 'mini-btn';
    showButton.textContent = '🗺 Показать на карте';
    showButton.addEventListener('click', () => {
      flyToFeature(kind, feature);
      if (isMobile()) closeDrawer();
    });
    actions.appendChild(showButton);

    if (feature.instagramUrl) {
      const link = document.createElement('a');
      link.className = 'mini-btn instagram-btn';
      link.href = feature.instagramUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.innerHTML =
        '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
        '<rect x="2" y="2" width="20" height="20" rx="5.5" fill="none" stroke="currentColor" stroke-width="2"/>' +
        '<circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/>' +
        '<circle cx="17.3" cy="6.7" r="1.4" fill="currentColor"/>' +
        '</svg><span>Instagram</span>';
      actions.appendChild(link);
    }

    const shareButton = document.createElement('button');
    shareButton.className = 'mini-btn';
    shareButton.textContent = '🔗 Поделиться';
    shareButton.addEventListener('click', () =>
      shareFeature(kind, feature, shareButton),
    );
    actions.appendChild(shareButton);

    if (state.editMode) {
      const editButton = document.createElement('button');
      editButton.className = 'mini-btn';
      editButton.textContent = 'Изменить';
      editButton.addEventListener('click', () =>
        openForm({ kind, editing: feature }),
      );
      actions.appendChild(editButton);

      const deleteButton = document.createElement('button');
      deleteButton.className = 'mini-btn danger-btn';
      deleteButton.textContent = 'Удалить';
      deleteButton.addEventListener('click', () =>
        deleteFeature(kind, feature),
      );
      actions.appendChild(deleteButton);
    }

    details.appendChild(actions);
  }

  // Instagram's /embed/ page has no resize API, so pick a width at which the
  // whole embed (9:16 media + ~96px header/actions chrome) fits the viewport
  // height — then the iframe never needs an inner scrollbar.
  const EMBED_CHROME = 96;

  function sizePlayer(player, container) {
    const availableWidth = container.clientWidth - 32; // card padding
    const maxHeight = Math.round(window.innerHeight * 0.78);
    const width = Math.max(
      220,
      Math.min(availableWidth, 420, ((maxHeight - EMBED_CHROME) * 9) / 16),
    );
    player.style.width = `${Math.round(width)}px`;
    player.style.height = `${Math.round((width * 16) / 9 + EMBED_CHROME)}px`;
  }

  window.addEventListener('resize', () => {
    const player = document.querySelector('.details-player');
    if (player) sizePlayer(player, el('feature-details'));
  });

  async function shareFeature(kind, feature, button) {
    const url = featureUrl(kind, feature);

    if (navigator.share) {
      try {
        await navigator.share({ title: feature.name, url });
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

  // --- Instagram metadata (author, date, counters) ---

  function renderInstagramMetaLine(container, meta) {
    container.innerHTML = '';
    if (!meta) return;

    if (meta.username) {
      const author = document.createElement('a');
      author.href = `https://www.instagram.com/${meta.username}/`;
      author.target = '_blank';
      author.rel = 'noopener';
      author.textContent = '@' + meta.username;
      if (meta.fullName) author.title = meta.fullName;
      container.appendChild(author);
    }

    const addPart = (text) => {
      const span = document.createElement('span');
      span.textContent = text;
      container.appendChild(span);
    };

    if (meta.publishedAt) {
      addPart(
        new Date(meta.publishedAt).toLocaleDateString('ru-RU', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }),
      );
    }
    if (typeof meta.likeCount === 'number') addPart(`❤ ${meta.likeCount}`);
    if (typeof meta.commentCount === 'number') {
      addPart(`💬 ${meta.commentCount}`);
    }
  }

  // Ask the server to refresh cached reel metadata (it re-fetches from
  // Instagram at most once a day) and update the open panel in place.
  async function refreshInstagramMeta(kind, feature) {
    const resource = kind === 'track' ? 'tracks' : 'points';
    try {
      const response = await fetch(
        `${API_BASE}/${resource}/${feature.id}/instagram-meta`,
        { method: 'POST' },
      );
      if (!response.ok) return;
      const { instagramMeta, refreshed } = await response.json();
      if (!instagramMeta) return;
      feature.instagramMeta = instagramMeta;
      if (state.selected?.feature === feature) {
        const container = document.getElementById('details-insta-meta');
        if (container) renderInstagramMetaLine(container, instagramMeta);
      }
      if (refreshed) renderRecentPanel(); // new cover/author may have appeared
    } catch {
      // metadata is best-effort decoration
    }
  }

  function instagramEmbedUrl(url) {
    const match = /instagram\.com\/(reel|p|tv)\/([A-Za-z0-9_-]+)/.exec(url);
    if (!match) return null;
    return `https://www.instagram.com/${match[1]}/${match[2]}/embed/`;
  }

  // --- Markers and track layers ---

  function addMarker(point) {
    const marker = L.marker([point.latitude, point.longitude]).addTo(map);
    marker.on('click', () => selectFeature('point', point));
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

  function addTrackLayer(track) {
    const polyline = L.polyline(track.points, TRACK_STYLE).addTo(map);
    polyline.on('click', () => selectFeature('track', track));
    state.trackLayers.set(track.id, polyline);
  }

  function removeTrackLayer(trackId) {
    const layer = state.trackLayers.get(trackId);
    if (layer) {
      map.removeLayer(layer);
      state.trackLayers.delete(trackId);
    }
    state.tracks = state.tracks.filter((t) => t.id !== trackId);
  }

  map.on('click', () => {
    if (state.editMode) return; // don't fight with double-click adding
    if (state.selected) clearSelection();
  });

  // --- Places list (covers, meta, filters, pagination) ---

  function allFeatures() {
    return [
      ...state.points.map((p) => ({ kind: 'point', feature: p })),
      ...state.tracks.map((t) => ({ kind: 'track', feature: t })),
    ].sort(
      (a, b) => new Date(b.feature.createdAt) - new Date(a.feature.createdAt),
    );
  }

  function matchesFilters(kind, feature) {
    if (state.filters.kind && kind !== state.filters.kind) return false;
    if (
      state.filters.author &&
      feature.instagramMeta?.username !== state.filters.author
    ) {
      return false;
    }
    return true;
  }

  function renderRecentPanel() {
    updateAuthorFilter();
    applyMapFilter();
    recentList.innerHTML = '';

    const filtered = allFeatures().filter(({ kind, feature }) =>
      matchesFilters(kind, feature),
    );

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'recent-empty';
      empty.textContent = 'Ничего не найдено';
      recentList.appendChild(empty);
      el('list-more').classList.add('hidden');
      return;
    }

    filtered.slice(0, state.listLimit).forEach(({ kind, feature }) => {
      recentList.appendChild(buildListItem(kind, feature));
    });

    const moreButton = el('list-more');
    const remaining = filtered.length - state.listLimit;
    moreButton.classList.toggle('hidden', remaining <= 0);
    if (remaining > 0) {
      moreButton.textContent = `Показать ещё (${remaining})`;
    }
  }

  function buildListItem(kind, feature) {
    const item = document.createElement('button');
    item.className = 'recent-item';

    const meta = feature.instagramMeta;
    const coverSrc = meta?.coverUrl || meta?.thumbnailUrl;
    if (coverSrc) {
      const cover = document.createElement('img');
      cover.className = 'recent-cover';
      cover.src = coverSrc;
      cover.alt = '';
      cover.loading = 'lazy';
      item.appendChild(cover);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'recent-cover recent-cover-placeholder';
      placeholder.textContent = kind === 'track' ? '🚴' : '📍';
      item.appendChild(placeholder);
    }

    const body = document.createElement('div');
    body.className = 'recent-body';

    const name = document.createElement('div');
    name.className = 'recent-name';
    name.textContent =
      (kind === 'track' ? '🚴 ' : '') + feature.name;
    body.appendChild(name);

    const metaLine = document.createElement('div');
    metaLine.className = 'recent-meta';
    const parts = [];
    if (meta?.username) parts.push('@' + meta.username);
    const date = meta?.publishedAt || feature.createdAt;
    parts.push(new Date(date).toLocaleDateString('ru-RU'));
    if (typeof meta?.likeCount === 'number') parts.push(`❤ ${meta.likeCount}`);
    if (kind === 'track') {
      parts.push(`${trackDistanceKm(feature.points)} км`);
    }
    metaLine.textContent = parts.join(' · ');
    body.appendChild(metaLine);

    item.appendChild(body);
    item.addEventListener('click', () =>
      selectFeature(kind, feature, { fly: true }),
    );
    return item;
  }

  function updateAuthorFilter() {
    const select = el('filter-author');
    const current = select.value;
    const authors = [
      ...new Set(
        allFeatures()
          .map(({ feature }) => feature.instagramMeta?.username)
          .filter(Boolean),
      ),
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

  function applyMapFilter() {
    state.points.forEach((point) => {
      const marker = state.markers.get(point.id);
      if (!marker) return;
      const visible = matchesFilters('point', point);
      if (visible && !map.hasLayer(marker)) marker.addTo(map);
      if (!visible && map.hasLayer(marker)) map.removeLayer(marker);
    });
    state.tracks.forEach((track) => {
      const layer = state.trackLayers.get(track.id);
      if (!layer) return;
      const visible = matchesFilters('track', track);
      if (visible && !map.hasLayer(layer)) layer.addTo(map);
      if (!visible && map.hasLayer(layer)) map.removeLayer(layer);
    });
  }

  el('filter-kind').addEventListener('change', (event) => {
    state.filters.kind = event.target.value;
    state.listLimit = LIST_PAGE_SIZE;
    renderRecentPanel();
  });

  el('filter-author').addEventListener('change', (event) => {
    state.filters.author = event.target.value;
    state.listLimit = LIST_PAGE_SIZE;
    renderRecentPanel();
  });

  el('list-more').addEventListener('click', () => {
    state.listLimit += LIST_PAGE_SIZE;
    renderRecentPanel();
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
    editHint.classList.toggle('hidden', !enabled);
    gpxButton.classList.toggle('hidden', !enabled);
    // Double click is reserved for adding points while editing
    if (enabled) {
      map.doubleClickZoom.disable();
    } else {
      map.doubleClickZoom.enable();
    }
    renderDetails(); // edit/delete buttons appear or disappear
  }

  map.on('dblclick', (event) => {
    if (!state.editMode) return;
    openForm({ kind: 'point', editing: null, latlng: event.latlng });
  });

  // --- GPX upload ---

  gpxButton.addEventListener('click', () => gpxInput.click());

  gpxInput.addEventListener('change', async () => {
    const file = gpxInput.files && gpxInput.files[0];
    gpxInput.value = '';
    if (!file) return;

    const text = await file.text();
    const rawPoints = parseGpx(text);
    if (!rawPoints || rawPoints.length < 2) {
      alert('Не удалось прочитать точки трека из этого GPX-файла');
      return;
    }

    const points = simplifyTrack(smoothTrack(rawPoints));
    if (points.length > MAX_TRACK_POINTS) {
      alert('Трек слишком длинный даже после упрощения');
      return;
    }

    showDraftTrack(points, file.name.replace(/\.gpx$/i, ''));
  });

  function parseGpx(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) return null;

    let elements = doc.getElementsByTagName('trkpt');
    if (!elements.length) {
      elements = doc.getElementsByTagName('rtept');
    }

    return [...elements]
      .map((element) => [
        Number(element.getAttribute('lat')),
        Number(element.getAttribute('lon')),
      ])
      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  }

  // Moving average flattens GPS jitter; endpoints stay fixed.
  function smoothTrack(points, windowSize = 5) {
    if (points.length <= windowSize) return points;
    const half = Math.floor(windowSize / 2);
    return points.map((point, index) => {
      if (index < half || index >= points.length - half) return point;
      let lat = 0;
      let lng = 0;
      for (let i = index - half; i <= index + half; i++) {
        lat += points[i][0];
        lng += points[i][1];
      }
      return [lat / windowSize, lng / windowSize];
    });
  }

  // Douglas-Peucker; tolerance in degrees (~0.0001 ≈ 10 m).
  function simplifyTrack(points, tolerance = 0.0001) {
    if (points.length <= 2) return points;

    const keep = new Array(points.length).fill(false);
    keep[0] = keep[points.length - 1] = true;
    const stack = [[0, points.length - 1]];

    while (stack.length) {
      const [start, end] = stack.pop();
      let maxDistance = 0;
      let maxIndex = start;

      for (let i = start + 1; i < end; i++) {
        const distance = pointToSegment(points[i], points[start], points[end]);
        if (distance > maxDistance) {
          maxDistance = distance;
          maxIndex = i;
        }
      }

      if (maxDistance > tolerance) {
        keep[maxIndex] = true;
        stack.push([start, maxIndex], [maxIndex, end]);
      }
    }

    return points.filter((_, index) => keep[index]);
  }

  function pointToSegment([py, px], [ay, ax], [by, bx]) {
    const dx = bx - ax;
    const dy = by - ay;
    if (dx === 0 && dy === 0) {
      return Math.hypot(px - ax, py - ay);
    }
    let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  // Cut the given number of meters off both ends, interpolating the exact
  // cut position on the segment where it falls. Returns null if the cuts
  // would consume (almost) the whole track.
  function trimTrack(points, startMeters, endMeters) {
    const cumulative = [0];
    for (let i = 1; i < points.length; i++) {
      cumulative.push(
        cumulative[i - 1] + map.distance(points[i - 1], points[i]),
      );
    }
    const total = cumulative[cumulative.length - 1];
    if (startMeters + endMeters >= total - 10) return null;

    const from = startMeters;
    const to = total - endMeters;
    const pointAt = (target) => {
      let i = 1;
      while (cumulative[i] < target) i++;
      const segment = cumulative[i] - cumulative[i - 1] || 1;
      const t = (target - cumulative[i - 1]) / segment;
      return [
        points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t,
        points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t,
      ];
    };

    const result = [];
    if (from > 0) result.push(pointAt(from));
    for (let i = 0; i < points.length; i++) {
      if (cumulative[i] > from && cumulative[i] < to) result.push(points[i]);
    }
    if (endMeters > 0) result.push(pointAt(to));
    return result.length >= 2 ? result : null;
  }

  function trackDistanceKm(points) {
    let meters = 0;
    for (let i = 1; i < points.length; i++) {
      meters += map.distance(points[i - 1], points[i]);
    }
    return (meters / 1000).toFixed(1);
  }

  function showDraftTrack(points, suggestedName) {
    removeDraftTrack();
    const layer = L.polyline(points, TRACK_PREVIEW_STYLE).addTo(map);
    state.draftTrackLayer = layer;
    map.flyToBounds(layer.getBounds().pad(0.2));
    if (isMobile()) closeDrawer();
    openForm({
      kind: 'track',
      editing: null,
      trackPoints: points,
      prefillName: suggestedName,
    });
  }

  function removeDraftTrack() {
    if (state.draftTrackLayer) {
      map.removeLayer(state.draftTrackLayer);
      state.draftTrackLayer = null;
    }
  }

  // --- Google Maps links ---

  function isGoogleMapsLink(text) {
    return /(google\.[a-z.]+\/maps|maps\.app\.goo\.gl\/|goo\.gl\/maps)/.test(
      text,
    );
  }

  function parseGoogleMapsUrl(url) {
    // Pin coordinates (!3d..!4d..) are more precise than the viewport (@..)
    const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(url);
    if (pin) return { lat: Number(pin[1]), lng: Number(pin[2]) };
    const viewport = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(url);
    if (viewport) {
      return { lat: Number(viewport[1]), lng: Number(viewport[2]) };
    }
    const query =
      /[?&](?:q|query|ll|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)(-?\d+(?:\.\d+)?)/.exec(
        url,
      );
    if (query) return { lat: Number(query[1]), lng: Number(query[2]) };
    return null;
  }

  function parseGoogleMapsPlaceName(url) {
    const match = /\/maps\/place\/([^/@?]+)/.exec(url);
    if (!match) return '';
    try {
      return decodeURIComponent(match[1].replace(/\+/g, ' '));
    } catch {
      return '';
    }
  }

  async function expandGoogleMapsLink(url) {
    let coords = parseGoogleMapsUrl(url);
    if (coords) return { coords, name: parseGoogleMapsPlaceName(url) };

    // Short link — expand it on the server
    const response = await fetch(
      `${API_BASE}/resolve-google-link?url=${encodeURIComponent(url)}`,
    );
    if (!response.ok) return null;
    const { url: resolved } = await response.json();
    coords = parseGoogleMapsUrl(resolved);
    if (!coords) return null;
    return { coords, name: parseGoogleMapsPlaceName(resolved) };
  }

  function showDraftMarker(coords, name) {
    removeDraftMarker();
    const marker = L.marker([coords.lat, coords.lng], {
      draggable: true,
      opacity: 0.7,
    }).addTo(map);
    state.draftMarker = marker;

    marker.bindPopup(() => {
      const container = document.createElement('div');

      const title = document.createElement('div');
      title.className = 'popup-title';
      title.textContent = name || 'Точка из Google Maps';
      container.appendChild(title);

      const hint = document.createElement('div');
      hint.className = 'popup-hint';
      hint.textContent = 'Маркер можно перетащить для уточнения места';
      container.appendChild(hint);

      const addButton = document.createElement('button');
      addButton.className = 'primary-btn';
      addButton.textContent = '➕ Добавить точку';
      addButton.addEventListener('click', async () => {
        if (!(await ensureKey())) return;
        if (!state.editMode) setEditMode(true);
        openForm({
          kind: 'point',
          editing: null,
          latlng: marker.getLatLng(),
          prefillName: name,
        });
      });
      container.appendChild(addButton);

      return container;
    });

    map.flyTo([coords.lat, coords.lng], 16);
    setTimeout(() => marker.openPopup(), 600);
  }

  function removeDraftMarker() {
    if (state.draftMarker) {
      map.removeLayer(state.draftMarker);
      state.draftMarker = null;
    }
  }

  // --- Form (shared between points and tracks) ---

  function openForm({ kind, editing, latlng, trackPoints, prefillName }) {
    state.form = { kind, editing, latlng, trackPoints };

    const titles = {
      point: editing ? 'Редактировать точку' : 'Новая точка',
      track: editing ? 'Редактировать трек' : 'Новый трек',
    };
    el('form-title').textContent = titles[kind];
    el('form-name').value = editing ? editing.name : prefillName || '';
    el('form-description').value = editing?.description || '';
    el('form-instagram').value = editing?.instagramUrl || '';

    el('form-trim-row').classList.toggle('hidden', kind !== 'track');
    if (kind === 'point') {
      const coords = editing
        ? { lat: editing.latitude, lng: editing.longitude }
        : latlng;
      state.form.latlng = coords;
      el('form-coords').textContent =
        `Координаты: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
    } else {
      // Trimming an already saved track again would eat it up on every save,
      // so editing defaults to 0.
      el('form-trim-start').value = editing ? 0 : 500;
      el('form-trim-end').value = editing ? 0 : 500;
      const points = editing ? editing.points : trackPoints;
      el('form-coords').textContent =
        `Трек: ${points.length} точек, ${trackDistanceKm(points)} км`;
    }

    backdrop.classList.remove('hidden');
    el('form-name').focus();
  }

  function closeModals() {
    backdrop.classList.add('hidden');
    state.form = null;
  }

  el('form-cancel').addEventListener('click', closeModals);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeModals();
  });

  pointForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.form) return;
    const { kind, editing, latlng, trackPoints } = state.form;

    const body = {
      name: el('form-name').value,
      description: el('form-description').value,
      instagramUrl: el('form-instagram').value,
    };
    if (kind === 'point') {
      body.latitude = latlng.lat;
      body.longitude = latlng.lng;
    } else {
      const trimStart = Math.max(0, Number(el('form-trim-start').value) || 0);
      const trimEnd = Math.max(0, Number(el('form-trim-end').value) || 0);
      let points = editing ? editing.points : trackPoints;
      if (trimStart > 0 || trimEnd > 0) {
        points = trimTrack(points, trimStart, trimEnd);
        if (!points) {
          alert('Обрезка больше длины трека — уменьшите значения');
          return;
        }
        body.points = points;
      } else if (!editing) {
        body.points = points;
      }
    }

    const resource = kind === 'track' ? 'tracks' : 'points';
    const url = editing
      ? `${API_BASE}/${resource}/${editing.id}`
      : `${API_BASE}/${resource}`;
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
      alert(error?.message || 'Не удалось сохранить');
      return;
    }

    const saved = await response.json();
    if (kind === 'point') {
      if (editing) removeMarker(editing.id);
      state.points.push(saved);
      addMarker(saved);
      removeDraftMarker();
    } else {
      if (editing) removeTrackLayer(editing.id);
      state.tracks.push(saved);
      addTrackLayer(saved);
      removeDraftTrack();
    }
    renderRecentPanel();
    closeModals();
    selectFeature(kind, saved);
  });

  async function deleteFeature(kind, feature) {
    const label = kind === 'track' ? 'трек' : 'точку';
    if (!confirm(`Удалить ${label} «${feature.name}»?`)) return;

    const resource = kind === 'track' ? 'tracks' : 'points';
    const response = await fetch(`${API_BASE}/${resource}/${feature.id}`, {
      method: 'DELETE',
      headers: { 'x-map-api-key': getApiKey() },
    });

    if (!response.ok) {
      alert('Не удалось удалить');
      return;
    }

    if (kind === 'track') {
      removeTrackLayer(feature.id);
    } else {
      removeMarker(feature.id);
    }
    clearSelection();
    renderRecentPanel();
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
    if (isGoogleMapsLink(query)) {
      renderGoogleLinkResult(query);
      return;
    }

    const lowerQuery = query.toLowerCase();
    const matchesQuery = (feature) =>
      feature.name.toLowerCase().includes(lowerQuery) ||
      (feature.description || '').toLowerCase().includes(lowerQuery);
    const localMatches = [
      ...state.points
        .filter(matchesQuery)
        .map((p) => ({ kind: 'point', feature: p })),
      ...state.tracks
        .filter(matchesQuery)
        .map((t) => ({ kind: 'track', feature: t })),
    ];

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

  function renderGoogleLinkResult(link) {
    searchResults.innerHTML = '';
    const item = document.createElement('button');
    item.className = 'search-result';
    item.innerHTML = '<span class="result-tag">🗺️</span>';
    item.appendChild(
      document.createTextNode('Перейти к точке из ссылки Google Maps'),
    );
    item.addEventListener('click', async () => {
      item.disabled = true;
      item.textContent = 'Открываю ссылку…';
      const result = await expandGoogleMapsLink(link).catch(() => null);
      hideSearchResults();
      searchInput.value = '';
      if (!result) {
        alert('Не удалось извлечь координаты из этой ссылки');
        return;
      }
      if (isMobile()) closeDrawer();
      showDraftMarker(result.coords, result.name);
    });
    searchResults.appendChild(item);
    searchResults.classList.remove('hidden');
  }

  function renderSearchResults(localMatches, geoMatches) {
    searchResults.innerHTML = '';

    localMatches.slice(0, 5).forEach(({ kind, feature }) => {
      const item = document.createElement('button');
      item.className = 'search-result';
      const tag = kind === 'track' ? '🚴' : '📍';
      item.innerHTML = `<span class="result-tag">${tag}</span>`;
      item.appendChild(document.createTextNode(feature.name));
      item.addEventListener('click', () => {
        hideSearchResults();
        selectFeature(kind, feature, { fly: true });
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
        if (isMobile()) closeDrawer();
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

  loadFeatures();
})();
