(function () {
  const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
  const STORAGE_ID = 'trip.contributorId';
  const STORAGE_NAME = 'trip.displayName';
  const CONCURRENCY = 2;

  const createView = document.getElementById('createView');
  const albumView = document.getElementById('albumView');
  const createForm = document.getElementById('createForm');
  const createError = document.getElementById('createError');
  const tripTitleInput = document.getElementById('tripTitleInput');
  const createNameInput = document.getElementById('createNameInput');
  const albumTitle = document.getElementById('albumTitle');
  const albumMeta = document.getElementById('albumMeta');
  const albumStatus = document.getElementById('albumStatus');
  const gallery = document.getElementById('gallery');
  const emptyGallery = document.getElementById('emptyGallery');
  const fileInput = document.getElementById('fileInput');
  const uploadPanel = document.getElementById('uploadPanel');
  const uploadQueue = document.getElementById('uploadQueue');
  const uploadSummary = document.getElementById('uploadSummary');
  const uploadSummaryPct = document.getElementById('uploadSummaryPct');
  const uploadOverallBar = document.getElementById('uploadOverallBar');
  const copyLinkBtn = document.getElementById('copyLinkBtn');
  const editTitleBtn = document.getElementById('editTitleBtn');
  const changeNameBtn = document.getElementById('changeNameBtn');
  const nameModal = document.getElementById('nameModal');
  const nameForm = document.getElementById('nameForm');
  const nameInput = document.getElementById('nameInput');
  const lightbox = document.getElementById('lightbox');
  const lightboxBody = document.getElementById('lightboxBody');
  const lightboxClose = document.getElementById('lightboxClose');
  const header = document.querySelector('[data-site-header]');

  /** @type {{ id: string, secret: string, title: string, ownerContributorId: string, isAdmin: boolean } | null} */
  let trip = null;
  /** @type {Array<any>} */
  let media = [];

  function t(key, vars) {
    let text;
    if (window.SiteI18n && typeof window.SiteI18n.t === 'function') {
      text = window.SiteI18n.t(key);
    } else {
      const lang = document.documentElement.lang?.startsWith('en') ? 'en' : 'ru';
      text =
        window.PAGE_I18N?.[lang]?.[key] ??
        window.PAGE_I18N?.ru?.[key] ??
        key;
    }
    if (!vars) return text;
    return String(text).replace(/\{(\w+)\}/g, (_, name) =>
      vars[name] == null ? '' : String(vars[name]),
    );
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getContributorId() {
    let id = localStorage.getItem(STORAGE_ID);
    if (!id) {
      id = uuid();
      localStorage.setItem(STORAGE_ID, id);
    }
    return id;
  }

  function getDisplayName() {
    return (localStorage.getItem(STORAGE_NAME) || '').trim();
  }

  function setDisplayName(name) {
    localStorage.setItem(STORAGE_NAME, name.trim());
  }

  function ensureDisplayName() {
    return new Promise((resolve) => {
      const existing = getDisplayName();
      if (existing) {
        resolve(existing);
        return;
      }
      nameInput.value = '';
      nameModal.hidden = false;
      const onSubmit = (event) => {
        event.preventDefault();
        const name = nameInput.value.trim();
        if (!name) return;
        setDisplayName(name);
        nameModal.hidden = true;
        nameForm.removeEventListener('submit', onSubmit);
        resolve(name);
      };
      nameForm.addEventListener('submit', onSubmit);
    });
  }

  function parseSecretFromPath() {
    const parts = location.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    // /trip | /trip/en | /trip/<secret> | /trip/en/<secret>
    if (parts[0] !== 'trip') return null;
    if (parts.length === 1) return null;
    if (parts[1] === 'en') return parts[2] || null;
    return parts[1] || null;
  }

  function albumPath(secret) {
    const en = document.documentElement.lang?.startsWith('en');
    return en ? `/trip/en/${secret}` : `/trip/${secret}`;
  }

  function absoluteAlbumUrl(secret) {
    return `${location.origin}${albumPath(secret)}`;
  }

  function syncHeaderLangPaths(secret) {
    if (!header) return;
    if (secret) {
      header.dataset.langRu = `/trip/${secret}`;
      header.dataset.langEn = `/trip/en/${secret}`;
    } else {
      header.dataset.langRu = '/trip';
      header.dataset.langEn = '/trip/en';
    }
  }

  async function api(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    const response = await fetch(path, { ...options, headers });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { message: text };
    }
    if (!response.ok) {
      const message =
        data?.message ||
        (Array.isArray(data?.message) ? data.message.join(', ') : null) ||
        `HTTP ${response.status}`;
      throw new Error(message);
    }
    return data;
  }

  function showStatus(message, isError) {
    if (!message) {
      albumStatus.hidden = true;
      albumStatus.textContent = '';
      return;
    }
    albumStatus.hidden = false;
    albumStatus.textContent = message;
    albumStatus.style.color = isError
      ? 'hsl(var(--destructive))'
      : 'var(--v-muted)';
  }

  async function sha256File(file, onProgress) {
    // Prefer streaming incremental SHA-256 so large phone videos don't need
    // a full in-memory ArrayBuffer.
    if (file.stream && typeof ReadableStream !== 'undefined') {
      try {
        return await sha256Stream(file.stream(), file.size, onProgress);
      } catch {
        // fall through
      }
    }
    onProgress?.(0.5);
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    onProgress?.(1);
    return hexFromBuffer(digest);
  }

  async function sha256Stream(stream, totalBytes, onProgress) {
    const hasher = createSha256();
    const reader = stream.getReader();
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hasher.update(value);
      loaded += value.byteLength;
      if (totalBytes > 0) onProgress?.(Math.min(1, loaded / totalBytes));
    }
    onProgress?.(1);
    return hasher.digestHex();
  }

  function hexFromBuffer(buffer) {
    return [...new Uint8Array(buffer)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Minimal incremental SHA-256 (public domain style) for large file streams.
  function createSha256() {
    const K = new Uint32Array([
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
      0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
      0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
      0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
      0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
      0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]);
    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;
    const buffer = new Uint8Array(64);
    let bufferLength = 0;
    let bytesHashed = 0n;

    function rotr(n, x) {
      return (x >>> n) | (x << (32 - n));
    }

    function processBlock(block) {
      const w = new Uint32Array(64);
      for (let i = 0; i < 16; i++) {
        const j = i * 4;
        w[i] =
          (block[j] << 24) |
          (block[j + 1] << 16) |
          (block[j + 2] << 8) |
          block[j + 3];
      }
      for (let i = 16; i < 64; i++) {
        const s0 =
          rotr(7, w[i - 15]) ^ rotr(18, w[i - 15]) ^ (w[i - 15] >>> 3);
        const s1 =
          rotr(17, w[i - 2]) ^ rotr(19, w[i - 2]) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = h0;
      let b = h1;
      let c = h2;
      let d = h3;
      let e = h4;
      let f = h5;
      let g = h6;
      let h = h7;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + temp1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) >>> 0;
      }
      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
      h5 = (h5 + f) >>> 0;
      h6 = (h6 + g) >>> 0;
      h7 = (h7 + h) >>> 0;
    }

    return {
      update(chunk) {
        let offset = 0;
        while (offset < chunk.length) {
          const take = Math.min(64 - bufferLength, chunk.length - offset);
          buffer.set(chunk.subarray(offset, offset + take), bufferLength);
          bufferLength += take;
          offset += take;
          if (bufferLength === 64) {
            processBlock(buffer);
            bytesHashed += 64n;
            bufferLength = 0;
          }
        }
      },
      digestHex() {
        const bitLen = (bytesHashed + BigInt(bufferLength)) * 8n;
        buffer[bufferLength++] = 0x80;
        if (bufferLength > 56) {
          while (bufferLength < 64) buffer[bufferLength++] = 0;
          processBlock(buffer);
          bufferLength = 0;
        }
        while (bufferLength < 56) buffer[bufferLength++] = 0;
        const view = new DataView(buffer.buffer);
        view.setUint32(56, Number((bitLen >> 32n) & 0xffffffffn));
        view.setUint32(60, Number(bitLen & 0xffffffffn));
        processBlock(buffer);
        const out = new Uint8Array(32);
        const outView = new DataView(out.buffer);
        outView.setUint32(0, h0);
        outView.setUint32(4, h1);
        outView.setUint32(8, h2);
        outView.setUint32(12, h3);
        outView.setUint32(16, h4);
        outView.setUint32(20, h5);
        outView.setUint32(24, h6);
        outView.setUint32(28, h7);
        return hexFromBuffer(out.buffer);
      },
    };
  }

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function renderGallery() {
    gallery.innerHTML = '';
    const visible = media;
    emptyGallery.hidden = visible.length > 0;
    for (const item of visible) {
      const card = document.createElement('article');
      card.className = 'trip-card' + (item.deleted ? ' deleted' : '');
      card.dataset.id = item.id;

      if (item.deleted) {
        const badge = document.createElement('span');
        badge.className = 'badge trip-card__badge';
        badge.textContent = t('deletedBadge');
        card.appendChild(badge);
      }

      const mine = item.contributorId === getContributorId();
      if ((mine || trip?.isAdmin) && !item.deleted) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'mini-btn trip-card__delete';
        del.textContent = t('deleteBtn');
        del.addEventListener('click', (event) => {
          event.stopPropagation();
          void deleteMedia(item.id);
        });
        card.appendChild(del);
      }

      const mediaBtn = document.createElement('button');
      mediaBtn.type = 'button';
      mediaBtn.className =
        'trip-card__media' + (item.kind === 'video' ? ' is-video' : '');
      const previewUrl = item.thumbUrl || item.url;
      if (item.kind === 'video' && !item.thumbUrl) {
        // Thumb still generating — cheap poster via muted video metadata.
        const video = document.createElement('video');
        video.src = item.url;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        mediaBtn.appendChild(video);
      } else {
        const img = document.createElement('img');
        img.src = previewUrl;
        img.alt = item.originalFilename;
        img.loading = 'lazy';
        mediaBtn.appendChild(img);
      }
      mediaBtn.addEventListener('click', () => openLightbox(item));
      card.appendChild(mediaBtn);

      const meta = document.createElement('div');
      meta.className = 'trip-card__meta';
      meta.innerHTML = `<strong></strong><span></span>`;
      meta.querySelector('strong').textContent = item.originalFilename;
      meta.querySelector('span').textContent =
        `${t('byAuthor')} ${item.displayName} · ${formatBytes(item.size)}`;
      card.appendChild(meta);

      gallery.appendChild(card);
    }
  }

  function openLightbox(item) {
    lightboxBody.innerHTML = '';
    if (item.kind === 'video') {
      const video = document.createElement('video');
      video.src = item.url;
      video.controls = true;
      video.autoplay = true;
      video.playsInline = true;
      lightboxBody.appendChild(video);
    } else {
      const img = document.createElement('img');
      img.src = item.url;
      img.alt = item.originalFilename;
      lightboxBody.appendChild(img);
    }
    lightbox.hidden = false;
  }

  function closeLightbox() {
    lightbox.hidden = true;
    lightboxBody.innerHTML = '';
  }

  async function deleteMedia(id) {
    if (!trip) return;
    if (!confirm(t('confirmDelete'))) return;
    await api(`/trip-api/trips/${trip.secret}/media/${id}`, {
      method: 'DELETE',
      headers: { 'X-Contributor-Id': getContributorId() },
    });
    await loadMedia();
  }

  async function loadTrip(secret) {
    try {
      trip = await api(`/trip-api/trips/${encodeURIComponent(secret)}`);
    } catch {
      showCreate();
      createError.hidden = false;
      createError.textContent = t('tripNotFound');
      return;
    }
    createView.hidden = true;
    albumView.hidden = false;
    emptyGallery.hidden = false;
    albumTitle.textContent = trip.title;
    syncHeaderLangPaths(trip.secret);
    const bits = [`${t('itemsCount')}`];
    if (trip.ownerContributorId === getContributorId()) {
      bits.unshift(t('youAreOwner'));
      editTitleBtn.hidden = false;
    } else {
      editTitleBtn.hidden = true;
    }
    albumMeta.textContent = bits.join(' · ');
    // Load the gallery immediately; only ask for a name when uploading.
    await loadMedia();
    if (!getDisplayName()) {
      void ensureDisplayName();
    }
  }

  async function loadMedia() {
    if (!trip) return;
    const data = await api(
      `/trip-api/trips/${encodeURIComponent(trip.secret)}/media`,
    );
    trip.isAdmin = data.isAdmin;
    media = data.media || [];
    albumMeta.textContent = [
      trip.ownerContributorId === getContributorId() ? t('youAreOwner') : null,
      `${media.filter((m) => !m.deleted).length} ${t('itemsCount')}`,
    ]
      .filter(Boolean)
      .join(' · ');
    renderGallery();
    // Video thumbs are built in the background — refresh a few times.
    const pendingThumbs = media.some((m) => !m.thumbUrl && !m.deleted);
    if (pendingThumbs) {
      loadMedia._thumbTries = (loadMedia._thumbTries || 0) + 1;
      if (loadMedia._thumbTries <= 5) {
        window.clearTimeout(loadMedia._thumbTimer);
        loadMedia._thumbTimer = window.setTimeout(() => {
          void loadMedia();
        }, 4000);
      }
    } else {
      loadMedia._thumbTries = 0;
    }
  }

  function showCreate() {
    createView.hidden = false;
    albumView.hidden = true;
    syncHeaderLangPaths(null);
    const name = getDisplayName();
    if (name) createNameInput.value = name;
  }

  createForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    createError.hidden = true;
    const title = tripTitleInput.value.trim();
    const displayName = createNameInput.value.trim();
    if (!title || !displayName) return;
    setDisplayName(displayName);
    try {
      const created = await api('/trip-api/trips', {
        method: 'POST',
        body: JSON.stringify({
          title,
          displayName,
          contributorId: getContributorId(),
        }),
      });
      history.replaceState({}, '', albumPath(created.secret));
      await loadTrip(created.secret);
      showStatus(t('linkCopied'));
      try {
        await navigator.clipboard.writeText(absoluteAlbumUrl(created.secret));
      } catch {
        // ignore
      }
    } catch (error) {
      createError.hidden = false;
      createError.textContent = error.message || t('createFailed');
    }
  });

  copyLinkBtn.addEventListener('click', async () => {
    if (!trip) return;
    try {
      await navigator.clipboard.writeText(absoluteAlbumUrl(trip.secret));
      showStatus(t('linkCopied'));
    } catch {
      prompt(t('copyLink'), absoluteAlbumUrl(trip.secret));
    }
  });

  editTitleBtn.addEventListener('click', async () => {
    if (!trip) return;
    const next = prompt(t('renamePrompt'), trip.title);
    if (!next || !next.trim() || next.trim() === trip.title) return;
    const updated = await api(`/trip-api/trips/${trip.secret}`, {
      method: 'PATCH',
      headers: { 'X-Contributor-Id': getContributorId() },
      body: JSON.stringify({ title: next.trim() }),
    });
    trip.title = updated.title;
    albumTitle.textContent = trip.title;
  });

  changeNameBtn.addEventListener('click', () => {
    nameInput.value = getDisplayName();
    nameModal.hidden = false;
    const onSubmit = (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      if (!name) return;
      setDisplayName(name);
      nameModal.hidden = true;
      nameForm.removeEventListener('submit', onSubmit);
    };
    nameForm.addEventListener('submit', onSubmit);
  });

  lightboxClose.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox) closeLightbox();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeLightbox();
  });

  function makeQueueItem(file) {
    const el = document.createElement('div');
    el.className = 'trip-upload-item';
    el.innerHTML = `
      <div class="trip-upload-item__row">
        <span class="name"></span>
        <span class="state"></span>
      </div>
      <div class="trip-upload-item__bar"><span></span></div>
    `;
    el.querySelector('.name').textContent = `${file.name} (${formatBytes(file.size)})`;
    const stateEl = el.querySelector('.state');
    const barEl = el.querySelector('.trip-upload-item__bar > span');
    const item = {
      el,
      file,
      /** 0..1 fraction of this file's work (hash + upload + complete). */
      fraction: 0,
      done: false,
      setState(text, pct) {
        stateEl.textContent = text;
        if (typeof pct === 'number') {
          const clamped = Math.max(0, Math.min(100, pct));
          barEl.style.width = `${clamped}%`;
          item.fraction = clamped / 100;
          refreshOverallProgress();
        }
      },
      markDone() {
        item.done = true;
        item.fraction = 1;
        refreshOverallProgress();
      },
    };
    return item;
  }

  /** @type {ReturnType<typeof makeQueueItem>[]} */
  let activeUploadItems = [];

  function refreshOverallProgress() {
    if (!activeUploadItems.length) return;
    const total = activeUploadItems.length;
    const done = activeUploadItems.filter((item) => item.done).length;
    const avg =
      activeUploadItems.reduce((sum, item) => sum + item.fraction, 0) / total;
    const pct = Math.round(avg * 100);
    const finished = done === total;
    uploadSummary.textContent = finished
      ? t('uploadSummaryDone', { done, total })
      : t('uploadSummary', { done, total });
    uploadSummaryPct.textContent = `${pct}%`;
    uploadOverallBar.style.width = `${pct}%`;
  }

  async function readImageDims(file) {
    if (!file.type.startsWith('image/')) return { width: null, height: null };
    try {
      const bitmap = await createImageBitmap(file);
      const dims = { width: bitmap.width, height: bitmap.height };
      bitmap.close?.();
      return dims;
    } catch {
      return { width: null, height: null };
    }
  }

  async function uploadOne(file, queueItem) {
    if (!trip) return;
    if (file.size > MAX_FILE_BYTES) {
      queueItem.setState(t('tooLarge'), 100);
      queueItem.markDone();
      return;
    }
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      queueItem.setState(t('badType'), 100);
      queueItem.markDone();
      return;
    }

    const displayName = await ensureDisplayName();
    queueItem.setState(t('hashing'), 1);
    const contentHash = await sha256File(file, (ratio) => {
      const pct = Math.round(ratio * 100);
      queueItem.setState(`${t('hashing')} ${pct}%`, ratio * 25);
    });
    const dims = await readImageDims(file);

    const payload = {
      contentHash,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      originalFilename: file.name || 'file',
      contributorId: getContributorId(),
      displayName,
      width: dims.width,
      height: dims.height,
    };

    queueItem.setState(t('uploading'), 28);
    const check = await api(
      `/trip-api/trips/${encodeURIComponent(trip.secret)}/uploads/check`,
      { method: 'POST', body: JSON.stringify(payload) },
    );

    if (check.status === 'alreadyExists') {
      queueItem.setState(t('alreadyExists'), 100);
      queueItem.markDone();
      return;
    }
    if (check.status === 'restored') {
      queueItem.setState(t('restored'), 100);
      queueItem.markDone();
      return;
    }

    await putWithProgress(check.uploadUrl, file, check.headers || {}, (pct) => {
      // Upload is the bulk of the work: map 0..100% → 30..90 of the bar.
      const label =
        pct < 100
          ? `${t('uploading')} ${pct}% · ${formatBytes((file.size * pct) / 100)}`
          : t('uploading');
      queueItem.setState(label, 30 + pct * 0.6);
    });

    queueItem.setState(t('finishing'), 92);
    const done = await api(
      `/trip-api/trips/${encodeURIComponent(trip.secret)}/uploads/complete`,
      { method: 'POST', body: JSON.stringify(payload) },
    );
    if (done.status === 'alreadyExists') {
      queueItem.setState(t('alreadyExists'), 100);
    } else if (done.status === 'restored') {
      queueItem.setState(t('restored'), 100);
    } else {
      queueItem.setState(t('uploaded'), 100);
    }
    queueItem.markDone();
  }

  function putWithProgress(url, file, headers, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      Object.entries(headers).forEach(([key, value]) => {
        xhr.setRequestHeader(key, value);
      });
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        onProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(file);
    });
  }

  async function processFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    uploadPanel.hidden = false;
    uploadQueue.innerHTML = '';
    activeUploadItems = files.map((file) => {
      const item = makeQueueItem(file);
      item.setState(t('waiting'), 0);
      uploadQueue.appendChild(item.el);
      return item;
    });
    refreshOverallProgress();
    uploadPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    let index = 0;
    async function worker() {
      while (index < activeUploadItems.length) {
        const current = activeUploadItems[index++];
        try {
          await uploadOne(current.file, current);
        } catch (error) {
          current.setState(
            `${t('failed')}: ${error.message || ''}`.trim(),
            100,
          );
          current.markDone();
        }
      }
    }
    await Promise.all(
      Array.from({
        length: Math.min(CONCURRENCY, activeUploadItems.length),
      }, () => worker()),
    );
    refreshOverallProgress();
    loadMedia._thumbTries = 0;
    await loadMedia();
  }

  fileInput.addEventListener('change', () => {
    const files = fileInput.files;
    fileInput.value = '';
    if (files?.length) void processFiles(files);
  });

  // Boot
  getContributorId();
  const secret = parseSecretFromPath();
  if (secret) {
    createView.hidden = true;
    albumView.hidden = false;
    void loadTrip(secret).catch((error) => {
      showStatus(error.message || t('loadFailed'), true);
    });
  } else {
    showCreate();
  }
})();
