import { useEffect, useState } from 'react';
import ServiceCard from './components/ServiceCard.tsx';
import type { ApiResponse, Service } from './types';

export default function App() {
    const [services, setServices] = useState<Service[]>([]);
    const [admin, setAdmin] = useState<Service[]>([]);
    const [vpn, setVpn] = useState(false);

    useEffect(() => {
        fetch('/api/services')
            .then(r => r.json())
            .then((data: ApiResponse) => {
                setServices(data.services);
                setVpn(data.vpn);
                if (data.admin) setAdmin(data.admin);
            })
            .catch(() => {});
    }, []);

    return (
        <>
            <div className="glow glow-1" />
            <div className="glow glow-2" />

            {vpn && <div className="vpn-badge">VPN</div>}

            <div className="hero">
                <div className="logo">lucipher-lab</div>
                <p className="tagline">Projets & outils perso</p>
            </div>

            <div className="cards">
                {services.map((s, i) => (
                    <ServiceCard key={s.url} service={s} index={i} />
                ))}
            </div>

            {admin.length > 0 && (
                <>
                    <div className="section-title">Administration</div>
                    <div className="cards">
                        {admin.map((s, i) => (
                            <ServiceCard key={s.url} service={s} index={i + services.length} />
                        ))}
                    </div>
                </>
            )}

            <p className="footer">fait avec <span>&hearts;</span> par bastich</p>
        </>
    );
}
