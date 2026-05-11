import type { WorkflowDoctorResult } from "./workflow-doctor"
import type { WorkflowInstallResult } from "../install/workflow-installer"
import { AUTOPILOT_CONFIG_FILENAME } from "../config/workflow-config"

const divider = "=".repeat(64)

export function formatWorkflowDoctorResult(result: WorkflowDoctorResult): string {
  const lines = [
    divider,
    `Workflow Doctor: ${result.ok ? "OK" : "ATTENTION"}`,
    `Project config: ${result.projectConfigFile}`,
    `Global config: ${result.globalConfigFile}`,
  ]

  lines.push("")
  lines.push("Checks:")
  for (const check of result.checks) {
    const marker = check.status === "ok" ? "[ok]" : check.status === "warning" ? "[warn]" : "[error]"
    lines.push(`${marker} ${check.name}: ${check.detail}`)
  }

  lines.push("")
  lines.push("Required skills:")
  if (result.requiredSkills.length === 0) {
    lines.push("- none")
  } else {
    for (const entry of result.requiredSkills) {
      lines.push(`- ${entry.phase}: ${entry.skills.join(", ")}`)
    }
  }

  if (result.missingSkills.length > 0) {
    lines.push("")
    lines.push("Missing skills:")
    for (const entry of result.missingSkills) {
      lines.push(`- ${entry.phase}: ${entry.skill}`)
    }
  }

  if (result.nextSteps.length > 0) {
    lines.push("")
    lines.push("Next steps:")
    for (const step of result.nextSteps) {
      lines.push(`- ${step}`)
    }
  }

  if (result.warnings.length > 0) {
    lines.push("")
    lines.push("Warnings:")
    for (const warning of result.warnings) {
      lines.push(`- ${warning}`)
    }
  }

  lines.push(divider)
  return lines.join("\n")
}

export function formatWorkflowInstallResult(result: WorkflowInstallResult): string {
  const lines = [
    divider,
    `Workflow Install: ${result.ok ? "OK" : "ATTENTION"}`,
    `Project ${AUTOPILOT_CONFIG_FILENAME}: ${result.projectWorkflowConfigFile}`,
    `OpenCode config: ${result.opencodeConfigFile}`,
    `Plugin entry: ${result.pluginEntry}`,
  ]

  if (result.warnings.length > 0) {
    lines.push("")
    lines.push("Warnings:")
    for (const warning of result.warnings) {
      lines.push(`- ${warning}`)
    }
  }

  lines.push("")
  lines.push("Recommended next steps:")
  lines.push("- Run: bun run src/cli.ts doctor")
  lines.push("- Then open OpenCode and use workflow_open / workflow_attach")
  lines.push(divider)
  return lines.join("\n")
}
