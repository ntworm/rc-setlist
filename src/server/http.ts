import * as http from 'node:http';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath, URL as NodeURL } from 'node:url';

const __dirnameResolved = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));

export function sanitizeUrl(urlStr: string): string {
  if (!urlStr) return '';
  const [base, query] = urlStr.split('?');
  if (!query) return urlStr;
  const parts = query.split('&');
  const sanitizedParts = parts.map(part => {
    const separator = part.indexOf('=');
    const rawKey = separator === -1 ? part : part.slice(0, separator);
    let decodedKey = '';
    try {
      decodedKey = decodeURIComponent(rawKey.replace(/\+/g, ' '));
    } catch {
      return part;
    }
    if (decodedKey === 'token') {
      return `${rawKey}=***`;
    }
    return part;
  });
  return `${base}?${sanitizedParts.join('&')}`;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8',
};

export type CsvExportResolver = (fileName: string) => Promise<{
  absolutePath: string;
  friendlyName: string;
} | null>;

export type AudioResolver = (fileName: string) => Promise<{
  absolutePath: string;
  mimeType: string;
} | null>;

export type DebugSnapshotProvider = () => Record<string, unknown>;
let debugSnapshotProvider: DebugSnapshotProvider | null = null;

export function setDebugSnapshotProvider(fn: DebugSnapshotProvider): void {
  debugSnapshotProvider = fn;
}

let httpAuthToken: string = '';

export function setHttpAuthToken(token: string): void {
  httpAuthToken = token;
}

let csvExportResolver: CsvExportResolver | null = null;
let audioResolver: AudioResolver | null = null;

export function setCsvExportResolver(fn: CsvExportResolver): void {
  csvExportResolver = fn;
}

export function setAudioResolver(fn: AudioResolver): void {
  audioResolver = fn;
}

export type AsyncHttpHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) => void | Promise<void>;

export function createHttpRequestListener(
  handler: AsyncHttpHandler = handleHttp,
): http.RequestListener {
  return (req, res) => {
    void Promise.resolve().then(() => handler(req, res)).catch(() => {
      console.error('[HTTP] Request failed.');
      if (res.writableEnded) return;
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('internal server error\n');
    });
  };
}

function debugSnapshotEnabled(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  return /^(?:1|true)$/i.test(process.env.ENABLE_DEBUG_SNAPSHOT?.trim() ?? '');
}

async function loadResponseFile(
  filePath: string,
  isHead: boolean,
): Promise<{ length: number; data: Buffer | null }> {
  if (isHead) {
    const stat = await fs.stat(filePath);
    return { length: stat.size, data: null };
  }
  const data = await fs.readFile(filePath);
  return { length: data.length, data };
}

async function serveStaticFile(reqUrl: string, res: http.ServerResponse, isHead: boolean = false): Promise<void> {
  const staticDir = path.join(__dirnameResolved, 'static');
  const rawPath = reqUrl.split('?')[0] ?? '/';
  const relativePath = rawPath.startsWith('/static/')
    ? rawPath.slice('/static/'.length)
    : rawPath.replace(/^\/+/, '');

  let decodedRelativePath = '';
  try {
    decodedRelativePath = decodeURIComponent(relativePath);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('bad request: malformed percent-encoding\n');
    return;
  }

  const normalized = path
    .normalize(decodedRelativePath)
    .replace(/^[\\/]+/, '');
  let filePath = path.join(staticDir, normalized);

  if (!filePath.startsWith(staticDir + path.sep) && filePath !== staticDir) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end(isHead ? undefined : 'forbidden\n');
    return;
  }

  let size = 0;
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      const indexStat = await fs.stat(filePath);
      size = indexStat.size;
    } else {
      size = stat.size;
    }
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(isHead ? undefined : 'not found\n');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  if (isHead) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', MIME_TYPES[ext] ?? 'application/octet-stream');
    res.setHeader('Content-Length', String(size));
    res.end();
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', MIME_TYPES[ext] ?? 'application/octet-stream');
    res.setHeader('Content-Length', String(data.length));
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found\n');
  }
}

export async function handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${sanitizeUrl(req.url ?? '')}`);

  const rawPath = req.url ? (req.url.split('?')[0] ?? '') : '';

  const isGet = req.method === 'GET';
  const isHead = req.method === 'HEAD';
  if (!isGet && !isHead) {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('method not allowed\n');
    return;
  }

  if (rawPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    if (isHead) {
      res.end();
    } else {
      res.end(JSON.stringify({ ok: true, ts, message: 'Ableton RC Setlist: server is healthy.' }));
    }
    return;
  }

  if (rawPath === '/debug/snapshot') {
    if (!debugSnapshotEnabled()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found\n');
      return;
    }

    const url = new NodeURL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
    const tokenParsed = url.searchParams.get('token');
    if (!httpAuthToken || tokenParsed !== httpAuthToken) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(isHead ? undefined : JSON.stringify({ error: 'unauthorized: invalid or missing security token' }));
      return;
    }

    if (!debugSnapshotProvider) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(isHead ? undefined : JSON.stringify({ error: 'debug snapshot not configured' }));
      return;
    }
    const snapshot = debugSnapshotProvider();
    const bodyStr = JSON.stringify({ ts, ...snapshot });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(bodyStr, 'utf-8'))
    });
    if (isHead) {
      res.end();
    } else {
      res.end(bodyStr);
    }
    return;
  }

  if (rawPath === '/' || rawPath === '/index.html' || rawPath === '/setlist') {
    const query = req.url && req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.writeHead(302, { 
      'Location': `/static/setlist/${query}`,
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
    });
    res.end();
    return;
  }

  if (rawPath === '/performance') {
    const query = req.url && req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.writeHead(302, { 
      'Location': `/static/performance/${query}`,
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
    });
    res.end();
    return;
  }

  if (rawPath.startsWith('/exports/')) {
    const rawName = rawPath.slice('/exports/'.length);
    // Sanity check: only accept basename.csv (no traversal)
    if (!/^[A-Za-z0-9_.\-]+\.csv$/.test(rawName)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(isHead ? undefined : 'invalid export filename\n');
      return;
    }
    if (!csvExportResolver) {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end(isHead ? undefined : 'export resolver not configured\n');
      return;
    }
    const resolved = await csvExportResolver(rawName);
    if (!resolved) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(isHead ? undefined : 'not found\n');
      return;
    }
    try {
      const file = await loadResponseFile(resolved.absolutePath, isHead);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Length', String(file.length));
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${resolved.friendlyName.replace(/["\r\n]/g, '_')}"`
      );
      res.end(file.data ?? undefined);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(isHead ? undefined : 'not found\n');
      return;
    }
    return;
  }

  if (rawPath.startsWith('/audio/')) {
    const rawName = rawPath.slice('/audio/'.length);
    // Stricter allow-list for audio: only click-preview-<bpm>bpm-<n>beats.wav
    if (!/^click-preview-\d{2,3}bpm-\d{1,2}beats\.wav$/.test(rawName)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(isHead ? undefined : 'invalid audio filename\n');
      return;
    }
    if (!audioResolver) {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end(isHead ? undefined : 'audio resolver not configured\n');
      return;
    }
    const resolved = await audioResolver(rawName);
    if (!resolved) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(isHead ? undefined : 'not found\n');
      return;
    }
    try {
      const file = await loadResponseFile(resolved.absolutePath, isHead);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Content-Type', resolved.mimeType);
      res.setHeader('Content-Length', String(file.length));
      res.end(file.data ?? undefined);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(isHead ? undefined : 'not found\n');
      return;
    }
    return;
  }

  if (rawPath.startsWith('/static/')) {
    await serveStaticFile(req.url ?? '', res, isHead);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end(isHead ? undefined : 'not found. try /setlist or /performance\n');
}
