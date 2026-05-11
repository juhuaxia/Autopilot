import { describe, expect, it } from "bun:test"
import { formatWorkflowDoctorResult, formatWorkflowInstallResult } from "../packages/runtime/src/diagnostics/workflow-diagnostics-format"

describe("workflow diagnostics formatters", () => {
  it("formats doctor result into human-readable text", () => {
    const output = formatWorkflowDoctorResult({
      ok: false,
      globalConfigFile: "/home/user/.config/opencode/workflow.json",
      projectConfigFile: "/repo/.workflow-harness/workflow.json",
      skillRoots: ["~/.claude/skills"],
      requiredSkills: [{ phase: "develop", skills: ["frontend-design"] }],
      missingSkills: [{ phase: "develop", skill: "frontend-design" }],
      checks: [{ name: "required-skills", status: "warning", detail: "develop:frontend-design" }],
      nextSteps: ["Fix missing requiredSkills"],
      warnings: ["Missing skill for phase develop: frontend-design"],
    })

    expect(output).toContain("Workflow Doctor: ATTENTION")
    expect(output).toContain("Checks:")
    expect(output).toContain("Missing skills:")
    expect(output).toContain("Next steps:")
  })

  it("formats install result into human-readable text", () => {
    const output = formatWorkflowInstallResult({
      ok: true,
      projectWorkflowConfigFile: "/repo/.workflow-harness/workflow.json",
      opencodeConfigFile: "/home/user/.config/opencode/opencode.json",
      pluginEntry: "file:///repo/plugin.ts",
      warnings: [],
    })

    expect(output).toContain("Workflow Install: OK")
    expect(output).toContain("Project workflow.json")
    expect(output).toContain("Recommended next steps:")
  })
})
