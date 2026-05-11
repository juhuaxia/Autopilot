import { describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createHarness } from "../packages/runtime/src/bootstrap/create-harness"
import { runWorkflowDoctor } from "../packages/runtime/src/diagnostics/workflow-doctor"

describe("workflow doctor", () => {
  it("reports missing config and missing skills without throwing", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-doctor-"))
    const homeDir = join(baseDir, "home")
    await mkdir(join(homeDir, ".config", "opencode"), { recursive: true })
    const harness = await createHarness(baseDir, { homeDir })

    const result = await runWorkflowDoctor(harness.workspace, { homeDir })

    expect(result.ok).toBe(true)
    expect(result.projectConfigFile).toContain("autopilot.json")
    expect(Array.isArray(result.checks)).toBe(true)
    expect(Array.isArray(result.nextSteps)).toBe(true)
    expect(Array.isArray(result.warnings)).toBe(true)

    await rm(baseDir, { recursive: true, force: true })
  })

  it("reports resolved skills and missing skill warnings", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-doctor-skill-"))
    const homeDir = join(baseDir, "home")
    const skillRoot = join(baseDir, "skills")
    await mkdir(join(homeDir, ".config", "opencode"), { recursive: true })
    await mkdir(skillRoot, { recursive: true })
    await writeFile(join(skillRoot, "frontend-design.md"), "# frontend-design\n")
    await writeFile(
      join(baseDir, "autopilot.json"),
      JSON.stringify({
        skillRoots: [skillRoot],
        phases: {
          develop: { requiredSkills: ["frontend-design", "missing-skill"] },
        },
      }, null, 2),
    )

    const harness = await createHarness(baseDir, { homeDir })
    const result = await runWorkflowDoctor(harness.workspace, { homeDir })

    expect(result.ok).toBe(false)
    expect(result.skillRoots).toContain(skillRoot)
    expect(result.requiredSkills).toEqual([{ phase: "develop", skills: ["frontend-design", "missing-skill"] }])
    expect(result.missingSkills).toEqual([{ phase: "develop", skill: "missing-skill" }])
    expect(result.checks.some((check) => check.name === "required-skills" && check.status === "error")).toBe(true)
    expect(result.nextSteps.some((step) => step.includes("Fix missing requiredSkills"))).toBe(true)
    expect(result.warnings.some((warning) => warning.includes("Missing skill for phase develop: missing-skill"))).toBe(true)

    await rm(baseDir, { recursive: true, force: true })
  })

  it("reports gitignore hygiene status", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-doctor-gitignore-"))
    const homeDir = join(baseDir, "home")
    await mkdir(join(homeDir, ".config", "opencode"), { recursive: true })
    await mkdir(join(baseDir, ".workflow-harness"), { recursive: true })
    await writeFile(join(baseDir, ".gitignore"), "dist/\n.workflow-harness/workflows/\n")

    const harness = await createHarness(baseDir, { homeDir })
    const result = await runWorkflowDoctor(harness.workspace, { homeDir })

    expect(result.checks.some((check) => check.name === "gitignore-workflow-harness" && check.status === "ok")).toBe(true)
    expect(result.nextSteps.some((step) => step.includes("Consider ignoring .workflow-harness/"))).toBe(false)

    await rm(baseDir, { recursive: true, force: true })
  })
})
