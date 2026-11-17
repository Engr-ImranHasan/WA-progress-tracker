import { jsPDF } from 'jspdf';
import { svg2pdf } from 'svg2pdf.js';
import * as XLSX from 'xlsx';
import {
  AppState,
  PipeDia,
  PumpStationData,
  SavedProgressFile,
  ShaftRecord,
  ShaftType,
  SheetSettings,
  WbSectionData,
  WcSectionData,
  WorkStatus,
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
  parseDateInput,
  recomputeWbChainages,
  resizeShaftLayers,
  resolveDisplayContext,
} from './calculations';
import {
  createInitialWbData,
  createInitialWcData,
  DEFAULT_AIR_VALVE_COORD,
  DEFAULT_WASHOUT_COORD,
  GOLAPBAG_SPS_COORD,
  INITIAL_WA_GEO_NODES,
} from './../data/wbcInitialData';
import { buildGeoViewport, ensureMapTileSnapshot } from './geoMap';

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sanitizeSvgCloneForExport(svgEl: SVGSVGElement, w: string, h: string): SVGSVGElement {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  clone.querySelectorAll('[data-selection-ring="true"]').forEach((n) => n.remove());
  return clone;
}

export async function preloadSectionMapSnapshots(state: AppState): Promise<void> {
  if (!state.settings.showMapBackground || state.settings.mapStyle === 'cad') return;
  // Standalone WB page: x=22, y=58, w=950, h=926 (padTop=26) -> mapX=26, mapY=84, mapW=942, mapH=896
  const wbFullVp = buildGeoViewport(state.wb.nodes, 26, 84, 942, 896, 0.1);
  // Combined side-by-side WB map: x=922, y=704, w=368, h=464 -> mapX=926, mapY=723, mapW=360, mapH=441
  const wbCompactVp = buildGeoViewport(state.wb.nodes, 926, 723, 360, 441, 0.12);
  // Standalone WC page: x=22, y=720, w=1638, h=268 (padTop=24) -> mapX=26, mapY=744, mapW=1630, mapH=240
  const wcFullVp = buildGeoViewport(state.wc.geoNodes, 26, 744, 1630, 240, 0.12);
  // Combined side-by-side WC map: x=1296, y=704, w=368, h=464 -> mapX=1300, mapY=723, mapW=360, mapH=441
  const wcCompactVp = buildGeoViewport(state.wc.geoNodes, 1300, 723, 360, 441, 0.12);

  // Full-A1 Portrait GIS Map Pages (Pages 2, 3, 4 in 5-Page PDF: x=44, y=86, w=1100, h=1558, padRatio=0.09, 1120x1594)
  const waNodes =
    state.waGeoNodes && state.waGeoNodes.length > 0
      ? state.waGeoNodes
      : INITIAL_WA_GEO_NODES;
  const spsCoord = state.spsCoord || GOLAPBAG_SPS_COORD;
  const waFullA1Vp = buildGeoViewport(
    [...waNodes, spsCoord],
    44,
    86,
    1100,
    1558,
    0.09
  );
  const wbFullA1Vp = buildGeoViewport(
    [
      ...state.wb.nodes,
      state.wb.washoutCoord || DEFAULT_WASHOUT_COORD,
      state.wb.airValveCoord || DEFAULT_AIR_VALVE_COORD,
      spsCoord,
    ],
    44,
    86,
    1100,
    1558,
    0.09
  );
  const wcFullA1Vp = buildGeoViewport(state.wc.geoNodes, 44, 86, 1100, 1558, 0.09);

  const wbFullW = Math.min(1100, Math.max(480, Math.round(942 * 1.35)));
  const wbFullH = Math.min(1100, Math.max(420, Math.round(896 * 1.35)));
  const compactW = Math.min(1100, Math.max(480, Math.round(360 * 1.55)));
  const compactH = Math.min(1100, Math.max(420, Math.round(441 * 1.55)));
  const wcFullW = Math.min(1100, Math.max(480, Math.round(1630 * 1.35)));
  const wcFullH = Math.min(1100, Math.max(420, Math.round(240 * 1.35)));

  await Promise.all([
    ensureMapTileSnapshot(wbFullVp, state.settings.mapStyle, wbFullW, wbFullH),
    ensureMapTileSnapshot(wbCompactVp, state.settings.mapStyle, compactW, compactH),
    ensureMapTileSnapshot(wcFullVp, state.settings.mapStyle, wcFullW, wcFullH),
    ensureMapTileSnapshot(wcCompactVp, state.settings.mapStyle, compactW, compactH),
    ensureMapTileSnapshot(waFullA1Vp, state.settings.mapStyle, 1120, 1594),
    ensureMapTileSnapshot(wbFullA1Vp, state.settings.mapStyle, 1120, 1594),
    ensureMapTileSnapshot(wcFullA1Vp, state.settings.mapStyle, 1120, 1594),
  ]);
}

function getSvgPageSpec(svgEl: SVGSVGElement): {
  orientation: 'landscape' | 'portrait';
  widthMm: number;
  heightMm: number;
} {
  const vb = svgEl.getAttribute('viewBox') || '';
  const parts = vb.trim().split(/[\s,]+/).map(Number);
  if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3]) && parts[3] > parts[2]) {
    return { orientation: 'portrait', widthMm: 594, heightMm: 841 };
  }
  return { orientation: 'landscape', widthMm: 841, heightMm: 594 };
}

export async function exportA1VectorPdf(
  svgEl: SVGSVGElement,
  filename: string
): Promise<void> {
  const spec = getSvgPageSpec(svgEl);
  const clone = sanitizeSvgCloneForExport(
    svgEl,
    String(spec.widthMm),
    String(spec.heightMm)
  );
  const pdf = new jsPDF({
    orientation: spec.orientation,
    unit: 'mm',
    format: [spec.widthMm, spec.heightMm],
    compress: true,
  });

  await svg2pdf(clone, pdf, {
    x: 0,
    y: 0,
    width: spec.widthMm,
    height: spec.heightMm,
  });

  pdf.save(filename);
}

/**
 * Exports multiple ISO A1 sheets (mixed Landscape & Portrait supported automatically)
 * into a single multi-page A1 vector PDF file.
 */
export async function exportMultiPageA1VectorPdf(
  svgEls: SVGSVGElement[],
  filename: string
): Promise<void> {
  if (svgEls.length === 0) return;
  const firstSpec = getSvgPageSpec(svgEls[0]);
  const pdf = new jsPDF({
    orientation: firstSpec.orientation,
    unit: 'mm',
    format: [firstSpec.widthMm, firstSpec.heightMm],
    compress: true,
  });

  for (let i = 0; i < svgEls.length; i++) {
    const spec = getSvgPageSpec(svgEls[i]);
    if (i > 0) {
      pdf.addPage([spec.widthMm, spec.heightMm], spec.orientation);
    }
    const clone = sanitizeSvgCloneForExport(
      svgEls[i],
      String(spec.widthMm),
      String(spec.heightMm)
    );
    await svg2pdf(clone, pdf, {
      x: 0,
      y: 0,
      width: spec.widthMm,
      height: spec.heightMm,
    });
  }

  pdf.save(filename);
}

export function exportSvgFile(svgEl: SVGSVGElement, filename: string): void {
  const spec = getSvgPageSpec(svgEl);
  const clone = sanitizeSvgCloneForExport(svgEl, `${spec.widthMm}mm`, `${spec.heightMm}mm`);
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  triggerDownload(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }), filename);
}

export async function exportHighResPng(
  svgEl: SVGSVGElement,
  filename: string
): Promise<void> {
  const spec = getSvgPageSpec(svgEl);
  const width = spec.orientation === 'portrait' ? 2970 : 4205;
  const height = spec.orientation === 'portrait' ? 4205 : 2970;
  const clone = sanitizeSvgCloneForExport(svgEl, String(width), String(height));

  const svgStr = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Canvas context unavailable'));
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (blob) triggerDownload(blob, filename);
        resolve();
      }, 'image/png');
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

export function exportJsonBackup(state: AppState, filename: string): void {
  const json = JSON.stringify(state, null, 2);
  triggerDownload(new Blob([json], { type: 'application/json;charset=utf-8' }), filename);
}

export function exportSavedFileJson(file: SavedProgressFile, filename: string): void {
  const json = JSON.stringify(file, null, 2);
  triggerDownload(new Blob([json], { type: 'application/json;charset=utf-8' }), filename);
}

function mapShaftRows(
  shafts: ShaftRecord[],
  compareInfo?: {
    baselineShafts: Record<string, { layerFlags: boolean[]; tunnelPct: number; castingPct: number; precastPct: number; bottomSlabDone: boolean }>;
  },
  geoCoords?: Array<{ id: string; lat: number; lon: number }>
) {
  const geoById = new Map<string, { lat: number; lon: number }>();
  if (geoCoords) {
    for (const g of geoCoords) geoById.set(g.id, { lat: g.lat, lon: g.lon });
  }

  return shafts.map((s) => {
    const shDone = getShaftCompletedLayersCount(s);
    const shDur = calcDurationDays(s.shaftSDate, s.shaftEDate);
    const mhDur = calcDurationDays(s.manholeSDate, s.manholeEDate);
    const mtDur = calcDurationDays(s.tunnelSDate, s.tunnelEDate);
    const prevSnap = compareInfo?.baselineShafts[s.id];
    const prevLayers = prevSnap
      ? (prevSnap.layerFlags || []).slice(0, s.totalLayers).filter(Boolean).length
      : 0;
    const coord = geoById.get(s.id);

    return {
      'No.': s.index,
      'Shaft ID': s.id,
      'Next Connection': s.nextId,
      ...(coord ? { Latitude: coord.lat, Longitude: coord.lon } : {}),
      'Shaft Size (mm)': s.shaftSize,
      'Type of Shaft': s.shaftType,
      'Net Height (mm)': s.netHeightMm,
      'Bottom Slab (mm)': s.bottomSlabMm,
      'Total Layers (6-13)': s.totalLayers,
      'Completed Layers': shDone,
      'Bottom Slab Done (Yes/No)': s.bottomSlabDone ? 'Yes' : 'No',
      'Shaft S.Date (DD/MM/YYYY)': formatDateDisplay(s.shaftSDate),
      'Shaft E.Date (DD/MM/YYYY)': formatDateDisplay(s.shaftEDate),
      'Shaft Duration (Days)': shDur ?? (getShaftStatus(s) === 'ongoing' ? 'On-going' : ''),
      'Shaft Status': getShaftStatus(s).toUpperCase(),
      'Manhole Casting (%)': s.castingPct,
      'Manhole Precast Ring (%)': s.precastPct,
      'Manhole S.Date (DD/MM/YYYY)': formatDateDisplay(s.manholeSDate),
      'Manhole E.Date (DD/MM/YYYY)': formatDateDisplay(s.manholeEDate),
      'Manhole Duration (Days)': mhDur ?? (getManholeStatus(s) === 'ongoing' ? 'On-going' : ''),
      'Manhole Status': getManholeStatus(s).toUpperCase(),
      'Pipe Dia': s.pipeDia,
      'Tunnel Length (m)': s.tunnelLengthM,
      'Tunnel Completed (%)': s.tunnelPct,
      'Tunnel Completed (m)': Number(((s.tunnelLengthM * s.tunnelPct) / 100).toFixed(2)),
      'Tunnel S.Date (DD/MM/YYYY)': formatDateDisplay(s.tunnelSDate),
      'Tunnel E.Date (DD/MM/YYYY)': formatDateDisplay(s.tunnelEDate),
      'Tunnel Duration (Days)': mtDur ?? (getTunnelStatus(s) === 'ongoing' ? 'On-going' : ''),
      'Tunnel Status': getTunnelStatus(s).toUpperCase(),
      ...(compareInfo
        ? {
            'File 1 Layers': prevLayers,
            'Added Layers': Math.max(0, shDone - prevLayers),
            'File 1 Tunnel (%)': prevSnap ? prevSnap.tunnelPct : 0,
            'Added Tunnel (%)': Math.max(0, s.tunnelPct - (prevSnap?.tunnelPct ?? 0)),
          }
        : {}),
    };
  });
}

function buildWorkbookFromData(
  shafts: ShaftRecord[],
  pumpStation: PumpStationData,
  wbData: WbSectionData,
  wcData: WcSectionData,
  reportDate: string,
  compareInfo?: {
    mode: 'weekly' | 'monthly';
    file1Label: string;
    file2Label: string;
    baselineShafts: Record<string, { layerFlags: boolean[]; tunnelPct: number; castingPct: number; precastPct: number; bottomSlabDone: boolean }>;
    baselineWcShafts?: Record<string, { layerFlags: boolean[]; tunnelPct: number; castingPct: number; precastPct: number; bottomSlabDone: boolean }>;
    prevWbCompletedM?: number;
  },
  waTunnelDiaTotalsM?: Partial<Record<PipeDia, number>>
) {
  const waRows = mapShaftRows(
    shafts,
    compareInfo ? { baselineShafts: compareInfo.baselineShafts } : undefined
  );
  const wcRows = mapShaftRows(
    wcData.shafts,
    compareInfo?.baselineWcShafts
      ? { baselineShafts: compareInfo.baselineWcShafts }
      : undefined,
    wcData.geoNodes
  );

  const wbRows = wbData.nodes.map((n, idx) => ({
    'No.': n.index,
    'Node ID': n.id,
    Latitude: n.lat,
    Longitude: n.lon,
    'Chainage (m)': Number(n.chainageM.toFixed(2)),
    Status: n.status.toUpperCase(),
    'S. Date': formatDateDisplay(n.sDate),
    'E. Date': formatDateDisplay(n.eDate),
    'Duration (Days)': calcDurationDays(n.sDate, n.eDate) ?? (n.status === 'ongoing' ? 'On-going' : ''),
    'Pipe Spec': idx === 0 ? wbData.pipeDia : '',
    'WB Total Length (m)': idx === 0 ? wbData.totalLengthM : '',
    'WB Completed Length (m)': idx === 0 ? wbData.completedLengthM : '',
    'WB Remaining Length (m)':
      idx === 0 ? Number(Math.max(0, wbData.totalLengthM - wbData.completedLengthM).toFixed(2)) : '',
  }));

  const waSummary = computeSummary(
    shafts,
    compareInfo
      ? {
          label: compareInfo.file1Label,
          date: reportDate,
          capturedAt: '',
          shafts: compareInfo.baselineShafts,
          pumpLayersDone: pumpStation.layers.map((l) => l.status === 'complete'),
          pumpMachineRoomStatus: pumpStation.machineRoom.status,
        }
      : undefined,
    pumpStation,
    undefined,
    waTunnelDiaTotalsM
  );
  const wcSummary = computeSummary(wcData.shafts);
  const wbPct = wbData.totalLengthM > 0 ? (wbData.completedLengthM / wbData.totalLengthM) * 100 : 0;

  const summaryRows = [
    { Section: 'Report', Category: 'Report Date', Metric: 'Date', Value: formatDateDisplay(reportDate), Unit: '' },
    ...(compareInfo
      ? [
          { Section: 'Compare', Category: 'Comparison', Metric: 'File 1 (Previous)', Value: compareInfo.file1Label, Unit: '' },
          { Section: 'Compare', Category: 'Comparison', Metric: 'File 2 (Current/Final)', Value: compareInfo.file2Label, Unit: '' },
          { Section: 'Compare', Category: 'WA Delta', Metric: 'Added Shaft Layers', Value: waSummary.delta.addedLayers, Unit: 'Layers' },
          { Section: 'Compare', Category: 'WA Delta', Metric: 'Added Tunnel Length', Value: Number(waSummary.delta.addedTunnelM.toFixed(2)), Unit: 'm' },
          { Section: 'Compare', Category: 'WA Delta', Metric: 'MH Cast (New Complete / On-going)', Value: `${waSummary.delta.addedCastingCompleted} / ${waSummary.delta.addedCastingOngoing}`, Unit: 'Nos' },
          { Section: 'Compare', Category: 'WA Delta', Metric: 'MH Ring (New Complete / On-going)', Value: `${waSummary.delta.addedPrecastCompleted} / ${waSummary.delta.addedPrecastOngoing}`, Unit: 'Nos' },
          {
            Section: 'Compare',
            Category: 'WB Delta',
            Metric: 'Added Open Cut Length',
            Value: Number(Math.max(0, wbData.completedLengthM - (compareInfo.prevWbCompletedM ?? 0)).toFixed(2)),
            Unit: 'm',
          },
        ]
      : []),
    { Section: 'WA', Category: 'Shafts', Metric: 'Total Shafts', Value: waSummary.totalShafts, Unit: 'Nos' },
    { Section: 'WA', Category: 'Shafts', Metric: 'Completed / On-going / Remaining', Value: `${waSummary.completedShafts} / ${waSummary.ongoingShafts} / ${waSummary.remainingShafts}`, Unit: 'Nos' },
    { Section: 'WA', Category: 'Manholes', Metric: 'Casting (Complete / On-going / Remaining)', Value: `${waSummary.castingCompleteCount} / ${waSummary.castingOngoingCount} / ${waSummary.castingRemainingCount}`, Unit: 'Nos' },
    { Section: 'WA', Category: 'Manholes', Metric: 'Ring (Complete / On-going / Remaining)', Value: `${waSummary.precastCompleteCount} / ${waSummary.precastOngoingCount} / ${waSummary.precastRemainingCount}`, Unit: 'Nos' },
    { Section: 'WA', Category: 'Micro-Tunnelling', Metric: 'Completed / Total Length', Value: `${(waSummary.completedTunnelLengthM / 1000).toFixed(3)} / ${(waSummary.totalTunnelLengthM / 1000).toFixed(3)}`, Unit: 'km' },
    { Section: 'SPS', Category: 'Pump Station', Metric: 'Lower Main Structure (L1 bottom→L5 top)', Value: `${getPumpLowerStatus(pumpStation).toUpperCase()} (${pumpStation.layers.filter((l) => l.status === 'complete').length}/5 layers)`, Unit: '' },
    { Section: 'SPS', Category: 'Pump Station', Metric: 'Sinking Status & Completed / Remaining', Value: `${pumpStation.sinkingStatus.toUpperCase()} (${pumpStation.sinkingCompletedM}m / ${pumpStation.totalHeightM}m, Rem: ${Math.max(0, Number((pumpStation.totalHeightM - pumpStation.sinkingCompletedM).toFixed(2)))}m)`, Unit: 'm' },
    { Section: 'SPS', Category: 'Pump Station', Metric: 'Upper Machine Room', Value: pumpStation.machineRoom.status.toUpperCase(), Unit: '' },
    { Section: 'WB', Category: 'Open Cut', Metric: 'Total / Completed / Remaining', Value: `${wbData.totalLengthM}m / ${wbData.completedLengthM}m / ${Math.max(0, wbData.totalLengthM - wbData.completedLengthM).toFixed(1)}m (${wbPct.toFixed(1)}%)`, Unit: 'm' },
    { Section: 'WB', Category: 'Nodes', Metric: 'Total / Complete / On-going / Remaining', Value: `${wbData.nodes.length} / ${wbData.nodes.filter((n) => n.status === 'complete').length} / ${wbData.nodes.filter((n) => n.status === 'ongoing').length} / ${wbData.nodes.filter((n) => n.status === 'remaining').length}`, Unit: 'Nos' },
    { Section: 'WC', Category: 'Shafts', Metric: 'Total / Completed / On-going / Remaining', Value: `${wcSummary.totalShafts} / ${wcSummary.completedShafts} / ${wcSummary.ongoingShafts} / ${wcSummary.remainingShafts}`, Unit: 'Nos' },
    { Section: 'WC', Category: 'Micro-Tunnelling', Metric: 'Completed / Total Length', Value: `${(wcSummary.completedTunnelLengthM / 1000).toFixed(3)} / ${(wcSummary.totalTunnelLengthM / 1000).toFixed(3)}`, Unit: 'km' },
  ];

  const pumpRows = [
    {
      Part: 'Upper Part — Machine Room',
      Item: 'Machine Room (Control / Storage / Pump House)',
      Status: pumpStation.machineRoom.status.toUpperCase(),
      'S. Date': formatDateDisplay(pumpStation.machineRoom.sDate),
      'E. Date': formatDateDisplay(pumpStation.machineRoom.eDate),
      'Duration (Days)': calcDurationDays(pumpStation.machineRoom.sDate, pumpStation.machineRoom.eDate) ?? '-',
      'Total Height (m)': '',
      'Casting Complete (m)': '',
      'Sinking Complete (m)': '',
      'Sinking Status': '',
    },
    ...[4, 3, 2, 1, 0].map((li) => {
      const ly = pumpStation.layers[li];
      return {
        Part: 'Lower Part — Main Structure (Top L5 down to Base L1)',
        Item: `L${li + 1}: ${ly.name}`,
        Status: ly.status.toUpperCase(),
        'S. Date': formatDateDisplay(ly.sDate),
        'E. Date': formatDateDisplay(ly.eDate),
        'Duration (Days)': calcDurationDays(ly.sDate, ly.eDate) ?? '-',
        'Total Height (m)': li === 0 ? pumpStation.totalHeightM : '',
        'Casting Complete (m)': li === 0 ? pumpStation.castingCompleteM : '',
        'Sinking Complete (m)': li === 0 ? pumpStation.sinkingCompletedM : '',
        'Sinking Status': li === 0 ? pumpStation.sinkingStatus.toUpperCase() : '',
      };
    }),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(waRows), 'WA_Shafts_Progress');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pumpRows), 'Pump_Station_2Part');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(wbRows), 'WB_OpenCut_Nodes');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(wcRows), 'WC_Shafts_Progress');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Summary');
  return wb;
}

export function exportSavedFileExcel(
  file: SavedProgressFile,
  settings: SheetSettings,
  filename: string
): void {
  const wb = buildWorkbookFromData(
    file.shafts,
    file.pumpStation,
    file.wb || createInitialWbData(),
    file.wc || createInitialWcData(),
    file.date,
    undefined,
    settings.waTunnelDiaTotalsM
  );
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  triggerDownload(
    new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename
  );
}

export function exportExcelWorkbook(state: AppState, filename: string): void {
  const ctx = resolveDisplayContext(state);
  const wb = buildWorkbookFromData(
    ctx.displayShafts,
    ctx.displayPump,
    ctx.displayWb,
    ctx.displayWc,
    state.settings.reportDate,
    state.viewMode === 'overall'
      ? undefined
      : {
          mode: state.viewMode,
          file1Label: ctx.file1Label,
          file2Label: ctx.file2Label,
          baselineShafts: ctx.baseline.shafts,
          baselineWcShafts: ctx.baseline.wcShafts,
          prevWbCompletedM: ctx.baseline.wbCompletedLengthM,
        },
    state.settings.waTunnelDiaTotalsM
  );
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  triggerDownload(
    new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename
  );
}

function excelCellToIsoDate(val: unknown): string {
  if (val == null || val === '') return '';
  if (typeof val === 'number') {
    const parsed = XLSX.SSF.parse_date_code(val);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }
  return parseDateInput(String(val));
}

function mergeShaftRowsFromSheet(
  rows: Record<string, unknown>[],
  currentShafts: ShaftRecord[]
): ShaftRecord[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const rawId = String(r['Shaft ID'] || r['ID'] || '').replace(/\s+/g, '').replace('Shaft', '');
    if (rawId) byId.set(rawId.toUpperCase(), r);
  }

  return currentShafts.map((s) => {
    const row = byId.get(s.id.toUpperCase());
    if (!row) return s;

    const totalLayersRaw = Number(row['Total Layers (6-13)'] ?? s.totalLayers);
    const totalLayers = Math.max(6, Math.min(13, Number.isFinite(totalLayersRaw) ? totalLayersRaw : s.totalLayers));
    const completedLayersRaw = Number(row['Completed Layers'] ?? getShaftCompletedLayersCount(s));
    const completedLayers = Math.max(0, Math.min(totalLayers, Number.isFinite(completedLayersRaw) ? completedLayersRaw : 0));

    let flags = resizeShaftLayers(s.layerFlags, totalLayers);
    if (flags.filter(Boolean).length !== completedLayers) {
      flags = Array.from({ length: totalLayers }, (_, i) => i < completedLayers);
    }

    const bsVal = String(row['Bottom Slab Done (Yes/No)'] ?? '').toLowerCase();
    const bottomSlabDone = bsVal ? bsVal === 'yes' || bsVal === 'true' || bsVal === '1' : s.bottomSlabDone;

    const stTypeRaw = String(row['Type of Shaft'] ?? s.shaftType) as ShaftType;
    const shaftType: ShaftType = ['Driving', 'Receiving', 'Receiving/Driving'].includes(stTypeRaw)
      ? stTypeRaw
      : s.shaftType;

    const diaRaw = String(row['Pipe Dia'] ?? s.pipeDia).toUpperCase() as PipeDia;
    const pipeDia: PipeDia = ['DN900', 'DN1100', 'DN1600', 'DN1800', 'DN2400', 'DN2600'].includes(diaRaw)
      ? diaRaw
      : s.pipeDia;

    const castingRaw = Number(row['Manhole Casting (%)'] ?? s.castingPct);
    const precastRaw = Number(row['Manhole Precast Ring (%)'] ?? s.precastPct);
    const lenRaw = Number(row['Tunnel Length (m)'] ?? s.tunnelLengthM);
    const pctRaw = Number(row['Tunnel Completed (%)'] ?? s.tunnelPct);

    return {
      ...s,
      shaftSize: String(row['Shaft Size (mm)'] ?? s.shaftSize),
      shaftType,
      netHeightMm: Number(row['Net Height (mm)'] ?? s.netHeightMm) || s.netHeightMm,
      bottomSlabMm: Number(row['Bottom Slab (mm)'] ?? s.bottomSlabMm) || s.bottomSlabMm,
      totalLayers,
      layerFlags: flags,
      bottomSlabDone,
      shaftSDate: row['Shaft S.Date (DD/MM/YYYY)'] !== undefined ? excelCellToIsoDate(row['Shaft S.Date (DD/MM/YYYY)']) : s.shaftSDate,
      shaftEDate: row['Shaft E.Date (DD/MM/YYYY)'] !== undefined ? excelCellToIsoDate(row['Shaft E.Date (DD/MM/YYYY)']) : s.shaftEDate,
      castingPct: Math.max(0, Math.min(100, Number.isFinite(castingRaw) ? castingRaw : s.castingPct)),
      precastPct: Math.max(0, Math.min(100, Number.isFinite(precastRaw) ? precastRaw : s.precastPct)),
      manholeSDate: row['Manhole S.Date (DD/MM/YYYY)'] !== undefined ? excelCellToIsoDate(row['Manhole S.Date (DD/MM/YYYY)']) : s.manholeSDate,
      manholeEDate: row['Manhole E.Date (DD/MM/YYYY)'] !== undefined ? excelCellToIsoDate(row['Manhole E.Date (DD/MM/YYYY)']) : s.manholeEDate,
      pipeDia,
      tunnelLengthM: Number.isFinite(lenRaw) && lenRaw >= 0 ? lenRaw : s.tunnelLengthM,
      tunnelPct: Math.max(0, Math.min(100, Number.isFinite(pctRaw) ? pctRaw : s.tunnelPct)),
      tunnelSDate: row['Tunnel S.Date (DD/MM/YYYY)'] !== undefined ? excelCellToIsoDate(row['Tunnel S.Date (DD/MM/YYYY)']) : s.tunnelSDate,
      tunnelEDate: row['Tunnel E.Date (DD/MM/YYYY)'] !== undefined ? excelCellToIsoDate(row['Tunnel E.Date (DD/MM/YYYY)']) : s.tunnelEDate,
    };
  });
}

export async function importExcelShafts(
  file: File,
  currentShafts: ShaftRecord[]
): Promise<ShaftRecord[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames.includes('WA_Shafts_Progress')
    ? 'WA_Shafts_Progress'
    : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName]);
  return mergeShaftRowsFromSheet(rows, currentShafts);
}

export async function importFullExcelWorkbook(
  file: File,
  currentState: AppState
): Promise<{ shafts: ShaftRecord[]; wb: WbSectionData; wc: WcSectionData }> {
  const buf = await file.arrayBuffer();
  const book = XLSX.read(buf, { type: 'array' });

  // 1. WA Shafts
  const waSheetName = book.SheetNames.includes('WA_Shafts_Progress')
    ? 'WA_Shafts_Progress'
    : book.SheetNames[0];
  const waRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[waSheetName]);
  const nextWaShafts = mergeShaftRowsFromSheet(waRows, currentState.shafts);

  // 2. WC Shafts
  let nextWc = currentState.wc;
  if (book.SheetNames.includes('WC_Shafts_Progress')) {
    const wcRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      book.Sheets['WC_Shafts_Progress']
    );
    nextWc = {
      ...currentState.wc,
      shafts: mergeShaftRowsFromSheet(wcRows, currentState.wc.shafts),
    };
  }

  // 3. WB Open-Cut Nodes
  let nextWb = currentState.wb;
  if (book.SheetNames.includes('WB_OpenCut_Nodes')) {
    const wbRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      book.Sheets['WB_OpenCut_Nodes']
    );
    const byNodeId = new Map<string, Record<string, unknown>>();
    let headerTotal = nextWb.totalLengthM;
    let headerComp = nextWb.completedLengthM;

    for (const r of wbRows) {
      const nid = String(r['Node ID'] || '').trim().toUpperCase();
      if (nid) byNodeId.set(nid, r);
      const tVal = Number(r['WB Total Length (m)']);
      if (Number.isFinite(tVal) && tVal > 0) headerTotal = tVal;
      const cVal = Number(r['WB Completed Length (m)']);
      if (Number.isFinite(cVal) && cVal >= 0) headerComp = cVal;
    }

    const updatedNodes = nextWb.nodes.map((n) => {
      const r = byNodeId.get(n.id.toUpperCase());
      if (!r) return n;
      const stRaw = String(r['Status'] || n.status).toLowerCase();
      const status: WorkStatus =
        stRaw === 'complete' || stRaw === 'done'
          ? 'complete'
          : stRaw === 'ongoing' || stRaw === 'on-going'
          ? 'ongoing'
          : 'remaining';
      return {
        ...n,
        status,
        sDate: r['S. Date'] !== undefined ? excelCellToIsoDate(r['S. Date']) : n.sDate,
        eDate: r['E. Date'] !== undefined ? excelCellToIsoDate(r['E. Date']) : n.eDate,
      };
    });

    nextWb = {
      ...nextWb,
      totalLengthM: headerTotal,
      completedLengthM: Math.min(headerTotal, headerComp),
      nodes: recomputeWbChainages(updatedNodes, headerTotal),
    };
  }

  return { shafts: nextWaShafts, wb: nextWb, wc: nextWc };
}

/**
 * Generates an AutoCAD-compatible ASCII DXF file (A1 841x594 mm coordinates)
 * covering WA Shafts, 2-Part Pump Station, WB Open Cut polyline + Blue Tip, and WC Shafts.
 */
export function exportAutoCadDxf(state: AppState, filename: string): void {
  const lines: string[] = [];
  const push = (...vals: (string | number)[]) => {
    for (const v of vals) lines.push(String(v));
  };

  const addLayer = (name: string, aciColor: number) => {
    push(0, 'LAYER', 2, name, 70, 0, 62, aciColor, 6, 'CONTINUOUS');
  };

  const dxfRect = (layer: string, x: number, yTop: number, w: number, h: number) => {
    const y0 = 594 - yTop;
    const y1 = 594 - (yTop + h);
    push(0, 'LWPOLYLINE', 8, layer, 90, 4, 70, 1);
    push(10, x.toFixed(2), 20, y0.toFixed(2));
    push(10, (x + w).toFixed(2), 20, y0.toFixed(2));
    push(10, (x + w).toFixed(2), 20, y1.toFixed(2));
    push(10, x.toFixed(2), 20, y1.toFixed(2));
  };

  const dxfSolidRect = (layer: string, x: number, yTop: number, w: number, h: number) => {
    const y0 = 594 - yTop;
    const y1 = 594 - (yTop + h);
    push(0, 'SOLID', 8, layer);
    push(10, x.toFixed(2), 20, y0.toFixed(2), 30, 0);
    push(11, (x + w).toFixed(2), 21, y0.toFixed(2), 31, 0);
    push(12, x.toFixed(2), 22, y1.toFixed(2), 32, 0);
    push(13, (x + w).toFixed(2), 23, y1.toFixed(2), 33, 0);
  };

  const dxfText = (layer: string, x: number, yTop: number, h: number, txt: string) => {
    const y = 594 - yTop;
    push(0, 'TEXT', 8, layer, 10, x.toFixed(2), 20, y.toFixed(2), 30, 0, 40, h.toFixed(2), 1, txt);
  };

  push(0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC');
  push(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER', 70, 9);
  addLayer('BORDER_TITLE', 7);
  addLayer('SHAFT_PREV_COMPLETE', 3);
  addLayer('SHAFT_CURR_PERIOD', 2);
  addLayer('SHAFT_REMAINING', 1);
  addLayer('MANHOLE_CASTING', 5);
  addLayer('MANHOLE_PRECAST', 4);
  addLayer('TUNNEL_PROGRESS', 6);
  addLayer('WB_OPEN_CUT', 3);
  addLayer('TEXT_TABLES', 7);
  push(0, 'ENDTAB', 0, 'ENDSEC');
  push(0, 'SECTION', 2, 'ENTITIES');

  dxfRect('BORDER_TITLE', 8, 8, 825, 578);
  dxfText('BORDER_TITLE', 14, 18, 4.5, `${state.settings.sectionTitle} [${state.activeSection.toUpperCase()} / ${state.viewMode.toUpperCase()}]`);

  const ctx = resolveDisplayContext(state);
  const cols = state.settings.layoutMode === '12col' ? 12 : 10;
  const colW = 815 / cols;
  const rowH = 115;
  const baseline = ctx.baseline;
  const targetShafts = state.activeSection === 'wc' ? ctx.displayWc.shafts : ctx.displayShafts;
  const targetBaseline =
    state.activeSection === 'wc' ? baseline.wcShafts || {} : baseline.shafts;

  targetShafts.forEach((s, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x0 = 13 + col * colW;
    const y0 = 28 + row * rowH;
    const doneL = getShaftCompletedLayersCount(s);

    dxfText('TEXT_TABLES', x0 + colW * 0.25, y0 + 5, 3.0, `Shaft ${s.id} (L:${doneL}/${s.totalLayers})`);
    dxfText('TEXT_TABLES', x0 + 2, y0 + 12, 1.8, `${s.shaftSize} | ${s.shaftType}`);
    dxfText('TEXT_TABLES', x0 + 2, y0 + 16, 1.8, `H:${s.netHeightMm} BS:${s.bottomSlabMm}`);
    dxfText('TEXT_TABLES', x0 + 2, y0 + 21, 1.7, `SH: ${formatDateDisplay(s.shaftSDate)} - ${formatDateDisplay(s.shaftEDate) || getShaftStatus(s)}`);
    dxfText('TEXT_TABLES', x0 + 2, y0 + 25, 1.7, `MT: ${formatDateDisplay(s.tunnelSDate)} - ${formatDateDisplay(s.tunnelEDate)}`);
    dxfText('TEXT_TABLES', x0 + 2, y0 + 29, 1.7, `MH: ${formatDateDisplay(s.manholeSDate)} - ${formatDateDisplay(s.manholeEDate)}`);

    const sx = x0 + colW * 0.48;
    const sy = y0 + 34;
    const wallH = 54;
    const layerH = wallH / s.totalLayers;
    const bSnap = targetBaseline[s.id];

    for (let li = 0; li < s.totalLayers; li++) {
      const ly = s.sheetPileStyle
        ? sy + wallH - (li + 1) * layerH
        : sy + li * layerH;
      const isDone = Boolean(s.layerFlags[li]);
      const wasPrev = Boolean(bSnap?.layerFlags?.[li]);
      let lyrName = 'SHAFT_REMAINING';
      if (isDone) {
        if (state.viewMode !== 'overall' && !wasPrev) lyrName = 'SHAFT_CURR_PERIOD';
        else lyrName = 'SHAFT_PREV_COMPLETE';
      }
      const wThick = s.sheetPileStyle ? 1.8 : 3;
      const rightX = s.sheetPileStyle ? sx + 21 - wThick : sx + 18;
      if (isDone) {
        dxfSolidRect(lyrName, sx, ly, wThick, layerH - 0.3);
        dxfSolidRect(lyrName, rightX, ly, wThick, layerH - 0.3);
      } else {
        dxfRect(lyrName, sx, ly, wThick, layerH - 0.3);
        dxfRect(lyrName, rightX, ly, wThick, layerH - 0.3);
      }
      if (!s.sheetPileStyle) {
        dxfText('TEXT_TABLES', sx + 22.5, ly + layerH * 0.7, 1.4, `W${li + 1}`);
      }
    }

    const mhX = sx + 6.5;
    const mhW = 8;
    const precastH = wallH * 0.45;
    const castingH = wallH * 0.48;
    if (s.precastPct > 0) dxfSolidRect('MANHOLE_PRECAST', mhX, sy + 2, mhW, precastH);
    else dxfRect('SHAFT_REMAINING', mhX, sy + 2, mhW, precastH);

    if (s.castingPct > 0) dxfSolidRect('MANHOLE_CASTING', mhX, sy + 2 + precastH, mhW, castingH);
    else dxfRect('SHAFT_REMAINING', mhX, sy + 2 + precastH, mhW, castingH);

    // Flush shaft-wall tunnel bar
    const tx = sx + 21;
    const tw = colW - 21 - (sx - x0);
    const ty = sy + wallH - 9;
    dxfRect('TEXT_TABLES', tx, ty, Math.max(8, tw), 5);
    if (s.tunnelPct > 0 && tw > 0) {
      dxfSolidRect('TUNNEL_PROGRESS', tx, ty, (tw * s.tunnelPct) / 100, 5);
    }
    dxfText('TEXT_TABLES', tx + 1, ty + 8.5, 1.7, `${s.pipeDia}: ${s.tunnelLengthM}m (${s.tunnelPct}%)`);
  });

  // WB Open-Cut Polyline block
  const wbVp = buildGeoViewport(ctx.displayWb.nodes, 560, 405, 255, 130, 0.12);
  dxfRect('WB_OPEN_CUT', 560, 405, 255, 130);
  dxfText(
    'TEXT_TABLES',
    565,
    414,
    2.4,
    `WB OPEN CUT (${ctx.displayWb.pipeDia}): ${ctx.displayWb.completedLengthM}m / ${ctx.displayWb.totalLengthM}m`
  );
  if (ctx.displayWb.nodes.length >= 2) {
    push(0, 'LWPOLYLINE', 8, 'WB_OPEN_CUT', 90, ctx.displayWb.nodes.length, 70, 0);
    for (const n of ctx.displayWb.nodes) {
      const pt = wbVp.project(n.lat, n.lon);
      push(10, pt.x.toFixed(2), 20, (594 - pt.y).toFixed(2));
    }
  }

  const summary = computeSummary(ctx.displayShafts, baseline);
  dxfText(
    'BORDER_TITLE',
    14,
    555,
    2.8,
    `WA: Shafts ${summary.completedShafts}/${summary.totalShafts} | Tunnel ${(summary.completedTunnelLengthM / 1000).toFixed(3)}/${(summary.totalTunnelLengthM / 1000).toFixed(3)}km | Pump Lower: ${getPumpLowerStatus(ctx.displayPump).toUpperCase()} | Sinking: ${ctx.displayPump.sinkingStatus.toUpperCase()} | WB: ${ctx.displayWb.completedLengthM}/${ctx.displayWb.totalLengthM}m | WC: ${ctx.displayWc.shafts.length} Shafts`
  );

  push(0, 'ENDSEC', 0, 'EOF');
  triggerDownload(new Blob([lines.join('\n')], { type: 'application/dxf' }), filename);
}
