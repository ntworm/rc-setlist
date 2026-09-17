import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'marker-editor.js'), 'utf8');
const scope = {};
vm.runInNewContext(source, { globalThis: scope });
const editor = scope.RcMarkerEditor;

/** Minimal stand-in for the panel form: only what readForm actually touches. */
function fakeForm(values, color) {
  return {
    dataset: { color: color ?? '' },
    querySelector(selector) {
      const field = /\[data-field="([^"]+)"\]/.exec(selector)?.[1];
      if (field === undefined || !(field in values)) return null;
      const value = values[field];
      return typeof value === 'boolean' ? { checked: value } : { value: String(value) };
    },
  };
}

test('the palette has sixteen colours and none of them is the RC accent', () => {
  assert.equal(editor.PALETTE.length, 16);
  assert.equal(new Set(editor.PALETTE_HEXES).size, 16, 'no colour is offered twice');
  assert.equal(
    editor.PALETTE_HEXES.includes('#ffa133'),
    false,
    'orange is RC focus, not a song colour',
  );
});

test('the original eight colours are still in the palette', () => {
  // A song's colour is stored as its hex. Dropping or altering one of these
  // would leave a saved value isPaletteColor no longer recognises, and the card
  // would silently lose its paint.
  for (const hex of [
    '#d9c7a7',
    '#d6a89a',
    '#d9a3b0',
    '#bfa8d1',
    '#9db8d4',
    '#98c4c0',
    '#a9c4a0',
    '#c9c9c9',
  ]) {
    assert.equal(
      editor.PALETTE_HEXES.includes(hex),
      true,
      `${hex} was already assignable to a song`,
    );
  }
});

const hueOf = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return null;
  const d = max - min;
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
};

test('hue climbs across each row and the neutral ends it', () => {
  // Left to right has to be the colour wheel, otherwise the strip is a bag of
  // swatches and picking two that read apart on stage is guesswork.
  const rows = editor.PALETTE.length / editor.PALETTE_ROW;
  assert.equal(rows, 2);

  for (let row = 0; row < rows; row++) {
    const cells = editor.PALETTE.slice(row * editor.PALETTE_ROW, (row + 1) * editor.PALETTE_ROW);
    const hues = cells.map((cell) => hueOf(cell.hex));
    assert.equal(hues[hues.length - 1], null, `row ${row} must end on its neutral`);
    for (let i = 1; i < hues.length - 1; i++) {
      assert.ok(hues[i] > hues[i - 1], `hue must climb: ${cells[i].id} breaks row ${row}`);
    }
  }
});

test('the second row deepens the first rather than repeating it', () => {
  const value = (hex) => Math.max(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  for (let i = 0; i < editor.PALETTE_ROW; i++) {
    const light = editor.PALETTE[i];
    const deep = editor.PALETTE[i + editor.PALETTE_ROW];
    assert.ok(
      value(light.hex) - value(deep.hex) > 40,
      `${deep.id} must read clearly deeper than ${light.id}`,
    );
  }

  // Its hues fall between the ones above, so the matrix holds fifteen distinct
  // hues plus two neutrals instead of eight hues twice over.
  const top = editor.PALETTE.slice(0, editor.PALETTE_ROW - 1).map((c) => hueOf(c.hex));
  const bottom = editor.PALETTE.slice(editor.PALETTE_ROW, -1).map((c) => hueOf(c.hex));
  for (const hue of bottom) {
    assert.ok(
      top.every((other) => Math.abs(hue - other) > 8),
      `${hue.toFixed(0)}deg repeats a hue from the row above`,
    );
  }
});

test('no two colours in the ramp are close enough to be confused', () => {
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (let i = 0; i < editor.PALETTE.length; i++) {
    for (let j = i + 1; j < editor.PALETTE.length; j++) {
      const [a, b] = [rgb(editor.PALETTE[i].hex), rgb(editor.PALETTE[j].hex)];
      const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      assert.ok(
        distance > 19,
        `${editor.PALETTE[i].id} and ${editor.PALETTE[j].id} are too close (${distance.toFixed(1)})`,
      );
    }
  }
});

test('no palette colour collides with a state colour from the theme contract', () => {
  const stateHues = ['#30d158', '#ff375f', '#0a84ff', '#bf5af2', '#ffa133'];
  for (const hex of editor.PALETTE_HEXES) {
    assert.equal(stateHues.includes(hex), false, `${hex} would be read as state, not identity`);
  }
});

test('every palette colour is desaturated enough to read as identity', () => {
  // Saturation is what separates identity from state. A vivid swatch would
  // compete with ARMED and ERR under stage light.
  for (const hex of editor.PALETTE_HEXES) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    assert.ok(saturation < 0.35, `${hex} is too saturated (${saturation.toFixed(2)})`);
  }
});

test('a section offers no colour field, a song does', () => {
  assert.equal(editor.fieldsFor('section').includes('color'), false);
  assert.equal(editor.fieldsFor('song').includes('color'), true);
});

test('a blank name is rejected rather than leaving the locator unnamed', () => {
  assert.equal(editor.readForm(fakeForm({ name: '   ' }), 'song'), null);
});

test('brackets in the name field are rejected, because tags are controls here', () => {
  assert.equal(editor.readForm(fakeForm({ name: 'INTRO [bpm 136]' }), 'song'), null);
});

test('an empty tempo field means no bpm tag, not a bad value', () => {
  const result = editor.readForm(fakeForm({ name: 'INTRO', bpm: '' }), 'song');
  assert.equal(result.bpm, null);
});

test('a nonsense tempo is rejected', () => {
  assert.equal(editor.readForm(fakeForm({ name: 'A', bpm: 'abc' }), 'song'), null);
  assert.equal(editor.readForm(fakeForm({ name: 'A', bpm: '0' }), 'song'), null);
  assert.equal(editor.readForm(fakeForm({ name: 'A', bpm: '-5' }), 'song'), null);
});

test('loop reads as off, infinite, or a count', () => {
  assert.equal(
    editor.readForm(fakeForm({ name: 'A', 'loop-mode': 'off' }), 'song').loopCount,
    null,
  );
  assert.equal(
    editor.readForm(fakeForm({ name: 'A', 'loop-mode': 'infinite' }), 'song').loopCount,
    -1,
  );
  assert.equal(
    editor.readForm(fakeForm({ name: 'A', 'loop-mode': 'count', 'loop-times': '4' }), 'song')
      .loopCount,
    4,
  );
  assert.equal(
    editor.readForm(fakeForm({ name: 'A', 'loop-mode': 'count', 'loop-times': '0' }), 'song'),
    null,
    'a loop of zero times is not a loop',
  );
});

test('a section cannot switch on a song-only tag', () => {
  const result = editor.readForm(fakeForm({ name: 'VERSO', hidden: true }), 'section');
  assert.equal(result.hidden, false, 'hidden is not offered to a section, so it stays off');
});

test('the colour only comes through for a song', () => {
  assert.equal(editor.readForm(fakeForm({ name: 'A' }), 'song', '#d9c7a7').color, '');
  assert.equal(editor.readForm(fakeForm({ name: 'A' }, '#d9c7a7'), 'song').color, '#d9c7a7');
  assert.equal(editor.readForm(fakeForm({ name: 'A' }, '#d9c7a7'), 'section').color, '');
});

test('the swatch strip marks the selected colour and offers a way back to none', () => {
  const markup = editor.swatchMarkup('#d9c7a7');
  assert.match(markup, /data-swatch="#d9c7a7"[^>]*aria-pressed="true"/);
  assert.match(markup, /data-swatch=""/, 'clearing the colour must always be reachable');

  const cleared = editor.swatchMarkup('');
  assert.match(cleared, /marker-swatch-none[^>]*is-selected/);
});

test('isPaletteColor refuses anything outside the palette', () => {
  assert.equal(editor.isPaletteColor('#d9c7a7'), true);
  assert.equal(editor.isPaletteColor('#ff0000'), false);
  assert.equal(editor.isPaletteColor(''), false);
  assert.equal(editor.isPaletteColor(null), false);
});

test('the song panel does not offer loop or click: those belong to a section', () => {
  const songFields = editor.fieldsFor('song');
  assert.equal(songFields.includes('loop'), false);
  assert.equal(songFields.includes('click'), false);
  assert.equal(editor.fieldsFor('section').includes('loop'), true);
  assert.equal(editor.fieldsFor('section').includes('click'), true);
});

test('a tag the panel does not show survives the save', () => {
  // The song panel dropped the loop and click controls. Demoting a control must
  // never delete the data behind it.
  const read = editor.readForm(fakeForm({ name: 'INTRO', bpm: '136' }), 'song');
  const out = editor.buildLocatorName(
    'INTRO',
    read,
    'song',
    'INTRO [loop 4x] [click off] [bpm 136]',
  );
  assert.match(out, /\[loop 4x\]/, 'a song-level loop is carried through, not deleted');
  assert.match(out, /\[click off\]/);
  assert.match(out, /\[bpm 136\]/);
});

test('an unknown tag survives the save from either panel', () => {
  const read = editor.readForm(fakeForm({ name: 'DERRETE', bpm: '110' }), 'song');
  const out = editor.buildLocatorName('DERRETE', read, 'song', 'DERRETE [bpm 110] [mood dark]');
  assert.match(out, /\[mood dark\]/);
});

test('a field the panel does show is rewritten, not duplicated', () => {
  const read = editor.readForm(fakeForm({ name: 'INTRO', bpm: '128' }), 'song');
  const out = editor.buildLocatorName('INTRO', read, 'song', 'INTRO [bpm 136]');
  assert.equal(out, 'INTRO [bpm 128]');
  assert.equal(
    (out.match(/\[bpm/g) || []).length,
    1,
    'the old tempo must not linger beside the new one',
  );
});

test('clearing a shown field removes its tag while unshown ones stay', () => {
  const read = editor.readForm(fakeForm({ name: 'INTRO', bpm: '' }), 'song');
  const out = editor.buildLocatorName('INTRO', read, 'song', 'INTRO [bpm 136] [loop]');
  assert.equal(out, 'INTRO [loop]');
});

test('the section panel rewrites loop and click, and carries a song-only tag', () => {
  const read = editor.readForm(
    fakeForm({
      name: 'VERSO I',
      bpm: '107',
      'loop-mode': 'count',
      'loop-times': '2',
      click: 'off',
    }),
    'section',
  );
  const out = editor.buildLocatorName(
    'JÚLIA > VERSO I',
    read,
    'section',
    'JÚLIA > VERSO I [loop] [hidden]',
  );
  assert.match(out, /\[loop 2x\]/);
  assert.doesNotMatch(out, /\[loop\]/, 'the old infinite loop is replaced, not kept');
  assert.match(out, /\[hidden\]/, 'hidden is not a section control, so it is carried');
  assert.match(out, /\[bpm 107\]/);
});

test('a relative section keeps its bare prefix instead of gaining a song title', () => {
  // The set under test writes sections as `> VERSO`. Composing the prefix from
  // the song title rewrote every one of them into `JÚLIA > VERSO` the moment the
  // panel touched it — a rename the user never asked for.
  assert.equal(editor.sectionPrefix('> VERSO I [bpm 107]'), '> ');
  const read = editor.readForm(fakeForm({ name: 'VERSO I', bpm: '107' }), 'section');
  const head = editor.sectionPrefix('> VERSO I [bpm 107]') + read.name;
  assert.equal(
    editor.buildLocatorName(head, read, 'section', '> VERSO I [bpm 107]'),
    '> VERSO I [bpm 107]',
  );
});

test('an absolute section keeps its song title prefix', () => {
  assert.equal(editor.sectionPrefix('JÚLIA > VERSO I'), 'JÚLIA > ');
  assert.equal(editor.sectionPrefix('TÁ TUDO DANÇANDO > CHORUS [stop]'), 'TÁ TUDO DANÇANDO > ');
});

test('a > inside a tag is not mistaken for the separator', () => {
  assert.equal(editor.sectionPrefix('> BREAK [note a>b]'), '> ');
});

test('a section with no separator at all still gets a valid one', () => {
  assert.equal(editor.sectionPrefix('VERSO'), '> ');
  assert.equal(editor.sectionPrefix(undefined), '> ');
});

test('neither panel can switch a tag that would hide the marker', () => {
  // [ignore] and [hidden] remove the marker from the setlist. An unlabelled
  // toggle beside STOP made a section disappear on a mis-tap.
  for (const kind of ['song', 'section']) {
    assert.equal(editor.fieldsFor(kind).includes('ignore'), false);
    assert.equal(editor.fieldsFor(kind).includes('hidden'), false);
  }
});

test('an [ignore] already on a section survives a save from the panel', () => {
  const read = editor.readForm(fakeForm({ name: 'VERSO III' }), 'section');
  const out = editor.buildLocatorName('> VERSO III', read, 'section', '> VERSO III [ignore]');
  assert.match(out, /\[ignore\]/);
});

test('reordering tags is not a change: a no-op save must not trigger a rename', () => {
  // A rename is a delete plus a recreate. Firing one when the user changed
  // nothing puts the locator at risk for no reason.
  assert.equal(
    editor.isSameLocatorName('INTRO [bpm 136] [click]', 'INTRO [click] [bpm 136]'),
    true,
  );
  assert.equal(editor.isSameLocatorName('> VERSO  [bpm 107]', '> VERSO [bpm  107]'), true);
  assert.equal(editor.isSameLocatorName('INTRO [bpm 136]', 'INTRO [bpm 137]'), false);
  assert.equal(editor.isSameLocatorName('INTRO [bpm 136]', 'ABERTURA [bpm 136]'), false);
  assert.equal(editor.isSameLocatorName('INTRO [bpm 136]', 'INTRO [bpm 136] [stop]'), false);
  assert.equal(editor.isSameLocatorName('INTRO', undefined), false);
});

test('a jump target is a text field on both panels and is written as [jump NAME]', () => {
  const read = editor.readForm(
    fakeForm({ name: 'VERSO', bpm: '', jump: ' Refrão II ' }),
    'section',
  );
  assert.equal(read.jump, 'Refrão II', 'trimmed, spelling kept');
  const out = editor.buildLocatorName('> VERSO', read, 'section', '> VERSO [mood dark]');
  assert.equal(out, '> VERSO [jump Refrão II] [mood dark]');
  const song = editor.readForm(fakeForm({ name: 'A', bpm: '', jump: 'B > Chorus' }), 'song');
  assert.equal(editor.buildLocatorName('A', song, 'song', 'A'), 'A [jump B > Chorus]');
});

test('a jump target with brackets is rejected, and clearing it removes the tag', () => {
  assert.equal(
    editor.readForm(fakeForm({ name: 'VERSO', bpm: '', jump: 'x [y]' }), 'section'),
    null,
  );
  const cleared = editor.readForm(fakeForm({ name: 'VERSO', bpm: '100', jump: '' }), 'section');
  assert.equal(
    editor.buildLocatorName('> VERSO', cleared, 'section', '> VERSO [jump Chorus] [bpm 100]'),
    '> VERSO [bpm 100]',
  );
});

test('an existing [jump] is recognised as the jump field, not carried as an unknown tag', () => {
  const read = editor.readForm(fakeForm({ name: 'VERSO', bpm: '', jump: 'Ponte' }), 'section');
  const out = editor.buildLocatorName('> VERSO', read, 'section', '> VERSO [JUMP old target]');
  assert.equal(out, '> VERSO [jump Ponte]');
  assert.equal(
    editor.isSameLocatorName('> A [jump X] [stop]', '> A [stop] [jump x]'),
    true,
    'tag order and keyword case do not matter',
  );
});

test('notes belong to the song panel only and never enter the locator name', () => {
  const song = editor.readForm(
    fakeForm({ name: 'JÚLIA', bpm: '160', notes: '  Sol maior · capo 2 ' }),
    'song',
  );
  assert.equal(song.notes, 'Sol maior · capo 2');
  assert.equal(
    editor.buildLocatorName('JÚLIA', song, 'song', 'JÚLIA [bpm 160]'),
    'JÚLIA [bpm 160]',
    'notes are RC Setlist memory, not a tag',
  );
  const section = editor.readForm(
    fakeForm({ name: 'VERSO', bpm: '', notes: 'ignored' }),
    'section',
  );
  assert.equal(section.notes, '', 'a section has no notes field');
});

test('jumpTargets returns unique titles and sections in order', () => {
  const songs = [
    { title: 'Agua Gelada', sections: [{ name: 'Verso' }, { name: 'Refrao' }] },
    { title: 'Julia', sections: [{ name: 'Refrao' }] },
  ];
  const expected = [
    'Agua Gelada',
    'Agua Gelada > Verso',
    'Agua Gelada > Refrao',
    'Julia',
    'Julia > Refrao',
    'Verso',
    'Refrao',
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(editor.jumpTargets(songs))), expected);
  assert.deepEqual(JSON.parse(JSON.stringify(editor.jumpTargets(null))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(editor.jumpTargets([{ title: 'A', sections: [] }]))), [
    'A',
  ]);
});
