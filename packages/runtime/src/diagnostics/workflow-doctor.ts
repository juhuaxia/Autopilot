import { access } from "node:fs/promises"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { buildSkillRegistryWithWarnings } from "../config/skill-registry"
import { AUTOPILOT_CONFIG_FILENAME, resolveWorkflowConfig } from "../config/workflow-config"
import type { WorkflowWorkspace } from "../workspace/workflow-workspace"

export type WorkflowDoctorResult = {
  ok: boolean
  globalConfigFile: string
  projectConfigFile: string
  skillRoots: string[]
  requiredSkills: Array<{ phase: string; skills: string[] }>
  missingSkills: Array<{ phase: string; skill: string }>
  checks: Array<{ name: string; status: "ok" | "warning" | "error"; detail: string }>
  nextSteps: string[]
  warnings: string[]
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8")
  } catch {
    return null
  }
}

function gitignoreHasWorkflowHarness(content: string): boolean {
  return content.split("\n").some((line) => {
    const normalized = line.trim()
    return normalized.includes(".workflow-harness/")
  })
}

export async function runWorkflowDoctor(workspace: WorkflowWorkspace): Promise<WorkflowDoctorResult> {
  const projectConfigFile = workspace.workflowConfigFile()
  const globalConfigFile = join(homedir(), ".config", "opencode", AUTOPILOT_CONFIG_FILENAME)
  const resolvedConfig = await resolveWorkflowConfig({
    projectConfigFile,
  })
  const registryResult = await buildSkillRegistryWithWarnings(resolvedConfig.skillRoots)
  const checks: Array<{ name: string; status: "ok" | "warning" | "error"; detail: string }> = []

  const requiredSkills = Object.entries(resolvedConfig.phases)
    .flatMap(([phase, phaseConfig]) => {
      const skills = phaseConfig?.requiredSkills ?? []
      return skills.length > 0 ? [{ phase, skills }] : []
    })

  const warnings = [...resolvedConfig.warnings, ...registryResult.warnings]
  const missingSkills: Array<{ phase: string; skill: string }> = []
  for (const { phase, skills } of requiredSkills) {
    for (const skillName of skills) {
      if (!registryResult.registry.has(skillName)) {
        warnings.push(`Missing skill for phase ${phase}: ${skillName}`)
        missingSkills.push({ phase, skill: skillName })
      }
    }
  }

  const hasGlobalConfig = await fileExists(globalConfigFile)
  if (!hasGlobalConfig) {
    warnings.push(`Global ${AUTOPILOT_CONFIG_FILENAME} not found: ${globalConfigFile}`)
  }

  const workspaceRoot = workspace.baseDir().endsWith(".workflow-harness")
    ? dirname(workspace.baseDir())
    : workspace.baseDir()
  const gitignoreFile = join(workspaceRoot, ".gitignore")
  const gitignoreContent = await readTextIfExists(gitignoreFile)
  const hasGitignoreRule = gitignoreContent ? gitignoreHasWorkflowHarness(gitignoreContent) : false

  checks.push({
    name: "project-workflow-config",
    status: (await fileExists(projectConfigFile)) ? "ok" : "warning",
    detail: projectConfigFile,
  })
  checks.push({
    name: "global-workflow-config",
    status: hasGlobalConfig ? "ok" : "warning",
    detail: globalConfigFile,
  })
  checks.push({
    name: "skill-roots",
    status: resolvedConfig.skillRoots.length > 0 ? "ok" : "warning",
    detail: resolvedConfig.skillRoots.length > 0 ? resolvedConfig.skillRoots.join(", ") : "No skillRoots configured",
  })
  checks.push({
    name: "required-skills",
    status: missingSkills.length === 0 ? "ok" : "error",
    detail: missingSkills.length === 0
      ? "All required skills resolved"
      : missingSkills.map((entry) => `${entry.phase}:${entry.skill}`).join(", "),
  })
  checks.push({
    name: "gitignore-workflow-harness",
    status: hasGitignoreRule ? "ok" : "warning",
    detail: hasGitignoreRule
      ? ".workflow-harness runtime files are ignored"
      : "Recommend ignoring .workflow-harness/ or at least runtime subpaths such as workflows/ and plugin-load.json",
  })

  const nextSteps: string[] = []
  if (!(await fileExists(projectConfigFile))) {
    nextSteps.push(`Run installer to generate project ${AUTOPILOT_CONFIG_FILENAME}: ${projectConfigFile}`)
  }
  if (resolvedConfig.skillRoots.length === 0) {
    nextSteps.push(`Add skillRoots to ${AUTOPILOT_CONFIG_FILENAME} if you want phase skill injection`)
  }
  if (missingSkills.length > 0) {
    nextSteps.push("Fix missing requiredSkills or add corresponding skill files under configured skillRoots")
  }
  if (!hasGlobalConfig) {
    nextSteps.push(`Optional: create global workflow defaults at ${globalConfigFile}`)
  }
  if (!hasGitignoreRule) {
    nextSteps.push("Consider ignoring .workflow-harness/ runtime files to avoid accidental commits")
  }

  const ok = checks.every((check) => check.status !== "error")

  return {
    ok,
    globalConfigFile,
    projectConfigFile,
    skillRoots: resolvedConfig.skillRoots,
    requiredSkills,
    missingSkills,
    checks,
    nextSteps,
    warnings,
  }
}
