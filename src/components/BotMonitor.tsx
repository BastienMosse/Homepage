import { useState, useEffect, useRef, useCallback } from 'react';
import type { ContainerDetail } from '../types.ts';
import { ArrowLeft, Play, Square, RotateCw, Terminal, Cpu, MemoryStick, Clock, Circle } from 'lucide-react';

interface Bot {
    id: string;
    name: string;
    key: string;
    desc: string;
    icon: string;
    color: string;
    state: string;
    status: string;
}

interface BotState {
    logs: string[];
    detail: ContainerDetail | null;
}

function formatBytes(b: number) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1024 ** 3) return (b / 1024 / 1024).toFixed(1) + ' MB';
    return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function formatUptime(iso: string) {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}min ${s % 60}s`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}min`;
    const d = Math.floor(h / 24);
    return `${d}j ${h % 24}h`;
}

interface Props {
    onBack: () => void;
}

export default function BotMonitor({ onBack }: Props) {
    const [bots, setBots] = useState<Bot[]>([]);
    const [states, setStates] = useState<Record<string, BotState>>({});
    const [expanded, setExpanded] = useState<string | null>(null);
    const logsEndRef = useRef<HTMLDivElement>(null);

    const fetchBots = useCallback(() => {
        fetch('/api/admin/bots').then(r => r.json()).then(d => setBots(d.bots || []));
    }, []);

    useEffect(() => {
        fetchBots();
        const iv = setInterval(fetchBots, 8000);
        return () => clearInterval(iv);
    }, [fetchBots]);

    const fetchBotData = useCallback(() => {
        for (const bot of bots) {
            Promise.all([
                fetch(`/api/admin/containers/${bot.id}/stats`).then(r => r.json()).catch(() => null),
                fetch(`/api/admin/containers/${bot.id}/logs`).then(r => r.json()).catch(() => ({ logs: [] })),
            ]).then(([detail, logsData]) => {
                setStates(prev => ({
                    ...prev,
                    [bot.id]: { detail, logs: logsData?.logs || [] },
                }));
            });
        }
    }, [bots]);

    useEffect(() => {
        if (bots.length === 0) return;
        fetchBotData();
        const iv = setInterval(fetchBotData, 4000);
        return () => clearInterval(iv);
    }, [bots, fetchBotData]);

    useEffect(() => {
        if (logsEndRef.current) logsEndRef.current.scrollTop = logsEndRef.current.scrollHeight;
    }, [states, expanded]);

    async function doAction(id: string, action: string) {
        await fetch(`/api/admin/containers/${id}/${action}`, { method: 'POST' });
        setTimeout(fetchBots, 1500);
    }

    return (
        <div className="bot-monitor">
            <div className="bm-header">
                <button className="bm-back" onClick={onBack}>
                    <ArrowLeft size={16} />
                    Retour
                </button>
                <h2>Monitoring Bots</h2>
                <span className="bm-count">{bots.length} bot{bots.length !== 1 ? 's' : ''}</span>
            </div>

            {bots.length === 0 && (
                <div className="bm-empty">Aucun bot détecté</div>
            )}

            <div className="bm-grid">
                {bots.map(bot => {
                    const s = states[bot.id];
                    const detail = s?.detail;
                    const logs = s?.logs || [];
                    const isExpanded = expanded === bot.id;
                    const memPercent = detail && detail.memory.limit > 0
                        ? Math.round(detail.memory.used / detail.memory.limit * 100)
                        : 0;

                    return (
                        <div key={bot.id} className={`bm-card ${isExpanded ? 'expanded' : ''}`}>
                            <div className="bm-card-header" onClick={() => setExpanded(isExpanded ? null : bot.id)}>
                                <div className="bm-card-info">
                                    <Circle
                                        size={10}
                                        fill={bot.state === 'running' ? '#34d399' : '#e2685f'}
                                        stroke="none"
                                        style={{ filter: bot.state === 'running' ? 'drop-shadow(0 0 4px rgba(52,211,153,0.5))' : 'none' }}
                                    />
                                    <span className="bm-card-name">{bot.name}</span>
                                    <span className="bm-card-desc">{bot.desc}</span>
                                </div>
                                <div className="bm-card-actions" onClick={e => e.stopPropagation()}>
                                    {bot.state !== 'running' && (
                                        <button title="Démarrer" onClick={() => doAction(bot.id, 'start')}>
                                            <Play size={13} />
                                        </button>
                                    )}
                                    {bot.state === 'running' && (
                                        <button title="Stopper" onClick={() => doAction(bot.id, 'stop')}>
                                            <Square size={13} />
                                        </button>
                                    )}
                                    <button title="Redémarrer" onClick={() => doAction(bot.id, 'restart')}>
                                        <RotateCw size={13} />
                                    </button>
                                </div>
                            </div>

                            <div className="bm-card-stats">
                                <div className="bm-stat">
                                    <Cpu size={13} />
                                    <span className="bm-stat-val">{detail ? `${detail.cpu}%` : '—'}</span>
                                </div>
                                <div className="bm-stat">
                                    <MemoryStick size={13} />
                                    <span className="bm-stat-val">{detail ? formatBytes(detail.memory.used) : '—'}</span>
                                    {detail && detail.memory.limit > 0 && (
                                        <div className="bm-stat-bar">
                                            <div className="bm-stat-bar-fill" style={{ width: `${Math.min(memPercent, 100)}%` }} />
                                        </div>
                                    )}
                                </div>
                                <div className="bm-stat">
                                    <Clock size={13} />
                                    <span className="bm-stat-val">{detail ? formatUptime(detail.startedAt) : '—'}</span>
                                </div>
                            </div>

                            <div className="bm-console">
                                <div className="bm-console-header">
                                    <Terminal size={11} />
                                    Console
                                    <span className="bm-console-count">{logs.length} lignes</span>
                                </div>
                                <div className="bm-console-body" ref={isExpanded ? logsEndRef : undefined}>
                                    {logs.length === 0 ? (
                                        <span className="bm-console-empty">Aucun log</span>
                                    ) : (
                                        (isExpanded ? logs : logs.slice(-15)).map((line, i) => (
                                            <div key={i} className="bm-log-line">{line}</div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
