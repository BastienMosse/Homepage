// Vitrine publique (lucipher-lab.fr) : rendue côté serveur depuis vitrine.json,
// éditable depuis Asgard (onglet Vitrine). Tout le texte est échappé, les liens filtrés.

const BLOCK_TYPES = ['realms', 'tools', 'text', 'contact'];

const DEFAULT_VITRINE = {
    hero: {
        visible: true,
        showGate: true,
        title: 'LUCIPHER LAB',
        tagline: 'Homelab',
        lead: 'Un homelab auto-hébergé, bâti comme les mondes nordiques : chaque service est un royaume, et la Porte de Lucipher Lab ouvre sur les sept.',
        primary: { label: 'Explorer les royaumes', href: '#royaumes' },
        secondary: { label: 'Portail Asgard →', href: 'https://asgard.lucipher-lab.fr' },
    },
    blocks: [
        {
            id: 'royaumes', type: 'realms', visible: true,
            kicker: 'Les royaumes', title: "L'infrastructure",
            text: 'Les dieux et leurs attributs veillent sur le lab. Certains royaumes restent fermés aux mortels.',
            items: [
                { id: 'asgard', name: 'Asgard', subtitle: 'Le portail', icon: 'asgard', visible: true, open: true, label: 'Entrer →', url: 'https://asgard.lucipher-lab.fr', desc: 'La cité des dieux : le tableau de bord qui veille sur chaque service du lab.' },
                { id: 'yggdrasil', name: 'Yggdrasil', subtitle: 'Les fichiers', icon: 'yggdrasil', visible: true, open: true, label: 'Ouvrir →', url: 'https://yggdrasil.lucipher-lab.fr', desc: "L'arbre-monde, dont les racines et les branches portent tous les fichiers partagés." },
                { id: 'hermod', name: 'Hermod', subtitle: 'Le courrier', icon: 'hermod', visible: true, open: false, label: 'Ouvrir →', url: 'https://hermod.lucipher-lab.fr', desc: 'Le messager des dieux, monté sur Sleipnir : la messagerie @lucipher-lab.fr.' },
                { id: 'draupnir', name: 'Draupnir', subtitle: 'Le coffre', icon: 'draupnir', visible: true, open: false, label: 'Ouvrir →', url: 'https://draupnir.lucipher-lab.fr', desc: "L'anneau d'Odin, qui engendre ses semblables : ici, il garde les secrets." },
                { id: 'odin', name: 'Odin', subtitle: "L'orchestrateur", icon: 'odin', visible: true, open: false, label: 'Ouvrir →', url: 'https://odin.lucipher-lab.fr', desc: 'Le Père-de-tout, qui a donné un œil pour tout voir : il déploie chaque service.' },
                { id: 'heimdall', name: 'Heimdall', subtitle: 'Le gardien', icon: 'heimdall', visible: true, open: false, label: 'Ouvrir →', url: 'https://heimdall.lucipher-lab.fr', desc: 'Il voit et entend tout, et garde le seul chemin vers les royaumes privés.' },
                { id: 'bifrost', name: 'Bifrost', subtitle: 'Le pont', icon: 'bifrost', visible: true, open: false, label: 'Ouvrir →', url: 'https://bifrost.lucipher-lab.fr', desc: 'Le pont arc-en-ciel entre les mondes : tout le trafic du lab le traverse.' },
            ],
        },
        {
            id: 'midgard', type: 'tools', visible: true,
            kicker: 'Midgard', title: 'Les outils ouverts',
            text: 'Le monde des humains : ce que le lab met à disposition de tous.',
            items: [
                { id: 'whisper', name: 'Whisper', visible: true, url: 'https://whisper.lucipher-lab.fr', desc: "Partager un secret qui s'efface après lecture." },
                { id: 'relais', name: 'Relais', visible: true, url: 'https://relais.lucipher-lab.fr', desc: 'Messagerie chiffrée de bout en bout.' },
                { id: 'network-learning', name: 'Network Learning', visible: true, url: 'https://network-learning.lucipher-lab.fr', desc: 'Des cours de réseau interactifs.' },
                { id: 'cyber', name: 'Cyber Dashboard', visible: true, url: 'https://cyber.lucipher-lab.fr', desc: 'Veille cybersécurité et globe des menaces en 3D.' },
            ],
        },
        {
            id: 'contact', type: 'contact', visible: true,
            kicker: 'Contact', title: 'Un message pour les dieux ?', email: 'contact@lucipher-lab.fr',
        },
    ],
};

// --- Normalisation (ce qui est sauvegardé est toujours propre) ---

const str = (v, max = 600) => (typeof v === 'string' ? v : '').slice(0, max);
const bool = (v, dflt) => (typeof v === 'boolean' ? v : dflt);
const slug = v => str(v, 60).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

function normalizeLink(v) {
    const o = v && typeof v === 'object' ? v : {};
    return { label: str(o.label, 80), href: str(o.href, 300) };
}

function normalizeItem(it, i, type) {
    const o = it && typeof it === 'object' ? it : {};
    const base = {
        id: slug(o.id) || `item-${i}`,
        name: str(o.name, 80),
        desc: str(o.desc),
        url: str(o.url, 300),
        visible: bool(o.visible, true),
    };
    if (type !== 'realms') return base;
    return { ...base, subtitle: str(o.subtitle, 80), icon: str(o.icon, 300), open: bool(o.open, false), label: str(o.label, 40) };
}

function normalizeVitrine(input) {
    const o = input && typeof input === 'object' ? input : {};
    const h = o.hero && typeof o.hero === 'object' ? o.hero : {};
    const hero = {
        visible: bool(h.visible, true),
        showGate: bool(h.showGate, true),
        title: str(h.title, 80),
        tagline: str(h.tagline, 80),
        lead: str(h.lead),
        primary: normalizeLink(h.primary),
        secondary: normalizeLink(h.secondary),
    };
    const seen = new Set();
    const blocks = (Array.isArray(o.blocks) ? o.blocks : []).slice(0, 30)
        .filter(b => b && BLOCK_TYPES.includes(b.type))
        .map((b, i) => {
            let id = slug(b.id) || `bloc-${i}`;
            while (seen.has(id)) id += '-2';
            seen.add(id);
            const block = { id, type: b.type, visible: bool(b.visible, true), kicker: str(b.kicker, 80), title: str(b.title, 120), text: str(b.text, 2000) };
            if (b.type === 'contact') block.email = str(b.email, 120);
            if (b.type === 'realms' || b.type === 'tools') {
                block.items = (Array.isArray(b.items) ? b.items : []).slice(0, 40).map((it, j) => normalizeItem(it, j, b.type));
            }
            return block;
        });
    return { hero, blocks };
}

// --- Rendu ---

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Seuls http(s), mailto, les ancres et les chemins relatifs passent (pas de javascript:)
function safeHref(href) {
    const h = String(href || '').trim();
    if (/^(https?:\/\/|mailto:|#|\/(?!\/))/i.test(h)) return esc(h);
    return '';
}

function iconSrc(icon) {
    const i = String(icon || '').trim();
    if (!i) return '';
    if (/^[a-z0-9-]+$/.test(i)) return `/brand/icons/${i}.svg`;
    return safeHref(i);
}

const LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

function head(b) {
    return `<div class="head reveal">
                ${b.kicker ? `<div class="mono">${esc(b.kicker)}</div>` : ''}
                ${b.title ? `<h2>${esc(b.title)}</h2>` : ''}
                ${b.text ? `<p>${esc(b.text)}</p>` : ''}
            </div>`;
}

function renderRealm(r) {
    const src = iconSrc(r.icon);
    const href = safeHref(r.url);
    const badge = r.open && href
        ? `<a class="badge badge-open" href="${href}">${esc(r.label || 'Entrer →')}</a>`
        : `<span class="badge badge-locked">${LOCK}Réservé</span>`;
    return `<article class="realm reveal">
                    ${src ? `<img src="${src}" alt="" width="132" height="132">` : ''}
                    <h3>${esc(r.name)}</h3>${r.subtitle ? `<span class="mono">${esc(r.subtitle)}</span>` : ''}
                    ${r.desc ? `<p>${esc(r.desc)}</p>` : ''}
                    ${badge}
                </article>`;
}

function renderTool(t) {
    const href = safeHref(t.url);
    const inner = `<b>${esc(t.name)} <span>→</span></b>${t.desc ? `<small>${esc(t.desc)}</small>` : ''}`;
    return href ? `<a class="tool reveal" href="${href}">${inner}</a>` : `<div class="tool reveal">${inner}</div>`;
}

function renderBlock(b) {
    const items = (b.items || []).filter(i => i.visible);
    switch (b.type) {
        case 'realms':
            return `<section id="${esc(b.id)}"><div class="wrap">${head(b)}
            <div class="realms">${items.map(renderRealm).join('\n')}</div></div></section>`;
        case 'tools':
            return `<section id="${esc(b.id)}"><div class="wrap">${head(b)}
            <div class="tools">${items.map(renderTool).join('\n')}</div></div></section>`;
        case 'text':
            return `<section id="${esc(b.id)}" class="prose"><div class="wrap">${head(b)}</div></section>`;
        case 'contact': {
            const mail = b.email ? `<a class="mail" href="mailto:${esc(b.email)}">${esc(b.email)}</a>` : '';
            return `<section id="${esc(b.id)}" class="contact"><div class="wrap reveal">
            ${b.kicker ? `<div class="mono">${esc(b.kicker)}</div>` : ''}
            ${b.title ? `<h2>${esc(b.title)}</h2>` : ''}
            ${b.text ? `<p class="contact-text">${esc(b.text)}</p>` : ''}
            ${mail}</div></section>`;
        }
        default:
            return '';
    }
}

function renderHero(h) {
    if (!h.visible) return '';
    const btn = (l, cls) => (l.label && safeHref(l.href) ? `<a class="btn ${cls}" href="${safeHref(l.href)}">${esc(l.label)}</a>` : '');
    const buttons = btn(h.primary, 'btn-primary') + btn(h.secondary, 'btn-ghost');
    return `<header class="hero" id="accueil">
    <div class="wrap">
        ${h.showGate ? '<img class="hero-gate" src="/brand/porte-des-7-royaumes.svg" alt="La Porte de Lucipher Lab, entourée des sept royaumes" width="460" height="460">' : ''}
        ${h.title ? `<h1>${esc(h.title)}</h1>` : ''}
        ${h.tagline ? `<div class="mono">${esc(h.tagline)}</div>` : ''}
        ${h.lead ? `<p class="lead">${esc(h.lead)}</p>` : ''}
        ${buttons ? `<div class="actions">${buttons}</div>` : ''}
    </div>
</header>`;
}

// preview : aperçu dans Asgard (iframe srcdoc) — liens ouverts dans un nouvel onglet, pas d'animation d'apparition
function renderVitrine(cfg, { preview = false } = {}) {
    const v = normalizeVitrine(cfg);
    return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${preview ? '<base target="_blank">' : ''}
    <title>Lucipher Lab · Homelab</title>
    <meta name="description" content="Lucipher Lab, un homelab auto-hébergé bâti comme les Neuf Mondes de la mythologie nordique.">
    <meta name="theme-color" content="#06060a">
    <link rel="icon" href="/brand/icons/lucipher-lab.svg" type="image/svg+xml">
    <link rel="apple-touch-icon" href="/brand/apple-touch-lucipher.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Oxanium:wght@500;700&family=Plus+Jakarta+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    <style>${CSS}${preview ? '.reveal{opacity:1;transform:none}' : ''}</style>
</head>
<body>
<div class="glow"></div>

${renderHero(v.hero)}

<main>
${v.blocks.filter(b => b.visible).map(renderBlock).join('\n\n')}
</main>

<footer>
    <div class="wrap mono"><a href="https://lucipher-lab.fr">Lucipher Lab</a> · Homelab · <a href="https://asgard.lucipher-lab.fr">Asgard</a></div>
</footer>

<script>
    // Apparition douce des blocs au défilement
    const io = new IntersectionObserver(entries => {
        for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { threshold: 0.12 });
    document.querySelectorAll('.reveal').forEach(el => io.observe(el));
</script>${preview ? PREVIEW_SCRIPT : ''}
</body>
</html>`;
}

// Aperçu : garde la position de défilement entre deux rendus et permet à l'éditeur de viser un bloc
const PREVIEW_SCRIPT = `
<script>
    document.documentElement.style.scrollBehavior = 'auto';
    addEventListener('scroll', () => parent.postMessage({ vitrineScroll: scrollY }, '*'), { passive: true });
    addEventListener('message', e => {
        const d = e.data || {};
        if (typeof d.scrollY === 'number') scrollTo(0, d.scrollY);
        if (d.scrollTo) { const el = document.getElementById(d.scrollTo); if (el) el.scrollIntoView({ behavior: 'smooth' }); }
    });
</script>`;

const CSS = `
        :root {
            --bg: #06060a;
            --surface: #0e0e18;
            --border: #1e1e3a;
            --text: #e2e8f0;
            --muted: #8f86a8;
            --lilac: #c8a2ff;
            --violet: #8b5cf6;
            --deep: #6d28d9;
            --ease: cubic-bezier(.2, .7, .2, 1);
        }
        * { box-sizing: border-box }
        html { scroll-behavior: smooth }
        body {
            margin: 0;
            background: var(--bg);
            color: var(--text);
            font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
            line-height: 1.6;
            overflow-x: hidden;
        }
        a { color: inherit }
        .glow {
            position: fixed; inset: -20% -10% auto; height: 70vh; z-index: -1; pointer-events: none;
            background: radial-gradient(ellipse at 50% 30%, rgba(139,92,246,.16), transparent 60%);
        }
        .wrap { max-width: 1080px; margin: 0 auto; padding: 0 16px }
        .mono { font-family: 'JetBrains Mono', monospace; letter-spacing: .22em; text-transform: uppercase; font-size: .72rem; color: var(--muted) }

        /* ── Hero ── */
        .hero { min-height: 92vh; display: grid; place-items: center; text-align: center; padding: 64px 0 32px }
        .hero-gate { width: min(460px, 88vw); height: auto; display: block; margin: 0 auto 18px }
        h1 {
            margin: 0; font-family: 'Oxanium', sans-serif; font-weight: 700;
            font-size: clamp(2.4rem, 8vw, 4.6rem); letter-spacing: .06em; line-height: 1.05;
            background: linear-gradient(135deg, #f1ecff 20%, var(--lilac) 60%, var(--violet));
            -webkit-background-clip: text; background-clip: text; color: transparent;
        }
        .hero .mono { margin-top: 10px; font-size: .8rem; letter-spacing: .5em }
        .lead { max-width: 560px; margin: 26px auto 0; color: var(--muted); font-size: 1.05rem }
        .actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 34px }
        .btn {
            display: inline-flex; align-items: center; gap: 8px; padding: 12px 22px; border-radius: 10px;
            font-weight: 600; font-size: .92rem; text-decoration: none; transition: all .25s var(--ease);
        }
        .btn-primary { background: linear-gradient(135deg, var(--violet), var(--deep)); color: #fff; box-shadow: 0 8px 30px rgba(109,40,217,.35) }
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 12px 38px rgba(109,40,217,.5) }
        .btn-ghost { border: 1px solid var(--border); color: var(--text) }
        .btn-ghost:hover { border-color: var(--violet); background: rgba(139,92,246,.08) }

        /* ── Sections ── */
        section { padding: 72px 0 }
        .head { text-align: center; margin-bottom: 44px }
        h2 { margin: 8px 0 10px; font-family: 'Oxanium', sans-serif; font-size: clamp(1.7rem, 4.5vw, 2.4rem); letter-spacing: .03em }
        .head p { margin: 0 auto; max-width: 560px; color: var(--muted); white-space: pre-line }
        .prose .head { margin-bottom: 0 }

        /* ── Royaumes : lignes centrées, la dernière ligne incomplète reste au milieu ── */
        .realms { display: flex; flex-wrap: wrap; justify-content: center; gap: 16px }
        .realm {
            flex: 0 1 244px; min-width: 0;
            position: relative; background: var(--surface); border: 1px solid var(--border); border-radius: 18px;
            padding: 28px 24px 24px; text-align: center; overflow: hidden;
            transition: transform .35s var(--ease), border-color .35s var(--ease);
        }
        .realm::before {
            content: ""; position: absolute; inset: 0; opacity: 0; transition: opacity .35s var(--ease);
            background: radial-gradient(circle at 50% 25%, rgba(139,92,246,.18), transparent 65%);
        }
        .realm:hover { transform: translateY(-4px); border-color: rgba(139,92,246,.45) }
        .realm:hover::before { opacity: 1 }
        .realm img {
            position: relative; width: 132px; height: 132px; display: block; margin: 0 auto 18px;
            transition: transform .5s var(--ease), filter .5s var(--ease);
        }
        .realm:hover img { transform: scale(1.06) rotate(-2deg); filter: drop-shadow(0 0 22px rgba(139,92,246,.45)) }
        .realm h3 { position: relative; margin: 0; font-family: 'Oxanium', sans-serif; font-size: 1.35rem; letter-spacing: .06em }
        .realm .mono { position: relative; display: block; margin-top: 2px; color: var(--lilac); letter-spacing: .18em; font-size: .66rem }
        .realm p { position: relative; margin: 12px 0 18px; color: var(--muted); font-size: .92rem }
        .badge {
            position: relative; display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px;
            font-family: 'JetBrains Mono', monospace; font-size: .7rem; letter-spacing: .08em; text-decoration: none;
        }
        .badge-open { background: rgba(139,92,246,.14); color: var(--lilac); border: 1px solid rgba(139,92,246,.35) }
        .badge-open:hover { background: rgba(139,92,246,.26) }
        .badge-locked { color: var(--muted); border: 1px dashed var(--border) }
        .badge svg { width: 12px; height: 12px }

        /* ── Outils ── */
        .tools { display: flex; flex-wrap: wrap; justify-content: center; gap: 14px }
        .tool {
            flex: 0 1 250px; min-width: 0;
            display: block; padding: 20px 22px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border);
            text-decoration: none; transition: all .3s var(--ease);
        }
        a.tool:hover { border-color: rgba(139,92,246,.45); transform: translateY(-3px) }
        .tool b { display: flex; justify-content: space-between; font-size: 1rem }
        .tool b span { color: var(--violet); transition: transform .3s var(--ease) }
        a.tool:hover b span { transform: translateX(4px) }
        div.tool b span { display: none }
        .tool small { display: block; margin-top: 4px; color: var(--muted); font-size: .85rem }
        @media (max-width: 560px) { .realm, .tool { flex-basis: 100% } }

        /* ── Contact / pied ── */
        .contact { text-align: center }
        .contact-text { margin: 0 auto 10px; max-width: 560px; color: var(--muted); white-space: pre-line }
        .contact a.mail {
            display: inline-block; margin-top: 8px; font-family: 'JetBrains Mono', monospace; font-size: clamp(1rem, 3.5vw, 1.35rem);
            color: var(--lilac); text-decoration: none; border-bottom: 1px solid rgba(200,162,255,.35); padding-bottom: 2px;
        }
        .contact a.mail:hover { border-color: var(--lilac) }
        footer { border-top: 1px solid var(--border); padding: 26px 0 34px; text-align: center }
        footer a { color: var(--muted); text-decoration: none } footer a:hover { color: var(--lilac) }

        .reveal { opacity: 0; transform: translateY(18px); transition: opacity .8s var(--ease), transform .8s var(--ease) }
        .reveal.in { opacity: 1; transform: none }
        @media (prefers-reduced-motion: reduce) {
            .reveal { opacity: 1; transform: none; transition: none }
            html { scroll-behavior: auto }
        }
`;

module.exports = { DEFAULT_VITRINE, BLOCK_TYPES, normalizeVitrine, renderVitrine };
