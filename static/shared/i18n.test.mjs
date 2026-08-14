import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const runtimeUrl = new URL('./i18n.js', import.meta.url);

function loadRuntime({ storedLocale = null, rejectWrites = false } = {}) {
  assert.ok(existsSync(runtimeUrl), 'static/shared/i18n.js must exist');
  const values = new Map();
  if (storedLocale) values.set('rc-setlist.locale', storedLocale);
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (rejectWrites) throw new Error('storage unavailable');
      values.set(key, String(value));
    },
  };
  const documentElement = { lang: 'en' };
  const document = {
    documentElement,
    querySelectorAll() {
      return [];
    },
    dispatchEvent() {},
  };
  const context = {
    console,
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    document,
    localStorage: storage,
  };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(runtimeUrl, 'utf8'), context, { filename: 'i18n.js' });
  return { i18n: context.RcSetlistI18n, storage, documentElement };
}

test('locale runtime normalizes supported locales and defaults to English', () => {
  const { i18n } = loadRuntime();
  assert.equal(i18n.normalizeLocale('pt-br'), 'pt-BR');
  assert.equal(i18n.normalizeLocale('pt'), 'pt-BR');
  assert.equal(i18n.normalizeLocale('en-US'), 'en');
  assert.equal(i18n.normalizeLocale('fr'), 'en');
});

test('locale runtime translates, interpolates and exposes missing keys', () => {
  const { i18n } = loadRuntime();
  assert.equal(i18n.t('common.language', {}, 'pt-BR'), 'Idioma');
  assert.equal(i18n.t('status.connected'), 'Connected');
  assert.equal(i18n.t('next.repeat', { name: 'CHORUS' }, 'pt-BR'), 'CHORUS (Repetir)');
  assert.equal(i18n.t('missing.contract.key'), 'missing.contract.key');
  assert.equal(i18n.t('setlist.preRollLabel'), 'COUNT-IN 1 BAR');
  assert.equal(i18n.t('setlist.preRollLabel', {}, 'pt-BR'), 'CONTAGEM 1 COMP.');
  assert.equal(i18n.t('setlist.previousSongHold'), 'Previous song — press and hold');
  assert.equal(i18n.t('setlist.previousSongHold', {}, 'pt-BR'), 'Música anterior — pressione e segure');
  assert.equal(i18n.t('setlist.previousSectionHold'), 'Previous section — press and hold');
  assert.equal(i18n.t('setlist.previousSectionHold', {}, 'pt-BR'), 'Seção anterior — pressione e segure');
  assert.equal(i18n.t('setlist.nextSectionHold'), 'Next section — press and hold');
  assert.equal(i18n.t('setlist.nextSectionHold', {}, 'pt-BR'), 'Próxima seção — pressione e segure');
  assert.equal(i18n.t('setlist.nextSongHold'), 'Next song — press and hold');
  assert.equal(i18n.t('setlist.nextSongHold', {}, 'pt-BR'), 'Próxima música — pressione e segure');
  assert.match(i18n.t('feedback.preRollShortened', {}, 'pt-BR'), /encurtada/i);
});

test('locale selection persists and survives unavailable storage', () => {
  const first = loadRuntime();
  first.i18n.setLocale('pt-BR');
  assert.equal(first.i18n.getLocale(), 'pt-BR');
  assert.equal(first.storage.getItem('rc-setlist.locale'), 'pt-BR');
  assert.equal(first.documentElement.lang, 'pt-BR');
  assert.equal(first.i18n.t('status.connected'), 'Conectado');

  const unavailable = loadRuntime({ rejectWrites: true });
  unavailable.i18n.setLocale('pt-BR');
  assert.equal(unavailable.i18n.getLocale(), 'pt-BR');
  assert.equal(unavailable.documentElement.lang, 'pt-BR');
});
