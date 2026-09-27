// Hermod : envois de mails programmés (onglet Hermod d'Asgard).
// - Modèles éditables (objet + HTML) avec des champs {{NOM}} détectés automatiquement. Chaque champ est
//   « text » (valeur recopiée) ou « whisper » (valeur secrète → lien Whisper créé AU MOMENT DE L'ENVOI,
//   lecture unique, sa durée de vie part donc de l'envoi). Champs automatiques : EMAIL, EXPIRATION, EXPIRE_LE.
// - Un envoi = un expéditeur, un modèle, une date/heure, une liste de destinataires avec leurs valeurs.
// - Les valeurs secrètes en attente sont chiffrées (AES-256-GCM) dans hermod.json et effacées après l'envoi.
// - SMTP + copie IMAP dans « Envoyés » de l'expéditeur, via Mailu sur le réseau Docker interne.
//   Un jeton Mailu par expéditeur (env HERMOD_SMTP_USER/HERMOD_SMTP_PASS + HERMOD_ACCOUNTS en JSON).

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');

const DURATIONS = { '5m': '5 minutes', '30m': '30 minutes', '1h': '1 heure', '24h': '24 heures', '7d': '7 jours' };
const DURATION_MS = { '5m': 300e3, '30m': 1800e3, '1h': 3600e3, '24h': 86400e3, '7d': 604800e3 };
const AUTO_VARS = {
    EMAIL: 'adresse du destinataire',
    EXPIRATION: 'durée de vie du lien (« 24 heures »)',
    EXPIRE_LE: "date d'expiration du lien (« mardi 29/09 à 10:00 »)",
};
const SAFETY_TICK_MS = 30000; // filet de sécurité ; le vrai réveil est calé sur le prochain envoi
const VAR_RE = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g;

// --- Configuration ---

function accounts() {
    const list = {};
    const user = process.env.HERMOD_SMTP_USER || 'no-reply@lucipher-lab.fr';
    if (process.env.HERMOD_SMTP_PASS) list[user] = process.env.HERMOD_SMTP_PASS;
    try { Object.assign(list, JSON.parse(process.env.HERMOD_ACCOUNTS || '{}')); } catch { /* JSON invalide : ignoré */ }
    return list;
}

function config() {
    return {
        whisperUrl: (process.env.WHISPER_URL || 'https://whisper.lucipher-lab.fr').replace(/\/$/, ''),
        smtpHost: process.env.HERMOD_SMTP_HOST || 'front-dkxsnkskkllwuvthxczgqq4q',
        smtpPort: Number(process.env.HERMOD_SMTP_PORT || 587),
        imapPort: Number(process.env.HERMOD_IMAP_PORT || 143),
        fromName: process.env.HERMOD_FROM_NAME || 'Lucipher Lab',
    };
}

// --- Chiffrement des valeurs secrètes en attente ---

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

function unseal(box) {
    const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(box.iv, 'base64'));
    d.setAuthTag(Buffer.from(box.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]).toString('utf8');
}

// --- Stockage ---

let file = null;
let state = { jobs: [], templates: [] };

function httpError(message, status) { return Object.assign(new Error(message), { status }); }

function varsOf(tpl) {
    const names = new Set();
    for (const src of [tpl.subject || '', tpl.html || '']) for (const m of src.matchAll(VAR_RE)) names.add(m[1]);
    return [...names];
}

// Modèle d'origine : le mail d'accès (branding/templates/acces.min.html)
function seedTemplate() {
    return {
        id: 'acces',
        name: "Accès à un service (mot de passe via Whisper)",
        subject: 'Vos accès à {{SERVICE}}',
        html: fs.readFileSync(path.join(__dirname, 'templates', 'acces.html'), 'utf8'),
        fields: {
            PRENOM: { label: 'Prénom', type: 'text' },
            SERVICE: { label: 'Service', type: 'text' },
            URL: { label: 'Adresse du service', type: 'text' },
            IDENTIFIANT: { label: 'Identifiant', type: 'text' },
            LIEN_WHISPER: { label: 'Mot de passe', type: 'whisper' },
        },
        updatedAt: Date.now(),
    };
}

function load(filePath) {
    file = filePath;
    try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { state = {}; }
    if (!Array.isArray(state.jobs)) state.jobs = [];
    if (!Array.isArray(state.templates) || !state.templates.length) state.templates = [seedTemplate()];
    for (const j of state.jobs) {
        // Arrêt pendant un envoi : on ne sait pas si le mail est parti, on ne renvoie pas tout seul
        if (j.status === 'sending') {
            j.status = 'failed';
            j.error = "Interrompu par un redémarrage pendant l'envoi : vérifie si le mail est parti avant de relancer.";
        }
        // Envois de la 1re version (mail d'accès figé) : affichage seulement
        if (!j.to && j.email) { j.to = j.email; j.templateName = j.templateName || 'Accès (ancienne version)'; }
    }
    save();
}

function save() {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
}

// --- Modèles ---

function publicTemplate(t) {
    return { ...t, vars: varsOf(t) };
}

function listTemplates() {
    return state.templates.map(publicTemplate);
}

function saveTemplate(input) {
    const o = input && typeof input === 'object' ? input : {};
    const name = String(o.name || '').trim().slice(0, 120);
    const subject = String(o.subject || '').trim().slice(0, 300);
    const html = String(o.html || '');
    if (!name) throw httpError('nom du modèle manquant', 400);
    if (!subject) throw httpError('objet manquant', 400);
    if (!html.trim()) throw httpError('contenu HTML manquant', 400);
    if (html.length > 500000) throw httpError('modèle trop lourd (500 Ko max)', 400);
    const fields = {};
    for (const v of varsOf({ subject, html })) {
        if (AUTO_VARS[v]) continue;
        const f = (o.fields && o.fields[v]) || {};
        fields[v] = { label: String(f.label || v).slice(0, 80), type: f.type === 'whisper' ? 'whisper' : 'text' };
    }
    const existing = o.id && state.templates.find(t => t.id === o.id);
    const tpl = { id: existing ? existing.id : crypto.randomBytes(6).toString('hex'), name, subject, html, fields, updatedAt: Date.now() };
    if (existing) Object.assign(existing, tpl);
    else state.templates.push(tpl);
    save();
    return publicTemplate(existing || tpl);
}

function deleteTemplate(id) {
    if (state.templates.length <= 1) throw httpError('il faut garder au moins un modèle', 409);
    state.templates = state.templates.filter(t => t.id !== id);
    save();
}

// --- Envois ---

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

// Ce que l'interface voit : jamais les valeurs secrètes, même chiffrées
function publicJob(j) {
    const { secrets, secret, html, ...rest } = j;
    return { ...rest, hasSecrets: !!(secrets || secret) };
}

// input : { from, fromName, templateId, sendAt, duration, batch, recipients: [{ email, values: { VAR: valeur } }] }
function schedule(input) {
    const o = input && typeof input === 'object' ? input : {};
    const acc = accounts();
    const from = String(o.from || '').toLowerCase();
    if (!acc[from]) throw httpError(`expéditeur non configuré : ${from || '(vide)'}`, 400);
    const tpl = state.templates.find(t => t.id === o.templateId);
    if (!tpl) throw httpError('modèle introuvable', 400);
    const sendAt = Number(o.sendAt);
    if (!Number.isFinite(sendAt) || sendAt <= 0) throw httpError("date d'envoi invalide", 400);
    const duration = DURATIONS[o.duration] ? o.duration : '24h';
    const recipients = Array.isArray(o.recipients) ? o.recipients : [];
    if (!recipients.length) throw httpError('aucun destinataire', 400);
    if (recipients.length > 500) throw httpError('500 destinataires maximum par envoi', 400);

    const fields = Object.entries(tpl.fields || {});
    const errors = [];
    const jobs = recipients.map((r, i) => {
        const email = String(r.email || '').trim().toLowerCase();
        const values = {};
        const secrets = {};
        const missing = [];
        for (const [name, f] of fields) {
            const v = typeof r.values?.[name] === 'string' ? r.values[name] : '';
            if (!v.trim()) missing.push(f.label);
            if (f.type === 'whisper') secrets[name] = v;
            else values[name] = v.trim().slice(0, 2000);
        }
        if (!EMAIL_RE.test(email)) missing.unshift('email');
        if (missing.length) errors.push(`ligne ${i + 1}${email ? ` (${email})` : ''} : ${missing.join(', ')}`);
        return {
            id: crypto.randomBytes(8).toString('hex'),
            status: 'pending',
            createdAt: Date.now(),
            sendAt,
            duration,
            from,
            fromName: String(o.fromName || config().fromName).slice(0, 80),
            templateId: tpl.id,
            templateName: tpl.name,
            // Copie du modèle au moment de la programmation : le modifier ensuite ne change pas les envois prévus
            subject: tpl.subject,
            html: tpl.html,
            to: email,
            values,
            secretFields: Object.keys(secrets),
            secrets: Object.keys(secrets).length ? seal(JSON.stringify(secrets)) : null,
            batch: String(o.batch || '').slice(0, 120),
        };
    });
    if (errors.length) throw httpError(`à compléter — ${errors.join(' ; ')}`, 400);
    state.jobs.push(...jobs);
    save();
    kick();
    return jobs.map(publicJob);
}

function listJobs() {
    return state.jobs.map(publicJob).sort((a, b) => a.sendAt - b.sendAt);
}

function action(id, what) {
    const j = state.jobs.find(x => x.id === id);
    if (!j) throw httpError('envoi introuvable', 404);
    if (what === 'cancel') {
        if (j.status !== 'pending') throw httpError('seul un envoi en attente peut être annulé', 409);
        j.status = 'cancelled';
        delete j.secrets;
    } else if (what === 'send-now' || what === 'retry') {
        if (!['pending', 'failed'].includes(j.status) || !j.html) throw httpError('rien à envoyer', 409);
        if (j.secretFields?.length && !j.secrets) throw httpError('valeurs secrètes déjà effacées', 409);
        j.status = 'pending';
        j.sendAt = Date.now();
        delete j.error;
    } else if (what === 'delete') {
        if (j.status === 'pending' || j.status === 'sending') throw httpError("annule l'envoi avant de le supprimer", 409);
        state.jobs = state.jobs.filter(x => x !== j);
    } else {
        throw httpError('action inconnue', 400);
    }
    save();
    kick();
    return publicJob(j);
}

// --- Rendu ---

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtParis = ms => new Date(ms).toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
}).replace(/ (\d{2}:\d{2})$/, ' à $1');

function fill(src, vars, html) {
    return src.replace(VAR_RE, (m, name) => (name in vars ? (html ? esc(vars[name]) : vars[name]) : m));
}

// Version texte (repli pour les clients sans HTML) tirée du HTML rendu
function htmlToText(html) {
    return html
        .replace(/<(style|head|script)[\s\S]*?<\/\1>/gi, '')
        .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, txt) => {
            const t = txt.replace(/<[^>]+>/g, '').trim();
            return t && t !== href ? `${t} : ${href}` : href;
        })
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, ' ')
        .split('\n').map(l => l.trim()).join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .replace(/\n/g, '\r\n');
}

const b64lines = s => Buffer.from(s, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
const encWord = s => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const quoteName = s => (/^[\x20-\x7e]*$/.test(s) ? `"${s.replace(/["\\]/g, '')}"` : encWord(s));

function buildMessage({ from, fromName, to, subject, html }) {
    const boundary = `hermod-${crypto.randomBytes(12).toString('hex')}`;
    const domain = from.split('@')[1] || 'lucipher-lab.fr';
    return [
        `From: ${quoteName(fromName)} <${from}>`,
        `To: <${to}>`,
        `Subject: ${encWord(subject.replace(/[\r\n]+/g, ' '))}`,
        `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
        `Message-ID: <${crypto.randomBytes(16).toString('hex')}@${domain}>`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: base64', '',
        b64lines(htmlToText(html)),
        `--${boundary}`,
        'Content-Type: text/html; charset=utf-8',
        'Content-Transfer-Encoding: base64', '',
        b64lines(html),
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
        sock.once('connect', () => resolve({
            wait: test => new Promise((res, rej) => { waiter = { test, resolve: res, reject: rej }; check(); }),
            send: line => { if (!sock.destroyed) sock.write(line); },
            close: () => sock.end(),
        }));
    });
}

const smtpDone = b => /(^|\r\n)\d{3} [^\r\n]*\r\n$/.test(b);

async function smtp(s, line, expect) {
    if (line) s.send(`${line}\r\n`);
    const r = await s.wait(smtpDone);
    const code = r.trimEnd().split('\r\n').pop().slice(0, 3);
    if (!expect.includes(code)) throw new Error(`SMTP ${line ? line.split(' ')[0] : 'accueil'} : ${r.trim().split('\r\n').pop()}`);
    return r;
}

async function sendSmtp(cfg, user, pass, to, raw) {
    const s = await session(cfg.smtpHost, cfg.smtpPort);
    try {
        await smtp(s, null, ['220']);
        await smtp(s, 'EHLO asgard.lucipher-lab.fr', ['250']);
        await smtp(s, `AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`).toString('base64')}`, ['235']);
        await smtp(s, `MAIL FROM:<${user}>`, ['250']);
        await smtp(s, `RCPT TO:<${to}>`, ['250', '251']);
        await smtp(s, 'DATA', ['354']);
        s.send(`${raw.replace(/\r\n\./g, '\r\n..')}\r\n.\r\n`); // « dot-stuffing »
        await smtp(s, null, ['250']);
        s.send('QUIT\r\n');
    } finally {
        s.close();
    }
}

const imapQuote = s => `"${String(s).replace(/(["\\])/g, '\\$1')}"`;
const tagged = tag => b => new RegExp(`(^|\\r\\n)${tag} (OK|NO|BAD)[^\\r\\n]*\\r\\n$`).test(b);

async function imap(s, tag, line) {
    s.send(`${tag} ${line}\r\n`);
    const r = await s.wait(tagged(tag));
    if (!new RegExp(`(^|\\r\\n)${tag} OK`).test(r)) throw new Error(`IMAP ${line.split(' ')[0]} : ${r.trim().split('\r\n').pop()}`);
    return r;
}

// Range une copie dans le dossier « Envoyés » (attribut \Sent, sinon « Sent »)
async function appendSent(cfg, user, pass, raw) {
    const s = await session(cfg.smtpHost, cfg.imapPort);
    try {
        await s.wait(b => /^\* (OK|PREAUTH)[^\r\n]*\r\n/.test(b));
        await imap(s, 'a1', `LOGIN ${imapQuote(user)} ${imapQuote(pass)}`);
        const listing = await imap(s, 'a2', 'LIST "" "*"');
        const sent = listing.split('\r\n').find(l => /\\Sent\b/i.test(l));
        const folder = sent ? sent.replace(/^.*\) (?:"[^"]*"|NIL) /, '').replace(/^"(.*)"$/, '$1') : 'Sent';
        s.send(`a3 APPEND ${imapQuote(folder)} (\\Seen) {${Buffer.byteLength(raw)}}\r\n`);
        await s.wait(b => /^\+/m.test(b));
        s.send(`${raw}\r\n`);
        const r = await s.wait(tagged('a3'));
        if (!/(^|\r\n)a3 OK/.test(r)) throw new Error(`IMAP APPEND : ${r.trim().split('\r\n').pop()}`);
        s.send('a4 LOGOUT\r\n');
        return folder;
    } finally {
        s.close();
    }
}

async function createWhisper(cfg, content, duration) {
    const r = await fetch(`${cfg.whisperUrl}/api/secrets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, password: '', duration, max_views: 1 }),
        signal: AbortSignal.timeout(20000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.id) throw new Error(`Whisper ${r.status} : ${d.error || JSON.stringify(d)}`);
    return { link: `${cfg.whisperUrl}/secret/${d.id}`, expiresAt: (d.expires_at || 0) * 1000 };
}

// --- Envoi d'un job ---

async function deliver(j) {
    const cfg = config();
    const pass = accounts()[j.from];
    if (!pass) throw new Error(`pas de jeton Mailu configuré pour ${j.from}`);
    const secrets = j.secrets ? JSON.parse(unseal(j.secrets)) : {};
    const vars = { ...j.values, EMAIL: j.to, EXPIRATION: DURATIONS[j.duration] };
    // Les secrets Whisper n'existent qu'à partir de maintenant : leur durée de vie commence à l'envoi
    let expiresAt = Date.now() + DURATION_MS[j.duration];
    for (const [name, content] of Object.entries(secrets)) {
        const w = await createWhisper(cfg, content, j.duration);
        vars[name] = w.link;
        if (w.expiresAt) expiresAt = w.expiresAt;
    }
    vars.EXPIRE_LE = fmtParis(expiresAt);
    const raw = buildMessage({ from: j.from, fromName: j.fromName, to: j.to, subject: fill(j.subject, vars, false), html: fill(j.html, vars, true) });
    await sendSmtp(cfg, j.from, pass, j.to, raw);
    if (Object.keys(secrets).length) j.whisperExpiresAt = expiresAt;
    try {
        j.sentFolder = await appendSent(cfg, j.from, pass, raw);
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
                delete j.secrets; // les valeurs secrètes ne sont plus nécessaires
                delete j.error;
            } catch (e) {
                j.status = 'failed';
                j.error = e.message;
                console.error('hermod:', j.to, e.message);
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

// Aperçu : valeurs saisies, liens Whisper factices, expiration calculée depuis la date prévue
function preview({ templateId, subject, html, fields: draftFields, values, duration, sendAt }) {
    const tpl = state.templates.find(t => t.id === templateId) || {};
    const src = { subject: subject ?? tpl.subject ?? '', html: html ?? tpl.html ?? '' };
    const fields = draftFields || tpl.fields || {}; // l'éditeur de modèle envoie ses réglages non enregistrés
    const d = DURATIONS[duration] ? duration : '24h';
    const vars = { EMAIL: 'destinataire@exemple.fr', ...values, EXPIRATION: DURATIONS[d], EXPIRE_LE: fmtParis((Number(sendAt) || Date.now()) + DURATION_MS[d]) };
    for (const [name, f] of Object.entries(fields)) if (f.type === 'whisper') vars[name] = `${config().whisperUrl}/secret/apercu`;
    return { subject: fill(src.subject, vars, false), html: fill(src.html, vars, true) };
}

function info() {
    return { senders: Object.keys(accounts()), fromName: config().fromName, durations: DURATIONS, autoVars: AUTO_VARS };
}

module.exports = {
    start, info, schedule, listJobs, action, preview, listTemplates, saveTemplate, deleteTemplate,
    buildMessage, htmlToText, DURATIONS,
};
