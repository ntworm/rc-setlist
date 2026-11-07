# Notas da versão RC Setlist 1.1.0

**Data de lançamento:** 2026-11-06
**Linha de versões suportada:** `1.1.x`
**Também disponível em inglês:** [`../RELEASE-NOTES-1.1.0.md`](../RELEASE-NOTES-1.1.0.md)

## Novidades

- **Painel do Live.** O painel do Live é novo e tem três abas: **Principal**,
  **Repertórios** e **Rede**. **Principal** mostra um QR, do Controle de palco
  por padrão, e um botão que troca para a tela Performance; abaixo, o repertório
  ativo, o número de músicas, o tempo de show e a lista de músicas.
- **Gestão de repertórios.** A aba **Repertórios** ativa, renomeia, apaga,
  cria e restaura repertórios com o transporte parado. Apagar pede confirmação
  na própria linha e pode ser desfeito pela lista de **Setlists excluídos**.
- **Pacotes de repertórios.** **Exportar todos**, na aba **Repertórios**,
  grava todos os repertórios do Live Set (ordem, cores e notas das músicas,
  letras) num arquivo `.rcsetlist`, e **Importar** acrescenta os repertórios de
  um pacote aos existentes: um nome repetido ganha um número, e uma importação
  que falha é desfeita. Os arquivos ficam na pasta `packages` dos dados da
  extensão, porque o Live só deixa a extensão gravar ali, e o painel mostra o
  caminho.
- **Segundo computador.** A aba **Rede** pareia um segundo computador com o
  Live usando um código de seis dígitos. Um segundo ponto de estado no topo do
  Controle de palco fica verde com o link ativo e os marcadores iguais, âmbar
  com marcadores diferentes e vermelho quando o computador não responde.
- **Lista de músicas recolhível.** O botão de três pontos ao lado de uma música
  recolhe as seções dela, e **Recolher todas / Abrir todas** age na lista
  inteira. Segure o nome ou o número da música para saltar; arraste a alça na
  borda direita do card para reordenar.
- **Certificado local.** A extensão cria uma autoridade certificadora para este
  computador, válida para localhost e endereços privados da rede. A aba
  **Rede** mostra um QR para uma página de instalação na porta `4445`; com o
  certificado instalado, o navegador abre as páginas sem aviso.
- **Endereço de rede.** O QR usa o endereço da rota padrão, não o primeiro
  endereço privado, então uma segunda interface de rede (luz, áudio) não
  substitui o endereço do Wi-Fi.

## Correções

- A barra do topo fica numa linha nos dois idiomas.
- Reordenar funciona no Windows.
- Salvar funciona quando o Live recusa `fsync`.
- O pareamento fica preso à chave do segundo computador, então uma mudança de
  endereço mantém o link.

## Parear um segundo computador

1. No **segundo computador**, inicie o servidor do RC Setlist e abra o painel
   dentro do Live. Vá na aba **Rede** e aperte **Mostrar** no cartão
   **Segundo computador**. Aperte **Gerar código** e leia os seis dígitos.
2. No **computador principal**, abra o painel dentro do Live, vá na aba **Rede**
   e aperte **Mostrar** no cartão **Segundo computador**. Digite o endereço do
   segundo computador e o código, e aperte **Parear**.
3. Ponha os dois computadores na mesma sessão: **Link** do Ableton ligado,
   **Start Stop Sync** do Live desligado. O RC Setlist repassa o transporte; a
   sincronização nativa dirigiria o transporte duas vezes.

Um celular que abre a página do Controle de palco é um controlador do
computador principal: ele entra na sessão do principal e vê o setlist do
principal. O pareamento serve para uma segunda máquina rodando Live. O macOS
é suportado de forma experimental; o Windows é a plataforma validada.

## O que chega ao segundo computador

**Play**, **Stop**, **salto**, **metrônomo**, **quantização**, **contagem**,
**refresh** e **pânico** são enviados para o computador pareado. Edição do
setlist, edição de marcadores, cores, notas, letras, perfis, ordenação e a
exportação CSV ficam no computador principal.

## Outras mudanças

- No card da música, só o nome e o número iniciam um salto; o tempo, as notas,
  os badges, o botão de três pontos e a alça não. Numa tela de toque, o salto
  exige segurar 500 ms.
- O estado de **Recolher todas / Abrir todas** fica guardado no aparelho, por
  repertório.
- Parear um computador com ele mesmo é recusado, e o painel avisa quando o
  código tem de ser gerado no segundo computador.
- **pânico** cancela uma contagem em andamento.

## Contratos

`docs/CONTRACTS.md` (e `docs/pt-BR/CONTRATOS.md`) descrevem a rota de
pareamento, a credencial do par, o frame `jump_time` e o campo `peerStatus` do
frame de estado.

## Atualizando da 1.0

Nada a migrar. O pareamento é por instalação e nada é gravado a não ser que o
operador pareie um segundo computador: até lá, sem segundo ponto e sem conexão
de saída. No primeiro início a extensão assina um novo certificado do servidor,
então um celular que tinha aceitado o certificado antigo pergunta mais uma
vez, ou para de perguntar depois de instalar o certificado do celular. A página
de instalação responde enquanto o servidor roda. O Live recusa instalar por
cima de uma pasta de extensão existente: remova o RC Setlist nas configurações
de extensões do Live antes; a pasta de dados fica.
