import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

const releaseDir = join(process.cwd(), "release")
const bundleDir = join(releaseDir, "autopilot")
async function main(): Promise<void> {
  await rm(releaseDir, { recursive: true, force: true })
  await mkdir(bundleDir, { recursive: true })
  const packageMetadata = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as { version?: unknown }

  const result = await Bun.build({
    entrypoints: [join(process.cwd(), "plugin.ts")],
    outdir: bundleDir,
    naming: "plugin.js",
    target: "bun",
    format: "esm",
    minify: false,
    sourcemap: "none",
  })

  if (!result.success) {
    const logs = result.logs.map((log) => log.message).join("\n")
    throw new Error(`Failed to build release bundle:\n${logs}`)
  }

  await cp(join(process.cwd(), "package.json"), join(bundleDir, "package.json"))
  await cp(join(process.cwd(), "README.md"), join(bundleDir, "README.md"))

  const releaseMetadata = {
    name: "autopilot",
    version: typeof packageMetadata.version === "string" ? packageMetadata.version : null,
    pluginEntry: "plugin.js",
    installedAt: new Date().toISOString(),
  }

  await writeFile(
    join(bundleDir, "release.json"),
    `${JSON.stringify(releaseMetadata, null, 2)}\n`,
    "utf8",
  )
}

void main()
