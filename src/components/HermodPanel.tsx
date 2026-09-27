import { useState, useEffect, useCallback, useRef } from 'react';
import type { HermodJob, HermodDraft, HermodStatus } from '../types.ts';
import { Mail, Clock, Send, X, Trash2, RotateCw, Eye, EyeOff, Upload, AlertTriangle, CheckCircle2, FileText } from 'lucide-react';

const TZ = 'Europe/Paris';
const STATUS: Record<HermodStatus, string> = {
    pending: 'Programmé',
    sending: 'Envoi…',
    sent: 'Envoyé',
    failed: 'Échec',
    cancelled: 'Annulé',
};

const fmt = (ms: number) => new Date(ms).toLocaleString('fr-FR', {
    timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

function relative(ms: number) {
    const d = ms - Date.now();
    if (d <= 0) return 'maintenant';
    const m = Math.round(d / 60000);
    if (m < 1) return "dans moins d'une minute";
    if (m < 60) return `dans ${m} min`;
    const h = Math.floor(m / 60);
    if (h < 48) return `dans ${h} h ${String(m % 60).padStart(2, '0')}`;
    return `dans ${Math.floor(h / 24)} j ${h % 24} h`;
}

// Valeur <input type="datetime-local"> ↔ horodatage (heure locale du navigateur, donc Paris)
const toInput = (ms: number) => {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromInput = (v: string) => (v ? new Date(v).getTime() : NaN);

function tomorrowTen() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    return d.getTime();
}

const EMPTY: HermodDraft = {
    prenom: '', email: '', service: '', url: '', identifiant: '', password: '', duration: '24h', subject: '', sendAt: 0,
};

// --- CSV (même format que branding/templates/users.csv, + colonne email) ---

function parseCsv(text: string): string[][] {
    const firstLine = text.split(/\r?\n/)[0] || '';
    const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
            else if (c === '"') quoted = false;
            else cell += c;
        } else if (c === '"') quoted = true;
        else if (c === sep) { row.push(cell); cell = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(cell); cell = '';
            if (row.some(x => x.trim())) rows.push(row);
            row = [];
        } else cell += c;
    }
    row.push(cell);
    if (row.some(x => x.trim())) rows.push(row);
    return rows;
}

const CSV_ALIASES: Record<string, keyof HermodDraft> = {
    prenom: 'prenom', prénom: 'prenom', email: 'email', mail: 'email', courriel: 'email',
    service: 'service', url: 'url', identifiant: 'identifiant', login: 'identifiant',
    password: 'password', motdepasse: 'password', mdp: 'password', expiration: 'duration', duree: 'duration', durée: 'duration',
    objet: 'subject', subject: 'subject',
};

interface CsvRow { draft: HermodDraft; errors: string[] }

function csvToDrafts(text: string, durations: Record<string, string>): { rows: CsvRow[]; missing: string[] } {
    const [header, ...lines] = parseCsv(text.replace(/^﻿/, ''));
    const cols = (header || []).map(h => CSV_ALIASES[h.trim().toLowerCase().replace(/[\s_-]/g, '')]);
    const missing = (['prenom', 'email', 'service', 'url', 'identifiant', 'password'] as const).filter(k => !cols.includes(k));
    const rows = lines.map(cells => {
        const draft: HermodDraft = { ...EMPTY };
        cols.forEach((k, i) => { if (k && k !== 'sendAt') (draft as unknown as Record<string, string>)[k] = (cells[i] ?? '').trim(); });
        if (!draft.duration) draft.duration = '24h';
        const errors: string[] = [];
        if (!draft.prenom) errors.push('prénom');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email)) errors.push('email');
        if (!draft.service) errors.push('service');
        if (!/^https?:\/\//i.test(draft.url)) errors.push('url');
        if (!draft.identifiant) errors.push('identifiant');
        if (!draft.password) errors.push('mot de passe');
        if (!durations[draft.duration]) errors.push(`expiration « ${draft.duration} »`);
        return { draft, errors };
    });
    return { rows, missing };
}

export default function HermodPanel() {
    const [jobs, setJobs] = useState<HermodJob[]>([]);
    const [durations, setDurations] = useState<Record<string, string>>({ '24h': '24 heures' });
    const [sender, setSender] = useState('');
    const [configured, setConfigured] = useState(true);
    const [draft, setDraft] = useState<HermodDraft>({ ...EMPTY, sendAt: tomorrowTen() });
    const [showPwd, setShowPwd] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [preview, setPreview] = useState<string | null>(null);
    const [csv, setCsv] = useState<{ name: string; rows: CsvRow[]; missing: string[] } | null>(null);
    const [csvAt, setCsvAt] = useState(tomorrowTen());
    const [, setNow] = useState(0);
    const fileRef = useRef<HTMLInputElement>(null);

    const load = useCallback(() => {
        fetch('/api/admin/hermod').then(r => r.json()).then(d => {
            setJobs(d.jobs || []);
            setDurations(d.durations || {});
            setSender(d.sender || '');
            setConfigured(!!d.configured);
        });
    }, []);

    useEffect(() => {
        load();
        const iv = setInterval(() => { load(); setNow(Date.now()); }, 10000);
        return () => clearInterval(iv);
    }, [load]);

    async function post(url: string, body?: unknown) {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || r.statusText);
        return d;
    }

    function set<K extends keyof HermodDraft>(k: K, v: HermodDraft[K]) {
        setDraft(d => ({ ...d, [k]: v }));
    }

    async function schedule() {
        setSaving(true); setError(''); setNotice('');
        try {
            await post('/api/admin/hermod/jobs', { jobs: [draft] });
            setNotice(`Envoi programmé pour ${draft.prenom} le ${fmt(draft.sendAt)}.`);
            setDraft({ ...EMPTY, sendAt: draft.sendAt, service: draft.service, url: draft.url, duration: draft.duration });
            load();
        } catch (e) { setError((e as Error).message); }
        setSaving(false);
    }

    async function scheduleCsv() {
        if (!csv) return;
        setSaving(true); setError(''); setNotice('');
        try {
            const batch = `${csv.name} (${fmt(csvAt)})`;
            await post('/api/admin/hermod/jobs', { jobs: csv.rows.map(r => ({ ...r.draft, sendAt: csvAt, batch })) });
            setNotice(`${csv.rows.length} envois programmés pour le ${fmt(csvAt)}.`);
            setCsv(null);
            load();
        } catch (e) { setError((e as Error).message); }
        setSaving(false);
    }

    async function act(job: HermodJob, what: 'cancel' | 'send-now' | 'retry' | 'delete') {
        const ask = {
            cancel: `Annuler l'envoi à ${job.prenom} ? Le mot de passe stocké sera effacé.`,
            'send-now': `Envoyer maintenant à ${job.prenom} (${job.email}) ?`,
            retry: `Relancer l'envoi à ${job.prenom} ?`,
            delete: `Retirer cet envoi de l'historique ?`,
        }[what];
        if (!confirm(ask)) return;
        try { await post(`/api/admin/hermod/jobs/${job.id}/${what}`); load(); }
        catch (e) { alert((e as Error).message); }
    }

    async function showPreview(d: Partial<HermodDraft>) {
        const r = await fetch('/api/admin/hermod/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
        setPreview(await r.text());
    }

    function onFile(f: File | undefined) {
        if (!f) return;
        f.text().then(t => setCsv({ name: f.name, ...csvToDrafts(t, durations) }));
    }

    const upcoming = jobs.filter(j => j.status === 'pending' || j.status === 'sending');
    const history = jobs.filter(j => j.status !== 'pending' && j.status !== 'sending').sort((a, b) => (b.sentAt || b.sendAt) - (a.sentAt || a.sendAt));
    const draftOk = draft.prenom && draft.email && draft.service && draft.url && draft.identifiant && draft.password && Number.isFinite(draft.sendAt);
    const csvOk = csv && !csv.missing.length && csv.rows.length > 0 && csv.rows.every(r => !r.errors.length);

    return (
        <>
            {!configured && (
                <div className="sp-alert">
                    <AlertTriangle size={14} />
                    <div>L'expéditeur n'est pas configuré (<code>HERMOD_SMTP_PASS</code>) : les envois échoueront.</div>
                </div>
            )}

            <div className="section" style={{ animationDelay: '.05s' }}>
                <div className="section-header">
                    <Mail size={14} />
                    Programmer un mail d'accès
                </div>
                <div className="hm-card">
                    <p className="le-hint" style={{ marginBottom: 12 }}>
                        Envoyé depuis <b>{sender}</b>. Le lien Whisper (lecture unique) est créé <b>au moment de l'envoi</b> :
                        sa durée de vie part de là. Copie rangée dans « Envoyés ».
                    </p>
                    <div className="hm-grid">
                        <HField label="Prénom" value={draft.prenom} onChange={v => set('prenom', v)} />
                        <HField label="Email" value={draft.email} onChange={v => set('email', v)} placeholder="prenom@exemple.fr" />
                        <HField label="Service" value={draft.service} onChange={v => set('service', v)} placeholder="Yggdrasil" />
                        <HField label="Adresse du service" value={draft.url} onChange={v => set('url', v)} placeholder="https://yggdrasil.lucipher-lab.fr" />
                        <HField label="Identifiant" value={draft.identifiant} onChange={v => set('identifiant', v)} />
                        <label className="ve-field">
                            <span className="le-label">Mot de passe</span>
                            <div className="hm-pwd">
                                <input type={showPwd ? 'text' : 'password'} value={draft.password} autoComplete="new-password"
                                    onChange={e => set('password', e.target.value)} />
                                <button type="button" className="le-icon-btn" onClick={() => setShowPwd(s => !s)} title={showPwd ? 'Masquer' : 'Afficher'}>
                                    {showPwd ? <EyeOff size={12} /> : <Eye size={12} />}
                                </button>
                            </div>
                        </label>
                        <label className="ve-field">
                            <span className="le-label">Envoi le (heure de Paris)</span>
                            <input type="datetime-local" value={toInput(draft.sendAt)} onChange={e => set('sendAt', fromInput(e.target.value))} />
                        </label>
                        <label className="ve-field">
                            <span className="le-label">Le lien expire après</span>
                            <select value={draft.duration} onChange={e => set('duration', e.target.value)}>
                                {Object.entries(durations).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                        </label>
                    </div>
                    <HField label="Objet (facultatif)" value={draft.subject} onChange={v => set('subject', v)}
                        placeholder={`Vos accès à ${draft.service || '…'}`} />
                    {Number.isFinite(draft.sendAt) && (
                        <p className="le-hint" style={{ marginTop: 8 }}>
                            Envoi {fmt(draft.sendAt)} ({relative(draft.sendAt)}) → lien valable jusqu'au{' '}
                            {fmt(draft.sendAt + ({ '5m': 5, '30m': 30, '1h': 60, '24h': 1440, '7d': 10080 }[draft.duration] || 1440) * 60000)}
                        </p>
                    )}
                    {error && <p className="le-error" style={{ marginTop: 8 }}>{error}</p>}
                    {notice && <p className="hm-ok"><CheckCircle2 size={12} /> {notice}</p>}
                    <div className="hm-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => showPreview(draft)}><FileText size={12} /> Aperçu</button>
                        <button className="btn btn-primary btn-sm" disabled={!draftOk || saving} onClick={schedule}>
                            <Clock size={12} /> {saving ? '…' : 'Programmer'}
                        </button>
                    </div>
                </div>

                <div className="hm-card">
                    <div className="hm-csv-head">
                        <span className="le-label" style={{ margin: 0 }}>Import CSV (plusieurs personnes)</span>
                        <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}><Upload size={12} /> Choisir un fichier</button>
                        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={e => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
                    </div>
                    <p className="le-hint">Colonnes : prenom, email, service, url, identifiant, password, expiration (facultative, 24h par défaut). Séparateur , ou ;</p>
                    {csv && (
                        <>
                            {csv.missing.length > 0 && <p className="le-error">Colonnes manquantes : {csv.missing.join(', ')}</p>}
                            <div className="hm-table-wrap">
                                <table className="hm-table">
                                    <thead><tr><th>Prénom</th><th>Email</th><th>Service</th><th>Identifiant</th><th>Mot de passe</th><th>Lien</th><th></th></tr></thead>
                                    <tbody>
                                        {csv.rows.map((r, i) => (
                                            <tr key={i} className={r.errors.length ? 'hm-bad' : ''}>
                                                <td>{r.draft.prenom}</td><td>{r.draft.email}</td><td>{r.draft.service}</td><td>{r.draft.identifiant}</td>
                                                <td>{r.draft.password ? '••••••' : ''}</td><td>{durations[r.draft.duration] || r.draft.duration}</td>
                                                <td>{r.errors.length ? `à corriger : ${r.errors.join(', ')}` : '✓'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="hm-actions">
                                <label className="ve-field" style={{ flex: '0 1 240px' }}>
                                    <span className="le-label">Envoi de tous le (heure de Paris)</span>
                                    <input type="datetime-local" value={toInput(csvAt)} onChange={e => setCsvAt(fromInput(e.target.value))} />
                                </label>
                                <button className="btn btn-ghost btn-sm" onClick={() => setCsv(null)}>Annuler</button>
                                <button className="btn btn-primary btn-sm" disabled={!csvOk || saving || !Number.isFinite(csvAt)} onClick={scheduleCsv}>
                                    <Clock size={12} /> Programmer {csv.rows.length} envoi{csv.rows.length > 1 ? 's' : ''}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            <div className="section" style={{ animationDelay: '.1s' }}>
                <div className="section-header">
                    <Clock size={14} />
                    À venir ({upcoming.length})
                </div>
                {upcoming.length === 0 ? <p className="le-hint">Aucun envoi programmé.</p> : (
                    <div className="hm-list">{upcoming.map(j => <JobRow key={j.id} job={j} durations={durations} onAct={act} onPreview={showPreview} />)}</div>
                )}
            </div>

            <div className="section" style={{ animationDelay: '.15s' }}>
                <div className="section-header">
                    <Send size={14} />
                    Historique
                </div>
                {history.length === 0 ? <p className="le-hint">Rien pour l'instant.</p> : (
                    <div className="hm-list">{history.map(j => <JobRow key={j.id} job={j} durations={durations} onAct={act} onPreview={showPreview} />)}</div>
                )}
            </div>

            {preview !== null && (
                <div className="modal-overlay" onClick={() => setPreview(null)}>
                    <div className="hm-preview" onClick={e => e.stopPropagation()}>
                        <div className="hm-preview-bar">
                            <span>Aperçu (lien Whisper factice)</span>
                            <button className="le-icon-btn" onClick={() => setPreview(null)}><X size={12} /></button>
                        </div>
                        <iframe title="Aperçu du mail" sandbox="" srcDoc={preview} />
                    </div>
                </div>
            )}
        </>
    );
}

function HField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
    return (
        <label className="ve-field">
            <span className="le-label">{label}</span>
            <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
        </label>
    );
}

function JobRow({ job, durations, onAct, onPreview }: {
    job: HermodJob;
    durations: Record<string, string>;
    onAct: (j: HermodJob, what: 'cancel' | 'send-now' | 'retry' | 'delete') => void;
    onPreview: (d: Partial<HermodDraft>) => void;
}) {
    return (
        <div className={`hm-job hm-${job.status}`}>
            <div className="hm-job-main">
                <div className="hm-job-top">
                    <span className={`hm-status hm-status-${job.status}`}>{STATUS[job.status]}</span>
                    <b>{job.prenom}</b>
                    <span className="hm-dim">{job.email}</span>
                </div>
                <div className="hm-dim">
                    {job.service} · identifiant {job.identifiant} · lien {durations[job.duration] || job.duration}
                    {job.batch && <> · lot {job.batch}</>}
                </div>
                <div className="hm-when">
                    {job.status === 'sent' && job.sentAt
                        ? <>Envoyé {fmt(job.sentAt)}{job.whisperExpiresAt ? <> · lien valable jusqu'au {fmt(job.whisperExpiresAt)}</> : null}{job.sentFolder ? <> · copie dans « {job.sentFolder} »</> : null}</>
                        : <>Prévu {fmt(job.sendAt)}{job.status === 'pending' ? ` (${relative(job.sendAt)})` : ''}</>}
                </div>
                {job.error && <div className="le-error">{job.error}</div>}
                {job.warning && <div className="hm-warn">{job.warning}</div>}
            </div>
            <div className="hm-job-actions">
                <button className="le-icon-btn" title="Aperçu" onClick={() => onPreview(job)}><FileText size={12} /></button>
                {job.status === 'pending' && <>
                    <button className="le-icon-btn" title="Envoyer maintenant" onClick={() => onAct(job, 'send-now')}><Send size={12} /></button>
                    <button className="le-icon-btn" title="Annuler" onClick={() => onAct(job, 'cancel')}><X size={12} /></button>
                </>}
                {job.status === 'failed' && job.hasPassword && (
                    <button className="le-icon-btn" title="Relancer" onClick={() => onAct(job, 'retry')}><RotateCw size={12} /></button>
                )}
                {(job.status === 'sent' || job.status === 'failed' || job.status === 'cancelled') && (
                    <button className="le-icon-btn" title="Retirer de l'historique" onClick={() => onAct(job, 'delete')}><Trash2 size={12} /></button>
                )}
            </div>
        </div>
    );
}
