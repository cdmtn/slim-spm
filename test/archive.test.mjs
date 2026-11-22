import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { test } from "node:test"
import path from "node:path"
import zlib from "node:zlib"
import { extractTarGz, packageIntegrity } from "../src/api/github_get.js"

function tarHeader(name, type, size, link = "") {
    const header = Buffer.alloc(512)
    header.write(name, 0, 100)
    header.write("0000644\0", 100)
    header.write("0000000\0", 108)
    header.write("0000000\0", 116)
    header.write(size.toString(8).padStart(11, "0") + "\0", 124)
    header.write("00000000000\0", 136)
    header.write("        ", 148)
    header.write(type, 156)
    header.write(link, 157, 100)
    header.write("ustar\0", 257)
    header.write("00", 263)
    let sum = 0
    for (const byte of header) sum += byte
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148)
    return header
}

test("spm extracts only plain files inside the package and hashes them", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "slim-spm-"))
    try {
        const parts = []
        const add = (name, type, body = "", link = "") => {
            parts.push(tarHeader(name, type, Buffer.byteLength(body), link))
            if (!body) return
            const block = Buffer.alloc(Math.ceil(Buffer.byteLength(body) / 512) * 512)
            block.write(body)
            parts.push(block)
        }
        add("root/", "5")
        add("root/ok.slim", "0", "log(1)\n")
        add("root/../../escape.txt", "0", "bad")
        add("root/link", "2", "", "../../../outside")
        add("root/hard", "1", "", "root/ok.slim")
        add("/abs.txt", "0", "abs")
        parts.push(Buffer.alloc(1024))
        const archive = path.join(dir, "evil.tar.gz")
        writeFileSync(archive, zlib.gzipSync(Buffer.concat(parts)))
        const target = path.join(dir, "pkg", "inner")
        mkdirSync(target, { recursive: true })

        const rejectedEntries = await extractTarGz(archive, target)
        assert.deepEqual(readdirSync(target), ["ok.slim"])
        assert.equal(rejectedEntries.length, 4)
        assert.ok(!existsSync(path.join(dir, "escape.txt")) && !existsSync(path.join(dir, "pkg", "escape.txt")))

        const integrity = packageIntegrity(target)
        assert.match(integrity, /^sha256-/)
        assert.equal(packageIntegrity(target), integrity)
        writeFileSync(path.join(target, "ok.slim"), "log(2)\n")
        assert.notEqual(packageIntegrity(target), integrity)
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})
