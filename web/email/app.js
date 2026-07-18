(() => {
  const API_BASE = '/email-api';

  const state = {
    messages: [],
    stats: [],
    selectedId: null,
    filters: { query: '', account: '', flag: '' },
  };

  const el = (id) => document.getElementById(id);
  const messageList = el('message-list');

  const dateFormat = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  function formatDate(value) {
    if (!value) return '—';
    return dateFormat.format(new Date(value));
  }

  // Per-account accent: pick from a fixed, well-spaced palette by the account's
  // alphabetical index (a hash of the name gave near-identical hues for some
  // accounts). Hues are far apart so up to 7 mailboxes stay distinguishable.
  // The color is data, not theme — set inline from here, not in CSS.
  const ACCOUNT_HUES = [145, 212, 32, 275, 175, 330, 95];

  function hueFor(name) {
    const names = state.stats.map((account) => account.account).sort();
    const index = names.indexOf(name);
    // Fall back to a stable per-name hue if stats haven't loaded yet
    if (index === -1) {
      let hash = 0;
      for (const char of name) hash = (hash * 31 + char.codePointAt(0)) % 997;
      return (hash * 137) % 360;
    }
    return ACCOUNT_HUES[index % ACCOUNT_HUES.length];
  }

  function accountColor(name, alpha) {
    return `hsl(${hueFor(name)} 62% 48% / ${alpha})`;
  }

  function formatSize(bytes) {
    if (bytes == null) return '';
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  }

  // --- Stats ---

  async function loadStats() {
    const data = await fetchJson(`${API_BASE}/stats`);
    state.stats = data.accounts;
    renderStats();
    renderAccountFilter();
    // Palette depends on the account list; refresh list colors once known
    if (state.messages.length) renderList();
  }

  function renderStats() {
    const row = el('stats-row');
    row.replaceChildren(
      ...state.stats.map((account) => {
        const card = document.createElement('div');
        card.className = 'editor-card stat-card';
        card.style.borderLeftColor = accountColor(account.account, 0.85);
        card.style.background = accountColor(account.account, 0.07);

        const name = document.createElement('div');
        name.className = 'stat-account';
        const dot = document.createElement('span');
        dot.className = 'account-dot';
        dot.style.background = accountColor(account.account, 1);
        name.append(dot, document.createTextNode(account.account));

        const line = document.createElement('div');
        line.className = 'stat-line';
        const chips = [
          `всего: ${account.total}`,
          `непрочитанных: ${account.unseen}`,
          ...Object.entries(account.statuses).map(
            ([status, count]) => `${status}: ${count}`,
          ),
        ];
        line.replaceChildren(
          ...chips.map((text) => {
            const chip = document.createElement('span');
            chip.className = 'meta-chip';
            chip.textContent = text;
            return chip;
          }),
        );

        const sync = document.createElement('div');
        sync.className = 'stat-sync muted';
        sync.textContent = `синхронизация: ${formatDate(account.syncedAt)} · UID ${account.lastUid}`;

        card.append(name, line, sync);
        return card;
      }),
    );
  }

  function renderAccountFilter() {
    const select = el('filter-account');
    const current = select.value;
    select.replaceChildren(new Option('Все аккаунты', ''));
    for (const account of state.stats) {
      select.append(new Option(account.account, account.account));
    }
    select.value = current;
  }

  // --- Message list ---

  async function loadMessages() {
    const data = await fetchJson(`${API_BASE}/messages`);
    state.messages = data.messages;
    renderList();
  }

  function visibleMessages() {
    const query = state.filters.query.trim().toLowerCase();
    return state.messages.filter((message) => {
      if (state.filters.account && message.account !== state.filters.account) {
        return false;
      }
      if (state.filters.flag === 'unseen' && message.seen) return false;
      if (state.filters.flag === 'attachments' && !message.hasAttachments) {
        return false;
      }
      if (!query) return true;
      return [message.subject, message.fromAddress, message.fromName]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query));
    });
  }

  function renderList() {
    const messages = visibleMessages();
    el('list-empty').classList.toggle('hidden', messages.length > 0);

    messageList.replaceChildren(
      ...messages.map((message) => {
        const item = document.createElement('li');
        item.classList.toggle('selected', message.id === state.selectedId);
        item.style.borderLeftColor = accountColor(message.account, 1);

        const top = document.createElement('div');
        top.className = 'message-row-top';

        const subject = document.createElement('span');
        subject.className = 'message-subject';
        subject.classList.toggle('unseen', !message.seen);
        subject.textContent = message.subject || '(без темы)';

        const date = document.createElement('span');
        date.className = 'message-date';
        date.textContent = formatDate(message.date);

        top.append(subject, date);

        const from = document.createElement('div');
        from.className = 'message-from';

        const sender = document.createElement('span');
        sender.className = 'message-sender';
        sender.textContent =
          (message.fromName || message.fromAddress || '—') +
          (message.hasAttachments ? ' 📎' : '');

        // Colored pill naming the mailbox — the primary per-account cue
        const account = document.createElement('span');
        account.className = 'account-pill';
        account.style.color = accountColor(message.account, 1);
        account.style.background = accountColor(message.account, 0.12);
        const dot = document.createElement('span');
        dot.className = 'account-dot';
        dot.style.background = accountColor(message.account, 1);
        account.append(dot, document.createTextNode(message.account));

        from.append(sender, account);

        item.append(top, from);
        item.addEventListener('click', () => selectMessage(message.id));
        return item;
      }),
    );
  }

  // --- Detail ---

  async function selectMessage(id) {
    state.selectedId = id;
    renderList();

    const message = await fetchJson(`${API_BASE}/messages/${id}`);

    el('detail-empty').classList.add('hidden');
    el('detail').classList.remove('hidden');

    el('detail-subject').textContent = message.subject || '(без темы)';

    const meta = el('detail-meta');
    const rows = [
      ['От', `${message.fromName || ''} <${message.fromAddress || ''}>`],
      ['Кому', message.toAddresses.join(', ') || '—'],
      ...(message.ccAddresses.length
        ? [['Копия', message.ccAddresses.join(', ')]]
        : []),
      ['Дата', formatDate(message.date)],
      ['Аккаунт', `${message.account} · ${message.mailbox}`],
      ['Статус', `${message.status}${message.seen ? ' · прочитано' : ' · не прочитано'}`],
      ...(message.sizeBytes ? [['Размер', formatSize(message.sizeBytes)]] : []),
    ];
    meta.replaceChildren(
      ...rows.flatMap(([label, value]) => {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = value;
        return [dt, dd];
      }),
    );

    const labels = el('detail-labels');
    labels.replaceChildren(
      ...message.labels.map((label) => {
        const chip = document.createElement('span');
        chip.className = 'meta-chip';
        chip.textContent = label;
        return chip;
      }),
    );

    const attachments = el('detail-attachments');
    attachments.replaceChildren(
      ...message.attachments.map((attachment) => {
        const chip = document.createElement('span');
        chip.className = 'badge';
        chip.textContent = `📎 ${attachment.filename || attachment.mimeType || 'файл'} ${formatSize(attachment.sizeBytes)}`;
        chip.title = attachment.mimeType || '';
        return chip;
      }),
    );

    el('detail-body').textContent = message.bodyText || '(пустое тело письма)';

    renderThread(message);
  }

  function renderThread(message) {
    const container = el('detail-thread');
    const others = message.thread.messages;
    if (others.length < 2) {
      container.replaceChildren();
      return;
    }

    const title = document.createElement('h3');
    title.textContent = `Тред · ${others.length} писем`;

    const list = document.createElement('ul');
    list.replaceChildren(
      ...others.map((item) => {
        const li = document.createElement('li');
        li.classList.toggle('current', item.id === message.id);

        const from = document.createElement('span');
        from.textContent = item.fromAddress || '—';
        const date = document.createElement('span');
        date.className = 'muted';
        date.textContent = formatDate(item.date);

        li.append(from, date);
        if (item.id !== message.id) {
          li.addEventListener('click', () => selectMessage(item.id));
        }
        return li;
      }),
    );

    container.replaceChildren(title, list);
  }

  // --- Sync ---

  async function syncNow() {
    const button = el('sync-button');
    button.disabled = true;
    button.textContent = 'Синхронизация…';
    try {
      const data = await fetchJson(`${API_BASE}/sync`, { method: 'POST' });
      const summary = data.results
        .map(
          (result) =>
            `${result.account}: ${result.error ? `ошибка (${result.error})` : `+${result.ingested}`}`,
        )
        .join(', ');
      button.textContent = summary || 'Аккаунты не настроены';
      await Promise.all([loadStats(), loadMessages()]);
    } catch (error) {
      button.textContent = 'Ошибка синхронизации';
      console.error(error);
    } finally {
      button.disabled = false;
      setTimeout(() => {
        button.textContent = 'Синхронизировать';
      }, 5000);
    }
  }

  // --- Wiring ---

  el('filter-query').addEventListener('input', (event) => {
    state.filters.query = event.target.value;
    renderList();
  });
  el('filter-account').addEventListener('change', (event) => {
    state.filters.account = event.target.value;
    renderList();
  });
  el('filter-flag').addEventListener('change', (event) => {
    state.filters.flag = event.target.value;
    renderList();
  });
  el('sync-button').addEventListener('click', () => void syncNow());

  Promise.all([loadStats(), loadMessages()]).catch((error) => {
    console.error(error);
    el('list-empty').textContent = 'Не удалось загрузить данные';
    el('list-empty').classList.remove('hidden');
  });
})();
