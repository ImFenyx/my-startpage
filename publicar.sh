#!/usr/bin/env bash
#
# Publica a startpage no seu GitHub.
#
#   ./publicar.sh SEU-USUARIO [nome-do-repo]
#
# O que faz:
#   1. confere que nada sensível está prestes a ser enviado
#   2. ajusta seu nome/e-mail nos commits (se ainda estiverem no padrão)
#   3. troca SEU-USUARIO no README pelo seu usuário real
#   4. cria o repositório (via gh, se disponível) e envia
#
set -euo pipefail

USUARIO="${1:-}"
REPO="${2:-startpage}"

if [[ -z "$USUARIO" ]]; then
  echo "uso: ./publicar.sh SEU-USUARIO [nome-do-repo]"
  exit 1
fi

cd "$(dirname "$0")"

# ── 0. o repositório existe? ─────────────────────────────────────
# O diretório .git não sobrevive à exportação do workspace: o download traz
# os arquivos, mas não o histórico. Recriamos aqui, com os mesmos commits.
if [[ ! -d .git ]]; then
  echo "▸ Nenhum repositório git encontrado — criando o histórico…"
  echo
  ./git-setup.sh
  echo
fi

# ── 1. guarda de segurança ───────────────────────────────────────
echo "▸ Conferindo que nada sensível será publicado…"
if git ls-files | grep -qiE '\.sqlite|^data/|\.env$'; then
  echo "  ✗ ABORTADO: há arquivo sensível versionado:"
  git ls-files | grep -iE '\.sqlite|^data/|\.env$' | sed 's/^/    /'
  exit 1
fi
echo "  ✓ nenhum banco, .env ou dado pessoal"

# ── 2. autoria dos commits ───────────────────────────────────────
NOME_ATUAL="$(git config user.name || echo '')"
if [[ "$NOME_ATUAL" == "Startpage Dev" || -z "$NOME_ATUAL" ]]; then
  echo
  echo "▸ Os commits estão com autoria genérica."
  read -rp "  Seu nome para os commits [$USUARIO]: " NOME
  NOME="${NOME:-$USUARIO}"
  read -rp "  Seu e-mail do GitHub: " EMAIL

  if [[ -n "$EMAIL" ]]; then
    git config user.name "$NOME"
    git config user.email "$EMAIL"
    echo "  Reescrevendo a autoria dos commits existentes…"
    git -c "user.name=$NOME" -c "user.email=$EMAIL" \
      filter-branch -f --env-filter "
        export GIT_AUTHOR_NAME='$NOME'
        export GIT_AUTHOR_EMAIL='$EMAIL'
        export GIT_COMMITTER_NAME='$NOME'
        export GIT_COMMITTER_EMAIL='$EMAIL'
      " -- --all >/dev/null 2>&1
    echo "  ✓ autoria atualizada"
  fi
fi

# ── 3. usuário no README ─────────────────────────────────────────
if grep -q "SEU-USUARIO" README.md; then
  sed -i.bak "s|SEU-USUARIO/startpage|$USUARIO/$REPO|g" README.md && rm -f README.md.bak
  git add README.md
  git commit -q -m "docs: aponta o badge de CI para o repositório" || true
  echo "▸ README ajustado para $USUARIO/$REPO"
fi

# ── 4. publicar ──────────────────────────────────────────────────
git branch -M main

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  echo
  echo "▸ Criando o repositório com o GitHub CLI…"
  gh repo create "$USUARIO/$REPO" --source=. --remote=origin --push --public \
    --description "Startpage com relógio, Pomodoro, Todoist, wishlist e notas — Catppuccin Mocha, pensada para TDAH"
  echo
  echo "  ✓ publicado: https://github.com/$USUARIO/$REPO"
else
  git remote remove origin 2>/dev/null || true
  git remote add origin "https://github.com/$USUARIO/$REPO.git"
  echo
  echo "▸ O GitHub CLI não está disponível ou autenticado."
  echo
  echo "  1. Crie o repositório vazio em:"
  echo "       https://github.com/new"
  echo "       nome: $REPO   (NÃO marque README, .gitignore ou licença)"
  echo
  echo "  2. Depois rode:"
  echo "       git push -u origin main"
  echo
  echo "  O remote já está configurado para $USUARIO/$REPO."
fi
