import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { test } from "node:test"
import path from "node:path"
import { getPackageFiles, isIgnored, parseIgnore } from "../src/api/package_files.js"

async function withPackage(files, run) {
    const dir = mkdtempSync(path.join(tmpdir(), "spm-files-"))
    try {
        for (const [name, body] of Object.entries(files)) {
            const file = path.join(dir, ...name.split("/"))
            mkdirSync(path.dirname(file), { recursive: true })
            writeFileSync(file, body)
        }
        return await run(dir)
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

const listed = async dir => (await getPackageFiles(dir)).map(file => file.path)

test("publish skips .git, build output and the lockfile", async () => {
    await withPackage({
        ".spm": "name = \"lib\"\n",
        "main.slim": "log(1)\n",
        "lib/util.slim": "log(2)\n",
        ".git/config": "[core]\n",
        ".git/objects/ab/cdef": "x",
        "vendor/.git": "gitdir: ../.git/modules/vendor\n",
        "vendor/a.slim": "a\n",
        "node_modules/x/index.js": "x\n",
        "lib/node_modules/y.js": "y\n",
        "slim-dist/main.js": "out\n",
        "spm.lock.json": "{}\n"
    }, async dir => {
        assert.deepEqual(await listed(dir), [".spm", "lib/util.slim", "main.slim", "vendor/a.slim"])
    })
})

test("publish honours .gitignore files, nested ones and negations", async () => {
    await withPackage({
        ".spm": "name = \"lib\"\n",
        ".gitignore": "*.log\n!keep.log\n/build/\ntmp/\ndocs/**/*.draft\n# comment\n\n!slim-dist/\n",
        "main.slim": "",
        "debug.log": "",
        "keep.log": "",
        "build/out.js": "",
        "src/build/kept.slim": "",
        "src/tmp/x": "",
        "src/tmp.slim": "",
        "docs/a.draft": "",
        "docs/deep/b.draft": "",
        "docs/a.md": "",
        "slim-dist/main.js": "",
        "sub/.gitignore": "local.txt\n",
        "sub/local.txt": "",
        "sub/shared.txt": "",
        "local.txt": ""
    }, async dir => {
        assert.deepEqual(await listed(dir), [
            ".gitignore",
            ".spm",
            "docs/a.md",
            "keep.log",
            "local.txt",
            "main.slim",
            "slim-dist/main.js",
            "src/build/kept.slim",
            "src/tmp.slim",
            "sub/.gitignore",
            "sub/shared.txt"
        ])
    })
})

test("ignore patterns follow gitignore rules", () => {
    const rules = parseIgnore("/root.txt\na/**/z\n**/deep\ndir/\n\\#hash\nfile[0-9].txt\n")
    assert.equal(isIgnored(rules, "root.txt", false), true)
    assert.equal(isIgnored(rules, "x/root.txt", false), false)
    assert.equal(isIgnored(rules, "a/z", false), true)
    assert.equal(isIgnored(rules, "a/b/c/z", false), true)
    assert.equal(isIgnored(rules, "q/r/deep", true), true)
    assert.equal(isIgnored(rules, "x/dir", true), true)
    assert.equal(isIgnored(rules, "x/dir", false), false)
    assert.equal(isIgnored(rules, "#hash", false), true)
    assert.equal(isIgnored(rules, "file7.txt", false), true)
    assert.equal(isIgnored(rules, "filex.txt", false), false)
})
