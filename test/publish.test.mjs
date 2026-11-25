import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { afterEach, test } from "node:test"
import path from "node:path"
import { commitPackage, gitBlobSha } from "../src/api/github_req.js"
import { getPackageFiles } from "../src/api/package_files.js"
import { compareVersions, preparePublish, runPublish } from "../src/api/publish.js"

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const sha = text => gitBlobSha(Buffer.from(text))
const treeKey = entries => JSON.stringify([...entries].map(e => [e.path, e.mode, e.sha]).sort())

function fakeServers({ remote = {}, tags = [], registry = null, installations = 1, registryFails = false } = {}) {
    const calls = []
    const remoteEntries = Object.entries(remote).map(([p, body]) => ({ path: p, mode: "100644", type: "blob", sha: sha(body) }))
    const trees = new Map([[treeKey(remoteEntries), "tree0"]])
    const blobs = new Set(remoteEntries.map(e => e.sha))
    let commits = 0

    globalThis.fetch = async (url, options = {}) => {
        const method = options.method ?? "GET"
        const body = options.body ? JSON.parse(options.body) : undefined
        const u = new URL(url)
        const route = `${method} ${u.host === "api.github.com" ? "" : u.host}${u.pathname}`
        calls.push({ method, route, body, search: u.search })
        const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })

        switch (route) {
            case "GET /user/installations": return reply(200, { total_count: installations })
            case "GET /repos/me/lib": return reply(200, { full_name: "me/lib", default_branch: "main" })
            case "GET /repos/me/lib/git/ref/heads/main": return reply(200, { object: { sha: "commit0" } })
            case "GET /repos/me/lib/git/commits/commit0": return reply(200, { sha: "commit0", tree: { sha: "tree0" } })
            case "GET /repos/me/lib/git/trees/tree0": return reply(200, { sha: "tree0", truncated: false, tree: remoteEntries })
            case "POST /repos/me/lib/git/blobs": {
                const blobSha = gitBlobSha(Buffer.from(body.content, "base64"))
                blobs.add(blobSha)
                return reply(201, { sha: blobSha })
            }
            case "POST /repos/me/lib/git/trees": {
                assert.equal(body.base_tree, undefined)
                for (const entry of body.tree) assert.ok(blobs.has(entry.sha), `unknown blob for ${entry.path}`)
                const key = treeKey(body.tree)
                if (!trees.has(key)) trees.set(key, `tree${trees.size}`)
                return reply(201, { sha: trees.get(key) })
            }
            case "POST /repos/me/lib/git/commits": return reply(201, { sha: `commit${++commits}` })
            case "PATCH /repos/me/lib/git/refs/heads/main": return reply(200, { object: { sha: body.sha } })
            case "POST /repos/me/lib/git/refs": return reply(201, { ref: body.ref })
            case "GET spm.yurba.one/install":
                return reply(200, registry ? { success: true, result: registry } : { success: false, result: "Package not found" })
            case "POST spm.yurba.one/update":
            case "POST spm.yurba.one/publish":
                return reply(200, registryFails ? { success: false, result: "registry is down" } : { success: true, result: { latest: body.version } })
        }

        const tag = route.match(/^GET \/repos\/me\/lib\/git\/ref\/tags\/(.+)$/)
        if (tag) return tags.includes(decodeURIComponent(tag[1])) ? reply(200, { ref: `refs/tags/${tag[1]}` }) : reply(404, { message: "Not Found" })

        return reply(500, { message: `unexpected ${route}` })
    }

    return { calls, writes: () => calls.filter(c => c.method !== "GET").map(c => c.route) }
}

async function withPackage(files, run) {
    const dir = mkdtempSync(path.join(tmpdir(), "spm-publish-"))
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

const spmFile = version => ({ name: "lib", version, description: "d", github: { repo: "me/lib" } })
const parent = { commit: "commit0", tree: "tree0" }

test("commitPackage sends the whole folder as a fresh tree and reuses known blobs", async () => {
    const server = fakeServers({ remote: { "main.slim": "old\n", "gone.slim": "x\n", "README.md": "readme\n" } })
    await withPackage({ "main.slim": "new\n", "README.md": "readme\n", ".git/HEAD": "ref\n" }, async dir => {
        const result = await commitPackage({ token: "t", repo: "me/lib", branch: "main", parent, files: await getPackageFiles(dir), message: "Release 1.1.0" })
        assert.equal(result.changed, true)

        const treeCall = server.calls.find(c => c.route === "POST /repos/me/lib/git/trees")
        assert.deepEqual(treeCall.body.tree.map(e => e.path), ["README.md", "main.slim"])
        assert.equal(server.calls.filter(c => c.route === "POST /repos/me/lib/git/blobs").length, 1)

        const commitCall = server.calls.find(c => c.route === "POST /repos/me/lib/git/commits")
        assert.deepEqual(commitCall.body.parents, ["commit0"])
        assert.equal(commitCall.body.message, "Release 1.1.0")

        const refCall = server.calls.find(c => c.route === "PATCH /repos/me/lib/git/refs/heads/main")
        assert.equal(refCall.body.sha, result.commit)
        assert.equal(refCall.body.force, undefined)
    })
})

test("commitPackage makes no commit when the tree is unchanged", async () => {
    const server = fakeServers({ remote: { "main.slim": "same\n", "lib/a.slim": "a\n" } })
    await withPackage({ "main.slim": "same\n", "lib/a.slim": "a\n", "spm.lock.json": "{}" }, async dir => {
        const result = await commitPackage({ token: "t", repo: "me/lib", branch: "main", parent, files: await getPackageFiles(dir), message: "Release 1.0.1" })
        assert.deepEqual(result, { commit: "commit0", tree: "tree0", changed: false })
        assert.deepEqual(server.writes(), ["POST /repos/me/lib/git/trees"])
    })
})

test("publishing a new version makes one commit, updates the registry, then tags", async () => {
    const server = fakeServers({ remote: { "main.slim": "old\n" }, registry: { latest: "1.0.0", repo: "me/lib" }, tags: ["v1.0.0"] })
    await withPackage({ "main.slim": "new\n", ".spm": "x" }, async dir => {
        const prepared = await preparePublish({ token: "t", name: "lib", dir, spm: spmFile("1.1.0") })
        assert.equal(prepared.success, true, prepared.msg)
        assert.deepEqual(server.writes(), [])

        const result = await runPublish({ token: "t", plan: prepared.plan })
        assert.equal(result.success, true, result.msg)
        assert.deepEqual(server.writes(), [
            "POST /repos/me/lib/git/blobs",
            "POST /repos/me/lib/git/blobs",
            "POST /repos/me/lib/git/trees",
            "POST /repos/me/lib/git/commits",
            "PATCH /repos/me/lib/git/refs/heads/main",
            "POST spm.yurba.one/update",
            "POST /repos/me/lib/git/refs"
        ])
        const tagCall = server.calls.at(-1)
        assert.deepEqual(tagCall.body, { ref: "refs/tags/v1.1.0", sha: "commit1" })
    })
})

test("a first publish registers the name and tags the commit", async () => {
    const server = fakeServers({ remote: { "README.md": "auto\n" } })
    await withPackage({ "main.slim": "a\n" }, async dir => {
        const prepared = await preparePublish({ token: "t", name: "lib", dir, spm: spmFile("1.0.0") })
        const result = await runPublish({ token: "t", plan: prepared.plan })
        assert.equal(result.success, true, result.msg)
        assert.ok(server.writes().includes("POST spm.yurba.one/publish"))
        assert.equal(server.writes().filter(r => r.endsWith("/git/commits")).length, 1)
    })
})

test("an unchanged folder is tagged without a new commit", async () => {
    const server = fakeServers({ remote: { "main.slim": "a\n" }, registry: { latest: "1.0.0" }, tags: ["v1.0.0"] })
    await withPackage({ "main.slim": "a\n" }, async dir => {
        const prepared = await preparePublish({ token: "t", name: "lib", dir, spm: spmFile("1.0.1") })
        const result = await runPublish({ token: "t", plan: prepared.plan })
        assert.equal(result.success, true, result.msg)
        assert.equal(result.pushed.changed, false)
        assert.deepEqual(server.writes(), ["POST /repos/me/lib/git/trees", "POST spm.yurba.one/update", "POST /repos/me/lib/git/refs"])
        assert.equal(server.calls.at(-1).body.sha, "commit0")
    })
})

test("publish refuses before writing anything", async t => {
    const cases = [
        { title: "not signed in", token: null, servers: {}, msg: /spm login/ },
        { title: "app not installed", servers: { installations: 0 }, msg: /not installed/, appMissing: true },
        { title: "tag exists", servers: { tags: ["v1.1.0"] }, msg: /already has the tag v1\.1\.0/ },
        { title: "version below the registry", servers: { registry: { latest: "1.2.0" } }, msg: /below the registry's latest 1\.2\.0/ }
    ]
    for (const c of cases) {
        await t.test(c.title, async () => {
            const server = fakeServers(c.servers)
            await withPackage({ "main.slim": "a\n" }, async dir => {
                const prepared = await preparePublish({ token: "token" in c ? c.token : "t", name: "lib", dir, spm: spmFile("1.1.0") })
                assert.equal(prepared.success, false)
                assert.match(prepared.msg, c.msg)
                if (c.appMissing) assert.equal(prepared.appMissing, true)
                assert.deepEqual(server.writes(), [])
            })
        })
    }
})

test("a registry failure leaves the tag for the next run", async () => {
    const server = fakeServers({ remote: { "main.slim": "old\n" }, registry: { latest: "1.0.0" }, registryFails: true })
    await withPackage({ "main.slim": "new\n" }, async dir => {
        const prepared = await preparePublish({ token: "t", name: "lib", dir, spm: spmFile("1.1.0") })
        const result = await runPublish({ token: "t", plan: prepared.plan })
        assert.equal(result.success, false)
        assert.match(result.msg, /registry is down.*run spm publish again/)
        assert.ok(!server.writes().includes("POST /repos/me/lib/git/refs"))
    })
})

test("a version already in the registry but not tagged is finished without a registry write", async () => {
    const server = fakeServers({ remote: { "main.slim": "a\n" }, registry: { latest: "1.1.0" }, tags: ["v1.0.0"] })
    await withPackage({ "main.slim": "a\n" }, async dir => {
        const prepared = await preparePublish({ token: "t", name: "lib", dir, spm: spmFile("1.1.0") })
        assert.equal(prepared.plan.registryUpToDate, true)
        const result = await runPublish({ token: "t", plan: prepared.plan })
        assert.equal(result.success, true, result.msg)
        assert.deepEqual(server.writes(), ["POST /repos/me/lib/git/trees", "POST /repos/me/lib/git/refs"])
    })
})

test("versions compare by number and pre-release", () => {
    assert.equal(compareVersions("1.10.0", "1.9.0"), 1)
    assert.equal(compareVersions("2.0.0", "2.0"), 0)
    assert.equal(compareVersions("1.0.0-beta.2", "1.0.0-beta.10"), -1)
    assert.equal(compareVersions("1.0.0-rc.1", "1.0.0"), -1)
    assert.equal(compareVersions("1.0.0", "1.0.0-rc.1"), 1)
})
