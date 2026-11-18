# Notas da versão RC Setlist 1.2.0

**Data de lançamento:** 2026-11-18
**Linha de versões suportada:** `1.2.x`
**Também disponível em inglês:** [`../RELEASE-NOTES-1.2.0.md`](../RELEASE-NOTES-1.2.0.md)

## Novidades

- **Vários segundos computadores.** Um computador principal, o **master**,
  pareia vários segundos computadores, os **slaves**. O cartão **Segundo
  computador** da aba **Rede** lista cada slave com o estado dele e o próprio
  **Desfazer**, e todo comando de transporte vai para todos. Parear ou
  desfazer o pareamento de um slave mantém os links dos outros abertos.
- **Master e slave no painel.** A barra na parte de baixo do painel do Live
  mostra o papel deste computador: **Master** com quantos slaves estão
  conectados, ou **Slave** e se o master está falando com ele. O slave lembra
  do master depois de reiniciar e mostra o endereço dele no cartão.
- **O slave acompanha o tempo do master.** O master envia onde está a sua
  agulha duas vezes por segundo. Quando o Link inicia um Play ou um salto
  quantizado um compasso atrasado num slave, o slave se move pelos beats inteiros
  de diferença; quando perde um Play, ele começa no próximo compasso do master,
  e quando perde um Stop, ele para. Nada se move enquanto um salto espera a
  grade, enquanto um loop roda, com pânico ou trava ligados, nem logo depois
  de um comando repassado, e uma diferença que não é de beats inteiros é
  apontada como um problema de Link em vez de ser corrigida.
- **Prontos para parear.** Enquanto mostra um código de pareamento, o slave
  anuncia o próprio nome e a porta na rede local, na porta UDP `4447`. O master
  o lista em **Prontos para parear**, e um clique preenche o endereço. O
  anúncio nunca leva o código.
- **Trazer do master.** Num slave, **Trazer do master** no cartão
  **Importar** traz o repertório ativo do master, com ordem, cores das músicas,
  notas e letras, como um repertório novo do slave. O Live precisa estar parado
  no slave.
- **Modo Show.** Uma chave na barra superior do Controle de palco escolhe entre
  **Edição** e **Show**. O modo Show esconde os controles de configuração, os
  pontos de recolher, a alça de arrastar e o seletor de repertório, recusa o
  editor de marcadores e a reordenação, e mantém aberta só a música ativa,
  fixada no topo da lista em todas as telas.
- **Próxima música agora e Música anterior agora.** Duas ações de MIDI e de
  teclado saltam na hora durante a reprodução, sem esperar a grade de
  quantização.
- **Mudanças de fórmula de compasso.** O mostrador de compasso conta os
  compassos de cada trecho do set na sua própria fórmula de compasso, e conta
  os tempos na unidade do denominador, então 6/8 mostra seis colcheias por
  compasso.
- **Renomear um pacote.** Um clique duplo no nome de um pacote no cartão
  **Importar** renomeia o arquivo na pasta `packages`.

## Correções

- **Repertórios no macOS.** O Live Set é reconhecido pelo título da janela do
  Live também no macOS, por meio do System Events com a permissão de
  Acessibilidade, para que os repertórios não comecem mais vazios a cada
  reinício do Live.
- **Gerenciar setlists** diz por que está bloqueado: sem conexão, página só de
  leitura, Live tocando ou Live Set mudando. Um comando de repertório recusado
  não deixa mais a janela esperando.
- **Pareamento** aceita o endereço com a porta, como o cartão mostra, e um
  código digitado com espaços; um pareamento recusado informa o endereço que
  leu.
- Um comando repassado só é descartado quando o link com o slave está
  travado, e não atrás de um frame que ainda está saindo.
- Um comando enviado de novo com o mesmo id recebe de volta o estado salvo,
  em vez de ficar sem resposta.
- Os arquivos de token e `peer.json` são mantidos só para o dono, e os dados
  do usuário são gravados de forma atômica.

## Outras mudanças

- **Verificar OSC** roda a partir do estado do OSC na barra de baixo do painel
  do Live; o botão saiu da barra.

## Atualizando da 1.1

Nada a migrar: um pareamento salvo pela 1.1 carrega como o primeiro slave da
lista. O Live recusa instalar por cima de uma pasta de extensão existente:
remova o RC Setlist nas configurações de extensões do Live antes; a pasta de
dados fica. Instale a 1.2.0 no master e em cada slave. No macOS, permita o
Ableton Live em **System Settings > Privacy & Security > Accessibility** e
**Automation** quando o macOS pedir, depois reinicie o RC Setlist. Repertórios
feitos num Mac antes da 1.2.0 ficavam em pastas temporárias, que continuam no
disco para recuperação manual.
