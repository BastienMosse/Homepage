import { useState } from 'react';
import type { Section } from '../types.ts';
import { getIcon } from './Icons.tsx';
import ServiceCard from './ServiceCard.tsx';
import { ChevronDown } from 'lucide-react';

export default function SectionBlock({ section, delay }: { section: Section; delay: number }) {
    const Icon = getIcon(section.icon);
    const storageKey = `section-collapsed-${section.id}`;

    const [collapsed, setCollapsed] = useState(() => {
        try { return localStorage.getItem(storageKey) === '1'; } catch { return false; }
    });

    function toggle() {
        const next = !collapsed;
        setCollapsed(next);
        try { localStorage.setItem(storageKey, next ? '1' : '0'); } catch {}
    }

    return (
        <div className={`section ${collapsed ? 'section-collapsed' : ''}`} style={{ animationDelay: `${delay}s` }}>
            <div className="section-header" onClick={toggle} style={{ cursor: 'pointer', userSelect: 'none' }}>
                <Icon />
                {section.label}
                <ChevronDown size={14} className={`section-chevron ${collapsed ? 'rotated' : ''}`} />
            </div>
            {!collapsed && (
                <div className="cards">
                    {section.items.map(item => (
                        <ServiceCard key={item.name} item={item} />
                    ))}
                </div>
            )}
        </div>
    );
}
