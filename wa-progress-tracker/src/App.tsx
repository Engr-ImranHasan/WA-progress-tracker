import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Download,
  Eye,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Languages,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { AppState, SavedProgressFile, ShaftRecord, ViewMode } from './types';
import { createInitialAppState } from './data/initialWaData';
import {
  computeSummary,
  formatDateDisplay,
  getPumpLowerStatus,
  LIVE_WORKSPACE_ID,
  resolveDisplayContext,
  sanitizeLoadedState,
} from './utils/calculations';
import {
  exportA1VectorPdf,
  exportAutoCadDxf,
  exportExcelWorkbook,
  exportHighResPng,
  exportJsonBackup,
  exportSavedFileExcel,
  exportSavedFileJson,
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

  // Save Overall File Modal
  const [saveModalOpen, setSaveModalOpen] = useState<boolean>(false);
  const [saveFileName, setSaveFileName] = useState<string>('');
  const [saveFileDate, setSaveFileDate] = useState<string>('');
  const [saveFileNote, setSaveFileNote] = useState<string>('');

  // Saved Files Manager Modal & In-Modal Viewer
  const [filesModalOpen, setFilesModalOpen] = useState<boolean>(false);
  const [previewFile, setPreviewFile] = useState<SavedProgressFile | null>(null);

  const [toastMsg, setToastMsg] = useState<string>('');
  const [exportBusy, setExportBusy] = useState<string>('');

  const svgRef = useRef<SVGSVGElement>(null);
  const previewSvgRef = useRef<SVGSVGElement>(null);
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
    setTimeout(() => setToastMsg(''), 3400);
  };

  const handleUpdateShaft = (id: string, patch: Partial<ShaftRecord>) => {
    setState((prev) => ({
      ...prev,
      lastSavedAt: new Date().toISOString(),
      shafts: prev.shafts.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  };

  const displayCtx = resolveDisplayContext(state);
  const summary = computeSummary(displayCtx.displayShafts, displayCtx.baseline);
  const editingFile = state.activeLoadedFileId
    ? state.savedFiles.find((f) => f.id === state.activeLoadedFileId) || null
    : null;

  // Open Save Overall File modal
  const openSaveFileModal = () => {
    const defaultDate = state.settings.reportDate || new Date().toISOString().slice(0, 10);
    if (editingFile) {
      setSaveFileName(editingFile.name);
      setSaveFileDate(editingFile.date || defaultDate);
      setSaveFileNote(editingFile.note || '');
    } else {
      setSaveFileName(`WA Progress (${formatDateDisplay(defaultDate)})`);
      setSaveFileDate(defaultDate);
      setSaveFileNote('');
    }
    setSaveModalOpen(true);
  };

  // Save as New File or Update Existing File
  const handleSaveFile = (mode: 'new' | 'update') => {
    const cleanName = saveFileName.trim() || `WA Progress (${formatDateDisplay(saveFileDate)})`;
    const cleanDate = saveFileDate || state.settings.reportDate;
    const nowIso = new Date().toISOString();

    if (mode === 'update' && state.activeLoadedFileId) {
      setState((prev) => ({
        ...prev,
        lastSavedAt: nowIso,
        savedFiles: prev.savedFiles.map((f) =>
          f.id === prev.activeLoadedFileId
            ? {
                ...f,
                name: cleanName,
                date: cleanDate,
                note: saveFileNote.trim(),
                updatedAt: nowIso,
                shafts: JSON.parse(JSON.stringify(prev.shafts)),
                pumpStation: JSON.parse(JSON.stringify(prev.pumpStation)),
              }
            : f
        ),
      }));
      setSaveModalOpen(false);
      showToast(
        isBn
          ? `"${cleanName}" ফাইল আপডেট সেভ হয়েছে!`
          : `Updated saved file "${cleanName}"!`
      );
      return;
    }

    const newFile: SavedProgressFile = {
      id: `file-${Date.now()}`,
      name: cleanName,
      date: cleanDate,
      note: saveFileNote.trim(),
      createdAt: nowIso,
      updatedAt: nowIso,
      shafts: JSON.parse(JSON.stringify(state.shafts)),
      pumpStation: JSON.parse(JSON.stringify(state.pumpStation)),
    };

    setState((prev) => ({
      ...prev,
      lastSavedAt: nowIso,
      activeLoadedFileId: newFile.id,
      savedFiles: [newFile, ...prev.savedFiles],
    }));
    setSaveModalOpen(false);
    showToast(
      isBn
        ? `"${cleanName}" (${formatDateDisplay(cleanDate)}) সেভ করা হয়েছে!`
        : `Saved "${cleanName}" (${formatDateDisplay(cleanDate)})!`
    );
  };

  // Load a saved file into Overall editor for editing
  const handleEditSavedFile = (file: SavedProgressFile) => {
    setState((prev) => ({
      ...prev,
      lastSavedAt: new Date().toISOString(),
      viewMode: 'overall',
      activeLoadedFileId: file.id,
      shafts: JSON.parse(JSON.stringify(file.shafts)),
      pumpStation: JSON.parse(JSON.stringify(file.pumpStation)),
      settings: {
        ...prev.settings,
        reportDate: file.date || prev.settings.reportDate,
      },
    }));
    setPreviewFile(null);
    setFilesModalOpen(false);
    showToast(
      isBn
        ? `"${file.name}" এডিট করার জন্য লোড হয়েছে। পরিবর্তন শেষে Save বাটনে আপডেট করুন।`
        : `Loaded "${file.name}" into editor. Click Save when done.`
    );
  };

  const handleDeleteSavedFile = (file: SavedProgressFile) => {
    if (state.savedFiles.length <= 1) {
      showToast(
        isBn
          ? 'অন্তত একটি সেভ করা ফাইল রাখা প্রয়োজন।'
          : 'Keep at least one saved file for comparisons.'
      );
      return;
    }
    if (
      !window.confirm(
        isBn
          ? `"${file.name}" ফাইলটি কি মুছে ফেলতে চান?`
          : `Delete saved file "${file.name}"?`
      )
    ) {
      return;
    }
    setState((prev) => {
      const remaining = prev.savedFiles.filter((f) => f.id !== file.id);
      const fallbackId = remaining[0]?.id || '';
      return {
        ...prev,
        activeLoadedFileId:
          prev.activeLoadedFileId === file.id ? null : prev.activeLoadedFileId,
        weeklyCompare: {
          file1Id:
            prev.weeklyCompare.file1Id === file.id
              ? fallbackId
              : prev.weeklyCompare.file1Id,
          file2Id:
            prev.weeklyCompare.file2Id === file.id
              ? LIVE_WORKSPACE_ID
              : prev.weeklyCompare.file2Id,
        },
        monthlyCompare: {
          file1Id:
            prev.monthlyCompare.file1Id === file.id
              ? fallbackId
              : prev.monthlyCompare.file1Id,
          file2Id:
            prev.monthlyCompare.file2Id === file.id
              ? LIVE_WORKSPACE_ID
              : prev.monthlyCompare.file2Id,
        },
        savedFiles: remaining,
      };
    });
    if (previewFile?.id === file.id) setPreviewFile(null);
    showToast(isBn ? 'ফাইলটি মুছে ফেলা হয়েছে।' : 'File deleted.');
  };

  const handleExport = async (
    kind: 'pdf' | 'png' | 'svg' | 'dxf' | 'xlsx' | 'json' | 'print',
    customSvg?: SVGSVGElement | null,
    customLabel?: string
  ) => {
    setShowExportMenu(false);
    const dateTag = customLabel || state.settings.reportDate || 'report';
    const modeTag = customLabel ? 'saved' : state.viewMode;
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
      const targetSvg = customSvg || svgRef.current;
      if (!targetSvg) return;
      if (kind === 'svg') {
        exportSvgFile(targetSvg, `WA-Progress-A1-${modeTag}-${dateTag}.svg`);
        showToast(isBn ? 'Vector SVG ডাউনলোড হয়েছে!' : 'SVG exported!');
        return;
      }
      if (kind === 'pdf') {
        setExportBusy(isBn ? 'A1 PDF তৈরি হচ্ছে...' : 'Generating A1 Vector PDF...');
        await exportA1VectorPdf(
          targetSvg,
          `WA-Progress-A1-${modeTag}-${dateTag}.pdf`
        );
        showToast(isBn ? 'A1 Vector PDF ডাউনলোড হয়েছে!' : 'A1 Vector PDF exported!');
      } else if (kind === 'png') {
        setExportBusy(isBn ? 'High-Res PNG তৈরি হচ্ছে...' : 'Rendering High-Res PNG...');
        await exportHighResPng(
          targetSvg,
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

  const activeCompare =
    state.viewMode === 'monthly' ? state.monthlyCompare : state.weeklyCompare;

  const updateCompare = (side: 'file1Id' | 'file2Id', val: string) => {
    const key = state.viewMode === 'monthly' ? 'monthlyCompare' : 'weeklyCompare';
    setState((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        [side]: val,
      },
    }));
  };

  const previewState: AppState | null = previewFile
    ? {
        ...state,
        viewMode: 'overall',
        shafts: previewFile.shafts,
        pumpStation: previewFile.pumpStation,
        settings: {
          ...state.settings,
          reportDate: previewFile.date || state.settings.reportDate,
          sectionTitle: `${state.settings.sectionTitle} — [${previewFile.name}]`,
        },
      }
    : null;

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
        <div className="flex items-center gap-2.5">
          <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider">
            A1 CAD
          </span>
          <h1 className="text-sm font-bold tracking-tight">WA Progress Studio</h1>
          <span className="hidden md:inline-flex items-center gap-1 rounded-full bg-emerald-950/90 border border-emerald-500/40 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
            <Check className="h-3 w-3" />
            {isBn ? 'অটো-সেভড' : 'Auto-saved'} {savedTimeStr}
          </span>
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
                en: 'Weekly Compare',
              },
              {
                id: 'monthly',
                bn: 'মাসিক (Monthly)',
                en: 'Monthly Compare',
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

        {/* Action Buttons: Save File, Saved Files Manager, Export, Lang, Panel */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Save Overall with Name & Date */}
          <button
            onClick={openSaveFileModal}
            className="flex items-center gap-1.5 rounded-md bg-emerald-500 px-2.5 py-1.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition"
            title={
              isBn
                ? 'বর্তমান প্রোগ্রেস নাম ও তারিখ দিয়ে সেভ করুন'
                : 'Save Overall progress with Name & Date'
            }
          >
            <Save className="h-3.5 w-3.5" />
            {isBn ? 'ফাইল সেভ' : 'Save File'}
          </button>

          {/* Saved Files Manager Button */}
          <button
            onClick={() => setFilesModalOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-indigo-400/50 bg-indigo-600/90 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 transition"
            title={
              isBn
                ? 'সব সেভ করা ফাইল দেখুন, এডিট ও ডাউনলোড করুন'
                : 'View, Edit & Download all saved files'
            }
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {isBn ? `সেভ করা ফাইল (${state.savedFiles.length})` : `Saved Files (${state.savedFiles.length})`}
          </button>

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

      {/* ==================== EDITING SAVED FILE BANNER (OVERALL MODE) ==================== */}
      {state.viewMode === 'overall' && editingFile && (
        <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs text-indigo-950">
          <div className="flex items-center gap-2">
            <Pencil className="h-3.5 w-3.5 text-indigo-700" />
            <span>
              {isBn ? 'এডিট করছেন:' : 'Editing Saved File:'}{' '}
              <strong>{editingFile.name}</strong> ({formatDateDisplay(editingFile.date)})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={openSaveFileModal}
              className="rounded bg-indigo-600 px-2.5 py-0.5 font-bold text-white hover:bg-indigo-700"
            >
              {isBn ? 'আপডেট / নতুন সেভ' : 'Update / Save Copy'}
            </button>
            <button
              onClick={() =>
                setState((p) => ({ ...p, activeLoadedFileId: null }))
              }
              className="rounded border border-indigo-300 bg-white px-2 py-0.5 font-semibold text-indigo-800 hover:bg-indigo-100"
            >
              {isBn ? 'সম্পন্ন' : 'Detach'}
            </button>
          </div>
        </div>
      )}

      {/* ==================== 2-FILE COMPARISON BAR (WEEKLY / MONTHLY) ==================== */}
      {state.viewMode !== 'overall' && (
        <div
          className={`no-print flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-xs ${
            state.viewMode === 'weekly'
              ? 'border-amber-200 bg-amber-50/90 text-amber-950'
              : 'border-cyan-200 bg-cyan-50/90 text-cyan-950'
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold uppercase tracking-wide">
              {state.viewMode === 'weekly'
                ? isBn
                  ? 'সাপ্তাহিক তুলনা (২টি ফাইল):'
                  : 'Weekly 2-File Compare:'
                : isBn
                ? 'মাসিক তুলনা (২টি ফাইল):'
                : 'Monthly 2-File Compare:'}
            </span>

            {/* 1st File Selector (Previous Week / Month) */}
            <div className="flex items-center gap-1.5">
              <label className="font-semibold">
                {state.viewMode === 'weekly'
                  ? isBn
                    ? '১ম (Previous Week):'
                    : '1st (Prev Week):'
                  : isBn
                  ? '১ম (Previous Month):'
                  : '1st (Prev Month):'}
              </label>
              <select
                value={activeCompare.file1Id}
                onChange={(e) => updateCompare('file1Id', e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-900 shadow-xs"
              >
                {state.savedFiles.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} — {formatDateDisplay(f.date)}
                  </option>
                ))}
              </select>
            </div>

            <ArrowRight className="h-4 w-4 text-slate-500" />

            {/* 2nd File Selector (Last / Updated Report) */}
            <div className="flex items-center gap-1.5">
              <label className="font-semibold">
                {state.viewMode === 'weekly'
                  ? isBn
                    ? '২য় (Last Week / Updated):'
                    : '2nd (Last Week):'
                  : isBn
                  ? '২য় (Updated / Final):'
                  : '2nd (Final Report):'}
              </label>
              <select
                value={activeCompare.file2Id}
                onChange={(e) => updateCompare('file2Id', e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-900 shadow-xs"
              >
                <option value={LIVE_WORKSPACE_ID}>
                  ★ {isBn ? 'বর্তমান চলমান কাজ (Live Workspace)' : 'Current Live Workspace'}
                </option>
                {state.savedFiles.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} — {formatDateDisplay(f.date)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white px-2.5 py-0.5 font-bold border border-slate-300 text-slate-900">
              {state.viewMode === 'weekly'
                ? isBn
                  ? 'সাপ্তাহিক অগ্রগতি:'
                  : 'Weekly Delta:'
                : isBn
                ? 'মাসিক অগ্রগতি:'
                : 'Monthly Delta:'}{' '}
              +{summary.delta.addedShaftsCompleted} Shafts · +{summary.delta.addedLayers} Layers · +
              {summary.delta.addedTunnelM.toFixed(1)}m Tunnel · +
              {summary.delta.addedCastingCompleted + summary.delta.addedPrecastCompleted} MH parts
            </span>
          </div>
        </div>
      )}

      {/* ==================== LIVE KPI & ZOOM SUB-BAR ==================== */}
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

          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-500">Pump SPS:</span>
            <span className="rounded bg-teal-100 px-1.5 py-0.5 font-bold text-teal-800">
              Lower {displayCtx.displayPump.layers.filter((l) => l.status === 'complete').length}/5 · MR:{' '}
              {displayCtx.displayPump.machineRoom.status.toUpperCase()}
            </span>
          </div>
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
            {zoom === 1 ? (
              <Maximize2 className="h-3 w-3 inline mr-1" />
            ) : (
              <Minimize2 className="h-3 w-3 inline mr-1" />
            )}
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
              ? 'টিপস: যেকোনো Shaft, Tunnel বা Pump Station-এ ক্লিক করে ডান পাশ থেকে এডিট করুন। সব পরিবর্তন সাথে সাথে ব্রাউজারে অটো-সেভ হয়।'
              : 'Tip: Click any Shaft, Tunnel bar, or Pump Station on the A1 drawing to edit. All edits auto-save instantaneously.'}
          </div>
        </main>

        {/* Right: Shaft & Pump Station Editor */}
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

      {/* ==================== SAVE OVERALL FILE MODAL (NAME + DATE) ==================== */}
      {saveModalOpen && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                <Save className="h-4 w-4 text-emerald-600" />
                {isBn
                  ? 'ফাইল সেভ করুন (নাম ও তারিখ)'
                  : 'Save Progress File (Name & Date)'}
              </h2>
              <button
                onClick={() => setSaveModalOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              {isBn
                ? 'সেভ করা ফাইলটি "সেভ করা ফাইল" বাটনে জমা থাকবে এবং Weekly ও Monthly রিপোর্টে ২টি ফাইল তুলনা করতে ব্যবহার করা যাবে।'
                : 'Saved files appear in Saved Files and can be selected as File 1 or File 2 in Weekly & Monthly comparison modes.'}
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700">
                  {isBn ? 'ফাইলের নাম (File Name):' : 'File Name:'}
                </label>
                <input
                  type="text"
                  value={saveFileName}
                  onChange={(e) => setSaveFileName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-medium"
                  placeholder="e.g. Week 46 Report / Nov Final"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700">
                  {isBn ? 'তারিখ (Date):' : 'Date:'}
                </label>
                <input
                  type="date"
                  value={saveFileDate}
                  onChange={(e) => setSaveFileDate(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-medium"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700">
                  {isBn ? 'মন্তব্য / নোট (ঐচ্ছিক):' : 'Note (optional):'}
                </label>
                <input
                  type="text"
                  value={saveFileNote}
                  onChange={(e) => setSaveFileNote(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                  placeholder={isBn ? 'যেমন: মিটিংয়ের পর আপডেট' : 'e.g. Site inspection update'}
                />
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button
                onClick={() => setSaveModalOpen(false)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                {isBn ? 'বাতিল' : 'Cancel'}
              </button>
              {editingFile && (
                <button
                  onClick={() => handleSaveFile('update')}
                  className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700"
                >
                  {isBn ? 'আগের ফাইলে আপডেট' : 'Update Existing File'}
                </button>
              )}
              <button
                onClick={() => handleSaveFile('new')}
                className="flex items-center gap-1 rounded-md bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
              >
                <Plus className="h-3.5 w-3.5" />
                {isBn ? 'নতুন ফাইল সেভ করুন' : 'Save New File'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== SAVED FILES MANAGER MODAL (VIEW / EDIT / DOWNLOAD) ==================== */}
      {filesModalOpen && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/65 p-4">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-xl bg-white shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-5 py-3 text-white">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-5 w-5 text-indigo-300" />
                <h2 className="text-sm font-bold">
                  {previewFile
                    ? `${isBn ? 'ফাইল প্রিভিউ:' : 'Previewing File:'} ${previewFile.name} (${formatDateDisplay(previewFile.date)})`
                    : isBn
                    ? `সেভ করা সব ফাইল (${state.savedFiles.length}টি)`
                    : `All Saved Progress Files (${state.savedFiles.length})`}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {previewFile && (
                  <button
                    onClick={() => setPreviewFile(null)}
                    className="rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs font-semibold hover:bg-slate-700"
                  >
                    ← {isBn ? 'সব ফাইল তালিকা' : 'Back to Files List'}
                  </button>
                )}
                <button
                  onClick={() => {
                    setPreviewFile(null);
                    setFilesModalOpen(false);
                  }}
                  className="rounded p-1 text-slate-300 hover:bg-slate-800 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Body: either Preview A1 Sheet OR Saved Files List */}
            {previewFile && previewState ? (
              <div className="flex flex-1 flex-col overflow-hidden bg-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-300 bg-white px-4 py-2 text-xs">
                  <div className="text-slate-700">
                    <strong>{previewFile.name}</strong> · Date:{' '}
                    {formatDateDisplay(previewFile.date)}
                    {previewFile.note && (
                      <span className="ml-2 text-slate-500">({previewFile.note})</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleEditSavedFile(previewFile)}
                      className="flex items-center gap-1 rounded bg-indigo-600 px-2.5 py-1 font-bold text-white hover:bg-indigo-700"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {isBn ? 'এই ফাইল এডিট করুন' : 'Edit This File'}
                    </button>
                    <button
                      onClick={() =>
                        handleExport(
                          'pdf',
                          previewSvgRef.current,
                          `${previewFile.date}-${previewFile.name.replace(/[^a-zA-Z0-9_-]+/g, '_')}`
                        )
                      }
                      className="flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 font-bold text-white hover:bg-blue-700"
                    >
                      <FileText className="h-3.5 w-3.5" /> A1 PDF
                    </button>
                    <button
                      onClick={() =>
                        exportSavedFileExcel(
                          previewFile,
                          state.settings,
                          `WA-${previewFile.name.replace(/[^a-zA-Z0-9_-]+/g, '_')}-${previewFile.date}.xlsx`
                        )
                      }
                      className="flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 font-bold text-white hover:bg-emerald-700"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5" /> Excel (.xlsx)
                    </button>
                    <button
                      onClick={() =>
                        exportSavedFileJson(
                          previewFile,
                          `WA-${previewFile.name.replace(/[^a-zA-Z0-9_-]+/g, '_')}-${previewFile.date}.json`
                        )
                      }
                      className="flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Download className="h-3.5 w-3.5" /> JSON
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-4">
                  <div className="mx-auto max-w-[1400px] bg-white shadow-xl">
                    <A1SheetDrawing
                      state={previewState}
                      selectedShaftId=""
                      onSelectShaft={() => {}}
                      svgRef={previewSvgRef}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                  <span>
                    {isBn
                      ? 'এখান থেকে আগের যেকোনো সেভ করা ফাইল View (দেখা), Edit (এডিট), এবং Download (PDF / Excel / JSON) করতে পারবেন।'
                      : 'View, Edit, or Download (PDF / Excel / JSON) any saved progress file below.'}
                  </span>
                  <button
                    onClick={() => {
                      setFilesModalOpen(false);
                      openSaveFileModal();
                    }}
                    className="flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 font-bold text-white hover:bg-emerald-700"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {isBn ? 'বর্তমান অবস্থা নতুন ফাইল হিসেবে সেভ' : 'Save Current Workspace'}
                  </button>
                </div>

                {state.savedFiles.map((file) => {
                  const fSum = computeSummary(file.shafts);
                  const lowerPumpDone = file.pumpStation.layers.filter(
                    (l) => l.status === 'complete'
                  ).length;
                  const isEditingThis = state.activeLoadedFileId === file.id;
                  const safeSlug = file.name.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'file';

                  return (
                    <div
                      key={file.id}
                      className={`rounded-xl border bg-white p-3.5 shadow-xs transition ${
                        isEditingThis ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-bold text-slate-900">
                              {file.name}
                            </h3>
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                              Date: {formatDateDisplay(file.date)}
                            </span>
                            {isEditingThis && (
                              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-800">
                                {isBn ? 'বর্তমানে এডিটেড' : 'Currently Editing'}
                              </span>
                            )}
                          </div>
                          {file.note && (
                            <p className="text-xs text-slate-500">{file.note}</p>
                          )}
                          <div className="flex flex-wrap gap-2 pt-1 text-[11px]">
                            <span className="rounded bg-emerald-50 border border-emerald-200 px-2 py-0.5 font-semibold text-emerald-800">
                              Shafts: {fSum.completedShafts}/37 Done ({fSum.ongoingShafts} On-going)
                            </span>
                            <span className="rounded bg-blue-50 border border-blue-200 px-2 py-0.5 font-semibold text-blue-800">
                              Manhole: Cast {fSum.castingCompleteCount}/37 · Ring {fSum.precastCompleteCount}/37
                            </span>
                            <span className="rounded bg-fuchsia-50 border border-fuchsia-200 px-2 py-0.5 font-semibold text-fuchsia-800">
                              Tunnel: {(fSum.completedTunnelLengthM / 1000).toFixed(3)} km ({fSum.tunnelPctOverall.toFixed(1)}%)
                            </span>
                            <span className="rounded bg-teal-50 border border-teal-200 px-2 py-0.5 font-semibold text-teal-800">
                              Pump: {lowerPumpDone}/5 ({getPumpLowerStatus(file.pumpStation)}) · MR: {file.pumpStation.machineRoom.status}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          <button
                            onClick={() => setPreviewFile(file)}
                            className="flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 font-bold text-blue-800 hover:bg-blue-100"
                            title="View Full A1 Drawing & PDF"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            {isBn ? 'দেখুন (View)' : 'View'}
                          </button>

                          <button
                            onClick={() => handleEditSavedFile(file)}
                            className="flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 font-bold text-indigo-800 hover:bg-indigo-100"
                            title="Load into Editor"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            {isBn ? 'এডিট (Edit)' : 'Edit'}
                          </button>

                          <button
                            onClick={() => {
                              exportSavedFileExcel(
                                file,
                                state.settings,
                                `WA-${safeSlug}-${file.date}.xlsx`
                              );
                              showToast(
                                isBn ? `"${file.name}" Excel ডাউনলোড হয়েছে!` : 'Excel downloaded!'
                              );
                            }}
                            className="flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 font-bold text-emerald-800 hover:bg-emerald-100"
                            title="Download Excel (.xlsx)"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Excel
                          </button>

                          <button
                            onClick={() => {
                              exportSavedFileJson(file, `WA-${safeSlug}-${file.date}.json`);
                              showToast(
                                isBn ? `"${file.name}" JSON ডাউনলোড হয়েছে!` : 'JSON downloaded!'
                              );
                            }}
                            className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 font-semibold text-slate-700 hover:bg-slate-100"
                            title="Download JSON"
                          >
                            JSON
                          </button>

                          <button
                            onClick={() => handleDeleteSavedFile(file)}
                            className="rounded-md border border-rose-200 bg-white p-1.5 text-rose-600 hover:bg-rose-50"
                            title={isBn ? 'মুছে ফেলুন' : 'Delete'}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
