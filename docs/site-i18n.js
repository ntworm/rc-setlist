(function rcSetlistSiteI18n(globalScope) {
  'use strict';

  const STORAGE_KEY = 'rc-setlist.locale';
  const copy = {
    en: {
      title: 'Ableton RC Setlist — your Ableton Live setlist on stage',
      description: 'Ableton RC Setlist is a source-available setlist extension for Ableton Live with locator-driven songs, synchronized lyrics and guarded stage controls.',
      skip: 'Skip to content',
      navAria: 'Primary navigation',
      navProduct: 'Product',
      navWorkflow: 'Workflow',
      navInstall: 'Install',
      navDocs: 'Docs',
      navSource: 'Source',
      language: 'Language',
      heroEyebrow: 'Ableton Live extension · v0.4.1',
      heroLede: 'Turn Arrangement locators into a real operator setlist, synchronized lyric display and guarded stage controls — running locally between Ableton Live and your browser.',
      download: 'Download .ablx',
      readDocs: 'Read the docs',
      fine: 'No account · no subscription · no analytics · source-available',
      heroAlt: 'Product truth composition of the real Ableton RC Setlist Performance and Stage Control interfaces',
      productTruth: 'Product truth',
      realInterfaces: 'Real interfaces · neutral demo data',
      principlesAria: 'Product principles',
      localFirst: 'Local first',
      localFirstBody: 'Live ↔ browser on your trusted LAN',
      twoViews: 'Two real views',
      twoViewsBody: 'Stage Control + Performance display',
      oneAblx: 'One .ablx',
      oneAblxBody: 'Install through Ableton Live',
      noTelemetry: 'No telemetry',
      noTelemetryBody: 'Your show data stays local',
      shipped: 'The shipped interface',
      seeShow: 'See the show.',
      runSet: 'Run the set.',
      productIntro: 'The product stays anchored to Ableton Live. The browser gives the operator and performer the information each one needs without inventing a second timeline.',
      performanceAlt: 'Performance interface showing current and next song, section, lyrics, timecode, bar, BPM and click',
      performanceBody: 'High-contrast show state, current and next cues, synchronized lyrics, timecode, bar, tempo and click.',
      stageControl: 'Stage Control',
      stageAlt: 'Stage Control interface showing the setlist, section controls, show state and transport',
      stageBody: 'Song and section navigation, guarded transport, quantization, click, refresh, tools, lock and live feedback.',
      workflowEyebrow: 'Three-step workflow',
      fromLocators: 'From locators',
      toStage: 'to stage.',
      workflowBody: 'Write the show structure once in Arrangement with automation tags. Ableton RC Setlist turns that structure into operator and performer views.',
      workflowAlt: 'From locators to stage workflow: mark the Arrangement, conduct the set and read the show',
      builtFor: 'Built for rehearsal and stage',
      liveSet: 'A Live Set that reads like a show.',
      truthful: 'The interface mirrors the functions that ship in v0.4.1. No fictional dashboard metrics and no show content bundled with the extension.',
      feature1Label: '01 · STRUCTURE',
      feature1Title: 'Locator-driven setlist',
      feature1Body: 'Turn Arrangement markers into ordered songs and sections with optional automation tags.',
      feature2Label: '02 · SAFETY',
      feature2Title: 'Guarded transport',
      feature2Body: 'Previous and Next require a deliberate hold. Jump and quantization feedback wait for confirmation from Live.',
      feature3Label: '03 · LYRICS',
      feature3Title: 'Synchronized words',
      feature3Body: 'Create, time, edit and display authorized LRC or plain text inside local show profiles.',
      feature4Label: '04 · FEEDBACK',
      feature4Title: 'Current and next cues',
      feature4Body: 'See song and total duration, section, loop progress, stable bar/beat, BPM and click state at a glance.',
      feature5Label: '05 · SHOW DATA',
      feature5Title: 'Saved setlists and export',
      feature5Body: 'Keep multiple setlists inside the current Live Set, preserve local ordering and lyrics, recover deleted profiles, and export CSV.',
      feature6Label: '06 · NETWORK',
      feature6Title: 'Local browser access',
      feature6Body: 'Open Stage Control or the read-only Performance view from a trusted laptop, tablet or phone on the LAN.',
      editorialAlt: 'Stage editorial composition using the real Performance and Stage Control interfaces',
      oneSession: 'One session · two views',
      controlShow: 'Control the show.',
      notScreen: 'Not the screen.',
      editorialBody: 'Operate from Stage Control and keep Performance visible for the information that matters in the next second.',
      release: 'Release 0.4.1',
      installTitle: 'Install, rehearse, verify.',
      installBody: 'Ableton RC Setlist requires Ableton Live 12.4.5+ Suite (Beta) with Extensions support and the external AbletonOSC Control Surface. Windows is validated; macOS remains experimental for this release.',
      installGuide: 'Installation guide',
      releaseNotes: 'What is new',
      check1: 'Install the single Ableton-RC-Setlist-0.4.1.ablx package',
      check2: 'Install AbletonOSC separately from its upstream project',
      check3: 'Start the local server from Extensions in Live',
      check4: 'Open Stage Control or Performance on a trusted LAN',
      check5: 'Rehearse transport, cues, click and lyrics before stage use',
      license: 'License:',
      licenseBody: 'Ableton RC Setlist is source-available under the PolyForm Noncommercial 1.0.0 license. Commercial use is not permitted.',
      copyright: 'Copyright © 2026 Gabriel Worm.',
      trademark: 'Ableton and Ableton Live are trademarks of Ableton AG.',
      independence: 'Ableton RC Setlist is an independent project and is not affiliated with or endorsed by Ableton AG.',
    },
    'pt-BR': {
      title: 'Ableton RC Setlist — seu setlist do Ableton Live no palco',
      description: 'Ableton RC Setlist é uma extensão source-available para Ableton Live, com setlist guiado por localizadores do Arrangement, letras sincronizadas e controles protegidos para o palco.',
      skip: 'Pular para o conteúdo',
      navAria: 'Navegação principal',
      navProduct: 'Produto',
      navWorkflow: 'Fluxo',
      navInstall: 'Instalação',
      navDocs: 'Documentação',
      navSource: 'Código-fonte',
      language: 'Idioma',
      heroEyebrow: 'Extensão para Ableton Live · v0.4.1',
      heroLede: 'Transforme os localizadores do Arrangement em um setlist de verdade para a operação, com letras sincronizadas e controles protegidos para o palco — tudo rodando localmente entre o Ableton Live e o navegador.',
      download: 'Baixar .ablx',
      readDocs: 'Ver a documentação',
      fine: 'Sem conta · sem assinatura · sem analytics · source-available',
      heroAlt: 'Composição com as interfaces reais Performance e Controle de Palco do Ableton RC Setlist',
      productTruth: 'Produto real',
      realInterfaces: 'Interfaces reais · dados de demonstração neutros',
      principlesAria: 'Princípios do produto',
      localFirst: 'Local primeiro',
      localFirstBody: 'Live ↔ navegador na sua rede local confiável',
      twoViews: 'Duas telas reais',
      twoViewsBody: 'Controle de Palco + tela de Performance',
      oneAblx: 'Um único .ablx',
      oneAblxBody: 'Instalação pelo Ableton Live',
      noTelemetry: 'Sem telemetria',
      noTelemetryBody: 'Os dados do seu show permanecem locais',
      shipped: 'A interface entregue',
      seeShow: 'Veja o show.',
      runSet: 'Rode o set.',
      productIntro: 'O produto fica ancorado no Ableton Live. O navegador entrega ao operador e ao performer a informação que cada um precisa, sem inventar uma segunda timeline.',
      performanceAlt: 'Interface Performance com música atual e próxima, seção, letras, timecode, compasso, BPM e clique',
      performanceBody: 'Estado do show em alto contraste, cue atual e próximo, letras sincronizadas, timecode, compasso, tempo e clique.',
      stageControl: 'Controle de palco',
      stageAlt: 'Interface Controle de Palco com setlist, controles de seção, estado do show e transporte',
      stageBody: 'Navegação por músicas e seções, transporte protegido, quantização, clique, refresh, ferramentas, bloqueio e retorno ao vivo.',
      workflowEyebrow: 'Fluxo em três etapas',
      fromLocators: 'Dos localizadores',
      toStage: 'ao palco.',
      workflowBody: 'Escreva uma vez a estrutura do show no Arrangement com tags de automação. O Ableton RC Setlist transforma essa estrutura em telas para operador e performer.',
      workflowAlt: 'Fluxo dos localizadores ao palco: marque o Arrangement, rode o set e leia o show',
      builtFor: 'Feito para ensaio e palco',
      liveSet: 'Um Live Set que pode ser lido como um show.',
      truthful: 'A interface mostra as funções que já fazem parte da v0.4.1. Sem métricas fictícias e sem conteúdo de shows incluído na extensão.',
      feature1Label: '01 · ESTRUTURA',
      feature1Title: 'Setlist guiado por localizadores',
      feature1Body: 'Transforme marcadores do Arrangement em músicas e seções ordenadas, com tags opcionais de automação.',
      feature2Label: '02 · SEGURANÇA',
      feature2Title: 'Transporte protegido',
      feature2Body: 'Anterior e Próxima exigem confirmação deliberada. Saltos e quantização só acontecem depois da confirmação do Live.',
      feature3Label: '03 · LETRAS',
      feature3Title: 'Palavras sincronizadas',
      feature3Body: 'Crie, marque o tempo, edite e exiba LRC autorizado ou texto simples em perfis locais de show.',
      feature4Label: '04 · RETORNO',
      feature4Title: 'Cue atual e próximo',
      feature4Body: 'Veja a duração da música e do setlist, a seção, o progresso do loop, o compasso estável, o BPM e o estado do clique de uma vez só.',
      feature5Label: '05 · DADOS DO SHOW',
      feature5Title: 'Setlists salvos e exportação',
      feature5Body: 'Mantenha vários setlists dentro do Live Set atual, preserve a ordem e as letras, recupere perfis apagados e exporte em CSV.',
      feature6Label: '06 · REDE',
      feature6Title: 'Acesso local pelo navegador',
      feature6Body: 'Abra o Controle de Palco ou a tela Performance em modo somente leitura a partir de um notebook, tablet ou celular confiável na LAN.',
      editorialAlt: 'Composição editorial de palco com as interfaces reais Performance e Controle de Palco',
      oneSession: 'Uma sessão · duas telas',
      controlShow: 'Controle o show.',
      notScreen: 'Não a tela.',
      editorialBody: 'Opere pelo Controle de Palco e mantenha a Performance visível para a informação que importa no próximo segundo.',
      release: 'Versão 0.4.1',
      installTitle: 'Instale, ensaie, verifique.',
      installBody: 'O Ableton RC Setlist precisa do Ableton Live 12.4.5+ Suite (Beta) com suporte a Extensions e da Control Surface externa AbletonOSC. O Windows está validado; o macOS segue experimental nesta versão.',
      installGuide: 'Guia de instalação',
      releaseNotes: 'O que há de novo',
      check1: 'Instale o único pacote Ableton-RC-Setlist-0.4.1.ablx',
      check2: 'Instale o AbletonOSC à parte, pelo projeto original',
      check3: 'Inicie o servidor local em Extensions no Live',
      check4: 'Abra Controle de Palco ou Performance em uma LAN confiável',
      check5: 'Ensaie transporte, cues, clique e letras antes de usar no palco',
      license: 'Licença:',
      licenseBody: 'Ableton RC Setlist é source-available sob a licença PolyForm Noncommercial 1.0.0. Uso comercial não é permitido.',
      copyright: 'Copyright © 2026 Gabriel Worm.',
      trademark: 'Ableton e Ableton Live são marcas da Ableton AG.',
      independence: 'Ableton RC Setlist é um projeto independente, sem afiliação ou endosso da Ableton AG.',
    },
  };

  function normalizeLocale(value) {
    return String(value || '').toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
  }

  function storedLocale() {
    try {
      return globalScope.localStorage?.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  let locale = normalizeLocale(storedLocale());

  function apply() {
    const active = copy[locale];
    document.documentElement.lang = locale;
    document.title = active.title;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.content = active.description;

    for (const element of document.querySelectorAll('[data-site-i18n]')) {
      element.textContent = active[element.dataset.siteI18n] || element.dataset.siteI18n;
    }
    for (const element of document.querySelectorAll('[data-site-i18n-aria-label]')) {
      element.setAttribute('aria-label', active[element.dataset.siteI18nAriaLabel] || element.dataset.siteI18nAriaLabel);
    }
    for (const element of document.querySelectorAll('[data-site-i18n-alt]')) {
      element.alt = active[element.dataset.siteI18nAlt] || element.dataset.siteI18nAlt;
    }
    for (const image of document.querySelectorAll('[data-site-image]')) {
      image.src = `./media/${locale}/${image.dataset.siteImage}`;
    }

    const documentation = document.getElementById('documentation');
    const navDocumentation = document.getElementById('navDocumentation');
    const installGuide = document.getElementById('installGuide');
    const docsHref = locale === 'pt-BR' ? './pt-BR/README.md' : './README.md';
    const installHref = locale === 'pt-BR' ? './pt-BR/INSTALL.md' : './INSTALL.md';
    if (documentation) documentation.href = docsHref;
    if (navDocumentation) navDocumentation.href = docsHref;
    if (installGuide) installGuide.href = installHref;

    const selector = document.getElementById('languageSelect');
    if (selector) selector.value = locale;
  }

  function setLocale(value) {
    locale = normalizeLocale(value);
    try {
      globalScope.localStorage?.setItem(STORAGE_KEY, locale);
    } catch {
      // The page remains bilingual even if persistence is unavailable.
    }
    apply();
  }

  const selector = document.getElementById('languageSelect');
  selector?.addEventListener('change', () => setLocale(selector.value));
  apply();
})(globalThis);
