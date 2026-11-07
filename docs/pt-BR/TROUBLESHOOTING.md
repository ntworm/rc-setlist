# Solução de problemas

## O RC Setlist não aparece no Live

- Confirme o Ableton Live 12.4.5+ Suite (Beta).
- Abra novamente o `.ablx` e confirme a instalação.
- Reinicie o Live e procure em **Extensions > RC Setlist**.

## O RCBridge não aparece na lista de Control Surface

- Instale em `User Library/Remote Scripts/RCBridge`, e não na pasta oculta
  `User Remote Scripts` das preferências do Live. O `Install-RC-Bridge.cmd` /
  `Install RC Bridge.command` do kit coloca no lugar certo.
- Confirme que `RCBridge/__init__.py` existe diretamente nessa pasta, sem
  outro diretório `RCBridge` aninhado.
- Feche e abra o Live de novo depois de copiar; o Live lê a pasta ao iniciar.
- Selecione RCBridge como Control Surface; Input e Output podem permanecer
  como `None`.
- A linha OSC do painel diz com qual script a extensão está falando de fato
  (`via RC Bridge 1.0.0 na porta 11020`, ou `via AbletonOSC na porta 11000`),
  e mostra os passos de instalação quando não é o RC Bridge que responde.

## O painel inicia, mas os controles OSC ou o playhead não respondem

- Escolha **Verificar OSC** no painel do RC Setlist.
- `Live conectado` significa que as respostas do remote script estão chegando
  ao RC Setlist.
- `Aguardando o AbletonOSC` significa que o servidor local está rodando, mas
  ainda não recebeu resposta. Confira novamente a pasta exata acima, a seleção
  de Control Surface e reinicie o Live.
- `Conexão com AbletonOSC interrompida` significa que havia respostas e elas
  pararam.
- A extensão decide com qual script falar quando o servidor inicia. Se você
  instalou e selecionou o RC Bridge com o servidor já rodando, aperte
  **Reiniciar** no painel.
- Play/Stop e o playhead em movimento testam o caminho OSC inteiro de uma vez.

## Nenhuma música aparece

- Confirme que o Live Set tem locators no Arrangement.
- Comece o nome com uma música; use `Música > Seção` nas seções.
- Reinicie pelo painel depois de mudar a configuração da integração.

## A página do navegador não abre

- `ERR_CERT_AUTHORITY_INVALID` é o aviso esperado enquanto o certificado deste
  computador não estiver instalado no aparelho. Escaneie o QR **Certificado do
  celular** no painel do Live e siga os passos daquela página (porta `4445`). O
  Android recusa o certificado aberto pela notificação do download: instale
  pelas Configurações.
- Abra `https://localhost:4444/health` no host.
- Confirme que o painel informa que o servidor está em execução.
- Libere TCP `4444` somente no perfil de rede privada.
- Coloque host e controle na mesma LAN que não seja uma rede de convidados.
- Aceite o aviso de certificado somente para esse endereço exato do painel.

## Os controles estão somente para leitura

Abra a URL de controle ou leia o QR code de controle no painel. O token é
obrigatório para transporte e escrita. Não o compartilhe publicamente.

As ações de transporte e navegação precisam do RC Setlist 0.3.0 ou superior.
Quando as músicas, as letras e o timecode atualizam, mas toda ação de
transporte ou navegação falha, escolha **Verificar OSC** no painel e leia a
seção de OSC acima.

## O primeiro início mostra erro de persistência do perfil

A primeira gravação do perfil precisa do RC Setlist 0.3.0 ou superior.

Se o erro continuar depois de atualizar, capture um trecho sanitizado de
`ExtensionHost.txt` sem apagar os dados do perfil.

## As letras não correspondem à música

- Confirme o perfil ativo.
- Confirme que a letra está associada ao título limpo da música.
- Remova tags de locator do nome usado na letra.
- Salve novamente no editor interno e atualize o estado.

Reinicie o servidor uma vez. O RC Setlist importa letras e ordem ausentes das
pastas conhecidas de extensões anteriores, sem apagar pastas antigas nem
substituir arquivos já existentes no perfil novo.

Os dados de uma build 0.x ficam em outra pasta. Veja [Migrar os dados do
0.x](INSTALL.md#migrar-os-dados-do-0-x).

## Outra extensão usa a porta OSC 11001

Isso só acontece com um AbletonOSC comum. Ele envia todas as respostas para a
porta UDP fixa `11001`; quando outra extensão RC já ocupa essa porta, o RC
Setlist usa a porta 11101 como fallback, ainda pode enviar comandos, mas não
recebe as respostas do AbletonOSC. O painel compacto mostra
`Live ativo · porta de retorno OSC ocupada`.

A solução é o RC Bridge: ele responde na porta de quem perguntou, então cada
extensão RC recebe as suas respostas e nada é compartilhado. Instale (veja
[INSTALL](INSTALL.md)), selecione como Control Surface e reinicie o servidor.

Quando a ponte MCP local também está disponível, o **fallback MCP** mantém o
playhead, o estado de reprodução e o tempo sincronizados e fornece a duração
total. O RC Setlist também conserva localmente a quantização pedida pelo
operador; ao escolher `Nenhuma`, os saltos de seção ficam imediatos mesmo com a
porta de retorno OSC ocupada. **Verificar OSC** continua mostrando o conflito de
porta corretamente, sem chamar o fallback de conexão OSC nativa.

Se a ponte MCP também estiver ausente, pare a outra extensão RC, reinicie o RC
Setlist e use **Verificar OSC** novamente. Não tente forçar dois sockets a
compartilhar a porta `11001` no Windows; apenas um deles receberá cada
resposta. Para o diagnóstico OSC nativo, mantenha o início automático ligado
em apenas uma extensão RC que dependa de OSC.

## Aparecem setlists de outro Live Set

O RC Setlist guarda cada operação de perfil dentro do escopo do Live Set
atual. A lista global de perfis não aparece, e um Live Set novo e não salvo não
importa outra sessão temporária automaticamente.

Os dados globais antigos continuam preservados como backup. Somente a pasta por
projeto que corresponde exatamente ao Live Set salvo atual é importada
automaticamente.

Se os metadados do projeto chegarem depois da inicialização, ou se você usar
**Save As** sem mudar o Song handle, o escopo temporário do projeto é
promovido ao escopo do `.als` salvo, e só quando esses metadados atrasados
ainda correspondem à mesma sessão do Live e ao mesmo escopo de perfil. Perfis
criados durante a espera, inclusive `Second Setlist`, são copiados sem apagar
a origem temporária.

Depois de trocar de Live Set, reinicie o RC Setlist antes de abrir o `.als`
salvo pretendido. A pasta temporária criada quando o Song handle muda é
mantida para recuperação manual, mas os perfis dela não são migrados
automaticamente. Outras pastas temporárias de sessões anteriores também são
mantidas para recuperação manual. Em um Set não identificado, letras ausentes
só são recuperadas quando uma única ordem personalizada antiga corresponde à
lista completa de músicas atual; resultados ambíguos permanecem intactos.

## O que incluir em um bug report

Inclua sistema operacional, versão/edição do Live, versão do RC Setlist,
navegador, passos exatos e logs sanitizados. Remova tokens, certificados,
caminhos locais e conteúdo real do setlist ou das letras. Consulte
[SUPPORT.md](../../SUPPORT.md).
