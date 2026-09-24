#!/usr/bin/env node
// Render what search engines and AI assistants read from the public site,
// all derived from files that already exist so nothing can drift by hand:
//
//   docs/index.html        its structured data (schema.org JSON-LD), built
//                          from the page's own visible FAQ and package.json
//   docs/pt-BR/index.html  the landing in Portuguese at a URL of its own, built
//                          from docs/index.html and the table in site-i18n.js
//   docs/sitemap.xml       every public page, with the hreflang pair
//   docs/llms-full.txt     the user documentation as one Markdown file
//
// docs/index.html stays hand-authored; only its structured-data block is
// written here. docs/llms.txt is hand-authored too.
//
// Usage:
//   node scripts/render-landing.mjs           # write the files above
//   node scripts/render-landing.mjs --check   # write nothing; exit 1 if stale

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import prettier from 'prettier';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const docsDir = join(repoRoot, 'docs');
const checkOnly = process.argv.includes('--check');

const SITE = 'https://ntworm.github.io/rc-setlist/';
const REPO = 'https://github.com/ntworm/rc-setlist';
const PT_URL = `${SITE}pt-BR/`;

// The same options scripts/render-docs.mjs uses, so `prettier --check`
// accepts every file written here.
const PRETTIER = {
  parser: 'html',
  printWidth: 100,
  singleQuote: true,
  trailingComma: 'all',
  proseWrap: 'preserve',
};

const read = (path) => readFileSync(join(repoRoot, path), 'utf8').replace(/\r\n/g, '\n');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };

function escapeHtml(text) {
  return text.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
}

function plainText(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name) => ENTITIES[name])
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------- sources

const version = JSON.parse(read('package.json')).version;
const releaseDate = read('CHANGELOG.md').match(
  new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\] - (\\d{4}-\\d{2}-\\d{2})`, 'm'),
)?.[1];
if (!releaseDate) throw new Error(`CHANGELOG.md has no dated entry for ${version}`);

// site-i18n.js is a browser script; without a document it only publishes its table.
const sandbox = {};
vm.runInNewContext(read('docs/site-i18n.js'), { globalThis: sandbox });
const ptBR = sandbox.rcSetlistSiteStrings['pt-BR'];

// Every element carrying one of the site's translation attributes, with the
// span of its content. Nested elements of the same tag are counted so the
// closing tag found is the element's own.
function translatable(html) {
  const found = [];
  const open = /<([a-z][a-z0-9]*)\b[^>]*?\sdata-i18n(-html|-alt|-aria)?="([^"]+)"[^>]*>/g;
  for (const match of html.matchAll(open)) {
    const [tag, name, kind = '', key] = match;
    const item = { key, kind, start: match.index, tagEnd: match.index + tag.length };
    if (kind === '' || kind === '-html') {
      const pattern = new RegExp(`<(/?)${name}\\b[^>]*>`, 'g');
      pattern.lastIndex = item.tagEnd;
      let depth = 1;
      let close;
      while (depth && (close = pattern.exec(html))) depth += close[1] ? -1 : 1;
      if (depth) throw new Error(`unclosed <${name} data-i18n${kind}="${key}">`);
      item.contentEnd = close.index;
      item.content = html.slice(item.tagEnd, close.index);
    }
    found.push(item);
  }
  return found;
}

// ---------------------------------------------------------- structured data

const FEATURES = {
  en: [
    'Arrangement locators become songs and sections',
    'Stage Control for the operator and a Performance view for the band',
    'Synchronized .lrc lyrics with an in-browser timing editor',
    'Locator tags: [loop], [loop Nx], [stop], [next], [bpm N], [click], [skip], [hidden]',
    'Quantized, hold-to-send transport controls',
    'One-bar visual count-in',
    'Several saved setlists per Live Set, with the total set duration',
    'Runs in any browser on the local network: phone, tablet or laptop',
    'English and Brazilian Portuguese interface',
    'No account, no cloud, no telemetry',
  ],
  'pt-BR': [
    'Os locators do Arrangement viram músicas e seções',
    'Controle de palco para quem opera e tela Performance para a banda',
    'Letra sincronizada (.lrc) com editor de tempo no navegador',
    'Tags nos locators: [loop], [loop Nx], [stop], [next], [bpm N], [click], [skip], [hidden]',
    'Transporte quantizado, com botões de segurar para enviar',
    'Contagem visual de um compasso',
    'Vários setlists salvos por Live Set, com a duração total do set',
    'Funciona em qualquer navegador da rede local: celular, tablet ou notebook',
    'Interface em inglês e em português do Brasil',
    'Sem conta, sem nuvem, sem telemetria',
  ],
};

const IMAGE_ALT = {
  en: 'RC Setlist Stage Control running a five-song setlist from Ableton Live locators.',
  'pt-BR':
    'Controle de palco do RC Setlist rodando um setlist de cinco músicas a partir dos locators do Ableton Live.',
};

function structuredData({ locale, url, title, description, faq }) {
  const releaseNotes =
    locale === 'pt-BR'
      ? `${PT_URL}NOTAS-DA-VERSAO-${version}.html`
      : `${REPO}/blob/main/docs/RELEASE-NOTES-${version}.md`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE}#website`,
        url: SITE,
        name: 'RC Setlist',
        inLanguage: ['en', 'pt-BR'],
        publisher: { '@id': `${SITE}#author` },
      },
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: title,
        description,
        inLanguage: locale,
        isPartOf: { '@id': `${SITE}#website` },
        about: { '@id': `${SITE}#software` },
        primaryImageOfPage: { '@id': `${SITE}#image` },
      },
      {
        '@type': 'ImageObject',
        '@id': `${SITE}#image`,
        url: `${SITE}og-image.png`,
        width: 1200,
        height: 630,
        caption: IMAGE_ALT[locale],
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${SITE}#software`,
        name: 'RC Setlist',
        alternateName: ['RC Setlist for Ableton Live', 'rc-setlist'],
        description,
        url: SITE,
        applicationCategory: 'MultimediaApplication',
        applicationSubCategory: 'Ableton Live extension',
        operatingSystem: 'Windows, macOS',
        softwareVersion: version,
        dateModified: releaseDate,
        softwareRequirements:
          'Ableton Live 12.4.5 or later, Suite edition, with Extensions support; RC Bridge (included)',
        downloadUrl: `${REPO}/releases/latest`,
        installUrl: `${REPO}/blob/main/docs/INSTALL.md`,
        releaseNotes,
        featureList: FEATURES[locale],
        inLanguage: ['en', 'pt-BR'],
        isAccessibleForFree: true,
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
          url: `${REPO}/releases/latest`,
        },
        license: 'https://polyformproject.org/licenses/noncommercial/1.0.0/',
        image: { '@id': `${SITE}#image` },
        screenshot: ['stage-control.png', 'performance.png', 'performance-phone.png'].map(
          (name) => `${SITE}media/${locale}/${name}`,
        ),
        author: { '@id': `${SITE}#author` },
        sameAs: [REPO],
        // Plain CreativeWork on purpose: Google validates Article and
        // DiscussionForumPosting as rich results of the page that carries them,
        // and this page is neither an article nor a forum thread.
        subjectOf: [
          {
            '@type': 'CreativeWork',
            name: 'Building a stage setlist & lyric prompter for Ableton Live 12',
            url: 'https://dev.to/gabriel_worm/building-a-stage-setlist-lyric-prompter-for-ableton-live-12-4idh',
          },
          {
            '@type': 'CreativeWork',
            name: 'RC Setlist on the KVR Audio forum',
            url: 'https://www.kvraudio.com/forum/viewtopic.php?t=632094',
          },
        ],
      },
      {
        '@type': 'SoftwareSourceCode',
        '@id': `${SITE}#source`,
        name: 'RC Setlist source code',
        codeRepository: REPO,
        programmingLanguage: ['TypeScript', 'JavaScript', 'Python'],
        license: 'https://polyformproject.org/licenses/noncommercial/1.0.0/',
        targetProduct: { '@id': `${SITE}#software` },
        author: { '@id': `${SITE}#author` },
      },
      {
        '@type': 'Person',
        '@id': `${SITE}#author`,
        name: 'Gabriel Worm',
        alternateName: 'ntworm',
        url: 'https://github.com/ntworm',
        sameAs: ['https://github.com/ntworm', 'https://dev.to/gabriel_worm'],
      },
      {
        '@type': 'FAQPage',
        '@id': `${url}#faq`,
        inLanguage: locale,
        mainEntity: faq.map(([question, answer]) => ({
          '@type': 'Question',
          name: question,
          acceptedAnswer: { '@type': 'Answer', text: answer },
        })),
      },
    ],
  };
}

// The FAQ exactly as a visitor reads it: "faq.x" is a question, "faq.xd" its
// answer, in page order.
function visibleFaq(items, text) {
  const faq = [];
  for (const item of items) {
    const match = item.key.match(/^faq\.([a-z])$/);
    if (!match) continue;
    const answer = items.find((other) => other.key === `faq.${match[1]}d`);
    if (!answer) throw new Error(`${item.key} has no answer`);
    faq.push([text(item), text(answer)]);
  }
  if (!faq.length) throw new Error('the landing has no FAQ');
  return faq;
}

function withStructuredData(html, data) {
  const block = /(<script type="application\/ld\+json" id="structured-data">)[\s\S]*?(<\/script>)/;
  if (!block.test(html)) throw new Error('no <script id="structured-data"> block');
  // "</" cannot end the script early once escaped; JSON reads it back unchanged.
  const json = JSON.stringify(data).replace(/<\//g, '<\\/');
  return html.replace(block, (_, open, close) => `${open}${json}${close}`);
}

// --------------------------------------------------------------- the pages

function metaContent(html, attribute, name, value) {
  const pattern = new RegExp(`(<meta\\s+${attribute}="${name}"\\s+content=")[^"]*(")`);
  if (!pattern.test(html)) throw new Error(`no <meta ${attribute}="${name}">`);
  return html.replace(pattern, (_, head, tail) => `${head}${escapeHtml(value)}${tail}`);
}

function replaceOnce(html, from, to) {
  if (!html.includes(from)) throw new Error(`landing no longer contains: ${from}`);
  return html.replace(from, to);
}

function renderPortuguese(english) {
  let html = english;
  const edits = [];
  for (const item of translatable(html)) {
    const value = ptBR[item.key];
    if (value === undefined) throw new Error(`site-i18n.js has no Portuguese for "${item.key}"`);
    if (item.kind === '') {
      edits.push([item.tagEnd, item.contentEnd, escapeHtml(value)]);
    } else if (item.kind === '-html') {
      edits.push([item.tagEnd, item.contentEnd, value]);
    } else {
      const attribute = item.kind === '-alt' ? 'alt' : 'aria-label';
      const tag = html.slice(item.start, item.tagEnd);
      const pattern = new RegExp(`(\\s${attribute}=")[^"]*(")`);
      if (!pattern.test(tag)) throw new Error(`"${item.key}" has no ${attribute}`);
      const replaced = tag.replace(
        pattern,
        (_, head, tail) => `${head}${escapeHtml(value)}${tail}`,
      );
      edits.push([item.start, item.tagEnd, replaced]);
    }
  }
  edits.sort((a, b) => b[0] - a[0]);
  for (let i = 1; i < edits.length; i += 1) {
    if (edits[i][1] > edits[i - 1][0]) throw new Error('translatable elements overlap');
  }
  for (const [start, end, value] of edits) html = html.slice(0, start) + value + html.slice(end);

  // Images and links that site-i18n.js swaps at run time are set here instead.
  html = html.replace(
    /\ssrc="\.\/media\/en\/([^"]+)"\s+data-site-image="[^"]*"/g,
    (_, name) => ` src="./media/pt-BR/${name}"`,
  );
  html = html.replace(
    /(\shref=")[^"]*"\s+data-href-pt-br="([^"]*)"/g,
    (_, head, href) => `${head}${href}"`,
  );
  if (/data-site-image|data-href-pt-br/.test(html)) {
    throw new Error('an image or link swapped at run time was left in English');
  }
  // Every relative address was written for docs/; this page is one folder down.
  html = html.replace(/(\s(?:href|src)=")\.\//g, '$1../');
  html = html.replace(/url\('\.\/fonts\//g, "url('../fonts/");
  html = html.replace(/(\shref=")\.\.\/pt-BR\//g, '$1./');

  const title = ptBR['meta.title'];
  const description = ptBR['meta.description'];
  html = replaceOnce(html, '<html lang="en">', '<html lang="pt-BR" data-site-locale="pt-BR">');
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
  html = metaContent(html, 'name', 'description', description);
  html = replaceOnce(
    html,
    `<link rel="canonical" href="${SITE}" />`,
    `<link rel="canonical" href="${PT_URL}" />`,
  );
  html = metaContent(html, 'property', 'og:locale', 'pt_BR');
  html = metaContent(html, 'property', 'og:locale:alternate', 'en_US');
  html = metaContent(html, 'property', 'og:title', title);
  html = metaContent(html, 'property', 'og:description', description);
  html = metaContent(html, 'property', 'og:url', PT_URL);
  html = metaContent(html, 'property', 'og:image:alt', IMAGE_ALT['pt-BR']);
  html = metaContent(html, 'name', 'twitter:image:alt', IMAGE_ALT['pt-BR']);
  // The page is already Portuguese: nothing to hold back while a script translates it.
  html = html.replace(/\n\s*<script>\s*\/\/ A Portuguese visitor[\s\S]*?<\/script>/, '');
  if (html.includes("classList.add('i18n-wait')"))
    throw new Error('the landing hides itself in a new way');
  html = replaceOnce(html, '<option value="en">', '<option value="en" data-href="../?lang=en">');
  html = replaceOnce(html, '<option value="pt-BR">', '<option value="pt-BR" selected>');

  const items = translatable(html);
  const faq = visibleFaq(items, (item) => plainText(ptBR[item.key]));
  return withStructuredData(
    html,
    structuredData({ locale: 'pt-BR', url: PT_URL, title, description, faq }),
  );
}

function renderEnglish(source) {
  const items = translatable(source);
  const title = plainText(source.match(/<title>([^<]*)<\/title>/)[1]);
  const description = plainText(source.match(/<meta\s+name="description"\s+content="([^"]*)"/)[1]);
  const faq = visibleFaq(items, (item) => plainText(item.content));
  return withStructuredData(
    source,
    structuredData({ locale: 'en', url: SITE, title, description, faq }),
  );
}

// ------------------------------------------------------------- sitemap.xml

function sitemap() {
  const pair = [
    ['en', SITE],
    ['pt-BR', PT_URL],
    ['x-default', SITE],
  ]
    .map(([lang, href]) => `    <xhtml:link rel="alternate" hreflang="${lang}" href="${href}" />`)
    .join('\n');
  const landing = [SITE, PT_URL].map((loc) => `  <url>\n    <loc>${loc}</loc>\n${pair}\n  </url>`);
  const guides = readdirSync(join(docsDir, 'pt-BR'))
    .filter((name) => name.endsWith('.html') && name !== 'index.html')
    .sort()
    .map((name) => `  <url>\n    <loc>${PT_URL}${name}</loc>\n  </url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...landing,
    ...guides,
    '</urlset>',
    '',
  ].join('\n');
}

// ----------------------------------------------------------- llms-full.txt

const FULL_TEXT_SOURCES = [
  'README.md',
  'docs/GETTING-STARTED.md',
  'docs/INSTALL.md',
  'docs/USER-GUIDE.md',
  'docs/FAQ.md',
  'docs/TROUBLESHOOTING.md',
  `docs/RELEASE-NOTES-${version}.md`,
];

// Relative links only work beside the file they came from; out here they
// point at the repository on GitHub.
function absoluteLinks(markdown, source) {
  return markdown.replace(/(\]\()([^)\s]+)(\))/g, (all, open, target, close) => {
    if (/^(https?:|mailto:|#)/.test(target)) return all;
    const path = posix.normalize(posix.join(posix.dirname(source), target));
    const kind = /\.(png|jpe?g|gif|svg)$/i.test(path) ? 'raw' : 'blob';
    return `${open}${REPO}/${kind}/main/${path}${close}`;
  });
}

function llmsFull() {
  const parts = FULL_TEXT_SOURCES.map(
    (source) =>
      `<!-- ${REPO}/blob/main/${source} -->\n\n${absoluteLinks(read(source).trim(), source)}\n`,
  );
  return [
    '# RC Setlist — full documentation',
    '',
    `> Every user guide of RC Setlist ${version}, the setlist extension for Ableton Live, in one`,
    '> Markdown file. Generated by scripts/render-landing.mjs from the files named in each',
    `> comment; the index is ${SITE}llms.txt. Portuguese guides: ${PT_URL}README.html`,
    '',
    ...parts,
  ].join('\n');
}

// ------------------------------------------------------------------ output

const englishPath = join(docsDir, 'index.html');
const english = await prettier.format(renderEnglish(read('docs/index.html')), PRETTIER);
const outputs = [
  [englishPath, english],
  [
    join(docsDir, 'pt-BR', 'index.html'),
    await prettier.format(renderPortuguese(english), PRETTIER),
  ],
  [join(docsDir, 'sitemap.xml'), sitemap()],
  [join(docsDir, 'llms-full.txt'), llmsFull()],
];

const stale = [];
for (const [path, content] of outputs) {
  let current = '';
  try {
    current = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    // A missing file is stale.
  }
  if (current === content) continue;
  if (checkOnly) stale.push(relative(repoRoot, path));
  else writeFileSync(path, content, 'utf8');
}

if (checkOnly && stale.length) {
  process.stderr.write(`stale: ${stale.join(', ')}\nrun: node scripts/render-landing.mjs\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    checkOnly
      ? 'site files are current\n'
      : `rendered: ${outputs.map(([p]) => relative(repoRoot, p)).join(', ')}\n`,
  );
}
