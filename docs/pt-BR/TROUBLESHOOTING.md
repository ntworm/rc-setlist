# Solução de problemas

## O Ableton RC Setlist não aparece no Live

- Confirme o Ableton Live 12.4.5+ Suite (Beta).
- Abra novamente o `.ablx` e confirme a instalação.
- Reinicie o Live e procure em **Extensions > Ableton RC Setlist**.

## O AbletonOSC não aparece

- Confirme que a pasta `AbletonOSC` está diretamente dentro de Remote Scripts.
- Reinicie o Live depois de copiar a pasta.
- Siga as [instruções oficiais do AbletonOSC](https://github.com/ideoforms/AbletonOSC).

## O painel inicia, mas nenhuma música aparece

- Confirme que o Live Set tem localizadores no Arrangement.
- Comece o nome com uma música; use `Música > Seção` nas seções.
- Confirme que o AbletonOSC está ativo e que o UDP não está bloqueado localmente.
- Reinicie pelo painel depois de mudar a configuração da integração.

## A página do navegador não abre

- Abra `https://localhost:4444/health` no host.
- Confirme que o painel informa que o servidor está em execução.
- Libere TCP `4444` somente no perfil de rede privada.
- Coloque host e controle na mesma LAN que não seja uma rede de convidados.
- Aceite o certificado autoassinado somente para o host esperado.

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

O Ableton RC Setlist usa um listener cooperativo com extensões compatíveis. Use
versões atuais. Se houver falha de bind, reinicie o Live e capture logs sanitizados.

## O que incluir em um bug report

Inclua sistema operacional, versão/edição do Live, versão do Ableton RC Setlist,
navegador, passos exatos e logs sanitizados. Remova tokens, certificados,
caminhos locais e conteúdo real do setlist ou das letras. Consulte
[SUPPORT.md](../../SUPPORT.md).
