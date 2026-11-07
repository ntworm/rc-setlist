import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteMediaDir = path.join(root, 'docs', 'media');
const templatePath = path.join(root, 'scripts', 'media-kit-template.html');
const outputArgIndex = process.argv.indexOf('--output-dir');
const externalOutputDir =
  outputArgIndex >= 0 ? path.resolve(process.argv[outputArgIndex + 1]) : null;
const checkOnly = process.argv.includes('--check');
const publicOnly = process.argv.includes('--public');
const locales = ['en', 'pt-BR'];

const outputs = [
  { id: 'product-truth-linkedin', file: 'product-truth-linkedin.png', width: 1200, height: 627 },
  { id: 'product-truth-square', file: 'product-truth-square.png', width: 1200, height: 1200 },
  { id: 'product-truth-discord', file: 'product-truth-discord.png', width: 1200, height: 675 },
  { id: 'performance', file: 'performance.png', width: 1600, height: 900 },
  { id: 'stage-control', file: 'stage-control.png', width: 1600, height: 900 },
  { id: 'performance-phone', file: 'performance-phone.png', width: 860, height: 1864 },
  { id: 'workflow', file: 'workflow.png', width: 1200, height: 675 },
  { id: 'stage-editorial', file: 'stage-editorial.png', width: 1200, height: 675 },
];
const publicOutputIds = new Set([
  'product-truth-discord',
  'performance',
  'stage-control',
  'performance-phone',
  'workflow',
  'stage-editorial',
]);

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG')
    throw new Error('Invalid PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function verifyOutputs(directory, expectedOutputs = outputs) {
  for (const output of expectedOutputs) {
    const buffer = await fs.readFile(path.join(directory, output.file));
    const actual = pngDimensions(buffer);
    if (actual.width !== output.width || actual.height !== output.height) {
      throw new Error(
        `${output.file} is ${actual.width}x${actual.height}; expected ${output.width}x${output.height}`,
      );
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

async function captureInterface(browser, route, outputPath, locale, device = {}) {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
    ...device,
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(
    ({ selectedLocale, fixedNow }) => {
      Object.defineProperty(performance, 'now', {
        configurable: true,
        value: () => fixedNow,
      });
      localStorage.setItem('rc-setlist.locale', selectedLocale);
    },
    { selectedLocale: locale, fixedNow: 1_000 },
  );
  await page.goto(`http://127.0.0.1:4173/${route}/?scenario=marketing`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByText('SONG 03', { exact: true }).first().waitFor();
  await page.screenshot({ path: outputPath, animations: 'disabled', caret: 'hide' });
  await page.close();
}

function localizeTemplate(template, locale) {
  const replacements =
    locale === 'pt-BR'
      ? new Map([
          [
            'Your Live Set.<br><span>Ready for the stage.</span>',
            'Seu Live Set.<br><span>Pronto para o palco.</span>',
          ],
          [
            'Setlist, guarded transport and synchronized lyrics — straight from Arrangement locators.',
            'Setlist, transporte protegido e letras sincronizadas — direto dos localizadores do Arrangement.',
          ],
          [
            'The real interface: songs and sections, guarded controls, show state and synchronized lyrics.',
            'A interface real: músicas e seções, controles protegidos, estado do show e letras sincronizadas.',
          ],
          ['PRODUCT TRUTH · v1.1.0 · LOCAL FIRST', 'PRODUTO REAL · v1.1.0 · LOCAL PRIMEIRO'],
          [
            'ONE .ABLX · NO ACCOUNT · NO TELEMETRY · v1.1.0',
            'UM .ABLX · SEM CONTA · SEM TELEMETRIA · v1.1.0',
          ],
          ['From locator<br><span>to stage.</span>', 'Do localizador<br><span>ao palco.</span>'],
          [
            'Run the set, follow every section and keep lyrics or chords visible in the browser.',
            'Rode o set, acompanhe cada seção e mantenha letras ou cifras visíveis no navegador.',
          ],
          [
            'UTILITY · WORKFLOW · ABLETON LIVE EXTENSION',
            'UTILIDADE · FLUXO · EXTENSÃO PARA ABLETON LIVE',
          ],
          ['Workflow · three steps', 'Fluxo · três etapas'],
          [
            'From locator<br><span>to performance.</span>',
            'Do localizador<br><span>à performance.</span>',
          ],
          ['01 · Live', '01 · Live'],
          ['Map the Arrangement', 'Mapeie o Arrangement'],
          ['02 · Operate', '02 · Operar'],
          ['Run the set', 'Rode o set'],
          [
            'Songs, sections, quantization, click, refresh and guarded transport.',
            'Músicas, seções, quantização, clique, refresh e transporte protegido.',
          ],
          ['03 · Stage', '03 · Palco'],
          ['Read the show', 'Acompanhe o show'],
          [
            'Current and next state, timecode, bar/beat, BPM/click and synchronized lyrics.',
            'Estado atual e seguinte, timecode, compasso, BPM/clique e letras sincronizadas.',
          ],
          ['Stage editorial', 'Editorial de palco'],
          [
            'Control the show.<br><span>Not the screen.</span>',
            'Controle o show.<br><span>Não a tela.</span>',
          ],
          [
            'One Live Set, two real interfaces: one to operate and one to keep the stage readable.',
            'Um Live Set, duas interfaces reais: uma para operar e outra para manter o palco legível.',
          ],
          ['LOCAL FIRST · BROWSER BASED · NO CLOUD', 'LOCAL PRIMEIRO · NO NAVEGADOR · SEM NUVEM'],
          ['Ableton Live extension', 'Extensão para Ableton Live'],
          [
            'Source-available · Ableton Live extension',
            'Código disponível · Extensão para Ableton Live',
          ],
          ['Locators → stage', 'Localizadores → palco'],
          [
            'Your Live Set,<br><span>ready for the stage.</span>',
            'Seu Live Set,<br><span>pronto para o palco.</span>',
          ],
          [
            'The running order, the section, the click and the lyrics, read from Arrangement locators.',
            'A ordem do show, a seção, o click e as letras, lidos dos localizadores do Arrangement.',
          ],
          ['Song 03 · now', 'Song 03 · agora'],
          [
            '<b>Stage Control</b> · the real page on a tablet, 900 × 592',
            '<b>Controle de palco</b> · a página real num tablet, 900 × 592',
          ],
          [
            'Independent · not affiliated with Ableton AG',
            'Independente · sem vínculo com a Ableton AG',
          ],
          [
            '<b>Stage Control</b> on a tablet · <b>Performance</b> on the mic stand',
            '<b>Controle de palco</b> no tablet · <b>Performance</b> no pedestal do microfone',
          ],
          ['One .ablx · no account · no telemetry', 'Um .ablx · sem conta · sem telemetria'],
          ['The stage screen', 'A tela do palco'],
          [
            'The band reads<br><span>the same show.</span>',
            'A banda lê<br><span>o mesmo show.</span>',
          ],
          [
            'Song, section, timecode, bar, BPM and the lyric line, large enough to read from the stage.',
            'Música, seção, timecode, compasso, BPM e a linha da letra, grandes para ler do palco.',
          ],
          ['Chorus · loop 2x', 'Chorus · loop 2x'],
          ['Bridge · next', 'Bridge · próxima'],
          [
            '<b>Performance</b> · the real page, 900 × 592',
            '<b>Performance</b> · a página real, 900 × 592',
          ],
          ['Local first · browser based · no cloud', 'Local primeiro · no navegador · sem nuvem'],
          ['Two real interfaces', 'Duas interfaces reais'],
          [
            '<b>Performance</b> · on stage and on the mic stand',
            '<b>Performance</b> · no palco e no pedestal do microfone',
          ],
          [
            '<b>Stage Control</b> · Performance Display',
            '<b>Controle de palco</b> · Performance Display',
          ],
          [
            '<b>Performance Display</b> · the stage screen',
            '<b>Performance Display</b> · a tela do palco',
          ],
          [
            '<b>Performance Display</b> · on stage and on the mic stand',
            '<b>Performance Display</b> · no palco e no pedestal do microfone',
          ],
        ])
      : new Map();
  // Prettier writes the line breaks of the template as <br />; the
  // translations are keyed on <br>.
  // Prettier also wraps long sentences; the translations are keyed on one
  // line, so runs of whitespace collapse everywhere except inside <pre>.
  const collapsed = template
    .split(/(<pre>[\s\S]*?<\/pre>)/)
    .map((part) => (part.startsWith('<pre>') ? part : part.replace(/\s*\n\s*/g, ' ')))
    .join('');
  let localized = collapsed
    .replaceAll('<br />', '<br>')
    .replace('<html lang="en">', `<html lang="${locale}">`);
  for (const [source, target] of replacements) localized = localized.replaceAll(source, target);
  return localized;
}

async function writeChecksums(directory) {
  const lines = [];
  for (const locale of locales) {
    for (const output of outputs) {
      const relative = path.join(locale, output.file);
      const buffer = await fs.readFile(path.join(directory, relative));
      lines.push(
        `${createHash('sha256').update(buffer).digest('hex').toUpperCase()}  ${relative.replaceAll('\\', '/')}`,
      );
    }
  }
  await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), `${lines.join('\r\n')}\r\n`, 'utf8');
}

if (checkOnly) {
  const expectedOutputs = publicOnly
    ? outputs.filter((output) => publicOutputIds.has(output.id))
    : outputs;
  for (const locale of locales) {
    await verifyOutputs(path.join(siteMediaDir, locale), expectedOutputs);
  }
  process.stdout.write(`Verified ${expectedOutputs.length * locales.length} media assets.\n`);
  process.exit(0);
}

await fs.mkdir(siteMediaDir, { recursive: true });
for (const locale of locales) {
  await fs.mkdir(path.join(siteMediaDir, locale), { recursive: true });
  if (externalOutputDir) await fs.mkdir(path.join(externalOutputDir, locale), { recursive: true });
}

const fixture = spawn(process.execPath, ['tests/ui/mock-stage-server.mjs'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
});

const browser = await chromium.launch({ headless: true });
try {
  await waitForServer('http://127.0.0.1:4173/__test__/state');
  const rawTemplate = await fs.readFile(templatePath, 'utf8');
  for (const locale of locales) {
    const localeDir = path.join(siteMediaDir, locale);
    // A 1080p screen, the usual stage display, stored at 1600 x 900.
    await captureInterface(
      browser,
      'performance',
      path.join(localeDir, 'performance.png'),
      locale,
      {
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1600 / 1920,
      },
    );
    await captureInterface(browser, 'setlist', path.join(localeDir, 'stage-control.png'), locale);
    // The phone the band reads from a mic stand: portrait, at twice the density
    // so the landing can show it at its real size without softening the type.
    await captureInterface(
      browser,
      'performance',
      path.join(localeDir, 'performance-phone.png'),
      locale,
      {
        viewport: { width: 430, height: 932 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    );

    // The compositions show the interface at its own size: a 900 x 592
    // capture at twice the density, cropped in the frame, so the type of the
    // product stays legible instead of shrinking with the whole screen.
    const closeUps = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-setlist-media-'));
    await captureInterface(browser, 'setlist', path.join(closeUps, 'stage.png'), locale, {
      viewport: { width: 900, height: 592 },
      deviceScaleFactor: 2,
    });
    await captureInterface(browser, 'performance', path.join(closeUps, 'performance.png'), locale, {
      viewport: { width: 900, height: 592 },
      deviceScaleFactor: 2,
    });
    const stageCloseUp = (await fs.readFile(path.join(closeUps, 'stage.png'))).toString('base64');
    const performanceCloseUp = (await fs.readFile(path.join(closeUps, 'performance.png'))).toString(
      'base64',
    );
    await fs.rm(closeUps, { recursive: true, force: true });
    const phoneData = (await fs.readFile(path.join(localeDir, 'performance-phone.png'))).toString(
      'base64',
    );
    const fontData = (
      await fs.readFile(path.join(root, 'static', 'fonts', 'MartianMono-latin.woff2'))
    ).toString('base64');
    const performanceData = (await fs.readFile(path.join(localeDir, 'performance.png'))).toString(
      'base64',
    );
    const stageControlData = (
      await fs.readFile(path.join(localeDir, 'stage-control.png'))
    ).toString('base64');
    const template = localizeTemplate(rawTemplate, locale)
      .replaceAll('{{PERFORMANCE_DATA_URI}}', `data:image/png;base64,${performanceData}`)
      .replaceAll('{{STAGE_CONTROL_DATA_URI}}', `data:image/png;base64,${stageControlData}`)
      .replaceAll('{{PHONE_DATA_URI}}', `data:image/png;base64,${phoneData}`)
      .replaceAll('{{STAGE_CLOSEUP_DATA_URI}}', `data:image/png;base64,${stageCloseUp}`)
      .replaceAll('{{PERFORMANCE_CLOSEUP_DATA_URI}}', `data:image/png;base64,${performanceCloseUp}`)
      .replaceAll('{{FONT_DATA_URI}}', `data:font/woff2;base64,${fontData}`);
    for (const output of outputs.filter(
      (item) => !['performance', 'stage-control', 'performance-phone'].includes(item.id),
    )) {
      const page = await browser.newPage({
        viewport: { width: output.width, height: output.height },
        deviceScaleFactor: 1,
      });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setContent(template, { waitUntil: 'load' });
      await page.addStyleTag({
        content: `.artboard { display: none !important; } #${output.id} { display: block !important; }`,
      });
      await page.screenshot({
        path: path.join(localeDir, output.file),
        animations: 'disabled',
        caret: 'hide',
      });
      await page.close();
    }
    await verifyOutputs(localeDir);

    if (externalOutputDir) {
      for (const output of outputs) {
        await fs.copyFile(
          path.join(localeDir, output.file),
          path.join(externalOutputDir, locale, output.file),
        );
      }
    }
  }
  if (externalOutputDir) await writeChecksums(externalOutputDir);

  process.stdout.write(`Rendered and verified ${outputs.length * locales.length} media assets.\n`);
} finally {
  await browser.close();
  fixture.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => fixture.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
}
