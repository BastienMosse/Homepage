import { useState, useEffect } from 'react';
import { getIcon, COLORS, ICON_NAMES, COLOR_NAMES } from './Icons.tsx';
import { ArrowLeft, Pencil, GripVertical, Plus, EyeOff, Save, Trash2 } from 'lucide-react';

interface LayoutSection { label: string; icon: string; order: number; adminOnly?: boolean; hidden?: boolean; }
interface LayoutService { name: string; icon: string; color: string; desc: string; url?: string; section: string; order: number; hidden?: boolean; }
interface LayoutData {
    sections: Record<string, LayoutSection>;
    services: Record<string, LayoutService>;
    static: Array<LayoutService & { section: string }>;
}

export default function LayoutEditor({ onBack }: { onBack: () => void }) {
    const [layout, setLayout] = useState<LayoutData | null>(null);
    const [original, setOriginal] = useState('');
    const [liveState, setLiveState] = useState<Record<string, string>>({});
    const [editCard, setEditCard] = useState<string | null>(null);
    const [editSection, setEditSection] = useState<string | null>(null);
    const [addingSection, setAddingSection] = useState(false);
    const [dragKey, setDragKey] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        fetch('/api/admin/layout')
            .then(r => r.json())
            .then(d => {
                setLayout(d.layout);
                setOriginal(JSON.stringify(d.layout));
                setLiveState(d.states || {});
            });
    }, []);

    const dirty = layout ? JSON.stringify(layout) !== original : false;

    function updateService(key: string, updates: Partial<LayoutService>) {
        if (!layout) return;
        setLayout({ ...layout, services: { ...layout.services, [key]: { ...layout.services[key], ...updates } } });
    }

    function deleteService(key: string) {
        if (!layout) return;
        const s = { ...layout.services };
        delete s[key];
        setLayout({ ...layout, services: s });
    }

    function updateSection(id: string, updates: Partial<LayoutSection>) {
        if (!layout) return;
        setLayout({ ...layout, sections: { ...layout.sections, [id]: { ...layout.sections[id], ...updates } } });
    }

    function deleteSection(id: string) {
        if (!layout) return;
        const svc = { ...layout.services };
        for (const [k, v] of Object.entries(svc)) {
            if (v.section === id) svc[k] = { ...v, section: '_new' };
        }
        const sec = { ...layout.sections };
        delete sec[id];
        setLayout({ ...layout, sections: sec, services: svc });
    }

    function addSection(id: string, label: string) {
        if (!layout || layout.sections[id]) return;
        const maxOrder = Math.max(0, ...Object.values(layout.sections).map(s => s.order ?? 0));
        setLayout({
            ...layout,
            sections: { ...layout.sections, [id]: { label, icon: 'server', order: maxOrder + 1, adminOnly: false } },
        });
    }

    function handleDrop(sectionId: string) {
        if (!dragKey || !layout) return;
        const maxOrder = Math.max(0, ...Object.values(layout.services)
            .filter(s => s.section === sectionId).map(s => s.order ?? 0));
        updateService(dragKey, { section: sectionId, order: maxOrder + 1 });
        setDragKey(null);
        setDropTarget(null);
    }

    async function handleSave() {
        if (!layout) return;
        setSaving(true);
        const res = await fetch('/api/admin/layout', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(layout),
        });
        if (res.ok) {
            setOriginal(JSON.stringify(layout));
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        }
        setSaving(false);
    }

    function handleCancel() {
        if (original) setLayout(JSON.parse(original));
    }

    if (!layout) {
        return <div className="layout-editor"><p style={{ color: 'var(--text-dim)' }}>Chargement...</p></div>;
    }

    const sortedSections = Object.entries(layout.sections)
        .sort(([, a], [, b]) => (a.order ?? 99) - (b.order ?? 99));

    function sectionItems(sectionId: string) {
        return Object.entries(layout!.services)
            .filter(([, svc]) => svc.section === sectionId)
            .sort(([, a], [, b]) => (a.order ?? 99) - (b.order ?? 99));
    }

    function sectionStaticItems(sectionId: string) {
        return (layout!.static || []).filter(s => s.section === sectionId);
    }

    return (
        <div className="layout-editor">
            <div className="le-header">
                <button className="bm-back" onClick={onBack}>
                    <ArrowLeft size={14} />
                    Retour
                </button>
                <h2>Modifier le layout</h2>
                <div className="le-actions">
                    {saved && <span className="le-saved">Sauvegardé</span>}
                    {dirty && (
                        <>
                            <button className="btn btn-ghost btn-sm" onClick={handleCancel}>Annuler</button>
                            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                                <Save size={12} />
                                {saving ? '...' : 'Sauvegarder'}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {sortedSections.map(([id, def]) => {
                const SectionIcon = getIcon(def.icon);
                const items = sectionItems(id);
                const statics = sectionStaticItems(id);

                return (
                    <div
                        key={id}
                        className={`le-section ${dropTarget === id ? 'le-drop-target' : ''} ${def.hidden ? 'le-section-hidden' : ''}`}
                        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTarget(id); }}
                        onDragLeave={e => { if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null); }}
                        onDrop={e => { e.preventDefault(); handleDrop(id); }}
                    >
                        <div className="le-section-header">
                            <SectionIcon size={14} />
                            <span>{def.label}</span>
                            {def.adminOnly && <span className="le-badge">admin</span>}
                            {def.hidden && <span className="le-badge le-badge-dim">masqué</span>}
                            <button className="le-icon-btn" onClick={() => setEditSection(id)} title="Modifier la section">
                                <Pencil size={11} />
                            </button>
                        </div>
                        <div className="le-cards">
                            {statics.map((s, i) => {
                                const SIcon = getIcon(s.icon);
                                const c = COLORS[s.color] || COLORS.purple;
                                return (
                                    <div key={`s-${i}`} className="le-card le-card-static">
                                        <div className="le-card-grip"><GripVertical size={14} /></div>
                                        <div className="le-card-icon" style={{ background: c.bg }}>
                                            <SIcon size={16} color={c.stroke} strokeWidth={1.8} />
                                        </div>
                                        <div className="le-card-info">
                                            <div className="le-card-name">{s.name}</div>
                                            <div className="le-card-desc">{s.desc}</div>
                                        </div>
                                        <span className="le-badge le-badge-dim">statique</span>
                                    </div>
                                );
                            })}
                            {items.map(([key, svc]) => {
                                const SIcon = getIcon(svc.icon);
                                const c = COLORS[svc.color] || COLORS.purple;
                                const state = liveState[key];
                                return (
                                    <div
                                        key={key}
                                        className={`le-card ${svc.hidden ? 'le-card-hidden' : ''} ${dragKey === key ? 'le-card-dragging' : ''}`}
                                        draggable
                                        onDragStart={e => { setDragKey(key); e.dataTransfer.effectAllowed = 'move'; }}
                                        onDragEnd={() => { setDragKey(null); setDropTarget(null); }}
                                    >
                                        <div className="le-card-grip"><GripVertical size={14} /></div>
                                        <div className="le-card-icon" style={{ background: c.bg }}>
                                            <SIcon size={16} color={c.stroke} strokeWidth={1.8} />
                                        </div>
                                        <div className="le-card-info">
                                            <div className="le-card-name">{svc.name}</div>
                                            <div className="le-card-desc">{svc.desc || key}</div>
                                        </div>
                                        {state && (
                                            <span className={`card-state-dot ${state === 'running' ? 'running' : 'stopped'}`}
                                                style={{ position: 'static', flexShrink: 0 }} />
                                        )}
                                        {svc.hidden && <EyeOff size={12} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />}
                                        <button className="le-icon-btn" onClick={() => setEditCard(key)} title="Modifier">
                                            <Pencil size={11} />
                                        </button>
                                    </div>
                                );
                            })}
                            {items.length === 0 && statics.length === 0 && (
                                <div className="le-empty">Glisser des cartes ici</div>
                            )}
                        </div>
                    </div>
                );
            })}

            <button className="le-add-section" onClick={() => setAddingSection(true)}>
                <Plus size={14} />
                Ajouter une section
            </button>

            {editCard && layout.services[editCard] && (
                <CardEditModal
                    svc={layout.services[editCard]}
                    onSave={updates => { updateService(editCard, updates); setEditCard(null); }}
                    onDelete={() => { deleteService(editCard); setEditCard(null); }}
                    onClose={() => setEditCard(null)}
                />
            )}

            {editSection && layout.sections[editSection] && (
                <SectionEditModal
                    section={layout.sections[editSection]}
                    id={editSection}
                    onSave={updates => { updateSection(editSection, updates); setEditSection(null); }}
                    onDelete={editSection !== '_new' ? () => { deleteSection(editSection); setEditSection(null); } : undefined}
                    onClose={() => setEditSection(null)}
                />
            )}

            {addingSection && (
                <AddSectionModal
                    existing={Object.keys(layout.sections)}
                    onAdd={(id, label) => { addSection(id, label); setAddingSection(false); }}
                    onClose={() => setAddingSection(false)}
                />
            )}
        </div>
    );
}

function CardEditModal({ svc, onSave, onDelete, onClose }: {
    svc: LayoutService;
    onSave: (u: Partial<LayoutService>) => void;
    onDelete: () => void;
    onClose: () => void;
}) {
    const [form, setForm] = useState({ ...svc });

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal le-modal" onClick={e => e.stopPropagation()}>
                <h3>Modifier la carte</h3>

                <label className="le-label">Nom</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />

                <label className="le-label">Description</label>
                <input value={form.desc} onChange={e => setForm({ ...form, desc: e.target.value })} />

                <label className="le-label">URL</label>
                <input value={form.url || ''} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://..." />

                <label className="le-label">Icône</label>
                <div className="le-icon-picker">
                    {ICON_NAMES.map(name => {
                        const I = getIcon(name);
                        return (
                            <button
                                key={name}
                                className={`le-icon-option ${form.icon === name ? 'active' : ''}`}
                                onClick={() => setForm({ ...form, icon: name })}
                                title={name}
                            >
                                <I size={16} />
                            </button>
                        );
                    })}
                </div>

                <label className="le-label">Couleur</label>
                <div className="le-color-grid">
                    {COLOR_NAMES.map(c => (
                        <button
                            key={c}
                            className={`le-color-swatch ${form.color === c ? 'active' : ''}`}
                            style={{ background: COLORS[c].stroke }}
                            onClick={() => setForm({ ...form, color: c })}
                            title={c}
                        />
                    ))}
                </div>

                <label className="le-label">Ordre</label>
                <input type="number" value={form.order ?? 0}
                    onChange={e => setForm({ ...form, order: parseInt(e.target.value) || 0 })} />

                <label className="le-checkbox">
                    <input type="checkbox" checked={!!form.hidden} onChange={e => setForm({ ...form, hidden: e.target.checked })} />
                    Masquer cette carte
                </label>

                <div className="modal-buttons" style={{ marginTop: 16 }}>
                    <button className="btn btn-ghost" style={{ color: '#e2685f' }} onClick={onDelete} title="Supprimer de la config">
                        <Trash2 size={13} />
                    </button>
                    <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
                    <button className="btn btn-primary" onClick={() => onSave(form)}>Valider</button>
                </div>
            </div>
        </div>
    );
}

function SectionEditModal({ section, id, onSave, onDelete, onClose }: {
    section: LayoutSection;
    id: string;
    onSave: (u: Partial<LayoutSection>) => void;
    onDelete?: () => void;
    onClose: () => void;
}) {
    const [form, setForm] = useState({ ...section });

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal le-modal" onClick={e => e.stopPropagation()}>
                <h3>Section : {section.label}</h3>
                <p className="le-hint" style={{ marginBottom: 12 }}>ID : {id}</p>

                <label className="le-label">Nom</label>
                <input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} />

                <label className="le-label">Icône</label>
                <div className="le-icon-picker">
                    {ICON_NAMES.map(name => {
                        const I = getIcon(name);
                        return (
                            <button
                                key={name}
                                className={`le-icon-option ${form.icon === name ? 'active' : ''}`}
                                onClick={() => setForm({ ...form, icon: name })}
                                title={name}
                            >
                                <I size={16} />
                            </button>
                        );
                    })}
                </div>

                <label className="le-label">Ordre</label>
                <input type="number" value={form.order ?? 0}
                    onChange={e => setForm({ ...form, order: parseInt(e.target.value) || 0 })} />

                <label className="le-checkbox">
                    <input type="checkbox" checked={!!form.adminOnly} onChange={e => setForm({ ...form, adminOnly: e.target.checked })} />
                    Admin uniquement
                </label>

                <label className="le-checkbox">
                    <input type="checkbox" checked={!!form.hidden} onChange={e => setForm({ ...form, hidden: e.target.checked })} />
                    Masquer la section
                </label>

                <div className="modal-buttons" style={{ marginTop: 16 }}>
                    {onDelete && (
                        <button className="btn btn-ghost" style={{ color: '#e2685f' }} onClick={onDelete}>
                            <Trash2 size={13} />
                        </button>
                    )}
                    <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
                    <button className="btn btn-primary" onClick={() => onSave(form)}>Valider</button>
                </div>
            </div>
        </div>
    );
}

function AddSectionModal({ existing, onAdd, onClose }: {
    existing: string[];
    onAdd: (id: string, label: string) => void;
    onClose: () => void;
}) {
    const [label, setLabel] = useState('');
    const id = label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const valid = id.length > 0 && !existing.includes(id) && label.trim().length > 0;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal le-modal" onClick={e => e.stopPropagation()}>
                <h3>Nouvelle section</h3>

                <label className="le-label">Nom</label>
                <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Ex: Monitoring" autoFocus />

                {id && <p className="le-hint">ID : {id}</p>}
                {id && existing.includes(id) && <p className="le-error">Cette section existe déjà</p>}

                <div className="modal-buttons" style={{ marginTop: 16 }}>
                    <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
                    <button className="btn btn-primary" disabled={!valid} onClick={() => onAdd(id, label.trim())}>Créer</button>
                </div>
            </div>
        </div>
    );
}
