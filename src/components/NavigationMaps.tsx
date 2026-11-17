import React, { useMemo } from 'react';
import {
  ShaftRecord,
  SheetSettings,
  ViewMode,
  WbSectionData,
  WcSectionData,
  WorkStatus,
} from '../types';
import { getShaftStatus, getTunnelStatus } from '../utils/calculations';
import {
  buildGeoViewport,
  computeWbPolylineSplit,
  useMapTileSnapshot,
} from '../utils/geoMap';

function nodeColors(status: WorkStatus) {
  if (status === 'complete') {
    return { fill: '#16a34a', stroke: '#14532d', text: '#15803d' };
  }
  if (status === 'ongoing') {
    return { fill: '#f59e0b', stroke: '#92400e', text: '#b45309' };
  }
  return { fill: '#ffffff', stroke: '#dc2626', text: '#dc2626' };
}

interface WbMapProps {
  wb: WbSectionData;
  x: number;
  y: number;
  w: number;
  h: number;
  settings: SheetSettings;
  viewMode: ViewMode;
  prevCompletedLengthM?: number;
  highlightColor?: string;
  selectedNodeId?: string;
  onSelectNode?: (nodeId: string) => void;
  compact?: boolean;
  clipIdSuffix?: string;
}

export const WbNavigationMapGroup: React.FC<WbMapProps> = ({
  wb,
  x,
  y,
  w,
  h,
  settings,
  viewMode,
  prevCompletedLengthM,
  highlightColor = '#f59e0b',
  selectedNodeId,
  onSelectNode,
  compact = false,
  clipIdSuffix = 'main',
}) => {
  const padTop = compact ? 19 : 26;
  const mapX = x + 4;
  const mapY = y + padTop;
  const mapW = Math.max(40, w - 8);
  const mapH = Math.max(40, h - padTop - 4);
  const clipId = `wb-map-clip-${clipIdSuffix}`;
  const isNarrow = w < 440;

  const viewport = useMemo(
    () => buildGeoViewport(wb.nodes, mapX, mapY, mapW, mapH, compact ? 0.12 : 0.1),
    [wb.nodes, mapX, mapY, mapW, mapH, compact]
  );

  const tilePxW = Math.min(1100, Math.max(480, Math.round(mapW * (compact ? 1.55 : 1.35))));
  const tilePxH = Math.min(1100, Math.max(420, Math.round(mapH * (compact ? 1.55 : 1.35))));

  const tileDataUrl = useMapTileSnapshot(
    viewport,
    settings.showMapBackground,
    settings.mapStyle,
    tilePxW,
    tilePxH
  );

  const split = useMemo(
    () =>
      computeWbPolylineSplit(
        wb.nodes,
        wb.totalLengthM,
        wb.completedLengthM,
        viewMode === 'overall' ? undefined : prevCompletedLengthM
      ),
    [wb.nodes, wb.totalLengthM, wb.completedLengthM, viewMode, prevCompletedLengthM]
  );

  const toPointsAttr = (pts: Array<{ lat: number; lon: number }>) =>
    pts
      .map((p) => {
        const pr = viewport.project(p.lat, p.lon);
        return `${pr.x.toFixed(1)},${pr.y.toFixed(1)}`;
      })
      .join(' ');

  const tipScreen = viewport.project(split.tipPoint.lat, split.tipPoint.lon);
  const pct =
    wb.totalLengthM > 0
      ? Math.min(100, (wb.completedLengthM / wb.totalLengthM) * 100)
      : 0;

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect x={mapX} y={mapY} width={mapW} height={mapH} />
        </clipPath>
      </defs>

      {/* Outer Frame */}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="#ffffff"
        stroke="#1e3a8a"
        strokeWidth={1.1}
      />
      <rect
        x={x}
        y={y}
        width={w}
        height={padTop}
        fill="#eff6ff"
        stroke="#1e3a8a"
        strokeWidth={0.8}
      />
      <text
        x={x + 7}
        y={y + (compact ? 13 : 17)}
        fontSize={isNarrow ? 6.5 : compact ? 7.2 : 10}
        fontWeight="700"
        fill="#1e3a8a"
      >
        {isNarrow ? `WB MAP (${wb.pipeDia} ${wb.method})` : `WB SECTION (${wb.method} ${wb.pipeDia})`}
      </text>
      <text
        x={x + w - 7}
        y={y + (compact ? 13 : 17)}
        textAnchor="end"
        fontSize={isNarrow ? 5.7 : compact ? 6.0 : 8.5}
        fontWeight="700"
        fill="#15803d"
      >
        Done: {wb.completedLengthM.toFixed(1)}m / {wb.totalLengthM}m ({pct.toFixed(1)}%)
      </text>

      {/* Map Viewport Canvas */}
      <rect x={mapX} y={mapY} width={mapW} height={mapH} fill="#f1f5f9" />

      <g clipPath={`url(#${clipId})`}>
        {/* Embedded Street Navigation Tile Image */}
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
          /* Clean CAD Geographic Coordinate Grid Fallback */
          <g>
            {Array.from({ length: 6 }).map((_, gi) => {
              const gx = mapX + ((gi + 1) / 7) * mapW;
              const gy = mapY + ((gi + 1) / 7) * mapH;
              return (
                <g key={gi}>
                  <line
                    x1={gx}
                    y1={mapY}
                    x2={gx}
                    y2={mapY + mapH}
                    stroke="#cbd5e1"
                    strokeWidth={0.5}
                    strokeDasharray="3,3"
                  />
                  <line
                    x1={mapX}
                    y1={gy}
                    x2={mapX + mapW}
                    y2={gy}
                    stroke="#cbd5e1"
                    strokeWidth={0.5}
                    strokeDasharray="3,3"
                  />
                </g>
              );
            })}
          </g>
        )}

        {/* Custom KML/KMZ Extra Lines */}
        {(wb.customKmlLines || []).map((ln, li) => (
          <polyline
            key={`kml-${li}`}
            points={ln.coords
              .map(([la, lo]) => {
                const p = viewport.project(la, lo);
                return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
              })
              .join(' ')}
            fill="none"
            stroke="#64748b"
            strokeWidth={1.1}
            strokeDasharray="3,2"
          />
        ))}

        {/* Remaining Line (RED) */}
        {split.remainingPoints.length >= 2 && (
          <polyline
            points={toPointsAttr(split.remainingPoints)}
            fill="none"
            stroke="#dc2626"
            strokeWidth={compact ? 2.4 : 3.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Completed Line (GREEN or Prev in Weekly/Monthly) */}
        {split.prevPoints.length >= 2 && (
          <polyline
            points={toPointsAttr(split.prevPoints)}
            fill="none"
            stroke="#16a34a"
            strokeWidth={compact ? 3.2 : 5.0}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Period Newly Added Line (Amber/Cyan) */}
        {viewMode !== 'overall' && split.currPoints.length >= 2 && (
          <polyline
            points={toPointsAttr(split.currPoints)}
            fill="none"
            stroke={highlightColor}
            strokeWidth={compact ? 3.6 : 5.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Nodes WB1..WB38 with smart label de-collision */}
        {(() => {
          let lastLabelX = -9999;
          let lastLabelY = -9999;
          const minDist = compact ? 22 : 21;

          return wb.nodes.map((n, idx) => {
            const pt = viewport.project(n.lat, n.lon);
            const col = nodeColors(n.status);
            const isSel = selectedNodeId === n.id;
            const r = isSel ? (compact ? 4.2 : 6.2) : compact ? 2.6 : 4.2;
            const isBoundary = idx === 0 || idx === wb.nodes.length - 1 || isSel;
            const farEnough = Math.hypot(pt.x - lastLabelX, pt.y - lastLabelY) >= minDist;
            const showLabel = isBoundary || ((!compact || idx % 3 === 0) && farEnough);
            if (showLabel) {
              lastLabelX = pt.x;
              lastLabelY = pt.y;
            }
            const labelOffsetX = idx % 2 === 0 ? r + 3 : -(r + 3);
            const anchor = idx % 2 === 0 ? 'start' : 'end';

            return (
              <g
                key={n.id}
                style={{ cursor: onSelectNode ? 'pointer' : 'default' }}
                onClick={(e) => {
                  if (onSelectNode) {
                    e.stopPropagation();
                    onSelectNode(n.id);
                  }
                }}
              >
                {isSel && (
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={r + 3.5}
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth={1.6}
                  />
                )}
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={r}
                  fill={col.fill}
                  stroke={col.stroke}
                  strokeWidth={compact ? 0.9 : 1.3}
                />
                {showLabel && (
                  <g>
                    <rect
                      x={anchor === 'start' ? pt.x + labelOffsetX - 1 : pt.x + labelOffsetX - (compact ? 17 : 23)}
                      y={pt.y - (compact ? 4.5 : 6)}
                      width={compact ? 18 : 24}
                      height={compact ? 8 : 11}
                      rx={1.5}
                      fill="#ffffff"
                      fillOpacity={0.88}
                    />
                    <text
                      x={pt.x + labelOffsetX}
                      y={pt.y + (compact ? 1.8 : 2.5)}
                      textAnchor={anchor}
                      fontSize={compact ? 4.8 : 6.5}
                      fontWeight="700"
                      fill="#0f172a"
                    >
                      {n.id}
                    </text>
                  </g>
                )}
              </g>
            );
          });
        })()}

        {/* BLUE CIRCLE MARKER AT COMPLETED TIP ("completion er mathai blue circle") */}
        <g>
          <circle
            cx={tipScreen.x}
            cy={tipScreen.y}
            r={compact ? 6.2 : 9.5}
            fill="#3b82f6"
            fillOpacity={0.28}
          />
          <circle
            cx={tipScreen.x}
            cy={tipScreen.y}
            r={compact ? 4.0 : 6.2}
            fill="#2563eb"
            stroke="#ffffff"
            strokeWidth={compact ? 1.4 : 2.0}
          />
          <rect
            x={tipScreen.x + (compact ? 6 : 10)}
            y={tipScreen.y - (compact ? 7 : 10)}
            width={compact ? 56 : 78}
            height={compact ? 12 : 16}
            rx={2}
            fill="#1e3a8a"
          />
          <text
            x={tipScreen.x + (compact ? 34 : 49)}
            y={tipScreen.y + (compact ? 1.5 : 1.5)}
            textAnchor="middle"
            fontSize={compact ? 5.2 : 7.2}
            fontWeight="700"
            fill="#ffffff"
          >
            Done: {wb.completedLengthM.toFixed(1)}m
          </text>
        </g>

        {/* North Arrow & Mini Legend inside Map */}
        <g transform={`translate(${mapX + mapW - (compact ? 20 : 28)}, ${mapY + (compact ? 18 : 24)})`}>
          <circle cx={0} cy={0} r={compact ? 9 : 13} fill="#ffffff" fillOpacity={0.88} stroke="#475569" strokeWidth={0.7} />
          <polygon points={`0,${compact ? -7 : -10} ${compact ? -3 : -4},${compact ? 3 : 4} 0,${compact ? 1 : 1.5} ${compact ? 3 : 4},${compact ? 3 : 4}`} fill="#1e3a8a" />
          <text x={0} y={compact ? 7.5 : 10.5} textAnchor="middle" fontSize={compact ? 4.5 : 6} fontWeight="700" fill="#1e3a8a">N</text>
        </g>

        {/* Bottom-left Mini Key Overlay */}
        <g transform={`translate(${mapX + 5}, ${mapY + mapH - (compact ? 34 : 46)})`}>
          <rect
            x={0}
            y={0}
            width={compact ? 105 : 148}
            height={compact ? 30 : 41}
            rx={3}
            fill="#ffffff"
            fillOpacity={0.92}
            stroke="#cbd5e1"
            strokeWidth={0.7}
          />
          <line x1={6} y1={compact ? 8 : 11} x2={22} y2={compact ? 8 : 11} stroke="#16a34a" strokeWidth={2.5} />
          <circle cx={14} cy={compact ? 8 : 11} r={2.5} fill="#2563eb" stroke="#ffffff" strokeWidth={0.6} />
          <text x={27} y={compact ? 10 : 13.5} fontSize={compact ? 4.8 : 6.4} fontWeight="700" fill="#0f172a">
            Complete + Blue End Pt
          </text>

          <line x1={6} y1={compact ? 17 : 23} x2={22} y2={compact ? 17 : 23} stroke="#dc2626" strokeWidth={2.2} />
          <text x={27} y={compact ? 19 : 25.5} fontSize={compact ? 4.8 : 6.4} fontWeight="600" fill="#991b1b">
            Remaining: {Math.max(0, wb.totalLengthM - wb.completedLengthM).toFixed(1)}m
          </text>

          <circle cx={10} cy={compact ? 25 : 34} r={2.2} fill="#f59e0b" stroke="#92400e" strokeWidth={0.6} />
          <text x={27} y={compact ? 27 : 36.5} fontSize={compact ? 4.6 : 6.2} fill="#334155">
            Complete / On-Going / Rem
          </text>
        </g>
      </g>

      <rect x={mapX} y={mapY} width={mapW} height={mapH} fill="none" stroke="#94a3b8" strokeWidth={0.6} />
    </g>
  );
};

interface WcMapProps {
  wc: WcSectionData;
  x: number;
  y: number;
  w: number;
  h: number;
  settings: SheetSettings;
  selectedShaftId?: string;
  onSelectShaft?: (id: string) => void;
  compact?: boolean;
  clipIdSuffix?: string;
}

export const WcNavigationMapGroup: React.FC<WcMapProps> = ({
  wc,
  x,
  y,
  w,
  h,
  settings,
  selectedShaftId,
  onSelectShaft,
  compact = false,
  clipIdSuffix = 'main',
}) => {
  const padTop = compact ? 19 : 24;
  const mapX = x + 4;
  const mapY = y + padTop;
  const mapW = Math.max(40, w - 8);
  const mapH = Math.max(40, h - padTop - 4);
  const clipId = `wc-map-clip-${clipIdSuffix}`;
  const isNarrow = w < 440;

  const viewport = useMemo(
    () => buildGeoViewport(wc.geoNodes, mapX, mapY, mapW, mapH, compact ? 0.12 : 0.12),
    [wc.geoNodes, mapX, mapY, mapW, mapH, compact]
  );

  const tilePxW = Math.min(1100, Math.max(480, Math.round(mapW * (compact ? 1.55 : 1.35))));
  const tilePxH = Math.min(1100, Math.max(420, Math.round(mapH * (compact ? 1.55 : 1.35))));

  const tileDataUrl = useMapTileSnapshot(
    viewport,
    settings.showMapBackground,
    settings.mapStyle,
    tilePxW,
    tilePxH
  );

  const shaftById = useMemo(() => {
    const m = new Map<string, ShaftRecord>();
    for (const s of wc.shafts) m.set(s.id, s);
    return m;
  }, [wc.shafts]);

  const totalLenM = wc.shafts.reduce((acc, s) => acc + s.tunnelLengthM, 0);
  const doneLenM = wc.shafts.reduce(
    (acc, s) => acc + (s.tunnelLengthM * s.tunnelPct) / 100,
    0
  );

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect x={mapX} y={mapY} width={mapW} height={mapH} />
        </clipPath>
      </defs>

      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="#ffffff"
        stroke="#1e3a8a"
        strokeWidth={1.1}
      />
      <rect
        x={x}
        y={y}
        width={w}
        height={padTop}
        fill="#eff6ff"
        stroke="#1e3a8a"
        strokeWidth={0.8}
      />
      <text
        x={x + 7}
        y={y + (compact ? 13 : 16)}
        fontSize={isNarrow ? 6.5 : compact ? 7.2 : 9.2}
        fontWeight="700"
        fill="#1e3a8a"
      >
        {isNarrow ? 'WC MAP (MICRO-TUNNEL WC-1..27)' : 'WC SECTION (MICRO-TUNNELLING CORRIDOR — WC-1 TO WC-27)'}
      </text>
      <text
        x={x + w - 7}
        y={y + (compact ? 13 : 16)}
        textAnchor="end"
        fontSize={isNarrow ? 5.7 : compact ? 6.0 : 8.0}
        fontWeight="700"
        fill={doneLenM > 0 ? '#a21caf' : '#dc2626'}
      >
        {isNarrow
          ? `${(doneLenM / 1000).toFixed(2)} / ${(totalLenM / 1000).toFixed(2)} km (${doneLenM > 0 ? 'Active' : 'Blank'})`
          : `Done: ${(doneLenM / 1000).toFixed(3)} / ${(totalLenM / 1000).toFixed(2)} km (${doneLenM > 0 ? 'Active' : 'Not Started'})`}
      </text>

      <rect x={mapX} y={mapY} width={mapW} height={mapH} fill="#f1f5f9" />

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
            {Array.from({ length: 8 }).map((_, gi) => {
              const gx = mapX + ((gi + 1) / 9) * mapW;
              const gy = mapY + ((gi + 1) / 9) * mapH;
              return (
                <g key={gi}>
                  <line x1={gx} y1={mapY} x2={gx} y2={mapY + mapH} stroke="#cbd5e1" strokeWidth={0.5} strokeDasharray="3,3" />
                  <line x1={mapX} y1={gy} x2={mapX + mapW} y2={gy} stroke="#cbd5e1" strokeWidth={0.5} strokeDasharray="3,3" />
                </g>
              );
            })}
          </g>
        )}

        {(wc.customKmlLines || []).map((ln, li) => (
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
            strokeWidth={1.1}
            strokeDasharray="3,2"
          />
        ))}

        {/* Segment lines WC-i -> WC-(i+1) */}
        {wc.geoNodes.slice(0, -1).map((gNode, idx) => {
          const nextNode = wc.geoNodes[idx + 1];
          const p1 = viewport.project(gNode.lat, gNode.lon);
          const p2 = viewport.project(nextNode.lat, nextNode.lon);
          const sh = shaftById.get(gNode.id);
          const mtStatus = sh ? getTunnelStatus(sh) : 'remaining';
          const stroke =
            mtStatus === 'complete'
              ? '#a21caf'
              : mtStatus === 'ongoing'
              ? '#f59e0b'
              : '#dc2626';
          return (
            <line
              key={`seg-${gNode.id}`}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke={stroke}
              strokeWidth={compact ? 2.4 : 3.2}
              strokeDasharray={mtStatus === 'remaining' ? '4,2' : undefined}
              strokeLinecap="round"
            />
          );
        })}

        {/* Shaft Node Markers WC-1 .. WC-27 with smart de-collision & white halo */}
        {(() => {
          let lastLx = -9999;
          let lastLy = -9999;
          const minDist = compact ? 18 : 13;

          return wc.geoNodes.map((gNode, idx) => {
            const pt = viewport.project(gNode.lat, gNode.lon);
            const sh = shaftById.get(gNode.id);
            const st = sh ? getShaftStatus(sh) : 'remaining';
            const col = nodeColors(st);
            const isSel = selectedShaftId === gNode.id;
            const r = isSel ? (compact ? 4.0 : 5.5) : compact ? 2.5 : 3.5;
            const isEnd = idx === 0 || idx === wc.geoNodes.length - 1 || isSel;
            const farEnough = Math.hypot(pt.x - lastLx, pt.y - lastLy) >= minDist;
            const showLbl = isEnd || ((!compact || idx % 3 === 0) && farEnough);
            if (showLbl) {
              lastLx = pt.x;
              lastLy = pt.y;
            }
            const sideRight = idx % 2 === 0;
            const lx = sideRight ? pt.x + r + 3 : pt.x - r - 3;
            const anchor = sideRight ? 'start' : 'end';

            return (
              <g
                key={gNode.id}
                style={{ cursor: onSelectShaft ? 'pointer' : 'default' }}
                onClick={(e) => {
                  if (onSelectShaft) {
                    e.stopPropagation();
                    onSelectShaft(gNode.id);
                  }
                }}
              >
                {isSel && (
                  <circle cx={pt.x} cy={pt.y} r={r + 3} fill="none" stroke="#2563eb" strokeWidth={1.5} />
                )}
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={r}
                  fill={col.fill}
                  stroke={col.stroke}
                  strokeWidth={compact ? 0.9 : 1.2}
                />
                {showLbl && (
                  <g>
                    <rect
                      x={sideRight ? lx - 1 : lx - (compact ? 21 : 25)}
                      y={pt.y - (compact ? 4.2 : 5.2)}
                      width={compact ? 22 : 26}
                      height={compact ? 7.5 : 9.5}
                      rx={1.5}
                      fill="#ffffff"
                      fillOpacity={0.88}
                    />
                    <text
                      x={lx}
                      y={pt.y + (compact ? 1.5 : 2.2)}
                      textAnchor={anchor}
                      fontSize={compact ? 4.6 : 5.8}
                      fontWeight="700"
                      fill="#0f172a"
                    >
                      {gNode.id}
                    </text>
                  </g>
                )}
              </g>
            );
          });
        })()}

        {/* North arrow */}
        <g transform={`translate(${mapX + mapW - 18}, ${mapY + 18})`}>
          <circle cx={0} cy={0} r={9} fill="#ffffff" fillOpacity={0.88} stroke="#475569" strokeWidth={0.7} />
          <polygon points="0,-7 -3,3 0,1 3,3" fill="#1e3a8a" />
          <text x={0} y={7.5} textAnchor="middle" fontSize={4.5} fontWeight="700" fill="#1e3a8a">N</text>
        </g>
      </g>

      <rect x={mapX} y={mapY} width={mapW} height={mapH} fill="none" stroke="#94a3b8" strokeWidth={0.6} />
    </g>
  );
};
