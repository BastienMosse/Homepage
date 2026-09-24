const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DIST_DIR = path.join(__dirname, '..', 'dist');
const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const PROC_DIR = process.env.PROC_DIR || '/host/proc';

const COOKIE_NAME = 'lab_admin';
const COOKIE_MAX_AGE = 86400 * 7;

const SKIP_CONTAINERS = new Set([
    'coolify', 'coolify-proxy', 'coolify-db', 'coolify-redis',
    'coolify-realtime', 'coolify-sentinel', 'errorpages',
]);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
};

// --- Auth ---

function makeSessionToken() {
    return crypto.createHmac('sha256', ADMIN_TOKEN).update('lab-session').digest('hex');
}

function parseCookies(req) {
    const cookies = {};
    (req.headers.cookie || '').split(';').forEach(c => {
        const [k, ...v] = c.trim().split('=');
        if (k) cookies[k] = v.join('=');
    });
    return cookies;
}

function isAuthed(req) {
    if (!ADMIN_TOKEN) return false;
    const cookies = parseCookies(req);
    const got = cookies[COOKIE_NAME] || '';
    const expected = makeSessionToken();
    if (got.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

function parseBody(req) {
    return new Promise(resolve => {
        const chunks = [];
        req.on('data', c => { chunks.push(c); if (Buffer.concat(chunks).length > 4096) req.destroy(); });
        req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    });
}

function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

// --- Config ---

function loadConfig() {
    const file = path.join(DATA_DIR, 'services.json');
    if (!fs.existsSync(file)) return { apps: {}, static: [], sections: {} };
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return { apps: {}, static: [], sections: {} }; }
}

// --- Docker ---

function dockerRequest(method, endpoint) {
    return new Promise((resolve, reject) => {
        const opts = { socketPath: DOCKER_SOCKET, path: endpoint, method };
        const req = http.request(opts, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString();
                try { resolve(JSON.parse(body)); }
                catch { resolve(body); }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

function extractUrl(labels) {
    for (const [key, value] of Object.entries(labels)) {
        if (key.startsWith('traefik.http.routers.https-') && key.endsWith('.rule')) {
            const match = value.match(/Host\(`([^`]+)`\)/);
            if (match) return `https://${match[1]}`;
        }
    }
    return '';
}

// --- Discovery ---

let cachedDiscovery = null;
let lastDiscoveryTime = 0;
const DISCOVERY_TTL = 5000;

async function discover() {
    const now = Date.now();
    if (cachedDiscovery && now - lastDiscoveryTime < DISCOVERY_TTL) return cachedDiscovery;

    const config = loadConfig();
    let containers;
    try {
        containers = await dockerRequest('GET', '/containers/json?all=true');
        if (!Array.isArray(containers)) containers = [];
    } catch { containers = []; }

    const items = [];
    const groupMap = {};

    for (const c of containers) {
        const labels = c.Labels || {};
        if (labels['coolify.managed'] !== 'true') continue;

        const serviceName = labels['coolify.serviceName'] || '';
        const resourceName = labels['coolify.resourceName'] || '';
        const dockerName = (c.Names?.[0] || '').replace(/^\//, '');

        if (SKIP_CONTAINERS.has(serviceName) || SKIP_CONTAINERS.has(resourceName) || SKIP_CONTAINERS.has(dockerName)) continue;
        if (!serviceName && !resourceName) continue;

        const serviceId = labels['coolify.serviceId'] || '';
        const groupKey = serviceId || serviceName || resourceName;

        if (!groupMap[groupKey]) {
            groupMap[groupKey] = { containers: [] };
        }
        groupMap[groupKey].containers.push({
            id: c.Id.slice(0, 12),
            name: serviceName || resourceName || dockerName,
            state: c.State,
            status: c.Status,
        });

        const appConfig = config.apps?.[serviceName] || config.apps?.[resourceName];
        if (appConfig && !groupMap[groupKey].matched) {
            groupMap[groupKey].matched = true;
            groupMap[groupKey].label = appConfig.name || serviceName;
        }

        if (!appConfig) continue;

        items.push({
            name: appConfig.name || serviceName,
            desc: appConfig.desc || '',
            url: extractUrl(labels) || appConfig.url || '',
            icon: appConfig.icon || 'server',
            color: appConfig.color || 'purple',
            section: appConfig.section || 'sites',
            state: c.State,
            order: appConfig.order || 99,
        });
    }

    const allContainers = Object.values(groupMap).map(g => ({
        label: g.label || g.containers[0].name,
        containers: g.containers,
    }));

    if (config.static) {
        for (const entry of config.static) {
            items.push({ ...entry, state: 'static', order: entry.order || 0 });
        }
    }

    const sectionDefs = config.sections || {};
    const sectionMap = {};

    for (const item of items) {
        const sid = item.section;
        if (!sectionMap[sid]) {
            const def = sectionDefs[sid] || { label: sid, icon: 'server', order: 99 };
            sectionMap[sid] = {
                id: sid,
                label: def.label,
                icon: def.icon,
                order: def.order,
                adminOnly: !!def.adminOnly,
                items: [],
            };
        }
        sectionMap[sid].items.push(item);
    }

    const sections = Object.values(sectionMap)
        .sort((a, b) => a.order - b.order)
        .map(s => ({ ...s, items: s.items.sort((a, b) => a.order - b.order) }));

    cachedDiscovery = { sections, allContainers };
    lastDiscoveryTime = now;
    return cachedDiscovery;
}

// --- Server stats ---

let lastCpu = null;

function sampleCpu() {
    try {
        const stat = fs.readFileSync(path.join(PROC_DIR, 'stat'), 'utf8');
        const parts = stat.split('\n')[0].split(/\s+/).slice(1).map(Number);
        const idle = parts[3] + (parts[4] || 0);
        const total = parts.reduce((a, b) => a + b, 0);
        const prev = lastCpu;
        lastCpu = { idle, total };
        if (!prev) return 0;
        const dt = total - prev.total;
        if (dt === 0) return 0;
        return Math.round((1 - (idle - prev.idle) / dt) * 100);
    } catch { return -1; }
}

function readMemory() {
    try {
        const data = fs.readFileSync(path.join(PROC_DIR, 'meminfo'), 'utf8');
        const get = k => { const m = data.match(new RegExp(`${k}:\\s+(\\d+)`)); return m ? parseInt(m[1]) * 1024 : 0; };
        const total = get('MemTotal');
        const avail = get('MemAvailable');
        const used = total - avail;
        return { total, used, percent: total ? Math.round(used / total * 100) : 0 };
    } catch { return { total: 0, used: 0, percent: -1 }; }
}

function readUptime() {
    try {
        return Math.floor(parseFloat(fs.readFileSync(path.join(PROC_DIR, 'uptime'), 'utf8').split(' ')[0]));
    } catch { return 0; }
}

function readDisk() {
    try {
        const s = fs.statfsSync('/');
        const total = s.blocks * s.bsize;
        const free = s.bavail * s.bsize;
        const used = total - free;
        return { total, used, percent: total ? Math.round(used / total * 100) : 0 };
    } catch { return { total: 0, used: 0, percent: -1 }; }
}

function readLoad() {
    try {
        const data = fs.readFileSync(path.join(PROC_DIR, 'loadavg'), 'utf8');
        const parts = data.split(/\s+/);
        return { load1: parseFloat(parts[0]), load5: parseFloat(parts[1]), load15: parseFloat(parts[2]) };
    } catch { return { load1: 0, load5: 0, load15: 0 }; }
}

sampleCpu();
const cpuInterval = setInterval(sampleCpu, 2000);

// --- HTTP server ---

const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];

    if (url === '/api/config') {
        const { sections } = await discover();
        json(res, 200, { sections: sections.filter(s => !s.adminOnly) });
        return;
    }

    if (url === '/api/auth/check') {
        json(res, 200, { authed: isAuthed(req) });
        return;
    }

    if (url === '/api/auth/login' && req.method === 'POST') {
        const body = await parseBody(req);
        let password;
        try { password = JSON.parse(body).password; } catch { password = ''; }
        if (!ADMIN_TOKEN || !password) return json(res, 401, { error: 'unauthorized' });

        const match = crypto.timingSafeEqual(
            crypto.createHash('sha256').update(password).digest(),
            crypto.createHash('sha256').update(ADMIN_TOKEN).digest(),
        );
        if (!match) return json(res, 401, { error: 'unauthorized' });

        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': `${COOKIE_NAME}=${makeSessionToken()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}`,
        });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    if (url === '/api/auth/logout' && req.method === 'POST') {
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
        });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    if (url === '/api/admin/containers') {
        if (!isAuthed(req)) return json(res, 401, { error: 'unauthorized' });
        const { allContainers } = await discover();
        json(res, 200, { containers: allContainers });
        return;
    }

    if (url === '/api/admin/services') {
        if (!isAuthed(req)) return json(res, 401, { error: 'unauthorized' });
        const { sections } = await discover();
        json(res, 200, { sections: sections.filter(s => s.adminOnly) });
        return;
    }

    if (url === '/api/admin/stats') {
        if (!isAuthed(req)) return json(res, 401, { error: 'unauthorized' });
        json(res, 200, {
            cpu: sampleCpu(),
            memory: readMemory(),
            disk: readDisk(),
            uptime: readUptime(),
            load: readLoad(),
        });
        return;
    }

    const containerAction = url.match(/^\/api\/admin\/containers\/([a-f0-9]+)\/(start|stop|restart)$/);
    if (containerAction && req.method === 'POST') {
        if (!isAuthed(req)) return json(res, 401, { error: 'unauthorized' });
        const [, id, action] = containerAction;
        try {
            await dockerRequest('POST', `/containers/${id}/${action}`);
            cachedDiscovery = null;
            json(res, 200, { ok: true });
        } catch (e) {
            json(res, 500, { error: e.message });
        }
        return;
    }

    // --- Static files ---

    let filePath = path.join(DIST_DIR, url === '/' ? 'index.html' : url);
    if (!filePath.startsWith(path.resolve(DIST_DIR))) {
        res.writeHead(403); res.end('Forbidden'); return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            fs.readFile(path.join(DIST_DIR, 'index.html'), (e, html) => {
                if (e) { res.writeHead(404); res.end('Not found'); return; }
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(html);
            });
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`Dashboard on port ${PORT}`);
    if (ADMIN_TOKEN) console.log('Admin auth enabled');
    else console.log('Warning: ADMIN_TOKEN not set, admin disabled');
});

process.on('SIGTERM', () => { clearInterval(cpuInterval); server.close(); });
