import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { buildSkillRegistry, buildSkillRegistryWithWarnings, resolveSkillPaths } from "../packages/runtime/src/config/skill-registry"
import { AUTOPILOT_CONFIG_FILENAME, resolveWorkflowConfig } from "../packages/runtime/src/config/workflow-config"

describe("workflow config and skill registry", () => {
  it("merges global and project autopilot.json with project override", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "workflow-config-"))
    const homeDir = join(tempRoot, "home")
    const projectDir = join(tempRoot, "project")
    const projectHarnessDir = join(projectDir, ".workflow-harness")

    await mkdir(join(homeDir, ".config", "opencode"), { recursive: true })
    await mkdir(projectHarnessDir, { recursive: true })

    await writeFile(
      join(homeDir, ".config", "opencode", AUTOPILOT_CONFIG_FILENAME),
      JSON.stringify({
        skillRoots: ["~/.claude/skills"],
        phases: {
          develop: { requiredSkills: ["frontend-design"] },
        },
      }, null, 2),
    )

    await writeFile(
      join(projectHarnessDir, AUTOPILOT_CONFIG_FILENAME),
      JSON.stringify({
        skillRoots: ["./project-skills"],
        phases: {
          test: { requiredSkills: ["playwright"] },
        },
      }, null, 2),
    )

    const resolved = await resolveWorkflowConfig({
      projectConfigFile: join(projectHarnessDir, AUTOPILOT_CONFIG_FILENAME),
      homeDir,
    })

    expect(resolved.skillRoots).toEqual(["~/.claude/skills", "./project-skills"])
    expect(resolved.phases.develop?.requiredSkills).toEqual(["frontend-design"])
    expect(resolved.phases.test?.requiredSkills).toEqual(["playwright"])
    expect(resolved.warnings).toEqual([])

    await rm(tempRoot, { recursive: true, force: true })
  })

  it("builds skill registry from single-file and directory skills", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "workflow-skills-"))
    const skillRoot = join(tempRoot, "skills")
    await mkdir(join(skillRoot, "playwright"), { recursive: true })
    await writeFile(join(skillRoot, "frontend-design.md"), "# frontend-design\n")
    await writeFile(join(skillRoot, "playwright", "SKILL.md"), "# playwright\n")

    const registry = await buildSkillRegistry([skillRoot])
    const resolved = resolveSkillPaths(registry, ["frontend-design", "playwright", "missing-skill"])

    expect(registry.get("frontend-design")).toBe(join(skillRoot, "frontend-design.md"))
    expect(registry.get("playwright")).toBe(join(skillRoot, "playwright", "SKILL.md"))
    expect(resolved).toEqual([
      { name: "frontend-design", path: join(skillRoot, "frontend-design.md") },
      { name: "playwright", path: join(skillRoot, "playwright", "SKILL.md") },
    ])

    await rm(tempRoot, { recursive: true, force: true })
  })

  it("reports warnings for unreadable roots and duplicate skill names", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "workflow-skill-warnings-"))
    const rootA = join(tempRoot, "skills-a")
    const rootB = join(tempRoot, "skills-b")
    await mkdir(rootA, { recursive: true })
    await mkdir(rootB, { recursive: true })
    await writeFile(join(rootA, "dup.md"), "# dup from a\n")
    await writeFile(join(rootB, "dup.md"), "# dup from b\n")

    const result = await buildSkillRegistryWithWarnings([join(tempRoot, "missing-root"), rootA, rootB])

    expect(result.warnings.some((warning) => warning.includes("Skill root not found or unreadable"))).toBe(true)
    expect(result.warnings.some((warning) => warning.includes("Duplicate skill name detected: dup"))).toBe(true)
    expect(result.registry.get("dup")).toBe(join(rootB, "dup.md"))

    await rm(tempRoot, { recursive: true, force: true })
  })
})
