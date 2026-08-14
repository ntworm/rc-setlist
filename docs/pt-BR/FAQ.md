# Perguntas frequentes

## O Ableton RC Setlist é open source?

Ele é source-available sob a PolyForm Noncommercial 1.0.0. Uso, modificação e
redistribuição não comerciais são permitidos conforme a licença; uso comercial
não é permitido. A PolyForm Noncommercial não é uma licença open source aprovada
pela OSI.

## O usuário final precisa de Node.js?

Não. Instale o `.ablx` da release. O Node.js 24.16.0 serve apenas para desenvolvimento.

## Por que o AbletonOSC é obrigatório?

O Ableton RC Setlist usa o AbletonOSC para transporte e operações do Live Object
Model. Instale a partir de <https://github.com/ideoforms/AbletonOSC>. Ele não vem
incluído no pacote.

## Por que o navegador mostra um aviso de certificado?

Na primeira conexão, o navegador pode mostrar `ERR_CERT_AUTHORITY_INVALID`
porque o RC Setlist cria um certificado local autoassinado para WebSockets
seguros. Continue somente se o endereço for exatamente o IP mostrado no painel
do Live e a rede local for confiável. Cada navegador/aparelho pode exigir isso
uma vez.

## Onde as letras ficam salvas?

No diretório de armazenamento de Ableton Extensions, dentro do perfil ativo do
Ableton RC Setlist. Use o editor interno em vez de editar os arquivos diretamente.

## Posso usar minhas letras?

Somente se você for o autor ou tiver autorização. O repositório e o kit de
demonstração usam texto fictício; o Ableton RC Setlist não fornece letras comerciais.

## O macOS funciona?

O código foi projetado para ser portátil, mas a versão 0.5.1 mantém o macOS como
experimental até existir uma matriz completa em hardware real.

## Posso expor o Ableton RC Setlist na internet?

Não. Ele foi projetado para uma rede local confiável. Nunca exponha a porta
`4444` diretamente à internet.

## Posso vender o Ableton RC Setlist ou uma modificação?

Não sob a PolyForm Noncommercial 1.0.0. Leia a [licença](../../LICENSE) e procure
orientação jurídica própria para um caso específico.
