# Solução de problemas

## O Ableton RC Setlist não aparece no Live

- Confirme o Ableton Live 12.4.5+ Suite (Beta).
- Abra novamente o `.ablx` e confirme a instalação.
- Reinicie o Live e procure em **Extensions > Ableton RC Setlist**.

## O AbletonOSC não aparece

- Instale em `User Library/Remote Scripts/AbletonOSC`, e não na pasta oculta
  `User Remote Scripts` das preferências do Live.
- Confirme que `AbletonOSC/__init__.py` existe diretamente nessa pasta, sem
  outro diretório `AbletonOSC` aninhado.
- Reinicie o Live depois de copiar a pasta.
- Selecione AbletonOSC como Control Surface; Input e Output podem permanecer
  como `None`.
- Siga as [instruções oficiais do AbletonOSC](https://github.com/ideoforms/AbletonOSC).

## O painel inicia, mas os controles OSC ou o playhead não respondem

- Escolha **Verificar OSC** no painel do RC Setlist.
- `Live conectado` significa que as respostas do AbletonOSC estão chegando ao
  RC Setlist.
- `Aguardando o AbletonOSC` significa que o servidor local está rodando, mas
  ainda não recebeu resposta. Confira novamente a pasta exata acima, a seleção
  de Control Surface e reinicie o Live.
- `Conexão com AbletonOSC interrompida` significa que havia respostas e elas
  pararam.
- Play/Stop e o playhead em movimento são os testes OSC ponta a ponta mais claros.

## Nenhuma música aparece

- Confirme que o Live Set tem localizadores no Arrangement.
- Comece o nome com uma música; use `Música > Seção` nas seções.
- Reinicie pelo painel depois de mudar a configuração da integração.

## A página do navegador não abre

- Na primeira conexão, `ERR_CERT_AUTHORITY_INVALID` é o aviso esperado para o
  certificado local autoassinado do RC Setlist. Continue somente se o endereço
  for exatamente o IP mostrado no painel do Live e a rede local for confiável.
  Cada navegador/aparelho pode exigir isso uma vez.
- Abra `https://localhost:4444/health` no host.
- Confirme que o painel informa que o servidor está em execução.
- Libere TCP `4444` somente no perfil de rede privada.
- Coloque host e controle na mesma LAN que não seja uma rede de convidados.
- Aceite o certificado autoassinado somente para esse endereço exato do painel.

## Os controles estão somente para leitura

Abra a URL de controle ou leia o QR code de controle no painel. O token é
obrigatório para transporte e escrita. Não o compartilhe publicamente.

Se músicas, letras e timecode atualizam, mas transporte e navegação falham,
confirme que você usa 0.3.0 ou superior. Versões anteriores podiam falhar ao
codificar comandos OSC no runtime embutido do Ableton.

## O primeiro início mostra erro de persistência do perfil

Instale 0.3.0 ou superior. Versões anteriores podiam gravar o perfil inicial e
falhar logo depois por usar uma API indisponível. Se o erro continuar, capture
um trecho sanitizado de `ExtensionHost.txt` sem apagar os dados do perfil.

## As letras não correspondem à música

- Confirme o perfil ativo.
- Confirme que a letra está associada ao título limpo da música.
- Remova tags de localizador do nome usado na letra.
- Salve novamente no editor interno e atualize o estado.

Ao atualizar de uma versão antiga chamada **RC SETLIST** ou **Ableton Setlist
Bridge**, reinicie o servidor uma vez. O Ableton RC Setlist importa letras e
ordem ausentes das pastas conhecidas sem apagar pastas antigas ou substituir
arquivos já existentes no perfil novo.

## Outra extensão usa a porta OSC 11001

O AbletonOSC envia todas as respostas para a porta UDP fixa `11001`. Quando
outra extensão RC já ocupa essa porta, o RC Setlist usa a porta 11101 como
fallback: ele ainda pode enviar comandos, mas não recebe as respostas do
AbletonOSC. O painel compacto mostra `Live ativo · porta de retorno OSC ocupada`.

Quando a ponte MCP local também está disponível, o **fallback MCP** mantém o
playhead, o estado de reprodução e o tempo sincronizados e fornece a duração
total. O RC Setlist também conserva localmente a quantização pedida pelo
operador; ao escolher `Nenhuma`, os saltos de seção ficam imediatos mesmo com a
porta de retorno OSC ocupada. **Verificar OSC** continua mostrando o conflito de
porta corretamente, sem chamar o fallback de conexão OSC nativa.

Se a ponte MCP também estiver ausente, pare a outra extensão RC, reinicie o RC
Setlist e use **Verificar OSC** novamente. Não tente forçar dois sockets a
compartilhar a porta `11001` no Windows; apenas um deles receberá cada resposta.
Para o diagnóstico OSC nativo, mantenha o início automático ligado em apenas uma
extensão RC que dependa de OSC.

## Aparecem setlists de outro Live Set

As versões atuais guardam vários setlists somente dentro do escopo do Live Set
atual. A lista global de perfis de versões antigas não aparece no projeto aberto.
Se o projeto foi trocado enquanto uma versão antiga estava rodando, reinicie o
servidor do RC Setlist depois de abrir o `.als` correto.

Os dados globais antigos continuam preservados como backup. Somente a antiga
pasta por projeto que corresponde exatamente ao Live Set salvo atual é importada
automaticamente.

Se os metadados do projeto chegarem depois da inicialização, o escopo temporário
do projeto é promovido ao escopo do `.als` salvo. Perfis criados durante a espera,
inclusive `Second Setlist`, são copiados sem apagar a origem temporária. Em um Set
não identificado, letras ausentes só são recuperadas quando uma única ordem
personalizada antiga corresponde à lista completa de músicas atual; resultados
ambíguos permanecem intactos.

## O que incluir em um bug report

Inclua sistema operacional, versão/edição do Live, versão do Ableton RC Setlist,
navegador, passos exatos e logs sanitizados. Remova tokens, certificados,
caminhos locais e conteúdo real do setlist ou das letras. Consulte
[SUPPORT.md](../../SUPPORT.md).
