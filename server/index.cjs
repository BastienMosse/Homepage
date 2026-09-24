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
const LAYOUT_FILE = process.env.LAYOUT_FILE || path.join(DATA_DIR, 'layout.json');

const COOKIE_NAME = 'lab_admin';
const COOKIE_MAX_AGE = 86400 * 7;

const SKIP_CONTAINERS = new Set([
    'coolify', 'coolify-proxy', 'coolify-db', 'coolify-redis',
    'coolify-realtime', 'coolify-sentinel',
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

function parseBody(req, maxSize) {
    if (!maxSize) maxSize = 4096;
    return new Promise(resolve => {
        const chunks = [];
        let size = 0;
        req.on('data', c => { size += c.length; if (size > maxSize) { req.destroy(); return; } chunks.push(c); });
        req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    });
}

function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

// --- Config (default seed) ---

function loadConfig() {
    const file = path.join(DATA_DIR, 'services.json');
    if (!fs.existsSync(file)) return { apps: {}, static: [], sections: {} };
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return { apps: {}, static: [], sections: {} }; }
}

// --- Layout persistence ---

let layoutCache = null;

function loadLayout() {
    if (layoutCache) return layoutCache;
    if (fs.existsSync(LAYOUT_FILE)) {
        try {
            layoutCache = JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf8'));
            if (layoutCache.sections && layoutCache.services) return layoutCache;
        } catch {}
    }
    const config = loadConfig();
    const layout = {
        sections: {
            ...(config.sections || {}),
            _new: { label: 'Non classé', icon: 'inbox', order: 99, adminOnly: true, hidden: true },
        },
        services: {},
        static: config.static || [],
    };
    let order = 0;
    for (const [key, app] of Object.entries(config.apps || {})) {
        layout.services[key] = { ...app, order: order++ };
    }
    saveLayout(layout);
    return layout;
}

function saveLayout(layout) {
    layoutCache = layout;
    try {
        const dir = path.dirname(LAYOUT_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(LAYOUT_FILE, JSON.stringify(layout, null, 2));
    } catch (e) { console.error('Failed to save layout:', e.message); }
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

    const layout = loadLayout();

    let containers;
    try {
        containers = await dockerRequest('GET', '/containers/json?all=true');
        if (!Array.isArray(containers)) containers = [];
    } catch { containers = []; }

    const items = [];
    const groupMap = {};
    let layoutChanged = false;

    for (const c of containers) {
        const labels = c.Labels || {};
        if (labels['coolify.managed'] !== 'true') continue;

        const serviceName = labels['coolify.serviceName'] || '';
        const resourceName = labels['coolify.resourceName'] || '';
        const dockerName = (c.Names?.[0] || '').replace(/^\//, '');

        if (SKIP_CONTAINERS.has(serviceName) || SKIP_CONTAINERS.has(resourceName) || SKIP_CONTAINERS.has(dockerName)) continue;
        if (!serviceName && !resourceName) continue;

        const key = serviceName || resourceName;
        const serviceId = labels['coolify.serviceId'] || '';
        const groupKey = serviceId || key;

        if (!groupMap[groupKey]) {
            groupMap[groupKey] = { containers: [], key };
        }
        groupMap[groupKey].containers.push({
            id: c.Id.slice(0, 12),
            name: key,
            state: c.State,
            status: c.Status,
        });

        if (groupMap[groupKey].matched) continue;
        groupMap[groupKey].matched = true;

        let svc = layout.services[key];
        if (!svc) {
            const url = extractUrl(labels);
            svc = {
                name: key,
                icon: 'server',
                color: 'purple',
                desc: '',
                url: url || '',
                section: '_new',
                order: Object.keys(layout.services).length,
            };
            layout.services[key] = svc;
            layoutChanged = true;
        }

        groupMap[groupKey].label = svc.name;
        items.push({
            key,
            name: svc.name,
            desc: svc.desc || '',
            url: svc.url || extractUrl(labels) || '',
            icon: svc.icon || 'server',
            color: svc.color || 'purple',
            section: svc.section || '_new',
            state: c.State,
            order: svc.order ?? 99,
            hidden: !!svc.hidden,
        });
    }

    if (layoutChanged) saveLayout(layout);

    const allContainers = Object.values(groupMap).map(g => ({
        label: g.label || g.containers[0].name,
        containers: g.containers,
    }));

    if (layout.static) {
        for (const entry of layout.static) {
            items.push({ ...entry, state: 'static', order: entry.order ?? 0, hidden: !!entry.hidden });
        }
    }

    const sectionDefs = layout.sections || {};
    const sectionMap = {};

    for (const item of items) {
        const sid = item.section;
        if (!sectionMap[sid]) {
            const def = sectionDefs[sid] || { label: sid, icon: 'server', order: 99 };
            sectionMap[sid] = {
                id: sid,
                label: def.label,
                icon: def.icon,
                order: def.order ?? 99,
                adminOnly: !!def.adminOnly,
                hidden: !!def.hidden,
                items: [],
            };
        }
        sectionMap[sid].items.push(item);
    }

    for (const [id, def] of Object.entries(sectionDefs)) {
        if (!sectionMap[id]) {
            sectionMap[id] = {
                id,
                label: def.label,
                icon: def.icon,
                order: def.order ?? 99,
                adminOnly: !!def.adminOnly,
                hidden: !!def.hidden,
                items: [],
            };
        }
    }

    const sections = Object.values(sectionMap)
        .sort((a, b) => a.order - b.order)
        .map(s => ({ ...s, items: s.items.sort((a, b) => (a.order ?? 99) - (b.order ?? 99)) }));

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
        const filtered = sections
            .filter(s => !s.adminOnly && !s.hidden)
            .map(s => ({ ...s, items: s.items.filter(i => !i.hidden) }))
            .filter(s => s.items.length > 0);
        json(res, 200, { sections: filtered });
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
        const filtered = sections
            .filter(s => s.adminOnly && !s.hidden)
            .map(s => ({ ...s, items: s.items.filter(i => !i.hidden) }));
        json(res, 200, { sections: filtered });
        return;
    }

    if (url === '/api/admin/layout' && req.method === 'GET') {
        if (!isAuthed(req)) return json(res, 401, { error: 'unauthorized' });
        const layout = loadLayout();
        let containers;
        try {
            containers = await dockerRequest('GET', '/containers/json?all=true');
            if (!Array.isArray(containers)) containers = [];
        } catch { containers = []; }
        const states = {};
        for (const c of containers) {
            const labels = c.Labels || {};
            const key = labels['coolify.serviceName'] || labels['coolify.resourceName'] || '';
            if (key) states[key] = c.State;
        }
        json(res, 200, { layout, states });
        return;
    }

    if (url === '/api/admin/layout' && req.method === 'PUT') {
        if (!isAuthed(req)) return json(res, 401, { error: 'unauthorized' });
        const body = await parseBody(req, 65536);
        try {
            const data = JSON.parse(body);
            if (data.sections && data.services) {
                saveLayout(data);
                cachedDiscovery = null;
                json(res, 200, { ok: true });
            } else {
                json(res, 400, { error: 'Invalid layout' });
            }
        } catch {
            json(res, 400, { error: 'Invalid JSON' });
        }
        return;
    }

    if (url === '/api/admin/bots') {
        if (!isAuthed(req)) return json(res, 401, { error: 'unauthorized' });
        const layout = loadLayout();

        let containers;
        try {
            containers = await dockerRequest('GET', '/containers/json?all=true');
            if (!Array.isArray(containers)) containers = [];
        } catch { containers = []; }

        const bots = [];
        for (const c of containers) {
            const labels = c.Labels || {};
            if (labels['coolify.managed'] !== 'true') continue;
            const serviceName = labels['coolify.serviceName'] || '';
            const resourceName = labels['coolify.resourceName'] || '';
            const key = serviceName || resourceName;
            if (!key) continue;
            const svc = layout.services[key];
            if (!svc || !svc.bot) continue;
            if (svc.hidden) continue;
            bots.push({
                id: c.Id.slice(0, 12),
                name: svc.name || key,
                key,
                desc: svc.desc || '',
                icon: svc.icon || 'bot',
                color: svc.color || 'purple',
                state: c.State,
                status: c.Status,
            });
        }
        json(res, 200, { bots });
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

    const containerLogs = url.match(/^\/api\/admin\/containers\/([a-f0-9]+)\/logs$/);
    if (containerLogs) {
        if (!isAuthed(req)) return json(res, 401, { error: 'unauthorized' });
        const [, id] = containerLogs;
        try {
            const logs = await dockerRequest('GET', `/containers/${id}/logs?stdout=true&stderr=true&tail=150&timestamps=true`);
            const lines = typeof logs === 'string'
                ? logs.split('\n').map(l => l.replace(/^.{8}/, '').trim()).filter(Boolean)
                : [];
            json(res, 200, { logs: lines });
        } catch (e) {
            json(res, 500, { error: e.message });
        }
        return;
    }

    const containerStats = url.match(/^\/api\/admin\/containers\/([a-f0-9]+)\/stats$/);
    if (containerStats) {
        if (!isAuthed(req)) return json(res, 401, { error: 'unauthorized' });
        const [, id] = containerStats;
        try {
            const raw = await dockerRequest('GET', `/containers/${id}/stats?stream=false`);
            const cpuDelta = raw.cpu_stats?.cpu_usage?.total_usage - raw.precpu_stats?.cpu_usage?.total_usage || 0;
            const sysDelta = raw.cpu_stats?.system_cpu_usage - raw.precpu_stats?.system_cpu_usage || 0;
            const cpuCount = raw.cpu_stats?.online_cpus || 1;
            const cpuPercent = sysDelta > 0 ? Math.round(cpuDelta / sysDelta * cpuCount * 10000) / 100 : 0;
            const memUsed = raw.memory_stats?.usage - (raw.memory_stats?.stats?.cache || 0);
            const memLimit = raw.memory_stats?.limit || 0;
            const info = await dockerRequest('GET', `/containers/${id}/json`);
            const startedAt = info.State?.StartedAt || '';
            json(res, 200, {
                cpu: cpuPercent,
                memory: { used: memUsed || 0, limit: memLimit },
                state: info.State?.Status || 'unknown',
                startedAt,
            });
        } catch (e) {
            json(res, 500, { error: e.message });
        }
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
    console.log(`Layout file: ${LAYOUT_FILE}`);
});

process.on('SIGTERM', () => { clearInterval(cpuInterval); server.close(); });
