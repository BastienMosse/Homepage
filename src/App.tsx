import { useState, useEffect } from 'react';
import LoginModal from './components/LoginModal.tsx';
import BotMonitor from './components/BotMonitor.tsx';
import VitrineEditor from './components/VitrineEditor.tsx';
import ServerPanel from './components/ServerPanel.tsx';
import HermodPanel from './components/HermodPanel.tsx';
import { Activity, LogOut, Bot, PanelsTopLeft, Mail, Globe } from 'lucide-react';

type Page = 'server' | 'vitrine' | 'hermod' | 'bots';

const NAV: { id: Page; label: string; icon: typeof Activity }[] = [
    { id: 'server', label: 'Serveur', icon: Activity },
    { id: 'vitrine', label: 'Vitrine', icon: PanelsTopLeft },
    { id: 'hermod', label: 'Hermod', icon: Mail },
    { id: 'bots', label: 'Bots', icon: Bot },
];

export default function App() {
    // null = vérification en cours ; sans session, Asgard n'affiche que l'écran de connexion
    const [authed, setAuthed] = useState<boolean | null>(null);
    const [page, setPage] = useState<Page>('server');

    useEffect(() => {
        fetch('/api/auth/check').then(r => r.json()).then(d => setAuthed(d.authed)).catch(() => setAuthed(false));
    }, []);

    function go(p: Page) {
        setPage(p);
        window.scrollTo(0, 0);
    }

    async function logout() {
        await fetch('/api/auth/logout', { method: 'POST' });
        setAuthed(false);
        setPage('server');
    }

    if (authed === null) return null;

    if (!authed) {
        return (
            <>
                <div className="glow glow-1" />
                <div className="glow glow-2" />
                <LoginModal onSuccess={() => setAuthed(true)} />
            </>
        );
    }

    return (
        <>
            <div className="glow glow-1" />
            <div className="glow glow-2" />

            <nav className="admin-nav">
                <div className="admin-nav-inner">
                    <img src="/brand/icons/asgard.svg" alt="" width={22} height={22} />
                    {NAV.map(n => (
                        <button key={n.id} className={page === n.id ? 'active' : ''} onClick={() => go(n.id)}>
                            <n.icon size={13} />
                            <span>{n.label}</span>
                        </button>
                    ))}
                    <a className="admin-nav-site" href="https://lucipher-lab.fr" title="Retour à la vitrine (lucipher-lab.fr)">
                        <Globe size={13} />
                        <span>Voir le site</span>
                    </a>
                    <button className="admin-nav-logout" onClick={logout} title="Déconnexion">
                        <LogOut size={13} />
                    </button>
                </div>
            </nav>

            {page === 'server' && (
                <div className="page">
                    <ServerPanel />
                </div>
            )}
            {page === 'hermod' && (
                <div className="page">
                    <HermodPanel />
                </div>
            )}
            {page === 'vitrine' && <VitrineEditor onBack={() => go('server')} />}
            {page === 'bots' && <BotMonitor onBack={() => go('server')} />}
        </>
    );
}
