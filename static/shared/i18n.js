(function rcSetlistI18nModule(globalScope) {
  'use strict';

  const STORAGE_KEY = 'rc-setlist.locale';
  const SUPPORTED_LOCALES = Object.freeze(['en', 'pt-BR']);
  const catalog = Object.freeze({
    'common.language': { en: 'Language', 'pt-BR': 'Idioma' },
    'common.english': { en: 'EN', 'pt-BR': 'EN' },
    'common.portuguese': { en: 'PT', 'pt-BR': 'PT' },

    'common.close': { en: 'Close', 'pt-BR': 'Fechar' },
    'common.none': { en: 'None', 'pt-BR': 'Nenhum' },
    'common.cancel': { en: 'Cancel', 'pt-BR': 'Cancelar' },
    'common.clear': { en: 'Clear', 'pt-BR': 'Limpar' },
    'common.map': { en: 'Map', 'pt-BR': 'Mapear' },
    'common.save': { en: 'Save', 'pt-BR': 'Salvar' },
    'common.removeLine': { en: 'Remove line', 'pt-BR': 'Remover linha' },
    'common.empty': { en: '(empty)', 'pt-BR': '(vazia)' },

    'status.offline': { en: 'OFFLINE', 'pt-BR': 'OFFLINE' },
    'status.connected': { en: 'Connected', 'pt-BR': 'Conectado' },
    'status.connectedUpper': { en: 'CONNECTED', 'pt-BR': 'CONECTADO' },
    'status.reconnecting': { en: 'Reconnecting', 'pt-BR': 'Reconectando' },
    'status.reconnectingUpper': { en: 'RECONNECTING', 'pt-BR': 'RECONECTANDO' },
    'status.disconnected': { en: 'Disconnected', 'pt-BR': 'Desconectado' },
    'status.wsError': { en: 'WS error (see F12 console)', 'pt-BR': 'Erro de WS (veja o console F12)' },
    'status.wsErrorUpper': { en: 'WS ERROR', 'pt-BR': 'ERRO DE WS' },
    'status.readOnly': { en: 'Connected (Read-only)', 'pt-BR': 'Conectado (somente leitura)' },
    'status.bridgeUnavailable': { en: 'Bridge unavailable', 'pt-BR': 'Bridge indisponível' },
    'status.noState': {
      en: 'No show state has been received. Confirm that the Bridge is running in Ableton Live and this device is on the same network.',
      'pt-BR': 'Nenhum estado do show foi recebido. Confirme que o Bridge está em execução no Ableton Live e que este dispositivo está na mesma rede.',
    },
    'status.performanceLost': {
      en: 'The display lost its connection to the Bridge. The last valid state remains visible while reconnection is attempted.',
      'pt-BR': 'A tela perdeu a conexão com o Bridge. O último estado válido permanece visível enquanto tentamos reconectar.',
    },
    'status.panelLost': {
      en: 'The panel lost its connection to the Bridge. The last valid state remains visible while reconnection is attempted.',
      'pt-BR': 'O painel perdeu a conexão com o Bridge. O último estado válido permanece visível enquanto tentamos reconectar.',
    },

    'fullscreen.enter': { en: '⛶ Full screen', 'pt-BR': '⛶ Tela cheia' },

    'fullscreen.enterAria': { en: 'Enter full screen', 'pt-BR': 'Entrar em tela cheia' },
    'fullscreen.enterTitle': { en: 'Enter full screen (F)', 'pt-BR': 'Entrar em tela cheia (F)' },
    'fullscreen.exit': { en: 'Exit full screen', 'pt-BR': 'Sair da tela cheia' },
    'fullscreen.exitTitle': { en: 'Exit full screen (F)', 'pt-BR': 'Sair da tela cheia (F)' },
    'fullscreen.wakeUnsupported': {
      en: 'Full screen is active, but this browser does not support Screen Wake Lock.',
      'pt-BR': 'A tela cheia está ativa, mas este navegador não oferece suporte ao bloqueio de suspensão da tela.',
    },
    'fullscreen.wakeDenied': {
      en: 'Full screen is active, but the browser did not allow the screen to stay awake.',
      'pt-BR': 'A tela cheia está ativa, mas o navegador não permitiu manter a tela ligada.',
    },
    'fullscreen.unavailable': {
      en: 'Full screen is not available in this browser.',
      'pt-BR': 'A tela cheia não está disponível neste navegador.',
    },
    'fullscreen.failed': {
      en: 'Could not enter full screen. The page remains available in normal mode.',
      'pt-BR': 'Não foi possível entrar em tela cheia. A página continua disponível no modo normal.',
    },

    'panel.title': { en: 'Web Panel Access', 'pt-BR': 'Acesso ao painel web' },
    'panel.serverStopped': { en: 'Server stopped', 'pt-BR': 'Servidor parado' },
    'panel.serverRunning': { en: 'Server running', 'pt-BR': 'Servidor em execução' },
    'panel.port': { en: 'Port: {port}', 'pt-BR': 'Porta: {port}' },
    'panel.oscStopped': {
      en: 'Start the server to test AbletonOSC',
      'pt-BR': 'Inicie o servidor para testar o AbletonOSC',
    },
    'panel.oscNoReply': {
      en: 'Waiting for AbletonOSC',
      'pt-BR': 'Aguardando o AbletonOSC',
    },
    'panel.oscPortConflict': {
      en: 'Live active · OSC return port busy',
      'pt-BR': 'Live ativo · porta de retorno OSC ocupada',
    },
    'panel.oscResponding': {
      en: 'Live connected',
      'pt-BR': 'Live conectado',
    },
    'panel.oscStale': {
      en: 'AbletonOSC connection interrupted',
      'pt-BR': 'Conexão com AbletonOSC interrompida',
    },
    'panel.oscTraffic': {
      en: 'UDP {port} · TX {tx} · RX {rx}',
      'pt-BR': 'UDP {port} · TX {tx} · RX {rx}',
    },
    'panel.checkOsc': { en: 'Check OSC', 'pt-BR': 'Verificar OSC' },
    'panel.oscInstallHint': {
      en: 'Install AbletonOSC directly in User Library/Remote Scripts/AbletonOSC — not the hidden User Remote Scripts preferences folder — and confirm __init__.py is directly inside AbletonOSC. Then select it as a Control Surface and restart Live.',
      'pt-BR': 'Instale o AbletonOSC diretamente em User Library/Remote Scripts/AbletonOSC — não na pasta oculta User Remote Scripts das preferências — e confirme que __init__.py está diretamente dentro de AbletonOSC. Depois selecione-o como Control Surface e reinicie o Live.',
    },
    'panel.stageControl': { en: 'Stage Control', 'pt-BR': 'Controle de palco' },
    'panel.performanceDisplay': { en: 'Performance Display', 'pt-BR': 'Tela de performance' },
    'panel.openComputer': { en: 'Open on this computer', 'pt-BR': 'Abrir neste computador' },
    'panel.startPrompt': {
      en: 'Start the server to generate access links and QR codes.',
      'pt-BR': 'Inicie o servidor para gerar links de acesso e códigos QR.',
    },
    'panel.start': { en: 'Start', 'pt-BR': 'Iniciar' },
    'panel.stop': { en: 'Stop', 'pt-BR': 'Parar' },
    'panel.restart': { en: 'Restart', 'pt-BR': 'Reiniciar' },
    'panel.autoStart': { en: 'Start automatically with Live', 'pt-BR': 'Iniciar automaticamente com o Live' },
    'panel.autoStartHint': {
      en: 'Prevents conflicts with other RC extensions. This setting persists between sessions.',
      'pt-BR': 'Evita conflitos com outras extensões RC. Esta configuração é mantida entre sessões.',
    },
    'panel.certificateFirstUse': {
      en: 'First connection: your browser may show ERR_CERT_AUTHORITY_INVALID because RC Setlist creates a local self-signed certificate. Continue only when the address exactly matches the IP shown in the Live panel and you are on a trusted LAN. Each browser/device may require this once.',
      'pt-BR': 'Primeira conexão: o navegador pode mostrar ERR_CERT_AUTHORITY_INVALID porque o RC Setlist cria um certificado local autoassinado. Continue somente se o endereço for exatamente o IP mostrado no painel do Live e a rede local for confiável. Cada navegador/aparelho pode exigir isso uma vez.',
    },
    'panel.on': { en: 'On', 'pt-BR': 'Ligado' },
    'panel.off': { en: 'Off', 'pt-BR': 'Desligado' },
    'panel.actionFailed': {
      en: 'Could not run "{action}": {detail}',
      'pt-BR': 'Não foi possível executar "{action}": {detail}',
    },
    'panel.assetsFailed': {
      en: 'Failed to load panel files: {detail}',
      'pt-BR': 'Falha ao carregar os arquivos do painel: {detail}',
    },

    'performance.name': { en: 'Performance', 'pt-BR': 'Performance' },
    'performance.brandAria': { en: 'Ableton RC Setlist Performance', 'pt-BR': 'Performance do Ableton RC Setlist' },
    'performance.currentStateAria': { en: 'Current show state', 'pt-BR': 'Estado atual do show' },
    'performance.currentSong': { en: 'Current song', 'pt-BR': 'Música atual' },
    'performance.activeSection': { en: 'Active section', 'pt-BR': 'Seção ativa' },
    'performance.next': { en: 'Next', 'pt-BR': 'Próxima' },
    'performance.telemetryAria': { en: 'Show telemetry', 'pt-BR': 'Telemetria do show' },
    'performance.timecode': { en: 'Timecode', 'pt-BR': 'Timecode' },
    'performance.songTime': { en: 'Song: {time}', 'pt-BR': 'Música: {time}' },
    'performance.barBeat': { en: 'Bar / beat', 'pt-BR': 'Compasso / tempo' },
    'performance.bpmClick': { en: 'BPM & click', 'pt-BR': 'BPM e clique' },
    'performance.clickOn': { en: 'Click ON', 'pt-BR': 'Clique LIGADO' },
    'performance.clickOff': { en: 'Click OFF', 'pt-BR': 'Clique DESLIGADO' },
    'performance.lyricsAria': { en: 'Synchronized lyrics', 'pt-BR': 'Letra sincronizada' },
    'performance.lyricsTitle': { en: 'Lyrics / chords', 'pt-BR': 'Letra / cifras' },
    'performance.noLyrics': { en: 'No lyrics loaded for this song.', 'pt-BR': 'Nenhuma letra carregada para esta música.' },
    'performance.endSet': { en: 'END OF SET', 'pt-BR': 'FIM DO SET' },
    'performance.end': { en: 'END', 'pt-BR': 'FIM' },

    'setlist.title': { en: 'Stage Control', 'pt-BR': 'Controle de palco' },
    'setlist.locked': { en: 'Panel locked', 'pt-BR': 'Painel bloqueado' },
    'setlist.unlocked': { en: 'Panel unlocked', 'pt-BR': 'Painel desbloqueado' },
    'setlist.lockWarning': {
      en: '🔒 PANEL LOCKED. Unlock it at the top to perform this action.',
      'pt-BR': '🔒 PAINEL BLOQUEADO. Desbloqueie-o na parte superior para executar esta ação.',
    },
    'setlist.tools': { en: '🛠️ Tools', 'pt-BR': '🛠️ Ferramentas' },
    'setlist.manageSetlists': { en: '⚙️ Manage setlists', 'pt-BR': '⚙️ Gerenciar setlists' },

    'setlist.exportCsv': { en: 'Export CSV', 'pt-BR': 'Exportar CSV' },
    'setlist.exportCsvTitle': { en: 'Export tracklist as CSV', 'pt-BR': 'Exportar repertório como CSV' },
    'setlist.lyrics': { en: 'Lyrics', 'pt-BR': 'Letras' },
    'setlist.midi': { en: 'MIDI mapping', 'pt-BR': 'Mapeamento MIDI' },
    'setlist.help': { en: 'Help', 'pt-BR': 'Ajuda' },
    'setlist.authenticateTitle': {
      en: 'Authenticate or change the security token',
      'pt-BR': 'Autenticar ou alterar o token de segurança',
    },
    'setlist.songsAria': { en: 'Songs and sections', 'pt-BR': 'Músicas e seções' },
    'setlist.songsProject': { en: 'Songs in Project', 'pt-BR': 'Músicas no projeto' },
    'setlist.waitingServer': { en: 'Waiting for the WebSocket server...', 'pt-BR': 'Aguardando o servidor WebSocket...' },
    'setlist.controlsAria': { en: 'Show controls and status', 'pt-BR': 'Controles e estado do show' },
    'setlist.secondaryAria': { en: 'Secondary controls', 'pt-BR': 'Controles secundários' },
    'setlist.transportAria': { en: 'Main transport', 'pt-BR': 'Transporte principal' },
    'setlist.currentSong': { en: 'Active song', 'pt-BR': 'Música ativa' },
    'setlist.activeSection': { en: 'Active section', 'pt-BR': 'Seção ativa' },
    'setlist.automationMarker': { en: 'Automation marker', 'pt-BR': 'Marcador de automação' },
    'setlist.bpmBar': { en: 'BPM / bar', 'pt-BR': 'BPM / compasso' },
    'setlist.showTime': { en: 'Show time', 'pt-BR': 'Tempo do show' },
    'setlist.lyricLine': { en: 'Lyric line', 'pt-BR': 'Linha da letra' },
    'setlist.quantization': { en: 'Quantization', 'pt-BR': 'Quantização' },
    'setlist.preRollLabel': { en: 'COUNT-IN 1 BAR', 'pt-BR': 'CONTAGEM 1 COMP.' },
    'setlist.preRollTitle': {
      en: "Use Ableton Live's Click for a one-bar pre-roll when Play starts from stopped",
      'pt-BR': 'Usar o Click do Ableton Live para uma contagem de um compasso ao iniciar Play com o transporte parado',
    },
    'setlist.refresh': { en: 'Refresh', 'pt-BR': 'Atualizar' },
    'setlist.refreshTitle': { en: 'Reload the setlist from Ableton Live', 'pt-BR': 'Recarregar o setlist do Ableton Live' },
    'setlist.previous': { en: 'Previous', 'pt-BR': 'Anterior' },
    'setlist.previousHold': { en: 'Previous — press and hold', 'pt-BR': 'Anterior — pressione e segure' },
    'setlist.previousSongHold': { en: 'Previous song — press and hold', 'pt-BR': 'Música anterior — pressione e segure' },
    'setlist.previousSectionHold': { en: 'Previous section — press and hold', 'pt-BR': 'Seção anterior — pressione e segure' },
    'setlist.play': { en: 'Play', 'pt-BR': 'Reproduzir' },
    'setlist.stop': { en: 'Stop', 'pt-BR': 'Parar' },
    'setlist.next': { en: 'Next', 'pt-BR': 'Próxima' },
    'setlist.nextHold': { en: 'Next — press and hold', 'pt-BR': 'Próxima — pressione e segure' },
    'setlist.nextSectionHold': { en: 'Next section — press and hold', 'pt-BR': 'Próxima seção — pressione e segure' },
    'setlist.nextSongHold': { en: 'Next song — press and hold', 'pt-BR': 'Próxima música — pressione e segure' },
    'setlist.none': { en: 'None', 'pt-BR': 'Nenhuma' },
    'setlist.bars8': { en: '8 bars', 'pt-BR': '8 compassos' },
    'setlist.bars4': { en: '4 bars', 'pt-BR': '4 compassos' },
    'setlist.bars2': { en: '2 bars', 'pt-BR': '2 compassos' },
    'setlist.bar1': { en: '1 bar', 'pt-BR': '1 compasso' },
    'setlist.showLogs': { en: 'Show logs', 'pt-BR': 'Mostrar logs' },
    'setlist.logReady': {
      en: 'Stage log ready. Waiting for automations...',
      'pt-BR': 'Log de palco pronto. Aguardando automações...',
    },
    'setlist.noSongs': {
      en: 'No songs with locators were found in the project.',
      'pt-BR': 'Nenhuma música com localizadores foi encontrada no projeto.',
    },
    'setlist.activeSetlist': { en: 'Active setlist', 'pt-BR': 'Setlist ativo' },
    'setlist.active': { en: 'Active', 'pt-BR': 'Ativo' },
    'setlist.manageSetlists': { en: 'Manage setlists', 'pt-BR': 'Gerenciar setlists' },
    'setlist.waitingProfiles': { en: 'Waiting for setlists...', 'pt-BR': 'Aguardando setlists...' },
    'setlist.totalDuration': { en: 'Total duration', 'pt-BR': 'Duração total' },
    'setlist.unknownDuration': { en: 'Unknown duration', 'pt-BR': 'Duração desconhecida' },
    'setlist.editSectionHint': {
      en: 'Double-click to rename · Enter to save · Esc to cancel',
      'pt-BR': 'Clique duplo para renomear · Enter para salvar · Esc para cancelar',
    },
    'setlist.sectionEditSaved': {
      en: 'Section updated',
      'pt-BR': 'Seção atualizada',
    },
    'setlist.sectionEditFailed': {
      en: 'Could not edit section',
      'pt-BR': 'Não foi possível editar a seção',
    },
    'setlist.sectionEditEmptyName': {
      en: 'Section name cannot be empty (only tags).',
      'pt-BR': 'O nome da seção não pode ficar vazio (só tags).',
    },
    'setlist.createSetlist': { en: 'Create setlist', 'pt-BR': 'Criar setlist' },
    'setlist.setlistName': { en: 'Setlist name', 'pt-BR': 'Nome do setlist' },
    'setlist.create': { en: 'Create', 'pt-BR': 'Criar' },
    'setlist.savedSetlists': { en: 'Saved setlists', 'pt-BR': 'Setlists salvos' },
    'setlist.rename': { en: 'Rename', 'pt-BR': 'Renomear' },
    'setlist.renameSetlist': { en: 'Rename {name}', 'pt-BR': 'Renomear {name}' },
    'setlist.delete': { en: 'Delete', 'pt-BR': 'Excluir' },
    'setlist.restore': { en: 'Restore', 'pt-BR': 'Restaurar' },
    'setlist.deletedSetlists': { en: 'Deleted setlists', 'pt-BR': 'Setlists excluídos' },
    'setlist.stopLiveFirst': {
      en: 'Stop Ableton Live before changing setlists.',
      'pt-BR': 'Pare o Ableton Live antes de alterar os setlists.',
    },
    'setlist.confirmationName': {
      en: 'Type “{name}” to confirm',
      'pt-BR': 'Digite “{name}” para confirmar',
    },
    'setlist.operationFailed': {
      en: 'The setlist operation failed. Check the stage log and try again.',
      'pt-BR': 'A operação do setlist falhou. Verifique o log de palco e tente novamente.',
    },
    'setlist.noSavedLyrics': { en: '— no saved lyrics —', 'pt-BR': '— nenhuma letra salva —' },
    'setlist.nextValue': { en: 'Next: {name}', 'pt-BR': 'Próxima: {name}' },
    'setlist.nextRepeat': { en: 'Next: {name} (Repeat)', 'pt-BR': 'Próxima: {name} (Repetir)' },
    'setlist.nextEnd': { en: 'Next: End', 'pt-BR': 'Próxima: Fim' },
    'setlist.nextEndSet': { en: 'Next: End of set', 'pt-BR': 'Próxima: Fim do set' },
    'setlist.songTime': { en: 'Song {elapsed} / {duration}', 'pt-BR': 'Música {elapsed} / {duration}' },
    'setlist.songTimeEmpty': { en: 'Song — / —', 'pt-BR': 'Música — / —' },
    'setlist.driftTitle': {
      en: 'Expected {expected} BPM (set by the locator). Live {live}.',
      'pt-BR': 'Esperado: {expected} BPM (definido pelo localizador). Live: {live}.',
    },
    'next.repeat': { en: '{name} (Repeat)', 'pt-BR': '{name} (Repetir)' },

    'midi.title': { en: 'MIDI mapping', 'pt-BR': 'Mapeamento MIDI' },
    'midi.intro': {
      en: 'Connect a USB MIDI controller to this device. Select Map beside an action, then press the pedal or button you want to assign.',
      'pt-BR': 'Conecte um controlador MIDI USB a este dispositivo. Selecione Mapear ao lado de uma ação e pressione o pedal ou botão que deseja atribuir.',
    },
    'midi.device': { en: 'MIDI device:', 'pt-BR': 'Dispositivo MIDI:' },
    'midi.waitingConnection': { en: 'Waiting for a MIDI connection...', 'pt-BR': 'Aguardando uma conexão MIDI...' },
    'midi.mappings': { en: 'Mappings:', 'pt-BR': 'Mapeamentos:' },
    'midi.note': { en: 'Note', 'pt-BR': 'Nota' },
    'midi.action': { en: 'Action', 'pt-BR': 'Ação' },
    'midi.mappedTo': { en: 'Mapped to', 'pt-BR': 'Mapeado para' },
    'midi.control': { en: 'Control', 'pt-BR': 'Controle' },
    'midi.unsupported': { en: 'MIDI is not supported by this browser', 'pt-BR': 'Este navegador não oferece suporte a MIDI' },
    'midi.permissionDenied': { en: 'MIDI permission was denied', 'pt-BR': 'A permissão MIDI foi negada' },
    'midi.noDevices': { en: 'No devices found', 'pt-BR': 'Nenhum dispositivo encontrado' },
    'midi.waiting': { en: 'Waiting for a MIDI message...', 'pt-BR': 'Aguardando uma mensagem MIDI...' },
    'midi.notMapped': { en: 'Not mapped', 'pt-BR': 'Não mapeado' },
    'midi.play': { en: 'Start Playback (PLAY)', 'pt-BR': 'Iniciar reprodução (PLAY)' },
    'midi.stop': { en: 'Stop Playback (STOP)', 'pt-BR': 'Parar reprodução (STOP)' },
    'midi.nextSong': { en: 'Next Song', 'pt-BR': 'Próxima música' },
    'midi.previousSong': { en: 'Previous Song', 'pt-BR': 'Música anterior' },
    'midi.nextSection': { en: 'Next Section', 'pt-BR': 'Próxima seção' },
    'midi.previousSection': { en: 'Previous Section', 'pt-BR': 'Seção anterior' },
    'midi.toggleClick': { en: 'Toggle Click', 'pt-BR': 'Alternar clique' },
    'midi.toggleLock': { en: 'Toggle Panel Lock', 'pt-BR': 'Alternar bloqueio do painel' },
    'midi.toggleCountIn': { en: 'Toggle Count-In Bar', 'pt-BR': 'Alternar compasso de contagem' },

    'keyboard.title': { en: 'Keyboard Mapping', 'pt-BR': 'Mapeamento de Teclado' },
    'keyboard.intro': {
      en: 'Press Map beside an action, then press the key you want to assign. Numpad keys (1–9) and other keys are supported.',
      'pt-BR': 'Pressione Mapear ao lado de uma ação e depois pressione a tecla que deseja atribuir. Teclas numéricas (1–9) e outras são suportadas.',
    },
    'keyboard.mappings': { en: 'Key bindings:', 'pt-BR': 'Atalhos de teclado:' },
    'keyboard.action': { en: 'Action', 'pt-BR': 'Ação' },
    'keyboard.mappedTo': { en: 'Key', 'pt-BR': 'Tecla' },
    'keyboard.control': { en: 'Control', 'pt-BR': 'Controle' },
    'keyboard.waiting': { en: 'Press a key...', 'pt-BR': 'Pressione uma tecla...' },
    'keyboard.notMapped': { en: 'Not mapped', 'pt-BR': 'Não mapeado' },
    'keyboard.play': { en: 'Start Playback (PLAY)', 'pt-BR': 'Iniciar reprodução (PLAY)' },
    'keyboard.stop': { en: 'Stop Playback (STOP)', 'pt-BR': 'Parar reprodução (STOP)' },
    'keyboard.nextSong': { en: 'Next Song', 'pt-BR': 'Próxima música' },
    'keyboard.previousSong': { en: 'Previous Song', 'pt-BR': 'Música anterior' },
    'keyboard.nextSection': { en: 'Next Section', 'pt-BR': 'Próxima seção' },
    'keyboard.previousSection': { en: 'Previous Section', 'pt-BR': 'Seção anterior' },
    'keyboard.toggleClick': { en: 'Toggle Click', 'pt-BR': 'Alternar clique' },
    'keyboard.toggleLock': { en: 'Toggle Panel Lock', 'pt-BR': 'Alternar bloqueio do painel' },
    'keyboard.toggleCountIn': { en: 'Toggle Count-In Bar', 'pt-BR': 'Alternar compasso de contagem' },

    'lyrics.create': { en: 'Create', 'pt-BR': 'Criar' },
    'lyrics.sync': { en: 'Sync', 'pt-BR': 'Sincronizar' },
    'lyrics.edit': { en: 'Edit', 'pt-BR': 'Editar' },
    'lyrics.unsaved': { en: '● unsaved', 'pt-BR': '● não salvo' },
    'lyrics.generator': { en: 'Lyrics (LRC Generator)', 'pt-BR': 'Letras (gerador LRC)' },
    'lyrics.inputIntro': {
      en: 'Paste the song lyrics below, one phrase per line. Then play the song in Ableton Live and mark the exact time each line begins.',
      'pt-BR': 'Cole a letra abaixo, uma frase por linha. Depois reproduza a música no Ableton Live e marque o momento exato em que cada linha começa.',
    },
    'lyrics.selectSong': { en: 'Select a song:', 'pt-BR': 'Selecione uma música:' },
    'lyrics.songLyrics': { en: 'Song lyrics:', 'pt-BR': 'Letra da música:' },
    'lyrics.rawPlaceholder': {
      en: 'Example:\nIntro (G | D | Am | C)\nThe room wakes under amber light\nA quiet pulse becomes our guide...',
      'pt-BR': 'Exemplo:\nIntro (G | D | Am | C)\nA sala desperta sob a luz âmbar\nUm pulso tranquilo se torna nosso guia...',
    },
    'lyrics.startSync': { en: 'Start synchronization ➔', 'pt-BR': 'Iniciar sincronização ➔' },
    'lyrics.syncingSong': { en: 'Synchronizing song:', 'pt-BR': 'Sincronizando música:' },
    'lyrics.currentTime': { en: 'Current time:', 'pt-BR': 'Tempo atual:' },
    'lyrics.nextLine': { en: 'Next line to mark:', 'pt-BR': 'Próxima linha para marcar:' },
    'lyrics.upcoming': { en: 'Upcoming lines:', 'pt-BR': 'Próximas linhas:' },
    'lyrics.reset': { en: 'Reset', 'pt-BR': 'Reiniciar' },
    'lyrics.editing': { en: 'Editing:', 'pt-BR': 'Editando:' },
    'lyrics.addLine': { en: '+ Line', 'pt-BR': '+ Linha' },
    'lyrics.editHelp': {
      en: 'Double-click any line to edit it. Lines without timestamps use [--:--.--] and must be marked before the LRC can be saved.',
      'pt-BR': 'Clique duas vezes em uma linha para editá-la. Linhas sem marcação usam [--:--.--] e precisam ser marcadas antes de salvar o LRC.',
    },
    'lyrics.emptyEditor': {
      en: 'No lines yet. Select "+ Line" to begin, or use Create to generate the base text.',
      'pt-BR': 'Ainda não há linhas. Selecione “+ Linha” para começar ou use Criar para gerar o texto base.',
    },
    'lyrics.saveLrc': { en: 'Save LRC', 'pt-BR': 'Salvar LRC' },
    'lyrics.saveSynchronized': { en: 'Save synchronized lyrics (LRC)', 'pt-BR': 'Salvar letra sincronizada (LRC)' },
    'lyrics.markNow': { en: 'MARK NOW (Press Space)', 'pt-BR': 'MARCAR AGORA (pressione Espaço)' },
    'lyrics.allMarked': { en: 'All lines marked', 'pt-BR': 'Todas as linhas marcadas' },
    'lyrics.end': { en: 'End of lyrics', 'pt-BR': 'Fim da letra' },
    'lyrics.readySave': { en: 'Ready to save', 'pt-BR': 'Pronto para salvar' },
    'lyrics.enterBeforeStart': {
      en: 'Enter or paste the song lyrics before starting.',
      'pt-BR': 'Digite ou cole a letra da música antes de começar.',
    },
    'lyrics.noValidLines': { en: 'No valid lyric lines were found.', 'pt-BR': 'Nenhuma linha de letra válida foi encontrada.' },
    'lyrics.notConnected': { en: 'Not connected to the server.', 'pt-BR': 'Sem conexão com o servidor.' },
    'lyrics.readOnlySave': {
      en: 'Lyrics can only be saved by a synchronized controller.',
      'pt-BR': 'As letras só podem ser salvas por um controlador sincronizado.',
    },
    'lyrics.saveFailed': {
      en: 'Lyrics were not saved. Your edits are still available; check the connection and try again.',
      'pt-BR': 'A letra não foi salva. Suas edições continuam disponíveis; verifique a conexão e tente novamente.',
    },
    'lyrics.savePending': {
      en: 'Wait for the current lyrics save to finish.',
      'pt-BR': 'Aguarde o salvamento atual da letra terminar.',
    },
    'lyrics.invalidTimecode': {
      en: 'Invalid timecode. Use [mm:ss.xx] or leave it empty.',
      'pt-BR': 'Timecode inválido. Use [mm:ss.xx] ou deixe vazio.',
    },
    'lyrics.missingTimecodes': {
      en: 'Every line needs a timestamp before the LRC can be saved.',
      'pt-BR': 'Todas as linhas precisam de uma marcação de tempo antes de salvar o LRC.',
    },
    'lyrics.discardTab': {
      en: 'There are unsaved changes in the Edit tab. Discard them?',
      'pt-BR': 'Há alterações não salvas na aba Editar. Deseja descartá-las?',
    },
    'lyrics.discardSong': {
      en: 'There are unsaved changes. Switching songs will discard your edits. Continue?',
      'pt-BR': 'Há alterações não salvas. Trocar de música descartará suas edições. Continuar?',
    },
    'lyrics.saved': {
      en: 'Lyrics for "{song}" saved ({count} timestamped lines).',
      'pt-BR': 'Letra de "{song}" salva ({count} linhas com marcação de tempo).',
    },
    'lyrics.syncSaved': {
      en: 'Synchronized lyrics for "{song}" saved.',
      'pt-BR': 'Letra sincronizada de "{song}" salva.',
    },

    'feedback.readOnly': {
      en: '⚠ Connected in READ-ONLY mode (no control token)',
      'pt-BR': '⚠ Conectado no modo SOMENTE LEITURA (sem token de controle)',
    },
    'feedback.controller': { en: '✔ Connected as CONTROLLER', 'pt-BR': '✔ Conectado como CONTROLADOR' },
    'feedback.wsHandshake': {
      en: '⚠ WebSocket handshake failed. Check the HTTPS certificate and firewall.',
      'pt-BR': '⚠ Falha no handshake do WebSocket. Verifique o certificado HTTPS e o firewall.',
    },
    'feedback.wsClosed': {
      en: '⚠ WebSocket closed: code={code} reason={reason}',
      'pt-BR': '⚠ WebSocket fechado: código={code} motivo={reason}',
    },
    'feedback.serverError': { en: 'Server error: {detail}', 'pt-BR': 'Erro do servidor: {detail}' },
    'feedback.processError': { en: 'Could not process server message:', 'pt-BR': 'Não foi possível processar a mensagem do servidor:' },
    'setlist.exportCsvTitle': {
      en: 'Export tracklist as CSV (saves a copy in active profile and downloads to your browser)',
      'pt-BR': 'Exportar repertório como CSV (salva uma cópia no perfil ativo e baixa no navegador)',
    },
    'setlist.manageSetlistsTitle': {
      en: 'Manage setlists and profiles (creating, renaming, deleting, and restoring setlists require Live stopped)',
      'pt-BR': 'Gerenciar setlists e perfis (criar, renomear, excluir e restaurar setlists exigem o Live parado)',
    },
    'feedback.csv': {
      en: 'Tracklist exported ({count} songs). Downloaded {fileName}. Check your browser’s Downloads.',
      'pt-BR': 'Repertório exportado ({count} músicas). {fileName} baixado. Confira os Downloads do navegador.',
    },
    'feedback.jumpTimeout': {
      en: '⚠ Ableton Live did not confirm the jump within 3 seconds.',
      'pt-BR': '⚠ O Ableton Live não confirmou o salto em até 3 segundos.',
    },
    'feedback.quantizationFailed': {
      en: '⚠ Ableton Live did not confirm the new quantization.',
      'pt-BR': '⚠ O Ableton Live não confirmou a nova quantização.',
    },
    'feedback.preRollShortened': {
      en: 'Count-in shortened because the selected point is less than one bar from the start of the Live Set.',
      'pt-BR': 'Contagem encurtada porque o ponto selecionado está a menos de um compasso do início do Live Set.',
    },
    'feedback.tokenPrompt': {
      en: 'Enter the security token for control (shown in the Ableton Live panel):',
      'pt-BR': 'Digite o token de segurança para controle (mostrado no painel do Ableton Live):',
    },
    'feedback.tokenUpdated': { en: 'Token updated locally. Reconnecting...', 'pt-BR': 'Token atualizado localmente. Reconectando...' },

    'help.title': { en: 'Syntax & Tag Guide', 'pt-BR': 'Guia de sintaxe e tags' },
    'help.intro': {
      en: 'Add bracketed tags to Ableton Live locators to program automations:',
      'pt-BR': 'Adicione tags entre colchetes aos localizadores do Ableton Live para programar automações:',
    },
    'help.flow': { en: 'Transition & Flow Tags:', 'pt-BR': 'Tags de transição e fluxo:' },
    'help.tag': { en: 'Tag', 'pt-BR': 'Tag' },
    'help.behavior': { en: 'Expected behavior', 'pt-BR': 'Comportamento esperado' },
    'help.loop': {
      en: 'Keeps the section or song playing in an infinite loop.',
      'pt-BR': 'Mantém a seção ou música em reprodução em um loop infinito.',
    },
    'help.loopCount': {
      en: 'Repeats the section exactly four times, then exits the loop.',
      'pt-BR': 'Repete a seção exatamente quatro vezes e depois encerra o loop.',
    },
    'help.stop': {
      en: 'Stops Ableton Live playback when the locator is reached.',
      'pt-BR': 'Interrompe a reprodução do Ableton Live quando o localizador é alcançado.',
    },
    'help.next': {
      en: 'Jumps immediately to the next song and keeps playing.',
      'pt-BR': 'Salta imediatamente para a próxima música e continua reproduzindo.',
    },
    'help.skip': {
      en: 'Skips the segment and advances directly to the next section.',
      'pt-BR': 'Ignora o segmento e avança diretamente para a próxima seção.',
    },
    'help.tempo': { en: 'Metronome & Tempo Tags:', 'pt-BR': 'Tags de metrônomo e tempo:' },
    'help.bpm': {
      en: 'Changes the global Ableton Live tempo when crossed; decimal values are supported.',
      'pt-BR': 'Altera o tempo global do Ableton Live ao ser atravessado; valores decimais são aceitos.',
    },
    'help.clickOn': { en: "Enables Ableton Live's native metronome.", 'pt-BR': 'Ativa o metrônomo nativo do Ableton Live.' },
    'help.clickOff': { en: "Disables Ableton Live's native metronome.", 'pt-BR': 'Desativa o metrônomo nativo do Ableton Live.' },
    'help.extra': { en: 'Extra Features & Filters:', 'pt-BR': 'Recursos extras e filtros:' },
    'help.hidden': {
      en: '[hidden] or the _ prefix: hides the locator from the visual setlist.',
      'pt-BR': '[hidden] ou o prefixo _: oculta o localizador do setlist visual.',
    },
    'help.ignore': {
      en: '[ignore]: hides technical markers or overrides action tags without creating songs, sections or automations.',
      'pt-BR': '[ignore]: oculta marcadores técnicos ou anula tags de ação sem criar músicas, seções ou automações.',
    },
    'help.relativeSyntax': {
      en: '> Section: relative locator attached to the preceding song (e.g. > Intro).',
      'pt-BR': '> Seção: localizador relativo vinculado à música anterior (ex.: > Intro).',
    },
    'help.lock': {
      en: '🔒 Lock Mode: blocks taps and drags on phones or tablets to prevent accidental stage input.',
      'pt-BR': '🔒 Modo bloqueado: impede toques e arrastes em celulares ou tablets para evitar comandos acidentais no palco.',
    },
    'help.metronome': {
      en: '⚡ Visual Metronome: the BPM and bar card flashes with the click using +90 ms network compensation.',
      'pt-BR': '⚡ Metrônomo visual: o cartão de BPM e compasso pisca com o clique usando compensação de rede de +90 ms.',
    },
    'help.loops': {
      en: '↻ Dynamic Loops: the next-section cue shows Next: [Name] (Repeat) while loop iterations remain.',
      'pt-BR': '↻ Loops dinâmicos: a indicação da próxima seção mostra Próxima: [Nome] (Repetir) enquanto restarem iterações.',
    },
    'help.network': {
      en: '🔌 Network Loss: shows an alert if Wi-Fi or the WebSocket connection to Ableton Live drops.',
      'pt-BR': '🔌 Perda de rede: mostra um alerta se o Wi-Fi ou a conexão WebSocket com o Ableton Live cair.',
    },
    'help.hierarchy': { en: 'Locator Hierarchy in Ableton Live:', 'pt-BR': 'Hierarquia de localizadores no Ableton Live:' },
  });

  const listeners = new Set();
  const documentRef = globalScope.document;

  function normalizeLocale(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'pt' || normalized === 'pt-br' || normalized.startsWith('pt-')) return 'pt-BR';
    if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
    return 'en';
  }

  function readStoredLocale() {
    try {
      return globalScope.localStorage?.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  let locale = normalizeLocale(readStoredLocale());

  function interpolate(template, params) {
    return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => (
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
    ));
  }

  function t(key, params = {}, requestedLocale = locale) {
    const entry = catalog[key];
    if (!entry) return key;
    const resolvedLocale = normalizeLocale(requestedLocale);
    return interpolate(entry[resolvedLocale] ?? entry.en ?? key, params);
  }

  function apply(root = documentRef) {
    if (!root?.querySelectorAll) return;
    const mappings = [
      ['data-i18n', 'textContent'],
      ['data-i18n-title', 'title'],
      ['data-i18n-placeholder', 'placeholder'],
      ['data-i18n-aria-label', 'aria-label'],
    ];
    for (const [attribute, property] of mappings) {
      for (const element of root.querySelectorAll(`[${attribute}]`)) {
        const key = element.getAttribute(attribute);
        const value = t(key);
        if (property === 'aria-label') element.setAttribute('aria-label', value);
        else element[property] = value;
      }
    }
    if (documentRef?.documentElement) documentRef.documentElement.lang = locale;
  }

  function notify() {
    apply(documentRef);
    for (const listener of listeners) listener(locale);
    try {
      documentRef?.dispatchEvent?.(new globalScope.CustomEvent('rcsetlist:languagechange', {
        detail: { locale },
      }));
    } catch {
      // Older embedded webviews may not expose CustomEvent.
    }
  }

  function setLocale(value) {
    locale = normalizeLocale(value);
    try {
      globalScope.localStorage?.setItem(STORAGE_KEY, locale);
    } catch {
      // Keep the in-memory choice when storage is unavailable.
    }
    notify();
    return locale;
  }

  function getLocale() {
    return locale;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function bindSelector(selector) {
    if (!selector) return () => {};
    selector.value = locale;
    const change = () => setLocale(selector.value);
    const sync = (nextLocale) => {
      selector.value = nextLocale;
    };
    selector.addEventListener?.('change', change);
    const unsubscribe = subscribe(sync);
    return () => {
      selector.removeEventListener?.('change', change);
      unsubscribe();
    };
  }

  if (documentRef?.documentElement) documentRef.documentElement.lang = locale;
  if (documentRef?.readyState === 'loading') {
    documentRef.addEventListener?.('DOMContentLoaded', () => apply(documentRef), { once: true });
  } else {
    apply(documentRef);
  }

  globalScope.RcSetlistI18n = Object.freeze({
    STORAGE_KEY,
    SUPPORTED_LOCALES,
    normalizeLocale,
    getLocale,
    setLocale,
    t,
    apply,
    bindSelector,
    subscribe,
  });
})(globalThis);
