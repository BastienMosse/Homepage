import { useState, useEffect, useCallback } from 'react';
import type { Container, ContainerGroup, ServerStats, HealthCheck } from '../types.ts';
import ServerStatsPanel from './ServerStats.tsx';
import ContainerModal from './ContainerModal.tsx';
import { Play, Square, RotateCw, Activity, Globe, Terminal, Copy, Check, AlertTriangle } from 'lucide-react';

// Pense-bête pour les pannes connues (voir CLAUDE.md) : à lancer en SSH sur le serveur
const RESCUE = [
    { title: 'VPN : IPs perdues après restart Headscale', cmd: 'sudo tailscale set --snat-subnet-routes=false' },
    { title: 'IP du conteneur Headplane (heimdall.yaml)', cmd: `docker inspect $(docker ps -qf name=headplane) --format '{{(index .NetworkSettings.Networks "coolify").IPAddress}}'` },
    { title: 'IP du conteneur Error Pages (errorpages.yaml)', cmd: `docker inspect $(docker ps -qf name=fctzlky47nggsnuvxrtwrfqh) --format '{{(index .NetworkSettings.Networks "coolify").IPAddress}}'` },
    { title: 'Seanime : mot de passe perdu après redeploy', cmd: "grep -A5 '\\[server\\]' /opt/seanime/config/config.toml" },
    { title: 'Conteneurs arrêtés', cmd: "docker ps -a --filter status=exited --format '{{.Names}}\\t{{.Status}}'" },
    { title: 'Espace disque', cmd: 'df -h / && docker system df' },
];

function statusClass(state: string) {
    if (state === 'running') return 'running';
    if (state === 'exited') return 'exited';
    return 'other';
}

// 2xx/3xx = en ligne, 401/403 = protégé (VPN / auth), le reste = problème
function healthLevel(h: HealthCheck): 'ok' | 'guarded' | 'down' {
    if (h.status >= 200 && h.status < 400) return 'ok';
    if (h.status === 401 || h.status === 403) return 'guarded';
    return 'down';
}

export default function ServerPanel() {
    const [groups, setGroups] = useState<ContainerGroup[]>([]);
    const [stats, setStats] = useState<ServerStats | null>(null);
    const [health, setHealth] = useState<HealthCheck[] | null>(null);
    const [checking, setChecking] = useState(false);
    const [loadingAction, setLoadingAction] = useState<string | null>(null);
    const [selected, setSelected] = useState<Container | null>(null);
    const [copied, setCopied] = useState<number | null>(null);

    const load = useCallback(() => {
        fetch('/api/admin/containers').then(r => r.json()).then(d => setGroups(d.containers || []));
        fetch('/api/admin/stats').then(r => r.json()).then(d => setStats(d));
    }, []);

    const checkHealth = useCallback(() => {
        setChecking(true);
        fetch('/api/admin/health').then(r => r.json())
            .then(d => setHealth((d.checks || []).sort((a: HealthCheck, b: HealthCheck) => a.name.localeCompare(b.name))))
            .finally(() => setChecking(false));
    }, []);

    useEffect(() => {
        load();
        checkHealth();
        const iv = setInterval(load, 5000);
        const hv = setInterval(checkHealth, 60000);
        return () => { clearInterval(iv); clearInterval(hv); };
    }, [load, checkHealth]);

    async function containerAction(id: string, action: string) {
        setLoadingAction(`${id}-${action}`);
        await fetch(`/api/admin/containers/${id}/${action}`, { method: 'POST' });
        setTimeout(load, 1500);
        setLoadingAction(null);
    }

    function copy(i: number, cmd: string) {
        navigator.clipboard?.writeText(cmd).then(() => { setCopied(i); setTimeout(() => setCopied(null), 1500); });
    }

    const stopped = groups.flatMap(g => g.containers.filter(c => c.state !== 'running').map(c => ({ ...c, group: g.label })));
    const down = (health || []).filter(h => healthLevel(h) === 'down');

    return (
        <>
            {(stopped.length > 0 || down.length > 0) && (
                <div className="sp-alert">
                    <AlertTriangle size={14} />
                    <div>
                        {stopped.length > 0 && <div><b>{stopped.length}</b> conteneur(s) arrêté(s) : {stopped.map(c => c.group === c.name ? c.name : `${c.group}/${c.name}`).join(', ')}</div>}
                        {down.length > 0 && <div><b>{down.length}</b> site(s) injoignable(s) : {down.map(h => h.name).join(', ')}</div>}
                    </div>
                </div>
            )}

            <div className="section" style={{ animationDelay: '.05s' }}>
                <div className="section-header">
                    <Activity size={14} />
                    Serveur
                </div>
                <ServerStatsPanel stats={stats} />
            </div>

            <div className="section" style={{ animationDelay: '.1s' }}>
                <div className="section-header">
                    <Globe size={14} />
                    Sites (HTTP)
                    <button className="section-link" onClick={checkHealth} disabled={checking} title="Relancer le test">
                        <RotateCw size={12} className={checking ? 'sp-spin' : ''} />
                    </button>
                </div>
                {!health ? (
                    <p style={{ color: 'var(--text-dim)', fontSize: '.8rem' }}>Test en cours...</p>
                ) : (
                    <div className="sp-health">
                        {health.map(h => {
                            const lvl = healthLevel(h);
                            return (
                                <a key={h.url} className={`sp-health-row sp-${lvl}`} href={h.url} target="_blank" rel="noopener noreferrer" title={h.url}>
                                    <span className={`status-dot ${lvl === 'ok' ? 'running' : lvl === 'guarded' ? 'other' : 'exited'}`} />
                                    <span className="sp-health-name">{h.name}</span>
                                    <span className="sp-health-meta">
                                        {h.status ? h.status : (h.error || 'erreur')}
                                        {lvl === 'guarded' && ' · VPN'}
                                        {' · '}{h.ms} ms
                                    </span>
                                </a>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="section" style={{ animationDelay: '.15s' }}>
                <div className="section-header">
                    <Activity size={14} />
                    Conteneurs
                </div>
                {groups.length === 0 ? (
                    <p style={{ color: 'var(--text-dim)', fontSize: '.8rem' }}>
                        Aucun conteneur détecté
                    </p>
                ) : (
                    <div className="monitor-grid">
                        {groups.map(g => (
                            <div key={g.label} className="container-group">
                                <div className="group-label">{g.label}</div>
                                {g.containers.map(c => (
                                    <div key={c.id} className="container-row">
                                        <span className={`status-dot ${statusClass(c.state)}`} />
                                        <span className="container-name clickable" title={c.status} onClick={() => setSelected(c)}>{c.name}</span>
                                        <div className="container-actions">
                                            {c.state !== 'running' && (
                                                <button title="Démarrer" onClick={() => containerAction(c.id, 'start')} disabled={loadingAction === `${c.id}-start`}>
                                                    <Play size={12} />
                                                </button>
                                            )}
                                            {c.state === 'running' && (
                                                <button title="Stopper" onClick={() => containerAction(c.id, 'stop')} disabled={loadingAction === `${c.id}-stop`}>
                                                    <Square size={12} />
                                                </button>
                                            )}
                                            <button title="Redémarrer" onClick={() => containerAction(c.id, 'restart')} disabled={loadingAction === `${c.id}-restart`}>
                                                <RotateCw size={12} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="section" style={{ animationDelay: '.2s' }}>
                <div className="section-header">
                    <Terminal size={14} />
                    Secours (SSH)
                </div>
                <p className="le-hint" style={{ marginBottom: 10 }}>ssh ubuntu@89.168.48.143 puis :</p>
                <div className="sp-rescue">
                    {RESCUE.map((r, i) => (
                        <div key={i} className="sp-rescue-row">
                            <div className="sp-rescue-title">{r.title}</div>
                            <code>{r.cmd}</code>
                            <button className="le-icon-btn" onClick={() => copy(i, r.cmd)} title="Copier">
                                {copied === i ? <Check size={11} /> : <Copy size={11} />}
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {selected && (
                <ContainerModal
                    container={selected}
                    onClose={() => setSelected(null)}
                    onAction={(id, action) => { containerAction(id, action); }}
                />
            )}
        </>
    );
}
