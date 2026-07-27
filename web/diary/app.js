(() => {
  const API_BASE = '/diary-api';
  const BASE_PATH = '/diary';

  const MONTHS_RU = [
    'Январь',
    'Февраль',
    'Март',
    'Апрель',
    'Май',
    'Июнь',
    'Июль',
    'Август',
    'Сентябрь',
    'Октябрь',
    'Ноябрь',
    'Декабрь',
  ];

  // Year-agnostic, so February keeps its leap day (29).
  const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  const dayTitleFormat = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
  });
  const noteDateFormat = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const el = (id) => document.getElementById(id);
  const calendarView = el('calendar-view');
  const dayView = el('day-view');
  const errorBox = el('error');

  const pad2 = (n) => String(n).padStart(2, '0');

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.remove('hidden');
  }

  function clearError() {
    errorBox.textContent = '';
    errorBox.classList.add('hidden');
  }

  async function api(path, options) {
    const response = await fetch(`${API_BASE}${path}`, options);
    if (response.status === 401) {
      const redirect = encodeURIComponent(location.pathname + location.search);
      location.href = `/auth/google?redirect=${redirect}`;
      throw new Error('unauthorized');
    }
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    return response.json();
  }

  // --- Routing ---

  // Returns { month, day } (1-indexed) for /diary/MM-DD, else null.
  function parseDayPath() {
    const match = location.pathname.match(/^\/diary\/(\d{2})-(\d{2})\/?$/);
    if (!match) return null;
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { month, day };
  }

  function render() {
    clearError();
    const target = parseDayPath();
    if (target) {
      calendarView.classList.add('hidden');
      dayView.classList.remove('hidden');
      void renderDay(target.month, target.day);
    } else {
      dayView.classList.add('hidden');
      calendarView.classList.remove('hidden');
      void renderCalendar();
    }
  }

  function navigate(path) {
    history.pushState({}, '', path);
    render();
  }

  // --- Calendar view ---

  async function renderCalendar() {
    const container = el('months');
    if (container.dataset.loaded === '1') return;

    let data;
    try {
      data = await api('/calendar');
    } catch (err) {
      if (err.message !== 'unauthorized') {
        showError('Не удалось загрузить календарь.');
      }
      return;
    }

    const present = new Set(
      (data.days || []).map((d) => `${d.month}-${d.day}`),
    );

    const frag = document.createDocumentFragment();
    for (let month = 1; month <= 12; month += 1) {
      const card = document.createElement('div');
      card.className = 'editor-card month-card';

      const title = document.createElement('h2');
      title.className = 'month-name';
      title.textContent = MONTHS_RU[month - 1];
      card.append(title);

      const grid = document.createElement('div');
      grid.className = 'day-grid';
      for (let day = 1; day <= DAYS_IN_MONTH[month - 1]; day += 1) {
        const cell = document.createElement('a');
        cell.className = 'day-cell';
        cell.textContent = String(day);
        const href = `${BASE_PATH}/${pad2(month)}-${pad2(day)}`;
        cell.href = href;
        if (present.has(`${month}-${day}`)) {
          cell.classList.add('has-notes');
          cell.title = 'Есть записи';
        }
        cell.addEventListener('click', (event) => {
          event.preventDefault();
          navigate(href);
        });
        grid.append(cell);
      }
      card.append(grid);
      frag.append(card);
    }

    container.replaceChildren(frag);
    container.dataset.loaded = '1';
  }

  // --- Day view ---

  async function renderDay(month, day) {
    const yearsBox = el('years');
    const emptyBox = el('day-empty');
    yearsBox.replaceChildren();
    emptyBox.classList.add('hidden');

    // Use a fixed year just for the localized "5 июля" label.
    el('day-title').textContent = dayTitleFormat.format(
      new Date(2000, month - 1, day),
    );

    let data;
    try {
      data = await api(`/day?month=${month}&day=${day}`);
    } catch (err) {
      if (err.message !== 'unauthorized') {
        showError('Не удалось загрузить записи.');
      }
      return;
    }

    const years = data.years || [];
    if (years.length === 0) {
      emptyBox.classList.remove('hidden');
      return;
    }

    const frag = document.createDocumentFragment();
    for (const entry of years) {
      frag.append(renderYearBlock(entry));
    }
    yearsBox.replaceChildren(frag);
  }

  function renderYearBlock(entry) {
    const block = document.createElement('div');
    block.className = 'editor-card year-block';

    const head = document.createElement('h2');
    head.className = 'year-head';
    head.textContent = String(entry.year);
    block.append(head);

    const list = document.createElement('div');
    list.className = 'note-list';
    for (const note of entry.notes) {
      list.append(renderNote(note));
    }
    block.append(list);
    return block;
  }

  function renderNote(note) {
    const item = document.createElement('div');
    item.className = 'note-item';

    const date = document.createElement('div');
    date.className = 'note-date';
    date.textContent = note.noteDate
      ? noteDateFormat.format(new Date(note.noteDate))
      : '';
    item.append(date);

    const editor = document.createElement('textarea');
    editor.className = 'note-editor';
    editor.value = note.content || '';
    item.append(editor);

    const media = renderMedia(note);
    if (media) item.append(media);

    const actions = document.createElement('div');
    actions.className = 'note-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'primary-btn';
    saveBtn.type = 'button';
    saveBtn.textContent = 'Сохранить';

    const status = document.createElement('span');
    status.className = 'note-status';

    saveBtn.addEventListener('click', () =>
      saveNote(note.id, editor, saveBtn, status),
    );

    // Re-enable the save button once the text changes after a save.
    editor.addEventListener('input', () => {
      status.textContent = '';
      status.className = 'note-status';
    });

    actions.append(saveBtn, status);
    item.append(actions);
    return item;
  }

  function renderMedia(note) {
    const images = note.images || [];
    const videos = note.videos || [];
    if (images.length === 0 && videos.length === 0) return null;

    const box = document.createElement('div');
    box.className = 'note-media';
    for (const image of images) {
      const img = document.createElement('img');
      img.src = image.url;
      img.loading = 'lazy';
      img.alt = image.description || 'Фото';
      if (image.description) img.title = image.description;
      box.append(img);
    }
    for (const video of videos) {
      const link = document.createElement('a');
      link.className = 'media-link';
      link.href = video.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '🎬 Видео';
      if (video.description) link.title = video.description;
      box.append(link);
    }
    return box;
  }

  async function saveNote(id, editor, saveBtn, status) {
    saveBtn.disabled = true;
    status.className = 'note-status';
    status.textContent = 'Сохранение…';
    try {
      await api(`/notes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editor.value }),
      });
      status.className = 'note-status saved';
      status.textContent = 'Сохранено';
    } catch (err) {
      if (err.message !== 'unauthorized') {
        status.className = 'note-status error';
        status.textContent = 'Ошибка сохранения';
      }
    } finally {
      saveBtn.disabled = false;
    }
  }

  // Back link should route within the SPA.
  el('back-link').addEventListener('click', (event) => {
    event.preventDefault();
    navigate(BASE_PATH);
  });

  window.addEventListener('popstate', render);

  render();
})();
