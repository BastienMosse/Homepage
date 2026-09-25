import {
    Globe, Wrench, GraduationCap, Shield, MessageCircle,
    HardDrive, Server, ShieldCheck, Lock, Play, Square,
    RotateCw, Activity, type LucideIcon, ChevronDown, Bot,
    Cpu, MemoryStick, HardDriveDownload, Clock, Gauge,
    AlertTriangle, Settings, Inbox,
} from 'lucide-react';

const MAP: Record<string, LucideIcon> = {
    globe: Globe,
    wrench: Wrench,
    'graduation-cap': GraduationCap,
    shield: Shield,
    'message-circle': MessageCircle,
    'hard-drive': HardDrive,
    server: Server,
    'shield-check': ShieldCheck,
    lock: Lock,
    play: Play,
    stop: Square,
    restart: RotateCw,
    activity: Activity,
    'chevron-down': ChevronDown,
    bot: Bot,
    cpu: Cpu,
    memory: MemoryStick,
    disk: HardDriveDownload,
    clock: Clock,
    gauge: Gauge,
    'alert-triangle': AlertTriangle,
    settings: Settings,
    inbox: Inbox,
};

export function getIcon(name: string): LucideIcon {
    return MAP[name] || Shield;
}

export const ICON_NAMES = Object.keys(MAP);

export const COLORS: Record<string, { bg: string; stroke: string; glow: string }> = {
    purple:  { bg: 'rgba(124,108,240,0.12)', stroke: '#7c6cf0', glow: 'rgba(124,108,240,0.06)' },
    emerald: { bg: 'rgba(52,211,153,0.12)',  stroke: '#34d399', glow: 'rgba(52,211,153,0.06)' },
    amber:   { bg: 'rgba(251,191,36,0.12)',  stroke: '#fbbf24', glow: 'rgba(251,191,36,0.06)' },
    mint:    { bg: 'rgba(94,230,176,0.12)',   stroke: '#5ee6b0', glow: 'rgba(94,230,176,0.06)' },
    red:     { bg: 'rgba(239,68,68,0.12)',    stroke: '#ef4444', glow: 'rgba(239,68,68,0.06)' },
    cyan:    { bg: 'rgba(34,211,238,0.12)',   stroke: '#22d3ee', glow: 'rgba(34,211,238,0.06)' },
    indigo:  { bg: 'rgba(99,102,241,0.12)',   stroke: '#6366f1', glow: 'rgba(99,102,241,0.06)' },
};

export const COLOR_NAMES = Object.keys(COLORS);

// Icônes de marque (SVG dans public/brand/icons/), référencées dans layout.json par « brand:<nom> »
export const BRAND_ICONS = ['asgard', 'odin', 'heimdall', 'heimdall-2', 'bifrost', 'yggdrasil', 'hermod', 'draupnir'];

export const isBrandIcon = (name?: string) => !!name && name.startsWith('brand:');

export function IconView({ name, size, color, strokeWidth }: { name: string; size: number; color?: string; strokeWidth?: number }) {
    if (isBrandIcon(name)) {
        return <img src={`/brand/icons/${name.slice(6)}.svg`} width={size} height={size} alt="" draggable={false} style={{ display: 'block' }} />;
    }
    const I = getIcon(name);
    return <I size={size} color={color} strokeWidth={strokeWidth} />;
}
