# Instalar o RC Setlist

## Requisitos

- Ableton Live 12.4.5+ Suite (Beta) com suporte a Extensions.
- RC Bridge selecionado como Control Surface no Live. Ele vem com a extensão e
  com o kit de instalação; o passo 1 abaixo instala. (Um
  [AbletonOSC](https://github.com/ideoforms/AbletonOSC) comum também funciona.)
- Windows para o caminho de lançamento validado. O macOS é experimental.

O Node.js 24.16.0 é necessário apenas para desenvolver a partir do código-fonte,
não para instalar o pacote de lançamento.

## 1. Instalar o RC Bridge

O RC Bridge é o Remote Script do Live com que o RC Setlist conversa. É
um fork do [AbletonOSC](https://github.com/ideoforms/AbletonOSC), licenciado
sob MIT, que responde a cada cliente na porta dele — assim nunca disputa a
porta de resposta com outra extensão RC e convive com um AbletonOSC comum, se
você tiver um. Nada para baixar: ele está dentro da extensão e dentro do kit.

Escolha um dos dois jeitos de colocá-lo na User Library do Live:

- **Pelo kit** — na pasta `RC-Bridge`, clique duas vezes em
  `Install-RC-Bridge.cmd` (Windows) ou `Install RC Bridge.command` (macOS; na
  primeira vez, botão direito › Abrir). Ele copia o script e mostra o último
  passo.
- **À mão** — copie a pasta `RCBridge` do kit para
  - Windows: `%USERPROFILE%\Documents\Ableton\User Library\Remote Scripts\RCBridge`
  - macOS: `~/Music/Ableton/User Library/Remote Scripts/RCBridge`

Depois, o único passo que o Live não deixa ninguém fazer por você: abra
**Settings/Preferences > Link, Tempo & MIDI** e escolha **RCBridge** como
Control Surface. Input e Output podem ficar em `None`. Se o Live já estava
aberto quando o script foi copiado, feche e abra de novo uma vez, para ele
enxergar a pasta nova.

Use `User Library/Remote Scripts/`, e não a pasta oculta `User Remote Scripts`
das preferências do Live (ela serve para `UserConfiguration.txt`). Confirme que
`RCBridge/__init__.py` existe diretamente nesse local, sem outra pasta
`RCBridge` aninhada.

Se você já usa o AbletonOSC com outras ferramentas, pode manter. O RC Bridge
escuta na porta 11020; o AbletonOSC fica com a 11000. O RC Setlist procura o
RC Bridge primeiro e cai para o AbletonOSC quando ele não está lá, então os
dois funcionam — o RC Bridge é o que também funciona ao lado do RC Surface. A
linha OSC do painel diz qual está em uso (`via RC Bridge 1.0.0 na porta 11020`).
A própria extensão não consegue copiar o script por você: o Live roda as
extensões numa sandbox que não escreve na sua User Library.

## 2. Instalar o RC Setlist

1. Baixe `RC-Setlist-1.0.0.ablx` na
   [release mais recente do GitHub](https://github.com/ntworm/rc-setlist/releases/latest).
2. Abra o `.ablx` e siga a confirmação de instalação do Ableton Live.
3. Reinicie o Live se a extensão não aparecer imediatamente.
4. Abra **Extensions > RC Setlist**.

O mesmo `.ablx` contém os dois idiomas. A interface começa em inglês; selecione
**Português (Brasil)** no menu de idioma do painel, do Controle de Palco ou da
Performance. A escolha fica salva localmente.

Não instale arquivos do SDK ou da CLI como usuário final.

## 3. Iniciar o servidor local

1. No painel do RC Setlist, escolha **Start Server** ou **Iniciar servidor**.
2. Confirme que o painel mostra uma URL local e um QR code.
3. No computador principal, abra `https://localhost:4444/setlist`.
4. Em um celular ou tablet, use a URL da LAN ou o QR code mostrado no painel.

Primeira conexão: o navegador pode mostrar `ERR_CERT_AUTHORITY_INVALID` porque o
RC Setlist cria um certificado local autoassinado. Continue somente se o endereço
for exatamente o IP mostrado no painel do Live e a rede local for confiável. Cada
navegador/aparelho pode exigir isso uma vez.

## 4. Abrir as duas visualizações

- Operação: `https://<ip-do-host>:4444/setlist`
- Performance: `https://<ip-do-host>:4444/performance`

## Atualizando de 0.x (Ableton RC Setlist 0.4.x–0.7.0)

O nome do produto mudou para **RC Setlist** na 1.0 seguindo as diretrizes
de marca da Ableton. Seus perfis, project-setlists, token e preferências
ficam numa pasta cujo nome vem do manifest, então precisam mudar.

Rode o `Migrate-RC-Setlist-Data.cmd` (Windows) ou
`Migrate RC Setlist Data.command` (macOS) do kit **uma vez, antes de abrir
o Live** com a 1.0. Ele copia os dados de `ntworm.ableton-rc-setlist` para
a pasta nova `ntworm.rc-setlist` sem mexer na antiga e nunca sobrescreve
um arquivo que já existe no destino.

O instalador `RC-Bridge/Install-RC-Bridge.ps1` (Windows) ou
`RC-Bridge/Install RC Bridge.command` (macOS) remove automaticamente qualquer
`Ableton-RC-Setlist-*.ablx` encontrado na User Library. Nenhum passo de
desinstalação separado é necessário. Se você instalou o RC Bridge antes de
atualizar para a 1.0, use o `uninstall-pre-1.0-extensions.ps1` incluído no
kit como alternativa manual (veja [TROUBLESHOOTING.md](TROUBLESHOOTING.md)).

A URL de controle contém um token. Trate esse token como uma senha local e não
publique capturas mostrando o endereço completo.

## 5. Verificar a primeira sessão

1. Abra um Live Set com localizadores fictícios do [exemplo](../../examples/README.md).
2. No painel do RC Setlist, escolha **Verificar OSC** e confirme tráfego recebido.
3. Confirme que músicas e seções aparecem em `/setlist`.
4. Abra `/performance` e confirme que a música ativa acompanha o playhead do Live.
5. Teste Play/Stop e o acionamento protegido por hold de Anterior/Próxima.
6. Troque o idioma e recarregue as páginas para confirmar que a escolha foi salva.
7. Feche e reabra o Live para conferir o perfil e a opção de início automático.

## Atualização

Instale o `.ablx` mais recente pelo Live. Faça backup de letras e exportações
importantes antes de substituir uma versão de pré-lançamento. Os dados de perfil
ficam separados do pacote e devem continuar disponíveis após a atualização.

## Desinstalação

1. Pare o RC Setlist no painel.
2. Remova a extensão pelo gerenciamento de extensões do Live.
3. Reinicie o Live.
4. Para remover também perfis, letras, certificados e preferências, apague somente
   o diretório do RC Setlist indicado nos logs de Ableton Extensions.

Não apague um diretório amplo da biblioteca do Ableton. Remova apenas o destino
confirmado do RC Setlist.
