# Notas da versão Ableton RC Setlist 0.5.0

[English](../RELEASE-NOTES-0.5.0.md)

Lançada em 1º de agosto de 2026. A versão 0.5.0 promove a integração de
localizadores, automações, Stage Control e confiabilidade que foi ensaiada em
um projeto real do Ableton Live.

## Compatibilidade de localizadores e controle do show

- A nomenclatura explícita, como `MÚSICA > Seção`, e a nomenclatura relativa,
  como `> Seção`, funcionam juntas. A seção relativa permanece ligada à última
  música na ordem cronológica.
- Localizadores antigos de música e automações formadas apenas por tags
  continuam compatíveis.
- `[ignore]`, `[IGNORE]`, `_hidden` e `[hidden]` mantêm localizadores técnicos
  fora do setlist visível. `[ignore]` prevalece sobre tags de ação.
- BPM, contagem de loop, stop, next, click e skip de músicas e seções preservam
  a identidade cronológica do localizador.
- Antes desta promoção, o proprietário verificou em um projeto real a detecção
  das músicas, acompanhamento das seções, saída de loop contado, transições
  stop/next, transporte e vários setlists.

## CSV completo do repertório

O CSV agora contém apenas informações que o runtime consegue confirmar. Cada
linha identifica o `setlist` ativo, `title`, `start_beat`, `bpm` declarado,
`duration_sec`, duração legível em `duration`, `sections_count`, nomes em
`sections`, ações dos localizadores em `automations` e `lyric_lines`.

Foram removidos os placeholders `signature`, `key`, `plays`, `custom_order`,
`in_setlist`, `cues_count` e `last_played_at`. A extensão não inventa tom,
fórmula de compasso por música nem histórico de reprodução que ela não
acompanha. O arquivo continua em UTF-8 com BOM, separado por ponto e vírgula e
salvo tanto no perfil ativo quanto na pasta Downloads do navegador.

## Confiabilidade e desempenho

- Comandos WebSocket são decodificados e limitados antes do despacho, verificam
  novamente as travas de segurança na execução e só confirmam a ação concluída.
- Ordem, letras, CSV e prévia de click usam substituição atômica e rejeitam
  conclusão atrasada depois da troca do Live Set ou perfil.
- Letras continuam marcadas como não salvas até a confirmação exata, e uma
  confirmação atrasada não reabre uma janela que o operador já fechou.
- Heartbeat e backpressure do WebSocket, validação TLS, erros HTTP controlados e
  encerramento ordenado evitam clientes presos e limpeza parcial do runtime.
- Cálculos do setlist e troca do cartão ativo usam cache para não reconstruir a
  lista inteira a cada atualização do transporte.
- O Stage Control compacto e responsivo, área de letras, perfis, dock de
  transporte, duração total e interface bilíngue permanecem preservados.

## Compatibilidade e escopo

- Ableton Live 12.4.5+ Suite (Beta) com suporte a Extensions.
- AbletonOSC continua sendo uma dependência externa de Control Surface.
- Windows é validado. macOS continua experimental.
- Localizadores do Arrangement continuam sendo a fonte do setlist; Session View
  não faz parte desta versão.

Ensaie transporte, localizadores, automações e acesso pela rede local usando uma
cópia do Live Set antes do palco.
