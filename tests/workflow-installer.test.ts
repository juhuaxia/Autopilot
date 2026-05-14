import { describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { runWorkflowInstall } from "../packages/runtime/src/install/workflow-installer"

describe("workflow installer", () => {
  it("creates project autopilot.json and opencode config when absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "workflow-install-"))
    const home = join(root, "home")
    const repo = join(root, "repo")
    await mkdir(repo, { recursive: true })

    const result = await runWorkflowInstall({ cwd: repo, homeDir: home })

    expect(result.ok).toBe(true)
    const workflowJson = JSON.parse(await readFile(join(repo, ".workflow-harness", "autopilot.json"), "utf8")) as Record<string, unknown>
    const opencodeJson = JSON.parse(await readFile(join(home, ".config", "opencode", "opencode.json"), "utf8")) as { plugin?: string[] }
    expect(workflowJson).toHaveProperty("skillRoots")
    expect(opencodeJson.plugin).toContain(`file://${join(repo, "dist", "plugin.js")}`)

    await rm(root, { recursive: true, force: true })
  })

  it("is idempotent when plugin entry already exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "workflow-install-idempotent-"))
    const home = join(root, "home")
    const repo = join(root, "repo")
    await mkdir(join(home, ".config", "opencode"), { recursive: true })
    await mkdir(repo, { recursive: true })

    const pluginEntry = `file://${join(repo, "dist", "plugin.js")}`
    await writeFile(
      join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ plugin: [pluginEntry] }, null, 2),
    )

    const result = await runWorkflowInstall({ cwd: repo, homeDir: home })
    const opencodeJson = JSON.parse(await readFile(join(home, ".config", "opencode", "opencode.json"), "utf8")) as { plugin?: string[] }

    expect(result.ok).toBe(true)
    expect(opencodeJson.plugin).toEqual([pluginEntry])

    await rm(root, { recursive: true, force: true })
  })

  it("removes stale autopilot file entries when npm package entry already exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "workflow-install-dedupe-autopilot-"))
    const home = join(root, "home")
    const repo = join(root, "repo")
    await mkdir(join(home, ".config", "opencode"), { recursive: true })
    await mkdir(repo, { recursive: true })

    await writeFile(
      join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({
        plugin: [
          "@fkqfkq123/opencode-autopilot",
          `file://${join(root, "tmp-a", "dist", "plugin.js")}`,
          `file://${join(root, "tmp-b", "dist", "plugin.js")}`,
          "other-plugin",
        ],
      }, null, 2),
    )
    await mkdir(join(root, "tmp-a", "dist"), { recursive: true })
    await mkdir(join(root, "tmp-b", "dist"), { recursive: true })
    await writeFile(join(root, "tmp-a", "dist", "plugin.js"), "export default {}\n")
    await writeFile(join(root, "tmp-b", "dist", "plugin.js"), "export default {}\n")
    await writeFile(join(root, "tmp-a", "dist", "package.json"), JSON.stringify({ name: "@fkqfkq123/opencode-autopilot" }, null, 2))
    await writeFile(join(root, "tmp-b", "dist", "package.json"), JSON.stringify({ name: "@fkqfkq123/opencode-autopilot" }, null, 2))

    const result = await runWorkflowInstall({ cwd: repo, homeDir: home })
    const opencodeJson = JSON.parse(await readFile(join(home, ".config", "opencode", "opencode.json"), "utf8")) as { plugin?: string[] }

    expect(result.ok).toBe(true)
    expect(opencodeJson.plugin).toEqual(["other-plugin", "@fkqfkq123/opencode-autopilot"])

    await rm(root, { recursive: true, force: true })
  })

  it("fails safely when existing opencode config is not valid json", async () => {
    const root = await mkdtemp(join(tmpdir(), "workflow-install-invalid-json-"))
    const home = join(root, "home")
    const repo = join(root, "repo")
    await mkdir(join(home, ".config", "opencode"), { recursive: true })
    await mkdir(repo, { recursive: true })
    await writeFile(join(home, ".config", "opencode", "opencode.json"), "{ invalid json\n")

    const result = await runWorkflowInstall({ cwd: repo, homeDir: home })

    expect(result.ok).toBe(false)
    expect(result.warnings.some((warning) => warning.includes("Unable to safely update existing OpenCode config"))).toBe(true)

    await rm(root, { recursive: true, force: true })
  })

  it("reads existing opencode.jsonc and normalizes output into opencode.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "workflow-install-jsonc-"))
    const home = join(root, "home")
    const repo = join(root, "repo")
    await mkdir(join(home, ".config", "opencode"), { recursive: true })
    await mkdir(repo, { recursive: true })

    await writeFile(
      join(home, ".config", "opencode", "opencode.jsonc"),
      `// comment\n{\n  "plugin": []\n}\n`,
    )

    const result = await runWorkflowInstall({ cwd: repo, homeDir: home })
    const opencodeJson = JSON.parse(await readFile(join(home, ".config", "opencode", "opencode.json"), "utf8")) as { plugin?: string[] }

    expect(result.ok).toBe(true)
    expect(result.warnings.some((warning) => warning.includes("opencode.jsonc"))).toBe(true)
    expect(opencodeJson.plugin).toContain(`file://${join(repo, "dist", "plugin.js")}`)

    await rm(root, { recursive: true, force: true })
  })

  it("prefers opencode.json when both json and jsonc exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "workflow-install-both-configs-"))
    const home = join(root, "home")
    const repo = join(root, "repo")
    await mkdir(join(home, ".config", "opencode"), { recursive: true })
    await mkdir(repo, { recursive: true })

    await writeFile(join(home, ".config", "opencode", "opencode.json"), JSON.stringify({ plugin: [] }, null, 2))
    await writeFile(join(home, ".config", "opencode", "opencode.jsonc"), `// comment\n{\n  "plugin": []\n}\n`)

    const result = await runWorkflowInstall({ cwd: repo, homeDir: home })

    expect(result.ok).toBe(true)
    expect(result.warnings.some((warning) => warning.includes("Both opencode.json and opencode.jsonc exist"))).toBe(true)

    await rm(root, { recursive: true, force: true })
  })
})
