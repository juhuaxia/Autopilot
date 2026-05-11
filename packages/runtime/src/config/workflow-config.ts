import { homedir } from "node:os"
import { join } from "node:path"
import { fileExists, readJsonFile, writeJsonFile } from "../shared/json-file"

export const AUTOPILOT_CONFIG_FILENAME = "autopilot.json"

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
  skillRoots: [],
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

export async function resolveWorkflowConfig(args: {
  projectConfigFile: string
  homeDir?: string
}): Promise<ResolvedWorkflowConfig> {
  const globalConfigFile = join(args.homeDir ?? homedir(), ".config", "opencode", AUTOPILOT_CONFIG_FILENAME)
  const globalConfig = await readJsonFile<WorkflowConfigFile>(globalConfigFile)
  const projectConfig = await readJsonFile<WorkflowConfigFile>(args.projectConfigFile)
  return mergeConfigs(mergeConfigs(EMPTY_CONFIG, globalConfig), projectConfig)
}

export async function ensureAutopilotConfigFile(filePath: string): Promise<void> {
  if (await fileExists(filePath)) {
    return
  }
  await writeJsonFile(filePath, DEFAULT_AUTOPILOT_CONFIG)
}
