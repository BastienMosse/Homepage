import { useState, useEffect, Fragment } from 'react';
import { getIcon, COLORS, ICON_NAMES, COLOR_NAMES } from './Icons.tsx';
import { ArrowLeft, Pencil, GripVertical, Plus, EyeOff, Save, Trash2 } from 'lucide-react';

interface LayoutSection { label: string; icon: string; order: number; adminOnly?: boolean; hidden?: boolean; }
interface LayoutService { name: string; icon: string; color: string; desc: string; url?: string; section: string; order: number; hidden?: boolean; bot?: boolean; }
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
    const [insertInfo, setInsertInfo] = useState<{sectionId: string; index: number} | null>(null);
    const [dragSectionId, setDragSectionId] = useState<string | null>(null);
    const [sectionDropIndex, setSectionDropIndex] = useState<number | null>(null);
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

        const sourceSection = layout.services[dragKey]?.section;

        const targetItems = Object.entries(layout.services)
            .filter(([k, s]) => s.section === sectionId && k !== dragKey)
            .sort(([, a], [, b]) => (a.order ?? 99) - (b.order ?? 99));

        let insertAt = targetItems.length;
        if (insertInfo?.sectionId === sectionId) {
            const allItems = Object.entries(layout.services)
                .filter(([, s]) => s.section === sectionId)
                .sort(([, a], [, b]) => (a.order ?? 99) - (b.order ?? 99));
            const dragIdx = allItems.findIndex(([k]) => k === dragKey);
            insertAt = insertInfo.index;
            if (dragIdx >= 0 && dragIdx < insertAt) insertAt--;
            insertAt = Math.max(0, Math.min(insertAt, targetItems.length));
        }

        targetItems.splice(insertAt, 0, [dragKey, layout.services[dragKey]]);

        const newServices = { ...layout.services };
        newServices[dragKey] = { ...newServices[dragKey], section: sectionId };
        targetItems.forEach(([k], i) => {
            newServices[k] = { ...newServices[k], order: i };
        });

        if (sourceSection && sourceSection !== sectionId) {
            Object.entries(newServices)
                .filter(([, s]) => s.section === sourceSection)
                .sort(([, a], [, b]) => (a.order ?? 99) - (b.order ?? 99))
                .forEach(([k], i) => {
                    newServices[k] = { ...newServices[k], order: i };
                });
        }

        setLayout({ ...layout, services: newServices });
        setDragKey(null);
        setDropTarget(null);
        setInsertInfo(null);
    }

    function handleSectionDrop(targetIndex: number) {
        if (!dragSectionId || !layout) return;

        const sorted = Object.entries(layout.sections)
            .sort(([, a], [, b]) => (a.order ?? 99) - (b.order ?? 99));

        const fromIndex = sorted.findIndex(([id]) => id === dragSectionId);
        if (fromIndex < 0 || fromIndex === targetIndex) return;

        const item = sorted.splice(fromIndex, 1)[0];
        const adjustedTarget = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
        sorted.splice(adjustedTarget, 0, item);

        const newSections = { ...layout.sections };
        sorted.forEach(([id], i) => {
            newSections[id] = { ...newSections[id], order: i };
        });

        setLayout({ ...layout, sections: newSections });
        setDragSectionId(null);
        setSectionDropIndex(null);
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
                    {saved && <span className="le-saved">Sauvegard&eacute;</span>}
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

            {sortedSections.map(([id, def], sectionIdx) => {
                const SectionIcon = getIcon(def.icon);
                const items = sectionItems(id);
                const statics = sectionStaticItems(id);
                const showSectionDropBefore = dragSectionId && dragSectionId !== id && sectionDropIndex === sectionIdx;

                return (
                    <Fragment key={id}>
                        {showSectionDropBefore && <div className="le-section-drop-line" />}
                        <div
                            className={`le-section ${dropTarget === id ? 'le-drop-target' : ''} ${def.hidden ? 'le-section-hidden' : ''} ${dragSectionId === id ? 'le-section-dragging' : ''}`}
                            onDragOver={e => {
                                e.preventDefault();
                                if (dragSectionId) {
                                    e.dataTransfer.dropEffect = 'move';
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setSectionDropIndex(e.clientY < rect.top + rect.height / 2 ? sectionIdx : sectionIdx + 1);
                                } else if (dragKey) {
                                    e.dataTransfer.dropEffect = 'move';
                                    setDropTarget(id);
                                    setInsertInfo({ sectionId: id, index: items.length });
                                }
                            }}
                            onDragLeave={e => {
                                if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
                                    if (!dragSectionId) {
                                        setDropTarget(null);
                                        setInsertInfo(null);
                                    }
                                }
                            }}
                            onDrop={e => {
                                e.preventDefault();
                                if (dragSectionId) {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const dropIdx = e.clientY < rect.top + rect.height / 2 ? sectionIdx : sectionIdx + 1;
                                    handleSectionDrop(dropIdx);
                                } else {
                                    handleDrop(id);
                                }
                            }}
                        >
                            <div
                                className="le-section-header"
                                draggable
                                onDragStart={e => {
                                    setDragSectionId(id);
                                    e.dataTransfer.effectAllowed = 'move';
                                }}
                                onDragEnd={() => {
                                    setDragSectionId(null);
                                    setSectionDropIndex(null);
                                }}
                            >
                                <div className="le-section-grip"><GripVertical size={14} /></div>
                                <SectionIcon size={14} />
                                <span>{def.label}</span>
                                {def.adminOnly && <span className="le-badge">admin</span>}
                                {def.hidden && <span className="le-badge le-badge-dim">masqu&eacute;</span>}
                                <button className="le-icon-btn" onClick={e => { e.stopPropagation(); setEditSection(id); }} title="Modifier la section">
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
                                {items.map(([key, svc], idx) => {
                                    const SIcon = getIcon(svc.icon);
                                    const c = COLORS[svc.color] || COLORS.purple;
                                    const state = liveState[key];
                                    const showBefore = dragKey && dragKey !== key && insertInfo?.sectionId === id && insertInfo.index === idx;
                                    return (
                                        <Fragment key={key}>
                                            {showBefore && <div className="le-drop-line" />}
                                            <div
                                                className={`le-card ${svc.hidden ? 'le-card-hidden' : ''} ${dragKey === key ? 'le-card-dragging' : ''}`}
                                                draggable
                                                onDragStart={e => { setDragKey(key); e.dataTransfer.effectAllowed = 'move'; }}
                                                onDragEnd={() => { setDragKey(null); setDropTarget(null); setInsertInfo(null); }}
                                                onDragOver={e => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    if (dragKey) {
                                                        e.dataTransfer.dropEffect = 'move';
                                                        const rect = e.currentTarget.getBoundingClientRect();
                                                        setInsertInfo({ sectionId: id, index: e.clientY < rect.top + rect.height / 2 ? idx : idx + 1 });
                                                        setDropTarget(id);
                                                    }
                                                }}
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
                                        </Fragment>
                                    );
                                })}
                                {dragKey && insertInfo?.sectionId === id && insertInfo.index === items.length && (
                                    <div className="le-drop-line" />
                                )}
                                {items.length === 0 && statics.length === 0 && !dragKey && (
                                    <div className="le-empty">Glisser des cartes ici</div>
                                )}
                            </div>
                        </div>
                    </Fragment>
                );
            })}

            {dragSectionId && sectionDropIndex === sortedSections.length && (
                <div className="le-section-drop-line" />
            )}

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

                <label className="le-label">Ic&ocirc;ne</label>
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

                <label className="le-checkbox">
                    <input type="checkbox" checked={!!form.bot} onChange={e => setForm({ ...form, bot: e.target.checked })} />
                    Monitoring bots
                </label>

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

                <label className="le-label">Ic&ocirc;ne</label>
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
                {id && existing.includes(id) && <p className="le-error">Cette section existe d&eacute;j&agrave;</p>}

                <div className="modal-buttons" style={{ marginTop: 16 }}>
                    <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
                    <button className="btn btn-primary" disabled={!valid} onClick={() => onAdd(id, label.trim())}>Cr&eacute;er</button>
                </div>
            </div>
        </div>
    );
}
