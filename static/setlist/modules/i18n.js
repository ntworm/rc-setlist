// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// i18n translation dictionary & helper module for Setlist UI (Task 6.4)

export const TRANSLATIONS = {
  en: {
    appTitle: "Ableton RC Setlist",
    play: "Play",
    stop: "Stop",
    prev: "Previous",
    next: "Next",
    disconnected: "Disconnected from Ableton",
    reconnecting: "Reconnecting to Ableton...",
    emptyProject: "No song markers found in current Live set.",
  },
  pt: {
    appTitle: "Ableton RC Setlist",
    play: "Tocar",
    stop: "Parar",
    prev: "Anterior",
    next: "Próxima",
    disconnected: "Desconectado do Ableton",
    reconnecting: "Reconectando ao Ableton...",
    emptyProject: "Nenhum marcador de música encontrado no projeto do Live.",
  },
};

export function getTranslation(lang, key) {
  const dict = TRANSLATIONS[lang] ?? TRANSLATIONS.en;
  return dict[key] ?? TRANSLATIONS.en[key] ?? key;
}
