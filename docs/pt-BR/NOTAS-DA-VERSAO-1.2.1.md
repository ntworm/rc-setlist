# Notas da versão RC Setlist 1.2.1

**Data de lançamento:** 2026-11-20
**Linha de versões suportada:** `1.2.x`
**Também disponível em inglês:** [`../RELEASE-NOTES-1.2.1.md`](../RELEASE-NOTES-1.2.1.md)

## Correções

- **Prontos para parear mostra um endereço que responde.** Quando o segundo
  computador (o slave) tem duas interfaces de rede na mesma sub-rede, a lista
  **Prontos para parear** podia mostrar um endereço que o computador principal
  (o master) não alcança. O anúncio na rede agora leva os endereços de LAN do
  slave, e o master testa cada um na porta anunciada e lista o primeiro que
  responde.
- **Um celular num slave comanda o show inteiro.** Quando o master está
  conectado, os comandos dados por um celular ou pelo painel do Live num slave —
  play, stop, saltos, metrônomo, quantização, contagem, atualizar e pânico —
  sobem para o master, que executa cada um e envia para todos os slaves. Sem o
  master conectado, o slave executa tudo sozinho, como antes, e registra isso no
  log.

## Atualizando

O Live recusa instalar por cima de uma pasta de extensão existente: remova o RC
Setlist nas configurações de extensões do Live antes (a pasta de dados fica) e
depois troque o `.ablx` em cada computador. O Remote Script RC Bridge não
mudou, então não é preciso reinstalá-lo. O master e todos os slaves precisam
estar na 1.2.1 para o controle pelo celular num slave funcionar: um master na
1.2.0 ignora o que um slave na 1.2.1 envia para cima, e o slave acusa o tempo
esgotado.
