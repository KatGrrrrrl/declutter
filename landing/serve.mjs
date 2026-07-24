/** Tiny static server for the landing page preview. Honors $PORT. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 3000;

const TYPES = {
  html: 'text/html; charset=utf-8',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
};

createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];
  const file = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
  try {
    const body = await readFile(join(here, file));
    const ext = file.split('.').pop().toLowerCase();
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
}).listen(port, () => console.log(`landing preview on http://localhost:${port}`));
