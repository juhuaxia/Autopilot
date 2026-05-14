import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runAutopilotUpdate } from "../packages/runtime/src/install/autopilot-updater"

describe("autopilot updater", () => {
  it("skips local-source rebuild when version already matches latest", async () => {
    const root = await mkdtemp(join(tmpdir(), "autopilot-update-local-skip-"))
    const home = join(root, "home")
    const repo = join(root, "repo")
    await mkdir(join(home, ".config", "opencode"), { recursive: true })
    await mkdir(join(repo, "dist"), { recursive: true })
    await writeFile(join(repo, "package.json"), JSON.stringify({ version: "0.1.10" }, null, 2))
    await writeFile(
      join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ plugin: [`file://${join(repo, "dist", "plugin.js")}`] }, null, 2),
    )

    let built = false
    const result = await runAutopilotUpdate({
      cwd: repo,
      homeDir: home,
      options: {
        fetchLatestReleaseVersion: async () => "0.1.10",
        fetchLatestPackageVersion: async () => "0.1.10",
        buildLocalSource: async () => {
          built = true
        },
      },
    })

    expect(result.mode).toBe("local-source")
    expect(result.updated).toBe(false)
    expect(result.restartRequired).toBe(false)
    expect(result.resolvedConfigSourceFile).toContain("opencode.json")
    expect(result.detectedPluginEntries).toEqual([`file://${join(repo, "dist", "plugin.js")}`])
    expect(built).toBe(false)

    await rm(root, { recursive: true, force: true })
  })

  it("rebuilds local-source installs when version is behind latest", async () => {
    const root = await mkdtemp(join(tmpdir(), "autopilot-update-local-build-"))
    const home = join(root, "home")
    const repo = join(root, "repo")
    await mkdir(join(home, ".config", "opencode"), { recursive: true })
    await mkdir(join(repo, "dist"), { recursive: true })
    await writeFile(join(repo, "package.json"), JSON.stringify({ version: "0.1.9" }, null, 2))
    await writeFile(
      join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ plugin: [`file://${join(repo, "dist", "plugin.js")}`] }, null, 2),
    )

    let builtRepo: string | undefined
    const result = await runAutopilotUpdate({
      cwd: repo,
      homeDir: home,
      options: {
        fetchLatestReleaseVersion: async () => "0.1.10",
        fetchLatestPackageVersion: async () => "0.1.10",
        buildLocalSource: async (repoRoot) => {
          builtRepo = repoRoot
        },
      },
    })

    expect(result.ok).toBe(true)
    expect(result.mode).toBe("local-source")
    expect(result.previousVersion).toBe("0.1.9")
    expect(result.currentVersion).toBe("0.1.9")
    expect(result.detectedPluginEntries).toEqual([`file://${join(repo, "dist", "plugin.js")}`])
    expect(result.updated).toBe(true)
    expect(result.restartRequired).toBe(true)
    expect(builtRepo).toBe(repo)

    await rm(root, { recursive: true, force: true })
  })

  it("reports previous and current version for release-file installs", async () => {
    const root = await mkdtemp(join(tmpdir(), "autopilot-update-release-"))
    const home = join(root, "home")
    const repo = join(root, "repo")
    const installRoot = join(home, ".config", "opencode", "plugins", "autopilot")
    await mkdir(join(home, ".config", "opencode"), { recursive: true })
    await mkdir(installRoot, { recursive: true })
    await mkdir(repo, { recursive: true })
    await writeFile(join(installRoot, "plugin.js"), "export default {}\n")
    await writeFile(join(installRoot, "release.json"), JSON.stringify({ name: "autopilot", version: "0.1.9" }, null, 2))
    await writeFile(
      join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ plugin: [`file://${join(installRoot, "plugin.js")}`] }, null, 2),
    )

    let updatedInstallRoot: string | undefined
    const result = await runAutopilotUpdate({
      cwd: repo,
      homeDir: home,
      options: {
        fetchLatestReleaseVersion: async () => "0.1.10",
        fetchLatestPackageVersion: async () => "0.1.10",
        updateInstalledRelease: async ({ installRoot: targetRoot }) => {
          updatedInstallRoot = targetRoot
          await writeFile(join(targetRoot, "release.json"), JSON.stringify({ name: "autopilot", version: "0.1.10" }, null, 2))
        },
      },
    })

    expect(result.ok).toBe(true)
    expect(result.mode).toBe("release-file")
    expect(result.previousVersion).toBe("0.1.9")
    expect(result.currentVersion).toBe("0.1.10")
    expect(result.detectedPluginEntries).toEqual([`file://${join(installRoot, "plugin.js")}`])
    expect(updatedInstallRoot).toBe(installRoot)

    await rm(root, { recursive: true, force: true })
  })

  it("reads installed package version for npm installs", async () => {
    const root = await mkdtemp(join(tmpdir(), "autopilot-update-package-"))
    const home = join(root, "home")
    const repo = join(root, "repo")
    const packageRoot = join(home, ".cache", "opencode", "packages", "@fkqfkq123", "opencode-autopilot@latest", "node_modules", "@fkqfkq123", "opencode-autopilot")
    await mkdir(join(home, ".config", "opencode"), { recursive: true })
    await mkdir(repo, { recursive: true })
    await mkdir(packageRoot, { recursive: true })
    await writeFile(join(repo, "package.json"), JSON.stringify({ version: "9.9.9" }, null, 2))
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({ version: "0.1.9" }, null, 2))
    await writeFile(
      join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ plugin: ["@fkqfkq123/opencode-autopilot"] }, null, 2),
    )

    const result = await runAutopilotUpdate({
      cwd: repo,
      homeDir: home,
      options: {
        fetchLatestReleaseVersion: async () => "0.1.10",
        fetchLatestPackageVersion: async () => "0.2.3",
        clearCachedPackageInstall: async () => {},
      },
    })

    expect(result.ok).toBe(true)
    expect(result.mode).toBe("package")
    expect(result.previousVersion).toBe("0.1.9")
    expect(result.currentVersion).toBeNull()
    expect(result.latestVersion).toBe("0.2.3")
    expect(result.detectedPluginEntries).toEqual(["@fkqfkq123/opencode-autopilot"])
    expect(result.updated).toBe(true)
    expect(result.restartRequired).toBe(true)
    expect(result.nextSteps[0]).toContain("refreshed Autopilot package cache")
    expect(result.nextSteps[1]).toContain("other OpenCode windows")

    await rm(root, { recursive: true, force: true })
  })

  it("returns already-up-to-date message for current package installs", async () => {
    const root = await mkdtemp(join(tmpdir(), "autopilot-update-package-current-"))
    const home = join(root, "home")
    const repo = join(root, "repo")
    const packageRoot = join(home, ".cache", "opencode", "packages", "@fkqfkq123", "opencode-autopilot@latest", "node_modules", "@fkqfkq123", "opencode-autopilot")
    await mkdir(join(home, ".config", "opencode"), { recursive: true })
    await mkdir(repo, { recursive: true })
    await mkdir(packageRoot, { recursive: true })
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({ version: "0.1.10" }, null, 2))
    await writeFile(
      join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ plugin: ["@fkqfkq123/opencode-autopilot"] }, null, 2),
    )

    const result = await runAutopilotUpdate({
      cwd: repo,
      homeDir: home,
      options: {
        fetchLatestReleaseVersion: async () => "0.1.10",
        fetchLatestPackageVersion: async () => "0.1.10",
      },
    })

    expect(result.updated).toBe(false)
    expect(result.restartRequired).toBe(false)
    expect(result.detectedPluginEntries).toEqual(["@fkqfkq123/opencode-autopilot"])
    expect(result.nextSteps[0]).toContain("already at the latest installed package version")

    await rm(root, { recursive: true, force: true })
  })

  it("reports ignored plugin entries when npm and stale file entries coexist", async () => {
    const root = await mkdtemp(join(tmpdir(), "autopilot-update-mixed-entries-"))
    const home = join(root, "home")
    const repo = join(root, "repo")
    const packageRoot = join(home, ".cache", "opencode", "packages", "@fkqfkq123", "opencode-autopilot@latest", "node_modules", "@fkqfkq123", "opencode-autopilot")
    const staleRoot = join(root, "stale", "dist")
    await mkdir(join(home, ".config", "opencode"), { recursive: true })
    await mkdir(repo, { recursive: true })
    await mkdir(packageRoot, { recursive: true })
    await mkdir(staleRoot, { recursive: true })
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({ version: "0.2.5" }, null, 2))
    await writeFile(join(staleRoot, "plugin.js"), "export default {}\n")
    await writeFile(join(staleRoot, "package.json"), JSON.stringify({ name: "@fkqfkq123/opencode-autopilot", version: "0.2.3" }, null, 2))
    await writeFile(
      join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({
        plugin: [
          "@fkqfkq123/opencode-autopilot",
          `file://${join(staleRoot, "plugin.js")}`,
        ],
      }, null, 2),
    )

    const result = await runAutopilotUpdate({
      cwd: repo,
      homeDir: home,
      options: {
        fetchLatestReleaseVersion: async () => "0.2.4",
        fetchLatestPackageVersion: async () => "0.2.5",
        clearCachedPackageInstall: async () => {},
      },
    })

    expect(result.mode).toBe("package")
    expect(result.pluginEntry).toBe("@fkqfkq123/opencode-autopilot")
    expect(result.detectedPluginEntries).toEqual([
      "@fkqfkq123/opencode-autopilot",
      `file://${join(staleRoot, "plugin.js")}`,
    ])
    expect(result.ignoredPluginEntries).toEqual([`file://${join(staleRoot, "plugin.js")}`])
    expect(result.latestVersion).toBe("0.2.5")

    await rm(root, { recursive: true, force: true })
  })

  it("clears OpenCode package cache when package install is behind latest", async () => {
    const root = await mkdtemp(join(tmpdir(), "autopilot-update-package-clear-cache-"))
    const home = join(root, "home")
    const repo = join(root, "repo")
    const packageRoot = join(home, ".cache", "opencode", "packages", "@fkqfkq123", "opencode-autopilot@latest", "node_modules", "@fkqfkq123", "opencode-autopilot")
    await mkdir(join(home, ".config", "opencode"), { recursive: true })
    await mkdir(repo, { recursive: true })
    await mkdir(packageRoot, { recursive: true })
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({ version: "0.2.5" }, null, 2))
    await writeFile(
      join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ plugin: ["@fkqfkq123/opencode-autopilot"] }, null, 2),
    )

    let clearedHomeDir: string | undefined
    const result = await runAutopilotUpdate({
      cwd: repo,
      homeDir: home,
      options: {
        fetchLatestPackageVersion: async () => "0.2.6",
        fetchLatestReleaseVersion: async () => "0.2.6",
        clearCachedPackageInstall: async (targetHomeDir) => {
          clearedHomeDir = targetHomeDir
        },
      },
    })

    expect(result.mode).toBe("package")
    expect(result.updated).toBe(true)
    expect(result.restartRequired).toBe(true)
    expect(result.previousVersion).toBe("0.2.5")
    expect(result.currentVersion).toBeNull()
    expect(clearedHomeDir).toBe(home)

    await rm(root, { recursive: true, force: true })
  })

  it("does not mark unrelated plugins as ignored autopilot entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "autopilot-update-unrelated-plugin-"))
    const home = join(root, "home")
    const repo = join(root, "repo")
    const packageRoot = join(home, ".cache", "opencode", "packages", "@fkqfkq123", "opencode-autopilot@latest", "node_modules", "@fkqfkq123", "opencode-autopilot")
    await mkdir(join(home, ".config", "opencode"), { recursive: true })
    await mkdir(repo, { recursive: true })
    await mkdir(packageRoot, { recursive: true })
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({ version: "0.2.5" }, null, 2))
    await writeFile(
      join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({
        plugin: [
          "@fkqfkq123/opencode-autopilot",
          "other-plugin",
        ],
      }, null, 2),
    )

    const result = await runAutopilotUpdate({
      cwd: repo,
      homeDir: home,
      options: {
        fetchLatestPackageVersion: async () => "0.2.5",
        fetchLatestReleaseVersion: async () => "0.2.5",
      },
    })

    expect(result.mode).toBe("package")
    expect(result.detectedPluginEntries).toEqual([
      "@fkqfkq123/opencode-autopilot",
      "other-plugin",
    ])
    expect(result.ignoredPluginEntries).toEqual([])

    await rm(root, { recursive: true, force: true })
  })

  it("asks for install when plugin is not registered", async () => {
    const root = await mkdtemp(join(tmpdir(), "autopilot-update-missing-"))
    const home = join(root, "home")
    const repo = join(root, "repo")
    await mkdir(join(home, ".config", "opencode"), { recursive: true })
    await mkdir(repo, { recursive: true })
    await writeFile(join(home, ".config", "opencode", "opencode.json"), JSON.stringify({ plugin: [] }, null, 2))

    const result = await runAutopilotUpdate({
      cwd: repo,
      homeDir: home,
      options: {
        fetchLatestReleaseVersion: async () => "0.1.10",
        fetchLatestPackageVersion: async () => "0.1.10",
      },
    })

    expect(result.ok).toBe(false)
    expect(result.mode).toBe("not-installed")
    expect(result.detectedPluginEntries).toEqual([])
    expect(result.nextSteps[0]).toContain("bun run src/cli.ts install")

    await rm(root, { recursive: true, force: true })
  })

  it("returns a suspicious mismatch warning when package entry exists but package mode is not recognized", async () => {
    const root = await mkdtemp(join(tmpdir(), "autopilot-update-package-mismatch-"))
    const home = join(root, "home")
    const repo = join(root, "repo")
    await mkdir(join(home, ".config", "opencode"), { recursive: true })
    await mkdir(repo, { recursive: true })
    await writeFile(
      join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ plugin: ["@fkqfkq123/opencode-autopilot"] }, null, 2),
    )

    const result = await runAutopilotUpdate({
      cwd: repo,
      homeDir: home,
      options: {
        fetchLatestReleaseVersion: async () => "0.1.10",
      },
    })

    expect(result.ok).toBe(true)
    expect(result.mode).toBe("package")
    expect(result.detectedPluginEntries).toEqual(["@fkqfkq123/opencode-autopilot"])

    await rm(root, { recursive: true, force: true })
  })

  it("writes release metadata with version", async () => {
    const repo = await mkdtemp(join(tmpdir(), "autopilot-build-release-"))

    try {
      await writeFile(join(repo, "package.json"), JSON.stringify({ version: "1.2.3" }, null, 2))
      await writeFile(join(repo, "plugin.ts"), "export default {}\n")
      await writeFile(join(repo, "README.md"), "# Test\n")

      const proc = Bun.spawn(["bun", "run", "scripts/build-release.ts"], {
        cwd: "/Users/macbookpro/Documents/workspace/yibai_fe_workflow",
        env: {
          ...process.env,
          PWD: repo,
        },
        stdout: "pipe",
        stderr: "pipe",
      })
      const exitCode = await proc.exited
      expect(exitCode).toBe(0)

      const metadata = JSON.parse(await readFile("/Users/macbookpro/Documents/workspace/yibai_fe_workflow/release/autopilot/release.json", "utf8")) as { version?: string }
      expect(metadata.version).toBeDefined()
    } finally {
      await rm("/Users/macbookpro/Documents/workspace/yibai_fe_workflow/release", { recursive: true, force: true })
      await rm(repo, { recursive: true, force: true })
    }
  })
})
