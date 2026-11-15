import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Download,
  FileSpreadsheet,
  FileText,
  Printer,
  Upload,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Lock,
  RotateCcw,
  Save,
  Image as ImageIcon,
  FileCode2,
  Languages,
  PanelRightClose,
  PanelRightOpen,
  CalendarCheck,
} from 'lucide-react';
import { AppState, HistoryArchiveEntry, ShaftRecord, ViewMode } from './types';
import { createInitialAppState } from './data/initialWaData';
import {
  computeSummary,
  createSnapshotFromState,
  sanitizeLoadedState,
} from './utils/calculations';
import {
  exportA1VectorPdf,
  exportAutoCadDxf,
  exportExcelWorkbook,
  exportHighResPng,
  exportJsonBackup,
  exportSvgFile,
  importExcelShafts,
} from './utils/exporters';
import { A1SheetDrawing } from './components/A1SheetDrawing';
import { ShaftEditorPanel } from './components/ShaftEditorPanel';

const STORAGE_KEY = 'wa_progress_studio_v1';

function loadInitialState(): AppState {
  const fallback = createInitialAppState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return sanitizeLoadedState(parsed, fallback);
  } catch {
    return fallback;
  }
}

export function App() {
  const [state, setState] = useState<AppState>(loadInitialState);
  const [selectedShaftId, setSelectedShaftId] = useState<string>('WA-1');
  const [focusSection, setFocusSection] = useState<'shaft' | 'manhole' | 'tunnel'>('shaft');
  const [zoom, setZoom] = useState<number>(1);
  const [showInspector, setShowInspector] = useState<boolean>(true);
  const [showExportMenu, setShowExportMenu] = useState<boolean>(false);
  const [lockModalType, setLockModalType] = useState<'weekly' | 'monthly' | null>(null);
  const [nextPeriodLabel, setNextPeriodLabel] = useState<string>('');
  const [toastMsg, setToastMsg] = useState<string>('');
  const [exportBusy, setExportBusy] = useState<string>('');

  const svgRef = useRef<SVGSVGElement>(null);
  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const jsonInputRef = useRef<HTMLInputElement | null>(null);

  const isBn = state.uiLang === 'bn';

  // Instant localStorage autosave on every change
  useEffect(() => {
    try {
      const payload = { ...state, lastSavedAt: new Date().toISOString() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore quota errors
    }
  }, [state]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3200);
  };

  const handleUpdateShaft = (id: string, patch: Partial<ShaftRecord>) => {
    setState((prev) => ({
      ...prev,
      lastSavedAt: new Date().toISOString(),
      shafts: prev.shafts.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  };

  const activeBaseline =
    state.viewMode === 'monthly' ? state.monthlyBaseline : state.weeklyBaseline;
  const summary = computeSummary(state.shafts, activeBaseline);

  const handleOpenLockModal = (type: 'weekly' | 'monthly') => {
    setLockModalType(type);
    setNextPeriodLabel(
      type === 'weekly'
        ? `Next Week (${state.settings.reportDate})`
        : `Next Month (${state.settings.reportDate})`
    );
  };

  const handleConfirmLockPeriod = () => {
    if (!lockModalType) return;
    const type = lockModalType;
    const baseToCheck =
      type === 'weekly' ? state.weeklyBaseline : state.monthlyBaseline;
    const snapSummary = computeSummary(state.shafts, baseToCheck);
    const pumpDone = state.pumpStation.layers.map((l) => l.done);
    const closedLabel =
      type === 'weekly' ? state.currentWeekLabel : state.currentMonthLabel;

    const newSnapshot = createSnapshotFromState(
      state.shafts,
      pumpDone,
      closedLabel,
      state.settings.reportDate
    );

    const archiveEntry: HistoryArchiveEntry = {
      id: `${type}-${Date.now()}`,
      type,
      label: closedLabel,
      date: state.settings.reportDate,
      capturedAt: new Date().toISOString(),
      summary: {
        completedShafts: snapSummary.completedShafts,
        ongoingShafts: snapSummary.ongoingShafts,
        completedManholes: snapSummary.completedManholes,
        ongoingManholes: snapSummary.ongoingManholes,
        tunnelCompletedKm: Number(
          (snapSummary.completedTunnelLengthM / 1000).toFixed(3)
        ),
      },
      snapshot: newSnapshot,
    };

    setState((prev) => ({
      ...prev,
      lastSavedAt: new Date().toISOString(),
      weeklyBaseline: type === 'weekly' ? newSnapshot : prev.weeklyBaseline,
      monthlyBaseline: type === 'monthly' ? newSnapshot : prev.monthlyBaseline,
      currentWeekLabel:
        type === 'weekly' ? nextPeriodLabel.trim() || prev.currentWeekLabel : prev.currentWeekLabel,
      currentMonthLabel:
        type === 'monthly' ? nextPeriodLabel.trim() || prev.currentMonthLabel : prev.currentMonthLabel,
      history: [archiveEntry, ...prev.history],
    }));

    setLockModalType(null);
    showToast(
      isBn
        ? `${type === 'weekly' ? 'সপ্তাহ' : 'মাসিক মিটিং'} সেভ ও লক হয়েছে! এখন নতুন আপডেট শুরু করতে পারেন।`
        : `${type === 'weekly' ? 'Week' : 'Monthly meeting'} locked! New edits will count toward the next period.`
    );
  };

  const handleExport = async (
    kind: 'pdf' | 'png' | 'svg' | 'dxf' | 'xlsx' | 'json' | 'print'
  ) => {
    setShowExportMenu(false);
    const dateTag = state.settings.reportDate || 'report';
    const modeTag = state.viewMode;
    try {
      if (kind === 'print') {
        window.print();
        return;
      }
      if (kind === 'xlsx') {
        exportExcelWorkbook(state, `WA-Progress-${modeTag}-${dateTag}.xlsx`);
        showToast(isBn ? 'Excel (.xlsx) ডাউনলোড হয়েছে!' : 'Excel exported!');
        return;
      }
      if (kind === 'json') {
        exportJsonBackup(state, `WA-Progress-Backup-${dateTag}.json`);
        showToast(isBn ? 'JSON ব্যাকআপ সেভ হয়েছে!' : 'JSON backup saved!');
        return;
      }
      if (kind === 'dxf') {
        exportAutoCadDxf(state, `WA-Progress-A1-${modeTag}-${dateTag}.dxf`);
        showToast(isBn ? 'AutoCAD DXF এক্সপোর্ট হয়েছে!' : 'AutoCAD DXF exported!');
        return;
      }
      if (!svgRef.current) return;
      if (kind === 'svg') {
        exportSvgFile(svgRef.current, `WA-Progress-A1-${modeTag}-${dateTag}.svg`);
        showToast(isBn ? 'Vector SVG ডাউনলোড হয়েছে!' : 'SVG exported!');
        return;
      }
      if (kind === 'pdf') {
        setExportBusy(isBn ? 'A1 PDF তৈরি হচ্ছে...' : 'Generating A1 Vector PDF...');
        await exportA1VectorPdf(
          svgRef.current,
          `WA-Progress-A1-${modeTag}-${dateTag}.pdf`
        );
        showToast(isBn ? 'A1 Vector PDF ডাউনলোড হয়েছে!' : 'A1 Vector PDF exported!');
      } else if (kind === 'png') {
        setExportBusy(isBn ? 'High-Res PNG তৈরি হচ্ছে...' : 'Rendering High-Res PNG...');
        await exportHighResPng(
          svgRef.current,
          `WA-Progress-A1-${modeTag}-${dateTag}.png`
        );
        showToast(isBn ? 'High-Res PNG ডাউনলোড হয়েছে!' : 'PNG exported!');
      }
    } catch (err) {
      console.error(err);
      showToast(isBn ? 'এক্সপোর্টে সমস্যা হয়েছে, আবার চেষ্টা করুন।' : 'Export failed.');
    } finally {
      setExportBusy('');
    }
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const updatedShafts = await importExcelShafts(file, state.shafts);
      setState((prev) => ({
        ...prev,
        lastSavedAt: new Date().toISOString(),
        shafts: updatedShafts,
      }));
      showToast(
        isBn
          ? 'Excel থেকে সব ডাটা ইমপোর্ট ও অটো-সেভ হয়েছে!'
          : 'Excel imported & auto-saved!'
      );
    } catch (err) {
      console.error(err);
      showToast(isBn ? 'Excel ফাইলটি পড়া যায়নি।' : 'Could not read Excel file.');
    }
  };

  const handleJsonRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<AppState>;
      const restored = sanitizeLoadedState(parsed, createInitialAppState());
      setState(restored);
      showToast(
        isBn ? 'JSON ব্যাকআপ রিস্টোর হয়েছে!' : 'Backup restored successfully!'
      );
    } catch {
      showToast(isBn ? 'সঠিক JSON ব্যাকআপ ফাইল নয়।' : 'Invalid JSON backup.');
    }
  };

  const handleResetToPdf = () => {
    if (
      window.confirm(
        isBn
          ? 'আপনি কি নিশ্চিত যে আপনার সব এডিট মুছে মূল PDF-এর অবস্থায় ফিরে যেতে চান?'
          : 'Reset all data back to the initial PDF baseline?'
      )
    ) {
      const fresh = createInitialAppState();
      setState(fresh);
      showToast(isBn ? 'মূল PDF ডাটায় রিসেট হয়েছে।' : 'Reset to PDF baseline.');
    }
  };

  const savedTimeStr = (() => {
    try {
      return new Date(state.lastSavedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return '';
    }
  })();

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-100 text-slate-900">
      {/* Hidden file inputs */}
      <input
        ref={excelInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleExcelUpload}
      />
      <input
        ref={jsonInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleJsonRestore}
      />

      {/* ==================== TOP HEADER TOOLBAR ==================== */}
      <header className="no-print z-30 flex flex-wrap items-center justify-between gap-2 border-b border-slate-300 bg-slate-900 px-3 py-2 text-white shadow-sm">
        {/* Brand & Autosave Status */}
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider">
                A1 CAD
              </span>
              <h1 className="text-sm font-bold tracking-tight">
                WA Progress Studio
              </h1>
              <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-emerald-950/90 border border-emerald-500/40 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                <Check className="h-3 w-3" />
                {isBn ? 'অটো-সেভড' : 'Auto-saved'} {savedTimeStr}
              </span>
            </div>
          </div>
        </div>

        {/* View Mode Switcher (Overall / Weekly / Monthly) */}
        <div className="flex items-center gap-1 rounded-lg bg-slate-800 p-1">
          {(
            [
              {
                id: 'overall',
                bn: 'সামগ্রিক (Overall)',
                en: 'Overall Status',
              },
              {
                id: 'weekly',
                bn: 'সাপ্তাহিক (Weekly)',
                en: 'Weekly Progress',
              },
              {
                id: 'monthly',
                bn: 'মাসিক (Monthly)',
                en: 'Monthly Progress',
              },
            ] as { id: ViewMode; bn: string; en: string }[]
          ).map((m) => (
            <button
              key={m.id}
              onClick={() => setState((p) => ({ ...p, viewMode: m.id }))}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                state.viewMode === m.id
                  ? m.id === 'weekly'
                    ? 'bg-amber-500 text-slate-950 shadow'
                    : m.id === 'monthly'
                    ? 'bg-cyan-500 text-slate-950 shadow'
                    : 'bg-emerald-500 text-slate-950 shadow'
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
            >
              {isBn ? m.bn : m.en}
            </button>
          ))}
        </div>

        {/* Action Buttons: Period Rollover, Export, Language, Panel Toggle */}
        <div className="flex items-center gap-1.5">
          {state.viewMode === 'weekly' && (
            <button
              onClick={() => handleOpenLockModal('weekly')}
              className="flex items-center gap-1.5 rounded-md bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400 transition"
              title="Save this week & start updating next week from here"
            >
              <Lock className="h-3.5 w-3.5" />
              {isBn ? 'সপ্তাহ শেষ ও নতুন সপ্তাহ শুরু' : 'Close Week → Next'}
            </button>
          )}
          {state.viewMode === 'monthly' && (
            <button
              onClick={() => handleOpenLockModal('monthly')}
              className="flex items-center gap-1.5 rounded-md bg-cyan-500 px-2.5 py-1.5 text-xs font-bold text-slate-950 hover:bg-cyan-400 transition"
              title="Save monthly meeting snapshot & start next month"
            >
              <CalendarCheck className="h-3.5 w-3.5" />
              {isBn ? 'মিটিং লক ও নতুন মাস শুরু' : 'Close Month → Next'}
            </button>
          )}

          {/* Direct A1 PDF quick button */}
          <button
            onClick={() => handleExport('pdf')}
            disabled={Boolean(exportBusy)}
            className="flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-blue-500 transition disabled:opacity-50"
          >
            <FileText className="h-3.5 w-3.5" />
            {exportBusy ? exportBusy : 'A1 PDF'}
          </button>

          {/* More Exports & Excel/Backup Menu */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-1 rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold hover:bg-slate-700"
            >
              <Download className="h-3.5 w-3.5" />
              {isBn ? 'এক্সপোর্ট / ইমপোর্ট' : 'Export / Sync'}
            </button>

            {showExportMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowExportMenu(false)}
                />
                <div className="absolute right-0 mt-1.5 z-50 w-64 rounded-lg border border-slate-200 bg-white py-1.5 text-slate-800 shadow-xl text-xs">
                  <div className="px-3 py-1 text-[10px] font-bold uppercase text-slate-400">
                    {isBn ? 'A1 প্রিন্ট ও ড্রয়িং এক্সপোর্ট' : 'A1 Drawing Exports'}
                  </div>
                  <button
                    onClick={() => handleExport('pdf')}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-blue-50 font-semibold text-blue-700"
                  >
                    <FileText className="h-4 w-4" /> A1 Vector PDF (841×594mm)
                  </button>
                  <button
                    onClick={() => handleExport('print')}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <Printer className="h-4 w-4 text-slate-600" /> Print A1 Page (Ctrl+P)
                  </button>
                  <button
                    onClick={() => handleExport('png')}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <ImageIcon className="h-4 w-4 text-emerald-600" /> High-Res PNG Image
                  </button>
                  <button
                    onClick={() => handleExport('svg')}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <FileCode2 className="h-4 w-4 text-indigo-600" /> Vector SVG File
                  </button>
                  <button
                    onClick={() => handleExport('dxf')}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <FileCode2 className="h-4 w-4 text-amber-600" /> AutoCAD (.dxf) File
                  </button>

                  <div className="my-1 border-t border-slate-100" />
                  <div className="px-3 py-1 text-[10px] font-bold uppercase text-slate-400">
                    {isBn ? 'Excel ও ব্যাকআপ' : 'Excel & Data Backup'}
                  </div>
                  <button
                    onClick={() => handleExport('xlsx')}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-emerald-50 text-emerald-800 font-medium"
                  >
                    <FileSpreadsheet className="h-4 w-4" /> Export Excel (.xlsx)
                  </button>
                  <button
                    onClick={() => {
                      setShowExportMenu(false);
                      excelInputRef.current?.click();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-emerald-50 text-emerald-800 font-medium"
                  >
                    <Upload className="h-4 w-4" /> Import Excel (.xlsx)
                  </button>
                  <button
                    onClick={() => handleExport('json')}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <Save className="h-4 w-4 text-slate-600" /> Save Full Backup (.json)
                  </button>
                  <button
                    onClick={() => {
                      setShowExportMenu(false);
                      jsonInputRef.current?.click();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <Upload className="h-4 w-4 text-slate-600" /> Restore Backup (.json)
                  </button>
                  <div className="my-1 border-t border-slate-100" />
                  <button
                    onClick={() => {
                      setShowExportMenu(false);
                      handleResetToPdf();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-rose-600 hover:bg-rose-50"
                  >
                    <RotateCcw className="h-4 w-4" /> Reset to Initial PDF Data
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Language Toggle BN / EN */}
          <button
            onClick={() =>
              setState((p) => ({ ...p, uiLang: p.uiLang === 'bn' ? 'en' : 'bn' }))
            }
            className="flex items-center gap-1 rounded-md border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs font-semibold hover:bg-slate-700"
            title="Switch UI Language (বাংলা / English)"
          >
            <Languages className="h-3.5 w-3.5" />
            {isBn ? 'EN' : 'বাংলা'}
          </button>

          {/* Toggle Editor Panel */}
          <button
            onClick={() => setShowInspector(!showInspector)}
            className="rounded-md border border-slate-600 bg-slate-800 p-1.5 hover:bg-slate-700"
            title={showInspector ? 'Hide Editor' : 'Show Editor'}
          >
            {showInspector ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </button>
        </div>
      </header>

      {/* ==================== LIVE KPI & PERIOD SUB-BAR ==================== */}
      <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-500">
              {isBn ? 'Shaft:' : 'Shafts:'}
            </span>
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-bold text-emerald-800">
              {summary.completedShafts}/37 Done
            </span>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 font-bold text-amber-800">
              {summary.ongoingShafts} On-going
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-500">
              {isBn ? 'Manhole:' : 'Manholes:'}
            </span>
            <span className="rounded bg-blue-100 px-1.5 py-0.5 font-bold text-blue-800">
              Cast: {summary.castingCompleteCount}/37 · Ring: {summary.precastCompleteCount}/37
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-500">
              {isBn ? 'Tunnel:' : 'Tunnel:'}
            </span>
            <span className="rounded bg-fuchsia-100 px-1.5 py-0.5 font-bold text-fuchsia-800">
              {(summary.completedTunnelLengthM / 1000).toFixed(3)} /{' '}
              {(summary.totalTunnelLengthM / 1000).toFixed(3)} km (
              {summary.tunnelPctOverall.toFixed(1)}%)
            </span>
          </div>

          {state.viewMode !== 'overall' && (
            <div className="flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-300 px-2.5 py-0.5 font-bold text-amber-900">
              <span>
                {state.viewMode === 'weekly'
                  ? isBn
                    ? 'এই সপ্তাহে যোগ হয়েছে:'
                    : 'This Week Added:'
                  : isBn
                  ? 'এই মাসে যোগ হয়েছে:'
                  : 'This Month Added:'}
              </span>
              <span>
                +{summary.delta.addedLayers} layers · +{summary.delta.addedTunnelM.toFixed(1)}m tunnel
              </span>
            </div>
          )}
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoom((z) => Math.max(0.6, Number((z - 0.2).toFixed(2))))}
            className="rounded border border-slate-200 p-1 hover:bg-slate-100"
            title="Zoom Out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="w-12 text-center font-bold text-slate-700">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(3.5, Number((z + 0.2).toFixed(2))))}
            className="rounded border border-slate-200 p-1 hover:bg-slate-100"
            title="Zoom In"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setZoom(1)}
            className="ml-1 rounded border border-slate-200 px-2 py-0.5 text-[11px] font-semibold hover:bg-slate-100"
          >
            {zoom === 1 ? <Maximize2 className="h-3 w-3 inline mr-1" /> : <Minimize2 className="h-3 w-3 inline mr-1" />}
            Fit A1
          </button>
        </div>
      </div>

      {/* ==================== MAIN SPLIT WORKSPACE ==================== */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left/Center: A1 Vector Drawing Viewport */}
        <main className="flex-1 overflow-auto bg-slate-300/70 p-4">
          <div
            className="print-sheet-wrapper mx-auto origin-top-left bg-white shadow-2xl ring-1 ring-slate-400/50 transition-all"
            style={{
              width: `${zoom * 100}%`,
              minWidth: zoom > 1 ? `${zoom * 100}%` : undefined,
            }}
          >
            <A1SheetDrawing
              state={state}
              selectedShaftId={selectedShaftId}
              onSelectShaft={(id, focus) => {
                setSelectedShaftId(id);
                if (focus) setFocusSection(focus);
                if (!showInspector) setShowInspector(true);
              }}
              svgRef={svgRef}
            />
          </div>
          <div className="no-print mt-2 text-center text-[11px] text-slate-600">
            {isBn
              ? 'টিপস: যেকোনো Shaft বা Tunnel বারের ওপর ক্লিক করে ডান পাশ থেকে এডিট করুন। সব পরিবর্তন সাথে সাথে ব্রাউজারে অটো-সেভ হয়।'
              : 'Tip: Click any Shaft or Tunnel bar on the A1 drawing to edit. All edits auto-save instantaneously.'}
          </div>
        </main>

        {/* Right: Shaft & Bulk Editor */}
        {showInspector && (
          <div className="no-print w-full max-w-[390px] shrink-0 h-full">
            <ShaftEditorPanel
              state={state}
              selectedShaftId={selectedShaftId}
              onSelectShaft={(id) => setSelectedShaftId(id)}
              onUpdateShaft={handleUpdateShaft}
              onUpdateState={(updater) =>
                setState((prev) => ({
                  ...updater(prev),
                  lastSavedAt: new Date().toISOString(),
                }))
              }
              focusSection={focusSection}
            />
          </div>
        )}
      </div>

      {/* ==================== LOCK PERIOD / ROLLOVER MODAL ==================== */}
      {lockModalType && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl space-y-4">
            <h2 className="text-base font-bold text-slate-900">
              {lockModalType === 'weekly'
                ? isBn
                  ? 'এই সপ্তাহের প্রোগ্রেস সেভ ও লক করুন'
                  : 'Lock Current Week & Start Next Week'
                : isBn
                ? 'এই মাসের মিটিং প্রোগ্রেস সেভ ও লক করুন'
                : 'Lock Current Monthly Meeting & Start Next Month'}
            </h2>

            <p className="text-xs text-slate-600 leading-relaxed">
              {isBn
                ? 'এটি করলে আজ পর্যন্ত সম্পন্ন হওয়া সব কাজ হিস্টোরিতে সেভ হয়ে "আগের সপ্তাহ/মিটিং পর্যন্ত কাজ" হিসেবে লক হবে। এরপর থেকে আপনি যত নতুন কাজ ইনপুট দেবেন, সেগুলো স্বয়ংক্রিয়ভাবে নতুন রঙ হিসেবে দেখাবে।'
                : 'This archives the current progress into History and sets it as the new baseline. Any subsequent updates will highlight as new progress in the next period.'}
            </p>

            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs space-y-1">
              <div className="font-bold text-slate-800">
                {isBn ? 'বর্তমান অবস্থা যা লক হতে যাচ্ছে:' : 'Snapshot Summary:'}
              </div>
              <div>• Shafts Completed: {summary.completedShafts} / 37 ({summary.ongoingShafts} On-going)</div>
              <div>• Manholes: Cast {summary.castingCompleteCount}/37, Precast {summary.precastCompleteCount}/37</div>
              <div>• Tunnel Completed: {(summary.completedTunnelLengthM / 1000).toFixed(3)} km</div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                {isBn ? 'পরবর্তী সপ্তাহ/মাসের নাম লিখুন:' : 'Label for Next Period:'}
              </label>
              <input
                type="text"
                value={nextPeriodLabel}
                onChange={(e) => setNextPeriodLabel(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-medium"
                placeholder="e.g. Week 47 (16-22 Nov 2026)"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setLockModalType(null)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                {isBn ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                onClick={handleConfirmLockPeriod}
                className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-blue-700"
              >
                {isBn ? 'হ্যাঁ, সেভ ও লক করুন' : 'Lock & Start Next'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMsg && (
        <div className="no-print fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-lg">
          {toastMsg}
        </div>
      )}
    </div>
  );
}

export default App;
