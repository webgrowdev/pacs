#!/usr/bin/env bash
set -euo pipefail

echo "Iniciando backend y frontend (requiere dependencias instaladas)"
(cd backend && npm run dev) &
(cd frontend && npm run dev) &
wait
