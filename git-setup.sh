#!/usr/bin/env bash
#
# Cria o repositório git com o histórico de commits do projeto.
#
#   ./git-setup.sh ["Seu Nome" "seu@email.com"]
#
# Roda sozinho quando você usa ./publicar.sh — só precisa chamar direto se
# quiser montar o histórico sem publicar.
#
# Existe porque o diretório .git não é preservado ao exportar o workspace:
# o download traz os arquivos, mas não o histórico.
#
set -euo pipefail
cd "$(dirname "$0")"

NOME="${1:-}"
EMAIL="${2:-}"

if [[ -d .git ]]; then
  echo "▸ Repositório já existe ($(git rev-list --count HEAD 2>/dev/null || echo 0) commits). Nada a fazer."
  exit 0
fi

echo "▸ Criando o repositório e o histórico…"
git init -q
git config commit.gpgsign false

# autoria: usa a global se existir, senão a informada, senão um padrão neutro
if [[ -n "$NOME" ]]; then git config user.name "$NOME"; fi
if [[ -n "$EMAIL" ]]; then git config user.email "$EMAIL"; fi
git config user.name  >/dev/null 2>&1 || git config user.name "Startpage Dev"
git config user.email >/dev/null 2>&1 || git config user.email "dev@localhost"

commit() { git commit -q -m "$1" && printf '  ✓ %s\n' "${1%%$'\n'*}"; }

# ── 1. fundação ──────────────────────────────────────────────────
git add .gitignore package.json bun.lock tsconfig.json tsconfig.server.json \
        vite.config.ts bunfig.toml index.html 2>/dev/null
commit "chore: estrutura do projeto com Bun, Vite, React e TypeScript

Configuração base: Vite com plugin React e Tailwind v4, proxy /api para o
backend Elysia, dois tsconfig (app e servidor) e bunfig apontando o preload
de testes."

# ── 2. design system ─────────────────────────────────────────────
git add src/index.css public/fonts/
commit "feat(ui): paleta Catppuccin Mocha e fontes self-hosted

Tokens oficiais do Mocha no @theme do Tailwind, com mauve como cor de
destaque. Inter para texto e Symbols Nerd Font para ícones, servidas
localmente com unicode-range restrito à PUA — o texto normal nunca cai no
fallback de ícones.

A fonte de símbolos é um subset com apenas os 117 glyphs usados: 847 KB
para 13 KB."

# ── 3. ícones ────────────────────────────────────────────────────
git add src/lib/icons.ts src/components/Icon.tsx
commit "feat(ui): sistema de ícones Nerd Font sem SVG

Mapa de codepoints com resolução por nome, hex ou caractere cru, mais
guessIcon() que deduz o ícone a partir do domínio (~50 sites conhecidos).
Nenhum SVG na interface, conforme o requisito."

# ── 4. persistência local ────────────────────────────────────────
git add src/lib/types.ts src/lib/storage.ts src/lib/defaults.ts
commit "feat: persistência em localStorage com hook usePersistentState

Estado persistido por chave, sincronia entre abas via evento storage e
export/import para backup. Segredos ficam numa lista LOCAL_ONLY e nunca
saem da máquina."

# ── 5. relógio e pomodoro ────────────────────────────────────────
git add src/components/Modal.tsx src/components/Clock.tsx src/components/Pomodoro.tsx
commit "feat: relógio em tempo real e Pomodoro configurável

Relógio sincronizado no segundo cheio, sem pulos. Pomodoro com foco, pausa
curta e longa, ciclos configuráveis, alerta sonoro via WebAudio e atalhos
de teclado.

O timer é baseado em timestamp (deadline - now), não em setInterval
acumulado: navegadores estrangulam timers em abas de fundo e o ciclo
desregularia."

# ── 6. links rápidos ─────────────────────────────────────────────
git add src/components/QuickLinks.tsx
commit "feat: links rápidos em carrossel com categorias

Cinco atalhos por página com navegação por setas, categorias editáveis e
seletor de ícones. Ao colar uma URL o ícone é deduzido do domínio."

# ── 7. scraper ───────────────────────────────────────────────────
git add server/scrape-lib.ts server/scraper.test.ts
commit "feat(server): scraper de produtos com parser de preço robusto

Extrai título, imagem e preço de páginas de produto, na ordem: JSON-LD
schema.org/Product (respeitando availability), metatags og:/product: e
seletores específicos de Amazon, Mercado Livre e AliExpress.

O parser de preço decide os separadores por regra explícita em vez de
parseFloat: 'R\$ 8.499,00' vira 8499.00 e — o caso que quebrava —
'R\$ 8.499' vira 8499.00, não 8.50. Em texto com ruído ('12x de R\$ 708,25')
usa o maior valor, que é sempre o preço à vista.

pickImage() descarta logos, sprites e placeholders; detectBlock() reconhece
páginas anti-bot que respondem 200 fingindo ser o produto."

# ── 8. segurança ─────────────────────────────────────────────────
git add server/security.ts server/security.test.ts server/redirect.test.ts
commit "feat(server): camada de segurança contra SSRF, CORS aberto e DoS

Auditoria com exploits executados contra o servidor no ar encontrou três
falhas exploráveis:

- SSRF: /api/scrape e /api/img buscavam 127.0.0.1, 192.168.x.x e
  169.254.169.254 (metadata de cloud) e devolviam o conteúdo
- CORS: cors() sem opções ecoa qualquer Origin, então qualquer aba aberta
  no navegador podia LER essas respostas
- Sem rate limiting: um laço de scrapes travava a máquina

checkPublicUrl() resolve o DNS e rejeita IPs privados; safeFetch() segue
redirects manualmente revalidando cada salto (redirect: 'follow' validava
só a URL inicial)."

# ── 9. banco ─────────────────────────────────────────────────────
git add server/db.ts server/db.test.ts
commit "feat(server): persistência em SQLite com bun:sqlite

Key-value versionado por timestamp, last-write-wins resolvido no servidor:
gravação mais antiga nunca sobrescreve a recente. Histórico de 20 revisões
por chave.

Carimbos no futuro são normalizados — um updatedAt adiantado travava a
chave (nada mais conseguia superá-la) e ainda sobrescrevia o cliente a
cada sincronização.

O checkpoint do WAL é adiado quando há transação aberta: o SQLite recusa
wal_checkpoint durante escrita e responde SQLITE_LOCKED, o que derrubava
todo POST em lote."

# ── 10. servidor e sync ──────────────────────────────────────────
git add server/index.ts server/e2e.test.ts scripts/dev.ts \
        src/lib/sync.ts src/lib/sync-keys.test.ts src/lib/sync-logic.test.ts
commit "feat: servidor Elysia e sincronização offline-first

Rotas: /api/health, /api/scrape, /api/img, /api/todoist/* (proxy) e
/api/sync/* (persistência). ETag no pull evita transferir o payload quando
nada mudou.

O cliente é offline-first: localStorage é a leitura instantânea e o SQLite
é a verdade compartilhada. Backend fora do ar não impede o uso; o sync
retoma sozinho.

POST /api/sync é tolerante: chave desconhecida é ignorada em vez de
derrubar o lote. Antes, uma única chave fora da allowlist fazia o autosave
inteiro responder 400 e as alterações válidas se perdiam."

# ── 11. slides ───────────────────────────────────────────────────
git add src/components/slides/ src/lib/todoist.ts src/lib/todoist-logic.test.ts \
        src/components/RightCarousel.tsx
commit "feat: carrossel com Tarefas, Wishlist e Notas

Tarefas: integração com a Unified API v1 do Todoist (a REST v2 foi
desligada e responde 410). Visões Inbox e Tudo agrupadas pelas seções
reais, CRUD completo e Quick Add em linguagem natural.

Wishlist: cards com imagem e preço obtidos pelo scraper, com aviso claro
quando a loja bloqueia o acesso automatizado.

Notas: markdown com marked + DOMPurify, autosave e blocos anteriores.

Listas vindas do storage passam por normalização — uma nota sem body ou
uma tarefa corrompida derrubavam o slide inteiro."

# ── 12. PWA, resiliência, acessibilidade ─────────────────────────
git add src/App.tsx src/main.tsx src/components/ErrorBoundary.tsx \
        src/components/ErrorBoundary.test.tsx src/components/Modal.test.tsx \
        src/lib/pwa.ts src/lib/pwa.test.ts src/lib/safe-url.ts src/lib/safe-url.test.ts \
        src/lib/fuzz.test.ts src/lib/backup.test.ts src/lib/classes.test.ts \
        src/lib/contrast.test.ts src/lib/icons.test.ts src/lib/test-isolation.test.ts \
        test-setup.ts public/sw.js public/manifest.webmanifest public/*.png
commit "feat: PWA offline, error boundaries, acessibilidade e testes

Resiliência: cada bloco tem error boundary própria — antes, uma exceção
no slide de Notas apagava a tela inteira, relógio e Pomodoro junto.

Offline: service worker com estratégia por recurso e manifest instalável.
A página inicial não pode depender de rede para abrir.

Acessibilidade: 16 blocos de texto pequeno usavam cores abaixo do contraste
WCAG AA (overlay0 sobre surface0 dava 2.57:1). Pomodoro ganhou aria-live.

Segurança do cliente: safeHref/safeImageSrc com allowlist de esquema. O
React 19 bloqueia javascript:, mas não data:text/html, vbscript: nem blob:.

206 testes cobrindo comportamento, integração E2E, fuzzing e invariantes
estáticos. Os testes nunca tocam no banco real."

# ── 13. documentação e publicação ────────────────────────────────
git add README.md LICENSE .env.example .github/ publicar.sh git-setup.sh
commit "docs: licença MIT, CI no GitHub Actions e scripts de publicação

Workflow roda typecheck, testes e build a cada push. O publicar.sh confere
que nenhum banco ou .env está versionado antes de enviar."

# ── sobrou algo? ─────────────────────────────────────────────────
if [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  commit "chore: arquivos restantes do projeto"
fi

git branch -M main
echo
echo "▸ Pronto: $(git rev-list --count HEAD) commits em 'main'."
