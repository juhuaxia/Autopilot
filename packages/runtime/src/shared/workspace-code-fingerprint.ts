import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { basename, join, resolve } from "node:path"

const EXCLUDED_DIRS = new Set([".git", ".workflow-harness", "node_modules", "dist", "release", "coverage"])
const CODELIKE_FILE_NAMES = new Set([
  "package.json",
  "bun.lockb",
  "bunfig.toml",
  "tsconfig.json",
  "tsconfig.build.json",
  "vite.config.ts",
  "vitest.config.ts",
  "eslint.config.js",
  "eslint.config.mjs",
  "prettier.config.js",
  "prettier.config.mjs",
])
const CODELIKE_EXTENSION_PATTERN = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|scss|sass|less|html|vue|svelte|mdx|sh|bash|zsh|py|go|rs|java|kt|swift|m|mm|c|cc|cpp|h|hpp|toml|yml|yaml)$/i

function isCodeLikeFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/")
  const baseName = normalized.split("/").pop() ?? normalized
  if (/^readme(?:\.|$)/i.test(baseName)) {
    return false
  }
  if (CODELIKE_FILE_NAMES.has(baseName)) {
    return true
  }
  if (normalized.includes("/docs/") || normalized.startsWith("docs/")) {
    return false
  }
  if (normalized.includes("/.workflow-harness/") || normalized.startsWith(".workflow-harness/")) {
    return false
  }
  return CODELIKE_EXTENSION_PATTERN.test(baseName)
}

async function collectCodeLikeEntries(rootDir: string, currentDir = ""): Promise<string[]> {
  const entries = await readdir(join(rootDir, currentDir), { withFileTypes: true })
  const collected: string[] = []

  for (const entry of entries) {
    if (entry.name.startsWith(".") && EXCLUDED_DIRS.has(entry.name)) {
      continue
    }

    const relativePath = currentDir ? `${currentDir}/${entry.name}` : entry.name
    const normalizedPath = relativePath.replace(/\\/g, "/")

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) {
        continue
      }
      collected.push(...await collectCodeLikeEntries(rootDir, relativePath))
      continue
    }

    if (!isCodeLikeFile(normalizedPath)) {
      continue
    }

    const content = await readFile(join(rootDir, relativePath))
    const contentHash = createHash("sha256").update(content).digest("hex")
    collected.push(`${normalizedPath}:${contentHash}`)
  }

  return collected
}

export type WorkspaceCodeSnapshot = Record<string, string>

export function resolveCodeScanRoot(baseDir: string): string {
  const normalized = resolve(baseDir)
  return basename(normalized) === ".workflow-harness"
    ? resolve(normalized, "..")
    : normalized
}

export async function buildWorkspaceCodeSnapshot(rootDir: string): Promise<WorkspaceCodeSnapshot> {
  const entries = await collectCodeLikeEntries(resolveCodeScanRoot(rootDir))
  return Object.fromEntries(entries.map((entry) => {
    const separator = entry.indexOf(":")
    const filePath = separator === -1 ? entry : entry.slice(0, separator)
    return [filePath, entry]
  }))
}

export async function buildWorkspaceCodeFingerprint(rootDir: string): Promise<string> {
  const snapshot = await buildWorkspaceCodeSnapshot(rootDir)
  const entries = Object.values(snapshot).sort()
  return createHash("sha256").update(entries.join("\n")).digest("hex")
}
