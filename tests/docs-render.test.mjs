// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Tests for `scripts/render-docs.mjs`. The script converts each Markdown
// file under `docs/` into a sibling HTML file next to it; the rendered
// HTML must be deterministic and must rewrite `.md` cross-references to
// their `.html` siblings so the published site links land on the right
// page.
//
// The suite never writes under `docs/`: freshness uses `--check`, content
// assertions read the committed HTML, and renders run in a temporary copy.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { after, test } from 'node:test';

function escapeRegex(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const repoRoot = process.cwd();
const docsDir = join(repoRoot, 'docs');
const ptBrDir = join(docsDir, 'pt-BR');
const renderer = join(repoRoot, 'scripts', 'render-docs.mjs');
const tempRoots = [];

after(() => {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

function toPosix(path) {
  return path.replace(/\\/g, '/');
}

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

function runRenderer(args) {
  const result = spawnSync(process.execPath, [renderer, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `renderer exited non-zero\n${result.stdout}\n${result.stderr}`);
  return result;
}

// A fresh copy of docs/ under the OS temp directory, removed after the suite.
function docsCopy() {
  const root = mkdtempSync(join(tmpdir(), 'rc-setlist-docs-'));
  tempRoots.push(root);
  const copy = join(root, 'docs');
  cpSync(docsDir, copy, { recursive: true });
  return copy;
}

// Same rule as the renderer's freshness check: the footer names the source
// path and the render date, so it is the only line allowed to differ.
function withoutSourceLine(html) {
  return html
    .replace(/\r\n/g, '\n')
    .replace(
      /\s*<div class="source">\s*Rendered from\s+<code>[^<]*<\/code>\s+on\s+[0-9-]+\.\s*<\/div>/,
      '',
    );
}

test('every Markdown file under docs/ has a current committed HTML sibling', () => {
  const result = runRenderer(['--check']);
  assert.match(result.stdout, /all current/);
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
  const copy = docsCopy();
  runRenderer([copy]);
  const first = {};
  for (const md of markdownFiles(copy)) {
    const html = md.replace(/\.mdx?$/i, '.html');
    first[html] = withoutSourceLine(readFileSync(html, 'utf8'));
  }
  assert.ok(Object.keys(first).length > 0, 'the copy must render at least one page');
  runRenderer([copy]);
  for (const [path, contents] of Object.entries(first)) {
    const second = withoutSourceLine(readFileSync(path, 'utf8'));
    assert.equal(second, contents, `${relative(copy, path)} drifted across runs`);
  }
});

test('renderer rewrites intra-doc `.md` cross-references to `.html`', () => {
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
      // A label may wrap across lines in the Markdown and in the HTML, so
      // each whitespace run in it matches any whitespace run.
      const labelPattern = label
        .trim()
        .split(/\s+/)
        .map((word) => escapeRegex(word))
        .join('\\s+');
      assert.ok(
        // The renderer wraps backtick-quoted labels in `<code>…</code>` (the
        // markdown inline rule), so accept either the bare label or the
        // code-wrapped form. Whitespace between `>` and `</a` tolerates
        // prettier splitting the tag across multiple lines.
        new RegExp(`>\\s*(?:<code>)?\\s*${labelPattern}\\s*(?:</code>)?\\s*</a`).test(htmlText),
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
  // auditable. Translations whose filenames differ are mapped: release
  // notes by version, the other pairs explicitly.
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
    ['GETTING-STARTED.md', 'PRIMEIROS-PASSOS.md'],
  ]);
  const counterpart = (rel) =>
    pairLookup.get(rel) ?? rel.replace(/^RELEASE-NOTES-(.+\.md)$/, 'NOTAS-DA-VERSAO-$1');

  const english = markdownFiles(docsDir)
    .map((p) => toPosix(relative(docsDir, p)))
    .filter((rel) => !rel.startsWith('pt-BR/'));
  const portuguese = new Set(markdownFiles(ptBrDir).map((p) => toPosix(relative(ptBrDir, p))));

  const missing = english.filter(
    (rel) => !englishOnly.has(rel) && !portuguese.has(counterpart(rel)),
  );
  assert.deepEqual(missing, [], `English docs without a pt-BR counterpart: ${missing.join(', ')}`);
});

test('renderer output uses the documented page shell (lang, title, source footer)', () => {
  // index.html is hand-authored; FAQ.html is a generated page with a stable name.
  for (const generated of [join(docsDir, 'FAQ.html'), join(ptBrDir, 'FAQ.html')]) {
    assert.ok(existsSync(generated), `${relative(repoRoot, generated)} should exist`);
    const html = readFileSync(generated, 'utf8');
    assert.match(html, /<!doctype html>/i);
    const lang = toPosix(generated).split('/').includes('pt-BR') ? 'pt-BR' : 'en';
    assert.match(html, new RegExp(`<html lang="${lang}">`, 'i'));
    assert.match(html, /<title>[^<]+<\/title>/);
    assert.match(html, /<meta\s+name="description"\s+content="[^"]{20,}"/);
    assert.match(
      html,
      /<link\s+rel="canonical"\s+href="https:\/\/ntworm\.github\.io\/rc-setlist\/(?![^"]*\.\.)[^"]+\.html"/,
    );
    assert.match(html, /Rendered from <code>[^<]+<\/code>/);
  }
});

test('renderer skips non-Markdown files silently', () => {
  const copy = docsCopy();
  const siblings = new Set(markdownFiles(copy).map((md) => md.replace(/\.mdx?$/i, '.html')));
  for (const html of siblings) if (existsSync(html)) unlinkSync(html);
  const before = new Map(
    [...walk(copy)].filter((p) => statSync(p).isFile()).map((p) => [p, readFileSync(p)]),
  );
  const nonMarkdown = [...before.keys()].filter((p) => !/\.mdx?$/i.test(p));
  assert.ok(nonMarkdown.length > 0, 'docs/ must contain non-Markdown files');

  const result = runRenderer([copy]);
  assert.match(result.stdout, new RegExp(`skipped: ${nonMarkdown.length}\\b`));

  // The only new files are the HTML siblings of the Markdown sources, and
  // every non-Markdown file is left byte for byte as it was.
  const afterFiles = [...walk(copy)].filter((p) => statSync(p).isFile());
  const created = afterFiles.filter((p) => !before.has(p)).sort();
  assert.deepEqual(created, [...siblings].sort());
  for (const p of nonMarkdown) {
    assert.ok(readFileSync(p).equals(before.get(p)), `${relative(copy, p)} changed`);
  }
});
