import React from 'react';
import {
  AppState,
  PumpStationData,
  ShaftRecord,
  ShaftSnapshotItem,
} from '../types';
import {
  calcDurationDays,
  computeSummary,
  formatDateDisplay,
  getManholeStatus,
  getPumpLowerStatus,
  getShaftCompletedLayersCount,
  getShaftStatus,
  getTunnelStatus,
  resolveDisplayContext,
} from '../utils/calculations';

interface A1SheetDrawingProps {
  state: AppState;
  selectedShaftId: string;
  onSelectShaft: (id: string, focus?: 'shaft' | 'manhole' | 'tunnel') => void;
  svgRef: React.RefObject<SVGSVGElement>;
}

const SHEET_W = 1682; // 841mm * 2
const SHEET_H = 1188; // 594mm * 2

function trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '...' : s;
}

export const A1SheetDrawing: React.FC<A1SheetDrawingProps> = ({
  state,
  selectedShaftId,
  onSelectShaft,
  svgRef,
}) => {
  const { viewMode, colors, settings } = state;
  const { displayShafts: shafts, displayPump: pumpStation, baseline, file1Label, file2Label } =
    resolveDisplayContext(state);
  const summary = computeSummary(shafts, baseline);

  const cols = settings.layoutMode === '12col' ? 12 : 10;
  const gridX = 46; // Left room for row-wrap incoming bars (60%..100%)
  const gridY = 60;
  const gridW = 1584; // Leaves right room inside 1666 border for row-wrap exiting bars (10%..50%)
  const colW = gridW / cols;
  const sx = colW / 158.4; // 1.0 in 10col, ~0.833 in 12col
  const rowH = 232;

  const activePeriodLabel =
    viewMode === 'weekly'
      ? `WEEKLY COMPARISON: ${file1Label}  -->  ${file2Label}`
      : viewMode === 'monthly'
      ? `MONTHLY COMPARISON: ${file1Label}  -->  ${file2Label}`
      : 'OVERALL CONSTRUCTION STATUS';

  const currHighlight =
    viewMode === 'monthly'
      ? colors.thisMonthHighlight
      : colors.thisWeekHighlight;

  const getLayerFill = (
    shaft: ShaftRecord,
    layerIndex: number,
    bSnap?: ShaftSnapshotItem
  ): string | null => {
    if (!shaft.layerFlags[layerIndex]) return null;
    if (viewMode === 'overall') return colors.overallShaft;
    const prevDone = Boolean(bSnap?.layerFlags?.[layerIndex]);
    if (prevDone) {
      return viewMode === 'weekly'
        ? colors.prevWeekShaft
        : colors.prevMonthShaft;
    }
    return currHighlight;
  };

  const getBottomSlabFill = (
    shaft: ShaftRecord,
    bSnap?: ShaftSnapshotItem
  ): string | null => {
    if (!shaft.bottomSlabDone) return null;
    if (viewMode === 'overall') return colors.overallShaft;
    if (bSnap?.bottomSlabDone) {
      return viewMode === 'weekly'
        ? colors.prevWeekShaft
        : colors.prevMonthShaft;
    }
    return currHighlight;
  };

  const statusBadgeColor = (st: 'remaining' | 'ongoing' | 'complete') => {
    if (st === 'complete') return '#16a34a';
    if (st === 'ongoing') return '#f59e0b';
    return '#dc2626';
  };

  // Render horizontal tunnel bar (supports full 10..100 or split wrap 10..50 / 60..100)
  const renderTunnelBar = (
    shaft: ShaftRecord,
    xStart: number,
    yTop: number,
    totalWidth: number,
    pctFrom: number,
    pctTo: number,
    captionMode: 'full' | 'exit' | 'entry' | 'pump'
  ) => {
    const bSnap = baseline.shafts[shaft.id];
    const prevPct =
      viewMode === 'overall'
        ? shaft.tunnelPct
        : Math.min(shaft.tunnelPct, bSnap?.tunnelPct ?? 0);
    const currPct = shaft.tunnelPct;

    const prevColor =
      viewMode === 'overall'
        ? colors.overallTunnel
        : viewMode === 'weekly'
        ? colors.prevWeekTunnel
        : colors.prevMonthTunnel;

    const spanPct = pctTo - pctFrom + 10;
    const boxCount = spanPct / 10;
    const boxW = totalWidth / boxCount;
    const barH = 14;

    const rangeStart = pctFrom - 10;
    const clampRange = (p: number) =>
      Math.max(0, Math.min(spanPct, p - rangeStart));

    const prevW = (clampRange(prevPct) / spanPct) * totalWidth;
    const currW = (clampRange(currPct) / spanPct) * totalWidth;
    const deltaPct =
      viewMode === 'overall' ? 0 : Math.max(0, currPct - (bSnap?.tunnelPct ?? 0));

    const boxes = [];
    for (let i = 0; i < boxCount; i++) {
      const pVal = pctFrom + i * 10;
      const bx = xStart + i * boxW;
      const isDarkBg = pVal <= currPct;
      boxes.push(
        <g key={pVal}>
          <line
            x1={bx}
            y1={yTop}
            x2={bx}
            y2={yTop + barH}
            stroke="#1e3a8a"
            strokeWidth={0.65}
          />
          <text
            x={bx + boxW / 2}
            y={yTop + 9.5}
            textAnchor="middle"
            fontSize={4.6}
            fontWeight="700"
            fill={isDarkBg ? '#ffffff' : '#1e3a8a'}
          >
            {pVal}%
          </text>
        </g>
      );
    }

    const captionCenterX = xStart + totalWidth / 2;

    return (
      <g
        style={{ cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          onSelectShaft(shaft.id, 'tunnel');
        }}
      >
        <rect
          x={xStart}
          y={yTop}
          width={totalWidth}
          height={barH}
          fill="#ffffff"
          stroke="#1e3a8a"
          strokeWidth={0.8}
        />
        {prevW > 0 && (
          <rect
            x={xStart}
            y={yTop + 0.4}
            width={prevW}
            height={barH - 0.8}
            fill={prevColor}
          />
        )}
        {viewMode !== 'overall' && currW > prevW && (
          <rect
            x={xStart + prevW}
            y={yTop + 0.4}
            width={currW - prevW}
            height={barH - 0.8}
            fill={currHighlight}
          />
        )}
        {boxes}
        <rect
          x={xStart}
          y={yTop}
          width={totalWidth}
          height={barH}
          fill="none"
          stroke="#1e3a8a"
          strokeWidth={0.8}
        />

        {captionMode === 'full' && (
          <g>
            <text
              x={captionCenterX}
              y={yTop + 21.5}
              textAnchor="middle"
              fontSize={5.0}
              fontWeight="600"
              fill="#1e3a8a"
            >
              {shaft.tunnelPct >= 100 ? 'Completed (%)' : 'Micro-Tunnelling (%)'}
              {deltaPct > 0 ? ` [+${deltaPct}%]` : ''}
            </text>
            <text
              x={captionCenterX}
              y={yTop + 28.5}
              textAnchor="middle"
              fontSize={5.2}
              fontWeight="700"
              fill="#1e3a8a"
            >
              ({shaft.pipeDia}: {shaft.tunnelLengthM}m)
            </text>
          </g>
        )}

        {captionMode === 'exit' && (
          <g>
            <text
              x={captionCenterX}
              y={yTop + 21.5}
              textAnchor="middle"
              fontSize={4.7}
              fontWeight="700"
              fill="#1e3a8a"
            >
              To {shaft.nextId}
              {deltaPct > 0 ? ` [+${deltaPct}%]` : ''}
            </text>
            <text
              x={captionCenterX}
              y={yTop + 28.5}
              textAnchor="middle"
              fontSize={4.8}
              fontWeight="700"
              fill="#1e3a8a"
            >
              ({shaft.pipeDia}: {shaft.tunnelLengthM}m)
            </text>
          </g>
        )}

        {captionMode === 'entry' && (
          <g>
            <text
              x={captionCenterX}
              y={yTop + 21.5}
              textAnchor="middle"
              fontSize={4.7}
              fontWeight="700"
              fill="#1e3a8a"
            >
              From {shaft.id}
            </text>
            <text
              x={captionCenterX}
              y={yTop + 28.5}
              textAnchor="middle"
              fontSize={4.6}
              fontWeight="600"
              fill="#475569"
            >
              ({shaft.pipeDia}: {shaft.tunnelLengthM}m)
            </text>
          </g>
        )}

        {captionMode === 'pump' && (
          <g>
            <text
              x={captionCenterX}
              y={yTop + 21.5}
              textAnchor="middle"
              fontSize={4.9}
              fontWeight="600"
              fill="#1e3a8a"
            >
              To Pump Station{deltaPct > 0 ? ` [+${deltaPct}%]` : ''}
            </text>
            <text
              x={captionCenterX}
              y={yTop + 28.5}
              textAnchor="middle"
              fontSize={5.1}
              fontWeight="700"
              fill="#1e3a8a"
            >
              ({shaft.pipeDia}: {shaft.tunnelLengthM}m)
            </text>
          </g>
        )}
      </g>
    );
  };

  // Render 2-Part Golapbag SPS Pump Station (Lower 5-Layer Main Caisson + Upper Machine Room)
  const renderPumpStation = (
    ps: PumpStationData,
    x: number,
    y: number,
    w: number
  ) => {
    const isPumpSelected = selectedShaftId === 'PUMP_STATION';
    const structX = x + 16;
    const structW = Math.min(182, w * 0.45);

    // Vertical geometry inside Row 4 (total row height = 232)
    // Upper Part: Machine Room (+7.000 to +19.500 PWD)
    const mrTopY = y + 20;
    const mrH = 58;
    const groundY = mrTopY + mrH; // +7.000 PWD / Road Level

    // Lower Part: Main Pump Station Structure (-13.000 to +6.550 PWD, 5 Layers)
    const subTopY = groundY;
    const subH = 114; // ends at y + 192
    const shoeH = 16;
    const bodyH = subH - shoeH; // 98 -> 19.6 per layer across 5 layers
    const layerH = bodyH / Math.max(1, ps.layers.length);

    const tblX = structX + structW + 10;
    const tblW = Math.max(122, x + w - tblX - 4);

    // Status color resolver for Pump Station elements
    const resolvePumpFill = (
      status: 'remaining' | 'ongoing' | 'complete',
      prevDone: boolean
    ): { fill: string; stroke: string; badgeBg: string; badgeText: string } => {
      if (status === 'complete') {
        const fill =
          viewMode === 'overall'
            ? colors.overallShaft
            : prevDone
            ? viewMode === 'weekly'
              ? colors.prevWeekShaft
              : colors.prevMonthShaft
            : currHighlight;
        return {
          fill,
          stroke: '#14532d',
          badgeBg: '#dcfce7',
          badgeText: '#15803d',
        };
      }
      if (status === 'ongoing') {
        return {
          fill: '#fbbf24',
          stroke: '#b45309',
          badgeBg: '#fef3c7',
          badgeText: '#b45309',
        };
      }
      return {
        fill: '#ffffff',
        stroke: colors.remainingOutline,
        badgeBg: '#fef2f2',
        badgeText: '#dc2626',
      };
    };

    const mrVisual = resolvePumpFill(
      ps.machineRoom.status,
      baseline.pumpMachineRoomStatus === 'complete'
    );
    const lowerStatus = getPumpLowerStatus(ps);
    const mrDur = calcDurationDays(ps.machineRoom.sDate, ps.machineRoom.eDate);

    // Machine Room Level 2 (Control Room + Food & Tea, top 24u) & Level 1 (Storage + Pump House, lower 34u)
    const lvl2H = 24;
    const lvl1Y = mrTopY + lvl2H;
    const lvl1H = mrH - lvl2H;
    const midX = structX + structW * 0.52;
    const leftAnnexW = 14;

    return (
      <g
        style={{ cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          onSelectShaft('PUMP_STATION', 'shaft');
        }}
      >
        {/* Selection highlight */}
        {isPumpSelected && (
          <rect
            data-selection-ring="true"
            x={x + 1}
            y={y + 1}
            width={w - 3}
            height={224}
            rx={4}
            fill="#eff6ff"
            fillOpacity={0.35}
            stroke="#2563eb"
            strokeWidth={1.6}
            strokeDasharray="4,2"
          />
        )}

        {/* Title */}
        <text
          x={x + w * 0.48}
          y={y + 12}
          textAnchor="middle"
          fontSize={9.2}
          fontWeight="700"
          fill="#0f172a"
        >
          Pump Station (Golapbag SPS - Sec 1-1)
        </text>

        {/* ================= UPPER PART: MACHINE ROOM ================= */}
        {/* Side entrance canopy on left (Sec 1-1) */}
        <polygon
          points={`${structX - leftAnnexW},${groundY - 17} ${structX},${groundY - 22} ${structX},${groundY} ${structX - leftAnnexW},${groundY}`}
          fill={mrVisual.fill}
          fillOpacity={ps.machineRoom.status === 'remaining' ? 1 : 0.78}
          stroke={mrVisual.stroke}
          strokeWidth={0.75}
        />

        {/* Level 2: Control Room + Food & Tea (+14.400 to +19.500) */}
        <rect
          x={structX + 8}
          y={mrTopY}
          width={structW - 8}
          height={lvl2H}
          fill={mrVisual.fill}
          fillOpacity={ps.machineRoom.status === 'remaining' ? 1 : 0.85}
          stroke={mrVisual.stroke}
          strokeWidth={0.9}
        />
        {/* Parapet roof cap */}
        <rect
          x={structX + 6}
          y={mrTopY - 2.5}
          width={structW - 4}
          height={3.2}
          fill={ps.machineRoom.status === 'remaining' ? '#e2e8f0' : mrVisual.stroke}
          stroke={mrVisual.stroke}
          strokeWidth={0.55}
        />

        {/* Level 1: Storage Room & Pump House (+7.000 to +14.400) */}
        <rect
          x={structX}
          y={lvl1Y}
          width={structW}
          height={lvl1H}
          fill={mrVisual.fill}
          fillOpacity={ps.machineRoom.status === 'remaining' ? 1 : 0.88}
          stroke={mrVisual.stroke}
          strokeWidth={0.95}
        />

        {/* Interior architectural room partitions (Grid 2 dividing wall + floor slab) */}
        <line
          x1={midX}
          y1={mrTopY}
          x2={midX}
          y2={groundY}
          stroke={mrVisual.stroke}
          strokeWidth={0.7}
        />
        <line
          x1={structX + 8}
          y1={lvl1Y}
          x2={midX}
          y2={lvl1Y}
          stroke={mrVisual.stroke}
          strokeWidth={0.8}
        />
        {/* Tiny window silhouettes */}
        {[structX + 20, structX + 42, midX + 14, midX + 38, midX + 60].map((wx, wi) => (
          <rect
            key={wi}
            x={wx}
            y={mrTopY + 6}
            width={11}
            height={9}
            fill="#ffffff"
            fillOpacity={0.75}
            stroke={mrVisual.stroke}
            strokeWidth={0.45}
          />
        ))}
        {/* Crane / Pump House high-bay beam & room tags */}
        <text
          x={structX + 8 + (midX - structX - 8) / 2}
          y={mrTopY + 21}
          textAnchor="middle"
          fontSize={3.9}
          fontWeight="700"
          fill="#0f172a"
        >
          Control
        </text>
        <text
          x={midX + (structX + structW - midX) / 2}
          y={mrTopY + 21}
          textAnchor="middle"
          fontSize={3.9}
          fontWeight="700"
          fill="#0f172a"
        >
          Food/Tea
        </text>
        <text
          x={structX + (midX - structX) / 2}
          y={lvl1Y + 13}
          textAnchor="middle"
          fontSize={4.2}
          fontWeight="700"
          fill="#0f172a"
        >
          Storage
        </text>
        <text
          x={midX + (structX + structW - midX) / 2}
          y={lvl1Y + 13}
          textAnchor="middle"
          fontSize={4.2}
          fontWeight="700"
          fill="#0f172a"
        >
          Pump House
        </text>

        {/* Machine Room Center Status Badge */}
        <rect
          x={structX + structW * 0.16}
          y={lvl1Y + 18}
          width={structW * 0.68}
          height={12}
          rx={2}
          fill="#ffffff"
          fillOpacity={0.92}
          stroke={mrVisual.stroke}
          strokeWidth={0.6}
        />
        <text
          x={structX + structW * 0.5}
          y={lvl1Y + 26.2}
          textAnchor="middle"
          fontSize={4.6}
          fontWeight="700"
          fill={mrVisual.badgeText}
        >
          MACHINE ROOM: {ps.machineRoom.status.toUpperCase()}
        </text>

        {/* Ground / Road Slab Datum Line (+7.000 PWD) */}
        <line
          x1={structX - leftAnnexW - 4}
          y1={groundY}
          x2={structX + structW + 6}
          y2={groundY}
          stroke="#1e293b"
          strokeWidth={1.1}
        />
        <text
          x={structX - leftAnnexW - 3}
          y={groundY + 6.5}
          fontSize={3.8}
          fontWeight="700"
          fill="#475569"
        >
          +7.0m
        </text>

        {/* ================= LOWER PART: MAIN PUMP STRUCTURE (5 LAYERS) ================= */}
        {/* Background shaft interior */}
        <rect
          x={structX}
          y={subTopY}
          width={structW}
          height={bodyH}
          fill="#f8fafc"
          stroke="#64748b"
          strokeWidth={0.5}
        />

        {/* Render each of 5 horizontal construction layers */}
        {ps.layers.map((ly, li) => {
          const lyY = subTopY + li * layerH;
          const prevDone = Boolean(baseline.pumpLayersDone?.[li]);
          const vis = resolvePumpFill(ly.status, prevDone);
          const wallW = 12;
          const innerMidX = structX + structW / 2 - 4.5;
          const partWallX = structX + structW * 0.27;

          return (
            <g key={ly.name}>
              {/* Layer light band fill */}
              <rect
                x={structX + wallW}
                y={lyY}
                width={structW - wallW * 2}
                height={layerH}
                fill={vis.fill}
                fillOpacity={ly.status === 'remaining' ? 0.15 : 0.2}
              />
              {/* Left Caisson Wall (Grid 1) */}
              <rect
                x={structX}
                y={lyY}
                width={wallW}
                height={layerH - 0.5}
                fill={vis.fill}
                stroke={vis.stroke}
                strokeWidth={0.65}
              />
              {/* Right Caisson Wall (Grid 3) */}
              <rect
                x={structX + structW - wallW}
                y={lyY}
                width={wallW}
                height={layerH - 0.5}
                fill={vis.fill}
                stroke={vis.stroke}
                strokeWidth={0.65}
              />
              {/* Central Dividing Wall (Grid 2) */}
              <rect
                x={innerMidX}
                y={lyY}
                width={9}
                height={layerH - 0.5}
                fill={vis.fill}
                stroke={vis.stroke}
                strokeWidth={0.55}
              />
              {/* Intermediate inner partition/slab at layers 1, 3, 5 */}
              {(li === 0 || li === 2 || li === 4) && (
                <rect
                  x={structX + wallW}
                  y={lyY + layerH - 4.5}
                  width={structW - wallW * 2}
                  height={4.2}
                  fill={vis.fill}
                  stroke={vis.stroke}
                  strokeWidth={0.5}
                />
              )}
              {li >= 2 && (
                <rect
                  x={partWallX}
                  y={lyY}
                  width={5}
                  height={layerH - 0.5}
                  fill={vis.fill}
                  stroke={vis.stroke}
                  strokeWidth={0.45}
                />
              )}
              {/* Layer dashed separation & L1..L5 label */}
              <line
                x1={structX}
                y1={lyY + layerH}
                x2={structX + structW}
                y2={lyY + layerH}
                stroke="#475569"
                strokeWidth={0.4}
                strokeDasharray="2,1.5"
              />
              <text
                x={structX - 2.5}
                y={lyY + layerH * 0.68}
                textAnchor="end"
                fontSize={4.4}
                fontWeight="700"
                fill={vis.badgeText}
              >
                L{li + 1}
              </text>
            </g>
          );
        })}

        {/* Cutting Shoe & Base Plug / Tremie Slab (-13.000 to -9.300 PWD) */}
        {(() => {
          const shoeY = subTopY + bodyH;
          const shoeVis = resolvePumpFill(
            ps.layers[4]?.status ?? 'remaining',
            Boolean(baseline.pumpLayersDone?.[4])
          );
          return (
            <g>
              {/* Left cutting shoe bevel */}
              <polygon
                points={`${structX},${shoeY} ${structX + 18},${shoeY} ${structX + 10},${shoeY + shoeH} ${structX},${shoeY + shoeH}`}
                fill={shoeVis.fill}
                stroke={shoeVis.stroke}
                strokeWidth={0.7}
              />
              {/* Right cutting shoe bevel */}
              <polygon
                points={`${structX + structW - 18},${shoeY} ${structX + structW},${shoeY} ${structX + structW},${shoeY + shoeH} ${structX + structW - 10},${shoeY + shoeH}`}
                fill={shoeVis.fill}
                stroke={shoeVis.stroke}
                strokeWidth={0.7}
              />
              {/* Bottom tremie plug slab */}
              <rect
                x={structX + 10}
                y={shoeY + 3}
                width={structW - 20}
                height={shoeH - 3}
                fill={lowerStatus === 'complete' ? '#dcfce7' : '#fee2e2'}
                stroke={lowerStatus === 'complete' ? '#15803d' : '#dc2626'}
                strokeWidth={0.7}
              />
              <text
                x={structX + structW / 2}
                y={shoeY + 12.2}
                textAnchor="middle"
                fontSize={4.6}
                fontWeight="700"
                fill={lowerStatus === 'complete' ? '#166534' : '#991b1b'}
              >
                BASE PLUG / CUTTING SHOE (-13.0m)
              </text>
            </g>
          );
        })()}

        {/* Lower Structural Summary Captions */}
        <text
          x={structX + structW / 2}
          y={subTopY + subH + 10.5}
          textAnchor="middle"
          fontSize={5.4}
          fontWeight="700"
          fill="#1e3a8a"
        >
          Total H: {ps.totalHeightM}m | Casting: {ps.castingCompleteM}m
        </text>
        <text
          x={structX + structW / 2}
          y={subTopY + subH + 19}
          textAnchor="middle"
          fontSize={5.4}
          fontWeight="700"
          fill="#0f766e"
        >
          Sinking Complete: {ps.sinkingCompletedM}m
        </text>

        {/* ================= RIGHT SIDE 2-PART STATUS TABLE ================= */}
        <g>
          {/* PART 1: UPPER MACHINE ROOM */}
          <rect
            x={tblX}
            y={y + 20}
            width={tblW}
            height={34}
            fill="#ffffff"
            stroke="#1e3a8a"
            strokeWidth={0.75}
          />
          <rect
            x={tblX}
            y={y + 20}
            width={tblW}
            height={12}
            fill="#eff6ff"
            stroke="#1e3a8a"
            strokeWidth={0.6}
          />
          <text x={tblX + 4} y={y + 28.5} fontSize={4.8} fontWeight="700" fill="#1e3a8a">
            UPPER: MACHINE ROOM
          </text>
          <rect
            x={tblX + tblW - 46}
            y={y + 21.5}
            width={43}
            height={9}
            rx={1.5}
            fill={mrVisual.badgeBg}
            stroke={mrVisual.badgeText}
            strokeWidth={0.45}
          />
          <text
            x={tblX + tblW - 24.5}
            y={y + 27.8}
            textAnchor="middle"
            fontSize={4.3}
            fontWeight="700"
            fill={mrVisual.badgeText}
          >
            {ps.machineRoom.status.toUpperCase()}
          </text>
          <text x={tblX + 4} y={y + 41} fontSize={4.8} fill="#334155">
            S: {formatDateDisplay(ps.machineRoom.sDate)}   |   E: {ps.machineRoom.eDate ? formatDateDisplay(ps.machineRoom.eDate) : ps.machineRoom.status === 'ongoing' ? 'On-going' : '-'}
          </text>
          <text x={tblX + 4} y={y + 50} fontSize={4.8} fontWeight="700" fill={mrVisual.badgeText}>
            Duration: {mrDur !== null ? `${mrDur} Days` : ps.machineRoom.status === 'ongoing' ? 'On-going' : 'Remaining'}
          </text>

          {/* PART 2: LOWER MAIN PUMP STATION (5 LAYERS) */}
          <text
            x={tblX + tblW / 2}
            y={y + 62}
            textAnchor="middle"
            fontSize={5.2}
            fontWeight="700"
            fill="#1e3a8a"
          >
            LOWER: MAIN PUMP STRUCTURE (5 LAYERS)
          </text>
          <rect
            x={tblX}
            y={y + 65}
            width={tblW}
            height={120}
            fill="#ffffff"
            stroke="#1e3a8a"
            strokeWidth={0.75}
          />
          {ps.layers.map((ly, li) => {
            const rowY = y + 65 + li * 24;
            const dur = calcDurationDays(ly.sDate, ly.eDate);
            const vis = resolvePumpFill(ly.status, Boolean(baseline.pumpLayersDone?.[li]));
            return (
              <g key={ly.name}>
                {li > 0 && (
                  <line
                    x1={tblX}
                    y1={rowY}
                    x2={tblX + tblW}
                    y2={rowY}
                    stroke="#1e3a8a"
                    strokeWidth={0.55}
                  />
                )}
                <rect
                  x={tblX}
                  y={rowY}
                  width={42}
                  height={24}
                  fill={vis.badgeBg}
                  stroke="#1e3a8a"
                  strokeWidth={0.5}
                />
                <text
                  x={tblX + 21}
                  y={rowY + 14}
                  textAnchor="middle"
                  fontSize={5.0}
                  fontWeight="700"
                  fill={vis.badgeText}
                >
                  {ly.name}
                </text>
                <text x={tblX + 46} y={rowY + 9.5} fontSize={4.6} fill="#334155">
                  S: {formatDateDisplay(ly.sDate)}  |  E: {ly.eDate ? formatDateDisplay(ly.eDate) : ly.status === 'ongoing' ? 'On-going' : '-'}
                </text>
                <text x={tblX + 46} y={rowY + 19} fontSize={4.6} fontWeight="700" fill={vis.badgeText}>
                  Dur: {dur !== null ? `${dur} Days` : '-'}  ({ly.status.toUpperCase()})
                </text>
              </g>
            );
          })}

          {/* LOWER LENGTHS SUMMARY BOX */}
          <rect
            x={tblX}
            y={y + 189}
            width={tblW}
            height={28}
            fill="#f8fafc"
            stroke="#1e3a8a"
            strokeWidth={0.65}
          />
          <text x={tblX + 5} y={y + 200} fontSize={4.9} fontWeight="700" fill="#1e3a8a">
            Total Height: {ps.totalHeightM}m  |  Casting: {ps.castingCompleteM}m
          </text>
          <text x={tblX + 5} y={y + 211} fontSize={4.9} fontWeight="700" fill="#0f766e">
            Sinking Complete: {ps.sinkingCompletedM}m  (Click to Edit)
          </text>
        </g>
      </g>
    );
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${SHEET_W} ${SHEET_H}`}
      className="print-sheet-svg w-full h-auto bg-white select-none"
      style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
    >
      {/* Clean A1 White Page Background */}
      <rect x={0} y={0} width={SHEET_W} height={SHEET_H} fill="#ffffff" />

      {/* Outer A1 Engineering Frame */}
      <rect
        x={12}
        y={12}
        width={SHEET_W - 24}
        height={SHEET_H - 24}
        fill="none"
        stroke="#1e3a8a"
        strokeWidth={1.6}
      />
      <rect
        x={16}
        y={16}
        width={SHEET_W - 32}
        height={SHEET_H - 32}
        fill="none"
        stroke="#1e3a8a"
        strokeWidth={0.7}
      />

      {/* Top Title Header Strip */}
      <rect
        x={16}
        y={16}
        width={SHEET_W - 32}
        height={38}
        fill="#f8fafc"
        stroke="#1e3a8a"
        strokeWidth={0.8}
      />
      <text x={28} y={33} fontSize={11.5} fontWeight="700" fill="#0f172a">
        {settings.sectionTitle}
      </text>
      <text x={28} y={47} fontSize={7.5} fontWeight="600" fill="#475569">
        {settings.projectTitle}  |  Total Shafts: {summary.totalShafts} (WA-01 to WA-36 incl. WA-24.1)  |  Sheet: A1 Landscape (841 x 594 mm)
      </text>

      {/* Active Mode Banner Pill on Right */}
      <rect
        x={1060}
        y={22}
        width={592}
        height={26}
        rx={3}
        fill={
          viewMode === 'weekly'
            ? '#fffbeb'
            : viewMode === 'monthly'
            ? '#ecfeff'
            : '#f0fdf4'
        }
        stroke={
          viewMode === 'weekly'
            ? '#d97706'
            : viewMode === 'monthly'
            ? '#0891b2'
            : '#16a34a'
        }
        strokeWidth={1.1}
      />
      <text
        x={1356}
        y={34}
        textAnchor="middle"
        fontSize={8}
        fontWeight="700"
        fill="#0f172a"
      >
        {activePeriodLabel}
      </text>
      <text
        x={1356}
        y={44}
        textAnchor="middle"
        fontSize={6.6}
        fontWeight="600"
        fill="#475569"
      >
        Report Date: {formatDateDisplay(settings.reportDate)}  |  Drawing No: {settings.drawingNo} ({settings.revision})
      </text>

      {/* Subtle horizontal row divider guides */}
      {[1, 2, 3].map((r) => (
        <line
          key={r}
          x1={20}
          y1={gridY + r * rowH - 3}
          x2={SHEET_W - 20}
          y2={gridY + r * rowH - 3}
          stroke="#e2e8f0"
          strokeWidth={0.7}
          strokeDasharray="4,4"
        />
      ))}

      {/* Render All 37 Shafts */}
      {shafts.map((s, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const cellX = gridX + col * colW;
        const cellY = gridY + row * rowH;

        const bSnap = baseline.shafts[s.id];
        const shStatus = getShaftStatus(s);
        const mhStatus = getManholeStatus(s);
        const mtStatus = getTunnelStatus(s);
        const shDur = calcDurationDays(s.shaftSDate, s.shaftEDate);
        const mtDur = calcDurationDays(s.tunnelSDate, s.tunnelEDate);
        const mhDur = calcDurationDays(s.manholeSDate, s.manholeEDate);
        const shDoneLayers = getShaftCompletedLayersCount(s);

        const isSelected = s.id === selectedShaftId;

        // Cross section local coords (with 15-unit gap between tbl and left wall for W1..W13 labels!)
        const tblW = 70 * sx;
        const wallLeftX = 87 * sx;
        const wallThick = 7.5 * sx;
        const innerX = wallLeftX + wallThick;
        const innerW = 34 * sx;
        const wallRightX = innerX + innerW;
        const shaftTopY = 63;
        const wallH = 116;
        const botSlabH = 7;
        const layerH = wallH / s.totalLayers;

        // Manhole 2 parts inside shaft interior
        const mhW = 20 * sx;
        const mhX = innerX + (innerW - mhW) / 2;
        const precastY = shaftTopY + 1;
        const precastH = 49;
        const castingY = precastY + precastH;
        const castingH = wallH - precastH - 2;

        const mhPrevColor =
          viewMode === 'overall'
            ? colors.overallCasting
            : viewMode === 'weekly'
            ? colors.prevWeekManhole
            : colors.prevMonthManhole;
        const precastBaseColor =
          viewMode === 'overall'
            ? colors.overallPrecast
            : viewMode === 'weekly'
            ? colors.prevWeekManhole
            : colors.prevMonthManhole;

        const prevCastPct =
          viewMode === 'overall'
            ? s.castingPct
            : Math.min(s.castingPct, bSnap?.castingPct ?? 0);
        const currCastPct = s.castingPct;

        const prevPrePct =
          viewMode === 'overall'
            ? s.precastPct
            : Math.min(s.precastPct, bSnap?.precastPct ?? 0);
        const currPrePct = s.precastPct;

        const isLastInRow = col === cols - 1;
        const isLastShaft = idx === shafts.length - 1;
        const tunnelBarY = shaftTopY + wallH - 17;

        return (
          <g
            key={s.id}
            transform={`translate(${cellX}, ${cellY})`}
            style={{ cursor: 'pointer' }}
            onClick={() => onSelectShaft(s.id, 'shaft')}
          >
            {/* Selection highlight frame (excluded on export) */}
            {isSelected && (
              <rect
                data-selection-ring="true"
                x={1}
                y={1}
                width={colW - 2}
                height={rowH - 8}
                rx={4}
                fill="#eff6ff"
                fillOpacity={0.35}
                stroke="#2563eb"
                strokeWidth={1.6}
                strokeDasharray="4,2"
              />
            )}

            {/* Shaft Title (always dark slate in SVG so exports never look selected) */}
            <text
              x={colW * 0.56}
              y={13}
              textAnchor="middle"
              fontSize={9.6 * Math.max(0.88, sx)}
              fontWeight="700"
              fill="#0f172a"
            >
              Shaft {s.id}
            </text>

            {/* Layer progress mini badge top-right */}
            <text
              x={colW - 4}
              y={12}
              textAnchor="end"
              fontSize={5.2}
              fontWeight="700"
              fill={statusBadgeColor(shStatus)}
            >
              L:{shDoneLayers}/{s.totalLayers}
            </text>

            {/* --- LEFT DESCRIPTIONS & STATUS TABLES --- */}
            <g transform="translate(2, 18)">
              <text
                x={tblW / 2}
                y={5}
                textAnchor="middle"
                fontSize={5.2}
                fontWeight="700"
                fill="#1e3a8a"
                textDecoration="underline"
              >
                Shaft Descriptions:
              </text>
              <rect
                x={0}
                y={7}
                width={tblW}
                height={36}
                fill="#ffffff"
                stroke="#1e3a8a"
                strokeWidth={0.65}
              />
              <line x1={30 * sx} y1={7} x2={30 * sx} y2={43} stroke="#1e3a8a" strokeWidth={0.5} />
              {[1, 2, 3].map((r) => (
                <line
                  key={r}
                  x1={0}
                  y1={7 + r * 9}
                  x2={tblW}
                  y2={7 + r * 9}
                  stroke="#1e3a8a"
                  strokeWidth={0.5}
                />
              ))}
              <text x={2} y={13.5} fontSize={4.5} fill="#1e3a8a">Shaft Size</text>
              <text x={30 * sx + (tblW - 30 * sx) / 2} y={13.5} textAnchor="middle" fontSize={5.0} fontWeight="600" fill="#0f172a">{s.shaftSize}</text>

              <text x={2} y={22.5} fontSize={4.5} fill="#1e3a8a">Type</text>
              <text x={30 * sx + (tblW - 30 * sx) / 2} y={22.5} textAnchor="middle" fontSize={4.6} fontWeight="600" fill="#0f172a">{trunc(s.shaftType, 14)}</text>

              <text x={2} y={31.5} fontSize={4.5} fill="#1e3a8a">Net Height</text>
              <text x={30 * sx + (tblW - 30 * sx) / 2} y={31.5} textAnchor="middle" fontSize={5.0} fontWeight="600" fill="#0f172a">{s.netHeightMm}</text>

              <text x={2} y={40.5} fontSize={4.5} fill="#1e3a8a">Bot. Slab</text>
              <text x={30 * sx + (tblW - 30 * sx) / 2} y={40.5} textAnchor="middle" fontSize={5.0} fontWeight="600" fill="#0f172a">{s.bottomSlabMm}</text>

              {/* Construction Status Table */}
              <text
                x={tblW / 2}
                y={50}
                textAnchor="middle"
                fontSize={5.2}
                fontWeight="700"
                fill="#1e3a8a"
                textDecoration="underline"
              >
                Construction Status
              </text>
              <rect
                x={0}
                y={52}
                width={tblW}
                height={81}
                fill="#ffffff"
                stroke="#1e3a8a"
                strokeWidth={0.65}
              />
              <line x1={11.5 * sx} y1={52} x2={11.5 * sx} y2={133} stroke="#1e3a8a" strokeWidth={0.5} />
              <line x1={30 * sx} y1={52} x2={30 * sx} y2={133} stroke="#1e3a8a" strokeWidth={0.5} />

              {[
                {
                  name: 'Shaft',
                  y: 52,
                  st: shStatus,
                  sD: formatDateDisplay(s.shaftSDate),
                  eD: s.shaftEDate ? formatDateDisplay(s.shaftEDate) : shStatus === 'ongoing' ? 'On-going' : '',
                  dur: shDur !== null ? `${shDur} Days` : shStatus === 'ongoing' ? 'On-going' : 'Rem.',
                },
                {
                  name: 'Tunnel',
                  y: 79,
                  st: mtStatus,
                  sD: formatDateDisplay(s.tunnelSDate),
                  eD: s.tunnelEDate ? formatDateDisplay(s.tunnelEDate) : mtStatus === 'ongoing' ? 'On-going' : '',
                  dur: mtDur !== null ? `${mtDur} Days` : mtStatus === 'ongoing' ? 'On-going' : 'Rem.',
                },
                {
                  name: 'Manhole',
                  y: 106,
                  st: mhStatus,
                  sD: formatDateDisplay(s.manholeSDate),
                  eD: s.manholeEDate ? formatDateDisplay(s.manholeEDate) : mhStatus === 'ongoing' ? 'On-going' : '',
                  dur: mhDur !== null ? `${mhDur} Days` : mhStatus === 'ongoing' ? 'On-going' : 'Rem.',
                },
              ].map((grp, gi) => (
                <g key={grp.name}>
                  {gi > 0 && (
                    <line x1={0} y1={grp.y} x2={tblW} y2={grp.y} stroke="#1e3a8a" strokeWidth={0.75} />
                  )}
                  <rect x={0.5} y={grp.y + 0.5} width={2.8} height={26} fill={statusBadgeColor(grp.st)} />
                  <line x1={11.5 * sx} y1={grp.y + 9} x2={tblW} y2={grp.y + 9} stroke="#94a3b8" strokeWidth={0.4} />
                  <line x1={11.5 * sx} y1={grp.y + 18} x2={tblW} y2={grp.y + 18} stroke="#94a3b8" strokeWidth={0.4} />

                  <text
                    x={7.2 * sx}
                    y={grp.y + 13.5}
                    textAnchor="middle"
                    fontSize={4.3}
                    fontWeight="700"
                    fill="#1e3a8a"
                    transform={`rotate(-90, ${7.2 * sx}, ${grp.y + 13.5})`}
                  >
                    {grp.name}
                  </text>

                  <text x={13 * sx} y={grp.y + 6.5} fontSize={4.2} fill="#334155">S.Date</text>
                  <text x={30 * sx + (tblW - 30 * sx) / 2} y={grp.y + 6.5} textAnchor="middle" fontSize={4.7} fill="#0f172a">{grp.sD}</text>

                  <text x={13 * sx} y={grp.y + 15.5} fontSize={4.2} fill="#334155">E.Date</text>
                  <text
                    x={30 * sx + (tblW - 30 * sx) / 2}
                    y={grp.y + 15.5}
                    textAnchor="middle"
                    fontSize={4.6}
                    fontWeight={grp.eD === 'On-going' ? '700' : '400'}
                    fill={grp.eD === 'On-going' ? '#d97706' : '#0f172a'}
                  >
                    {grp.eD}
                  </text>

                  <text x={13 * sx} y={grp.y + 24.5} fontSize={4.2} fill="#334155">Dur.</text>
                  <text
                    x={30 * sx + (tblW - 30 * sx) / 2}
                    y={grp.y + 24.5}
                    textAnchor="middle"
                    fontSize={4.5}
                    fontWeight="700"
                    fill={
                      grp.st === 'complete'
                        ? '#15803d'
                        : grp.st === 'ongoing'
                        ? '#b45309'
                        : '#94a3b8'
                    }
                  >
                    {grp.dur}
                  </text>
                </g>
              ))}
            </g>

            {/* --- RIGHT CROSS SECTION DIAGRAM --- */}
            {/* Road Level datum */}
            <line
              x1={wallLeftX - 5}
              y1={shaftTopY}
              x2={wallRightX + wallThick + 10}
              y2={shaftTopY}
              stroke="#475569"
              strokeWidth={0.7}
            />
            <polygon
              points={`${innerX + innerW / 2 - 3},${shaftTopY - 4} ${innerX + innerW / 2 + 3},${shaftTopY - 4} ${innerX + innerW / 2},${shaftTopY}`}
              fill="#64748b"
            />
            <text
              x={innerX + innerW / 2 + 5}
              y={shaftTopY - 2}
              fontSize={5.0}
              fontWeight="700"
              fill="#334155"
            >
              Road Level
            </text>

            {/* Shaft Outer Lip */}
            <rect
              x={wallLeftX - 2.5}
              y={shaftTopY}
              width={wallThick + 2.5}
              height={3}
              fill={getLayerFill(s, 0, bSnap) ?? '#ffffff'}
              stroke={getLayerFill(s, 0, bSnap) ? '#14532d' : colors.remainingOutline}
              strokeWidth={0.5}
            />
            <rect
              x={wallRightX}
              y={shaftTopY}
              width={wallThick + 2.5}
              height={3}
              fill={getLayerFill(s, 0, bSnap) ?? '#ffffff'}
              stroke={getLayerFill(s, 0, bSnap) ? '#14532d' : colors.remainingOutline}
              strokeWidth={0.5}
            />

            {/* Dynamic W1..WN Shaft Layers (6 to 13) — Labels placed cleanly on LEFT of left wall so Tunnel bar NEVER overlaps! */}
            {Array.from({ length: s.totalLayers }).map((_, li) => {
              const ly = shaftTopY + li * layerH;
              const fill = getLayerFill(s, li, bSnap);
              const stroke = fill ? '#14532d' : colors.remainingOutline;
              return (
                <g key={li}>
                  <rect
                    x={wallLeftX}
                    y={ly}
                    width={wallThick}
                    height={Math.max(2, layerH - 0.5)}
                    fill={fill ?? '#ffffff'}
                    stroke={stroke}
                    strokeWidth={0.55}
                  />
                  <rect
                    x={wallRightX}
                    y={ly}
                    width={wallThick}
                    height={Math.max(2, layerH - 0.5)}
                    fill={fill ?? '#ffffff'}
                    stroke={stroke}
                    strokeWidth={0.55}
                  />
                  <text
                    x={wallLeftX - 2.2}
                    y={ly + layerH * 0.68}
                    textAnchor="end"
                    fontSize={s.totalLayers >= 11 ? 4.3 : 4.8}
                    fontWeight="700"
                    fill={fill ? '#15803d' : '#dc2626'}
                  >
                    W{li + 1}
                  </text>
                </g>
              );
            })}

            {s.sheetPileStyle &&
              [0.24, 0.52, 0.78].map((frac, si) => (
                <line
                  key={si}
                  x1={wallLeftX}
                  y1={shaftTopY + wallH * frac}
                  x2={wallRightX + wallThick}
                  y2={shaftTopY + wallH * frac}
                  stroke="#ca8a04"
                  strokeWidth={1.3}
                />
              ))}

            {/* Bottom Slab */}
            {(() => {
              const bFill = getBottomSlabFill(s, bSnap);
              return (
                <rect
                  x={wallLeftX}
                  y={shaftTopY + wallH}
                  width={wallThick * 2 + innerW}
                  height={botSlabH}
                  fill={bFill ?? '#ffffff'}
                  stroke={bFill ? '#14532d' : colors.remainingOutline}
                  strokeWidth={0.65}
                />
              );
            })()}

            {/* --- MANHOLE (2 PARTS: UPPER PRECAST RING + LOWER CASTING) --- */}
            <g
              onClick={(e) => {
                e.stopPropagation();
                onSelectShaft(s.id, 'manhole');
              }}
            >
              {/* UPPER PART: PRECAST RING */}
              <rect
                x={mhX + 3 * sx}
                y={precastY}
                width={mhW - 6 * sx}
                height={precastH}
                fill="#ffffff"
                stroke={currPrePct > 0 ? '#0369a1' : colors.remainingOutline}
                strokeWidth={0.65}
              />
              {prevPrePct > 0 && (
                <rect
                  x={mhX + 3 * sx + 0.4}
                  y={precastY + precastH * (1 - prevPrePct / 100)}
                  width={mhW - 6 * sx - 0.8}
                  height={precastH * (prevPrePct / 100)}
                  fill={precastBaseColor}
                  fillOpacity={0.85}
                />
              )}
              {viewMode !== 'overall' && currPrePct > prevPrePct && (
                <rect
                  x={mhX + 3 * sx + 0.4}
                  y={precastY + precastH * (1 - currPrePct / 100)}
                  width={mhW - 6 * sx - 0.8}
                  height={precastH * ((currPrePct - prevPrePct) / 100)}
                  fill={currHighlight}
                />
              )}
              {[0.25, 0.5, 0.75].map((f) => (
                <line
                  key={f}
                  x1={mhX + 3 * sx}
                  y1={precastY + precastH * f}
                  x2={mhX + mhW - 3 * sx}
                  y2={precastY + precastH * f}
                  stroke={currPrePct > 0 ? '#ffffff' : colors.remainingOutline}
                  strokeWidth={0.55}
                />
              ))}

              {/* LOWER PART: IN-SITU CASTING */}
              <rect
                x={mhX}
                y={castingY}
                width={mhW}
                height={castingH}
                fill="#ffffff"
                stroke={currCastPct > 0 ? '#1e3a8a' : colors.remainingOutline}
                strokeWidth={0.7}
              />
              {prevCastPct > 0 && (
                <rect
                  x={mhX + 0.4}
                  y={castingY + castingH * (1 - prevCastPct / 100)}
                  width={mhW - 0.8}
                  height={castingH * (prevCastPct / 100)}
                  fill={mhPrevColor}
                />
              )}
              {viewMode !== 'overall' && currCastPct > prevCastPct && (
                <rect
                  x={mhX + 0.4}
                  y={castingY + castingH * (1 - currCastPct / 100)}
                  width={mhW - 0.8}
                  height={castingH * ((currCastPct - prevCastPct) / 100)}
                  fill={currHighlight}
                />
              )}
              <rect
                x={mhX + 3.2 * sx}
                y={castingY + 3.5}
                width={mhW - 6.4 * sx}
                height={castingH - 7}
                fill="#ffffff"
                fillOpacity={0.88}
                stroke={currCastPct > 0 ? '#1e3a8a' : colors.remainingOutline}
                strokeWidth={0.5}
              />
              {[0.2, 0.35, 0.5, 0.65, 0.8].map((f) => (
                <line
                  key={f}
                  x1={mhX + 4.5 * sx}
                  y1={castingY + 3.5 + (castingH - 7) * f}
                  x2={mhX + mhW - 4.5 * sx}
                  y2={castingY + 3.5 + (castingH - 7) * f}
                  stroke="#dc2626"
                  strokeWidth={0.45}
                  strokeDasharray="2,1.5"
                />
              ))}
            </g>

            {/* --- TUNNEL CONNECTION BAR TO NEXT SHAFT --- */}
            {!isLastInRow && !isLastShaft && (() => {
              const barStart = wallRightX + wallThick;
              const barEnd = colW + wallLeftX - 11; // Leaves 11u clear for next shaft's W10-W13 labels!
              return (
                <g>
                  <line
                    x1={barEnd}
                    y1={tunnelBarY + 7}
                    x2={colW + wallLeftX}
                    y2={tunnelBarY + 7}
                    stroke="#1e3a8a"
                    strokeWidth={1.1}
                    strokeDasharray="2,1"
                  />
                  {renderTunnelBar(
                    s,
                    barStart,
                    tunnelBarY,
                    barEnd - barStart,
                    10,
                    100,
                    'full'
                  )}
                </g>
              );
            })()}

            {/* Exiting 10%..50% bar at right end of row */}
            {isLastInRow && !isLastShaft &&
              renderTunnelBar(
                s,
                wallRightX + wallThick,
                tunnelBarY,
                colW - (wallRightX + wallThick) + 32,
                10,
                50,
                'exit'
              )}

            {/* Incoming 60%..100% bar at left start of row > 0 */}
            {col === 0 && row > 0 && idx > 0 && (() => {
              const barStart = -28;
              const barEnd = wallLeftX - 11;
              return (
                <g>
                  <line
                    x1={barEnd}
                    y1={tunnelBarY + 7}
                    x2={wallLeftX}
                    y2={tunnelBarY + 7}
                    stroke="#1e3a8a"
                    strokeWidth={1.1}
                    strokeDasharray="2,1"
                  />
                  {renderTunnelBar(
                    shafts[idx - 1],
                    barStart,
                    tunnelBarY,
                    barEnd - barStart,
                    60,
                    100,
                    'entry'
                  )}
                </g>
              );
            })()}

            {/* Last Shaft (WA-36 -> Pump Station) */}
            {isLastShaft &&
              renderTunnelBar(
                s,
                wallRightX + wallThick,
                tunnelBarY,
                settings.showPumpStation
                  ? settings.layoutMode === '12col'
                    ? colW * 1.25 - (wallRightX + wallThick) + 4
                    : colW - (wallRightX + wallThick) + colW * 0.56 + 4
                  : 96 * sx,
                10,
                100,
                'pump'
              )}
          </g>
        );
      })}

      {/* Pump Station in Row 4 */}
      {settings.showPumpStation &&
        renderPumpStation(
          pumpStation,
          settings.layoutMode === '12col'
            ? gridX + colW * 1.25
            : gridX + colW * 7.56,
          gridY + rowH * 3 + 4,
          settings.layoutMode === '12col' ? colW * 4.5 : colW * 2.44
        )}

      {/* ==================== BOTTOM FOOTER STRIP (A1) ==================== */}
      <g transform="translate(16, 996)">
        {/* 1. PROGRESS SUMMARY BOX */}
        <rect
          x={6}
          y={0}
          width={924}
          height={168}
          fill="#ffffff"
          stroke="#1e3a8a"
          strokeWidth={1.1}
        />
        <rect
          x={6}
          y={0}
          width={924}
          height={22}
          fill="#eff6ff"
          stroke="#1e3a8a"
          strokeWidth={0.8}
        />
        <text
          x={468}
          y={15}
          textAnchor="middle"
          fontSize={10.5}
          fontWeight="700"
          fill="#1e3a8a"
        >
          WA SECTION - PROGRESS SUMMARY
        </text>

        <line x1={270} y1={22} x2={270} y2={168} stroke="#1e3a8a" strokeWidth={0.7} />
        <line x1={550} y1={22} x2={550} y2={168} stroke="#1e3a8a" strokeWidth={0.7} />

        {/* Sub-col 1: SHAFT PROGRESS */}
        <text x={138} y={37} textAnchor="middle" fontSize={8.2} fontWeight="700" fill="#1e3a8a" textDecoration="underline">
          SHAFT PROGRESS (WA-01 to WA-36 + 24.1)
        </text>
        <text x={20} y={55} fontSize={7.6} fill="#0f172a">TOTAL SHAFT</text>
        <text x={252} y={55} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#0f172a">: {summary.totalShafts} Nos</text>

        <text x={20} y={71} fontSize={7.6} fill="#15803d" fontWeight="600">COMPLETED SHAFT</text>
        <text x={252} y={71} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#15803d">: {String(summary.completedShafts).padStart(2, '0')} Nos</text>

        <text x={20} y={87} fontSize={7.6} fill="#b45309" fontWeight="600">ON-GOING SHAFT</text>
        <text x={252} y={87} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#b45309">: {String(summary.ongoingShafts).padStart(2, '0')} Nos</text>

        <text x={20} y={103} fontSize={7.6} fill="#dc2626">REMAINING SHAFT</text>
        <text x={252} y={103} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#dc2626">: {String(summary.remainingShafts).padStart(2, '0')} Nos</text>

        {viewMode === 'overall' ? (
          <g>
            <rect x={16} y={114} width={242} height={44} rx={3} fill="#f0fdf4" stroke="#16a34a" strokeWidth={0.7} />
            <text x={24} y={128} fontSize={7} fontWeight="700" fill="#166534">
              PUMP STATION (GOLAPBAG SPS):
            </text>
            <text x={24} y={140} fontSize={6.8} fill="#0f172a">
              - Lower Main Structure: {pumpStation.layers.filter((l) => l.status === 'complete').length}/5 Layers (Sink {pumpStation.sinkingCompletedM}m)
            </text>
            <text x={24} y={152} fontSize={6.8} fontWeight="700" fill="#1e3a8a">
              - Upper Machine Room: {pumpStation.machineRoom.status.toUpperCase()}
            </text>
          </g>
        ) : (
          <g>
            <rect x={16} y={114} width={242} height={44} rx={3} fill="#fffbeb" stroke="#f59e0b" strokeWidth={0.7} />
            <text x={24} y={130} fontSize={7} fontWeight="700" fill="#92400e">
              {viewMode === 'weekly' ? 'WEEKLY DELTA (FILE 2 vs FILE 1):' : 'MONTHLY DELTA (FILE 2 vs FILE 1):'}
            </text>
            <text x={24} y={142} fontSize={7} fill="#78350f">
              - Shaft Layers Completed: +{summary.delta.addedLayers} layers
            </text>
            <text x={24} y={153} fontSize={7} fill="#78350f">
              - Shafts Completed: +{summary.delta.addedShaftsCompleted} Nos
            </text>
          </g>
        )}

        {/* Sub-col 2: MANHOLE PROGRESS (2 PARTS) */}
        <text x={410} y={37} textAnchor="middle" fontSize={8.2} fontWeight="700" fill="#1e3a8a" textDecoration="underline">
          MANHOLE PROGRESS (CASTING + PRECAST)
        </text>
        <text x={284} y={55} fontSize={7.6} fill="#0f172a">TOTAL MANHOLE</text>
        <text x={536} y={55} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#0f172a">: {summary.totalManholes} Nos</text>

        <text x={284} y={71} fontSize={7.6} fill="#15803d" fontWeight="600">COMPLETED (BOTH PARTS)</text>
        <text x={536} y={71} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#15803d">: {String(summary.completedManholes).padStart(2, '0')} Nos</text>

        <text x={284} y={87} fontSize={7.6} fill="#b45309" fontWeight="600">ON-GOING MANHOLE</text>
        <text x={536} y={87} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#b45309">: {String(summary.ongoingManholes).padStart(2, '0')} Nos</text>

        <text x={284} y={103} fontSize={7.6} fill="#1d4ed8">- Lower Casting Complete</text>
        <text x={536} y={103} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#1d4ed8">: {String(summary.castingCompleteCount).padStart(2, '0')} Nos</text>

        <text x={284} y={119} fontSize={7.6} fill="#0284c7">- Upper Precast Ring Complete</text>
        <text x={536} y={119} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#0284c7">: {String(summary.precastCompleteCount).padStart(2, '0')} Nos</text>

        {viewMode !== 'overall' && (
          <text x={284} y={145} fontSize={7.2} fontWeight="700" fill="#92400e">
            Period Added: Casting +{summary.delta.addedCastingCompleted} | Precast +{summary.delta.addedPrecastCompleted}
          </text>
        )}

        {/* Sub-col 3: MICRO-TUNNELLING PROGRESS */}
        <text x={740} y={37} textAnchor="middle" fontSize={8.2} fontWeight="700" fill="#1e3a8a" textDecoration="underline">
          MICRO-TUNNELLING PROGRESS
        </text>
        <text x={564} y={55} fontSize={7.6} fontWeight="700" fill="#0f172a">TOTAL LENGTH</text>
        <text x={914} y={55} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#0f172a">
          : {(summary.totalTunnelLengthM / 1000).toFixed(3)} km
        </text>
        <text x={564} y={71} fontSize={7.6} fontWeight="700" fill="#a21caf">COMPLETED LENGTH</text>
        <text x={914} y={71} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#a21caf">
          : {(summary.completedTunnelLengthM / 1000).toFixed(3)} km ({summary.tunnelPctOverall.toFixed(1)}%)
        </text>

        <text x={564} y={91} fontSize={7.2} fill="#334155">1. DN 900  (Total: {(summary.byDia.DN900.totalM / 1000).toFixed(3)} km)</text>
        <text x={914} y={91} textAnchor="end" fontSize={7.4} fontWeight="700" fill="#0f172a">Done: {(summary.byDia.DN900.completedM / 1000).toFixed(3)} km</text>

        <text x={564} y={107} fontSize={7.2} fill="#334155">2. DN 1100 (Total: {(summary.byDia.DN1100.totalM / 1000).toFixed(3)} km)</text>
        <text x={914} y={107} textAnchor="end" fontSize={7.4} fontWeight="700" fill="#0f172a">Done: {(summary.byDia.DN1100.completedM / 1000).toFixed(3)} km</text>

        <text x={564} y={123} fontSize={7.2} fill="#334155">3. DN 1600 (Total: {(summary.byDia.DN1600.totalM / 1000).toFixed(3)} km)</text>
        <text x={914} y={123} textAnchor="end" fontSize={7.4} fontWeight="700" fill="#0f172a">Done: {(summary.byDia.DN1600.completedM / 1000).toFixed(3)} km</text>

        {viewMode !== 'overall' && (
          <g>
            <rect x={562} y={133} width={354} height={24} rx={3} fill="#fffbeb" stroke="#f59e0b" strokeWidth={0.7} />
            <text x={739} y={148} textAnchor="middle" fontSize={7.4} fontWeight="700" fill="#92400e">
              {viewMode === 'weekly' ? 'THIS WEEK TUNNEL ADDED: ' : 'THIS MONTH TUNNEL ADDED: '}
              +{summary.delta.addedTunnelM.toFixed(1)} m ({(summary.delta.addedTunnelM / 1000).toFixed(3)} km)
            </text>
          </g>
        )}

        {/* 2. COLOR & SYMBOL LEGEND */}
        <rect
          x={938}
          y={0}
          width={374}
          height={168}
          fill="#ffffff"
          stroke="#1e3a8a"
          strokeWidth={1.1}
        />
        <rect
          x={938}
          y={0}
          width={374}
          height={22}
          fill="#eff6ff"
          stroke="#1e3a8a"
          strokeWidth={0.8}
        />
        <text x={1125} y={15} textAnchor="middle" fontSize={9.5} fontWeight="700" fill="#1e3a8a">
          COLOR LEGEND ({viewMode.toUpperCase()})
        </text>

        {viewMode === 'overall' ? (
          <g>
            {[
              { c: colors.overallShaft, label: 'Shaft Layers (W1-W13) & Slab Complete' },
              { c: colors.overallCasting, label: 'Manhole Lower Part: In-situ Casting' },
              { c: colors.overallPrecast, label: 'Manhole Upper Part: Precast Ring' },
              { c: colors.overallTunnel, label: 'Micro-Tunnelling Completed (%)' },
              { c: '#ffffff', stroke: colors.remainingOutline, label: 'Remaining / Not Yet Started' },
            ].map((item, i) => (
              <g key={item.label} transform={`translate(950, ${34 + i * 24})`}>
                <rect
                  x={0}
                  y={0}
                  width={20}
                  height={13}
                  fill={item.c}
                  stroke={item.stroke || '#334155'}
                  strokeWidth={0.9}
                />
                <text x={28} y={10} fontSize={7.3} fontWeight="600" fill="#0f172a">
                  {item.label}
                </text>
              </g>
            ))}
          </g>
        ) : (
          <g>
            {[
              {
                c: viewMode === 'weekly' ? colors.prevWeekShaft : colors.prevMonthShaft,
                label: 'Shaft Done in File 1 (Previous)',
              },
              {
                c: viewMode === 'weekly' ? colors.prevWeekManhole : colors.prevMonthManhole,
                label: 'Manhole Done in File 1 (Previous)',
              },
              {
                c: viewMode === 'weekly' ? colors.prevWeekTunnel : colors.prevMonthTunnel,
                label: 'Tunnel Done in File 1 (Previous)',
              },
              {
                c: currHighlight,
                label: viewMode === 'weekly' ? 'NEW WEEKLY PROGRESS (File 2 vs File 1)' : 'NEW MONTHLY PROGRESS (File 2 vs File 1)',
                bold: true,
              },
              {
                c: '#ffffff',
                stroke: colors.remainingOutline,
                label: 'Remaining Work (Not Started)',
              },
            ].map((item, i) => (
              <g key={item.label} transform={`translate(950, ${34 + i * 24})`}>
                <rect
                  x={0}
                  y={0}
                  width={20}
                  height={13}
                  fill={item.c}
                  stroke={item.stroke || '#334155'}
                  strokeWidth={0.9}
                />
                <text
                  x={28}
                  y={10}
                  fontSize={7.1}
                  fontWeight={item.bold ? '700' : '600'}
                  fill={item.bold ? '#b45309' : '#0f172a'}
                >
                  {item.label}
                </text>
              </g>
            ))}
          </g>
        )}

        <g transform="translate(950, 154)">
          <circle cx={4} cy={-2} r={3} fill="#16a34a" />
          <text x={11} y={1} fontSize={6.4} fill="#334155">Complete</text>
          <circle cx={68} cy={-2} r={3} fill="#f59e0b" />
          <text x={75} y={1} fontSize={6.4} fill="#334155">On-going</text>
          <circle cx={136} cy={-2} r={3} fill="#dc2626" />
          <text x={143} y={1} fontSize={6.4} fill="#334155">Remaining</text>
        </g>

        {/* 3. DRAWING TITLE BLOCK (A1) */}
        <rect
          x={1320}
          y={0}
          width={324}
          height={168}
          fill="#ffffff"
          stroke="#1e3a8a"
          strokeWidth={1.1}
        />
        <rect x={1320} y={0} width={324} height={22} fill="#1e3a8a" />
        <text x={1482} y={15} textAnchor="middle" fontSize={9.5} fontWeight="700" fill="#ffffff">
          PROJECT DRAWING TITLE BLOCK
        </text>
        {[
          ['Client:', settings.clientName],
          ['Contractor:', settings.contractorName],
          ['Section:', 'WA Section (Micro-Tunnelling)'],
          ['Prepared By:', settings.preparedBy],
          ['Checked By:', settings.checkedBy],
          ['Report Date:', formatDateDisplay(settings.reportDate)],
          ['Drawing No:', `${settings.drawingNo}  (${settings.revision})`],
          ['Page Setup:', 'ISO A1 Landscape (841 x 594 mm)'],
        ].map(([k, v], i) => (
          <g key={k} transform={`translate(1320, ${22 + i * 18.2})`}>
            <line x1={0} y1={18.2} x2={324} y2={18.2} stroke="#cbd5e1" strokeWidth={0.6} />
            <text x={8} y={12} fontSize={6.8} fontWeight="700" fill="#475569">{k}</text>
            <text x={88} y={12} fontSize={7.1} fontWeight="600" fill="#0f172a">{trunc(v, 36)}</text>
          </g>
        ))}
      </g>
    </svg>
  );
};
