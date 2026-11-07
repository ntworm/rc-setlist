# RC Setlist

[![PolyForm Noncommercial](https://img.shields.io/badge/licença-PolyForm%20Noncommercial-orange)](LICENSE)
[![Versão](https://img.shields.io/badge/versão-1.1.0-f97316)](CHANGELOG.md)
[![CI](https://github.com/ntworm/rc-setlist/actions/workflows/ci.yml/badge.svg)](https://github.com/ntworm/rc-setlist/actions/workflows/ci.yml)

[English](README.md) · **Português (Brasil)**

> **[Página do RC Setlist e capturas de tela](https://ntworm.github.io/rc-setlist/pt-BR/)**

O **RC Setlist** é uma extensão de setlist, letra sincronizada e tela de palco para o **Ableton Live 12**. Os locators do Arrangement viram o setlist de quem opera, num notebook ou tablet (Controle de palco), e uma tela só de leitura para a banda, em qualquer celular (Performance), com letra sincronizada, BPM e click, e controles de transporte protegidos para ensaios e shows. É grátis para uso não comercial e tem código disponível (source-available).

[Página do RC Setlist](https://ntworm.github.io/rc-setlist/pt-BR/) ·
[Instalação](docs/pt-BR/INSTALL.md) ·
[Guia do usuário](docs/pt-BR/USER-GUIDE.md) ·
[English](README.md) ·
[Versão mais recente](https://github.com/ntworm/rc-setlist/releases/latest)

> **Segurança de rede:** O RC Setlist serve as páginas de controle na sua rede local.
> Utilize apenas em redes locais (LAN/Wi-Fi) confiáveis, mantenha a URL e o token do controlador privados, e nunca exponha a porta `4444` diretamente na internet pública. Consulte [SECURITY.md](SECURITY.md).

## Novo na 1.1.0

- **Painel do Live.** Três abas: Principal, Repertórios, Rede. A Principal
  mostra um QR, do Controle de palco por padrão, e um botão que troca para a
  tela Performance; abaixo, o repertório ativo, o número de músicas, o tempo de
  show e a lista de músicas.
- **Gestão de repertórios no painel.** Ativar, renomear, apagar, criar e
  restaurar repertórios com o transporte parado. Apagar pede confirmação na
  própria linha e pode ser desfeito pela lista de apagados.
- **Pacotes de repertórios.** _Exportar todos_ grava os repertórios do Live Set
  (ordem, cores e notas das músicas, letras) num arquivo `.rcsetlist`.
  _Importar_ acrescenta os repertórios de um pacote aos existentes; um nome
  repetido ganha um número, e uma importação que falha é desfeita. Os arquivos
  ficam na pasta `packages` dos dados da extensão, porque o Live só deixa a
  extensão gravar ali; o painel mostra o caminho.
- **Segundo computador.** Pareie um segundo computador com o Live usando um
  código de seis dígitos. Play, Stop, saltos, click, quantização, contagem,
  atualizar e pânico são enviados a ele; a edição de repertório e de
  marcadores fica no principal. Um segundo ponto de estado no topo do Controle
  de palco fica verde com o link ativo e os marcadores iguais, âmbar com
  marcadores diferentes, vermelho quando ele não responde.
- **Lista de músicas recolhível.** O botão de três pontos ao lado de uma música
  recolhe as seções dela; _Recolher todas / Abrir todas_ age na lista inteira.
  Segure o nome ou o número da música para saltar; arraste a alça na borda
  direita do card para reordenar.
- **Certificado local.** A extensão cria uma autoridade certificadora para este
  computador, válida para localhost e endereços privados da rede. A aba Rede
  mostra um QR para uma página de instalação na porta `4445`; com o
  certificado instalado, o navegador abre as páginas sem aviso.
- **Endereço de rede.** O QR usa o endereço da rota padrão, não o primeiro
  endereço privado, então uma segunda interface de rede (luz, áudio) não
  substitui o endereço do Wi-Fi.
- **Correções.** A barra do topo fica numa linha nos dois idiomas; reordenar
  funciona no Windows; salvar funciona quando o Live recusa `fsync`; o
  pareamento fica preso à chave do segundo computador, então uma mudança de
  endereço mantém o link.

## Destaques

- Músicas e seções definidas pelos locators com suporte a tags `[loop]`, `[loop Nx]`, `[stop]`, `[next]`, `[bpm N]`, `[click]`, `[click off]`, `[skip]` e `[hidden]`.
- Modos de visualização Setlist (Controle de Palco) e Performance para computadores, notebooks, tablets e celulares.
- Letras sincronizadas `.lrc` com fluxo de edição e sincronização diretamente no navegador.
- Transporte protegido (retenção de 500 ms nos botões), feedback de quantização e repetições contadas.
- Ordem personalizada, letras e exportação CSV por perfil salvas localmente.
- Múltiplos setlists salvos no escopo do Live Set atual, com exclusão e restauração seguras.
- Duração das músicas e duração total do setlist calculadas a partir da linha do tempo do Arrangement.
- Modo de palco em tela cheia com Screen Wake Lock para manter a tela sempre ligada nos navegadores compatíveis.
- Interfaces completas em inglês e português do Brasil empacotadas no mesmo `.ablx`.
- Sem necessidade de contas, sincronização em nuvem, analytics ou telemetria.
- Mapeamento de teclado (Keyboard Mapping) para disparar transporte e navegação pelo teclado numérico ou alfanumérico.
- Um segundo computador que segue o show: pareie-o pelo painel do Live e os comandos de transporte viajam para ele por um link com o certificado preso.
- Um painel do Live com três abas, Principal, Repertórios e Rede, onde o QR, os repertórios e o segundo computador ficam juntos.
- Pacotes de repertórios: todos os repertórios de um Live Set em um arquivo, prontos para importar de novo.

## Requisitos

- Ableton Live 12.4.5+ Suite (Beta) com suporte a Extensions.
- RC Bridge, o Remote Script incluído (um fork do [AbletonOSC](https://github.com/ideoforms/AbletonOSC)), selecionado como Control Surface no Live para transporte e operações no Live Object Model.
- Node.js 24.16.0 ou superior (linha Node 24 LTS) necessário apenas para desenvolvimento a partir do código-fonte. Usuários finais apenas instalam o `.ablx` e não necessitam do Node.js.

O Windows é a plataforma de lançamento validada. O suporte a macOS permanece experimental até ser validado em hardware Apple físico dedicado.

## Início rápido

1. Instale o RC Bridge: execute o `Install-RC-Bridge.cmd` (Windows) ou `Install RC Bridge.command` (macOS) do kit de instalação, e selecione RCBridge como Control Surface nas preferências do Live.
2. Baixe o `RC-Setlist-1.1.0.ablx` e o kit de instalação na
   [versão 1.1.0](https://github.com/ntworm/rc-setlist/releases/tag/v1.1.0).
3. Vindo da 1.0, remova antes o RC Setlist nas configurações de extensões do
   Live (o Live não instala por cima de uma pasta de extensão que já existe;
   a pasta de dados fica). Depois dê dois cliques no `.ablx` e aprove a
   instalação no Ableton Live.
4. No Live, acesse **Extensions > RC Setlist** e inicie o servidor.
5. Acesse a URL do painel ou escaneie o código QR com o tablet ou celular para abrir `/setlist` ou `/performance`.
6. Para o aviso de certificado sumir, escaneie uma vez o QR **Certificado** no
   painel e siga os passos daquela página.
7. Aperte **EN** ou **PT** no alto do painel para escolher **Português (Brasil)**.

Usuários atualizando de versões antigas 0.x (`Ableton-RC-Setlist-0.4.x` a `0.7.0`) devem executar o script de migração `Migrate-RC-Setlist-Data.cmd` (Windows) ou `Migrate RC Setlist Data.command` (macOS) uma única vez antes de abrir o Live com a versão 1.0. O script copia perfis, setlists do projeto e preferências para a nova estrutura sem alterar a pasta anterior. Quem vem da 1.0 (`RC-Setlist-1.0.0.ablx`) não tem nada a migrar. Na primeira partida, a 1.1.0 assina um novo certificado do servidor com a autoridade certificadora deste computador, então um navegador que tinha aceitado o certificado antigo pergunta mais uma vez, ou para de perguntar depois que o certificado do celular está instalado. Instruções completas em [docs/pt-BR/INSTALL.md](docs/pt-BR/INSTALL.md).

## Formato dos locators

```text
Neon Signal [bpm 122] [click]
Neon Signal > Intro
Neon Signal > Chorus [loop 2x]
Neon Signal > Outro [stop]
```

Todos os exemplos neste repositório são fictícios. Consulte [examples/README.md](examples/README.md) para um set de demonstração completo.

## Arquitetura

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

A extensão funciona de forma local (local-first). Os arquivos de integração com a SDK ficam na borda do sistema; parser, estado, lógica de transporte, persistência e clientes web podem ser testados de forma independente.

## Pacote de Instalação para Envio (Kit)

Para gerar e organizar o pacote zip completo para envio aos operadores e músicos:

```powershell
npm run package:kit
```

O comando produz a pasta e o arquivo zip em `release-candidates/RC-Setlist-1.1.0-Installation-Kit.zip` contendo:

- `RC-Setlist-1.1.0.ablx` (extensão para o Live)
- `START-HERE.html` (página de introdução bilíngue amigável)
- `README.txt` (instruções rápidas de instalação e migração)
- Pasta `RC-Bridge/` com scripts automatizados de instalação (`Install-RC-Bridge.cmd` e `.command`)
- Scripts de migração de versões 0.x (`Migrate-RC-Setlist-Data.cmd` e `.command`)
- Pastas de documentação completa em português (`pt-BR/`) e inglês (`en/`) com checklists de testes e guias do usuário.

## Desenvolvimento

```bash
npm ci
npm run ci:public
```

O SDK e CLI do Ableton não são redistribuídos neste repositório público. Desenvolvedores autorizados podem configurar a compilação completa seguindo [vendor/README.md](vendor/README.md) e [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Documentação

- [Índice da documentação](docs/pt-BR/README.md)
- [Primeiros passos](docs/pt-BR/PRIMEIROS-PASSOS.md)
- [Guia de instalação](docs/pt-BR/INSTALL.md)
- [Guia do usuário](docs/pt-BR/USER-GUIDE.md)
- [O que há de novo na versão 1.1.0](docs/pt-BR/NOTAS-DA-VERSAO-1.1.0.md)
- [O que há de novo na versão 1.0.0](docs/pt-BR/NOTAS-DA-VERSAO-1.0.0.md)
- [Solução de problemas](docs/pt-BR/TROUBLESHOOTING.md)
- [Perguntas frequentes (FAQ)](docs/pt-BR/FAQ.md)
- [Contratos públicos da API](docs/pt-BR/CONTRATOS.md)
- [Histórico de versões](docs/HISTORY.md)
- [Contrato de temas](docs/THEME_CONTRACT.md)
- [Guia de testes](docs/TESTER-GUIDE.md)
- [Desenvolvimento](docs/DEVELOPMENT.md)
- [Privacidade](PRIVACY.md)
- [Segurança](SECURITY.md)
- [Suporte](SUPPORT.md)
- [Conduta](CODE_OF_CONDUCT.md)
- [Contribuição](CONTRIBUTING.md)
- [Avisos de terceiros](THIRD_PARTY_NOTICES.md)

## Licença

O RC Setlist tem código disponível sob a licença [PolyForm Noncommercial License 1.0.0](LICENSE). O uso, modificação e redistribuição não comerciais são permitidos de acordo com seus termos; o uso comercial não é permitido. Esta não é uma licença de código aberto aprovada pela OSI.

Aviso obrigatório: Copyright © 2026 Gabriel Worm<br>
<https://github.com/ntworm/rc-setlist>

Ableton e Ableton Live são marcas registradas da Ableton AG. O RC Setlist é um projeto independente e não é afiliado ou endossado pela Ableton AG.
