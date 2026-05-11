import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createHarness } from "../packages/runtime/src/bootstrap/create-harness"
import { AUTOPILOT_CONFIG_FILENAME, DEFAULT_SKILL_ROOTS, resolveWorkflowConfig } from "../packages/runtime/src/config/workflow-config"

describe("autopilot config migration and defaults", () => {
  it("restores default skill roots in generated config", async () => {
    expect(DEFAULT_SKILL_ROOTS).toEqual(["~/.claude/skills", "~/.config/opencode/skills"])
  })

  it("reads legacy workflow.json when autopilot.json is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "workflow-config-legacy-"))
    const home = join(root, "home")
    const projectDir = join(root, "project")
    const harnessDir = join(projectDir, ".workflow-harness")
    await mkdir(join(home, ".config", "opencode"), { recursive: true })
    await mkdir(harnessDir, { recursive: true })

    await writeFile(
      join(home, ".config", "opencode", "workflow.json"),
      JSON.stringify({ skillRoots: ["~/.legacy/skills"] }, null, 2),
    )
    await writeFile(
      join(harnessDir, "workflow.json"),
      JSON.stringify({ phases: { develop: { requiredSkills: ["legacy-skill"] } } }, null, 2),
    )

    try {
      const resolved = await resolveWorkflowConfig({
        projectConfigFile: join(harnessDir, AUTOPILOT_CONFIG_FILENAME),
        homeDir: home,
      })

      expect(resolved.skillRoots).toContain("~/.legacy/skills")
      expect(resolved.phases.develop?.requiredSkills).toEqual(["legacy-skill"])
      expect(resolved.warnings.some((warning) => warning.includes("legacy workflow.json"))).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("auto-creates autopilot.json from legacy workflow.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "workflow-config-autocreate-"))
    const harnessDir = join(root, ".workflow-harness")
    await mkdir(harnessDir, { recursive: true })
    await writeFile(
      join(harnessDir, "workflow.json"),
      JSON.stringify({ skillRoots: ["./legacy-skills"] }, null, 2),
    )

    try {
      await createHarness(harnessDir)
      const configFile = join(harnessDir, AUTOPILOT_CONFIG_FILENAME)
      const content = await Bun.file(configFile).json() as { skillRoots?: string[] }

      expect(content.skillRoots).toEqual(["./legacy-skills"])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("reports warnings when autopilot.json contains invalid JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "workflow-config-invalid-"))
    const home = join(root, "home")
    const projectDir = join(root, "project")
    const harnessDir = join(projectDir, ".workflow-harness")
    await mkdir(join(home, ".config", "opencode"), { recursive: true })
    await mkdir(harnessDir, { recursive: true })

    await writeFile(join(harnessDir, AUTOPILOT_CONFIG_FILENAME), "{ invalid json")

    try {
      const resolved = await resolveWorkflowConfig({
        projectConfigFile: join(harnessDir, AUTOPILOT_CONFIG_FILENAME),
        homeDir: home,
      })

      expect(resolved.warnings.some((warning) => warning.includes("invalid JSON"))).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
