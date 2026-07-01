import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BarChart3,
  Camera,
  CheckCircle2,
  CirclePlus,
  Cloud,
  CloudOff,
  Database,
  Download,
  FileUp,
  HeartPulse,
  Link2,
  LineChart,
  NotebookTabs,
  RefreshCw,
  Save,
  Settings,
  Sparkles,
  Trash2,
  Unplug,
  Upload,
  UserRound,
  UsersRound,
  WandSparkles,
  Watch,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart as ReLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  AppTab,
  EntryDraft,
  ExtractionResult,
  FieldConfidence,
  GoogleHealthStatus,
  HealthDailySummary,
  MeasurementField,
  ProfileSex,
  RecompEntry,
  UserProfile,
} from './types';
import {
  deletedCloudRecord,
  entryCloudRecord,
  flushCloudQueue,
  profileCloudRecord,
  queueCloudRecords,
  syncWithCloud,
  type CloudRecord,
} from './lib/cloud-sync';
import { downloadFile, exportCsv, exportJson, parseBackup } from './lib/export';
import {
  beginGoogleHealthConnection,
  disconnectGoogleHealth,
  getGoogleHealthStatus,
  syncGoogleHealth,
} from './lib/google-health';
import { prepareImageForExtraction } from './lib/image';
import { estimateRestingMetabolismKcal } from './lib/metabolism';
import { loadActiveProfileId, loadProfiles, saveActiveProfileId, saveProfiles } from './lib/profile';
import { loadEntries, saveEntries, sortEntries } from './lib/storage';
import {
  createProfile,
  draftToEntry,
  emptyDraft,
  entryToDraft,
  profileToDraftPatch,
  validateDraft,
} from './lib/validation';
import './styles.css';

type ProfileField = keyof Pick<
  UserProfile,
  'weight' | 'ageYears' | 'height' | 'skeletalMusclePercent' | 'visceralFatLevel' | 'restingMetabolismKcal'
>;

type SyncStatus = 'local' | 'syncing' | 'synced' | 'error';
type HealthRequestStatus = 'idle' | 'loading' | 'syncing' | 'error';

const emptyHealthStatus: GoogleHealthStatus = {
  connected: false,
  connectedAt: null,
  lastSyncedAt: null,
  summaries: [],
};

const tabs: Array<{ id: AppTab; label: string; icon: React.ReactNode }> = [
  { id: 'capture', label: 'Capture', icon: <Camera size={20} /> },
  { id: 'dashboard', label: 'Dashboard', icon: <LineChart size={20} /> },
  { id: 'log', label: 'Log', icon: <NotebookTabs size={20} /> },
  { id: 'profiles', label: 'Profiles', icon: <UsersRound size={20} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={20} /> },
];

const dailyFields: Array<{ key: MeasurementField; label: string; suffix?: string; step?: string }> = [
  { key: 'bodyFatPercent', label: 'Body fat', suffix: '%', step: '0.1' },
  { key: 'bmi', label: 'BMI', step: '0.1' },
];

const profileFields: Array<{ key: ProfileField; label: string; suffix?: string; step?: string }> = [
  { key: 'weight', label: 'Weight', step: '0.1' },
  { key: 'ageYears', label: 'Age', suffix: 'years', step: '1' },
  { key: 'height', label: 'Height', step: '0.1' },
  { key: 'skeletalMusclePercent', label: 'Skeletal muscle', suffix: '%', step: '0.1' },
  { key: 'visceralFatLevel', label: 'Visceral fat', step: '1' },
  { key: 'restingMetabolismKcal', label: 'Estimated resting metabolism', suffix: 'kcal', step: '1' },
];

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>(() =>
    new URLSearchParams(window.location.search).has('googleHealth') ? 'settings' : 'capture',
  );
  const [entries, setEntries] = useState<RecompEntry[]>(() => loadEntries());
  const [profiles, setProfiles] = useState<UserProfile[]>(() => loadProfiles());
  const [activeProfileId, setActiveProfileId] = useState<string | null>(() => loadActiveProfileId(loadProfiles()));
  const [accessKey, setAccessKey] = useState(() => localStorage.getItem('recomptrack.accessKey.v1') ?? '');
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(accessKey.trim() ? 'syncing' : 'local');
  const [syncMessage, setSyncMessage] = useState(
    accessKey.trim() ? 'Connecting to cloud…' : 'Add an access key to enable cloud sync.',
  );
  const [health, setHealth] = useState<GoogleHealthStatus>(emptyHealthStatus);
  const [healthRequestStatus, setHealthRequestStatus] = useState<HealthRequestStatus>('idle');
  const [healthMessage, setHealthMessage] = useState('');

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0],
    [activeProfileId, profiles],
  );
  const activeEntries = useMemo(
    () => entriesForProfile(entries, activeProfile?.id, profiles.length),
    [activeProfile?.id, entries, profiles.length],
  );

  useEffect(() => saveEntries(entries), [entries]);
  useEffect(() => saveProfiles(profiles), [profiles]);
  useEffect(() => saveActiveProfileId(activeProfile?.id ?? null), [activeProfile?.id]);
  useEffect(() => {
    const firstProfile = profiles[0];
    if (!firstProfile) return;
    setEntries((current) => {
      if (!current.some((entry) => !entry.profileId)) return current;
      return current.map((entry) =>
        entry.profileId ? entry : { ...entry, profileId: firstProfile.id, profileName: firstProfile.name },
      );
    });
  }, [profiles]);
  useEffect(() => {
    if (activeProfile && activeProfile.id !== activeProfileId) {
      setActiveProfileId(activeProfile.id);
    }
  }, [activeProfile, activeProfileId]);
  useEffect(() => {
    if (accessKey.trim()) {
      localStorage.setItem('recomptrack.accessKey.v1', accessKey.trim());
    } else {
      localStorage.removeItem('recomptrack.accessKey.v1');
    }
  }, [accessKey]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('googleHealth');
    if (!result) return;
    setHealthMessage(
      result === 'connected'
        ? 'Google Health connected. Sync your latest watch data when ready.'
        : params.get('message') || 'Google Health could not be connected.',
    );
    if (result === 'error') setHealthRequestStatus('error');
    window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`);
  }, []);

  useEffect(() => {
    const key = accessKey.trim();
    const profileId = activeProfile?.id;
    if (!key || !profileId) {
      setHealth(emptyHealthStatus);
      setHealthRequestStatus('idle');
      return;
    }

    let cancelled = false;
    setHealthRequestStatus('loading');
    void getGoogleHealthStatus(key, profileId)
      .then((result) => {
        if (cancelled) return;
        setHealth(result);
        setHealthRequestStatus('idle');
        setHealthMessage((current) => current.startsWith('Google Health connected.') ? current : '');
      })
      .catch((error) => {
        if (cancelled) return;
        setHealth(emptyHealthStatus);
        setHealthRequestStatus('error');
        setHealthMessage(error instanceof Error ? error.message : 'Google Health status could not be loaded.');
      });
    return () => { cancelled = true; };
  }, [accessKey, activeProfile?.id]);

  useEffect(() => {
    const key = accessKey.trim();
    if (!key) {
      setSyncStatus('local');
      setSyncMessage('Add an access key to enable cloud sync.');
      return;
    }

    let cancelled = false;
    const run = async () => {
      setSyncStatus('syncing');
      setSyncMessage('Syncing changes…');
      try {
        const result = await syncWithCloud(key, loadEntries(), loadProfiles());
        if (cancelled) return;
        setEntries(sortEntries(result.entries));
        if (result.profiles.length) setProfiles(result.profiles);
        setSyncStatus('synced');
        setSyncMessage('Cloud data is up to date.');
      } catch (error) {
        if (cancelled) return;
        setSyncStatus('error');
        setSyncMessage(error instanceof Error ? error.message : 'Cloud sync failed');
      }
    };

    const timer = window.setTimeout(run, 700);
    window.addEventListener('focus', run);
    window.addEventListener('online', run);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener('focus', run);
      window.removeEventListener('online', run);
    };
  }, [accessKey]);

  const flushChanges = (records: CloudRecord[]) => {
    queueCloudRecords(records);
    const key = accessKey.trim();
    if (!key) return;
    setSyncStatus('syncing');
    setSyncMessage('Syncing changes…');
    void flushCloudQueue(key)
      .then(() => {
        setSyncStatus('synced');
        setSyncMessage('Cloud data is up to date.');
      })
      .catch((error) => {
        setSyncStatus('error');
        setSyncMessage(error instanceof Error ? error.message : 'Changes are queued for retry.');
      });
  };

  const syncNow = async () => {
    const key = accessKey.trim();
    if (!key) {
      setSyncStatus('local');
      setSyncMessage('Enter the app access key first.');
      return;
    }
    setSyncStatus('syncing');
    setSyncMessage('Syncing changes…');
    try {
      const result = await syncWithCloud(key, entries, profiles);
      setEntries(sortEntries(result.entries));
      if (result.profiles.length) setProfiles(result.profiles);
      setSyncStatus('synced');
      setSyncMessage('Cloud data is up to date.');
    } catch (error) {
      setSyncStatus('error');
      setSyncMessage(error instanceof Error ? error.message : 'Cloud sync failed');
    }
  };

  const connectHealth = async () => {
    const key = accessKey.trim();
    if (!key) {
      setHealthRequestStatus('error');
      setHealthMessage('Enter the app access key under Cloud sync first.');
      return;
    }
    setHealthRequestStatus('loading');
    setHealthMessage('Opening Google authorization…');
    try {
      const result = await beginGoogleHealthConnection(key, activeProfile.id);
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      setHealthRequestStatus('error');
      setHealthMessage(error instanceof Error ? error.message : 'Google Health connection failed.');
    }
  };

  const syncHealth = async () => {
    const key = accessKey.trim();
    if (!key) return;
    setHealthRequestStatus('syncing');
    setHealthMessage('Syncing 14 days of watch summaries…');
    try {
      const result = await syncGoogleHealth(key, activeProfile.id);
      setHealth(result);
      setHealthRequestStatus('idle');
      setHealthMessage('Pixel Watch summaries are up to date.');
    } catch (error) {
      setHealthRequestStatus('error');
      setHealthMessage(error instanceof Error ? error.message : 'Google Health sync failed.');
    }
  };

  const disconnectHealth = async () => {
    if (!window.confirm(`Disconnect Google Health from ${activeProfile.name} and remove imported watch summaries?`)) return;
    const key = accessKey.trim();
    if (!key) return;
    setHealthRequestStatus('loading');
    try {
      const result = await disconnectGoogleHealth(key, activeProfile.id);
      setHealth(result);
      setHealthRequestStatus('idle');
      setHealthMessage('Google Health disconnected and imported summaries removed.');
    } catch (error) {
      setHealthRequestStatus('error');
      setHealthMessage(error instanceof Error ? error.message : 'Google Health could not be disconnected.');
    }
  };

  const upsertEntry = (entry: RecompEntry) => {
    setEntries((current) => sortEntries([entry, ...current.filter((item) => item.id !== entry.id)]));
    flushChanges([entryCloudRecord(entry)]);
  };

  const deleteEntry = (id: string) => {
    if (window.confirm('Delete this entry?')) {
      setEntries((current) => current.filter((item) => item.id !== id));
      flushChanges([deletedCloudRecord('entry', id)]);
    }
  };

  const upsertProfile = (profile: UserProfile) => {
    const updatedAt = new Date().toISOString();
    const savedProfile = { ...profile, updatedAt };
    setProfiles((current) => {
      const exists = current.some((item) => item.id === savedProfile.id);
      return exists ? current.map((item) => (item.id === savedProfile.id ? savedProfile : item)) : [...current, savedProfile];
    });
    const renamedEntries = entries.map((entry) =>
      entry.profileId === savedProfile.id ? { ...entry, profileName: savedProfile.name, updatedAt } : entry,
    );
    setEntries(renamedEntries);
    flushChanges([
      profileCloudRecord(savedProfile),
      ...renamedEntries.filter((entry) => entry.profileId === savedProfile.id).map(entryCloudRecord),
    ]);
    setActiveProfileId(savedProfile.id);
  };

  const addProfile = () => {
    const profile = createProfile(`Profile ${profiles.length + 1}`);
    setProfiles((current) => [...current, profile]);
    flushChanges([profileCloudRecord(profile)]);
    setActiveProfileId(profile.id);
    setActiveTab('profiles');
  };

  const deleteProfile = (profileId: string) => {
    if (profiles.length <= 1) return;
    if (!window.confirm('Delete this profile? Existing readings stay in the log as historical entries.')) return;
    setProfiles((current) => current.filter((profile) => profile.id !== profileId));
    flushChanges([deletedCloudRecord('profile', profileId)]);
    if (activeProfileId === profileId) {
      setActiveProfileId(profiles.find((profile) => profile.id !== profileId)?.id ?? null);
    }
  };

  if (!activeProfile) {
    return <EmptyState title="No profile found" text="Refresh the app to recreate the default profile." />;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="app-kicker">Local-first Omron journal</p>
          <h1>RecompTrack</h1>
        </div>
        <button className="profile-switch" type="button" onClick={() => setActiveTab('profiles')}>
          <UserRound size={17} />
          <span>{activeProfile.name}</span>
        </button>
      </header>

      <section className="content">
        {activeTab === 'capture' && (
          <CaptureView
            accessKey={accessKey}
            profile={activeProfile}
            profiles={profiles}
            onProfileChange={setActiveProfileId}
            onSave={upsertEntry}
          />
        )}
        {activeTab === 'dashboard' && (
          <DashboardView profile={activeProfile} entries={activeEntries} healthSummaries={health.summaries} />
        )}
        {activeTab === 'log' && (
          <LogView
            profile={activeProfile}
            entries={activeEntries}
            onDelete={deleteEntry}
            onSave={upsertEntry}
          />
        )}
        {activeTab === 'profiles' && (
          <ProfilesView
            activeProfileId={activeProfile.id}
            entries={entries}
            profiles={profiles}
            onAddProfile={addProfile}
            onDeleteProfile={deleteProfile}
            onProfileChange={setActiveProfileId}
            onProfileSave={upsertProfile}
          />
        )}
        {activeTab === 'settings' && (
          <SettingsView
            accessKey={accessKey}
            entries={entries}
            health={health}
            healthMessage={healthMessage}
            healthRequestStatus={healthRequestStatus}
            profiles={profiles}
            profile={activeProfile}
            onAccessKeyChange={setAccessKey}
            onConnectHealth={connectHealth}
            onDisconnectHealth={disconnectHealth}
            onSync={syncNow}
            onSyncHealth={syncHealth}
            syncMessage={syncMessage}
            syncStatus={syncStatus}
            onImport={(importedEntries, importedProfiles) => {
              if (importedProfiles.length) {
                setProfiles((current) => mergeProfiles(current, importedProfiles));
              }
              setEntries((current) => mergeEntries(current, importedEntries));
              flushChanges([
                ...importedProfiles.map(profileCloudRecord),
                ...importedEntries.map(entryCloudRecord),
              ]);
            }}
          />
        )}
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

function CaptureView({
  accessKey,
  profile,
  profiles,
  onProfileChange,
  onSave,
}: {
  accessKey: string;
  profile: UserProfile;
  profiles: UserProfile[];
  onProfileChange: (profileId: string) => void;
  onSave: (entry: RecompEntry) => void;
}) {
  const [draft, setDraft] = useState<EntryDraft>(() => emptyDraft(profile));
  const [confidence, setConfidence] = useState<FieldConfidence>({});
  const [preview, setPreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'extracting' | 'draft' | 'error' | 'saved'>('idle');
  const [message, setMessage] = useState('');
  const issues = validateDraft(draft, confidence);

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      profileId: profile.id,
      profileName: profile.name,
      ...profileToDraftPatch(profile),
    }));
  }, [profile]);

  const selectImage = (file: File | null) => {
    setImageFile(file);
    setConfidence({});
    setStatus('idle');
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
      const preparedImage = await prepareImageForExtraction(imageFile);
      const formData = new FormData();
      formData.append('image', preparedImage);
      const headers = accessKey.trim() ? { 'x-app-access-key': accessKey.trim() } : undefined;
      const response = await fetch('/api/extract', { method: 'POST', headers, body: formData });
      if (!response.ok) throw new Error(await readableError(response));
      const result = (await response.json()) as ExtractionResult;
      setDraft((current) => ({
        ...current,
        ...profileToDraftPatch(profile),
        source: 'ai',
        weight: valueToInput(result.values.weight) || profile.weight,
        weightUnit: result.values.weightUnit === 'kg' ? 'kg' : result.values.weightUnit === 'lb' ? 'lb' : profile.weightUnit,
        bmi: valueToInput(result.values.bmi),
        bodyFatPercent: valueToInput(result.values.bodyFatPercent),
        skeletalMusclePercent: valueToInput(result.values.skeletalMusclePercent) || profile.skeletalMusclePercent,
        visceralFatLevel: valueToInput(result.values.visceralFatLevel) || profile.visceralFatLevel,
        restingMetabolismKcal: valueToInput(result.values.restingMetabolismKcal) || profile.restingMetabolismKcal,
        bodyAgeYears: valueToInput(result.values.bodyAgeYears) || profile.ageYears,
      }));
      setConfidence(result.confidence ?? {});
      setStatus('draft');
      setMessage('AI draft ready. Confirm the numbers before saving.');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Extraction failed');
    }
  };

  const saveDraft = () => {
    onSave(draftToEntry(withEstimatedRestingMetabolism(draft, profile)));
    setDraft(emptyDraft(profile));
    setConfidence({});
    setImageFile(null);
    setPreview(null);
    setStatus('saved');
    setMessage('Saved locally.');
  };

  return (
    <div className="view-stack">
      <section className="hero-panel">
        <div>
          <span className="eyebrow">Active profile</span>
          <h2>{profile.name}</h2>
          <p>{profileSummary(profile)}</p>
        </div>
        <select value={profile.id} onChange={(event) => onProfileChange(event.target.value)} aria-label="Active profile">
          {profiles.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </section>

      <section className="panel capture-panel">
        <div className="section-heading">
          <div>
            <h2>New reading</h2>
            <p>Upload the HBF-306C display or enter FAT% and BMI manually.</p>
          </div>
          {status === 'draft' ? <span className="draft-chip">Draft</span> : null}
        </div>

        <div className="dropzone" aria-live="polite">
          {preview ? <img src={preview} alt="Selected monitor preview" /> : <Camera size={34} />}
          <span>{preview ? imageFile?.name ?? 'Selected image' : 'No image selected'}</span>
        </div>

        <div className="capture-actions">
          <label className="file-button primary" htmlFor="capture-camera-input">
            <Camera size={18} /> Take photo
          </label>
          <label className="file-button" htmlFor="capture-upload-input">
            <Upload size={18} /> Upload image
          </label>
          <input
            id="capture-camera-input"
            className="visually-hidden-file"
            accept="image/*"
            capture="environment"
            type="file"
            onChange={(event) => selectImage(event.target.files?.[0] ?? null)}
          />
          <input
            id="capture-upload-input"
            className="visually-hidden-file"
            accept="image/*"
            type="file"
            onChange={(event) => selectImage(event.target.files?.[0] ?? null)}
          />
        </div>

        <button className="ai-button" type="button" disabled={!imageFile || status === 'extracting'} onClick={extract}>
          <WandSparkles size={18} />
          {status === 'extracting' ? 'Extracting...' : 'Extract with Gemini'}
        </button>

        {message ? <StatusMessage status={status} message={message} /> : null}
      </section>

      <ReadingForm
        confidence={confidence}
        draft={draft}
        issues={issues}
        mode="capture"
        setDraft={setDraft}
        title="Verify reading"
      />

      <button className="save-button" type="button" onClick={saveDraft}>
        <Save size={19} />
        Save verified entry
      </button>
    </div>
  );
}

function ReadingForm({
  confidence,
  draft,
  issues,
  mode,
  setDraft,
  title,
}: {
  confidence?: FieldConfidence;
  draft: EntryDraft;
  issues: ReturnType<typeof validateDraft>;
  mode: 'capture' | 'edit';
  setDraft: React.Dispatch<React.SetStateAction<EntryDraft>>;
  title: string;
}) {
  const fieldIssues = (field: MeasurementField | 'capturedAt') => issues.filter((issue) => issue.field === field);

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          <p>{mode === 'capture' ? 'Confirm FAT% and BMI. Profile values stay tucked away.' : 'Edit the saved reading.'}</p>
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

      <div className="field-grid daily-grid">
        {dailyFields.map((field) => {
          const warnings = fieldIssues(field.key);
          return (
            <NumberField
              key={field.key}
              confidence={confidence?.[field.key]}
              field={field.key}
              label={field.label}
              step={field.step}
              suffix={field.suffix}
              value={draft[field.key]}
              warnings={warnings.map((issue) => issue.message)}
              onChange={(value) => setDraft((current) => ({ ...current, [field.key]: value }))}
            />
          );
        })}
      </div>

      <label className="input-field">
        <span>Notes</span>
        <textarea
          rows={3}
          value={draft.notes}
          onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
          placeholder="Training, hydration, meal timing, sleep..."
        />
      </label>

      <details className="advanced-entry">
        <summary>Profile-derived fields</summary>
        <p>These are applied automatically from the active profile. Change only when this reading needs an override.</p>
        <div className="field-grid">
          <NumberField
            field="weight"
            label="Weight"
            suffix={draft.weightUnit}
            value={draft.weight}
            warnings={fieldIssues('weight').map((issue) => issue.message)}
            onChange={(value) => setDraft((current) => ({ ...current, weight: value }))}
          />
          <NumberField
            field="bodyAgeYears"
            label="Age"
            suffix="years"
            value={draft.bodyAgeYears}
            warnings={fieldIssues('bodyAgeYears').map((issue) => issue.message)}
            onChange={(value) => setDraft((current) => ({ ...current, bodyAgeYears: value }))}
          />
          <NumberField
            field="skeletalMusclePercent"
            label="Skeletal muscle"
            suffix="%"
            value={draft.skeletalMusclePercent}
            warnings={fieldIssues('skeletalMusclePercent').map((issue) => issue.message)}
            onChange={(value) => setDraft((current) => ({ ...current, skeletalMusclePercent: value }))}
          />
          <NumberField
            field="visceralFatLevel"
            label="Visceral fat"
            value={draft.visceralFatLevel}
            warnings={fieldIssues('visceralFatLevel').map((issue) => issue.message)}
            onChange={(value) => setDraft((current) => ({ ...current, visceralFatLevel: value }))}
          />
        </div>
      </details>
    </section>
  );
}

function DashboardView({
  entries,
  healthSummaries,
  profile,
}: {
  entries: RecompEntry[];
  healthSummaries: HealthDailySummary[];
  profile: UserProfile;
}) {
  const latest = entries[0];
  const previous = entries[1];
  const chartData = useMemo(() => chartRows(entries), [entries]);
  const fatDelta = latest && previous ? delta(latest.bodyFatPercent, previous.bodyFatPercent) : null;
  const bmiDelta = latest && previous ? delta(latest.bmi, previous.bmi) : null;
  const latestHealth = healthSummaries[0];

  if (!entries.length) {
    return <EmptyState title="No readings for this profile" text="Capture the first FAT% and BMI reading to unlock the dashboard." />;
  }

  return (
    <div className="view-stack">
      <section className="hero-panel dashboard-hero">
        <div>
          <span className="eyebrow">Current profile</span>
          <h2>{profile.name}</h2>
          <p>Last reading {formatDate(latest.capturedAt)}</p>
        </div>
        <Sparkles size={24} />
      </section>

      <section className="metric-grid">
        <MetricCard label="Body fat" value={display(latest.bodyFatPercent, '%')} delta={fatDelta} />
        <MetricCard label="BMI" value={display(latest.bmi)} delta={bmiDelta} />
        <MetricCard label="Weight" value={`${display(latest.weight)} ${latest.weightUnit}`} />
      </section>

      {latestHealth ? (
        <section className="panel watch-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Pixel Watch</span>
              <h2>Daily context</h2>
              <p>{formatHealthDay(latestHealth.day)} · Google Health summary</p>
            </div>
            <Watch size={23} />
          </div>
          <div className="metric-grid watch-grid">
            <MetricCard label="Steps" value={displayWhole(latestHealth.steps)} />
            <MetricCard label="Sleep" value={displayMinutes(latestHealth.sleepMinutes)} />
            <MetricCard label="Resting HR" value={displayUnit(latestHealth.restingHeartRateBpm, 'bpm')} />
            <MetricCard label="Zone minutes" value={displayWhole(latestHealth.activeZoneMinutes)} />
          </div>
          <p className="muted-note">
            {latestHealth.totalCaloriesKcal === null ? 'Calorie estimate unavailable' : `${latestHealth.totalCaloriesKcal.toLocaleString()} kcal estimated burn`}
            {latestHealth.hrvMs === null ? '' : ` · HRV ${latestHealth.hrvMs} ms`}
          </p>
        </section>
      ) : null}

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Trend line</h2>
            <p>Profile-scoped readings, oldest to newest.</p>
          </div>
        </div>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={240}>
            <ReLineChart data={chartData} margin={{ top: 8, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="#e4e8ec" strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
              <Tooltip />
              <Line type="monotone" dataKey="bodyFatPercent" name="Body fat %" stroke="#087f79" strokeWidth={2.8} dot={{ r: 3 }} connectNulls />
              <Line type="monotone" dataKey="bmi" name="BMI" stroke="#2667c9" strokeWidth={2.4} dot={{ r: 3 }} connectNulls />
            </ReLineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}

function LogView({
  entries,
  profile,
  onDelete,
  onSave,
}: {
  entries: RecompEntry[];
  profile: UserProfile;
  onDelete: (id: string) => void;
  onSave: (entry: RecompEntry) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const editing = entries.find((entry) => entry.id === editingId);
  const [draft, setDraft] = useState<EntryDraft>(() => emptyDraft(profile));
  const issues = validateDraft(draft);
  const visibleEntries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return entries;
    return entries.filter((entry) => [entry.notes, entry.profileName, formatDate(entry.capturedAt)].join(' ').toLowerCase().includes(normalized));
  }, [entries, query]);

  useEffect(() => {
    if (editing) setDraft(entryToDraft(editing));
  }, [editing]);

  if (!entries.length) {
    return <EmptyState title={`No ${profile.name} readings yet`} text="Capture or manually enter the first reading." />;
  }

  return (
    <div className="view-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>{profile.name} log</h2>
            <p>{entries.length} saved readings, newest first.</p>
          </div>
        </div>
        <label className="input-field compact-field">
          <span>Search notes</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="hydration, evening..." />
        </label>
      </section>

      {editing ? (
        <div className="edit-block">
          <ReadingForm draft={draft} setDraft={setDraft} issues={issues} title="Edit reading" mode="edit" />
          <div className="action-row">
            <button
              className="primary"
              type="button"
              onClick={() => {
                onSave(draftToEntry(withEstimatedRestingMetabolism(draft, profile), editing));
                setEditingId(null);
              }}
            >
              <CheckCircle2 size={18} /> Update
            </button>
            <button type="button" onClick={() => setEditingId(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <section className="log-list">
        {visibleEntries.map((entry) => (
          <article className="entry-row" key={entry.id}>
            <button type="button" className="entry-main" onClick={() => setEditingId(entry.id)}>
              <span>{formatDate(entry.capturedAt)}</span>
              <strong>BF {display(entry.bodyFatPercent, '%')} · BMI {display(entry.bmi)}</strong>
              <small>{display(entry.weight)} {entry.weightUnit} · {entry.source === 'ai' ? 'AI draft verified' : 'Manual'}{entry.notes ? ` · ${entry.notes}` : ''}</small>
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

function ProfilesView({
  activeProfileId,
  entries,
  profiles,
  onAddProfile,
  onDeleteProfile,
  onProfileChange,
  onProfileSave,
}: {
  activeProfileId: string;
  entries: RecompEntry[];
  profiles: UserProfile[];
  onAddProfile: () => void;
  onDeleteProfile: (profileId: string) => void;
  onProfileChange: (profileId: string) => void;
  onProfileSave: (profile: UserProfile) => void;
}) {
  const [editingId, setEditingId] = useState(activeProfileId);
  const editingProfile = profiles.find((profile) => profile.id === editingId) ?? profiles[0];

  useEffect(() => setEditingId(activeProfileId), [activeProfileId]);

  return (
    <div className="view-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Profiles</h2>
            <p>Switch people before logging. Each dashboard and log is profile-scoped.</p>
          </div>
          <button className="icon-button" type="button" aria-label="Add profile" onClick={onAddProfile}>
            <CirclePlus size={20} />
          </button>
        </div>

        <div className="profile-list">
          {profiles.map((profile) => {
            const count = entriesForProfile(entries, profile.id, profiles.length).length;
            return (
              <button
                key={profile.id}
                type="button"
                className={`profile-card ${profile.id === activeProfileId ? 'active' : ''}`}
                onClick={() => {
                  onProfileChange(profile.id);
                  setEditingId(profile.id);
                }}
              >
                <span>{initials(profile.name)}</span>
                <strong>{profile.name}</strong>
                <small>{count} readings · {profileSummary(profile)}</small>
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Edit profile</h2>
            <p>Stable values are automatically applied to future readings.</p>
          </div>
        </div>
        <ProfileForm
          profile={editingProfile}
          onDelete={() => onDeleteProfile(editingProfile.id)}
          onSave={(profile) => {
            onProfileSave(profile);
            setEditingId(profile.id);
          }}
          canDelete={profiles.length > 1}
        />
      </section>
    </div>
  );
}

function ProfileForm({
  canDelete,
  onDelete,
  onSave,
  profile,
}: {
  canDelete: boolean;
  onDelete: () => void;
  onSave: (profile: UserProfile) => void;
  profile: UserProfile;
}) {
  const [draft, setDraft] = useState(profile);
  const estimatedRestingMetabolism = estimateRestingMetabolismKcal(draft);

  useEffect(() => setDraft(profile), [profile]);

  const update = (patch: Partial<UserProfile>) => setDraft((current) => ({ ...current, ...patch }));

  return (
    <div className="profile-form">
      <label className="input-field">
        <span>Name</span>
        <input value={draft.name} onChange={(event) => update({ name: event.target.value })} />
      </label>

      <div className="segmented compact-segmented" role="group" aria-label="Sex">
        {(['unspecified', 'female', 'male', 'other'] as ProfileSex[]).map((sex) => (
          <button key={sex} type="button" className={draft.sex === sex ? 'active' : ''} onClick={() => update({ sex })}>
            {sex === 'unspecified' ? 'Skip' : sex}
          </button>
        ))}
      </div>

      <div className="segmented" role="group" aria-label="Weight unit">
        {(['lb', 'kg'] as const).map((unit) => (
          <button key={unit} type="button" className={draft.weightUnit === unit ? 'active' : ''} onClick={() => update({ weightUnit: unit })}>
            {unit}
          </button>
        ))}
      </div>

      <div className="segmented" role="group" aria-label="Height unit">
        {(['in', 'cm'] as const).map((unit) => (
          <button key={unit} type="button" className={draft.heightUnit === unit ? 'active' : ''} onClick={() => update({ heightUnit: unit })}>
            {unit}
          </button>
        ))}
      </div>

      <div className="field-grid">
        {profileFields.map((field) => (
          <label key={field.key} className="input-field">
            <span>{field.label}</span>
            <div className="input-with-suffix">
              <input
                inputMode="decimal"
                placeholder={field.key === 'restingMetabolismKcal' ? 'Requires male/female + details' : undefined}
                readOnly={field.key === 'restingMetabolismKcal'}
                step={field.step}
                type="number"
                value={
                  field.key === 'restingMetabolismKcal'
                    ? estimatedRestingMetabolism ?? ''
                    : draft[field.key]
                }
                onChange={(event) => update({ [field.key]: event.target.value })}
              />
              {profileSuffix(field.key, draft, field.suffix) ? <em>{profileSuffix(field.key, draft, field.suffix)}</em> : null}
            </div>
          </label>
        ))}
      </div>

      <label className="input-field">
        <span>Baseline notes</span>
        <textarea rows={3} value={draft.baselineNotes} onChange={(event) => update({ baselineNotes: event.target.value })} />
      </label>

      <div className="action-row">
        <button
          className="primary"
          type="button"
          onClick={() =>
            onSave({
              ...draft,
              name: draft.name.trim() || 'Unnamed profile',
              restingMetabolismKcal:
                estimatedRestingMetabolism === null ? '' : String(estimatedRestingMetabolism),
            })
          }
        >
          <Save size={18} /> Save profile
        </button>
        <button className="danger subtle" type="button" disabled={!canDelete} onClick={onDelete}>
          <Trash2 size={18} /> Delete
        </button>
      </div>
    </div>
  );
}

function SettingsView({
  accessKey,
  entries,
  health,
  healthMessage,
  healthRequestStatus,
  profiles,
  profile,
  onAccessKeyChange,
  onConnectHealth,
  onDisconnectHealth,
  onImport,
  onSync,
  onSyncHealth,
  syncMessage,
  syncStatus,
}: {
  accessKey: string;
  entries: RecompEntry[];
  health: GoogleHealthStatus;
  healthMessage: string;
  healthRequestStatus: HealthRequestStatus;
  profiles: UserProfile[];
  profile: UserProfile;
  onAccessKeyChange: (value: string) => void;
  onConnectHealth: () => void;
  onDisconnectHealth: () => void;
  onImport: (entries: RecompEntry[], profiles: UserProfile[]) => void;
  onSync: () => void;
  onSyncHealth: () => void;
  syncMessage: string;
  syncStatus: SyncStatus;
}) {
  const [message, setMessage] = useState('');

  const importFile = async (file: File | null) => {
    if (!file) return;
    try {
      const imported = parseBackup(await file.text());
      onImport(imported.entries, imported.profiles);
      setMessage(`Imported ${imported.entries.length} entries${imported.profiles.length ? ` and ${imported.profiles.length} profiles` : ''}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Import failed');
    }
  };

  return (
    <div className="view-stack">
      <section className="panel health-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Wearable connection</span>
            <h2>Google Health</h2>
            <p>Read-only Pixel Watch summaries for {profile.name}.</p>
          </div>
          <div className={`connection-badge ${health.connected ? 'connected' : ''}`}>
            <HeartPulse size={17} />
            {health.connected ? 'Connected' : 'Not connected'}
          </div>
        </div>

        {health.connected ? (
          <>
            <div className="health-summary-row">
              <div>
                <span>Latest watch day</span>
                <strong>{health.summaries[0] ? formatHealthDay(health.summaries[0].day) : 'Not synced yet'}</strong>
              </div>
              <div>
                <span>Last sync</span>
                <strong>{health.lastSyncedAt ? formatDateTime(health.lastSyncedAt) : 'Ready to sync'}</strong>
              </div>
            </div>
            <div className="action-row">
              <button className="primary" type="button" disabled={healthRequestStatus === 'syncing'} onClick={onSyncHealth}>
                <RefreshCw size={18} /> {healthRequestStatus === 'syncing' ? 'Syncing…' : 'Sync watch'}
              </button>
              <button type="button" disabled={healthRequestStatus === 'loading'} onClick={onDisconnectHealth}>
                <Unplug size={18} /> Disconnect
              </button>
            </div>
          </>
        ) : (
          <button
            className="primary health-connect-button"
            type="button"
            disabled={!accessKey.trim() || healthRequestStatus === 'loading'}
            onClick={onConnectHealth}
          >
            <Link2 size={18} /> {healthRequestStatus === 'loading' ? 'Preparing…' : 'Connect Google Health'}
          </button>
        )}
        <p className={`muted-note ${healthRequestStatus === 'error' ? 'error-note' : ''}`}>
          {healthMessage || (accessKey.trim()
            ? 'Imports steps, sleep, activity, estimated calories, resting heart rate, and HRV.'
            : 'Enter the cloud access key below before connecting.')}
        </p>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Backup</h2>
            <p>{entries.length} readings and {profiles.length} profiles are cached in this browser.</p>
          </div>
        </div>
        <div className="settings-actions">
          <button type="button" onClick={() => downloadFile('recomptrack-backup.json', exportJson(entries, profiles), 'application/json')}>
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
        {message ? <p className="muted-note">{message}</p> : null}
      </section>

      <section className="panel quiet">
        <div className="section-heading">
          <div>
            <h2>Cloud sync</h2>
            <p>Use the same access key on every device to share profiles and readings.</p>
          </div>
          {syncStatus === 'error' || syncStatus === 'local' ? <CloudOff size={22} /> : <Cloud size={22} />}
        </div>
        <label className="input-field access-key-field">
          <span>App access key</span>
          <input
            type="password"
            value={accessKey}
            onChange={(event) => onAccessKeyChange(event.target.value)}
            placeholder="Required for private sync"
          />
        </label>
        <div className="action-row">
          <button type="button" disabled={syncStatus === 'syncing'} onClick={onSync}>
            <RefreshCw size={18} /> {syncStatus === 'syncing' ? 'Syncing…' : 'Sync now'}
          </button>
          <p className="muted-note">{syncMessage}</p>
        </div>
      </section>

      <section className="panel quiet">
        <h2>Local-first privacy</h2>
        <p>Profiles, logs, and notes remain available locally when offline. Photos are used for extraction and are not stored.</p>
      </section>
    </div>
  );
}

function NumberField({
  confidence,
  field,
  label,
  onChange,
  step = '0.1',
  suffix,
  value,
  warnings,
}: {
  confidence?: number;
  field: MeasurementField;
  label: string;
  onChange: (value: string) => void;
  step?: string;
  suffix?: string;
  value: string;
  warnings: string[];
}) {
  return (
    <label className={`input-field ${warnings.length ? 'warn' : ''}`}>
      <span>
        {label}
        {confidence !== undefined ? <small>{Math.round(confidence * 100)}%</small> : null}
      </span>
      <div className="input-with-suffix">
        <input inputMode="decimal" step={step} type="number" value={value} onChange={(event) => onChange(event.target.value)} />
        {suffix ? <em>{suffix}</em> : null}
      </div>
      {warnings.length ? <strong>{warnings.join(' · ')}</strong> : null}
    </label>
  );
}

function MetricCard({ delta: deltaValue, label, value }: { delta?: number | null; label: string; value: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {deltaValue !== undefined && deltaValue !== null ? (
        <small className={deltaValue <= 0 ? 'good' : 'watch'}>{deltaValue > 0 ? '+' : ''}{deltaValue.toFixed(1)} since last</small>
      ) : (
        <small>Waiting for comparison</small>
      )}
    </article>
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

const entriesForProfile = (entries: RecompEntry[], profileId: string | null | undefined, profileCount: number) =>
  entries.filter((entry) => entry.profileId === profileId || (!entry.profileId && profileCount === 1));

const mergeEntries = (current: RecompEntry[], imported: RecompEntry[]) =>
  sortEntries([...imported, ...current.filter((entry) => !imported.some((item) => item.id === entry.id))]);

const mergeProfiles = (current: UserProfile[], imported: UserProfile[]) => [
  ...imported,
  ...current.filter((profile) => !imported.some((item) => item.id === profile.id)),
];

const chartRows = (entries: RecompEntry[]) =>
  [...entries].reverse().map((entry) => ({
    date: new Date(entry.capturedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    bodyFatPercent: entry.bodyFatPercent,
    bmi: entry.bmi,
    weight: entry.weight,
  }));

const formatHealthDay = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const displayWhole = (value: number | null) => value === null ? '—' : Math.round(value).toLocaleString();

const displayUnit = (value: number | null, unit: string) => value === null ? '—' : `${Math.round(value)} ${unit}`;

const displayMinutes = (value: number | null) => {
  if (value === null) return '—';
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${hours}h ${minutes}m`;
};

const profileSummary = (profile: UserProfile) => {
  const parts = [
    profile.weight ? `${profile.weight} ${profile.weightUnit}` : '',
    profile.ageYears ? `${profile.ageYears} years` : '',
    profile.height ? `${profile.height} ${profile.heightUnit}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Profile values not set';
};

const profileSuffix = (field: ProfileField, profile: UserProfile, fallback?: string) => {
  if (field === 'weight') return profile.weightUnit;
  if (field === 'height') return profile.heightUnit;
  return fallback;
};

const withEstimatedRestingMetabolism = (draft: EntryDraft, profile: UserProfile): EntryDraft => {
  const estimate = estimateRestingMetabolismKcal({
    ...profile,
    ageYears: draft.bodyAgeYears,
    weight: draft.weight,
    weightUnit: draft.weightUnit,
  });

  return {
    ...draft,
    restingMetabolismKcal: estimate === null ? '' : String(estimate),
  };
};

const delta = (current: number | null, previous: number | null) => {
  if (current === null || previous === null) return null;
  return current - previous;
};

const valueToInput = (value: number | string | null | undefined) =>
  value === null || value === undefined ? '' : String(value);

const readableError = async (response: Response) => {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: string; detail?: string };
    return parsed.detail || parsed.error || `Extraction failed (${response.status})`;
  } catch {
    return text || `Extraction failed (${response.status})`;
  }
};

const display = (value: number | null, suffix = '') => (value === null ? '-' : `${value}${suffix}`);

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'P';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
