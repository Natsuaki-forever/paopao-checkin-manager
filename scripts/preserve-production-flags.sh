#!/usr/bin/env bash
set -euo pipefail

container="${1:-paopao-checkin-manager}"
env_file="${2:-app/.env}"
docker_bin="${CHECKIN_DOCKER_BIN:-docker}"

if ! "$docker_bin" inspect "$container" >/dev/null 2>&1; then
  echo "未找到现有容器 $container，已停止；首次部署请显式创建 $env_file。" >&2
  exit 1
fi

mapfile -t flags < <(
  "$docker_bin" inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" |
    awk -F= '/^CHECKIN_FEATURE_[A-Z0-9_]+=/ || /^CHECKIN_ALLOW_REGISTRATION=/'
)

if ((${#flags[@]} == 0)); then
  echo "现有容器未暴露可保留的功能开关，已停止重建。" >&2
  exit 1
fi

for entry in "${flags[@]}"; do
  key="${entry%%=*}"
  value="${entry#*=}"
  if [[ ! "$key" =~ ^CHECKIN_FEATURE_[A-Z0-9_]+$ && "$key" != "CHECKIN_ALLOW_REGISTRATION" ]]; then
    echo "拒绝处理未知变量：$key" >&2
    exit 1
  fi
  normalized_value="${value,,}"
  if [[ ! "$normalized_value" =~ ^(true|false|1|0|yes|no|on|off)$ ]]; then
    echo "功能开关 $key 的值无效，已停止重建。" >&2
    exit 1
  fi
done

env_dir="$(dirname "$env_file")"
mkdir -p "$env_dir"
umask 077
touch "$env_file"
timestamp="$(date +%Y%m%d-%H%M%S)"
backup_file="${env_file}.before-recreate-${timestamp}"
cp -p "$env_file" "$backup_file"
chmod 600 "$backup_file"

work_file="$(mktemp "${env_file}.work.XXXXXX")"
cp "$env_file" "$work_file"
next_file=""
cleanup() {
  [[ -z "$work_file" ]] || rm -f -- "$work_file"
  [[ -z "$next_file" ]] || rm -f -- "$next_file"
}
trap cleanup EXIT

for entry in "${flags[@]}"; do
  key="${entry%%=*}"
  value="${entry#*=}"
  next_file="$(mktemp "${env_file}.next.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    $0 ~ "^" key "=" {
      if (!found) print key "=" value
      found = 1
      next
    }
    { print }
    END { if (!found) print key "=" value }
  ' "$work_file" > "$next_file"
  mv -f "$next_file" "$work_file"
  next_file=""
done

chmod 600 "$work_file"
mv -f "$work_file" "$env_file"
work_file=""
trap - EXIT

echo "已保留 ${#flags[@]} 个正式功能开关。"
echo "环境备份：$backup_file"
