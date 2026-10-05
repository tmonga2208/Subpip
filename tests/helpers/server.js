// Static file server for e2e fixtures. Supports HTTP Range (Chrome needs it to
// seek in an mp4). With a distDir, `/script.js` is served from dist/. Paths starting with
// `/tt-` get a Trusted Types CSP header, like YouTube. `scripts` maps a path to
// JavaScript the server answers with, for a script the real host serves itself.
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mp4': 'video/mp4',
  '.vtt': 'text/vtt',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

export async function startServer({ fixturesDir, distDir, scripts = {} }) {
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (Object.hasOwn(scripts, pathname)) {
      res.writeHead(200, { 'Content-Type': TYPES['.js'] }).end(scripts[pathname]);
      return;
    }
    const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const file = distDir && pathname === '/script.js' ? path.join(distDir, 'script.js') : path.join(fixturesDir, safe);

    let stat;
    try {
      stat = statSync(file);
      if (!stat.isFile()) throw new Error('not a file');
    } catch {
      res.writeHead(404).end();
      return;
    }

    const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
    if (pathname.startsWith('/tt-')) headers['Content-Security-Policy'] = "require-trusted-types-for 'script'";

    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Number(range[2]) : stat.size - 1;
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    createReadStream(file).pipe(res);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}
