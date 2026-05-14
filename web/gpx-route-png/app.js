(() => {
  'use strict';

  // ---------- Constants ----------
  const CANVAS_W = 1080;
  const CANVAS_H = 1920;
  const MIN_DIST_M = 50; // minimum distance between thinned points
  const SAFE_MARGIN = 140; // safe margin in canvas px around the route

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
  const themeGroup = document.getElementById('themeGroup');
  const aiDescription = document.getElementById('aiDescription');
  const downloadPromptBtn = document.getElementById('downloadPromptBtn');
  const downloadTransparentPngBtn = document.getElementById('downloadTransparentPngBtn');
  const step2TrackPreviewCanvas = document.getElementById('step2TrackPreviewCanvas');
  const step2TrackPlaceholder = document.getElementById('step2TrackPlaceholder');

  const statSource = document.getElementById('statSource');
  const statOriginal = document.getElementById('statOriginal');
  const statThinned = document.getElementById('statThinned');
  const statDistance = document.getElementById('statDistance');
  const statBbox = document.getElementById('statBbox');

  let currentState = null; // { points, thinned, distance, source, bbox, fileName }
  let fileIngestGeneration = 0;
  let currentTheme = 'paper';
  let waypointCounter = 0;
  const DEFAULT_ROUTE_LINE_WIDTH = 14;

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
      throw new Error('Не удалось разобрать GPX: файл повреждён или не является валидным XML.');
    }

    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'gpx') {
      throw new Error('Это не похоже на GPX-файл: отсутствует корневой элемент <gpx>.');
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
      throw new Error('В GPX-файле не найдено достаточно координат (нужно минимум две точки).');
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

  // ---------- Theming ----------
  const themes = {
    paper: {
      bg1: '#F1EADA',
      bg2: '#E2D6B5',
      paperGrain: 'rgba(120,100,60,0.06)',
      contour: 'rgba(78,107,74,0.10)',
      line: '#C95A2B',
      ink: '#1A2A24',
      inkMuted: '#6B776F',
      dot: '#1A2A24',
      dotInner: '#C95A2B',
    },
    night: {
      bg1: '#0F1620',
      bg2: '#1A2535',
      paperGrain: 'rgba(255,255,255,0.025)',
      contour: 'rgba(120,160,200,0.08)',
      line: '#E8A36B',
      ink: '#EDE6D4',
      inkMuted: '#8A98AC',
      dot: '#EDE6D4',
      dotInner: '#E8A36B',
    },
    forest: {
      bg1: '#1F2A22',
      bg2: '#2D3B30',
      paperGrain: 'rgba(255,255,255,0.025)',
      contour: 'rgba(180,200,140,0.07)',
      line: '#E8C765',
      ink: '#F2EAD3',
      inkMuted: '#A8B59B',
      dot: '#F2EAD3',
      dotInner: '#E8C765',
    },
  };

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
    const theme = themes[currentTheme];
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
    return { fitted, pts, controls, theme, labelMarkers };
  }

  function drawTrackOverlayLayers(targetCtx, geo) {
    const { pts, controls, theme, labelMarkers } = geo;
    targetCtx.save();
    targetCtx.strokeStyle = theme.line;
    targetCtx.lineWidth = controls.lineWidth;
    targetCtx.lineCap = 'round';
    targetCtx.lineJoin = 'round';
    drawCatmullRom(targetCtx, pts, 0.5);
    targetCtx.restore();
    labelMarkers.forEach((marker, index) => {
      const routeIndex = nearestPointIndex(pts, marker.x, marker.y);
      const normal = outwardNormalForPoint(pts, routeIndex, marker.x, marker.y);
      drawWaypointMarker(targetCtx, marker, theme, index, controls, normal, pts);
    });
  }

  function renderStep2TrackPreview() {
    if (!step2TrackPreviewCanvas || !step2TrackPlaceholder) return;
    const s2 = step2TrackPreviewCanvas.getContext('2d');
    if (!currentState) {
      step2TrackPreviewCanvas.hidden = true;
      step2TrackPlaceholder.hidden = false;
      return;
    }
    step2TrackPlaceholder.hidden = true;
    step2TrackPreviewCanvas.hidden = false;
    s2.clearRect(0, 0, CANVAS_W, CANVAS_H);
    const geo = computeRouteGeometry();
    if (geo) drawTrackOverlayLayers(s2, geo);
  }

  // ---------- Rendering ----------
  function render() {
    if (!currentState) return;
    const theme = themes[currentTheme];
    const W = CANVAS_W, H = CANVAS_H;

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, theme.bg1);
    grad.addColorStop(1, theme.bg2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Soft topographic contour rings (decorative)
    ctx.save();
    ctx.strokeStyle = theme.contour;
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
      ctx.fillStyle = theme.paperGrain;
      const x = Math.random() * W;
      const y = Math.random() * H;
      ctx.fillRect(x, y, 1.2, 1.2);
    }
    ctx.restore();

    const geo = computeRouteGeometry();
    if (geo) drawTrackOverlayLayers(ctx, geo);

    // Top text block
    drawTopBlock(ctx, theme);

    // Bottom stats block
    drawBottomBlock(ctx, theme);

    // Outer frame
    ctx.save();
    ctx.strokeStyle = theme.ink;
    ctx.globalAlpha = 0.10;
    ctx.lineWidth = 4;
    ctx.strokeRect(40, 40, W - 80, H - 80);
    ctx.restore();

    updateAIDescription();
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

  function drawWaypointMarker(ctx, marker, theme, index, controls = getPosterControls(), normal = null, routePoints = null) {
    const side = index % 2 === 0 ? 'right' : 'left';
    const markerRadius = (controls.lineWidth * controls.pointScale) / 2;
    ctx.save();
    ctx.fillStyle = theme.line;
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, markerRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawTrackLabel(ctx, marker, theme, side, controls, normal, routePoints);
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
  function computeTrackLabelLayout(marker, theme, side, controls, normal, routePoints, measureCtx) {
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
      color: theme.line,
    };
  }

  function drawTrackLabel(ctx, marker, theme, side, controls = getPosterControls(), normal = null, routePoints = null) {
    const layout = computeTrackLabelLayout(marker, theme, side, controls, normal, routePoints, ctx);
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
    statOriginal.textContent = state.original.toLocaleString('ru-RU');
    statThinned.textContent = state.thinned.length.toLocaleString('ru-RU');
    const km = state.distance / 1000;
    statDistance.textContent = (km < 10 ? km.toFixed(2) : km.toFixed(1)) + ' км';
    const { minLat, maxLat, minLon, maxLon } = state.bbox;
    // Width/height in km
    const wKm = haversine(minLat, minLon, minLat, maxLon) / 1000;
    const hKm = haversine(minLat, minLon, maxLat, minLon) / 1000;
    statBbox.textContent = wKm.toFixed(1) + ' × ' + hKm.toFixed(1) + ' км';
  }

  /**
   * Geometry of the route overlay in poster canvas space (same as render()).
   * GPX is not included — another model can redraw from this spec only.
   */
  function buildCanvasTrackSpec(measureCtx) {
    if (!currentState || !measureCtx) return null;
    const geo = computeRouteGeometry();
    if (!geo) return null;
    const { pts, controls, theme, labelMarkers } = geo;
    const W = CANVAS_W;
    const H = CANVAS_H;
    const vertices = pts.map((p) => ({ x: roundPx(p.x), y: roundPx(p.y) }));
    const lineWidth = controls.lineWidth;
    const markerRadius = roundPx((lineWidth * controls.pointScale) / 2);

    const markers = [];

    labelMarkers.forEach((marker, index) => {
      const routeIndex = nearestPointIndex(pts, marker.x, marker.y);
      const normal = outwardNormalForPoint(pts, routeIndex, marker.x, marker.y);
      const side = index % 2 === 0 ? 'right' : 'left';
      const dot = {
        cx: roundPx(marker.x),
        cy: roundPx(marker.y),
        r: markerRadius,
        fill: theme.line,
      };
      const layout = computeTrackLabelLayout(marker, theme, side, controls, normal, pts, measureCtx);
      const label = layout
        ? {
            fontSize: layout.fontSize,
            fontWeight: layout.fontWeight,
            fontFamily: layout.fontFamily,
            color: layout.color,
            lines: layout.lines.map((text, i) => ({
              text,
              x: roundPx(layout.textX),
              y: roundPx(layout.firstLineY + i * layout.lineHeight),
            })),
          }
        : null;
      markers.push({ dot, label });
    });

    return {
      canvas: { width: W, height: H },
      track: {
        vertices,
        stroke: theme.line,
        lineWidth,
        lineCap: 'round',
        lineJoin: 'round',
        curve: {
          type: 'Catmull-Rom (Cardinal) spline through every vertex, tension 0.5',
          implementation:
            'Each segment between consecutive vertices is drawn as one cubic Bézier: for points p0,p1,p2,p3 (with endpoints duplicated at ends), cp1 = p1 + (p2-p0)/6 * tension*2, cp2 = p2 - (p3-p1)/6 * tension*2, tension=0.5 — same as reference canvas path using bezierCurveTo.',
        },
      },
      markers,
    };
  }

  function formatCanvasTrackPrompt(spec) {
    const { canvas, track, markers } = spec;
    const out = [];
    out.push(
      'Задача: сгенерировать изображение ТОЛЬКО с маршрутом (линия), кругами на точках подписей и текстовыми подписями.',
      `Холст: ${canvas.width}×${canvas.height} px, вертикальная ориентация. Начало координат — левый верхний угол, ось X вправо, ось Y вниз. Все числа в пикселях.`,
      '',
      'GPX и географические координаты недоступны — воспроизведи геометрию строго по данным ниже.',
      '',
      'Не добавляй: фон (градиент, текстуры, «бумага»), декоративные контуры, заголовок, нижний блок статистики, внешнюю рамку, тень/ореол вокруг линии (достаточно одной обводки указанной толщины). Прозрачный фон или сплошной нейтральный однотон — на выбор, остальное пустое.',
      '',
      '=== Линия трека ===',
      `Цвет обводки: ${track.stroke}. Толщина: ${track.lineWidth} px. lineCap: ${track.lineCap}, lineJoin: ${track.lineJoin}.`,
      `Кривая: ${track.curve.type}.`,
      `Построение: ${track.curve.implementation}`,
      '',
      `Вершины кривой по порядку (${track.vertices.length} шт., координаты центра линии в px):`,
      JSON.stringify(track.vertices),
      '',
      '=== Точки и подписи (каждая строка подписи — fillText, textAlign left, textBaseline middle; x,y — якорь как в canvas) ===',
    );

    if (markers.length === 0) {
      out.push('(нет подписей на треке — только линия)');
    } else {
      markers.forEach((m, i) => {
        out.push('', `Маркер ${i + 1}:`, `  круг: ${JSON.stringify(m.dot)}`);
        if (m.label && m.label.lines.length) {
          out.push(
            `  шрифт: ${m.label.fontWeight} ${m.label.fontSize}px ${m.label.fontFamily}, цвет ${m.label.color}`,
          );
          m.label.lines.forEach((line, lineIndex) => {
            out.push(`  строка ${lineIndex + 1}: ${JSON.stringify(line.text)} — x=${line.x}, y=${line.y}`);
          });
        } else {
          out.push('  подпись: (пустой текст — только круг)');
        }
      });
    }

    return out.join('\n');
  }

  function updateAIDescription() {
    if (!currentState) {
      aiDescription.value =
        'Загрузите GPX в шаге 1 — здесь появится промпт: координаты линии, точек и подписей на холсте 1080×1920 (без GPX).';
      updateStep2Controls();
      renderStep2TrackPreview();
      return;
    }
    const spec = buildCanvasTrackSpec(ctx);
    aiDescription.value = spec ? formatCanvasTrackPrompt(spec) : '';
    updateStep2Controls();
    renderStep2TrackPreview();
  }

  function updateStep2Controls() {
    const hasTrack = Boolean(currentState);
    if (downloadTransparentPngBtn) {
      downloadTransparentPngBtn.disabled = !hasTrack;
    }
    if (downloadPromptBtn) {
      const text = (aiDescription.value || '').trim();
      downloadPromptBtn.disabled = !hasTrack || !text;
    }
  }

  function downloadPromptAsFile() {
    const text = (aiDescription.value || '').trim();
    if (!text || !currentState) return;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const base =
      (currentState.fileName || 'gpx-track').replace(/[^\wа-яА-Я\-_. ]+/g, '').trim() || 'gpx-track';
    a.download = base + '-prompt.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    return String(rounded).replace('.', ',');
  }

  function resetDefaultLabels() {
    waypointList.textContent = '';
    if (!currentState) return;
    addWaypointRow('Старт', '0', '0', '0', false);
    addWaypointRow('Финиш', formatKm(currentState.distance / 1000), '0', '0', false);
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
    nameInput.placeholder = 'Текст';
    nameInput.value = name;
    nameInput.setAttribute('aria-label', 'Текст подписи');

    const distanceInput = document.createElement('input');
    distanceInput.type = 'text';
    distanceInput.className = 'waypoint-distance';
    distanceInput.inputMode = 'decimal';
    distanceInput.pattern = '[0-9]+([\\.,][0-9]+)?';
    distanceInput.placeholder = 'км';
    distanceInput.value = distanceKm;
    distanceInput.setAttribute('aria-label', 'Расстояние от старта в километрах');

    const offsetXInput = document.createElement('input');
    offsetXInput.type = 'text';
    offsetXInput.className = 'waypoint-offset-x';
    offsetXInput.inputMode = 'decimal';
    offsetXInput.pattern = '-?[0-9]+([\\.,][0-9]+)?';
    offsetXInput.placeholder = 'X';
    offsetXInput.value = offsetX;
    offsetXInput.setAttribute('aria-label', 'Смещение подписи по горизонтали в пикселях');

    const offsetYInput = document.createElement('input');
    offsetYInput.type = 'text';
    offsetYInput.className = 'waypoint-offset-y';
    offsetYInput.inputMode = 'decimal';
    offsetYInput.pattern = '-?[0-9]+([\\.,][0-9]+)?';
    offsetYInput.placeholder = 'Y';
    offsetYInput.value = offsetY;
    offsetYInput.setAttribute('aria-label', 'Смещение подписи по вертикали в пикселях');

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-waypoint';
    removeBtn.setAttribute('aria-label', 'Удалить подпись на треке');
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
      else updateAIDescription();
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
    const { scrollToResults = true, suppressError = false } = opts;
    clearError();
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.gpx') && file.type !== 'application/gpx+xml' && file.type !== 'text/xml' && file.type !== 'application/xml') {
      showError('Похоже, это не GPX-файл. Загрузите файл с расширением .gpx.');
      return;
    }
    if (file.size === 0) {
      showError('Файл пустой. Загрузите GPX с хотя бы двумя точками.');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      showError('Файл слишком большой (больше 50 МБ). Уменьшите размер GPX.');
      return;
    }
    const generation = ++fileIngestGeneration;
    try {
      const text = await file.text();
      if (!text.trim()) {
        showError('Файл пустой или содержит только пробелы.');
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

      resetDefaultLabels();
      updateStatsPanel(currentState);
      render();
      results.hidden = false;
      if (scrollToResults) {
        results.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (err) {
      console.error(err);
      if (!suppressError) {
        showError(err.message || 'Не удалось обработать файл. Попробуйте другой GPX.');
      }
    }
  }

  async function loadSampleTrack(options = {}) {
    const { quiet = false } = options;
    const scrollToResults = !quiet;
    const suppressError = quiet;
    if (!quiet) {
      clearError();
      sampleBtn.disabled = true;
    }
    const previousText = quiet ? '' : sampleBtn.textContent;
    if (!quiet) sampleBtn.textContent = 'Загружаю sample.gpx…';
    try {
      const response = await fetch('sample.gpx?v=20260514-8');
      if (!response.ok) {
        throw new Error('Не удалось загрузить пример sample.gpx.');
      }
      const blob = await response.blob();
      const file = new File([blob], 'sample.gpx', { type: 'application/gpx+xml' });
      await handleFile(file, { scrollToResults, suppressError });
      titleInput.value = 'Evening Mountain Bike Ride';
      if (currentState) {
        minDistanceInput.value = '180';
        minDistanceOutput.textContent = '180';
        updateThinning();
        waypointList.textContent = '';
        addWaypointRow('Старт', '0', '0', '0', false);
        addWaypointRow('ТЦ Галерея', '5,4', '0', '0', false);
        addWaypointRow('Пивски\nзабавник', '9,1', '240', '-200', false);
        addWaypointRow('Финиш', formatKm(currentState.distance / 1000), '0', '0', false);
        render();
      }
    } catch (err) {
      console.error(err);
      if (!quiet) {
        showError('Не удалось загрузить пример sample.gpx. Попробуйте обновить страницу.');
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

  if (downloadPromptBtn) {
    downloadPromptBtn.addEventListener('click', downloadPromptAsFile);
  }
  if (downloadTransparentPngBtn) {
    downloadTransparentPngBtn.addEventListener('click', () => {
      void downloadTransparentTrackPng();
    });
  }

  resetBtn.addEventListener('click', () => {
    currentState = null;
    results.hidden = true;
    clearError();
    titleInput.value = '';
    labelFontSelect.value = 'montserrat';
    labelSizeInput.value = '48';
    labelSizeOutput.textContent = '48';
    lineWidthInput.value = '14';
    lineWidthOutput.textContent = '14';
    pointScaleInput.value = '3';
    pointScaleOutput.textContent = '3';
    minDistanceInput.value = '50';
    minDistanceOutput.textContent = '50';
    waypointList.textContent = '';
    updateAIDescription();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  [titleInput].forEach((input) => input.addEventListener('input', () => {
    if (currentState) render();
    else updateAIDescription();
  }));

  labelFontSelect.addEventListener('change', async () => {
    const controls = getPosterControls();
    if (document.fonts && controls.labelFontKey !== 'georgia') {
      await document.fonts.load(`${controls.labelSize}px ${controls.labelFontFamily}`).catch(() => {});
    }
    if (currentState) render();
    else updateAIDescription();
  });

  labelSizeInput.addEventListener('input', () => {
    labelSizeOutput.textContent = labelSizeInput.value;
    if (currentState) render();
    else updateAIDescription();
  });

  lineWidthInput.addEventListener('input', () => {
    lineWidthOutput.textContent = lineWidthInput.value;
    if (currentState) render();
    else updateAIDescription();
  });

  pointScaleInput.addEventListener('input', () => {
    pointScaleOutput.textContent = pointScaleInput.value;
    if (currentState) render();
    else updateAIDescription();
  });

  minDistanceInput.addEventListener('input', () => {
    minDistanceOutput.textContent = minDistanceInput.value;
    if (currentState) updateThinning();
    else updateAIDescription();
  });

  addWaypointBtn.addEventListener('click', () => addWaypointRow());

  waypointList.addEventListener('input', (e) => {
    if (e.target.matches('.waypoint-name, .waypoint-distance, .waypoint-offset-x, .waypoint-offset-y')) {
      if (currentState) render();
      else updateAIDescription();
    }
  });

  waypointList.addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-waypoint');
    if (!btn) return;
    btn.closest('.waypoint-row').remove();
    if (currentState) render();
    else updateAIDescription();
  });

  updateAIDescription();
  themeGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    const theme = btn.dataset.theme;
    const VALID_THEMES = new Set(['paper', 'night', 'forest']);
    if (!theme || theme === currentTheme || !VALID_THEMES.has(theme)) return;
    currentTheme = theme;
    [...themeGroup.querySelectorAll('.seg-btn')].forEach((b) => {
      b.classList.toggle('is-active', b === btn);
      b.setAttribute('aria-checked', b === btn ? 'true' : 'false');
    });
    if (currentState) render();
    else updateAIDescription();
  });

  void loadSampleTrack({ quiet: true });
})();
