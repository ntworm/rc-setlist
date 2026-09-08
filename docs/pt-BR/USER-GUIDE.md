# Guia do Ableton RC Setlist

O Ableton RC Setlist transforma localizadores do Arrangement do Ableton Live em
um setlist e uma tela de performance. Leia [INSTALL.md](INSTALL.md) primeiro.

## Idioma da interface

A interface começa em inglês. Use o menu de idioma no painel do Live, no Controle
de Palco ou na Performance para escolher **English** ou **Português (Brasil)**.
A escolha fica salva localmente. Nomes de músicas, seções e conteúdo de letras ou
cifras são dados do show e nunca são traduzidos.

## Gramática dos localizadores

Um localizador de música tem um título. Uma seção usa `Música > Seção` ou a sintaxe relativa `> Seção` (que se vincula à música anterior). Tags de ação isoladas como `[stop]` e localizadores de automação relativa como `> [stop]` pertencem à música cronologicamente anterior.

```text
Música A [bpm 122] [click]
> Intro
> Verso
> Refrão [loop 4x]
[stop]
Marcador Técnico [ignore]
```

| Tag | Efeito |
| --- | --- |
| `[loop]` | Repete a seção atual até ser desativado. |
| `[loop Nx]` | Repete a seção N vezes. |
| `[stop]` | Para quando o localizador é alcançado. |
| `[next]` | Avança para a próxima música. |
| `[bpm N]` | Define o BPM esperado. |
| `[click]` / `[click off]` | Liga ou desliga o metrônomo do Live. |
| `[skip]` | Ignora esta seção ou música. |
| `[hidden]` | Oculta uma âncora de automação do setlist visível. |
| `[ignore]` | Marcador técnico que oculta o localizador e tem precedência sobre qualquer tag de ação. |

As tags não diferenciam maiúsculas de minúsculas e não aparecem no nome exibido. A tag `[ignore]` tem precedência sobre tags de automação, ocultando o marcador e ignorando quaisquer tags de ação no localizador sem criar músicas, seções ou automações.

## Editar um marcador

Dê um clique duplo na linha de uma música ou no chip de uma seção no Controle de
Palco para abrir o editor de marcador. Ali toda tag é um controle — você nunca
digita uma `[tag]` à mão, e não consegue apagar uma sem querer.

Uma **música** carrega nome, cor, andamento inicial e os comportamentos
`[stop]`, `[next]` e `[skip]`. Ela também lista suas seções; clique em uma para
editá-la, e a seta no topo do painel traz você de volta para a música.

Uma **seção** carrega nome, andamento, loop, click e os mesmos três
comportamentos. Loop e click ficam aqui, e não na música, porque é aqui que a
música está estruturada.

Três garantias do editor:

- **Uma tag que o painel não mostra nunca é apagada.** Tudo que o RC Setlist não
  reconhece, e tudo que ele reconhece mas não oferece para aquele tipo de
  marcador, atravessa o salvamento intacto.
- **Uma seção mantém o prefixo que já tinha.** O Live aceita tanto `> Verso`
  quanto `Música A > Verso`; a grafia que o seu set usa é preservada.
- **Salvar sem mudar nada não escreve nada.** As tags são comparadas por
  significado, então reordená-las não é uma mudança.

A edição é recusada com o transporte tocando. Renomear um localizador significa
apagá-lo e criá-lo de novo, e o Live só cria um cue point onde o playhead está —
com a reprodução rodando, o marcador novo cairia onde quer que o playhead
tivesse chegado. Pare o transporte antes.

A cor é memória do próprio RC Setlist. Ela fica guardada junto do seu setlist,
nunca é escrita no projeto do Live, e acompanha a música quando você a renomeia
ou a move. Os oito tons são dessaturados de propósito: no card, cor é
identidade, e as cores vivas ficam reservadas para estado.

## Perfis

Os perfis pertencem ao Live Set atual. O seletor de setlist ativo e o botão
**Gerenciar setlists** ficam no topo do Controle de Palco. Um `.als` salvo pode ter vários setlists
para ordens, ensaios ou formações diferentes, mas **Gerenciar setlists** não
mostra perfis de outro projeto do Ableton. Ao abrir outro Live Set, o RC Setlist
troca para o registro separado daquele Set.

Dentro do Live Set atual, os perfis separam ordem do setlist, letras, exportações
e estados relacionados. No Controle de Palco você pode criar, selecionar e
renomear perfis, mover um perfil inativo para a lixeira recuperável e
restaurá-lo depois com o mesmo UUID e os mesmos dados. A exclusão não apaga
permanentemente.

As alterações de perfil são exclusivas do controlador e o transporte deve estar
parado. O perfil ativo e o único perfil restante não podem ser excluídos. Para
mover outro perfil para a lixeira, digite exatamente o nome exibido no campo de
confirmação.

O armazenamento global de versões antigas continua preservado como backup
local, mas não é misturado em **Gerenciar setlists**. Somente uma pasta legada
que corresponda exatamente ao Live Set salvo é migrada, sem apagar a origem.

## Duração do setlist
 
O Controle de Palco mostra a duração de cada música no cartão correspondente. O
cabeçalho mostra a duração total do setlist. Cada música vai do seu localizador
até o localizador da próxima música, incluindo qualquer intervalo de transição.
A última música termina no fim do Arrangement informado pelo Live; o total vai do
primeiro localizador até esse mesmo fim e também inclui as transições. Um travessão
indica que o Live ainda não forneceu um limite final válido do Arrangement.

### Metodologia de duração e estabilidade em palco

As durações são referências fixas de cronograma estabelecidas no carregamento do set
e não oscilam quando o knob de tempo do Live é girado ou quando a reprodução começa.
No palco, os tempos previstos precisam permanecer estáveis para a equipe e a banda,
em vez de variarem com ajustes momentâneos de andamento.

### Limitação de automação de tempo do Arrangement

Projetos no Live frequentemente utilizam automações de andamento desenhadas na faixa master.
Contudo, **os envelopes de automação de tempo do Arrangement não podem ser inspecionados
remotamente** por nenhuma extensão. Nem o Ableton Extensions SDK, nem o AbletonOSC,
nem as ferramentas MCP, nem o Live Object Model (LOM) expõem a lista de pontos de automação
sem movimentar fisicamente o cursor de reprodução. A evidência por trás dessa
conclusão, e o que o RC Setlist faz no lugar, está em
[docs/architecture/tempo-automation-limitation.md](../architecture/tempo-automation-limitation.md).

### Como obter durações exatas (`[bpm N]`)

Para calcular durações exatas trecho a trecho para cada música e seção, declare o
andamento explicitamente no nome do localizador usando `[bpm N]` (ex.: `Música A [bpm 122]`
ou `> Refrão [bpm 135]`).

- **Confiança declarada**: Havendo pelo menos uma tag `[bpm]`, o RC Setlist calcula
  durações exatas trecho a trecho para músicas e seções com tag, propagando o andamento
  através de limites sem tag.
- **Confiança estimada (`EST.`)**: Se nenhum localizador contiver tag `[bpm]`, o RC Setlist
  utiliza o andamento inicial da sessão do Live, classifica a confiança da duração como
  estimada e exibe o indicador `EST.` ao lado do tempo total e nos cartões do HUD.

### Exemplo de medição real

Em um setlist de produção medido com 21 músicas e andamentos entre 93 e 166 BPM:
- **Duração exata trecho a trecho**: **78:41** (4.721 segundos).
- **Estimativa de andamento único a 99 BPM**: 95:40 — **erro de 16:59 (+21,6%)**.
- **Estimativa de andamento único a 136 BPM**: 69:38 — **erro de 9:03 (-11,5%)**.

A declaração de tags `[bpm N]` nos localizadores de música elimina a discrepância de
16:59, restaura o total exato de 78:41 e limpa o indicador de aviso `EST.`.

## Controle de Palco

Abra `/setlist` pela URL de controle com token mostrada no painel do Live.

- Arraste músicas para mudar a ordem exibida.
- Use Play e Stop para ações imediatas.
- Anterior e Próxima exigem um hold deliberado de 500 ms.
- Selecione a quantização; o agendador de saltos aplica imediatamente o valor
  pedido e o reconcilia com a resposta nativa do Live quando ela estiver disponível.
- Use a janela de letras para criar, sincronizar e editar linhas.
- Exporte o setlist atual como CSV UTF-8 (salva uma cópia na pasta `exports/` do perfil ativo e baixa na pasta de Downloads do seu navegador).
- Use a tela cheia para uma estação compacta de palco.

### Ordem de tempo dos saltos

Saltos explícitos aplicam o BPM de destino antes do salto de cue. O BPM da seção
substitui o BPM da música; uma seção sem BPM herda o BPM da música de destino.
No limite de execução, o RC Setlist usa uma escrita de tempo SDK-first e depois
envia o salto de cue. As operações são sequenciais, não atômicas, portanto não
garantem precisão de amostra. A automação de tempo nativa no Arrangement no
destino é recomendada para transições com precisão de amostra dentro do Live.

### Contagem de um compasso

`CONTAGEM 1 COMP.` ativa um pré-roll de exatamente um compasso antes do ponto
selecionado, somente quando Play é solicitado e o transporte está parado. O
recurso usa o metrônomo nativo do Live e o transporte: o RC Setlist recua o
playhead em um compasso, inicia a reprodução e restaura o Click no ponto
selecionado caso ele tenha sido ligado temporariamente. Se o ponto estiver a
menos de um compasso do beat zero, a contagem disponível é encurtada com
segurança.

Esse controle de ensaio não entra em Record e não arma pistas. Ele também não
altera a quantização dos saltos. Quando o Live já está tocando, Play e os saltos
de música/seção mantêm o comportamento existente, incluindo a quantização
atual. Uma alteração manual de Click durante a contagem tem prioridade sobre a
restauração automática.

A interface mantém o último estado válido durante reconexões breves. O aviso de
reconexão não significa que o estado antigo acabou de ser confirmado.

## Performance

Abra `/performance` para uma tela de alto contraste, principalmente de leitura.
Ela mostra música e seção atuais/próximas, timecode, compasso/tempo, BPM/click e
o contexto da letra.

Pressione `F` ou use o botão de tela cheia. Quando houver suporte, o Screen Wake
Lock permanece ativo durante a tela cheia e é liberado ao sair.

## Letras

Use somente texto original, licenciado ou autorizado.

O Ableton RC Setlist aceita linhas LRC sincronizadas:

```text
[00:00.00] A sala desperta sob uma luz âmbar
[00:04.50] Um pulso silencioso vira nosso guia
```

Na janela de letras você pode colar linhas, avançar por elas durante o áudio,
editar timestamps e salvar. O texto fica no perfil ativo. Texto simples também
é aceito para exibição sequencial.

## Ordem e CSV

A ordem personalizada é um estado de apresentação; ela não move localizadores
dentro do Live Set. O CSV inclui uma linha por música visível com o `setlist`
ativo, `start_beat`, BPM declarado, duração numérica e legível,
`sections_count`, nomes em `sections`, ações em `automations` e `lyric_lines`.
Ele não inventa tom, fórmula de compasso por música, contagem de execuções nem
histórico da última reprodução. O arquivo usa ponto e vírgula com BOM UTF-8 para
compatibilidade com planilhas, é salvo no diretório do perfil ativo na pasta
`exports/` e enviado para os Downloads do navegador.

## Início automático

O painel pode lembrar se o servidor local deve iniciar com a extensão. Deixe essa
opção desligada quando o serviço de rede só deva rodar em ensaios ou shows.

## Prática segura

- Ensaie o Live Set e a versão exata da extensão antes de uma apresentação.
- Mantenha host e controle em uma rede dedicada e confiável.
- Salve um setlist alternativo fora do Ableton RC Setlist.
- Não troque perfil, rede ou instalação do AbletonOSC durante o show.
- Confira perfil ativo e trava de transporte antes de liberar o controle.

Esta versão lê localizadores do Arrangement. O suporte ao Session View foi adiado.
Os links locais do Controle de Palco e da Performance continuam usando HTTPS.

## Automação de tempo desenhada no Live

Se o seu Arrangement tem automação de tempo própria, mantenha **Definir o tempo do
Live ao pular** **desligado** no painel do Live. Ele já vem desligado, e o motivo
é este.

Um pulo explícito pode escrever o tempo de destino no Live antes de mover o
playhead. Escrever `song.tempo` sobrepõe a automação de tempo do Live: o arranjo
para de seguir o próprio envelope até você clicar em **Re-Enable Automation** na
barra de transporte. Um pulo no meio do show achataria o tempo do resto do set.

O RC Setlist também vigia isso sozinho. Quando o tempo que o Live reporta diverge
da tag `[bpm N]` declarada naquele ponto do setlist, a extensão conclui que
alguém além do setlist é dono do tempo e se recusa a escrever, mesmo com a opção
ligada.

Uma tag `[bpm N]` significa "meça a duração com isto". Ela não significa "imponha
isto ao Live". Marcar as suas músicas é seguro com automação de tempo, e é o que
transforma uma duração estimada do set numa duração exata.

Ligue a opção apenas quando as tags forem a sua fonte de verdade para o tempo e o
Arrangement não tiver automação de tempo.

## Como o RC Setlist reconhece as suas músicas

**O locator do Ableton é a fonte de verdade. O RC Setlist nunca escreve nada
escondido no seu projeto.** Ele reconhece uma música por nome e posição, nessa
ordem.

- Renomeie uma música e ela continua a mesma — a posição não mudou.
- Arraste para outro lugar e ela continua a mesma — o nome não mudou.
- Mude os dois ao mesmo tempo e ela é tratada como música nova.

Tudo que o RC Setlist guarda por fora segue essa identidade. Apague um locator
sem querer e recrie: o que ele lembrava volta.

O raciocínio completo está em [docs/architecture/song-identity.md](../architecture/song-identity.md).
