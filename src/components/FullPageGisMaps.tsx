import React, { useMemo } from 'react';
import {
  GOLAPBAG_SPS_COORD,
  INITIAL_WA_GEO_NODES,
} from '../data/wbcInitialData';
import {
  AppState,
  ShaftRecord,
  ShaftSnapshotItem,
  WorkStatus,
} from '../types';
import {
  computeSummary,
  formatDateDisplay,
  getCastingStatus,
  getManholeStatus,
  getRingStatus,
  getShaftStatus,
  getTunnelStatus,
  resolveDisplayContext,
} from '../utils/calculations';
import {
  buildGeoViewport,
  computeMetersPerSvgUnit,
  computeWbPolylineSplit,
  formatDms,
  ProjectedViewport,
  useMapTileSnapshot,
  xToLon,
  yToLat,
} from '../utils/geoMap';

export const FULL_MAP_FRAME = {
  x: 50,
  y: 74,
  w: 1582,
  h: 1076,
  padRatio: 0.085,
  tileOutW: 1600,
  tileOutH: 1088,
};

type MapKind = 'wa-map' | 'wb-map' | 'wc-map';

interface FullPageGisMapProps {
  kind: MapKind;
  state: AppState;
  svgRef: React.Ref<SVGSVGElement>;
  selectedShaftId?: string;
  onSelectShaft?: (id: string, focus?: 'shaft' | 'manhole' | 'tunnel') => void;
  onSelectWbNode?: (id: string) => void;
}

const SHEET_W = 1682;
const SHEET_H = 1188;

// Symbology colors aligned with WA-WB-Construction-progress-15nov.pdf
const GIS_GREEN = '#16a34a';
const GIS_GREEN_DARK = '#14532d';
const GIS_BLUE = '#2563eb';
const GIS_BLUE_DARK = '#1e3a8a';
const GIS_RED = '#dc2626';
const GIS_RED_DARK = '#7f1d1d';
const GIS_HIGHLIGHT = '#f59e0b';

function statusStroke(st: WorkStatus): string {
  if (st === 'complete') return GIS_GREEN;
  if (st === 'ongoing') return GIS_BLUE;
  return GIS_RED;
}

function statusDarkStroke(st: WorkStatus): string {
  if (st === 'complete') return GIS_GREEN_DARK;
  if (st === 'ongoing') return GIS_BLUE_DARK;
  return GIS_RED_DARK;
}

/**
 * Dual-text white halo compatible with svg2pdf.js (avoids CSS paintOrder issues).
 */
const HaloText: React.FC<{
  x: number;
  y: number;
  text: string;
  fontSize?: number;
  fontWeight?: string;
  fill?: string;
  haloColor?: string;
  haloWidth?: number;
  textAnchor?: 'start' | 'middle' | 'end';
  fontStyle?: string;
}> = ({
  x,
  y,
  text,
  fontSize = 8.4,
  fontWeight = '700',
  fill = '#0f172a',
  haloColor = '#ffffff',
  haloWidth = 3.2,
  textAnchor = 'start',
  fontStyle,
}) => (
  <g>
    <text
      x={x}
      y={y}
      textAnchor={textAnchor}
      fontSize={fontSize}
      fontWeight={fontWeight}
      fontStyle={fontStyle}
      fill={haloColor}
      stroke={haloColor}
      strokeWidth={haloWidth}
      strokeLinejoin="round"
    >
      {text}
    </text>
    <text
      x={x}
      y={y}
      textAnchor={textAnchor}
      fontSize={fontSize}
      fontWeight={fontWeight}
      fontStyle={fontStyle}
      fill={fill}
    >
      {text}
    </text>
  </g>
);

interface RectBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function boxesOverlap(a: RectBox, b: RectBox, margin = 2): boolean {
  return !(
    a.x1 + margin < b.x0 ||
    b.x1 + margin < a.x0 ||
    a.y1 + margin < b.y0 ||
    b.y1 + margin < a.y0
  );
}

interface PlacedLabel {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  leaderNeeded: boolean;
}

function resolveSmartLabel(
  ptX: number,
  ptY: number,
  label: string,
  fontSize: number,
  occupied: RectBox[],
  bounds: RectBox,
  preferredSide: 'right' | 'left' | 'top' | 'bottom' = 'right',
  nodeDotRadius = 8
): PlacedLabel {
  const estW = Math.max(22, label.length * fontSize * 0.58 + 4);
  const estH = fontSize + 3;

  const baseOffsets: Array<[number, number, 'start' | 'middle' | 'end']> = [
          [-(nodeDotRadius + 5), 3, 'end'],
          [0, -(nodeDotRadius + 5), 'middle'],
          [0, nodeDotRadius + estH + 1, 'middle'],
          [nodeDotRadius + 16, -12, 'start'],
          [-(nodeDotRadius + 16), 14, 'end'],
          [nodeDotRadius + 24, 14, 'start'],
          [-(nodeDotRadius + 24), -12, 'end'],
          [nodeDotRadius + 34, -2, 'start'],
          [-(nodeDotRadius + 34), -2, 'end'],
          [nodeDotRadius + 22, -24, 'start'],
          [-(nodeDotRadius + 22), 26, 'end'],
          [nodeDotRadius + 36, 22, 'start'],
          [-(nodeDotRadius + 36), -22, 'end'],
        ];

  if (preferredSide === 'left') {
    baseOffsets.splice(
      0,
      baseOffsets.length,
      [-(nodeDotRadius + 5), 3, 'end'],
      [nodeDotRadius + 5, 3, 'start'],
      [0, -(nodeDotRadius + 5), 'middle'],
      [0, nodeDotRadius + estH + 1, 'middle'],
      [-(nodeDotRadius + 16), -12, 'end'],
      [nodeDotRadius + 16, 14, 'start'],
      [-(nodeDotRadius + 24), 14, 'end'],
      [nodeDotRadius + 24, -12, 'start'],
      [-(nodeDotRadius + 34), -2, 'end'],
      [nodeDotRadius + 34, -2, 'start'],
      [-(nodeDotRadius + 22), -24, 'end'],
      [nodeDotRadius + 22, 26, 'start'],
      [-(nodeDotRadius + 36), 22, 'end'],
      [nodeDotRadius + 36, -22, 'start']
    );
  } else if (preferredSide === 'top') {
    baseOffsets.splice(
      0,
      baseOffsets.length,
      [0, -(nodeDotRadius + 5), 'middle'],
      [0, nodeDotRadius + estH + 1, 'middle'],
      [nodeDotRadius + 5, 3, 'start'],
      [-(nodeDotRadius + 5), 3, 'end'],
      [nodeDotRadius + 14, -14, 'start'],
      [-(nodeDotRadius + 14), -14, 'end'],
      [nodeDotRadius + 24, 16, 'start'],
      [-(nodeDotRadius + 24), 16, 'end'],
      [0, -(nodeDotRadius + 22), 'middle'],
      [0, nodeDotRadius + estH + 18, 'middle'],
      [nodeDotRadius + 32, -26, 'start'],
      [-(nodeDotRadius + 32), 26, 'end']
    );
  } else if (preferredSide === 'bottom') {
    baseOffsets.splice(
      0,
      baseOffsets.length,
      [0, nodeDotRadius + estH + 1, 'middle'],
      [0, -(nodeDotRadius + 5), 'middle'],
      [nodeDotRadius + 5, 3, 'start'],
      [-(nodeDotRadius + 5), 3, 'end'],
      [nodeDotRadius + 16, 16, 'start'],
      [-(nodeDotRadius + 16), 16, 'end'],
      [nodeDotRadius + 24, -14, 'start'],
      [-(nodeDotRadius + 24), -14, 'end'],
      [0, nodeDotRadius + estH + 20, 'middle'],
      [0, -(nodeDotRadius + 22), 'middle']
    );
  }

  const makeBox = (dx: number, dy: number, anchor: 'start' | 'middle' | 'end'): RectBox => {
    const lx = ptX + dx;
    const ly = ptY + dy;
    const x0 = anchor === 'start' ? lx : anchor === 'end' ? lx - estW : lx - estW / 2;
    const x1 = x0 + estW;
    return { x0, y0: ly - estH + 2, x1, y1: ly + 2 };
  };

  for (let i = 0; i < baseOffsets.length; i++) {
    const [dx, dy, anchor] = baseOffsets[i];
    const box = makeBox(dx, dy, anchor);
    if (
      box.x0 < bounds.x0 + 4 ||
      box.x1 > bounds.x1 - 4 ||
      box.y0 < bounds.y0 + 4 ||
      box.y1 > bounds.y1 - 4
    ) {
      continue;
    }
    const collides = occupied.some((o) => boxesOverlap(box, o));
    if (!collides) {
      occupied.push(box);
      return {
        x: ptX + dx,
        y: ptY + dy,
        anchor,
        leaderNeeded: i >= 4,
      };
    }
  }

  // Spiral fallback scan if cluster is tight (e.g. WB1-4, WB35-38)
  for (let dist = 28; dist <= 64; dist += 12) {
    for (let deg = 0; deg < 360; deg += 45) {
      const rad = (deg * Math.PI) / 180;
      const dx = Math.round(Math.cos(rad) * dist);
      const dy = Math.round(Math.sin(rad) * dist);
      const anchor: 'start' | 'middle' | 'end' = dx > 6 ? 'start' : dx < -6 ? 'end' : 'middle';
      const box = makeBox(dx, dy, anchor);
      if (
        box.x0 < bounds.x0 + 4 ||
        box.x1 > bounds.x1 - 4 ||
        box.y0 < bounds.y0 + 4 ||
        box.y1 > bounds.y1 - 4
      ) {
        continue;
      }
      if (!occupied.some((o) => boxesOverlap(box, o))) {
        occupied.push(box);
        return { x: ptX + dx, y: ptY + dy, anchor, leaderNeeded: true };
      }
    }
  }

  const [dx, dy, anchor] = baseOffsets[0];
  occupied.push(makeBox(dx, dy, anchor));
  return {
    x: ptX + dx,
    y: ptY + dy,
    anchor,
    leaderNeeded: false,
  };
}

function renderCompassRose(cx: number, cy: number, r = 34) {
  const inner = r * 0.27;
  return (
    <g transform={`translate(${cx}, ${cy})`}>
      <circle
        cx={0}
        cy={0}
        r={r + 12}
        fill="#ffffff"
        fillOpacity={0.86}
        stroke="#cbd5e1"
        strokeWidth={0.8}
      />
      {/* N / S / E / W star arms (black left/top halves, white right/bottom halves like reference PDF) */}
      {/* North point */}
      <polygon points={`0,${-r} 0,0 ${-inner},${-inner}`} fill="#0f172a" stroke="#0f172a" strokeWidth={0.7} />
      <polygon points={`0,${-r} ${inner},${-inner} 0,0`} fill="#ffffff" stroke="#0f172a" strokeWidth={0.7} />
      {/* South point */}
      <polygon points={`0,${r} 0,0 ${inner},${inner}`} fill="#0f172a" stroke="#0f172a" strokeWidth={0.7} />
      <polygon points={`0,${r} ${-inner},${inner} 0,0`} fill="#ffffff" stroke="#0f172a" strokeWidth={0.7} />
      {/* East point */}
      <polygon points={`${r},0 0,0 ${inner},${-inner}`} fill="#0f172a" stroke="#0f172a" strokeWidth={0.7} />
      <polygon points={`${r},0 ${inner},${inner} 0,0`} fill="#ffffff" stroke="#0f172a" strokeWidth={0.7} />
      {/* West point */}
      <polygon points={`${-r},0 0,0 ${-inner},${inner}`} fill="#0f172a" stroke="#0f172a" strokeWidth={0.7} />
      <polygon points={`${-r},0 ${-inner},${-inner} 0,0`} fill="#ffffff" stroke="#0f172a" strokeWidth={0.7} />
      {/* Minor diagonal arms */}
      <polygon points={`${r * 0.56},${-r * 0.56} ${inner},0 0,${-inner}`} fill="#475569" fillOpacity={0.35} stroke="#475569" strokeWidth={0.4} />
      <polygon points={`${-r * 0.56},${-r * 0.56} 0,${-inner} ${-inner},0`} fill="#475569" fillOpacity={0.35} stroke="#475569" strokeWidth={0.4} />
      <polygon points={`${r * 0.56},${r * 0.56} 0,${inner} ${inner},0`} fill="#475569" fillOpacity={0.35} stroke="#475569" strokeWidth={0.4} />
      <polygon points={`${-r * 0.56},${r * 0.56} ${-inner},0 0,${inner}`} fill="#475569" fillOpacity={0.35} stroke="#475569" strokeWidth={0.4} />

      <text x={0} y={-(r + 3)} textAnchor="middle" fontSize={10.5} fontWeight="800" fill="#0f172a">
        N
      </text>
      <text x={0} y={r + 10} textAnchor="middle" fontSize={8.0} fontWeight="700" fill="#334155">
        S
      </text>
      <text x={r + 6} y={3} textAnchor="start" fontSize={8.0} fontWeight="700" fill="#334155">
        E
      </text>
      <text x={-(r + 6)} y={3} textAnchor="end" fontSize={8.0} fontWeight="700" fill="#334155">
        W
      </text>
    </g>
  );
}

function renderScaleBarAndAttribution(
  vp: ProjectedViewport,
  rightEdgeX: number,
  bottomEdgeY: number,
  sheetLabel: string,
  settingsDwg: string,
  contractorRep: string
) {
  const mPerSvg = computeMetersPerSvgUnit(vp);
  // Pick the clean decimal km bar closest to 240 SVG units for true geographic scale
  const candidatesKm = [0.2, 0.4, 0.5, 0.8, 1.0, 1.5, 2.0, 3.0];
  let chosenKm = 0.5;
  let bestDiff = Infinity;
  for (const c of candidatesKm) {
    const px = (c * 1000) / mPerSvg;
    const diff = Math.abs(px - 245);
    if (px >= 130 && px <= 330 && diff < bestDiff) {
      bestDiff = diff;
      chosenKm = c;
    }
  }
  const barW = Math.min(340, Math.max(130, (chosenKm * 1000) / mPerSvg));
  const segCount = 4; // 0, 1/4, 1/2, 1/1 stops
  const qW = barW / segCount;

  const cardW = Math.max(barW + 86, 365);
  const cardH = 54;
  const cx = rightEdgeX - cardW;
  const cy = bottomEdgeY - cardH;

  const barX = cx + 14;
  const barY = cy + 20;

  return (
    <g>
      <rect
        x={cx}
        y={cy}
        width={cardW}
        height={cardH}
        rx={3}
        fill="#ffffff"
        fillOpacity={0.93}
        stroke="#64748b"
        strokeWidth={0.8}
      />

      {/* Scale tick labels */}
      {[
        { frac: 0, lbl: '0' },
        { frac: 0.25, lbl: `${(chosenKm * 0.25).toFixed(3).replace(/\.?0+$/, '')}` },
        { frac: 0.5, lbl: `${(chosenKm * 0.5).toFixed(3).replace(/\.?0+$/, '')}` },
        { frac: 1, lbl: `${chosenKm.toFixed(3).replace(/\.?0+$/, '')}` },
      ].map((t) => (
        <text
          key={t.frac}
          x={barX + barW * t.frac}
          y={barY - 4}
          textAnchor="middle"
          fontSize={8.0}
          fontWeight="700"
          fill="#0f172a"
        >
          {t.lbl}
        </text>
      ))}
      <text
        x={barX + barW + 8}
        y={barY + 6}
        fontSize={8.0}
        fontWeight="700"
        fill="#0f172a"
      >
        Kilometers
      </text>

      {/* Alternating Black / White Scale Bar */}
      <rect
        x={barX}
        y={barY}
        width={qW}
        height={7}
        fill="#0f172a"
        stroke="#0f172a"
        strokeWidth={0.7}
      />
      <rect
        x={barX + qW}
        y={barY}
        width={qW}
        height={7}
        fill="#ffffff"
        stroke="#0f172a"
        strokeWidth={0.7}
      />
      <rect
        x={barX + qW * 2}
        y={barY}
        width={qW * 2}
        height={7}
        fill="#0f172a"
        stroke="#0f172a"
        strokeWidth={0.7}
      />

      {/* Attribution & Dwg Ref */}
      <text x={barX} y={cy + 39} fontSize={6.5} fill="#475569">
        Sources: Esri, TomTom, Garmin, FAO, NOAA, USGS, OpenStreetMap contributors
      </text>
      <text x={barX} y={cy + 49} fontSize={6.8} fontWeight="700" fill="#1e3a8a">
        {sheetLabel} | {settingsDwg} | Contractor Rep: {contractorRep}
      </text>
    </g>
  );
}

function renderGraticuleTicks(vp: ProjectedViewport) {
  const { x: mx, y: my, w: mw, h: mh } = FULL_MAP_FRAME;
  const lonMin = xToLon(vp.minX);
  const lonMax = xToLon(vp.maxX);
  const latMax = yToLat(vp.minY);
  const latMin = yToLat(vp.maxY);

  const lonFracs = [0.14, 0.38, 0.62, 0.86];
  const latFracs = [0.16, 0.42, 0.68, 0.88];

  return (
    <g>
      {lonFracs.map((f, i) => {
        const px = mx + mw * f;
        const lonVal = lonMin + (lonMax - lonMin) * f;
        const lbl = formatDms(lonVal, 'E', 'W');
        return (
          <g key={`lon-${i}`}>
            <line x1={px} y1={my - 5} x2={px} y2={my} stroke="#1e293b" strokeWidth={1.0} />
            <line x1={px} y1={my + mh} x2={px} y2={my + mh + 5} stroke="#1e293b" strokeWidth={1.0} />
            <text x={px} y={my + mh + 15} textAnchor="middle" fontSize={8.2} fontWeight="600" fill="#334155">
              {lbl}
            </text>
          </g>
        );
      })}
      {latFracs.map((f, i) => {
        const py = my + mh * f;
        const latVal = latMax - (latMax - latMin) * f;
        const lbl = formatDms(latVal, 'N', 'S');
        return (
          <g key={`lat-${i}`}>
            <line x1={mx - 5} y1={py} x2={mx} y2={py} stroke="#1e293b" strokeWidth={1.0} />
            <line x1={mx + mw} y1={py} x2={mx + mw + 5} y2={py} stroke="#1e293b" strokeWidth={1.0} />
            <text
              x={mx - 10}
              y={py + 3}
              textAnchor="middle"
              fontSize={8.2}
              fontWeight="600"
              fill="#334155"
              transform={`rotate(-90, ${mx - 10}, ${py})`}
            >
              {lbl}
            </text>
            <text
              x={mx + mw + 16}
              y={py + 3}
              textAnchor="middle"
              fontSize={8.2}
              fontWeight="600"
              fill="#334155"
              transform={`rotate(90, ${mx + mw + 16}, ${py})`}
            >
              {lbl}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function formatWaMapNodeId(id: string): string {
  const m = id.match(/^WA-(\d+)(\.\d+)?$/i);
  if (!m) return id.replace('-', ' ');
  const num = Number(m[1]);
  const suf = m[2] || '';
  return `WA ${num < 10 ? '0' + num : num}${suf}`;
}

function getDeltaProgressBadge(
  s: ShaftRecord,
  bSnap?: ShaftSnapshotItem
): { hasNewLayer: boolean; hasNewMh: boolean; hasNewTunnel: boolean } {
  if (!bSnap) return { hasNewLayer: false, hasNewMh: false, hasNewTunnel: false };
  const addedL = s.layerFlags.reduce(
    (acc, f, idx) => acc + (f && !bSnap.layerFlags?.[idx] ? 1 : 0),
    0
  );
  const hasNewMh =
    s.castingPct > (bSnap.castingPct ?? 0) || s.precastPct > (bSnap.precastPct ?? 0);
  const hasNewTunnel = s.tunnelPct > (bSnap.tunnelPct ?? 0);
  return { hasNewLayer: addedL > 0, hasNewMh, hasNewTunnel };
}

export const FullPageGisMapSheet: React.FC<FullPageGisMapProps> = ({
  kind,
  state,
  svgRef,
  selectedShaftId,
  onSelectShaft,
  onSelectWbNode,
}) => {
  const { settings, viewMode } = state;
  const {
    displayShafts: waShafts,
    displayPump: pumpStation,
    displayWb: wbData,
    displayWc: wcData,
    baseline,
    file1Label,
    file2Label,
  } = resolveDisplayContext(state);

  const waSummary = computeSummary(
    waShafts,
    baseline,
    pumpStation,
    undefined,
    settings.waTunnelDiaTotalsM
  );
  const wcSummary = computeSummary(wcData.shafts, baseline, undefined, baseline.wcShafts);

  const { x: mapX, y: mapY, w: mapW, h: mapH, padRatio, tileOutW, tileOutH } =
    FULL_MAP_FRAME;

  // Build projected viewport strictly per map kind
  const viewport = useMemo(() => {
    if (kind === 'wa-map') {
      return buildGeoViewport(
        [...INITIAL_WA_GEO_NODES, GOLAPBAG_SPS_COORD],
        mapX,
        mapY,
        mapW,
        mapH,
        padRatio
      );
    }
    if (kind === 'wb-map') {
      return buildGeoViewport(wbData.nodes, mapX, mapY, mapW, mapH, padRatio);
    }
    return buildGeoViewport(wcData.geoNodes, mapX, mapY, mapW, mapH, padRatio);
  }, [kind, wbData.nodes, wcData.geoNodes, mapX, mapY, mapW, mapH, padRatio]);

  const tileDataUrl = useMapTileSnapshot(
    viewport,
    settings.showMapBackground,
    settings.mapStyle,
    tileOutW,
    tileOutH
  );

  const clipId = `full-gis-clip-${kind}`;
  const mapBounds: RectBox = {
    x0: mapX + 6,
    y0: mapY + 6,
    x1: mapX + mapW - 6,
    y1: mapY + mapH - 6,
  };

  // Title & Header texts matching WA-WB-Construction-progress-15nov.pdf
  const mapTitle =
    kind === 'wa-map'
      ? 'Construction Progress Map: WA Shaft, Micro-Tunneling & Manhole'
      : kind === 'wb-map'
      ? 'Construction Progress Map: WB Open-Cut Pipeline (DN1200 GRP)'
      : 'Construction Progress Map: WC Shaft, Micro-Tunneling & Manhole';

  const sheetNoLabel =
    kind === 'wa-map'
      ? 'Sheet 2 of 5 (A1)'
      : kind === 'wb-map'
      ? 'Sheet 3 of 5 (A1)'
      : 'Sheet 4 of 5 (A1)';

  const periodText =
    viewMode === 'weekly'
      ? `WEEKLY COMPARISON: ${file1Label} -> ${file2Label}`
      : viewMode === 'monthly'
      ? `MONTHLY COMPARISON: ${file1Label} -> ${file2Label}`
      : 'OVERALL CONSTRUCTION STATUS';

  const wbPrevCompletedM =
    viewMode === 'overall' ? undefined : baseline.wbCompletedLengthM;

  // Reserved regions (Legend card, Compass rose, Scale bar) so node/landmark labels NEVER collide with UI cards
  const legendBox: RectBox =
    kind === 'wb-map'
      ? { x0: mapX + 12, y0: mapY + 124, x1: mapX + 332, y1: mapY + 465 }
      : { x0: mapX + 12, y0: mapY + mapH - 472, x1: mapX + 356, y1: mapY + mapH - 12 };

  const compassBox: RectBox =
    kind === 'wb-map'
      ? { x0: mapX + 20, y0: mapY + 14, x1: mapX + 135, y1: mapY + 116 }
      : { x0: mapX + mapW - 115, y0: mapY + 12, x1: mapX + mapW - 10, y1: mapY + 112 };

  const scaleBox: RectBox = {
    x0: mapX + mapW - 390,
    y0: mapY + mapH - 68,
    x1: mapX + mapW - 8,
    y1: mapY + mapH - 8,
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${SHEET_W} ${SHEET_H}`}
      className="w-full h-auto bg-white select-none"
      style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={mapX} y={mapY} width={mapW} height={mapH} />
        </clipPath>
      </defs>

      {/* Outer ISO A1 Landscape Page Background & Sheet Border */}
      <rect x={0} y={0} width={SHEET_W} height={SHEET_H} fill="#ffffff" />
      <rect x={12} y={12} width={SHEET_W - 24} height={SHEET_H - 24} fill="none" stroke="#0f172a" strokeWidth={1.3} />

      {/* Top Cartographic Title Banner */}
      <rect x={16} y={16} width={SHEET_W - 32} height={52} fill="#f8fafc" stroke="#cbd5e1" strokeWidth={0.7} />

      <text x={32} y={36} fontSize={9.5} fontWeight="700" fill="#1e3a8a">
        {sheetNoLabel}
      </text>
      <text x={32} y={50} fontSize={8.2} fontWeight="600" fill="#475569">
        {settings.drawingNo} ({settings.revision})
      </text>

      <text x={675} y={36} textAnchor="middle" fontSize={18.0} fontWeight="700" fill="#0f172a">
        {mapTitle}
      </text>
      <text x={675} y={55} textAnchor="middle" fontSize={10.8} fontWeight="600" fill="#334155">
        Dhaka Sanitation Improvement Project (DSIP) | {settings.sectionTitle} — As of {formatDateDisplay(settings.reportDate)}
      </text>

      <rect
        x={SHEET_W - 552}
        y={23}
        width={526}
        height={36}
        rx={4}
        fill={viewMode === 'weekly' ? '#fffbeb' : viewMode === 'monthly' ? '#ecfeff' : '#f0fdf4'}
        stroke={viewMode === 'weekly' ? '#d97706' : viewMode === 'monthly' ? '#0891b2' : '#16a34a'}
        strokeWidth={1.0}
      />
      <text x={SHEET_W - 289} y={39} textAnchor="middle" fontSize={7.8} fontWeight="700" fill="#0f172a">
        {periodText}
      </text>
      <text x={SHEET_W - 289} y={52} textAnchor="middle" fontSize={7.0} fontWeight="600" fill="#475569">
        Client: {settings.clientName} | {settings.contractorName}
      </text>

      {/* Geographic Neatline & Lat/Lon Graticule Ticks */}
      {renderGraticuleTicks(viewport)}

      {/* Map Canvas Background */}
      <rect x={mapX} y={mapY} width={mapW} height={mapH} fill="#f1f5f9" />

      {/* CLIPPED MAP INTERIOR */}
      <g clipPath={`url(#${clipId})`}>
        {tileDataUrl ? (
          <image
            href={tileDataUrl}
            x={mapX}
            y={mapY}
            width={mapW}
            height={mapH}
            preserveAspectRatio="none"
          />
        ) : (
          <g>
            {Array.from({ length: 12 }).map((_, gi) => {
              const gx = mapX + ((gi + 1) / 13) * mapW;
              const gy = mapY + ((gi + 1) / 13) * mapH;
              return (
                <g key={gi}>
                  <line x1={gx} y1={mapY} x2={gx} y2={mapY + mapH} stroke="#cbd5e1" strokeWidth={0.6} strokeDasharray="4,4" />
                  <line x1={mapX} y1={gy} x2={mapX + mapW} y2={gy} stroke="#cbd5e1" strokeWidth={0.6} strokeDasharray="4,4" />
                </g>
              );
            })}
          </g>
        )}

        {/* ================================================================ */}
        {/* PAGE 2: WA PROGRESS MAP                                          */}
        {/* ================================================================ */}
        {kind === 'wa-map' && (() => {
          const shaftById = new Map<string, ShaftRecord>();
          for (const s of waShafts) shaftById.set(s.id, s);

          const occupied: RectBox[] = [legendBox, compassBox, scaleBox];
          const geoById = new Map(INITIAL_WA_GEO_NODES.map((g) => [g.id, g]));
          const spsPt = viewport.project(GOLAPBAG_SPS_COORD.lat, GOLAPBAG_SPS_COORD.lon);

          // Pre-register every WA square node marker & SPS box in occupied so labels NEVER overlap markers!
          for (const gNode of INITIAL_WA_GEO_NODES) {
            const p = viewport.project(gNode.lat, gNode.lon);
            occupied.push({ x0: p.x - 9, y0: p.y - 9, x1: p.x + 9, y1: p.y + 9 });
          }
          occupied.push({
            x0: spsPt.x - 14,
            y0: spsPt.y - 14,
            x1: spsPt.x + 14,
            y1: spsPt.y + 14,
          });

          // Administrative Zone annotations inspired by WA_WB_WC_Map.pdf (Page 2)
          const zonePtDncc = viewport.project(23.7568, 90.4152);
          const zonePtDscc = viewport.project(23.7398, 90.4310);

          // Landmarks from WA_WB_WC_Map.pdf mapped to exact WA corridor reference nodes
          const waLandmarks: Array<{
            nodeId: string;
            label: string;
            side: 'left' | 'right' | 'top';
          }> = [
            { nodeId: 'WA-1', label: 'Mirbag (Start WA-01)', side: 'left' },
            { nodeId: 'WA-12', label: 'Moulovirtek (Rampura)', side: 'left' },
            { nodeId: 'WA-14', label: 'Sipahibag Moor', side: 'right' },
            { nodeId: 'WA-18', label: 'Goran Tempo Stand', side: 'left' },
            { nodeId: 'WA-22', label: 'East Bashaboo', side: 'left' },
            { nodeId: 'WA-23', label: 'Chayabithy', side: 'right' },
            { nodeId: 'WA-27', label: 'North Mugdapara', side: 'right' },
            { nodeId: 'WA-28', label: 'Mugdapara-Maniknogor Bridge', side: 'left' },
            { nodeId: 'WA-35', label: 'City Corp. Adarsha School', side: 'left' },
          ];

          return (
            <g>
              {/* Zone Context Watermark Badges */}
              <HaloText
                x={zonePtDncc.x - 16}
                y={zonePtDncc.y + 40}
                text="DNCC ZONE 03"
                fontSize={12}
                fontWeight="800"
                fill="#475569"
                haloWidth={4}
                textAnchor="middle"
              />
              <HaloText
                x={zonePtDscc.x - 82}
                y={zonePtDscc.y}
                text="DSCC ZONE 02"
                fontSize={12}
                fontWeight="800"
                fill="#475569"
                haloWidth={4}
                textAnchor="middle"
              />

              {/* Micro-tunneling alignment lines WA-i -> WA-(i+1) & WA-36 -> SPS */}
              {INITIAL_WA_GEO_NODES.map((gNode, idx) => {
                const p1 = viewport.project(gNode.lat, gNode.lon);
                const nextGeo =
                  idx < INITIAL_WA_GEO_NODES.length - 1
                    ? INITIAL_WA_GEO_NODES[idx + 1]
                    : GOLAPBAG_SPS_COORD;
                const p2 = viewport.project(nextGeo.lat, nextGeo.lon);
                const sh = shaftById.get(gNode.id);
                const mtStatus = sh ? getTunnelStatus(sh) : 'remaining';
                const col = statusStroke(mtStatus);
                const deltaInfo = sh
                  ? getDeltaProgressBadge(sh, baseline.shafts[sh.id])
                  : { hasNewLayer: false, hasNewMh: false, hasNewTunnel: false };

                return (
                  <g key={`wa-seg-${gNode.id}`}>
                    <line
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                      stroke="#ffffff"
                      strokeWidth={7.8}
                      strokeLinecap="round"
                    />
                    <line
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                      stroke={col}
                      strokeWidth={4.8}
                      strokeLinecap="round"
                    />
                    {viewMode !== 'overall' && deltaInfo.hasNewTunnel && (
                      <line
                        x1={p1.x}
                        y1={p1.y}
                        x2={p2.x}
                        y2={p2.y}
                        stroke={GIS_HIGHLIGHT}
                        strokeWidth={2.4}
                        strokeDasharray="6,4"
                        strokeLinecap="round"
                      />
                    )}
                  </g>
                );
              })}

              {/* Golapbag SPS Building Box Marker (pink/green box like reference PDF) */}
              <g>
                <rect
                  x={spsPt.x - 13}
                  y={spsPt.y - 13}
                  width={26}
                  height={26}
                  rx={2}
                  fill="#fbcfe8"
                  stroke="#9d174d"
                  strokeWidth={2.2}
                />
                <text x={spsPt.x} y={spsPt.y + 3.2} textAnchor="middle" fontSize={7.5} fontWeight="800" fill="#831843">
                  SPS
                </text>
              </g>

              {/* WA Shaft + Manhole Nodes & Non-Overlapping Labels */}
              {INITIAL_WA_GEO_NODES.map((gNode, idx) => {
                const pt = viewport.project(gNode.lat, gNode.lon);
                const sh = shaftById.get(gNode.id);
                const shStatus = sh ? getShaftStatus(sh) : 'remaining';
                const mhStatus = sh ? getManholeStatus(sh) : 'remaining';
                const castSt = sh ? getCastingStatus(sh) : 'remaining';
                const ringSt = sh ? getRingStatus(sh) : 'remaining';
                const isSel = selectedShaftId === gNode.id;

                const outerCol = statusStroke(shStatus);
                // Inner circle dot: Green if MH Complete (Cast & Ring 100%), Blue if Cast complete or MH ongoing, Red if Remaining
                const innerCol =
                  mhStatus === 'complete'
                    ? GIS_GREEN
                    : castSt === 'complete' || mhStatus === 'ongoing'
                    ? GIS_BLUE
                    : GIS_RED;

                const deltaInfo = sh
                  ? getDeltaProgressBadge(sh, baseline.shafts[sh.id])
                  : { hasNewLayer: false, hasNewMh: false, hasNewTunnel: false };

                // Directional hint matching WA's curve for ultra-clean spacing
                const prefSide: 'left' | 'right' | 'top' =
                  idx <= 5
                    ? idx % 2 === 0
                      ? 'top'
                      : 'right'
                    : idx <= 13
                    ? idx % 2 === 0
                      ? 'left'
                      : 'right'
                    : idx % 2 === 0
                    ? 'right'
                    : 'left';

                const dispName = formatWaMapNodeId(gNode.id);
                const lblPos = resolveSmartLabel(
                  pt.x,
                  pt.y,
                  dispName,
                  8.5,
                  occupied,
                  mapBounds,
                  prefSide,
                  9
                );

                return (
                  <g
                    key={gNode.id}
                    style={{ cursor: onSelectShaft ? 'pointer' : 'default' }}
                    onClick={() => onSelectShaft?.(gNode.id, 'shaft')}
                  >
                    {viewMode !== 'overall' && (deltaInfo.hasNewLayer || deltaInfo.hasNewMh) && (
                      <rect
                        x={pt.x - 10.5}
                        y={pt.y - 10.5}
                        width={21}
                        height={21}
                        rx={3}
                        fill="none"
                        stroke={GIS_HIGHLIGHT}
                        strokeWidth={2.0}
                      />
                    )}
                    {isSel && (
                      <rect
                        x={pt.x - 11.5}
                        y={pt.y - 11.5}
                        width={23}
                        height={23}
                        rx={3}
                        fill="none"
                        stroke="#0284c7"
                        strokeWidth={2.2}
                      />
                    )}

                    {/* Outer Square = Shaft Status (matching 15nov_p1.png) */}
                    <rect
                      x={pt.x - 7.5}
                      y={pt.y - 7.5}
                      width={15}
                      height={15}
                      fill="#ffffff"
                      stroke={outerCol}
                      strokeWidth={2.5}
                    />
                    {/* Inner Circle Dot = Manhole Status (matching 15nov_p1.png) */}
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={4.0}
                      fill={innerCol}
                      stroke={ringSt === 'ongoing' ? '#0ea5e9' : '#ffffff'}
                      strokeWidth={0.9}
                    />

                    {lblPos.leaderNeeded && (
                      <line
                        x1={pt.x}
                        y1={pt.y}
                        x2={lblPos.x}
                        y2={lblPos.y - 2}
                        stroke="#475569"
                        strokeWidth={0.7}
                      />
                    )}
                    <HaloText
                      x={lblPos.x}
                      y={lblPos.y}
                      text={dispName}
                      fontSize={8.5}
                      fontWeight="700"
                      fill="#0f172a"
                      haloWidth={3.2}
                      textAnchor={lblPos.anchor}
                    />
                  </g>
                );
              })}

              {/* Extra Reference Landmark Callouts (from WA_WB_WC_Map.pdf) */}
              {waLandmarks.map((lm) => {
                const g = geoById.get(lm.nodeId);
                if (!g) return null;
                const pt = viewport.project(g.lat, g.lon);
                const offX = lm.side === 'right' ? 68 : -68;
                const pos = resolveSmartLabel(
                  pt.x + offX,
                  pt.y,
                  lm.label,
                  7.8,
                  occupied,
                  mapBounds,
                  lm.side === 'right' ? 'right' : 'left',
                  4
                );
                return (
                  <g key={`wa-lm-${lm.nodeId}`}>
                    <line
                      x1={pt.x}
                      y1={pt.y}
                      x2={pos.x}
                      y2={pos.y - 2}
                      stroke="#64748b"
                      strokeWidth={0.65}
                      strokeDasharray="2,2"
                    />
                    <HaloText
                      x={pos.x}
                      y={pos.y}
                      text={lm.label}
                      fontSize={7.8}
                      fontWeight="600"
                      fontStyle="italic"
                      fill="#334155"
                      haloWidth={2.8}
                      textAnchor={pos.anchor}
                    />
                  </g>
                );
              })}

              {/* Prominent Golapbag SPS Label (placed smartly to avoid WA 36 & scale card) */}
              {(() => {
                const spsLblPos = resolveSmartLabel(
                  spsPt.x,
                  spsPt.y,
                  'Golapbag Pump Station (SPS)',
                  9.2,
                  occupied,
                  mapBounds,
                  'right',
                  16
                );
                return (
                  <HaloText
                    x={spsLblPos.x}
                    y={spsLblPos.y}
                    text="Golapbag Pump Station (SPS)"
                    fontSize={9.2}
                    fontWeight="800"
                    fill="#831843"
                    haloWidth={3.5}
                    textAnchor={spsLblPos.anchor}
                  />
                );
              })()}

              {/* WA Bottom-Left Frosted Legend & Summary Card (exact 15nov_p1.png style + v7 Cast/Ring breakdown) */}
              <g transform={`translate(${legendBox.x0}, ${legendBox.y0})`}>
                <rect
                  x={0}
                  y={0}
                  width={344}
                  height={460}
                  rx={4}
                  fill="#ffffff"
                  fillOpacity={0.94}
                  stroke="#1e293b"
                  strokeWidth={1.1}
                />
                <rect x={0} y={0} width={344} height={28} rx={4} fill="#eff6ff" stroke="#1e293b" strokeWidth={0.8} />
                <text x={14} y={19} fontSize={12.5} fontWeight="800" fill="#0f172a">
                  Legend — WA Section Progress
                </text>

                {/* Shaft Status */}
                <text x={14} y={48} fontSize={9.8} fontWeight="700" fill="#1e3a8a">
                  Shaft Status ({waSummary.totalShafts} Shafts)
                </text>
                {[
                  { label: `Complete (${waSummary.completedShafts})`, color: GIS_GREEN, y: 58 },
                  { label: `On-Going (${waSummary.ongoingShafts})`, color: GIS_BLUE, y: 79 },
                  { label: `Remaining (${waSummary.remainingShafts})`, color: GIS_RED, y: 100 },
                ].map((it) => (
                  <g key={it.label}>
                    <rect x={16} y={it.y} width={14} height={14} fill="#ffffff" stroke={it.color} strokeWidth={2.4} />
                    <text x={40} y={it.y + 11} fontSize={9.0} fontWeight="600" fill="#0f172a">
                      {it.label}
                    </text>
                  </g>
                ))}

                {/* Manhole Status */}
                <text x={14} y={136} fontSize={9.8} fontWeight="700" fill="#1e3a8a">
                  Manhole Status ({waSummary.totalManholes} Nos)
                </text>
                {[
                  { label: `Complete — Cast & Ring 100% (${waSummary.completedManholes})`, color: GIS_GREEN, y: 146 },
                  {
                    label: `Cast Done / On-Going (${Math.max(0, waSummary.castingCompleteCount + waSummary.castingOngoingCount - waSummary.completedManholes)})`,
                    color: GIS_BLUE,
                    y: 165,
                  },
                  { label: `Remaining (${waSummary.castingRemainingCount})`, color: GIS_RED, y: 184 },
                ].map((it) => (
                  <g key={it.label}>
                    <circle cx={23} cy={it.y + 6} r={5.2} fill={it.color} stroke="#ffffff" strokeWidth={0.8} />
                    <text x={40} y={it.y + 9.5} fontSize={8.7} fontWeight="600" fill="#0f172a">
                      {it.label}
                    </text>
                  </g>
                ))}
                <text x={16} y={208} fontSize={8.0} fontWeight="700" fill="#1d4ed8">
                  Cast: {waSummary.castingCompleteCount} Done | {waSummary.castingOngoingCount} Ong | {waSummary.castingRemainingCount} Rem
                </text>
                <text x={16} y={222} fontSize={8.0} fontWeight="700" fill="#0284c7">
                  Ring: {waSummary.precastCompleteCount} Done | {waSummary.precastOngoingCount} Ong | {waSummary.precastRemainingCount} Rem
                </text>

                {/* Micro-Tunneling Status */}
                <text x={14} y={244} fontSize={9.8} fontWeight="700" fill="#1e3a8a">
                  Micro-Tunneling Status
                </text>
                {[
                  { label: 'Complete', color: GIS_GREEN, y: 256 },
                  { label: 'On-Going', color: GIS_BLUE, y: 274 },
                  { label: 'Remaining', color: GIS_RED, y: 292 },
                ].map((it) => (
                  <g key={it.label}>
                    <line x1={16} y1={it.y + 4} x2={44} y2={it.y + 4} stroke={it.color} strokeWidth={4.2} strokeLinecap="round" />
                    <text x={54} y={it.y + 7.5} fontSize={8.8} fontWeight="600" fill="#0f172a">
                      {it.label}
                    </text>
                  </g>
                ))}

                {/* SPS Key Marker */}
                <rect x={198} y={254} width={14} height={14} fill="#fbcfe8" stroke="#9d174d" strokeWidth={1.6} />
                <text x={218} y={265} fontSize={8.5} fontWeight="700" fill="#831843">
                  Golapbag SPS
                </text>
                {viewMode !== 'overall' && (
                  <g>
                    <line x1={196} y1={282} x2={216} y2={282} stroke={GIS_HIGHLIGHT} strokeWidth={3.2} strokeDasharray="4,2" />
                    <text x={221} y={285} fontSize={8.0} fontWeight="700" fill="#b45309">
                      New Update ({file2Label})
                    </text>
                  </g>
                )}

                <line x1={12} y1={310} x2={332} y2={310} stroke="#cbd5e1" strokeWidth={0.9} />

                {/* Quantitative Pipe Lengths Table matching 15nov_p1.png */}
                <text x={14} y={328} fontSize={9.2} fontWeight="800" fill="#0f172a">
                  TOTAL LENGTH
                </text>
                <text x={330} y={328} textAnchor="end" fontSize={9.2} fontWeight="800" fill="#0f172a">
                  : {(waSummary.totalTunnelLengthM / 1000).toFixed(3)} km
                </text>
                <text x={14} y={345} fontSize={9.2} fontWeight="800" fill="#15803d">
                  COMPLETED LENGTH
                </text>
                <text x={330} y={345} textAnchor="end" fontSize={9.2} fontWeight="800" fill="#15803d">
                  : {(waSummary.completedTunnelLengthM / 1000).toFixed(3)} km ({waSummary.tunnelPctOverall.toFixed(1)}%)
                </text>

                <text x={14} y={365} fontSize={8.6} fontWeight="700" fill="#334155">
                  1. DN 900 ({(waSummary.byDia.DN900.totalM / 1000).toFixed(3)} km)
                </text>
                <text x={330} y={365} textAnchor="end" fontSize={8.6} fontWeight="700" fill="#0f172a">
                  Done: {(waSummary.byDia.DN900.completedM / 1000).toFixed(3)} km
                </text>
                <text x={14} y={381} fontSize={8.6} fontWeight="700" fill="#334155">
                  2. DN 1100 ({(waSummary.byDia.DN1100.totalM / 1000).toFixed(3)} km)
                </text>
                <text x={330} y={381} textAnchor="end" fontSize={8.6} fontWeight="700" fill="#0f172a">
                  Done: {(waSummary.byDia.DN1100.completedM / 1000).toFixed(3)} km
                </text>
                <text x={14} y={397} fontSize={8.6} fontWeight="700" fill="#334155">
                  3. DN 1600 ({(waSummary.byDia.DN1600.totalM / 1000).toFixed(3)} km)
                </text>
                <text x={330} y={397} textAnchor="end" fontSize={8.6} fontWeight="700" fill="#0f172a">
                  Done: {(waSummary.byDia.DN1600.completedM / 1000).toFixed(3)} km
                </text>

                {/* Golapbag SPS Status Pill */}
                <rect x={12} y={409} width={320} height={42} rx={3} fill="#f0fdf4" stroke="#16a34a" strokeWidth={0.8} />
                <text x={20} y={425} fontSize={8.2} fontWeight="700" fill="#166534">
                  Golapbag SPS: {pumpStation.layers.filter((l) => l.status === 'complete').length}/5 Lower (Cast: {pumpStation.castingCompleteM}m) | Room: {pumpStation.machineRoom.status.toUpperCase()}
                </text>
                <text x={20} y={441} fontSize={8.2} fontWeight="700" fill="#0f766e">
                  Sinking: {pumpStation.sinkingCompletedM}m / {pumpStation.totalHeightM}m [{pumpStation.sinkingStatus.toUpperCase()}
                  {pumpStation.sinkingStatus !== 'complete'
                    ? ` | Rem: ${Math.max(0, Number((pumpStation.totalHeightM - pumpStation.sinkingCompletedM).toFixed(2)))}m`
                    : ''}]
                </text>
              </g>

              {renderCompassRose(mapX + mapW - 60, mapY + 60, 34)}
            </g>
          );
        })()}

        {/* ================================================================ */}
        {/* PAGE 3: WB PROGRESS MAP                                          */}
        {/* ================================================================ */}
        {kind === 'wb-map' && (() => {
          const split = computeWbPolylineSplit(
            wbData.nodes,
            wbData.totalLengthM,
            wbData.completedLengthM,
            wbPrevCompletedM
          );
          const toPts = (pts: Array<{ lat: number; lon: number }>) =>
            pts
              .map((p) => {
                const pr = viewport.project(p.lat, p.lon);
                return `${pr.x.toFixed(1)},${pr.y.toFixed(1)}`;
              })
              .join(' ');

          const tipPt = viewport.project(split.tipPoint.lat, split.tipPoint.lon);
          const doneCount = wbData.nodes.filter((n) => n.status === 'complete').length;
          const ongCount = wbData.nodes.filter((n) => n.status === 'ongoing').length;
          const remCount = wbData.nodes.length - doneCount - ongCount;
          const wbRemM = Math.max(0, wbData.totalLengthM - wbData.completedLengthM);
          const wbPct = wbData.totalLengthM > 0 ? (wbData.completedLengthM / wbData.totalLengthM) * 100 : 0;

          const occupied: RectBox[] = [legendBox, compassBox, scaleBox];
          const spsPt = viewport.project(wbData.nodes[0]?.lat ?? 23.719516, wbData.nodes[0]?.lon ?? 90.432657);
          const wbById = new Map(wbData.nodes.map((n) => [n.id, n]));

          // Pre-register all WB squares, SPS box, and Done tip badge in occupied so labels NEVER overlap!
          for (const nd of wbData.nodes) {
            const p = viewport.project(nd.lat, nd.lon);
            occupied.push({ x0: p.x - 7.5, y0: p.y - 7.5, x1: p.x + 7.5, y1: p.y + 7.5 });
          }
          occupied.push({
            x0: spsPt.x - 16,
            y0: spsPt.y - 38,
            x1: spsPt.x + 34,
            y1: spsPt.y - 14,
          });
          // Tip badge sits cleanly to the RIGHT of tipPt (+26px) away from Dholpur/WB11
          occupied.push({
            x0: tipPt.x + 18,
            y0: tipPt.y - 11,
            x1: tipPt.x + 110,
            y1: tipPt.y + 11,
          });

          // Special valve/infrastructure symbols & landmarks from WA_WB_WC_Map.pdf Page 3
          const washoutNode = wbById.get('WB12');
          const airValveNode = wbById.get('WB35');
          const juncNode = wbById.get('WB38');

          const wbLandmarks: Array<{ id: string; label: string; dx: number; dy: number; side: 'left' | 'right' }> = [
            { id: 'WB8', label: 'Dhalpur Notun Rasta', dx: 74, dy: -6, side: 'right' },
            { id: 'WB17', label: 'Boubazar Road', dx: 68, dy: 4, side: 'right' },
            { id: 'WB24', label: 'Mayor Hanif Flyover', dx: 72, dy: 12, side: 'right' },
            { id: 'WB27', label: 'Ideal Road', dx: -68, dy: -16, side: 'left' },
            { id: 'WB32', label: 'Doyagonj Bazar Road', dx: 18, dy: 34, side: 'right' },
            { id: 'WB38', label: 'Doyagonj Chowrasta (Junc. WD2 & WD3)', dx: -24, dy: 28, side: 'left' },
          ];

          return (
            <g>
              {/* Custom KML Overlays if present */}
              {(wbData.customKmlLines || []).map((ln, li) => (
                <polyline
                  key={`wb-kml-${li}`}
                  points={ln.coords
                    .map(([la, lo]) => {
                      const p = viewport.project(la, lo);
                      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
                    })
                    .join(' ')}
                  fill="none"
                  stroke="#64748b"
                  strokeWidth={1.6}
                  strokeDasharray="4,3"
                />
              ))}

              {/* Remaining Segment (RED) */}
              {split.remainingPoints.length >= 2 && (
                <>
                  <polyline points={toPts(split.remainingPoints)} fill="none" stroke="#ffffff" strokeWidth={8.0} strokeLinecap="round" strokeLinejoin="round" />
                  <polyline points={toPts(split.remainingPoints)} fill="none" stroke={GIS_RED} strokeWidth={5.0} strokeLinecap="round" strokeLinejoin="round" />
                </>
              )}

              {/* Completed Segment (GREEN) */}
              {split.prevPoints.length >= 2 && (
                <>
                  <polyline points={toPts(split.prevPoints)} fill="none" stroke="#ffffff" strokeWidth={8.5} strokeLinecap="round" strokeLinejoin="round" />
                  <polyline points={toPts(split.prevPoints)} fill="none" stroke={GIS_GREEN} strokeWidth={5.6} strokeLinecap="round" strokeLinejoin="round" />
                </>
              )}

              {/* Comparison Added Segment Highlight */}
              {viewMode !== 'overall' && split.currPoints.length >= 2 && (
                <polyline
                  points={toPts(split.currPoints)}
                  fill="none"
                  stroke={GIS_HIGHLIGHT}
                  strokeWidth={6.0}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Golapbag SPS Pink Box above WB1..WB4 (matching 15nov_p2.png without covering nodes) */}
              <g>
                <rect
                  x={spsPt.x - 14}
                  y={spsPt.y - 36}
                  width={46}
                  height={20}
                  rx={2}
                  fill="#fbcfe8"
                  stroke="#9d174d"
                  strokeWidth={2.0}
                />
                <text x={spsPt.x + 9} y={spsPt.y - 23} textAnchor="middle" fontSize={8.5} fontWeight="800" fill="#831843">
                  SPS
                </text>
              </g>

              {/* Washout & Air Valve Infrastructure Markers from WA_WB_WC_Map.pdf Page 3 */}
              {washoutNode && (() => {
                const wp = viewport.project(washoutNode.lat, washoutNode.lon);
                const wPos = resolveSmartLabel(wp.x - 14, wp.y + 2, 'Washout', 7.8, occupied, mapBounds, 'left', 8);
                return (
                  <g>
                    <polygon points={`${wp.x - 14},${wp.y - 8} ${wp.x - 20},${wp.y + 3} ${wp.x - 8},${wp.y + 3}`} fill="#16a34a" stroke="#ffffff" strokeWidth={1.2} />
                    <HaloText x={wPos.x} y={wPos.y} text="Washout" fontSize={7.8} fontWeight="700" fill="#15803d" textAnchor={wPos.anchor} />
                  </g>
                );
              })()}
              {airValveNode && (() => {
                const ap = viewport.project(airValveNode.lat, airValveNode.lon);
                const aPos = resolveSmartLabel(ap.x, ap.y - 16, 'Air Valve', 7.8, occupied, mapBounds, 'top', 8);
                return (
                  <g>
                    <polygon points={`${ap.x},${ap.y - 20} ${ap.x - 6},${ap.y - 9} ${ap.x + 6},${ap.y - 9}`} fill="#0284c7" stroke="#ffffff" strokeWidth={1.2} />
                    <HaloText x={aPos.x} y={aPos.y} text="Air Valve" fontSize={7.8} fontWeight="700" fill="#0369a1" textAnchor={aPos.anchor} />
                  </g>
                );
              })()}
              {juncNode && (() => {
                const jp = viewport.project(juncNode.lat, juncNode.lon);
                return <circle cx={jp.x} cy={jp.y} r={9.5} fill="none" stroke="#9333ea" strokeWidth={2.2} />;
              })()}

              {/* WB1 .. WB38 Nodes & Smart De-Collided Labels */}
              {wbData.nodes.map((n, idx) => {
                const pt = viewport.project(n.lat, n.lon);
                const col = statusStroke(n.status);
                const isSel = selectedShaftId === n.id;
                const displayLbl = n.id.replace(/^WB(\d)$/i, 'WB0$1');

                // Strategic side preference for WB's North-South then East-West bend
                const prefSide: 'left' | 'right' | 'top' | 'bottom' =
                  idx <= 5
                    ? idx % 2 === 0
                      ? 'bottom'
                      : 'left'
                    : idx <= 26
                    ? idx % 2 === 0
                      ? 'left'
                      : 'right'
                    : idx % 2 === 0
                    ? 'top'
                    : 'bottom';

                const lblPos = resolveSmartLabel(
                  pt.x,
                  pt.y,
                  displayLbl,
                  8.0,
                  occupied,
                  mapBounds,
                  prefSide,
                  8
                );

                return (
                  <g
                    key={n.id}
                    style={{ cursor: onSelectWbNode ? 'pointer' : 'default' }}
                    onClick={() => onSelectWbNode?.(n.id)}
                  >
                    {isSel && (
                      <rect x={pt.x - 10} y={pt.y - 10} width={20} height={20} rx={3} fill="none" stroke="#0284c7" strokeWidth={2.2} />
                    )}
                    <rect
                      x={pt.x - 6.0}
                      y={pt.y - 6.0}
                      width={12}
                      height={12}
                      fill="#ffffff"
                      stroke={col}
                      strokeWidth={2.2}
                    />
                    <circle cx={pt.x} cy={pt.y} r={2.8} fill={col} />
                    {lblPos.leaderNeeded && (
                      <line x1={pt.x} y1={pt.y} x2={lblPos.x} y2={lblPos.y - 2} stroke="#475569" strokeWidth={0.65} />
                    )}
                    <HaloText
                      x={lblPos.x}
                      y={lblPos.y}
                      text={displayLbl}
                      fontSize={8.0}
                      fontWeight="700"
                      fill="#0f172a"
                      haloWidth={3.0}
                      textAnchor={lblPos.anchor}
                    />
                  </g>
                );
              })}

              {/* Prominent Blue Completion Tip Marker (placed cleanly to the right of tipPt) */}
              <g>
                <circle cx={tipPt.x} cy={tipPt.y} r={11} fill="#3b82f6" fillOpacity={0.28} />
                <circle cx={tipPt.x} cy={tipPt.y} r={6.5} fill={GIS_BLUE} stroke="#ffffff" strokeWidth={2.0} />
                <line x1={tipPt.x + 6} y1={tipPt.y} x2={tipPt.x + 20} y2={tipPt.y} stroke="#1e3a8a" strokeWidth={1.2} />
                <rect x={tipPt.x + 20} y={tipPt.y - 10} width={88} height={19} rx={3} fill="#1e3a8a" />
                <text x={tipPt.x + 64} y={tipPt.y + 3} textAnchor="middle" fontSize={8.0} fontWeight="700" fill="#ffffff">
                  Done: {wbData.completedLengthM.toFixed(1)} m
                </text>
              </g>

              {/* Corridor Landmark Callouts */}
              {wbLandmarks.map((lm) => {
                const nd = wbById.get(lm.id);
                if (!nd) return null;
                const pt = viewport.project(nd.lat, nd.lon);
                const pos = resolveSmartLabel(pt.x + lm.dx, pt.y + lm.dy, lm.label, 8.2, occupied, mapBounds, lm.side, 4);
                return (
                  <g key={`wb-lm-${lm.id}`}>
                    <line x1={pt.x} y1={pt.y} x2={pos.x} y2={pos.y - 2} stroke="#64748b" strokeWidth={0.65} strokeDasharray="2,2" />
                    <HaloText
                      x={pos.x}
                      y={pos.y}
                      text={lm.label}
                      fontSize={8.2}
                      fontWeight="700"
                      fontStyle="italic"
                      fill="#334155"
                      haloWidth={3.0}
                      textAnchor={pos.anchor}
                    />
                  </g>
                );
              })}

              {/* Top-Left Compass Rose + Legend Card matching 15nov_p2.png */}
              {renderCompassRose(mapX + 76, mapY + 62, 34)}

              <g transform={`translate(${legendBox.x0}, ${legendBox.y0})`}>
                <rect
                  x={0}
                  y={0}
                  width={320}
                  height={338}
                  rx={4}
                  fill="#ffffff"
                  fillOpacity={0.94}
                  stroke="#1e293b"
                  strokeWidth={1.1}
                />
                <rect x={0} y={0} width={320} height={28} rx={4} fill="#eff6ff" stroke="#1e293b" strokeWidth={0.8} />
                <text x={14} y={19} fontSize={12.5} fontWeight="800" fill="#0f172a">
                  Legend — WB Section Progress
                </text>

                <text x={14} y={48} fontSize={9.8} fontWeight="700" fill="#1e3a8a">
                  WB Node Status ({wbData.nodes.length} Nodes)
                </text>
                {[
                  { label: `Complete (${doneCount})`, color: GIS_GREEN, y: 58 },
                  { label: `On-Going (${ongCount})`, color: GIS_BLUE, y: 78 },
                  { label: `Remaining (${remCount})`, color: GIS_RED, y: 98 },
                ].map((it) => (
                  <g key={it.label}>
                    <rect x={16} y={it.y} width={13} height={13} fill="#ffffff" stroke={it.color} strokeWidth={2.3} />
                    <circle cx={22.5} cy={it.y + 6.5} r={2.6} fill={it.color} />
                    <text x={40} y={it.y + 10} fontSize={9.0} fontWeight="600" fill="#0f172a">
                      {it.label}
                    </text>
                  </g>
                ))}

                {/* Line Length Rows matching 15nov_p2.png */}
                <line x1={12} y1={124} x2={308} y2={124} stroke="#cbd5e1" strokeWidth={0.9} />
                <line x1={16} y1={144} x2={48} y2={144} stroke={GIS_GREEN} strokeWidth={4.5} strokeLinecap="round" />
                <text x={58} y={147.5} fontSize={9.0} fontWeight="700" fill="#15803d">
                  WB Complete = {wbData.completedLengthM.toFixed(1)} m ({wbPct.toFixed(1)}%)
                </text>

                <line x1={16} y1={166} x2={48} y2={166} stroke={GIS_RED} strokeWidth={4.5} strokeLinecap="round" />
                <text x={58} y={169.5} fontSize={9.0} fontWeight="700" fill="#dc2626">
                  WB Remaining = {wbRemM.toFixed(1)} m
                </text>

                <circle cx={32} cy={188} r={5} fill={GIS_BLUE} stroke="#ffffff" strokeWidth={1.2} />
                <text x={58} y={191.5} fontSize={8.8} fontWeight="600" fill="#1e3a8a">
                  Completion Tip Marker
                </text>

                {viewMode !== 'overall' && (
                  <g>
                    <line x1={16} y1={209} x2={48} y2={209} stroke={GIS_HIGHLIGHT} strokeWidth={4.5} strokeLinecap="round" />
                    <text x={58} y={212.5} fontSize={8.5} fontWeight="700" fill="#b45309">
                      Added ({file2Label}): +{Math.max(0, wbData.completedLengthM - (wbPrevCompletedM ?? wbData.completedLengthM)).toFixed(1)} m
                    </text>
                  </g>
                )}

                <line x1={12} y1={226} x2={308} y2={226} stroke="#cbd5e1" strokeWidth={0.9} />
                <text x={14} y={244} fontSize={9.5} fontWeight="800" fill="#0f172a">
                  WB Total Pipe Length = {(wbData.totalLengthM / 1000).toFixed(3)} km ({wbData.totalLengthM} m)
                </text>
                <text x={14} y={261} fontSize={8.6} fontWeight="600" fill="#334155">
                  Specification: {wbData.method} {wbData.pipeDia}
                </text>

                <line x1={12} y1={273} x2={308} y2={273} stroke="#cbd5e1" strokeWidth={0.9} />
                <text x={14} y={291} fontSize={9.0} fontWeight="700" fill="#1e3a8a">
                  Appurtenances & Reference Points:
                </text>
                <rect x={16} y={300} width={13} height={11} fill="#fbcfe8" stroke="#9d174d" strokeWidth={1.4} />
                <text x={35} y={309} fontSize={8.2} fontWeight="700" fill="#831843">Golapbag SPS</text>
                <polygon points="122,300 116,311 128,311" fill="#16a34a" />
                <text x={133} y={309} fontSize={8.2} fontWeight="600" fill="#15803d">Washout</text>
                <polygon points="194,300 188,311 200,311" fill="#0284c7" />
                <text x={205} y={309} fontSize={8.2} fontWeight="600" fill="#0369a1">Air Valve</text>
                <text x={16} y={327} fontSize={8.0} fontWeight="600" fill="#6b21a8">
                  End Junction: Doyagonj Chowrasta (WD2 / WD3 / WC-1)
                </text>
              </g>
            </g>
          );
        })()}

        {/* ================================================================ */}
        {/* PAGE 4: WC PROGRESS MAP                                          */}
        {/* ================================================================ */}
        {kind === 'wc-map' && (() => {
          const shaftById = new Map<string, ShaftRecord>();
          for (const s of wcData.shafts) shaftById.set(s.id, s);

          const occupied: RectBox[] = [legendBox, compassBox, scaleBox];
          const wcGeoById = new Map(wcData.geoNodes.map((g) => [g.id, g]));

          // Pre-register every WC node square & Pagla STP box in occupied
          for (const gNode of wcData.geoNodes) {
            const p = viewport.project(gNode.lat, gNode.lon);
            occupied.push({ x0: p.x - 9, y0: p.y - 9, x1: p.x + 9, y1: p.y + 9 });
          }
          const stpPre = wcGeoById.get('WC-27');
          if (stpPre) {
            const tp = viewport.project(stpPre.lat, stpPre.lon);
            occupied.push({ x0: tp.x - 14, y0: tp.y + 8, x1: tp.x + 76, y1: tp.y + 34 });
          }

          // Special features & road landmarks from WA_WB_WC_Map.pdf Page 4
          const siphonNode = wcGeoById.get('WC-9');
          const bridgeNode = wcGeoById.get('WC-15');
          const stpNode = wcGeoById.get('WC-27');

          const wcLandmarks: Array<{ id: string; label: string; dx: number; dy: number; side: 'left' | 'right' }> = [
            { id: 'WC-1', label: 'Doyagonj Chowrasta (Start WC-1)', dx: 64, dy: -14, side: 'right' },
            { id: 'WC-4', label: 'Shahid Faruk Road', dx: 68, dy: 4, side: 'right' },
            { id: 'WC-9', label: 'Inverted Siphon & Underpass', dx: -64, dy: 4, side: 'left' },
            { id: 'WC-11', label: 'Gendaria Rail Station (West)', dx: -68, dy: 8, side: 'left' },
            { id: 'WC-13', label: 'Khandakar Road', dx: 68, dy: -6, side: 'right' },
            { id: 'WC-15', label: '1st BD-China Friendship Bridge Rd', dx: -66, dy: 10, side: 'left' },
            { id: 'WC-17', label: 'Jurain Rail Gate / Titas Gas Rd', dx: 70, dy: -4, side: 'right' },
            { id: 'WC-21', label: 'Shyampur Kadamtoli', dx: -68, dy: 8, side: 'left' },
          ];

          const zone5Pt = viewport.project(23.6942, 90.4408);
          const zone10Pt = viewport.project(23.6865, 90.4470);

          return (
            <g>
              {/* Zone Watermarks */}
              <HaloText x={zone5Pt.x} y={zone5Pt.y} text="DSCC ZONE 05" fontSize={12} fontWeight="800" fill="#475569" haloWidth={4} textAnchor="middle" />
              <HaloText x={zone10Pt.x} y={zone10Pt.y} text="DSCC ZONE 10" fontSize={12} fontWeight="800" fill="#475569" haloWidth={4} textAnchor="middle" />

              {/* Custom KML Lines if imported */}
              {(wcData.customKmlLines || []).map((ln, li) => (
                <polyline
                  key={`wc-kml-${li}`}
                  points={ln.coords
                    .map(([la, lo]) => {
                      const p = viewport.project(la, lo);
                      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
                    })
                    .join(' ')}
                  fill="none"
                  stroke="#64748b"
                  strokeWidth={1.6}
                  strokeDasharray="4,3"
                />
              ))}

              {/* Micro-tunneling alignment segments WC-i -> WC-(i+1) */}
              {wcData.geoNodes.slice(0, -1).map((gNode, idx) => {
                const nextNode = wcData.geoNodes[idx + 1];
                const p1 = viewport.project(gNode.lat, gNode.lon);
                const p2 = viewport.project(nextNode.lat, nextNode.lon);
                const sh = shaftById.get(gNode.id);
                const mtStatus = sh ? getTunnelStatus(sh) : 'remaining';
                const col = statusStroke(mtStatus);
                const bSnap = baseline.wcShafts?.[gNode.id];
                const deltaInfo = sh ? getDeltaProgressBadge(sh, bSnap) : { hasNewTunnel: false };

                return (
                  <g key={`wc-seg-${gNode.id}`}>
                    <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#ffffff" strokeWidth={7.8} strokeLinecap="round" />
                    <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={col} strokeWidth={4.8} strokeLinecap="round" />
                    {viewMode !== 'overall' && deltaInfo.hasNewTunnel && (
                      <line
                        x1={p1.x}
                        y1={p1.y}
                        x2={p2.x}
                        y2={p2.y}
                        stroke={GIS_HIGHLIGHT}
                        strokeWidth={2.4}
                        strokeDasharray="6,4"
                        strokeLinecap="round"
                      />
                    )}
                  </g>
                );
              })}

              {/* Special Infrastructure Symbols from WA_WB_WC_Map.pdf Page 4 */}
              {siphonNode && (() => {
                const sp = viewport.project(siphonNode.lat, siphonNode.lon);
                return (
                  <rect
                    x={sp.x - 13}
                    y={sp.y - 5}
                    width={26}
                    height={10}
                    fill="#1e293b"
                    fillOpacity={0.22}
                    stroke="#0f172a"
                    strokeWidth={1.4}
                  />
                );
              })()}
              {bridgeNode && (() => {
                const bp = viewport.project(bridgeNode.lat, bridgeNode.lon);
                return <circle cx={bp.x} cy={bp.y} r={10} fill="none" stroke="#0284c7" strokeWidth={1.6} strokeDasharray="3,2" />;
              })()}
              {stpNode && (() => {
                const tp = viewport.project(stpNode.lat, stpNode.lon);
                return (
                  <g>
                    <rect
                      x={tp.x - 12}
                      y={tp.y + 10}
                      width={86}
                      height={22}
                      rx={3}
                      fill="#dbeafe"
                      stroke="#1e3a8a"
                      strokeWidth={1.8}
                    />
                    <text x={tp.x + 31} y={tp.y + 24.5} textAnchor="middle" fontSize={8.5} fontWeight="800" fill="#1e3a8a">
                      Pagla STP Outfall
                    </text>
                  </g>
                );
              })()}

              {/* WC-1 .. WC-27 Composite Shaft + Manhole Nodes */}
              {wcData.geoNodes.map((gNode, idx) => {
                const pt = viewport.project(gNode.lat, gNode.lon);
                const sh = shaftById.get(gNode.id);
                const shStatus = sh ? getShaftStatus(sh) : 'remaining';
                const mhStatus = sh ? getManholeStatus(sh) : 'remaining';
                const castSt = sh ? getCastingStatus(sh) : 'remaining';
                const ringSt = sh ? getRingStatus(sh) : 'remaining';
                const isSel = selectedShaftId === gNode.id;

                const outerCol = statusStroke(shStatus);
                const innerCol =
                  mhStatus === 'complete'
                    ? GIS_GREEN
                    : castSt === 'complete' || mhStatus === 'ongoing'
                    ? GIS_BLUE
                    : GIS_RED;

                const bSnap = baseline.wcShafts?.[gNode.id];
                const deltaInfo = sh
                  ? getDeltaProgressBadge(sh, bSnap)
                  : { hasNewLayer: false, hasNewMh: false, hasNewTunnel: false };

                const prefSide: 'left' | 'right' = idx % 2 === 0 ? 'right' : 'left';
                const lblPos = resolveSmartLabel(
                  pt.x,
                  pt.y,
                  gNode.id,
                  8.5,
                  occupied,
                  mapBounds,
                  prefSide,
                  9
                );

                return (
                  <g
                    key={gNode.id}
                    style={{ cursor: onSelectShaft ? 'pointer' : 'default' }}
                    onClick={() => onSelectShaft?.(gNode.id, 'shaft')}
                  >
                    {viewMode !== 'overall' && (deltaInfo.hasNewLayer || deltaInfo.hasNewMh) && (
                      <rect x={pt.x - 10.5} y={pt.y - 10.5} width={21} height={21} rx={3} fill="none" stroke={GIS_HIGHLIGHT} strokeWidth={2.0} />
                    )}
                    {isSel && (
                      <rect x={pt.x - 11.5} y={pt.y - 11.5} width={23} height={23} rx={3} fill="none" stroke="#0284c7" strokeWidth={2.2} />
                    )}
                    <rect
                      x={pt.x - 7.5}
                      y={pt.y - 7.5}
                      width={15}
                      height={15}
                      fill="#ffffff"
                      stroke={outerCol}
                      strokeWidth={2.5}
                    />
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={4.0}
                      fill={innerCol}
                      stroke={ringSt === 'ongoing' ? '#0ea5e9' : '#ffffff'}
                      strokeWidth={0.9}
                    />
                    {lblPos.leaderNeeded && (
                      <line x1={pt.x} y1={pt.y} x2={lblPos.x} y2={lblPos.y - 2} stroke="#475569" strokeWidth={0.7} />
                    )}
                    <HaloText
                      x={lblPos.x}
                      y={lblPos.y}
                      text={gNode.id}
                      fontSize={8.5}
                      fontWeight="700"
                      fill="#0f172a"
                      haloWidth={3.2}
                      textAnchor={lblPos.anchor}
                    />
                  </g>
                );
              })}

              {/* WC Landmarks */}
              {wcLandmarks.map((lm) => {
                const g = wcGeoById.get(lm.id);
                if (!g) return null;
                const pt = viewport.project(g.lat, g.lon);
                const pos = resolveSmartLabel(pt.x + lm.dx, pt.y + lm.dy, lm.label, 8.0, occupied, mapBounds, lm.side, 4);
                return (
                  <g key={`wc-lm-${lm.id}`}>
                    <line x1={pt.x} y1={pt.y} x2={pos.x} y2={pos.y - 2} stroke="#64748b" strokeWidth={0.65} strokeDasharray="2,2" />
                    <HaloText
                      x={pos.x}
                      y={pos.y}
                      text={lm.label}
                      fontSize={8.0}
                      fontWeight="600"
                      fontStyle="italic"
                      fill="#334155"
                      haloWidth={2.8}
                      textAnchor={pos.anchor}
                    />
                  </g>
                );
              })}

              {/* WC Bottom-Left Frosted Legend & Summary Card */}
              <g transform={`translate(${legendBox.x0}, ${legendBox.y0})`}>
                <rect
                  x={0}
                  y={0}
                  width={344}
                  height={460}
                  rx={4}
                  fill="#ffffff"
                  fillOpacity={0.94}
                  stroke="#1e293b"
                  strokeWidth={1.1}
                />
                <rect x={0} y={0} width={344} height={28} rx={4} fill="#eff6ff" stroke="#1e293b" strokeWidth={0.8} />
                <text x={14} y={19} fontSize={12.5} fontWeight="800" fill="#0f172a">
                  Legend — WC Section Progress
                </text>

                <text x={14} y={48} fontSize={9.8} fontWeight="700" fill="#1e3a8a">
                  WC Shaft Status ({wcSummary.totalShafts} Shafts)
                </text>
                {[
                  { label: `Complete (${wcSummary.completedShafts})`, color: GIS_GREEN, y: 58 },
                  { label: `On-Going (${wcSummary.ongoingShafts})`, color: GIS_BLUE, y: 79 },
                  { label: `Remaining (${wcSummary.remainingShafts})`, color: GIS_RED, y: 100 },
                ].map((it) => (
                  <g key={it.label}>
                    <rect x={16} y={it.y} width={14} height={14} fill="#ffffff" stroke={it.color} strokeWidth={2.4} />
                    <text x={40} y={it.y + 11} fontSize={9.0} fontWeight="600" fill="#0f172a">
                      {it.label}
                    </text>
                  </g>
                ))}

                <text x={14} y={136} fontSize={9.8} fontWeight="700" fill="#1e3a8a">
                  WC Manhole Status ({wcSummary.totalManholes} Nos)
                </text>
                {[
                  { label: `Complete — Cast & Ring 100% (${wcSummary.completedManholes})`, color: GIS_GREEN, y: 146 },
                  {
                    label: `Cast Done / On-Going (${Math.max(0, wcSummary.castingCompleteCount + wcSummary.castingOngoingCount - wcSummary.completedManholes)})`,
                    color: GIS_BLUE,
                    y: 165,
                  },
                  { label: `Remaining (${wcSummary.castingRemainingCount})`, color: GIS_RED, y: 184 },
                ].map((it) => (
                  <g key={it.label}>
                    <circle cx={23} cy={it.y + 6} r={5.2} fill={it.color} stroke="#ffffff" strokeWidth={0.8} />
                    <text x={40} y={it.y + 9.5} fontSize={8.7} fontWeight="600" fill="#0f172a">
                      {it.label}
                    </text>
                  </g>
                ))}
                <text x={16} y={208} fontSize={8.0} fontWeight="700" fill="#1d4ed8">
                  Cast: {wcSummary.castingCompleteCount} Done | {wcSummary.castingOngoingCount} Ong | {wcSummary.castingRemainingCount} Rem
                </text>
                <text x={16} y={222} fontSize={8.0} fontWeight="700" fill="#0284c7">
                  Ring: {wcSummary.precastCompleteCount} Done | {wcSummary.precastOngoingCount} Ong | {wcSummary.precastRemainingCount} Rem
                </text>

                <text x={14} y={244} fontSize={9.8} fontWeight="700" fill="#1e3a8a">
                  WC Micro-Tunneling Status
                </text>
                {[
                  { label: 'Complete', color: GIS_GREEN, y: 256 },
                  { label: 'On-Going', color: GIS_BLUE, y: 274 },
                  { label: 'Remaining', color: GIS_RED, y: 292 },
                ].map((it) => (
                  <g key={it.label}>
                    <line x1={16} y1={it.y + 4} x2={44} y2={it.y + 4} stroke={it.color} strokeWidth={4.2} strokeLinecap="round" />
                    <text x={54} y={it.y + 7.5} fontSize={8.8} fontWeight="600" fill="#0f172a">
                      {it.label}
                    </text>
                  </g>
                ))}

                <rect x={198} y={254} width={16} height={11} fill="#dbeafe" stroke="#1e3a8a" strokeWidth={1.4} />
                <text x={220} y={263} fontSize={8.2} fontWeight="700" fill="#1e3a8a">Pagla STP</text>
                <rect x={198} y={272} width={16} height={8} fill="#1e293b" fillOpacity={0.25} stroke="#0f172a" strokeWidth={1.1} />
                <text x={220} y={279} fontSize={8.0} fontWeight="600" fill="#0f172a">Underpass / Siphon</text>

                <line x1={12} y1={310} x2={332} y2={310} stroke="#cbd5e1" strokeWidth={0.9} />

                <text x={14} y={328} fontSize={9.2} fontWeight="800" fill="#0f172a">
                  TOTAL LENGTH
                </text>
                <text x={330} y={328} textAnchor="end" fontSize={9.2} fontWeight="800" fill="#0f172a">
                  : {(wcSummary.totalTunnelLengthM / 1000).toFixed(3)} km
                </text>
                <text x={14} y={345} fontSize={9.2} fontWeight="800" fill="#15803d">
                  COMPLETED LENGTH
                </text>
                <text x={330} y={345} textAnchor="end" fontSize={9.2} fontWeight="800" fill="#15803d">
                  : {(wcSummary.completedTunnelLengthM / 1000).toFixed(3)} km ({wcSummary.tunnelPctOverall.toFixed(1)}%)
                </text>

                <text x={14} y={365} fontSize={8.6} fontWeight="700" fill="#334155">
                  1. DN 1800 ({(wcSummary.byDia.DN1800.totalM / 1000).toFixed(3)} km)
                </text>
                <text x={330} y={365} textAnchor="end" fontSize={8.6} fontWeight="700" fill="#0f172a">
                  Done: {(wcSummary.byDia.DN1800.completedM / 1000).toFixed(3)} km
                </text>
                <text x={14} y={381} fontSize={8.6} fontWeight="700" fill="#334155">
                  2. DN 2400 ({(wcSummary.byDia.DN2400.totalM / 1000).toFixed(3)} km)
                </text>
                <text x={330} y={381} textAnchor="end" fontSize={8.6} fontWeight="700" fill="#0f172a">
                  Done: {(wcSummary.byDia.DN2400.completedM / 1000).toFixed(3)} km
                </text>
                <text x={14} y={397} fontSize={8.6} fontWeight="700" fill="#334155">
                  3. DN 2600 ({(wcSummary.byDia.DN2600.totalM / 1000).toFixed(3)} km)
                </text>
                <text x={330} y={397} textAnchor="end" fontSize={8.6} fontWeight="700" fill="#0f172a">
                  Done: {(wcSummary.byDia.DN2600.completedM / 1000).toFixed(3)} km
                </text>

                <rect x={12} y={409} width={320} height={42} rx={3} fill="#faf5ff" stroke="#9333ea" strokeWidth={0.8} />
                <text x={20} y={425} fontSize={8.2} fontWeight="700" fill="#6b21a8">
                  Corridor: Doyagonj Chowrasta (WC-1) to Pagla STP (WC-27)
                </text>
                <text x={20} y={441} fontSize={8.2} fontWeight="700" fill={wcSummary.completedTunnelLengthM > 0 || wcSummary.completedShafts > 0 ? '#15803d' : '#b91c1c'}>
                  Status: {wcSummary.completedTunnelLengthM > 0 || wcSummary.completedShafts > 0 ? 'Active Construction' : 'Not Started (All Remaining)'}
                </text>
              </g>

              {renderCompassRose(mapX + mapW - 60, mapY + 60, 34)}
            </g>
          );
        })()}

        {/* Shared Bottom-Right Cartographic Scale Bar & Esri Attribution */}
        {renderScaleBarAndAttribution(
          viewport,
          mapX + mapW - 14,
          mapY + mapH - 12,
          sheetNoLabel,
          `${settings.drawingNo} (${settings.revision})`,
          settings.checkedBy
        )}
      </g>

      {/* Double Neatline Frame */}
      <rect x={mapX} y={mapY} width={mapW} height={mapH} fill="none" stroke="#0f172a" strokeWidth={1.6} />
      <rect x={mapX - 4} y={mapY - 4} width={mapW + 8} height={mapH + 8} fill="none" stroke="#334155" strokeWidth={0.7} />
    </svg>
  );
};
