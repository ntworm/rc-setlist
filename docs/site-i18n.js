(function rcSetlistSiteI18n(globalScope) {
  'use strict';

  // English is the markup itself: every translatable node carries a key, and
  // its English text is read from the page on load. Only Portuguese lives here,
  // so the two languages cannot drift apart by one side being edited alone.
  const STORAGE_KEY = 'rc-setlist.locale';

  const ptBR = {
    'meta.title': 'RC Setlist — extensão de setlist e letra para Ableton Live',
    'meta.description':
      'Extensão de setlist para Ableton Live 12, grátis para uso não comercial: os locators do Arrangement viram o setlist de quem opera e a tela de palco da banda, com letra sincronizada, no celular ou tablet.',

    skip: 'Pular para o conteúdo',
    'top.req': 'Live 12.4.5+ Suite',
    'top.language': 'Idioma',
    'top.navAria': 'Seções',
    'nav.about': 'Sobre',
    'nav.chain': 'Como funciona',
    'nav.locators': 'Locators',
    'nav.views': 'Duas telas',
    'nav.safety': 'Segurança',
    'nav.install': 'Instalação',
    'nav.trouble': 'Problemas',
    'nav.docs': 'Docs',

    'about.lede':
      'Os locators do seu Arrangement viram o show: o setlist de quem opera, a tela de palco de quem toca. O Live manda no tempo; o navegador só acompanha.',

    'about.tagline':
      'Setlist, letra sincronizada e tela de palco para o Ableton Live 12 — grátis para uso não comercial.',
    'about.spec1': 'Live 12.4.5+ Suite (Beta)',
    'about.spec2': 'RC Bridge incluído',
    'about.spec3': 'Qualquer navegador da sua rede',
    'about.spec4': 'Sem conta · sem telemetria',
    'about.download': 'Baixar .ablx',
    'about.docs': 'Ler a documentação',
    'about.new': 'O que há de novo na 1.0.0',
    'about.source': 'Código-fonte',
    'about.release':
      'Versão 1.0.0&nbsp;· source-available sob a PolyForm Noncommercial 1.0.0&nbsp;· inglês e português (Brasil) no mesmo pacote',
    'about.figCap': 'As duas telas, exatamente como vêm',
    'about.figMeta': 'Prints reais · dados fictícios de demonstração',
    'about.figAlt':
      'Controle de palco: setlist de cinco músicas com seções e tags, a música 3 destacada como ativa, estado do show, quantização, click e transporte.',

    'chain.title': 'Cadeia de sinal <span class="tail">— quem manda no tempo é o Live</span>',
    'chain.why':
      'O Live toca; o RC Setlist lê a posição e pede os saltos; os navegadores só mostram o que o Live confirmou.',
    'chain.node0': 'Arrangement · locators · transporte · andamento',
    'chain.node1': 'Parser · agendador de saltos · perfis · letras',
    'chain.node2': 'Controle de palco · operador',
    'chain.node3': 'Performance · banda · somente leitura',
    'chain.down': '<i>▼</i> Comandos (saída)',
    'chain.up': '<i>▲</i> Estado (entrada)',
    'chain.needTitle': 'Do que você precisa',
    'chain.thPiece': 'Componente',
    'chain.thWhere': 'Onde',
    'chain.thRole': 'Função',
    'chain.liveWhere': 'O computador',
    'chain.liveRole': 'Roda a extensão. O Arrangement é a referência de tudo.',
    'chain.bridgeWhere': 'No Live, como Control Surface',
    'chain.bridgeRole':
      'Transporte, saltos e posição da música. Vem no kit; um AbletonOSC comum também funciona.',
    'chain.browser': 'Um navegador',
    'chain.browserWhere': 'Notebook, tablet ou celular',
    'chain.browserRole': 'Abre as duas telas por link ou QR code. Não precisa instalar nada.',
    'chain.lanTag': 'SÓ REDE LOCAL',
    'chain.lan': 'Mantenha o link do controlador privado e nunca exponha a porta 4444 na internet.',

    'loc.title': 'Locators <span class="tail">— do Arrangement ao palco</span>',
    'loc.why':
      'Dê nome aos locators uma vez só. Músicas, seções e tags saem direto do Arrangement, e nada escondido é gravado no seu projeto.',
    'loc.figCap': 'O que você digita no Live, o que o operador vê',
    'loc.figMeta': 'Ilustração desta página',
    'loc.inLive': 'Locators do Arrangement',
    'loc.end': 'Fim do Arrangement · compasso 81',
    'loc.reads': 'O RC Setlist lê',
    'loc.inStage': 'No Controle de palco — os cards que ele mostra',
    'loc.songs': 'Músicas no projeto',
    'loc.total': 'Duração total',
    'loc.figFoot':
      'Uma música vai até o locator da próxima, contando o intervalo: 40 compassos a 120 BPM dão 1:20. O [next] pula os compassos vazios.',
    'loc.tagsTitle': 'Tags disponíveis',
    'loc.thTag': 'No locator',
    'loc.thDoes': 'O que acontece',
    'loc.thCard': 'No card',
    'loc.tBpm': 'Informa o BPM. As durações ficam exatas.',
    'loc.tClick': 'Liga ou desliga o click (metrônomo) do Live nesse locator.',
    'loc.tLoop': 'Repete a seção até você desligar o loop, ou N vezes.',
    'loc.tNext': 'Pula para a próxima música assim que o Live passa por esse locator.',
    'loc.tStop': 'Para o Live nesse locator.',
    'loc.tSkip': 'Pula esta música ou seção.',
    'loc.tJump': 'Pula para uma música ou seção pelo nome.',
    'loc.tHidden': 'Esconde do setlist um locator usado só para automação.',
    'loc.tIgnore': 'Locator técnico: fica oculto e as tags dele não fazem nada.',
    'loc.tagsNote':
      'Tanto faz maiúscula ou minúscula, e as tags não aparecem no nome exibido. Fora [hidden] e [ignore], você nem precisa digitá-las: dê dois cliques numa música ou seção no Controle de palco e cada tag vira um controle.',
    'loc.durTitle': 'Duração do set',
    'loc.durCap': 'Um set medido, três formas de contar',
    'loc.durMeta': '21 músicas · de 93 a 166 BPM',
    'loc.durA': '[bpm] em todas as músicas',
    'loc.durAsub': 'Exata, música a música',
    'loc.durB': 'Sem tags · Live em 99 BPM',
    'loc.durBsub': '16:59 a mais',
    'loc.durC': 'Sem tags · Live em 136 BPM',
    'loc.durCsub': '9:03 a menos',
    'loc.durFoot':
      'Nenhuma extensão consegue ler a automação de andamento sem tocar a música. Use [bpm] e o aviso EST. some.',

    'views.title': 'Duas telas <span class="tail">— figs. 4 a 6</span>',
    'views.why':
      'O Controle de palco é de quem opera o show. A Performance é de quem toca: só leitura, alto contraste, dá para ler preso no pedestal do microfone.',
    'views.pick': 'Escolha uma tela',
    'views.tabStage': 'Controle de palco',
    'views.tabPerf': 'Performance',
    'views.tabPhone': 'Performance · celular',
    'views.stageCap': 'Controle de palco — /setlist, para quem opera',
    'views.stageAlt': 'Controle de palco com regiões numeradas.',
    'views.thRegion': 'Área',
    'views.thWhat': 'O que faz',
    'views.s1': 'Setlist ativo',
    'views.s1d': 'Vários setlists salvos por Live Set: ordem do show, ensaio, um set mais curto.',
    'views.s2': 'Músicas',
    'views.s2d':
      'Um card por música, com as tags e a duração à direita. Arraste para mudar a ordem.',
    'views.s3': 'Tocando agora',
    'views.s3d':
      'Borda laranja na música e na seção que estão tocando. Segure uma seção e solte para pular para ela.',
    'views.s4': 'Duração total',
    'views.s4d': 'O set inteiro, do locator da primeira música até o fim do Arrangement.',
    'views.s5': 'Estado do show',
    'views.s5d': 'Música e seção atuais e as próximas, BPM, compasso, tempo do show e da música.',
    'views.s6': 'Linha da letra',
    'views.s6d': 'A linha que está sendo cantada agora.',
    'views.s7': 'Quantização · click',
    'views.s7d': 'Grade dos saltos, click do Live, contagem de um compasso e botão de atualizar.',
    'views.s8': 'Transporte',
    'views.s8d':
      'Música ou seção anterior e próxima, Play e Stop. Tudo, menos o Play, pede para segurar o botão — veja 5.0.',
    'views.s9': 'Topo',
    'views.s9d':
      'Idioma, bloqueio do painel, ferramentas de letra e exportação, tela cheia, conexão.',
    'views.perfCap': 'Performance — /performance, para a banda',
    'views.perfAlt': 'Tela Performance com regiões numeradas.',
    'views.p1': 'Música atual',
    'views.p1d': 'Título, tags e a próxima música.',
    'views.p2': 'Seção ativa',
    'views.p2d': 'Onde a banda está, quantas repetições faltam, qual seção vem depois.',
    'views.p3': 'Letra · cifras',
    'views.p3d': 'A letra sincronizada acompanha a música; a linha atual fica destacada.',
    'views.p4': 'Timecode',
    'views.p4d': 'Tempo do show em relação ao total, e o tempo dentro da música.',
    'views.p5': 'Compasso · tempo',
    'views.p5d': 'Onde o Live está, em compassos e tempos.',
    'views.p6': 'BPM · click',
    'views.p6d': 'O andamento e se o click está ligado — escrito na tela, não só pela cor.',
    'views.p7': 'Conexão · tela cheia',
    'views.p7d': 'Estado da conexão; em tela cheia, a tela não apaga (quando o navegador permite).',
    'views.phoneCap': 'Performance no celular, na vertical',
    'views.phoneAlt':
      'Tela Performance num celular na vertical: cards de música e seção, letra, timecode, compasso e BPM.',
    'views.f1': 'Música',
    'views.f1d': 'Atual e seguinte.',
    'views.f2': 'Seção',
    'views.f2d': 'Repetições do loop e andamento em destaque.',
    'views.f3': 'Letra',
    'views.f3d': 'A linha cantada, numa fonte condensada para o verso caber na largura.',
    'views.f4': 'Indicadores',
    'views.f4d': 'Timecode, compasso e tempo, BPM e click.',
    'views.lrcTitle': 'A letra é um arquivo LRC comum',
    'views.lrcAria': 'Exemplo de LRC',
    'views.lrcNote':
      'Cole a letra, marque o tempo de cada linha com a música tocando, edite e salve. Ela fica no perfil ativo, fora do Live Set. Texto sem tempo também funciona.',

    'safety.title': 'Segurança no palco <span class="tail">— nada dispara sem querer</span>',
    'safety.why':
      'Todo botão que pode parar o show precisa ser segurado, não só tocado. Nada de janela de confirmação no meio da música.',
    'safety.figCap': 'Segurar para enviar — próxima música, seção anterior, Stop',
    'safety.figMeta': 'De 0 a 800 ms',
    'safety.holdAria':
      'Toque rápido: nada é enviado. Segurar por 500 milissegundos: o comando é enviado. Arrastar o dedo para fora antes dos 500 milissegundos: cancela.',
    'safety.tap': 'Toque',
    'safety.tapOut': 'Nada enviado',
    'safety.hold': 'Segurar',
    'safety.holdOut': 'Enviado aos 500 ms',
    'safety.slide': 'Arrastar para fora',
    'safety.slideOut': 'Cancelado',
    'safety.figFoot':
      'O Play é o único controle que responde a um toque. O bloqueio do painel desativa todos os controles, inclusive o Play, no aparelho que o ativou.',
    'safety.qTitle': 'Saltos quantizados',
    'safety.qBody':
      'O pedido de salto vai na hora para o Live, que executa no próximo tempo da grade.',
    'safety.ask': 'Salto pedido, compasso 2 tempo 3',
    'safety.land': 'Executado, compasso 3 tempo 1',
    'safety.cTitle': 'Contagem de um compasso',
    'safety.cBody':
      'Com a CONTAGEM ligada e o Live parado, o Play conta um compasso no próprio botão, no andamento definido no setlist, e dispara o Live no primeiro tempo. Por padrão é só visual: o celular nunca apita no palco.',
    'safety.lTitle': 'Travado enquanto toca',
    'safety.lBody':
      'Editar locators, trocar de setlist e mudar o idioma ficam bloqueados enquanto o Live toca.',
    'safety.rTitle': 'Quedas de conexão',
    'safety.rBody':
      'Uma reconexão mantém na tela o último estado válido e avisa, em vez de apagar tudo.',

    'install.title': 'Instalação <span class="tail">— cinco passos até o primeiro Play</span>',
    'install.s1': 'Baixe',
    'install.s1d':
      '<code>RC-Setlist-1.0.0.ablx</code> e o kit de instalação, na <a href="https://github.com/ntworm/rc-setlist/releases/latest">versão mais recente</a>.',
    'install.s2': 'Instale o RC Bridge',
    'install.s2d':
      'Rode <code>Install-RC-Bridge.cmd</code> (Windows) ou <code>Install RC Bridge.command</code> (macOS), que vêm no kit. No Live, abra <b>Settings › Link, Tempo &amp; MIDI</b> e escolha <b>RCBridge</b> como Control Surface.',
    'install.s3': 'Instale a extensão',
    'install.s3d': 'Abra o .ablx e aprove a instalação no Live.',
    'install.s4': 'Inicie o servidor',
    'install.s4d':
      'Abra <b>Extensions › RC Setlist</b> e clique em <b>Iniciar</b>. O painel mostra um link e um QR code para cada tela.',
    'install.s5': 'Abra as telas',
    'install.s5d':
      'Aponte a câmera para o QR code ou abra o link. Aceite o certificado local só se o endereço for o mesmo que o painel mostra.',
    'install.figCap': 'O painel dentro do Live',
    'install.panelAria':
      'O painel do RC Setlist no Live: servidor em execução na porta 4444, RC Bridge conectado, dois QR codes para Controle de palco e Performance, e os botões Iniciar, Parar e Reiniciar.',
    'install.pRun': 'Servidor em execução',
    'install.pOsc': 'Live conectado',
    'install.figFoot': 'Ilustração · os QR codes não funcionam',
    'install.note':
      'Vem da 0.x? Rode uma vez o script de migração do kit antes de abrir o Live com a 1.0 — veja o <a href="./pt-BR/INSTALL.html">guia de instalação</a>. O Windows está validado; o macOS é experimental nesta versão.',

    'trouble.title': 'Quando não funciona',
    'trouble.tsTitle': 'Solução de problemas',
    'trouble.a': 'O RC Setlist não aparece no Live',
    'trouble.ad':
      'Confira o Live 12.4.5+ Suite (Beta). Abra o .ablx de novo, reinicie o Live, procure em Extensions.',
    'trouble.b': 'O RCBridge não está na lista',
    'trouble.bd':
      'O lugar dele é <code>User Library/Remote Scripts/RCBridge</code> — o instalador do kit põe lá. Reinicie o Live uma vez.',
    'trouble.c': 'O cursor não anda',
    'trouble.cd':
      'Aperte Verificar OSC no painel; a linha de OSC diz qual script responde. Depois de instalar o RC Bridge, aperte Reiniciar.',
    'trouble.d': 'Nenhuma música aparece',
    'trouble.dd':
      'O Set precisa de locators no Arrangement. Primeiro as músicas; seções como <code>Música &gt; Seção</code> ou <code>&gt; Seção</code>.',
    'trouble.e': 'A página não abre',
    'trouble.ed':
      'Use a mesma rede, e não a de convidados. Libere a porta TCP 4444 no firewall só para redes privadas.',
    'trouble.f': 'Os controles estão bloqueados',
    'trouble.fd':
      'Abra o link ou o QR code do controlador no painel: o token dele libera o transporte.',
    'trouble.faqTitle': 'Perguntas frequentes',
    'faq.a': 'Um app no celular?',
    'faq.ad': 'Não. Qualquer navegador atual na mesma rede.',
    'faq.b': 'Preciso do AbletonOSC?',
    'faq.bd': 'Não. O RC Bridge vem no kit e roda ao lado de um AbletonOSC comum ou do RC Surface.',
    'faq.c': 'Para onde vão os dados do show?',
    'faq.cd': 'Para lugar nenhum. Setlists, letras e exportações ficam em perfis locais.',
    'faq.d': 'Por que a contagem não tem som?',
    'faq.dd':
      'Por padrão ela é só visual. Um notebook ligado no in-ear pode ativar o som, um aparelho por vez.',
    'faq.e': 'Session View?',
    'faq.ed': 'Ainda não. Esta versão lê os locators do Arrangement.',
    'faq.f': 'Posso usar comercialmente?',
    'faq.fd':
      'Não. Use, altere e compartilhe para fins não comerciais, sob a PolyForm Noncommercial 1.0.0.',
    'faq.g': 'É grátis?',
    'faq.gd': 'Sim, para uso não comercial: sem preço, sem conta e sem assinatura.',
    'faq.h': 'Mostra a letra no palco?',
    'faq.hd':
      'Sim. A letra sincronizada (.lrc) acompanha a música em qualquer celular, tablet ou notebook, e você marca o tempo das linhas no próprio navegador.',
    'faq.i': 'Funciona com playback e multitracks?',
    'faq.id':
      'Sim. O Live continua tocando as suas faixas; o RC Setlist organiza o setlist, navega pelo Arrangement e mostra a letra.',

    'docs.title': 'Documentos de referência',
    'docs.install': 'Instalação',
    'docs.guide': 'Guia do usuário',
    'docs.trouble': 'Solução de problemas',
    'docs.faq': 'Perguntas frequentes',
    'docs.notes': 'O que há de novo na 1.0.0',
    'docs.security': 'Segurança · privacidade',

    'foot.made': 'Feito por <b>Gabriel Worm</b>',
    'foot.credits': 'Créditos e licenças',
    'foot.legal':
      'RC Setlist é um projeto independente, sem afiliação ou endosso da Ableton AG. Ableton e Live são marcas da Ableton AG.',
    'about.figStage': 'Controle de palco, no notebook de quem opera',
    'about.figPhone': 'Performance, no celular da banda',
    'about.figPhoneAlt':
      'Performance num celular: música e seção atuais, letra, timecode, compasso e BPM.',
    'chain.hop2': 'HTTPS · WebSocket · porta 4444 · token',
    'loc.scrollHint': 'Arraste o desenho para o lado para ver o set inteiro.',
    'install.pLang': 'PT',
    'install.pStart': 'Iniciar',
    'install.pStop': 'Parar',
    'install.pRestart': 'Reiniciar',
    'docs.lInstall': 'Ler o guia de instalação',
    'docs.lGuide': 'Ler o guia do usuário',
    'docs.lTrouble': 'Ler a solução de problemas',
    'docs.lFaq': 'Ler as perguntas frequentes',
    'docs.lNotes': 'Ler as notas da 1.0.0',
  };

  const documentRef = globalScope.document;
  // scripts/render-landing.mjs runs this file without a document to read the
  // table above: docs/pt-BR/index.html is rendered from it.
  if (!documentRef) {
    globalScope.rcSetlistSiteStrings = { 'pt-BR': ptBR };
    return;
  }
  const html = documentRef.documentElement;

  // A page rendered ahead of time in one language (docs/pt-BR/index.html) says
  // so on <html>. Its text is already final, so the selector remembers the
  // choice and opens the page in the other language instead of rewriting this
  // one; each option names that page in data-href.
  if (html.dataset.siteLocale) {
    const fixed = documentRef.getElementById('languageSelect');
    if (fixed) {
      fixed.value = html.dataset.siteLocale;
      fixed.addEventListener('change', () => {
        remember(normalizeLocale(fixed.value));
        const target = fixed.selectedOptions[0]?.dataset.href;
        if (target) globalScope.location.assign(new URL(target, globalScope.location.href));
      });
    }
    html.classList.remove('i18n-wait');
    return;
  }

  const description = documentRef.querySelector('meta[name="description"]');

  const bindings = [
    {
      selector: '[data-i18n]',
      key: 'i18n',
      read: (el) => el.textContent,
      write: (el, v) => (el.textContent = v),
    },
    {
      selector: '[data-i18n-html]',
      key: 'i18nHtml',
      read: (el) => el.innerHTML,
      write: (el, v) => (el.innerHTML = v),
    },
    {
      selector: '[data-i18n-alt]',
      key: 'i18nAlt',
      read: (el) => el.alt,
      write: (el, v) => (el.alt = v),
    },
    {
      selector: '[data-i18n-aria]',
      key: 'i18nAria',
      read: (el) => el.getAttribute('aria-label') || '',
      write: (el, v) => el.setAttribute('aria-label', v),
    },
  ];

  // Snapshot the English page once, before anything is translated. Source
  // indentation is folded to single spaces, as the browser renders it anyway.
  for (const binding of bindings) {
    binding.english = new WeakMap();
    for (const element of documentRef.querySelectorAll(binding.selector)) {
      binding.english.set(element, binding.read(element).replace(/\s+/g, ' ').trim());
    }
  }
  const englishTitle = documentRef.title;
  const englishDescription = description ? description.content : '';

  function normalizeLocale(value) {
    return String(value || '')
      .toLowerCase()
      .startsWith('pt')
      ? 'pt-BR'
      : 'en';
  }

  function initialLocale() {
    try {
      const fromUrl = new URL(globalScope.location.href).searchParams.get('lang');
      if (fromUrl) return normalizeLocale(fromUrl);
    } catch {
      // A page opened from disk still works; it just has no query string.
    }
    try {
      const stored = globalScope.localStorage?.getItem(STORAGE_KEY);
      if (stored) return normalizeLocale(stored);
    } catch {
      // Storage can be blocked; fall through to the browser language.
    }
    return normalizeLocale(globalScope.navigator?.language);
  }

  function apply(locale) {
    const pt = locale === 'pt-BR';
    html.lang = locale;
    documentRef.title = pt ? ptBR['meta.title'] : englishTitle;
    if (description) description.content = pt ? ptBR['meta.description'] : englishDescription;

    for (const binding of bindings) {
      for (const element of documentRef.querySelectorAll(binding.selector)) {
        const key = element.dataset[binding.key];
        const value = pt && ptBR[key] !== undefined ? ptBR[key] : binding.english.get(element);
        if (value !== undefined) binding.write(element, value);
      }
    }
    for (const image of documentRef.querySelectorAll('[data-site-image]')) {
      image.src = `./media/${locale}/${image.dataset.siteImage}`;
    }
    for (const link of documentRef.querySelectorAll('[data-href-pt-br]')) {
      if (!link.dataset.hrefEn) link.dataset.hrefEn = link.getAttribute('href');
      link.href = pt ? link.dataset.hrefPtBr : link.dataset.hrefEn;
    }
    const selector = documentRef.getElementById('languageSelect');
    if (selector) selector.value = locale;
    html.classList.remove('i18n-wait');
  }

  function remember(locale) {
    try {
      globalScope.localStorage?.setItem(STORAGE_KEY, locale);
    } catch {
      // The page stays bilingual even when the choice cannot be remembered.
    }
  }

  function setLocale(value) {
    const locale = normalizeLocale(value);
    remember(locale);
    // A ?lang link would otherwise bring the old language back on reload.
    try {
      const url = new URL(globalScope.location.href);
      if (url.searchParams.has('lang')) {
        url.searchParams.set('lang', locale);
        globalScope.history.replaceState(null, '', url);
      }
    } catch {
      // Without a history API the page still switches.
    }
    apply(locale);
  }

  const selector = documentRef.getElementById('languageSelect');
  selector?.addEventListener('change', () => setLocale(selector.value));
  apply(initialLocale());
})(globalThis);
