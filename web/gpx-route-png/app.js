(() => {
  'use strict';

  // ---------- Constants ----------
  const CANVAS_W = 1080;
  const CANVAS_H = 1920;
  const MIN_DIST_M = 50; // minimum distance between thinned points
  const SAFE_MARGIN = 140; // safe margin in canvas px around the route
  const LANG = document.documentElement.lang === 'en' ? 'en' : 'ru';
  const COPY = {
    ru: {
      parseXmlError: 'Не удалось разобрать GPX: файл повреждён или не является валидным XML.',
      notGpxRoot: 'Это не похоже на GPX-файл: отсутствует корневой элемент <gpx>.',
      notEnoughPoints: 'В GPX-файле не найдено достаточно координат (нужно минимум две точки).',
      distanceUnit: 'км',
      defaultStart: 'Старт',
      defaultFinish: 'Финиш',
      waypointTextPlaceholder: 'Текст',
      waypointTextAria: 'Текст подписи',
      waypointDistancePlaceholder: 'км',
      waypointDistanceAria: 'Расстояние от старта в километрах',
      offsetXAria: 'Смещение подписи по горизонтали в пикселях',
      offsetYAria: 'Смещение подписи по вертикали в пикселях',
      removeWaypointAria: 'Удалить подпись на треке',
      fileTypeError: 'Похоже, это не GPX-файл. Загрузите файл с расширением .gpx.',
      emptyFileError: 'Файл пустой. Загрузите GPX с хотя бы двумя точками.',
      largeFileError: 'Файл слишком большой (больше 50 МБ). Уменьшите размер GPX.',
      whitespaceFileError: 'Файл пустой или содержит только пробелы.',
      genericFileError: 'Не удалось обработать файл. Попробуйте другой GPX.',
      loadingSample: 'Загружаю sample.gpx…',
      sampleLoadError: 'Не удалось загрузить пример sample.gpx.',
      sampleUiError: 'Не удалось загрузить пример sample.gpx. Попробуйте обновить страницу.',
      sampleMiddle1: 'ТЦ Галерея',
      sampleMiddle2: 'Пивски\nзабавник',
      animEmpty: 'Загрузите GPX в шаге 1 — здесь можно посмотреть анимацию прохождения трека.',
      playAnim: 'Воспроизвести',
      playingAnim: 'Воспроизведение…',
      downloadAnimWebm: 'Скачать WebM (альфа)',
      downloadAnimPngZip: 'Скачать кадры PNG (ZIP)',
      exportingWebm: 'Запись WebM…',
      exportingPngFrame: (current, total) => `Кадры: ${current}/${total}…`,
      exportFailed: 'Не удалось экспортировать анимацию. Попробуйте ещё раз.',
      webmUnsupported: 'WebM не поддерживается в этом браузере. Скачайте PNG (ZIP).',
      ffmpegReadme: (fps) =>
        [
          'PNG-последовательность трека 1080×1920, прозрачный фон.',
          `Кадровая частота: ${fps} fps (имя файлов frame_0001.png …).`,
          '',
          'Пример наложения на видео через ffmpeg:',
          `ffmpeg -i video.mp4 -framerate ${fps} -i frame_%04d.png -filter_complex "overlay=0:0" -c:a copy output.mp4`,
          '',
          'WebM с альфой (если скачали отдельно):',
          'ffmpeg -i video.mp4 -i track-anim.webm -filter_complex "[1:v]format=yuva420p[ov];[0:v][ov]overlay=0:0" -c:a copy output.mp4',
        ].join('\n'),
      trackColorLabel: 'Цвет трека',
      trackColorAria: 'Цвет линии трека, точек и подписей',
      trackColorLabels: {
        lemon: 'Лимон',
        sunflower: 'Подсолнух',
        saffron: 'Шафран',
        honey: 'Мёд',
        tangerine: 'Мандарин',
        terracotta: 'Терракота',
        rust: 'Ржавчина',
      },
      resetSettings: 'Сбросить настройки',
      locale: 'ru-RU',
    },
    en: {
      parseXmlError: 'Could not parse GPX: the file is damaged or is not valid XML.',
      notGpxRoot: 'This does not look like a GPX file: the root <gpx> element is missing.',
      notEnoughPoints: 'The GPX file does not contain enough coordinates; at least two points are required.',
      distanceUnit: 'km',
      defaultStart: 'Start',
      defaultFinish: 'Finish',
      waypointTextPlaceholder: 'Text',
      waypointTextAria: 'Label text',
      waypointDistancePlaceholder: 'km',
      waypointDistanceAria: 'Distance from start in kilometers',
      offsetXAria: 'Horizontal label offset in pixels',
      offsetYAria: 'Vertical label offset in pixels',
      removeWaypointAria: 'Remove track label',
      fileTypeError: 'This does not look like a GPX file. Upload a file with the .gpx extension.',
      emptyFileError: 'The file is empty. Upload a GPX with at least two points.',
      largeFileError: 'The file is too large (over 50 MB). Reduce the GPX size.',
      whitespaceFileError: 'The file is empty or contains only whitespace.',
      genericFileError: 'Could not process the file. Try another GPX.',
      loadingSample: 'Loading sample.gpx...',
      sampleLoadError: 'Could not load sample.gpx.',
      sampleUiError: 'Could not load sample.gpx. Try refreshing the page.',
      sampleMiddle1: 'Galerija Mall',
      sampleMiddle2: 'Pivski\nzabavnik',
      animEmpty: 'Upload a GPX in step 1 to preview the track traversal animation here.',
      playAnim: 'Play',
      playingAnim: 'Playing…',
      downloadAnimWebm: 'Download WebM (alpha)',
      downloadAnimPngZip: 'Download PNG frames (ZIP)',
      exportingWebm: 'Recording WebM…',
      exportingPngFrame: (current, total) => `Frames: ${current}/${total}…`,
      exportFailed: 'Could not export the animation. Try again.',
      webmUnsupported: 'WebM is not supported in this browser. Download PNG (ZIP) instead.',
      ffmpegReadme: (fps) =>
        [
          'Track PNG sequence 1080×1920, transparent background.',
          `Frame rate: ${fps} fps (files frame_0001.png …).`,
          '',
          'Example ffmpeg overlay on video:',
          `ffmpeg -i video.mp4 -framerate ${fps} -i frame_%04d.png -filter_complex "overlay=0:0" -c:a copy output.mp4`,
          '',
          'WebM with alpha (if downloaded separately):',
          'ffmpeg -i video.mp4 -i track-anim.webm -filter_complex "[1:v]format=yuva420p[ov];[0:v][ov]overlay=0:0" -c:a copy output.mp4',
        ].join('\n'),
      trackColorLabel: 'Track color',
      trackColorAria: 'Color of the route line, points, and labels',
      trackColorLabels: {
        lemon: 'Lemon',
        sunflower: 'Sunflower',
        saffron: 'Saffron',
        honey: 'Honey',
        tangerine: 'Tangerine',
        terracotta: 'Terracotta',
        rust: 'Rust',
      },
      resetSettings: 'Reset settings to defaults',
      locale: 'en-US',
    },
  };
  const copy = COPY[LANG];

  // ---------- DOM ----------
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');
  const sampleBtn = document.getElementById('sampleBtn');
  const errorBox = document.getElementById('errorBox');
  const results = document.getElementById('results');
  const canvas = document.getElementById('previewCanvas');
  const ctx = canvas.getContext('2d');
  const downloadBtn = document.getElementById('downloadBtn');
  const resetBtn = document.getElementById('resetBtn');
  const resetSettingsBtn = document.getElementById('resetSettingsBtn');
  const titleInput = document.getElementById('titleInput');
  const waypointList = document.getElementById('waypointList');
  const addWaypointBtn = document.getElementById('addWaypointBtn');
  const labelFontSelect = document.getElementById('labelFontSelect');
  const labelSizeInput = document.getElementById('labelSizeInput');
  const labelSizeOutput = document.getElementById('labelSizeOutput');
  const lineWidthInput = document.getElementById('lineWidthInput');
  const lineWidthOutput = document.getElementById('lineWidthOutput');
  const pointScaleInput = document.getElementById('pointScaleInput');
  const pointScaleOutput = document.getElementById('pointScaleOutput');
  const minDistanceInput = document.getElementById('minDistanceInput');
  const minDistanceOutput = document.getElementById('minDistanceOutput');
  const trackColorGroups = document.querySelectorAll('[data-track-color-group]');
  const downloadTransparentPngBtn = document.getElementById('downloadTransparentPngBtn');
  const step2AnimCanvas = document.getElementById('step2AnimCanvas');
  const step2AnimPlaceholder = document.getElementById('step2AnimPlaceholder');
  const step3TrackPreviewCanvas = document.getElementById('step3TrackPreviewCanvas');
  const step3TrackPlaceholder = document.getElementById('step3TrackPlaceholder');
  const animDurationInput = document.getElementById('animDurationInput');
  const animDurationOutput = document.getElementById('animDurationOutput');
  const animFpsSelect = document.getElementById('animFpsSelect');
  const playAnimBtn = document.getElementById('playAnimBtn');
  const downloadAnimWebmBtn = document.getElementById('downloadAnimWebmBtn');
  const downloadAnimPngZipBtn = document.getElementById('downloadAnimPngZipBtn');

  const statSource = document.getElementById('statSource');
  const statOriginal = document.getElementById('statOriginal');
  const statThinned = document.getElementById('statThinned');
  const statDistance = document.getElementById('statDistance');
  const statBbox = document.getElementById('statBbox');

  let currentState = null; // { points, thinned, distance, source, bbox, fileName }
  let fileIngestGeneration = 0;
  let currentTrackColorId = 'terracotta';
  let waypointCounter = 0;
  const DEFAULT_ROUTE_LINE_WIDTH = 14;
  const ROUTE_ANIM_UNREVEALED = '#FFFFFF';
  const ANIM_EXPORT_FPS_OPTIONS = [24, 25, 30, 60];
  let routePathCache = null;
  let routeAnimRafId = null;
  let routeAnimPlaying = false;
  let animExportInProgress = false;

  const LABEL_FONTS = {
    satoshi: '"Satoshi", sans-serif',
    montserrat: '"Montserrat", sans-serif',
    jetbrains: '"JetBrains Mono", monospace',
    georgia: 'Georgia, serif',
  };

  // ---------- Utility: Haversine distance (meters) ----------
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // ---------- GPX Parsing ----------
  function parseGPX(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');

    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      throw new Error(copy.parseXmlError);
    }

    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'gpx') {
      throw new Error(copy.notGpxRoot);
    }

    const extractPoints = (selector) => {
      const nodes = doc.getElementsByTagName(selector);
      const pts = [];
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const lat = parseFloat(n.getAttribute('lat'));
        const lon = parseFloat(n.getAttribute('lon'));
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          pts.push({ lat, lon });
        }
      }
      return pts;
    };

    let source = 'trkpt';
    let points = extractPoints('trkpt');
    if (points.length < 2) {
      const rte = extractPoints('rtept');
      if (rte.length >= 2) { points = rte; source = 'rtept'; }
      else {
        const wpt = extractPoints('wpt');
        if (wpt.length >= 2) { points = wpt; source = 'wpt'; }
      }
    }

    if (points.length < 2) {
      throw new Error(copy.notEnoughPoints);
    }
    return { points, source };
  }

  // ---------- Thinning: keep first & last, >=50m between adjacent ----------
  function thinPoints(points, minMeters) {
    if (points.length <= 2) return points.slice();
    const last = points[points.length - 1];
    const out = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const prev = out[out.length - 1];
      const d = haversine(prev.lat, prev.lon, points[i].lat, points[i].lon);
      if (d >= minMeters) out.push(points[i]);
    }
    // Ensure final point present and >= minDist from previous, otherwise replace last out point if it's too close to start? No — spec says keep first AND last.
    out.push(last);
    return out;
  }

  function totalDistanceMeters(points) {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += haversine(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
    }
    return total;
  }

  function pointAtDistance(points, targetMeters) {
    if (!points.length) return null;
    if (targetMeters <= 0) return points[0];
    let walked = 0;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const next = points[i];
      const segment = haversine(prev.lat, prev.lon, next.lat, next.lon);
      if (walked + segment >= targetMeters) {
        const t = segment > 0 ? (targetMeters - walked) / segment : 0;
        return {
          lat: prev.lat + (next.lat - prev.lat) * t,
          lon: prev.lon + (next.lon - prev.lon) * t,
        };
      }
      walked += segment;
    }
    return points[points.length - 1];
  }

  function parseDistanceKm(value) {
    const normalized = String(value || '').trim().replace(',', '.');
    if (!normalized) return NaN;
    const km = Number.parseFloat(normalized);
    return Number.isFinite(km) ? km : NaN;
  }

  function getPosterControls() {
    const labels = [...waypointList.querySelectorAll('.waypoint-row')]
      .map((row) => {
        const name = row.querySelector('.waypoint-name').value.trim();
        const km = parseDistanceKm(row.querySelector('.waypoint-distance').value);
        const offsetX = Number.parseFloat(String(row.querySelector('.waypoint-offset-x').value || '0').replace(',', '.')) || 0;
        const offsetY = Number.parseFloat(String(row.querySelector('.waypoint-offset-y').value || '0').replace(',', '.')) || 0;
        return { name, km, offsetX, offsetY };
      })
      .filter((w) => w.name && Number.isFinite(w.km) && w.km >= 0)
      .sort((a, b) => a.km - b.km);

    const labelFontKey = Object.prototype.hasOwnProperty.call(LABEL_FONTS, labelFontSelect.value)
      ? labelFontSelect.value
      : 'montserrat';
    const labelSize = Math.max(28, Math.min(72, Number.parseInt(labelSizeInput.value, 10) || 48));
    const lineWidth = Math.max(3, Math.min(24, Number.parseInt(lineWidthInput.value, 10) || DEFAULT_ROUTE_LINE_WIDTH));
    const pointScale = Math.max(2, Math.min(10, Number.parseFloat(pointScaleInput.value) || 3));
    const minDistanceMeters = Math.max(50, Math.min(500, Number.parseInt(minDistanceInput.value, 10) || MIN_DIST_M));

    return {
      labels,
      labelFontKey,
      labelFontFamily: LABEL_FONTS[labelFontKey],
      labelSize,
      lineWidth,
      pointScale,
      minDistanceMeters,
    };
  }

  function updateThinning() {
    if (!currentState || !currentState.points) return;
    const controls = getPosterControls();
    currentState.thinned = thinPoints(currentState.points, controls.minDistanceMeters);
    invalidateRoutePathCache();
    updateStatsPanel(currentState);
    render();
  }

  // ---------- Projection: equirectangular at track centroid, fit to canvas ----------
  function projectAndFit(points, width, height, margin) {
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const p of points) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }
    const centerLat = (minLat + maxLat) / 2;
    const cosLat = Math.cos((centerLat * Math.PI) / 180);

    // Project to local meters-ish plane
    const projected = points.map((p) => ({
      x: (p.lon - minLon) * cosLat,
      y: -(p.lat - minLat), // flip y
    }));

    let pminX = Infinity, pmaxX = -Infinity, pminY = Infinity, pmaxY = -Infinity;
    for (const p of projected) {
      if (p.x < pminX) pminX = p.x;
      if (p.x > pmaxX) pmaxX = p.x;
      if (p.y < pminY) pminY = p.y;
      if (p.y > pmaxY) pmaxY = p.y;
    }
    const pw = Math.max(pmaxX - pminX, 1e-9);
    const ph = Math.max(pmaxY - pminY, 1e-9);

    const availW = width - margin * 2;
    const availH = height - margin * 2;
    const scale = Math.min(availW / pw, availH / ph);

    const drawW = pw * scale;
    const drawH = ph * scale;
    const offX = (width - drawW) / 2 - pminX * scale;
    const offY = (height - drawH) / 2 - pminY * scale;

    const fitted = projected.map((p) => ({
      x: p.x * scale + offX,
      y: p.y * scale + offY,
    }));

    return {
      points: fitted,
      bbox: { minLat, maxLat, minLon, maxLon, widthKm: 0, heightKm: 0 },
    };
  }

  // ---------- Catmull-Rom to Bezier draw ----------
  function cubicBezierPoint(t, p0, p1, p2, p3) {
    const u = 1 - t;
    const uu = u * u;
    const tt = t * t;
    const uuu = uu * u;
    const ttt = tt * t;
    return {
      x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
      y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
    };
  }

  function sampleCatmullRomPath(points, tension = 0.5, stepsPerSegment = 16) {
    if (points.length < 2) {
      const only = points[0] || { x: 0, y: 0 };
      return { samples: [{ x: only.x, y: only.y, dist: 0 }], totalLength: 0 };
    }

    const samples = [];
    let totalLength = 0;

    const pushPoint = (x, y) => {
      if (samples.length > 0) {
        const prev = samples[samples.length - 1];
        totalLength += Math.hypot(x - prev.x, y - prev.y);
      }
      samples.push({ x, y, dist: totalLength });
    };

    pushPoint(points[0].x, points[0].y);

    if (points.length === 2) {
      pushPoint(points[1].x, points[1].y);
      return { samples, totalLength };
    }

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;

      const cp1x = p1.x + ((p2.x - p0.x) / 6) * tension * 2;
      const cp1y = p1.y + ((p2.y - p0.y) / 6) * tension * 2;
      const cp2x = p2.x - ((p3.x - p1.x) / 6) * tension * 2;
      const cp2y = p2.y - ((p3.y - p1.y) / 6) * tension * 2;

      const b0 = p1;
      const b1 = { x: cp1x, y: cp1y };
      const b2 = { x: cp2x, y: cp2y };
      const b3 = p2;

      for (let step = 1; step <= stepsPerSegment; step++) {
        const t = step / stepsPerSegment;
        const pt = cubicBezierPoint(t, b0, b1, b2, b3);
        pushPoint(pt.x, pt.y);
      }
    }

    return { samples, totalLength };
  }

  function arcLengthAtPoint(samples, x, y) {
    let bestDist = 0;
    let bestGap = Infinity;
    for (const sample of samples) {
      const gap = (sample.x - x) ** 2 + (sample.y - y) ** 2;
      if (gap < bestGap) {
        bestGap = gap;
        bestDist = sample.dist;
      }
    }
    return bestDist;
  }

  function strokeSampledPath(ctx, samples) {
    if (samples.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(samples[0].x, samples[0].y);
    for (let i = 1; i < samples.length; i++) {
      ctx.lineTo(samples[i].x, samples[i].y);
    }
    ctx.stroke();
  }

  function strokeSampledPathToLength(ctx, samples, maxLength) {
    if (samples.length < 2 || maxLength <= 0) return;

    ctx.beginPath();
    ctx.moveTo(samples[0].x, samples[0].y);

    for (let i = 1; i < samples.length; i++) {
      const prev = samples[i - 1];
      const curr = samples[i];
      if (curr.dist <= maxLength) {
        ctx.lineTo(curr.x, curr.y);
        continue;
      }
      if (prev.dist < maxLength) {
        const segLen = curr.dist - prev.dist || 1;
        const t = (maxLength - prev.dist) / segLen;
        ctx.lineTo(prev.x + (curr.x - prev.x) * t, prev.y + (curr.y - prev.y) * t);
      }
      break;
    }

    ctx.stroke();
  }

  function invalidateRoutePathCache() {
    routePathCache = null;
  }

  function getRoutePathCache(pts, labelMarkers) {
    const cacheKey =
      pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(';') +
      '|' +
      labelMarkers.map((m) => `${m.x.toFixed(2)},${m.y.toFixed(2)}`).join(';');
    if (routePathCache && routePathCache.cacheKey === cacheKey) return routePathCache;

    const sampled = sampleCatmullRomPath(pts, 0.5);
    routePathCache = {
      cacheKey,
      samples: sampled.samples,
      totalLength: sampled.totalLength,
      markerDistances: labelMarkers.map((marker) =>
        arcLengthAtPoint(sampled.samples, marker.x, marker.y),
      ),
    };
    return routePathCache;
  }

  function drawCatmullRom(ctx, points, tension = 0.5) {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    if (points.length === 2) {
      ctx.lineTo(points[1].x, points[1].y);
      ctx.stroke();
      return;
    }
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;

      const cp1x = p1.x + ((p2.x - p0.x) / 6) * tension * 2;
      const cp1y = p1.y + ((p2.y - p0.y) / 6) * tension * 2;
      const cp2x = p2.x - ((p3.x - p1.x) / 6) * tension * 2;
      const cp2y = p2.y - ((p3.y - p1.y) / 6) * tension * 2;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
    ctx.stroke();
  }

  // ---------- Poster (fixed) + track color palette ----------
  const POSTER_THEME = {
    bg1: '#F1EADA',
    bg2: '#E2D6B5',
    paperGrain: 'rgba(120,100,60,0.06)',
    contour: 'rgba(78,107,74,0.10)',
    ink: '#1A2A24',
    inkMuted: '#6B776F',
  };

  const TRACK_PALETTE = [
    { id: 'lemon', line: '#FFE566' },
    { id: 'sunflower', line: '#F7C948' },
    { id: 'saffron', line: '#F0B429' },
    { id: 'honey', line: '#E8A838' },
    { id: 'tangerine', line: '#E8943A' },
    { id: 'terracotta', line: '#E07A3C' },
    { id: 'rust', line: '#C95A2B' },
  ];

  const TRACK_COLOR_IDS = new Set(TRACK_PALETTE.map((entry) => entry.id));

  const SETTINGS_STORAGE_KEY = 'gpx-route-png/v1';
  const DEFAULT_SETTINGS = {
    v: 1,
    title: '',
    labelFont: 'montserrat',
    labelSize: 48,
    lineWidth: 14,
    pointScale: 3,
    minDistance: MIN_DIST_M,
    trackColor: 'terracotta',
    animDuration: 5,
    animFps: 30,
    waypoints: [],
  };

  let saveSettingsTimer = null;
  let settingsPersistSuspended = false;

  function clampSettingNumber(value, min, max, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }

  function collectWaypointsForStorage() {
    return [...waypointList.querySelectorAll('.waypoint-row')].map((row) => ({
      name: row.querySelector('.waypoint-name').value,
      distanceKm: row.querySelector('.waypoint-distance').value,
      offsetX: row.querySelector('.waypoint-offset-x').value,
      offsetY: row.querySelector('.waypoint-offset-y').value,
    }));
  }

  function collectSettings() {
    const fps = Number.parseInt(animFpsSelect?.value || String(DEFAULT_SETTINGS.animFps), 10);
    return {
      v: 1,
      title: titleInput.value,
      labelFont: labelFontSelect.value,
      labelSize: Number.parseInt(labelSizeInput.value, 10) || DEFAULT_SETTINGS.labelSize,
      lineWidth: Number.parseInt(lineWidthInput.value, 10) || DEFAULT_SETTINGS.lineWidth,
      pointScale: Number.parseFloat(pointScaleInput.value) || DEFAULT_SETTINGS.pointScale,
      minDistance: Number.parseInt(minDistanceInput.value, 10) || DEFAULT_SETTINGS.minDistance,
      trackColor: currentTrackColorId,
      animDuration: Number.parseFloat(animDurationInput?.value || String(DEFAULT_SETTINGS.animDuration)) || DEFAULT_SETTINGS.animDuration,
      animFps: ANIM_EXPORT_FPS_OPTIONS.includes(fps) ? fps : DEFAULT_SETTINGS.animFps,
      waypoints: collectWaypointsForStorage(),
    };
  }

  function normalizeStoredSettings(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const labelFont = Object.prototype.hasOwnProperty.call(LABEL_FONTS, raw.labelFont)
      ? raw.labelFont
      : DEFAULT_SETTINGS.labelFont;
    const trackColor = TRACK_COLOR_IDS.has(raw.trackColor) ? raw.trackColor : DEFAULT_SETTINGS.trackColor;
    const animFps = Number.parseInt(raw.animFps, 10);
    const waypoints = Array.isArray(raw.waypoints)
      ? raw.waypoints.map((entry) => ({
          name: String(entry?.name ?? ''),
          distanceKm: String(entry?.distanceKm ?? ''),
          offsetX: String(entry?.offsetX ?? '0'),
          offsetY: String(entry?.offsetY ?? '0'),
        }))
      : [];
    return {
      v: 1,
      title: String(raw.title ?? ''),
      labelFont,
      labelSize: clampSettingNumber(raw.labelSize, 28, 72, DEFAULT_SETTINGS.labelSize),
      lineWidth: clampSettingNumber(raw.lineWidth, 3, 24, DEFAULT_SETTINGS.lineWidth),
      pointScale: clampSettingNumber(raw.pointScale, 2, 10, DEFAULT_SETTINGS.pointScale),
      minDistance: clampSettingNumber(raw.minDistance, 50, 500, DEFAULT_SETTINGS.minDistance),
      trackColor,
      animDuration: clampSettingNumber(raw.animDuration, 1, 30, DEFAULT_SETTINGS.animDuration),
      animFps: ANIM_EXPORT_FPS_OPTIONS.includes(animFps) ? animFps : DEFAULT_SETTINGS.animFps,
      waypoints,
    };
  }

  function persistSettings() {
    if (settingsPersistSuspended) return;
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(collectSettings()));
    } catch (_e) {
      /* private mode or quota */
    }
  }

  function schedulePersistSettings() {
    if (settingsPersistSuspended) return;
    if (saveSettingsTimer) clearTimeout(saveSettingsTimer);
    saveSettingsTimer = setTimeout(() => {
      saveSettingsTimer = null;
      persistSettings();
    }, 250);
  }

  function loadStoredSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) return null;
      return normalizeStoredSettings(JSON.parse(raw));
    } catch (_e) {
      return null;
    }
  }

  function clearStoredSettings() {
    try {
      localStorage.removeItem(SETTINGS_STORAGE_KEY);
    } catch (_e) {
      /* ignore */
    }
  }

  function applySettings(settings, { skipRender = false } = {}) {
    const normalized = normalizeStoredSettings(settings) || { ...DEFAULT_SETTINGS, waypoints: [] };
    settingsPersistSuspended = true;
    titleInput.value = normalized.title;
    labelFontSelect.value = normalized.labelFont;
    labelSizeInput.value = String(normalized.labelSize);
    labelSizeOutput.textContent = String(normalized.labelSize);
    lineWidthInput.value = String(normalized.lineWidth);
    lineWidthOutput.textContent = String(normalized.lineWidth);
    pointScaleInput.value = String(normalized.pointScale);
    pointScaleOutput.textContent = String(normalized.pointScale);
    minDistanceInput.value = String(normalized.minDistance);
    minDistanceOutput.textContent = String(normalized.minDistance);
    currentTrackColorId = normalized.trackColor;
    syncTrackColorSwatches(normalized.trackColor);
    if (animDurationInput) {
      animDurationInput.value = String(normalized.animDuration);
      if (animDurationOutput) animDurationOutput.textContent = String(normalized.animDuration);
    }
    if (animFpsSelect) animFpsSelect.value = String(normalized.animFps);
    waypointList.textContent = '';
    waypointCounter = 0;
    normalized.waypoints.forEach((waypoint) => {
      addWaypointRow(waypoint.name, waypoint.distanceKm, waypoint.offsetX, waypoint.offsetY, false);
    });
    settingsPersistSuspended = false;
    if (currentState) {
      updateThinning();
      if (!skipRender) {
        render();
        renderStep2AnimPreview(1);
      }
    } else if (!skipRender) {
      refreshWorkflowOutputs();
    }
    return normalized;
  }

  function applyDefaultSettings(options) {
    return applySettings(DEFAULT_SETTINGS, options);
  }

  function restoreStoredSettings() {
    const stored = loadStoredSettings();
    if (!stored) return false;
    applySettings(stored, { skipRender: true });
    return true;
  }

  function resetSettingsToDefaults() {
    clearStoredSettings();
    applyDefaultSettings({ skipRender: true });
    if (currentState) {
      resetDefaultLabels();
      updateThinning();
      render();
      renderStep2AnimPreview(1);
    } else {
      refreshWorkflowOutputs();
    }
    persistSettings();
  }

  function getTrackColorLine(colorId = currentTrackColorId) {
    const entry = TRACK_PALETTE.find((item) => item.id === colorId);
    return entry ? entry.line : TRACK_PALETTE[5].line;
  }

  function syncTrackColorSwatches(colorId = currentTrackColorId) {
    trackColorGroups.forEach((group) => {
      [...group.querySelectorAll('.track-color-swatch')].forEach((btn) => {
        const active = btn.dataset.trackColor === colorId;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-checked', active ? 'true' : 'false');
      });
    });
  }

  function initTrackColorPalette() {
    if (trackColorGroups.length === 0) return;
    trackColorGroups.forEach((group) => {
      group.textContent = '';
      group.setAttribute('aria-label', copy.trackColorAria);
      TRACK_PALETTE.forEach((entry) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'track-color-swatch';
        btn.dataset.trackColor = entry.id;
        btn.style.setProperty('--swatch', entry.line);
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-label', copy.trackColorLabels[entry.id] || entry.id);
        group.appendChild(btn);
      });
    });
    syncTrackColorSwatches();
  }

  function setTrackColor(colorId) {
    if (!TRACK_COLOR_IDS.has(colorId) || colorId === currentTrackColorId) return;
    currentTrackColorId = colorId;
    syncTrackColorSwatches(colorId);
    invalidateRoutePathCache();
    if (currentState) {
      render();
      renderStep2AnimPreview(1);
    } else refreshWorkflowOutputs();
    schedulePersistSettings();
  }

  function computeRouteGeometry() {
    if (!currentState) return null;
    const W = CANVAS_W;
    const H = CANVAS_H;
    const topPad = 280;
    const bottomPad = 360;
    const routeArea = { x0: SAFE_MARGIN, y0: topPad, x1: W - SAFE_MARGIN, y1: H - bottomPad };
    const routeW = routeArea.x1 - routeArea.x0;
    const routeH = routeArea.y1 - routeArea.y0;
    const fitted = fitToBox(currentState.thinned, routeW, routeH);
    const pts = fitted.points.map((p) => ({ x: p.x + routeArea.x0, y: p.y + routeArea.y0 }));
    const controls = getPosterControls();
    const trackColor = getTrackColorLine();
    const labelMarkers = controls.labels
      .map((label, index) => {
        const targetMeters = Math.min(label.km * 1000, currentState.distance);
        const geoPoint = pointAtDistance(currentState.points, targetMeters);
        if (!geoPoint) return null;
        const projected = fitted.projectPoint(geoPoint);
        return {
          x: projected.x + routeArea.x0,
          y: projected.y + routeArea.y0,
          name: label.name,
          km: targetMeters / 1000,
          offsetX: label.offsetX,
          offsetY: label.offsetY,
          index: index + 1,
        };
      })
      .filter(Boolean);
    return { fitted, pts, controls, trackColor, labelMarkers };
  }

  function drawTrackOverlayLayers(targetCtx, geo) {
    const { pts, controls, trackColor, labelMarkers } = geo;
    targetCtx.save();
    targetCtx.strokeStyle = trackColor;
    targetCtx.lineWidth = controls.lineWidth;
    targetCtx.lineCap = 'round';
    targetCtx.lineJoin = 'round';
    drawCatmullRom(targetCtx, pts, 0.5);
    targetCtx.restore();
    labelMarkers.forEach((marker, index) => {
      const routeIndex = nearestPointIndex(pts, marker.x, marker.y);
      const normal = outwardNormalForPoint(pts, routeIndex, marker.x, marker.y);
      drawWaypointMarker(targetCtx, marker, index, controls, normal, pts, trackColor);
    });
  }

  function drawTrackTraversalLayers(targetCtx, geo, progress) {
    const { pts, controls, trackColor, labelMarkers } = geo;
    const path = getRoutePathCache(pts, labelMarkers);
    const mix = Math.max(0, Math.min(1, progress));
    const revealLength = mix * path.totalLength;
    const markerEpsilon = Math.max(2, controls.lineWidth * 0.35);

    targetCtx.save();
    targetCtx.lineWidth = controls.lineWidth;
    targetCtx.lineCap = 'round';
    targetCtx.lineJoin = 'round';

    targetCtx.strokeStyle = ROUTE_ANIM_UNREVEALED;
    strokeSampledPath(targetCtx, path.samples);

    if (revealLength > 0) {
      targetCtx.strokeStyle = trackColor;
      strokeSampledPathToLength(targetCtx, path.samples, revealLength);
    }
    targetCtx.restore();

    labelMarkers.forEach((marker, index) => {
      const reached = path.markerDistances[index] <= revealLength + markerEpsilon;
      const markerColor = reached ? trackColor : ROUTE_ANIM_UNREVEALED;
      const routeIndex = nearestPointIndex(pts, marker.x, marker.y);
      const normal = outwardNormalForPoint(pts, routeIndex, marker.x, marker.y);
      drawWaypointMarker(targetCtx, marker, index, controls, normal, pts, markerColor);
    });
  }

  function renderStep3TrackPreview() {
    if (!step3TrackPreviewCanvas || !step3TrackPlaceholder) return;
    const s2 = step3TrackPreviewCanvas.getContext('2d');
    if (!currentState) {
      step3TrackPreviewCanvas.hidden = true;
      step3TrackPlaceholder.hidden = false;
      return;
    }
    step3TrackPlaceholder.hidden = true;
    step3TrackPreviewCanvas.hidden = false;
    s2.clearRect(0, 0, CANVAS_W, CANVAS_H);
    const geo = computeRouteGeometry();
    if (geo) drawTrackOverlayLayers(s2, geo);
  }

  function getAnimDurationMs() {
    const seconds = parseFloat(animDurationInput?.value || '5');
    if (!Number.isFinite(seconds) || seconds <= 0) return 5000;
    return seconds * 1000;
  }

  function getAnimExportFps() {
    const fps = parseInt(animFpsSelect?.value || '30', 10);
    return ANIM_EXPORT_FPS_OPTIONS.includes(fps) ? fps : 30;
  }

  function getAnimExportFrameCount() {
    const durationMs = getAnimDurationMs();
    const fps = getAnimExportFps();
    return Math.max(2, Math.round((durationMs / 1000) * fps) + 1);
  }

  function getAnimProgressForFrame(frameIndex, frameCount) {
    if (frameCount <= 1) return 1;
    return frameIndex / (frameCount - 1);
  }

  function renderTraversalExportFrame(targetCtx, geo, progress) {
    targetCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    if (progress >= 1) drawTrackOverlayLayers(targetCtx, geo);
    else drawTrackTraversalLayers(targetCtx, geo, progress);
  }

  function safeTrackBaseName() {
    return (currentState?.fileName || 'gpx-track').replace(/[^\wа-яА-Я\-_. ]+/g, '').trim() || 'gpx-track';
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function delayMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32Uint8(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function buildStoredZipArchive(entries) {
    const nameEncoder = new TextEncoder();
    const fileParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = nameEncoder.encode(entry.name);
      const data = entry.data;
      const crc = crc32Uint8(data);
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const lh = new DataView(localHeader.buffer);
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0, true);
      lh.setUint16(8, 0, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, nameBytes.length, true);
      lh.setUint16(28, 0, true);
      localHeader.set(nameBytes, 30);
      fileParts.push(localHeader, data);

      const cd = new Uint8Array(46 + nameBytes.length);
      const cdv = new DataView(cd.buffer);
      cdv.setUint32(0, 0x02014b50, true);
      cdv.setUint16(4, 20, true);
      cdv.setUint16(6, 20, true);
      cdv.setUint16(8, 0, true);
      cdv.setUint16(10, 0, true);
      cdv.setUint32(16, crc, true);
      cdv.setUint32(20, data.length, true);
      cdv.setUint32(24, data.length, true);
      cdv.setUint16(28, nameBytes.length, true);
      cdv.setUint16(30, 0, true);
      cdv.setUint16(32, 0, true);
      cdv.setUint16(34, 0, true);
      cdv.setUint16(36, 0, true);
      cdv.setUint32(38, 0, true);
      cdv.setUint32(42, offset, true);
      cd.set(nameBytes, 46);
      centralParts.push(cd);
      offset += localHeader.length + data.length;
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const endv = new DataView(end.buffer);
    endv.setUint32(0, 0x06054b50, true);
    endv.setUint16(8, entries.length, true);
    endv.setUint16(10, entries.length, true);
    endv.setUint32(12, centralSize, true);
    endv.setUint32(16, offset, true);

    const totalSize =
      fileParts.reduce((sum, part) => sum + part.length, 0) + centralSize + end.length;
    const out = new Uint8Array(totalSize);
    let pos = 0;
    for (const part of fileParts) {
      out.set(part, pos);
      pos += part.length;
    }
    for (const part of centralParts) {
      out.set(part, pos);
      pos += part.length;
    }
    out.set(end, pos);
    return out;
  }

  function canvasToPngUint8(exportCanvas) {
    return new Promise((resolve, reject) => {
      exportCanvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('PNG encode failed'));
          return;
        }
        blob
          .arrayBuffer()
          .then((buffer) => resolve(new Uint8Array(buffer)))
          .catch(reject);
      }, 'image/png');
    });
  }

  function pickWebmMimeType() {
    if (typeof MediaRecorder === 'undefined') return null;
    const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || null;
  }

  async function prepareAnimExportContext() {
    if (!currentState || animExportInProgress) return null;
    stopRouteAnimPlayback();
    clearError();

    const controls = getPosterControls();
    if (document.fonts?.ready) {
      try {
        await document.fonts.ready;
      } catch (_e) {
        /* ignore */
      }
    }
    if (document.fonts && controls.labelFontKey !== 'georgia') {
      await document.fonts.load(`${controls.labelSize}px ${controls.labelFontFamily}`).catch(() => {});
    }

    const geo = computeRouteGeometry();
    if (!geo) return null;

    getRoutePathCache(geo.pts, geo.labelMarkers);

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = CANVAS_W;
    exportCanvas.height = CANVAS_H;
    const exportCtx = exportCanvas.getContext('2d', { alpha: true });
    return { geo, exportCanvas, exportCtx };
  }

  function setAnimExportBusy(busy) {
    animExportInProgress = busy;
    updateStep2Controls();
  }

  async function exportAnimWebm() {
    const exportContext = await prepareAnimExportContext();
    if (!exportContext) return;

    const mimeType = pickWebmMimeType();
    if (!mimeType) {
      showError(copy.webmUnsupported);
      return;
    }

    setAnimExportBusy(true);
    if (downloadAnimWebmBtn) downloadAnimWebmBtn.textContent = copy.exportingWebm;

    try {
      const { geo, exportCanvas, exportCtx } = exportContext;
      const frameCount = getAnimExportFrameCount();
      const exportFps = getAnimExportFps();
      const frameDelayMs = Math.round(1000 / exportFps);
      const stream = exportCanvas.captureStream(exportFps);
      const videoTrack = stream.getVideoTracks()[0];
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 12_000_000,
      });
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunks.push(event.data);
      };
      const stopped = new Promise((resolve) => {
        recorder.onstop = resolve;
      });

      recorder.start();
      for (let i = 0; i < frameCount; i++) {
        const progress = getAnimProgressForFrame(i, frameCount);
        renderTraversalExportFrame(exportCtx, geo, progress);
        if (videoTrack?.requestFrame) videoTrack.requestFrame();
        await delayMs(frameDelayMs);
      }
      renderTraversalExportFrame(exportCtx, geo, 1);
      if (videoTrack?.requestFrame) videoTrack.requestFrame();
      await delayMs(frameDelayMs);

      recorder.stop();
      await stopped;

      const blob = new Blob(chunks, { type: mimeType });
      downloadBlob(blob, `${safeTrackBaseName()}-track-anim.webm`);
    } catch (err) {
      console.error(err);
      showError(copy.exportFailed);
    } finally {
      setAnimExportBusy(false);
      renderStep2AnimPreview(1);
    }
  }

  async function exportAnimPngZip() {
    const exportContext = await prepareAnimExportContext();
    if (!exportContext) return;

    setAnimExportBusy(true);
    try {
      const { geo, exportCanvas, exportCtx } = exportContext;
      const frameCount = getAnimExportFrameCount();
      const zipEntries = [];

      for (let i = 0; i < frameCount; i++) {
        if (downloadAnimPngZipBtn) {
          downloadAnimPngZipBtn.textContent = copy.exportingPngFrame(i + 1, frameCount);
        }
        const progress = getAnimProgressForFrame(i, frameCount);
        renderTraversalExportFrame(exportCtx, geo, progress);
        const pngBytes = await canvasToPngUint8(exportCanvas);
        zipEntries.push({
          name: `frame_${String(i + 1).padStart(4, '0')}.png`,
          data: pngBytes,
        });
      }

      zipEntries.push({
        name: 'ffmpeg.txt',
        data: new TextEncoder().encode(copy.ffmpegReadme(getAnimExportFps())),
      });

      const zipBytes = buildStoredZipArchive(zipEntries);
      downloadBlob(
        new Blob([zipBytes], { type: 'application/zip' }),
        `${safeTrackBaseName()}-track-anim-frames.zip`,
      );
    } catch (err) {
      console.error(err);
      showError(copy.exportFailed);
    } finally {
      setAnimExportBusy(false);
      renderStep2AnimPreview(1);
    }
  }

  function stopRouteAnimPlayback() {
    if (routeAnimRafId !== null) {
      cancelAnimationFrame(routeAnimRafId);
      routeAnimRafId = null;
    }
    routeAnimPlaying = false;
    updateStep2Controls();
  }

  function renderStep2AnimFrame(progress) {
    if (!step2AnimCanvas || !step2AnimPlaceholder) return;
    const animCtx = step2AnimCanvas.getContext('2d');
    if (!currentState) {
      step2AnimCanvas.hidden = true;
      step2AnimPlaceholder.hidden = false;
      if (step2AnimPlaceholder.textContent !== copy.animEmpty) {
        step2AnimPlaceholder.textContent = copy.animEmpty;
      }
      return;
    }
    step2AnimPlaceholder.hidden = true;
    step2AnimCanvas.hidden = false;
    const geo = computeRouteGeometry();
    if (!geo) return;
    renderTraversalExportFrame(animCtx, geo, progress);
  }

  function renderStep2AnimPreview(progress = 1) {
    if (routeAnimPlaying) return;
    renderStep2AnimFrame(progress);
    updateStep2Controls();
  }

  function playRouteAnim() {
    if (!currentState || routeAnimPlaying || animExportInProgress) return;
    stopRouteAnimPlayback();
    routeAnimPlaying = true;
    updateStep2Controls();
    const durationMs = getAnimDurationMs();
    const startedAt = performance.now();

    const tick = (now) => {
      const elapsed = now - startedAt;
      const progress = Math.min(1, elapsed / durationMs);
      renderStep2AnimFrame(progress);
      if (progress < 1) {
        routeAnimRafId = requestAnimationFrame(tick);
        return;
      }
      routeAnimRafId = null;
      routeAnimPlaying = false;
      updateStep2Controls();
    };

    renderStep2AnimFrame(0);
    routeAnimRafId = requestAnimationFrame(tick);
  }

  // ---------- Rendering ----------
  function render() {
    if (!currentState) return;
    const posterTheme = POSTER_THEME;
    const W = CANVAS_W, H = CANVAS_H;

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, posterTheme.bg1);
    grad.addColorStop(1, posterTheme.bg2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Soft topographic contour rings (decorative)
    ctx.save();
    ctx.strokeStyle = posterTheme.contour;
    ctx.lineWidth = 2;
    for (let r = 200; r < 1400; r += 80) {
      ctx.beginPath();
      ctx.ellipse(W * 0.18, H * 0.18, r * 0.9, r * 0.55, 0.2, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let r = 200; r < 1400; r += 80) {
      ctx.beginPath();
      ctx.ellipse(W * 0.86, H * 0.82, r * 0.85, r * 0.5, -0.3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // Subtle grain
    ctx.save();
    ctx.globalAlpha = 1;
    for (let i = 0; i < 1400; i++) {
      ctx.fillStyle = posterTheme.paperGrain;
      const x = Math.random() * W;
      const y = Math.random() * H;
      ctx.fillRect(x, y, 1.2, 1.2);
    }
    ctx.restore();

    const geo = computeRouteGeometry();
    if (geo) drawTrackOverlayLayers(ctx, geo);

    // Top text block
    drawTopBlock(ctx, posterTheme);

    // Bottom stats block
    drawBottomBlock(ctx, posterTheme);

    // Outer frame
    ctx.save();
    ctx.strokeStyle = posterTheme.ink;
    ctx.globalAlpha = 0.10;
    ctx.lineWidth = 4;
    ctx.strokeRect(40, 40, W - 80, H - 80);
    ctx.restore();

    refreshWorkflowOutputs();
  }

  function fitToBox(points, boxW, boxH) {
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const p of points) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }
    const centerLat = (minLat + maxLat) / 2;
    const cosLat = Math.cos((centerLat * Math.PI) / 180);
    const projected = points.map((p) => ({
      x: (p.lon - minLon) * cosLat,
      y: -(p.lat - maxLat),
    }));
    let pminX = Infinity, pmaxX = -Infinity, pminY = Infinity, pmaxY = -Infinity;
    for (const p of projected) {
      if (p.x < pminX) pminX = p.x;
      if (p.x > pmaxX) pmaxX = p.x;
      if (p.y < pminY) pminY = p.y;
      if (p.y > pmaxY) pmaxY = p.y;
    }
    const pw = Math.max(pmaxX - pminX, 1e-9);
    const ph = Math.max(pmaxY - pminY, 1e-9);
    const scale = Math.min(boxW / pw, boxH / ph);
    const drawW = pw * scale;
    const drawH = ph * scale;
    const offX = (boxW - drawW) / 2 - pminX * scale;
    const offY = (boxH - drawH) / 2 - pminY * scale;
    const projectPoint = (point) => ({
      x: ((point.lon - minLon) * cosLat) * scale + offX,
      y: (-(point.lat - maxLat)) * scale + offY,
    });
    return {
      points: projected.map((p) => ({ x: p.x * scale + offX, y: p.y * scale + offY })),
      projectPoint,
    };
  }

  function nearestPointIndex(points, x, y) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dx = points[i].x - x;
      const dy = points[i].y - y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  function outwardNormalForPoint(points, index, x, y) {
    const prev = points[Math.max(0, index - 1)] || points[index];
    const next = points[Math.min(points.length - 1, index + 1)] || points[index];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const length = Math.hypot(dx, dy) || 1;
    let nx = -dy / length;
    let ny = dx / length;
    const centerX = CANVAS_W / 2;
    const centerY = CANVAS_H / 2;
    if (nx * (x - centerX) + ny * (y - centerY) < 0) {
      nx *= -1;
      ny *= -1;
    }
    return { x: nx, y: ny };
  }

  function distanceToSegment(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const lengthSq = abx * abx + aby * aby || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSq));
    const x = ax + abx * t;
    const y = ay + aby * t;
    return Math.hypot(px - x, py - y);
  }

  function rectDistanceToRoute(rect, routePoints) {
    const samples = [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.w, y: rect.y },
      { x: rect.x, y: rect.y + rect.h },
      { x: rect.x + rect.w, y: rect.y + rect.h },
      { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 },
    ];
    let best = Infinity;
    for (let i = 1; i < routePoints.length; i++) {
      for (const sample of samples) {
        best = Math.min(best, distanceToSegment(sample.x, sample.y, routePoints[i - 1].x, routePoints[i - 1].y, routePoints[i].x, routePoints[i].y));
      }
    }
    return best;
  }

  function candidateLabelPosition(anchorX, anchorY, labelW, labelH, offset, dir) {
    let x = anchorX + dir.x * offset;
    let y = anchorY + dir.y * offset;
    if (dir.x < -0.15) x -= labelW;
    else if (Math.abs(dir.x) <= 0.15) x -= labelW / 2;
    if (dir.y < -0.15) y -= labelH;
    else if (Math.abs(dir.y) <= 0.15) y -= labelH / 2;
    x = Math.max(64, Math.min(CANVAS_W - 64 - labelW, x));
    y = Math.max(286, Math.min(CANVAS_H - 430 - labelH, y));
    return { x, y, w: labelW, h: labelH };
  }

  function chooseLabelRect(anchorX, anchorY, labelW, labelH, offset, normal, routePoints) {
    const base = normal || { x: 1, y: 0 };
    const dirs = [
      base,
      { x: -base.x, y: -base.y },
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 0.72, y: -0.72 },
      { x: -0.72, y: -0.72 },
      { x: 0.72, y: 0.72 },
      { x: -0.72, y: 0.72 },
    ];
    let best = null;
    let bestScore = -Infinity;
    for (const dir of dirs) {
      const rect = candidateLabelPosition(anchorX, anchorY, labelW, labelH, offset, dir);
      const routeClearance = routePoints ? rectDistanceToRoute(rect, routePoints) : 999;
      const anchorDistance = Math.hypot(rect.x + rect.w / 2 - anchorX, rect.y + rect.h / 2 - anchorY);
      const score = routeClearance * 8 + anchorDistance * 0.05;
      if (score > bestScore) {
        bestScore = score;
        best = rect;
      }
    }
    return best;
  }

  function drawWaypointMarker(
    ctx,
    marker,
    index,
    controls = getPosterControls(),
    normal = null,
    routePoints = null,
    lineColor,
  ) {
    const side = index % 2 === 0 ? 'right' : 'left';
    const markerRadius = (controls.lineWidth * controls.pointScale) / 2;
    ctx.save();
    ctx.fillStyle = lineColor;
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, markerRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawTrackLabel(ctx, marker, side, controls, normal, routePoints, lineColor);
  }

  function splitLabelLines(text) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 4);
  }

  function roundPx(value) {
    return Math.round(value * 10) / 10;
  }

  /**
   * Same geometry as drawTrackLabel; used for canvas export and for AI prompt text.
   * @returns {null | { lines: string[], textX: number, firstLineY: number, lineHeight: number, fontSize: number, fontWeight: number, fontFamily: string, color: string }}
   */
  function computeTrackLabelLayout(
    marker,
    side,
    controls,
    normal,
    routePoints,
    measureCtx,
    lineColor,
  ) {
    const clean = marker.name.trim();
    if (!clean) return null;

    const fontSize = controls.labelSize;
    const weight = 700;
    measureCtx.save();
    measureCtx.font = `${weight} ${fontSize}px ${controls.labelFontFamily}`;
    measureCtx.textBaseline = 'middle';
    const maxWidth = Math.max(240, Math.min(390, fontSize * 14));
    const lines = splitLabelLines(clean).map((line) => {
      let label = line;
      while (measureCtx.measureText(label).width > maxWidth && label.length > 8) {
        label = label.slice(0, -2).trim() + '…';
      }
      return label;
    });
    if (!lines.length) {
      measureCtx.restore();
      return null;
    }

    const labelW = Math.max(...lines.map((line) => measureCtx.measureText(line).width));
    const lineHeight = fontSize * 1.14;
    const labelH = lineHeight * lines.length;
    const markerRadius = (controls.lineWidth * controls.pointScale) / 2;
    const offset = markerRadius + Math.max(controls.labelSize * 0.75, controls.lineWidth * 3, 34);
    let textX;
    let textY;
    if (routePoints) {
      const rect = chooseLabelRect(marker.x, marker.y, labelW, labelH, offset, normal, routePoints);
      textX = rect.x;
      textY = rect.y + labelH / 2;
    } else if (normal) {
      const rect = candidateLabelPosition(marker.x, marker.y, labelW, labelH, offset, normal);
      textX = rect.x;
      textY = rect.y + labelH / 2;
    } else {
      textX = side === 'left' ? marker.x - labelW - offset : marker.x + offset;
      textY = marker.y;
    }
    textX += marker.offsetX || 0;
    textY += marker.offsetY || 0;
    textX = Math.max(64, Math.min(CANVAS_W - 64 - labelW, textX));
    textY = Math.max(286, Math.min(CANVAS_H - 430, textY));

    const firstLineY = textY - ((lines.length - 1) * lineHeight) / 2;
    measureCtx.restore();

    return {
      lines,
      textX,
      firstLineY,
      lineHeight,
      fontSize,
      fontWeight: weight,
      fontFamily: controls.labelFontFamily,
      color: lineColor,
    };
  }

  function drawTrackLabel(
    ctx,
    marker,
    side,
    controls = getPosterControls(),
    normal = null,
    routePoints = null,
    lineColor,
  ) {
    const layout = computeTrackLabelLayout(marker, side, controls, normal, routePoints, ctx, lineColor);
    if (!layout) return;

    ctx.save();
    ctx.font = `${layout.fontWeight} ${layout.fontSize}px ${layout.fontFamily}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = layout.color;
    layout.lines.forEach((line, i) => {
      ctx.fillText(line, layout.textX, layout.firstLineY + i * layout.lineHeight);
    });
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function drawTopBlock(ctx, theme) {
    const title = (titleInput.value || '').trim() || 'GPX TRACK';

    // Eyebrow
    ctx.save();
    ctx.fillStyle = theme.inkMuted;
    ctx.font = '500 26px "JetBrains Mono", monospace';
    ctx.textBaseline = 'top';
    ctx.fillText('· TRAIL · TRACK · ROUTE ·', 90, 110);
    ctx.restore();

    // Title — wrap if needed
    ctx.save();
    ctx.fillStyle = theme.ink;
    ctx.font = '700 86px "Satoshi", sans-serif';
    ctx.textBaseline = 'top';
    const maxWidth = CANVAS_W - 180;
    const lines = wrapText(ctx, title.toUpperCase(), maxWidth);
    let ty = 150;
    for (const line of lines.slice(0, 2)) {
      ctx.fillText(line, 90, ty);
      ty += 90;
    }
    ctx.restore();
  }

  function wrapText(ctx, text, maxWidth) {
    const words = text.split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width <= maxWidth) {
        line = test;
      } else {
        if (line) lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawBottomBlock(ctx, theme) {
    const W = CANVAS_W, H = CANVAS_H;
    const baseY = H - 280;

    // Divider line
    ctx.save();
    ctx.strokeStyle = theme.ink;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(90, baseY - 30);
    ctx.lineTo(W - 90, baseY - 30);
    ctx.stroke();
    ctx.restore();

    const distKm = (currentState.distance / 1000);
    const distStr = distKm < 10 ? distKm.toFixed(2) : distKm.toFixed(1);
    const ptsStr = String(currentState.thinned.length);
    const { minLat, maxLat, minLon, maxLon } = currentState.bbox;
    const formatCoord = (v, isLat) => {
      const dir = isLat ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W');
      return Math.abs(v).toFixed(3) + '° ' + dir;
    };

    const cols = [
      { label: 'DISTANCE', value: distStr + ' km' },
      { label: 'POINTS', value: ptsStr },
      { label: 'LAT', value: formatCoord(minLat, true) + ' / ' + formatCoord(maxLat, true) },
      { label: 'LON', value: formatCoord(minLon, false) + ' / ' + formatCoord(maxLon, false) },
    ];

    ctx.save();
    let y = baseY;
    ctx.textBaseline = 'top';
    // Row 1: distance & points (large)
    ctx.fillStyle = theme.inkMuted;
    ctx.font = '500 22px "JetBrains Mono", monospace';
    ctx.fillText('DISTANCE', 90, y);
    ctx.fillText('POINTS', W / 2 + 20, y);

    ctx.fillStyle = theme.ink;
    ctx.font = '700 58px "Satoshi", sans-serif';
    ctx.fillText(distStr + ' km', 90, y + 32);
    ctx.fillText(ptsStr + ' pts', W / 2 + 20, y + 32);

    // Row 2: coords
    y = baseY + 130;
    ctx.fillStyle = theme.inkMuted;
    ctx.font = '500 20px "JetBrains Mono", monospace';
    ctx.fillText('LAT  ' + formatCoord(minLat, true) + '  →  ' + formatCoord(maxLat, true), 90, y);
    ctx.fillText('LON  ' + formatCoord(minLon, false) + '  →  ' + formatCoord(maxLon, false), 90, y + 32);
    ctx.restore();
  }

  // ---------- UI: stats panel ----------
  function updateStatsPanel(state) {
    statSource.textContent = state.source;
    statOriginal.textContent = state.original.toLocaleString(copy.locale);
    statThinned.textContent = state.thinned.length.toLocaleString(copy.locale);
    const km = state.distance / 1000;
    statDistance.textContent = (km < 10 ? km.toFixed(2) : km.toFixed(1)) + ' ' + copy.distanceUnit;
    const { minLat, maxLat, minLon, maxLon } = state.bbox;
    // Width/height in km
    const wKm = haversine(minLat, minLon, minLat, maxLon) / 1000;
    const hKm = haversine(minLat, minLon, maxLat, minLon) / 1000;
    statBbox.textContent = wKm.toFixed(1) + ' × ' + hKm.toFixed(1) + ' ' + copy.distanceUnit;
  }

  function refreshWorkflowOutputs() {
    if (!currentState) {
      stopRouteAnimPlayback();
      invalidateRoutePathCache();
      updateStep2Controls();
      updateStep3Controls();
      renderStep3TrackPreview();
      renderStep2AnimPreview(1);
      return;
    }
    updateStep2Controls();
    updateStep3Controls();
    renderStep3TrackPreview();
    renderStep2AnimPreview(1);
  }

  function updateStep2Controls() {
    const hasTrack = Boolean(currentState);
    const locked = routeAnimPlaying || animExportInProgress;
    if (playAnimBtn) {
      playAnimBtn.disabled = !hasTrack || locked;
      playAnimBtn.textContent = routeAnimPlaying ? copy.playingAnim : copy.playAnim;
    }
    if (animDurationInput) animDurationInput.disabled = locked;
    if (animFpsSelect) animFpsSelect.disabled = locked;
    if (downloadAnimWebmBtn) {
      downloadAnimWebmBtn.disabled = !hasTrack || locked;
      if (!animExportInProgress) downloadAnimWebmBtn.textContent = copy.downloadAnimWebm;
    }
    if (downloadAnimPngZipBtn) {
      downloadAnimPngZipBtn.disabled = !hasTrack || locked;
      if (!animExportInProgress) downloadAnimPngZipBtn.textContent = copy.downloadAnimPngZip;
    }
  }

  function updateStep3Controls() {
    const hasTrack = Boolean(currentState);
    if (downloadTransparentPngBtn) {
      downloadTransparentPngBtn.disabled = !hasTrack;
    }
  }

  async function downloadTransparentTrackPng() {
    if (!currentState) return;
    const controls = getPosterControls();
    if (document.fonts && document.fonts.ready) {
      try {
        await document.fonts.ready;
      } catch (_e) {
        /* ignore */
      }
    }
    if (document.fonts && controls.labelFontKey !== 'georgia') {
      await document.fonts.load(`${controls.labelSize}px ${controls.labelFontFamily}`).catch(() => {});
    }
    const geo = computeRouteGeometry();
    if (!geo) return;
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = CANVAS_W;
    exportCanvas.height = CANVAS_H;
    const x = exportCanvas.getContext('2d');
    x.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawTrackOverlayLayers(x, geo);
    exportCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const base =
        (currentState.fileName || 'gpx-track').replace(/[^\wа-яА-Я\-_. ]+/g, '').trim() || 'gpx-track';
      a.download = base + '-track-alpha.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  }

  function formatKm(value) {
    const rounded = Math.round(value * 10) / 10;
    const formatted = String(rounded);
    return LANG === 'ru' ? formatted.replace('.', ',') : formatted;
  }

  function resetDefaultLabels() {
    waypointList.textContent = '';
    if (!currentState) return;
    addWaypointRow(copy.defaultStart, '0', '0', '0', false);
    addWaypointRow(copy.defaultFinish, formatKm(currentState.distance / 1000), '0', '0', false);
  }

  function addWaypointRow(name = '', distanceKm = '', offsetX = '0', offsetY = '0', shouldRender = true) {
    waypointCounter += 1;
    const row = document.createElement('div');
    row.className = 'waypoint-row';
    row.dataset.id = String(waypointCounter);

    const nameInput = document.createElement('textarea');
    nameInput.className = 'waypoint-name';
    nameInput.maxLength = 80;
    nameInput.rows = 1;
    nameInput.placeholder = copy.waypointTextPlaceholder;
    nameInput.value = name;
    nameInput.setAttribute('aria-label', copy.waypointTextAria);

    const distanceInput = document.createElement('input');
    distanceInput.type = 'text';
    distanceInput.className = 'waypoint-distance';
    distanceInput.inputMode = 'decimal';
    distanceInput.pattern = '[0-9]+([\\.,][0-9]+)?';
    distanceInput.placeholder = copy.waypointDistancePlaceholder;
    distanceInput.value = distanceKm;
    distanceInput.setAttribute('aria-label', copy.waypointDistanceAria);

    const offsetXInput = document.createElement('input');
    offsetXInput.type = 'text';
    offsetXInput.className = 'waypoint-offset-x';
    offsetXInput.inputMode = 'decimal';
    offsetXInput.pattern = '-?[0-9]+([\\.,][0-9]+)?';
    offsetXInput.placeholder = 'X';
    offsetXInput.value = offsetX;
    offsetXInput.setAttribute('aria-label', copy.offsetXAria);

    const offsetYInput = document.createElement('input');
    offsetYInput.type = 'text';
    offsetYInput.className = 'waypoint-offset-y';
    offsetYInput.inputMode = 'decimal';
    offsetYInput.pattern = '-?[0-9]+([\\.,][0-9]+)?';
    offsetYInput.placeholder = 'Y';
    offsetYInput.value = offsetY;
    offsetYInput.setAttribute('aria-label', copy.offsetYAria);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-waypoint';
    removeBtn.setAttribute('aria-label', copy.removeWaypointAria);
    const trashIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    trashIcon.setAttribute('viewBox', '0 0 24 24');
    trashIcon.setAttribute('aria-hidden', 'true');
    trashIcon.classList.add('trash-icon');
    const trashLid = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    trashLid.setAttribute('d', 'M9 6V4.8C9 4.36 9.36 4 9.8 4H14.2C14.64 4 15 4.36 15 4.8V6M5 6H19');
    const trashBin = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    trashBin.setAttribute('d', 'M8 9L8.7 19H15.3L16 9M10.5 10.5V17M13.5 10.5V17');
    trashIcon.append(trashLid, trashBin);
    removeBtn.append(trashIcon);

    const controlsRow = document.createElement('div');
    controlsRow.className = 'waypoint-controls';
    controlsRow.append(distanceInput, offsetXInput, offsetYInput, removeBtn);

    row.append(nameInput, controlsRow);
    waypointList.append(row);
    if (shouldRender) {
      nameInput.focus();
      if (currentState) render();
      else refreshWorkflowOutputs();
    }
  }

  // ---------- File handling ----------
  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
    results.hidden = true;
  }
  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = '';
  }

  async function handleFile(file, opts = {}) {
    const { scrollToResults = true, suppressError = false, preserveWaypoints = false } = opts;
    clearError();
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.gpx') && file.type !== 'application/gpx+xml' && file.type !== 'text/xml' && file.type !== 'application/xml') {
      showError(copy.fileTypeError);
      return;
    }
    if (file.size === 0) {
      showError(copy.emptyFileError);
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      showError(copy.largeFileError);
      return;
    }
    const generation = ++fileIngestGeneration;
    try {
      const text = await file.text();
      if (!text.trim()) {
        showError(copy.whitespaceFileError);
        return;
      }
      const { points, source } = parseGPX(text);
      const original = points.length;

      if (generation !== fileIngestGeneration) return;

      // Bounding box on raw points
      let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
      for (const p of points) {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lon < minLon) minLon = p.lon;
        if (p.lon > maxLon) maxLon = p.lon;
      }

      const controls = getPosterControls();
      const thinned = thinPoints(points, controls.minDistanceMeters);
      const distance = totalDistanceMeters(points);

      currentState = {
        points,
        original,
        thinned,
        distance,
        source,
        bbox: { minLat, maxLat, minLon, maxLon },
        fileName: file.name.replace(/\.gpx$/i, ''),
      };

      invalidateRoutePathCache();
      if (!preserveWaypoints) resetDefaultLabels();
      updateStatsPanel(currentState);
      render();
      results.hidden = false;
      schedulePersistSettings();
      if (scrollToResults) {
        results.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (err) {
      console.error(err);
      if (!suppressError) {
        showError(err.message || copy.genericFileError);
      }
    }
  }

  async function loadSampleTrack(options = {}) {
    const { quiet = false, applyDemoContent = true, preserveWaypoints = false } = options;
    const scrollToResults = !quiet;
    const suppressError = quiet;
    if (!quiet) {
      clearError();
      sampleBtn.disabled = true;
    }
    const previousText = quiet ? '' : sampleBtn.textContent;
    if (!quiet) sampleBtn.textContent = copy.loadingSample;
    try {
      const response = await fetch('/gpx-route-png/sample.gpx?v=20260514-8');
      if (!response.ok) {
        throw new Error(copy.sampleLoadError);
      }
      const blob = await response.blob();
      const file = new File([blob], 'sample.gpx', { type: 'application/gpx+xml' });
      await handleFile(file, { scrollToResults, suppressError, preserveWaypoints });
      if (applyDemoContent && currentState) {
        settingsPersistSuspended = true;
        titleInput.value = 'Evening Mountain Bike Ride';
        minDistanceInput.value = '180';
        minDistanceOutput.textContent = '180';
        waypointList.textContent = '';
        waypointCounter = 0;
        addWaypointRow(copy.defaultStart, '0', '0', '0', false);
        addWaypointRow(copy.sampleMiddle1, formatKm(5.4), '0', '0', false);
        addWaypointRow(copy.sampleMiddle2, formatKm(9.1), '240', '-200', false);
        addWaypointRow(copy.defaultFinish, formatKm(currentState.distance / 1000), '0', '0', false);
        settingsPersistSuspended = false;
        updateThinning();
        render();
        persistSettings();
      }
    } catch (err) {
      console.error(err);
      if (!quiet) {
        showError(copy.sampleUiError);
      }
    } finally {
      if (!quiet) {
        sampleBtn.disabled = false;
        sampleBtn.textContent = previousText;
      }
    }
  }

  // ---------- Events ----------
  browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });
  sampleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    loadSampleTrack({ quiet: false });
  });
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFile(file);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('is-drag');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('is-drag');
    })
  );
  dropZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
  // Prevent default drop on window
  ['dragover', 'drop'].forEach((evt) => {
    window.addEventListener(evt, (e) => {
      if (e.target !== dropZone && !dropZone.contains(e.target)) {
        e.preventDefault();
      }
    });
  });

  downloadBtn.addEventListener('click', () => {
    if (!currentState) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (currentState.fileName || 'gpx-track').replace(/[^\wа-яА-Я\-_. ]+/g, '').trim() || 'gpx-track';
      a.download = safeName + '-1080x1920.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  });

  if (downloadTransparentPngBtn) {
    downloadTransparentPngBtn.addEventListener('click', () => {
      void downloadTransparentTrackPng();
    });
  }

  if (playAnimBtn) {
    playAnimBtn.addEventListener('click', () => playRouteAnim());
  }
  if (downloadAnimWebmBtn) {
    downloadAnimWebmBtn.addEventListener('click', () => {
      void exportAnimWebm();
    });
  }
  if (downloadAnimPngZipBtn) {
    downloadAnimPngZipBtn.addEventListener('click', () => {
      void exportAnimPngZip();
    });
  }
  if (animDurationInput) {
    animDurationInput.addEventListener('input', () => {
      if (animDurationOutput) animDurationOutput.textContent = animDurationInput.value;
      schedulePersistSettings();
    });
  }
  if (animFpsSelect) {
    animFpsSelect.addEventListener('change', () => schedulePersistSettings());
  }

  if (resetSettingsBtn) {
    resetSettingsBtn.addEventListener('click', () => resetSettingsToDefaults());
  }

  resetBtn.addEventListener('click', () => {
    stopRouteAnimPlayback();
    invalidateRoutePathCache();
    currentState = null;
    results.hidden = true;
    clearError();
    titleInput.value = '';
    waypointList.textContent = '';
    waypointCounter = 0;
    refreshWorkflowOutputs();
    schedulePersistSettings();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  [titleInput].forEach((input) => input.addEventListener('input', () => {
    if (currentState) {
      render();
      renderStep2AnimPreview(1);
    } else refreshWorkflowOutputs();
    schedulePersistSettings();
  }));

  labelFontSelect.addEventListener('change', async () => {
    const controls = getPosterControls();
    if (document.fonts && controls.labelFontKey !== 'georgia') {
      await document.fonts.load(`${controls.labelSize}px ${controls.labelFontFamily}`).catch(() => {});
    }
    if (currentState) {
      render();
      renderStep2AnimPreview(1);
    } else refreshWorkflowOutputs();
    schedulePersistSettings();
  });

  labelSizeInput.addEventListener('input', () => {
    labelSizeOutput.textContent = labelSizeInput.value;
    if (currentState) {
      render();
      renderStep2AnimPreview(1);
    } else refreshWorkflowOutputs();
    schedulePersistSettings();
  });

  lineWidthInput.addEventListener('input', () => {
    lineWidthOutput.textContent = lineWidthInput.value;
    if (currentState) {
      render();
      renderStep2AnimPreview(1);
    } else refreshWorkflowOutputs();
    schedulePersistSettings();
  });

  pointScaleInput.addEventListener('input', () => {
    pointScaleOutput.textContent = pointScaleInput.value;
    if (currentState) {
      render();
      renderStep2AnimPreview(1);
    } else refreshWorkflowOutputs();
    schedulePersistSettings();
  });

  minDistanceInput.addEventListener('input', () => {
    minDistanceOutput.textContent = minDistanceInput.value;
    if (currentState) updateThinning();
    else refreshWorkflowOutputs();
    schedulePersistSettings();
  });

  addWaypointBtn.addEventListener('click', () => {
    addWaypointRow();
    schedulePersistSettings();
  });

  waypointList.addEventListener('input', (e) => {
    if (e.target.matches('.waypoint-name, .waypoint-distance, .waypoint-offset-x, .waypoint-offset-y')) {
      if (currentState) {
        render();
        renderStep2AnimPreview(1);
      } else refreshWorkflowOutputs();
      schedulePersistSettings();
    }
  });

  waypointList.addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-waypoint');
    if (!btn) return;
    btn.closest('.waypoint-row').remove();
    if (currentState) {
      render();
      renderStep2AnimPreview(1);
    } else refreshWorkflowOutputs();
    schedulePersistSettings();
  });

  trackColorGroups.forEach((group) => {
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('.track-color-swatch');
      if (!btn || !group.contains(btn)) return;
      const colorId = btn.dataset.trackColor;
      if (colorId) setTrackColor(colorId);
    });
  });

  initTrackColorPalette();
  const hadStoredSettings = restoreStoredSettings();
  updateStep2Controls();
  updateStep3Controls();
  renderStep2AnimPreview(1);
  void loadSampleTrack({
    quiet: true,
    applyDemoContent: !hadStoredSettings,
    preserveWaypoints: hadStoredSettings,
  }).then(() => {
    if (!hadStoredSettings) persistSettings();
  });
})();
