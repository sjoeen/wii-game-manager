/** Loopback-only development server. GitHub Pages does NOT run this file. */
import {createServer} from 'node:http';
import {readFile, realpath, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const DEFAULT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const MIME = new Map(Object.entries({
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.zip':'application/zip', '.md':'text/plain; charset=utf-8',
  '.txt':'text/plain; charset=utf-8',
}));

/** Create a static HTTP server. Call .listen() yourself; useful in local tests. */
export async function createStaticServer({root = DEFAULT_ROOT, base = '/'} = {}) {
  if (typeof base !== 'string' || !/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base)) {
    throw new Error('Base must be / or a path such as /wii-game-manager/ (including the final slash).');
  }
  const rootPath = await realpath(root);
  const notFound = await readFile(path.join(rootPath, '404.html')).catch(() => Buffer.from('Not found'));
  return createServer((req, res) => {
    const send = (status, bytes, type = 'text/plain; charset=utf-8', extra = {}) => {
      res.writeHead(status, {'Content-Type':type, 'Content-Length':bytes.length,
        'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...extra});
      res.end(req.method === 'HEAD' ? undefined : bytes);
    };
    const missing = () => send(404, notFound, 'text/html; charset=utf-8');
    (async () => {
      if (!['GET','HEAD'].includes(req.method)) {
        send(405, Buffer.from('Read-only static server'), undefined, {Allow:'GET, HEAD'}); return;
      }
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
      catch { send(400, Buffer.from('Invalid URL')); return; }
      if (pathname.includes('\\') || pathname.includes('\0')) { missing(); return; }
      if (base !== '/' && pathname === base.slice(0, -1)) {
        send(308, Buffer.from(''), undefined, {Location:base}); return;
      }
      if (!pathname.startsWith(base)) { missing(); return; }
      const segments = pathname.slice(base.length).split('/').filter(Boolean);
      // Do not expose dotfiles, parent paths, or the Git database from local preview.
      if (segments.some(segment => segment.startsWith('.'))) { missing(); return; }
      let filename = path.join(rootPath, ...segments);
      let stats;
      try {
        stats = await stat(filename);
        if (stats.isDirectory()) { filename = path.join(filename, 'index.html'); stats = await stat(filename); }
        if (!stats.isFile()) { missing(); return; }
        const actual = await realpath(filename);
        if (!actual.startsWith(rootPath + path.sep)) { missing(); return; }
        filename = actual;
      } catch (error) {
        if (['ENOENT','ENOTDIR','EACCES'].includes(error.code)) { missing(); return; }
        throw error;
      }
      send(200, await readFile(filename), MIME.get(path.extname(filename).toLowerCase()) || 'application/octet-stream');
    })().catch(error => {
      console.error('Local preview error:', error.message);
      if (!res.headersSent) send(500, Buffer.from('Could not read this local file.'));
      else res.destroy();
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    let port = Number(process.env.PORT ?? 8080), base = '/';
    for (let i = 2; i < process.argv.length; i++) {
      const arg = process.argv[i];
      if (arg === '--port') port = Number(process.argv[++i]);
      else if (arg === '--base') base = process.argv[++i];
      else throw new Error('Usage: npm start -- [--port 8080] [--base /wii-game-manager/]');
    }
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535.');
    const server = await createStaticServer({base});
    server.on('error', error => {
      console.error(error.code === 'EADDRINUSE' ? 'Port is in use. Try: npm start -- --port 8081' : error.message);
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => console.log(`Wii SD Manager: http://127.0.0.1:${server.address().port}${base}\nDevelopment preview only. Press Ctrl+C to stop.`));
    for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => {server.close();server.closeAllConnections();});
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
