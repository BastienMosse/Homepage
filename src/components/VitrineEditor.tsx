import { useState, useEffect, useRef, Fragment, type ReactNode } from 'react';
import type { Vitrine, VitrineBlock, VitrineBlockType, VitrineItem } from '../types.ts';
import { BRAND_ICONS } from './Icons.tsx';
import {
    ArrowLeft, Save, GripVertical, ChevronUp, ChevronDown, ChevronRight, Eye, EyeOff, Plus, Trash2,
    Lock, Unlock, Monitor, Smartphone, ExternalLink, RotateCcw, LayoutTemplate,
} from 'lucide-react';

const BLOCK_LABELS: Record<VitrineBlockType, string> = {
    realms: 'Portail',
    classic: 'Bloc classique',
};

const VITRINE_URL = 'https://lucipher-lab.fr';
const DESKTOP_WIDTH = 1280;

function move<T>(list: T[], from: number, to: number): T[] {
    const next = [...list];
    const [it] = next.splice(from, 1);
    next.splice(Math.max(0, Math.min(to, next.length)), 0, it);
    return next;
}

function uid(prefix: string, taken: string[]) {
    let i = 1;
    while (taken.includes(`${prefix}-${i}`)) i++;
    return `${prefix}-${i}`;
}

// Liste réordonnable à la poignée, au pointeur (souris ET doigt — l'API drag HTML5 ne marche pas au tactile)
function useReorder(count: number, onMove: (from: number, to: number) => void) {
    const [drag, setDrag] = useState<number | null>(null);
    const [over, setOver] = useState<number | null>(null);
    const rows = useRef<(HTMLElement | null)[]>([]);
    const onMoveRef = useRef(onMove);
    onMoveRef.current = onMove;

    function start(from: number, e: React.PointerEvent) {
        e.preventDefault();
        e.stopPropagation();
        let target = from;
        setDrag(from);
        setOver(from);
        const onPointerMove = (ev: PointerEvent) => {
            target = count;
            for (let j = 0; j < count; j++) {
                const r = rows.current[j]?.getBoundingClientRect();
                if (r && ev.clientY < r.top + r.height / 2) { target = j; break; }
            }
            setOver(target);
            if (ev.clientY < 70) window.scrollBy(0, -14);
            else if (ev.clientY > window.innerHeight - 90) window.scrollBy(0, 14);
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            setDrag(null);
            setOver(null);
            if (target !== from && target !== from + 1) onMoveRef.current(from, target > from ? target - 1 : target);
        };
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
    }

    return {
        drag,
        // Ligne d'insertion affichée avant l'élément i (ou à la fin si i === count)
        lineAt: (i: number) => drag !== null && over === i && i !== drag && i !== drag + 1,
        rowRef: (i: number) => (el: HTMLElement | null) => { rows.current[i] = el; },
        handle: (i: number) => ({
            onPointerDown: (e: React.PointerEvent) => start(i, e),
            onClick: (e: React.MouseEvent) => e.stopPropagation(),
            style: { touchAction: 'none' as const },
            title: 'Glisser pour déplacer',
        }),
    };
}

export default function VitrineEditor({ onBack }: { onBack: () => void }) {
    const [vitrine, setVitrine] = useState<Vitrine | null>(null);
    const [defaults, setDefaults] = useState<Vitrine | null>(null);
    const [original, setOriginal] = useState('');
    const [open, setOpen] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');
    // Sur téléphone : aperçu mobile par défaut, et on bascule entre édition et aperçu
    const [device, setDevice] = useState<'desktop' | 'mobile'>(() => (window.innerWidth < 900 ? 'mobile' : 'desktop'));
    const [mobileView, setMobileView] = useState<'edit' | 'preview'>('edit');
    const [html, setHtml] = useState('');
    const [adding, setAdding] = useState(false);

    const frameRef = useRef<HTMLIFrameElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const scrollY = useRef(0);
    const [stageWidth, setStageWidth] = useState(0);

    useEffect(() => {
        fetch('/api/admin/vitrine').then(r => r.json()).then(d => {
            setVitrine(d.vitrine);
            setDefaults(d.defaults);
            setOriginal(JSON.stringify(d.vitrine));
        });
    }, []);

    // Aperçu : rendu serveur du brouillon, rafraîchi 350 ms après la dernière modif
    useEffect(() => {
        if (!vitrine) return;
        const t = setTimeout(() => {
            fetch('/api/admin/vitrine/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(vitrine),
            }).then(r => r.text()).then(setHtml).catch(() => {});
        }, 350);
        return () => clearTimeout(t);
    }, [vitrine]);

    useEffect(() => {
        function onMsg(e: MessageEvent) {
            if (e.source === frameRef.current?.contentWindow && typeof e.data?.vitrineScroll === 'number') scrollY.current = e.data.vitrineScroll;
        }
        window.addEventListener('message', onMsg);
        return () => window.removeEventListener('message', onMsg);
    }, []);

    useEffect(() => {
        const el = stageRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setStageWidth(el.clientWidth));
        ro.observe(el);
        return () => ro.disconnect();
    }, [vitrine === null]);

    const blockList = useReorder(vitrine?.blocks.length ?? 0,
        (from, to) => setVitrine(v => v && ({ ...v, blocks: move(v.blocks, from, to) })));

    if (!vitrine) {
        return <div className="ve"><p style={{ color: 'var(--text-dim)' }}>Chargement...</p></div>;
    }

    const dirty = JSON.stringify(vitrine) !== original;

    function setHero(u: Partial<Vitrine['hero']>) {
        setVitrine(v => v && ({ ...v, hero: { ...v.hero, ...u } }));
    }

    function setBlock(i: number, u: Partial<VitrineBlock>) {
        setVitrine(v => v && ({ ...v, blocks: v.blocks.map((b, j) => (j === i ? { ...b, ...u } : b)) }));
    }

    function focus(id: string) {
        setOpen(o => (o === id ? null : id));
        frameRef.current?.contentWindow?.postMessage({ scrollTo: id }, '*');
    }

    function moveBlock(i: number, dir: -1 | 1) {
        setVitrine(v => v && ({ ...v, blocks: move(v.blocks, i, i + dir) }));
    }

    function addBlock(type: VitrineBlockType) {
        const id = uid(type === 'realms' ? 'portail' : 'bloc', vitrine!.blocks.map(b => b.id));
        const block: VitrineBlock = { id, type, visible: true, kicker: '', title: type === 'realms' ? 'Les royaumes' : 'Nouveau bloc', text: '', items: [] };
        setVitrine({ ...vitrine!, blocks: [...vitrine!.blocks, block] });
        setOpen(id);
        setAdding(false);
    }

    async function handleSave() {
        setSaving(true);
        setError('');
        try {
            const res = await fetch('/api/admin/vitrine', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(vitrine),
            });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || res.statusText);
            setVitrine(d.vitrine);
            setOriginal(JSON.stringify(d.vitrine));
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (e) {
            setError(`Échec de la sauvegarde : ${(e as Error).message}`);
        }
        setSaving(false);
    }

    const scale = device === 'desktop' && stageWidth ? Math.min(1, stageWidth / DESKTOP_WIDTH) : 1;
    const hero = vitrine.hero;

    return (
        <div className="ve">
            <div className="le-header">
                <button className="bm-back" onClick={onBack}>
                    <ArrowLeft size={14} />
                    Retour
                </button>
                <h2>Vitrine <span className="ve-host">lucipher-lab.fr</span></h2>
                <div className="le-actions">
                    {saved && <span className="le-saved">Publi&eacute;</span>}
                    {defaults && (
                        <button className="le-icon-btn" title="Revenir au contenu d'origine (non publié tant que tu ne sauvegardes pas)"
                            onClick={() => { if (confirm('Remplacer le brouillon par le contenu d\'origine ?')) setVitrine(defaults); }}>
                            <RotateCcw size={12} />
                        </button>
                    )}
                    {dirty && (
                        <>
                            <button className="btn btn-ghost btn-sm" onClick={() => setVitrine(JSON.parse(original))}>Annuler</button>
                            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                                <Save size={12} />
                                {saving ? '...' : 'Publier'}
                            </button>
                        </>
                    )}
                </div>
            </div>
            {error && <p className="le-error" style={{ marginBottom: 12 }}>{error}</p>}

            <div className="ve-mobile-switch">
                <button className={mobileView === 'edit' ? 'active' : ''} onClick={() => setMobileView('edit')}>Édition</button>
                <button className={mobileView === 'preview' ? 'active' : ''} onClick={() => setMobileView('preview')}>Aperçu</button>
            </div>

            <div className={`ve-layout ve-show-${mobileView}`}>
                <div className="ve-panel">
                    {/* En-tête */}
                    <div className={`ve-block ${hero.visible ? '' : 've-off'}`}>
                        <div className="ve-block-head" onClick={() => focus('accueil')}>
                            <LayoutTemplate size={13} />
                            <span className="ve-block-title">En-t&ecirc;te</span>
                            <span className="le-badge le-badge-dim">fixe en haut</span>
                            <VisibleToggle on={hero.visible} onChange={v => setHero({ visible: v })} />
                            <ChevronRight size={14} className={`ve-chev ${open === 'accueil' ? 've-chev-open' : ''}`} />
                        </div>
                        {open === 'accueil' && (
                            <div className="ve-block-body">
                                <label className="le-checkbox" style={{ marginTop: 0 }}>
                                    <input type="checkbox" checked={hero.showGate} onChange={e => setHero({ showGate: e.target.checked })} />
                                    Afficher la Porte des 7 royaumes
                                </label>
                                <Field label="Titre" value={hero.title} onChange={v => setHero({ title: v })} />
                                <Field label="Baseline" value={hero.tagline} onChange={v => setHero({ tagline: v })} />
                                <Field label="Texte" value={hero.lead} onChange={v => setHero({ lead: v })} multiline />
                                <div className="ve-row">
                                    <Field label="Bouton principal" value={hero.primary.label} onChange={v => setHero({ primary: { ...hero.primary, label: v } })} />
                                    <Field label="Lien" value={hero.primary.href} onChange={v => setHero({ primary: { ...hero.primary, href: v } })} placeholder="#royaumes" />
                                </div>
                                <div className="ve-row">
                                    <Field label="Bouton secondaire" value={hero.secondary.label} onChange={v => setHero({ secondary: { ...hero.secondary, label: v } })} />
                                    <Field label="Lien" value={hero.secondary.href} onChange={v => setHero({ secondary: { ...hero.secondary, href: v } })} placeholder="https://..." />
                                </div>
                                <p className="le-hint">Lien vers un bloc : #id du bloc ({vitrine.blocks.map(b => `#${b.id}`).join(', ')})</p>
                            </div>
                        )}
                    </div>

                    {/* Blocs réordonnables */}
                    {vitrine.blocks.map((b, i) => (
                        <Fragment key={b.id}>
                            {blockList.lineAt(i) && <div className="le-section-drop-line" />}
                            <div ref={blockList.rowRef(i)} className={`ve-block ${b.visible ? '' : 've-off'} ${blockList.drag === i ? 've-dragging' : ''}`}>
                                <div className="ve-block-head" onClick={() => focus(b.id)}>
                                    <span className="ve-grip" {...blockList.handle(i)}><GripVertical size={16} /></span>
                                    <span className="ve-block-title">{b.title || b.kicker || BLOCK_LABELS[b.type]}</span>
                                    {b.type === 'realms' && <span className="le-badge">{BLOCK_LABELS.realms}</span>}
                                    {b.items.length > 0 && <span className="le-badge le-badge-dim">{b.items.filter(x => x.visible).length}/{b.items.length}</span>}
                                    <div className="ve-arrows" onClick={e => e.stopPropagation()}>
                                        <button className="le-icon-btn" disabled={i === 0} title="Monter" onClick={() => moveBlock(i, -1)}><ChevronUp size={14} /></button>
                                        <button className="le-icon-btn" disabled={i === vitrine.blocks.length - 1} title="Descendre" onClick={() => moveBlock(i, 1)}><ChevronDown size={14} /></button>
                                    </div>
                                    <VisibleToggle on={b.visible} onChange={v => setBlock(i, { visible: v })} />
                                    <ChevronRight size={14} className={`ve-chev ${open === b.id ? 've-chev-open' : ''}`} />
                                </div>
                                {open === b.id && (
                                    <BlockForm
                                        block={b}
                                        onChange={u => setBlock(i, u)}
                                        onDelete={() => {
                                            if (!confirm(`Supprimer le bloc « ${b.title || b.id} » ?`)) return;
                                            setVitrine({ ...vitrine, blocks: vitrine.blocks.filter((_, j) => j !== i) });
                                        }}
                                    />
                                )}
                            </div>
                        </Fragment>
                    ))}
                    {blockList.lineAt(vitrine.blocks.length) && <div className="le-section-drop-line" />}

                    {adding ? (
                        <div className="ve-add-menu">
                            <button className="btn btn-ghost btn-sm" onClick={() => addBlock('classic')}>Bloc classique (titre, texte, services)</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => addBlock('realms')}>Portail (portes des royaumes)</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Annuler</button>
                        </div>
                    ) : (
                        <button className="le-add-section" onClick={() => setAdding(true)}>
                            <Plus size={14} />
                            Ajouter un bloc
                        </button>
                    )}
                </div>

                <div className="ve-preview">
                    <div className="ve-preview-bar">
                        <span className={`ve-dirty-dot ${dirty ? 'on' : ''}`} />
                        <span>{dirty ? 'Brouillon non publié' : 'Identique au site en ligne'}</span>
                        <div className="ve-device">
                            <button className={device === 'desktop' ? 'active' : ''} onClick={() => setDevice('desktop')} title="Ordinateur"><Monitor size={13} /></button>
                            <button className={device === 'mobile' ? 'active' : ''} onClick={() => setDevice('mobile')} title="Mobile"><Smartphone size={13} /></button>
                        </div>
                        <a className="le-icon-btn" href={VITRINE_URL} target="_blank" rel="noopener noreferrer" title="Ouvrir le site en ligne"><ExternalLink size={12} /></a>
                    </div>
                    <div className="ve-stage" ref={stageRef}>
                        <iframe
                            ref={frameRef}
                            title="Aperçu de la vitrine"
                            sandbox="allow-scripts allow-popups"
                            srcDoc={html}
                            onLoad={() => frameRef.current?.contentWindow?.postMessage({ scrollY: scrollY.current }, '*')}
                            className={device === 'mobile' ? 've-frame-mobile' : ''}
                            style={device === 'desktop'
                                ? { width: DESKTOP_WIDTH, height: `${100 / scale}%`, transform: `scale(${scale})` }
                                : undefined}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

function VisibleToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
    return (
        <button className={`le-icon-btn ${on ? '' : 've-toggle-off'}`} title={on ? 'Visible (cliquer pour masquer)' : 'Masqué (cliquer pour afficher)'}
            onClick={e => { e.stopPropagation(); onChange(!on); }}>
            {on ? <Eye size={11} /> : <EyeOff size={11} />}
        </button>
    );
}

function Field({ label, value, onChange, multiline, placeholder }: {
    label: string; value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string;
}) {
    return (
        <label className="ve-field">
            <span className="le-label">{label}</span>
            {multiline
                ? <textarea value={value} onChange={e => onChange(e.target.value)} rows={3} placeholder={placeholder} />
                : <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />}
        </label>
    );
}

function BlockForm({ block, onChange, onDelete }: {
    block: VitrineBlock;
    onChange: (u: Partial<VitrineBlock>) => void;
    onDelete: () => void;
}) {
    const items = block.items;
    const [openItem, setOpenItem] = useState<string | null>(null);
    const list = useReorder(items.length, (from, to) => onChange({ items: move(items, from, to) }));

    function setItem(i: number, u: Partial<VitrineItem>) {
        onChange({ items: items.map((it, j) => (j === i ? { ...it, ...u } : it)) });
    }

    function addItem() {
        const id = uid(block.type === 'realms' ? 'porte' : 'service', items.map(it => it.id));
        const item: VitrineItem = block.type === 'realms'
            ? { id, name: 'Nouvelle porte', subtitle: '', desc: '', url: '', icon: 'lucipher-lab', open: false, label: 'Ouvrir →', visible: true }
            : { id, name: 'Nouveau service', desc: '', url: '', icon: '', visible: true };
        onChange({ items: [...items, item] });
        setOpenItem(id);
    }

    return (
        <div className="ve-block-body">
            <Field label="Surtitre" value={block.kicker} onChange={v => onChange({ kicker: v })} />
            <Field label="Titre" value={block.title} onChange={v => onChange({ title: v })} />
            <Field label="Texte" value={block.text} onChange={v => onChange({ text: v })} multiline />
            <span className="le-label">{block.type === 'realms' ? 'Portes' : 'Services'} — glisser la poignée pour réordonner</span>
            <div className="ve-items">
                        {items.map((it, i) => (
                            <Fragment key={it.id}>
                                {list.lineAt(i) && <div className="le-drop-line" />}
                                <div ref={list.rowRef(i)} className={`ve-item ${it.visible ? '' : 've-off'} ${list.drag === i ? 've-dragging' : ''}`}>
                                    <div className="ve-item-head" onClick={() => setOpenItem(o => (o === it.id ? null : it.id))}>
                                        <span className="ve-grip" {...list.handle(i)}><GripVertical size={15} /></span>
                                        {it.icon && <ItemIcon icon={it.icon} size={26} />}
                                        <div className="le-card-info">
                                            <div className="le-card-name">{it.name || '(sans nom)'}</div>
                                            <div className="le-card-desc">{it.subtitle || it.url || it.desc}</div>
                                        </div>
                                        {block.type === 'realms' && (
                                            <button className={`ve-door ${it.open ? 've-door-open' : ''}`}
                                                title={it.open ? 'Porte ouverte : lien actif (cliquer pour fermer)' : 'Porte fermée : « Réservé » (cliquer pour ouvrir)'}
                                                onClick={e => { e.stopPropagation(); setItem(i, { open: !it.open }); }}>
                                                {it.open ? <Unlock size={11} /> : <Lock size={11} />}
                                                {it.open ? 'Ouverte' : 'Fermée'}
                                            </button>
                                        )}
                                        <VisibleToggle on={it.visible} onChange={v => setItem(i, { visible: v })} />
                                    </div>
                                    {openItem === it.id && (
                                        <ItemForm type={block.type} item={it} onChange={u => setItem(i, u)}
                                            onDelete={() => onChange({ items: items.filter((_, j) => j !== i) })} />
                                    )}
                                </div>
                            </Fragment>
                        ))}
                        {list.lineAt(items.length) && <div className="le-drop-line" />}
                        <button className="le-add-section" style={{ padding: 10 }} onClick={addItem}>
                            <Plus size={13} />
                            {block.type === 'realms' ? 'Ajouter une porte' : 'Ajouter un service'}
                        </button>
            </div>

            <div className="ve-block-foot">
                <span className="le-hint">Ancre : #{block.id}</span>
                <button className="btn btn-ghost btn-sm" style={{ color: '#e2685f', flex: 'none' }} onClick={onDelete}>
                    <Trash2 size={12} /> Supprimer le bloc
                </button>
            </div>
        </div>
    );
}

function ItemIcon({ icon, size }: { icon?: string; size: number }) {
    if (!icon) return <span style={{ width: size, height: size, flexShrink: 0 }} />;
    const src = /^[a-z0-9-]+$/.test(icon) ? `/brand/icons/${icon}.svg` : icon;
    return <img src={src} width={size} height={size} alt="" draggable={false} style={{ flexShrink: 0 }} />;
}

function ItemForm({ type, item, onChange, onDelete }: {
    type: VitrineBlockType;
    item: VitrineItem;
    onChange: (u: Partial<VitrineItem>) => void;
    onDelete: () => void;
}): ReactNode {
    const custom = !!item.icon && !BRAND_ICONS.includes(item.icon);
    return (
        <div className="ve-item-body">
            <div className="ve-row">
                <Field label="Nom" value={item.name} onChange={v => onChange({ name: v })} />
                {type === 'realms' && <Field label="Sous-titre" value={item.subtitle || ''} onChange={v => onChange({ subtitle: v })} />}
            </div>
            <Field label="Description" value={item.desc} onChange={v => onChange({ desc: v })} multiline />
            <div className="ve-row">
                <Field label="URL" value={item.url} onChange={v => onChange({ url: v })} placeholder="https://..." />
                {type === 'realms' && <Field label="Texte du bouton" value={item.label || ''} onChange={v => onChange({ label: v })} placeholder="Ouvrir →" />}
            </div>
            <>
                    <span className="le-label">Ic&ocirc;ne{type === 'classic' ? ' (facultative)' : ''}</span>
                    <div className="le-icon-picker">
                        {type === 'classic' && (
                            <button className={`le-icon-option ${!item.icon ? 'active' : ''}`} onClick={() => onChange({ icon: '' })} title="Sans icône">∅</button>
                        )}
                        {BRAND_ICONS.map(b => (
                            <button key={b} className={`le-icon-option le-icon-option-brand ${item.icon === b ? 'active' : ''}`}
                                onClick={() => onChange({ icon: b })} title={b}>
                                <ItemIcon icon={b} size={26} />
                            </button>
                        ))}
                    </div>
                    <Field label="…ou URL d'image" value={custom ? item.icon || '' : ''} onChange={v => onChange({ icon: v })} placeholder="/brand/... ou https://..." />
                    {type === 'realms' && item.open && !item.url && <p className="le-error">Porte ouverte sans URL : elle s'affichera « Réservé ».</p>}
            </>
            <div className="ve-block-foot">
                <button className="btn btn-ghost btn-sm" style={{ color: '#e2685f', flex: 'none' }} onClick={onDelete}>
                    <Trash2 size={12} /> Retirer
                </button>
            </div>
        </div>
    );
}
