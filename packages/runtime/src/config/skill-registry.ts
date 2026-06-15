import { access, readdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, extname, isAbsolute, join, resolve } from "node:path"
import { readFile } from "node:fs/promises"
import { summarizeMarkdownContent } from "../shared/text-summary"

const MAX_SKILL_SUMMARY_CHARS = 1200
const skillFileCache = new Map<string, { mtimeMs: number, content: string }>()

function expandPath(input: string): string {
  if (input === "~") {
    return homedir()
  }
  if (input.startsWith("~/")) {
    return join(homedir(), input.slice(2))
  }
  return isAbsolute(input) ? input : resolve(input)
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export async function buildSkillRegistry(skillRoots: string[]): Promise<Map<string, string>> {
  const registry = new Map<string, string>()

  for (const rawRoot of skillRoots) {
    const root = expandPath(rawRoot)
    let entries: Awaited<ReturnType<typeof readdir>> = []
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
        const skillName = basename(entry.name, ".md")
        registry.set(skillName, join(root, entry.name))
        continue
      }

      if (entry.isDirectory()) {
        const skillPath = join(root, entry.name, "SKILL.md")
        if (await fileExists(skillPath)) {
          registry.set(entry.name, skillPath)
        }
      }
    }
  }

  return registry
}

export type SkillRegistryBuildResult = {
  registry: Map<string, string>
  warnings: string[]
}

export async function buildSkillRegistryWithWarnings(skillRoots: string[]): Promise<SkillRegistryBuildResult> {
  const registry = new Map<string, string>()
  const warnings: string[] = []

  for (const rawRoot of skillRoots) {
    const root = expandPath(rawRoot)
    let entries: Awaited<ReturnType<typeof readdir>> = []
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      warnings.push(`Skill root not found or unreadable: ${rawRoot}`)
      continue
    }

    for (const entry of entries) {
      if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
        const skillName = basename(entry.name, ".md")
        const skillPath = join(root, entry.name)
        if (registry.has(skillName)) {
          warnings.push(`Duplicate skill name detected: ${skillName}`)
        }
        registry.set(skillName, skillPath)
        continue
      }

      if (entry.isDirectory()) {
        const skillPath = join(root, entry.name, "SKILL.md")
        if (await fileExists(skillPath)) {
          if (registry.has(entry.name)) {
            warnings.push(`Duplicate skill name detected: ${entry.name}`)
          }
          registry.set(entry.name, skillPath)
        }
      }
    }
  }

  return { registry, warnings }
}

export function resolveSkillPaths(registry: Map<string, string>, skillNames: string[]): Array<{ name: string, path: string }> {
  return skillNames.flatMap((name) => {
    const path = registry.get(name)
    return path ? [{ name, path }] : []
  })
}

export async function loadResolvedSkillContents(
  registry: Map<string, string>,
  skillNames: string[],
): Promise<Array<{ name: string, path: string, content: string }>> {
  const resolved = resolveSkillPaths(registry, skillNames)
  const results: Array<{ name: string, path: string, content: string }> = []

  for (const skill of resolved) {
    try {
      const content = await readSkillFileWithCache(skill.path)
      results.push({
        ...skill,
        content: content.trim(),
      })
    } catch {
      continue
    }
  }

  return results
}

export async function loadResolvedSkillSummaries(
  registry: Map<string, string>,
  skillNames: string[],
): Promise<Array<{ name: string, path: string, summary: string }>> {
  const resolved = resolveSkillPaths(registry, skillNames)
  const results: Array<{ name: string, path: string, summary: string }> = []

  for (const skill of resolved) {
    try {
      const content = await readSkillFileWithCache(skill.path)
      results.push({
        ...skill,
        summary: summarizeMarkdownContent(content.trim(), MAX_SKILL_SUMMARY_CHARS),
      })
    } catch {
      continue
    }
  }

  return results
}

async function readSkillFileWithCache(filePath: string): Promise<string> {
  const fileStat = await stat(filePath)
  const cached = skillFileCache.get(filePath)
  if (cached && cached.mtimeMs === fileStat.mtimeMs) {
    return cached.content
  }
  const content = await readFile(filePath, "utf8")
  skillFileCache.set(filePath, {
    mtimeMs: fileStat.mtimeMs,
    content,
  })
  return content
}
