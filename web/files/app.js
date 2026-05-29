(function () {
  const fileList = document.querySelector('#fileList');
  const emptyState = document.querySelector('#emptyState');
  const totalCount = document.querySelector('#totalCount');
  const totalSize = document.querySelector('#totalSize');
  const sourceCount = document.querySelector('#sourceCount');
  const refreshButton = document.querySelector('#refreshButton');
  const objectUrls = new Map();
  const isEn = document.documentElement.lang?.toLowerCase().startsWith('en');
  const TEXT = isEn
    ? {
        bytes: ['B', 'KB', 'MB', 'GB'],
        missingDate: 'date unknown',
        origins: {
          'subs-source': 'Subs · source video',
          'subs-audio': 'Subs · audio',
          'subs-render': 'Subs · final video',
          'subs-ass': 'Subs · ASS subtitles',
          'gpx-poster': 'GPX · poster',
          'gpx-source-video': 'GPX · source video',
          'gpx-track-alpha': 'GPX · transparent PNG',
          'gpx-animation': 'GPX · animation',
          'gpx-frames': 'GPX · frames',
          'gpx-final-video': 'GPX · final video',
        },
        file: 'File',
        video: 'Video',
        sourceVideoDescription: 'Source video uploaded on the Subs page.',
        audioDescription: 'Audio track extracted from video {hash} on the Subs page.',
        renderedDescription:
          'Final video with burned-in ASS subtitles for {hash}.',
        descriptions: {
          'subs-source': 'Source video uploaded on the Subs page.',
          'subs-audio': 'Audio track extracted on the Subs page.',
          'subs-render': 'Final video with burned-in ASS subtitles.',
          'subs-ass': 'ASS subtitle file created on the Subs page.',
          'gpx-poster': '1080x1920 PNG poster with the route line, points, and labels.',
          'gpx-source-video': 'Source video selected on the GPX page.',
          'gpx-track-alpha': 'Transparent PNG route layer for editing.',
          'gpx-animation': 'WebM route traversal animation with alpha channel.',
          'gpx-frames': 'ZIP archive with PNG animation frames and ffmpeg notes.',
          'gpx-final-video': 'Final video with the route animation over the source video.',
        },
        untitled: 'Untitled file',
        remoteBadge: 'DO / link',
        localBadge: 'local',
        unknownType: 'type unknown',
        noDetails: 'No short information was saved.',
        open: 'Open',
        download: 'Download',
        useInSubs: 'Use in Subs',
        useInTrack: 'Use in track',
        locale: 'en-US',
      }
    : {
        bytes: ['Б', 'КБ', 'МБ', 'ГБ'],
        missingDate: 'дата неизвестна',
        origins: {
          'subs-source': 'Subs · исходное видео',
          'subs-audio': 'Subs · аудио',
          'subs-render': 'Subs · финальное видео',
          'subs-ass': 'Subs · ASS субтитры',
          'gpx-poster': 'GPX · постер',
          'gpx-source-video': 'GPX · исходное видео',
          'gpx-track-alpha': 'GPX · прозрачный PNG',
          'gpx-animation': 'GPX · анимация',
          'gpx-frames': 'GPX · кадры',
          'gpx-final-video': 'GPX · финальное видео',
        },
        file: 'Файл',
        video: 'Видео',
        sourceVideoDescription: 'Исходное видео, загруженное на странице Subs.',
        audioDescription:
          'Аудиодорожка, извлеченная из видео {hash} на странице Subs.',
        renderedDescription:
          'Финальное видео с наложенными ASS-субтитрами для {hash}.',
        descriptions: {},
        untitled: 'Файл без названия',
        remoteBadge: 'DO / ссылка',
        localBadge: 'локально',
        unknownType: 'тип неизвестен',
        noDetails: 'Краткая информация не сохранена.',
        open: 'Открыть',
        download: 'Скачать',
        useInSubs: 'В Subs',
        useInTrack: 'В трек',
        locale: 'ru-RU',
      };

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return `0 ${TEXT.bytes[0]}`;
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < TEXT.bytes.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${TEXT.bytes[unit]}`;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return TEXT.missingDate;
    return date.toLocaleString(TEXT.locale);
  }

  function formatText(template, values) {
    return template.replace(/\{(\w+)}/g, (_match, key) =>
      Object.prototype.hasOwnProperty.call(values, key) ? values[key] : '',
    );
  }

  function fileHref(file) {
    if (file.url) return file.url;
    if (!file.blob) return '';
    if (!objectUrls.has(file.id)) {
      objectUrls.set(file.id, URL.createObjectURL(file.blob));
    }
    return objectUrls.get(file.id);
  }

  function isVideoFile(file) {
    const mimeType = String(file.mimeType || '').toLowerCase();
    if (mimeType === 'video' || mimeType.startsWith('video/')) return true;
    if (file.origin === 'subs-source' || file.origin === 'subs-render') return true;
    return file.origin === 'gpx-source-video' || file.origin === 'gpx-final-video';
  }

  function sourceFileUrl(path, file) {
    const url = new URL(path, window.location.origin);
    url.searchParams.set('sourceFile', file.id);
    return url.pathname + url.search;
  }

  function cacheFolderId(file) {
    const hash =
      file.hash ||
      String(file.id || '').match(/^subs:([a-f0-9]{24}):(source|render)$/)?.[1] ||
      String(file.pageUrl || '').match(/^\/subs(?:\/en)?\/([a-f0-9]{24})\/?$/)?.[1];
    return hash || encodeURIComponent(file.id);
  }

  function sourceFilePath(path, file) {
    const base = path.endsWith('/') ? path : `${path}/`;
    return `${base}${cacheFolderId(file)}`;
  }

  function subsTargetUrl(file) {
    if (file.origin === 'subs-source' && file.pageUrl) return file.pageUrl;
    return sourceFileUrl(isEn ? '/subs/en' : '/subs/', file);
  }

  function trackTargetUrl(file) {
    const base = isEn ? '/gpx-route-png/en/' : '/gpx-route-png/';
    return `${base}${encodeURIComponent(file.id)}`;
  }

  function originLabel(file) {
    return TEXT.origins[file.origin] || file.sourceApp || TEXT.file;
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
        hash: video.hash,
        sourceApp: 'subs',
        origin: 'subs-source',
        name: video.originalName || `${TEXT.video} ${video.hash}`,
        url: video.videoUrl,
        pageUrl: video.pageUrl,
        mimeType: video.mimeType || 'video',
        size: video.size || 0,
        createdAt: video.createdAt,
        updatedAt: video.updatedAt,
        description: `${TEXT.sourceVideoDescription} ${describeSubsVideo(video)}`,
      });
    }

    if (video.audioUrl) {
      files.push({
        id: `subs:${video.hash}:audio`,
        hash: video.hash,
        sourceApp: 'subs',
        origin: 'subs-audio',
        name: `${video.hash}-audio.mp3`,
        url: video.audioUrl,
        pageUrl: video.pageUrl,
        mimeType: video.audioMimeType || 'audio/mpeg',
        size: video.audioSize || 0,
        createdAt: video.audioCreatedAt || video.updatedAt || video.createdAt,
        updatedAt: video.updatedAt,
        description: formatText(TEXT.audioDescription, { hash: video.hash }),
      });
    }

    if (video.renderedVideo?.videoUrl) {
      files.push({
        id: `subs:${video.hash}:render`,
        hash: video.hash,
        sourceApp: 'subs',
        origin: 'subs-render',
        name: `${video.hash}-subtitled.mp4`,
        url: video.renderedVideo.videoUrl,
        pageUrl: video.pageUrl,
        mimeType: video.renderedVideo.mimeType || 'video/mp4',
        size: video.renderedVideo.size || 0,
        createdAt: video.renderedVideo.createdAt || video.updatedAt || video.createdAt,
        updatedAt: video.updatedAt,
        description: formatText(TEXT.renderedDescription, {
          hash: video.hash,
        }),
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
    title.textContent = file.name || TEXT.untitled;

    const badge = document.createElement('span');
    badge.className = `badge${file.url ? '' : ' badge--local'}`;
    badge.textContent = file.url ? TEXT.remoteBadge : TEXT.localBadge;

    head.append(title, badge);

    const meta = document.createElement('p');
    meta.className = 'file-card__meta';
    meta.textContent = `${originLabel(file)} · ${formatDate(file.createdAt)} · ${formatBytes(file.size)} · ${file.mimeType || TEXT.unknownType}`;

    const details = document.createElement('p');
    details.className = 'file-card__details';
    details.textContent =
      TEXT.descriptions[file.origin] ||
      file.description ||
      file.context ||
      TEXT.noDetails;

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
      open.textContent = TEXT.open;

      const download = document.createElement('a');
      download.className = 'file-card__button';
      download.href = href;
      download.download = file.name || 'file';
      download.textContent = TEXT.download;
      actions.append(open, download);
    }

    if (isVideoFile(file)) {
      const useInSubs = document.createElement('a');
      useInSubs.className = 'file-card__button';
      useInSubs.href = subsTargetUrl(file);
      useInSubs.textContent = TEXT.useInSubs;

      const useInTrack = document.createElement('a');
      useInTrack.className = 'file-card__button';
      useInTrack.href = trackTargetUrl(file);
      useInTrack.textContent = TEXT.useInTrack;

      actions.append(useInSubs, useInTrack);
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
