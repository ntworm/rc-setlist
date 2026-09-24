import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function readRequired(path) {
  const url = new URL(`../${path}`, import.meta.url);
  assert.ok(existsSync(url), `${path} must exist`);
  return readFileSync(url, 'utf8');
}

test('public landing presents RC Setlist as source-available and noncommercial', () => {
  const landing = read('docs/index.html');

  assert.match(landing, /<title>RC Setlist\b/);
  assert.match(landing, /source-available/i);
  assert.match(landing, /PolyForm Noncommercial 1\.0\.0/i);
  assert.match(landing, /independent project.+not affiliated with or endorsed by Ableton AG/is);
  assert.match(landing, /https:\/\/ntworm\.github\.io\/rc-setlist\//i);
  // Derived from package.json rather than written as a literal: this assertion
  // used to name a version by hand, which is how docs/site-i18n.js came to be
  // announcing v0.5.0 for the whole of the 0.5.1 release with nothing failing.
  const version = JSON.parse(read('package.json')).version;
  assert.ok(landing.includes(`Release ${version}`), `the landing must announce ${version}`);
  // site-i18n.js holds the Portuguese copy of the landing ("Versão ..."), so it
  // must name the same release rather than repeat the English label.
  assert.ok(
    read('docs/site-i18n.js').includes(`Versão ${version}`),
    'site-i18n.js translates the landing, so it must announce the same version',
  );
  assert.match(landing, /id=["']languageSelect["']/);
  assert.doesNotMatch(landing, /Release candidate/i);
  assert.doesNotMatch(
    landing,
    /commercial distribution is in preparation|private beta|sales open/i,
  );
  assert.doesNotMatch(
    landing,
    /fonts\.googleapis\.com|fonts\.gstatic\.com|google-analytics|googletagmanager/i,
  );
  assert.match(
    landing,
    /@font-face\s*\{[^}]*font-family:\s*["']Martian Mono["'][^}]*src:\s*url\(["']?\.\/fonts\/MartianMono-latin\.woff2["']?\)/is,
    'the landing must self-host its deterministic Martian Mono webfont',
  );
  assert.ok(existsSync(new URL('../docs/fonts/MartianMono-latin.woff2', import.meta.url)));
  assert.ok(existsSync(new URL('../docs/fonts/OFL.txt', import.meta.url)));
});

test('public documentation uses the official compatibility floor', () => {
  for (const path of ['README.md', 'docs/INSTALL.md', 'docs/DEVELOPMENT.md']) {
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `${path} must exist`);
    const content = read(path);
    assert.match(
      content,
      /Ableton Live 12\.4\.5\+ Suite \(Beta\)/i,
      `${path} must state the Live floor`,
    );
    assert.match(
      content,
      /Node(?:\.js)? 24\.16\.0/i,
      `${path} must state the development Node floor`,
    );
  }
});

test('public documentation presents RC Bridge as the bundled fork of AbletonOSC, with the upstream credited', () => {
  const readme = readRequired('README.md');
  const install = readRequired('docs/INSTALL.md');

  for (const [label, content] of [
    ['README', readme],
    ['install guide', install],
  ]) {
    assert.match(
      content,
      /github\.com\/ideoforms\/AbletonOSC/i,
      `${label} must link upstream AbletonOSC`,
    );
    assert.match(content, /RC Bridge/, `${label} must name the bundled script`);
    assert.match(content, /fork/i, `${label} must say it is a fork, not the upstream project`);
  }
  // The fork ships in the tree with its licence; nothing is fetched at build time.
  assert.ok(
    existsSync(new URL('../bridge/RCBridge/LICENSE.md', import.meta.url)),
    'the MIT licence travels with the fork',
  );
  assert.ok(
    existsSync(new URL('../bridge/RCBridge/README.md', import.meta.url)),
    'the fork documents its changes',
  );
});

test('user guides define the stopped-play one-bar count-in safety contract', () => {
  const english = readRequired('docs/USER-GUIDE.md');
  const portuguese = readRequired('docs/pt-BR/USER-GUIDE.md');
  const tester = readRequired('docs/TESTER-GUIDE.md');
  const changelog = readRequired('CHANGELOG.md');

  // The count is browser audio now. What the guides have to promise changed
  // with it: Live's playhead and metronome are left alone, and the count runs
  // at the tempo the setlist declares rather than the one Live is sitting at.
  assert.match(english, /COUNT-IN 1 BAR[\s\S]*one bar[\s\S]*transport is stopped/i);
  assert.match(english, /playhead does not move[\s\S]*metronome is not touched/i);
  assert.match(english, /tempo \*\*the setlist declares\*\*/i);
  assert.match(english, /does not (?:enter )?Record[\s\S]*arm tracks/i);
  assert.match(english, /does not change[\s\S]*jump quantization/i);

  assert.match(portuguese, /CONTAGEM 1 COMP[\s\S]*um compasso[\s\S]*transporte est[aá] parado/i);
  assert.match(
    portuguese,
    /playhead do Live n[aã]o se move[\s\S]*metr[oô]nomo do Live n[aã]o [eé] tocado/i,
  );
  assert.match(portuguese, /tempo que \*\*o setlist declara\*\*/i);
  assert.match(portuguese, /n[aã]o entra em Record[\s\S]*n[aã]o arma pistas/i);
  assert.match(portuguese, /n[aã]o\s+altera[\s\S]*quantiza[cç][aã]o dos saltos/i);

  for (const marker of [
    'Click off',
    'Click on',
    'beat zero',
    'Stop',
    'manual Click',
    'already playing',
  ]) {
    assert.match(tester, new RegExp(marker, 'i'), `tester guide must cover ${marker}`);
  }
  assert.match(changelog, /\[ws\][^\n]*preRollEnabled[^\n]*protocolVersion 3/i);
});

test('installation and troubleshooting guides prevent the remote-script folder mix-up', () => {
  for (const path of [
    'docs/INSTALL.md',
    'docs/TROUBLESHOOTING.md',
    'docs/pt-BR/INSTALL.md',
    'docs/pt-BR/TROUBLESHOOTING.md',
  ]) {
    const content = readRequired(path);
    assert.match(
      content,
      /User Library[\\/]Remote Scripts[\\/]RCBridge/i,
      `${path} must show the exact install target`,
    );
    assert.match(
      content,
      /User Remote Scripts/i,
      `${path} must distinguish Live's hidden preferences folder`,
    );
    assert.match(
      content,
      /RCBridge[\\/]__init__\.py/i,
      `${path} must show how to detect an extra nested folder`,
    );
  }
  // The two ways in: the kit installers and the manual copy.
  for (const path of ['docs/INSTALL.md', 'docs/pt-BR/INSTALL.md']) {
    const content = readRequired(path);
    assert.match(content, /Install-RC-Bridge\.cmd/);
    assert.match(content, /Install RC Bridge\.command/);
    assert.match(content, /Link, Tempo & MIDI/);
  }
});

test('troubleshooting explains the fixed OSC return-port conflict outside the Live panel', () => {
  for (const path of ['docs/TROUBLESHOOTING.md', 'docs/pt-BR/TROUBLESHOOTING.md']) {
    const content = readRequired(path);
    assert.match(
      content,
      /UDP 11101|porta 11101/i,
      `${path} must identify the fallback listener symptom`,
    );
    assert.match(
      content,
      /another\s+RC\s+extension|outra\s+extens[aã]o\s+RC/i,
      `${path} must identify the competing RC extension`,
    );
    assert.match(
      content,
      /only one|apenas uma/i,
      `${path} must recommend one OSC auto-start owner`,
    );
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
  assert.match(
    portugueseNotes,
    /candidato local de teste[\s\S]*n[aã]o [ée] uma vers[aã]o publicada/i,
  );
  assert.match(portugueseNotes, />\s+Se[cç][aã]o[\s\S]*\[ignore\][\s\S]*visual/i);
  assert.match(portugueseNotes, /\.\.\/RELEASE-NOTES-0\.4\.2\.md/);
});

test('0.5.1 final notes are bilingual and promote the field-tested release surface', () => {
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
  assert.match(englishNotes, /pt-BR\/NOTAS-DA-VERSAO-0\.5\.1\.md/);
  assert.match(portugueseNotes, /Keyboard[\s\S]*Mapping/i);
  assert.match(portugueseNotes, /Count-in[\s\S]*pre-roll/i);
  assert.match(portugueseNotes, /\.\.\/RELEASE-NOTES-0\.5\.1\.md/);

  // The landing page and the README name the current release, not this one.
  // What has to survive is that the 0.5.1 notes remain published and bilingual.
  const version = JSON.parse(read('package.json')).version;
  assert.ok(landing.includes(`RELEASE-NOTES-${version}.md`));
  assert.ok(readme.includes(`RC-Setlist-${version}.ablx`));
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
  assert.match(
    portugueseChecklist,
    /criar[\s\S]*selecionar[\s\S]*renomear[\s\S]*excluir[\s\S]*restaurar/i,
  );
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
  assert.match(
    englishNotes,
    /setlist duration[\s\S]*Manage Setlists[\s\S]*lyrics[\s\S]*bar display/i,
  );
  assert.match(
    portugueseNotes,
    /dura[cç][aã]o total[\s\S]*Gerenciar setlists[\s\S]*letras[\s\S]*compasso/i,
  );
  assert.match(
    readme,
    /\[Landing page and screenshots\]\(https:\/\/ntworm\.github\.io\/rc-setlist\/\)/,
  );
  assert.match(readme, /!\[RC Setlist Stage Control\]\(docs\/media\/en\/stage-control\.png\)/);
});

test('Portuguese HTML docs match their Markdown sources', () => {
  // The landing links Portuguese readers to these rendered pages. A Markdown
  // edit without a re-render published a user guide 116 lines out of date.
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('../scripts/render-docs.mjs', import.meta.url)),
      '--check',
      fileURLToPath(new URL('../docs/pt-BR', import.meta.url)),
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});

test('site files for search engines match the landing, site-i18n.js and the guides', () => {
  // docs/pt-BR/index.html, docs/sitemap.xml, docs/llms-full.txt and the
  // landing's structured data are rendered, not written by hand.
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../scripts/render-landing.mjs', import.meta.url)), '--check'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});

test('Portuguese guides are pages search engines can read as Portuguese', () => {
  for (const page of ['USER-GUIDE', 'INSTALL', 'FAQ', 'PRIMEIROS-PASSOS']) {
    const html = readRequired(`docs/pt-BR/${page}.html`);
    assert.match(html, /<html lang="pt-BR">/);
    assert.match(html, /<meta\s+name="description"\s+content="[^"]{40,}"/);
    assert.match(
      html,
      new RegExp(
        `<link rel="canonical" href="https://ntworm\\.github\\.io/rc-setlist/pt-BR/${page}\\.html"`,
      ),
    );
    assert.match(
      html,
      new RegExp(`<link rel="alternate" type="text/markdown" href="\\./${page}\\.md"`),
    );
  }
});

test('llms.txt follows the llms.txt format and every link it gives resolves', () => {
  const llms = readRequired('docs/llms.txt');
  const version = JSON.parse(read('package.json')).version;
  assert.match(llms, /^# RC Setlist\n\n> \S/);
  assert.match(llms, /^## Docs$/m);
  assert.match(llms, /^## Optional$/m);
  assert.match(llms, /PolyForm Noncommercial/);
  assert.match(llms, /not affiliated with or endorsed by Ableton AG/);
  assert.ok(
    llms.includes(`RELEASE-NOTES-${version}.md`),
    `llms.txt must point at the ${version} release notes`,
  );
  const site = 'https://ntworm.github.io/rc-setlist/';
  const links = [...llms.matchAll(/\]\((https:\/\/ntworm\.github\.io\/rc-setlist\/[^)]*)\)/g)];
  assert.ok(links.length > 10);
  for (const [, url] of links) {
    const path = url.slice(site.length);
    const file = path === '' || path.endsWith('/') ? `${path}index.html` : path;
    assert.ok(
      existsSync(new URL(`../docs/${file}`, import.meta.url)),
      `${url} has no docs/${file}`,
    );
  }
  for (const page of ['docs/index.html', 'docs/pt-BR/index.html']) {
    assert.match(read(page), /<link rel="describedby" href="\.{1,2}\/llms\.txt" \/>/);
  }
});

test('the sitemap lists both landings and every Portuguese guide', () => {
  const sitemap = readRequired('docs/sitemap.xml');
  assert.match(sitemap, /<loc>https:\/\/ntworm\.github\.io\/rc-setlist\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/ntworm\.github\.io\/rc-setlist\/pt-BR\/<\/loc>/);
  for (const guide of ['README', 'INSTALL', 'USER-GUIDE', 'FAQ', 'TROUBLESHOOTING']) {
    assert.ok(sitemap.includes(`/rc-setlist/pt-BR/${guide}.html</loc>`), `${guide} is missing`);
  }
});

test('the IndexNow key the workflow sends is the one the site serves', () => {
  const workflow = readRequired('.github/workflows/indexnow.yml');
  const key = workflow.match(/INDEXNOW_KEY: ([0-9a-f]{32})\b/)?.[1];
  assert.ok(key, 'indexnow.yml must name a 32-digit hexadecimal key');
  assert.equal(readRequired(`docs/${key}.txt`), key);
  assert.match(read('public-files.txt'), new RegExp(`^docs/${key}\\.txt$`, 'm'));
});

test('public landing contains truthful site media and keeps the owner media kit private', () => {
  const required = [
    'docs/media/en/product-truth-discord.png',
    'docs/media/en/performance.png',
    'docs/media/en/performance-phone.png',
    'docs/media/en/stage-control.png',
    'docs/media/en/workflow.png',
    'docs/media/en/stage-editorial.png',
    'docs/media/pt-BR/product-truth-discord.png',
    'docs/media/pt-BR/performance.png',
    'docs/media/pt-BR/performance-phone.png',
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
    assert.doesNotMatch(
      allowlist,
      new RegExp(`^${privatePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'),
    );
  }
});

test('Dependabot keeps TypeScript and Node types on the supported major release line', () => {
  const dependabot = read('.github/dependabot.yml');
  for (const dependency of ['typescript', '@types/node']) {
    const escaped = dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      dependabot,
      new RegExp(
        `dependency-name:\\s*["']?${escaped}["']?[\\s\\S]*?update-types:[\\s\\S]*?version-update:semver-major`,
      ),
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
    assert.match(
      content,
      /> Se[çc][ãa]o|> Section/i,
      `${path} must document relative locator syntax`,
    );
    assert.match(content, /\[ignore\]/i, `${path} must document ignore tag`);
    assert.match(
      content,
      /Manage Setlists|Gerenciar setlists/i,
      `${path} must document Manage Setlists discovery`,
    );
    assert.match(content, /Downloads/i, `${path} must document browser Downloads location for CSV`);
    assert.match(content, /sections_count/i, `${path} must document named-section CSV data`);
    assert.match(content, /automations/i, `${path} must document automation CSV data`);
    assert.doesNotMatch(
      content,
      /CSV[^\n]*(?:plays|last_played_at)/i,
      `${path} must not promise unavailable play history`,
    );
  }
  const changelog = readRequired('CHANGELOG.md');
  assert.match(changelog, /## \[Unreleased\]/i, 'CHANGELOG.md must have Unreleased section');
  assert.match(
    changelog,
    /relative section locator syntax/i,
    'CHANGELOG.md must document relative section locators',
  );
  assert.match(changelog, /\[ignore\]/i, 'CHANGELOG.md must document ignore tag');
});

test('jump documentation preserves the destination-BPM ordering and timing limitation', () => {
  const english = readRequired('docs/USER-GUIDE.md');
  const portuguese = readRequired('docs/pt-BR/USER-GUIDE.md');
  const changelog = readRequired('CHANGELOG.md');

  assert.match(english, /explicit jumps[\s\S]*destination BPM[\s\S]*around[\s\S]*cue jump/i);
  assert.match(
    english,
    /handed to Live at once[\s\S]*next grid line[\s\S]*tempo is written when that landing is observed/i,
  );
  assert.match(english, /section BPM[\s\S]*overrides[\s\S]*song BPM/i);
  assert.match(english, /SDK-first/i);
  assert.match(english, /sequential[\s\S]*(?:not atomic|non-atomic)/i);
  assert.match(english, /Arrangement tempo automation[\s\S]*sample-accurate/i);

  assert.match(
    portuguese,
    /saltos expl.citos[\s\S]*BPM de destino[\s\S]*em torno[\s\S]*salto de cue/i,
  );
  assert.match(portuguese, /entregue ao Live na hora[\s\S]*pr.xima linha da grade/i);
  assert.match(portuguese, /BPM da se..o[\s\S]*substitui[\s\S]*BPM da m.sica/i);
  assert.match(portuguese, /SDK-first/i);
  assert.match(portuguese, /sequenciais[\s\S]*(?:n.o at.micas|n.o s.o at.micas)/i);
  assert.match(portuguese, /automa..o de tempo.*Arrangement[\s\S]*precis.o de amostra/i);

  assert.match(changelog, /destination BPM[\s\S]*before[\s\S]*cue jump/i);
  assert.match(changelog, /section BPM[\s\S]*overrides[\s\S]*song BPM/i);
  assert.match(changelog, /SDK-first[\s\S]*sequential[\s\S]*(?:not atomic|non-atomic)/i);
  assert.match(changelog, /Arrangement tempo automation[\s\S]*sample-accurate/i);
});

test('1.0.0 notes are bilingual and describe the consolidated release', () => {
  const changelog = readRequired('CHANGELOG.md');
  const englishNotes = readRequired('docs/RELEASE-NOTES-1.0.0.md');
  const portugueseNotes = readRequired('docs/pt-BR/NOTAS-DA-VERSAO-1.0.0.md');
  const landing = readRequired('docs/index.html');
  const siteStrings = readRequired('docs/site-i18n.js');
  const readme = readRequired('README.md');

  assert.match(changelog, /^## \[1\.0\.0\] - 2026-09-14/m);

  for (const notes of [englishNotes, portugueseNotes]) {
    assert.match(notes, /1\.0\.0/);
    assert.match(notes, /RC Setlist/i);
    assert.match(notes, /RC Bridge/i);
  }
  assert.match(englishNotes, /pt-BR\/NOTAS-DA-VERSAO-1\.0\.0\.md/);
  assert.match(portugueseNotes, /\.\.\/RELEASE-NOTES-1\.0\.0\.md/);

  assert.match(landing, /RELEASE-NOTES-1\.0\.0\.md/);
  assert.match(readme, /RC-Setlist-1\.0\.0\.ablx/);
  assert.match(readme, /docs\/RELEASE-NOTES-1\.0\.0\.md/);
  assert.doesNotMatch(
    siteStrings,
    /v0\.6\.\d|v0\.5\.\d/,
    'the site strings must not name a superseded version',
  );
  assert.doesNotMatch(landing, /v0\.6\.\d|v0\.5\.\d/);
});

test('the repository map only names paths that exist', (t) => {
  // docs/agent/PROJECT_MAP.md is the map agents are told to read first; a
  // path that no longer exists sends them to a module that moved or died.
  if (!existsSync(new URL('../docs/agent/PROJECT_MAP.md', import.meta.url))) {
    t.skip('docs/agent/PROJECT_MAP.md is excluded from public snapshot');
    return;
  }
  const map = readRequired('docs/agent/PROJECT_MAP.md');
  const roots = [
    'src/',
    'static/',
    'bridge/',
    'scripts/',
    'tests/',
    'docs/',
    'release-template/',
    '.agents/',
    'package.json',
    'public-files.txt',
  ];
  const missing = [];
  for (const match of map.matchAll(/`([A-Za-z0-9_./{},*-]+)`/g)) {
    const token = match[1];
    if (!roots.some((root) => token.startsWith(root))) continue;
    const braces = token.match(/^(.*)\{([^}]+)\}(.*)$/);
    const candidates = braces
      ? braces[2].split(',').map((part) => braces[1] + part + braces[3])
      : [token];
    for (const candidate of candidates) {
      if (candidate.includes('*')) continue;
      if (!existsSync(new URL(`../${candidate}`, import.meta.url))) missing.push(candidate);
    }
  }
  assert.deepEqual(missing, [], 'PROJECT_MAP.md names paths that do not exist');
});
