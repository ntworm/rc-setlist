import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function readRequired(path) {
  const url = new URL(`../${path}`, import.meta.url);
  assert.ok(existsSync(url), `${path} must exist`);
  return readFileSync(url, 'utf8');
}

test('public landing presents Ableton RC Setlist as source-available and noncommercial', () => {
  const landing = read('docs/index.html');

  assert.match(landing, /<title>Ableton RC Setlist\b/);
  assert.match(landing, /source-available/i);
  assert.match(landing, /PolyForm Noncommercial 1\.0\.0/i);
  assert.match(landing, /independent project.+not affiliated with or endorsed by Ableton AG/is);
  assert.match(landing, /https:\/\/ntworm\.github\.io\/rc-setlist\//i);
  assert.match(landing, /Release 0\.5\.1/);
  assert.match(landing, /id=["']languageSelect["']/);
  assert.doesNotMatch(landing, /Release candidate/i);
  assert.doesNotMatch(landing, /commercial distribution is in preparation|private beta|sales open/i);
  assert.doesNotMatch(landing, /fonts\.googleapis\.com|fonts\.gstatic\.com|google-analytics|googletagmanager/i);
  assert.match(
    landing,
    /@font-face\s*\{[^}]*font-family:\s*["']Inter["'][^}]*src:\s*url\(["']?\.\/fonts\/InterVariable\.woff2["']?\)/is,
    'the landing must self-host its deterministic Inter webfont',
  );
  assert.ok(existsSync(new URL('../docs/fonts/InterVariable.woff2', import.meta.url)));
  assert.ok(existsSync(new URL('../docs/fonts/OFL.txt', import.meta.url)));
});

test('current 0.5.1 notice and media-kit surfaces do not retain 0.5.0 labels', () => {
  for (const file of [
    'NOTICE',
    'docs/og-image.svg',
    'scripts/media-kit-template.html',
    'scripts/render-media-kit.mjs',
  ]) {
    const content = readRequired(file);
    assert.match(content, /0\.5\.1/, `${file} must identify the current 0.5.1 release`);
    assert.doesNotMatch(content, /0\.5\.0/, `${file} must not retain a 0.5.0 current-release label`);
  }
});

test('public documentation uses the official compatibility floor', () => {
  for (const path of ['README.md', 'docs/INSTALL.md', 'docs/DEVELOPMENT.md']) {
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `${path} must exist`);
    const content = read(path);
    assert.match(content, /Ableton Live 12\.4\.5\+ Suite \(Beta\)/i, `${path} must state the Live floor`);
    assert.match(content, /Node(?:\.js)? 24\.16\.0/i, `${path} must state the development Node floor`);
  }
});

test('public documentation describes external AbletonOSC without bundling it', () => {
  const readme = readRequired('README.md');
  const install = readRequired('docs/INSTALL.md');

  for (const [label, content] of [['README', readme], ['install guide', install]]) {
    assert.match(content, /github\.com\/ideoforms\/AbletonOSC/i, `${label} must link upstream AbletonOSC`);
    assert.doesNotMatch(content, /bundled.+AbletonOSC|vendor\/AbletonOSC/i, `${label} must not claim AbletonOSC is bundled`);
  }
});

test('user guides define the stopped-play one-bar count-in safety contract', () => {
  const english = readRequired('docs/USER-GUIDE.md');
  const portuguese = readRequired('docs/pt-BR/USER-GUIDE.md');
  const tester = readRequired('docs/TESTER-GUIDE.md');
  const changelog = readRequired('CHANGELOG.md');

  assert.match(english, /COUNT-IN 1 BAR[\s\S]*one bar[\s\S]*transport is stopped/i);
  assert.match(english, /Live(?:'s)? native metronome[\s\S]*does not (?:enter )?Record[\s\S]*arm tracks/i);
  assert.match(english, /does not change[\s\S]*jump quantization/i);

  assert.match(portuguese, /CONTAGEM 1 COMP[\s\S]*um compasso[\s\S]*transporte est[aá] parado/i);
  assert.match(portuguese, /metr[oô]nomo nativo do Live[\s\S]*n[aã]o entra em Record[\s\S]*n[aã]o arma pistas/i);
  assert.match(portuguese, /n[aã]o\s+altera[\s\S]*quantiza[cç][aã]o dos saltos/i);

  for (const marker of ['Click off', 'Click on', 'beat zero', 'Stop', 'manual Click', 'already playing']) {
    assert.match(tester, new RegExp(marker, 'i'), `tester guide must cover ${marker}`);
  }
  assert.match(changelog, /\[ws\][^\n]*preRollEnabled[^\n]*protocolVersion 3/i);
});

test('installation and troubleshooting guides prevent the AbletonOSC folder mix-up', () => {
  for (const path of [
    'docs/INSTALL.md',
    'docs/TROUBLESHOOTING.md',
    'docs/pt-BR/INSTALL.md',
    'docs/pt-BR/TROUBLESHOOTING.md',
  ]) {
    const content = readRequired(path);
    assert.match(content, /User Library[\\/]Remote Scripts[\\/]AbletonOSC/i, `${path} must show the exact install target`);
    assert.match(content, /User Remote Scripts/i, `${path} must distinguish Live's hidden preferences folder`);
    assert.match(content, /AbletonOSC[\\/]__init__\.py/i, `${path} must show how to detect an extra nested folder`);
  }
});

test('troubleshooting explains the fixed OSC return-port conflict outside the Live panel', () => {
  for (const path of ['docs/TROUBLESHOOTING.md', 'docs/pt-BR/TROUBLESHOOTING.md']) {
    const content = readRequired(path);
    assert.match(content, /UDP 11101|porta 11101/i, `${path} must identify the fallback listener symptom`);
    assert.match(content, /another\s+RC\s+extension|outra\s+extens[aã]o\s+RC/i, `${path} must identify the competing RC extension`);
    assert.match(content, /only one|apenas uma/i, `${path} must recommend one OSC auto-start owner`);
  }
});

test('public docs contain the required user, contributor, privacy and security pages', () => {
  const required = [
    'docs/README.md',
    'docs/INSTALL.md',
    'docs/USER-GUIDE.md',
    'docs/TESTER-GUIDE.md',
    'docs/DEVELOPMENT.md',
    'docs/FAQ.md',
    'docs/TROUBLESHOOTING.md',
    'PRIVACY.md',
    'SECURITY.md',
    'CONTRIBUTING.md',
    'CODE_OF_CONDUCT.md',
    'SUPPORT.md',
    'CHANGELOG.md',
    'LICENSE',
    'NOTICE',
    'THIRD_PARTY_NOTICES.md',
    'docs/pt-BR/README.md',
    'docs/pt-BR/INSTALL.md',
    'docs/pt-BR/USER-GUIDE.md',
    'docs/pt-BR/TROUBLESHOOTING.md',
    'docs/pt-BR/FAQ.md',
    'docs/RELEASE-NOTES-0.4.1.md',
    'docs/pt-BR/NOTAS-DA-VERSAO-0.4.1.md',
    'docs/RELEASE-NOTES-0.4.2.md',
    'docs/pt-BR/NOTAS-DA-VERSAO-0.4.2.md',
    'docs/RELEASE-NOTES-0.5.1.md',
    'docs/pt-BR/NOTAS-DA-VERSAO-0.5.1.md',
  ];

  for (const path of required) {
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `${path} must exist`);
  }
});

test('0.4.2 local test notes remain preserved as the historical candidate', () => {
  const changelog = readRequired('CHANGELOG.md');
  const englishNotes = readRequired('docs/RELEASE-NOTES-0.4.2.md');
  const portugueseNotes = readRequired('docs/pt-BR/NOTAS-DA-VERSAO-0.4.2.md');

  assert.match(changelog, /^## \[0\.4\.2\] - 2026-08-01/m);
  assert.match(changelog, />\s+Section|relative section/i);
  assert.match(changelog, /\[ignore\]/i);
  assert.match(changelog, /local test candidate|candidato local de teste/i);

  assert.match(englishNotes, /local test candidate[\s\S]*not (?:a )?published release/i);
  assert.match(englishNotes, />\s+Section[\s\S]*\[ignore\][\s\S]*visual/i);
  assert.match(englishNotes, /pt-BR\/NOTAS-DA-VERSAO-0\.4\.2\.md/);
  assert.match(portugueseNotes, /candidato local de teste[\s\S]*n[aã]o [ée] uma vers[aã]o publicada/i);
  assert.match(portugueseNotes, />\s+Se[cç][aã]o[\s\S]*\[ignore\][\s\S]*visual/i);
  assert.match(portugueseNotes, /\.\.\/RELEASE-NOTES-0\.4\.2\.md/);

});

test('0.5.1 final notes are bilingual and describe the verified release surface', () => {
  const changelog = readRequired('CHANGELOG.md');
  const englishNotes = readRequired('docs/RELEASE-NOTES-0.5.1.md');
  const portugueseNotes = readRequired('docs/pt-BR/NOTAS-DA-VERSAO-0.5.1.md');
  const landing = readRequired('docs/index.html');
  const readme = readRequired('README.md');

  assert.match(changelog, /^## \[0\.5\.0\] - 2026-08-01/m);
  assert.match(changelog, />\s+Section|relative section/i);
  assert.match(changelog, /\[ignore\]/i);
  assert.match(changelog, /sections_count[\s\S]*automations/i);

  assert.match(englishNotes, /Keyboard[\s\S]*Mapping/i);
  assert.match(englishNotes, /Count-in[\s\S]*Pre-roll/i);
  assert.match(englishNotes, /previous[\s\S]*next[\s\S]*song/i);
  assert.match(englishNotes, /insertion[\s\S]*(?:target|line|preview)/i);
  assert.doesNotMatch(englishNotes, /bulletproof|guaranteed|maximum reliability/i);
  assert.match(englishNotes, /pt-BR\/NOTAS-DA-VERSAO-0\.5\.1\.md/);
  assert.match(portugueseNotes, /Keyboard[\s\S]*Mapping/i);
  assert.match(portugueseNotes, /Count-in[\s\S]*pre-roll/i);
  assert.match(portugueseNotes, /música anterior[\s\S]*próxima música/i);
  assert.match(portugueseNotes, /inserção[\s\S]*(?:alvo|linha|prévia)/i);
  assert.doesNotMatch(portugueseNotes, /à prova de falhas|garantid[ao]|máxima confiabilidade/i);
  assert.match(portugueseNotes, /\.\.\/RELEASE-NOTES-0\.5\.1\.md/);

  assert.match(landing, /Release 0\.5\.1/);
  assert.match(landing, /RELEASE-NOTES-0\.5\.1\.md/);
  assert.match(readme, /Ableton-RC-Setlist-0\.5\.1\.ablx/);
  assert.match(readme, /docs\/RELEASE-NOTES-0\.5\.1\.md/);
});

test('README and 0.5.1 notes describe only channel-specific Note On and Control Change MIDI', () => {
  const surfaces = [
    ['README.md', readRequired('README.md'), /channel[-\s]specific|specific channel|configured channel|same channel/i, /view actions/i],
    ['docs/RELEASE-NOTES-0.5.1.md', readRequired('docs/RELEASE-NOTES-0.5.1.md'), /channel[-\s]specific|specific channel|configured channel|same channel/i, /view actions/i],
    ['docs/pt-BR/NOTAS-DA-VERSAO-0.5.1.md', readRequired('docs/pt-BR/NOTAS-DA-VERSAO-0.5.1.md'), /canal\s+(?:espec[ií]fic[oa]|configurado|selecionado)|mesmo canal/i, /a[cç][oõ]es[^.\r\n]{0,40}visualiza[cç][aã]o/i],
  ];

  for (const [file, content, channelPattern, genericViewPattern] of surfaces) {
    assert.match(content, /Note On/i, `${file} must name Note On support`);
    assert.match(content, /Control Change/i, `${file} must name Control Change support`);
    assert.match(content, channelPattern, `${file} must describe channel-specific matching`);
    assert.doesNotMatch(content, /Program[-\s]Change/i, `${file} must not claim Program Change support`);
    assert.doesNotMatch(content, /any[-\s]channel|qualquer canal/i, `${file} must not claim any-channel matching`);
    assert.doesNotMatch(content, genericViewPattern, `${file} must not describe mappings as generic view actions`);
  }
});

test('English and PT-BR user guides explain both mapping modals and list nine Stage Control actions', () => {
  const guides = [
    {
      file: 'docs/USER-GUIDE.md',
      content: readRequired('docs/USER-GUIDE.md'),
      keyboardTitle: /Keyboard Mapping/i,
      midiTitle: /MIDI Mapping/i,
      instruction: /(?:open|select|press|click|use)\b[^\r\n]*(?:Keyboard Mapping|MIDI Mapping|Map)\b/i,
      stageTitle: /Stage Control/i,
      actions: [
        /\b(?:Play|Start Playback)\b/i,
        /\b(?:Stop|Stop Playback)\b/i,
        /Previous Song/i,
        /Next Song/i,
        /Previous Section/i,
        /Next Section/i,
        /Toggle Click/i,
        /Toggle Panel Lock/i,
        /Toggle Count[- ]In(?: Bar)?/i,
      ],
    },
    {
      file: 'docs/pt-BR/USER-GUIDE.md',
      content: readRequired('docs/pt-BR/USER-GUIDE.md'),
      keyboardTitle: /Mapeamento de Teclado|Keyboard Mapping/i,
      midiTitle: /Mapeamento MIDI|MIDI Mapping/i,
      instruction: /(?:abra|selecione|pressione|clique|use)\b[^\r\n]*(?:Mapeamento|Mapear|MIDI|teclado)/i,
      stageTitle: /Controle de Palco|Stage Control/i,
      actions: [
        /\b(?:Play|Iniciar reprodu[cç][aã]o)\b/i,
        /\b(?:Stop|Parar reprodu[cç][aã]o)\b/i,
        /M[uú]sica anterior/i,
        /Pr[oó]xima m[uú]sica/i,
        /Se[cç][aã]o anterior/i,
        /Pr[oó]xima se[cç][aã]o/i,
        /Alternar clique/i,
        /Alternar bloqueio do painel/i,
        /Alternar (?:compasso de )?contagem/i,
      ],
    },
  ];

  for (const guide of guides) {
    assert.match(guide.content, guide.stageTitle, `${guide.file} must identify Stage Control`);
    assert.match(guide.content, guide.keyboardTitle, `${guide.file} must explain Keyboard Mapping`);
    assert.match(guide.content, guide.midiTitle, `${guide.file} must explain MIDI Mapping`);
    assert.match(guide.content, guide.instruction, `${guide.file} must explain how to open or use mappings`);
    for (const action of guide.actions) {
      assert.match(guide.content, action, `${guide.file} must list all nine Stage Control actions`);
    }
  }
});

test('user guides document browser-local mapping persistence and exact MIDI channel behavior', () => {
  const guides = [
    ['docs/USER-GUIDE.md', readRequired('docs/USER-GUIDE.md'), /mappings?[\s\S]{0,120}(?:browser|local storage)|(?:browser|local storage)[\s\S]{0,120}mappings?|localStorage/i, /channel[-\s]specific|specific channel|configured channel|same channel/i],
    ['docs/pt-BR/USER-GUIDE.md', readRequired('docs/pt-BR/USER-GUIDE.md'), /mapeamentos?[\s\S]{0,120}(?:navegador|armazenamento local)|(?:navegador|armazenamento local)[\s\S]{0,120}mapeamentos?|localStorage/i, /canal\s+(?:espec[ií]fic[oa]|configurado|selecionado)|mesmo canal/i],
  ];

  for (const [file, content, persistencePattern, channelPattern] of guides) {
    assert.match(content, persistencePattern, `${file} must state that mappings persist in the browser locally`);
    assert.match(content, /Note On/i, `${file} must document Note On`);
    assert.match(content, /Control Change/i, `${file} must document Control Change`);
    assert.match(content, channelPattern, `${file} must state exact MIDI channel behavior`);
  }
});

test('user guides distinguish outer song arrows from inner section arrows and require a 500 ms hold', () => {
  const guides = [
    ['docs/USER-GUIDE.md', readRequired('docs/USER-GUIDE.md'), /outer[\s\S]{0,120}song|song[\s\S]{0,120}outer/i, /inner[\s\S]{0,120}section|section[\s\S]{0,120}inner/i],
    ['docs/pt-BR/USER-GUIDE.md', readRequired('docs/pt-BR/USER-GUIDE.md'), /setas externas[\s\S]{0,120}m[uú]sic|m[uú]sic[\s\S]{0,120}setas externas/i, /setas internas[\s\S]{0,120}se[cç][aã]o|se[cç][aã]o[\s\S]{0,120}setas internas/i],
  ];

  for (const [file, content, outerSongPattern, innerSectionPattern] of guides) {
    assert.match(content, outerSongPattern, `${file} must distinguish outer song arrows`);
    assert.match(content, innerSectionPattern, `${file} must distinguish inner section arrows`);
    assert.match(content, /500\s*ms/i, `${file} must state the 500 ms hold`);
  }
});

test('current landing copy and bilingual FAQ identify release 0.5.1', () => {
  const landing = readRequired('docs/index.html');
  const landingTranslations = readRequired('docs/site-i18n.js');
  assert.match(landing, /0\.5\.1/);
  assert.doesNotMatch(landing, /0\.5\.0/, 'landing HTML must not describe the current release as 0.5.0');
  assert.match(landingTranslations, /0\.5\.1/);
  assert.doesNotMatch(landingTranslations, /0\.5\.0/, 'localized landing copy must not describe the current release as 0.5.0');

  for (const file of ['docs/FAQ.md', 'docs/pt-BR/FAQ.md']) {
    const content = readRequired(file);
    assert.match(content, /0\.5\.1/, `${file} must identify the current release as 0.5.1`);
    assert.doesNotMatch(content, /0\.5\.0/, `${file} must not identify the current release as 0.5.0`);
  }
});

test('0.4.1 guides and changelog document durations, recoverable profiles and WebSocket compatibility', () => {
  const englishGuide = read('docs/USER-GUIDE.md');
  const portugueseGuide = read('docs/pt-BR/USER-GUIDE.md');
  const changelog = read('CHANGELOG.md');

  assert.match(englishGuide, /song duration[\s\S]*total setlist duration/i);
  assert.match(englishGuide, /recoverable trash[\s\S]*restore/i);
  assert.match(englishGuide, /transport (?:must be|is) stopped/i);
  assert.match(portugueseGuide, /duração de cada música[\s\S]*duração total do setlist/i);
  assert.match(portugueseGuide, /lixeira recuperável[\s\S]*restaur/i);
  assert.match(portugueseGuide, /transporte (?:deve estar|está)\s+parado/i);

  assert.match(changelog, /\[ws\][^\n]*profiles_state[^\n]*version 2/i);
  assert.match(changelog, /\[ws\][^\n]*(?:durationSeconds|totalDurationSeconds)[^\n]*optional/i);
});

test('0.4.1 guides document current-Live-Set profile scope and the PT-BR rehearsal recipe', () => {
  const englishGuide = readRequired('docs/USER-GUIDE.md');
  const portugueseGuide = readRequired('docs/pt-BR/USER-GUIDE.md');
  const portugueseChecklist = readRequired('release-template/pt-BR/TEST-CHECKLIST.md');
  const changelog = readRequired('CHANGELOG.md');

  assert.match(englishGuide, /current Live Set[\s\S]*multiple\s+setlists/i);
  assert.match(portugueseGuide, /Live Set atual[\s\S]*v[aá]rios\s+setlists/i);
  for (const marker of ['TESTE 01', '[loop 2x]', '[stop]', 'TESTE 01B']) {
    assert.ok(portugueseChecklist.includes(marker), `PT-BR checklist must include ${marker}`);
  }
  assert.match(portugueseChecklist, /criar[\s\S]*selecionar[\s\S]*renomear[\s\S]*excluir[\s\S]*restaurar/i);
  assert.match(changelog, /current Live Set|Live Set atual/i);
  assert.match(changelog, /mobile[\s\S]*rename|rename[\s\S]*mobile/i);
});

test('0.4.1 troubleshooting documents OSC return-port fallback and safe data recovery', () => {
  const english = readRequired('docs/TROUBLESHOOTING.md');
  const portuguese = readRequired('docs/pt-BR/TROUBLESHOOTING.md');
  const changelog = readRequired('CHANGELOG.md');

  assert.match(english, /MCP fallback[\s\S]*Total Duration[\s\S]*requested quantization/i);
  assert.match(english, /temporary project scope[\s\S]*Second Setlist[\s\S]*without deleting/i);
  assert.match(portuguese, /fallback MCP[\s\S]*dura/i);
  assert.match(portuguese, /escopo tempor[\s\S]*Second Setlist[\s\S]*sem apagar/i);
  assert.match(changelog, /quantization[\s\S]*MCP[\s\S]*temporary project scope/i);
});

test('0.4.1 release notes remain preserved, bilingual and describe the tested release', () => {
  const changelog = readRequired('CHANGELOG.md');
  const readme = readRequired('README.md');
  const englishNotes = readRequired('docs/RELEASE-NOTES-0.4.1.md');
  const portugueseNotes = readRequired('docs/pt-BR/NOTAS-DA-VERSAO-0.4.1.md');

  assert.match(changelog, /^## \[0\.4\.1\] - 2026-07-29/m);
  assert.ok(changelog.indexOf('## [0.4.1]') < changelog.indexOf('## [0.4.0]'));
  assert.match(englishNotes, /pt-BR\/NOTAS-DA-VERSAO-0\.4\.1\.md/);
  assert.match(portugueseNotes, /\.\.\/RELEASE-NOTES-0\.4\.1\.md/);
  assert.match(englishNotes, /setlist duration[\s\S]*Manage Setlists[\s\S]*lyrics[\s\S]*bar display/i);
  assert.match(portugueseNotes, /dura[cç][aã]o total[\s\S]*Gerenciar setlists[\s\S]*letras[\s\S]*compasso/i);
  assert.match(readme, /\[Landing page\]\(https:\/\/ntworm\.github\.io\/rc-setlist\/\)/);
  assert.doesNotMatch(readme, /!\[[^\]]*\]\(docs\/media\/[^)]+\)/i);
});

test('README is text-first and inventories the operator control surfaces', () => {
  const readme = readRequired('README.md');

  for (const feature of [
    /Keyboard Mapping/i,
    /MIDI Mapping/i,
    /previous and next song|adjacent-song navigation/i,
    /insertion (?:target|line|preview)/i,
    /saved setlists.+current Ableton\s+Live Set/is,
    /\.lrc.+lyrics/is,
    /CSV export/i,
    /Screen Wake Lock/i,
    /No account, cloud sync, analytics or telemetry/i,
  ]) {
    assert.match(readme, feature);
  }

  assert.match(readme, /trusted LAN[\s\S]*port `4444`/i);
  assert.doesNotMatch(readme, /!\[[^\]]*\]\(docs\/media\/[^)]+\)/i);
});

test('public landing contains truthful site media and keeps the owner media kit private', () => {
  const required = [
    'docs/media/en/product-truth-discord.png',
    'docs/media/en/performance.png',
    'docs/media/en/stage-control.png',
    'docs/media/en/workflow.png',
    'docs/media/en/stage-editorial.png',
    'docs/media/pt-BR/product-truth-discord.png',
    'docs/media/pt-BR/performance.png',
    'docs/media/pt-BR/stage-control.png',
    'docs/media/pt-BR/workflow.png',
    'docs/media/pt-BR/stage-editorial.png',
  ];

  for (const path of required) {
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `${path} must exist`);
  }

  const landing = read('docs/index.html');
  const allowlist = read('public-files.txt');
  assert.doesNotMatch(landing, /href=["']\.\/media-kit\.html["']/i);
  assert.doesNotMatch(landing, /Need artwork for a post or community listing\?/i);
  for (const privatePath of [
    'docs/media/',
    'docs/media-kit.html',
    'docs/media/product-truth-linkedin.png',
    'docs/media/product-truth-square.png',
  ]) {
    assert.doesNotMatch(allowlist, new RegExp(`^${privatePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  }
});

test('Dependabot keeps TypeScript and Node types on the supported major release line', () => {
  const dependabot = read('.github/dependabot.yml');
  for (const dependency of ['typescript', '@types/node']) {
    const escaped = dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      dependabot,
      new RegExp(`dependency-name:\\s*["']?${escaped}["']?[\\s\\S]*?update-types:[\\s\\S]*?version-update:semver-major`),
      `${dependency} must ignore semver-major Dependabot updates`,
    );
  }
});

test('public media verification excludes owner-only social cards', () => {
  const packageJson = JSON.parse(read('package.json'));
  const publicCheck = packageJson.scripts['media:check'];
  const ownerCheck = packageJson.scripts['media:check:owner'];
  const publicGate = packageJson.scripts['ci:public'];
  const renderer = read('scripts/render-media-kit.mjs');

  assert.match(publicCheck, /--check\s+--public/);
  assert.match(ownerCheck, /--check/);
  assert.doesNotMatch(ownerCheck, /--public/);
  assert.match(publicGate, /media:check/);
  assert.match(renderer, /publicOutputIds/);
  assert.match(renderer, /process\.argv\.includes\(['"]--public['"]\)/);
});

test('media captures stabilize the browser clock and motion', () => {
  const renderer = read('scripts/render-media-kit.mjs');
  assert.match(renderer, /Object\.defineProperty\(performance,\s*['"]now['"]/);
  assert.match(renderer, /emulateMedia\(\{\s*reducedMotion:\s*['"]reduce['"]/);
});

test('the public CI gate includes browser and release-surface regressions', () => {
  const packageJson = JSON.parse(read('package.json'));
  const publicGate = packageJson.scripts['ci:public'];
  const workflow = read('.github/workflows/ci.yml');
  assert.equal(typeof publicGate, 'string', 'package.json must define ci:public');
  assert.match(publicGate, /test:ui/);
  assert.match(publicGate, /test:release-surface/);
  assert.match(workflow, /actions\/checkout@v7/);
  assert.match(workflow, /actions\/setup-node@v7/);
});

test('production build cleans generated output and enables minification', () => {
  const build = read('scripts/build.ts');
  assert.match(build, /rmSync\([^\n]+recursive:\s*true[^\n]+force:\s*true/);
  assert.match(build, /minify:\s*production/);
});

test('public Markdown and HTML have no broken local links', () => {
  const result = spawnSync(process.execPath, ['scripts/check-doc-links.mjs'], {
    cwd: new URL('../', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('documentation and guides explain relative locators, ignore tag, Manage Setlists and CSV downloads', () => {
  for (const path of ['docs/USER-GUIDE.md', 'docs/pt-BR/USER-GUIDE.md']) {
    const content = readRequired(path);
    assert.match(content, /> Se[çc][ãa]o|> Section/i, `${path} must document relative locator syntax`);
    assert.match(content, /\[ignore\]/i, `${path} must document ignore tag`);
    assert.match(content, /Manage Setlists|Gerenciar setlists/i, `${path} must document Manage Setlists discovery`);
    assert.match(content, /Downloads/i, `${path} must document browser Downloads location for CSV`);
    assert.match(content, /sections_count/i, `${path} must document named-section CSV data`);
    assert.match(content, /automations/i, `${path} must document automation CSV data`);
    assert.doesNotMatch(content, /CSV[^\n]*(?:plays|last_played_at)/i, `${path} must not promise unavailable play history`);
  }
  const changelog = readRequired('CHANGELOG.md');
  assert.match(changelog, /## \[Unreleased\]/i, 'CHANGELOG.md must have Unreleased section');
  assert.match(changelog, /relative section locator syntax/i, 'CHANGELOG.md must document relative section locators');
  assert.match(changelog, /\[ignore\]/i, 'CHANGELOG.md must document ignore tag');
});

test('jump documentation preserves the destination-BPM ordering and timing limitation', () => {
  const english = readRequired('docs/USER-GUIDE.md');
  const portuguese = readRequired('docs/pt-BR/USER-GUIDE.md');
  const changelog = readRequired('CHANGELOG.md');

  assert.match(english, /explicit jumps[\s\S]*destination BPM[\s\S]*before[\s\S]*cue jump/i);
  assert.match(english, /section BPM[\s\S]*overrides[\s\S]*song BPM/i);
  assert.match(english, /SDK-first/i);
  assert.match(english, /sequential[\s\S]*(?:not atomic|non-atomic)/i);
  assert.match(english, /Arrangement tempo automation[\s\S]*sample-accurate/i);

  assert.match(portuguese, /saltos expl.citos[\s\S]*BPM de destino[\s\S]*antes[\s\S]*salto de cue/i);
  assert.match(portuguese, /BPM da se..o[\s\S]*substitui[\s\S]*BPM da m.sica/i);
  assert.match(portuguese, /SDK-first/i);
  assert.match(portuguese, /sequenciais[\s\S]*(?:n.o at.micas|n.o s.o at.micas)/i);
  assert.match(portuguese, /automa..o de tempo.*Arrangement[\s\S]*precis.o de amostra/i);

  assert.match(changelog, /destination BPM[\s\S]*before[\s\S]*cue jump/i);
  assert.match(changelog, /section BPM[\s\S]*overrides[\s\S]*song BPM/i);
  assert.match(changelog, /SDK-first[\s\S]*sequential[\s\S]*(?:not atomic|non-atomic)/i);
  assert.match(changelog, /Arrangement tempo automation[\s\S]*sample-accurate/i);
});
