import { commitPackage, createGitHubTag, getBranchHead, githubRequest, tagExists } from "./github_req.js"
import { getPackage, publishPackage, updatePackage } from "./spm.js"
import { getPackageFiles } from "./package_files.js"

export const APP_INSTALL_URL = "https://github.com/apps/slim-package-manager/installations/new"

const VERSION = /^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?$/

export function parseVersion(value) {
    const match = VERSION.exec(String(value ?? ""))
    if (!match) return null
    return { parts: match[1].split(".").map(Number), pre: match[2] ? match[2].split(".") : [] }
}

export function compareVersions(a, b) {
    const left = parseVersion(a)
    const right = parseVersion(b)
    if (!left || !right) throw new Error(`Cannot compare versions "${a}" and "${b}"`)

    for (let i = 0; i < Math.max(left.parts.length, right.parts.length); i++) {
        const diff = (left.parts[i] ?? 0) - (right.parts[i] ?? 0)
        if (diff !== 0) return Math.sign(diff)
    }

    if (!left.pre.length || !right.pre.length) return Math.sign(right.pre.length - left.pre.length)

    for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
        const x = left.pre[i]
        const y = right.pre[i]
        if (x === undefined) return -1
        if (y === undefined) return 1
        if (x === y) continue
        const xn = /^\d+$/.test(x)
        const yn = /^\d+$/.test(y)
        if (xn && yn) return Math.sign(Number(x) - Number(y))
        if (xn) return -1
        if (yn) return 1
        return x < y ? -1 : 1
    }

    return 0
}

function fail(msg, extra = {}) {
    return { success: false, msg, ...extra }
}

export async function preparePublish({ token, name, dir, spm }) {
    const repo = spm.github?.repo
    const version = spm.version
    const tag = `v${version}`

    if (!repo) return fail("The .spm file has no @github repo")
    if (!parseVersion(version)) return fail(`version "${version}" in .spm is not a version like 1.2.0`)
    if (!token) return fail("Not signed in to GitHub: run spm login")

    const installations = await githubRequest(token, "/user/installations")
    if (!installations?.total_count) {
        return fail(`The slim-package-manager GitHub App is not installed on "${repo}"`, { appMissing: true })
    }

    const repository = await githubRequest(token, `/repos/${repo}`)
    const branch = repository.default_branch || "main"

    let parent
    try {
        parent = await getBranchHead(token, repo, branch)
    }
    catch (error) {
        throw new Error(`Cannot read branch ${branch} of ${repo}: ${error.message}`)
    }

    const registry = await getPackage({ name })
    const existing = registry.success ? registry.content : null
    let registryUpToDate = false

    if (existing?.latest) {
        const order = compareVersions(version, existing.latest)
        if (order < 0) return fail(`version ${version} is below the registry's latest ${existing.latest}: raise version in .spm`)
        registryUpToDate = order === 0
    }

    if (await tagExists(token, repo, tag)) {
        return fail(`${repo} already has the tag ${tag}: raise version in .spm`)
    }

    const files = await getPackageFiles(dir)
    if (files.length === 0) return fail("Package directory is empty")

    return {
        success: true,
        plan: { name, repo, branch, parent, version, tag, description: spm.description, files, existing: !!existing, registryUpToDate }
    }
}

export async function runPublish({ token, plan }) {
    const { name, repo, branch, parent, version, tag, description, files } = plan

    const pushed = await commitPackage({ token, repo, branch, parent, files, message: `Release ${version}` })
    const pushedNote = pushed.changed ? `${repo} now has the commit ${pushed.commit.slice(0, 7)}, ` : ""

    if (!plan.registryUpToDate) {
        const request = plan.existing ? updatePackage : publishPackage
        const registry = await request({ token, name, description, version, github: repo })
        if (!registry.success) {
            return fail(`SPM registry: ${registry.content ?? "request failed"} (${pushedNote}nothing tagged; run spm publish again)`, { pushed })
        }
    }

    const tagged = await createGitHubTag(token, repo, version, pushed.commit)
    if (!tagged.success) {
        return fail(`@${name} ${version} is in the registry, but tagging ${tag} on GitHub failed: ${tagged.msg} (run spm publish again)`, { pushed })
    }

    return {
        success: true,
        msg: `@${name} ${version} published: ${repo} ${tag} @ ${pushed.commit.slice(0, 7)}${pushed.changed ? "" : " (files unchanged, no new commit)"}`,
        pushed
    }
}
