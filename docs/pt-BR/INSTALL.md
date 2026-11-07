# Instalar o RC Setlist

## Requisitos

- Ableton Live 12.4.5+ Suite (Beta) com suporte a Extensions.
- Windows para o caminho de lançamento validado. O macOS é experimental.
- RC Bridge selecionado como Control Surface no Live; a seção abaixo instala o
  script. Um [AbletonOSC](https://github.com/ideoforms/AbletonOSC) comum também
  funciona.

O Node.js 24.16.0 é necessário apenas para desenvolver a partir do
código-fonte, não para instalar o pacote de lançamento.

Depois da instalação, siga [Primeiros passos](PRIMEIROS-PASSOS.md) para o
primeiro show.

## Instalar o RC Bridge

O RC Bridge é o Remote Script do Live com que o RC Setlist conversa. É um fork
do [AbletonOSC](https://github.com/ideoforms/AbletonOSC), licenciado sob MIT,
que responde a cada cliente na porta dele — assim nunca disputa a porta de
resposta com outra extensão RC e convive com um AbletonOSC comum. Ele está
dentro da extensão e dentro do kit, então não há nada para baixar.

Coloque o script na User Library do Live de duas maneiras:

- **Pelo kit** — na pasta `RC-Bridge`, clique duas vezes em
  `Install-RC-Bridge.cmd` (Windows) ou `Install RC Bridge.command` (macOS; na
  primeira vez, botão direito › Abrir). Ele copia o script e mostra o último
  passo.
- **À mão** — copie a pasta `RCBridge` do kit para
  `%USERPROFILE%\Documents\Ableton\User Library\Remote Scripts\RCBridge` no
  Windows ou `~/Music/Ableton/User Library/Remote Scripts/RCBridge` no macOS.

Depois abra **Settings/Preferences > Link, Tempo & MIDI** e escolha **RCBridge**
como Control Surface. Input e Output podem ficar em `None`. Se o Live já
estava aberto quando o script foi copiado, feche e abra de novo uma vez, para
ele enxergar a pasta nova.

Use `User Library/Remote Scripts/`, e não a pasta oculta `User Remote Scripts`
das preferências do Live, que guarda o `UserConfiguration.txt`. Confirme que
`RCBridge/__init__.py` existe diretamente nesse local, sem outra pasta
`RCBridge` aninhada.

O RC Bridge escuta na porta 11020 e o AbletonOSC fica com a 11000. O RC Setlist
procura o RC Bridge primeiro e cai para o AbletonOSC quando ele não está lá,
então os dois funcionam; o RC Bridge é o que também funciona ao lado do RC
Surface. A linha OSC do painel diz qual está em uso (`via RC Bridge 1.0.0 na
porta 11020`). A própria extensão não consegue copiar o script por você: o
Live roda as extensões numa sandbox que não escreve na sua User Library.

## Instalar a extensão

1. Baixe `RC-Setlist-1.1.0.ablx` na
   [release mais recente do GitHub](https://github.com/ntworm/rc-setlist/releases/latest).
2. Abra o `.ablx` e siga a confirmação de instalação do Ableton Live.
3. Reinicie o Live se a extensão não aparecer imediatamente.
4. Abra **Extensions > RC Setlist**.

O mesmo `.ablx` contém os dois idiomas. A interface começa em inglês; selecione
**Português (Brasil)** no menu de idioma do painel, do Controle de Palco ou da
Performance. A escolha fica salva localmente.

Não instale arquivos do SDK ou da CLI como usuário final.

## Iniciar o servidor local

1. No painel do RC Setlist, escolha **Start Server** ou **Iniciar servidor**.
2. Confirme que o painel mostra uma URL local e um QR code.
3. No computador principal, abra `https://localhost:4444/setlist`.
4. Em um celular ou tablet, use a URL da LAN ou o QR code mostrado no painel.

O RC Setlist cria uma autoridade certificadora para este computador, que só
vale para localhost e endereços da rede local, e assina com ela o certificado
do servidor. Enquanto o certificado deste computador não estiver instalado no
aparelho, o navegador mostra `ERR_CERT_AUTHORITY_INVALID`. Para o aviso sumir
no celular, escaneie o QR **Certificado do celular** no painel do Live: ele
abre uma página simples na porta `4445` com o arquivo e os passos para Android
e iPhone. Até lá, continue somente se o endereço for exatamente o IP mostrado
no painel do Live e a rede local for confiável.

A URL de controle contém um token. Trate esse token como uma senha local e não
publique capturas mostrando o endereço completo.

## Abrir as duas visualizações

- Controle de Palco, para o operador: `https://<ip-do-host>:4444/setlist`
- Performance, a tela somente leitura para a banda: `https://<ip-do-host>:4444/performance`

## Migrar os dados do 0.x

Os dados de uma build 0.x ficam na pasta `ntworm.ableton-rc-setlist`, onde
ficam os perfis, project-setlists, token e preferências; a extensão atual usa
`ntworm.rc-setlist`.

Rode o `Migrate-RC-Setlist-Data.cmd` (Windows) ou
`Migrate RC Setlist Data.command` (macOS) do kit **uma vez, antes de abrir o
Live**. Ele copia os dados antigos para a pasta nova sem mexer na antiga e
nunca sobrescreve um arquivo que já existe no destino.

O instalador `RC-Bridge/Install-RC-Bridge.ps1` (Windows) ou
`RC-Bridge/Install RC Bridge.command` (macOS) remove automaticamente qualquer
`Ableton-RC-Setlist-*.ablx` encontrado na User Library. Nenhum passo de
desinstalação separado é necessário. Se você instalou a extensão a partir de
uma build 0.x, use o `uninstall-pre-1.0-extensions.ps1` incluído no kit como
alternativa manual (veja [TROUBLESHOOTING.md](TROUBLESHOOTING.md)).

No Live, remova a entrada antiga **Ableton RC Setlist** em **Configurações >
Extensões**, para que as duas extensões não coexistam na mesma máquina.

## Atualização

Instale o `.ablx` mais recente pelo Live. Faça backup de letras e exportações
importantes antes de substituir uma versão de pré-lançamento. Os dados de
perfil ficam separados do pacote, então continuam disponíveis após a
atualização.

## Desinstalação

1. Pare o RC Setlist no painel.
2. Remova a extensão pelo gerenciamento de extensões do Live.
3. Reinicie o Live.
4. Para remover também perfis, letras, certificados e preferências, apague
   somente o diretório do RC Setlist indicado nos logs de Ableton Extensions.

Não apague um diretório amplo da biblioteca do Ableton. Remova apenas o destino
confirmado do RC Setlist.
