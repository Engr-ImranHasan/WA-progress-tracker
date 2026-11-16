import {
  AppState,
  PeriodBaseline,
  PumpStationData,
  SavedProgressFile,
  ShaftRecord,
  ShaftSnapshotItem,
  WorkStatus,
} from '../types';

export const LIVE_WORKSPACE_ID = '__LIVE__';

export function formatDateDisplay(iso: string): string {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function parseDateInput(val: string): string {
  const v = val.trim();
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return '';
}

/**
 * Inclusive engineering day count matching original AutoCAD table:
 * e.g. 04/07/2026 to 10/07/2026 = 07 Days
 */
export function calcDurationDays(sDate: string, eDate: string): number | null {
  if (!sDate || !eDate) return null;
  const s = new Date(`${sDate}T00:00:00Z`).getTime();
  const e = new Date(`${eDate}T00:00:00Z`).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return null;
  return Math.round((e - s) / 86400000) + 1;
}

export function calcElapsedDays(sDate: string, refDate: string): number | null {
  if (!sDate || !refDate) return null;
  const s = new Date(`${sDate}T00:00:00Z`).getTime();
  const r = new Date(`${refDate}T00:00:00Z`).getTime();
  if (Number.isNaN(s) || Number.isNaN(r) || r < s) return null;
  return Math.round((r - s) / 86400000) + 1;
}

export function getShaftCompletedLayersCount(s: ShaftRecord): number {
  return s.layerFlags.slice(0, s.totalLayers).filter(Boolean).length;
}

export function getShaftStatus(s: ShaftRecord): WorkStatus {
  const doneLayers = getShaftCompletedLayersCount(s);
  const allLayersDone = doneLayers >= s.totalLayers;
  if (allLayersDone && s.bottomSlabDone && Boolean(s.shaftEDate)) {
    return 'complete';
  }
  if (allLayersDone && (s.bottomSlabDone || Boolean(s.shaftEDate))) {
    if (s.bottomSlabDone && !s.shaftSDate && !s.shaftEDate) return 'complete';
    if (Boolean(s.shaftEDate)) return 'complete';
  }
  if (doneLayers === 0 && !s.bottomSlabDone && !s.shaftSDate) {
    return 'remaining';
  }
  return 'ongoing';
}

export function getPartStatus(pct: number): WorkStatus {
  if (pct <= 0) return 'remaining';
  if (pct >= 100) return 'complete';
  return 'ongoing';
}

export function getManholeStatus(s: ShaftRecord): WorkStatus {
  const c = s.castingPct;
  const p = s.precastPct;
  if (c >= 100 && p >= 100) return 'complete';
  if (c <= 0 && p <= 0 && !s.manholeSDate) return 'remaining';
  return 'ongoing';
}

export function getTunnelStatus(s: ShaftRecord): WorkStatus {
  if (s.tunnelPct >= 100) return 'complete';
  if (s.tunnelPct <= 0 && !s.tunnelSDate) return 'remaining';
  return 'ongoing';
}

export function getPumpLowerStatus(ps: PumpStationData): WorkStatus {
  const allDone = ps.layers.every((l) => l.status === 'complete');
  if (allDone) return 'complete';
  const anyStarted = ps.layers.some(
    (l) => l.status !== 'remaining' || Boolean(l.sDate)
  );
  return anyStarted ? 'ongoing' : 'remaining';
}

export function createSnapshotFromState(
  shafts: ShaftRecord[],
  pumpLayersDone: boolean[],
  label: string,
  date: string,
  pumpMachineRoomStatus?: WorkStatus
): PeriodBaseline {
  const map: Record<string, ShaftSnapshotItem> = {};
  for (const s of shafts) {
    map[s.id] = {
      layerFlags: s.layerFlags.slice(0, s.totalLayers),
      bottomSlabDone: s.bottomSlabDone,
      castingPct: s.castingPct,
      precastPct: s.precastPct,
      tunnelPct: s.tunnelPct,
    };
  }
  return {
    label,
    date,
    capturedAt: new Date().toISOString(),
    shafts: map,
    pumpLayersDone: [...pumpLayersDone],
    pumpMachineRoomStatus,
  };
}

export function snapshotFromSavedFile(file: SavedProgressFile): PeriodBaseline {
  return createSnapshotFromState(
    file.shafts,
    file.pumpStation.layers.map((l) => l.status === 'complete'),
    `${file.name} (${formatDateDisplay(file.date)})`,
    file.date,
    file.pumpStation.machineRoom.status
  );
}

export interface ProgressSummary {
  totalShafts: number;
  completedShafts: number;
  ongoingShafts: number;
  remainingShafts: number;

  totalManholes: number;
  completedManholes: number;
  ongoingManholes: number;
  remainingManholes: number;
  castingCompleteCount: number;
  precastCompleteCount: number;

  totalTunnelLengthM: number;
  completedTunnelLengthM: number;
  tunnelPctOverall: number;

  byDia: {
    DN900: { totalM: number; completedM: number };
    DN1100: { totalM: number; completedM: number };
    DN1600: { totalM: number; completedM: number };
  };

  delta: {
    addedLayers: number;
    addedShaftsCompleted: number;
    addedCastingCompleted: number;
    addedPrecastCompleted: number;
    addedTunnelM: number;
    addedPumpLayers: number;
  };
}

export function computeSummary(
  shafts: ShaftRecord[],
  baseline?: PeriodBaseline,
  pumpStation?: PumpStationData
): ProgressSummary {
  let completedShafts = 0;
  let ongoingShafts = 0;
  let remainingShafts = 0;

  let completedManholes = 0;
  let ongoingManholes = 0;
  let remainingManholes = 0;
  let castingCompleteCount = 0;
  let precastCompleteCount = 0;

  let totalTunnelLengthM = 0;
  let completedTunnelLengthM = 0;

  const byDia = {
    DN900: { totalM: 0, completedM: 0 },
    DN1100: { totalM: 0, completedM: 0 },
    DN1600: { totalM: 0, completedM: 0 },
  };

  let addedLayers = 0;
  let addedShaftsCompleted = 0;
  let addedCastingCompleted = 0;
  let addedPrecastCompleted = 0;
  let addedTunnelM = 0;
  let addedPumpLayers = 0;

  for (const s of shafts) {
    const st = getShaftStatus(s);
    if (st === 'complete') completedShafts++;
    else if (st === 'ongoing') ongoingShafts++;
    else remainingShafts++;

    const mh = getManholeStatus(s);
    if (mh === 'complete') completedManholes++;
    else if (mh === 'ongoing') ongoingManholes++;
    else remainingManholes++;

    if (s.castingPct >= 100) castingCompleteCount++;
    if (s.precastPct >= 100) precastCompleteCount++;

    const compM = (s.tunnelLengthM * s.tunnelPct) / 100;
    totalTunnelLengthM += s.tunnelLengthM;
    completedTunnelLengthM += compM;
    byDia[s.pipeDia].totalM += s.tunnelLengthM;
    byDia[s.pipeDia].completedM += compM;

    if (baseline) {
      const b = baseline.shafts[s.id];
      if (b) {
        const curDone = s.layerFlags.slice(0, s.totalLayers).filter(Boolean).length;
        const prevDone = (b.layerFlags || []).slice(0, s.totalLayers).filter(Boolean).length;
        addedLayers += Math.max(0, curDone - prevDone);

        const prevShaftComplete = prevDone >= s.totalLayers && b.bottomSlabDone;
        if (st === 'complete' && !prevShaftComplete) {
          addedShaftsCompleted++;
        }
        if (s.castingPct >= 100 && b.castingPct < 100) addedCastingCompleted++;
        if (s.precastPct >= 100 && b.precastPct < 100) addedPrecastCompleted++;
        addedTunnelM += Math.max(
          0,
          (s.tunnelLengthM * (s.tunnelPct - b.tunnelPct)) / 100
        );
      }
    }
  }

  if (baseline && pumpStation) {
    pumpStation.layers.forEach((l, i) => {
      const wasDone = Boolean(baseline.pumpLayersDone?.[i]);
      if (l.status === 'complete' && !wasDone) addedPumpLayers++;
    });
  }

  return {
    totalShafts: shafts.length,
    completedShafts,
    ongoingShafts,
    remainingShafts,
    totalManholes: shafts.length,
    completedManholes,
    ongoingManholes,
    remainingManholes,
    castingCompleteCount,
    precastCompleteCount,
    totalTunnelLengthM,
    completedTunnelLengthM,
    tunnelPctOverall:
      totalTunnelLengthM > 0
        ? (completedTunnelLengthM / totalTunnelLengthM) * 100
        : 0,
    byDia,
    delta: {
      addedLayers,
      addedShaftsCompleted,
      addedCastingCompleted,
      addedPrecastCompleted,
      addedTunnelM,
      addedPumpLayers,
    },
  };
}

export function resizeShaftLayers(
  oldFlags: boolean[],
  newTotalLayers: number
): boolean[] {
  const clamped = Math.max(6, Math.min(13, Math.round(newTotalLayers)));
  const res: boolean[] = [];
  for (let i = 0; i < clamped; i++) {
    res.push(Boolean(oldFlags[i]));
  }
  return res;
}

export function normalizePumpStation(
  raw: Partial<PumpStationData> | undefined,
  fallback: PumpStationData
): PumpStationData {
  if (!raw) return JSON.parse(JSON.stringify(fallback));
  const layers = Array.isArray(raw.layers) && raw.layers.length > 0
    ? raw.layers.map((ly, i) => ({
        name: ly.name || `${i + 1} Layer`,
        sDate: ly.sDate || '',
        eDate: ly.eDate || '',
        status:
          ly.status ||
          (ly.done ? 'complete' : ly.sDate ? 'ongoing' : 'remaining'),
      }))
    : JSON.parse(JSON.stringify(fallback.layers));

  return {
    totalHeightM: Number(raw.totalHeightM ?? fallback.totalHeightM),
    castingCompleteM: Number(
      raw.castingCompleteM ?? raw.completedHeightM ?? fallback.castingCompleteM
    ),
    sinkingCompletedM: Number(raw.sinkingCompletedM ?? fallback.sinkingCompletedM),
    layers,
    machineRoom: {
      status: raw.machineRoom?.status || fallback.machineRoom.status,
      sDate: raw.machineRoom?.sDate ?? fallback.machineRoom.sDate,
      eDate: raw.machineRoom?.eDate ?? fallback.machineRoom.eDate,
    },
  };
}

export interface DisplayContext {
  displayShafts: ShaftRecord[];
  displayPump: PumpStationData;
  baseline: PeriodBaseline;
  file1Label: string;
  file2Label: string;
  isFrozenCompare: boolean;
}

export function resolveDisplayContext(state: AppState): DisplayContext {
  if (state.viewMode === 'overall') {
    return {
      displayShafts: state.shafts,
      displayPump: state.pumpStation,
      baseline: state.weeklyBaseline,
      file1Label: '',
      file2Label: 'Live Workspace',
      isFrozenCompare: false,
    };
  }

  const compare =
    state.viewMode === 'monthly' ? state.monthlyCompare : state.weeklyCompare;
  const fallbackBase =
    state.viewMode === 'monthly' ? state.monthlyBaseline : state.weeklyBaseline;

  const file1 = state.savedFiles.find((f) => f.id === compare?.file1Id);
  const baseline = file1 ? snapshotFromSavedFile(file1) : fallbackBase;
  const file1Label = file1
    ? `${file1.name} (${formatDateDisplay(file1.date)})`
    : fallbackBase.label;

  const file2 =
    compare?.file2Id && compare.file2Id !== LIVE_WORKSPACE_ID
      ? state.savedFiles.find((f) => f.id === compare.file2Id)
      : undefined;

  if (file2) {
    return {
      displayShafts: file2.shafts,
      displayPump: file2.pumpStation,
      baseline,
      file1Label,
      file2Label: `${file2.name} (${formatDateDisplay(file2.date)})`,
      isFrozenCompare: true,
    };
  }

  return {
    displayShafts: state.shafts,
    displayPump: state.pumpStation,
    baseline,
    file1Label,
    file2Label: `Current Workspace (${formatDateDisplay(state.settings.reportDate)})`,
    isFrozenCompare: false,
  };
}

export function sanitizeLoadedState(
  parsed: Partial<AppState>,
  fallback: AppState
): AppState {
  if (!parsed || !Array.isArray(parsed.shafts) || parsed.shafts.length === 0) {
    return fallback;
  }
  const pumpStation = normalizePumpStation(parsed.pumpStation, fallback.pumpStation);
  const savedFiles: SavedProgressFile[] = Array.isArray(parsed.savedFiles) && parsed.savedFiles.length > 0
    ? parsed.savedFiles.map((f) => ({
        ...f,
        pumpStation: normalizePumpStation(f.pumpStation, fallback.pumpStation),
      }))
    : fallback.savedFiles;

  return {
    ...fallback,
    ...parsed,
    pumpStation,
    savedFiles,
    activeLoadedFileId: parsed.activeLoadedFileId ?? null,
    weeklyCompare: parsed.weeklyCompare || {
      file1Id: savedFiles[0]?.id || '',
      file2Id: LIVE_WORKSPACE_ID,
    },
    monthlyCompare: parsed.monthlyCompare || {
      file1Id: savedFiles[0]?.id || '',
      file2Id: LIVE_WORKSPACE_ID,
    },
    colors: { ...fallback.colors, ...(parsed.colors || {}) },
    settings: { ...fallback.settings, ...(parsed.settings || {}) },
    weeklyBaseline: parsed.weeklyBaseline || fallback.weeklyBaseline,
    monthlyBaseline: parsed.monthlyBaseline || fallback.monthlyBaseline,
    history: Array.isArray(parsed.history) ? parsed.history : fallback.history,
  };
}
