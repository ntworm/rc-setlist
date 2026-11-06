# Notas da versão — RC Setlist 1.1.0

**Data de lançamento:** 2026-11-06
**Linha de versões suportada:** `1.1.x`
**Also available in English:** [`../RELEASE-NOTES-1.1.0.md`](../RELEASE-NOTES-1.1.0.md)

Um show, dois computadores. O computador principal continua com o Live e com
o operador; o segundo computador segue o principal, e os comandos de
transporte que o operador dá são encaminhados para ele por um link com o
certificado preso.

## Destaques

- **Um painel do Live novo.** Três abas, Principal, Repertórios e Rede, na
  cara das páginas do RC Setlist (Martian Mono). A Principal mostra um QR no
  centro, o do Controle de Palco por padrão, com um botão ao lado que troca
  para o Performance Display no mesmo lugar; embaixo, o repertório ativo em
  quatro números (músicas, tempo de show, repertórios) e as músicas dele com
  as cores. A Rede guarda o endereço, o certificado do celular e o segundo
  computador.
- **Repertórios gerenciados pelo painel do Live.** Ativar, renomear, apagar
  (com pergunta na própria linha, e dá para restaurar), criar e restaurar
  repertórios com o transporte parado; o painel diz o que cada ação fez.
- **Pacotes de repertórios.** Exportar todos grava todos os repertórios do
  Live Set (ordem, cores e notas das músicas, letras) num arquivo
  `.rcsetlist`; Importar traz os repertórios de um pacote para o lado dos
  seus, numerando um nome repetido, e desfaz tudo se falhar no meio. O Live
  só deixa a extensão gravar dentro da pasta dela, então os pacotes ficam na
  pasta `packages` dos dados da extensão; o painel mostra o caminho com um
  botão Copiar caminho.

- **Uma linha "Segundo computador" no painel do Live.** O segundo computador
  mostra um código de seis dígitos, o computador principal digita o
  endereço dele e o código, e os dois ficam pareados. A linha diz o que o
  link está fazendo: sem pareamento, conectado, sem resposta, marcadores
  diferentes, ou certificado mudando e precisando de um pareamento novo.
- **Um segundo ponto no cabeçalho do Controle de Palco.** Verde quando o
  segundo computador está conectado e os dois leem os mesmos marcadores,
  amarelo quando está conectado e os marcadores são diferentes, vermelho
  quando não está respondendo ou o certificado mudou, e nenhum ponto quando
  não há nada pareado.
- **A rota de pareamento só responde sobre TLS.** O código vale por dez
  minutos, funciona exatamente uma vez, morre depois de cinco palpites
  errados, e as tentativas que chegam até ele são limitadas por endereço e
  no total.
- **O salto viaja por beat.** Os dois computadores podem ter as músicas em
  outra ordem, então um salto cruza a rede como o beat em que ele pousa
  (`jump_time`), e o lado que recebe procura o marcador que está ali.
- **O código de pareamento pode ser lido de novo.** O painel se redesenha
  com o código que ainda está vivo, então o número na tela é o número que
  abre a porta.

## Como usar

1. No **segundo computador**, inicie o servidor do RC Setlist e abra o painel
   dentro do Live. Aperte **Gerar código** e leia os seis dígitos.
2. No **computador principal**, abra o painel dentro do Live, expanda a linha
   "Segundo computador", digite o endereço do segundo computador e o código,
   e aperte **Parear**.
3. Ponha os dois computadores na mesma sessão: **Link** do Ableton ligado,
   **Start Stop Sync** do Live desligado. O relay cuida do transporte; a
   sincronização nativa cuidaria dele duas vezes.

Um celular que abre a página do Controle de Palco continua sendo um
controlador do computador principal — ele entra na sessão do principal e vê
o setlist do principal. O pareamento serve para uma segunda máquina rodando
Live. O macOS é suportado aqui de forma experimental; o Windows é a
plataforma validada.

## O que chega ao segundo computador

**Play**, **Stop**, **salto**, **metrônomo**, **quantização**, **contagem**,
**refresh** e **pânico** viajam para o computador pareado. Edição do setlist,
edição de marcadores, cores, notas, letras, perfis, ordenação e a exportação
CSV ficam no computador principal.

## Também nesta versão

- **O número da música também pula para ela**, como o nome, no Controle de
  Palco. Na tela de toque o pulo continua sendo segurar, para um toque sem
  querer nunca mover o show.

- **Recolher a lista de músicas.** Os três pontinhos ao lado do nome da
  música recolhem e reabrem as seções dela; **Recolher todas / Abrir todas**,
  na barra "Músicas no projeto", age em todas. A escolha fica salva no
  aparelho, por setlist.
- **Um lugar para cada função no card da música.** Segure o **nome** para
  pular; o número, o tempo e o espaço vazio não fazem nada. Reordene
  arrastando a **alça** na borda direita do card, com mouse ou com o dedo.
  Segurar os três pontinhos não pula mais.
- **O certificado do celular.** A extensão cria uma autoridade de
  certificado para este computador, limitada a localhost e endereços
  privados, e assina com ela o certificado do próprio servidor. Uma nova
  linha **Certificado do celular** no painel do Live mostra um QR para uma
  página simples na porta 4445, onde o celular baixa e instala o
  certificado uma vez; depois disso o navegador para de avisar.
- **O QR aponta para a rede certa.** O endereço do QR e da linha de
  pareamento é o que o sistema usa de verdade, então um computador com cabo
  de luz ou de áudio e Wi-Fi ao mesmo tempo anuncia o Wi-Fi.
- **A barra do topo fica numa linha só** em inglês e em português; palavras
  maiores diminuem o texto em vez de empurrar botões para uma segunda linha.
- **Reordenar voltou a funcionar no Windows**, e salvar não falha mais
  dentro do Live quando o sistema de arquivos recusa o `fsync`.
- **Correções do pareamento.** O segundo computador é fixado pela chave,
  então um endereço novo em qualquer lado não quebra mais o link; parear um
  computador com ele mesmo é recusado; o painel avisa quando o código tem
  que ser gerado no segundo computador; o PANIC cancela uma contagem em
  andamento.

## Contratos

`docs/CONTRACTS.md` (e `docs/pt-BR/CONTRATOS.md`) agora descrevem a rota de
pareamento, a credencial do par, o frame `jump_time` e o campo
`peerStatus` do frame de estado.

## Atualizando da 1.0

Nada a migrar. O pareamento é por instalação e nada é gravado a não ser que
o operador pareie um segundo computador: até lá, sem segundo ponto e sem
conexão de saída. Duas coisas são novas no primeiro início: a extensão
cria a autoridade de certificado na pasta de dados e assina com ela um
novo certificado do servidor, então um celular que tinha aceitado o
certificado antigo pergunta mais uma vez (ou para de perguntar depois de
instalar o certificado do celular), e a página de instalação responde na
porta 4445 enquanto o servidor roda. O Live recusa instalar por cima de
uma pasta de extensão existente: remova o RC Setlist nas configurações de
extensões do Live antes; a pasta de dados fica.
