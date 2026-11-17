// Tests for the batched, serialised writes of EventLogger.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { EventLogger } from '../src/core/event-log.ts';

async function withLogger(options, run) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-setlist-log-batch-'));
  try {
    const calls = { append: [], rotate: 0, stat: 0, inFlight: 0, maxInFlight: 0 };
    const fileOps = {
      async appendFile(_filePath, data) {
        calls.inFlight++;
        calls.maxInFlight = Math.max(calls.maxInFlight, calls.inFlight);
        try {
          if (options.holdAppend) await options.holdAppend();
          calls.append.push(data);
        } finally {
          calls.inFlight--;
        }
      },
      async stat() {
        calls.stat++;
        return { size: 0 };
      },
      rotate() {
        calls.rotate++;
        return options.rotate ? options.rotate() : true;
      },
    };
    const logger = new EventLogger(tmpDir, {
      maxSizeBytes: options.maxSizeBytes ?? 1024 * 1024,
      dedupWindowMs: 0,
      fileOps,
    });
    await run(logger, calls);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

function logMany(logger, count, message = 'entry') {
  for (let i = 0; i < count; i++) logger.log({ type: 'TEST', message: `${message}-${i}` });
}

test('100 entries under the limit are written with one appendFile', async () => {
  await withLogger({}, async (logger, calls) => {
    logMany(logger, 100);
    await logger.flush();
    assert.equal(calls.append.length, 1);
    assert.equal(calls.append[0].trim().split('\n').length, 100);
    assert.equal(calls.stat, 1);
    assert.equal(calls.rotate, 0);
  });
});

test('a batch crossing the limit is split into two appendFile calls and one rotation', async () => {
  await withLogger({ maxSizeBytes: 1000 }, async (logger, calls) => {
    logMany(logger, 10, 'x'.repeat(100));
    await logger.flush();
    assert.equal(calls.append.length, 2);
    assert.equal(calls.rotate, 1);
    assert.ok(Buffer.byteLength(calls.append[0]) <= 1000);
  });
});

test('a failing rotation does not reset the size', async () => {
  await withLogger({ maxSizeBytes: 1000, rotate: () => false }, async (logger, calls) => {
    logMany(logger, 10, 'x'.repeat(100));
    await logger.flush();
    const rotationsAfterFirstBatch = calls.rotate;
    assert.ok(rotationsAfterFirstBatch >= 1);

    // The size still counts the file that was not rotated, so the next small
    // entry tries the rotation again.
    logger.log({ type: 'TEST', message: 'small' });
    await logger.flush();
    assert.equal(calls.rotate, rotationsAfterFirstBatch + 1);
  });
});

test('a thrown rotation error counts as a failed rotation', async () => {
  const rotate = () => {
    throw new Error('rename failed');
  };
  await withLogger({ maxSizeBytes: 1000, rotate }, async (logger, calls) => {
    logMany(logger, 10, 'x'.repeat(100));
    await logger.flush();
    const rotationsAfterFirstBatch = calls.rotate;
    logger.log({ type: 'TEST', message: 'small' });
    await logger.flush();
    assert.equal(calls.rotate, rotationsAfterFirstBatch + 1);
  });
});

test('concurrent flush calls never run two appendFile calls at once', async () => {
  let releases = [];
  const holdAppend = () => new Promise((resolve) => releases.push(resolve));
  await withLogger({ holdAppend }, async (logger, calls) => {
    logMany(logger, 5);
    const first = logger.flush();
    const second = logger.flush();
    await new Promise((resolve) => setImmediate(resolve));
    logger.log({ type: 'TEST', message: 'mid-flush' });

    // Release every held write as it appears until both flushes settle.
    let done = false;
    const all = Promise.all([first, second]).then(() => {
      done = true;
    });
    while (!done) {
      const pending = releases;
      releases = [];
      for (const release of pending) release();
      await new Promise((resolve) => setImmediate(resolve));
    }
    await all;

    assert.equal(calls.maxInFlight, 1);
    assert.equal(calls.append.length, 2, 'the mid-flush entry is written in a second chunk');
    assert.ok(calls.append.join('').includes('mid-flush'));
  });
});
