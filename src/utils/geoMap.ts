import { useEffect, useState } from 'react';
import JSZip from 'jszip';
import { KmlOverlayLine, WbNodeRecord } from '../types';

export interface GeoBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface ProjectedViewport {
  boxX: number;
  boxY: number;
  boxW: number;
  boxH: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  project: (lat: number, lon: number) => { x: number; y: number };
}

// Web Mercator normalized [0..1]
export function latLonToNorm(lat: number, lon: number): { nx: number; ny: number } {
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const nx = (lon + 180) / 360;
  const sinLat = Math.sin((clampedLat * Math.PI) / 180);
  const ny = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
  return { nx, ny };
}

export function normToLatLon(nx: number, ny: number): { lat: number; lon: number } {
  const lon = nx * 360 - 180;
  const n = Math.PI - 2 * Math.PI * ny;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lon };
}

export function buildGeoViewport(
  points: Array<{ lat: number; lon: number }>,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  padFrac = 0.12
): ProjectedViewport {
  const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (valid.length === 0) {
    const center = latLonToNorm(23.705, 90.435);
    return {
      boxX,
      boxY,
      boxW,
      boxH,
      minX: center.nx - 0.0001,
      maxX: center.nx + 0.0001,
      minY: center.ny - 0.0001,
      maxY: center.ny + 0.0001,
      project: () => ({ x: boxX + boxW / 2, y: boxY + boxH / 2 }),
    };
  }

  let rawMinX = Infinity;
  let rawMaxX = -Infinity;
  let rawMinY = Infinity;
  let rawMaxY = -Infinity;

  for (const p of valid) {
    const { nx, ny } = latLonToNorm(p.lat, p.lon);
    if (nx < rawMinX) rawMinX = nx;
    if (nx > rawMaxX) rawMaxX = nx;
    if (ny < rawMinY) rawMinY = ny;
    if (ny > rawMaxY) rawMaxY = ny;
  }

  const dx = Math.max(1e-6, rawMaxX - rawMinX);
  const dy = Math.max(1e-6, rawMaxY - rawMinY);

  // Add padding around points
  const padX = dx * padFrac;
  const padY = dy * padFrac;
  const pMinX = rawMinX - padX;
  const pMaxX = rawMaxX + padX;
  const pMinY = rawMinY - padY;
  const pMaxY = rawMaxY + padY;

  const spanX = pMaxX - pMinX;
  const spanY = pMaxY - pMinY;
  const targetAspect = boxW / Math.max(1, boxH);
  const dataAspect = spanX / spanY;

  let minX = pMinX;
  let maxX = pMaxX;
  let minY = pMinY;
  let maxY = pMaxY;

  if (dataAspect > targetAspect) {
    const targetSpanY = spanX / targetAspect;
    const extraY = (targetSpanY - spanY) / 2;
    minY -= extraY;
    maxY += extraY;
  } else {
    const targetSpanX = spanY * targetAspect;
    const extraX = (targetSpanX - spanX) / 2;
    minX -= extraX;
    maxX += extraX;
  }

  const finalSpanX = maxX - minX;
  const finalSpanY = maxY - minY;

  return {
    boxX,
    boxY,
    boxW,
    boxH,
    minX,
    maxX,
    minY,
    maxY,
    project: (lat: number, lon: number) => {
      const { nx, ny } = latLonToNorm(lat, lon);
      return {
        x: boxX + ((nx - minX) / finalSpanX) * boxW,
        y: boxY + ((ny - minY) / finalSpanY) * boxH,
      };
    },
  };
}

export interface WbPolylineSplit {
  prevPoints: Array<{ lat: number; lon: number }>;
  currPoints: Array<{ lat: number; lon: number }>;
  remainingPoints: Array<{ lat: number; lon: number }>;
  tipPoint: { lat: number; lon: number; chainageM: number };
}

function interpolatePointAtChainage(
  nodes: WbNodeRecord[],
  targetM: number
): { lat: number; lon: number; segIdx: number } {
  if (nodes.length === 0) return { lat: 23.715, lon: 90.43, segIdx: 0 };
  if (targetM <= 0 || nodes.length === 1) {
    return { lat: nodes[0].lat, lon: nodes[0].lon, segIdx: 0 };
  }
  const last = nodes[nodes.length - 1];
  if (targetM >= last.chainageM) {
    return { lat: last.lat, lon: last.lon, segIdx: nodes.length - 1 };
  }
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    if (targetM >= a.chainageM && targetM <= b.chainageM) {
      const span = b.chainageM - a.chainageM;
      const t = span > 1e-6 ? (targetM - a.chainageM) / span : 0;
      return {
        lat: a.lat + (b.lat - a.lat) * t,
        lon: a.lon + (b.lon - a.lon) * t,
        segIdx: i,
      };
    }
  }
  return { lat: last.lat, lon: last.lon, segIdx: nodes.length - 1 };
}

function sliceNodesBetween(
  nodes: WbNodeRecord[],
  startM: number,
  endM: number
): Array<{ lat: number; lon: number }> {
  if (nodes.length === 0 || endM < startM) return [];
  const startPt = interpolatePointAtChainage(nodes, startM);
  const endPt = interpolatePointAtChainage(nodes, endM);
  const out: Array<{ lat: number; lon: number }> = [
    { lat: startPt.lat, lon: startPt.lon },
  ];
  for (const n of nodes) {
    if (n.chainageM > startM && n.chainageM < endM) {
      out.push({ lat: n.lat, lon: n.lon });
    }
  }
  out.push({ lat: endPt.lat, lon: endPt.lon });
  return out;
}

export function computeWbPolylineSplit(
  nodes: WbNodeRecord[],
  totalLengthM: number,
  completedLengthM: number,
  prevCompletedLengthM?: number
): WbPolylineSplit {
  if (nodes.length === 0) {
    return {
      prevPoints: [],
      currPoints: [],
      remainingPoints: [],
      tipPoint: { lat: 23.715, lon: 90.43, chainageM: 0 },
    };
  }
  const maxCh = nodes[nodes.length - 1].chainageM || totalLengthM || 1;
  const clampedCur = Math.max(0, Math.min(maxCh, completedLengthM));
  const clampedPrev =
    prevCompletedLengthM !== undefined
      ? Math.max(0, Math.min(clampedCur, prevCompletedLengthM))
      : clampedCur;

  const tip = interpolatePointAtChainage(nodes, clampedCur);

  const prevPoints =
    clampedPrev > 0 ? sliceNodesBetween(nodes, 0, clampedPrev) : [];
  const currPoints =
    clampedCur > clampedPrev
      ? sliceNodesBetween(nodes, clampedPrev, clampedCur)
      : [];
  const remainingPoints =
    clampedCur < maxCh ? sliceNodesBetween(nodes, clampedCur, maxCh) : [];

  return {
    prevPoints,
    currPoints,
    remainingPoints,
    tipPoint: { lat: tip.lat, lon: tip.lon, chainageM: clampedCur },
  };
}

/**
 * Fetches CORS-safe CartoDB navigation street tiles covering `viewport`
 * and bakes them into an inline PNG data URI for crisp SVG + A1 PDF output.
 */
const tileCache = new Map<string, string>();
const tilePromises = new Map<string, Promise<string | null>>();

export function getTileCacheKey(
  viewport: ProjectedViewport,
  style: 'voyager' | 'light' | 'cad',
  outW: number,
  outH: number
): string {
  return `${style}|${viewport.minX.toFixed(6)}|${viewport.maxX.toFixed(6)}|${viewport.minY.toFixed(6)}|${viewport.maxY.toFixed(6)}|${outW}x${outH}`;
}

export async function ensureMapTileSnapshot(
  viewport: ProjectedViewport,
  style: 'voyager' | 'light' | 'cad',
  outW = 900,
  outH = 640
): Promise<string | null> {
  if (style === 'cad') return null;
  const key = getTileCacheKey(viewport, style, outW, outH);
  const existing = tileCache.get(key);
  if (existing) return existing;
  const inflight = tilePromises.get(key);
  if (inflight) return inflight;

  const p = (async () => {
    try {
      const spanX = Math.max(1e-7, viewport.maxX - viewport.minX);
      let z = Math.round(Math.log2(outW / (256 * spanX)));
      z = Math.max(12, Math.min(17, z));

      const worldPx = 256 * Math.pow(2, z);
      const txMin = Math.floor((viewport.minX * worldPx) / 256);
      const txMax = Math.floor((viewport.maxX * worldPx) / 256);
      const tyMin = Math.floor((viewport.minY * worldPx) / 256);
      const tyMax = Math.floor((viewport.maxY * worldPx) / 256);

      if ((txMax - txMin + 1) * (tyMax - tyMin + 1) > 42) {
        z = Math.max(12, z - 1);
      }

      const nTiles = Math.pow(2, z);
      const wPx = 256 * nTiles;
      const xStart = viewport.minX * wPx;
      const xEnd = viewport.maxX * wPx;
      const yStart = viewport.minY * wPx;
      const yEnd = viewport.maxY * wPx;

      const tX0 = Math.floor(xStart / 256);
      const tX1 = Math.floor(xEnd / 256);
      const tY0 = Math.floor(yStart / 256);
      const tY1 = Math.floor(yEnd / 256);

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, outW, outH);

      const jobs: Promise<void>[] = [];
      let loadedAny = false;

      for (let tx = tX0; tx <= tX1; tx++) {
        for (let ty = tY0; ty <= tY1; ty++) {
          const wrappedX = ((tx % nTiles) + nTiles) % nTiles;
          if (ty < 0 || ty >= nTiles) continue;
          const url =
            style === 'light'
              ? `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/${z}/${ty}/${wrappedX}`
              : `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${ty}/${wrappedX}`;
          jobs.push(
            new Promise<void>((resolve) => {
              const img = new Image();
              img.crossOrigin = 'anonymous';
              const timer = setTimeout(() => resolve(), 5500);
              img.onload = () => {
                clearTimeout(timer);
                const tileWorldX = tx * 256;
                const tileWorldY = ty * 256;
                const dx = ((tileWorldX - xStart) / (xEnd - xStart)) * outW;
                const dy = ((tileWorldY - yStart) / (yEnd - yStart)) * outH;
                const dw = (256 / (xEnd - xStart)) * outW;
                const dh = (256 / (yEnd - yStart)) * outH;
                ctx.drawImage(img, dx, dy, dw + 0.6, dh + 0.6);
                loadedAny = true;
                resolve();
              };
              img.onerror = () => {
                clearTimeout(timer);
                resolve();
              };
              img.src = url;
            })
          );
        }
      }

      await Promise.all(jobs);
      if (loadedAny) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.fillRect(0, 0, outW, outH);
        const url = canvas.toDataURL('image/png');
        tileCache.set(key, url);
        return url;
      }
      return null;
    } catch {
      return null;
    } finally {
      tilePromises.delete(key);
    }
  })();

  tilePromises.set(key, p);
  return p;
}

export function useMapTileSnapshot(
  viewport: ProjectedViewport,
  enabled: boolean,
  style: 'voyager' | 'light' | 'cad',
  outW = 900,
  outH = 640
): string | null {
  const key = getTileCacheKey(viewport, style, outW, outH);
  const [dataUrl, setDataUrl] = useState<string | null>(() =>
    enabled && style !== 'cad' ? tileCache.get(key) || null : null
  );

  useEffect(() => {
    if (!enabled || style === 'cad') {
      setDataUrl(null);
      return;
    }
    const cached = tileCache.get(key);
    if (cached) {
      setDataUrl(cached);
      return;
    }

    let cancelled = false;
    ensureMapTileSnapshot(viewport, style, outW, outH).then((url) => {
      if (!cancelled && url) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [key, enabled, style, outW, outH, viewport]);

  return dataUrl;
}

export interface ParsedKmlResult {
  points: Array<{ name: string; lat: number; lon: number }>;
  lines: KmlOverlayLine[];
}

function parseKmlCoordString(raw: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const tokens = raw.trim().split(/\s+/);
  for (const tok of tokens) {
    const parts = tok.split(',');
    if (parts.length >= 2) {
      const lon = Number(parts[0]);
      const lat = Number(parts[1]);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        out.push([lat, lon]);
      }
    }
  }
  return out;
}

export async function parseKmlOrKmzOrCsvFile(file: File): Promise<ParsedKmlResult> {
  const lower = file.name.toLowerCase();

  // Support CSV too (Name,Latitude,Longitude)
  if (lower.endsWith('.csv')) {
    const text = (await file.text()).replace(/^\uFEFF/, '');
    const rows = text.split(/\r?\n/).filter((l) => l.trim());
    const points: Array<{ name: string; lat: number; lon: number }> = [];
    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i].split(',').map((c) => c.trim());
      if (cols.length >= 3) {
        const lat = Number(cols[1]);
        const lon = Number(cols[2]);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          points.push({ name: cols[0], lat, lon });
        }
      }
    }
    return {
      points,
      lines:
        points.length >= 2
          ? [{ name: file.name, coords: points.map((p) => [p.lat, p.lon]) }]
          : [],
    };
  }

  let kmlText = '';
  if (lower.endsWith('.kmz')) {
    const buf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    const kmlEntry =
      zip.file('doc.kml') ||
      Object.values(zip.files).find((f) => f.name.toLowerCase().endsWith('.kml'));
    if (!kmlEntry) {
      throw new Error('No KML found inside KMZ archive');
    }
    kmlText = await kmlEntry.async('text');
  } else {
    kmlText = await file.text();
  }

  const doc = new DOMParser().parseFromString(kmlText, 'text/xml');
  const placemarks = Array.from(doc.getElementsByTagName('Placemark'));
  const points: Array<{ name: string; lat: number; lon: number }> = [];
  const lines: KmlOverlayLine[] = [];

  for (const pm of placemarks) {
    const nameEl = pm.getElementsByTagName('name')[0];
    const pmName = nameEl?.textContent?.trim() || 'Point';

    const ptCoords = pm.getElementsByTagName('Point');
    for (let i = 0; i < ptCoords.length; i++) {
      const cText = ptCoords[i].getElementsByTagName('coordinates')[0]?.textContent || '';
      const parsed = parseKmlCoordString(cText);
      if (parsed.length > 0) {
        points.push({ name: pmName, lat: parsed[0][0], lon: parsed[0][1] });
      }
    }

    const lsCoords = pm.getElementsByTagName('LineString');
    for (let i = 0; i < lsCoords.length; i++) {
      const cText = lsCoords[i].getElementsByTagName('coordinates')[0]?.textContent || '';
      const parsed = parseKmlCoordString(cText);
      if (parsed.length >= 2) {
        lines.push({ name: pmName, coords: parsed });
      }
    }
  }

  return { points, lines };
}
