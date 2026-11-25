# Notas da versão RC Setlist 1.3.0

**Data de lançamento:** 2026-11-25
**Linha de versões suportada:** `1.3.x`
**Também disponível em inglês:** [`../RELEASE-NOTES-1.3.0.md`](../RELEASE-NOTES-1.3.0.md)

O Windows é a plataforma validada; o macOS é experimental. Esta versão trata
do link entre o computador principal (o **master**) e os segundos computadores
(os **slaves**). O [guia do usuário](USER-GUIDE.md) descreve cada estado e
alerta, e a [solução de problemas](TROUBLESHOOTING.md) diz o que fazer em cada
caso.

## Novidades

- **Saúde do link.** O Controle de palco, nos modos Editar e Show, a tela
  `/performance` e o painel do Live mostram uma linha por computador pareado com
  o estado, **OK**, **INSTÁVEL** ou **CAÍDO**, o motivo, o tempo de ida e volta
  (`RTT`), as quedas nos últimos 5 minutos, a última queda e o último frame
  recebido. Os dois computadores trocam heartbeats nos dois sentidos e medem o
  link.
- **Aquecimento, recuperação e trava por oscilação.** Um link novo fica
  **INSTÁVEL** por `20 s` de aquecimento. Depois de uma queda, de um heartbeat
  perdido (`> 1,5 s`) ou de latência alta (`RTT p95 > 150 ms`), precisa de
  `60 s` sem problema para voltar a **OK**. Um link que cai `3` ou mais vezes em
  `5 min` fica **INSTÁVEL** por `5 min`.
- **Confirmar.** Quando um link **INSTÁVEL** já estabilizou, **Confirmar** no
  Controle de palco ou no painel do Live reduz a janela limpa para `10 s` nos
  dois computadores. Nunca pula o aquecimento nem a trava de `5 min`.
- **Alarme de link caído.** Quando um link fica **CAÍDO** (nenhum frame por
  `3 s`, o socket fechou, ou Live ou OSC indisponível em um dos computadores),
  um alarme vermelho em tela cheia abre no Controle de palco e em
  `/performance`. **Dispensar alarme** fecha o alarme e mantém o selo vermelho
  **LINK CAÍDO** acima da barra de transporte. O **Stop** continua ao alcance
  acima do alarme.
- **Ponto de estado.** O ponto do segundo computador no Controle de palco segue
  o estado medido: verde para **OK**, amarelo para **INSTÁVEL**, vermelho para
  **CAÍDO**, **VERSÕES DIFERENTES** ou **CERTIFICADO MUDOU**.
- **Comandos confirmados.** O slave confirma cada comando que o master envia, e
  o master reenvia a cada `150 ms` até o prazo. O Controle de palco mostra por
  `3 s` um selo por computador: Pendente, Executou ou Falhou.
- **Alertas de comando.** Um comando que perde o prazo ou falha no slave mostra
  `SLAVE NÃO EXECUTOU: <comando>` no Controle de palco e no painel do Live. Uma
  confirmação que chega depois do prazo muda o alerta para
  `Executou atrasado: <comando>`.
- **Reenvio de segurança do Stop e do Pânico.** Enquanto o master continua
  parado ou em pânico, Stop e Pânico não expiram: são reenviados a cada
  reconexão. Se o slave não confirmar em `1 s`, aparece
  `SLAVE AINDA NÃO PAROU` até a confirmação chegar. Um Play atrasado atrás de um
  Stop ou Pânico mais novo é descartado e nunca toca fora de ordem.
- **Agulha parada segue o master.** Quando os dois computadores estão parados e
  o slave está a mais de meio beat de distância por três alvos seguidos, o slave
  vai para o marcador do master, ou para o beat exato entre marcadores. Isso
  também acontece em até `2 s` após reconectar.
- **Fora de passo.** Uma divergência de agulha que dura `3 s` fora de salto
  quantizado pendente ou loop ativo mostra **INSTÁVEL** com o motivo **Fora de
  passo** nos dois computadores.
- **Modos do slave.** No slave, o cartão **Segundo computador** da aba **Rede**
  tem **Modo do slave** com três botões:
  - **Segue tudo** (padrão): o slave executa os comandos do master e corrige a
    agulha tocando e parado.
  - **Segue transporte**: o slave executa os comandos do master e corrige a
    agulha tocando; parado em outro tempo, só alerta.
  - **Independente**: o master não envia comandos a esse slave nem gera alerta
    por ele, e o slave recusa os que chegarem. O master mostra a etiqueta
    **Independente** ao lado desse computador.

  A escolha fica salva depois de reiniciar. Um slave que rodou uma versão de
  teste da 1.3.0 com a opção **Corrigir agulha automaticamente no slave** mantém
  a escolha: marcada vira **Segue tudo**, desmarcada vira **Segue transporte**.

- **Trava de navegação no slave.** Em **Segue tudo** e **Segue transporte**, com
  o link do master ativo, o Controle de palco do slave não dá play, não salta,
  não faz contagem e não muda metrônomo, quantização nem pre-roll. Uma faixa
  avisa que o slave está seguindo o master. **Stop**, **Pânico** e
  **Atualizar** continuam disponíveis e sobem ao master, então um Stop no slave
  para o show inteiro. Em **Independente**, o Controle de palco do slave roda só
  naquele computador.
- **Verificação do protocolo do link.** Master e slave trocam uma versão do
  protocolo do link. Um computador em outra versão mostra **VERSÕES
  DIFERENTES**, e nenhum comando é repassado a ele.

## Mudanças

- **Um celular num slave não comanda mais o show inteiro.** Na 1.2.1, comandos
  de play, salto, metrônomo, quantização e contagem vindos de um celular ou do
  painel do Live num slave subiam para o master e moviam todos os computadores.
  Na 1.3.0, um slave em **Segue tudo** ou **Segue transporte** só envia para
  cima **Stop**, **Pânico** e **Atualizar**. Para navegar num slave por conta
  própria, escolha **Independente**.
- **Aba Rede.** O cartão **Segundo computador** fica acima do cartão
  **Certificado**.

## Incluído da 1.2.1

A versão 1.2.1 recebeu tag sem página de lançamento. As correções dela fazem
parte da 1.3.0:

- **Prontos para parear mostra um endereço que responde.** Quando um slave tem
  duas interfaces de rede na mesma sub-rede, o anúncio leva os endereços de LAN
  dele e o master lista o primeiro que responde na porta anunciada.
- **Comandos de um slave chegam ao master.** Com o master conectado, os
  comandos que um slave envia para cima são executados pelo master e enviados a
  todos os slaves; na 1.3.0 isso vale para **Stop**, **Pânico** e **Atualizar**
  enquanto o slave segue o master.

## Atualizando

Nada a migrar; a pasta de dados e os pareamentos ficam. O Live recusa instalar
por cima de uma pasta de extensão existente: remova o RC Setlist nas
configurações de extensões do Live antes e depois abra o `.ablx`. Instale a
1.3.0 no master e em cada slave. Os dois computadores precisam estar na mesma
versão: quando um computador na 1.2.x é pareado com um na 1.3.0, o lado na
1.3.0 mostra **VERSÕES DIFERENTES** e nenhum comando passa entre eles. O Remote
Script RC Bridge não mudou, então não é preciso reinstalá-lo.
