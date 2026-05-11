import { describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { readJsonFile } from "../packages/runtime/src/shared/json-file"

describe("readJsonFile", () => {
  it("returns null for an empty file", async () => {
    const root = await mkdtemp(join(tmpdir(), "json-file-empty-"))
    const filePath = join(root, "empty.json")
    await writeFile(filePath, "")

    try {
      await expect(readJsonFile(filePath)).resolves.toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("returns null for invalid JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "json-file-invalid-"))
    const filePath = join(root, "broken.json")
    await writeFile(filePath, "{ invalid json")

    try {
      await expect(readJsonFile(filePath)).resolves.toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
