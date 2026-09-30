import { useState, useEffect, useCallback } from 'react';
import type { Container, ResourceGroup, ResourceItem, ResourcesOverview } from '../types.ts';
import { Gauge, ChevronRight, Play, Square, RotateCw, Lock } from 'lucide-react';

// « Qui consomme quoi » : CPU / RAM / réseau / disque par service, relevés par le serveur
// toutes les 15 s (server/resources.cjs). CPU = % de la machine entière (4 cœurs = 100 %).

type SortKey = 'cpu' | 'cpu1h' | 'mem';

const SORTS: { key: SortKey; label: string }[] = [
    { key: 'cpu1h', label: 'CPU (1 h)' },
    { key: 'cpu', label: 'CPU (maintenant)' },
    { key: 'mem', label: 'RAM' },
];

function bytes(b: number): string {
    if (!b) return '0';
    if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} Ko`;
    if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(0)} Mo`;
    return `${(b / 1024 ** 3).toFixed(2)} Go`;
}

function rate(b: number): string {
    if (b < 1024) return b < 1 ? '—' : `${b.toFixed(0)} o/s`;
    if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} Ko/s`;
    return `${(b / 1024 ** 2).toFixed(1)} Mo/s`;
}

function pct(v: number): string {
    if (v <= 0) return '0 %';
    if (v < 0.1) return '< 0,1 %';
    return `${v.toFixed(v < 10 ? 1 : 0).replace('.', ',')} %`;
}

function since(t: number): string {
    return new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// Mini-courbe de la dernière heure (une seule série : pas de légende, le libellé de la colonne la nomme)
function Spark({ values, max, format }: { values: (number | null)[]; max: number; format: (v: number) => string }) {
    const W = 120, H = 26;
    const top = Math.max(max, ...values.map(v => v ?? 0)) || 1;
    const pts = values
        .map((v, i) => v == null ? null : `${(i / (values.length - 1)) * W},${H - 2 - (v / top) * (H - 4)}`)
        .filter(Boolean);
    const known = values.filter((v): v is number => v != null);
    const title = known.length
        ? `Dernière heure : moyenne ${format(known.reduce((a, b) => a + b, 0) / known.length)}, pic ${format(Math.max(...known))}`
        : 'Pas encore d’historique';
    return (
        <svg className="rs-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={title}>
            <title>{title}</title>
            <line x1="0" y1={H - 1} x2={W} y2={H - 1} className="rs-spark-base" />
            {pts.length > 1 && <polyline points={pts.join(' ')} className="rs-spark-line" />}
        </svg>
    );
}

function Bar({ value, max }: { value: number; max: number }) {
    return (
        <div className="rs-bar">
            <div style={{ width: `${max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0}%` }} />
        </div>
    );
}

interface Props {
    onSelect: (c: Container) => void;
    onAction: (id: string, action: string) => Promise<void>;
}

export default function ResourcesPanel({ onSelect, onAction }: Props) {
    const [data, setData] = useState<ResourcesOverview | null>(null);
    const [sort, setSort] = useState<SortKey>(() => {
        try { return (localStorage.getItem('rs-sort') as SortKey) || 'cpu1h'; } catch { return 'cpu1h'; }
    });
    const [open, setOpen] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState<string | null>(null);

    const load = useCallback(() => {
        fetch('/api/admin/resources').then(r => r.json()).then(d => { if (d.groups) setData(d); }).catch(() => {});
    }, []);

    useEffect(() => {
        load();
        const iv = setInterval(load, 15000);
        return () => clearInterval(iv);
    }, [load]);

    function pickSort(k: SortKey) {
        setSort(k);
        try { localStorage.setItem('rs-sort', k); } catch { /* stockage indisponible */ }
    }

    function toggle(key: string) {
        setOpen(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
    }

    async function act(c: ResourceItem, action: string, label: string) {
        if (action === 'stop' && !confirm(`Arrêter ${label} ?\n\nIl restera arrêté (même après un redémarrage du serveur) jusqu’à ce que tu le relances ici ou depuis Odin.`)) return;
        setBusy(`${c.id}-${action}`);
        try { await onAction(c.id, action); } finally { setBusy(null); setTimeout(load, 2000); }
    }

    if (!data) return null;

    const groups = [...data.groups].sort((a, b) =>
        (b.running > 0 ? 1 : 0) - (a.running > 0 ? 1 : 0) || b[sort] - a[sort] || a.label.localeCompare(b.label));
    const maxCpu = Math.max(...groups.map(g => Math.max(g.cpu, g.cpu1h)), 0.5);
    const maxMem = Math.max(...groups.map(g => g.mem), 1);
    const inMem = groups.reduce((a, g) => a + g.mem, 0);
    const inCpu = groups.reduce((a, g) => a + g.cpu, 0);
    const h = data.host;

    function actions(c: ResourceItem, label: string) {
        if (c.protected) return <span className="rs-lock" title={`Pas d’arrêt depuis Asgard : ${c.protected}`}><Lock size={11} /></span>;
        return (
            <div className="container-actions">
                {c.state !== 'running' ? (
                    <button title="Démarrer" onClick={() => act(c, 'start', label)} disabled={busy === `${c.id}-start`}><Play size={12} /></button>
                ) : (
                    <button title="Arrêter" onClick={() => act(c, 'stop', label)} disabled={busy === `${c.id}-stop`}><Square size={12} /></button>
                )}
                <button title="Redémarrer" onClick={() => act(c, 'restart', label)} disabled={busy === `${c.id}-restart`}><RotateCw size={12} /></button>
            </div>
        );
    }

    function cells(x: ResourceGroup | ResourceItem, running: boolean) {
        return (
            <>
                <div className="rs-cell rs-cpu" data-label="CPU">
                    <div className="rs-val">
                        <b>{running ? pct(x.cpu) : '—'}</b>
                        <span>moy. 1 h {pct(x.cpu1h)} · pic 24 h {pct(x.cpuMax24h)}</span>
                    </div>
                    <Bar value={sort === 'cpu' ? x.cpu : x.cpu1h} max={maxCpu} />
                </div>
                <div className="rs-cell rs-mem" data-label="RAM">
                    <div className="rs-val">
                        <b>{running ? bytes(x.mem) : '—'}</b>
                        <span>pic 24 h {bytes(x.memMax24h)}</span>
                    </div>
                    <Bar value={x.mem} max={maxMem} />
                </div>
                <div className="rs-cell rs-trend" data-label={sort === 'mem' ? 'RAM · 1 h' : 'CPU · 1 h'}>
                    {sort === 'mem'
                        ? <Spark values={x.sparkMem} max={0} format={bytes} />
                        : <Spark values={x.sparkCpu} max={0.5} format={pct} />}
                </div>
                <div className="rs-cell rs-io" data-label="Réseau / disque">
                    <span title="Réseau reçu / envoyé">↓ {rate(x.rx)} · ↑ {rate(x.tx)}</span>
                    <span title="Disque lu / écrit">L {rate(x.rd)} · É {rate(x.wr)}</span>
                </div>
            </>
        );
    }

    return (
        <div className="section" style={{ animationDelay: '.08s' }}>
            <div className="section-header">
                <Gauge size={14} />
                Qui consomme quoi
            </div>

            <div className="rs-summary">
                <span>Conteneurs : <b>{pct(inCpu)}</b> CPU · <b>{bytes(inMem)}</b> RAM</span>
                <span title="Système, Tailscale, SSH, noyau… (tout ce qui tourne hors Docker)">Hors Docker : {pct(h.otherCpu)} CPU · {bytes(h.otherMem)} RAM</span>
                <span>Machine : {h.cpus} cœurs · {bytes(h.memTotal)} RAM</span>
            </div>

            <div className="rs-sort" role="group" aria-label="Trier par">
                {SORTS.map(s => (
                    <button key={s.key} className={sort === s.key ? 'on' : ''} onClick={() => pickSort(s.key)}>{s.label}</button>
                ))}
            </div>

            <div className="rs-list">
                <div className="rs-row rs-head">
                    <div>Service</div><div>CPU</div><div>RAM</div><div>{sort === 'mem' ? 'RAM' : 'CPU'} · 1 h</div><div>Réseau / disque</div><div />
                </div>
                {groups.map(g => {
                    const single = g.containers.length === 1;
                    const isOpen = open.has(g.key);
                    const running = g.running > 0;
                    return (
                        <div key={g.key} className={`rs-group${running ? '' : ' rs-stopped'}`}>
                            <div className="rs-row">
                                <div className="rs-name">
                                    {single ? (
                                        <span className={`status-dot ${g.containers[0].state === 'running' ? 'running' : 'exited'}`} />
                                    ) : (
                                        <button className={`rs-chev${isOpen ? ' open' : ''}`} onClick={() => toggle(g.key)} aria-expanded={isOpen} title="Voir les conteneurs">
                                            <ChevronRight size={13} />
                                        </button>
                                    )}
                                    <span className="rs-label clickable" onClick={() => single ? onSelect(g.containers[0]) : toggle(g.key)}>
                                        {g.label}
                                    </span>
                                    {!single && <span className="rs-count">{g.running}/{g.containers.length}</span>}
                                    {!running && <span className="rs-count">arrêté</span>}
                                </div>
                                {cells(g, running)}
                                <div className="rs-actions">{single && actions(g.containers[0], g.label)}</div>
                            </div>
                            {!single && isOpen && [...g.containers].sort((a, b) => b[sort] - a[sort]).map(c => (
                                <div key={c.id} className="rs-row rs-sub">
                                    <div className="rs-name">
                                        <span className={`status-dot ${c.state === 'running' ? 'running' : 'exited'}`} />
                                        <span className="rs-label clickable" title={`${c.docker} · ${c.image} · ${c.status}`} onClick={() => onSelect(c)}>{c.name}</span>
                                    </div>
                                    {cells(c, c.state === 'running')}
                                    <div className="rs-actions">{actions(c, `${g.label} / ${c.name}`)}</div>
                                </div>
                            ))}
                        </div>
                    );
                })}
            </div>

            <p className="le-hint rs-foot">
                Relevé toutes les {Math.round(data.interval / 1000)} s · historique depuis {since(data.historySince)} (remis à zéro quand Asgard redémarre).
                Clic sur un nom = logs. <Lock size={10} /> = pas d’arrêt depuis ici (coupe les sites, le VPN ou Asgard).
            </p>
        </div>
    );
}
