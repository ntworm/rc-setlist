import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteMediaDir = path.join(root, 'docs', 'media');
const templatePath = path.join(root, 'scripts', 'media-kit-template.html');
const outputArgIndex = process.argv.indexOf('--output-dir');
const externalOutputDir = outputArgIndex >= 0 ? path.resolve(process.argv[outputArgIndex + 1]) : null;
const checkOnly = process.argv.includes('--check');

const outputs = [
  { id: 'product-truth-linkedin', file: 'product-truth-linkedin.png', width: 1200, height: 627 },
  { id: 'product-truth-square', file: 'product-truth-square.png', width: 1200, height: 1200 },
  { id: 'product-truth-discord', file: 'product-truth-discord.png', width: 1200, height: 675 },
  { id: 'performance', file: 'performance.png', width: 1600, height: 900 },
  { id: 'stage-control', file: 'stage-control.png', width: 1600, height: 900 },
  { id: 'workflow', file: 'workflow.png', width: 1200, height: 675 },
  { id: 'stage-editorial', file: 'stage-editorial.png', width: 1200, height: 675 },
];

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') throw new Error('Invalid PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function verifyOutputs(directory) {
  for (const output of outputs) {
    const buffer = await fs.readFile(path.join(directory, output.file));
    const actual = pngDimensions(buffer);
    if (actual.width !== output.width || actual.height !== output.height) {
      throw new Error(`${output.file} is ${actual.width}x${actual.height}; expected ${output.width}x${output.height}`);
    }
  }
}

async function waitForServer(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The fixture has not bound the port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function captureInterface(browser, route, outputPath) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:4173/${route}/?scenario=marketing`, { waitUntil: 'domcontentloaded' });
  await page.getByText('MÚSICA 03', { exact: true }).first().waitFor();
  await page.screenshot({ path: outputPath });
  await page.close();
}

async function writeChecksums(directory) {
  const lines = [];
  for (const output of outputs) {
    const buffer = await fs.readFile(path.join(directory, output.file));
    lines.push(`${createHash('sha256').update(buffer).digest('hex').toUpperCase()}  ${output.file}`);
  }
  await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), `${lines.join('\r\n')}\r\n`, 'utf8');
}

if (checkOnly) {
  await verifyOutputs(siteMediaDir);
  process.stdout.write(`Verified ${outputs.length} media assets.\n`);
  process.exit(0);
}

await fs.mkdir(siteMediaDir, { recursive: true });
if (externalOutputDir) await fs.mkdir(externalOutputDir, { recursive: true });

const fixture = spawn(process.execPath, ['tests/ui/mock-stage-server.mjs'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
});

const browser = await chromium.launch({ headless: true });
try {
  await waitForServer('http://127.0.0.1:4173/__test__/state');
  await captureInterface(browser, 'performance', path.join(siteMediaDir, 'performance.png'));
  await captureInterface(browser, 'setlist', path.join(siteMediaDir, 'stage-control.png'));

  const performanceData = (await fs.readFile(path.join(siteMediaDir, 'performance.png'))).toString('base64');
  const stageControlData = (await fs.readFile(path.join(siteMediaDir, 'stage-control.png'))).toString('base64');
  const template = (await fs.readFile(templatePath, 'utf8'))
    .replaceAll('{{PERFORMANCE_DATA_URI}}', `data:image/png;base64,${performanceData}`)
    .replaceAll('{{STAGE_CONTROL_DATA_URI}}', `data:image/png;base64,${stageControlData}`);
  for (const output of outputs.filter((item) => !['performance', 'stage-control'].includes(item.id))) {
    const page = await browser.newPage({
      viewport: { width: output.width, height: output.height },
      deviceScaleFactor: 1,
    });
    await page.setContent(template, { waitUntil: 'load' });
    await page.addStyleTag({ content: `.artboard { display: none !important; } #${output.id} { display: block !important; }` });
    await page.screenshot({ path: path.join(siteMediaDir, output.file) });
    await page.close();
  }
  await verifyOutputs(siteMediaDir);

  if (externalOutputDir) {
    for (const output of outputs) {
      await fs.copyFile(path.join(siteMediaDir, output.file), path.join(externalOutputDir, output.file));
    }
    await writeChecksums(externalOutputDir);
  }

  process.stdout.write(`Rendered and verified ${outputs.length} media assets.\n`);
} finally {
  await browser.close();
  fixture.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => fixture.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
}
