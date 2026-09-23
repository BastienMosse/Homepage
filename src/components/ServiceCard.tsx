import type { ServiceItem } from '../types.ts';
import { getIcon, COLORS } from './Icons.tsx';

export default function ServiceCard({ item }: { item: ServiceItem }) {
    const Icon = getIcon(item.icon);
    const c = COLORS[item.color] || COLORS.purple;

    const content = (
        <>
            <div className="card-glow" style={{ background: `radial-gradient(circle at 30% 50%, ${c.glow}, transparent 70%)` }} />
            {item.state && item.state !== 'static' && (
                <span className={`card-state-dot ${item.state === 'running' ? 'running' : 'stopped'}`} />
            )}
            <div className="card-icon" style={{ background: c.bg }}>
                <Icon size={20} color={c.stroke} strokeWidth={1.8} />
            </div>
            <div className="card-text">
                <div className="card-name">{item.name}</div>
                <div className="card-desc">{item.desc}</div>
            </div>
        </>
    );

    if (!item.url) {
        return <div className="card card-nolink">{content}</div>;
    }

    return (
        <a href={item.url} className="card" target="_blank" rel="noopener noreferrer">
            {content}
        </a>
    );
}
