param(
  [string]$HostName = "checkin.boyneverdie.xyz",
  [string]$User = "root",
  [string]$RemoteProjectDir = "/root/paopao-checkin-manager",
  [string]$ContainerName = "paopao-checkin-manager",
  [string]$ImageName = "paopao-checkin-manager",
  [string]$IdentityFile = $env:PAOPAO_PROD_SSH_KEY,
  [string]$KnownHostsFile = $env:PAOPAO_PROD_KNOWN_HOSTS,
  [string]$ReleaseDir = $env:PAOPAO_RELEASE_DIR,
  [switch]$BuildOnly
)

$ErrorActionPreference = "Stop"

function Resolve-RequiredPath([string]$PathValue, [string]$Label) {
  if (-not $PathValue) {
    throw "$Label is not configured."
  }
  if (-not (Test-Path -LiteralPath $PathValue)) {
    throw "$Label does not exist: $PathValue"
  }
  return (Resolve-Path -LiteralPath $PathValue).Path
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $scriptDir "..")).Path
$workspaceRoot = (Resolve-Path -LiteralPath (Join-Path $projectRoot "..\..\..\..")).Path

if (-not $IdentityFile) {
  $candidateKeys = @(
    (Join-Path $workspaceRoot ".codex-temp-deploy\lynvx_deploy_ed25519"),
    (Join-Path $workspaceRoot ".codex-temp-ssh\lynvx_deploy_ed25519")
  )
  $IdentityFile = ($candidateKeys | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1)
}

$IdentityFile = Resolve-RequiredPath $IdentityFile "Production SSH identity"
if ($KnownHostsFile) {
  $KnownHostsFile = Resolve-RequiredPath $KnownHostsFile "Production known_hosts"
}

if (-not $ReleaseDir) {
  $ReleaseDir = Join-Path $workspaceRoot ".codex-temp-deploy"
}
if (-not (Test-Path -LiteralPath $ReleaseDir)) {
  New-Item -ItemType Directory -Path $ReleaseDir | Out-Null
}
$ReleaseDir = (Resolve-Path -LiteralPath $ReleaseDir).Path

$versionFile = Join-Path $projectRoot "app\src\shared\version.ts"
$versionText = Get-Content -Raw -Encoding UTF8 $versionFile
if ($versionText -notmatch 'APP_VERSION\s*=\s*"([^"]+)"') {
  throw "Cannot read APP_VERSION from $versionFile"
}
$version = $Matches[1]
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$releasePath = Join-Path $ReleaseDir "paopao-checkin-manager-$version-$stamp.tar.gz"

$sshOptions = @(
  "-i", $IdentityFile,
  "-o", "IdentitiesOnly=yes",
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=10"
)
if ($KnownHostsFile) {
  $sshOptions += @("-o", "UserKnownHostsFile=$KnownHostsFile")
}

$target = "$User@$HostName"

function Invoke-Checked([string]$Exe, [string[]]$Arguments) {
  & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Exe failed with exit code $LASTEXITCODE"
  }
}

Write-Host "Packaging $version -> $releasePath"
Invoke-Checked "tar" @(
  "--exclude=./app/node_modules",
  "--exclude=./node_modules",
  "--exclude=./app/data",
  "--exclude=./app/dist",
  "--exclude=./dist",
  "--exclude=./.git",
  "-czf", $releasePath,
  "-C", $projectRoot,
  "."
)

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $releasePath).Hash.ToLowerInvariant()
Write-Host "Release SHA-256: $hash"

if ($BuildOnly) {
  Write-Host "BuildOnly set; not uploading or deploying."
  exit 0
}

$remoteRelease = "/root/paopao-checkin-manager-$version-$stamp.tar.gz"
$remoteScript = "/root/paopao-deploy-$version-$stamp.sh"
$localDeployScript = Join-Path ([System.IO.Path]::GetTempPath()) "paopao-deploy-$version-$stamp.sh"

$remoteBody = @'
#!/usr/bin/env bash
set -euo pipefail

version="$1"
release="$2"
remote_dir="$3"
container="$4"
image="$5"

ts="$(date +%Y%m%d-%H%M%S)"
backup_dir="/root/paopao-backups/${ts}-pre-${version}"
rollback_image="${image}:rollback-before-${version}-${ts}"
next_dir="${remote_dir}.next-${version}-${ts}"
old_dir="${remote_dir}.old-${version}-${ts}"

mkdir -p "$backup_dir" "$next_dir"

if [[ -d "$remote_dir" ]]; then
  tar -czf "$backup_dir/source.tar.gz" \
    --exclude='./app/data' \
    --exclude='./app/node_modules' \
    --exclude='./node_modules' \
    --exclude='./app/dist' \
    --exclude='./dist' \
    -C "$remote_dir" .
  if [[ -d "$remote_dir/app/data" ]]; then
    tar -czf "$backup_dir/data.tar.gz" -C "$remote_dir/app" data
  fi
  if [[ -f "$remote_dir/app/.env" ]]; then
    cp -p "$remote_dir/app/.env" "$backup_dir/env.before"
  fi
fi

if docker inspect "$container" >/dev/null 2>&1; then
  docker commit "$container" "$rollback_image" >/dev/null
fi

tar -xzf "$release" -C "$next_dir"

if [[ -d "$remote_dir/app/data" ]]; then
  mkdir -p "$next_dir/app"
  cp -a "$remote_dir/app/data" "$next_dir/app/data"
fi
if [[ -f "$remote_dir/app/.env" ]]; then
  cp -p "$remote_dir/app/.env" "$next_dir/app/.env"
fi

if [[ -d "$remote_dir" ]]; then
  mv "$remote_dir" "$old_dir"
fi
mv "$next_dir" "$remote_dir"

cd "$remote_dir"
bash ./scripts/preserve-production-flags.sh "$container" "app/.env"

cd "$remote_dir/app"
docker compose -f docker-compose.production.yml up -d --build --force-recreate

for i in $(seq 1 36); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
  if [[ "$status" == "healthy" ]]; then
    break
  fi
  sleep 5
done

health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")"
if [[ "$health" != "healthy" ]]; then
  docker logs --tail 120 "$container" || true
  echo "container health is $health" >&2
  exit 1
fi

curl -fsS http://127.0.0.1:8787/api/health >/dev/null

docker ps --filter "name=${container}" --format '{{.Names}} {{.Image}} {{.Status}}'
docker inspect --format 'RestartCount={{.RestartCount}}' "$container"
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" | awk -F= '/^CHECKIN_FEATURE_/ || /^CHECKIN_ALLOW_REGISTRATION=/'

echo "backup_dir=$backup_dir"
echo "env_backups="
ls -1 "$remote_dir"/app/.env.before-recreate-* 2>/dev/null | tail -n 3 || true
echo "rollback_image=$rollback_image"
'@

Set-Content -LiteralPath $localDeployScript -Value $remoteBody -Encoding ASCII

Write-Host "Uploading release to ${target}:$remoteRelease"
Invoke-Checked "scp" ($sshOptions + @($releasePath, "${target}:$remoteRelease"))
Write-Host "Uploading deploy script to ${target}:$remoteScript"
Invoke-Checked "scp" ($sshOptions + @($localDeployScript, "${target}:$remoteScript"))

Write-Host "Running remote deployment for $version"
Invoke-Checked "ssh" ($sshOptions + @(
  $target,
  "chmod 700 '$remoteScript' && '$remoteScript' '$version' '$remoteRelease' '$RemoteProjectDir' '$ContainerName' '$ImageName'"
))

Write-Host "Deployed $version"
Write-Host "release=$releasePath"
Write-Host "sha256=$hash"
