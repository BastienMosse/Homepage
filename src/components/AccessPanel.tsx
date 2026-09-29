import { useCallback, useEffect, useState } from 'react';
import { Shield, Globe, Lock, RotateCw, Check, X, Loader, AlertTriangle, ChevronDown } from 'lucide-react';

interface Item {
    uuid: string; name: string; hosts: string[];
    access: 'vpn' | 'public';
    running: boolean | null; dns: boolean; outside: number;
    locked: string | null; note: string | null; pending: boolean;
}
interface Step { label: string; state: 'run' | 'ok' | 'fail'; detail?: string }
interface Job { uuid: string; name: string; target: 'vpn' | 'public'; auto: boolean; reason?: string; steps: Step[]; status: 'run' | 'ok' | 'fail'; error?: string; startedAt: number; endedAt?: number; deployStatus?: string }
interface Event { at: number; name: string; text: string; ok: boolean; auto: boolean }
interface Overview {
    items: Item[];
    services: { name: string; hosts: string[]; outside: number }[];
    locked: { name: string; host: string; dns: boolean; outside: number }[];
    job: Job | null; queue: string[]; events: Event[];
    dnsError: string | null; tokenMissing: boolean;
}

const when = (t: number) => new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Incohérence visible (la surveillance la répare d'elle-même en ≤ 5 min). */
function drift(it: Item): string | null {
    if (it.pending) return null;
    if (it.running !== null && it.running !== (it.access === 'vpn')) return 'le conteneur n’applique pas encore ce réglage';
    if (it.access === 'vpn' && !it.dns) return 'entrée DNS du VPN manquante';
    if (it.access === 'vpn' && it.outside && it.outside !== 403) return `répond ${it.outside} hors VPN`;
    return null;
}

export default function AccessPanel() {
    const [data, setData] = useState<Overview | null>(null);
    const [err, setErr] = useState('');
    const [confirm, setConfirm] = useState<string | null>(null);
    const [showLog, setShowLog] = useState(false);

    const load = useCallback(() => {
        fetch('/api/admin/access').then(async r => {
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || `erreur ${r.status}`);
            setData(d); setErr('');
        }).catch(e => setErr(e.message));
    }, []);

    const busy = !!(data?.job?.status === 'run' || data?.queue.length);
    useEffect(() => {
        load();
        const iv = setInterval(load, busy ? 2500 : 30000);
        return () => clearInterval(iv);
    }, [load, busy]);

    async function toggle(it: Item) {
        setConfirm(null);
        const target = it.access === 'vpn' ? 'public' : 'vpn';
        const r = await fetch(`/api/admin/access/${it.uuid}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target }) });
        if (!r.ok) setErr((await r.json().catch(() => ({}))).error || 'échec');
        load();
    }

    const job = data?.job;
    const showJob = job && (job.status === 'run' || (job.endedAt && Date.now() - job.endedAt < 120000));

    return (
        <div className="section" style={{ animationDelay: '.12s' }}>
            <div className="section-header">
                <Shield size={14} />
                Accès : public ou VPN
                <button className="section-link" onClick={load} title="Actualiser"><RotateCw size={12} className={busy ? 'sp-spin' : ''} /></button>
            </div>
            <p className="le-hint" style={{ marginBottom: 10 }}>
                Un clic règle tout (filtre Traefik, DNS du VPN, redéploiement, vérification). Surveillance automatique toutes les 5 min : un blocage VPN qui disparaît est remis tout seul.
            </p>

            {err && <div className="sp-alert"><AlertTriangle size={14} /><div>{err}</div></div>}
            {data?.tokenMissing && <div className="sp-alert"><AlertTriangle size={14} /><div>Jeton Coolify absent : ajoute <code>COOLIFY_API_TOKEN</code> dans l’environnement d’Asgard.</div></div>}
            {data?.dnsError && <div className="sp-alert"><AlertTriangle size={14} /><div>{data.dnsError}</div></div>}

            {showJob && job && (
                <div className={`ac-job ac-${job.status}`}>
                    <div className="ac-job-title">
                        {job.status === 'run' ? <Loader size={13} className="sp-spin" /> : job.status === 'ok' ? <Check size={13} /> : <X size={13} />}
                        {job.name} → {job.target === 'vpn' ? 'VPN uniquement' : 'public'}{job.auto ? ' (automatique)' : ''}
                    </div>
                    {job.reason && <div className="ac-job-reason">{job.reason}</div>}
                    <ol className="ac-steps">
                        {job.steps.map((s, i) => (
                            <li key={i} className={`ac-step ac-${s.state}`}>
                                {s.state === 'run' ? <Loader size={11} className="sp-spin" /> : s.state === 'ok' ? <Check size={11} /> : <X size={11} />}
                                <span>{s.label}{s.state === 'run' && s.label === 'Redéploiement' && job.deployStatus ? ` (${job.deployStatus})` : ''}</span>
                                {s.detail && <span className="ac-detail">{s.detail}</span>}
                            </li>
                        ))}
                    </ol>
                    {job.error && <div className="ac-job-error">{job.error}</div>}
                </div>
            )}

            {!data && !err && <p style={{ color: 'var(--text-dim)', fontSize: '.8rem' }}>Chargement…</p>}

            {data && (
                <div className="ac-list">
                    {data.items.map(it => {
                        const d = drift(it);
                        const vpn = it.access === 'vpn';
                        return (
                            <div key={it.uuid} className={`ac-row ${d ? 'ac-drift' : ''}`}>
                                <div className="ac-main">
                                    <span className={`ac-badge ${vpn ? 'ac-vpn' : 'ac-public'}`}>{vpn ? <Lock size={11} /> : <Globe size={11} />}{vpn ? 'VPN' : 'Public'}</span>
                                    <div className="ac-name">
                                        <span>{it.name}</span>
                                        <span className="ac-hosts">{it.hosts.join(' · ')}</span>
                                        {d && <span className="ac-warn">{d} — réparation automatique en cours ou au prochain passage</span>}
                                    </div>
                                    {it.locked ? (
                                        <span className="ac-locked" title={it.locked}><Lock size={11} /> verrouillé</span>
                                    ) : it.pending ? (
                                        <span className="ac-locked"><Loader size={11} className="sp-spin" /> en cours</span>
                                    ) : (
                                        <button className="ac-btn" disabled={busy} onClick={() => setConfirm(confirm === it.uuid ? null : it.uuid)}>
                                            {vpn ? 'Rendre public' : 'Passer en VPN'}
                                        </button>
                                    )}
                                </div>
                                {it.locked && <div className="ac-sub">{it.locked}</div>}
                                {confirm === it.uuid && (
                                    <div className="ac-confirm">
                                        <p>
                                            {vpn
                                                ? <><b>{it.name}</b> sera accessible par <b>tout Internet</b>. Vérifie qu’il a sa propre protection (mot de passe) s’il contient des données privées.</>
                                                : <><b>{it.name}</b> ne sera plus accessible que depuis le VPN (403 pour les autres).</>}
                                            {' '}Redéploiement : coupure de quelques secondes.
                                        </p>
                                        {it.note && <p className="ac-note"><AlertTriangle size={11} /> {it.note}</p>}
                                        <div className="ac-confirm-actions">
                                            <button className="btn btn-ghost" onClick={() => setConfirm(null)}>Annuler</button>
                                            <button className="btn btn-primary" onClick={() => toggle(it)}>{vpn ? 'Rendre public' : 'Passer en VPN'}</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {data.locked.map(s => (
                        <div key={s.host} className="ac-row ac-static">
                            <div className="ac-main">
                                <span className="ac-badge ac-vpn"><Lock size={11} />VPN</span>
                                <div className="ac-name"><span>{s.name}</span><span className="ac-hosts">{s.host}{!s.dns ? ' · entrée DNS du VPN manquante !' : ''}</span></div>
                                <span className="ac-locked" title="Console d'admin : jamais publique"><Lock size={11} /> toujours VPN</span>
                            </div>
                        </div>
                    ))}

                    {data.services.map(s => (
                        <div key={s.name + s.hosts[0]} className="ac-row ac-static">
                            <div className="ac-main">
                                <span className={`ac-badge ${s.outside === 403 ? 'ac-vpn' : 'ac-public'}`}>{s.outside === 403 ? <Lock size={11} /> : <Globe size={11} />}{s.outside === 403 ? 'VPN' : 'Public'}</span>
                                <div className="ac-name"><span>{s.name}</span><span className="ac-hosts">{s.hosts.join(' · ')}</span></div>
                                <span className="ac-locked" title="Service docker-compose : réglage dans son fichier compose">compose</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {data && data.events.length > 0 && (
                <div className="ac-log">
                    <button className="ac-log-toggle" onClick={() => setShowLog(v => !v)}>
                        <ChevronDown size={12} style={{ transform: showLog ? 'rotate(180deg)' : undefined }} /> Journal ({data.events.length})
                    </button>
                    {showLog && data.events.map((e, i) => (
                        <div key={i} className={`ac-event ${e.ok ? '' : 'ac-fail'}`}>
                            <span className="ac-when">{when(e.at)}</span>
                            <span><b>{e.name}</b> — {e.text}{e.auto ? ' · auto' : ''}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
