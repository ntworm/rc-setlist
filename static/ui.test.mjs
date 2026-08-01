import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('Static UI Lyrics Sync Regression: Song starting after beat zero', () => {
  const setlistHtmlPath = path.join(__dirname, 'setlist', 'index.html');
  const performanceHtmlPath = path.join(__dirname, 'performance', 'index.html');
  const timingJsPath = path.join(__dirname, 'shared', 'lyrics-timing.js');

  const setlistHtml = fs.readFileSync(setlistHtmlPath, 'utf8');
  const performanceHtml = fs.readFileSync(performanceHtmlPath, 'utf8');
  const timingJs = fs.readFileSync(timingJsPath, 'utf8');

  // Verify that both HTML pages load the shared library
  assert.ok(setlistHtml.includes('src="../shared/lyrics-timing.js"'), 'setlist/index.html must load shared/lyrics-timing.js');
  assert.ok(performanceHtml.includes('src="../shared/lyrics-timing.js"'), 'performance/index.html must load shared/lyrics-timing.js');

  // Load the shared logic using a sandbox function to get the functions
  const timingExports = {};
  const loadFunc = new Function('exports', timingJs + `
    exports.calculateSongElapsedBeats = calculateSongElapsedBeats;
    exports.convertBeatsToSeconds = convertBeatsToSeconds;
    exports.findActiveLyricLine = findActiveLyricLine;
  `);
  loadFunc(timingExports);

  const { calculateSongElapsedBeats, convertBeatsToSeconds, findActiveLyricLine } = timingExports;

  // Let's run behavioral timing regression tests
  // Song starts at beat 32.0, BPM = 120.0
  const activeSong = { time: 32.0 };
  const bpm = 120.0;

  const currentLyrics = {
    lines: [
      { time: 1.0, text: 'First line' },
      { time: 3.0, text: 'Second line' },
      { time: 5.0, text: 'Third line' }
    ]
  };

  // Case 1: before song starts (absolute beat 20.0)
  // elapsed beats = 0, time = 0s -> index = -1
  const elapsedBeats1 = calculateSongElapsedBeats(20.0, activeSong);
  assert.strictEqual(elapsedBeats1, 0.0);
  const elapsedSec1 = convertBeatsToSeconds(elapsedBeats1, bpm);
  assert.strictEqual(elapsedSec1, 0.0);
  assert.strictEqual(findActiveLyricLine(currentLyrics, elapsedSec1), -1);

  // Case 2: 8 beats after song starts (absolute beat 40.0)
  // elapsed beats = 8, time = 4.0s -> index = 1 ('Second line' at 3.0s)
  const elapsedBeats2 = calculateSongElapsedBeats(40.0, activeSong);
  assert.strictEqual(elapsedBeats2, 8.0);
  const elapsedSec2 = convertBeatsToSeconds(elapsedBeats2, bpm);
  assert.strictEqual(elapsedSec2, 4.0);
  assert.strictEqual(findActiveLyricLine(currentLyrics, elapsedSec2), 1);

  // Case 3: 3 beats after song starts (absolute beat 35.0)
  // elapsed beats = 3, time = 1.5s -> index = 0 ('First line' at 1.0s)
  const elapsedBeats3 = calculateSongElapsedBeats(35.0, activeSong);
  assert.strictEqual(elapsedBeats3, 3.0);
  const elapsedSec3 = convertBeatsToSeconds(elapsedBeats3, bpm);
  assert.strictEqual(elapsedSec3, 1.5);
  assert.strictEqual(findActiveLyricLine(currentLyrics, elapsedSec3), 0);
});

test('Static UI Lyrics Editor: preserves rounded LRC centiseconds', () => {
  const timingJsPath = path.join(__dirname, 'shared', 'lyrics-timing.js');
  const timingJs = fs.readFileSync(timingJsPath, 'utf8');
  const timingExports = {};
  const loadFunc = new Function('exports', timingJs + `
    exports.formatSecondsToLrcTime = formatSecondsToLrcTime;
  `);
  loadFunc(timingExports);

  const { formatSecondsToLrcTime } = timingExports;
  assert.strictEqual(formatSecondsToLrcTime(17.29), '[00:17.29]');
  assert.strictEqual(formatSecondsToLrcTime(42.83), '[00:42.83]');
  assert.strictEqual(formatSecondsToLrcTime(59.999), '[01:00.00]');
});

test('Static UI Performance: compact desktop layout prevents card overlap', () => {
  const performanceCssPath = path.join(__dirname, 'performance', 'performance.css');
  const performanceCss = fs.readFileSync(performanceCssPath, 'utf8');

  assert.match(
    performanceCss,
    /\.performance-page\.has-lyrics\s+\.stage-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,/s,
  );
  assert.match(
    performanceCss,
    /@media\s*\(max-width:\s*600px\)\s*and\s*\(orientation:\s*portrait\)/,
  );
  assert.match(
    performanceCss,
    /@media\s*\(max-height:\s*500px\)\s*and\s*\(orientation:\s*landscape\)/,
  );
});

test('Static UI Performance: loads external design/runtime assets and fullscreen control', () => {
  const performanceHtmlPath = path.join(__dirname, 'performance', 'index.html');
  const performanceHtml = fs.readFileSync(performanceHtmlPath, 'utf8');

  assert.match(performanceHtml, /href="\.\.\/shared\/ui-system\.css"/);
  assert.match(performanceHtml, /href="\.\/performance\.css"/);
  assert.match(performanceHtml, /src="\.\.\/shared\/stage-runtime\.js"/);
  assert.match(performanceHtml, /src="\.\/performance\.js"/);
  assert.match(performanceHtml, /id="fullscreenButton"/);
  assert.doesNotMatch(performanceHtml, /<style(?:\s[^>]*)?>/i);
  assert.doesNotMatch(performanceHtml, /<script(?![^>]*\bsrc=)[^>]*>/i);
});

test('Static UI Setlist: loads external design/runtime assets and fullscreen control', () => {
  const setlistHtmlPath = path.join(__dirname, 'setlist', 'index.html');
  const setlistHtml = fs.readFileSync(setlistHtmlPath, 'utf8');

  assert.match(setlistHtml, /href="\.\.\/shared\/ui-system\.css"/);
  assert.match(setlistHtml, /href="\.\/setlist\.css"/);
  assert.match(setlistHtml, /src="\.\.\/shared\/stage-runtime\.js"/);
  assert.match(setlistHtml, /src="\.\/setlist\.js"/);
  assert.match(setlistHtml, /id="fullscreenButton"/);
  assert.doesNotMatch(setlistHtml, /<style(?:\s[^>]*)?>/i);
  assert.doesNotMatch(setlistHtml, /<script(?![^>]*\bsrc=)[^>]*>/i);
});

test('Static UI Setlist: loads the safe transport runtime and dock controls', () => {
  const setlistHtml = fs.readFileSync(path.join(__dirname, 'setlist', 'index.html'), 'utf8');
  assert.match(setlistHtml, /src="\.\/transport-runtime\.js"/);
  assert.match(setlistHtml, /class="transport-dock"/);
  for (const id of ['btnPrevious', 'btnPlay', 'btnStop', 'btnNext']) {
    const block = setlistHtml.match(new RegExp(`<button[^>]*id="${id}"[\\s\\S]*?</button>`))?.[0];
    assert.ok(block, `${id} markup exists`);
    assert.match(block, /aria-label="[^"]+"/);
    assert.match(block, /<svg\b[^>]*aria-hidden="true"[^>]*>/);
    assert.equal(block.replace(/<[^>]+>/g, '').trim(), '');
  }
  assert.match(setlistHtml, /class="secondary-controls"/);
  assert.match(setlistHtml, /id="quantizationSelect"/);
});

test('Static UI Setlist: uses guarded controller storage and confirmed lyrics saves', () => {
  const setlistHtml = fs.readFileSync(path.join(__dirname, 'setlist', 'index.html'), 'utf8');
  const setlistJs = fs.readFileSync(path.join(__dirname, 'setlist', 'setlist.js'), 'utf8');
  const runtimeIndex = setlistHtml.indexOf('src="./controller-runtime.js"');
  const applicationIndex = setlistHtml.indexOf('src="./setlist.js"');

  assert.ok(runtimeIndex >= 0 && runtimeIndex < applicationIndex, 'controller runtime loads before setlist.js');
  assert.match(setlistJs, /readMidiMappings\(/);
  assert.match(setlistJs, /consumeControllerToken\(/);
  assert.match(setlistJs, /lyricsSaveTracker\.settle\(payload\)/);
  assert.match(setlistJs, /status === 'confirmed'[\s\S]*markLyricsDirty\(false\)/);
  assert.doesNotMatch(
    setlistJs,
    /JSON\.parse\(localStorage\.getItem\(['"]bridge_midi_mappings['"]\)\)/,
  );
});

test('Static UI Setlist: exposes duration metrics and complete profile controls', () => {
  const setlistHtml = fs.readFileSync(path.join(__dirname, 'setlist', 'index.html'), 'utf8');
  const setlistJs = fs.readFileSync(path.join(__dirname, 'setlist', 'setlist.js'), 'utf8');

  for (const marker of ['profileSelect', 'profileManageModal', 'totalSetlistDuration']) {
    assert.match(setlistHtml, new RegExp(`id="${marker}"`));
  }
  for (const marker of ['profile_delete', 'profile_restore', 'durationSeconds']) {
    assert.match(setlistJs, new RegExp(marker));
  }
  assert.match(setlistJs, /function profileRegistryFingerprint\(/);
  assert.match(setlistJs, /renameInput\.addEventListener\(['"]keydown['"]/);
  assert.match(setlistJs, /profileState = \{ \.\.\.profileState, canMutate: !lastState\.isPlaying \};\s*updateProfileMutationAvailability\(\);/);
});

test('Static UI: automation-only sections receive a localized visible label', () => {
  const setlistJs = fs.readFileSync(path.join(__dirname, 'setlist', 'setlist.js'), 'utf8');
  const performanceJs = fs.readFileSync(path.join(__dirname, 'performance', 'performance.js'), 'utf8');
  const i18nSource = fs.readFileSync(path.join(__dirname, 'shared', 'i18n.js'), 'utf8');

  assert.match(setlistJs, /automationOnly/);
  assert.match(performanceJs, /automationOnly/);
  assert.match(i18nSource, /setlist\.automationMarker/);
  assert.match(i18nSource, /Automation marker/);
  assert.match(i18nSource, /Marcador de automa/);
});

test('Static UI Panel: separates server status from actionable OSC diagnostics', () => {
  const panelHtml = fs.readFileSync(path.join(__dirname, 'panel', 'index.html'), 'utf8');
  const i18nSource = fs.readFileSync(path.join(__dirname, 'shared', 'i18n.js'), 'utf8');

  for (const marker of ['oscStatusDot', 'oscStatusText', 'btnDiagnoseOsc']) {
    assert.match(panelHtml, new RegExp(`id="${marker}"`));
  }
  for (const state of ['stopped', 'port-conflict', 'no-reply', 'responding', 'stale']) {
    assert.match(panelHtml, new RegExp(`['"]${state}['"]`));
  }
  assert.match(panelHtml, /diagnose-osc/);
  assert.doesNotMatch(panelHtml, /certificate-notice|oscInstallHint/);
  assert.doesNotMatch(panelHtml, /ERR_CERT_AUTHORITY_INVALID|User Remote Scripts/);
  assert.doesNotMatch(panelHtml, /id="statusText"[^>]*data-i18n=/);
  assert.match(i18nSource, /User Library\/Remote Scripts\/AbletonOSC/);
  assert.match(i18nSource, /User Remote Scripts/);
  assert.match(i18nSource, /Check OSC/);
  assert.match(i18nSource, /Verificar OSC/);
});

test('Static UI Setlist: omits handlers for controls removed from the operator surface', () => {
  const setlistJsPath = path.join(__dirname, 'setlist', 'setlist.js');
  const setlistJs = fs.readFileSync(setlistJsPath, 'utf8');

  assert.doesNotMatch(setlistJs, /function\s+requestClickPreview\b/);
  assert.doesNotMatch(setlistJs, /function\s+handleClickPreviewReady\b/);
  assert.doesNotMatch(setlistJs, /function\s+createTestSessionInAbleton\b/);
  assert.doesNotMatch(setlistJs, /payload\.type\s*===\s*['"]click_preview_ready['"]/);
});

test('Static UI: product surfaces expose English and Brazilian Portuguese', () => {
  const panelHtml = fs.readFileSync(path.join(__dirname, 'panel', 'index.html'), 'utf8');
  const setlistHtml = fs.readFileSync(path.join(__dirname, 'setlist', 'index.html'), 'utf8');
  const performanceHtml = fs.readFileSync(path.join(__dirname, 'performance', 'index.html'), 'utf8');
  const i18nSource = fs.readFileSync(path.join(__dirname, 'shared', 'i18n.js'), 'utf8');

  assert.match(i18nSource, /SUPPORTED_LOCALES/);
  assert.match(i18nSource, /['"]pt-BR['"]/);
  assert.match(i18nSource, /Current song/);
  assert.match(i18nSource, /Música atual/);
  assert.match(i18nSource, /Stage Control/);
  assert.match(i18nSource, /Controle de palco/);

  for (const html of [panelHtml, performanceHtml, setlistHtml]) {
    assert.match(html, /id="languageSelect"/);
    assert.match(html, /src="\.\.\/shared\/i18n\.js"/);
  }
});
