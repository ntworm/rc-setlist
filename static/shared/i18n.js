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
    'status.wsError': {
      en: 'WS error (see F12 console)',
      'pt-BR': 'Erro de WS (veja o console F12)',
    },
    'status.wsErrorUpper': { en: 'WS ERROR', 'pt-BR': 'ERRO DE WS' },
    'status.readOnly': { en: 'Connected (Read-only)', 'pt-BR': 'Conectado (somente leitura)' },
    'status.bridgeUnavailable': { en: 'Bridge unavailable', 'pt-BR': 'Bridge indisponível' },
    'status.noState': {
      en: 'No show state has been received. Confirm that the Bridge is running in Ableton Live and this device is on the same network.',
      'pt-BR':
        'Nenhum estado do show foi recebido. Confirme que o Bridge está em execução no Ableton Live e que este dispositivo está na mesma rede.',
    },
    'status.performanceLost': {
      en: 'The display lost its connection to the Bridge. The last valid state remains visible while reconnection is attempted.',
      'pt-BR':
        'A tela perdeu a conexão com o Bridge. O último estado válido permanece visível enquanto tentamos reconectar.',
    },
    'status.panelLost': {
      en: 'The panel lost its connection to the Bridge. The last valid state remains visible while reconnection is attempted.',
      'pt-BR':
        'O painel perdeu a conexão com o Bridge. O último estado válido permanece visível enquanto tentamos reconectar.',
    },

    'fullscreen.enter': { en: '⛶ Full screen', 'pt-BR': '⛶ Tela cheia' },

    'fullscreen.enterAria': { en: 'Enter full screen', 'pt-BR': 'Entrar em tela cheia' },
    'fullscreen.enterTitle': { en: 'Enter full screen (F)', 'pt-BR': 'Entrar em tela cheia (F)' },
    'fullscreen.exit': { en: 'Exit full screen', 'pt-BR': 'Sair da tela cheia' },
    'fullscreen.exitTitle': { en: 'Exit full screen (F)', 'pt-BR': 'Sair da tela cheia (F)' },
    'fullscreen.wakeUnsupported': {
      en: 'Full screen is active, but this browser does not support Screen Wake Lock.',
      'pt-BR':
        'A tela cheia está ativa, mas este navegador não oferece suporte ao bloqueio de suspensão da tela.',
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
      'pt-BR':
        'Não foi possível entrar em tela cheia. A página continua disponível no modo normal.',
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
    'panel.checkOsc': { en: 'Check OSC', 'pt-BR': 'Verificar OSC' },
    'panel.oscVia': {
      en: 'via {name} on port {port}',
      'pt-BR': 'via {name} na porta {port}',
    },
    'panel.bridgeInUse': {
      en: 'RC Bridge is the bundled control surface for this extension. It is in use.',
      'pt-BR': 'O RC Bridge é a control surface que vem com esta extensão. Está em uso.',
    },
    'panel.bridgeMissing': {
      en: 'RC Bridge is not in use. Install it from the kit (RC-Bridge folder: Install-RC-Bridge.cmd on Windows, Install RC Bridge.command on macOS), then in Live: Settings › Link, Tempo & MIDI › Control Surface: RCBridge, and Restart here.',
      'pt-BR':
        'O RC Bridge não está em uso. Instale pelo kit (pasta RC-Bridge: Install-RC-Bridge.cmd no Windows, Install RC Bridge.command no macOS), depois no Live: Configurações › Link, Tempo & MIDI › Control Surface: RCBridge, e Reiniciar aqui.',
    },
    'panel.migrationBadge': { en: '0.x', 'pt-BR': '0.x' },
    'panel.migrationPrompt': {
      en: 'Migrating from a 0.x version? Run the "Migrate RC Setlist Data" script from the kit before opening Live.',
      'pt-BR':
        'Vem de uma versão 0.x? Rode o "Migrate RC Setlist Data" do kit antes de abrir o Live.',
    },
    'panel.migrationHint': {
      en: 'The kit ships with a copy-and-skip migration that leaves your 0.x data untouched.',
      'pt-BR':
        'O kit vem com uma migração que copia sem sobrescrever e deixa os dados 0.x intactos.',
    },
    'panel.durationEstimated': {
      en: 'Setlist duration is estimated (no [bpm] tags in Live markers)',
      'pt-BR': 'Duração do setlist estimada (sem tags [bpm] nos marcadores do Live)',
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
    'marker.title': { en: 'Edit marker', 'pt-BR': 'Editar marcador' },
    'marker.name': { en: 'Name', 'pt-BR': 'Nome' },
    'marker.color': { en: 'Colour', 'pt-BR': 'Cor' },
    'marker.bpm': { en: 'Tempo', 'pt-BR': 'Andamento' },
    'marker.loop': { en: 'Loop', 'pt-BR': 'Loop' },
    'marker.loopOff': { en: 'Off', 'pt-BR': 'Desligado' },
    'marker.loopInfinite': { en: 'Forever', 'pt-BR': 'Para sempre' },
    'marker.loopCount': { en: 'A number of times', 'pt-BR': 'Um número de vezes' },
    'marker.loopTimes': { en: 'Times', 'pt-BR': 'Vezes' },
    'marker.click': { en: 'Click', 'pt-BR': 'Click' },
    'marker.clickInherit': { en: 'Inherit', 'pt-BR': 'Herdar' },
    'marker.clickOn': { en: 'On', 'pt-BR': 'Ligado' },
    'marker.clickOff': { en: 'Off', 'pt-BR': 'Desligado' },
    'marker.stop': { en: 'Stop', 'pt-BR': 'Parar' },
    'marker.next': { en: 'Next', 'pt-BR': 'Próxima' },
    'marker.skip': { en: 'Skip', 'pt-BR': 'Pular' },
    'marker.notes': { en: 'Notes', 'pt-BR': 'Notas' },
    'marker.notesPlaceholder': {
      en: 'Key, tuning, who counts in…',
      'pt-BR': 'Tom, afinação, quem começa…',
    },
    'marker.jump': { en: 'Jump to', 'pt-BR': 'Pular para' },
    'marker.jumpPlaceholder': {
      en: 'Marker name, or Song > Section',
      'pt-BR': 'Nome do marcador, ou Música > Seção',
    },
    'marker.sections': { en: 'Sections', 'pt-BR': 'Seções' },
    'marker.invalid': {
      en: 'Check the name and the tempo. The name cannot be empty or contain brackets.',
      'pt-BR': 'Confira o nome e o andamento. O nome não pode ficar vazio nem conter colchetes.',
    },
    'panel.writeTempoOnJump': {
      en: 'Set Live tempo on jump',
      'pt-BR': 'Definir o tempo do Live ao pular',
    },
    'panel.writeTempoOnJumpHint': {
      en: 'Leave off if the Arrangement has tempo automation: writing the tempo overrides it.',
      'pt-BR':
        'Deixe desligado se o Arrangement tem automação de tempo: escrever o tempo sobrepõe ela.',
    },
    'panel.autoStart': {
      en: 'Start automatically with Live',
      'pt-BR': 'Iniciar automaticamente com o Live',
    },
    'panel.autoStartHint': {
      en: 'Prevents conflicts with other RC extensions. This setting persists between sessions.',
      'pt-BR':
        'Evita conflitos com outras extensões RC. Esta configuração é mantida entre sessões.',
    },
    'panel.on': { en: 'On', 'pt-BR': 'Ligado' },
    'panel.off': { en: 'Off', 'pt-BR': 'Desligado' },

    'performance.name': { en: 'Performance', 'pt-BR': 'Performance' },
    'performance.brandAria': { en: 'RC Setlist Performance', 'pt-BR': 'Performance do RC Setlist' },
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
    'performance.noLyrics': {
      en: 'No lyrics loaded for this song.',
      'pt-BR': 'Nenhuma letra carregada para esta música.',
    },
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

    'setlist.exportCsv': { en: 'Export CSV', 'pt-BR': 'Exportar CSV' },
    'setlist.lyrics': { en: 'Lyrics', 'pt-BR': 'Letras' },
    'setlist.help': { en: 'Help', 'pt-BR': 'Ajuda' },
    'setlist.authenticateTitle': {
      en: 'Authenticate or change the security token',
      'pt-BR': 'Autenticar ou alterar o token de segurança',
    },
    'setlist.songsAria': { en: 'Songs and sections', 'pt-BR': 'Músicas e seções' },
    'setlist.songsProject': { en: 'Songs in Project', 'pt-BR': 'Músicas no projeto' },
    'setlist.waitingServer': {
      en: 'Waiting for the WebSocket server...',
      'pt-BR': 'Aguardando o servidor WebSocket...',
    },
    'setlist.controlsAria': {
      en: 'Show controls and status',
      'pt-BR': 'Controles e estado do show',
    },
    'setlist.secondaryAria': { en: 'Secondary controls', 'pt-BR': 'Controles secundários' },
    'setlist.transportAria': { en: 'Main transport', 'pt-BR': 'Transporte principal' },
    'setlist.currentSong': { en: 'Active song', 'pt-BR': 'Música ativa' },
    'setlist.activeSection': { en: 'Active section', 'pt-BR': 'Seção ativa' },
    'setlist.automationMarker': { en: 'Automation marker', 'pt-BR': 'Marcador de automação' },
    'setlist.bpmBar': { en: 'BPM / bar', 'pt-BR': 'BPM / compasso' },
    'setlist.showTime': { en: 'Show time', 'pt-BR': 'Tempo do show' },
    'setlist.lyricLine': { en: 'Lyric line', 'pt-BR': 'Linha da letra' },
    'setlist.quantization': { en: 'Quantization', 'pt-BR': 'Quantização' },
    'setlist.preRollLabel': { en: 'COUNT-IN 1 BAR', 'pt-BR': 'CONTAGEM 1C' },
    'setlist.preRollTitle': {
      en: 'Visual 1-bar count-in before Play; browser click optional',
      'pt-BR': 'Contagem visual de 1 compasso antes do Play; click do navegador opcional',
    },
    'setlist.metronomeTitle': {
      en: 'Toggle metronome in Ableton Live',
      'pt-BR': 'Ligar ou desligar o metrônomo no Ableton Live',
    },
    'setlist.refresh': { en: 'Refresh', 'pt-BR': 'Atualizar' },
    'setlist.refreshTitle': {
      en: 'Reload the setlist from Ableton Live',
      'pt-BR': 'Recarregar o setlist do Ableton Live',
    },
    'setlist.previousSongHold': {
      en: 'Previous song — press and hold',
      'pt-BR': 'Música anterior — pressione e segure',
    },
    'setlist.previousSectionHold': {
      en: 'Previous section — press and hold',
      'pt-BR': 'Seção anterior — pressione e segure',
    },
    'setlist.play': { en: 'Play', 'pt-BR': 'Reproduzir' },
    'setlist.stop': { en: 'Stop — press and hold', 'pt-BR': 'Parar — pressione e segure' },
    'setlist.nextSectionHold': {
      en: 'Next section — press and hold',
      'pt-BR': 'Próxima seção — pressione e segure',
    },
    'setlist.nextSongHold': {
      en: 'Next song — press and hold',
      'pt-BR': 'Próxima música — pressione e segure',
    },
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
    'setlist.durationEstimatedTitle': {
      en: 'Duration is estimated (no [bpm] tags in Live markers)',
      'pt-BR': 'Duração estimada (sem tags [bpm] nos marcadores do Live)',
    },
    'setlist.markerEditSaved': {
      en: 'Marker updated',
      'pt-BR': 'Marcador atualizado',
    },
    'setlist.markerSaving': {
      en: 'Still saving that marker — try again in a moment',
      'pt-BR': 'Ainda salvando esse marcador — tente de novo em um instante',
    },
    'setlist.markerEditFailed': {
      en: 'Could not edit marker',
      'pt-BR': 'Não foi possível editar o marcador',
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
    'setlist.songTime': { en: 'Song {elapsed} / {duration}', 'pt-BR': 'Música {elapsed} / {duration}' }, // prettier-ignore
    'setlist.songTimeEmpty': { en: 'Song — / —', 'pt-BR': 'Música — / —' },
    'setlist.driftTitle': {
      en: 'Expected {expected} BPM (set by the locator). Live {live}.',
      'pt-BR': 'Esperado: {expected} BPM (definido pelo localizador). Live: {live}.',
    },
    'next.repeat': { en: '{name} (Repeat)', 'pt-BR': '{name} (Repetir)' },

    'midi.title': { en: 'MIDI mapping', 'pt-BR': 'Mapeamento MIDI' },
    'midi.intro': {
      en: 'Connect a USB MIDI controller to this device. Select Map beside an action, then press the pedal or button you want to assign.',
      'pt-BR':
        'Conecte um controlador MIDI USB a este dispositivo. Selecione Mapear ao lado de uma ação e pressione o pedal ou botão que deseja atribuir.',
    },
    'midi.device': { en: 'MIDI device:', 'pt-BR': 'Dispositivo MIDI:' },
    'midi.waitingConnection': {
      en: 'Waiting for a MIDI connection...',
      'pt-BR': 'Aguardando uma conexão MIDI...',
    },
    'midi.mappings': { en: 'Mappings:', 'pt-BR': 'Mapeamentos:' },
    'midi.action': { en: 'Action', 'pt-BR': 'Ação' },
    'midi.mappedTo': { en: 'Mapped to', 'pt-BR': 'Mapeado para' },
    'midi.control': { en: 'Control', 'pt-BR': 'Controle' },
    'midi.unsupported': {
      en: 'MIDI is not supported by this browser',
      'pt-BR': 'Este navegador não oferece suporte a MIDI',
    },
    'midi.permissionDenied': {
      en: 'MIDI permission was denied',
      'pt-BR': 'A permissão MIDI foi negada',
    },
    'midi.noDevices': { en: 'No devices found', 'pt-BR': 'Nenhum dispositivo encontrado' },
    'midi.waiting': {
      en: 'Waiting for a MIDI message...',
      'pt-BR': 'Aguardando uma mensagem MIDI...',
    },
    'midi.notMapped': { en: 'Not mapped', 'pt-BR': 'Não mapeado' },
    'midi.play': { en: 'Start Playback (PLAY)', 'pt-BR': 'Iniciar reprodução (PLAY)' },
    'midi.stop': { en: 'Stop Playback (STOP)', 'pt-BR': 'Parar reprodução (STOP)' },
    'midi.nextSong': { en: 'Next Song', 'pt-BR': 'Próxima música' },
    'midi.previousSong': { en: 'Previous Song', 'pt-BR': 'Música anterior' },
    'midi.nextSection': { en: 'Next Section', 'pt-BR': 'Próxima seção' },
    'midi.previousSection': { en: 'Previous Section', 'pt-BR': 'Seção anterior' },
    'midi.toggleClick': { en: 'Toggle Click', 'pt-BR': 'Alternar clique' },
    'midi.toggleLock': { en: 'Toggle Panel Lock', 'pt-BR': 'Alternar bloqueio do painel' },
    'midi.toggleCountIn': {
      en: 'Toggle Count-In Bar',
      'pt-BR': 'Alternar contagem de entrada (1 comp.)',
    },

    'keyboard.title': { en: 'Keyboard Mapping', 'pt-BR': 'Mapeamento de Teclado' },
    'keyboard.intro': {
      en: 'Press Map beside an action, then press the key you want to assign. Numpad keys (1–9) and other keys are supported.',
      'pt-BR':
        'Pressione Mapear ao lado de uma ação e depois pressione a tecla que deseja atribuir. Teclas numéricas (1–9) e outras são suportadas.',
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
    'keyboard.toggleCountIn': {
      en: 'Toggle Count-In Bar',
      'pt-BR': 'Alternar contagem de entrada (1 comp.)',
    },

    'lyrics.create': { en: 'Create', 'pt-BR': 'Criar' },
    'lyrics.sync': { en: 'Sync', 'pt-BR': 'Sincronizar' },
    'lyrics.edit': { en: 'Edit', 'pt-BR': 'Editar' },
    'lyrics.unsaved': { en: '● unsaved', 'pt-BR': '● não salvo' },
    'lyrics.generator': { en: 'Lyrics (LRC Generator)', 'pt-BR': 'Letras (gerador LRC)' },
    'lyrics.inputIntro': {
      en: 'Paste the song lyrics below, one phrase per line. Then play the song in Ableton Live and mark the exact time each line begins.',
      'pt-BR':
        'Cole a letra abaixo, uma frase por linha. Depois reproduza a música no Ableton Live e marque o momento exato em que cada linha começa.',
    },
    'lyrics.selectSong': { en: 'Select a song:', 'pt-BR': 'Selecione uma música:' },
    'lyrics.songLyrics': { en: 'Song lyrics:', 'pt-BR': 'Letra da música:' },
    'lyrics.rawPlaceholder': {
      en: 'Example:\nIntro (G | D | Am | C)\nThe room wakes under amber light\nA quiet pulse becomes our guide...',
      'pt-BR':
        'Exemplo:\nIntro (G | D | Am | C)\nA sala desperta sob a luz âmbar\nUm pulso tranquilo se torna nosso guia...',
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
      'pt-BR':
        'Clique duas vezes em uma linha para editá-la. Linhas sem marcação usam [--:--.--] e precisam ser marcadas antes de salvar o LRC.',
    },
    'lyrics.emptyEditor': {
      en: 'No lines yet. Select "+ Line" to begin, or use Create to generate the base text.',
      'pt-BR':
        'Ainda não há linhas. Selecione “+ Linha” para começar ou use Criar para gerar o texto base.',
    },
    'lyrics.saveLrc': { en: 'Save LRC', 'pt-BR': 'Salvar LRC' },
    'lyrics.saveSynchronized': {
      en: 'Save synchronized lyrics (LRC)',
      'pt-BR': 'Salvar letra sincronizada (LRC)',
    },
    'lyrics.markNow': { en: 'MARK NOW (Press Space)', 'pt-BR': 'MARCAR AGORA (pressione Espaço)' },
    'lyrics.allMarked': { en: 'All lines marked', 'pt-BR': 'Todas as linhas marcadas' },
    'lyrics.end': { en: 'End of lyrics', 'pt-BR': 'Fim da letra' },
    'lyrics.readySave': { en: 'Ready to save', 'pt-BR': 'Pronto para salvar' },
    'lyrics.enterBeforeStart': {
      en: 'Enter or paste the song lyrics before starting.',
      'pt-BR': 'Digite ou cole a letra da música antes de começar.',
    },
    'lyrics.noValidLines': {
      en: 'No valid lyric lines were found.',
      'pt-BR': 'Nenhuma linha de letra válida foi encontrada.',
    },
    'lyrics.notConnected': {
      en: 'Not connected to the server.',
      'pt-BR': 'Sem conexão com o servidor.',
    },
    'lyrics.readOnlySave': {
      en: 'Lyrics can only be saved by a synchronized controller.',
      'pt-BR': 'As letras só podem ser salvas por um controlador sincronizado.',
    },
    'lyrics.saveFailed': {
      en: 'Lyrics were not saved. Your edits are still available; check the connection and try again.',
      'pt-BR':
        'A letra não foi salva. Suas edições continuam disponíveis; verifique a conexão e tente novamente.',
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
    'feedback.controller': {
      en: '✔ Connected as CONTROLLER',
      'pt-BR': '✔ Conectado como CONTROLADOR',
    },
    'feedback.wsHandshake': {
      en: '⚠ WebSocket handshake failed. Check the HTTPS certificate and firewall.',
      'pt-BR': '⚠ Falha no handshake do WebSocket. Verifique o certificado HTTPS e o firewall.',
    },
    'feedback.wsClosed': {
      en: '⚠ WebSocket closed: code={code} reason={reason}',
      'pt-BR': '⚠ WebSocket fechado: código={code} motivo={reason}',
    },
    'feedback.serverError': { en: 'Server error: {detail}', 'pt-BR': 'Erro do servidor: {detail}' },
    'setlist.exportCsvTitle': {
      en: 'Export tracklist as CSV (saves a copy in active profile and downloads to your browser)',
      'pt-BR':
        'Exportar repertório como CSV (salva uma cópia no perfil ativo e baixa no navegador)',
    },
    'setlist.manageSetlistsTitle': {
      en: 'Manage setlists and profiles (creating, renaming, deleting, and restoring setlists require Live stopped)',
      'pt-BR':
        'Gerenciar setlists e perfis (criar, renomear, excluir e restaurar setlists exigem o Live parado)',
    },
    'feedback.csv': {
      en: 'Tracklist exported ({count} songs). Downloaded {fileName}. Check your browser’s Downloads.',
      'pt-BR':
        'Repertório exportado ({count} músicas). {fileName} baixado. Confira os Downloads do navegador.',
    },
    'feedback.jumpTimeout': {
      en: '⚠ Ableton Live did not confirm the jump within 3 seconds.',
      'pt-BR': '⚠ O Ableton Live não confirmou o salto em até 3 segundos.',
    },
    'feedback.quantizationFailed': {
      en: '⚠ Ableton Live did not confirm the new quantization.',
      'pt-BR': '⚠ O Ableton Live não confirmou a nova quantização.',
    },
    'feedback.tokenPrompt': {
      en: 'Enter the security token for control (shown in the Ableton Live panel):',
      'pt-BR': 'Digite o token de segurança para controle (mostrado no painel do Ableton Live):',
    },
    'feedback.tokenUpdated': {
      en: 'Token updated locally. Reconnecting...',
      'pt-BR': 'Token atualizado localmente. Reconectando...',
    },

    'help.title': { en: 'Syntax & Tag Guide', 'pt-BR': 'Guia de sintaxe e tags' },
    'help.intro': {
      en: 'Add bracketed tags to Ableton Live locators to program automations:',
      'pt-BR':
        'Adicione tags entre colchetes aos localizadores do Ableton Live para programar automações:',
    },
    'help.flow': { en: 'Transition & Flow Tags:', 'pt-BR': 'Tags de transição e fluxo:' },
    'help.tag': { en: 'Tag', 'pt-BR': 'Tag' },
    'help.behavior': { en: 'Expected behavior', 'pt-BR': 'Comportamento esperado' },
    'help.loop': {
      en: 'Keeps the section or song playing in an infinite loop.',
      'pt-BR': 'Mantém a seção ou música em reprodução contínua em loop infinito.',
    },
    'help.loopCount': {
      en: 'Repeats the section exactly four times, then exits the loop.',
      'pt-BR': 'Repete a seção exatamente 4 vezes e depois segue com a reprodução normal.',
    },
    'help.stop': {
      en: 'Stops Ableton Live playback when the locator is reached.',
      'pt-BR': 'Interrompe a reprodução do Ableton Live assim que o localizador é atingido.',
    },
    'help.next': {
      en: "When the playhead reaches this marker, playback moves to the start of the next song and keeps going. Put it on the marker where a song's audio ends to chain straight into the next song.",
      'pt-BR':
        'Quando a reprodução atinge este marcador, o Live salta imediatamente para o início da próxima música e continua tocando. Posicione no ponto em que o áudio da música termina para emendar diretamente na próxima faixa.',
    },
    'help.skip': {
      en: 'When the playhead reaches this marker, playback moves to the marker after it: the next section, or the next song if this was the last section. The tagged part is never heard.',
      'pt-BR':
        'Ao atingir este marcador, a reprodução avança para o marcador seguinte (a próxima seção ou, se for a última seção, a próxima música). O trecho posterior ao marcador é ignorado e não toca.',
    },
    'help.jump': {
      en: 'When the playhead reaches this marker, playback moves to the marker called NAME: a section of this song, a song, or Song > Section. Same timing as [next] and [skip].',
      'pt-BR':
        'Ao atingir este marcador, a reprodução salta para o marcador indicado em NOME: uma seção da mesma música, outra música ou Música > Seção. Mesma resposta de tempo de [next] e [skip].',
    },
    'help.nextVsSkip': { en: '[next] or [skip]?', 'pt-BR': '[next] ou [skip]?' },
    'help.nextVsSkipNext': {
      en: '[next] always goes to the next song. On a section it leaves the song from that point; it never advances to the next section.',
      'pt-BR':
        '[next] sempre pula para a próxima música. Quando usado em uma seção, encerra a música atual imediatamente a partir daquele ponto, sem avançar para a próxima seção.',
    },
    'help.nextVsSkipSkip': {
      en: '[skip] goes to whatever comes right after the marker. On a section that is the next section of the same song; on a song, or on its last section, it is the next song.',
      'pt-BR':
        '[skip] avança para o elemento imediatamente posterior na timeline. Em uma seção, pula para a próxima seção da mesma música; na última seção ou na música, pula para a próxima música.',
    },
    'help.nextVsSkipTiming': {
      en: 'Both hand over the moment the marker is reached — about a tenth of a second later, never before — not on the next bar. The target always starts from its first beat.',
      'pt-BR':
        'Ambos executam a transição no instante exato em que o marcador é atingido (com atraso imperceptível de ~100 ms, nunca antes), sem esperar o próximo compasso. O destino sempre inicia no primeiro tempo (downbeat).',
    },
    'help.exampleChain': {
      en: 'Chaining songs: skip the empty bars between them',
      'pt-BR': 'Emendando músicas: pulando os compassos vazios entre elas',
    },
    'help.exampleChainBody': {
      en: "> End sits where Song A's audio ends. Reaching it starts Song B at once, so the gap between the two is never played.",
      'pt-BR':
        '> End deve ser posicionado exatamente onde termina o áudio da Música A. Ao atingi-lo, a Música B inicia imediatamente, sem tocar o silêncio ou compassos vazios entre as duas.',
    },
    'help.tempo': { en: 'Metronome & Tempo Tags:', 'pt-BR': 'Tags de metrônomo e andamento:' },
    'help.bpm': {
      en: 'Declares the tempo of this song or section, which is what the setlist durations are calculated from. Decimals are supported. It only writes the tempo into Live when Set Live tempo on jump is switched on in the Live panel, and RC Setlist disarms that write on its own when it detects arrangement tempo automation.',
      'pt-BR':
        'Define o andamento (BPM) da música ou seção, servindo de base para o cálculo de duração no setlist. Aceita decimais. Só altera o tempo no Live quando a opção "Definir o tempo do Live ao pular" estiver ativa no painel do Live; o RC Setlist desativa essa alteração automaticamente ao detectar automação de andamento no Arrangement.',
    },
    'help.clickOn': {
      en: "Enables Ableton Live's native metronome.",
      'pt-BR': 'Ativa o metrônomo nativo do Ableton Live.',
    },
    'help.clickOff': {
      en: "Disables Ableton Live's native metronome.",
      'pt-BR': 'Desativa o metrônomo nativo do Ableton Live.',
    },
    'help.extra': { en: 'Extra Features & Filters:', 'pt-BR': 'Recursos adicionais e filtros:' },
    'help.hidden': {
      en: '[hidden] or the _ prefix: hides the locator from the visual setlist.',
      'pt-BR': '[hidden] ou o prefixo _: oculta o localizador da visualização do setlist.',
    },
    'help.ignore': {
      en: 'Hides the marker and overrides any other tag on it: no song, section or automation is created.',
      'pt-BR':
        'Oculta o marcador e anula qualquer outra tag nele: nenhuma música, seção ou automação é criada.',
    },
    'help.relativeSyntax': {
      en: '> Section: relative locator attached to the preceding song (e.g. > Intro).',
      'pt-BR': '> Seção: localizador relativo vinculado à música anterior (ex.: > Intro).',
    },
    'help.lock': {
      en: '🔒 Lock Mode: blocks taps and drags on phones or tablets to prevent accidental stage input.',
      'pt-BR':
        '🔒 Bloqueio de tela: bloqueia toques e arrastes em celulares ou tablets, evitando comandos acidentais no palco.',
    },
    'help.metronome': {
      en: '⚡ Visual Metronome: the BPM and bar card flashes with the click using +90 ms network compensation.',
      'pt-BR':
        '⚡ Metrônomo visual: o card de BPM e compasso pisca em sincronia com o clique (com compensação de rede de +90 ms).',
    },
    'help.loops': {
      en: '↻ Dynamic Loops: the next-section cue shows Next: [Name] (Repeat) while loop iterations remain.',
      'pt-BR':
        '↻ Loops dinâmicos: a indicação de próxima seção exibe Próxima: [Nome] (Repetir) enquanto restarem repetições.',
    },
    'help.network': {
      en: '🔌 Network Loss: shows an alert if Wi-Fi or the WebSocket connection to Ableton Live drops.',
      'pt-BR':
        '🔌 Queda de conexão: exibe um alerta caso o Wi-Fi ou a conexão WebSocket com o Ableton Live seja interrompida.',
    },
    'help.editing': {
      en: 'Writing tags without typing them:',
      'pt-BR': 'Configurando tags sem precisar digitá-las:',
    },
    'help.editingBody': {
      en: 'Double-click a song row or a section chip to open the marker editor. Every tag there is a control, so you never type brackets and cannot delete one by accident. A tag the panel does not show is carried through your edit untouched. Editing is refused while the transport is playing.',
      'pt-BR':
        'Dê um duplo clique na linha de uma música ou no chip de uma seção para abrir o editor de marcadores. Nele, cada tag é acionada por um botão visual interativo, dispensando a digitação manual de colchetes e evitando exclusões acidentais. Tags não exibidas no editor são preservadas intactas. A edição fica bloqueada enquanto o Live estiver em reprodução.',
    },
    'help.colour': {
      en: 'Colour is not a tag. It is chosen in the same panel, stored beside your setlist, never written into the Live project, and it follows a song through renames and moves.',
      'pt-BR':
        'A cor não é uma tag. Ela é selecionada no mesmo painel e salva junto ao setlist (sem alterar o projeto do Live), acompanhando a música mesmo ao renomeá-la ou reposicioná-la.',
    },
    'help.prefixEquivalence': {
      en: 'Both spellings of a section are valid and are never rewritten: > Verse attaches to the song above it, and Song A > Verse names the song outright.',
      'pt-BR':
        'Ambas as formas de declarar uma seção são válidas e mantidas intactas: "> Verso" vincula-se à música anterior, enquanto "Música A > Verso" especifica a música diretamente no nome.',
    },
    'help.durationNote': {
      en: 'Without any [bpm] tag the whole set is timed at one frozen tempo, and an EST. badge marks the durations as estimates. One tag per song, plus one wherever the tempo changes inside a song, is what makes the times exact.',
      'pt-BR':
        'Sem nenhuma tag [bpm], todo o setlist calcula o tempo com base em um andamento fixo, indicando durações estimadas com o selo EST.. Inserir uma tag por música (e onde o andamento mudar dentro da música) é o que torna os tempos exatos.',
    },
    'help.exampleTempo': {
      en: 'A song whose tempo changes partway through:',
      'pt-BR': 'Música com mudança de andamento no decorrer do arranjo:',
    },
    'help.hierarchy': {
      en: 'Locator Hierarchy in Ableton Live:',
      'pt-BR': 'Hierarquia de localizadores no Ableton Live:',
    },
  });

  const listeners = new Set();
  const documentRef = globalScope.document;

  function normalizeLocale(value) {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    if (normalized === 'pt' || normalized === 'pt-br' || normalized.startsWith('pt-'))
      return 'pt-BR';
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
    return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
    );
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
      documentRef?.dispatchEvent?.(
        new globalScope.CustomEvent('rcsetlist:languagechange', {
          detail: { locale },
        }),
      );
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
