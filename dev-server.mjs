// 로컬 개발 서버 (외부 패키지 없음, Node.js 20+)
// - .env.local(.env) 자동 로드
// - 정적 파일 서빙 + 서버 함수(api/feedback.js) 로컬 실행

import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import feedbackHandler from './api/feedback.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

async function loadEnvFiles() {
  for (const name of ['.env', '.env.local']) {
    const file = path.join(ROOT, name);
    if (!existsSync(file)) continue;
    const content = await fs.readFile(file, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key] || name === '.env.local') {
        if (val !== '') process.env[key] = val;
      }
    }
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        req.destroy();
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function wrapResponse(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(data));
    return res;
  };
  return res;
}

await loadEnvFiles();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/api/feedback') {
    try {
      const raw = await readBody(req);
      req.body = raw;
      await feedbackHandler(req, wrapResponse(res));
    } catch (err) {
      res.statusCode = err.message === 'PAYLOAD_TOO_LARGE' ? 413 : 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'SERVER_ERROR' }));
    }
    return;
  }

  // 숨김 파일(.env 등) 및 api 소스 직접 열람 차단
  if (pathname.startsWith('/.') || pathname.includes('/.') || pathname.startsWith('/api/')) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const fullPath = path.resolve(ROOT, rel);
  if (!fullPath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  try {
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) throw new Error('NOT_FILE');
    const ext = path.extname(fullPath).toLowerCase();
    const content = await fs.readFile(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
});

server.listen(PORT, HOST, () => {
  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite';
  const hasKey = Boolean(process.env.GEMINI_API_KEY?.trim());
  console.log(`level-reader 로컬 서버 실행 중: http://${HOST}:${PORT}`);
  console.log(`모델: ${model} | GEMINI_API_KEY: ${hasKey ? '설정됨' : '미설정'}`);
});
