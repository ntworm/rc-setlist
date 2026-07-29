# Guia do Ableton RC Setlist

O Ableton RC Setlist transforma localizadores do Arrangement do Ableton Live em
um setlist e uma tela de performance. Leia [INSTALL.md](INSTALL.md) primeiro.

## Idioma da interface

A interface começa em inglês. Use o menu de idioma no painel do Live, no Controle
de Palco ou na Performance para escolher **English** ou **Português (Brasil)**.
A escolha fica salva localmente. Nomes de músicas, seções e conteúdo de letras ou
cifras são dados do show e nunca são traduzidos.

## Gramática dos localizadores

Um localizador de música tem um título. Uma seção usa `Música > Seção`.

```text
Sinal Fictício [bpm 122] [click]
Sinal Fictício > Intro
Sinal Fictício > Verso
Sinal Fictício > Refrão [loop 2x]
Sinal Fictício > Final [stop]
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

As tags não diferenciam maiúsculas de minúsculas e não aparecem no nome exibido.

## Perfis

Os perfis pertencem ao Live Set atual. Um `.als` salvo pode ter vários setlists
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
primeiro localizador até esse mesmo fim e também inclui as transições.

As durações são estimativas baseadas no BPM do localizador da música, com o tempo
atual do Live como alternativa. A automação de tempo dentro de uma música não é
integrada ao cálculo. Um travessão indica que o Live ainda não forneceu um limite
final válido do Arrangement.

## Controle de Palco

Abra `/setlist` pela URL de controle com token mostrada no painel do Live.

- Arraste músicas para mudar a ordem exibida.
- Use Play e Stop para ações imediatas.
- Anterior e Próxima exigem um hold deliberado de 500 ms.
- Selecione a quantização; o agendador de saltos aplica imediatamente o valor
  pedido e o reconcilia com a resposta nativa do Live quando ela estiver disponível.
- Use a janela de letras para criar, sincronizar e editar linhas.
- Exporte o setlist atual como CSV UTF-8.
- Use a tela cheia para uma estação compacta de palco.

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
dentro do Live Set. O CSV inclui os dados visíveis e usa ponto e vírgula com BOM
UTF-8 para compatibilidade com planilhas.

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
