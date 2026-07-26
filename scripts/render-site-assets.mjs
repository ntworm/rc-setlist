import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = path.join(root, 'docs');
const outputs = [
  { source: 'favicon.svg', target: 'favicon-32.png', width: 32, height: 32 },
  { source: 'favicon.svg', target: 'apple-touch-icon.png', width: 180, height: 180 },
  { source: 'og-image.svg', target: 'og-image.png', width: 1200, height: 630 },
];

const browser = await chromium.launch({ headless: true });
try {
  for (const output of outputs) {
    const svg = await fs.readFile(path.join(docs, output.source), 'utf8');
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: { width: output.width, height: output.height },
    });
    await page.setContent(`
      <!doctype html>
      <style>
        html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
        svg { display: block; width: 100%; height: 100%; }
      </style>
      ${svg}
    `);
    await page.locator('svg').screenshot({ path: path.join(docs, output.target) });
    await page.close();
    process.stdout.write(`Rendered docs/${output.target}\n`);
  }
} finally {
  await browser.close();
}
