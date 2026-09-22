import { useState, useRef, useEffect } from 'react';

interface Props {
    onSuccess: () => void;
    onClose: () => void;
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
            else setError('Mot de passe incorrect');
        } catch {
            setError('Erreur de connexion');
        }
        setLoading(false);
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <form className="modal" onClick={e => e.stopPropagation()} onSubmit={handleSubmit}>
                <h3>Administration</h3>
                <div className="modal-error">{error}</div>
                <input
                    ref={inputRef}
                    type="password"
                    placeholder="Mot de passe"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                />
                <div className="modal-buttons">
                    <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        {loading ? '...' : 'Connexion'}
                    </button>
                </div>
            </form>
        </div>
    );
}
