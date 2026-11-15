import { jsPDF } from 'jspdf';
import { svg2pdf } from 'svg2pdf.js';
import * as XLSX from 'xlsx';
import { AppState, PipeDia, PumpStationData, SavedProgressFile, ShaftRecord, ShaftType, SheetSettings } from '../types';
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
  resizeShaftLayers,
  resolveDisplayContext,
} from './calculations';

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

export async function exportA1VectorPdf(
  svgEl: SVGSVGElement,
  filename: string
): Promise<void> {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('width', '841');
  clone.setAttribute('height', '594');
  // Remove transient selection highlight attributes if any
  clone.querySelectorAll('[data-selection-ring="true"]').forEach((n) => n.remove());

  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [841, 594],
    compress: true,
  });

  await svg2pdf(clone, pdf, {
    x: 0,
    y: 0,
    width: 841,
    height: 594,
  });

  pdf.save(filename);
}

export function exportSvgFile(svgEl: SVGSVGElement, filename: string): void {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', '841mm');
  clone.setAttribute('height', '594mm');
  clone.querySelectorAll('[data-selection-ring="true"]').forEach((n) => n.remove());
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  triggerDownload(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }), filename);
}

export async function exportHighResPng(
  svgEl: SVGSVGElement,
  filename: string
): Promise<void> {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // 4205 x 2970 (~127 DPI on A1 landscape — razor sharp & fast)
  const width = 4205;
  const height = 2970;
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.querySelectorAll('[data-selection-ring="true"]').forEach((n) => n.remove());

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

function buildWorkbookFromData(
  shafts: ShaftRecord[],
  pumpStation: PumpStationData,
  reportDate: string,
  compareInfo?: {
    mode: 'weekly' | 'monthly';
    file1Label: string;
    file2Label: string;
    baselineShafts: Record<string, { layerFlags: boolean[]; tunnelPct: number; castingPct: number; precastPct: number; bottomSlabDone: boolean }>;
  }
) {
  const rows = shafts.map((s) => {
    const shDone = getShaftCompletedLayersCount(s);
    const shDur = calcDurationDays(s.shaftSDate, s.shaftEDate);
    const mhDur = calcDurationDays(s.manholeSDate, s.manholeEDate);
    const mtDur = calcDurationDays(s.tunnelSDate, s.tunnelEDate);
    const prevSnap = compareInfo?.baselineShafts[s.id];
    const prevLayers = prevSnap
      ? (prevSnap.layerFlags || []).slice(0, s.totalLayers).filter(Boolean).length
      : 0;

    return {
      'No.': s.index,
      'Shaft ID': s.id,
      'Next Connection': s.nextId,
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

  const summary = computeSummary(
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
      : undefined
  );

  const summaryRows = [
    { Category: 'Report Date', Metric: 'Date', Value: formatDateDisplay(reportDate), Unit: '' },
    ...(compareInfo
      ? [
          { Category: 'Comparison', Metric: 'File 1 (Previous)', Value: compareInfo.file1Label, Unit: '' },
          { Category: 'Comparison', Metric: 'File 2 (Current/Final)', Value: compareInfo.file2Label, Unit: '' },
          { Category: 'Delta', Metric: 'Added Shaft Layers', Value: summary.delta.addedLayers, Unit: 'Layers' },
          { Category: 'Delta', Metric: 'Added Tunnel Length', Value: Number(summary.delta.addedTunnelM.toFixed(2)), Unit: 'm' },
        ]
      : []),
    { Category: 'Shafts', Metric: 'Total Shafts', Value: summary.totalShafts, Unit: 'Nos' },
    { Category: 'Shafts', Metric: 'Completed Shafts', Value: summary.completedShafts, Unit: 'Nos' },
    { Category: 'Shafts', Metric: 'On-going Shafts', Value: summary.ongoingShafts, Unit: 'Nos' },
    { Category: 'Shafts', Metric: 'Remaining Shafts', Value: summary.remainingShafts, Unit: 'Nos' },
    { Category: 'Manholes', Metric: 'Total Manholes', Value: summary.totalManholes, Unit: 'Nos' },
    { Category: 'Manholes', Metric: 'Completed Manholes (Both Parts)', Value: summary.completedManholes, Unit: 'Nos' },
    { Category: 'Manholes', Metric: 'Casting Completed', Value: summary.castingCompleteCount, Unit: 'Nos' },
    { Category: 'Manholes', Metric: 'Precast Ring Completed', Value: summary.precastCompleteCount, Unit: 'Nos' },
    { Category: 'Micro-Tunnelling', Metric: 'Total Length', Value: Number((summary.totalTunnelLengthM / 1000).toFixed(3)), Unit: 'km' },
    { Category: 'Micro-Tunnelling', Metric: 'Completed Length', Value: Number((summary.completedTunnelLengthM / 1000).toFixed(3)), Unit: 'km' },
    { Category: 'Pump Station', Metric: 'Lower Main Structure', Value: `${getPumpLowerStatus(pumpStation).toUpperCase()} (${pumpStation.layers.filter((l) => l.status === 'complete').length}/5 layers)`, Unit: '' },
    { Category: 'Pump Station', Metric: 'Upper Machine Room', Value: pumpStation.machineRoom.status.toUpperCase(), Unit: '' },
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
    },
    ...pumpStation.layers.map((ly, idx) => ({
      Part: 'Lower Part — Main Structure',
      Item: ly.name,
      Status: ly.status.toUpperCase(),
      'S. Date': formatDateDisplay(ly.sDate),
      'E. Date': formatDateDisplay(ly.eDate),
      'Duration (Days)': calcDurationDays(ly.sDate, ly.eDate) ?? '-',
      'Total Height (m)': idx === 0 ? pumpStation.totalHeightM : '',
      'Casting Complete (m)': idx === 0 ? pumpStation.castingCompleteM : '',
      'Sinking Complete (m)': idx === 0 ? pumpStation.sinkingCompletedM : '',
    })),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'WA_Shafts_Progress');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pumpRows), 'Pump_Station_2Part');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Summary');
  return wb;
}

export function exportSavedFileExcel(
  file: SavedProgressFile,
  _settings: SheetSettings,
  filename: string
): void {
  const wb = buildWorkbookFromData(file.shafts, file.pumpStation, file.date);
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
    state.settings.reportDate,
    state.viewMode === 'overall'
      ? undefined
      : {
          mode: state.viewMode,
          file1Label: ctx.file1Label,
          file2Label: ctx.file2Label,
          baselineShafts: ctx.baseline.shafts,
        }
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
    // Rebuild flags top-down if count changed
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
    const pipeDia: PipeDia = ['DN900', 'DN1100', 'DN1600'].includes(diaRaw) ? diaRaw : s.pipeDia;

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
      tunnelLengthM: Number.isFinite(lenRaw) && lenRaw > 0 ? lenRaw : s.tunnelLengthM,
      tunnelPct: Math.max(0, Math.min(100, Number.isFinite(pctRaw) ? pctRaw : s.tunnelPct)),
      tunnelSDate: row['Tunnel S.Date (DD/MM/YYYY)'] !== undefined ? excelCellToIsoDate(row['Tunnel S.Date (DD/MM/YYYY)']) : s.tunnelSDate,
      tunnelEDate: row['Tunnel E.Date (DD/MM/YYYY)'] !== undefined ? excelCellToIsoDate(row['Tunnel E.Date (DD/MM/YYYY)']) : s.tunnelEDate,
    };
  });
}

/**
 * Generates an AutoCAD-compatible ASCII DXF file (A1 841x594 mm coordinates)
 * with separated CAD layers for Prev Period, Current Period, Remaining, Manhole, Tunnel, and Texts.
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
    // DXF Y goes up from bottom (0..594)
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
  push(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER', 70, 8);
  addLayer('BORDER_TITLE', 7);
  addLayer('SHAFT_PREV_COMPLETE', 3);
  addLayer('SHAFT_CURR_PERIOD', 2);
  addLayer('SHAFT_REMAINING', 1);
  addLayer('MANHOLE_CASTING', 5);
  addLayer('MANHOLE_PRECAST', 4);
  addLayer('TUNNEL_PROGRESS', 6);
  addLayer('TEXT_TABLES', 7);
  push(0, 'ENDTAB', 0, 'ENDSEC');
  push(0, 'SECTION', 2, 'ENTITIES');

  // A1 Border
  dxfRect('BORDER_TITLE', 8, 8, 825, 578);
  dxfText('BORDER_TITLE', 14, 18, 4.5, `${state.settings.sectionTitle} [${state.viewMode.toUpperCase()}]`);

  const ctx = resolveDisplayContext(state);
  const cols = state.settings.layoutMode === '12col' ? 12 : 10;
  const colW = 815 / cols;
  const rowH = 115;
  const baseline = ctx.baseline;

  ctx.displayShafts.forEach((s, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x0 = 13 + col * colW;
    const y0 = 28 + row * rowH;

    dxfText('TEXT_TABLES', x0 + colW * 0.25, y0 + 5, 3.2, `Shaft ${s.id}`);
    dxfText('TEXT_TABLES', x0 + 2, y0 + 12, 1.8, `${s.shaftSize} | ${s.shaftType}`);
    dxfText('TEXT_TABLES', x0 + 2, y0 + 16, 1.8, `H:${s.netHeightMm} BS:${s.bottomSlabMm}`);
    dxfText('TEXT_TABLES', x0 + 2, y0 + 21, 1.7, `SH: ${formatDateDisplay(s.shaftSDate)} - ${formatDateDisplay(s.shaftEDate) || getShaftStatus(s)}`);
    dxfText('TEXT_TABLES', x0 + 2, y0 + 25, 1.7, `MT: ${formatDateDisplay(s.tunnelSDate)} - ${formatDateDisplay(s.tunnelEDate)}`);
    dxfText('TEXT_TABLES', x0 + 2, y0 + 29, 1.7, `MH: ${formatDateDisplay(s.manholeSDate)} - ${formatDateDisplay(s.manholeEDate)}`);

    const sx = x0 + colW * 0.48;
    const sy = y0 + 34;
    const wallH = 54;
    const layerH = wallH / s.totalLayers;
    const bSnap = baseline.shafts[s.id];

    for (let li = 0; li < s.totalLayers; li++) {
      const ly = sy + li * layerH;
      const isDone = Boolean(s.layerFlags[li]);
      const wasPrev = Boolean(bSnap?.layerFlags?.[li]);
      let lyrName = 'SHAFT_REMAINING';
      if (isDone) {
        if (state.viewMode !== 'overall' && !wasPrev) lyrName = 'SHAFT_CURR_PERIOD';
        else lyrName = 'SHAFT_PREV_COMPLETE';
      }
      if (isDone) {
        dxfSolidRect(lyrName, sx, ly, 3, layerH - 0.3);
        dxfSolidRect(lyrName, sx + 18, ly, 3, layerH - 0.3);
      } else {
        dxfRect(lyrName, sx, ly, 3, layerH - 0.3);
        dxfRect(lyrName, sx + 18, ly, 3, layerH - 0.3);
      }
      dxfText('TEXT_TABLES', sx + 22.5, ly + layerH * 0.7, 1.4, `W${li + 1}`);
    }

    // Manhole 2 parts: Upper Precast + Lower Casting
    const mhX = sx + 6.5;
    const mhW = 8;
    const precastH = wallH * 0.45;
    const castingH = wallH * 0.48;
    if (s.precastPct > 0) dxfSolidRect('MANHOLE_PRECAST', mhX, sy + 2, mhW, precastH);
    else dxfRect('SHAFT_REMAINING', mhX, sy + 2, mhW, precastH);

    if (s.castingPct > 0) dxfSolidRect('MANHOLE_CASTING', mhX, sy + 2 + precastH, mhW, castingH);
    else dxfRect('SHAFT_REMAINING', mhX, sy + 2 + precastH, mhW, castingH);

    // Tunnel Bar
    const tx = sx + 18;
    const tw = colW - (tx - x0);
    const ty = sy + wallH - 9;
    dxfRect('TEXT_TABLES', tx, ty, tw, 5);
    if (s.tunnelPct > 0) {
      dxfSolidRect('TUNNEL_PROGRESS', tx, ty, (tw * s.tunnelPct) / 100, 5);
    }
    dxfText('TEXT_TABLES', tx + 2, ty + 8.5, 1.7, `${s.pipeDia}: ${s.tunnelLengthM}m (${s.tunnelPct}%)`);
  });

  const summary = computeSummary(ctx.displayShafts, baseline);
  dxfText(
    'BORDER_TITLE',
    14,
    540,
    3,
    `SUMMARY: Shafts ${summary.completedShafts}/${summary.totalShafts} Complete (${summary.ongoingShafts} On-going) | Manholes ${summary.completedManholes}/${summary.totalManholes} | Tunnel ${(summary.completedTunnelLengthM / 1000).toFixed(3)} / ${(summary.totalTunnelLengthM / 1000).toFixed(3)} km | Pump Lower: ${getPumpLowerStatus(ctx.displayPump).toUpperCase()} | Machine Room: ${ctx.displayPump.machineRoom.status.toUpperCase()}`
  );

  push(0, 'ENDSEC', 0, 'EOF');
  triggerDownload(new Blob([lines.join('\n')], { type: 'application/dxf' }), filename);
}
