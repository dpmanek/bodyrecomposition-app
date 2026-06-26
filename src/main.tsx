import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BarChart3,
  Camera,
  CheckCircle2,
  Database,
  Download,
  FileUp,
  LineChart,
  NotebookTabs,
  Save,
  Settings,
  Trash2,
  Upload,
  WandSparkles,
} from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart as ReLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AppTab, EntryDraft, ExtractionResult, FieldConfidence, MeasurementField, RecompEntry } from './types';
import { downloadFile, exportCsv, exportJson, parseBackup } from './lib/export';
import { loadEntries, saveEntries, sortEntries } from './lib/storage';
import { draftToEntry, emptyDraft, entryToDraft, validateDraft } from './lib/validation';
import './styles.css';

const fields: Array<{ key: MeasurementField; label: string; suffix?: string; step?: string }> = [
  { key: 'weight', label: 'Weight', step: '0.1' },
  { key: 'bmi', label: 'BMI', step: '0.1' },
  { key: 'bodyFatPercent', label: 'Body fat', suffix: '%', step: '0.1' },
  { key: 'skeletalMusclePercent', label: 'Skeletal muscle', suffix: '%', step: '0.1' },
  { key: 'visceralFatLevel', label: 'Visceral fat', step: '1' },
  { key: 'restingMetabolismKcal', label: 'Resting metabolism', suffix: 'kcal', step: '1' },
  { key: 'bodyAgeYears', label: 'Body age', suffix: 'years', step: '1' },
];

const tabs: Array<{ id: AppTab; label: string; icon: React.ReactNode }> = [
  { id: 'capture', label: 'Capture', icon: <Camera size={20} /> },
  { id: 'log', label: 'Log', icon: <NotebookTabs size={20} /> },
  { id: 'trends', label: 'Trends', icon: <LineChart size={20} /> },
  { id: 'backup', label: 'Backup', icon: <Settings size={20} /> },
];

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('capture');
  const [entries, setEntries] = useState<RecompEntry[]>(() => loadEntries());
  const [accessKey, setAccessKey] = useState(() => localStorage.getItem('recomptrack.accessKey.v1') ?? '');

  useEffect(() => saveEntries(entries), [entries]);
  useEffect(() => {
    if (accessKey.trim()) {
      localStorage.setItem('recomptrack.accessKey.v1', accessKey.trim());
    } else {
      localStorage.removeItem('recomptrack.accessKey.v1');
    }
  }, [accessKey]);

  const upsertEntry = (entry: RecompEntry) => {
    setEntries((current) => sortEntries([entry, ...current.filter((item) => item.id !== entry.id)]));
  };

  const deleteEntry = (id: string) => {
    if (window.confirm('Delete this entry?')) {
      setEntries((current) => current.filter((item) => item.id !== id));
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>RecompTrack</h1>
          <p>{entries.length ? `${entries.length} saved readings` : 'Daily Omron readings, locally saved'}</p>
        </div>
        <div className="sync-dot" aria-label="Local only">
          <Database size={17} />
        </div>
      </header>

      <section className="content">
        {activeTab === 'capture' && <CaptureView accessKey={accessKey} onSave={upsertEntry} />}
        {activeTab === 'log' && <LogView entries={entries} onSave={upsertEntry} onDelete={deleteEntry} />}
        {activeTab === 'trends' && <TrendsView entries={entries} />}
        {activeTab === 'backup' && <BackupView entries={entries} accessKey={accessKey} onAccessKeyChange={setAccessKey} onImport={setEntries} />}
      </section>

      <nav className="tabs" aria-label="Primary navigation">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? 'active' : ''}
            type="button"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
    </main>
  );
}

function CaptureView({ accessKey, onSave }: { accessKey: string; onSave: (entry: RecompEntry) => void }) {
  const [draft, setDraft] = useState<EntryDraft>(() => emptyDraft());
  const [confidence, setConfidence] = useState<FieldConfidence>({});
  const [preview, setPreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'extracting' | 'draft' | 'error' | 'saved'>('idle');
  const [message, setMessage] = useState('');
  const issues = validateDraft(draft, confidence);

  const selectImage = (file: File | null) => {
    setImageFile(file);
    setConfidence({});
    setStatus(file ? 'idle' : 'idle');
    setMessage('');
    if (preview) URL.revokeObjectURL(preview);
    setPreview(file ? URL.createObjectURL(file) : null);
    setDraft((current) => ({ ...current, capturedAt: new Date().toISOString().slice(0, 16) }));
  };

  const extract = async () => {
    if (!imageFile) {
      setMessage('Choose a monitor photo first.');
      return;
    }
    setStatus('extracting');
    setMessage('');
    try {
      const formData = new FormData();
      formData.append('image', imageFile);
      const headers = accessKey.trim() ? { 'x-app-access-key': accessKey.trim() } : undefined;
      const response = await fetch('/api/extract', { method: 'POST', headers, body: formData });
      if (!response.ok) throw new Error(await response.text());
      const result = (await response.json()) as ExtractionResult;
      setDraft((current) => ({
        ...current,
        source: 'ai',
        weight: valueToInput(result.values.weight),
        weightUnit: result.values.weightUnit === 'kg' ? 'kg' : result.values.weightUnit === 'lb' ? 'lb' : current.weightUnit,
        bmi: valueToInput(result.values.bmi),
        bodyFatPercent: valueToInput(result.values.bodyFatPercent),
        skeletalMusclePercent: valueToInput(result.values.skeletalMusclePercent),
        visceralFatLevel: valueToInput(result.values.visceralFatLevel),
        restingMetabolismKcal: valueToInput(result.values.restingMetabolismKcal),
        bodyAgeYears: valueToInput(result.values.bodyAgeYears),
      }));
      setConfidence(result.confidence ?? {});
      setStatus('draft');
      setMessage('AI draft ready. Review every value before saving.');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Extraction failed');
    }
  };

  const saveDraft = () => {
    const entry = draftToEntry(draft);
    onSave(entry);
    setDraft(emptyDraft());
    setConfidence({});
    setImageFile(null);
    setPreview(null);
    setStatus('saved');
    setMessage('Saved locally.');
  };

  return (
    <div className="view-stack">
      <section className="panel capture-panel">
        <div className="section-heading">
          <div>
            <h2>Capture reading</h2>
            <p>Photos are used for extraction only and are not stored.</p>
          </div>
          {status === 'draft' && <span className="draft-chip">Draft</span>}
        </div>

        <label className="dropzone">
          {preview ? <img src={preview} alt="Selected monitor preview" /> : <Camera size={34} />}
          <span>{preview ? 'Change image' : 'Camera or upload'}</span>
          <input accept="image/*" capture="environment" type="file" onChange={(event) => selectImage(event.target.files?.[0] ?? null)} />
        </label>

        <div className="action-row">
          <button className="primary" type="button" disabled={!imageFile || status === 'extracting'} onClick={extract}>
            <WandSparkles size={18} />
            {status === 'extracting' ? 'Extracting...' : 'Extract with Gemini'}
          </button>
        </div>

        {message && <StatusMessage status={status} message={message} />}
      </section>

      <EntryForm draft={draft} setDraft={setDraft} confidence={confidence} issues={issues} title="Verify draft" />

      <button className="save-button" type="button" onClick={saveDraft}>
        <Save size={19} />
        Save verified entry
      </button>
    </div>
  );
}

function EntryForm({
  draft,
  setDraft,
  confidence,
  issues,
  title,
}: {
  draft: EntryDraft;
  setDraft: React.Dispatch<React.SetStateAction<EntryDraft>>;
  confidence?: FieldConfidence;
  issues: ReturnType<typeof validateDraft>;
  title: string;
}) {
  const fieldIssues = (field: MeasurementField | 'capturedAt') => issues.filter((issue) => issue.field === field);

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          <p>Suspicious values are highlighted for review, not blocked.</p>
        </div>
      </div>

      <label className="input-field">
        <span>Captured at</span>
        <input
          type="datetime-local"
          value={draft.capturedAt}
          onChange={(event) => setDraft((current) => ({ ...current, capturedAt: event.target.value }))}
        />
      </label>

      <div className="unit-toggle" role="group" aria-label="Weight unit">
        {(['lb', 'kg'] as const).map((unit) => (
          <button
            key={unit}
            type="button"
            className={draft.weightUnit === unit ? 'active' : ''}
            onClick={() => setDraft((current) => ({ ...current, weightUnit: unit }))}
          >
            {unit}
          </button>
        ))}
      </div>

      <div className="field-grid">
        {fields.map((field) => {
          const fieldWarnings = fieldIssues(field.key);
          const isWarn = fieldWarnings.length > 0;
          return (
            <label key={field.key} className={`input-field ${isWarn ? 'warn' : ''}`}>
              <span>
                {field.label}
                {confidence?.[field.key] !== undefined && <small>{Math.round((confidence[field.key] ?? 0) * 100)}%</small>}
              </span>
              <div className="input-with-suffix">
                <input
                  inputMode="decimal"
                  step={field.step}
                  type="number"
                  value={draft[field.key]}
                  onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                />
                {field.key === 'weight' ? <em>{draft.weightUnit}</em> : field.suffix ? <em>{field.suffix}</em> : null}
              </div>
              {isWarn && <strong>{fieldWarnings.map((issue) => issue.message).join(' · ')}</strong>}
            </label>
          );
        })}
      </div>

      <label className="input-field">
        <span>Notes</span>
        <textarea
          rows={3}
          value={draft.notes}
          onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
          placeholder="Training, hydration, unusual timing..."
        />
      </label>
    </section>
  );
}

function LogView({
  entries,
  onSave,
  onDelete,
}: {
  entries: RecompEntry[];
  onSave: (entry: RecompEntry) => void;
  onDelete: (id: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = entries.find((entry) => entry.id === editingId);
  const [draft, setDraft] = useState<EntryDraft>(() => emptyDraft());
  const issues = validateDraft(draft);

  useEffect(() => {
    if (editing) setDraft(entryToDraft(editing));
  }, [editing]);

  if (!entries.length) {
    return <EmptyState title="No readings yet" text="Capture or manually add your first Omron reading." />;
  }

  return (
    <div className="view-stack">
      {editing && (
        <div className="edit-block">
          <EntryForm draft={draft} setDraft={setDraft} issues={issues} title="Edit entry" />
          <div className="action-row">
            <button className="primary" type="button" onClick={() => { onSave(draftToEntry(draft, editing)); setEditingId(null); }}>
              <CheckCircle2 size={18} /> Update
            </button>
            <button type="button" onClick={() => setEditingId(null)}>Cancel</button>
          </div>
        </div>
      )}

      <section className="log-list">
        {entries.map((entry) => (
          <article className="entry-row" key={entry.id}>
            <button type="button" className="entry-main" onClick={() => setEditingId(entry.id)}>
              <span>{formatDate(entry.capturedAt)}</span>
              <strong>{display(entry.weight)} {entry.weightUnit}</strong>
              <small>BF {display(entry.bodyFatPercent)}% · BMI {display(entry.bmi)} · VF {display(entry.visceralFatLevel)}</small>
            </button>
            <button className="icon-button danger" type="button" aria-label="Delete entry" onClick={() => onDelete(entry.id)}>
              <Trash2 size={18} />
            </button>
          </article>
        ))}
      </section>
    </div>
  );
}

function TrendsView({ entries }: { entries: RecompEntry[] }) {
  const data = useMemo(
    () =>
      [...entries]
        .reverse()
        .map((entry) => ({
          date: new Date(entry.capturedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          weight: entry.weight,
          bmi: entry.bmi,
          bodyFatPercent: entry.bodyFatPercent,
          skeletalMusclePercent: entry.skeletalMusclePercent,
          visceralFatLevel: entry.visceralFatLevel,
        })),
    [entries],
  );

  if (entries.length < 2) {
    return <EmptyState title="Trends need two readings" text="Save a few entries and the charts will appear here." />;
  }

  return (
    <div className="view-stack">
      <TrendCard data={data} dataKey="weight" label="Weight" color="#0b8c83" />
      <TrendCard data={data} dataKey="bmi" label="BMI" color="#3467c2" />
      <TrendCard data={data} dataKey="bodyFatPercent" label="Body fat %" color="#dc7a13" />
      <TrendCard data={data} dataKey="skeletalMusclePercent" label="Skeletal muscle %" color="#5f7f36" />
      <TrendCard data={data} dataKey="visceralFatLevel" label="Visceral fat" color="#9b4d8d" />
    </div>
  );
}

function TrendCard({ data, dataKey, label, color }: { data: Array<Record<string, string | number | null>>; dataKey: string; label: string; color: string }) {
  const hasData = data.some((point) => point[dataKey] !== null);
  if (!hasData) return null;
  return (
    <section className="panel trend-card">
      <h2>{label}</h2>
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height={210}>
          <ReLineChart data={data} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid stroke="#e4e8ec" strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey={dataKey} name={label} stroke={color} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
          </ReLineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function BackupView({
  entries,
  accessKey,
  onAccessKeyChange,
  onImport,
}: {
  entries: RecompEntry[];
  accessKey: string;
  onAccessKeyChange: (value: string) => void;
  onImport: (entries: RecompEntry[]) => void;
}) {
  const [message, setMessage] = useState('');

  const importFile = async (file: File | null) => {
    if (!file) return;
    try {
      const imported = parseBackup(await file.text());
      const merged = sortEntries([...imported, ...entries.filter((entry) => !imported.some((item) => item.id === entry.id))]);
      onImport(merged);
      setMessage(`Imported ${imported.length} valid entries.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Import failed');
    }
  };

  return (
    <div className="view-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Backup</h2>
            <p>Your data stays in this browser unless you export it.</p>
          </div>
        </div>
        <div className="settings-actions">
          <button type="button" onClick={() => downloadFile('recomptrack-backup.json', exportJson(entries), 'application/json')}>
            <Download size={18} /> Export JSON
          </button>
          <button type="button" onClick={() => downloadFile('recomptrack-log.csv', exportCsv(entries), 'text/csv')}>
            <BarChart3 size={18} /> Export CSV
          </button>
          <label className="file-button">
            <FileUp size={18} /> Import JSON
            <input type="file" accept="application/json,.json" onChange={(event) => importFile(event.target.files?.[0] ?? null)} />
          </label>
        </div>
        {message && <p className="muted-note">{message}</p>}
      </section>

      <section className="panel quiet">
        <h2>Gemini proxy</h2>
        <p>Set <code>GEMINI_API_KEY</code> as a server secret. If you set <code>APP_ACCESS_KEY</code>, store the same key here to send <code>x-app-access-key</code>.</p>
        <label className="input-field access-key-field">
          <span>App access key</span>
          <input
            type="password"
            value={accessKey}
            onChange={(event) => onAccessKeyChange(event.target.value)}
            placeholder="Optional"
          />
        </label>
      </section>
    </div>
  );
}

function StatusMessage({ status, message }: { status: string; message: string }) {
  return <p className={`status ${status}`}>{message}</p>;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <section className="empty-state">
      <Upload size={34} />
      <h2>{title}</h2>
      <p>{text}</p>
    </section>
  );
}

const valueToInput = (value: number | string | null | undefined) =>
  value === null || value === undefined ? '' : String(value);

const display = (value: number | null) => (value === null ? '-' : value);

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
