# Notas da Versão 0.6.0

O Ableton RC Setlist 0.6.0 refaz duas coisas em que o aplicativo se apoiava sem
que nenhuma delas fosse sólida: como ele mede um show e como você altera um
marcador. As telas de palco também ganharam uma superfície desenhada para sala
escura, e não para mesa iluminada.

## O que há de novo

- **Editor de marcador**: clique duplo numa música ou numa seção e toda tag vira
  um controle. Uma música carrega nome, cor, andamento inicial e os
  comportamentos stop, next e skip, além da lista das suas seções, para entrar e
  voltar. Loop e click pertencem à seção, porque é ali que a música está
  estruturada. O campo de texto cru que isso substitui juntava nome e tags numa
  entrada só, onde `[bpm 107]` — a tag que alimenta o cálculo de duração — podia
  ser apagada por um toque errado.
- **Cores de música**: dezesseis cores dessaturadas numa matriz de oito por dois.
  O matiz sobe ao longo de cada linha e o tom se aprofunda em cada coluna, então
  duas cores que se distinguem num palco escuro são duas que ficam distantes na
  tira. A cor é memória do próprio RC Setlist: fica guardada junto do seu
  setlist, nunca é escrita no projeto do Live, e acompanha a música quando você a
  renomeia ou a move.
- **A música é reconhecida por nome e posição**: renomeie e continua a mesma
  música; arraste para outro lugar e continua a mesma música. Mude as duas coisas
  de uma vez e ela é honestamente tratada como nova. Apague um localizador sem
  querer e recrie: o que o RC Setlist lembrava volta.
- **Tipografia própria de palco**: Martian Mono para a interface e Barlow Semi
  Condensed para as letras cantadas, que cabe cerca de 45% mais palavras por
  linha no celular sem descer do piso de 12px. Acentos e cedilhas não são mais
  cortados.
- **Confiança da duração**: um selo `EST.` aparece sempre que o setlist não tem
  nenhuma tag `[bpm N]`, para que uma estimativa uniforme nunca seja confundida
  com um número exato.
- **Segurança com automação de tempo**: um botão **Escrever tempo no salto**,
  desligado por padrão. O RC Setlist também detecta sozinho a automação de tempo
  do Arrangement e se recusa a escrever tempo quando a encontra, mesmo com o
  botão ligado.

## Correções

- **A duração do show não depende mais do que estava tocando.** Um campo
  capturado devolvia o tempo ao vivo para a duração da própria música, então um
  set com automação de tempo se media de um jeito diferente a cada passada — até
  16:59 de variação num show de 79 minutos. As durações agora vêm do tempo que os
  localizadores declaram, integrado trecho a trecho numa única linha do tempo
  cronológica para o setlist inteiro.
- **Renomear um localizador não arrisca mais perdê-lo.** A renomeação acontece no
  lugar, em vez de apagar o cue point e criar um substituto, e a lista de cues do
  próprio Live é relida em vez de confiar na palavra da ponte.
- **Os prefixos das seções são preservados.** O Live aceita tanto `> Verso`
  quanto `Música > Verso`; o editor reescrevia a primeira forma na segunda e
  renomeava toda seção em que encostava.
- **A edição é recusada com o transporte tocando**, em qualquer modo. A
  renomeação move o playhead para agir sobre o cue, então com a reprodução
  rodando a escrita caía no compasso onde a reprodução tivesse chegado.
- **As edições de marcador atualizam na hora.** Os cue points são lidos a cada
  dois segundos, e dentro dessa janela o editor reabria com valores velhos e os
  gravava de volta — o que fazia as tags parecerem cair aleatoriamente.
- **Toda tag que o painel escreve agora tem selo.** `[skip]` e `[click]` mudavam
  o que acontece no palco sem deixar marca nenhuma no card.
- **O play não vira mais um símbolo de pause**, que dava a impressão de que
  clicar de novo pausaria.

*Para detalhes completos sobre a migração a partir da 0.5.x, consulte o [Guia de Instalação](INSTALL.md).*

*Read these notes in English: [RELEASE-NOTES-0.6.0.md](../RELEASE-NOTES-0.6.0.md).*
