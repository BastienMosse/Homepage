const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const VPN_SUBNET = process.env.VPN_SUBNET || '10.8.0.';
const DIST_DIR = path.join(__dirname, '..', 'dist');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

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

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return forwarded.split(',')[0].trim();
    return req.socket.remoteAddress;
}

function loadServices() {
    const file = path.join(DATA_DIR, 'services.json');
    if (!fs.existsSync(file)) return { public: [], admin: [] };
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];

    if (url === '/api/ip') {
        const ip = getClientIp(req);
        const vpn = ip.startsWith(VPN_SUBNET);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ip, vpn }));
        return;
    }

    if (url === '/api/services') {
        const ip = getClientIp(req);
        const vpn = ip.startsWith(VPN_SUBNET);
        const services = loadServices();
        const result = { services: services.public, vpn };
        if (vpn) result.admin = services.admin;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
    }

    let filePath = path.join(DIST_DIR, url === '/' ? 'index.html' : url);
    if (!filePath.startsWith(path.resolve(DIST_DIR))) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
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

server.listen(PORT, () => console.log(`Homepage on port ${PORT}`));
