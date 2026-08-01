import { test } from 'node:test';
import assert from 'node:assert';
import * as http from 'node:http';
import { WebSocket } from 'ws';
import { SetlistWSServer, isValidOrigin } from '../src/server/ws.ts';

function createServerAndWS(authToken) {
  const wsServer = new SetlistWSServer(authToken);
  wsServer.init();

  const server = http.createServer((req, res) => {
    res.writeHead(404);
    res.end();
  });

  server.on('upgrade', (req, socket, head) => {
    wsServer.handleUpgrade(req, socket, head);
  });

  return { wsServer, server };
}

function startServer(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(addr.port);
    });
  });
}

function stopServerAndWS(server, wsServer) {
  return new Promise((resolve) => {
    wsServer.stop();
    server.close(() => {
      resolve();
    });
  });
}

function nextMessage(ws, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for WebSocket message')), 1000);
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (!predicate(message)) return;
      clearTimeout(timer);
      resolve(message);
    });
  });
}

test('WebSocket Hardening: malformed JSON receives a sanitized structured error', async () => {
  const { wsServer, server } = createServerAndWS('token123');
  const port = await startServer(server);

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    const errorPromise = nextMessage(ws, (message) => message.code === 'invalid_message');
    ws.send('{"type":"play",BROKEN');

    assert.deepStrictEqual(await errorPromise, {
      type: 'error',
      code: 'invalid_message',
      message: 'Message must be valid JSON.',
    });
    ws.close();
  } finally {
    await stopServerAndWS(server, wsServer);
  }
});

test('WebSocket Hardening: invalid decoded messages are sanitized and never emitted', async () => {
  const { wsServer, server } = createServerAndWS('token123');
  const port = await startServer(server);
  let emitted = false;
  wsServer.on('client_message', () => { emitted = true; });

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    const errorPromise = nextMessage(ws, (message) => message.code === 'invalid_message');
    ws.send(JSON.stringify({
      type: 'destroy_everything',
      commandId: 'unsafe-command-1',
      raw: 'do-not-reflect',
    }));

    assert.deepStrictEqual(await errorPromise, {
      type: 'error',
      code: 'invalid_message',
      message: 'Unsupported message type.',
      commandId: 'unsafe-command-1',
    });
    assert.equal(emitted, false);
    ws.close();
  } finally {
    await stopServerAndWS(server, wsServer);
  }
});

test('WebSocket Hardening: emitted commands omit unexpected hostile properties', async () => {
  const { wsServer, server } = createServerAndWS('token123');
  const port = await startServer(server);

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    const emittedPromise = new Promise((resolve) => wsServer.once('client_message', resolve));
    ws.send(JSON.stringify({
      type: 'play',
      commandId: 'play-canonical-1',
      raw: 'hostile\nvalue',
    }));

    assert.deepStrictEqual(await emittedPromise, {
      type: 'play',
      commandId: 'play-canonical-1',
    });
    ws.close();
  } finally {
    await stopServerAndWS(server, wsServer);
  }
});

test('WebSocket Hardening: isValidOrigin same-origin helper checks', () => {
  // Same host and port matching
  assert.strictEqual(isValidOrigin('https://192.168.1.42:4444', '192.168.1.42:4444'), true);
  assert.strictEqual(isValidOrigin('http://localhost:4444', 'localhost:4444'), true);
  assert.strictEqual(isValidOrigin('http://[::1]:4444', '[::1]:4444'), true);
  assert.strictEqual(isValidOrigin('http://127.0.0.1:4444', '127.0.0.1:4444'), true);

  // Mismatched ports
  assert.strictEqual(isValidOrigin('https://192.168.1.42:8080', '192.168.1.42:4444'), false);
  assert.strictEqual(isValidOrigin('http://localhost:8080', 'localhost:4444'), false);

  // External hostnames
  assert.strictEqual(isValidOrigin('http://external-site.com', '192.168.1.42:4444'), false);

  // Localhost only accepted if host header is localhost
  assert.strictEqual(isValidOrigin('http://localhost:4444', '127.0.0.1:4444'), false);
});

test('WebSocket Hardening: origin header upgrade validation', async () => {
  const { wsServer, server } = createServerAndWS('token123');
  const port = await startServer(server);

  try {
    // 1. Valid Origin (matches Host)
    const wsValid = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:${port}`
      }
    });
    await new Promise((resolve, reject) => {
      wsValid.on('open', () => {
        wsValid.close();
        resolve();
      });
      wsValid.on('error', reject);
      setTimeout(() => reject(new Error('Timeout on valid origin')), 1000);
    });

    // 2. Invalid Origin (port mismatch)
    const wsInvalidPort = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:8080`
      }
    });
    await new Promise((resolve, reject) => {
      wsInvalidPort.on('open', () => {
        wsInvalidPort.close();
        reject(new Error('Should not have connected with port mismatch origin'));
      });
      wsInvalidPort.on('error', () => resolve());
      setTimeout(() => resolve(), 1000);
    });

    // 3. Absent Origin (non-browser clients must be allowed)
    const wsAbsent = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((resolve, reject) => {
      wsAbsent.on('open', () => {
        wsAbsent.close();
        resolve();
      });
      wsAbsent.on('error', reject);
      setTimeout(() => reject(new Error('Timeout on absent origin')), 1000);
    });

  } finally {
    await stopServerAndWS(server, wsServer);
  }
});

test('WebSocket Auth: valid token in query param grants controller access', async () => {
  const secretToken = 'my_secret_token';
  const { wsServer, server } = createServerAndWS(secretToken);
  const port = await startServer(server);

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${secretToken}`);
    const authStatus = await new Promise((resolve, reject) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'auth_status') resolve(msg);
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('Timeout')), 1000);
    });

    assert.strictEqual(authStatus.isController, true);
    ws.close();
  } finally {
    await stopServerAndWS(server, wsServer);
  }
});

test('WebSocket Auth: invalid token in query param denies controller access', async () => {
  const { wsServer, server } = createServerAndWS('my_secret_token');
  const port = await startServer(server);

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=wrong_token`);
    const authStatus = await new Promise((resolve, reject) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'auth_status') resolve(msg);
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('Timeout')), 1000);
    });

    assert.strictEqual(authStatus.isController, false);
    ws.close();
  } finally {
    await stopServerAndWS(server, wsServer);
  }
});

test('WebSocket Auth: empty token or empty server token denies access', async () => {
  // Case A: server token empty
  const { wsServer: wsServerEmpty, server: serverEmpty } = createServerAndWS('');
  const portEmpty = await startServer(serverEmpty);

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${portEmpty}/ws?token=`);
    const authStatus = await new Promise((resolve, reject) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'auth_status') resolve(msg);
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('Timeout')), 1000);
    });

    assert.strictEqual(authStatus.isController, false);
    ws.close();
  } finally {
    await stopServerAndWS(serverEmpty, wsServerEmpty);
  }
});

test('WebSocket Auth: manual authentication message', async () => {
  const secretToken = 'my_secret_token';
  const { wsServer, server } = createServerAndWS(secretToken);
  const port = await startServer(server);

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((resolve) => ws.on('open', resolve));

    // 1. Invalid manual auth
    ws.send(JSON.stringify({ type: 'auth', token: 'wrong_token' }));
    const failRes = await new Promise((resolve) => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'auth_result') {
          ws.off('message', handler);
          resolve(msg);
        }
      };
      ws.on('message', handler);
    });
    assert.strictEqual(failRes.success, false);

    // 2. Valid manual auth
    ws.send(JSON.stringify({ type: 'auth', token: secretToken }));
    const successRes = await new Promise((resolve) => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'auth_result') {
          ws.off('message', handler);
          resolve(msg);
        }
      };
      ws.on('message', handler);
    });
    assert.strictEqual(successRes.success, true);
    ws.close();
  } finally {
    await stopServerAndWS(server, wsServer);
  }
});

test('WebSocket Hardening: rate limiting rules', async () => {
  const secretToken = 'valid_token_123';
  const { wsServer, server } = createServerAndWS(secretToken);
  const port = await startServer(server);

  try {
    // A. Ten sequential connections with valid token: all must pass!
    for (let i = 0; i < 10; i++) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${secretToken}`);

      const authStatus = await new Promise((resolve, reject) => {
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'auth_status') resolve(msg);
        });
        ws.on('error', reject);
        setTimeout(() => reject(new Error(`Timeout on iteration ${i}`)), 1000);
      });

      assert.strictEqual(authStatus.isController, true);
      ws.close();
    }

    // B. Four reconnections with invalid token: each consumes only one failure.
    for (let i = 0; i < 4; i++) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=wrong_token`);
      const authStatus = await new Promise((resolve, reject) => {
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'auth_status') resolve(msg);
        });
        ws.on('error', reject);
        setTimeout(() => reject(new Error(`Timeout on invalid connection ${i}`)), 1000);
      });
      assert.strictEqual(authStatus.isController, false);
      ws.close();
    }

    // C. Quinta falha ainda retorna conexão read-only/nega autenticação normalmente.
    const wsFifth = new WebSocket(`ws://127.0.0.1:${port}/ws?token=wrong_token`);
    const authStatusFifth = await new Promise((resolve, reject) => {
      wsFifth.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'auth_status') resolve(msg);
      });
      wsFifth.on('error', reject);
      setTimeout(() => reject(new Error('Timeout fifth failure')), 1000);
    });
    assert.strictEqual(authStatusFifth.isController, false);
    wsFifth.close();

    // D. Sexta falha recebe rate limit (Upgrade returns 429).
    const wsSixth = new WebSocket(`ws://127.0.0.1:${port}/ws?token=wrong_token`);
    const isRejected = await new Promise((resolve) => {
      wsSixth.on('unexpected-response', (req, res) => {
        resolve(res.statusCode === 429);
      });
      wsSixth.on('open', () => {
        wsSixth.close();
        resolve(false);
      });
      wsSixth.on('error', () => {
        resolve(true); // closed/rejected
      });
      setTimeout(() => resolve(false), 1000);
    });
    assert.strictEqual(isRejected, true, 'Sixth invalid upgrade request must be rejected with 429');

    // E. Autenticação manual sem token na URL continua funcionando.
    const wsManualNoToken = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((resolve) => wsManualNoToken.on('open', resolve));

    wsManualNoToken.send(JSON.stringify({ type: 'auth', token: secretToken }));
    const successRes = await new Promise((resolve) => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'auth_result') {
          wsManualNoToken.off('message', handler);
          resolve(msg);
        }
      };
      wsManualNoToken.on('message', handler);
    });
    assert.strictEqual(successRes.success, true);
    wsManualNoToken.close();

  } finally {
    await stopServerAndWS(server, wsServer);
  }
});

test('WebSocket Hardening: max payload size restriction', async () => {
  const { wsServer, server } = createServerAndWS('any');
  const port = await startServer(server);

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    await new Promise((resolve, reject) => {
      let count = 0;
      ws.on('message', () => {
        count++;
        if (count === 2) resolve();
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('Timeout')), 1000);
    });

    const largeMessage = JSON.stringify({
      type: 'save_lyrics',
      song: 'test',
      lyrics: 'a'.repeat(110 * 1024)
    });

    const isClosed = await new Promise((resolve) => {
      ws.on('close', () => {
        resolve(true);
      });
      ws.send(largeMessage, (err) => {
        if (err) resolve(true);
      });
      setTimeout(() => resolve(false), 2000);
    });

    assert.strictEqual(isClosed, true, 'Connection should be closed/dropped due to excessive payload size');

  } finally {
    await stopServerAndWS(server, wsServer);
  }
});

test('WebSocket Hardening: console.log/console.warn sentinel token leakage prevention', async () => {
  const sentinelToken = 'SENTINEL_TOKEN_XYZ_123456';
  const { wsServer, server } = createServerAndWS(sentinelToken);
  const port = await startServer(server);

  const capturedLogs = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...args) => {
    capturedLogs.push(args.join(' '));
    originalLog(...args);
  };
  console.warn = (...args) => {
    capturedLogs.push(args.join(' '));
    originalWarn(...args);
  };

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${sentinelToken}`);

    const messages = [];
    await new Promise((resolve, reject) => {
      ws.on('message', (data) => {
        messages.push(JSON.parse(data.toString()));
        if (messages.length === 2) resolve();
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('Timeout')), 1000);
    });

    ws.close();

    for (const msg of messages) {
      const msgStr = JSON.stringify(msg);
      assert.strictEqual(msgStr.includes(sentinelToken), false, 'WS message sent to client must not contain the sentinel token');
    }

    for (const logLine of capturedLogs) {
      assert.strictEqual(logLine.includes(sentinelToken), false, `Console log line must not contain the sentinel token: ${logLine}`);
    }

  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    await stopServerAndWS(server, wsServer);
  }
});

test('WebSocket backpressure: healthy clients remain connected during ordinary telemetry', async () => {
  const { wsServer, server } = createServerAndWS('test_token');
  const port = await startServer(server);

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    const clientSocket = Array.from(wsServer['clients'])[0];
    assert.ok(clientSocket, 'Client socket should be registered in wsServer');

    const iterations = 50;
    for (let i = 0; i < iterations; i++) {
      wsServer.broadcast({ type: 'telemetry_ping', index: i, payload: 'x'.repeat(1024) });
    }

    assert.strictEqual(
      wsServer['clients'].has(clientSocket),
      true,
      'A healthy client must not be disconnected below the backpressure thresholds'
    );

    ws.close();
  } finally {
    await stopServerAndWS(server, wsServer);
  }
});
