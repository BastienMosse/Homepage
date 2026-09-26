// Zip de dossier pour Yggdrasil (OpenList), fabriqué au fil de l'envoi : rien n'est écrit sur le disque.
// Route publique : https://yggdrasil.lucipher-lab.fr/ygg-zip (Traefik → ce serveur), appelée par le bouton
// injecté dans l'interface d'OpenList (réglage customize_body). Les droits sont ceux de l'utilisateur :
// on liste et on lit les fichiers via l'API OpenList avec SON jeton.
//
// Format : ZIP64 « stored » (pas de compression : films/photos ne rétrécissent pas), descripteurs de données
// après chaque fichier (CRC calculé en streaming). Taille totale connue d'avance → Content-Length → barre de
// progression dans le navigateur.

const zlib = require('zlib');

const MAX_FILES = 20000;
const MAX_PARALLEL_ZIPS = 3;
let activeZips = 0;

// --- En-têtes ZIP64 ---

const LOCAL_EXTRA = 20;    // id + taille + 2 × 8 octets
const CENTRAL_EXTRA = 28;  // id + taille + 3 × 8 octets

function dosDateTime(ms) {
    const d = new Date(ms || Date.now());
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    const date = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
}

function localHeader(name, dt) {
    const b = Buffer.alloc(30 + name.length + LOCAL_EXTRA);
    b.writeUInt32LE(0x04034b50, 0);
    b.writeUInt16LE(45, 4);              // version nécessaire (ZIP64)
    b.writeUInt16LE(0x0808, 6);          // bit 3 : descripteur après les données, bit 11 : noms UTF-8
    b.writeUInt16LE(0, 8);               // stored
    b.writeUInt16LE(dt.time, 10);
    b.writeUInt16LE(dt.date, 12);
    b.writeUInt32LE(0, 14);              // CRC dans le descripteur
    b.writeUInt32LE(0xffffffff, 18);
    b.writeUInt32LE(0xffffffff, 22);
    b.writeUInt16LE(name.length, 26);
    b.writeUInt16LE(LOCAL_EXTRA, 28);
    name.copy(b, 30);
    const e = 30 + name.length;
    b.writeUInt16LE(0x0001, e);
    b.writeUInt16LE(16, e + 2);          // tailles à 0 : les vraies sont dans le descripteur
    return b;
}

function dataDescriptor(crc, size) {
    const b = Buffer.alloc(24);
    b.writeUInt32LE(0x08074b50, 0);
    b.writeUInt32LE(crc >>> 0, 4);
    b.writeBigUInt64LE(BigInt(size), 8);
    b.writeBigUInt64LE(BigInt(size), 16);
    return b;
}

function centralHeader(f) {
    const b = Buffer.alloc(46 + f.name.length + CENTRAL_EXTRA);
    b.writeUInt32LE(0x02014b50, 0);
    b.writeUInt16LE((3 << 8) | 45, 4);   // créé sous Unix, ZIP64
    b.writeUInt16LE(45, 6);
    b.writeUInt16LE(0x0808, 8);
    b.writeUInt16LE(0, 10);
    b.writeUInt16LE(f.dt.time, 12);
    b.writeUInt16LE(f.dt.date, 14);
    b.writeUInt32LE(f.crc >>> 0, 16);
    b.writeUInt32LE(0xffffffff, 20);
    b.writeUInt32LE(0xffffffff, 24);
    b.writeUInt16LE(f.name.length, 28);
    b.writeUInt16LE(CENTRAL_EXTRA, 30);
    // commentaire, disque, attributs internes : 0
    b.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    b.writeUInt32LE(0xffffffff, 42);
    f.name.copy(b, 46);
    const e = 46 + f.name.length;
    b.writeUInt16LE(0x0001, e);
    b.writeUInt16LE(24, e + 2);
    b.writeBigUInt64LE(BigInt(f.size), e + 4);
    b.writeBigUInt64LE(BigInt(f.size), e + 12);
    b.writeBigUInt64LE(BigInt(f.offset), e + 20);
    return b;
}

function endRecords(count, cdSize, cdOffset) {
    const b = Buffer.alloc(56 + 20 + 22);
    b.writeUInt32LE(0x06064b50, 0);      // fin de répertoire ZIP64
    b.writeBigUInt64LE(44n, 4);
    b.writeUInt16LE((3 << 8) | 45, 12);
    b.writeUInt16LE(45, 14);
    b.writeBigUInt64LE(BigInt(count), 24);
    b.writeBigUInt64LE(BigInt(count), 32);
    b.writeBigUInt64LE(BigInt(cdSize), 40);
    b.writeBigUInt64LE(BigInt(cdOffset), 48);
    b.writeUInt32LE(0x07064b50, 56);     // localisateur ZIP64
    b.writeBigUInt64LE(BigInt(cdOffset + cdSize), 64);
    b.writeUInt32LE(1, 72);
    b.writeUInt32LE(0x06054b50, 76);     // fin de répertoire classique (valeurs « voir ZIP64 »)
    b.writeUInt16LE(0xffff, 84);
    b.writeUInt16LE(0xffff, 86);
    b.writeUInt32LE(0xffffffff, 88);
    b.writeUInt32LE(0xffffffff, 92);
    return b;
}

// Taille exacte du zip, calculable avant d'envoyer quoi que ce soit (pas de compression)
function zipLength(files) {
    let total = 0;
    for (const f of files) {
        const n = Buffer.byteLength(f.name);
        total += 30 + n + LOCAL_EXTRA + f.size + 24 + 46 + n + CENTRAL_EXTRA;
    }
    return total + 56 + 20 + 22;
}

// files : [{ name, size, mtime, open: () => Promise<AsyncIterable<Buffer>> }]
async function writeZip(files, out, isAborted) {
    const write = chunk => (out.write(chunk) ? null : new Promise(r => out.once('drain', r)));
    let offset = 0;
    const done = [];
    for (const f of files) {
        if (isAborted()) return;
        const name = Buffer.from(f.name);
        const dt = dosDateTime(f.mtime);
        const header = localHeader(name, dt);
        await write(header);
        const start = offset;
        offset += header.length;

        let crc = 0;
        let size = 0;
        for await (const chunk of await f.open()) {
            if (isAborted()) return;
            crc = zlib.crc32(chunk, crc);
            size += chunk.length;
            const w = write(chunk);
            if (w) await w;
        }
        // La taille annoncée (Content-Length) doit rester juste : fichier modifié pendant l'envoi = on coupe
        if (size !== f.size) throw new Error(`taille changée pendant l'envoi : ${f.name}`);
        await write(dataDescriptor(crc, size));
        offset += size + 24;
        done.push({ name, dt, crc, size, offset: start });
    }
    const cdStart = offset;
    for (const f of done) {
        const c = centralHeader(f);
        await write(c);
        offset += c.length;
    }
    await write(endRecords(done.length, offset - cdStart, cdStart));
}

// --- OpenList ---

async function olApi(base, token, endpoint, body) {
    const r = await fetch(`${base}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
    });
    const d = await r.json().catch(() => ({}));
    if (d.code !== 200) {
        const err = new Error(d.message || `OpenList ${r.status}`);
        err.status = d.code === 401 || d.code === 403 ? 403 : 400;
        throw err;
    }
    return d.data;
}

// Parcours récursif avec les droits de l'utilisateur ; les chemins du zip partent du dossier demandé
async function collect(base, token, root, only) {
    const files = [];
    async function walk(dir, prefix, filter) {
        let page = 1;
        for (;;) {
            const d = await olApi(base, token, '/api/fs/list', { path: dir, password: '', page, per_page: 500, refresh: false });
            const content = d.content || [];
            for (const it of content) {
                if (filter && !filter.has(it.name)) continue;
                const p = `${dir.replace(/\/$/, '')}/${it.name}`;
                const rel = prefix ? `${prefix}/${it.name}` : it.name;
                if (it.is_dir) await walk(p, rel, null);
                else files.push({ path: p, name: rel, size: Number(it.size) || 0, mtime: Date.parse(it.modified) || Date.now() });
                if (files.length > MAX_FILES) throw Object.assign(new Error(`plus de ${MAX_FILES} fichiers`), { status: 400 });
            }
            if (content.length < 500 || page * 500 >= (d.total || 0)) break;
            page++;
        }
    }
    // Comme un zip fait à la main : tout dans un dossier au nom du dossier zippé (sauf pour la racine)
    await walk(root, root.split('/').filter(Boolean).pop() || '', only && only.length ? new Set(only) : null);
    return files;
}

// Lien de téléchargement signé fourni par OpenList, réécrit vers l'adresse interne (pas de détour par Internet)
async function fileStream(base, token, path) {
    const d = await olApi(base, token, '/api/fs/get', { path, password: '' });
    const u = new URL(d.raw_url, base);
    const internal = new URL(base);
    u.protocol = internal.protocol;
    u.host = internal.host;
    const r = await fetch(u, { headers: { Authorization: token } });
    if (!r.ok || !r.body) throw new Error(`lecture impossible (${r.status}) : ${path}`);
    return r.body;
}

function contentDisposition(filename) {
    const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// POST formulaire : token, path, names (JSON, facultatif : seulement ces éléments du dossier)
async function handleZip(req, res, { form, resolveBase }) {
    const token = String(form.token || '');
    const root = String(form.path || '/') || '/';
    let only = [];
    try { only = form.names ? JSON.parse(form.names) : []; } catch { only = []; }
    if (!token) { res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Connecte-toi à Yggdrasil.'); return; }
    if (activeZips >= MAX_PARALLEL_ZIPS) { res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Trop de zips en cours, réessaie dans un moment.'); return; }

    activeZips++;
    let aborted = false;
    res.on('close', () => { aborted = true; });
    try {
        const base = await resolveBase();
        const files = await collect(base, token, root, only);
        if (!files.length) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Dossier vide.'); return; }
        const folder = root.split('/').filter(Boolean).pop() || 'yggdrasil';
        res.writeHead(200, {
            'Content-Type': 'application/zip',
            'Content-Length': String(zipLength(files)),
            'Content-Disposition': contentDisposition(`${folder}.zip`),
            'Cache-Control': 'no-store',
        });
        await writeZip(files.map(f => ({ ...f, open: () => fileStream(base, token, f.path) })), res, () => aborted);
        res.end();
    } catch (e) {
        console.error('ygg-zip:', e.message);
        if (!res.headersSent) {
            res.writeHead(e.status || 502, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Zip impossible : ${e.message}`);
        } else {
            res.destroy(); // le navigateur verra un téléchargement échoué plutôt qu'un zip tronqué
        }
    } finally {
        activeZips--;
    }
}

module.exports = { handleZip, writeZip, zipLength };
