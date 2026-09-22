import {
    Layers, MessageCircle, Mail, Shield, Monitor,
    ShieldAlert, Activity, type LucideIcon,
} from 'lucide-react';
import type { Service } from '../types';

const ICONS: Record<string, LucideIcon> = {
    layers: Layers,
    'message-circle': MessageCircle,
    mail: Mail,
    shield: Shield,
    monitor: Monitor,
    'shield-alert': ShieldAlert,
    activity: Activity,
};

const COLORS: Record<string, { bg: string; stroke: string; glow: string }> = {
    purple:  { bg: 'rgba(124,108,240,0.12)', stroke: '#7c6cf0', glow: 'rgba(124,108,240,0.08)' },
    emerald: { bg: 'rgba(52,211,153,0.12)',  stroke: '#34d399', glow: 'rgba(52,211,153,0.08)' },
    amber:   { bg: 'rgba(251,191,36,0.12)',  stroke: '#fbbf24', glow: 'rgba(251,191,36,0.08)' },
    mint:    { bg: 'rgba(94,230,176,0.12)',   stroke: '#5ee6b0', glow: 'rgba(94,230,176,0.08)' },
    red:     { bg: 'rgba(239,68,68,0.12)',    stroke: '#ef4444', glow: 'rgba(239,68,68,0.08)' },
    cyan:    { bg: 'rgba(34,211,238,0.12)',   stroke: '#22d3ee', glow: 'rgba(34,211,238,0.08)' },
};

export default function ServiceCard({ service, index }: { service: Service; index: number }) {
    const Icon = ICONS[service.icon] || Shield;
    const color = COLORS[service.color] || COLORS.purple;

    return (
        <a
            href={service.url}
            className="card"
            style={{ animationDelay: `${0.25 + index * 0.1}s` }}
        >
            <div
                className="card-glow"
                style={{ background: `radial-gradient(circle at 50% 0%, ${color.glow}, transparent 70%)` }}
            />
            <div className="card-icon" style={{ background: color.bg }}>
                <Icon size={24} color={color.stroke} strokeWidth={1.8} />
            </div>
            <div className="card-name">{service.name}</div>
            <div className="card-desc">{service.desc}</div>
        </a>
    );
}
