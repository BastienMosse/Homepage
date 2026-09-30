// Qui accède à quoi dans le VPN : une case par utilisateur Headscale et par site réservé au VPN.
//
// Deux verrous, écrits par Asgard à partir des cases cochées :
//   1. Traefik — un filtre par site (`acces-<site>@file`, fichier asgard-acces.yaml) qui n'accepte que les
//      IP des appareils des utilisateurs autorisés (lues dans Headscale : un nouvel appareil hérite des droits
//      de son utilisateur). C'est ce qui distingue Bragi d'Odin : ils sont tous sur 100.64.0.1:443.
//   2. Headscale — la politique d'accès (ACL) : les administrateurs joignent tout, les autres seulement
//      le serveur en HTTPS (pas les autres appareils, pas le SSH). Nécessite `policy.mode: database`.
const fs = require('fs');
const path = require('path');
const http = require('http');

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const TRAEFIK_DIR = process.env.TRAEFIK_DYNAMIC_DIR || '/app/traefik-dynamic';
const OUT_FILE = path.join(TRAEFIK_DIR, 'asgard-acces.yaml');
const HS = process.env.HEADSCALE_CONTAINER || 'headscale-lpdqjrjdfiqqtmlcaxgxqost';
// dossier partagé avec Headscale (déjà monté pour le DNS du VPN) : /app/headscale-dns ↔ /etc/headscale/dns
const DNS_DIR = path.dirname(process.env.HEADSCALE_DNS_FILE || '/app/headscale-dns/extra-records.json');
const POLICY_LOCAL = path.join(DNS_DIR, 'asgard-acl.hujson');
const POLICY_IN_HS = '/etc/headscale/dns/asgard-acl.hujson';
const VPN_IP = process.env.VPN_SERVER_IP || '100.64.0.1';

/** Sites VPN routés par fichier (pas d'app Coolify). Les apps VPN s'ajoutent automatiquement. */
const STATIC_SITES = [
    { key: 'odin', name: 'Odin', hosts: ['odin.lucipher-lab.fr'] },
    { key: 'heimdall', name: 'Heimdall', hosts: ['heimdall.lucipher-lab.fr'] },
    { key: 'bifrost', name: 'Bifrost', hosts: ['bifrost.lucipher-lab.fr'] },
];

let state = null;          // partagé avec access.cjs (même fichier access.json)
let save = () => {};
let getVpnApps = async () => [];
let last = { at: 0, traefik: null, acl: null, error: null, aclMode: null };

const mwName = (key) => `acces-${key}`;

/* ───────── Docker : exécuter une commande dans le conteneur Headscale ───────── */

function dockerApi(method, p, body) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const req = http.request({ socketPath: DOCKER_SOCKET, path: p, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks) }));
        });
        req.on('error', reject);
        req.setTimeout(30000, () => req.destroy(new Error('docker : délai dépassé')));
        if (data) req.write(data);
        req.end();
    });
}

async function hsExec(args) {
    const c = await dockerApi('POST', `/containers/${HS}/exec`, { AttachStdout: true, AttachStderr: true, Cmd: ['headscale', ...args] });
    if (c.status >= 300) throw new Error(`Headscale injoignable (${c.status})`);
    const id = JSON.parse(c.buf.toString()).Id;
    const r = await dockerApi('POST', `/exec/${id}/start`, { Detach: false, Tty: false });
    // flux multiplexé Docker : [type(1) 0 0 0 taille(4)] + données
    let out = '', err = '';
    for (let i = 0; i + 8 <= r.buf.length;) {
        const len = r.buf.readUInt32BE(i + 4);
        const chunk = r.buf.slice(i + 8, i + 8 + len).toString();
        if (r.buf[i] === 2) err += chunk; else out += chunk;
        i += 8 + len;
    }
    const info = JSON.parse((await dockerApi('GET', `/exec/${id}/json`)).buf.toString());
    return { code: info.ExitCode, out, err };
}

async function hsJson(args) {
    const r = await hsExec([...args, '-o', 'json']);
    if (r.code !== 0) throw new Error((r.err || r.out).trim().slice(0, 200) || 'erreur Headscale');
    return JSON.parse(r.out || '[]');
}

/** Utilisateurs Headscale + leurs appareils (IP). */
async function listUsers() {
    const [users, nodes] = await Promise.all([hsJson(['users', 'list']), hsJson(['nodes', 'list'])]);
    return (users || []).map((u) => ({
        name: u.name,
        devices: (nodes || []).filter((n) => n.user && n.user.name === u.name).map((n) => ({ name: n.given_name || n.name, ips: n.ip_addresses || [], online: !!n.online })),
    }));
}

/** Politique en base de données (modifiable) ou en fichier (lecture seule pour Asgard) ? */
async function aclMode() {
    const r = await hsExec(['policy', 'get']);
    const txt = (r.out + r.err);
    if (/reading policy from path/i.test(txt)) return 'file';
    return 'database';
}

/* ───────── état : cases cochées ───────── */

function vpnState() {
    if (!state.vpn) state.vpn = { admins: ['admin'], sites: {} };
    if (!state.vpn.admins.includes('admin')) state.vpn.admins.unshift('admin');
    return state.vpn;
}

async function allSites() {
    const apps = await getVpnApps();
    const v = vpnState();
    const sites = [...STATIC_SITES, ...apps.map((a) => ({ key: a.uuid, name: a.name, hosts: a.hosts, app: true }))];
    // site en train de passer en VPN (son filtre doit exister avant le redéploiement)
    for (const [key, st] of Object.entries(v.sites)) if (st.pending && !sites.some((x) => x.key === key)) sites.push({ key, name: st.name || key, hosts: st.hosts || [], app: true });
    for (const s of sites) {
        if (!v.sites[s.key]) v.sites[s.key] = { users: [] }; // nouveau site : administrateurs seulement
        if (s.app && apps.some((a) => a.uuid === s.key)) delete v.sites[s.key].pending;
    }
    return sites;
}

/* ───────── écriture des deux verrous ───────── */

const cidr = (ip) => (ip.includes(':') ? `${ip}/128` : `${ip}/32`);

function traefikYaml(sites, users, v) {
    const lines = [
        '# ÉCRIT PAR ASGARD (onglet Serveur → Accès → « Qui accède à quoi ») : ne pas modifier à la main,',
        '# les changements seraient écrasés. Un filtre par site réservé au VPN : IP des appareils autorisés.',
        'http:', '  middlewares:',
    ];
    for (const s of sites) {
        const allowed = new Set([...v.admins, ...(v.sites[s.key]?.users || [])]);
        const ips = users.filter((u) => allowed.has(u.name)).flatMap((u) => u.devices.flatMap((d) => d.ips)).map(cidr);
        lines.push(`    ${mwName(s.key)}:`, `      # ${s.name} : ${[...allowed].join(', ')}`, '      ipAllowList:', '        sourceRange:');
        for (const ip of ips.length ? [...new Set(ips)] : ['127.0.0.1/32']) lines.push(`          - "${ip}"`);
    }
    return lines.join('\n') + '\n';
}

function policyJson(users, v) {
    const admins = users.filter((u) => v.admins.includes(u.name)).map((u) => `${u.name}@`);
    const limited = users.filter((u) => !v.admins.includes(u.name)).map((u) => `${u.name}@`);
    if (!limited.length) return { acls: [{ action: 'accept', src: ['*'], dst: ['*:*'] }] }; // que des administrateurs : tout ouvert
    return {
        groups: { 'group:admin': admins, 'group:limite': limited },
        hosts: { srv01: VPN_IP },
        acls: [
            { action: 'accept', src: ['group:admin'], dst: ['*:*'] },   // administrateurs : tout
            { action: 'accept', src: ['group:limite'], dst: ['srv01:443'] }, // les autres : sites du serveur (le filtre Traefik choisit lesquels)
        ],
    };
}

function writeAtomic(file, text) {
    const tmp = file + '.tmp'; // extension .tmp : ignorée par Traefik pendant l'écriture
    fs.writeFileSync(tmp, text, { mode: 0o644 });
    fs.renameSync(tmp, file);
}

/** Recalcule et écrit les deux verrous (seulement s'ils ont changé). */
async function applyFiles(reason = '') {
    const v = vpnState();
    const res = { at: Date.now(), traefik: null, acl: null, error: null, aclMode: null, reason };
    try {
        const [users, sites] = await Promise.all([listUsers(), allSites()]);
        // 1. Traefik
        const yaml = traefikYaml(sites, users, v);
        let old = '';
        try { old = fs.readFileSync(OUT_FILE, 'utf8'); } catch { /* premier passage */ }
        if (old !== yaml) { writeAtomic(OUT_FILE, yaml); res.traefik = 'écrit'; } else res.traefik = 'inchangé';
        // 2. Headscale (si la politique est en base de données)
        res.aclMode = await aclMode();
        if (res.aclMode === 'database') {
            const pol = JSON.stringify(policyJson(users, v), null, 2) + '\n';
            if (state.vpnPolicy !== pol) {
                writeAtomic(POLICY_LOCAL, pol);
                const chk = await hsExec(['policy', 'check', '-f', POLICY_IN_HS]);
                if (chk.code !== 0) throw new Error('politique refusée par Headscale : ' + (chk.err || chk.out).trim().slice(0, 200));
                const set = await hsExec(['policy', 'set', '-f', POLICY_IN_HS]);
                if (set.code !== 0) throw new Error('politique non appliquée : ' + (set.err || set.out).trim().slice(0, 200));
                state.vpnPolicy = pol;
                res.acl = 'appliquée';
            } else res.acl = 'inchangée';
        } else res.acl = 'inactive (politique Headscale en mode fichier)';
        save();
    } catch (e) {
        res.error = e.message;
        console.error('Accès VPN :', e.message);
    }
    last = res;
    return res;
}

/* ───────── interface ───────── */

async function overview() {
    const v = vpnState();
    let users = [], sites = [], error = null;
    try { [users, sites] = await Promise.all([listUsers(), allSites()]); } catch (e) { error = e.message; }
    const writable = (() => { try { fs.accessSync(TRAEFIK_DIR, fs.constants.W_OK); return true; } catch { return false; } })();
    return {
        writable, error, last,
        users: users.map((u) => ({ ...u, admin: v.admins.includes(u.name), locked: u.name === 'admin' })),
        sites: sites.map((s) => ({ key: s.key, name: s.name, hosts: s.hosts, users: v.sites[s.key]?.users || [] })),
    };
}

async function setAccess(site, user, allowed) {
    const v = vpnState();
    await allSites();
    if (!v.sites[site]) throw Object.assign(new Error('site inconnu'), { status: 404 });
    const s = new Set(v.sites[site].users);
    allowed ? s.add(user) : s.delete(user);
    v.sites[site].users = [...s];
    save();
    return applyFiles(`${user} ${allowed ? '→' : '✕'} ${site}`);
}

async function setAdmin(user, admin) {
    const v = vpnState();
    if (user === 'admin' && !admin) throw Object.assign(new Error('l’utilisateur admin reste administrateur (sinon tu te bloquerais dehors)'), { status: 403 });
    const s = new Set(v.admins);
    admin ? s.add(user) : s.delete(user);
    v.admins = [...s];
    save();
    return applyFiles(`${user} ${admin ? 'administrateur' : 'accès limité'}`);
}

function ensureSite(key, name, hosts) {
    const v = vpnState();
    v.sites[key] = { users: v.sites[key]?.users || [], pending: true, name, hosts };
    save();
}

/** Filtre Traefik à mettre sur une app Coolify passée en VPN. */
const appMiddleware = (uuid) => `${mwName(uuid)}@file`;
const isWritable = () => { try { fs.accessSync(TRAEFIK_DIR, fs.constants.W_OK); return true; } catch { return false; } };

function init(sharedState, saveFn, vpnAppsFn) {
    state = sharedState();
    save = saveFn;
    getVpnApps = vpnAppsFn;
    vpnState();
}

module.exports = { init, overview, setAccess, setAdmin, applyFiles, appMiddleware, isWritable, ensureSite, _test: { traefikYaml, policyJson } };
