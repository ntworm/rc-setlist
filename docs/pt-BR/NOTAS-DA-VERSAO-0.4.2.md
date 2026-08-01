# Notas locais de teste do Ableton RC Setlist 0.4.2

[English](../RELEASE-NOTES-0.4.2.md)

A versão 0.4.2 é um candidato local de teste para validação no Ableton Live.
Ela não é uma versão publicada: o site público e o download mais recente
continuam na 0.4.1 até o ensaio terminar.

## O que verificar

- A nova forma relativa `> Seção` mantém a seção ligada à música anterior.
  Marcadores relativos de automação seguem a mesma regra, e `[ignore]` oculta
  localizadores técnicos mesmo quando existe outra tag de ação.
- Todo o visual do Stage Control 0.4.1 permanece preservado: cabeçalho compacto,
  cartões de música, área de letras, perfis, dock de transporte e layouts
  responsivos.
- Edições de letras continuam marcadas como não salvas até a confirmação da
  gravação. Falha, timeout ou desconexão mantém o texto disponível para tentar
  novamente.
- Títulos repetidos, ordem personalizada, durações, loops, ações stop/next e
  marcadores técnicos ocultos continuam seguindo a identidade cronológica dos
  localizadores.

## Mudanças de confiabilidade

- Mensagens WebSocket são validadas antes do despacho. As travas de segurança
  são verificadas novamente na execução, e comandos urgentes de stop/pânico não
  ficam presos atrás de comandos comuns.
- Ordem, letras, CSV e prévia de clique usam substituição atômica e rejeitam uma
  conclusão atrasada depois da troca do Live Set ou do perfil ativo.
- O bridge monitora clientes WebSocket com heartbeat limitado, preserva os
  limites de backpressure, valida certificados TLS salvos e encerra conexões
  HTTP em uma ordem definida.
- O cálculo do setlist e a troca do cartão ativo usam cache para evitar reconstruir
  toda a lista durante a atualização normal do transporte.

## Estado do teste

Os testes automatizados de código, interface, navegador, documentação e pacote
fazem parte deste candidato. Ainda é obrigatório instalar e ensaiar no Ableton
Live antes do palco. Esta promoção local não criou release, tag nem download
público.
