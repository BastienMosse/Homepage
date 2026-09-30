// Accès Public / VPN des applications Coolify, en un clic et surveillé automatiquement.
//
// Un site « VPN uniquement » = deux choses à la fois :
//   1. les middlewares `error-403@file,vpn-only@file` sur son routeur Traefik HTTPS (labels Coolify)
//   2. une entrée DNS du VPN (Headscale extra_records_path, relu à chaud) : nom → 100.64.0.1,
//      sinon les appareils du VPN passent par l'IP publique et sont bloqués eux aussi.
// Basculer = modifier les labels via l'API Coolify + le fichier DNS, redéployer, vérifier.
// La surveillance (toutes les 5 min) remet le blocage si Coolify a régénéré les labels.
const fs = require('fs');
const path = require('path');
const https = require('https');
const vpnusers = require('./vpnusers.cjs');

const API = (process.env.COOLIFY_API_URL || 'http://coolify:8080/api/v1').replace(/\/$/, '');
const TOKEN = process.env.COOLIFY_API_TOKEN || '';
const DNS_FILE = process.env.HEADSCALE_DNS_FILE || '/app/headscale-dns/extra-records.json';
const VPN_IP = process.env.VPN_SERVER_IP || '100.64.0.1';
const PROXY = process.env.TRAEFIK_HOST || 'coolify-proxy';
const SELF = process.env.COOLIFY_RESOURCE_UUID || '';
const WATCH_MS = 5 * 60e3;
const RETRY_MS = 30 * 60e3;

const VPN_MW = ['error-403@file', 'vpn-only@file'];
// filtre VPN d'une app : son filtre « par utilisateur » (acces-<uuid>) si Asgard peut écrire dans Traefik, sinon l'ancien filtre commun
const isVpnMw = (m) => m === 'vpn-only@file' || /^acces-.+@file$/.test(m);
const vpnMwFor = (uuid) => (vpnusers.isWritable() ? vpnusers.appMiddleware(uuid) : 'vpn-only@file');

// Routes par fichier (pas d'app Coolify) : toujours VPN, règle d'infra
const LOCKED_STATIC = [
    // Asgard : route fichier asgard.yaml (le domaine asgard. seulement, la vitrine lucipher-lab.fr reste publique)
    { name: 'Asgard', host: 'asgard.lucipher-lab.fr' },
    { name: 'Odin', host: 'odin.lucipher-lab.fr' },
    { name: 'Heimdall', host: 'heimdall.lucipher-lab.fr' },
    { name: 'Bifrost', host: 'bifrost.lucipher-lab.fr' },
];

// Particularités connues (CLAUDE.md), affichées avant de basculer
const NOTES = {
    nchvkqvpprclrt0zhvnvm36y: 'Seanime : après le redéploiement, vérifier que le mot de passe est toujours dans config.toml (pense-bête plus bas).',
    xu4pjawjk6lktnryrvrny6k9: 'La route /ygg-zip (fichier ygg-zip.yaml) n’est pas concernée : elle reste joignable, mais exige le jeton OpenList de l’utilisateur.',
    dmcscgwb1wrcm5yzh9avknsh: 'En VPN, les applis Bitwarden du téléphone ne synchronisent plus sans le VPN.',
};

let STATE_FILE = null;
let state = { desired: {}, managedHosts: [], events: [], retryAfter: {} };
let dockerRequest = null;
let job = null;             // opération en cours (une seule à la fois)
const queue = [];

/* ───────── persistance ───────── */

function loadState() {
    try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch { /* premier lancement */ }
}
function saveState() {
    try {
        fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(state, null, 2));
        fs.renameSync(STATE_FILE + '.tmp', STATE_FILE);
    } catch (e) { console.error('Accès : sauvegarde impossible', e.message); }
}
function logEvent(ev) {
    state.events.unshift({ at: Date.now(), ...ev });
    state.events = state.events.slice(0, 60);
    saveState();
    console.log(`Accès : ${ev.name} — ${ev.text}`);
}

/* ───────── API Coolify ───────── */

async function coolify(method, p, body) {
    if (!TOKEN) throw new Error('COOLIFY_API_TOKEN manquant dans l’environnement d’Asgard');
    const r = await fetch(API + p, {
        method,
        headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000),
    });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    if (!r.ok) throw new Error(`Coolify ${method} ${p} → ${r.status} ${typeof data === 'object' ? (data.message || '') : ''}`.trim());
    return data;
}

/* ───────── labels Traefik ───────── */

const decode = (b64) => (b64 ? Buffer.from(b64, 'base64').toString('utf8') : '');
const encode = (s) => Buffer.from(s, 'utf8').toString('base64');

/** Routeurs HTTPS déclarés dans les labels (routers.<nom>.entryPoints=https). */
function httpsRouters(lines) {
    const out = [];
    for (const l of lines) {
        const m = l.match(/^traefik\.http\.routers\.([^.]+)\.entry[pP]oints=(.*)$/);
        if (m && m[2].split(',').map(s => s.trim()).includes('https')) out.push(m[1]);
    }
    return out;
}

function hostsOf(lines, routers) {
    const hosts = new Set();
    for (const r of routers) {
        const rule = lines.find(l => l.startsWith(`traefik.http.routers.${r}.rule=`));
        if (!rule) continue;
        for (const m of rule.matchAll(/Host\(`([^`]+)`\)/g)) hosts.add(m[1].toLowerCase());
    }
    return [...hosts];
}

const mwKey = (r) => `traefik.http.routers.${r}.middlewares=`;
function middlewaresOf(lines, r) {
    const l = lines.find(x => x.startsWith(mwKey(r)));
    return l ? l.slice(mwKey(r).length).split(',').map(s => s.trim()).filter(Boolean) : [];
}

/** VPN = tous les routeurs HTTPS ont un filtre VPN (commun ou par utilisateur). */
function labelsAreVpn(lines, routers) {
    return routers.length > 0 && routers.every(r => middlewaresOf(lines, r).some(isVpnMw));
}
/** Encore sur l'ancien filtre commun (à passer sur le filtre par utilisateur) ? */
const usesCommonFilter = (lines, routers) => routers.some(r => middlewaresOf(lines, r).includes('vpn-only@file'));

function withAccess(lines, routers, vpn, vpnMw = 'vpn-only@file') {
    let out = [...lines];
    for (const r of routers) {
        const mws = middlewaresOf(out, r).filter(m => m !== 'error-403@file' && !isVpnMw(m));
        const next = vpn ? ['error-403@file', vpnMw, ...mws] : mws;
        const idx = out.findIndex(x => x.startsWith(mwKey(r)));
        if (!next.length) { if (idx >= 0) out.splice(idx, 1); continue; }
        const line = mwKey(r) + next.join(',');
        if (idx >= 0) out[idx] = line;
        else {
            const ruleIdx = out.findIndex(x => x.startsWith(`traefik.http.routers.${r}.rule=`));
            out.splice(ruleIdx >= 0 ? ruleIdx : out.length, 0, line);
        }
    }
    return out;
}

/* ───────── DNS du VPN (Headscale extra_records_path) ───────── */

function readDns() {
    try { return JSON.parse(fs.readFileSync(DNS_FILE, 'utf8')); } catch (e) {
        if (e.code === 'ENOENT') throw new Error(`Fichier DNS du VPN introuvable (${DNS_FILE}) : monter /opt/headscale/config/dns dans Asgard`);
        throw new Error('Fichier DNS du VPN illisible : ' + e.message);
    }
}
function writeDns(records) {
    const tmp = DNS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(records, null, 2) + '\n', { mode: 0o644 });
    fs.chmodSync(tmp, 0o644);
    fs.renameSync(tmp, DNS_FILE); // écriture atomique : Headscale relit le fichier en quelques secondes
}
function setDns(hosts, present) {
    const recs = readDns();
    const locked = new Set(LOCKED_STATIC.map(s => s.host));
    let next = recs.filter(r => !(hosts.includes(String(r.name).toLowerCase()) && !locked.has(String(r.name).toLowerCase())));
    if (present) next = [...next, ...hosts.map(h => ({ name: h, type: 'A', value: VPN_IP }))];
    const changed = JSON.stringify(next) !== JSON.stringify(recs);
    if (changed) writeDns(next);
    const managed = new Set(state.managedHosts);
    hosts.forEach(h => (present ? managed.add(h) : managed.delete(h)));
    state.managedHosts = [...managed];
    return changed;
}
const dnsHas = (recs, host) => recs.some(r => String(r.name).toLowerCase() === host && r.value === VPN_IP);

/* ───────── état réel ───────── */

/** Conteneur en cours de l'app : ses labels disent ce que Traefik applique vraiment. */
async function runningVpn(uuid) {
    try {
        const list = await dockerRequest('GET', '/containers/json');
        const c = (Array.isArray(list) ? list : []).find(x => (x.Names || []).some(n => n.replace(/^\//, '').startsWith(uuid)));
        if (!c) return null;
        const keys = Object.entries(c.Labels || {}).filter(([k]) => /^traefik\.http\.routers\.https[^.]*\.middlewares$/.test(k));
        if (!keys.length) return false;
        return keys.every(([, v]) => String(v).split(',').map(s => s.trim()).some(isVpnMw));
    } catch { return null; }
}

/** Requête vers Traefik depuis Asgard (IP Docker, donc « hors VPN ») : 403 = bloqué. */
function probeOutside(host) {
    return new Promise(resolve => {
        const r = https.request({ host: PROXY, port: 443, servername: host, path: '/', method: 'GET', headers: { Host: host, 'User-Agent': 'asgard-acces' }, timeout: 6000 }, res => { res.resume(); resolve(res.statusCode || 0); });
        r.on('timeout', () => { r.destroy(); resolve(0); });
        r.on('error', () => resolve(0));
        r.end();
    });
}

async function listApps() {
    const apps = await coolify('GET', '/applications');
    return (Array.isArray(apps) ? apps : []).map(a => {
        const lines = decode(a.custom_labels).split('\n').map(l => l.trim()).filter(Boolean);
        const routers = httpsRouters(lines);
        return { uuid: a.uuid, name: a.name, lines, routers, hosts: hostsOf(lines, routers), vpn: labelsAreVpn(lines, routers), common: usesCommonFilter(lines, routers) };
    }).filter(a => a.routers.length && a.hosts.length);
}

const lockReason = (a) => (a.uuid === SELF ? 'Asgard lui-même : le passer en VPN couperait aussi la vitrine lucipher-lab.fr' : null);

/* ───────── bascule ───────── */

function step(j, label) {
    const s = { label, state: 'run' };
    j.steps.push(s);
    return {
        ok: (detail) => { s.state = 'ok'; if (detail) s.detail = detail; },
        fail: (detail) => { s.state = 'fail'; s.detail = detail; },
    };
}

async function waitDeploy(depUuid, j) {
    const t0 = Date.now();
    while (Date.now() - t0 < 20 * 60e3) {
        await new Promise(r => setTimeout(r, 3000));
        let d;
        try { d = await coolify('GET', `/deployments/${depUuid}`); } catch { continue; }
        j.deployStatus = d.status;
        if (d.status === 'finished') return;
        if (['failed', 'cancelled-by-user', 'cancelled'].includes(d.status)) throw new Error(`redéploiement ${d.status}`);
    }
    throw new Error('redéploiement trop long (20 min)');
}

async function apply(uuid, target, meta = {}) {
    const apps = await listApps();
    const app = apps.find(a => a.uuid === uuid);
    if (!app) throw new Error('application introuvable');
    const vpn = target === 'vpn';
    const j = { uuid, name: app.name, target, auto: !!meta.auto, reason: meta.reason, steps: [], status: 'run', startedAt: Date.now() };
    job = j;
    const before = app.lines;
    let dnsAdded = false;
    try {
        // 1. VPN : l'entrée DNS d'abord, pour ne jamais se bloquer soi-même
        if (vpn) {
            const s = step(j, 'Entrée DNS du VPN');
            dnsAdded = setDns(app.hosts, true);
            saveState();
            s.ok(app.hosts.join(', '));
        }
        // 1 bis. VPN : le filtre « par utilisateur » de ce site doit exister avant que le site s'en serve
        if (vpn && vpnusers.isWritable()) {
            const s = step(j, 'Filtre « qui accède à quoi »');
            vpnusers.ensureSite(uuid, app.name, app.hosts);
            const r = await vpnusers.applyFiles(`${app.name} passé en VPN`);
            if (r.error) { s.fail(r.error); throw new Error(r.error); }
            s.ok();
        }
        // 2. filtres Traefik
        const s2 = step(j, vpn ? 'Filtres : bloquer hors VPN' : 'Filtres : ouvrir à tous');
        const next = withAccess(before, app.routers, vpn, vpnMwFor(uuid));
        await coolify('PATCH', `/applications/${uuid}`, { custom_labels: encode(next.join('\n')) });
        s2.ok();
        // 3. redéploiement (les labels ne changent qu'à la création du conteneur)
        const s3 = step(j, 'Redéploiement');
        let dep;
        try {
            const r = await coolify('POST', `/deploy?uuid=${uuid}`);
            dep = r?.deployments?.[0]?.deployment_uuid;
            if (!dep) throw new Error('pas de déploiement lancé');
            await waitDeploy(dep, j);
        } catch (e) {
            s3.fail(e.message);
            // retour à l'état d'avant : l'ancien conteneur tourne toujours
            await coolify('PATCH', `/applications/${uuid}`, { custom_labels: encode(before.join('\n')) }).catch(() => {});
            if (vpn && dnsAdded) setDns(app.hosts, false);
            throw new Error(`${e.message} — configuration remise comme avant`);
        }
        s3.ok();
        // 4. vérification réelle
        const s4 = step(j, 'Vérification');
        let ok = false, last = '';
        for (let i = 0; i < 30 && !ok; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const run = await runningVpn(uuid);
            const codes = await Promise.all(app.hosts.map(probeOutside));
            last = codes.join(', ');
            ok = run === vpn && codes.every(c => (vpn ? c === 403 : c !== 403 && c !== 0));
        }
        if (!ok) { s4.fail(`réponse hors VPN : ${last}`); throw new Error(`la vérification a échoué (réponse hors VPN : ${last})`); }
        s4.ok(vpn ? `hors VPN : ${last} (bloqué)` : `hors VPN : ${last} (ouvert)`);
        // 5. public : on retire l'entrée DNS (inutile, mais on garde le fichier propre)
        if (!vpn) {
            const s5 = step(j, 'Entrée DNS du VPN retirée');
            setDns(app.hosts, false);
            s5.ok();
        }
        state.desired[uuid] = target;
        delete state.retryAfter[uuid];
        j.status = 'ok';
        logEvent({ uuid, name: app.name, ok: true, auto: !!meta.auto, text: `${vpn ? 'VPN uniquement' : 'public'}${meta.reason ? ' — ' + meta.reason : ''}` });
    } catch (e) {
        j.status = 'fail';
        j.error = e.message;
        if (meta.auto) state.retryAfter[uuid] = Date.now() + RETRY_MS;
        logEvent({ uuid, name: app.name, ok: false, auto: !!meta.auto, text: `échec du passage en ${vpn ? 'VPN' : 'public'} : ${e.message}` });
    } finally {
        j.endedAt = Date.now();
        saveState();
    }
}

function enqueue(uuid, target, meta) {
    if ((job && job.status === 'run' && job.uuid === uuid) || queue.some(q => q.uuid === uuid)) return false;
    queue.push({ uuid, target, meta });
    pump();
    return true;
}
async function pump() {
    if (job && job.status === 'run') return;
    const next = queue.shift();
    if (!next) return;
    try { await apply(next.uuid, next.target, next.meta); } catch (e) { console.error('Accès :', e.message); }
    pump();
}

/* ───────── surveillance automatique ───────── */

async function watch() {
    if (job && job.status === 'run') return;
    let apps;
    try { apps = await listApps(); } catch (e) { console.error('Accès (surveillance) :', e.message); return; }
    let recs = [];
    try { recs = readDns(); } catch (e) { console.error('Accès (surveillance) :', e.message); return; }
    for (const a of apps) {
        const desired = state.desired[a.uuid];
        if (!desired) { state.desired[a.uuid] = a.vpn ? 'vpn' : 'public'; saveState(); continue; } // nouvelle app : on prend son état
        if ((state.retryAfter[a.uuid] || 0) > Date.now()) continue;
        if (desired === 'vpn' && !a.vpn) {
            enqueue(a.uuid, 'vpn', { auto: true, reason: 'le blocage VPN avait disparu des labels (régénérés par Coolify ?), remis automatiquement' });
            continue;
        }
        if (desired === 'public' && a.vpn) {
            // passé en VPN à la main dans Coolify : on adopte (le VPN l'emporte)
            state.desired[a.uuid] = 'vpn';
            setDns(a.hosts, true);
            logEvent({ uuid: a.uuid, name: a.name, ok: true, auto: true, text: 'passé en VPN à la main dans Coolify : adopté, entrée DNS du VPN ajoutée' });
            continue;
        }
        if (a.vpn && a.common && vpnusers.isWritable()) {
            enqueue(a.uuid, 'vpn', { auto: true, reason: 'passage au filtre « qui accède à quoi » (droits par utilisateur)' });
            continue;
        }
        const run = await runningVpn(a.uuid);
        if (run !== null && run !== a.vpn) {
            enqueue(a.uuid, a.vpn ? 'vpn' : 'public', { auto: true, reason: 'le conteneur ne correspondait pas à sa configuration, redéployé automatiquement' });
            continue;
        }
        if (a.vpn && a.hosts.some(h => !dnsHas(recs, h))) {
            setDns(a.hosts, true);
            logEvent({ uuid: a.uuid, name: a.name, ok: true, auto: true, text: 'entrée DNS du VPN manquante : rajoutée' });
        }
    }
}

/* ───────── vue d'ensemble pour l'interface ───────── */

async function watchVpnUsers() {
    if (!vpnusers.isWritable()) return;
    const r = await vpnusers.applyFiles('surveillance (nouveaux appareils ?)');
    if (r.traefik === 'écrit' || r.acl === 'appliquée') logEvent({ uuid: '', name: 'VPN', ok: !r.error, auto: true, text: `droits par utilisateur mis à jour (Traefik : ${r.traefik}, Headscale : ${r.acl})` });
}

async function overview() {
    const apps = (await listApps()).filter(a => a.uuid !== SELF); // Asgard : ligne « toujours VPN » plus bas
    let recs = [], dnsError = null;
    try { recs = readDns(); } catch (e) { dnsError = e.message; }
    const running = await Promise.all(apps.map(a => runningVpn(a.uuid)));
    const outside = await Promise.all(apps.map(a => probeOutside(a.hosts[0])));
    const items = apps.map((a, i) => ({
        uuid: a.uuid, name: a.name, hosts: a.hosts,
        access: a.vpn ? 'vpn' : 'public',
        running: running[i],
        dns: a.hosts.every(h => dnsHas(recs, h)),
        outside: outside[i],
        locked: lockReason(a),
        note: NOTES[a.uuid] || null,
        pending: (job && job.status === 'run' && job.uuid === a.uuid) || queue.some(q => q.uuid === a.uuid),
    })).sort((x, y) => x.name.localeCompare(y.name, 'fr'));

    // services docker-compose (Hermod, Outline…) : affichés, pas encore modifiables d'ici
    let services = [];
    try {
        const list = await coolify('GET', '/services');
        services = (Array.isArray(list) ? list : []).flatMap(s => (s.applications || []).filter(x => x.fqdn).map(x => ({ name: s.name, hosts: String(x.fqdn).split(',').map(u => u.replace(/^https?:\/\//, '').replace(/\/.*$/, '')) })));
    } catch { /* facultatif */ }
    const svc = await Promise.all(services.map(async s => ({ ...s, outside: await probeOutside(s.hosts[0]) })));
    const locked = await Promise.all(LOCKED_STATIC.map(async s => ({ ...s, dns: dnsHas(recs, s.host), outside: await probeOutside(s.host) })));

    const vpn = await vpnusers.overview().catch((e) => ({ error: e.message, users: [], sites: [] }));
    return { items, services: svc, locked, vpn, job, queue: queue.map(q => q.uuid), events: state.events.slice(0, 30), dnsError, tokenMissing: !TOKEN, at: Date.now() };
}

function request(uuid, target) {
    if (!['vpn', 'public'].includes(target)) throw Object.assign(new Error('cible invalide'), { status: 400 });
    if (uuid === SELF) throw Object.assign(new Error('Asgard ne peut pas être basculé d’ici'), { status: 403 });
    delete state.retryAfter[uuid];
    if (!enqueue(uuid, target, { auto: false })) throw Object.assign(new Error('déjà en cours'), { status: 409 });
}

function start(stateFile, docker) {
    STATE_FILE = stateFile;
    dockerRequest = docker;
    loadState();
    vpnusers.init(() => state, saveState, async () => (await listApps()).filter(a => a.vpn));
    setTimeout(async () => { await watchVpnUsers().catch(() => {}); watch(); }, 30e3);
    setInterval(async () => { await watchVpnUsers().catch(() => {}); watch(); }, WATCH_MS);
}

async function vpnRequest(body) {
    if (typeof body.user !== 'string' || !body.user) throw Object.assign(new Error('utilisateur manquant'), { status: 400 });
    if (typeof body.admin === 'boolean') return vpnusers.setAdmin(body.user, body.admin);
    if (typeof body.site !== 'string' || typeof body.allowed !== 'boolean') throw Object.assign(new Error('requête invalide'), { status: 400 });
    return vpnusers.setAccess(body.site, body.user, body.allowed);
}

module.exports = { start, overview, request, vpnRequest, _test: { httpsRouters, hostsOf, labelsAreVpn, withAccess } };
