import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileExists, readJsonFile, writeJsonFile } from "../shared/json-file"

export const AUTOPILOT_CONFIG_FILENAME = "autopilot.json"
export const LEGACY_WORKFLOW_CONFIG_FILENAME = "workflow.json"
export const DEFAULT_SKILL_ROOTS = ["~/.claude/skills", "~/.config/opencode/skills"]

export type WorkflowConfigPhase = "spec_refinement" | "plan" | "develop" | "review" | "test"

export type WorkflowPhaseConfig = {
  requiredSkills?: string[]
}

export type WorkflowConfigFile = {
  skillRoots?: string[]
  phases?: Partial<Record<WorkflowConfigPhase, WorkflowPhaseConfig>>
}

export type ResolvedWorkflowConfig = {
  skillRoots: string[]
  phases: Partial<Record<WorkflowConfigPhase, WorkflowPhaseConfig>>
  warnings: string[]
}

export const DEFAULT_AUTOPILOT_CONFIG: WorkflowConfigFile = {
  skillRoots: DEFAULT_SKILL_ROOTS,
  phases: {
    spec_refinement: { requiredSkills: [] },
    plan: { requiredSkills: [] },
    develop: { requiredSkills: [] },
    review: { requiredSkills: [] },
    test: { requiredSkills: [] },
  },
}

const EMPTY_CONFIG: ResolvedWorkflowConfig = {
  skillRoots: [],
  phases: {},
  warnings: [],
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function normalizePhaseConfig(config: WorkflowConfigPhase | WorkflowPhaseConfig | undefined): WorkflowPhaseConfig | undefined {
  if (!config || typeof config !== "object") {
    return undefined
  }
  const requiredSkills = Array.isArray((config as WorkflowPhaseConfig).requiredSkills)
    ? unique((config as WorkflowPhaseConfig).requiredSkills!.map((value) => value.trim()).filter(Boolean))
    : undefined
  if (!requiredSkills || requiredSkills.length === 0) {
    return undefined
  }
  return { requiredSkills }
}

function mergeConfigs(base: ResolvedWorkflowConfig, incoming: WorkflowConfigFile | null): ResolvedWorkflowConfig {
  if (!incoming) {
    return base
  }

  const next: ResolvedWorkflowConfig = {
    skillRoots: unique([
      ...base.skillRoots,
      ...(Array.isArray(incoming.skillRoots)
        ? incoming.skillRoots.map((value) => value.trim()).filter(Boolean)
        : []),
    ]),
    phases: { ...base.phases },
    warnings: [...base.warnings],
  }

  for (const phase of ["spec_refinement", "plan", "develop", "review", "test"] as const) {
    const merged = normalizePhaseConfig(incoming.phases?.[phase]) ?? next.phases[phase]
    if (merged) {
      next.phases[phase] = merged
    }
  }

  return next
}

type ConfigReadResult = {
  config: WorkflowConfigFile | null
  warnings: string[]
}

async function readConfigFileWithWarnings(filePath: string, label: string): Promise<ConfigReadResult> {
  if (!(await fileExists(filePath))) {
    return { config: null, warnings: [] }
  }

  try {
    const raw = await readFile(filePath, "utf8")
    if (!raw.trim()) {
      return {
        config: null,
        warnings: [`${label} is empty and will be treated as defaults: ${filePath}`],
      }
    }

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        config: null,
        warnings: [`${label} is not a JSON object and will be ignored: ${filePath}`],
      }
    }

    return {
      config: parsed as WorkflowConfigFile,
      warnings: [],
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        config: null,
        warnings: [`${label} contains invalid JSON and will be ignored: ${filePath}`],
      }
    }
    throw error
  }
}

async function loadConfigWithLegacy(args: {
  preferredFile: string
  legacyFile: string
  label: string
}): Promise<ConfigReadResult> {
  const preferred = await readConfigFileWithWarnings(args.preferredFile, args.label)
  if (preferred.config || preferred.warnings.length > 0 || await fileExists(args.preferredFile)) {
    return preferred
  }

  const legacy = await readConfigFileWithWarnings(args.legacyFile, `Legacy ${args.label}`)
  if (!legacy.config && legacy.warnings.length === 0) {
    return legacy
  }

  return {
    config: legacy.config,
    warnings: [
      `Using legacy ${LEGACY_WORKFLOW_CONFIG_FILENAME}; migrate to ${AUTOPILOT_CONFIG_FILENAME}: ${args.legacyFile}`,
      ...legacy.warnings,
    ],
  }
}

export async function resolveWorkflowConfig(args: {
  projectConfigFile: string
  homeDir?: string
}): Promise<ResolvedWorkflowConfig> {
  const globalConfigFile = join(args.homeDir ?? homedir(), ".config", "opencode", AUTOPILOT_CONFIG_FILENAME)
  const globalLegacyFile = join(args.homeDir ?? homedir(), ".config", "opencode", LEGACY_WORKFLOW_CONFIG_FILENAME)
  const projectLegacyFile = join(dirname(args.projectConfigFile), LEGACY_WORKFLOW_CONFIG_FILENAME)

  const globalConfig = await loadConfigWithLegacy({
    preferredFile: globalConfigFile,
    legacyFile: globalLegacyFile,
    label: `Global ${AUTOPILOT_CONFIG_FILENAME}`,
  })
  const projectConfig = await loadConfigWithLegacy({
    preferredFile: args.projectConfigFile,
    legacyFile: projectLegacyFile,
    label: `Project ${AUTOPILOT_CONFIG_FILENAME}`,
  })

  const merged = mergeConfigs(
    mergeConfigs(EMPTY_CONFIG, globalConfig.config),
    projectConfig.config,
  )
  merged.warnings.push(...globalConfig.warnings, ...projectConfig.warnings)
  return merged
}

export async function ensureAutopilotConfigFile(filePath: string): Promise<void> {
  if (await fileExists(filePath)) {
    return
  }
  const legacyFilePath = join(dirname(filePath), LEGACY_WORKFLOW_CONFIG_FILENAME)
  const legacyConfig = await readJsonFile<WorkflowConfigFile>(legacyFilePath)
  if (legacyConfig) {
    await writeJsonFile(filePath, legacyConfig)
    return
  }
  await writeJsonFile(filePath, DEFAULT_AUTOPILOT_CONFIG)
}
