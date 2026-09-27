// Hermod : envois de mails d'accès programmés (onglet Hermod d'Asgard).
// À l'heure prévue : création du secret Whisper (lecture unique, durée choisie, le compte à rebours part
// donc de l'envoi), mail tiré de templates/acces.html envoyé via Mailu, copie rangée dans « Envoyés ».
// Jusqu'à l'envoi, le mot de passe est stocké chiffré (AES-256-GCM) dans hermod.json ; il est effacé une
// fois le mail parti. Aucune dépendance : SMTP et IMAP minimaux sur le réseau Docker interne.

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');

const DURATIONS = { '5m': '5 minutes', '30m': '30 minutes', '1h': '1 heure', '24h': '24 heures', '7d': '7 jours' };
const TEMPLATE = fs.readFileSync(path.join(__dirname, 'templates', 'acces.html'), 'utf8');
const SAFETY_TICK_MS = 30000; // filet de sécurité ; le vrai réveil est calé sur le prochain envoi

// --- Configuration ---

function config() {
    return {
        whisperUrl: (process.env.WHISPER_URL || 'https://whisper.lucipher-lab.fr').replace(/\/$/, ''),
        smtpHost: process.env.HERMOD_SMTP_HOST || 'front-dkxsnkskkllwuvthxczgqq4q',
        smtpPort: Number(process.env.HERMOD_SMTP_PORT || 587),
        imapPort: Number(process.env.HERMOD_IMAP_PORT || 143),
        user: process.env.HERMOD_SMTP_USER || 'no-reply@lucipher-lab.fr',
        pass: process.env.HERMOD_SMTP_PASS || '',
        fromName: process.env.HERMOD_FROM_NAME || 'Lucipher Lab',
    };
}

// --- Chiffrement du mot de passe en attente ---

function key() {
    const secret = process.env.HERMOD_KEY || `hermod:${process.env.ADMIN_TOKEN || ''}`;
    return crypto.createHash('sha256').update(secret).digest();
}

function seal(text) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
    const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
    return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function open(box) {
    const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(box.iv, 'base64'));
    d.setAuthTag(Buffer.from(box.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]).toString('utf8');
}

// --- Stockage ---

let file = null;
let state = { jobs: [] };

function load(filePath) {
    file = filePath;
    try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { state = { jobs: [] }; }
    if (!Array.isArray(state.jobs)) state.jobs = [];
    // Arrêt pendant un envoi : on ne sait pas si le mail est parti, on ne renvoie pas tout seul
    for (const j of state.jobs) {
        if (j.status === 'sending') {
            j.status = 'failed';
            j.error = "Interrompu par un redémarrage pendant l'envoi : vérifie si le mail est parti avant de relancer.";
        }
    }
    save();
}

function save() {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
}

// Ce que l'interface voit : jamais le mot de passe, même chiffré
function publicJob(j) {
    const { secret, ...rest } = j;
    return { ...rest, hasPassword: !!secret };
}

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function validate(input) {
    const o = input && typeof input === 'object' ? input : {};
    const s = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const job = {
        prenom: s(o.prenom, 80),
        email: s(o.email, 200).toLowerCase(),
        service: s(o.service, 120),
        url: s(o.url, 300),
        identifiant: s(o.identifiant, 200),
        duration: DURATIONS[o.duration] ? o.duration : '24h',
        subject: s(o.subject, 200),
        sendAt: Number(o.sendAt),
        batch: s(o.batch, 120),
    };
    const password = typeof o.password === 'string' ? o.password : '';
    const errors = [];
    if (!job.prenom) errors.push('prénom manquant');
    if (!EMAIL_RE.test(job.email)) errors.push('adresse mail invalide');
    if (!job.service) errors.push('service manquant');
    if (!/^https?:\/\//i.test(job.url)) errors.push("URL invalide (http:// ou https://)");
    if (!job.identifiant) errors.push('identifiant manquant');
    if (!password) errors.push('mot de passe manquant');
    if (!Number.isFinite(job.sendAt) || job.sendAt <= 0) errors.push("date d'envoi invalide");
    if (!job.subject) job.subject = `Vos accès à ${job.service}`;
    return { job, password, errors };
}

function create(inputs) {
    const list = Array.isArray(inputs) ? inputs : [inputs];
    const checked = list.map(validate);
    const bad = checked.map((c, i) => (c.errors.length ? `#${i + 1} (${c.job.email || c.job.prenom || '?'}) : ${c.errors.join(', ')}` : null)).filter(Boolean);
    if (bad.length) { const e = new Error(bad.join(' ; ')); e.status = 400; throw e; }
    const now = Date.now();
    const created = checked.map(({ job, password }) => ({
        id: crypto.randomBytes(8).toString('hex'),
        status: 'pending',
        createdAt: now,
        ...job,
        secret: seal(password),
    }));
    state.jobs.push(...created);
    save();
    kick();
    return created.map(publicJob);
}

function list() {
    return state.jobs.map(publicJob).sort((a, b) => a.sendAt - b.sendAt);
}

function find(id) {
    const j = state.jobs.find(x => x.id === id);
    if (!j) { const e = new Error('envoi introuvable'); e.status = 404; throw e; }
    return j;
}

function action(id, what) {
    const j = find(id);
    if (what === 'cancel') {
        if (j.status !== 'pending') throw Object.assign(new Error('seul un envoi en attente peut être annulé'), { status: 409 });
        j.status = 'cancelled';
        delete j.secret;
    } else if (what === 'send-now' || what === 'retry') {
        if (!['pending', 'failed'].includes(j.status) || !j.secret) throw Object.assign(new Error('rien à envoyer (mot de passe déjà effacé)'), { status: 409 });
        j.status = 'pending';
        j.sendAt = Date.now();
        delete j.error;
    } else if (what === 'delete') {
        if (j.status === 'pending' || j.status === 'sending') throw Object.assign(new Error("annule l'envoi avant de le supprimer"), { status: 409 });
        state.jobs = state.jobs.filter(x => x !== j);
    } else {
        throw Object.assign(new Error('action inconnue'), { status: 400 });
    }
    save();
    kick();
    return publicJob(j);
}

// --- Mail ---

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderHtml(job, link) {
    const values = {
        '{{PRENOM}}': esc(job.prenom),
        '{{SERVICE}}': esc(job.service),
        '{{URL}}': esc(job.url),
        '{{IDENTIFIANT}}': esc(job.identifiant),
        '{{LIEN_WHISPER}}': esc(link),
        '{{EXPIRATION}}': DURATIONS[job.duration],
    };
    return TEMPLATE.replace(/\{\{[A-Z_]+\}\}/g, m => (m in values ? values[m] : m));
}

function renderText(job, link) {
    return [
        `Bonjour ${job.prenom},`,
        '',
        `Votre accès à ${job.service} est prêt.`,
        '',
        `Adresse : ${job.url}`,
        `Identifiant : ${job.identifiant}`,
        `Mot de passe : ${link}`,
        '',
        `Ce lien ne fonctionne qu'une seule fois et expire dans ${DURATIONS[job.duration]}.`,
        "Notez le mot de passe à l'ouverture, puis changez-le dès votre première connexion.",
        '',
        'Lien expiré, déjà ouvert ou mail perdu ? Écrivez à contact@lucipher-lab.fr',
        '',
        '-- ',
        'Lucipher Lab · lucipher-lab.fr',
        "Message envoyé automatiquement, merci de ne pas y répondre.",
    ].join('\r\n');
}

const b64lines = s => Buffer.from(s, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
const encWord = s => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const quoteName = s => (/^[\x20-\x7e]*$/.test(s) ? `"${s.replace(/["\\]/g, '')}"` : encWord(s));

function buildMessage(job, link, cfg) {
    const boundary = `hermod-${crypto.randomBytes(12).toString('hex')}`;
    const domain = cfg.user.split('@')[1] || 'lucipher-lab.fr';
    const headers = [
        `From: ${quoteName(cfg.fromName)} <${cfg.user}>`,
        `To: ${quoteName(job.prenom)} <${job.email}>`,
        `Subject: ${encWord(job.subject)}`,
        `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
        `Message-ID: <${crypto.randomBytes(16).toString('hex')}@${domain}>`,
        'MIME-Version: 1.0',
        'Auto-Submitted: auto-generated',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ];
    return [
        ...headers, '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: base64', '',
        b64lines(renderText(job, link)),
        `--${boundary}`,
        'Content-Type: text/html; charset=utf-8',
        'Content-Transfer-Encoding: base64', '',
        b64lines(renderHtml(job, link)),
        `--${boundary}--`, '',
    ].join('\r\n');
}

// --- Dialogue ligne à ligne (SMTP / IMAP) ---

function session(host, port) {
    return new Promise((resolve, reject) => {
        const sock = net.connect({ host, port });
        sock.setTimeout(30000, () => sock.destroy(new Error(`délai dépassé (${host}:${port})`)));
        let buf = '';
        let waiter = null;
        const check = () => { if (waiter && waiter.test(buf)) { const w = waiter; waiter = null; const out = buf; buf = ''; w.resolve(out); } };
        sock.on('data', d => { buf += d.toString('utf8'); check(); });
        sock.on('error', e => { if (waiter) waiter.reject(e); else reject(e); });
        sock.on('close', () => { if (waiter) waiter.reject(new Error('connexion fermée par le serveur mail')); });
        const s = {
            // Attend une réponse qui satisfait « test » (tampon complet)
            wait: test => new Promise((res, rej) => { waiter = { test, resolve: res, reject: rej }; check(); }),
            send: line => sock.write(line),
            close: () => sock.end(),
        };
        sock.once('connect', () => resolve(s));
    });
}

// Réponse SMTP complète : dernière ligne « NNN » suivie d'une espace
const smtpDone = b => /(^|\r\n)\d{3} [^\r\n]*\r\n$/.test(b);

async function smtp(s, line, expect) {
    if (line) s.send(`${line}\r\n`);
    const r = await s.wait(smtpDone);
    const code = r.trimEnd().split('\r\n').pop().slice(0, 3);
    if (!expect.includes(code)) throw new Error(`SMTP ${line ? line.split(' ')[0] : 'accueil'} : ${r.trim().split('\r\n').pop()}`);
    return r;
}

async function sendSmtp(cfg, to, raw) {
    const s = await session(cfg.smtpHost, cfg.smtpPort);
    try {
        await smtp(s, null, ['220']);
        await smtp(s, 'EHLO asgard.lucipher-lab.fr', ['250']);
        await smtp(s, `AUTH PLAIN ${Buffer.from(`\0${cfg.user}\0${cfg.pass}`).toString('base64')}`, ['235']);
        await smtp(s, `MAIL FROM:<${cfg.user}>`, ['250']);
        await smtp(s, `RCPT TO:<${to}>`, ['250', '251']);
        await smtp(s, 'DATA', ['354']);
        // « dot-stuffing » : une ligne commençant par « . » est doublée
        s.send(`${raw.replace(/\r\n\./g, '\r\n..')}\r\n.\r\n`);
        await smtp(s, null, ['250']);
        s.send('QUIT\r\n');
    } finally {
        s.close();
    }
}

async function imap(s, tag, line) {
    s.send(`${tag} ${line}\r\n`);
    const r = await s.wait(b => new RegExp(`(^|\\r\\n)${tag} (OK|NO|BAD)[^\\r\\n]*\\r\\n$`).test(b));
    if (!new RegExp(`(^|\\r\\n)${tag} OK`).test(r)) throw new Error(`IMAP ${line.split(' ')[0]} : ${r.trim().split('\r\n').pop()}`);
    return r;
}

const imapQuote = s => `"${String(s).replace(/(["\\])/g, '\\$1')}"`;

// Range une copie dans le dossier « Envoyés » (attribut \Sent, sinon « Sent »)
async function appendSent(cfg, raw) {
    const s = await session(cfg.smtpHost, cfg.imapPort);
    try {
        await s.wait(b => /^\* (OK|PREAUTH)[^\r\n]*\r\n/.test(b));
        await imap(s, 'a1', `LOGIN ${imapQuote(cfg.user)} ${imapQuote(cfg.pass)}`);
        const listing = await imap(s, 'a2', 'LIST "" "*"');
        const sent = listing.split('\r\n').find(l => /\\Sent\b/i.test(l));
        const folder = sent ? sent.replace(/^.*\) "[^"]*" /, '').replace(/^"(.*)"$/, '$1') : 'Sent';
        const bytes = Buffer.byteLength(raw);
        s.send(`a3 APPEND ${imapQuote(folder)} (\\Seen) {${bytes}}\r\n`);
        await s.wait(b => /^\+/m.test(b));
        s.send(`${raw}\r\n`);
        await s.wait(b => /(^|\r\n)a3 (OK|NO|BAD)[^\r\n]*\r\n$/.test(b)).then(r => {
            if (!/(^|\r\n)a3 OK/.test(r)) throw new Error(`IMAP APPEND : ${r.trim().split('\r\n').pop()}`);
        });
        s.send('a4 LOGOUT\r\n');
        return folder;
    } finally {
        s.close();
    }
}

async function createWhisper(cfg, password, duration) {
    const r = await fetch(`${cfg.whisperUrl}/api/secrets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: password, password: '', duration, max_views: 1 }),
        signal: AbortSignal.timeout(20000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.id) throw new Error(`Whisper ${r.status} : ${d.error || JSON.stringify(d)}`);
    return { link: `${cfg.whisperUrl}/secret/${d.id}`, expiresAt: (d.expires_at || 0) * 1000 };
}

// --- Envoi d'un job ---

async function deliver(j) {
    const cfg = config();
    if (!cfg.pass) throw new Error("HERMOD_SMTP_PASS n'est pas configuré (jeton Mailu de l'expéditeur)");
    const password = open(j.secret);
    // Le secret Whisper n'existe qu'à partir de maintenant : sa durée de vie commence à l'envoi
    const w = await createWhisper(cfg, password, j.duration);
    const raw = buildMessage(j, w.link, cfg);
    await sendSmtp(cfg, j.email, raw);
    j.whisperExpiresAt = w.expiresAt;
    try {
        j.sentFolder = await appendSent(cfg, raw);
    } catch (e) {
        j.warning = `Mail envoyé, mais copie dans « Envoyés » impossible : ${e.message}`;
    }
}

let running = false;

async function tick() {
    if (running || !file) return;
    running = true;
    try {
        for (;;) {
            const j = state.jobs.filter(x => x.status === 'pending' && x.sendAt <= Date.now()).sort((a, b) => a.sendAt - b.sendAt)[0];
            if (!j) break;
            j.status = 'sending';
            j.attempts = (j.attempts || 0) + 1;
            save();
            try {
                await deliver(j);
                j.status = 'sent';
                j.sentAt = Date.now();
                delete j.secret; // le mot de passe n'est plus nécessaire
                delete j.error;
            } catch (e) {
                j.status = 'failed';
                j.error = e.message;
                console.error('hermod:', j.email, e.message);
            }
            save();
        }
    } finally {
        running = false;
        scheduleNext();
    }
}

// Réveil à l'heure exacte du prochain envoi (plafonné : setTimeout ne tient pas au-delà de ~24 j)
let timer = null;
function scheduleNext() {
    clearTimeout(timer);
    const next = Math.min(...state.jobs.filter(x => x.status === 'pending').map(x => x.sendAt));
    if (!Number.isFinite(next)) return;
    timer = setTimeout(tick, Math.min(Math.max(next - Date.now(), 0), 6 * 3600 * 1000));
}

function kick() { setTimeout(tick, 0); }

function start(filePath) {
    load(filePath);
    setInterval(tick, SAFETY_TICK_MS).unref();
    kick();
}

// Aperçu du mail dans Asgard (lien factice)
function preview(input) {
    const { job } = validate({ ...input, password: 'x', sendAt: Date.now() });
    return renderHtml(job, `${config().whisperUrl}/secret/apercu`);
}

module.exports = { start, create, list, action, preview, DURATIONS, buildMessage, renderText };
