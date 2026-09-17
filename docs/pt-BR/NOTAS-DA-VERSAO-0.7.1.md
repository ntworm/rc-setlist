# Notas da Versão 0.7.1

O RC Setlist 0.7.1 incorpora correções de palco do ensaio de 16/09/2026,
melhora a visibilidade do painel e o layout em celulares, remove instalações
legadas e alinha o nome do produto às diretrizes da Ableton.

## O que há de novo

- **Alinhamento do nome**: Renomeado para **RC Setlist** para cumprir as
  diretrizes de marca da Ableton, que proíbem o uso de 'Ableton' no nome de
  produtos terceiros.
- **Migração de dados em uma etapa**: A atualização a partir da versão 0.x copia
  perfis, setlists de projeto, preferências e tokens para a nova estrutura sem
  alterar os arquivos originais (scripts/migrate-data.mjs).
- **Placa do painel com alto contraste**: Moldura âmbar de 2px
  (
gba(255, 168, 38, 0.45)) com brilho sutil garante que o painel se destaque
  com clareza sobre temas claros e escuros do Live.
- **Limpeza de extensões legadas**: O kit de instalação e o script
  (scripts/uninstall-pre-1.0-extensions.ps1) removem pacotes antigos da pasta
  User Library para que o Live exiba apenas uma entrada do RC Setlist no menu.

## Correções

- **Carregamento de CSS do painel**: Estilos restaurados com a correção da tag
  <link> no container de extensões do Live.
- **Layout da telemetria no celular**: Cartões em modo retrato agora usam a
  divisão 58/42, eliminando cortes de visualização em smartphones.
- **Contagem silenciada no celular**: O áudio da contagem no navegador agora vem
  mudo por padrão em celulares para evitar vazamentos em fones e PA; pode ser
  ativado opcionalmente nas configurações locais.
- **Autocomplete do editor de marcadores**: O menu seletor exibe marcadores de
  forma limpa, sem duplicar tags [jump] ou [loop].

*Para detalhes completos sobre a instalação, consulte o [Guia de Instalação](INSTALL.md).*

*Read these notes in English: [RELEASE-NOTES-0.7.1.md](../RELEASE-NOTES-0.7.1.md).*
