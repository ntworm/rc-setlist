# Notas da Versão 0.5.1

O Ableton RC Setlist 0.5.1 prioriza navegação de palco mais segura, relógios
mais claros e controles físicos mais flexíveis. A versão também consolida os
fluxos de perfis, letras e CSV entregues nas versões 0.4.x e 0.5.0.

## Novidades e mudanças

- **Música anterior e próxima música:** as setas externas do Stage Control
  saltam para o início da música adjacente. Os botões ficam desativados nos
  limites do setlist e exigem que o toque ou ponteiro seja segurado por 500 ms.
- **Seção anterior e próxima seção:** as setas internas preservam a navegação
  por seções com o mesmo gesto protegido.
- **Alvo de reordenação:** arrastar no desktop ou segurar e arrastar no celular
  mostra uma prévia do alvo de inserção antes de confirmar a nova ordem.
- **Keyboard Mapping:** ações de transporte e visualização podem ser atribuídas
  ao Numpad ou a teclas alfabéticas. O MIDI Mapping existente continua disponível
  para mensagens MIDI de nota, control change e program change.
- **Count-in Pre-roll:** `CONTAGEM 1 COMP` ativa uma introdução opcional de um
  compasso quando o transporte está parado, usando o metrônomo nativo do Live.
  O recurso não arma pistas, não entra em Record e não altera a quantização dos saltos.
- **Edição de seção em linha:** clique duas vezes em uma tag de seção no Setlist
  do desktop para editá-la no próprio lugar.
- **Relógios do show e da música:** o Stage Control exibe os tempos relativos
  SHOW e SONG em vez da coordenada bruta do Arrangement.

## Correções

- Os tempos decorridos de SHOW e SONG não voltam quando a automação de tempo do
  Live muda; as durações estimadas usam o BPM declarado de cada música.
- A inicialização da contagem não espera indefinidamente por uma confirmação
  separada antes de enviar, em ordem, os comandos de Click, posição e Play.
- Os limites do WebSocket e do roteamento de comandos tratam eventos rápidos e
  sucessivos de forma mais consistente, mantendo as verificações de autorização.
- A exportação pública agora inclui o ponto de entrada real do build e estas
  notas, mas deixa o checkout externo do AbletonOSC fora do repositório para que
  o GitHub Pages publique a documentação estática.

## Antes de usar no palco

Os requisitos de instalação e compatibilidade estão no
[Guia de Instalação](../INSTALL.md). Windows é a plataforma validada desta versão;
macOS continua experimental até ser testado em hardware macOS real. Ensaie o Live
Set, o controlador e a rede exatos antes do uso no palco.

*Read these notes in English: [RELEASE-NOTES-0.5.1.md](../RELEASE-NOTES-0.5.1.md).*
