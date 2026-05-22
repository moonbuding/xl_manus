#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

if [ ! -f .env.local ]; then
  cp .env.local.example .env.local
  printf '%s\n' "已创建 .env.local，请先填入 DEEPSEEK_API_KEY 后再次运行。"
  exit 1
fi

docker compose up --build
