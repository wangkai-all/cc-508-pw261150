// 零依赖静态文件服务器：node scripts/serve.mjs [port]
// 仅服务项目根目录，便于在浏览器打开 index.html（ES Modules 需 http(s) 协议，file:// 会被 CORS 拦截）。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const port = Number(process.argv[2]) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const rel = normalize(urlPath === '/' ? 'index.html' : urlPath.slice(1));
    const filePath = join(root, rel);
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const s = await stat(filePath);
    if (s.isDirectory()) {
      res.writeHead(404).end('Not Found');
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
  }
}).listen(port, () => {
  console.log(`情景推演工具已启动：http://localhost:${port}/  （Ctrl+C 停止）`);
});
