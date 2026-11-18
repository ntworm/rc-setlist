// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The setlist of the main computer, pulled over the link.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { WebSocket } from 'ws';

import { setExtensionContext, clearExtensionContext } from '../src/context.ts';
import { startServer, stopServer } from '../src/index.ts';
import { bridgeState } from '../src/runtime/bridge-state.ts';
import {
  answerSetlistRequest,
  receiveSetlistChunk,
  requestMasterSetlist,
} from '../src/runtime/peer-setlist.ts';
import { decodeClientMessage } from '../src/server/client-message.ts';
import { parseSongBook } from '../src/core/song-book.ts';
import { MAIN_CUES } from './helpers/peer-link-harness.mjs';

let storageDir = '';

// A lyric big enough that the setlist has to travel in more than one piece.
const BIG_LYRIC = `${'la la la\n'.repeat(20_000)}`;

// The song book of a setlist: the colour and the notes of its songs.
const SONG_BOOK = {
  version: 1,
  reloadCount: 0,
  present: [],
  tombstoned: [],
  data: {
    Alpha: { color: '#ff8800', notes: 'Slow start' },
    Beta: { color: '#22aa66', notes: 'Talk to the crowd' },
  },
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'rc-setlist-pull-'));
}

// The manager of the setlists, as the package needs it: the list of the
// setlists, the folder of each one and the names that are taken.
function fakeManager(root) {
  const profiles = [];
  let activeId = '';
  const pathsOf = (id) => ({
    customOrder: path.join(root, 'profiles', id, 'custom-order.json'),
    lyrics: path.join(root, 'profiles', id, 'lyrics'),
    songBook: path.join(root, 'profiles', id, 'song-book.json'),
  });
  return {
    create: async (name) => {
      const profile = { id: `p${profiles.length + 1}`, name };
      profiles.push(profile);
      if (!activeId) activeId = profile.id;
      await fs.mkdir(pathsOf(profile.id).lyrics, { recursive: true });
      return profile;
    },
    getActive: () => profiles.find((profile) => profile.id === activeId) ?? profiles[0],
    getPaths: (id) => pathsOf(id),
    hasName: (name) => profiles.some((profile) => profile.name === name),
    list: () => profiles.map((profile) => ({ id: profile.id, name: profile.name })),
    listDeleted: () => [],
    select: async (id) => {
      activeId = id;
      return profiles.find((profile) => profile.id === id);
    },
  };
}

// A setlist of the main computer: an order, a song book and lyrics.
async function masterSetlist(root, name) {
  const manager = fakeManager(root);
  const created = await manager.create(name);
  await manager.select(created.id);
  const paths = manager.getPaths(created.id);
  await fs.writeFile(paths.customOrder, JSON.stringify(['Beta', 'Alpha']), 'utf8');
  await fs.writeFile(paths.songBook, JSON.stringify(SONG_BOOK), 'utf8');
  await fs.mkdir(paths.lyrics, { recursive: true });
  await fs.writeFile(path.join(paths.lyrics, 'Big.lrc'), BIG_LYRIC, 'utf8');
  return manager;
}

// The link of the main computer, as this computer sees it, and the server
// it hangs on.
function stubPeer(answer) {
  const sent = [];
  const socket = {
    readyState: 1,
    send(text) {
      const message = JSON.parse(text);
      sent.push(message);
      if (message.type === 'setlist_request' && answer) answer(message);
      return true;
    },
  };
  return {
    sent,
    socket,
    server: { peerSockets: () => [socket], broadcast: () => {}, broadcastState: () => {} },
  };
}

// Puts the given manager and server in place of the ones of this computer,
// and puts the old ones back afterwards.
async function withState(manager, server, run) {
  const previousManager = bridgeState.profileManager;
  const previousServer = bridgeState.wsServer;
  bridgeState.profileManager = manager;
  bridgeState.wsServer = server;
  try {
    return await run();
  } finally {
    bridgeState.profileManager = previousManager;
    bridgeState.wsServer = previousServer;
  }
}

function mainPort() {
  const address = bridgeState.server?.address();
  return address && typeof address === 'object' ? address.port : 0;
}

// The main computer, as a paired computer of this one.
async function connectPeer(port, token) {
  const socket = new WebSocket(`wss://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`, {
    rejectUnauthorized: false,
  });
  const messages = [];
  socket.on('message', (data) => {
    try {
      messages.push(JSON.parse(data.toString()));
    } catch {
      // a frame that is not JSON is not a frame this test reads
    }
  });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.on('error', () => {
    // the socket is closed at the end of the test
  });
  socket.send(JSON.stringify({ type: 'handshake', clientId: 'test-master' }));
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !messages.some((message) => message.type === 'handshake_ack')) {
    await delay(25);
  }
  const ack = messages.find((message) => message.type === 'handshake_ack');
  if (ack) socket.send(JSON.stringify({ type: 'sync_confirm', stateVersion: ack.stateVersion }));
  await delay(50);
  return socket;
}

before(async () => {
  storageDir = path.join(os.tmpdir(), `rc-setlist-pull-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(storageDir, { recursive: true });
  setExtensionContext({
    environment: { storageDirectory: storageDir },
    application: { song: { handle: { id: 42 }, tempo: 120, cuePoints: MAIN_CUES } },
  });
});

after(async () => {
  await stopServer();
  clearExtensionContext();
  await fs.rm(storageDir, { recursive: true, force: true });
});

test('the setlist of the main computer comes in as a setlist of its own', async () => {
  const root = await tempRoot();
  try {
    const master = await masterSetlist(path.join(root, 'master'), 'Master Setlist');
    const slave = fakeManager(path.join(root, 'slave'));
    const pieces = [];
    const link = stubPeer((message) => {
      void answerSetlistRequest(
        message.requestId,
        (reply) => {
          pieces.push(reply);
          receiveSetlistChunk(reply);
          return true;
        },
        master,
        'Master Project',
      );
    });

    const result = await withState(slave, link.server, () => requestMasterSetlist());

    assert.equal(result.count, 1);
    assert.deepEqual(result.names, ['Master Setlist']);
    assert.ok(pieces.length > 1, 'the setlist must travel in more than one piece');
    assert.deepEqual(
      slave.list().map((profile) => profile.name),
      ['Master Setlist'],
    );
    const imported = slave.getPaths(slave.list()[0].id);
    const order = JSON.parse(await fs.readFile(imported.customOrder, 'utf8'));
    const book = JSON.parse(await fs.readFile(imported.songBook, 'utf8'));
    assert.deepEqual(order, ['Beta', 'Alpha']);
    assert.deepEqual(book, parseSongBook(SONG_BOOK));
    const lyric = await fs.readFile(path.join(imported.lyrics, 'Big.lrc'), 'utf8');
    assert.equal(lyric, BIG_LYRIC);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a piece that carries too much or lies out of range is refused', () => {
  const piece = (data) => ({
    type: 'setlist_chunk',
    requestId: 'abc123',
    index: 0,
    total: 1,
    data,
  });
  assert.equal(decodeClientMessage(piece('x'.repeat(48 * 1024 + 17))).ok, false);
  assert.equal(decodeClientMessage(piece('x'.repeat(48 * 1024))).ok, true);
  // The request is a name, not a number: it must not carry anything else.
  assert.equal(
    decodeClientMessage({ ...piece('x'), requestId: 'ABCDEF' }).ok,
    false,
    'a request id must be lower case hex',
  );
  assert.equal(decodeClientMessage({ ...piece('x'), requestId: 'f'.repeat(65) }).ok, false);
  // At most six hundred pieces, and the index must be one of them.
  assert.equal(decodeClientMessage({ ...piece('x'), total: 601 }).ok, false);
  assert.equal(decodeClientMessage({ ...piece('x'), index: 600, total: 601 }).ok, false);
});

test('an answer that is broken leaves the setlists alone', async () => {
  const root = await tempRoot();
  try {
    const slave = fakeManager(path.join(root, 'slave'));
    // A piece that does not belong to the setlist drops the request.
    const link = stubPeer(() => {});
    const pull = withState(slave, link.server, () => requestMasterSetlist());
    await delay(50);
    receiveSetlistChunk({
      type: 'setlist_chunk',
      requestId: link.sent[0].requestId,
      index: 5,
      total: 2,
      data: 'x',
    });
    await assert.rejects(pull, /did not send its setlist/);

    // A setlist that adds up to more than a package is refused too.
    const other = stubPeer(() => {});
    const second = withState(slave, other.server, () => requestMasterSetlist());
    await delay(50);
    const piece = 'x'.repeat(48 * 1024);
    for (let index = 0; index < 600; index += 1) {
      receiveSetlistChunk({
        type: 'setlist_chunk',
        requestId: other.sent[0].requestId,
        index,
        total: 600,
        data: piece,
      });
    }
    await assert.rejects(second, /did not send its setlist/);
    assert.deepEqual(slave.list(), [], 'no setlist may come out of a broken answer');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a piece of a request nobody made is ignored', () => {
  assert.doesNotThrow(() => {
    receiveSetlistChunk({
      type: 'setlist_chunk',
      requestId: 'deadbeef',
      index: 0,
      total: 1,
      data: 'x',
    });
  });
});

test('a main computer that refuses ends the pull with the refusal', async () => {
  const root = await tempRoot();
  try {
    const slave = fakeManager(path.join(root, 'slave'));
    const pieces = [];
    const link = stubPeer((message) => {
      void answerSetlistRequest(
        message.requestId,
        (reply) => {
          pieces.push(reply);
          receiveSetlistChunk(reply);
          return true;
        },
        fakeManager(path.join(root, 'empty')),
        'Master Project',
      );
    });
    await assert.rejects(
      withState(slave, link.server, () => requestMasterSetlist()),
      /did not send its setlist/,
    );
    assert.deepEqual(
      pieces.map((piece) => piece.total),
      [0],
      'the refusal is a piece with nothing in it',
    );
    assert.deepEqual(slave.list(), [], 'no setlist may come out of a refusal');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('the setlist of the main computer crosses the link into the second computer', async () => {
  const root = await tempRoot();
  let socket = null;
  try {
    await startServer({ port: 0, skipOsc: true, skipProjectDetector: true });
    const master = await masterSetlist(path.join(root, 'master'), 'Master Setlist');
    socket = await connectPeer(mainPort(), bridgeState.peerToken);
    socket.on('message', (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!message || message.type !== 'setlist_request') return;
      void answerSetlistRequest(
        message.requestId,
        (reply) => {
          socket.send(JSON.stringify(reply));
          return true;
        },
        master,
        'Master Project',
      );
    });

    const result = await requestMasterSetlist();

    assert.deepEqual(result.names, ['Master Setlist']);
    const imported = bridgeState.profileManager
      .list()
      .find((profile) => profile.name === 'Master Setlist');
    assert.ok(imported, 'the setlist of the main computer must be in the project');
    const paths = bridgeState.profileManager.getPaths(imported.id);
    const order = JSON.parse(await fs.readFile(paths.customOrder, 'utf8'));
    const book = JSON.parse(await fs.readFile(paths.songBook, 'utf8'));
    assert.deepEqual(order, ['Beta', 'Alpha']);
    assert.deepEqual(book, parseSongBook(SONG_BOOK));
    const lyric = await fs.readFile(path.join(paths.lyrics, 'Big.lrc'), 'utf8');
    assert.equal(lyric, BIG_LYRIC);
  } finally {
    socket?.close();
    await stopServer();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('the pieces wait for room on the socket and stop when it is gone', async () => {
  const root = await tempRoot();
  try {
    const master = fakeManager(path.join(root, 'master'));
    await master.create('Waiting Set');
    const sent = [];
    let asks = 0;
    await answerSetlistRequest(
      'abcd',
      (piece) => {
        sent.push(piece);
        return true;
      },
      master,
      'Master Project',
      () => {
        asks += 1;
        return asks > 2;
      },
    );
    assert.ok(asks >= 3, 'the socket was asked until it had room');
    assert.ok(sent.length >= 1 && sent[0].total >= 1, 'the setlist went once there was room');

    const none = [];
    await answerSetlistRequest(
      'abce',
      (piece) => {
        none.push(piece);
        return true;
      },
      master,
      'Master Project',
      () => null,
    );
    assert.deepEqual(none, [], 'nothing is written to a socket that is gone');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
