import { test } from 'node:test';
import assert from 'node:assert';
import { embedPanelAssets } from '../src/ui/panel-embed.ts';

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
