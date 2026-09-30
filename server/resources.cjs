// Consommation des ressources par service (onglet Serveur → « Qui consomme quoi »)
//
// Toutes les 15 s : stats « one-shot » de chaque conteneur via le socket Docker (~5 ms chacun).
// Le CPU se calcule entre deux échantillons (total_usage / system_cpu_usage) = % de la machine
// entière (4 cœurs = 100 %), comme la jauge CPU. Historique en mémoire sur 24 h (perdu si
// Asgard redémarre), pour les moyennes 1 h et les pics 24 h.

const fs = require('fs');
const os = require('os');
const path = require('path');

const INTERVAL = 15000;
const HISTORY = 24 * 3600 * 1000 / INTERVAL;   // 5760 points = 24 h
const SPARK = 60;                               // points de la mini-courbe (1 h)
const PROC_DIR = process.env.PROC_DIR || '/host/proc';

const SYSTEM = new Set(['coolify', 'coolify-proxy', 'coolify-db', 'coolify-redis', 'coolify-realtime', 'coolify-sentinel']);
// Conteneurs qu'on ne propose pas d'arrêter depuis Asgard : ils coupent Asgard, le VPN ou tout le serveur
const PROTECTED = {
    'coolify-proxy': 'arrête tous les sites',
    'coolify': 'Odin (Coolify) : déploiements',
    'coolify-db': 'base de Coolify',
    'coolify-redis': 'Coolify',
    'coolify-realtime': 'Coolify',
    'headscale-lpdqjrjdfiqqtmlcaxgxqost': 'coupe le VPN (et donc Odin / Heimdall)',
};

let docker = null;
let nameFor = () => null;

// Nom affiché : celui du layout d'Asgard s'il est soigné, sinon « bragi-transcription » → « Bragi transcription »
function pretty(key) {
    const n = nameFor(key);
    if (n && n !== key) return n;
    const k = key.replace(/-/g, ' ');
    return k.charAt(0).toUpperCase() + k.slice(1);
}
const series = new Map();   // id → { name, t: Float64Array, cpu: Float32Array, mem: Float32Array, n, head, prev }
let host = { prev: null, cpu: 0 };
let last = { at: 0, containers: [] };
let timer = null;

function ring() {
    return { t: new Float64Array(HISTORY), cpu: new Float32Array(HISTORY), mem: new Float32Array(HISTORY), n: 0, head: 0 };
}

function push(r, t, cpu, mem) {
    r.t[r.head] = t; r.cpu[r.head] = cpu; r.mem[r.head] = mem;
    r.head = (r.head + 1) % HISTORY;
    if (r.n < HISTORY) r.n++;
}

// Points du plus ancien au plus récent, depuis `since`
function points(r, since) {
    const out = [];
    for (let i = 0; i < r.n; i++) {
        const k = (r.head - r.n + i + HISTORY) % HISTORY;
        if (r.t[k] >= since) out.push(k);
    }
    return out;
}

function hostCpu() {
    try {
        const parts = fs.readFileSync(path.join(PROC_DIR, 'stat'), 'utf8').split('\n')[0].split(/\s+/).slice(1).map(Number);
        const idle = parts[3] + (parts[4] || 0);
        const total = parts.reduce((a, b) => a + b, 0);
        const prev = host.prev;
        host.prev = { idle, total };
        if (prev && total > prev.total) host.cpu = (1 - (idle - prev.idle) / (total - prev.total)) * 100;
    } catch { /* /host/proc absent (dev) */ }
}

function hostMem() {
    try {
        const data = fs.readFileSync(path.join(PROC_DIR, 'meminfo'), 'utf8');
        const get = k => { const m = data.match(new RegExp(`${k}:\\s+(\\d+)`)); return m ? parseInt(m[1]) * 1024 : 0; };
        const total = get('MemTotal');
        return { total, used: total - get('MemAvailable') };
    } catch { return { total: os.totalmem(), used: os.totalmem() - os.freemem() }; }
}

function sum(list, pick) { return (list || []).reduce((a, x) => a + (pick(x) || 0), 0); }

async function sampleOne(c, now) {
    const raw = await docker('GET', `/containers/${c.Id}/stats?stream=false&one-shot=true`);
    if (!raw || typeof raw !== 'object' || !raw.cpu_stats) return;
    const ms = raw.memory_stats || {};
    // Comme `docker stats` : on retire le cache de fichiers récupérable
    const mem = Math.max(0, (ms.usage || 0) - (ms.stats?.inactive_file ?? ms.stats?.cache ?? 0));
    const cur = {
        at: now,
        cpuTotal: raw.cpu_stats.cpu_usage?.total_usage || 0,
        sysTotal: raw.cpu_stats.system_cpu_usage || 0,
        rx: sum(Object.values(raw.networks || {}), n => n.rx_bytes),
        tx: sum(Object.values(raw.networks || {}), n => n.tx_bytes),
        rd: sum(raw.blkio_stats?.io_service_bytes_recursive, x => x.op?.toLowerCase() === 'read' ? x.value : 0),
        wr: sum(raw.blkio_stats?.io_service_bytes_recursive, x => x.op?.toLowerCase() === 'write' ? x.value : 0),
        pids: raw.pids_stats?.current || 0,
        mem,
    };
    let s = series.get(c.Id);
    if (!s) { s = { ...ring(), prev: null }; series.set(c.Id, s); }
    const p = s.prev;
    s.prev = cur;
    if (!p) return;
    const dt = (now - p.at) / 1000 || 1;
    const dSys = cur.sysTotal - p.sysTotal;
    const cpu = dSys > 0 ? Math.max(0, (cur.cpuTotal - p.cpuTotal) / dSys * 100) : 0;
    s.rate = {
        cpu, mem,
        rx: Math.max(0, (cur.rx - p.rx) / dt), tx: Math.max(0, (cur.tx - p.tx) / dt),
        rd: Math.max(0, (cur.rd - p.rd) / dt), wr: Math.max(0, (cur.wr - p.wr) / dt),
        pids: cur.pids,
    };
    push(s, now, cpu, mem);
}

async function sample() {
    const now = Date.now();
    let list;
    try { list = await docker('GET', '/containers/json?all=true'); } catch { return; }
    if (!Array.isArray(list)) return;
    hostCpu();
    const running = list.filter(c => c.State === 'running');
    // Par paquets de 8 pour ne pas saturer le démon Docker
    for (let i = 0; i < running.length; i += 8) {
        await Promise.all(running.slice(i, i + 8).map(c => sampleOne(c, now).catch(() => {})));
    }
    const alive = new Set(list.map(c => c.Id));
    for (const id of series.keys()) if (!alive.has(id)) series.delete(id);
    // Conteneur arrêté : on oublie le dernier compteur (le prochain démarrage repart de zéro)
    for (const c of list) if (c.State !== 'running' && series.get(c.Id)) series.get(c.Id).prev = null;
    last = { at: now, containers: list };
}

function groupOf(c) {
    const labels = c.Labels || {};
    const dockerName = (c.Names?.[0] || '').replace(/^\//, '');
    if (SYSTEM.has(dockerName)) return { key: '_coolify', label: 'Coolify (Odin)', kind: 'system' };
    if (labels['coolify.managed'] !== 'true') return { key: '_other', label: 'Hors Coolify', kind: 'other' };
    const key = labels['coolify.serviceName'] || labels['coolify.resourceName'] || dockerName;
    const isService = labels['coolify.type'] === 'service';
    const gkey = isService ? `svc-${labels['coolify.serviceId'] || key}` : key;
    return { key: gkey, kind: isService ? 'service' : 'app', part: key };
}

function stat(s, since, pick) {
    if (!s) return { avg: 0, max: 0 };
    const ks = points(s, since);
    if (!ks.length) return { avg: 0, max: 0 };
    let tot = 0, max = 0;
    for (const k of ks) { const v = pick(s, k); tot += v; if (v > max) max = v; }
    return { avg: tot / ks.length, max };
}

// Mini-courbe : dernière heure, moyennée en SPARK paquets
function spark(s, now, field) {
    const out = new Array(SPARK).fill(null);
    if (!s) return out;
    const start = now - 3600e3, step = 3600e3 / SPARK;
    const acc = new Array(SPARK).fill(0), cnt = new Array(SPARK).fill(0);
    for (const k of points(s, start)) {
        const b = Math.min(SPARK - 1, Math.floor((s.t[k] - start) / step));
        acc[b] += s[field][k]; cnt[b]++;
    }
    for (let b = 0; b < SPARK; b++) if (cnt[b]) out[b] = acc[b] / cnt[b];
    return out;
}

function overview() {
    const now = Date.now();
    const selfId = os.hostname();
    const groups = new Map();
    for (const c of last.containers) {
        const g = groupOf(c);
        const dockerName = (c.Names?.[0] || '').replace(/^\//, '');
        const s = series.get(c.Id);
        const running = c.State === 'running';
        const r = running && s?.rate ? s.rate : { cpu: 0, mem: 0, rx: 0, tx: 0, rd: 0, wr: 0, pids: 0 };
        const h1 = stat(s, now - 3600e3, (x, k) => x.cpu[k]);
        const d1 = stat(s, now - 86400e3, (x, k) => x.cpu[k]);
        const m1 = stat(s, now - 3600e3, (x, k) => x.mem[k]);
        const md = stat(s, now - 86400e3, (x, k) => x.mem[k]);
        let protectedWhy = PROTECTED[dockerName] || '';
        if (c.Id.startsWith(selfId)) protectedWhy = 'Asgard lui-même (cette page)';
        const item = {
            id: c.Id.slice(0, 12),
            name: dockerName.replace(/-[a-z0-9]{24}(-\d+)?$/, '').replace(/^[a-z0-9]{24}-\d+$/, g.part || dockerName),
            docker: dockerName,
            state: c.State,
            status: c.Status,
            image: c.Image,
            cpu: r.cpu, mem: r.mem, rx: r.rx, tx: r.tx, rd: r.rd, wr: r.wr, pids: r.pids,
            cpu1h: h1.avg, cpuMax24h: d1.max, mem1h: m1.avg, memMax24h: md.max,
            sparkCpu: spark(s, now, 'cpu'),
            sparkMem: spark(s, now, 'mem'),
            protected: protectedWhy,
        };
        if (!groups.has(g.key)) groups.set(g.key, { key: g.key, label: g.label, kind: g.kind, parts: [], containers: [] });
        const grp = groups.get(g.key);
        grp.containers.push(item);
        if (g.part) grp.parts.push(g.part);
    }
    for (const g of groups.values()) {
        // Service compose (Mailu, Heimdall…) : le nom du layout est rangé sous l'un de ses conteneurs
        if (!g.label) g.label = pretty(g.parts.find(p => nameFor(p)) || g.parts[0] || g.key);
        delete g.parts;
    }
    const out = [...groups.values()].map(g => {
        const t = f => g.containers.reduce((a, c) => a + c[f], 0);
        const sparkSum = f => Array.from({ length: SPARK }, (_, i) => {
            const vals = g.containers.map(c => c[f][i]).filter(v => v != null);
            return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
        });
        return {
            ...g,
            cpu: t('cpu'), mem: t('mem'), rx: t('rx'), tx: t('tx'), rd: t('rd'), wr: t('wr'),
            cpu1h: t('cpu1h'), mem1h: t('mem1h'),
            // Pic du groupe ≈ somme des pics (majorant : ils ne tombent pas forcément en même temps)
            cpuMax24h: t('cpuMax24h'), memMax24h: t('memMax24h'),
            sparkCpu: sparkSum('sparkCpu'), sparkMem: sparkSum('sparkMem'),
            running: g.containers.filter(c => c.state === 'running').length,
        };
    });
    const mem = hostMem();
    const inCpu = out.reduce((a, g) => a + g.cpu, 0);
    const inMem = out.reduce((a, g) => a + g.mem, 0);
    const oldest = Math.min(...[...series.values()].filter(s => s.n).map(s => s.t[(s.head - s.n + HISTORY) % HISTORY]), now);
    return {
        at: last.at,
        interval: INTERVAL,
        historySince: oldest,
        host: {
            cpus: os.cpus().length,
            cpu: host.cpu,
            memTotal: mem.total,
            memUsed: mem.used,
            // Ce que consomment le système et les programmes hors Docker (Tailscale, SSH, noyau…)
            otherCpu: Math.max(0, host.cpu - inCpu),
            otherMem: Math.max(0, mem.used - inMem),
        },
        groups: out,
    };
}

function start(dockerRequest, nameForKey) {
    docker = dockerRequest;
    if (nameForKey) nameFor = nameForKey;
    if (timer) return;
    // Deux échantillons rapprochés au démarrage pour avoir un CPU tout de suite
    sample().then(() => setTimeout(sample, 3000));
    timer = setInterval(sample, INTERVAL);
    timer.unref?.();
}

module.exports = { start, overview };
