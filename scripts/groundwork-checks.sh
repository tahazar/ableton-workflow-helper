#!/bin/sh
# Project checks run by the dev-groundwork Stop hook before Claude ends a turn
# that changed code (.groundwork/config.json, "onStop"). The TypeScript checks
# take under a minute; the Python suite takes about three, so it runs only when
# analysis/ changed.
set -e
changed=$(git status --porcelain --untracked-files=all | cut -c4- | grep -v '\.md$' || true)

if printf '%s\n' "$changed" | grep -q '^analysis/'; then
  (cd analysis && ../.venv/bin/ruff check . && ../.venv/bin/ruff format --check . \
    && AWH_CLAP_STUB=1 ../.venv/bin/pytest -q -x)
fi

if printf '%s\n' "$changed" | grep -qv '^analysis/'; then
  pnpm build && pnpm lint && pnpm fmt:check && pnpm typecheck && pnpm test
fi
