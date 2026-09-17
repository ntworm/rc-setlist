# Contratos do RC Setlist

Este documento é o contrato público do RC Setlist 1.0. Cada comportamento
aqui documentado tem um teste de regressão em
[`tests/release-contracts.test.mjs`](../../tests/release-contracts.test.mjs);
o que estiver fora deste documento é detalhe de implementação e pode
mudar sem aviso. Tudo o que está documentado aqui permanece até a
próxima major version (2.0), conforme a política de SemVer na §7.

Público: autores de extensão escrevendo um controlador que conversa
com o RC Setlist via WebSocket, integradores lendo ou escrevendo
perfis do RC Setlist em disco, e contribuidores alterando qualquer
uma das superfícies abaixo.

Idioma: [English](../CONTRACTS.md)

---

## 1. Formatos em disco

Os perfis ficam sob uma única raiz de armazenamento. A 1.0 deriva a
raiz a partir de `name` em `manifest.json` (`RC Setlist`), do
editor (`ntworm`) e da versão do Live Suite, então um usuário Windows
com Ableton 12 vê
`%LOCALAPPDATA%\Ableton\Extensions Data\ntworm.rc-setlist\` e um
usuário macOS vê `~/Library/Application Support/Ableton/Extensions
Data/ntworm.rc-setlist/`. A linha 0.x usava `ntworm.ableton-rc-setlist`;
o kit de migração 1.0 (`Migrate-RC-Setlist-Data.{cmd,ps1}` /
`Migrate RC Setlist Data.command`, `scripts/migrate-data.mjs`) copia a
árvore antiga para a nova sem sobrescrever arquivos do destino.

Dentro do diretório de um perfil:

| Arquivo                             | Dono    | Estável desde | Observações                                                         |
| ----------------------------------- | ------- | ------------- | ------------------------------------------------------------------- |
| `index.json`                        | manager | 0.5.1         | Registro de perfis (UUID, nome, created/updated, schemaVersion).    |
| `index.json.bak`                    | manager | 0.5.1         | Sombra de recuperação gravada junto a `index.json`.                 |
| `profile.json`                      | manager | 0.5.1         | Metadados do perfil + raiz de caminhos + `lastSavedAt`.             |
| `profile.json.bak`                  | manager | 0.5.1         | Sombra de recuperação.                                              |
| `profiles/<uuid>/profile.json`      | manager | 0.5.1         | Metadados por perfil.                                               |
| `profiles/<uuid>/custom-order.json` | manager | 0.5.1         | `string[]` de títulos de música na ordem de exibição.               |
| `profiles/<uuid>/song-book.json`    | manager | 0.5.1         | Cor por música (`#rrggbb`, paleta em §6.3) e notas de uma linha.    |
| `profiles/<uuid>/lyrics/<song>.lrc` | lyrics  | 0.5.1         | LRC com cabeçalhos opcionais `ar`/`ti`/`al`/`by`; UTF-8.            |
| `profiles/<uuid>/lyrics/<song>.txt` | lyrics  | 0.5.1         | Texto puro; uma linha por batida, o servidor atribui pseudo-tempo.  |
| `certs/<hostname>.pem` + `.key`     | server  | 0.5.1         | Certificado autoassinado por hostname de LAN detectado.             |
| `token`                             | server  | 0.5.1         | Token em texto puro usado para autenticação HTTP/WS.                |
| `ui-locale`                         | prefs   | 0.5.1         | `en` ou `pt-BR`; qualquer outro valor é rejeitado pelo painel.      |
| `auto-start`                        | prefs   | 0.5.1         | `1` ou `0`; liga/desliga o início automático no Live.               |
| `events.log`                        | log     | 0.5.1         | NDJSON, append-only, rotação a 10 MiB; redacta segredos (ver §2.5). |

O registro 1.0 carrega `schemaVersion: 2`. Perfis migrados do 0.x
chegam com `schemaVersion: 1` e são atualizados in-place na primeira
abertura. `schemaVersion: 3` é reservado para a próxima major e
atualmente rejeita o perfil com `future_schema`.

A fixture `tests/fixtures/storage/{0.5.1,0.6.1,0.7.0}/` carrega um
perfil mínimo anonimizado por versão passada, para manter a cobertura
do caminho de migração.

---

## 2. Protocolo WebSocket (v3)

O servidor HTTPS em `https://<host>:<port>/` faz upgrade para
WebSocket na mesma origem. O handshake exige que `Origin` / `Host`
seja loopback (`127.0.0.1`, `::1`) ou endereço de LAN local; qualquer
outro valor é rejeitado com HTTP 403 antes do upgrade. Após o upgrade,
todo frame é um frame JSON de texto.

### 2.1 Frames servidor → cliente

Todo frame do servidor carrega `type` e (para `state`) `stateVersion`,
para que um cliente que conectou tarde ou reconectou possa rejeitar um
frame fora de ordem.

| `type`              | Campos obrigatórios                                                    | Enviado quando                                                                 |
| ------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `state`             | `stateVersion`, `SetlistState` (§2.4)                                  | Conexão inicial (`sync_confirm` re-dispara) e em toda mudança de estado.       |
| `log`               | `level` (`debug`/`info`/`warn`/`error`), `scope`, `message`, `fields?` | Linha de log do servidor roteada ao console; redactada por §2.5.               |
| `pong`              | `ts`                                                                   | Resposta ao heartbeat.                                                         |
| `auth_success`      | `clientId`, `controller: true`                                         | `auth` manual sucedeu.                                                         |
| `auth_failure`      | `reason`                                                               | `auth` manual rejeitado; cliente pode tentar de novo até 3 vezes/minuto/IP.    |
| `command_ack`       | `commandId`, `status`                                                  | Servidor aceitou o comando de §2.2.                                            |
| `command_confirmed` | `commandId`, `status`, `commandType`, `details?`                       | Handler terminou; `status` é um de `confirmed`/`failed`/`expired`/`cancelled`. |
| `disconnect_notice` | `reason`                                                               | Fechamento forçado (backpressure, origem rejeitada, …).                        |

### 2.2 Frames cliente → servidor

O decoder é `src/server/client-message.ts`. Toda mensagem valida `type`
contra `^[a-z][a-z0-9_]{0,63}$`; qualquer outro valor retorna
`invalid_message`. IDs de comando precisam casar `^[A-Za-z0-9._:-]+$` e
são obrigatórios em todo comando.

| `type`           | Campos obrigatórios                   | Efeito                                                                                                                       |
| ---------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `handshake`      | `clientId`                            | Inicia a sincronização do Reliability Core; responde com `state` quando termina.                                             |
| `sync_confirm`   | `stateVersion`                        | Reenvia o `state` em cache se a versão bate; caso contrário, no-op.                                                          |
| `auth`           | `token`                               | Re-tenta autenticar; só sucede se `token === server.token` e o token do servidor é não vazio.                                |
| `play`           | `commandId`                           | Retoma o transporte na posição de descanso.                                                                                  |
| `stop`           | `commandId`                           | Para o transporte; desarma qualquer jump pendente.                                                                           |
| `toggle_play`    | `commandId`                           | Toca se parado, para se tocando.                                                                                             |
| `next`           | `commandId`                           | Cue-jump para o primeiro beat da próxima música (quantizado ou imediato conforme a quantização global).                      |
| `prev`           | `commandId`                           | Recua para a música anterior.                                                                                                |
| `jump`           | `commandId`, `locator`                | Cue-jump para um marker pelo nome (gramática de locators na §4).                                                             |
| `bpm`            | `commandId`, `bpm` (20–300)           | Define o tempo.                                                                                                              |
| `click`          | `commandId`, `enabled`                | Liga/desliga o metrônomo.                                                                                                    |
| `pre_roll`       | `commandId`, `enabled`                | Liga/desliga o pre-roll.                                                                                                     |
| `set_panic`      | `commandId`, `enabled`                | Entra/sai do modo panic (para o transporte, trava comandos não-safety).                                                      |
| `set_song_color` | `commandId`, `songTime`, `color`      | Pinta a música na posição; cor precisa estar em §6.3.                                                                        |
| `set_song_notes` | `commandId`, `songTime`, `notes`      | Define a nota de uma linha; `null` limpa.                                                                                    |
| `set_loop`       | `commandId`, `enabled`, `count?`      | Arma/desarma loop na música atual.                                                                                           |
| `reorder`        | `commandId`, `order`                  | Ordem de exibição custom; precisa conter toda música atual exatamente uma vez.                                               |
| `profile_*`      | `commandId`                           | Gestão de perfis (`profile_create`, `profile_select`, `profile_rename`, `profile_delete`, `profile_restore`); só controller. |
| `export_csv`     | `commandId`                           | Grava um CSV UTF-8-BOM do setlist ativo no caminho de exportação resolvido.                                                  |
| `edit_locator`   | `commandId`, `currentName`, `newName` | Renomeia o cue no Set (só controller).                                                                                       |

Tamanhos limitados aplicados pelo decoder: commandId ≤ 128 chars;
clientId ≤ 128; campos de perfil ≤ 80; títulos ≤ 255; corpo de letra
≤ 96 KiB; reorder ≤ 4096 músicas; campos de texto estruturado (notas,
título, cabeçalho de letra) rejeitam controles C0/C1.

### 2.3 Reliability Core

Cada comando é reconhecido duas vezes: `command_ack` (servidor aceitou o
comando no barramento) e `command_confirmed` (handler terminou). O
enum `status` em `command_confirmed` é
`created` → `sent` → `acknowledged` → `confirmed` (ou `failed`/`expired`/
`cancelled`). Um handler que lança `OperatorError` mantém a rejeição
dentro de `failed` com `reason` estável; um handler que lança qualquer
outra coisa settleia como `execution_failed` e o erro original vai para
`events.log`, nunca para o frame WS.

O servidor envia `state` com `stateVersion` monotônico. `sync_confirm`
com versão stale é no-op; o cliente deve enviar `handshake` para
recuperar.

### 2.4 Forma do SetlistState

Espelha `SetlistState` em [`src/types.ts`](../../src/types.ts). O
contrato 1.0 adiciona `protocolVersion: 3` (a versão de schema deste
frame, não dos perfis em disco), `preRollEnabled`, `durationBpm`,
`declaredTempo`, `songColors`, `songNotes`, `durationConfidence`,
`loopIteration`, `loopCount`, `currentLoopIteration`,
`clipTriggerQuantization`. O Reliability Core adiciona `stateVersion`,
`connection`, `transport`, `currentSongId`, `currentSectionId`,
`pendingCommands`, `mode` (`rehearsal` | `show`), `safety`.

### 2.5 Redação de logs

Logs do servidor e frames WS `log` redactam, por nome de campo ou
padrão de valor:

- Nomes de campo casando `/(?:token|password|secret|^key$|authToken|passwordHash|apiKey)/i`
  viram `[REDACTED]`.
- Caminhos absolutos Windows (`C:\…`), UNC (`\\…`), macOS (`/Users/…`)
  e Linux (`/home/…`) mantêm os últimos dois segmentos do caminho,
  normalizados.
- Valores `token=…` em query string viram `***`.

Isso é garantido por `tests/release-contracts.test.mjs`.

---

## 3. Integração OSC

O RC Setlist prefere o **RC Bridge** (fork do AbletonOSC distribuído
dentro da extensão e do kit) e faz fallback para um AbletonOSC padrão
quando nenhum bridge responde o probe.

| Camada                | Porta UDP | Comportamento                                                                                                          |
| --------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| RC Bridge             | 11020     | Responde `/live/rcbridge/version` em cada socket cliente; a porta escolhida é a porta efêmera de origem da requisição. |
| AbletonOSC (fallback) | 11000     | OSC padrão; respostas vão para a porta de origem.                                                                      |
| AbletonOSC (listen)   | 11001     | OSC padrão; cliente escuta aqui o estado não solicitado.                                                               |

O probe roda por 700 ms (RC Bridge responde em bem menos de 200 ms na
prática). A versão do RC Bridge é `/live/rcbridge/version` e responde
com string no formato `RC Bridge 1.0.0`.

Endereços OSC que o cliente escuta ou envia:

- `/live/song/get/tempo` e `/live/song/start_listen/tempo` — tempo atual.
- `/live/clip/get/cues` — lista de cues (`name`, `time`).
- `/live/song/get/current_song_time` — posição atual do playhead.
- `/live/song/get/is_playing` — estado do transporte.
- `/live/clip/get/name` — renomear cue.
- `/live/song/set/tempo` — define tempo (quando o sync do SDK não está disponível).
- `/live/clip/fire` — cue jump.

---

## 4. Gramática de locators

Um nome de cue no Live segue a gramática abaixo. O parser
([`src/core/locator-parser.ts`](../../src/core/locator-parser.ts))
aceita a forma exata; qualquer coisa fora da tabela ou quebra em
vários cues (separador `>`) ou é tratada como título puro.

### 4.1 Música vs seção

- `Título da música` — locator de música (só título).
- `> Seção` — seção da música vista por último.
- `Música > Seção` — seção de uma música explicitamente nomeada.
- `Música >` (com `>` no fim) — seção de automação pura da `Música`
  (sem título de exibição, mas as tags da seção disparam).

O `>` quebra fora de colchetes `[ ]`, então `[jump A > Chorus]` mantém
o `>` dentro da tag.

### 4.2 Tabela de tags

Todas as tags são case-insensitive (`[LOOP]` ≡ `[loop]`). Espaço dentro
da tag é colapsado.

| Tag                           | Valor       | Efeito                                                                                                                                                               |
| ----------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[stop]`                      | nenhum      | Para o transporte quando o cue é alcançado.                                                                                                                          |
| `[next]`                      | nenhum      | Recua para o primeiro beat da próxima música quando alcançado tarde.                                                                                                 |
| `[skip]`                      | nenhum      | Pula esta música no `next`.                                                                                                                                          |
| `[loop]`                      | nenhum      | Arma loop infinito no cue (libera no próximo `[loop]` / `[stop]` / `[next]`).                                                                                        |
| `[loop Nx]` / `[loop N]`      | inteiro ≥ 1 | Arma loop contado no cue; N iterações antes de liberar.                                                                                                              |
| `[bpm N]`                     | float       | Declara o tempo neste cue; durações usam este valor em vez do tempo corrente.                                                                                        |
| `[click]`                     | nenhum      | Liga o metrônomo quando alcançado.                                                                                                                                   |
| `[click off]` / `[click-off]` | nenhum      | Desliga o metrônomo quando alcançado.                                                                                                                                |
| `[hidden]`                    | nenhum      | Esconde este cue do setlist visível (fica em `hidden[]`).                                                                                                            |
| `[ignore]`                    | nenhum      | Mesmo efeito de `[hidden]`; forma preferida para cues novos.                                                                                                         |
| `[jump NOME]`                 | string      | Quando alcançado, faz handover para o marker chamado NOME. Resolução: seção da mesma música → música → qualquer seção, case-insensitive; tags são ignoradas no alvo. |
| `_pre-roll`                   | legado      | Tratado como `[hidden] + preRoll` para compatibilidade com 0.x.                                                                                                      |

Exemplos, todos válidos:

- `INTRO`
- `> VERSO`
- `Música A > Refrão [loop 4x]`
- `[bpm 120] > Refrão`
- `Música A [bpm 120]`
- `[jump A > Refrão]`
- `> [stop]` (automação pura sob a música anterior)
- `Música A [hidden]` (fica em `hidden[]`, não em `songs[]`)
- `Música A > Ponte [jump Verso]` (handover para a seção "Verso")

### 4.3 O que não está na gramática

- `[qualquer-outra-coisa]` — ignorada, com o literal `[qualquer-outra-coisa]`
  removido do título de exibição.
- Colchetes aninhados: `[a [b]]` — não suportado; tratado como texto.
- Espaço Unicode dentro de tags: não normalizado além de `trim()`.
- Comentários dentro de um cue: não suportados; o cue é uma linha só no Live.

---

## 5. Endpoints HTTP

URL base: `https://<host>:<port>/` (porta padrão `4444`, mas o servidor
agarra a primeira porta livre na faixa do hint `RC_SETLIST_HTTP_PORT`).
O token vai em `Authorization: Bearer <token>` ou em query string
`?token=<token>` (este último é o fluxo de pareamento por QR e é o
único lugar onde o token pode aparecer numa URL). Toda resposta carrega
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` e uma
CSP que proíbe scripts inline nas páginas de palco.

| Método | Caminho                  | Auth | Propósito                                                                                                                |
| ------ | ------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/`                      | não  | HTML de landing (redireciona para `/setlist`).                                                                           |
| GET    | `/setlist`               | não  | HTML do Stage Control.                                                                                                   |
| GET    | `/performance`           | não  | HTML do display de Performance.                                                                                          |
| GET    | `/panel`                 | não  | HTML do painel do Live (token injetado via `window.INITIAL_TOKEN`).                                                      |
| GET    | `/health`                | não  | `HEAD`/`GET` — retorna 200 sem corpo.                                                                                    |
| GET    | `/static/<caminho>`      | não  | Serve `static/`; `..`, encoded slashes e nomes Unicode são rejeitados.                                                   |
| GET    | `/exports/<arquivo>.csv` | sim  | Retorna um CSV gerado; nome precisa casar `[A-Za-z0-9_.-]+\.csv`.                                                        |
| GET    | `/audio/<arquivo>`       | sim  | Retorna um asset de áudio; allowlist por perfil.                                                                         |
| GET    | `/lyrics/<música>`       | sim  | Retorna a letra salva (`.lrc` ou `.txt`).                                                                                |
| GET    | `/state`                 | sim  | Retorna o `SetlistState` atual em JSON.                                                                                  |
| GET    | `/api/snapshot`          | sim  | Diagnóstico interno; desabilitado em produção.                                                                           |
| POST   | `/api/command`           | sim  | Aceita uma única mensagem cliente (`src/server/client-message.ts`); responde `command_ack` e depois `command_confirmed`. |

Caminhos `/api/*` exigem token de controller; `/health`, `/static/*` e
as páginas HTML não exigem. Qualquer caminho desconhecido retorna
`404 text/plain` sem vazar o header do servidor.

---

## 6. Auxiliares de compatibilidade

### 6.1 Versão com fonte única

`version` em `package.json` é a única fonte da verdade.
`scripts/sync-version.mjs`:

- `npm run version:check` (alias `node scripts/sync-version.mjs --check`)
  lê `package.json`, `manifest.json`, `docs/site-i18n.js` e os arquivos
  do release-template. Sai com código 1 e diff se qualquer superfície
  divergir.
- `node scripts/sync-version.mjs --write` reescreve toda superfície
  listada acima para casar com `package.json`. O pipeline de release
  chama `--check` e falha se houver drift não corrigido.

### 6.2 Migração 0.x → 1.0

`scripts/migrate-data.mjs` é o núcleo testável; o kit distribui
wrappers em PowerShell (Windows) e shell (macOS) ao redor dele.
Comportamento:

- Origem: `%LOCALAPPDATA%\Ableton\Extensions Data\ntworm.ableton-rc-setlist`
  (Windows) ou `~/Library/Application Support/Ableton/Extensions Data/ntworm.ableton-rc-setlist`
  (macOS). Os wrappers sondam os dois candidatos.
- Destino: a raiz 1.0 (ver §1). Criada se não existir.
- Copia `profiles/`, `project-setlists/`, `token`, `ui-locale`,
  `auto-start`, `certs/`. Nunca sobrescreve arquivo existente no destino.
- Idempotente: uma segunda execução com a mesma origem é no-op.

### 6.3 Paleta de cores de música

Dezesseis cores em duas linhas; o servidor rejeita qualquer coisa fora
da paleta para que um cliente hostil não pinte uma música em uma cor
reservada para estado. Definida uma vez em
`src/server/client-message.ts` e espelhada em
`static/setlist/marker-editor.js`; o teste
`tests/client-message.test.mjs` lê o arquivo do cliente e falha se os
dois divergirem.

---

## 7. Política de SemVer

`1.0.x` é a linha pública em
`https://github.com/ntworm/rc-setlist` a partir da data do release.
Correções de segurança são fornecidas apenas para o último `1.x.y`;
`1.x` mais antigos e a linha `0.x` não têm suporte. A próxima mudança
quebradora é `2.0.0`; `1.x` é apenas aditiva.

| Superfície                | Backwards-compatible em 1.x?                                             |
| ------------------------- | ------------------------------------------------------------------------ |
| Protocolo WebSocket       | Sim — só campos aditivos; clientes antigos ignoram campos desconhecidos. |
| Layout de perfil em disco | Sim — `schemaVersion: 2` é somente leitura aqui.                         |
| Endpoints HTTP            | Sim — aditivos; caminhos antigos mantêm a semântica.                     |
| Gramática de locators     | Sim — só tags aditivas; tags existentes mantêm o significado.            |
| Endereços OSC             | Sim — aditivos; o probe mantém o timeout de 700 ms.                      |

Qualquer coisa que precise de mudança quebradora fica para `2.0.0`. As
release notes de `1.0.0` estão em
[`NOTAS-DA-VERSAO-1.0.0.md`](./NOTAS-DA-VERSAO-1.0.0.md).

---

## 8. Como mudanças neste documento são testadas

Cada afirmação aqui é um teste de regressão em
[`tests/release-contracts.test.mjs`](../../tests/release-contracts.test.mjs):

1. **Migração em disco** — para cada versão passada em `tests/fixtures/storage/`,
   carrega via API pública do manager e assert perfis / ordem / cores /
   notas / letras chegam idênticos. Fixture corrompida não pode destruir
   o original.
2. **Snapshot de protocolo** — `getState()` sobre um setlist curado é
   comparado a `tests/fixtures/state/snapshot.json`; divergência =
   `task verify` falha.
3. **Gramática de locators** — a tabela de tags em §4.2 é lida pelo teste
   (ou duplicada como JSON) e cada linha passa pelo `parseLocator`.
4. **Versão do bridge** — a resposta `/live/rcbridge/version` é fixada
   em `1.0.0`; drift nas fixtures do bridge falha a suite.
5. **Segurança HTTP / WS** — `tests/http-security.test.mjs` e
   `tests/ws-auth.test.mjs` exercitam as allowlists de §5 e §2; o teste
   de release-contracts re-executa o subset security-crítico para
   prevenir drift silencioso.

Mudar um contrato aqui sem mudar o teste, ou vice-versa, quebra
`npm run ci:public` e `npm run version:check`. Ambos rodam em CI antes
de qualquer release tagged.
