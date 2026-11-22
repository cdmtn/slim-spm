import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { test } from "node:test"
import path from "node:path"
import { parseSPM } from "../src/parsers/spm.js"
import pkg from "../package.json" with { type: "json" }

const cli = path.join(process.cwd(), "src", "cli.js")

function inProject(body) {
    const dir = mkdtempSync(path.join(tmpdir(), "slim-spm-"))
    try {
        writeFileSync(path.join(dir, "slimconfig.json"), JSON.stringify({ main: "index" }))
        return body(dir)
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

const spm = (dir, args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: "utf8" })

test("spm prints its own version", () => {
    inProject(dir => assert.equal(spm(dir, ["--version"]).stdout.trim(), pkg.version))
})

test("spm refuses package names that leave the packages folder", () => {
    inProject(dir => {
        const result = spm(dir, ["rm", "../outside"])
        assert.match(result.stdout + result.stderr, /is not a valid package name/)
    })
})

test("removing a package that isn't installed fails", () => {
    inProject(dir => {
        const removed = spm(dir, ["rm", "doesnotexist"])
        assert.equal(removed.status, 1)
        assert.match(removed.stdout, /not installed/)
    })
})

test("the .spm parser rejects prototype keys", () => {
    assert.throws(() => parseSPM('name = "x"\nversion = "1"\n@__proto__\npolluted = "yes"'), /invalid section name/)
    assert.equal(({}).polluted, undefined)
})

test("spm works in the packages folder named in slimconfig.json", () => {
    inProject(dir => {
        writeFileSync(path.join(dir, "slimconfig.json"), JSON.stringify({ main: "index", packages: "libs" }))
        mkdirSync(path.join(dir, "libs", "tool"), { recursive: true })
        writeFileSync(path.join(dir, "libs", "tool", "main.slim"), "export const a = 1\n")
        writeFileSync(path.join(dir, "spm.lock.json"), JSON.stringify({ packages: { tool: { version: "1.0.0", repo: "user/tool" } } }))
        const removed = spm(dir, ["rm", "tool"])
        assert.equal(removed.status ?? 0, 0, removed.stdout + removed.stderr)
        assert.ok(!existsSync(path.join(dir, "libs", "tool")))
        assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "spm.lock.json"), "utf8")).packages, {})
    })
})
