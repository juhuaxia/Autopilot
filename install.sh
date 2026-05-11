#!/usr/bin/env bash
set -euo pipefail

REPO_SLUG="juhuaxia/Autopilot"
INSTALL_ROOT="${HOME}/.config/opencode/plugins/autopilot"
OPENCODE_CONFIG_DIR="${HOME}/.config/opencode"
OPENCODE_CONFIG_JSON="${OPENCODE_CONFIG_DIR}/opencode.json"
OPENCODE_CONFIG_JSONC="${OPENCODE_CONFIG_DIR}/opencode.jsonc"
VERSION="latest"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="$2"
      shift 2
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      exit 1
      ;;
  esac
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

require_command curl
require_command tar
require_command python3

if [[ "$VERSION" == "latest" ]]; then
  DOWNLOAD_URL="https://github.com/${REPO_SLUG}/releases/latest/download/autopilot-release.tar.gz"
else
  DOWNLOAD_URL="https://github.com/${REPO_SLUG}/releases/download/${VERSION}/autopilot-release.tar.gz"
fi

TMP_DIR="$(mktemp -d)"
ARCHIVE_PATH="${TMP_DIR}/autopilot-release.tar.gz"
EXTRACT_DIR="${TMP_DIR}/extract"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

printf 'Downloading %s\n' "$DOWNLOAD_URL"
curl -fsSL "$DOWNLOAD_URL" -o "$ARCHIVE_PATH"

mkdir -p "$EXTRACT_DIR"
tar -xzf "$ARCHIVE_PATH" -C "$EXTRACT_DIR"

if [[ ! -d "${EXTRACT_DIR}/autopilot" ]]; then
  printf 'Release archive is missing autopilot/ root directory\n' >&2
  exit 1
fi

mkdir -p "$(dirname "$INSTALL_ROOT")"
rm -rf "$INSTALL_ROOT"
mv "${EXTRACT_DIR}/autopilot" "$INSTALL_ROOT"

PLUGIN_ENTRY="file://${INSTALL_ROOT}/plugin.js"
mkdir -p "$OPENCODE_CONFIG_DIR"

CONFIG_SOURCE="$OPENCODE_CONFIG_JSON"
if [[ -f "$OPENCODE_CONFIG_JSONC" && ! -f "$OPENCODE_CONFIG_JSON" ]]; then
  CONFIG_SOURCE="$OPENCODE_CONFIG_JSONC"
fi

python3 - "$CONFIG_SOURCE" "$OPENCODE_CONFIG_JSON" "$PLUGIN_ENTRY" <<'PY'
import json
import pathlib
import re
import sys

source_path = pathlib.Path(sys.argv[1])
target_path = pathlib.Path(sys.argv[2])
plugin_entry = sys.argv[3]

def strip_json_comments(text: str) -> str:
    text = re.sub(r"^\s*//.*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"/\*[\s\S]*?\*/", "", text)
    return text

if source_path.exists():
    raw = source_path.read_text(encoding="utf-8")
    try:
        data = json.loads(strip_json_comments(raw))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Failed to parse OpenCode config: {source_path}: {exc}")
    if not isinstance(data, dict):
        raise SystemExit(f"OpenCode config must be a JSON object: {source_path}")
else:
    data = {}

plugins = data.get("plugin")
if not isinstance(plugins, list):
    plugins = []

if plugin_entry not in plugins:
    plugins.append(plugin_entry)

data["plugin"] = plugins
target_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
PY

printf '\nInstalled autopilot plugin to:\n%s\n' "$INSTALL_ROOT"
printf 'Registered plugin entry:\n%s\n' "$PLUGIN_ENTRY"
printf 'OpenCode config:\n%s\n' "$OPENCODE_CONFIG_JSON"
