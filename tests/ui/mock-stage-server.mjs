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
  durationSeconds: songIndex === 0 ? 60 : songIndex === 1 ? 120 : null,
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
    protocolVersion: 3,
    songs,
    activeSongIndex: 2,
    activeSectionIndex: 2,
    currentSongTime: 318.5,
    tempo: 124,
    isPlaying: true,
    signatureNumerator: 4,
    metronome: true,
    preRollEnabled: false,
    clipTriggerQuantization: 4,
    totalDurationSeconds: 180,
  },
};

const relativeShowSongs = [
  {
    title: 'INTRO',
    time: 0,
    durationSeconds: 106,
    sections: [{ name: 'INTRO', time: 0, loopCount: null, autoStop: false, autoNext: false, bpm: null }],
    loopCount: null,
    autoStop: false,
    autoNext: false,
    bpm: 120,
  },
  {
    title: 'JULIA',
    time: 840,
    durationSeconds: 237,
    sections: [{ name: 'INTRO', time: 840, loopCount: null, autoStop: false, autoNext: false, bpm: null }],
    loopCount: null,
    autoStop: false,
    autoNext: false,
    bpm: 120,
  },
];

function relativeShowState(activeSongIndex) {
  return {
    type: 'state',
    state: {
      protocolVersion: 3,
      songs: relativeShowSongs,
      totalDurationSeconds: 343,
      activeSongIndex,
      activeSectionIndex: 0,
      currentSongTime: relativeShowSongs[activeSongIndex].time,
      tempo: 120,
      isPlaying: false,
      signatureNumerator: 4,
      metronome: false,
      preRollEnabled: false,
      clipTriggerQuantization: 4,
    },
  };
}

const profilesStateMessage = {
  type: 'profiles_state',
  version: 2,
  activeProfileId: '11111111-1111-4111-8111-111111111111',
  profiles: [
    { id: '11111111-1111-4111-8111-111111111111', name: 'Main Setlist' },
    { id: '22222222-2222-4222-8222-222222222222', name: '<Festival>' },
  ],
  deletedProfiles: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Archive',
      deletedAt: '2026-07-29T12:00:00.000Z',
    },
  ],
  canMutate: true,
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

const marketingSongNames = ['SONG 01', 'SONG 02', 'SONG 03', 'SONG 04', 'SONG 05'];
const marketingSongs = marketingSongNames.map((title, songIndex) => ({
  title,
  time: songIndex * 128,
  durationSeconds: 128,
  sections: [
    { name: 'INTRO', time: songIndex * 128, loopCount: null, autoStop: false, autoNext: false, bpm: null },
    { name: 'VERSE', time: songIndex * 128 + 24, loopCount: null, autoStop: false, autoNext: false, bpm: null },
    {
      name: 'CHORUS',
      time: songIndex * 128 + 56,
      loopCount: songIndex === 2 ? 2 : null,
      autoStop: false,
      autoNext: false,
      bpm: songIndex === 2 ? 124 : null,
    },
    { name: 'BRIDGE', time: songIndex * 128 + 88, loopCount: null, autoStop: false, autoNext: true, bpm: null },
  ],
  loopCount: null,
  autoStop: songIndex === 4,
  autoNext: songIndex !== 4,
  bpm: songIndex === 2 ? 124 : 120,
}));

const marketingStateMessage = {
  type: 'state',
  state: {
    protocolVersion: 3,
    songs: marketingSongs,
    totalDurationSeconds: 640,
    arrangementEndTime: 640,
    activeSongIndex: 2,
    activeSectionIndex: 2,
    currentSongTime: 318.5,
    tempo: 124,
    isPlaying: true,
    signatureNumerator: 4,
    metronome: true,
    preRollEnabled: false,
    clipTriggerQuantization: 4,
  },
};

const marketingLyricsMessage = {
  type: 'lyrics',
  song: marketingSongNames[2],
  format: 'lrc',
  lines: [
    { time: 0, text: 'Previous lyric or chord line' },
    { time: 15, text: 'The next phrase follows the transport' },
    { time: 30, text: 'The highlight advances with song time' },
    { time: 45, text: 'Readable context for rehearsal and stage' },
    { time: 60, text: 'Current line synchronized with the song' },
    { time: 75, text: 'Next line ready for the performer' },
  ],
};

function stateForScenario(scenario) {
  if (scenario === 'relative-first') return relativeShowState(0);
  if (scenario === 'relative-later') return relativeShowState(1);
  return scenario === 'marketing' ? marketingStateMessage : stateMessage;
}

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
    response.end(JSON.stringify(stateForScenario(requestUrl.searchParams.get('scenario') || activeScenario)));
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
    : stateForScenario(scenario);
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
      if (parsed.type === 'handshake') {
        socket.send(JSON.stringify({
          type: 'handshake_ack',
          stateVersion: 1,
          state: message.state,
        }));
      } else if (parsed.type === 'get_lyrics') {
        const requestedSong = typeof parsed.song === 'string' && parsed.song
          ? parsed.song
          : lyrics.song;
        socket.send(JSON.stringify(requestedSong === lyrics.song
          ? lyrics
          : { type: 'lyrics', song: requestedSong, format: 'none', lines: [] }));
      } else if (parsed.type === 'profiles_get') {
        socket.send(JSON.stringify(profilesStateMessage));
      } else if (parsed.type === 'save_lyrics' && typeof parsed.commandId === 'string') {
        if (scenario === 'lyrics-save-pending') return;
        socket.send(JSON.stringify({
          type: 'command_status',
          commandId: parsed.commandId,
          status: scenario === 'lyrics-save-fails' ? 'failed' : 'confirmed',
        }));
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
