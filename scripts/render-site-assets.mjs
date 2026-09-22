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

// The page is loaded with setContent, so nothing relative resolves: the landing's
// own Martian Mono and every image the SVG points at are inlined as data URIs.
const fontData = (await fs.readFile(path.join(docs, 'fonts', 'MartianMono-latin.woff2'))).toString(
  'base64',
);

async function inlineImages(svg) {
  let result = svg;
  for (const [, href] of svg.matchAll(/href="((?:media|fonts)\/[^"]+\.png)"/g)) {
    const data = (await fs.readFile(path.join(docs, href))).toString('base64');
    result = result.replaceAll(`href="${href}"`, `href="data:image/png;base64,${data}"`);
  }
  return result;
}

const browser = await chromium.launch({ headless: true });
try {
  for (const output of outputs) {
    const svg = await inlineImages(await fs.readFile(path.join(docs, output.source), 'utf8'));
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: { width: output.width, height: output.height },
    });
    await page.setContent(`
      <!doctype html>
      <style>
        @font-face {
          font-family: 'Martian Mono';
          font-weight: 100 800;
          font-stretch: 75% 112.5%;
          src: url(data:font/woff2;base64,${fontData}) format('woff2');
        }
        html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
        svg { display: block; width: 100%; height: 100%; }
      </style>
      ${svg}
    `);
    await page.evaluate(async () => {
      await document.fonts.load("800 16px 'Martian Mono'");
      await document.fonts.ready;
    });
    await page
      .locator('svg')
      .first()
      .screenshot({ path: path.join(docs, output.target) });
    await page.close();
    process.stdout.write(`Rendered docs/${output.target}\n`);
  }
} finally {
  await browser.close();
}
