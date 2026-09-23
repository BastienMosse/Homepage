import type { Section } from '../types.ts';
import { getIcon } from './Icons.tsx';
import ServiceCard from './ServiceCard.tsx';

export default function SectionBlock({ section, delay }: { section: Section; delay: number }) {
    const Icon = getIcon(section.icon);

    return (
        <div className="section" style={{ animationDelay: `${delay}s` }}>
            <div className="section-header">
                <Icon />
                {section.label}
            </div>
            <div className="cards">
                {section.items.map(item => (
                    <ServiceCard key={item.name} item={item} />
                ))}
            </div>
        </div>
    );
}
