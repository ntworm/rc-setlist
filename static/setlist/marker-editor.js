/*
 * Marker editor — one panel for a song or a section.
 *
 * Tags are controls here, never raw text. The old section editor put the name
 * and its tags in a single input, which let `[bpm 107]` be deleted by accident
 * — the tag that feeds the show duration. A number field cannot be cleared by
 * accident; it is cleared on purpose.
 *
 * This module knows nothing about WebSocket or transport. It builds the panel,
 * reads what the user did, and hands back a result. setlist.js decides what to
 * send. That boundary is what makes it testable without a browser.
 */
(function markerEditorModule(globalScope) {
  'use strict';

  /**
   * Sixteen colours as an 8x2 matrix, and the shape is the point.
   *
   * Across each row, hue climbs: warm, yellow, green, cyan, blue, purple, back
   * to red, neutral last. Down a column, the tone deepens. So two colours that
   * read apart on a dark stage are simply two that sit apart on the strip, and
   * a whole setlist coloured from left to right looks ordered rather than
   * scattered.
   *
   * The second row is not the first row darkened. Its hues fall between the
   * ones above, so the matrix holds fifteen distinct hues plus two neutrals
   * instead of eight hues twice over.
   *
   * Every colour stays under 0.35 HSV saturation, because that is what
   * separates identity from state: the state hues (#30d158, #ff375f, #0a84ff,
   * #bf5af2) are vivid, and the absence of chroma is itself the signal for
   * "this is which song". #ffa133 is deliberately absent — it is RC focus and
   * must not double as a song colour.
   *
   * The first row is the original palette, hex for hex. A song's colour is
   * stored as its hex, so changing one of these would leave a saved value
   * isPaletteColor no longer recognises and the card would silently lose its
   * paint. They are reordered here, which is display only.
   */
  const PALETTE = [
    { id: 'clay', hex: '#d6a89a' },
    { id: 'sand', hex: '#d9c7a7' },
    { id: 'sage', hex: '#a9c4a0' },
    { id: 'water', hex: '#98c4c0' },
    { id: 'sky', hex: '#9db8d4' },
    { id: 'lilac', hex: '#bfa8d1' },
    { id: 'rose', hex: '#d9a3b0' },
    { id: 'plain', hex: '#c9c9c9' },
    { id: 'brick', hex: '#8a705c' },
    { id: 'moss', hex: '#818a5c' },
    { id: 'forest', hex: '#5c8a6b' },
    { id: 'teal', hex: '#5c818a' },
    { id: 'indigo', hex: '#5d5c8a' },
    { id: 'plum', hex: '#8a5c83' },
    { id: 'wine', hex: '#8a5c60' },
    { id: 'slate', hex: '#8a8a8a' },
  ];

  /** Colours per row of the swatch matrix; the CSS grid uses the same number. */
  const PALETTE_ROW = 8;

  const PALETTE_HEXES = PALETTE.map((swatch) => swatch.hex);

  function isPaletteColor(value) {
    return typeof value === 'string' && PALETTE_HEXES.indexOf(value) !== -1;
  }

  /**
   * A section is where loop, click and the per-part behaviour live — that is how
   * the music is actually structured, and it is how the user thinks. The song
   * panel stays about the song: what it is called, what colour it is, what tempo
   * it starts at, and which sections it contains.
   *
   * A tag the panel does not show is NOT dropped. buildLocatorName below carries
   * it through from the original name, so demoting a control never deletes data.
   *
   * `[ignore]` and `[hidden]` are deliberately absent from both lists. Either one
   * removes the marker from the setlist entirely, and an unlabelled toggle sitting
   * beside STOP and NEXT made a section vanish on a mis-tap. They stay in the
   * locator, carried through untouched; they are simply not switched from here.
   */
  const SECTION_FIELDS = ['name', 'bpm', 'loop', 'stop', 'next', 'click', 'skip', 'jump'];
  const SONG_FIELDS = ['name', 'color', 'bpm', 'stop', 'next', 'skip', 'jump', 'notes'];

  function fieldsFor(kind) {
    return kind === 'song' ? SONG_FIELDS : SECTION_FIELDS;
  }

  /**
   * Normalise what the user typed into the shape buildLocatorName expects.
   * Returns null for a name that would leave the locator unnamed, because an
   * empty locator name is unrecoverable from the setlist UI.
   */
  function readForm(form, kind) {
    const value = (selector) => {
      const el = form.querySelector(selector);
      return el ? el.value : '';
    };
    const checked = (selector) => {
      const el = form.querySelector(selector);
      return Boolean(el && el.checked);
    };

    const name = value('[data-field="name"]').trim();
    if (!name) return null;
    if (name.indexOf('[') !== -1 || name.indexOf(']') !== -1) return null;

    const bpmRaw = value('[data-field="bpm"]').trim();
    const bpm = bpmRaw === '' ? null : Number(bpmRaw);
    if (bpm !== null && (!Number.isFinite(bpm) || bpm <= 0)) return null;

    const loopMode = value('[data-field="loop-mode"]');
    let loopCount = null;
    if (loopMode === 'infinite') {
      loopCount = -1;
    } else if (loopMode === 'count') {
      const times = Number(value('[data-field="loop-times"]').trim());
      if (!Number.isInteger(times) || times < 1) return null;
      loopCount = times;
    }

    const fields = fieldsFor(kind);
    const has = (field) => fields.indexOf(field) !== -1;

    // A jump target is a marker name; brackets would start a tag inside a tag.
    const jump = has('jump') ? value('[data-field="jump"]').trim() : '';
    if (jump.indexOf('[') !== -1 || jump.indexOf(']') !== -1) return null;

    return {
      name,
      bpm,
      loopCount,
      jump,
      // RC Setlist's own memory, like the colour: stored beside the setlist,
      // shown on the card, never written into the locator name.
      notes: has('notes') ? value('[data-field="notes"]').trim() : '',
      stop: has('stop') && checked('[data-field="stop"]'),
      next: has('next') && checked('[data-field="next"]'),
      click: value('[data-field="click"]') || 'inherit',
      skip: has('skip') && checked('[data-field="skip"]'),
      hidden: has('hidden') && checked('[data-field="hidden"]'),
      ignore: has('ignore') && checked('[data-field="ignore"]'),
      color: has('color') ? form.dataset.color || '' : '',
    };
  }

  /**
   * The ramp is one gapless block so the hue order is legible as an order. The
   * clear button sits outside it: it is not a colour and putting it inline broke
   * the run.
   */
  function swatchMarkup(selected) {
    const cells = PALETTE.map((swatch) => {
      const isOn = swatch.hex === selected;
      return (
        '<button type="button" class="marker-swatch' +
        (isOn ? ' is-selected' : '') +
        '"' +
        ' data-swatch="' +
        swatch.hex +
        '"' +
        ' style="--swatch: ' +
        swatch.hex +
        '"' +
        ' aria-pressed="' +
        (isOn ? 'true' : 'false') +
        '"' +
        ' title="' +
        swatch.id +
        '"></button>'
      );
    }).join('');
    const clearOn = !selected;
    return (
      '<div class="marker-swatches" role="group">' +
      '<div class="marker-swatch-ramp">' +
      cells +
      '</div>' +
      '<button type="button" class="marker-swatch marker-swatch-none' +
      (clearOn ? ' is-selected' : '') +
      '"' +
      ' data-swatch="" aria-pressed="' +
      (clearOn ? 'true' : 'false') +
      '" title="none"></button>' +
      '</div>'
    );
  }

  /** The `[...]` blocks of a name, in source order. */
  function splitBlocks(raw) {
    const blocks = [];
    const pattern = /\[([^\]]*)\]/g;
    let match;
    while ((match = pattern.exec(raw)) !== null) blocks.push(match[0]);
    return blocks;
  }

  function blockKey(block) {
    const tag = block.slice(1, -1).trim().toLowerCase();
    if (tag === 'loop' || /^loop\s+\d+x?$/.test(tag)) return 'loop';
    if (/^bpm\s+\d+(?:\.\d+)?$/.test(tag)) return 'bpm';
    if (tag === 'click' || tag === 'click off' || tag === 'click-off') return 'click';
    if (['stop', 'next', 'skip', 'hidden', 'ignore'].indexOf(tag) !== -1) return tag;
    if (/^jump\s+\S/.test(tag)) return 'jump';
    return null;
  }

  /**
   * Whether two locator names mean the same marker.
   *
   * A plain string comparison is not enough. The panel emits tags in one fixed
   * order, so `INTRO [click] [bpm 136]` rebuilds as `INTRO [bpm 136] [click]` —
   * identical in meaning, different as text. Treating that as a change fired a
   * rename on a save where the user touched nothing, and a rename is a delete
   * followed by a recreate: the one operation in this app that can lose a
   * locator. So sameness is judged on the head text plus the multiset of tag
   * blocks, order and spacing ignored.
   */
  function isSameLocatorName(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const head = (raw) =>
      raw
        .replace(/\s*\[[^\]]*\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (head(a) !== head(b)) return false;
    const blocks = (raw) =>
      splitBlocks(raw)
        .map((block) => block.slice(1, -1).trim().replace(/\s+/g, ' ').toLowerCase())
        .sort();
    const left = blocks(a);
    const right = blocks(b);
    return left.length === right.length && left.every((block, i) => block === right[i]);
  }

  /**
   * The prefix a section locator carries in front of its own name.
   *
   * Live holds two spellings of the same relationship: `> VERSO`, where the
   * section belongs to whichever song locator precedes it, and `JÚLIA > VERSO`,
   * which names the song outright. They parse identically — locator-parser.ts
   * takes the section name from after the LAST `>` either way — so rewriting one
   * spelling into the other renames a locator for no reason and scrambles a set
   * that was written consistently in the other one.
   *
   * So the prefix is taken verbatim from the name Live already has, and only the
   * part after the last `>` is rebuilt. The search stops at the first `[` so a
   * `>` inside a tag cannot be mistaken for the separator.
   */
  function sectionPrefix(rawName) {
    if (typeof rawName !== 'string') return '> ';
    const firstTag = rawName.indexOf('[');
    const searchable = firstTag === -1 ? rawName : rawName.slice(0, firstTag);
    const cut = searchable.lastIndexOf('>');
    if (cut === -1) return '> ';
    return rawName.slice(0, cut + 1) + ' ';
  }

  /**
   * Rebuild a locator name from what the panel shows, carrying through every
   * tag it does not show. Two things must survive a save: a tag this build has
   * never heard of, and a tag that is simply not offered for this kind.
   */
  function buildLocatorName(head, read, kind, originalName) {
    const fields = fieldsFor(kind);
    const shows = (field) => fields.indexOf(field) !== -1;
    const parts = [head];

    const carried = splitBlocks(originalName || '').filter((block) => {
      const key = blockKey(block);
      if (key === null) return true; // unknown: always carried
      if (key === 'loop') return !shows('loop');
      return !shows(key);
    });

    if (shows('loop')) {
      if (read.loopCount === -1) parts.push('[loop]');
      else if (typeof read.loopCount === 'number') parts.push('[loop ' + read.loopCount + 'x]');
    }
    if (shows('stop') && read.stop) parts.push('[stop]');
    if (shows('next') && read.next) parts.push('[next]');
    if (shows('bpm') && read.bpm !== null) parts.push('[bpm ' + read.bpm + ']');
    if (shows('click')) {
      if (read.click === 'on') parts.push('[click]');
      else if (read.click === 'off') parts.push('[click off]');
    }
    if (shows('skip') && read.skip) parts.push('[skip]');
    if (shows('jump') && read.jump) parts.push('[jump ' + read.jump + ']');
    if (shows('hidden') && read.hidden) parts.push('[hidden]');
    if (shows('ignore') && read.ignore) parts.push('[ignore]');

    return parts.concat(carried).join(' ').trim();
  }

  function jumpTargets(songs) {
    if (!Array.isArray(songs)) return [];
    const targets = [];
    const simpleSections = [];

    for (const song of songs) {
      if (!song) continue;
      if (song.title && !targets.includes(song.title)) {
        targets.push(song.title);
      }
      if (Array.isArray(song.sections)) {
        for (const sec of song.sections) {
          if (!sec || !sec.name) continue;
          const full = `${song.title} > ${sec.name}`;
          if (!targets.includes(full)) {
            targets.push(full);
          }
          if (!targets.includes(sec.name) && !simpleSections.includes(sec.name)) {
            simpleSections.push(sec.name);
          }
        }
      }
    }

    for (const sec of simpleSections) {
      if (!targets.includes(sec)) {
        targets.push(sec);
      }
    }

    return targets;
  }

  globalScope.RcMarkerEditor = {
    buildLocatorName,
    isSameLocatorName,
    PALETTE_ROW,
    sectionPrefix,
    PALETTE,
    PALETTE_HEXES,
    isPaletteColor,
    fieldsFor,
    readForm,
    swatchMarkup,
    jumpTargets,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
