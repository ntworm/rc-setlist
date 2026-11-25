# RC Setlist

[![PolyForm Noncommercial](https://img.shields.io/badge/licença-PolyForm%20Noncommercial-orange)](LICENSE)
[![Versão](https://img.shields.io/badge/versão-1.3.0-f97316)](CHANGELOG.md)
[![CI](https://github.com/ntworm/rc-setlist/actions/workflows/ci.yml/badge.svg)](https://github.com/ntworm/rc-setlist/actions/workflows/ci.yml)

[English](README.md) · **Português (Brasil)**

[Página do RC Setlist e capturas de tela](https://ntworm.github.io/rc-setlist/pt-BR/)

O RC Setlist é uma extensão para o Ableton Live 12 que roda um show a partir do
Arrangement. Marque cada música e cada seção com um locator no Live, e o RC
Setlist os transforma em um setlist no navegador. Quem opera inicia músicas e
salta entre seções de um notebook ou tablet; a banda vê a seção atual, a
próxima música e a letra nos próprios celulares. Um segundo computador com o
Live pode seguir o primeiro pela rede local.

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

1. Baixe o `RC-Setlist-1.3.0.ablx` e o kit de instalação na
   [versão mais recente](https://github.com/ntworm/rc-setlist/releases/latest).
2. Instale o RC Bridge a partir do kit: execute o `Install-RC-Bridge.cmd`
   (Windows) ou `Install RC Bridge.command` (macOS) e selecione RCBridge como
   Control Surface no Live.
3. Se o RC Setlist já estiver instalado, remova-o nas configurações de
   extensões do Live (o Live não instala por cima de uma pasta de extensão que
   já existe; a pasta de dados fica). Depois dê dois cliques no `.ablx` e
   aprove a instalação no Ableton Live. Com dois computadores, instale a mesma
   versão em cada um.
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
- Transporte protegido: retenção de 500 ms nos botões, retorno de quantização e
  loops contados.
- Ordem personalizada, letras e exportação CSV por perfil, salvas localmente.
- Vários setlists salvos para cada Live Set.
- Duração de cada música e duração total do setlist, calculadas a partir do
  Arrangement.
- Modo Show no Controle de palco esconde os controles de preparação e mantém a
  música ativa fixa.
- Modo de palco em tela cheia com Screen Wake Lock nos navegadores compatíveis.
- Interfaces em inglês e português do Brasil no mesmo `.ablx`.
- Keyboard Mapping atribui ações de transporte e de visualização ao teclado
  numérico ou alfanumérico.
- Sem contas, sincronização em nuvem, analytics ou telemetria.

## Dois computadores

Um computador principal, o **master**, pode parear um ou mais segundos
computadores, os **slaves**, pelo cartão **Segundo computador** na aba **Rede**
do painel do Live. O slave mostra um código de seis dígitos; o master digita o
endereço e o código. O link usa certificados fixados.

- **Comandos.** Play, Stop, saltos, metrônomo, quantização, contagem, atualizar
  e pânico dados no master vão para todos os slaves. Cada slave confirma cada
  comando; o master reenvia até o prazo e mostra um alerta quando um slave não
  executou, executou atrasado ou ainda não parou.
- **Saúde do link.** O Controle de palco, a tela `/performance` e o painel do
  Live mostram cada link como **OK**, **INSTÁVEL** ou **CAÍDO**, com o motivo e
  o tempo de ida e volta. Um link **CAÍDO** abre um alarme em tela cheia nas
  páginas de palco; o **Stop** continua ao alcance acima dele.
- **Agulha.** O master envia o alvo de transporte duas vezes por segundo, e o
  slave corrige diferenças de beats inteiros, um Play perdido, um Stop perdido
  e, com os dois parados, uma posição diferente. Uma divergência que dura `3 s`
  mostra **Fora de passo**.
- **Modos do slave.** **Segue tudo** executa os comandos do master e todas as
  correções. **Segue transporte** corrige só tocando. Nos dois, o Controle de
  palco do slave não dá play nem salta; Stop, Pânico e Atualizar sobem ao
  master. **Independente** não recebe comandos do master e deixa o slave
  navegar por conta própria.

Ligue o Ableton Link e desligue o Start Stop Sync em todos os computadores, e
use a mesma versão do RC Setlist em todos. Detalhes no
[guia do usuário](docs/pt-BR/USER-GUIDE.md).

## O que há de novo na 1.3.0

Detalhes em [notas da versão 1.3.0](docs/pt-BR/NOTAS-DA-VERSAO-1.3.0.md), que
também cobrem as correções da 1.2.1.

- **Saúde do link.** Cada computador pareado mostra **OK**, **INSTÁVEL** ou
  **CAÍDO** com o motivo, `RTT` e quedas, depois de `20 s` de aquecimento, com
  janela de recuperação, trava de `5 min` para link oscilando e o botão
  **Confirmar**.
- **Alarme de link caído.** Um alarme em tela cheia no Controle de palco e em
  `/performance`, com o selo vermelho acima do transporte depois de **Dispensar
  alarme**; o **Stop** continua ao alcance acima dele.
- **Comandos confirmados.** Os slaves confirmam cada comando. Alertas avisam
  quando um slave não executou um comando, executou atrasado ou ainda não
  parou; Stop e Pânico são reenviados até a confirmação.
- **Agulha parada e Fora de passo.** Um slave parado vai para a posição do
  master, e uma divergência que persiste mostra **Fora de passo**.
- **Modos do slave e trava de navegação.** **Segue tudo**, **Segue transporte**
  e **Independente**. O Controle de palco de um slave que segue o master só
  envia Stop, Pânico e Atualizar, o que substitui o comportamento da 1.2.1 em
  que um celular num slave comandava o show inteiro.
- **Mesma versão obrigatória.** Master e slave verificam o protocolo do link e
  mostram **VERSÕES DIFERENTES** quando diferem.
- **Aba Rede.** O cartão Segundo computador fica acima do cartão Certificado.

## Documentação

- [Primeiros passos](docs/pt-BR/PRIMEIROS-PASSOS.md)
- [Guia de instalação](docs/pt-BR/INSTALL.md)
- [Guia do usuário](docs/pt-BR/USER-GUIDE.md)
- [Solução de problemas](docs/pt-BR/TROUBLESHOOTING.md)
- [Perguntas frequentes (FAQ)](docs/pt-BR/FAQ.md)
- [O que há de novo na versão 1.3.0](docs/pt-BR/NOTAS-DA-VERSAO-1.3.0.md)
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
arquivo `release-candidates/RC-Setlist-1.3.0-Installation-Kit.zip` com o
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
