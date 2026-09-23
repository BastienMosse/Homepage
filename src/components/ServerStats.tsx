import type { ServerStats } from '../types.ts';
import { Cpu, MemoryStick, HardDrive, Clock } from 'lucide-react';

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}j ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function barColor(percent: number): string {
    if (percent >= 90) return '#ef4444';
    if (percent >= 70) return '#fbbf24';
    return '#34d399';
}

function StatGauge({ label, icon: Icon, percent, detail }: {
    label: string;
    icon: typeof Cpu;
    percent: number;
    detail: string;
}) {
    const color = barColor(percent);
    return (
        <div className="stat-gauge">
            <div className="stat-gauge-header">
                <Icon size={13} color="var(--text-dim)" />
                <span className="stat-label">{label}</span>
                <span className="stat-value" style={{ color }}>{percent >= 0 ? `${percent}%` : '—'}</span>
            </div>
            <div className="stat-bar-track">
                <div
                    className="stat-bar-fill"
                    style={{ width: `${Math.max(0, percent)}%`, background: color }}
                />
            </div>
            <div className="stat-detail">{detail}</div>
        </div>
    );
}

export default function ServerStatsPanel({ stats }: { stats: ServerStats | null }) {
    if (!stats) return null;

    return (
        <div className="stats-panel">
            <StatGauge
                label="CPU"
                icon={Cpu}
                percent={stats.cpu}
                detail={`Load: ${stats.load.load1.toFixed(2)}`}
            />
            <StatGauge
                label="RAM"
                icon={MemoryStick}
                percent={stats.memory.percent}
                detail={`${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}`}
            />
            <StatGauge
                label="Disque"
                icon={HardDrive}
                percent={stats.disk.percent}
                detail={`${formatBytes(stats.disk.used)} / ${formatBytes(stats.disk.total)}`}
            />
            <div className="stat-gauge stat-uptime">
                <div className="stat-gauge-header">
                    <Clock size={13} color="var(--text-dim)" />
                    <span className="stat-label">Uptime</span>
                    <span className="stat-value" style={{ color: '#34d399' }}>{formatUptime(stats.uptime)}</span>
                </div>
            </div>
        </div>
    );
}
