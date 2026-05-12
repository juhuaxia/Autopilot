import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileExists, readJsonFile, writeJsonFile } from "../shared/json-file"

export const AUTOPILOT_CONFIG_FILENAME = "autopilot.json"
export const LEGACY_WORKFLOW_CONFIG_FILENAME = "workflow.json"
export const DEFAULT_SKILL_ROOTS = ["~/.claude/skills", "~/.config/opencode/skills"]

export type WorkflowConfigPhase = "spec_refinement" | "plan" | "develop" | "review" | "test"

/**
 * Understanding depth levels for risk-driven layered project understanding strategy.
 *
 * - `lightweight`: Extract core intent only. No full dependency tracing unless ambiguity detected.
 * - `standard`: Trace direct dependencies and parent components. Identify impact scope.
 * - `deep`: Comprehensive tracing including parent components, routes, stores, services,
 *   shared modules, cross-module impacts, full call chains, and state flow.
 */
export type UnderstandingDepth = "lightweight" | "standard" | "deep"

export type WorkflowPhaseConfig = {
  requiredSkills?: string[]
  /**
   * Target understanding depth for this phase.
   * When unset, the engine applies a phase-aware default:
   * - spec_refinement → lightweight
   * - plan → standard
   * - develop → deep
   * - review → deep
   * - test → standard
   */
  understandingDepth?: UnderstandingDepth
}

/**
 * A declarative risk signal that can elevate understanding depth.
 * When a matching signal is active, the effective depth is upgraded
 * (at least to `standard`, or to `deep` if `triggersDeep` is true).
 */
export type RiskSignal = {
  /** Unique identifier for this risk signal */
  id: string
  /** Human-readable description of what this signal represents */
  description: string
  /** If true, this signal forces deep understanding regardless of phase default */
  triggersDeep?: boolean
}

export type WorkflowConfigFile = {
  skillRoots?: string[]
  phases?: Partial<Record<WorkflowConfigPhase, WorkflowPhaseConfig>>
  /**
   * Global risk signal definitions.
   * These are referenced by phase dispatch to determine whether understanding depth
   * should be elevated beyond the phase default.
   */
  riskSignals?: RiskSignal[]
}

export type ResolvedWorkflowConfig = {
  skillRoots: string[]
  phases: Partial<Record<WorkflowConfigPhase, WorkflowPhaseConfig>>
  warnings: string[]
  riskSignals: RiskSignal[]
}

export const DEFAULT_AUTOPILOT_CONFIG: WorkflowConfigFile = {
  skillRoots: DEFAULT_SKILL_ROOTS,
  phases: {
    spec_refinement: { requiredSkills: [], understandingDepth: "lightweight" },
    plan: { requiredSkills: [], understandingDepth: "standard" },
    develop: { requiredSkills: [], understandingDepth: "deep" },
    review: { requiredSkills: [], understandingDepth: "deep" },
    test: { requiredSkills: [], understandingDepth: "standard" },
  },
  riskSignals: [
    {
      id: "cross_module",
      description: "Modification spans multiple modules or packages",
      triggersDeep: true,
    },
    {
      id: "public_component",
      description: "Change affects a shared/public component used by other features",
      triggersDeep: true,
    },
    {
      id: "state_route_permission",
      description: "Change touches state management, routing, or permission logic",
    },
    {
      id: "dependency_chain",
      description: "Requires tracing parent components, import chains, or dependency graphs",
    },
    {
      id: "history_complexity",
      description: "Area has history of complexity, bugs, or regression issues",
      triggersDeep: true,
    },
  ],
}

const EMPTY_CONFIG: ResolvedWorkflowConfig = {
  skillRoots: [],
  phases: {},
  warnings: [],
  riskSignals: [],
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
  const rawDepth = (config as WorkflowPhaseConfig).understandingDepth
  const understandingDepth: UnderstandingDepth | undefined =
    rawDepth === "lightweight" || rawDepth === "standard" || rawDepth === "deep" ? rawDepth : undefined
  if (!requiredSkills && !understandingDepth) {
    return undefined
  }
  const result: WorkflowPhaseConfig = {}
  if (requiredSkills && requiredSkills.length > 0) {
    result.requiredSkills = requiredSkills
  }
  if (understandingDepth) {
    result.understandingDepth = understandingDepth
  }
  return result
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
    riskSignals: [...(base.riskSignals ?? [])],
  }

  for (const phase of ["spec_refinement", "plan", "develop", "review", "test"] as const) {
    const merged = normalizePhaseConfig(incoming.phases?.[phase]) ?? next.phases[phase]
    if (merged) {
      next.phases[phase] = merged
    }
  }

  if (Array.isArray(incoming.riskSignals) && incoming.riskSignals.length > 0) {
    const incomingIds = new Set(next.riskSignals.map((s) => s.id))
    for (const signal of incoming.riskSignals) {
      if (signal.id && !incomingIds.has(signal.id)) {
        next.riskSignals.push(signal)
        incomingIds.add(signal.id)
      }
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

const PHASE_DEFAULT_DEPTH: Record<WorkflowConfigPhase, UnderstandingDepth> = {
  spec_refinement: "lightweight",
  plan: "standard",
  develop: "deep",
  review: "deep",
  test: "standard",
}

export function resolveEffectiveUnderstandingDepth(args: {
  phase: WorkflowConfigPhase
  config: ResolvedWorkflowConfig
  activeRiskSignalIds?: string[]
}): UnderstandingDepth {
  const phaseConfig = args.config.phases[args.phase]
  const baseDepth = phaseConfig?.understandingDepth ?? PHASE_DEFAULT_DEPTH[args.phase]
  const activeSignals = (args.activeRiskSignalIds ?? []).filter((id) =>
    args.config.riskSignals.some((s) => s.id === id),
  )
  if (activeSignals.length === 0) {
    return baseDepth
  }
  const hasDeepTrigger = activeSignals.some((id) =>
    args.config.riskSignals.find((s) => s.id === id)?.triggersDeep,
  )
  if (hasDeepTrigger || baseDepth === "deep") {
    return "deep"
  }
  return baseDepth === "lightweight" ? "standard" : baseDepth
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
