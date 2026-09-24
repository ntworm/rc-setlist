# Notas da versão — RC Setlist 1.0.0

**Data de lançamento:** 2026-09-14
**Linha de versões suportada:** `1.0.x`
**Also available in English:** [`../RELEASE-NOTES-1.0.0.md`](../RELEASE-NOTES-1.0.0.md)

Esta é a primeira versão do RC Setlist como uma linha única consolidada.
As notas das versões 0.6.0, 0.6.1 e 0.7.0 continuam no repositório como
registro histórico; o conteúdo está resumido na seção **Desde 0.5.1**
abaixo para quem vem da linha pública 0.5.1.

## Destaques

- **Renomeado para "RC Setlist"** seguindo as diretrizes de marca da
  Ableton, que proíbem "Ableton" no nome de um produto de terceiros.
- **Migração única** para quem vem da 0.x: o kit traz
  `Migrate-RC-Setlist-Data.cmd` (Windows) e
  `Migrate RC Setlist Data.command` (macOS) que copiam perfis,
  project-setlists, token e preferências para o novo layout sem mexer
  no antigo.
- **Gates de qualidade** — ESLint, Prettier, knip, dependency-cruiser,
  ruff, html-validate e `@axe-core/playwright` agora fazem parte do
  `ci:public`.
- **Documento de contratos** em `docs/CONTRACTS.md` (e
  `docs/pt-BR/CONTRATOS.md`) descreve a versão 3 do protocolo WS, os
  formatos em disco, a sintaxe dos locators, os endereços OSC,
  os endpoints HTTP e a política SemVer. Cada asserção é exercida por
  `tests/release-contracts.test.mjs`.
- **Limpeza de ciclos e camadas** — 5 ciclos de dependência removidos,
  `bridgeState` movido de `core/` para `runtime/`, `handlers.ts`
  dividido em um dispatcher e seis módulos por família, `setlist-manager.ts`
  delega avaliação de tags e seguimento de transporte a helpers
  dedicados.
- **Strictness de análise estática** — `verbatimModuleSyntax` está
  ligado; o build TypeScript resolve o SDK apenas por uma fronteira de
  tipos versionada.

### Correções do teste de palco (16/09/2026)

- **Carregamento do CSS do painel**: estilos restaurados ao remover a barra de fechamento automático da tag HTML `<link>`, que fazia o navegador ignorar a folha de estilos.
- **Layout dos cards de telemetria**: corrigido o corte de conteúdo no modo retrato do celular introduzindo uma restrição de quebra de layout e proporção 58/42.
- **Áudio do count-in**: metrônomo silenciado por padrão em dispositivos móveis. Agora é uma configuração opcional do navegador via chave `rc-setlist.count-in-audio` no localStorage.
- **Autocomplete do alvo de jump**: o editor de marcadores agora exibe os nomes dos alvos de forma limpa, sem as tags duplicadas de `[jump]` ou `[loop]` no dropdown.

## Desde 0.5.1

### RC Bridge (control surface do Live embutido)

O Remote Script com que a extensão conversa agora vem dentro da
extensão e do kit de instalação, como fork do AbletonOSC sob MIT
(upstream `0ca6821`). Ninguém baixa o AbletonOSC à mão: o kit traz
`Install-RC-Bridge.cmd` (Windows) e `Install RC Bridge.command`
(macOS) que copiam para a User Library do Live e mostram o único
passo que falta. Selecionar **RCBridge** em Settings › Link, Tempo &
MIDI › Control Surface continua sendo passo do usuário, porque o Live
não deixa ninguém fazer por ele. O fork também expõe `last_event_time`,
que o upstream nunca expôs, então a duração total do show não precisa
mais da ponte MCP.

### `[jump NOME]`

Um marcador que passa a reprodução para um marcador _nomeado_ em vez
do próximo — uma seção da mesma música, uma música, ou `Música > Seção`.
Nomes batem com tags removidas e ignorando caixa; um nome puro é
resolvido primeiro nas seções desta música, depois nos títulos, depois
nas seções de qualquer música na ordem do Arrangement. Usa a mesma
transferência imediata de `[next]` e `[skip]`, tem campo próprio no
editor de marcadores e selo no card, e um nome que não bate nada não
faz nada.

### Notas por música

Uma linha para o palco — tom, afinação, quem conta — editada no painel
da música ao lado da cor, mostrada sob o título no card e na tela de
Performance. Guardada no song book com a cor, então acompanha a música
em renomeações e movimentos e nunca toca no projeto do Live.

### Count-In repensado (0.6.1)

O count-in voltava o playhead do Live uma barra e iniciava ali. Aquela
barra é tempo real de Arrangement da música anterior, então o count
era ouvido no andamento da música anterior e o áudio dela também
tocava. Tornar o count audível também ligava o metrônomo do Live, o
que sobrescrevia um click que o operador tinha desligado de propósito.
O count foi movido para o navegador no andamento que o setlist declara
para o playhead, o Live começa no batimento em que já estava, e o
transporte e o metrônomo dele nunca são tocados para produzi-lo. Play
é enviado pouco antes do último batimento para o transporte chegar no
downbeat; pressionar Play de novo durante o count inicia imediatamente,
e Stop cancela. O aviso "count-in encurtado" desapareceu com o retrocesso
que o causava.

**1.0.0: click do navegador desligado por padrão.** O áudio da contagem no navegador
agora vem desligado por padrão, tornando a contagem apenas visual, para que o celular
do operador não apite pelo alto-falante no palco. O click pode ser ligado por aparelho
através da chave `rc-setlist.count-in-audio` no `localStorage` do navegador.

### Live Set vazio limpa as músicas (0.6.1)

Uma lista de cue points vazia válida agora limpa as músicas e os alvos
exibidos, inclusive quando o último locator é deletado. Dados
indisponíveis e erros de leitura continuam preservando o último estado
válido.

### Stop desarma um jump pendente (0.6.1)

Um jump esperando o limite de quantização ficava armado pelo Stop, e o
scheduler executava o jump pendente assim que uma posição reportada
passasse seu beat de pouso. O Stop do Live move o playhead, então a
próxima amostra depois do Stop podia levar o transporte para uma
seção que o operador já tinha mudado de ideia — chegando como jump
para uma parte aparentemente aleatória do set, segundos depois do Stop.
Stop agora desarma.

### `[next]` e `[skip]` passam o playhead direto (0.6.1)

`[next]` e `[skip]` eram executados pelo cue jump do Live, que o Live
quantiza para a próxima linha de grade da quantização global: medido no
set do proprietário, NEXT disparou no beat 872.3 e o Live saltou para
876.0, a próxima linha de barra. Para um `[next]` colocado onde o áudio
de uma música termina e seguido por uma barra vazia — a razão do tag
existir — o jump caía exatamente onde a próxima música começava, então
o marcador parecia não fazer nada, e um gap de duas barras só perdia
uma barra. Os dois tags agora realocam o playhead direto, que o Live
faz na hora: a transferência acontece cerca de um décimo de segundo
depois do marcador ser cruzado (poll de posição + tick de comando do
AbletonOSC), nunca antes, e a próxima música começa do primeiro beat.

### Jump parado move o playhead na hora (0.6.1)

Enquanto parado, o alvo do jump é adotado de imediato; o caso de
ensaio para o qual o count-in existe é "pular para uma seção enquanto
parado, depois Play imediatamente".

### Jump quantizado pousa no beat anunciado (0.6.1)

Enquanto tocando com quantização ligada, o cue jump era enviado quando
o clock deste lado passava o beat de pouso — logo após a linha de
grade do Live — e o Live, que quantiza cue jumps para a próxima linha
de grade, pousava uma barra inteira depois. Todo jump quantizado
chegava uma barra depois do que a página dizia. O jump agora é
entregue ao Live no momento em que é pedido e o Live pousa na exata
linha de grade que a página mostra.

### Lista de músicas não reconstrói mais a cada dois segundos (0.6.1)

Cues chegam do SDK do Live a cada 100ms e do AbletonOSC a cada 2000ms, e
os dois não concordam no último decimal. O manager comparava floats
exatos enquanto seus chamadores comparavam uma fingerprint quantizada
para 1/100 de beat, então cada fonte parecia uma mudança para a outra:
cada poll do OSC reparseava o setlist e o cliente reconstruía a lista
inteira. O manager agora usa a mesma fingerprint quantizada — uma
diferença abaixo de 1/100 de beat não pode mudar como um locator
parsea.

### Flash do beat sem layout cheio (0.6.1)

O card de andamento reiniciava sua animação CSS lendo `offsetWidth`,
o que força layout do documento inteiro. Os dois visores de palco
agora piscam via Web Animations API, que não invalida layout e recicla
uma única animação.

### Menu de ferramentas cabe nos rótulos (0.6.1)

O popover era uma caixa fixa de 11rem enquanto sua coluna de grid
dimensionava para o rótulo mais largo, então "Mapeamento de Teclado"
empurrava todo botão para fora da borda direita. O popover agora é
dimensionado pelo seu rótulo mais largo, limitado à viewport.

### Listas nativas de select são legíveis (0.6.1)

O dropdown do seletor de setlist abria como uma lista branca com texto
quase branco, porque o Chromium pinta a lista de opções a partir do
próprio background do select. Todo select nativo agora pinta suas
opções escuras.

### Guia de ajuda distingue `[next]` e `[skip]` (0.6.1)

As duas linhas se pareciam. O guia agora diz para onde cada tag leva o
playhead, que `[next]` nunca avança para a próxima seção, que ambos
passam a bola no marcador em vez de na próxima barra, e mostra o caso
de encadeamento — marcador de fim com `[next]` seguido da próxima
música.

### Dígito do count substitui o triângulo de Play (0.6.1)

Era desenhado sobre o glifo, deixando os dois visíveis ao mesmo tempo.

### Segundo press silencia o count (0.6.1)

Cancelar limpava os timers, o que parava os dígitos de mudar, mas os
blips já estavam agendados no clock de áudio e continuavam soando por
baixo do playback que esse segundo press tinha iniciado.

### Tags de música disparam de novo (0.6.1)

O avaliador de automações escolhia um alvo, `section || song`, então
quando o playhead estava dentro de qualquer seção as próprias tags da
música nunca eram lidas de novo. Uma tag de nível música só disparava
no gap entre o locator da música e sua primeira seção, e quando uma
seção começava no próprio beat da música — o caso comum — nunca
disparava. O editor de marcadores oferece STOP, NEXT e SKIP no painel
da música, então isso era um controle que o usuário podia definir e
ver não fazer nada. Tags de música e de seção são agora avaliadas
independentemente.

### Por que um fork do AbletonOSC (0.6.1)

AbletonOSC envia toda resposta e toda atualização de listener para
uma porta fixa, 11001, então só um cliente por máquina podia ouvir —
RC Surface e RC Setlist no mesmo Live não podiam funcionar juntos, e o
perdedor mostrava "OSC return port busy". O RC Bridge escuta na porta
dele (11020), responde para quem pediu, e publica as atualizações de
cada listener para todo assinante.

### Play toca de onde o playhead está (0.6.1)

Live oferece dois inícios e nenhum é "do playhead". Play retoma quando
o playhead não se moveu desde que o transporte parou, e inicia do
marcador de início quando um jump ou um clique moveu.

### O primeiro Play após start retoma de onde o Live está (0.6.1)

O SDK reporta o andamento a cada 100ms desde o momento em que a
extensão inicia, e esse report era roteado pela atualização de
transporte, apresentando uma posição de zero como a primeira observação
parada. Reports só de andamento agora têm seu próprio caminho.

### Regressão de transporte OSC-only (0.6.1)

O caminho de transporte só OSC, que um setup sem o Ableton MCP usa e
que a máquina do próprio proprietário nunca exercita, agora tem um
teste de regressão fim a fim para a transferência de playhead no
`[next]`.

### Command Bus e Error Sanitization (0.7.0)

O command bus agora anexa mensagens de erro voltadas ao operador
(`OperatorError` e `ProfileError`) em `command_status.error`, enquanto
exceções internas (como caminhos brutos de filesystem) permanecem
estritamente sanitizadas e chegam como `execution_failed` genérico.

### Parsing de Tag de Locator limpo (0.7.0)

Extração de tag e construção de seção foram refatoradas em um pipeline
único coerente, sem branches duplicadas.

### Cache do Song Book segue o perfil ativo (0.7.0)

Cores e notas de música são cacheadas por perfil; trocar de perfil
agora limpa o cache na hora, evitando que edições de um perfil
vazem em outro.

### Tick de Sync do MCP loga falhas inesperadas em silêncio (0.7.0)

Timeouts e recusas de conexão do bridge ficam em silêncio como
esperado quando o MCP está ausente, enquanto erros internos de callback
logam limpamente.

### Código morto e testes órfãos removidos (0.7.0)

Utilitários aposentados de criação de locator de sessão de teste e
testes órfãos foram removidos limpamente.

## Mudanças em 1.0

### Renomeado para "RC Setlist"

O nome do produto não inclui mais "Ableton" (diretrizes de marca da
Ableton). Dados antigos da 0.x ficam em
`<Extensions Data>/ntworm.ableton-rc-setlist`; o kit migra para
`<Extensions Data>/ntworm.rc-setlist` e a entrada antiga da extensão no
Live deve ser removida em **Configurações > Extensões**.

### Contratos documentados

`docs/CONTRACTS.md` e `docs/pt-BR/CONTRATOS.md` descrevem toda
superfície externa. Cada contrato é reforçado por uma asserção em
`tests/release-contracts.test.mjs`.

### Gates de qualidade

`ci:public` agora inclui `lint`, `format:check`, `deadcode`,
`deps:check`, `lint:py`, `html-validate` e o scan de landing do
`@axe-core/playwright`. O script `gates:quality` coleta todos para
runs manuais.

### Limpeza de ciclos e camadas

- `bridgeState` movido de `src/core/` para `src/runtime/`.
- `commands/handlers.ts` dividido em um dispatcher e seis módulos por
  família sob `src/commands/handlers/`.
- `setlist-manager.ts` delega avaliação de tags para
  `src/core/automation-evaluator.ts` e seguimento de transporte para
  `src/core/transport-tracker.ts`.
- 5 ciclos de dependência removidos.

## Correções em 1.0

- Os scripts `Migrate-RC-Setlist-Data` do kit são idempotentes e nunca
  sobrescrevem um arquivo no destino.
- O painel agora pede ao operador para rodar a migração quando a pasta
  nova de dados está vazia.
- `verbatimModuleSyntax` está ligado; type-only imports são explícitos.
- `tsconfig.json` reforça `noUnusedLocals`, `noUnusedParameters`,
  `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noImplicitReturns`.

## Removido em 1.0

- O nome de produto `Ableton RC Setlist` em todas as superfícies
  públicas (apenas entradas históricas no CHANGELOG e prosa de
  contexto de migração o mantêm).
- A nomeação de artefato `Ableton-RC-Setlist-<version>`; 1.0 envia
  `RC-Setlist-1.0.0.ablx` e `RC-Setlist-1.0.0-Installation-Kit.zip`.
- Código morto reportado por `knip` e exports inalcançáveis do passe
  de narrowing da regra `no-explicit-any`.
- Chamadas `console.*` em caminhos voltados ao usuário; todos esses
  logs agora vão por `src/util/log.ts` com a mensagem para o operador
  e um escopo legível por máquina.
- Notas de versão para 0.6.0, 0.6.1 e 0.7.0 (incorporadas em
  "Desde 0.5.1" acima e no `CHANGELOG.md`).

## Segurança

Ver `internal/SECURITY-REVIEW-1.0.md` para a revisão item a item e
`SECURITY.md` para a linha de versões suportada e como reportar
problemas.

## Atualizando da 0.x

1. Instale `RC-Setlist-1.0.0.ablx` da release.
2. No Live, abra **Configurações > Extensões** e remova a entrada
   antiga **Ableton RC Setlist**.
3. Rode `Migrate-RC-Setlist-Data.cmd` (Windows) ou
   `Migrate RC Setlist Data.command` (macOS) uma vez antes de abrir o
   Live pela primeira vez com a 1.0. O script copia perfis,
   project-setlists, token e preferências para a pasta nova sem mexer
   na antiga.
4. Reinicie o Live; a extensão nova continua de onde a antiga parou.

Pular a migração ou deixar as duas extensões instaladas faz seus
perfis antigos ficarem invisíveis para a extensão nova.
