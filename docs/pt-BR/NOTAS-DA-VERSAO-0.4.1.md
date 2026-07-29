# Notas da versão Ableton RC Setlist 0.4.1

Lançada em 29 de julho de 2026. A versão 0.4.1 é uma atualização compatível com
o fluxo existente baseado no Arrangement.

## O que há de novo

- Cada cartão mostra a duração da música, e o cabeçalho mostra a duração total do
  setlist quando o Live fornece o final do Arrangement.
- **Gerenciar setlists** permite criar, selecionar, renomear, excluir de forma
  recuperável e restaurar vários setlists do Live Set atual. Setlists de outros
  projetos ficam ocultos.
- A área de letras agora tem um seletor de música compartilhado acima de Criar,
  Sincronizar e Editar. Abrir o editor não substitui mais as letras sincronizadas
  na tela do show, e edições não salvas sobrevivem ao fechamento do diálogo.
- O painel do Live ganhou um diagnóstico compacto da conexão com AbletonOSC,
  sem ocupar a interface com textos longos de instalação.

## Correções

- Marcadores `[stop]` e `[loop]` continuam como seções da música anterior, e
  músicas novas entram no setlist salvo na posição correta do Arrangement.
- Saltos quantizados e sem quantização respeitam a opção escolhida no Live mesmo
  quando outra extensão RC ocupa a porta fixa de resposta do AbletonOSC.
- Duração Total, posição de reprodução e confirmação de salto usam um fallback
  MCP serializado, sem acumular requisições atrasadas.
- O valor de compasso em Barras/Batidas/Semicolcheias não pisca mais para trás
  nas viradas normais, mas saltos, loops, parar/iniciar e reconexões continuam
  atualizando imediatamente.
- O rename de setlist no celular mantém o foco e o teclado durante atualizações.
- A troca de idioma fica desativada enquanto o Live toca ou o painel está
  bloqueado; o aviso de bloqueio aparece no idioma ativo.
- O painel embutido no Live mantém as duas ações **Abrir neste computador**
  visíveis e clicáveis no tamanho suportado.

## Notas de instalação

- Instale o AbletonOSC diretamente em
  `User Library/Remote Scripts/AbletonOSC` e confirme que
  `AbletonOSC/__init__.py` está dentro dessa pasta. Não use a pasta oculta
  `User Remote Scripts` das preferências.
- Na primeira conexão pelo navegador, `ERR_CERT_AUTHORITY_INVALID` é esperado
  por causa do certificado local autoassinado. Continue somente se o endereço
  for exatamente o IP mostrado no painel do Live e a LAN for confiável.
- O Session View não faz parte desta versão. A 0.4.1 continua usando
  localizadores do Arrangement.

Consulte o [guia de instalação](INSTALL.md), o [guia do usuário](USER-GUIDE.md)
e a [solução de problemas](TROUBLESHOOTING.md) para o fluxo completo.
