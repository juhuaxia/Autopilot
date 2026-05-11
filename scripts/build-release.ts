import { cp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

const releaseDir = join(process.cwd(), "release")
const bundleDir = join(releaseDir, "autopilot")
async function main(): Promise<void> {
  await rm(releaseDir, { recursive: true, force: true })
  await mkdir(bundleDir, { recursive: true })

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
