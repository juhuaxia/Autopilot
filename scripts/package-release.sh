#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_DIR="${ROOT_DIR}/release"
ARCHIVE_PATH="${RELEASE_DIR}/autopilot-release.tar.gz"

bun run build
bun run build:release

rm -f "$ARCHIVE_PATH"
tar -czf "$ARCHIVE_PATH" -C "$RELEASE_DIR" autopilot

printf 'Created release archive: %s\n' "$ARCHIVE_PATH"
