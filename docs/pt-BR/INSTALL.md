# Instalar o Ableton RC Setlist

## Requisitos

- Ableton Live 12.4.5+ Suite (Beta) com suporte a Extensions.
- [AbletonOSC](https://github.com/ideoforms/AbletonOSC) instalado como Control Surface.
- Windows para o caminho de lançamento validado. O macOS é experimental.

O Node.js 24.16.0 é necessário apenas para desenvolver a partir do código-fonte,
não para instalar o pacote de lançamento.

## 1. Instalar o AbletonOSC

O Ableton RC Setlist usa o Remote Script externo AbletonOSC, licenciado sob MIT,
para transporte e operações do Live Object Model. Ele não está incluído neste
repositório nem no kit de lançamento.

1. Baixe o AbletonOSC no [repositório oficial](https://github.com/ideoforms/AbletonOSC).
2. Siga as instruções de instalação do projeto.
3. Coloque a pasta `AbletonOSC` diretamente no diretório de Remote Scripts do Live:
   - Windows: `%USERPROFILE%\Documents\Ableton\User Library\Remote Scripts\AbletonOSC`
   - macOS: `~/Music/Ableton/User Library/Remote Scripts/AbletonOSC`
4. Reinicie o Live.
5. Abra **Settings/Preferences > Link, Tempo & MIDI** e selecione AbletonOSC como
   Control Surface.

Importante: use `User Library/Remote Scripts/AbletonOSC`, e não a pasta oculta
`User Remote Scripts` das preferências do Live (ela serve para
`UserConfiguration.txt`). Confirme que `AbletonOSC/__init__.py` existe
diretamente nesse local, sem outra pasta `AbletonOSC` aninhada.

## 2. Instalar o Ableton RC Setlist

1. Baixe `Ableton-RC-Setlist-0.5.0.ablx` na
   [release mais recente do GitHub](https://github.com/ntworm/rc-setlist/releases/latest).
2. Abra o `.ablx` e siga a confirmação de instalação do Ableton Live.
3. Reinicie o Live se a extensão não aparecer imediatamente.
4. Abra **Extensions > Ableton RC Setlist**.

O mesmo `.ablx` contém os dois idiomas. A interface começa em inglês; selecione
**Português (Brasil)** no menu de idioma do painel, do Controle de Palco ou da
Performance. A escolha fica salva localmente.

Não instale arquivos do SDK ou da CLI como usuário final.

## 3. Iniciar o servidor local

1. No painel do Ableton RC Setlist, escolha **Start Server** ou **Iniciar servidor**.
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

1. Pare o Ableton RC Setlist no painel.
2. Remova a extensão pelo gerenciamento de extensões do Live.
3. Reinicie o Live.
4. Para remover também perfis, letras, certificados e preferências, apague somente
   o diretório do Ableton RC Setlist indicado nos logs de Ableton Extensions.

Não apague um diretório amplo da biblioteca do Ableton. Remova apenas o destino
confirmado do Ableton RC Setlist.
