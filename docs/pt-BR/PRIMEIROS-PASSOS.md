# Primeiros passos com o RC Setlist 1.0

Este guia leva de uma instalação nova do Live até um setlist rodando
em menos de 15 minutos. Se algo aqui não bater com o que você vê na
tela, abra uma issue com a label `docs/wrong`.

- [1. Instalar](#1-instalar)
- [2. Abrir o Live e habilitar o RC Setlist](#2-abrir-o-live-e-habilitar-o-rc-setlist)
- [3. Primeiro setlist em três locators](#3-primeiro-setlist-em-três-locators)
- [4. Abrir o painel](#4-abrir-o-painel)
- [5. Parear o celular do palco](#5-parear-o-celular-do-palco)
- [Próximos passos](#próximos-passos)

## 1. Instalar

Você precisa de:

- Ableton Live 12.4.5 Suite (Beta) ou mais recente, com Extensions
  habilitado.
- macOS 13+ (caminho de release) ou Windows 11 23H2+ (caminho de
  release). Linux não é suportado pelo host; o bridge é Python e roda
  onde o Live rodar.
- Um navegador moderno no celular (Safari 17+, Chrome 121+) para o
  Stage Control.

Abra o kit baixado da
[página de release](https://github.com/ntworm/rc-setlist/releases/latest)
e dê duplo clique no instalador do seu sistema. O instalador copia o
RC Bridge para a User Library do Live e imprime a URL final do painel
local.

Se preferir fazer manualmente, siga
[INSTALL.md](INSTALL.md). A instalação 1.0 é uma pasta RC Bridge
mais a extensão `.ablx`; nada mais precisa estar no disco.

## 2. Abrir o Live e habilitar o RC Setlist

1. Abra o Ableton Live.
2. Em **Preferences → Extensions**, confirme que `RC Setlist` aparece
   na lista com status **Enabled**.
3. **Extensions → RC Setlist → Open panel** abre o painel do host.
4. O painel mostra a URL local, o token de controller como QR code, e
   o IP de LAN autodetectado.

A URL é `https://<lan-ip>:4444/`; o QR embute a mesma URL com o token
na query string. Trate o QR como senha — quem escanear consegue parar
o transporte.

## 3. Primeiro setlist em três locators

O Live usa **locators** (cue points no Arrangement). Cada um carrega
o título da música mais tags opcionais dentro de colchetes `[ ]`. O
RC Setlist transforma isso em músicas e seções.

Crie um Set novo, marque o tempo em 120 BPM, e adicione três
locators:

| Beat | Nome                 | Notas              |
| ---- | -------------------- | ------------------ |
| 0    | `INTRO`              | Primeira música    |
| 16   | `> Verso`            | Seção da INTRO     |
| 48   | `MÚSICA 2 [bpm 100]` | Próxima em 100 BPM |

Abra o painel e confirme que você vê:

- `INTRO` listada como música atual
- `Verso` listada como seção da INTRO
- `MÚSICA 2` listada como música separada com BPM 100

Se o painel não mostrar nada, confira o painel de logs; um locator
malformado é a causa mais comum.

## 4. Abrir o painel

O painel é a interface principal do operador. Mostra a música atual,
o cronômetro, o próximo locator e os controles de play, stop, jump e
edição. **Espaço** alterna play/stop; **N** e **P** pulam para o
próximo e o anterior locator; **J** abre um diálogo para digitar o
nome de um marker e pular para ele.

A referência completa está em
[USER-GUIDE.md](USER-GUIDE.md#controles-do-painel).

## 5. Parear o celular do palco

1. No celular do palco, escaneie o QR do painel.
2. O celular abre a página de Stage Control na mesma URL, com o token
   já na query string.
3. Toque em **Confirmar controller** para registrar o celular como
   controller desta sessão.

O celular passa a mostrar a próxima música, o índice da seção, o
cronômetro e a letra. Não há app separado de pareamento; o único
estado que o celular precisa é a URL.

Se o celular perder a conexão, o painel re-renderiza e a URL continua
válida até você reiniciar o Live.

## Próximos passos

- [USER-GUIDE.md](USER-GUIDE.md) — referência completa do painel e
  do Stage Control.
- [CONTRATOS.md](CONTRATOS.md) — o contrato público (HTTP, WS,
  gramática de locators). Leia se quiser escrever seu próprio
  controller.
- [THEME_CONTRACT.md](../THEME_CONTRACT.md) — paleta e tipografia se
  você quer uma skin custom para o Stage Control.
- [TESTER-GUIDE.md](../TESTER-GUIDE.md) — o que conferir num release
  candidate antes de mandar pra banda.
- [DEVELOPMENT.md](../DEVELOPMENT.md) — como rodar os testes e buildar
  a extensão localmente.
