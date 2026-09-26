import { useState, useRef, useEffect } from 'react';

interface Props {
    onSuccess: () => void;
    // Absent = écran de verrouillage (Asgard est entièrement protégé)
    onClose?: () => void;
}

export default function LoginModal({ onSuccess, onClose }: Props) {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { inputRef.current?.focus() }, []);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            });
            if (res.ok) onSuccess();
            else if (res.status === 429) {
                const d = await res.json().catch(() => ({}));
                setError(`Trop d'essais, réessaie dans ${Math.ceil((d.retryIn || 900) / 60)} min`);
            } else setError('Mot de passe incorrect');
        } catch {
            setError('Erreur de connexion');
        }
        setLoading(false);
    }

    return (
        <div className={`modal-overlay ${onClose ? '' : 'lock-screen'}`} onClick={onClose}>
            <form className="modal" onClick={e => e.stopPropagation()} onSubmit={handleSubmit}>
                {!onClose && <img className="lock-mark" src="/brand/icons/asgard.svg" alt="" width={64} height={64} />}
                <h3>{onClose ? 'Administration' : 'Asgard'}</h3>
                <div className="modal-error">{error}</div>
                <input
                    ref={inputRef}
                    type="password"
                    placeholder="Mot de passe"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                />
                <div className="modal-buttons">
                    {onClose && <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>}
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        {loading ? '...' : 'Connexion'}
                    </button>
                </div>
            </form>
        </div>
    );
}
