/**
 * The shell of the panel: the words, the buttons and the way back.
 *
 * The panel is one page that runs in two places: in the kit, where the
 * browser loads the files next to it, and in the modal of Live, where every
 * file travels inside the page. The modules therefore talk to each other
 * through one namespace and never through a global of their own.
 *
 * The words of the labels the shared dictionary does not know live here,
 * in the two languages the panel speaks. Nothing of what the operator
 * types is ever put into the page as markup.
 */
(function () {
  'use strict';

  const Panel = (window.RcPanel = window.RcPanel || {});

  const DICTIONARY = {
    en: {
      'tabs.label': 'Panel sections',
      'tab.main': 'Main',
      'tab.setlist': 'Setlists',
      'tab.network': 'Network',
      'common.refresh': 'Refresh',
      'common.close': 'Close',
      'main.setlist': 'Setlist',
      'main.project': 'Project',
      'main.activeSetlist': 'Active setlist',
      'main.songs': 'Songs',
      'main.duration': 'Show time',
      'main.playing': 'Playing',
      'main.stopped': 'Stopped',
      'main.networkAccess': 'Network access',
      'main.openNetwork': 'Network',
      'main.noProject': 'No project open',
      'main.noSetlist': 'No setlist yet',
      'main.addressUnknown': 'No address yet',
      'setlist.project': 'Project',
      'setlist.active': 'Active setlist',
      'setlist.count': 'Setlists',
      'setlist.setlists': 'Setlists',
      'setlist.choose': 'Setlist',
      'setlist.manage': 'Manage in Stage Control',
      'setlist.empty': 'No setlist in this project yet.',
      'setlist.pick': 'Choose',
      'setlist.activeFlag': 'Active',
      'setlist.lockedPlaying': 'The setlist cannot change while the transport runs.',
      'setlist.lockedSwitching': 'The setlist is being changed. Wait a moment.',
      'setlist.lockedMissing': 'The setlists of this project are not available right now.',
      'setlist.lockedNoProject': 'No project is open in Live.',
      'main.setlists': 'Setlists',
      'main.inSetlist': 'In this setlist',
      'main.now': 'Now',
      'main.sections': '{count} sections',
      'main.noSongs': 'No song with locators in this setlist yet.',
      'setlist.inProject': 'Setlists in {project}',
      'setlist.activePlays': 'The active one plays in Stage Control',
      'setlist.songs': '{count} songs',
      'setlist.activate': 'Activate',
      'setlist.rename': 'Rename',
      'setlist.save': 'Save',
      'setlist.cancel': 'Cancel',
      'setlist.delete': 'Delete',
      'setlist.confirmDelete': 'Delete it?',
      'setlist.restore': 'Restore',
      'setlist.deleted': 'Deleted',
      'setlist.create': 'Create',
      'setlist.newPlaceholder': 'Name of a new setlist',
      'package.title': 'Packages',
      'package.carries': 'Order, lyrics, notes and colours travel together',
      'package.export': 'Export',
      'package.exportHint':
        'Saves every setlist of this Live Set as one package file in the folder.',
      'package.exportAll': 'Export all',
      'package.import': 'Import',
      'package.importHint': 'Pick a package of the folder. Its setlists join the ones you have.',
      'package.importOne': 'Import',
      'package.folder': 'Folder',
      'package.copyPath': 'Copy path',
      'package.copied': 'Copied',
      'package.copyFailed': 'Copy failed',
      'package.none': 'No package in the folder yet.',
      'notice.unavailable': 'The setlists of this project are not available right now.',
      'notice.switching': 'The setlist is being changed. Wait a moment and try again.',
      'notice.playing': 'Setlists cannot change while the transport runs.',
      'notice.unknown': 'That setlist is not part of this project.',
      'notice.noProject': 'No project is open in Live.',
      'notice.selected': 'Setlist "{name}" is active.',
      'notice.duplicate': 'A setlist named "{name}" already exists.',
      'notice.nameMissing': 'Write a name first.',
      'notice.packageMissing': 'Pick a package first.',
      'notice.created': 'Setlist "{name}" created and active.',
      'notice.renamed': 'Renamed to "{name}".',
      'notice.deleted': 'Setlist "{name}" deleted. It can be restored below.',
      'notice.restored': 'Setlist "{name}" restored.',
      'notice.exported': 'Package saved: {file}',
      'notice.imported': '{count} setlist(s) imported from {file}.',
      'notice.failed': 'It did not work: {detail}',
      'option.writeTempoHint': 'Overrides tempo automation drawn in the Arrangement.',
      'network.address': 'Address',
      'network.announced': 'Announced address',
      'network.selectAddress': 'Choose the address',
      'network.snapshot': 'Snapshot',
      'network.protocol': 'Protocol',
      'network.port': 'Port',
      'network.caPort': 'Certificate port',
      'network.coverage': 'Certificate',
      'network.candidates': 'Detected addresses',
      'network.candidatesEmpty': 'No address of the network was found.',
      'network.automatic': 'Automatic (recommended)',
      'network.selected': 'Selected',
      'network.covered': 'The certificate covers this address.',
      'network.notCovered': 'The certificate does not cover this address.',
      'network.caNotReady': 'The server does not serve a local authority yet.',
      'network.coveredShort': 'Covered',
      'network.notCoveredShort': 'Not covered',
      'network.caNotReadyShort': 'Not ready',
      'network.sameSubnet': 'The phone has to be on the same network ({subnet}).',
      'network.lanHelp':
        'The computer may be on Ethernet while the phone is on Wi-Fi: the router joins the two. If it fails, check that both are on the same network, that guest isolation is off and that the firewall lets the port through.',
      'network.copyLink': 'Copy link',
      'network.copyFailed': 'The clipboard is not available here: copy the address below.',
      'network.copied': 'Copied',
      'network.type': 'Type',
      'network.interface': 'Interface',
      'network.gateway': 'Gateway',
      'network.subnet': 'Network',
      'network.defaultRoute': 'default route',
    },
    'pt-BR': {
      'tabs.label': 'Seções do painel',
      'tab.main': 'Principal',
      'tab.setlist': 'Repertório',
      'tab.network': 'Rede',
      'common.refresh': 'Atualizar',
      'common.close': 'Fechar',
      'main.setlist': 'Repertório',
      'main.project': 'Projeto',
      'main.activeSetlist': 'Repertório ativo',
      'main.songs': 'Músicas',
      'main.duration': 'Tempo de show',
      'main.playing': 'Tocando',
      'main.stopped': 'Parado',
      'main.networkAccess': 'Acesso pela rede',
      'main.openNetwork': 'Rede',
      'main.noProject': 'Nenhum projeto aberto',
      'main.noSetlist': 'Nenhum repertório ainda',
      'main.addressUnknown': 'Nenhum endereço ainda',
      'setlist.project': 'Projeto',
      'setlist.active': 'Repertório ativo',
      'setlist.count': 'Repertórios',
      'setlist.setlists': 'Repertórios',
      'setlist.choose': 'Repertório',
      'setlist.manage': 'Gerenciar no Controle de palco',
      'setlist.empty': 'Nenhum repertório neste projeto ainda.',
      'setlist.pick': 'Escolher',
      'setlist.activeFlag': 'Ativo',
      'setlist.lockedPlaying': 'O repertório não pode mudar com o transporte rodando.',
      'setlist.lockedSwitching': 'O repertório está sendo trocado. Espere um instante.',
      'setlist.lockedMissing': 'Os repertórios deste projeto não estão disponíveis agora.',
      'setlist.lockedNoProject': 'Nenhum projeto está aberto no Live.',
      'main.setlists': 'Repertórios',
      'main.inSetlist': 'Neste repertório',
      'main.now': 'Agora',
      'main.sections': '{count} seções',
      'main.noSongs': 'Nenhuma música com locators neste repertório ainda.',
      'setlist.inProject': 'Repertórios de {project}',
      'setlist.activePlays': 'O ativo é o que toca no Controle de palco',
      'setlist.songs': '{count} músicas',
      'setlist.activate': 'Ativar',
      'setlist.rename': 'Renomear',
      'setlist.save': 'Salvar',
      'setlist.cancel': 'Cancelar',
      'setlist.delete': 'Apagar',
      'setlist.confirmDelete': 'Apagar?',
      'setlist.restore': 'Restaurar',
      'setlist.deleted': 'Apagados',
      'setlist.create': 'Criar',
      'setlist.newPlaceholder': 'Nome de um novo repertório',
      'package.title': 'Pacotes',
      'package.carries': 'Ordem, letras, notas e cores vão juntas',
      'package.export': 'Exportar',
      'package.exportHint': 'Grava todos os repertórios deste Live Set num pacote, na pasta.',
      'package.exportAll': 'Exportar todos',
      'package.import': 'Importar',
      'package.importHint':
        'Escolha um pacote da pasta. Os repertórios dele entram ao lado dos seus.',
      'package.importOne': 'Importar',
      'package.folder': 'Pasta',
      'package.copyPath': 'Copiar caminho',
      'package.copied': 'Copiado',
      'package.copyFailed': 'Não copiou',
      'package.none': 'Nenhum pacote na pasta ainda.',
      'notice.unavailable': 'Os repertórios deste projeto não estão disponíveis agora.',
      'notice.switching': 'O repertório está sendo trocado. Espere um momento e tente de novo.',
      'notice.playing': 'Os repertórios não podem mudar com o transporte rodando.',
      'notice.unknown': 'Esse repertório não faz parte deste projeto.',
      'notice.noProject': 'Nenhum projeto está aberto no Live.',
      'notice.selected': 'Repertório "{name}" ativo.',
      'notice.duplicate': 'Já existe um repertório chamado "{name}".',
      'notice.nameMissing': 'Escreva um nome primeiro.',
      'notice.packageMissing': 'Escolha um pacote primeiro.',
      'notice.created': 'Repertório "{name}" criado e ativo.',
      'notice.renamed': 'Renomeado para "{name}".',
      'notice.deleted': 'Repertório "{name}" apagado. Dá para restaurar abaixo.',
      'notice.restored': 'Repertório "{name}" restaurado.',
      'notice.exported': 'Pacote gravado: {file}',
      'notice.imported': '{count} repertório(s) importado(s) de {file}.',
      'notice.failed': 'Não funcionou: {detail}',
      'option.writeTempoHint': 'Substitui a automação de tempo desenhada no Arranjo.',
      'network.address': 'Endereço',
      'network.announced': 'Endereço anunciado',
      'network.selectAddress': 'Escolher endereço',
      'network.snapshot': 'Instantâneo',
      'network.protocol': 'Protocolo',
      'network.port': 'Porta',
      'network.caPort': 'Porta do certificado',
      'network.coverage': 'Certificado',
      'network.candidates': 'Endereços detectados',
      'network.candidatesEmpty': 'Nenhum endereço de rede foi encontrado.',
      'network.automatic': 'Automático (recomendado)',
      'network.selected': 'Selecionado',
      'network.covered': 'O certificado cobre este endereço.',
      'network.notCovered': 'O certificado não cobre este endereço.',
      'network.caNotReady': 'O servidor ainda não serve uma autoridade local.',
      'network.coveredShort': 'Coberto',
      'network.notCoveredShort': 'Não coberto',
      'network.caNotReadyShort': 'Ainda não',
      'network.sameSubnet': 'O celular precisa estar na mesma rede ({subnet}).',
      'network.lanHelp':
        'O computador pode estar no Ethernet e o celular no Wi-Fi: o roteador liga os dois. Se falhar, confirme que os dois estão na mesma rede, que o isolamento de convidados está desligado e que o firewall libera a porta.',
      'network.copyLink': 'Copiar link',
      'network.copyFailed': 'A área de transferência não está disponível: copie o endereço abaixo.',
      'network.copied': 'Copiado',
      'network.type': 'Tipo',
      'network.interface': 'Interface',
      'network.gateway': 'Gateway',
      'network.subnet': 'Rede',
      'network.defaultRoute': 'rota padrão',
    },
  };

  const state = {
    locale: 'en',
    tab: 'main',
    access: 'stage',
    address: '',
  };

  /**
   * The word of a label, in the language of the panel.
   *
   * The labels the shared dictionary knows come from there; the ones it
   * does not know come from the dictionary of the panel.
   */
  function translate(key, params) {
    const table = DICTIONARY[state.locale] || DICTIONARY.en;
    let value = table[key] || DICTIONARY.en[key];
    if (!value) {
      const shared = window.RcSetlistI18n;
      if (shared && typeof shared.t === 'function') {
        value = shared.t(key, params || {});
      } else {
        value = key;
      }
    }
    if (!params) return value;
    return value.replace(/\{(\w+)\}/g, (match, name) => params[name] || match);
  }

  /**
   * Writes the words of the panel into the page.
   */
  function applyLabels(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-rc-text]').forEach((element) => {
      const key = element.getAttribute('data-rc-text');
      if (key) element.textContent = translate(key);
    });
    scope.querySelectorAll('[data-rc-text-aria]').forEach((element) => {
      const key = element.getAttribute('data-rc-text-aria');
      if (key) element.setAttribute('aria-label', translate(key));
    });
  }

  /**
   * Sends what the panel has to say to the extension.
   *
   * The answer travels as one envelope: what to do, and where the operator
   * wants to stay. The extension reads the envelope before it acts.
   */
  function sendAction(action, extra) {
    const envelope = {
      action: action,
      tab: state.tab,
      access: state.access,
      address: state.address,
    };
    if (extra && typeof extra.profileId === 'string') envelope.profileId = extra.profileId;
    if (extra && typeof extra.name === 'string') envelope.name = extra.name;
    if (extra && typeof extra.packageFile === 'string') envelope.packageFile = extra.packageFile;
    postMessage(JSON.stringify(envelope));
  }

  /**
   * Lets a link work, or stops it from working.
   */
  function setLinkEnabled(link, enabled, url) {
    if (!link) return;
    link.href = enabled ? url : '#';
    link.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    link.classList.toggle('is-disabled', !enabled);
  }

  /**
   * Hands a message to the host of the page.
   */
  function postMessage(message) {
    const payload = { method: 'close_and_send', params: [message] };
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.live) {
      window.webkit.messageHandlers.live.postMessage(payload);
    } else if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage(payload);
    }
  }

  /**
   * The element of the page, or nothing.
   */
  function el(id) {
    return document.getElementById(id);
  }

  Panel.shell = {
    state: state,
    text: translate,
    applyLabels: applyLabels,
    sendAction: sendAction,
    setLinkEnabled: setLinkEnabled,
    el: el,
  };
})();
