import type { ServiceItem } from '../types.ts';
import { getIcon, COLORS } from './Icons.tsx';

export default function ServiceCard({ item }: { item: ServiceItem }) {
    const Icon = getIcon(item.icon);
    const c = COLORS[item.color] || COLORS.purple;

    return (
        <a href={item.url} className="card" target="_blank" rel="noopener noreferrer">
            <div className="card-glow" style={{ background: `radial-gradient(circle at 30% 50%, ${c.glow}, transparent 70%)` }} />
            <div className="card-icon" style={{ background: c.bg }}>
                <Icon size={20} color={c.stroke} strokeWidth={1.8} />
            </div>
            <div className="card-text">
                <div className="card-name">{item.name}</div>
                <div className="card-desc">{item.desc}</div>
            </div>
        </a>
    );
}
