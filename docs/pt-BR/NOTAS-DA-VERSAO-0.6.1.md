# Notas da Versão 0.6.1

O Ableton RC Setlist 0.6.1 é a passada de palco sobre a 0.6.0. Tudo aqui saiu
de rodar a extensão contra um Live Set de verdade: a contagem, o jeito como uma
música passa para a outra, o que Play significa depois de um Stop, e um punhado
de coisas que só aparecem num celular em sala escura.

## O que há de novo

- **A contagem toca no navegador.** Ela rebobinava o playhead do Live um
  compasso e começava o transporte ali — tempo real do arranjo, pertencente à
  música anterior, então a contagem tocava no andamento daquela música e o áudio
  dela tocava junto. Para ser audível, ainda ligava o metrônomo do Live,
  passando por cima de um click que você tinha desligado de propósito. Agora a
  contagem é áudio do navegador, no andamento que o setlist declara para o
  playhead. O Live começa no tempo em que estava, e o transporte e o metrônomo
  dele nunca são tocados para produzi-la. O Play é enviado um pouco antes do
  último tempo, para o transporte chegar no tempo forte; apertar Play de novo
  durante a contagem começa na hora, e Stop cancela.
- **A ajuda distingue `[next]` de `[skip]`** e mostra o caso de emenda: um
  marcador de fim com `[next]`, seguido da próxima música.

## Correções

- **Um marcador `[next]` no fim da música pula o vão de verdade.** `[next]` e
  `[skip]` eram executados pelo salto de cue do Live, que o Live quantiza pela
  quantização global: medido num set real, o marcador disparou no tempo 872.3 e
  o Live saltou em 876.0, a linha de compasso seguinte. Para um `[next]` posto
  onde o áudio da música termina, seguido de um compasso vazio — a razão de a
  tag existir — o salto caía exatamente onde a próxima música já começava, e o
  marcador parecia não fazer nada. As duas tags agora movem o playhead
  diretamente: a passagem acontece cerca de um décimo de segundo depois de o
  marcador ser cruzado, nunca antes, e a próxima música começa do primeiro tempo.
- **O Play toca de onde você vê o playhead.** O Live oferece dois inícios, e
  nenhum é "a partir do playhead": um começa no marcador de início, o outro
  retoma de onde o transporte parou pela última vez e ignora tudo o que foi
  feito com o playhead desde então — inclusive um salto para uma seção com o
  transporte parado. O Play agora retoma quando o playhead não se moveu desde
  que o transporte parou, e começa do marcador de início quando um salto ou um
  clique o moveu.
- **Um salto quantizado chega no tempo que a página anuncia.** O salto de cue
  era enviado quando o relógio do próprio RC Setlist passava o tempo de
  chegada — logo depois da linha da grade do Live — e o Live, que quantiza
  saltos de cue para a próxima linha da grade, o executava um compasso inteiro
  depois do mostrado. O salto agora é entregue ao Live no instante do pedido, e
  o Live o executa na linha da grade que a página mostra.
- **O primeiro Play depois de abrir retoma de onde o Live está**, em vez de
  ler os relatos de andamento que chegam antes de qualquer posição como um
  playhead parado no zero.
- **O Stop não dispara mais um salto abandonado.** Um salto esperando a
  quantização ficava armado através do Stop e podia levar o transporte para uma
  seção da qual você já tinha desistido, segundos depois.
- **Um salto com o transporte parado move o playhead na hora**, então a
  contagem lê o andamento da seção que você acabou de escolher, e não de onde o
  playhead estava.
- **Tags de música voltam a disparar.** Um `[stop]`, `[next]`, `[skip]`,
  `[loop]`, `[bpm]` ou `[click]` escrito numa música nunca era lido quando o
  playhead estava dentro de qualquer seção dela — o que, com uma seção começando
  no mesmo tempo da música, era sempre. Tags de música e de seção agora são
  avaliadas de forma independente.
- **Um Live Set vazio limpa as músicas anteriores**, inclusive quando o último
  localizador é apagado.
- **A lista de músicas não se reconstrói mais a cada dois segundos**, e o
  piscar do tempo não força mais um layout inteiro da página a cada batida.
- **O dígito da contagem substitui o triângulo de Play** em vez de ser
  desenhado por cima, e um segundo toque silencia a contagem em vez de deixar
  o compasso soando embaixo da reprodução que ele iniciou.
- **O menu Ferramentas cabe nos seus rótulos.** "Mapeamento de Teclado"
  empurrava todos os botões para fora do popover.
- **As listas de seleção nativas ficaram legíveis.** O seletor de setlist abria
  como uma lista branca com texto quase branco.

*Para detalhes completos sobre a instalação, consulte o [Guia de Instalação](INSTALL.md).*

*Read these notes in English: [RELEASE-NOTES-0.6.1.md](../RELEASE-NOTES-0.6.1.md).*
