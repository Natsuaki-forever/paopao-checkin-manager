#!/usr/bin/env bash
set -euo pipefail

backup_root="${1:-/root/paopao-backups}"

while IFS= read -r -d '' archive; do
  if ! tar -tzf "$archive" | grep secret.key >/dev/null; then
    chmod 600 "$archive"
    continue
  fi

  extracted="$(mktemp -d)"
  cleanup() { rm -rf "$extracted" "${archive}.new"; }
  trap cleanup RETURN
  tar -xzf "$archive" -C "$extracted"
  find "$extracted" -type f \( -name paopao-secret.key -o -name demo-secret.key \) -delete
  tar -czf "${archive}.new" -C "$extracted" .
  if tar -tzf "${archive}.new" | grep secret.key >/dev/null; then
    echo "key removal verification failed: $archive" >&2
    exit 1
  fi
  chmod 600 "${archive}.new"
  mv "${archive}.new" "$archive"
  echo "sanitized $archive"
done < <(find "$backup_root" -type f -name data.tar.gz -print0)
