import { useState, useEffect, useCallback } from 'react';
import type { Section, ContainerGroup, ServerStats } from './types.ts';
import SectionBlock from './components/SectionBlock.tsx';
import ServerStatsPanel from './components/ServerStats.tsx';
import LoginModal from './components/LoginModal.tsx';
import { Play, Square, RotateCw, ShieldCheck, Lock, Activity, LogOut, Bot } from 'lucide-react';
import ServiceCard from './components/ServiceCard.tsx';

export default function App() {
    const [sections, setSections] = useState<Section[]>([]);
    const [authed, setAuthed] = useState(false);
    const [showLogin, setShowLogin] = useState(false);
    const [adminOpen, setAdminOpen] = useState(false);
    const [groups, setGroups] = useState<ContainerGroup[]>([]);
    const [adminSections, setAdminSections] = useState<Section[]>([]);
    const [stats, setStats] = useState<ServerStats | null>(null);
    const [loadingAction, setLoadingAction] = useState<string | null>(null);

    useEffect(() => {
        fetch('/api/config').then(r => r.json()).then(d => setSections(d.sections || []));
        fetch('/api/auth/check').then(r => r.json()).then(d => setAuthed(d.authed));
    }, []);

    const loadAdmin = useCallback(() => {
        fetch('/api/admin/containers').then(r => r.json()).then(d => setGroups(d.containers || []));
        fetch('/api/admin/services').then(r => r.json()).then(d => setAdminSections(d.sections || []));
        fetch('/api/admin/stats').then(r => r.json()).then(d => setStats(d));
    }, []);

    useEffect(() => {
        if (!authed) return;
        loadAdmin();
        const iv = setInterval(loadAdmin, 5000);
        return () => clearInterval(iv);
    }, [authed, loadAdmin]);

    async function containerAction(id: string, action: string) {
        setLoadingAction(`${id}-${action}`);
        await fetch(`/api/admin/containers/${id}/${action}`, { method: 'POST' });
        setTimeout(loadAdmin, 1500);
        setLoadingAction(null);
    }

    function statusClass(state: string) {
        if (state === 'running') return 'running';
        if (state === 'exited') return 'exited';
        return 'other';
    }

    return (
        <>
            <div className="glow glow-1" />
            <div className="glow glow-2" />

            <div className="page">
                <header className="hero">
                    <div className="logo">lucipher-lab</div>
                    <div className="tagline">Infrastructure & Services</div>
                    <button className="admin-toggle" onClick={() => authed ? setAdminOpen(v => !v) : setShowLogin(true)}>
                        {authed ? <ShieldCheck size={13} /> : <Lock size={13} />}
                        {authed
                            ? (adminOpen ? 'Masquer le panneau' : 'Panneau admin')
                            : 'Connexion admin'
                        }
                    </button>
                </header>

                {sections.map((s, i) => (
                    <SectionBlock key={s.id} section={s} delay={0.15 + i * 0.1} />
                ))}

                {authed && adminOpen && (
                    <div className="admin-panel">
                        <div className="admin-badge">
                            <ShieldCheck size={10} />
                            Connecté en tant qu'administrateur
                            <button
                                onClick={async () => {
                                    await fetch('/api/auth/logout', { method: 'POST' });
                                    setAuthed(false); setAdminOpen(false);
                                    setGroups([]); setStats(null); setAdminSections([]);
                                }}
                                style={{ marginLeft: 8, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
                                title="Déconnexion"
                            >
                                <LogOut size={10} />
                            </button>
                        </div>

                        {/* Server stats */}
                        <div className="section" style={{ animationDelay: '.05s' }}>
                            <div className="section-header">
                                <Activity size={14} />
                                Serveur
                            </div>
                            <ServerStatsPanel stats={stats} />
                        </div>

                        {/* Admin-only sections (bots/services) */}
                        {adminSections.map(s => (
                            <div key={s.id} className="section" style={{ animationDelay: '.1s' }}>
                                <div className="section-header">
                                    <Bot size={14} />
                                    {s.label}
                                </div>
                                <div className="cards">
                                    {s.items.map(item => (
                                        <ServiceCard key={item.name} item={item} />
                                    ))}
                                </div>
                            </div>
                        ))}

                        {/* Container monitoring */}
                        <div className="section" style={{ animationDelay: '.15s' }}>
                            <div className="section-header">
                                <Activity size={14} />
                                Conteneurs
                            </div>
                            {groups.length === 0 ? (
                                <p style={{ color: 'var(--text-dim)', fontSize: '.8rem' }}>
                                    Aucun conteneur détecté
                                </p>
                            ) : (
                                <div className="monitor-grid">
                                    {groups.map(g => (
                                        <div key={g.label} className="container-group">
                                            <div className="group-label">{g.label}</div>
                                            {g.containers.map(c => (
                                                <div key={c.id} className="container-row">
                                                    <span className={`status-dot ${statusClass(c.state)}`} />
                                                    <span className="container-name" title={c.status}>{c.name}</span>
                                                    <div className="container-actions">
                                                        {c.state !== 'running' && (
                                                            <button title="Démarrer" onClick={() => containerAction(c.id, 'start')} disabled={loadingAction === `${c.id}-start`}>
                                                                <Play size={12} />
                                                            </button>
                                                        )}
                                                        {c.state === 'running' && (
                                                            <button title="Stopper" onClick={() => containerAction(c.id, 'stop')} disabled={loadingAction === `${c.id}-stop`}>
                                                                <Square size={12} />
                                                            </button>
                                                        )}
                                                        <button title="Redémarrer" onClick={() => containerAction(c.id, 'restart')} disabled={loadingAction === `${c.id}-restart`}>
                                                            <RotateCw size={12} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <footer className="footer">
                    <span>lucipher-lab</span> — infrastructure personnelle
                </footer>
            </div>

            {showLogin && (
                <LoginModal onSuccess={() => { setShowLogin(false); setAuthed(true); }} onClose={() => setShowLogin(false)} />
            )}
        </>
    );
}
