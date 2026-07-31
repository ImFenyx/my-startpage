# 󰋜 Startpage — Catppuccin Mocha · TDAH-friendly

![CI](https://github.com/ImFenyx/my-startpage/actions/workflows/ci.yml/badge.svg)
![Bun](https://img.shields.io/badge/Bun-1.3-black?logo=bun)
![React](https://img.shields.io/badge/React-19-149eca?logo=react)
![Testes](https://img.shields.io/badge/testes-230-green)
![Licença](https://img.shields.io/badge/licen%C3%A7a-MIT-blue)

Painel inicial com relógio, Pomodoro, links rápidos, tarefas do Todoist,
wishlist com scraping e bloco de notas — construído com foco em **carga
cognitiva baixa**: um alvo por vez, feedback imediato, zero decisão
desnecessária.

```
┌────────────────────────┬──────────────────────────────┐
│  Relógio + Pomodoro    │                              │
├────────────────────────┤   CARROSSEL (3 slides)       │
│  Links Rápidos         │   1 Tarefas · 2 Wishlist     │
│  [academico][work][+]  │   3 Notas                    │
└────────────────────────┴──────────────────────────────┘
```

## Stack

| Camada    | Tecnologia                                                       |
| --------- | ---------------------------------------------------------------- |
| Front     | **React 19 + TypeScript + Vite + Tailwind v4**                    |
| Backend   | **Bun + Elysia** — scraping, proxy e sync                          |
| Banco     | **SQLite** via `bun:sqlite` (nativo, zero dependências)            |
| Fontes    | Inter (sans) + **JetBrainsMono Nerd Font / Symbols** para ícones  |
| Cores     | **Catppuccin Mocha**, accent **Mauve** `#cba6f7`                  |
| Persist.  | SQLite + `localStorage` (offline-first) + export/import JSON       |

## Rodando

```bash
bun install
bun run dev      # Vite :5173  +  Elysia :8787  (um processo, logs coloridos)
```

> Os testes **nunca** tocam em `data/startpage.sqlite`: o preload `test-setup.ts` (carregado via `bunfig.toml`) redireciona `DB_PATH` para um arquivo temporário e limpa órfãos de execuções anteriores. Isso existe porque testes de carga rodados contra o banco real deixaram registros sintéticos que causaram três bugs em uso.

Outros scripts:

```bash
bun run web        # só o front
bun run server     # só o scraper (hot-reload via --watch)
bun run build      # typecheck + build de produção em dist/
bun run preview    # serve o dist/
bun run typecheck  # tsc --noEmit
bun test           # testes (inclui regressão do foco no modal)
```

> Para usar como página inicial do navegador: `bun run build` e aponte para o
> `dist/index.html`, ou deixe o `bun run dev` rodando e use `http://localhost:5173`.
> O carrossel de Wishlist só faz scraping com o Elysia no ar.

---

## Decisões de UX para TDAH

- **Um foco visual por vez.** Só um slide da direita fica visível; nada de feed infinito competindo por atenção.
- **Relógio gigante** (`clamp(3.1rem, 7.2vw, 6.2rem)`) — saber a hora não pode custar esforço, é o principal antídoto contra *time blindness*.
- **Pomodoro por timestamp**, não por `setInterval` acumulado: o navegador estrangula timers em abas de fundo; aqui o tempo restante é sempre `deadline - Date.now()`, então trocar de aba não desregula o ciclo.
- **Progresso ambiente**: o card do Pomodoro se preenche com a cor da fase e o `document.title` vira o cronômetro — você vê o tempo passar mesmo em outra aba.
- **Feedback de salvamento explícito** ("salvando…" → "salvo") nas notas: elimina a ansiedade de "será que perdi?".
- **Cores com significado fixo**: mauve = foco, verde = pausa curta/concluído, sky = pausa longa, vermelho/pêssego/azul = prioridade alta/média/baixa.
- **Atalhos de teclado** para tudo que é frequente, evitando a "viagem do mouse" que quebra o fluxo.
- **5 links por página** (como no wireframe): respeita o limite de memória de trabalho em vez de despejar 30 ícones.
- **Estados vazios acolhedores** ("Nada para hoje. Respira. 🌿") em vez de vazio culpado.
- **`prefers-reduced-motion`** respeitado; animações ≤ 240ms, nunca decorativas em loop.
- **Foco visível** (`:focus-visible` mauve) em 100% dos controles.

## Atalhos

| Tecla        | Ação                                        |
| ------------ | ------------------------------------------- |
| `Espaço`     | Play / pause do Pomodoro                    |
| `R` / `S`    | Reiniciar / pular fase                      |
| `←` `→`      | Navegar entre os slides da direita          |
| `1` `2` `3`  | Tarefas / Wishlist / Notas                  |
| `Ctrl+E`     | Alternar preview markdown nas notas         |
| `Tab`        | Indentar dentro do editor de notas          |
| `Esc`        | Fechar qualquer modal                       |

## Funcionalidades

### Coluna esquerda

**Relógio** — hora em tempo real sincronizada no segundo cheio (sem "pulos"), saudação contextual e data completa em pt-BR.

**Pomodoro** — mostrador, Play/Pause, Reset, Skip e ⚙️ com modal: duração de foco / pausa curta / pausa longa, ciclos até a pausa longa, auto-start, bipe (WebAudio, sem arquivo externo) e notificação do navegador. Contador de ciclos e barra de progresso embutida no card.

**Links Rápidos** — carrossel de **5 por página** com setas e dots. Tabs de categoria (`academico`, `work`, `pessoal`) + botão `+` para criar novas. Duplo-clique numa tab exclui a categoria. O botão ⚙️ do header abre o gerenciador (reordenar ↑↓, editar, excluir).
Cada link tem um **ícone Nerd Font** escolhido por: nome no picker (`github`), **hex** (`f09b`, `0xf09b`) ou detecção automática pelo domínio — `guessIcon()` reconhece ~50 sites.

### Coluna direita (carrossel)

**1 · Tarefas** — integração real com a **Unified API v1 do Todoist**, com **2 visualizações** nas abas do topo:

| Aba | O que mostra | Endpoints |
| --- | --- | --- |
| **Inbox** | Inbox completo **agrupado pelas suas seções** | `/projects` + `/sections` + `/tasks?project_id=` |
| **Tudo** | todas as tarefas ativas, agrupadas por projeto | `/projects` + `/tasks` |

As **seções do Inbox** (Pessoal, Acadêmico, Trabalho, Eventos…) viram grupos colapsáveis, na ordem definida no Todoist e incluindo as vazias — igual ao app oficial. Tarefas sem seção aparecem em "Sem seção", no topo. O colapso persiste no `localStorage`.

**CRUD completo.** Cada linha tem, no hover, os botões **editar** (`󰏫`), **excluir** (`󰩹`) e **abrir no Todoist** (`󰏌`):

- **Editar** abre um modal com conteúdo, prioridade (p1–p4 com cores), data em linguagem natural (`amanhã 9h`, `próxima segunda`, `2026-08-22` — vazio remove) e um seletor de **projeto / seção** que move a tarefa. Duplo-clique no texto também abre. `Enter` salva, `Shift+Enter` quebra linha.
- **Excluir** pede confirmação num modal que mostra o texto da tarefa e avisa se a exclusão é no Todoist ou só local. A remoção é otimista e reverte se a API recusar.

Cada tarefa mostra data (vermelha se atrasada) e até duas labels `@`. Marcar a checkbox fecha a tarefa no Todoist; o input usa **Quick Add**, então aceita linguagem natural (`Pagar boleto amanhã 9h #Casa p1`) e re-sincroniza para a tarefa cair na seção certa. Barra de progresso, cores por prioridade, re-sync automático a cada 5 min e cache local. Sem token, vira lista local funcional.

Endpoints de escrita usados: `POST /tasks/{id}` (editar), `POST /tasks/{id}/move` (mover), `DELETE /tasks/{id}` (excluir), `POST /tasks/{id}/close|reopen`.

O botão **Testar** valida o token em `/api/v1/user` e mostra o nome da conta antes de salvar. Os erros são traduzidos: 401 explica que o token está inválido, 429 pede para aguardar, e assim por diante.

> ⚠️ **A REST API v2 (`/rest/v2/*`) foi desligada pelo Todoist** — hoje ela devolve `410 Gone`. Toda integração precisa usar `https://api.todoist.com/api/v1/`, cujas respostas são paginadas no formato `{ results, next_cursor }`.

O token vai em `localStorage` (`startpage:todoist_token`) e a chamada é client-side — use só em máquina pessoal. A API manda CORS refletindo o `Origin`, então a chamada direta funciona; se um adblock ou rede corporativa bloquear `api.todoist.com`, o front repete a requisição pelo **proxy `/api/todoist/*` do Elysia** automaticamente.

**2 · Wishlist & Metas** — cards com imagem, preço, categoria (Tech/Roupa/Deco/Livro/Meta/Outro), prioridade e soma total dos itens abertos. O botão **Buscar** chama o scraper Elysia, que extrai:

1. `schema.org/Product` em JSON-LD (percorrendo `@graph` recursivamente), **respeitando `availability`** — ofertas `OutOfStock` são puladas;
2. `og:image`, `og:title`, `product:price:amount`, `itemprop="price"`;
3. seletores específicos de Amazon (`.a-price .a-offscreen`), Mercado Livre (`.andes-money-amount__fraction`) e AliExpress (`.product-price-value`);
4. heurística em `[class*=price]` como último recurso — só com símbolo de moeda e texto curto.

**Parser de preço.** Os separadores são resolvidos por regra explícita, não por `parseFloat`: `R$ 8.499,00` → `8499.00`, `$1,299.90` → `1299.90` e — o caso que quebrava — `R$ 8.499` → `8499.00` (ponto seguido de 3 dígitos é milhar, não decimal). Em textos com ruído (`"R$ 8.499,00 em 12x de R$ 708,25"`) pega-se o **maior** valor, que é sempre o preço à vista e nunca a parcela.

**Imagem.** `pickImage()` monta uma lista de candidatas (JSON-LD → `og:image` → `itemprop` → seletores de loja → maiores `<img>`) e descarta logos, sprites, placeholders, data-URIs e miniaturas com dimensão embutida na URL. Era daí que vinha a logo do Mercado Livre e a imagem branca da Amazon.

**Páginas anti-bot.** Lojas como Mercado Livre e Amazon respondem **200 OK** servindo uma tela de verificação cujo `<title>` é só "Mercado Libre". `detectBlock()` reconhece esses casos (marcadores de `suspicious-traffic`, CAPTCHA, títulos genéricos, erros 4xx/5xx no título) e devolve `blocked: true` + `warnings[]`. A UI mostra o aviso em amarelo e **não sobrescreve** nome e imagem que você já tenha preenchido.

> ⚠️ **Limite honesto do scraping:** Mercado Livre, Amazon, AliExpress e Shopee usam proteção anti-bot (Akamai/Cloudflare/PerimeterX) que bloqueia qualquer requisição HTTP simples, por mais bem formados que sejam os cabeçalhos. Isso **não é contornável** com `fetch` — exigiria navegador headless (Playwright) com IP residencial, ou as APIs oficiais de afiliado (todas com OAuth). O scraper funciona bem em lojas menores e sites com JSON-LD; para os grandes marketplaces, o app agora avisa claramente e você preenche preço e imagem à mão (upload ou URL).

**Vigia de preços (automático).** Com o backend no ar, os preços dos itens abertos que têm link são re-verificados sozinhos **2× por semana** (a cada 84 h; `WISHLIST_REFRESH_HOURS` muda o ciclo, `0` desliga). O vigia (`server/price-watch.ts`) lê a cópia da wishlist no SQLite de sync, raspa um item por vez com pausa entre lojas e grava o preço novo + carimbo `priceUpdatedAt` — o front puxa na reconciliação periódica (5 min) e exibe "há X d" ao lado do preço. Regras de segurança da rodada: fora de estoque **mantém** o último preço; loja bloqueada/sem preço vira `failed` no relatório (visível em `/api/health`); se TUDO falhar, a próxima tentativa sai em 8 h em vez de esperar o ciclo; e se você editar a lista no meio de uma rodada, os preços são mesclados por id na versão mais nova — nada é sobrescrito. O botão **Preços** no cabeçalho da wishlist (`POST /api/wishlist/refresh`) dispara uma rodada na hora.

**3 · Bloco de Notas** — textarea com **markdown** (marked + DOMPurify), preview `Ctrl+E`, autosave debounced com indicador de status, contador de palavras, export `.md` e **blocos salvos anteriormente** na régua inferior (título + data, duplo-clique exclui), exatamente como no wireframe.

## Acessibilidade

Auditoria de contraste feita com cálculo WCAG 2.1 sobre a paleta real:

| Cor | Sobre `base` | Sobre `surface0` |
| --- | --- | --- |
| `overlay0` | 3.36 — reprova | **2.57 — reprova tudo** |
| `overlay1` | 4.44 — reprova | 3.40 — reprova |
| `subtext0` | 7.37 — passa AA | 5.65 — passa AA |

Havia **16 blocos de texto pequeno** (0.62–0.68 rem) usando `overlay0`/`overlay1`: datas de tarefas, contadores e legendas. Abaixo de 0.75 rem o WCAG classifica como texto normal, exigindo 4.5:1 — nenhum passava. Todos migraram para `subtext0`, a única cor da paleta que aprova em todos os fundos usados. Os `opacity-35` do rodapé, que anulavam o ganho, subiram para `opacity-60`.

Também: o Pomodoro ganhou `aria-live` (a troca foco→pausa era silenciosa para leitores de tela), o fallback de erro usa `role="alert"` e há `<noscript>` explicando a dependência de JavaScript.

O teste `contrast.test.ts` recalcula os contrastes e falha se algum texto pequeno voltar a usar cor reprovada.

## Resiliência

**Error boundaries por bloco.** Antes não havia nenhum: uma exceção no slide de Notas desmontava a árvore inteira e sobrava tela branca — relógio e Pomodoro junto. Agora cada bloco (Relógio, Pomodoro, Links, Carrossel e cada slide) é isolado. O fallback mostra o erro, oferece "Tentar de novo" sem perder dados e, em último caso, limpar só os dados daquele bloco.

**Funciona offline.** Service worker com estratégias por tipo de recurso:

| Recurso | Estratégia |
| --- | --- |
| Navegação | network-first com fallback para o shell em cache |
| JS/CSS/fontes | cache-first (têm hash no nome) |
| `/api/img` | stale-while-revalidate, teto de 120 imagens |
| `/api/*` | network-only — dados nunca saem de cache |

Instalável como PWA (manifest + ícones 192/512/maskable em Catppuccin Mocha). O rodapé mostra um selo `offline` quando a rede cai e um botão `atualizar` quando uma versão nova é baixada.

## Persistência

Três camadas, nesta ordem:

1. **localStorage** — leitura síncrona e instantânea; nunca perde a última tecla num fechamento abrupto.
2. **SQLite** (`bun:sqlite`, nativo) — fonte de verdade compartilhada, em `data/startpage.sqlite`.
3. **Backup JSON** — botão no rodapé, para levar tudo para outra máquina.

O sync é **offline-first**: se o backend estiver fora, o app funciona só com localStorage e volta a sincronizar sozinho quando o servidor responder. O indicador no canto inferior esquerdo mostra o estado (`󰅧` sincronizado, `󰑐` sincronizando, `󰀪` erro, `󰆓` só local).

**Conflitos** usam last-write-wins por timestamp, resolvido no servidor: uma gravação mais antiga nunca sobrescreve uma mais recente — uma aba parada há horas não apaga o que você acabou de escrever em outra máquina. Cada chave guarda as **20 últimas revisões** (`GET /api/sync/:key/revisions`).

**Relógio adiantado.** Um `updatedAt` no futuro é veneno para o last-write-wins: a chave trava (nenhuma gravação real consegue superá-la) e ainda sobrescreve o cliente a cada pull. Carimbos acima de *agora + 5 min* são fixados no horário do servidor, nos dois lados, e `repairFutureStamps()` conserta no boot linhas já gravadas assim. Diagnóstico em `GET /api/sync/_debug`, que lista cada chave com idade e sinaliza `inFuture`.

**Chaves locais.** Nem tudo sincroniza. `todoist_token` é segredo; `tasks:groups` é cache das tarefas do Todoist (rederivado a cada 5 min) e `tasks:lastsync` é um carimbo por máquina — os três ficam em `LOCAL_ONLY` e nunca trafegam.

As allowlists de cliente (`sync.ts`), servidor (`db.ts`) e importação (`storage.ts`) precisam concordar: o teste `sync-keys.test.ts` cruza as três com as chaves realmente usadas em `usePersistentState` e falha se alguma ficar órfã. Uma chave órfã rendia `400 Bad Request` a cada autosave.

O `POST /api/sync` é **tolerante**: chaves desconhecidas são ignoradas e listadas em `ignored`, em vez de derrubar o lote. Antes, uma única chave inválida fazia o autosave inteiro responder 400 e as alterações válidas do mesmo lote se perdiam — bastava cliente e servidor estarem em versões diferentes para tudo parar.

## Segurança

Duas rodadas de auditoria, sempre com exploits executados contra o servidor no ar — nada de achado teórico.

### Primeira rodada

| Problema | Impacto | Correção |
| --- | --- | --- |
| **SSRF** em `/api/scrape` e `/api/img` | O backend buscava `127.0.0.1`, `192.168.x.x` e `169.254.169.254` (metadata de cloud) e devolvia o conteúdo | `checkPublicUrl()` resolve o DNS e rejeita IPs privados, loopback, link-local, CGNAT, hostnames internos, esquemas não-HTTP e credenciais na URL |
| **CORS aberto** | `cors()` sem opções ecoa qualquer `Origin` — qualquer aba podia ler as respostas acima | allowlist explícita |
| **Sem rate limiting** | Um laço de scrapes travava a máquina | janela deslizante: 30/min scrape, 600/min sync |

### Segunda rodada

| Problema | Impacto | Correção |
| --- | --- | --- |
| **SSRF via redirect** | `redirect: 'follow'` valida só a URL inicial: uma página pública responde `302` para `169.254.169.254` e o filtro é contornado | `safeFetch()` segue os saltos manualmente, revalidando **cada um** (máx. 5) |
| **XSS por esquema de URL** | O React 19 bloqueia `javascript:`, mas **não** `data:text/html`, `vbscript:` nem `blob:` — confirmado com `renderToStaticMarkup` | `safeHref()`/`safeImageSrc()` com allowlist, aplicados a todo `href` e `src` |
| **SVG servido pelo proxy** | SVG é XML e executa `<script>` — vindo de `/api/img` rodaria no **nosso** domínio | só formatos rasterizados + `CSP: sandbox` na resposta |
| **Markdown com falha aberta** | Se o DOMPurify não estivesse operante, o HTML ia cru para `dangerouslySetInnerHTML` | fail-safe que escapa o texto + allowlist de tags |
| **Sem CSP** | Nenhuma defesa em profundidade | CSP restritiva no `index.html` |

### Terceira rodada

| Problema | Impacto | Correção |
| --- | --- | --- |
| **Backup injetava credencial** | `importAll` gravava **qualquer** chave: um arquivo JSON de terceiro podia definir `todoist_token` e sequestrar a conta | allowlist de chaves importáveis + recusa de `__proto__`/`constructor` + teto de 1 MB por valor e 10 MB por arquivo |
| **Backup vazava o token** | `exportAll` incluía `todoist_token` em texto plano — e o backup existe para ser copiado ou enviado a alguém | segredos e metadados internos ficam fora do arquivo |
| **WAL crescia sem limite** | Medido: 300 gravações do autosave inflavam o `-wal` para **4,1 MB** com apenas 24 KB de banco — vazamento de disco contínuo | revisão só quando o conteúdo muda de fato, `UPDATE` mínimo do carimbo, checkpoint a cada 20 escritas e `journal_size_limit`. Resultado: **132 KB** (31× menor) |
| **Race condition no sync** | O retry após falha de rede sobrescrevia valores editados **durante** o envio | guarda `inFlight` e devolução à fila só quando a chave não tem valor mais novo |
| **Cache sem expurgo** | Entradas expiradas ficavam na memória até o limite de 300 | LRU real: reinserção ao usar e remoção no vencimento |

Complementos: allowlist de chaves no sync, teto de 1 MB por valor, 5 MB no corpo de respostas externas, normalização de caminho no proxy do Todoist, cabeçalhos `nosniff`/`DENY`/`no-referrer`, `rel="noopener noreferrer"` em todo link externo e stack traces que não vazam. `bun audit`: **0 vulnerabilidades**.

> O banco fica em `data/` e está no `.gitignore` — contém suas notas e wishlist. O token do Todoist nunca sai da máquina: está em `LOCAL_ONLY` no cliente e fora da allowlist do servidor.

## Performance

| Métrica | Antes | Depois |
| --- | --- | --- |
| Fonte de ícones | 847 KB | **13 KB** (subset dos 117 glyphs usados) |
| Fontes em `dist/` | 960 KB | **126 KB** |
| JS inicial (gzip) | 104 KB | **76 KB** |
| Markdown (`marked`+`DOMPurify`) | bundle inicial | sob demanda |
| Listeners recriados/s (timer ativo) | ~5 | **0** |
| Renders/s do Pomodoro | 4 | **1** |

**Bundle.** Subset da Nerd Font com `fonttools` (98,4% menor — o teste de ícones valida contra o subset, então remover um glyph usado quebra o build). React em chunk próprio para cache longo; Wishlist e Notas com `React.lazy`.

**Runtime.** Dois `useEffect` de atalho de teclado estavam **sem array de dependências** — com o timer rodando, o listener era removido e readicionado ~4×/s. Agora o handler mora numa ref e o listener é registrado uma única vez. O tick do Pomodoro roda a 250 ms para não "pular", mas só chama `setState` quando o segundo exibido muda de fato. `Clock`, `QuickLinks`, `RightCarousel` e `Icon` estão em `memo`, então o tick do relógio não reconcilia a árvore inteira.

**Rede.** `/api/sync` responde com **ETag**: no boot o cliente manda `If-None-Match` e recebe `304` quando nada mudou, em vez do payload completo. Imagens do proxy vão com `immutable`, e o scraper mantém cache LRU de 300 entradas.

**Banco.** Medido: 0,15 ms por escrita, 0,1 ms por leitura, 50 escritas em transação em 6 ms. WAL com checkpoint oportunista a cada 20 escritas e manutenção (`TRUNCATE` + `optimize`) a cada 10 min — sem isso o arquivo `-wal` crescia indefinidamente.

> O checkpoint é **adiado quando há transação aberta**. O SQLite recusa `wal_checkpoint` durante uma transação de escrita e responde `SQLITE_LOCKED: database table is locked`. Como `setMany()` (usado pelo autosave em lote) chama `set()` num laço dentro de uma transação, o checkpoint disparava exatamente ali e derrubava todo `POST /api/sync`.

**Robustez.** Sem ReDoS no parser de preço (100 mil caracteres processados em 0,8 ms) e corpos de 50 MB rejeitados em 0,16 s, antes de qualquer parse pesado.

## Testes

**230 testes** em 22 arquivos, executados com `bun test`. Três execuções seguidas produzem resultado idêntico (sem flakiness).

| Camada | Cobertura |
| --- | --- |
| **Comportamental** | lógica executada de verdade: parser de preço, SQLite, sincronização, cliente Todoist, saneamento de URL |
| **Integração (E2E)** | servidor Elysia real via HTTP: roteamento, CORS, SSRF, ciclo completo de sync, concorrência |
| **Estático** | invariantes que um lint não pega: coerência das allowlists, contraste WCAG, glyphs existentes, ausência de padrões perigosos |
| **Fuzzing** | ~190 asserções contra entrada hostil (null, NaN, strings de 50 KB, esquemas exóticos) |

Cada bug encontrado em uso virou teste de regressão, e todos foram validados reintroduzindo a falha para confirmar que o teste realmente a detecta.

Os testes **nunca** tocam em `data/startpage.sqlite`: o preload `test-setup.ts` redireciona `DB_PATH` para um arquivo temporário e varre órfãos de execuções anteriores.

```bash
bun test                      # tudo
bun test server/e2e.test.ts   # só integração
bun test src/lib/fuzz.test.ts # só fuzzing
```

## Estrutura

```
startpage/
├── bunfig.toml              # preload dos testes
├── test-setup.ts            # isola DB_PATH do banco real
├── server/
│   ├── index.ts             # Elysia: health · scrape · img · todoist/* · sync/*
│   ├── db.ts                # SQLite (bun:sqlite) — kv versionado + revisões
│   ├── security.ts          # anti-SSRF, CORS, rate limit, cabeçalhos
│   └── scrape-lib.ts        # parser de preço, imagem, detecção de bloqueio
├── scripts/dev.ts           # sobe Vite + Elysia num processo só
├── public/
│   ├── sw.js                # service worker (offline)
│   ├── manifest.webmanifest # PWA instalável
│   ├── icon-*.png           # ícones 192/512/maskable
│   └── fonts/               # Inter, JetBrains Mono, Symbols Nerd Font (subset)
└── src/
    ├── App.tsx              # grid 2 colunas + modal de atalhos/backup
    ├── index.css            # paleta Mocha, @font-face, componentes utilitários
    ├── components/
    │   ├── Icon.tsx         # renderiza glyph Nerd Font (nome | hex | char)
    │   ├── ErrorBoundary.tsx # isola falhas por bloco
    │   ├── Modal.tsx        # modal acessível com focus trap
    │   ├── Clock.tsx  Pomodoro.tsx  QuickLinks.tsx  RightCarousel.tsx
    │   └── slides/          # TasksSlide · WishlistSlide · NotesSlide
    └── lib/
        ├── icons.ts         # mapa de codepoints + guessIcon() por domínio
        ├── safe-url.ts      # allowlist de esquema para href/src
        ├── pwa.ts           # registro do SW + conectividade
        ├── storage.ts  todoist.ts  types.ts  defaults.ts
```

## Notas técnicas

- **Nenhum SVG** na interface: 100% dos ícones são glyphs Nerd Font, carregados de `SymbolsNerdFont-Regular.woff2` self-hosted com `unicode-range` restrito à PUA — o texto normal continua em Inter e só os codepoints de ícone caem no fallback.
- **Fit to screen**: `h-screen` + `grid-rows-[auto_1fr]` + `min-h-0` em toda a cadeia, com scroll interno apenas nas listas. Testado em 1366×768 e 1280×720. Abaixo de `lg` (1024px) o layout empilha em uma coluna.
- Paleta declarada em `@theme` do Tailwind v4 → `bg-mauve`, `text-subtext0`, `border-surface0` etc. saem direto dos tokens oficiais do Catppuccin Mocha.

## Publicar no GitHub

```bash
./publicar.sh SEU-USUARIO [nome-do-repo]
```

O script cria o histórico de commits (se ainda não existir), confere que
nenhum banco ou `.env` está prestes a ser enviado, pergunta seu nome e e-mail
para a autoria e publica. Com o [GitHub CLI](https://cli.github.com)
autenticado ele cria o repositório sozinho; caso contrário, mostra os dois
passos manuais.

> O diretório `.git` não sobrevive à exportação do workspace — o download traz
> os arquivos, mas não o histórico. Por isso o `publicar.sh` chama o
> `git-setup.sh`, que reconstrói os 13 commits temáticos a partir dos arquivos.

Para só montar o histórico, sem publicar: `./git-setup.sh "Seu Nome" "seu@email.com"`.

## Licença

MIT — veja [LICENSE](LICENSE).

As fontes têm licenças próprias: [Inter](https://github.com/rsms/inter) (OFL),
[JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) (OFL) e
[Nerd Fonts](https://github.com/ryanoasis/nerd-fonts) (MIT). A paleta
[Catppuccin](https://github.com/catppuccin/catppuccin) é MIT.
