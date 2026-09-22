const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DIST_DIR = path.join(__dirname, '..', 'dist');
const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';

const COOKIE_NAME = 'lab_admin';
const COOKIE_MAX_AGE = 86400 * 7;

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

function loadConfig() {
    const file = path.join(DATA_DIR, 'services.json');
    if (!fs.existsSync(file)) return { sections: [], admin: { links: [], monitoredContainers: [] } };
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

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

async function getContainers(filter) {
    try {
        const all = await dockerRequest('GET', '/containers/json?all=true');
        if (!Array.isArray(all)) return [];
        return all
            .filter(c => {
                const name = (c.Names?.[0] || '').replace(/^\//, '').toLowerCase();
                return filter.some(f => name.includes(f.toLowerCase()));
            })
            .map(c => ({
                id: c.Id.slice(0, 12),
                name: (c.Names?.[0] || '').replace(/^\//, ''),
                state: c.State,
                status: c.Status,
                image: c.Image,
            }));
    } catch {
        return [];
    }
}

const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];

    // --- API ---
    if (url === '/api/config') {
        const config = loadConfig();
        json(res, 200, { sections: config.sections });
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

    if (url === '/api/admin/config') {
        if (!isAuthed(req)) return json(res, 401, { error: 'unauthorized' });
        const config = loadConfig();
        json(res, 200, { links: config.admin?.links || [] });
        return;
    }

    if (url === '/api/admin/containers') {
        if (!isAuthed(req)) return json(res, 401, { error: 'unauthorized' });
        const config = loadConfig();
        const containers = await getContainers(config.admin?.monitoredContainers || []);
        json(res, 200, { containers });
        return;
    }

    const containerAction = url.match(/^\/api\/admin\/containers\/([a-f0-9]+)\/(start|stop|restart)$/);
    if (containerAction && req.method === 'POST') {
        if (!isAuthed(req)) return json(res, 401, { error: 'unauthorized' });
        const [, id, action] = containerAction;
        try {
            await dockerRequest('POST', `/containers/${id}/${action}`);
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
