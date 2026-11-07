# Perguntas frequentes

## O RC Setlist é open source?

Ele é source-available sob a PolyForm Noncommercial 1.0.0. Uso, modificação e
redistribuição não comerciais são permitidos conforme a licença; uso comercial
não é permitido. A PolyForm Noncommercial não é uma licença open source
aprovada pela OSI.

## O usuário final precisa de Node.js?

Não. Instale o `.ablx` da release. O Node.js 24.16.0 serve apenas para
desenvolvimento.

## O que é o RC Bridge, e ainda preciso do AbletonOSC?

O RC Bridge é o Remote Script do Live com que o RC Setlist conversa para
transporte e operações do Live Object Model. É um fork do AbletonOSC
(<https://github.com/ideoforms/AbletonOSC>, MIT) que responde a cada cliente na
porta dele: assim nunca disputa a porta de resposta com outra extensão RC e
convive com um AbletonOSC comum. Ele vem dentro da extensão e dentro do kit de
instalação, e o instalador do kit (`Install-RC-Bridge.cmd` /
`Install RC Bridge.command`) copia para a User Library do Live. Você não
precisa do AbletonOSC; se já tem, o RC Setlist continua funcionando com ele.
Veja [Instalar o RC Bridge](INSTALL.md#instalar-o-rc-bridge).

## Por que o navegador mostra um aviso de certificado?

Enquanto o certificado deste computador não estiver instalado no aparelho, o
navegador mostra `ERR_CERT_AUTHORITY_INVALID`. O RC Setlist assina o
certificado do servidor com uma autoridade certificadora própria, que só vale
para localhost e endereços da rede local. Escaneie uma vez o QR **Certificado
do celular** no painel do Live para instalá-la. Até lá, continue somente se o
endereço for exatamente o IP mostrado no painel do Live e a rede local for
confiável. Os passos estão em [Iniciar o servidor
local](INSTALL.md#iniciar-o-servidor-local).

## Onde as letras ficam salvas?

No diretório de armazenamento de Ableton Extensions, dentro do perfil ativo do
RC Setlist. Use o editor interno em vez de editar os arquivos diretamente.

## Posso usar minhas letras?

Somente se você for o autor ou tiver autorização. O repositório e o kit de
demonstração usam texto fictício; o RC Setlist não fornece letras comerciais.

## O macOS funciona?

O macOS é experimental: a release é validada apenas no Windows, até existir uma
matriz completa em hardware real.

## Posso expor o RC Setlist na internet?

Não. Ele foi projetado para uma rede local confiável. Use um túnel privado
configurado por profissional se o acesso remoto for inevitável; nunca exponha a
porta `4444` diretamente.

## Posso vender o RC Setlist ou uma modificação?

Não sob esta licença. Leia a [licença](../../LICENSE) e procure orientação
jurídica própria para um caso específico.

## Por que a duração total do meu setlist está diferente do esperado?

Se o seu projeto no Ableton Live possui automações de andamento desenhadas na
faixa master do Arrangement e os locators não contêm a tag `[bpm N]`, a
extensão não consegue ler a curva de automação. Nem o Live Object Model nem o
Extensions SDK expõem os pontos de automação da linha do tempo remotamente.

Sem tags declaradas, o RC Setlist calcula a duração usando o andamento
corrente do Live como estimativa uniforme e exibe a etiqueta `EST.`. Em um
setlist real de 21 faixas com andamentos entre 93 e 166 BPM, essa estimativa
gerou uma distorção de 16:59 (95:40 contra os 78:41 reais).

Para obter durações exatas, adicione `[bpm N]` no nome do locator de cada
música (ex.: `Nome da Música [bpm 120]`). O RC Setlist passará a usar o modo
de confiança declarada com cálculo trecho a trecho e removerá o aviso `EST.`.

## Por que não ouço a contagem?

Por padrão, a contagem de 1 compasso é apenas visual (mostrando `1 2 3 4` no
botão Play no navegador), para que o celular do operador não apite pelo
alto-falante no palco. Se você quiser ouvir o click, ative-o por aparelho
definindo `rc-setlist.count-in-audio` como `true` no `localStorage` do
navegador (ex.: via console de desenvolvedor num notebook que alimenta um
retorno de ouvido). O menu "Count-In" embutido no Live não se aplica ao Play,
apenas à gravação.

## Como atualizo da versão 0.x?

Rode o script de migração do kit uma vez, antes de abrir o Live, e remova a
entrada antiga **Ableton RC Setlist** em **Configurações > Extensões**, para
que as duas extensões não coexistam. Os passos completos estão em [Migrar os
dados do 0.x](INSTALL.md#migrar-os-dados-do-0-x).

## Automação de tempo

Se o seu Arrangement tem automação de tempo própria, mantenha **Definir o tempo
do Live ao pular** **desligado** no painel do Live. O padrão é desligado.

Um pulo explícito pode escrever o tempo de destino no Live antes de mover o
playhead. Escrever `song.tempo` sobrepõe a automação de tempo do Live: o
arranjo para de seguir o próprio envelope até você clicar em **Re-Enable
Automation** na barra de transporte. Um pulo no meio do show achataria o tempo
do resto do set.

O RC Setlist também vigia isso sozinho. Quando o tempo que o Live reporta
diverge da tag `[bpm N]` declarada naquele ponto do setlist, a extensão
conclui que alguém além do setlist é dono do tempo e se recusa a escrever,
mesmo com a opção ligada.

Uma tag `[bpm N]` declara o andamento usado para medir a duração. O RC Setlist
não impõe esse andamento ao Live.

Ligue a opção apenas quando as tags forem a sua fonte de verdade para o tempo
e o Arrangement não tiver automação de tempo.
