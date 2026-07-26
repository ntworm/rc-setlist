# Checklist de lançamento — Ableton RC Setlist 0.4.0

Use uma cópia de um Live Set e uma **rede local confiável / LAN**. Não faça o
primeiro teste durante um show real.

## Instalação

- [ ] Ableton Live 12.4.5+ Suite Beta abre normalmente.
- [ ] AbletonOSC aparece e está selecionado como Control Surface.
- [ ] `Ableton-RC-Setlist-0.4.0.ablx` instala sem erro.
- [ ] Em dados limpos, o primeiro **Iniciar** cria o perfil padrão e sobe o servidor sem erro de persistência.
- [ ] **Extensions > Ableton RC Setlist** abre o painel correto e mostra a versão 0.4.0.

## Idioma

- [ ] O painel, o Controle de Palco e a Performance iniciam em inglês.
- [ ] **Português (Brasil)** traduz os rótulos sem alterar músicas, seções, letras ou cifras.
- [ ] O idioma escolhido permanece depois de recarregar a página e reiniciar a extensão.
- [ ] Voltar ao inglês preserva música, seção e transporte ativos.

## Primeiro uso

- [ ] O servidor inicia e mostra URL/QR local.
- [ ] `https://localhost:4444/setlist` abre após aceitar o certificado local.
- [ ] Outro dispositivo na mesma LAN abre a URL mostrada pelo painel.
- [ ] `/performance` abre em tela cheia sem rolagem horizontal.

## Set fictício

- [ ] Os localizadores de `examples/` viram músicas e seções na ordem esperada.
- [ ] BPM, click, `[loop 2x]`, `[next]` e `[stop]` funcionam como documentado.
- [ ] Anterior/Próxima exigem o hold de segurança.
- [ ] Saltos, click e Atualizar enviam comandos reais ao Live.
- [ ] A quantização aguarda confirmação do Live.
- [ ] Texto LRC autorizado ou fictício acompanha o transporte.
- [ ] Letras antigas ausentes migram sem apagar a pasta anterior ou sobrescrever letras novas.
- [ ] O CSV abre em UTF-8 e contém somente o set atual.

## Persistência e falhas

- [ ] Perfil, ordem, idioma e início automático sobrevivem ao reinício do Live.
- [ ] Uma queda breve mostra reconexão sem inventar dados.
- [ ] Sem AbletonOSC, a interface falha de forma compreensível.
- [ ] O token completo do controle não aparece em nenhuma captura pública.

## Aprovação

- [ ] Windows verificado no computador de lançamento.
- [ ] macOS continua experimental se não houver teste em hardware real.
- [ ] Landing, documentação inglês/PT-BR, kit e changelog conferidos.
- [ ] SHA-256 do `.ablx` confere com `SHA256SUMS.txt`.
- [ ] Resultado final registrado antes de publicar no GitHub.
