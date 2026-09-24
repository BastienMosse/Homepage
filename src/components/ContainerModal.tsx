import { useState, useEffect, useRef, useCallback } from 'react';
import type { Container, ContainerDetail } from '../types.ts';
import { X, Play, Square, RotateCw, Terminal, Cpu, MemoryStick } from 'lucide-react';

interface Props {
    container: Container;
    onClose: () => void;
    onAction: (id: string, action: string) => void;
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
    if (m < 60) return `${m}m ${s % 60}s`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    const d = Math.floor(h / 24);
    return `${d}j ${h % 24}h`;
}

export default function ContainerModal({ container, onClose, onAction }: Props) {
    const [logs, setLogs] = useState<string[]>([]);
    const [detail, setDetail] = useState<ContainerDetail | null>(null);
    const logsRef = useRef<HTMLDivElement>(null);

    const fetchData = useCallback(() => {
        fetch(`/api/admin/containers/${container.id}/logs`).then(r => r.json()).then(d => {
            if (d.logs) setLogs(d.logs);
        }).catch(() => {});
        fetch(`/api/admin/containers/${container.id}/stats`).then(r => r.json()).then(d => {
            if (d.cpu !== undefined) setDetail(d);
        }).catch(() => {});
    }, [container.id]);

    useEffect(() => {
        fetchData();
        const iv = setInterval(fetchData, 4000);
        return () => clearInterval(iv);
    }, [fetchData]);

    useEffect(() => {
        if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }, [logs]);

    useEffect(() => {
        function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const memPercent = detail && detail.memory.limit > 0
        ? Math.round(detail.memory.used / detail.memory.limit * 100)
        : 0;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="container-modal" onClick={e => e.stopPropagation()}>
                <div className="cm-header">
                    <div className="cm-title">
                        <span className={`status-dot ${container.state === 'running' ? 'running' : container.state === 'exited' ? 'exited' : 'other'}`} />
                        <span>{container.name}</span>
                    </div>
                    <div className="cm-actions">
                        {container.state !== 'running' && (
                            <button title="Démarrer" onClick={() => onAction(container.id, 'start')}><Play size={14} /></button>
                        )}
                        {container.state === 'running' && (
                            <button title="Stopper" onClick={() => onAction(container.id, 'stop')}><Square size={14} /></button>
                        )}
                        <button title="Redémarrer" onClick={() => onAction(container.id, 'restart')}><RotateCw size={14} /></button>
                        <button className="cm-close" onClick={onClose}><X size={16} /></button>
                    </div>
                </div>

                <div className="cm-stats">
                    <div className="cm-stat">
                        <Cpu size={14} />
                        <span className="cm-stat-label">CPU</span>
                        <span className="cm-stat-value">{detail ? `${detail.cpu}%` : '—'}</span>
                    </div>
                    <div className="cm-stat">
                        <MemoryStick size={14} />
                        <span className="cm-stat-label">RAM</span>
                        <span className="cm-stat-value">
                            {detail ? `${formatBytes(detail.memory.used)} / ${formatBytes(detail.memory.limit)}` : '—'}
                        </span>
                        {detail && detail.memory.limit > 0 && (
                            <div className="cm-bar">
                                <div className="cm-bar-fill" style={{ width: `${Math.min(memPercent, 100)}%` }} />
                            </div>
                        )}
                    </div>
                    <div className="cm-stat">
                        <span className="cm-stat-label">Uptime</span>
                        <span className="cm-stat-value">{detail ? formatUptime(detail.startedAt) : '—'}</span>
                    </div>
                </div>

                <div className="cm-logs-header">
                    <Terminal size={12} />
                    Console
                </div>
                <div className="cm-logs" ref={logsRef}>
                    {logs.length === 0 ? (
                        <span className="cm-logs-empty">Aucun log disponible</span>
                    ) : (
                        logs.map((line, i) => <div key={i} className="cm-log-line">{line}</div>)
                    )}
                </div>
            </div>
        </div>
    );
}
