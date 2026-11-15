import {
  AppState,
  PeriodBaseline,
  ShaftRecord,
  ShaftSnapshotItem,
  WorkStatus,
} from '../types';

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
    // If all layers + bottom slab done even without E.Date, or E.Date set with all layers done
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

export function createSnapshotFromState(
  shafts: ShaftRecord[],
  pumpLayersDone: boolean[],
  label: string,
  date: string
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
  };
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

  // Incremental delta vs active baseline (weekly or monthly)
  delta: {
    addedLayers: number;
    addedShaftsCompleted: number;
    addedCastingCompleted: number;
    addedPrecastCompleted: number;
    addedTunnelM: number;
  };
}

export function computeSummary(
  shafts: ShaftRecord[],
  baseline?: PeriodBaseline
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

        const prevShaftComplete =
          prevDone >= s.totalLayers && b.bottomSlabDone;
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

export function sanitizeLoadedState(
  parsed: Partial<AppState>,
  fallback: AppState
): AppState {
  if (!parsed || !Array.isArray(parsed.shafts) || parsed.shafts.length === 0) {
    return fallback;
  }
  return {
    ...fallback,
    ...parsed,
    colors: { ...fallback.colors, ...(parsed.colors || {}) },
    settings: { ...fallback.settings, ...(parsed.settings || {}) },
    pumpStation: { ...fallback.pumpStation, ...(parsed.pumpStation || {}) },
    weeklyBaseline: parsed.weeklyBaseline || fallback.weeklyBaseline,
    monthlyBaseline: parsed.monthlyBaseline || fallback.monthlyBaseline,
    history: Array.isArray(parsed.history) ? parsed.history : fallback.history,
  };
}
