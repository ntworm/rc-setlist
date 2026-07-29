# Checklist de lançamento — Ableton RC Setlist 0.4.1

Use uma cópia de um Live Set e uma **rede local confiável / LAN**. Não faça o
primeiro teste durante um show real.

## Instalação

- [ ] Ableton Live 12.4.5+ Suite Beta abre normalmente.
- [ ] O AbletonOSC está em `User Library/Remote Scripts/AbletonOSC`, não na pasta
  oculta `User Remote Scripts` das preferências, e
  `AbletonOSC/__init__.py` existe diretamente dentro dela.
- [ ] AbletonOSC aparece e está selecionado como Control Surface.
- [ ] `Ableton-RC-Setlist-0.4.1.ablx` instala sem erro.
- [ ] Em dados limpos, o primeiro **Iniciar** cria o perfil padrão e sobe o servidor sem erro de persistência.
- [ ] **Extensions > Ableton RC Setlist** abre o painel correto e mostra a versão 0.4.1.

## Idioma

- [ ] O painel, o Controle de Palco e a Performance iniciam em inglês.
- [ ] **Português (Brasil)** traduz os rótulos sem alterar músicas, seções, letras ou cifras.
- [ ] O idioma escolhido permanece depois de recarregar a página e reiniciar a extensão.
- [ ] Voltar ao inglês preserva música, seção e transporte ativos.

## Primeiro uso

- [ ] O servidor inicia e mostra URL/QR local.
- [ ] O guia de instalação/troubleshooting explica que `ERR_CERT_AUTHORITY_INVALID` é o aviso esperado para o certificado local autoassinado; continue somente se o endereço for exatamente o IP mostrado no painel do Live em uma LAN confiável.
- [ ] `https://localhost:4444/setlist` abre após aceitar o certificado local uma vez neste navegador/aparelho.
- [ ] Outro dispositivo na mesma LAN abre a URL mostrada pelo painel.
- [ ] `/performance` abre em tela cheia sem rolagem horizontal.

## Set fictício

Crie um Arrangement descartável com estes localizadores, nesta ordem:

```text
TESTE 01 [bpm 120] [click]
TESTE 01 > VERSO
[loop 2x]
TESTE 01 > FINAL
[stop]
TESTE 02 [bpm 128] [click off]
TESTE 02 > REFRÃO
```

- [ ] Os dois localizadores que contêm somente tags aparecem como seções de
  automação dentro de TESTE 01, e não como músicas vazias.
- [ ] Adicione `TESTE 01B` entre TESTE 01 e TESTE 02; **Atualizar** deve
  colocá-lo na posição cronológica em vez de anexá-lo ao final.
- [ ] A duração aparece em cada música e a duração total do setlist é atualizada.
- [ ] BPM, click, `[loop 2x]` e `[stop]` funcionam como documentado.
- [ ] Anterior/Próxima exigem o hold de segurança.
- [ ] Play, Stop, saltos, click e Atualizar enviam comandos reais ao Live.
- [ ] A quantização aguarda confirmação do Live.
- [ ] **Controle de Palco** e **Tela de Performance** abrem pelo painel do Live.
- [ ] Texto LRC autorizado ou fictício acompanha o transporte.
- [ ] Letras antigas ausentes migram sem apagar a pasta anterior ou sobrescrever letras novas.
- [ ] O CSV abre em UTF-8 e contém somente o set atual.

## Persistência e falhas

- [ ] Perfil, ordem, idioma e início automático sobrevivem ao reinício do Live.
- [ ] Com o transporte parado, criar, selecionar e renomear um segundo Active
  Setlist; depois excluir esse setlist enquanto estiver inativo e restaurar pela
  lixeira recuperável.
- [ ] No celular, o campo de rename mantém teclado e foco com o Live parado, e
  Enter confirma o novo nome.
- [ ] Um setlist criado neste Live Set não aparece ao abrir outro `.als` salvo;
  reabrir o primeiro Set recupera esse setlist.
- [ ] Uma queda breve mostra reconexão sem inventar dados.
- [ ] Sem AbletonOSC, a interface falha de forma compreensível.
- [ ] **Verificar OSC** distingue parado, aguardando, conectado, interrompido e
  porta de retorno OSC ocupada com um rótulo compacto.
- [ ] O token completo do controle não aparece em nenhuma captura pública.

## Aprovação

- [ ] Windows verificado no computador de lançamento.
- [ ] macOS continua experimental se não houver teste em hardware real.
- [ ] Landing, documentação inglês/PT-BR, kit e changelog conferidos.
- [ ] SHA-256 do `.ablx` confere com `SHA256SUMS.txt`.
- [ ] Resultado final registrado antes de publicar no GitHub.
