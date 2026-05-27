import { beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { buildWorkspaceCodeFingerprint, buildWorkspaceCodeSnapshot, resolveCodeScanRoot } from "../packages/runtime/src/shared/workspace-code-fingerprint"

describe("workspace code fingerprint", () => {
  let rootDir = ""

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "workspace-fingerprint-"))
  })

  it("excludes markdown docs and README files", async () => {
    await mkdir(join(rootDir, "docs"), { recursive: true })
    await mkdir(join(rootDir, "src"), { recursive: true })
    await writeFile(join(rootDir, "README.md"), "readme\n", "utf8")
    await writeFile(join(rootDir, "docs", "notes.md"), "notes\n", "utf8")
    await writeFile(join(rootDir, "src", "app.ts"), "export const ok = true\n", "utf8")

    const fingerprint = await buildWorkspaceCodeFingerprint(rootDir)

    expect(fingerprint).toBeTypeOf("string")
    expect(fingerprint.length).toBe(64)

    const snapshot = await buildWorkspaceCodeSnapshot(rootDir)
    expect(snapshot["src/app.ts"]).toContain("src/app.ts")
    expect(snapshot["README.md"]).toBeUndefined()
    expect(snapshot["docs/notes.md"]).toBeUndefined()

    await rm(rootDir, { recursive: true, force: true })
  })

  it("changes snapshot when file content changes without size change", async () => {
    await mkdir(join(rootDir, "src"), { recursive: true })
    const filePath = join(rootDir, "src", "same-size.ts")
    await writeFile(filePath, "export const a = 1\n", "utf8")

    const before = await buildWorkspaceCodeSnapshot(rootDir)
    await writeFile(filePath, "export const b = 1\n", "utf8")
    const after = await buildWorkspaceCodeSnapshot(rootDir)

    expect(before["src/same-size.ts"]).not.toBe(after["src/same-size.ts"])

    await rm(rootDir, { recursive: true, force: true })
  })

  it("represents added and deleted code-like files in snapshot diffs", async () => {
    await mkdir(join(rootDir, "src"), { recursive: true })

    const before = await buildWorkspaceCodeSnapshot(rootDir)
    await writeFile(join(rootDir, "src", "new-file.ts"), "export const created = true\n", "utf8")
    const afterAdd = await buildWorkspaceCodeSnapshot(rootDir)
    expect(before["src/new-file.ts"]).toBeUndefined()
    expect(afterAdd["src/new-file.ts"]).toContain("src/new-file.ts")

    await rm(join(rootDir, "src", "new-file.ts"), { force: true })
    const afterDelete = await buildWorkspaceCodeSnapshot(rootDir)
    expect(afterDelete["src/new-file.ts"]).toBeUndefined()

    await rm(rootDir, { recursive: true, force: true })
  })

  it("resolves .workflow-harness baseDir back to project root", () => {
    expect(resolveCodeScanRoot("/tmp/project/.workflow-harness")).toBe("/tmp/project")
    expect(resolveCodeScanRoot("/tmp/project")).toBe("/tmp/project")
  })
})
