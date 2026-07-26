import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const staticRoot = path.resolve(here, '../../static');
const docsRoot = path.resolve(here, '../../docs');
const port = 4173;
let activeScenario = 'default';
let receivedMessages = [];

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const songNames = [
  'WALK-IN',
  'NEON SIGNAL',
  'OPEN CIRCUIT — EXTENDED DEMO TITLE FOR RESPONSIVE TESTING',
  'NIGHT TRANSIT',
  'LAST LIGHT',
  'INTERLUDE',
  'ENCORE',
  'EXIT',
];

const songs = songNames.map((title, songIndex) => ({
  title,
  time: songIndex * 128,
  sections: [
    { name: 'INTRO', time: songIndex * 128, loopCount: null, autoStop: false, autoNext: false, bpm: null },
    { name: 'SECTION 1', time: songIndex * 128 + 24, loopCount: null, autoStop: false, autoNext: false, bpm: null },
    {
      name: 'MAIN SECTION WITH AN INTENTIONALLY LONG DEMO NAME',
      time: songIndex * 128 + 56,
      loopCount: songIndex === 2 ? 4 : null,
      autoStop: false,
      autoNext: false,
      bpm: songIndex === 2 ? 124 : null,
    },
    { name: 'BRIDGE / SOLO', time: songIndex * 128 + 88, loopCount: null, autoStop: false, autoNext: songIndex === 2, bpm: null },
  ],
  loopCount: null,
  autoStop: songIndex === 6,
  autoNext: songIndex !== 6,
  bpm: songIndex === 2 ? 124 : 120,
}));

const stateMessage = {
  type: 'state',
  state: {
    songs,
    activeSongIndex: 2,
    activeSectionIndex: 2,
    currentSongTime: 318.5,
    tempo: 124,
    isPlaying: true,
    signatureNumerator: 4,
    metronome: true,
    clipTriggerQuantization: 4,
  },
};

const lyricsMessage = {
  type: 'lyrics',
  song: songNames[2],
  format: 'lrc',
  lines: [
    { time: 0, text: 'Demo line one for synchronized text' },
    { time: 12.4, text: 'Demo line two follows the transport' },
    { time: 25.2, text: 'A deliberately longer fictional line tests responsive layout' },
    { time: 38.8, text: 'Demo line four marks the next cue' },
    { time: 52.1, text: 'Neon Signal is a fictional example' },
    { time: 65.4, text: 'No personal setlist content is included' },
    { time: 78.7, text: 'Demo line seven keeps timing coverage' },
    { time: 91.3, text: 'Demo line eight closes the fixture' },
  ],
};

const marketingSongNames = ['MÚSICA 01', 'MÚSICA 02', 'MÚSICA 03', 'MÚSICA 04', 'MÚSICA 05'];
const marketingSongs = marketingSongNames.map((title, songIndex) => ({
  title,
  time: songIndex * 128,
  sections: [
    { name: 'INTRO', time: songIndex * 128, loopCount: null, autoStop: false, autoNext: false, bpm: null },
    { name: 'VERSO', time: songIndex * 128 + 24, loopCount: null, autoStop: false, autoNext: false, bpm: null },
    {
      name: 'REFRÃO',
      time: songIndex * 128 + 56,
      loopCount: songIndex === 2 ? 2 : null,
      autoStop: false,
      autoNext: false,
      bpm: songIndex === 2 ? 124 : null,
    },
    { name: 'PONTE', time: songIndex * 128 + 88, loopCount: null, autoStop: false, autoNext: true, bpm: null },
  ],
  loopCount: null,
  autoStop: songIndex === 4,
  autoNext: songIndex !== 4,
  bpm: songIndex === 2 ? 124 : 120,
}));

const marketingStateMessage = {
  type: 'state',
  state: {
    songs: marketingSongs,
    activeSongIndex: 2,
    activeSectionIndex: 2,
    currentSongTime: 318.5,
    tempo: 124,
    isPlaying: true,
    signatureNumerator: 4,
    metronome: true,
    clipTriggerQuantization: 4,
  },
};

const marketingLyricsMessage = {
  type: 'lyrics',
  song: marketingSongNames[2],
  format: 'lrc',
  lines: [
    { time: 0, text: 'Linha anterior da letra ou cifra' },
    { time: 15, text: 'A próxima frase acompanha o transporte' },
    { time: 30, text: 'O destaque avança no tempo da música' },
    { time: 45, text: 'Contexto legível para ensaio e palco' },
    { time: 60, text: 'Linha atual sincronizada com a música' },
    { time: 75, text: 'Próxima linha preparada para leitura' },
  ],
};

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function resolveStaticPath(rawUrl) {
  let pathname = new URL(rawUrl, `http://127.0.0.1:${port}`).pathname;
  if (pathname === '/landing' || pathname === '/landing/') {
    return path.resolve(docsRoot, 'index.html');
  }
  if (pathname.startsWith('/landing/')) {
    const resolvedDocsPath = path.resolve(docsRoot, `.${pathname.slice('/landing'.length)}`);
    return resolvedDocsPath.startsWith(docsRoot) ? resolvedDocsPath : null;
  }
  if (pathname === '/' || pathname === '/setlist' || pathname === '/setlist/') {
    pathname = '/setlist/index.html';
  } else if (pathname === '/performance' || pathname === '/performance/') {
    pathname = '/performance/index.html';
  }
  const resolved = path.resolve(staticRoot, `.${pathname}`);
  return resolved.startsWith(staticRoot) ? resolved : null;
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || '/', `http://127.0.0.1:${port}`);
  if (requestUrl.pathname === '/__test__/state') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(stateMessage));
    return;
  }
  if (requestUrl.pathname === '/__test__/messages') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(receivedMessages));
    return;
  }
  if (requestUrl.pathname === '/__test__/emit' && request.method === 'POST') {
    readJsonBody(request)
      .then((payload) => {
        for (const client of webSockets.clients) client.send(JSON.stringify(payload));
        response.writeHead(204).end();
      })
      .catch(() => response.writeHead(400).end());
    return;
  }
  if (requestUrl.pathname === '/setlist/' || requestUrl.pathname === '/performance/') {
    activeScenario = requestUrl.searchParams.get('scenario') || 'default';
    if (requestUrl.pathname === '/setlist/') receivedMessages = [];
  }
  const filePath = resolveStaticPath(request.url || '/');
  if (!filePath) {
    response.writeHead(403).end();
    return;
  }
  fs.readFile(filePath, (error, body) => {
    if (error) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': contentTypes[path.extname(filePath)] || 'application/octet-stream',
    });
    response.end(body);
  });
});

const webSockets = new WebSocketServer({ server, path: '/ws' });
webSockets.on('connection', (socket) => {
  const scenario = activeScenario;
  if (scenario === 'never-connected') {
    socket.close();
    return;
  }

  const message = scenario === 'no-song'
    ? { ...stateMessage, state: { ...stateMessage.state, songs: [], activeSongIndex: -1, activeSectionIndex: -1 } }
    : scenario === 'marketing'
      ? marketingStateMessage
      : stateMessage;
  const lyrics = scenario === 'no-lyrics' || scenario === 'no-song'
    ? { ...lyricsMessage, lines: [], format: 'none' }
    : scenario === 'marketing'
      ? marketingLyricsMessage
      : lyricsMessage;

  socket.send(JSON.stringify({ type: 'auth_status', isController: scenario !== 'read-only' }));
  socket.send(JSON.stringify(message));
  socket.on('message', (rawMessage) => {
    try {
      const parsed = JSON.parse(String(rawMessage));
      receivedMessages.push(parsed);
      if (parsed.type === 'get_lyrics') {
        socket.send(JSON.stringify(lyrics));
      }
    } catch {
      // The production UI ignores malformed messages, and so does the fixture.
    }
  });
  if (scenario === 'stale') {
    setTimeout(() => socket.close(), 120);
  }
});

server.listen(port, '127.0.0.1');

function shutdown() {
  for (const client of webSockets.clients) client.terminate();
  webSockets.close(() => server.close(() => process.exit(0)));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
