import { cp, mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { isAutopilotPluginEntry, resolveOpencodeConfigFile, stripJsonComments } from "./workflow-installer"

const PACKAGE_NAME = "@fkqfkq123/opencode-autopilot"
const RELEASE_REPO_SLUG = "juhuaxia/Autopilot"

export type AutopilotUpdateMode = "local-source" | "release-file" | "package" | "not-installed"

export type AutopilotUpdateResult = {
  ok: boolean
  mode: AutopilotUpdateMode
  opencodeConfigFile: string
  resolvedConfigSourceFile: string
  pluginEntry: string | null
  detectedPluginEntries: string[]
  ignoredPluginEntries: string[]
  previousVersion: string | null
  currentVersion: string | null
  latestVersion: string | null
  updated: boolean
  restartRequired: boolean
  warnings: string[]
  nextSteps: string[]
}

export type AutopilotUpdateOptions = {
  buildLocalSource?: (repoRoot: string) => Promise<void>
  fetchLatestReleaseVersion?: (repoSlug: string) => Promise<string | null>
  fetchLatestPackageVersion?: (packageName: string) => Promise<string | null>
  updateInstalledRelease?: (args: { installRoot: string; repoSlug: string }) => Promise<void>
  clearCachedPackageInstall?: (homeDir: string) => Promise<void>
}

type ParsedOpencodeConfig = {
  plugin?: unknown
}

type ResolvedPluginTarget =
  | { mode: "local-source"; pluginEntry: string; pluginFile: string }
  | { mode: "release-file"; pluginEntry: string; pluginFile: string }
  | { mode: "package"; pluginEntry: string }
  | { mode: "not-installed"; pluginEntry: null }

function extractPluginEntries(config: ParsedOpencodeConfig): string[] {
  return Array.isArray(config.plugin)
    ? config.plugin.filter((entry): entry is string => typeof entry === "string")
    : []
}

async function runCommand(command: string, args: string[], cwd?: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
    })

    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      reject(new Error(`Command failed: ${command} ${args.join(" ")}`))
    })
  })
}

async function buildLocalSource(repoRoot: string): Promise<void> {
  await runCommand("bun", ["run", "build"], repoRoot)
}

async function fetchLatestReleaseVersion(repoSlug: string): Promise<string | null> {
  const response = await fetch(`https://api.github.com/repos/${repoSlug}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
    },
  })

  if (!response.ok) {
    throw new Error(`Unable to fetch latest release metadata: ${response.status}`)
  }

  const parsed = await response.json() as { tag_name?: unknown; name?: unknown }
  const candidate = typeof parsed.tag_name === "string"
    ? parsed.tag_name
    : typeof parsed.name === "string"
      ? parsed.name
      : null
  return candidate ? candidate.replace(/^v/i, "") : null
}

async function fetchLatestPackageVersion(packageName: string): Promise<string | null> {
  const encodedName = packageName.replace("/", "%2F")
  const response = await fetch(`https://registry.npmjs.org/${encodedName}/latest`, {
    headers: {
      Accept: "application/json",
    },
  })

  if (!response.ok) {
    throw new Error(`Unable to fetch latest npm package metadata: ${response.status}`)
  }

  const parsed = await response.json() as { version?: unknown }
  return typeof parsed.version === "string" ? parsed.version : null
}

async function replaceDirectoryAtomically(args: { sourceRoot: string; targetRoot: string; scratchRoot: string }): Promise<void> {
  const backupRoot = join(args.scratchRoot, "previous-install")
  let movedExisting = false

  try {
    await rename(args.targetRoot, backupRoot)
    movedExisting = true
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code !== "ENOENT") {
      throw error
    }
  }

  try {
    await rename(args.sourceRoot, args.targetRoot)
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code !== "EXDEV") {
      if (movedExisting) {
        await rename(backupRoot, args.targetRoot)
      }
      throw error
    }

    await cp(args.sourceRoot, args.targetRoot, { recursive: true })
    await rm(args.sourceRoot, { recursive: true, force: true })
  }
}

async function updateInstalledRelease(args: { installRoot: string; repoSlug: string }): Promise<void> {
  const downloadUrl = `https://github.com/${args.repoSlug}/releases/latest/download/autopilot-release.tar.gz`
  const tempRoot = await mkdtemp(join(tmpdir(), "autopilot-update-"))
  const archivePath = join(tempRoot, "autopilot-release.tar.gz")
  const extractDir = join(tempRoot, "extract")

  try {
    const response = await fetch(downloadUrl)
    if (!response.ok) {
      throw new Error(`Unable to download latest release: ${response.status}`)
    }

    const archiveBuffer = Buffer.from(await response.arrayBuffer())
    await writeFile(archivePath, archiveBuffer)
    await mkdir(extractDir, { recursive: true })
    await runCommand("tar", ["-xzf", archivePath, "-C", extractDir])

    const extractedRoot = join(extractDir, "autopilot")
    await mkdir(dirname(args.installRoot), { recursive: true })
    await replaceDirectoryAtomically({
      sourceRoot: extractedRoot,
      targetRoot: args.installRoot,
      scratchRoot: tempRoot,
    })
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

function readVersionFromJson(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null
  }

  const version = (input as { version?: unknown }).version
  return typeof version === "string" ? version : null
}

async function readJsonFileIfExists(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(stripJsonComments(await readFile(filePath, "utf8"))) as unknown
  } catch {
    return null
  }
}

async function readPluginVersion(pluginFile: string): Promise<string | null> {
  const pluginRoot = dirname(pluginFile)
  const releaseMetadata = await readJsonFileIfExists(join(pluginRoot, "release.json"))
  const releaseVersion = readVersionFromJson(releaseMetadata)
  if (releaseVersion) {
    return releaseVersion
  }

  const packageMetadata = await readJsonFileIfExists(join(pluginRoot, "package.json"))
  return readVersionFromJson(packageMetadata)
}

async function readInstalledPackageVersion(repoRoot: string): Promise<string | null> {
  const packageJsonPath = join(repoRoot, "node_modules", ...PACKAGE_NAME.split("/"), "package.json")
  const packageMetadata = await readJsonFileIfExists(packageJsonPath)
  return readVersionFromJson(packageMetadata)
}

async function readOpencodeCachedPackageVersion(homeDir: string): Promise<string | null> {
  const scopedName = PACKAGE_NAME.split("/")[0]
  const unscopedName = PACKAGE_NAME.split("/")[1]
  if (!scopedName || !unscopedName) {
    return null
  }

  const cacheRoot = join(
    homeDir,
    ".cache",
    "opencode",
    "packages",
    scopedName,
    `${unscopedName}@latest`,
    "node_modules",
    ...PACKAGE_NAME.split("/"),
    "package.json",
  )
  const packageMetadata = await readJsonFileIfExists(cacheRoot)
  return readVersionFromJson(packageMetadata)
}

async function clearCachedPackageInstall(homeDir: string): Promise<void> {
  const scopedName = PACKAGE_NAME.split("/")[0]
  const unscopedName = PACKAGE_NAME.split("/")[1]
  if (!scopedName || !unscopedName) {
    return
  }

  const cacheRoot = join(
    homeDir,
    ".cache",
    "opencode",
    "packages",
    scopedName,
    `${unscopedName}@latest`,
  )
  await rm(cacheRoot, { recursive: true, force: true })
}

async function resolvePluginTarget(args: { repoRoot: string; config: ParsedOpencodeConfig }): Promise<ResolvedPluginTarget> {
  const plugins = Array.isArray(args.config.plugin)
    ? args.config.plugin.filter((entry): entry is string => typeof entry === "string")
    : []

  const localPluginFile = join(args.repoRoot, "dist", "plugin.js")
  const localPluginEntry = `file://${localPluginFile}`
  if (plugins.includes(localPluginEntry)) {
    return {
      mode: "local-source",
      pluginEntry: localPluginEntry,
      pluginFile: localPluginFile,
    }
  }

  if (plugins.includes(PACKAGE_NAME)) {
    return {
      mode: "package",
      pluginEntry: PACKAGE_NAME,
    }
  }

  for (const pluginEntry of plugins) {
    if (!pluginEntry.startsWith("file://")) {
      continue
    }

    const pluginFile = fileURLToPath(pluginEntry)
    const releaseMetadata = await readJsonFileIfExists(join(dirname(pluginFile), "release.json"))
    const packageMetadata = await readJsonFileIfExists(join(dirname(pluginFile), "package.json"))
    const releaseName = releaseMetadata && typeof releaseMetadata === "object" && !Array.isArray(releaseMetadata)
      ? (releaseMetadata as { name?: unknown }).name
      : null
    const packageName = packageMetadata && typeof packageMetadata === "object" && !Array.isArray(packageMetadata)
      ? (packageMetadata as { name?: unknown }).name
      : null

    if (releaseName === "autopilot" || packageName === PACKAGE_NAME) {
      return {
        mode: "release-file",
        pluginEntry,
        pluginFile,
      }
    }
  }

  return {
    mode: "not-installed",
    pluginEntry: null,
  }
}

export async function runAutopilotUpdate(args: {
  cwd: string
  homeDir: string
  options?: AutopilotUpdateOptions
}): Promise<AutopilotUpdateResult> {
  const repoRoot = resolve(args.cwd)
  const opencodeConfigDir = join(args.homeDir, ".config", "opencode")
  const configResolution = await resolveOpencodeConfigFile(opencodeConfigDir)
  const opencodeConfigFile = join(opencodeConfigDir, "opencode.json")
  const warnings = [...configResolution.warnings]
  let latestVersion: string | null = null

  let parsed: ParsedOpencodeConfig | null = null
  try {
    parsed = JSON.parse(stripJsonComments(await readFile(configResolution.filePath, "utf8"))) as ParsedOpencodeConfig
  } catch {
    warnings.push(`Unable to read existing OpenCode config: ${configResolution.filePath}`)
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      mode: "not-installed",
      opencodeConfigFile,
      resolvedConfigSourceFile: configResolution.filePath,
      pluginEntry: null,
      detectedPluginEntries: [],
      ignoredPluginEntries: [],
      previousVersion: null,
      currentVersion: null,
      latestVersion,
      updated: false,
      restartRequired: false,
      warnings,
      nextSteps: ["Run: bun run src/cli.ts install"],
    }
  }

  const detectedPluginEntries = extractPluginEntries(parsed)
  const target = await resolvePluginTarget({ repoRoot, config: parsed })
  const ignoredPluginEntries = (await Promise.all(
    detectedPluginEntries.map(async (entry) => ({
      entry,
      isAutopilot: await isAutopilotPluginEntry(entry),
    })),
  ))
    .filter(({ entry, isAutopilot }) => isAutopilot && entry !== target.pluginEntry)
    .map(({ entry }) => entry)

  try {
    latestVersion = target.mode === "package"
      ? await (args.options?.fetchLatestPackageVersion ?? fetchLatestPackageVersion)(PACKAGE_NAME)
      : await (args.options?.fetchLatestReleaseVersion ?? fetchLatestReleaseVersion)(RELEASE_REPO_SLUG)
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "Unable to determine latest version")
  }

  if (target.mode === "not-installed") {
    const detectedPackageEntry = detectedPluginEntries.includes(PACKAGE_NAME)
    warnings.push(
      detectedPackageEntry
        ? `Updater saw ${PACKAGE_NAME} in ${configResolution.filePath} but could not complete package-mode detection in the current environment`
        : `Updater did not recognize any supported plugin entry in ${configResolution.filePath}`,
    )
    return {
      ok: false,
      mode: "not-installed",
      opencodeConfigFile,
      resolvedConfigSourceFile: configResolution.filePath,
      pluginEntry: null,
      detectedPluginEntries,
      ignoredPluginEntries,
      previousVersion: null,
      currentVersion: null,
      latestVersion,
      updated: false,
      restartRequired: false,
      warnings,
      nextSteps: detectedPackageEntry
        ? [
            `Verify that ${configResolution.filePath} is the config file you expect this session to use.`,
            `If this is an npm install, run: npm update ${PACKAGE_NAME}`,
            "If the plugin still reports not-installed, compare the detected plugin entries above with the config file you inspected.",
          ]
        : ["Run: bun run src/cli.ts install"],
    }
  }

  if (target.mode === "package") {
    const currentVersion = await readOpencodeCachedPackageVersion(args.homeDir)
      ?? await readInstalledPackageVersion(repoRoot)
    const alreadyCurrent = Boolean(currentVersion && latestVersion && currentVersion === latestVersion)
    if (alreadyCurrent) {
      return {
        ok: true,
        mode: "package",
        opencodeConfigFile,
        resolvedConfigSourceFile: configResolution.filePath,
        pluginEntry: target.pluginEntry,
        detectedPluginEntries,
        ignoredPluginEntries,
        previousVersion: currentVersion,
        currentVersion,
        latestVersion,
        updated: false,
        restartRequired: false,
        warnings,
        nextSteps: ["Autopilot is already at the latest installed package version."],
      }
    }

    await (args.options?.clearCachedPackageInstall ?? clearCachedPackageInstall)(args.homeDir)
    return {
      ok: true,
      mode: "package",
      opencodeConfigFile,
      resolvedConfigSourceFile: configResolution.filePath,
      pluginEntry: target.pluginEntry,
      detectedPluginEntries,
      ignoredPluginEntries,
      previousVersion: currentVersion,
      currentVersion: null,
      latestVersion,
      updated: true,
      restartRequired: true,
      warnings,
      nextSteps: [
        "Restart OpenCode so it reloads the refreshed Autopilot package cache.",
        "If you have other OpenCode windows that are currently using Autopilot, restart those windows too.",
      ],
    }
  }

  if (target.mode === "local-source") {
    const previousVersion = readVersionFromJson(await readJsonFileIfExists(join(repoRoot, "package.json")))
    const alreadyCurrent = Boolean(previousVersion && latestVersion && previousVersion === latestVersion)
    if (alreadyCurrent) {
      return {
        ok: true,
        mode: "local-source",
        opencodeConfigFile,
        resolvedConfigSourceFile: configResolution.filePath,
        pluginEntry: target.pluginEntry,
        detectedPluginEntries,
        ignoredPluginEntries,
        previousVersion,
        currentVersion: previousVersion,
        latestVersion,
        updated: false,
        restartRequired: false,
        warnings,
        nextSteps: ["Autopilot source version already matches the latest release version."],
      }
    }

    await (args.options?.buildLocalSource ?? buildLocalSource)(repoRoot)
    const currentVersion = readVersionFromJson(await readJsonFileIfExists(join(repoRoot, "package.json")))
    return {
      ok: true,
      mode: "local-source",
      opencodeConfigFile,
      resolvedConfigSourceFile: configResolution.filePath,
      pluginEntry: target.pluginEntry,
      detectedPluginEntries,
      ignoredPluginEntries,
      previousVersion,
      currentVersion,
      latestVersion,
      updated: true,
      restartRequired: true,
      warnings,
      nextSteps: ["Restart OpenCode so it reloads the rebuilt plugin bundle."],
    }
  }

  const previousVersion = await readPluginVersion(target.pluginFile)
  const installRoot = dirname(target.pluginFile)
  await (args.options?.updateInstalledRelease ?? updateInstalledRelease)({
    installRoot,
    repoSlug: RELEASE_REPO_SLUG,
  })

  const currentVersion = await readPluginVersion(target.pluginFile)
  return {
    ok: true,
    mode: "release-file",
    opencodeConfigFile,
    resolvedConfigSourceFile: configResolution.filePath,
    pluginEntry: target.pluginEntry,
    detectedPluginEntries,
    ignoredPluginEntries,
    previousVersion,
    currentVersion,
    latestVersion,
    updated: true,
    restartRequired: true,
    warnings,
    nextSteps: ["Restart OpenCode so it reloads the updated plugin files."],
  }
}
