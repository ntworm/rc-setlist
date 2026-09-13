# Notas da Versão 0.7.0

O Ableton RC Setlist 0.7.0 aposenta a instalação manual da ponte, adiciona um
marcador que entrega a reprodução a um alvo nomeado e coloca uma linha de
notas em cada música.

## O que há de novo

- **O RC Bridge vem dentro da extensão.** Até agora, o Control Surface com
  quem a extensão conversa era um download à parte — o AbletonOSC, buscado e
  instalado à mão na User Library do Live. Agora ele vem como RC Bridge, um
  fork do AbletonOSC (licença MIT), e o kit de instalação copia para você:
  `Install-RC-Bridge.cmd` no Windows, `Install RC Bridge.command` no macOS.
  Selecionar **RCBridge** em Settings › Link, Tempo & MIDI › Control Surface
  continua sendo o seu passo, porque o Live não oferece como fazer isso por
  você — e a cópia também não pode acontecer de dentro do Live: o
  ExtensionHost restringe o sistema de arquivos às pastas da própria
  extensão, então o painel informa qual script está em uso e mostra o passo
  restante em vez de fingir que instala.
  O fork também é o que torna possível ter duas extensões na mesma máquina.
  O AbletonOSC manda toda resposta e atualização de listener para uma porta
  fixa, então só um cliente conseguia ouvir — RC Surface e RC Setlist no
  mesmo Live não podiam funcionar juntos. O RC Bridge escuta na própria porta
  (11020, para um AbletonOSC comum seguir funcionando ao lado), responde para
  o socket que perguntou e publica as atualizações de cada listener para
  todos os assinantes, com uma concessão de 60 segundos que esquece clientes
  que foram embora. A extensão sonda o RC Bridge primeiro e recorre a um
  AbletonOSC comum quando ele não está presente; a linha OSC do painel diz
  com qual deles está falando (`via RC Bridge 1.0.0 na porta 11020`). O fork
  também responde `last_event_time`, que o upstream nunca respondeu, então a
  duração total do show não precisa mais da ponte MCP.
- **`[jump NAME]` — um marcador que entrega a reprodução a um alvo
  *nomeado*.** Uma seção da mesma música, uma música, ou a forma
  `Song > Section`. Os nomes casam com as tags removidas e ignorando
  maiúsculas; um nome sozinho resolve primeiro nas seções desta música,
  depois nos títulos das músicas, depois em todas as seções na ordem do
  arranjo. A passagem é a mesma imediata que `[next]` e `[skip]` usam — sem
  esperar o próximo compasso — e o editor de marcador e o cartão a mostram.
  Um nome que não casa com nada não faz nada, de propósito.
- **Uma linha de notas por música.** Tom, afinação, quem conta — uma linha
  para o palco, editada no painel da música ao lado da cor, mostrada sob o
  título no cartão e no display de performance. Fica guardada com a música no
  song book, então acompanha renomeações e movimentações e nunca toca no
  projeto do Live.

## Correções

- **Erros de operação sobrevivem à sanitização.** O barramento de comandos
  agora anexa mensagens voltadas ao operador (`OperatorError` e
  `ProfileError`) a `command_status.error`, enquanto exceções internas —
  caminhos de arquivo crus incluídos — continuam estritamente sanitizadas e
  chegam como um `execution_failed` genérico.
- **O cache do song book segue o perfil ativo.** Cores e notas são cacheadas
  por perfil e o cache é descartado na troca de perfil, então as edições de um
  perfil não vazam para outro.
- **O parser de localizadores parou de dividir `Song > Section` num `>` que
  está dentro de uma tag.**

*Para detalhes completos sobre a instalação, consulte o [Guia de Instalação](INSTALL.md).*

*Read these notes in English: [RELEASE-NOTES-0.7.0.md](../RELEASE-NOTES-0.7.0.md).*
