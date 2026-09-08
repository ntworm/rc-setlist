# Notas da Versão 0.5.1

O Ableton RC Setlist 0.5.1 chegou! Esta versão traz melhorias significativas de usabilidade, particularmente nos controles de transporte do palco, além de correções cruciais de bugs para garantir a máxima confiabilidade da performance ao vivo.

## Novidades

- **Suporte a Keyboard Mapping**: Agora você pode mapear teclas (como o Numpad ou alfanuméricas) para os controles de transporte, tornando as mudanças de música e navegação muito mais seguras e fáceis sem depender de toque na tela ou mouse.
- **Toggle de Count-in Pre-roll**: Você agora pode ativar ou desativar o count-in de pre-roll de 1 compasso diretamente pelo painel Stage Control. Isso permite iniciar o playback sem count-in quando a banda precisar.
- **Melhorias de "Hold-to-Select" no Mobile**: A navegação pelo transporte em aparelhos mobile agora requer um gesto de "hold" (pressionar e segurar) para saltos seguros entre as músicas, prevenindo toques acidentais durante o show. O threshold foi cuidadosamente balanceado.
- **Edição de Seção via Double-Click**: Agora você pode fazer um clique duplo para editar as tags da seção diretamente da visualização Setlist no desktop.

## Correções de Bugs

- **Relógio Desacoplado (Decoupled Show Clock)**: O relógio geral do show e o tempo decorrido da música foram devidamente desacoplados da automação de BPM do Live, garantindo que o seu timecode não sofra saltos repentinos quando o tempo muda.
- **Rastreamento de Estado Seguro**: Foram resolvidas corridas de sincronização (race conditions) em que o servidor e a UI podiam discordar temporariamente sobre a seção atual sendo reproduzida.
- **Estabilidade**: Refinamentos nas observações de pre-roll, correção nos limites de WebSocket e estabilização da interface contra cliques sucessivos e rápidos.

*Para detalhes completos de migração da versão 0.4.x, consulte o [Guia de Instalação](../INSTALL.md).*

*Read these notes in English: [RELEASE-NOTES-0.5.1.md](../RELEASE-NOTES-0.5.1.md).*
