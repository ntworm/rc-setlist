# Primeiros passos com o RC Setlist

Este guia leva do Live recém-instalado até o primeiro show: habilitar a
extensão, montar um setlist com locators e comandar tudo pelo celular.
Instale o RC Setlist e o RC Bridge antes (veja [INSTALL.md](INSTALL.md)). Se
algo aqui não bater com o que você vê na tela, abra uma issue com a label
`docs/wrong`.

- [Habilitar o RC Setlist](#habilitar-o-rc-setlist)
- [Montar um setlist com locators](#montar-um-setlist-com-locators)
- [Ler o painel](#ler-o-painel)
- [Conectar o celular](#conectar-o-celular)
- [Mais documentos](#mais-documentos)

## Habilitar o RC Setlist

1. Abra o Ableton Live.
2. Em **Preferences → Extensions**, confirme que `RC Setlist` aparece na lista
   com status **Enabled**.
3. **Extensions → RC Setlist → Open panel** abre o painel do host.
4. O painel mostra a URL local, o token de controller como QR code e o IP de
   LAN autodetectado.

A URL é `https://<lan-ip>:4444/`; o QR embute a mesma URL com o token na query
string. Trate o QR como senha: quem escanear consegue parar o transporte.

## Montar um setlist com locators

O Live usa **locators** (cue points no Arrangement). Cada um carrega o título
da música mais tags opcionais dentro de colchetes `[ ]`. O RC Setlist
transforma isso em músicas e seções.

Crie um Set novo, marque o tempo em 120 BPM e adicione três locators:

| Beat | Nome                 | Notas              |
| ---- | -------------------- | ------------------ |
| 0    | `INTRO`              | Primeira música    |
| 16   | `> Verso`            | Seção da INTRO     |
| 48   | `MÚSICA 2 [bpm 100]` | Próxima em 100 BPM |

Abra o painel e confirme que você vê:

- `INTRO` listada como música atual
- `Verso` listada como seção da INTRO
- `MÚSICA 2` listada como música separada com BPM 100

Se o painel não mostrar nada, confira no painel de logs se há locator
malformado.

## Ler o painel

O painel do Live é a janela que o RC Setlist abre dentro do Live. O operador
trabalha na página de Controle de Palco no navegador: ela mostra a música
atual, o cronômetro, o próximo locator e os controles de play, stop, jump e
edição.

A referência completa está em
[USER-GUIDE.md](USER-GUIDE.md#o-painel-do-live).

## Conectar o celular

1. No celular do palco, escaneie o QR do painel.
2. O celular abre a página de Controle de Palco na mesma URL, com o token já
   na query string.
3. Toque em **Confirmar controller** para registrar o celular como controller
   desta sessão.

O celular passa a mostrar a próxima música, o índice da seção, o cronômetro e
a letra. Ele precisa de um navegador moderno (Safari 17+, Chrome 121+).

A visualização Performance em `https://<ip-do-host>:4444/performance` é somente
leitura e mostra o estado do show para a banda.

Não há app separado de pareamento; o único estado que o celular precisa é a
URL. Se o celular perder a conexão, o painel re-renderiza e a URL continua
válida até você reiniciar o Live.

## Mais documentos

- [USER-GUIDE.md](USER-GUIDE.md): referência completa do painel e do Controle
  de Palco.
- [CONTRATOS.md](CONTRATOS.md): o contrato público (HTTP, WS, gramática de
  locators). Leia se quiser escrever seu próprio controller.
- [THEME_CONTRACT.md](../THEME_CONTRACT.md): paleta e tipografia se você quer
  uma skin custom para o Controle de Palco.
- [TESTER-GUIDE.md](../TESTER-GUIDE.md): o que conferir num release candidate
  antes de mandar pra banda.
- [DEVELOPMENT.md](../DEVELOPMENT.md): como rodar os testes e buildar a
  extensão localmente.
