# RC Setlist

[![PolyForm Noncommercial](https://img.shields.io/badge/licença-PolyForm%20Noncommercial-orange)](LICENSE)
[![Versão](https://img.shields.io/badge/versão-1.2.1-f97316)](CHANGELOG.md)
[![CI](https://github.com/ntworm/rc-setlist/actions/workflows/ci.yml/badge.svg)](https://github.com/ntworm/rc-setlist/actions/workflows/ci.yml)

[English](README.md) · **Português (Brasil)**

[Página do RC Setlist e capturas de tela](https://ntworm.github.io/rc-setlist/pt-BR/)

O RC Setlist é uma extensão para o Ableton Live 12 que roda um show a partir do
Arrangement. Marque cada música e cada seção com um locator no Live, e o RC
Setlist os transforma em um setlist no navegador. Quem opera inicia músicas e
salta entre seções de um notebook ou tablet; a banda vê a seção atual, a
próxima música e a letra nos próprios celulares.

> **Segurança de rede:** O RC Setlist serve as páginas de controle na sua rede local.
> Utilize apenas em redes locais (LAN/Wi-Fi) confiáveis, mantenha a URL e o token do controlador privados, e nunca exponha a porta `4444` diretamente na internet pública. Consulte [SECURITY.md](SECURITY.md).

## Requisitos

- Ableton Live 12.4.5+ Suite (Beta) com suporte a Extensions.
- RC Bridge, o Remote Script incluído (um fork do
  [AbletonOSC](https://github.com/ideoforms/AbletonOSC)), selecionado como
  Control Surface no Live para transporte e operações no Live Object Model.

O Windows é a plataforma de lançamento validada. O suporte a macOS permanece
experimental até ser validado em hardware Apple físico dedicado.

## Instalação

1. Baixe o `RC-Setlist-1.2.1.ablx` e o kit de instalação na
   [versão mais recente](https://github.com/ntworm/rc-setlist/releases/latest).
2. Instale o RC Bridge a partir do kit: execute o `Install-RC-Bridge.cmd`
   (Windows) ou `Install RC Bridge.command` (macOS) e selecione RCBridge como
   Control Surface no Live.
3. Se o RC Setlist já estiver instalado, remova-o nas configurações de
   extensões do Live (o Live não instala por cima de uma pasta de extensão que
   já existe; a pasta de dados fica). Depois dê dois cliques no `.ablx` e
   aprove a instalação no Ableton Live.
4. No Live, acesse **Extensions > RC Setlist** e inicie o servidor. Use a URL
   do painel ou o código QR para abrir `/setlist` ou `/performance`.
5. Para remover o aviso de certificado, escaneie uma vez o QR **Certificado**
   no painel e siga os passos daquela página.
6. Aperte **EN** ou **PT** no alto do painel para escolher inglês ou português
   do Brasil.

Quem usa o layout [`RC-Setlist-1.0.0.ablx`](docs/pt-BR/NOTAS-DA-VERSAO-1.0.0.md)
não tem nada a migrar. Para mover os dados do layout 0.x
(`Ableton-RC-Setlist-0.4.x` a `0.7.0`), execute o
`Migrate-RC-Setlist-Data.cmd` (Windows) ou `Migrate RC Setlist Data.command`
(macOS) do kit de instalação uma única vez antes de abrir o Live; o script
copia perfis, setlists do projeto e preferências para o layout 1.x e não altera
a pasta anterior.

Instruções completas em [docs/pt-BR/INSTALL.md](docs/pt-BR/INSTALL.md).

## Como funciona

O RC Bridge, o Remote Script que vem com a extensão, é o lado do Live na
ligação:

```text
Ableton Live + RC Bridge (fork empacotado do AbletonOSC)
          │ OSC 11020, responde ao socket solicitante
          │ (AbletonOSC original nas portas 11000/11001 ainda suportado)
          ▼
     Extensão RC Setlist
          │ HTTP(S) local + WebSocket :4444
          ├── /setlist       área de trabalho do operador (Controle de Palco)
          └── /performance   tela de visualização para o músico/palco
```

Músicas e seções vêm dos locators. As tags suportadas são `[loop]`,
`[loop Nx]`, `[stop]`, `[next]`, `[bpm N]`, `[click]`, `[click off]`, `[skip]` e
`[hidden]`.

```text
Neon Signal [bpm 122] [click]
Neon Signal > Intro
Neon Signal > Chorus [loop 2x]
Neon Signal > Outro [stop]
```

Todos os exemplos neste repositório são fictícios. Consulte
[examples/README.md](examples/README.md) para um set de demonstração completo.

## Recursos

- As duas páginas rodam no navegador de um desktop, notebook, tablet ou celular
  da rede.
- Letras `.lrc` sincronizadas, com a sincronização e a edição no navegador.
- Transporte protegido (retenção de 500 ms nos botões), feedback de quantização
  e repetições contadas.
- Ordem personalizada, letras e exportação CSV por perfil, salvas localmente.
- Vários setlists salvos no escopo do Live Set atual.
- Duração das músicas e duração total do setlist calculadas a partir da linha
  do tempo do Arrangement.
- Modo de palco em tela cheia com Screen Wake Lock para manter a tela sempre
  ligada nos navegadores compatíveis.
- Interfaces completas em inglês e português do Brasil empacotadas no mesmo
  `.ablx`.
- Mapeamento de teclado (Keyboard Mapping) para disparar transporte e
  navegação pelo teclado numérico ou alfanumérico.
- Sem necessidade de contas, sincronização em nuvem, analytics ou telemetria.

## O que há de novo na 1.2.1

Detalhes em [notas da versão 1.2.1](docs/pt-BR/NOTAS-DA-VERSAO-1.2.1.md).

- **Prontos para parear mostra um endereço que responde.** Quando um slave tem
  duas interfaces de rede na mesma sub-rede, o anúncio leva os endereços de LAN
  e o master lista o primeiro que responde na porta anunciada.
- **Um celular num slave comanda o show inteiro.** Com o master conectado,
  comandos de transporte, salto, metrônomo, quantização, contagem, atualizar e
  pânico vindos de um celular ou do painel no slave sobem para o master, que
  executa e envia a todos os slaves; sem o master, o slave executa sozinho e
  registra no log.

## O que há de novo na 1.2.0

Detalhes em [notas da versão 1.2.0](docs/pt-BR/NOTAS-DA-VERSAO-1.2.0.md).

- **Vários segundos computadores.** Um master pareia vários slaves; a aba Rede
  lista cada um com o estado dele e o próprio Desfazer, e todo comando de
  transporte vai para todos.
- **Master e slave no painel.** A barra na parte de baixo do painel do Live
  mostra se este computador é Master (com quantos slaves estão conectados) ou
  Slave (com o estado do master).
- **O slave acompanha o tempo do master.** O master envia a posição da agulha
  duas vezes por segundo para o slave corrigir diferenças de beats inteiros,
  começar num Play perdido e parar num Stop perdido.
- **Prontos para parear.** Um slave com código de pareamento ativo anuncia nome
  e porta na UDP `4447`; o master o lista em Prontos para parear para
  preencher o endereço com um clique.
- **Trazer do master.** Num slave com o Live parado, Trazer do master no cartão
  Importar traz o repertório ativo do master com ordem, cores das músicas,
  notas e letras.
- **Modo Show.** Uma chave na barra superior do Controle de palco escolhe entre
  Edição e Show, escondendo os controles de configuração e fixando só a música
  ativa aberta no topo.
- **Próxima música agora e Música anterior agora.** Duas ações de MIDI e
  teclado saltam na hora durante a reprodução, sem esperar a grade de
  quantização.
- **Mudanças de fórmula de compasso.** O mostrador de compasso conta cada
  trecho do set na própria fórmula de compasso e conta os tempos na unidade do
  denominador.
- **Renomear um pacote.** Um clique duplo no nome de um pacote no cartão
  Importar renomeia o arquivo na pasta `packages`.

## Documentação

- [Primeiros passos](docs/pt-BR/PRIMEIROS-PASSOS.md)
- [Guia de instalação](docs/pt-BR/INSTALL.md)
- [Guia do usuário](docs/pt-BR/USER-GUIDE.md)
- [Solução de problemas](docs/pt-BR/TROUBLESHOOTING.md)
- [Perguntas frequentes (FAQ)](docs/pt-BR/FAQ.md)
- [O que há de novo na versão 1.2.1](docs/pt-BR/NOTAS-DA-VERSAO-1.2.1.md)
- [O que há de novo na versão 1.2.0](docs/pt-BR/NOTAS-DA-VERSAO-1.2.0.md)
- [Privacidade](PRIVACY.md)
- [Segurança](SECURITY.md)
- [Todos os outros documentos](docs/pt-BR/README.md)

## Desenvolvimento

```bash
npm ci
npm run ci:public
```

A extensão funciona de forma local (local-first). Os arquivos de integração com
a SDK ficam no limite do sistema; o parser, o estado, a lógica de transporte, a
persistência e os clientes web podem ser testados de forma independente.

O SDK e CLI do Ableton não são redistribuídos neste repositório público.
Desenvolvedores autorizados podem configurar a compilação completa seguindo
[vendor/README.md](vendor/README.md) e [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
Compilar a partir do código-fonte exige Node.js 24.16.0 ou superior, na linha
Node 24 LTS; quem instala o `.ablx` não precisa do Node.js.

O kit de instalação é gerado por `npm run package:kit`. O comando produz o
arquivo `release-candidates/RC-Setlist-1.2.1-Installation-Kit.zip` com o
`.ablx`, a página `START-HERE.html`, o `README.txt` de instruções, os
instaladores em `RC-Bridge/`, os scripts de migração da 0.x e as pastas de
documentação `en/` e `pt-BR/`.

## Licença

O RC Setlist tem código disponível sob a licença
[PolyForm Noncommercial License 1.0.0](LICENSE). O uso, modificação e
redistribuição não comerciais são permitidos de acordo com seus termos; o uso
comercial não é permitido. Esta não é uma licença de código aberto aprovada
pela OSI.

Aviso obrigatório: Copyright © 2026 Gabriel Worm<br>
<https://github.com/ntworm/rc-setlist>

Ableton e Ableton Live são marcas registradas da Ableton AG. O RC Setlist é um
projeto independente e não é afiliado ou endossado pela Ableton AG.
