# Perguntas frequentes

## O Ableton RC Setlist é open source?

Ele é source-available sob a PolyForm Noncommercial 1.0.0. Uso, modificação e
redistribuição não comerciais são permitidos conforme a licença; uso comercial
não é permitido. A PolyForm Noncommercial não é uma licença open source aprovada
pela OSI.

## O usuário final precisa de Node.js?

Não. Instale o `.ablx` da release. O Node.js 24.16.0 serve apenas para desenvolvimento.

## Por que o AbletonOSC é obrigatório?

O Ableton RC Setlist usa o AbletonOSC para transporte e operações do Live Object
Model. Instale a partir de <https://github.com/ideoforms/AbletonOSC>. Ele não vem
incluído no pacote.

## Por que o navegador mostra um aviso de certificado?

Na primeira conexão, o navegador pode mostrar `ERR_CERT_AUTHORITY_INVALID`
porque o RC Setlist cria um certificado local autoassinado para WebSockets
seguros. Continue somente se o endereço for exatamente o IP mostrado no painel
do Live e a rede local for confiável. Cada navegador/aparelho pode exigir isso
uma vez.

## Onde as letras ficam salvas?

No diretório de armazenamento de Ableton Extensions, dentro do perfil ativo do
Ableton RC Setlist. Use o editor interno em vez de editar os arquivos diretamente.

## Posso usar minhas letras?

Somente se você for o autor ou tiver autorização. O repositório e o kit de
demonstração usam texto fictício; o Ableton RC Setlist não fornece letras comerciais.

## O macOS funciona?

O código foi projetado para ser portátil, mas a versão 0.5.0 mantém o macOS como
experimental até existir uma matriz completa em hardware real.

## Posso expor o Ableton RC Setlist na internet?

Não. Ele foi projetado para uma rede local confiável. Nunca exponha a porta
`4444` diretamente à internet.

## Posso vender o Ableton RC Setlist ou uma modificação?

Não sob a PolyForm Noncommercial 1.0.0. Leia a [licença](../../LICENSE) e procure
orientação jurídica própria para um caso específico.

## Por que a duração total do meu setlist está diferente do esperado?

Se o seu projeto no Ableton Live possui automações de andamento desenhadas na faixa master do Arrangement e os localizadores não contêm a tag `[bpm N]`, a extensão não consegue ler a curva de automação. Nem o Live Object Model nem o Extensions SDK expõem os pontos de automação da linha do tempo remotamente.

Sem tags declaradas, o RC Setlist calcula a duração usando o andamento corrente do Live como estimativa uniforme e exibe a etiqueta `EST.`. Em um setlist real de 21 faixas com andamentos entre 93 e 166 BPM, essa estimativa gerou uma distorção de 16:59 (95:40 contra os 78:41 reais).

Para obter durações exatas, adicione `[bpm N]` no nome do localizador de cada música (ex.: `Nome da Música [bpm 120]`). O RC Setlist passará a usar o modo de confiança declarada com cálculo trecho a trecho e removerá o aviso `EST.`.

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
