(function () {
  const fileList = document.querySelector('#fileList');
  const emptyState = document.querySelector('#emptyState');
  const totalCount = document.querySelector('#totalCount');
  const totalSize = document.querySelector('#totalSize');
  const sourceCount = document.querySelector('#sourceCount');
  const refreshButton = document.querySelector('#refreshButton');
  const objectUrls = new Map();

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б';
    const units = ['Б', 'КБ', 'МБ', 'ГБ'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'дата неизвестна';
    return date.toLocaleString('ru-RU');
  }

  function fileHref(file) {
    if (file.url) return file.url;
    if (!file.blob) return '';
    if (!objectUrls.has(file.id)) {
      objectUrls.set(file.id, URL.createObjectURL(file.blob));
    }
    return objectUrls.get(file.id);
  }

  function originLabel(file) {
    if (file.origin === 'subs-source') return 'Subs · исходное видео';
    if (file.origin === 'subs-audio') return 'Subs · аудио';
    if (file.origin === 'subs-render') return 'Subs · финальное видео';
    if (file.origin === 'subs-ass') return 'Subs · ASS субтитры';
    if (file.origin === 'gpx-poster') return 'GPX · постер';
    if (file.origin === 'gpx-track-alpha') return 'GPX · прозрачный PNG';
    if (file.origin === 'gpx-animation') return 'GPX · анимация';
    if (file.origin === 'gpx-frames') return 'GPX · кадры';
    return file.sourceApp || 'Файл';
  }

  function describeSubsVideo(video) {
    const parts = [];
    if (video.originalName) parts.push(video.originalName);
    if (video.hash) parts.push(`hash ${video.hash}`);
    return parts.join(' · ');
  }

  function filesFromSubsVideo(video) {
    const files = [];
    if (video.videoUrl) {
      files.push({
        id: `subs:${video.hash}:source`,
        sourceApp: 'subs',
        origin: 'subs-source',
        name: video.originalName || `Видео ${video.hash}`,
        url: video.videoUrl,
        pageUrl: video.pageUrl,
        mimeType: video.mimeType || 'video',
        size: video.size || 0,
        createdAt: video.createdAt,
        updatedAt: video.updatedAt,
        description: `Исходное видео, загруженное на странице Subs. ${describeSubsVideo(video)}`,
      });
    }

    if (video.audioUrl) {
      files.push({
        id: `subs:${video.hash}:audio`,
        sourceApp: 'subs',
        origin: 'subs-audio',
        name: `${video.hash}-audio.mp3`,
        url: video.audioUrl,
        pageUrl: video.pageUrl,
        mimeType: video.audioMimeType || 'audio/mpeg',
        size: video.audioSize || 0,
        createdAt: video.audioCreatedAt || video.updatedAt || video.createdAt,
        updatedAt: video.updatedAt,
        description: `Аудиодорожка, извлеченная из видео ${video.hash} на странице Subs.`,
      });
    }

    if (video.renderedVideo?.videoUrl) {
      files.push({
        id: `subs:${video.hash}:render`,
        sourceApp: 'subs',
        origin: 'subs-render',
        name: `${video.hash}-subtitled.mp4`,
        url: video.renderedVideo.videoUrl,
        pageUrl: video.pageUrl,
        mimeType: video.renderedVideo.mimeType || 'video/mp4',
        size: video.renderedVideo.size || 0,
        createdAt: video.renderedVideo.createdAt || video.updatedAt || video.createdAt,
        updatedAt: video.updatedAt,
        description: `Финальное видео с наложенными ASS-субтитрами для ${video.hash}.`,
      });
    }

    return files;
  }

  async function listFiles() {
    const registryFiles = await window.UserFilesRegistry.list();
    const filesById = new Map(registryFiles.map((file) => [file.id, file]));

    if (window.SubsFonts?.readActiveVideos) {
      const videos = await window.SubsFonts.readActiveVideos().catch(() => []);
      for (const file of videos.flatMap(filesFromSubsVideo)) {
        filesById.set(file.id, { ...file, ...filesById.get(file.id) });
      }
    }

    return [...filesById.values()].sort((a, b) =>
      String(b.createdAt).localeCompare(String(a.createdAt)),
    );
  }

  function makeCard(file) {
    const card = document.createElement('article');
    card.className = 'file-card';

    const content = document.createElement('div');
    const head = document.createElement('div');
    head.className = 'file-card__head';

    const title = document.createElement('h2');
    title.textContent = file.name || 'Файл без названия';

    const badge = document.createElement('span');
    badge.className = `badge${file.url ? '' : ' badge--local'}`;
    badge.textContent = file.url ? 'DO / ссылка' : 'локально';

    head.append(title, badge);

    const meta = document.createElement('p');
    meta.className = 'file-card__meta';
    meta.textContent = `${originLabel(file)} · ${formatDate(file.createdAt)} · ${formatBytes(file.size)} · ${file.mimeType || 'тип неизвестен'}`;

    const details = document.createElement('p');
    details.className = 'file-card__details';
    details.textContent = file.description || file.context || 'Краткая информация не сохранена.';

    content.append(head, meta, details);

    if (file.url) {
      const url = document.createElement('a');
      url.className = 'file-card__url';
      url.href = file.url;
      url.target = '_blank';
      url.rel = 'noopener noreferrer';
      url.textContent = file.url;
      content.append(url);
    }

    const actions = document.createElement('div');
    actions.className = 'file-card__actions';

    const href = fileHref(file);
    if (href) {
      const open = document.createElement('a');
      open.className = 'file-card__button file-card__button--primary';
      open.href = href;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      open.textContent = 'Открыть';

      const download = document.createElement('a');
      download.className = 'file-card__button';
      download.href = href;
      download.download = file.name || 'file';
      download.textContent = 'Скачать';
      actions.append(open, download);
    }

    card.append(content, actions);
    return card;
  }

  async function render() {
    for (const url of objectUrls.values()) URL.revokeObjectURL(url);
    objectUrls.clear();

    const files = await listFiles();
    fileList.replaceChildren(...files.map(makeCard));
    emptyState.hidden = files.length > 0;

    const knownSize = files.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
    totalCount.textContent = String(files.length);
    totalSize.textContent = formatBytes(knownSize);
    sourceCount.textContent = String(new Set(files.map((file) => file.sourceApp || file.origin)).size);
  }

  refreshButton.addEventListener('click', () => {
    void render();
  });

  window.addEventListener('beforeunload', () => {
    for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  });

  void render();
})();
