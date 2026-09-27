import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { HermodJob, HermodInfo, HermodStatus, HermodTemplate, HermodField } from '../types.ts';
import {
    Mail, Clock, Send, X, Trash2, RotateCw, Upload, AlertTriangle, CheckCircle2, FileText, Plus, Pencil, Copy, Lock, Eye, EyeOff, Users,
} from 'lucide-react';

const TZ = 'Europe/Paris';
const STATUS: Record<HermodStatus, string> = { pending: 'Programmé', sending: 'Envoi…', sent: 'Envoyé', failed: 'Échec', cancelled: 'Annulé' };
const DURATION_MIN: Record<string, number> = { '5m': 5, '30m': 30, '1h': 60, '24h': 1440, '7d': 10080 };
const VAR_RE = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g;

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

// <input type="datetime-local"> ↔ horodatage (heure locale du navigateur, donc Paris)
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

const varsOf = (subject: string, html: string) => [...new Set([...`${subject}\n${html}`.matchAll(VAR_RE)].map(m => m[1]))];
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// --- CSV (facultatif : pré-remplit le tableau) ---

function parseCsv(text: string): string[][] {
    const first = text.split(/\r?\n/)[0] || '';
    const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
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

interface Recipient { email: string; values: Record<string, string>; }
const emptyRow = (): Recipient => ({ email: '', values: {} });

export default function HermodPanel() {
    const [info, setInfo] = useState<HermodInfo | null>(null);
    const [from, setFrom] = useState('');
    const [fromName, setFromName] = useState('');
    const [templateId, setTemplateId] = useState('');
    const [sendAt, setSendAt] = useState(tomorrowTen());
    const [duration, setDuration] = useState('24h');
    const [rows, setRows] = useState<Recipient[]>([emptyRow()]);
    const [reveal, setReveal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
    const [editing, setEditing] = useState<Partial<HermodTemplate> | null>(null);
    const [, setTick] = useState(0);
    const fileRef = useRef<HTMLInputElement>(null);

    const load = useCallback(() => {
        fetch('/api/admin/hermod').then(r => r.json()).then((d: HermodInfo) => {
            setInfo(d);
            setFrom(f => f || d.senders[0] || '');
            setFromName(n => n || d.fromName);
            setTemplateId(t => (t && d.templates.some(x => x.id === t) ? t : d.templates[0]?.id || ''));
        });
    }, []);

    useEffect(() => {
        load();
        const iv = setInterval(() => { load(); setTick(t => t + 1); }, 10000);
        return () => clearInterval(iv);
    }, [load]);

    const tpl = info?.templates.find(t => t.id === templateId);
    const fields = useMemo(() => Object.entries(tpl?.fields || {}) as [string, HermodField][], [tpl]);
    const hasWhisper = fields.some(([, f]) => f.type === 'whisper');

    async function post(url: string, body?: unknown) {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || r.statusText);
        return d;
    }

    function setCell(i: number, name: string, value: string) {
        setRows(rs => rs.map((r, j) => (j !== i ? r : name === '@email' ? { ...r, email: value } : { ...r, values: { ...r.values, [name]: value } })));
    }

    const filled = rows.filter(r => r.email.trim() || Object.values(r.values).some(v => v.trim()));
    const rowOk = (r: Recipient) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email.trim()) && fields.every(([n]) => (r.values[n] || '').trim());
    const ready = !!tpl && !!from && Number.isFinite(sendAt) && filled.length > 0 && filled.every(rowOk);

    async function schedule() {
        setSaving(true); setError(''); setNotice('');
        try {
            const d = await post('/api/admin/hermod/schedule', {
                from, fromName, templateId, sendAt, duration,
                batch: filled.length > 1 ? `${tpl?.name} · ${fmt(sendAt)}` : '',
                recipients: filled.map(r => ({ email: r.email.trim(), values: r.values })),
            });
            setNotice(`${d.jobs.length} envoi${d.jobs.length > 1 ? 's' : ''} programmé${d.jobs.length > 1 ? 's' : ''} pour le ${fmt(sendAt)}.`);
            setRows([emptyRow()]);
            load();
        } catch (e) { setError((e as Error).message); }
        setSaving(false);
    }

    async function act(job: HermodJob, what: 'cancel' | 'send-now' | 'retry' | 'delete') {
        const ask = {
            cancel: `Annuler l'envoi à ${job.to} ? Les valeurs secrètes stockées seront effacées.`,
            'send-now': `Envoyer maintenant à ${job.to} ?`,
            retry: `Relancer l'envoi à ${job.to} ?`,
            delete: "Retirer cet envoi de l'historique ?",
        }[what];
        if (!confirm(ask)) return;
        try { await post(`/api/admin/hermod/jobs/${job.id}/${what}`); load(); }
        catch (e) { alert((e as Error).message); }
    }

    async function showPreview(values?: Record<string, string>) {
        const sample = values || filled[0]?.values || Object.fromEntries(fields.map(([n, f]) => [n, `[${f.label}]`]));
        setPreview(await post('/api/admin/hermod/preview', { templateId, values: sample, duration, sendAt }));
    }

    // CSV facultatif : colonnes reconnues par nom de champ ou libellé (+ « email »)
    function importCsv(file: File | undefined) {
        if (!file) return;
        file.text().then(text => {
            const [header, ...lines] = parseCsv(text.replace(/^﻿/, ''));
            const map = (header || []).map(h => {
                const k = norm(h);
                if (['email', 'mail', 'courriel', 'destinataire'].includes(k)) return '@email';
                const hit = fields.find(([n, f]) => norm(n) === k || norm(f.label) === k);
                return hit ? hit[0] : null;
            });
            if (!map.includes('@email')) { setError('CSV : colonne « email » introuvable.'); return; }
            const imported = lines.map(cells => {
                const r = emptyRow();
                map.forEach((k, i) => {
                    if (k === '@email') r.email = (cells[i] || '').trim();
                    else if (k) r.values[k] = (cells[i] || '').trim();
                });
                return r;
            });
            setRows(rs => [...rs.filter(r => r.email.trim() || Object.values(r.values).some(v => v.trim())), ...imported]);
            const unknown = (header || []).filter((_, i) => !map[i]);
            setNotice(`${imported.length} destinataire(s) ajouté(s) depuis ${file.name}${unknown.length ? ` — colonnes ignorées : ${unknown.join(', ')}` : ''}.`);
        });
    }

    async function deleteTemplate(t: HermodTemplate) {
        if (!confirm(`Supprimer le modèle « ${t.name} » ? Les envois déjà programmés avec lui partiront quand même.`)) return;
        try { await post(`/api/admin/hermod/templates/${t.id}/delete`); load(); }
        catch (e) { alert((e as Error).message); }
    }

    if (!info) return <p className="le-hint">Chargement…</p>;

    const upcoming = info.jobs.filter(j => j.status === 'pending' || j.status === 'sending');
    const history = info.jobs.filter(j => j.status !== 'pending' && j.status !== 'sending')
        .sort((a, b) => (b.sentAt || b.sendAt) - (a.sentAt || a.sendAt));

    return (
        <>
            {!info.senders.length && (
                <div className="sp-alert">
                    <AlertTriangle size={14} />
                    <div>Aucun expéditeur configuré (jetons Mailu <code>HERMOD_SMTP_PASS</code> / <code>HERMOD_ACCOUNTS</code>).</div>
                </div>
            )}

            {/* --- Nouvel envoi --- */}
            <div className="section" style={{ animationDelay: '.05s' }}>
                <div className="section-header"><Mail size={14} /> Nouvel envoi</div>
                <div className="hm-card">
                    <div className="hm-grid hm-grid-3">
                        <label className="ve-field">
                            <span className="le-label">Expéditeur</span>
                            <select value={from} onChange={e => setFrom(e.target.value)}>
                                {info.senders.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </label>
                        <HField label="Nom affiché" value={fromName} onChange={setFromName} />
                        <label className="ve-field">
                            <span className="le-label">Modèle</span>
                            <select value={templateId} onChange={e => setTemplateId(e.target.value)}>
                                {info.templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                        </label>
                        <label className="ve-field">
                            <span className="le-label">Envoi le (heure de Paris)</span>
                            <input type="datetime-local" value={Number.isFinite(sendAt) ? toInput(sendAt) : ''} onChange={e => setSendAt(fromInput(e.target.value))} />
                        </label>
                        {hasWhisper && (
                            <label className="ve-field">
                                <span className="le-label">Liens Whisper valables</span>
                                <select value={duration} onChange={e => setDuration(e.target.value)}>
                                    {Object.entries(info.durations).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                </select>
                            </label>
                        )}
                    </div>
                    {Number.isFinite(sendAt) && (
                        <p className="le-hint" style={{ marginTop: 4 }}>
                            Envoi {fmt(sendAt)} ({relative(sendAt)})
                            {hasWhisper && <> → liens Whisper créés à l'envoi, valables jusqu'au {fmt(sendAt + DURATION_MIN[duration] * 60000)}</>}
                        </p>
                    )}

                    <div className="hm-recipients-head">
                        <span className="le-label" style={{ margin: 0 }}><Users size={11} /> Destinataires ({filled.length})</span>
                        <div className="hm-inline-actions">
                            {hasWhisper && (
                                <button className="btn btn-ghost btn-sm" onClick={() => setReveal(v => !v)}>
                                    {reveal ? <EyeOff size={12} /> : <Eye size={12} />} {reveal ? 'Masquer les secrets' : 'Afficher les secrets'}
                                </button>
                            )}
                            <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} title="Facultatif : pré-remplir depuis un CSV">
                                <Upload size={12} /> CSV
                            </button>
                            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={e => { importCsv(e.target.files?.[0]); e.target.value = ''; }} />
                        </div>
                    </div>
                    <div className="hm-table-wrap">
                        <table className="hm-table hm-edit">
                            <thead>
                                <tr>
                                    <th>Email</th>
                                    {fields.map(([n, f]) => (
                                        <th key={n} title={`{{${n}}}`}>{f.type === 'whisper' && <Lock size={10} />} {f.label}</th>
                                    ))}
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r, i) => {
                                    const touched = r.email.trim() || Object.values(r.values).some(v => v.trim());
                                    return (
                                        <tr key={i} className={touched && !rowOk(r) ? 'hm-bad' : ''}>
                                            <td><input value={r.email} placeholder="prenom@exemple.fr" onChange={e => setCell(i, '@email', e.target.value)} /></td>
                                            {fields.map(([n, f]) => (
                                                <td key={n}>
                                                    <input
                                                        type={f.type === 'whisper' && !reveal ? 'password' : 'text'}
                                                        autoComplete={f.type === 'whisper' ? 'new-password' : 'off'}
                                                        value={r.values[n] || ''}
                                                        placeholder={f.type === 'whisper' ? 'secret → lien Whisper' : f.label}
                                                        onChange={e => setCell(i, n, e.target.value)}
                                                    />
                                                </td>
                                            ))}
                                            <td className="hm-row-actions">
                                                <button className="le-icon-btn" title="Aperçu pour ce destinataire" onClick={() => showPreview(r.values)}><FileText size={11} /></button>
                                                <button className="le-icon-btn" title="Dupliquer la ligne" onClick={() => setRows(rs => [...rs.slice(0, i + 1), { email: '', values: { ...r.values } }, ...rs.slice(i + 1)])}><Copy size={11} /></button>
                                                <button className="le-icon-btn" title="Retirer" onClick={() => setRows(rs => (rs.length > 1 ? rs.filter((_, j) => j !== i) : [emptyRow()]))}><X size={11} /></button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <button className="le-add-section" style={{ padding: 10, marginTop: 8 }} onClick={() => setRows(rs => [...rs, emptyRow()])}>
                        <Plus size={13} /> Ajouter un destinataire
                    </button>
                    <p className="le-hint" style={{ marginTop: 6 }}>
                        Colonnes = champs du modèle. <Lock size={9} /> = secret : la valeur n'apparaît pas dans le mail, elle devient un lien Whisper
                        à lecture unique. Rempli automatiquement : {Object.keys(info.autoVars).map(v => `{{${v}}}`).join(', ')}.
                    </p>

                    {error && <p className="le-error" style={{ marginTop: 8 }}>{error}</p>}
                    {notice && <p className="hm-ok"><CheckCircle2 size={12} /> {notice}</p>}
                    <div className="hm-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => showPreview()}><FileText size={12} /> Aperçu</button>
                        <button className="btn btn-primary btn-sm" disabled={!ready || saving} onClick={schedule}>
                            <Clock size={12} /> {saving ? '…' : `Programmer ${filled.length || ''} envoi${filled.length > 1 ? 's' : ''}`}
                        </button>
                    </div>
                </div>
            </div>

            {/* --- Modèles --- */}
            <div className="section" style={{ animationDelay: '.08s' }}>
                <div className="section-header">
                    <FileText size={14} /> Modèles
                    <button className="section-link" title="Nouveau modèle" onClick={() => setEditing({ name: '', subject: '', html: '', fields: {} })}><Plus size={12} /></button>
                </div>
                <div className="hm-list">
                    {info.templates.map(t => (
                        <div key={t.id} className="hm-job">
                            <div className="hm-job-main">
                                <b>{t.name}</b>
                                <span className="hm-dim">Objet : {t.subject}</span>
                                <div className="hm-chips">
                                    {t.vars.map(v => {
                                        const f = t.fields[v];
                                        return <span key={v} className={`hm-chip ${f?.type === 'whisper' ? 'hm-chip-secret' : ''} ${info.autoVars[v] ? 'hm-chip-auto' : ''}`}>
                                            {f?.type === 'whisper' && <Lock size={9} />} {f?.label || v}{info.autoVars[v] ? ' (auto)' : ''}
                                        </span>;
                                    })}
                                </div>
                            </div>
                            <div className="hm-job-actions">
                                <button className="le-icon-btn" title="Modifier" onClick={() => setEditing(t)}><Pencil size={12} /></button>
                                <button className="le-icon-btn" title="Dupliquer" onClick={() => setEditing({ ...t, id: undefined, name: `${t.name} (copie)` })}><Copy size={12} /></button>
                                <button className="le-icon-btn" title="Supprimer" onClick={() => deleteTemplate(t)}><Trash2 size={12} /></button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* --- À venir / historique --- */}
            <div className="section" style={{ animationDelay: '.1s' }}>
                <div className="section-header"><Clock size={14} /> À venir ({upcoming.length})</div>
                {upcoming.length === 0 ? <p className="le-hint">Aucun envoi programmé.</p> : (
                    <div className="hm-list">{upcoming.map(j => <JobRow key={j.id} job={j} durations={info.durations} onAct={act} />)}</div>
                )}
            </div>
            <div className="section" style={{ animationDelay: '.15s' }}>
                <div className="section-header"><Send size={14} /> Historique</div>
                {history.length === 0 ? <p className="le-hint">Rien pour l'instant.</p> : (
                    <div className="hm-list">{history.map(j => <JobRow key={j.id} job={j} durations={info.durations} onAct={act} />)}</div>
                )}
            </div>

            {preview && (
                <div className="modal-overlay" onClick={() => setPreview(null)}>
                    <div className="hm-preview" onClick={e => e.stopPropagation()}>
                        <div className="hm-preview-bar">
                            <span>Objet : <b>{preview.subject}</b> <span className="hm-dim">(liens Whisper factices)</span></span>
                            <button className="le-icon-btn" onClick={() => setPreview(null)}><X size={12} /></button>
                        </div>
                        <iframe title="Aperçu du mail" sandbox="" srcDoc={preview.html} />
                    </div>
                </div>
            )}

            {editing && (
                <TemplateEditor
                    initial={editing}
                    autoVars={info.autoVars}
                    onClose={() => setEditing(null)}
                    onSaved={t => { setEditing(null); setTemplateId(t.id); load(); }}
                    post={post}
                />
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

// Éditeur de modèle : nom, objet, HTML ; les champs {{…}} sont détectés, on règle libellé et type
function TemplateEditor({ initial, autoVars, onClose, onSaved, post }: {
    initial: Partial<HermodTemplate>;
    autoVars: Record<string, string>;
    onClose: () => void;
    onSaved: (t: HermodTemplate) => void;
    post: (url: string, body?: unknown) => Promise<{ template: HermodTemplate; subject: string; html: string }>;
}) {
    const [name, setName] = useState(initial.name || '');
    const [subject, setSubject] = useState(initial.subject || '');
    const [html, setHtml] = useState(initial.html || '');
    const [fields, setFields] = useState<Record<string, HermodField>>(initial.fields || {});
    const [rendered, setRendered] = useState('');
    const [error, setError] = useState('');
    const fileRef = useRef<HTMLInputElement>(null);

    const vars = varsOf(subject, html);
    const editable = vars.filter(v => !autoVars[v]);
    const effective = Object.fromEntries(editable.map(v => [v, fields[v] || { label: v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' '), type: 'text' as const }]));

    useEffect(() => {
        const t = setTimeout(() => {
            const values = Object.fromEntries(editable.map(v => [v, `[${effective[v].label}]`]));
            post('/api/admin/hermod/preview', { subject, html, fields: effective, values, duration: '24h' })
                .then(d => setRendered(d.html)).catch(() => {});
        }, 400);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subject, html, JSON.stringify(effective)]);

    async function save() {
        setError('');
        try {
            const d = await post('/api/admin/hermod/templates', { id: initial.id, name, subject, html, fields: effective });
            onSaved(d.template);
        } catch (e) { setError((e as Error).message); }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="hm-editor" onClick={e => e.stopPropagation()}>
                <div className="hm-preview-bar">
                    <span>{initial.id ? 'Modifier le modèle' : 'Nouveau modèle'}</span>
                    <button className="le-icon-btn" onClick={onClose}><X size={12} /></button>
                </div>
                <div className="hm-editor-body">
                    <div className="hm-editor-form">
                        <HField label="Nom du modèle" value={name} onChange={setName} placeholder="Accès à un service" />
                        <HField label="Objet (champs {{…}} autorisés)" value={subject} onChange={setSubject} placeholder="Vos accès à {{SERVICE}}" />
                        <label className="ve-field">
                            <span className="le-label hm-label-row">
                                Contenu HTML
                                <button className="btn btn-ghost btn-sm" onClick={e => { e.preventDefault(); fileRef.current?.click(); }}><Upload size={11} /> Importer un .html</button>
                            </span>
                            <textarea className="hm-code" value={html} onChange={e => setHtml(e.target.value)} spellCheck={false}
                                placeholder={'<p>Bonjour {{PRENOM}},</p>\n<p>Votre lien : <a href="{{LIEN}}">{{LIEN}}</a></p>'} />
                            <input ref={fileRef} type="file" accept=".html,.htm,text/html" hidden
                                onChange={e => { e.target.files?.[0]?.text().then(setHtml); e.target.value = ''; }} />
                        </label>
                        <span className="le-label">Champs détectés</span>
                        {vars.length === 0 && <p className="le-hint">Aucun champ : écris {'{{NOM_DU_CHAMP}}'} dans l'objet ou le HTML.</p>}
                        <div className="hm-fields">
                            {vars.map(v => autoVars[v] ? (
                                <div key={v} className="hm-field-row">
                                    <code>{`{{${v}}}`}</code><span className="hm-dim">automatique : {autoVars[v]}</span>
                                </div>
                            ) : (
                                <div key={v} className="hm-field-row">
                                    <code>{`{{${v}}}`}</code>
                                    <input value={effective[v].label} onChange={e => setFields(f => ({ ...f, [v]: { ...effective[v], label: e.target.value } }))} />
                                    <select value={effective[v].type} onChange={e => setFields(f => ({ ...f, [v]: { ...effective[v], type: e.target.value as HermodField['type'] } }))}>
                                        <option value="text">Texte</option>
                                        <option value="whisper">Secret → lien Whisper</option>
                                    </select>
                                </div>
                            ))}
                        </div>
                        {error && <p className="le-error">{error}</p>}
                        <div className="hm-actions">
                            <button className="btn btn-ghost btn-sm" onClick={onClose}>Annuler</button>
                            <button className="btn btn-primary btn-sm" onClick={save}>Enregistrer</button>
                        </div>
                    </div>
                    <iframe className="hm-editor-preview" title="Aperçu du modèle" sandbox="" srcDoc={rendered} />
                </div>
            </div>
        </div>
    );
}

function JobRow({ job, durations, onAct }: {
    job: HermodJob;
    durations: Record<string, string>;
    onAct: (j: HermodJob, what: 'cancel' | 'send-now' | 'retry' | 'delete') => void;
}) {
    const summary = Object.values(job.values || {}).filter(Boolean).slice(0, 3).join(' · ');
    const canResend = !!job.templateId && (job.hasSecrets || !job.secretFields?.length);
    return (
        <div className={`hm-job hm-${job.status}`}>
            <div className="hm-job-main">
                <div className="hm-job-top">
                    <span className={`hm-status hm-status-${job.status}`}>{STATUS[job.status]}</span>
                    <b>{job.to}</b>
                    {summary && <span className="hm-dim">{summary}</span>}
                </div>
                <div className="hm-dim">
                    {job.templateName} · depuis {job.from || 'no-reply@lucipher-lab.fr'}
                    {job.secretFields?.length ? <> · lien{job.secretFields.length > 1 ? 's' : ''} {durations[job.duration] || job.duration}</> : null}
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
                {job.status === 'pending' && <>
                    <button className="le-icon-btn" title="Envoyer maintenant" onClick={() => onAct(job, 'send-now')}><Send size={12} /></button>
                    <button className="le-icon-btn" title="Annuler" onClick={() => onAct(job, 'cancel')}><X size={12} /></button>
                </>}
                {job.status === 'failed' && canResend && (
                    <button className="le-icon-btn" title="Relancer" onClick={() => onAct(job, 'retry')}><RotateCw size={12} /></button>
                )}
                {(job.status === 'sent' || job.status === 'failed' || job.status === 'cancelled') && (
                    <button className="le-icon-btn" title="Retirer de l'historique" onClick={() => onAct(job, 'delete')}><Trash2 size={12} /></button>
                )}
            </div>
        </div>
    );
}
