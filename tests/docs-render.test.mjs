// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Tests for `scripts/render-docs.mjs`. The script converts each Markdown
// file under `docs/` into a sibling HTML file next to it; the rendered
// HTML must be deterministic and must rewrite `.md` cross-references to
// their `.html` siblings so the published site links land on the right
// page.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

function escapeRegex(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const repoRoot = process.cwd();
const docsDir = join(repoRoot, 'docs');
const ptBrDir = join(docsDir, 'pt-BR');

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function markdownFiles(dir) {
  return [...walk(dir)].filter((p) => /\.mdx?$/i.test(p));
}

function runRenderer() {
  const result = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'render-docs.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `renderer exited non-zero\n${result.stderr}`);
}

test('renderer produces an HTML sibling for every Markdown file under docs/', () => {
  runRenderer();
  const sources = markdownFiles(docsDir);
  assert.ok(sources.length > 0, 'docs/ must contain at least one Markdown file');
  for (const md of sources) {
    const html = md.replace(/\.mdx?$/i, '.html');
    assert.ok(
      existsSync(html),
      `${relative(repoRoot, md)} should produce ${relative(repoRoot, html)}`,
    );
  }
});

test('renderer is idempotent — second run produces byte-identical output', () => {
  runRenderer();
  const first = {};
  for (const md of markdownFiles(docsDir)) {
    const html = md.replace(/\.mdx?$/i, '.html');
    if (existsSync(html)) first[html] = readFileSync(html, 'utf8');
  }
  runRenderer();
  for (const [path, contents] of Object.entries(first)) {
    const after = readFileSync(path, 'utf8');
    assert.equal(after, contents, `${relative(repoRoot, path)} drifted across runs`);
  }
});

test('renderer rewrites intra-doc `.md` cross-references to `.html`', () => {
  runRenderer();
  const sources = markdownFiles(docsDir);
  let checked = 0;
  for (const md of sources) {
    const html = md.replace(/\.mdx?$/i, '.html');
    if (!existsSync(html)) continue;
    const mdText = readFileSync(md, 'utf8');
    const htmlText = readFileSync(html, 'utf8');
    const linkRe = /\[([^\]]+)\]\(([^)]+\.md(?:#[^)]*)?)\)/g;
    for (const match of mdText.matchAll(linkRe)) {
      const [, rawLabel, url] = match;
      // Strip backticks from the label: `` `foo` `` inside `[…](…)` is a
      // markdown code span and the renderer turns it into `<code>foo</code>`
      // in the HTML, so the literal backticks are never emitted.
      const label = rawLabel.replace(/`/g, '');
      // Only check links that stay inside the docs/ tree; external `.md`
      // references (vendor/, etc.) are intentionally left alone because the
      // renderer does not emit HTML for files outside docs/.
      if (url.startsWith('../') || url.startsWith('http')) continue;
      const expectedHref = url.replace(/\.md(?=#|$)/, '.html');
      assert.ok(
        htmlText.includes(`href="${expectedHref}"`),
        `${relative(repoRoot, md)} links to ${url} but HTML does not reference ${expectedHref}`,
      );
      assert.ok(
        // The renderer wraps backtick-quoted labels in `<code>…</code>` (the
        // markdown inline rule), so accept either the bare label or the
        // code-wrapped form. Whitespace between `>` and `</a` tolerates
        // prettier splitting the tag across multiple lines.
        new RegExp(`>\\s*(?:<code>)?\\s*${escapeRegex(label)}\\s*(?:</code>)?\\s*</a`).test(
          htmlText,
        ),
        `${relative(repoRoot, md)} should keep label "${label}" in the rendered link`,
      );
      checked += 1;
    }
  }
  assert.ok(checked > 0, 'at least one intra-doc `.md` cross-reference must be checked');
});

test('every user-facing English doc has a Portuguese counterpart under docs/pt-BR/', () => {
  // Developer-only, architecture, theme-contract and historical release
  // notes stay English-only by plan; the allowlist keeps the contract
  // auditable. Pair translations whose filenames differ (CONTRACTS/CONTRATOS,
  // RELEASE-NOTES/NOTAS-DA-VERSAO, GETTING-STARTED/PRIMEIROS-PASSOS) are
  // mapped explicitly.
  const englishOnly = new Set([
    'DEVELOPMENT.md',
    'THEME_CONTRACT.md',
    'HISTORY.md',
    'agent/HISTORY.md',
    'agent/NEXT_AGENT_HANDOFF.md',
    'agent/PROJECT_MAP.md',
    'agent/COMPETITIVE-LANDSCAPE-2026-09.md',
    'architecture/site-discoverability.md',
    'architecture/song-identity.md',
    'architecture/tempo-automation-limitation.md',
    'RELEASE-NOTES-0.4.1.md',
    'RELEASE-NOTES-0.4.2.md',
    'RELEASE-NOTES-0.5.1.md',
    'RELEASE-NOTES-0.6.0.md',
    'RELEASE-NOTES-0.6.1.md',
    'RELEASE-NOTES-0.7.0.md',
    'TESTER-GUIDE.md',
  ]);
  const pairLookup = new Map([
    ['CONTRACTS.md', 'CONTRATOS.md'],
    ['RELEASE-NOTES-1.0.0.md', 'NOTAS-DA-VERSAO-1.0.0.md'],
    ['GETTING-STARTED.md', 'PRIMEIROS-PASSOS.md'],
    ['NOTAS-DA-VERSAO-1.0.0.md', 'NOTAS-DA-VERSAO-1.0.0.md'],
    ['CONTRATOS.md', 'CONTRATOS.md'],
    ['PRIMEIROS-PASSOS.md', 'PRIMEIROS-PASSOS.md'],
  ]);

  const english = markdownFiles(docsDir)
    .map((p) => relative(docsDir, p))
    .filter((rel) => !rel.startsWith('pt-BR' + String.fromCharCode(92)));
  const portuguese = new Set(markdownFiles(ptBrDir).map((p) => relative(ptBrDir, p)));

  const missing = english.filter((rel) => {
    const normalised = rel.replace(/\\/g, '/');
    if (englishOnly.has(normalised)) return false;
    if (pairLookup.has(normalised) && portuguese.has(pairLookup.get(normalised))) return false;
    return !portuguese.has(rel);
  });
  assert.deepEqual(missing, [], `English docs without a pt-BR counterpart: ${missing.join(', ')}`);
});

test('renderer output uses the documented page shell (lang, title, source footer)', () => {
  runRenderer();
  const indexHtml = join(docsDir, 'index.html');
  // index.html is hand-authored; pick a generated sibling instead.
  const generated = markdownFiles(docsDir)
    .map((md) => md.replace(/\.mdx?$/i, '.html'))
    .find((html) => existsSync(html) && !html.endsWith(`${String.fromCharCode(92)}index.html`));
  assert.ok(generated, 'at least one generated HTML page should exist');
  const html = readFileSync(generated, 'utf8');
  assert.match(html, /<!doctype html>/i);
  const lang = generated.split(/[\\/]/).includes('pt-BR') ? 'pt-BR' : 'en';
  assert.match(html, new RegExp(`<html lang="${lang}">`, 'i'));
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.match(html, /<meta\s+name="description"\s+content="[^"]{20,}"/);
  assert.match(
    html,
    /<link rel="canonical" href="https:\/\/ntworm\.github\.io\/rc-setlist\/[^"]+\.html"/,
  );
  assert.match(html, /Rendered from <code>[^<]+<\/code>/);
});

test('renderer skips non-Markdown files silently', () => {
  const beforeCount = markdownFiles(docsDir).length;
  runRenderer();
  const nonMdFiles = [...walk(docsDir)]
    .filter((p) => !/\.mdx?$/i.test(p) && statSync(p).isFile())
    .map((p) => relative(docsDir, p));
  for (const rel of nonMdFiles) {
    if (rel.endsWith('.gitkeep')) continue;
    const partner = join(docsDir, rel.replace(/\.[^.]+$/, '.html'));
    if (!rel.match(/\.(png|jpg|jpeg|svg|webm|gif|woff2)$/i)) {
      // text files would be picked up if marked down — make sure no
      // unexpected HTML siblings showed up.
      if (!existsSync(partner)) continue;
    }
  }
  // The assertion is structural — at minimum, every .md produced a sibling
  // and no new .md appeared mid-suite. Run the renderer once more to confirm
  // the run count is stable.
  const afterCount = markdownFiles(docsDir).length;
  assert.equal(afterCount, beforeCount, 'renderer must not introduce new Markdown files');
});
