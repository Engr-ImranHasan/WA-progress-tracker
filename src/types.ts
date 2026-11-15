export type WorkStatus = 'remaining' | 'ongoing' | 'complete';
export type ViewMode = 'overall' | 'weekly' | 'monthly';
export type LayoutMode = '10col' | '12col';
export type UiLang = 'bn' | 'en';
export type PipeDia = 'DN900' | 'DN1100' | 'DN1600';
export type ShaftType = 'Driving' | 'Receiving' | 'Receiving/Driving';

export interface ShaftRecord {
  index: number;
  id: string; // e.g. 'WA-1', 'WA-24.1', 'WA-36'
  nextId: string; // e.g. 'WA-2', 'Pump Station'
  shaftSize: string;
  shaftType: ShaftType;
  netHeightMm: number;
  bottomSlabMm: number;
  sheetPileStyle: boolean;
  totalLayers: number; // 6 to 13
  layerFlags: boolean[]; // length = totalLayers (true = completed)
  bottomSlabDone: boolean;
  shaftSDate: string; // YYYY-MM-DD
  shaftEDate: string; // YYYY-MM-DD

  // Manhole in 2 parts: lower Casting + upper Precast Ring
  castingPct: number; // 0..100
  precastPct: number; // 0..100
  manholeSDate: string;
  manholeEDate: string;

  // Connection to nextId
  pipeDia: PipeDia;
  tunnelLengthM: number;
  tunnelPct: number; // 0..100
  tunnelSDate: string;
  tunnelEDate: string;
}

export interface PumpLayer {
  name: string;
  sDate: string;
  eDate: string;
  done: boolean;
}

export interface PumpStationData {
  totalHeightM: number;
  completedHeightM: number;
  sinkingCompletedM: number;
  layers: PumpLayer[];
}

export interface ShaftSnapshotItem {
  layerFlags: boolean[];
  bottomSlabDone: boolean;
  castingPct: number;
  precastPct: number;
  tunnelPct: number;
}

export interface PeriodBaseline {
  label: string;
  date: string; // YYYY-MM-DD
  capturedAt: string;
  shafts: Record<string, ShaftSnapshotItem>;
  pumpLayersDone: boolean[];
}

export interface HistoryArchiveEntry {
  id: string;
  type: 'weekly' | 'monthly';
  label: string;
  date: string;
  capturedAt: string;
  summary: {
    completedShafts: number;
    ongoingShafts: number;
    completedManholes: number;
    ongoingManholes: number;
    tunnelCompletedKm: number;
  };
  snapshot: PeriodBaseline;
}

export interface ColorPalette {
  // Overall mode
  overallShaft: string;
  overallCasting: string;
  overallPrecast: string;
  overallTunnel: string;
  remainingOutline: string;

  // Weekly comparison
  prevWeekShaft: string;
  prevWeekManhole: string;
  prevWeekTunnel: string;
  thisWeekHighlight: string;

  // Monthly comparison
  prevMonthShaft: string;
  prevMonthManhole: string;
  prevMonthTunnel: string;
  thisMonthHighlight: string;
}

export interface SheetSettings {
  projectTitle: string;
  sectionTitle: string;
  drawingNo: string;
  revision: string;
  reportDate: string; // YYYY-MM-DD
  preparedBy: string;
  checkedBy: string;
  clientName: string;
  contractorName: string;
  layoutMode: LayoutMode;
  showPumpStation: boolean;
}

export interface AppState {
  version: number;
  lastSavedAt: string;
  viewMode: ViewMode;
  uiLang: UiLang;
  currentWeekLabel: string;
  currentMonthLabel: string;
  shafts: ShaftRecord[];
  pumpStation: PumpStationData;
  weeklyBaseline: PeriodBaseline;
  monthlyBaseline: PeriodBaseline;
  history: HistoryArchiveEntry[];
  colors: ColorPalette;
  settings: SheetSettings;
}
