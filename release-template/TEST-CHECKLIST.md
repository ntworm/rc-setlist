# Checklist de teste — Ableton RC Setlist 0.3.0

Use uma cópia de um Live Set e uma **trusted local network / LAN**. Não faça o
primeiro teste em um show real.

## Instalação

- [ ] Ableton Live 12.4.5+ Suite Beta abre normalmente.
- [ ] AbletonOSC aparece e está selecionado como Control Surface.
- [ ] `Ableton-RC-Setlist-0.3.0.ablx` instala sem erro.
- [ ] Em dados limpos, o primeiro clique em **Iniciar** cria o perfil padrão e sobe o servidor sem erro de persistência.
- [ ] **Extensions > Ableton RC Setlist** abre o painel correto e mostra versão 0.3.0.

## Primeiro uso

- [ ] O servidor inicia e mostra URL/QR local.
- [ ] `https://localhost:4444/setlist` abre após aceitar o certificado local.
- [ ] Outro dispositivo na mesma LAN abre a URL mostrada pelo painel.
- [ ] `/performance` abre em tela cheia sem rolagem horizontal.

## Set fictício

- [ ] Os locators de `examples/` viram músicas e seções na ordem esperada.
- [ ] BPM, click, `[loop 2x]`, `[next]` e `[stop]` respondem como documentado.
- [ ] Previous/Next exigem o hold de segurança.
- [ ] Saltos de música/seção, click e Atualizar enviam comandos reais ao Live.
- [ ] A troca de quantização aguarda confirmação do Live.
- [ ] Texto LRC autorizado/fictício acompanha o transporte.
- [ ] Letras antigas ausentes são migradas sem apagar a pasta anterior nem sobrescrever letras novas.
- [ ] O CSV exportado abre em UTF-8 e contém apenas o set atual.

## Persistência e falhas

- [ ] Perfil, ordem e preferência de auto-start sobrevivem ao reinício do Live.
- [ ] Uma queda breve da conexão exibe estado de reconexão sem inventar dados.
- [ ] Com AbletonOSC indisponível, a interface falha de modo compreensível.
- [ ] O token completo do controller não aparece em nenhuma captura pública.

## Aprovação manual

- [ ] Windows validado no computador de lançamento.
- [ ] macOS marcado como experimental se não houver teste em hardware real.
- [ ] Landing, README, instalação e changelog conferidos.
- [ ] SHA-256 do `.ablx` confere com `SHA256SUMS.txt`.
- [ ] Resultado final registrado antes de publicar no GitHub.
