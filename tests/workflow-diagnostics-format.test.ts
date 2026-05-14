import { describe, expect, it } from "bun:test"
import { formatWorkflowDoctorResult, formatWorkflowInstallResult, formatWorkflowUpdateResult } from "../packages/runtime/src/diagnostics/workflow-diagnostics-format"

describe("workflow diagnostics formatters", () => {
  it("formats doctor result into human-readable text", () => {
    const output = formatWorkflowDoctorResult({
      ok: false,
      globalConfigFile: "/home/user/.config/opencode/autopilot.json",
      projectConfigFile: "/repo/.workflow-harness/autopilot.json",
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
      projectWorkflowConfigFile: "/repo/.workflow-harness/autopilot.json",
      opencodeConfigFile: "/home/user/.config/opencode/opencode.json",
      pluginEntry: "file:///repo/plugin.ts",
      warnings: [],
    })

    expect(output).toContain("Workflow Install: OK")
    expect(output).toContain("Project autopilot.json")
    expect(output).toContain("Recommended next steps:")
  })

  it("formats update result into human-readable text", () => {
    const output = formatWorkflowUpdateResult({
      ok: true,
      mode: "release-file",
      opencodeConfigFile: "/home/user/.config/opencode/opencode.json",
      resolvedConfigSourceFile: "/home/user/.config/opencode/opencode.json",
      pluginEntry: "file:///home/user/.config/opencode/plugins/autopilot/plugin.js",
      detectedPluginEntries: ["file:///home/user/.config/opencode/plugins/autopilot/plugin.js"],
      ignoredPluginEntries: ["@fkqfkq123/opencode-autopilot"],
      previousVersion: "0.1.9",
      currentVersion: "0.1.9",
      latestVersion: "0.1.10",
      updated: true,
      restartRequired: true,
      warnings: [],
      nextSteps: ["Restart OpenCode so it reloads the updated plugin files."],
    })

    expect(output).toContain("Workflow Update: OK")
    expect(output).toContain("Mode: release-file")
    expect(output).toContain("Resolved config source: /home/user/.config/opencode/opencode.json")
    expect(output).toContain("Previous version: 0.1.9")
    expect(output).toContain("Detected plugin entries:")
    expect(output).toContain("Ignored plugin entries:")
    expect(output).toContain("Latest version: 0.1.10")
    expect(output).toContain("Restart required: yes")
    expect(output).toContain("Recommended next steps:")
  })
})
