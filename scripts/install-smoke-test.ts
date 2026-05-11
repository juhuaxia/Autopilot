import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { runWorkflowInstall } from "../packages/runtime/src/install/workflow-installer"

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "workflow-install-smoke-"))
  const home = join(root, "home")
  const repo = join(root, "repo")

  try {
    const result = await runWorkflowInstall({ cwd: repo, homeDir: home })
    if (!result.ok) {
      throw new Error(`Install failed: ${result.warnings.join("; ")}`)
    }

    const opencodeConfigPath = join(home, ".config", "opencode", "opencode.json")
    const opencodeConfig = JSON.parse(await readFile(opencodeConfigPath, "utf8")) as { plugin?: string[] }
    const expectedPluginEntry = `file://${join(repo, "dist", "plugin.js")}`

    if (!opencodeConfig.plugin?.includes(expectedPluginEntry)) {
      throw new Error(`Missing plugin entry: ${expectedPluginEntry}`)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

void main()
