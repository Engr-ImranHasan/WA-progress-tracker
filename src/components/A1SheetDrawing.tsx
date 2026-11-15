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
  getShaftCompletedLayersCount,
  getShaftStatus,
  getTunnelStatus,
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
  const { shafts, pumpStation, viewMode, colors, settings } = state;
  const baseline =
    viewMode === 'monthly' ? state.monthlyBaseline : state.weeklyBaseline;
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
      ? `WEEKLY PROGRESS: ${state.currentWeekLabel}  (vs ${state.weeklyBaseline.label})`
      : viewMode === 'monthly'
      ? `MONTHLY PROGRESS: ${state.currentMonthLabel}  (vs ${state.monthlyBaseline.label})`
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

  // Render Pump Station block
  const renderPumpStation = (
    ps: PumpStationData,
    x: number,
    y: number,
    w: number
  ) => {
    const structX = x + 10;
    const structY = y + 36;
    const structW = Math.min(210, w * 0.46);
    const structH = 152;
    const tblX = structX + structW + 14;
    const tblW = Math.max(110, x + w - tblX - 8);

    return (
      <g>
        <text
          x={x + w * 0.35}
          y={y + 18}
          textAnchor="middle"
          fontSize={10.5}
          fontWeight="700"
          fill="#0f172a"
        >
          Pump Station - Section Layout (A-A)
        </text>
        <rect
          x={structX}
          y={structY}
          width={structW}
          height={structH}
          fill="#f8fafc"
          stroke="#16a34a"
          strokeWidth={1.2}
        />
        <rect
          x={structX}
          y={structY}
          width={14}
          height={structH}
          fill={colors.overallShaft}
          stroke="#15803d"
          strokeWidth={0.6}
        />
        <rect
          x={structX + structW - 14}
          y={structY}
          width={14}
          height={structH}
          fill={colors.overallShaft}
          stroke="#15803d"
          strokeWidth={0.6}
        />
        <rect
          x={structX + structW / 2 - 5}
          y={structY}
          width={10}
          height={structH}
          fill={colors.overallShaft}
          stroke="#15803d"
          strokeWidth={0.6}
        />
        <rect x={structX} y={structY} width={structW} height={7} fill={colors.overallShaft} />
        <rect x={structX} y={structY + 42} width={structW} height={9} fill={colors.overallShaft} />
        <rect x={structX} y={structY + 92} width={structW} height={9} fill={colors.overallShaft} />
        <rect
          x={structX + 14}
          y={structY + structH - 22}
          width={structW - 28}
          height={22}
          fill="#fee2e2"
          stroke="#dc2626"
          strokeWidth={0.8}
        />
        <text
          x={structX + structW / 2}
          y={structY + structH - 8}
          textAnchor="middle"
          fontSize={5.2}
          fill="#991b1b"
          fontWeight="700"
        >
          BASE PLUG / TREMIE SLAB (H: {ps.totalHeightM}m | Sinking: {ps.sinkingCompletedM}m)
        </text>
        <text
          x={structX + structW / 2}
          y={structY + structH + 11}
          textAnchor="middle"
          fontSize={6.1}
          fontWeight="600"
          fill="#1e3a8a"
        >
          Section Layout (A-A) - Completed Height: {ps.completedHeightM}m / {ps.totalHeightM}m
        </text>

        <g>
          <text
            x={tblX + tblW / 2}
            y={structY - 6}
            textAnchor="middle"
            fontSize={7.2}
            fontWeight="700"
            fill="#1e3a8a"
          >
            Pump Station Construction Status
          </text>
          <rect
            x={tblX}
            y={structY}
            width={tblW}
            height={ps.layers.length * 26}
            fill="#ffffff"
            stroke="#1e3a8a"
            strokeWidth={0.8}
          />
          {ps.layers.map((ly, li) => {
            const lyY = structY + li * 26;
            const dur = calcDurationDays(ly.sDate, ly.eDate);
            return (
              <g key={ly.name}>
                <line
                  x1={tblX}
                  y1={lyY}
                  x2={tblX + tblW}
                  y2={lyY}
                  stroke="#1e3a8a"
                  strokeWidth={0.6}
                />
                <rect
                  x={tblX}
                  y={lyY}
                  width={42}
                  height={26}
                  fill={ly.done ? '#dcfce7' : '#fef2f2'}
                  stroke="#1e3a8a"
                  strokeWidth={0.5}
                />
                <text
                  x={tblX + 21}
                  y={lyY + 15}
                  textAnchor="middle"
                  fontSize={5.4}
                  fontWeight="700"
                  fill="#1e3a8a"
                >
                  {ly.name}
                </text>
                <text x={tblX + 47} y={lyY + 9} fontSize={5.0} fill="#334155">
                  S: {formatDateDisplay(ly.sDate)}
                </text>
                <text x={tblX + 47} y={lyY + 17} fontSize={5.0} fill="#334155">
                  E: {formatDateDisplay(ly.eDate)}
                </text>
                <text x={tblX + 47} y={lyY + 24} fontSize={5.0} fontWeight="700" fill="#166534">
                  Dur: {dur ?? '-'} Days
                </text>
              </g>
            );
          })}
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
                  ? colW - (wallRightX + wallThick) + colW * 0.56 - 10
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

        {viewMode !== 'overall' && (
          <g>
            <rect x={16} y={114} width={242} height={44} rx={3} fill="#fffbeb" stroke="#f59e0b" strokeWidth={0.7} />
            <text x={24} y={130} fontSize={7} fontWeight="700" fill="#92400e">
              {viewMode === 'weekly' ? 'THIS WEEK ADDED:' : 'THIS MONTH ADDED:'}
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
                label: viewMode === 'weekly' ? 'Shaft Done Up to Previous Week' : 'Shaft Done Up to Previous Meeting',
              },
              {
                c: viewMode === 'weekly' ? colors.prevWeekManhole : colors.prevMonthManhole,
                label: viewMode === 'weekly' ? 'Manhole Done Up to Previous Week' : 'Manhole Done Up to Previous Meeting',
              },
              {
                c: viewMode === 'weekly' ? colors.prevWeekTunnel : colors.prevMonthTunnel,
                label: viewMode === 'weekly' ? 'Tunnel Done Up to Previous Week' : 'Tunnel Done Up to Previous Meeting',
              },
              {
                c: currHighlight,
                label: viewMode === 'weekly' ? 'NEW PROGRESS IN THIS WEEK' : 'NEW PROGRESS SINCE LAST MEETING (MONTH)',
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
