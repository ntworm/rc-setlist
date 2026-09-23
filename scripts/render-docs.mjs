#!/usr/bin/env node
// Render every Markdown file under `docs/` to a sibling HTML file next
// to the `.md` source. Idempotent — running it twice produces the same
// artefact. The output is a minimal, dependency-free static page that
// matches the landing-page styles already shipped under `static/`.
//
// The renderer is small on purpose: the contract documentation lives
// in the Markdown itself, not in the renderer's CSS. A bigger renderer
// would only buy us markdown extensions we never use.
//
// Usage:
//   node scripts/render-docs.mjs [docs/] [...]
//   node scripts/render-docs.mjs            # all of docs/
//   node scripts/render-docs.mjs --check docs/pt-BR
//       # write nothing; exit 1 if a committed HTML no longer matches its .md

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const paths = args.filter((arg) => arg !== '--check');
const targets = paths.length ? paths.map((p) => resolve(p)) : [resolve(repoRoot, 'docs')];

// The footer names the source path (with the platform's separator) and the
// render date, so two renders of the same Markdown differ there and nowhere
// else. A freshness check compares everything but that line.
function withoutSourceLine(html) {
  return html
    .replace(/\r\n/g, '\n')
    .replace(
      /\s*<div class="source">\s*Rendered from\s+<code>[^<]*<\/code>\s+on\s+[0-9-]+\.\s*<\/div>/,
      '',
    );
}

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(input) {
  return input.replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function looksLikeMarkdown(path) {
  return /\.mdx?$/i.test(path);
}

function* walk(dir) {
  if (!statSync(dir, { throwIfNoEntry: false })) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function mdToHtml(md) {
  // Tiny Markdown subset: ATX headings, paragraphs, fenced code, lists,
  // bold/em, inline links, hard line breaks. Good enough for the
  // shipped docs; the contract document lives in the Markdown itself.
  const out = [];
  const lines = md.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      out.push(`<h${level} id="${slugify(text)}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }
    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, '').trim();
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) (code.push(lines[i]), i++);
      i++;
      out.push(
        `<pre><code${lang ? ` class="lang-${escapeHtml(lang)}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`,
      );
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^[-*]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }
    const paragraph = [];
    while (i < lines.length && lines[i] && !/^(#{1,6}\s|```|[-*]\s)/.test(lines[i])) {
      paragraph.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }
  return out.join('\n');

  function inline(text) {
    // Inline backticks first so the regex for emphasis cannot reach into
    // them; a glob like `` `/exports/*` `` becomes `` <code>/exports/*</code> ``
    // with the literal `*` preserved, instead of being eaten by the
    // ``*([^*]+)*`` pair rule below.
    const codeSpans = [];
    // The placeholder uses \u0000 as a sentinel that cannot occur in real
    // Markdown input. ESLint's `no-control-regex` flags this pattern; the
    // suppression is intentional and documented here so future readers do
    // not 'fix' the placeholder character back into a printable one.

    const withPlaceholders = escapeHtml(text).replace(/`([^`]+)`/g, (_, c) => {
      const idx = codeSpans.push(c) - 1;
      return `\u0000CODE${idx}\u0000`;
    });
    const withEmphasis = withPlaceholders
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => {
        // Rewrite intra-doc `.md` cross-references to the `.html` sibling so
        // the published site lands on the rendered page. Cross-repo links
        // (`../…`, like the link from `docs/CONTRACTS.md` back to itself at
        // the repo root, or to `SECURITY.md`/`CHANGELOG.md` etc.) and external
        // URLs are left as-is: those targets don't have a rendered sibling
        // under `docs/` and breaking them would fail `docs:check`.
        const isCrossRepo = u.startsWith('../') || u.startsWith('http');
        const target = isCrossRepo ? u : u.replace(/(\.md)(?=[#?)]|$)/, '.html');
        return `<a href="${target}">${t}</a>`;
      });
    return withEmphasis.replace(
      // eslint-disable-next-line no-control-regex
      /\u0000CODE(\d+)\u0000/g,
      (_, n) => `<code>${codeSpans[Number(n)]}</code>`,
    );
  }
}

function pageShell(title, body, source) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — RC Setlist</title>
<style>
  body { font: 16px/1.55 system-ui, sans-serif; max-width: 920px; margin: 2rem auto; padding: 0 1rem; color: #f2f2f2; background: #0e0e0e; }
  h1,h2,h3,h4 { line-height: 1.25; }
  h1 { font-size: 2.2rem; margin-top: 0; }
  h2 { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #333; }
  h3 { margin-top: 1.5rem; }
  code { font: 0.92em ui-monospace, Consolas, monospace; background: #1a1a1a; padding: 0.1em 0.35em; border-radius: 0; }
  pre { background: #1a1a1a; padding: 0.8rem 1rem; overflow-x: auto; border: 1px solid #333; }
  pre code { background: transparent; padding: 0; }
  a { color: #ffa133; }
  ul, ol { padding-left: 1.2em; }
  blockquote { border-left: 4px solid #ffa133; margin: 1em 0; padding: 0.5em 1em; color: #a0a0a0; }
  .crumbs { font-size: 0.85em; color: #a0a0a0; margin-bottom: 1rem; }
  .crumbs a { color: #a0a0a0; text-decoration: none; }
  .crumbs a:hover { color: #f2f2f2; }
  .source { font-size: 0.78em; color: #a0a0a0; margin-top: 2rem; border-top: 1px solid #333; padding-top: 0.5rem; }
</style>
</head>
<body>
<div class="crumbs"><a href="https://ntworm.github.io/rc-setlist/">RC Setlist</a> · <a href="./">Docs</a></div>
${body}
<div class="source">Rendered from <code>${escapeHtml(source)}</code> on ${new Date().toISOString().slice(0, 10)}.</div>
</body>
</html>
`;
}

let rendered = 0;
let skipped = 0;
const stale = [];
(async () => {
  for (const target of targets) {
    const files = [];
    if (!existsSync(target)) {
      process.stderr.write(`skip: ${target} does not exist\n`);
      continue;
    }
    const stat = statSync(target);
    if (stat.isFile()) {
      if (looksLikeMarkdown(target)) files.push(target);
    } else {
      for (const file of walk(target)) {
        if (looksLikeMarkdown(file)) files.push(file);
        else skipped += 1;
      }
    }
    for (const file of files) {
      const md = readFileSync(file, 'utf8');
      const title = basename(file).replace(/\.mdx?$/i, '');
      const body = mdToHtml(md);
      const html = pageShell(title, body, relative(repoRoot, file));
      // Round-trip through prettier with the project's HTML options so the
      // emitted file is identical to what `prettier --check` expects. Without
      // this, `format:check` reports the rendered HTML as out of style even
      // though `render-docs.mjs` itself was idempotent (the gate used to mask
      // this with `|| exit 0`, which hid the regression in CI — see the P04
      // coder review Finding #1). `prettier.format` is deterministic for a
      // given input + options, so two consecutive renders remain byte-identical.
      // Prettier v3 exposes `format` as async; the outer IIFE awaits each call.
      const formatted = await prettier.format(html, {
        parser: 'html',
        printWidth: 100,
        singleQuote: true,
        trailingComma: 'all',
        proseWrap: 'preserve',
      });
      const output = file.replace(/\.mdx?$/i, '.html');
      if (checkOnly) {
        const committed = existsSync(output) ? readFileSync(output, 'utf8') : '';
        if (withoutSourceLine(committed) !== withoutSourceLine(formatted)) {
          stale.push(relative(repoRoot, output));
        }
      } else {
        writeFileSync(output, formatted, 'utf8');
      }
      rendered += 1;
    }
  }
  if (checkOnly) {
    if (stale.length) {
      process.stderr.write(
        `stale: ${stale.join(', ')}\nrun: node scripts/render-docs.mjs ${paths.join(' ')}\n`,
      );
      process.exitCode = 1;
    } else {
      process.stdout.write(`checked: ${rendered}, all current\n`);
    }
    return;
  }
  process.stdout.write(`rendered: ${rendered}\nskipped: ${skipped}\n`);
})();
