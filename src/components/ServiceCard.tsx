import type { ServiceItem } from '../types.ts';
import { COLORS, IconView, isBrandIcon } from './Icons.tsx';

export default function ServiceCard({ item, onClick }: { item: ServiceItem; onClick?: () => void }) {
    const brand = isBrandIcon(item.icon);
    const c = COLORS[item.color] || COLORS.purple;

    const content = (
        <>
            <div className="card-glow" style={{ background: `radial-gradient(circle at 30% 50%, ${c.glow}, transparent 70%)` }} />
            {item.state && item.state !== 'static' && item.state !== 'external' && (
                <span className={`card-state-dot ${item.state === 'running' ? 'running' : 'stopped'}`} />
            )}
            <div className={`card-icon${brand ? ' card-icon-brand' : ''}`} style={brand ? undefined : { background: c.bg }}>
                <IconView name={item.icon} size={brand ? 42 : 20} color={c.stroke} strokeWidth={1.8} />
            </div>
            <div className="card-text">
                <div className="card-name">{item.name}</div>
                <div className="card-desc">{item.desc}</div>
            </div>
        </>
    );

    if (onClick) {
        return <div className="card" style={{ cursor: 'pointer' }} onClick={onClick}>{content}</div>;
    }

    if (!item.url) {
        return <div className="card card-nolink">{content}</div>;
    }

    return (
        <a href={item.url} className="card" target="_blank" rel="noopener noreferrer">
            {content}
        </a>
    );
}
