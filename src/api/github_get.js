import { GITHUB_API, githubHeaders } from "./github_req.js";

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import * as tar from 'tar'

export async function getGitHubUser(token) {
    const response = await fetch(
        `${GITHUB_API}/user`,
        {
            headers: githubHeaders(token)
        }
    );

    if (!response.ok) {
        throw new Error("GitHub token is invalid");
    }

    return response.json();
}

export async function getGitHubRepo(token, repo) {
    const response = await fetch(
        `${GITHUB_API}/repos/${repo}`,
        {
            headers: githubHeaders(token)
        }
    );

    if (!response.ok) {
        throw new Error(
            `GitHub repository "${repo}" not found`
        );
    }

    return response.json();
}

export async function getPermission(token, repo, username) {
    const response = await fetch(
        `${GITHUB_API}/repos/${repo}/collaborators/${username}/permission`,
        {
            headers: githubHeaders(token)
        }
    );

    if (!response.ok) {
        throw new Error(
            "Unable to verify repository permissions"
        );
    }

    return response.json();
}

const MAX_PACKAGE_BYTES = 200 * 1024 * 1024
const MAX_PACKAGE_FILES = 20000
const SAFE_ENTRY_TYPES = new Set(["File", "OldFile", "ContiguousFile", "Directory"])

function isInside(root, target) {
    const relative = path.relative(root, target)
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

export async function extractTarGz(file, destination) {
    const root = path.resolve(destination)
    const rejected = []
    let bytes = 0
    let files = 0

    await tar.x({
        file,
        cwd: root,
        strip: 1,
        strict: true,
        preservePaths: false,
        filter: (entryPath, entry) => {
            const parts = entryPath.split(/[\\/]+/).slice(1)
            const target = path.resolve(root, ...parts)
            if (!SAFE_ENTRY_TYPES.has(entry.type)) {
                rejected.push(`${entryPath} (${entry.type})`)
                return false
            }
            if (parts.includes("..") || path.isAbsolute(entryPath) || !isInside(root, target)) {
                rejected.push(entryPath)
                return false
            }
            bytes += entry.size ?? 0
            files++
            return bytes <= MAX_PACKAGE_BYTES && files <= MAX_PACKAGE_FILES
        }
    });

    if (bytes > MAX_PACKAGE_BYTES || files > MAX_PACKAGE_FILES) {
        throw new Error(`The package is too large (${files} files, ${Math.round(bytes / 1024 / 1024)} MB)`)
    }
    return rejected
}

function listFiles(dir, base = dir, found = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) listFiles(full, base, found)
        else if (entry.isFile()) found.push(path.relative(base, full).split(path.sep).join("/"))
    }
    return found
}

export function packageIntegrity(dir) {
    const total = createHash("sha256")
    for (const file of listFiles(dir).sort()) {
        const content = createHash("sha256").update(fs.readFileSync(path.join(dir, file))).digest("hex")
        total.update(`${file}\0${content}\n`)
    }
    return `sha256-${total.digest("base64")}`
}

async function resolveCommit(token, owner, repo, ref) {
    const response = await fetch(
        `${GITHUB_API}/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`,
        {
            headers: githubHeaders(token)
        }
    );

    if (!response.ok) {
        const data = await response.json().catch(() => null);
        const failure = new Error(data?.message ? `${ref}: ${data.message}` : `Can't find ${ref} in ${owner}/${repo}`);
        failure.missing = response.status === 404 || response.status === 422;
        throw failure;
    }

    const data = await response.json();
    if (typeof data?.sha !== "string" || !/^[0-9a-f]{40}$/.test(data.sha)) throw new Error(`GitHub returned no commit for ${ref}`);
    return data.sha;
}

export async function downloadGitHubRepo(
    token,
    repository,
    destination,
    version = null,
    locked = null,
    { fallbackToMain = false } = {}
) {
    const match = repository.match(
        /^([a-zA-Z0-9-]+)\/([a-zA-Z0-9._-]+)$/
    );

    if (!match) {
        return {
            success: false,
            msg: "Repository must have format user/repo"
        };
    }

    const [, owner, repo] = match;
    const target = path.resolve(destination);
    const staging = `${target}.spm-${process.pid}-${Date.now()}`;
    const tempFile = path.join(
        os.tmpdir(),
        `spm-${owner}-${repo}-${Date.now()}.tar.gz`
    );

    try {
        let untagged = false;
        let commit = locked?.commit && /^[0-9a-f]{40}$/.test(locked.commit) ? locked.commit : null;
        if (!commit && version) {
            try {
                commit = await resolveCommit(token, owner, repo, `v${version}`);
            }
            catch (tagError) {
                if (!tagError.missing || !fallbackToMain) throw tagError;
                untagged = true;
            }
        }
        if (!commit) commit = await resolveCommit(token, owner, repo, "main");

        const response = await fetch(
            `${GITHUB_API}/repos/${owner}/${repo}/tarball/${commit}`,
            {
                headers: githubHeaders(token)
            }
        );

        if (!response.ok) {
            const data = await response.json().catch(() => null);

            return {
                success: false,
                msg: data?.message || `GitHub API error: ${response.status}`
            };
        }

        await pipeline(response.body, createWriteStream(tempFile));
        await fs.promises.mkdir(staging, { recursive: true });
        const rejected = await extractTarGz(tempFile, staging);
        const integrity = packageIntegrity(staging);

        if (locked?.integrity && locked.integrity !== integrity) {
            return {
                success: false,
                msg: `Integrity check failed for ${repository}@${commit.slice(0, 7)}: expected ${locked.integrity}, got ${integrity}. The package changed since it was locked; remove it from spm.lock.json to accept the new contents`
            };
        }

        const backup = fs.existsSync(target) ? `${target}.spm-old-${process.pid}-${Date.now()}` : null;
        if (backup) await fs.promises.rename(target, backup);
        try {
            await fs.promises.rename(staging, target);
        }
        catch (swapError) {
            if (backup) await fs.promises.rename(backup, target).catch(() => {});
            throw swapError;
        }
        if (backup) await fs.promises.rm(backup, { recursive: true, force: true }).catch(() => {});

        return {
            success: true,
            msg: `Repository ${repository} downloaded`,
            path: target,
            commit,
            integrity,
            rejected,
            untagged
        };
    }
    catch (error) {
        return {
            success: false,
            msg: error instanceof Error
                ? error.message
                : String(error)
        };
    }
    finally {
        await fs.promises.rm(tempFile, { force: true });
        await fs.promises.rm(staging, { recursive: true, force: true });
    }
}
