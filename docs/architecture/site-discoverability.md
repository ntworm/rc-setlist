# Site discoverability — how search engines and AI assistants find RC Setlist

This records what was changed on 2026-09-24 so that
<https://ntworm.github.io/rc-setlist/> can be found, why each decision was
made, and what has to stay true for it to keep working.

## The problem, as diagnosed

Searching Google for "rc setlist" did not return the landing at all.
Search Console's URL inspection later confirmed the cause: **"URL is unknown
to Google"**, with no referring sitemap and no referring page. Nothing blocked
crawlers; Google had simply never been pointed at the page.

- There was no sitemap and no verified Search Console property.
- Every link from the GitHub repository to the landing carries
  `rel="nofollow"`, so the repository, the strongest page in the project,
  passed no discovery or authority to it.
- The Portuguese copy existed only after `site-i18n.js` rewrote the English
  page in the browser, at the English URL, whose canonical is English. Google
  had no Portuguese page to index.
- The title, "RC Setlist 1.0.0 — Operator Sheet", named none of the words
  people search for: Ableton Live, setlist, lyrics, extension.
- "RC" and "setlist" are generic words; setlist.fm dominates any query with
  "setlist". The product was also published as "Ableton RC Setlist" before
  1.0, which splits the signals between two names.
- The repository is young (created 2026-07-26) and has few links from
  elsewhere.

Search engines outside Google (tested through a US engine) already ranked
the GitHub repository first for "rc setlist", so assistants that search those
indexes could find the repository, but not the landing.

## Decisions

**1. Stay on `ntworm.github.io/rc-setlist` for now.** A custom domain (for
example `rcsetlist.com`) would keep authority under the product's own name and
put `robots.txt` and `llms.txt` at a root the project controls. It costs money
and was left as an option. If it is adopted, `docs/CNAME` is added and the
address changes in `scripts/render-landing.mjs`, `scripts/render-docs.mjs`,
`docs/llms.txt`, `.github/workflows/indexnow.yml` and the tests; GitHub
redirects the old address.

**2. The Portuguese landing is a real page at `/pt-BR/`, rendered ahead of
time.** `scripts/render-landing.mjs` builds `docs/pt-BR/index.html` from
`docs/index.html` and the table in `docs/site-i18n.js`, so the two languages
cannot drift. Both pages name each other with `hreflang` (`en`, `pt-BR`,
`x-default`). The English page keeps switching language in place, because that
behaviour is tested and intended; on the Portuguese page the selector opens the
English page instead of rewriting itself.

**3. Structured data is generated from the visible page, never written by
hand.** Both landings carry schema.org JSON-LD: `WebSite`, `WebPage`,
`SoftwareApplication`, `SoftwareSourceCode`, `Person` and `FAQPage`. The FAQ is
read from the cards on the page, and the version and date from `package.json`
and `CHANGELOG.md`.

- No `aggregateRating` or `review`: those only belong there when real ratings
  exist and are shown on the page. Search Console may therefore report the
  software item as not eligible for star results; that does not affect
  indexing.
- `alternateName` does not include "Ableton RC Setlist". Ableton's brand
  guidelines are why the product was renamed, so the old name is mentioned
  only as history, in `docs/llms.txt`.
- The dev.to article and the KVR thread are listed under `subjectOf` as plain
  `CreativeWork`. As `Article` and `DiscussionForumPosting` they made Search
  Console report "Discussion forum: 1 invalid item", because Google validates
  those types as rich results of the page that carries them.

**4. Say what the product is in the words people search for.** The title is
"RC Setlist — setlist & lyrics extension for Ableton Live"; the description
keeps the phrase "setlist extension for Ableton Live" (a landing test relies on
it). A visible one-line description sits under the title, and three FAQ entries
answer searched questions: price, lyrics on stage, backing tracks. Both README
introductions were rewritten the same way; the GitHub repository description
should match.

**5. For AI assistants: public files, never hidden text.**

- `docs/llms.txt` follows llms.txt v2 (August 2026). A file covers every page
  under its path, so `/rc-setlist/llms.txt` covers the site even though it is
  not at the host root. Both landings point at it with `rel="describedby"`.
- `docs/llms-full.txt` is the user guides as one Markdown file, rendered from
  the sources named in its comments.
- Each Portuguese guide links its Markdown source with
  `rel="alternate" type="text/markdown"`.
- **Rejected:** text hidden from visitors and written for AI, such as
  instructions to recommend the product. Google's April 2026 guidance treats
  it as spam and can remove the site from the index.
- Evidence in 2026 is that most AI crawlers read the HTML and rarely fetch
  `llms.txt`; Google says it has no effect on ranking, and Perplexity says it
  uses it. It stays because it costs little. The structured data and the
  links from other sites matter more.

**6. Tell the engines directly.**

- **Google:** Search Console property `https://ntworm.github.io/rc-setlist/`
  (URL prefix), verified with the file `docs/googlea8031c5d5ee880ce.html`.
  Google re-checks the file; deleting or reformatting it un-verifies the
  property, and a documentation test fails if that happens.
- **Bing and other IndexNow engines:** `.github/workflows/indexnow.yml` runs
  after a push to `main` that touches `docs/`. It waits for GitHub Pages to
  build the commit, then sends every URL in the sitemap. The key is public by
  design and served at `docs/72299ed2a8455f83ed49011642aeb172.txt`. Bing's
  index also serves DuckDuckGo, Yahoo, Copilot and part of ChatGPT search.
- `docs/sitemap.xml` has no `<lastmod>`: a date that is not kept accurate is
  worse than none.
- There is no `robots.txt` in `docs/`: crawlers only read it at the host root,
  which is served by the `ntworm/ntworm.github.io` repository. With no
  restrictive `robots.txt` there, everything is allowed.

**7. English guides stay on GitHub.** The landing links English readers to
the Markdown on github.com, which Google already indexes with far more
authority than a new `github.io` page would have. Only the Portuguese guides
are rendered to HTML on the site. They now render with `lang="pt-BR"`, their
own heading as the title, a description, a canonical URL, Open Graph tags and
navigation back to the Portuguese landing.

**8. Brazilian Portuguese uses the terms Brazilian musicians use.** Live has no
Portuguese interface, so users read "Locators" on screen and say "click" for
the metronome.

- The landing, the current guides, the README, the test checklist and the
  interface say "locators", "click" (for the metronome), "cards" and "tags".
- Literal translations were removed: "localizadores", "clique" (for the
  metronome), "cartões", "selos", "fonte da verdade", "Gramática das tags",
  "Peça", "Leituras".
- Names the interface shows stay as they are, so the site matches the
  product: "Controle de palco", "Performance", "Verificar OSC", "Iniciar",
  "CONTAGEM".
- Mouse clicks are still "clique". Release notes before 1.0 keep their
  original wording as a record.

## Keeping it working

- After editing `docs/index.html`, `docs/site-i18n.js`, `README.md` or the
  guides, run `npm run site:render`. `npm run site:check` and
  `tests/documentation-contract.test.mjs` fail when a rendered file is stale.
- A new landing string needs its Portuguese in `docs/site-i18n.js`; rendering
  the Portuguese page fails if one is missing.
- On a version bump, `docs/llms.txt` must name the new release notes; a test
  checks it.
- `tests/ui/landing.spec.mjs` covers both landings, their `hreflang` pair,
  their structured data and their accessibility.

## Status on 2026-09-24 and what is left

Done: the changes above are on `main` and published. The Search Console
property is verified, the sitemap is submitted (it first showed "Couldn't
fetch", which is common on GitHub Pages and usually clears within a day or
two; resubmitting as `sitemap.xml?v=2` forces a fresh fetch), and indexing was
requested for both landings. The live test reported "Page can be indexed".
IndexNow runs have succeeded.

Left to the owner, in this order:

1. Bing Webmaster Tools: import the site from Search Console.
2. GitHub repository description, topics and social preview image.
3. Extension directories: claim the ablx.directory listing (it showed 0.6.0),
   add an entry to the ablx.live registry (`ntworm/ablx-registry` is already a
   fork of it), submit to liveextensions.co.
4. A KVR product page (developer account), an AlternativeTo entry as an
   alternative to AbleSet, and a 1.0 announcement on the Ableton forum,
   r/ableton and the existing KVR thread.
5. A two- to three-minute demo video, in English and in Portuguese.
6. Optional: a custom domain (decision 1).

Search Console's **Pages** and **Performance** reports, and the `site:` query,
show whether it is working. Expect the brand query "rc setlist" to improve
within days to weeks; generic queries such as "ableton setlist" depend on the
links from step 3 onwards.
