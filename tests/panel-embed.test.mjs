import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedPanelAssets, inlineFontAssets, stripFontFaces } from '../src/ui/panel-embed.ts';
import { PANEL_FONT_FILES, PANEL_SCRIPT_FILES } from '../src/ui/panel-assets.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('embedPanelAssets', async (t) => {
  const assets = { uiSystemCss: 'CSS', i18nJs: 'I18N', qrJs: 'QR' };

  await t.test('(a) <link ... />', () => {
    const html = `<link rel="stylesheet" href="../shared/ui-system.css" />
<script src="../shared/i18n.js"></script>
<script src="qrcode.js"></script>`;
    const out = embedPanelAssets(html, assets);
    assert.ok(out.includes('<style>CSS</style>'));
    assert.ok(!out.includes('<link'));
  });

  await t.test('(b) sem barra', () => {
    const html = `<link rel="stylesheet" href="../shared/ui-system.css">
<script src="../shared/i18n.js"></script>
<script src="qrcode.js"></script>`;
    const out = embedPanelAssets(html, assets);
    assert.ok(out.includes('<style>CSS</style>'));
  });

  await t.test('(c) as duas tags <script>', () => {
    const html = `<link rel="stylesheet" href="../shared/ui-system.css">
<script src="../shared/i18n.js"></script>
<script src="qrcode.js"></script>`;
    const out = embedPanelAssets(html, assets);
    assert.ok(out.includes('<script>I18N</script>'));
    assert.ok(out.includes('<script>QR</script>'));
  });

  await t.test('(d) saída não contém <link rel="stylesheet" nem <script src=', () => {
    const html = `<link rel="stylesheet" href="../shared/ui-system.css">
<script src="../shared/i18n.js"></script>
<script src="qrcode.js"></script>`;
    const out = embedPanelAssets(html, assets);
    assert.ok(!out.includes('<link rel="stylesheet"'));
    assert.ok(!out.includes('<script src='));
  });

  await t.test('(e) HTML sem a tag de CSS lança o erro', () => {
    const html = `
<script src="../shared/i18n.js"></script>
<script src="qrcode.js"></script>`;
    assert.throws(() => {
      embedPanelAssets(html, assets);
    }, /panel asset tag not found: ui-system\.css/);
  });
});

const panelHtml = `<link rel="stylesheet" href="../shared/ui-system.css" />
<link rel="stylesheet" href="panel.css" />
<script src="../shared/i18n.js"></script>
<script src="qrcode.js"></script>
${PANEL_SCRIPT_FILES.map((file) => `<script src="${file}"></script>`).join('\n')}`;

const panelAssets = {
  uiSystemCss: 'CSS',
  i18nJs: 'I18N',
  qrJs: 'QR',
  panelCss: 'PANEL-CSS',
  panelScripts: PANEL_SCRIPT_FILES.map((file) => ({ file, code: `CODE-${file}` })),
};

test('the panel travels inside the modal: every file of it is inlined', () => {
  const out = embedPanelAssets(panelHtml, panelAssets);
  assert.ok(!out.includes('<link rel="stylesheet"'));
  assert.ok(!out.includes('<script src='));
  assert.ok(out.includes('<style>PANEL-CSS</style>'));
  for (const file of PANEL_SCRIPT_FILES) {
    assert.ok(out.includes(`<script>CODE-${file}</script>`), `${file} must be inlined`);
  }
});

test('the panel is made of the scripts it loads', () => {
  assert.ok(PANEL_SCRIPT_FILES.includes('panel-shell.js'));
  assert.ok(PANEL_SCRIPT_FILES.includes('panel-main.js'));
  assert.ok(PANEL_SCRIPT_FILES.includes('panel-project.js'));
  assert.ok(PANEL_SCRIPT_FILES.includes('panel-network.js'));
});

test('no embedded script can close its element early', () => {
  const html = `<link rel="stylesheet" href="../shared/ui-system.css" />
<script src="../shared/i18n.js"></script>
<script src="qrcode.js"></script>`;
  const out = embedPanelAssets(html, {
    uiSystemCss: 'CSS',
    i18nJs: 'var a = "</script><b>i18n</b>";',
    qrJs: 'var b = "</SCRIPT>";',
  });
  assert.strictEqual((out.match(/<\/script>/gi) || []).length, 2);
  assert.ok(out.includes('"<\\/script><b>i18n</b>"'));
  assert.ok(out.includes('var b = "<\\/script>"'));
});

test('the stylesheet tag is matched by its exact name', () => {
  const html = `<link rel="stylesheet" href="../shared/ui-system.css" />
<link rel="stylesheet" href="panelXcss" />
<link rel="stylesheet" href="panel.css" />
<script src="../shared/i18n.js"></script>
<script src="qrcode.js"></script>`;
  const out = embedPanelAssets(html, {
    uiSystemCss: 'CSS',
    i18nJs: 'I18N',
    qrJs: 'QR',
    panelCss: 'PANEL',
  });
  assert.ok(out.includes('href="panelXcss"'));
  assert.ok(out.includes('<style>PANEL</style>'));
});

test('a script of the panel that is missing is an error, not a broken page', () => {
  assert.throws(
    () => embedPanelAssets(panelHtml, { ...panelAssets, panelScripts: [] }),
    /panel asset not found: panel-shell\.js/,
  );
});

test('the stylesheet of the panel that is missing is an error', () => {
  assert.throws(
    () => embedPanelAssets(panelHtml, { ...panelAssets, panelCss: undefined }),
    /panel asset not found: panel\.css/,
  );
});

test('the fonts of the panel travel as their bytes', () => {
  const css = PANEL_FONT_FILES.map(
    (file) =>
      `@font-face { font-family: 'Martian Mono'; src: url('../fonts/${file}') format('woff2'); }`,
  ).join('\n');
  const out = inlineFontAssets(
    css,
    PANEL_FONT_FILES.map((file) => ({ file, base64: 'AAA' })),
  );
  assert.ok(out.includes("url('data:font/woff2;base64,AAA')"));
  assert.ok(!out.includes('../fonts/'));
});

test('the font faces of the shared stylesheet are taken out of the modal', () => {
  const css =
    "@font-face { font-family: 'Inter'; src: url('../fonts/Inter.woff2'); }\nbody { color: red; }";
  const out = stripFontFaces(css);
  assert.ok(!out.includes('@font-face'));
  assert.ok(out.includes('body { color: red; }'));
});

test('the font the panel is written in travels with it', () => {
  for (const file of PANEL_FONT_FILES) {
    const fontPath = path.join(__dirname, '..', 'static', 'fonts', file);
    assert.ok(fs.existsSync(fontPath), `the font ${file} must be in the bundle`);
    assert.ok(fs.statSync(fontPath).size > 0);
  }
});

const panelDir = path.join(__dirname, '..', 'static', 'panel');
const readPanel = (file) => fs.readFileSync(path.join(panelDir, file), 'utf8');

test('every element the panel reaches for is in the markup', () => {
  const html = readPanel('index.html');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const known = new Set(ids);
  const scripts = PANEL_SCRIPT_FILES.map(readPanel).join('\n');
  const wanted = new Set([...scripts.matchAll(/\bel\('([^']+)'\)/g)].map((match) => match[1]));
  for (const id of wanted) {
    assert.ok(known.has(id), `the panel reaches for #${id}, which is not in the markup`);
  }
  for (const id of [
    'tabMain',
    'tabSetlist',
    'tabNetwork',
    'panelMain',
    'panelSetlist',
    'panelNetwork',
  ]) {
    assert.ok(known.has(id), `#${id} must be in the markup`);
  }
});

test('the markup holds no id twice', () => {
  const html = readPanel('index.html');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const repeated = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(repeated, []);
});

test('every word the panel asks for is in the dictionary', () => {
  const html = readPanel('index.html');
  const shell = readPanel('panel-shell.js');
  const scripts = PANEL_SCRIPT_FILES.map(readPanel).join('\n');
  const fromMarkup = [...html.matchAll(/data-rc-text(?:-aria)?="([^"]+)"/g)].map(
    (match) => match[1],
  );
  const fromScripts = [...scripts.matchAll(/shell\.text\('([^']+)'/g)].map((match) => match[1]);
  for (const key of [...fromMarkup, ...fromScripts]) {
    if (key.startsWith('panel.') || key.startsWith('common.')) continue;
    assert.ok(shell.includes(`'${key}':`), `the word ${key} must be in the dictionary`);
  }
});

test('the panel loads its files and nothing else', () => {
  const html = readPanel('index.html');
  assert.match(html, /href="panel\.css"/);
  for (const file of PANEL_SCRIPT_FILES) {
    assert.ok(html.includes(`src="${file}"`), `${file} must be loaded by the markup`);
  }
  assert.doesNotMatch(html, /<style(?:\s[^>]*)?>/i);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
});
