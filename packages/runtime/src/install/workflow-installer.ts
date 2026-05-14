import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { ensureAutopilotConfigFile, AUTOPILOT_CONFIG_FILENAME } from "../config/workflow-config"
import { fileExists, writeJsonFile } from "../shared/json-file"

export type WorkflowInstallResult = {
  ok: boolean
  projectWorkflowConfigFile: string
  opencodeConfigFile: string
  warnings: string[]
  pluginEntry: string
}

export type WorkflowInstallOptions = {
  pluginEntryFile?: string
  pluginEntry?: string
}

export function stripJsonComments(input: string): string {
  return input
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
}

export async function resolveOpencodeConfigFile(opencodeConfigDir: string): Promise<{ filePath: string; warnings: string[] }> {
  const jsonFile = join(opencodeConfigDir, "opencode.json")
  const jsoncFile = join(opencodeConfigDir, "opencode.jsonc")
  const hasJson = await fileExists(jsonFile)
  const hasJsonc = await fileExists(jsoncFile)
  const warnings: string[] = []

  if (hasJson && hasJsonc) {
    warnings.push(`Both opencode.json and opencode.jsonc exist under ${opencodeConfigDir}; installer will prefer opencode.json`)
  }

  if (hasJson) {
    return { filePath: jsonFile, warnings }
  }

  if (hasJsonc) {
    warnings.push(`Existing opencode.jsonc detected; installer will normalize output into opencode.json`)
    return { filePath: jsoncFile, warnings }
  }

  return { filePath: jsonFile, warnings }
}

function looksLikeAutopilotTempInstallEntry(entry: string): boolean {
  return entry.startsWith("file://") && entry.includes("workflow-plugin-install-") && entry.endsWith("/dist/plugin.js")
}

export async function isAutopilotPluginEntry(entry: string): Promise<boolean> {
  if (entry === "@fkqfkq123/opencode-autopilot") {
    return true
  }

  if (looksLikeAutopilotTempInstallEntry(entry)) {
    return true
  }

  if (!entry.startsWith("file://")) {
    return false
  }

  try {
    const pluginFile = fileURLToPath(entry)
    let releaseMetadata: unknown = null
    let packageMetadata: unknown = null
    try {
      releaseMetadata = JSON.parse(await readFile(join(dirname(pluginFile), "release.json"), "utf8")) as unknown
    } catch {
      releaseMetadata = null
    }
    try {
      packageMetadata = JSON.parse(await readFile(join(dirname(pluginFile), "package.json"), "utf8")) as unknown
    } catch {
      packageMetadata = null
    }
    const releaseName = releaseMetadata && typeof releaseMetadata === "object" && !Array.isArray(releaseMetadata)
      ? (releaseMetadata as { name?: unknown }).name
      : null
    const packageName = packageMetadata && typeof packageMetadata === "object" && !Array.isArray(packageMetadata)
      ? (packageMetadata as { name?: unknown }).name
      : null

    return releaseName === "autopilot" || packageName === "@fkqfkq123/opencode-autopilot"
  } catch {
    return false
  }
}

export async function runWorkflowInstall(args: {
  cwd: string
  homeDir: string
  options?: WorkflowInstallOptions
}): Promise<WorkflowInstallResult> {
  const repoRoot = resolve(args.cwd)
  const harnessDir = join(repoRoot, ".workflow-harness")
  const projectWorkflowConfigFile = join(harnessDir, AUTOPILOT_CONFIG_FILENAME)
  const opencodeConfigDir = join(args.homeDir, ".config", "opencode")
  const globalAutopilotConfigFile = join(opencodeConfigDir, AUTOPILOT_CONFIG_FILENAME)
  const pluginEntryFile = args.options?.pluginEntryFile ?? "dist/plugin.js"
  const pluginEntry = args.options?.pluginEntry ?? `file://${join(repoRoot, pluginEntryFile)}`
  const configResolution = await resolveOpencodeConfigFile(opencodeConfigDir)
  const opencodeConfigFile = join(opencodeConfigDir, "opencode.json")
  const warnings: string[] = [...configResolution.warnings]

  await mkdir(harnessDir, { recursive: true })
  await ensureAutopilotConfigFile(projectWorkflowConfigFile)

  await mkdir(opencodeConfigDir, { recursive: true })
  await ensureAutopilotConfigFile(globalAutopilotConfigFile)

  if (!(await fileExists(configResolution.filePath))) {
    await writeJsonFile(opencodeConfigFile, {
      plugin: [pluginEntry],
    })
    return {
      ok: true,
      projectWorkflowConfigFile,
      opencodeConfigFile,
      warnings,
      pluginEntry,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonComments(await readFile(configResolution.filePath, "utf8")))
  } catch {
    warnings.push(`Unable to safely update existing OpenCode config: ${configResolution.filePath}`)
    return {
      ok: false,
      projectWorkflowConfigFile,
      opencodeConfigFile,
      warnings,
      pluginEntry,
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    warnings.push(`OpenCode config is not a JSON object: ${configResolution.filePath}`)
    return {
      ok: false,
      projectWorkflowConfigFile,
      opencodeConfigFile,
      warnings,
      pluginEntry,
    }
  }

  const config = parsed as { plugin?: unknown }
  const pluginArray = Array.isArray(config.plugin) ? [...config.plugin] : []

  const normalizedPlugins: string[] = []
  for (const entry of pluginArray.filter((item): item is string => typeof item === "string")) {
    if (await isAutopilotPluginEntry(entry)) {
      continue
    }
    if (!normalizedPlugins.includes(entry)) {
      normalizedPlugins.push(entry)
    }
  }

  const preferredAutopilotEntry = pluginArray.includes("@fkqfkq123/opencode-autopilot")
    ? "@fkqfkq123/opencode-autopilot"
    : pluginEntry
  if (!normalizedPlugins.includes(preferredAutopilotEntry)) {
    normalizedPlugins.push(preferredAutopilotEntry)
  }

  await writeFile(
    opencodeConfigFile,
    `${JSON.stringify({
      ...(parsed as Record<string, unknown>),
      plugin: normalizedPlugins,
    }, null, 2)}\n`,
    "utf8",
  )

  return {
    ok: true,
    projectWorkflowConfigFile,
    opencodeConfigFile,
    warnings,
    pluginEntry,
  }
}
