import { useState, useEffect, useCallback } from 'react';
import type { Section } from './types.ts';
import SectionBlock from './components/SectionBlock.tsx';
import LoginModal from './components/LoginModal.tsx';
import BotMonitor from './components/BotMonitor.tsx';
import LayoutEditor from './components/LayoutEditor.tsx';
import VitrineEditor from './components/VitrineEditor.tsx';
import ServerPanel from './components/ServerPanel.tsx';
import ServiceCard from './components/ServiceCard.tsx';
import { ShieldCheck, Lock, Activity, LogOut, Bot, ExternalLink, Settings, Home, PanelsTopLeft } from 'lucide-react';

type Page = 'home' | 'vitrine' | 'server' | 'layout' | 'bots';

const NAV: { id: Page; label: string; icon: typeof Home }[] = [
    { id: 'home', label: 'Portail', icon: Home },
    { id: 'vitrine', label: 'Vitrine', icon: PanelsTopLeft },
    { id: 'server', label: 'Serveur', icon: Activity },
    { id: 'layout', label: 'Services', icon: Settings },
    { id: 'bots', label: 'Bots', icon: Bot },
];

export default function App() {
    const [sections, setSections] = useState<Section[]>([]);
    const [authed, setAuthed] = useState(false);
    const [showLogin, setShowLogin] = useState(false);
    const [adminSections, setAdminSections] = useState<Section[]>([]);
    const [page, setPage] = useState<Page>('home');

    const loadPublic = useCallback(() => {
        fetch('/api/config').then(r => r.json()).then(d => setSections(d.sections || []));
    }, []);

    useEffect(() => {
        loadPublic();
        fetch('/api/auth/check').then(r => r.json()).then(d => setAuthed(d.authed));
    }, [loadPublic]);

    useEffect(() => {
        if (!authed) return;
        fetch('/api/admin/services').then(r => r.json()).then(d => setAdminSections(d.sections || []));
    }, [authed, page]);

    function go(p: Page) {
        setPage(p);
        if (p === 'home') loadPublic();
        window.scrollTo(0, 0);
    }

    async function logout() {
        await fetch('/api/auth/logout', { method: 'POST' });
        setAuthed(false);
        setAdminSections([]);
        setPage('home');
    }

    const current = authed ? page : 'home';

    return (
        <>
            <div className="glow glow-1" />
            <div className="glow glow-2" />

            {authed && (
                <nav className="admin-nav">
                    <div className="admin-nav-inner">
                        <img src="/brand/icons/asgard.svg" alt="" width={22} height={22} />
                        {NAV.map(n => (
                            <button key={n.id} className={current === n.id ? 'active' : ''} onClick={() => go(n.id)}>
                                <n.icon size={13} />
                                <span>{n.label}</span>
                            </button>
                        ))}
                        <button className="admin-nav-logout" onClick={logout} title="Déconnexion">
                            <LogOut size={13} />
                        </button>
                    </div>
                </nav>
            )}

            {current === 'bots' && <BotMonitor onBack={() => go('home')} />}
            {current === 'layout' && <LayoutEditor onBack={() => go('home')} />}
            {current === 'vitrine' && <VitrineEditor onBack={() => go('home')} />}

            {current === 'server' && (
                <div className="page">
                    <ServerPanel />
                </div>
            )}

            {current === 'home' && (
                <div className="page">
                    <header className="hero">
                        <img className="hero-mark" src="/brand/icons/asgard.svg" alt="Asgard" width={88} height={88} />
                        <div className="logo">lucipher-lab</div>
                        <div className="tagline">Infrastructure & Services</div>
                        {!authed && (
                            <button className="admin-toggle" onClick={() => setShowLogin(true)}>
                                <Lock size={13} />
                                Connexion admin
                            </button>
                        )}
                    </header>

                    {sections.map((s, i) => (
                        <SectionBlock key={s.id} section={s} delay={0.15 + i * 0.1} />
                    ))}

                    {/* Sections réservées à l'admin (bots…) */}
                    {authed && adminSections.map(s => (
                        <div key={s.id} className="section" style={{ animationDelay: '.05s' }}>
                            <div className="section-header">
                                <ShieldCheck size={14} />
                                {s.label}
                                <button className="section-link" onClick={() => go('bots')} title="Monitoring bots">
                                    <ExternalLink size={12} />
                                </button>
                            </div>
                            <div className="cards">
                                {s.items.map(item => (
                                    <ServiceCard key={item.name} item={item} onClick={item.bot ? () => go('bots') : undefined} />
                                ))}
                            </div>
                        </div>
                    ))}

                    <footer className="footer">
                        <span>lucipher-lab</span> — infrastructure personnelle
                    </footer>
                </div>
            )}

            {showLogin && (
                <LoginModal onSuccess={() => { setShowLogin(false); setAuthed(true); setPage('server'); }} onClose={() => setShowLogin(false)} />
            )}
        </>
    );
}
