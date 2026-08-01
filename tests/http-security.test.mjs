import { test } from 'node:test';
import assert from 'node:assert';
import * as http from 'node:http';
import {
  createHttpRequestListener,
  handleHttp,
  loadResponseFile,
  safeAttachmentName,
  setHttpAuthToken,
  setDebugSnapshotProvider,
  sanitizeUrl,
} from '../src/server/http.ts';

function createServer(authToken) {
  setHttpAuthToken(authToken);
  setDebugSnapshotProvider(() => ({ dummy: 'data' }));

  const server = http.createServer(createHttpRequestListener());
  return server;
}

function startServer(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port);
    });
  });
}

function stopServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function makeRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('HTTP Security: sanitizeUrl query token redaction', () => {
  assert.strictEqual(sanitizeUrl('/debug/snapshot?token=secret123'), '/debug/snapshot?token=***');
  assert.strictEqual(sanitizeUrl('/setlist?param=abc&token=xyz&other=123'), '/setlist?param=abc&token=***&other=123');
  assert.strictEqual(sanitizeUrl('/debug/snapshot?%74oken=encoded-secret'), '/debug/snapshot?%74oken=***');
  assert.strictEqual(sanitizeUrl('/health'), '/health');
  assert.strictEqual(sanitizeUrl(''), '');
});

test('HTTP Security: production debug snapshot requires an explicit true flag', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDebugFlag = process.env.ENABLE_DEBUG_SNAPSHOT;
  process.env.NODE_ENV = 'production';
  process.env.ENABLE_DEBUG_SNAPSHOT = '0';

  const server = createServer('debug-token');
  const port = await startServer(server);
  try {
    const hidden = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/debug/snapshot?token=debug-token',
      method: 'GET',
    });
    assert.strictEqual(hidden.status, 404);
  } finally {
    await stopServer(server);
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousDebugFlag === undefined) delete process.env.ENABLE_DEBUG_SNAPSHOT;
    else process.env.ENABLE_DEBUG_SNAPSHOT = previousDebugFlag;
  }
});

test('HTTP Security: rejected async handlers return a controlled 500', async () => {
  const server = http.createServer(createHttpRequestListener(async () => {
    throw new Error('sensitive resolver detail');
  }));
  const port = await startServer(server);
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/exports/failure.csv',
      method: 'GET',
    });
    assert.strictEqual(response.status, 500);
    assert.strictEqual(response.body, 'internal server error\n');
    assert.doesNotMatch(response.body, /sensitive resolver detail/);
  } finally {
    await stopServer(server);
  }
});

test('HTTP Security: HEAD response metadata does not read the response body', async () => {
  let readCalled = false;
  const file = await loadResponseFile('virtual.csv', true, {
    async stat() { return { size: 42, isFile: () => true }; },
    async readFile() { readCalled = true; return Buffer.from('secret body'); },
  });
  assert.deepStrictEqual(file, { length: 42, data: null });
  assert.strictEqual(readCalled, false);
});

test('HTTP Security: attachment filenames cannot inject headers or paths', () => {
  assert.strictEqual(
    safeAttachmentName('../Tour "Set"\r\nX-Injected: yes.csv'),
    'Tour _Set___X-Injected_ yes.csv',
  );
});

test('HTTP Security: /debug/snapshot authentication', async () => {
  const token = 'my_secret_token_123';
  const server = createServer(token);
  const port = await startServer(server);

  try {
    // 1. Request without token
    const resNoToken = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/debug/snapshot',
      method: 'GET'
    });
    assert.strictEqual(resNoToken.status, 401);
    const jsonNoToken = JSON.parse(resNoToken.body);
    assert.strictEqual(jsonNoToken.error, 'unauthorized: invalid or missing security token');

    // 2. Request with wrong token
    const resWrongToken = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/debug/snapshot?token=wrong',
      method: 'GET'
    });
    assert.strictEqual(resWrongToken.status, 401);

    // 3. Request with valid token
    const resValidToken = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: `/debug/snapshot?token=${token}`,
      method: 'GET'
    });
    assert.strictEqual(resValidToken.status, 200);
    const jsonValidToken = JSON.parse(resValidToken.body);
    assert.strictEqual(jsonValidToken.dummy, 'data');

  } finally {
    await stopServer(server);
  }
});

test('HTTP Security: /debug/snapshot does not depend on the global URL constructor', async () => {
  const originalUrl = globalThis.URL;

  setHttpAuthToken('embedded_runtime_token');
  setDebugSnapshotProvider(() => ({ dummy: 'data' }));

  const invoke = async (url) => {
    let status = 0;
    let body = '';
    const request = {
      method: 'GET',
      url,
      headers: { host: 'localhost:4444' },
    };
    const response = {
      writeHead(statusCode) {
        status = statusCode;
      },
      end(chunk) {
        body = chunk ? String(chunk) : '';
      },
    };
    await handleHttp(request, response);
    return { status, body: JSON.parse(body) };
  };

  let unauthorized;
  let authenticated;
  try {
    globalThis.URL = undefined;
    unauthorized = await invoke('/debug/snapshot');
    authenticated = await invoke('/debug/snapshot?token=embedded_runtime_token');
  } finally {
    globalThis.URL = originalUrl;
  }

  assert.strictEqual(unauthorized.status, 401);
  assert.deepStrictEqual(unauthorized.body, {
    error: 'unauthorized: invalid or missing security token',
  });
  assert.strictEqual(authenticated.status, 200);
  assert.strictEqual(authenticated.body.dummy, 'data');
});

test('HTTP Security: /log route removal', async () => {
  const server = createServer('any');
  const port = await startServer(server);

  try {
    const res = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/log',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ level: 'info', parts: ['test'] }));

    assert.strictEqual(res.status, 405);
    assert.strictEqual(res.body, 'method not allowed\n');
  } finally {
    await stopServer(server);
  }
});

test('HTTP Security: HEAD method support', async () => {
  const token = 'my_secret_token_123';
  const server = createServer(token);
  const port = await startServer(server);

  try {
    // 1. HEAD /health should return 200, Content-Type, and empty body
    const resHealth = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/health',
      method: 'HEAD'
    });
    assert.strictEqual(resHealth.status, 200);
    assert.strictEqual(resHealth.headers['content-type'], 'application/json; charset=utf-8');
    assert.strictEqual(resHealth.body, '');

    // 2. HEAD /debug/snapshot with valid token should return 200, Content-Length, Content-Type, and empty body
    const resSnapshot = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: `/debug/snapshot?token=${token}`,
      method: 'HEAD'
    });
    assert.strictEqual(resSnapshot.status, 200);
    assert.strictEqual(resSnapshot.headers['content-type'], 'application/json; charset=utf-8');
    assert.ok(resSnapshot.headers['content-length'] !== undefined);
    assert.strictEqual(resSnapshot.body, '');

    // 3. HEAD to non-existent static file should return 404 and empty body
    const resStatic404 = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/static/non-existent-file-xyz.html',
      method: 'HEAD'
    });
    assert.strictEqual(resStatic404.status, 404);
    assert.strictEqual(resStatic404.body, '');

  } finally {
    await stopServer(server);
  }
});

test('HTTP Security: malformed percent encoding path robustness', async () => {
  const server = createServer('any');
  const port = await startServer(server);

  try {
    // Request with malformed percent encoding should fail with 400 Bad Request, not throw/crash
    const resMalformed = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/static/%C1abc',
      method: 'GET'
    });
    assert.strictEqual(resMalformed.status, 400);
    assert.ok(resMalformed.body.includes('bad request'));

  } finally {
    await stopServer(server);
  }
});
