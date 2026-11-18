# Notas da Versão 0.5.1

O RC Setlist 0.5.1 atualiza os controles de transporte de palco, mapeamento de teclado e sincronização do relógio do show.

## Novidades

- **Suporte a Keyboard Mapping**: Permite mapear teclas do teclado (como Numpad ou alfanuméricas) para controles de transporte de palco, facilitando troca de páginas e navegação entre músicas.
- **Toggle de Count-in Pre-roll**: Adiciona alternância para o count-in de pre-roll de 1 compasso no painel Stage Control.
- **Navegação Mobile com Hold**: A navegação de transporte mobile exige o gesto de pressionar e segurar para saltos entre músicas, evitando disparos involuntários.
- **Edição de Seção via Double-Click**: O clique duplo abre a edição direta de tags de seção na visualização Setlist no desktop.

## Correções de Bugs

- **Relógio Desacoplado (Decoupled Show Clock)**: O relógio geral do show e o tempo decorrido da música foram devidamente desacoplados da automação de BPM do Live, garantindo que o seu timecode não sofra saltos repentinos quando o tempo muda.
- **Rastreamento de Estado Seguro**: Foram resolvidas corridas de sincronização (race conditions) em que o servidor e a UI podiam discordar temporariamente sobre a seção atual sendo reproduzida.
- **Estabilidade**: Refinamentos nas observações de pre-roll, correção nos limites de WebSocket e estabilização da interface contra cliques sucessivos e rápidos.

_Para detalhes completos de migração da versão 0.4.x, consulte o [Guia de Instalação](../INSTALL.md)._

_Read these notes in English: [RELEASE-NOTES-0.5.1.md](../RELEASE-NOTES-0.5.1.md)._
