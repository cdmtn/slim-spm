import fs from "node:fs/promises";
import { createHash } from "node:crypto";

export const GITHUB_API = "https://api.github.com";
export const API_VERSION = "2026-03-10";

export function githubHeaders(token, extra = {}) {
    return {
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "X-GitHub-Api-Version": API_VERSION,
        ...extra
    };
}

export async function githubRequest(token, url, options = {}) {
    const response = await fetch(`${GITHUB_API}${url}`, {
        ...options,
        headers: githubHeaders(token, {
            "Content-Type": "application/json",
            ...options.headers
        })
    });

    const data = response.status === 204 ? null : await response.json().catch(() => null);

    if (!response.ok) {
        const error = new Error(data?.message || `GitHub API error: ${response.status}`);
        error.status = response.status;
        throw error;
    }

    return data;
}

export function gitBlobSha(content) {
    return createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
}

export async function getBranchHead(token, repo, branch) {
    const reference = await githubRequest(token, `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    const commit = await githubRequest(token, `/repos/${repo}/git/commits/${reference.object.sha}`);
    return { commit: commit.sha, tree: commit.tree.sha };
}

export async function tagExists(token, repo, tag) {
    try {
        await githubRequest(token, `/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`);
        return true;
    }
    catch (error) {
        if (error.status === 404) return false;
        throw error;
    }
}

async function remoteBlobs(token, repo, treeSha) {
    const tree = await githubRequest(token, `/repos/${repo}/git/trees/${treeSha}?recursive=1`);
    return new Set((tree?.tree ?? []).filter(entry => entry.type === "blob").map(entry => entry.sha));
}

export async function commitPackage({ token, repo, branch, parent, files, message }) {
    if (files.length === 0) throw new Error("Package directory is empty");

    const existing = await remoteBlobs(token, repo, parent.tree);
    const tree = [];

    for (const file of files) {
        const content = await fs.readFile(file.fullPath);
        let sha = gitBlobSha(content);

        if (!existing.has(sha)) {
            const blob = await githubRequest(token, `/repos/${repo}/git/blobs`, {
                method: "POST",
                body: JSON.stringify({ content: content.toString("base64"), encoding: "base64" })
            });
            sha = blob.sha;
        }

        tree.push({ path: file.path, mode: "100644", type: "blob", sha });
    }

    const newTree = await githubRequest(token, `/repos/${repo}/git/trees`, {
        method: "POST",
        body: JSON.stringify({ tree })
    });

    if (newTree.sha === parent.tree) {
        return { commit: parent.commit, tree: newTree.sha, changed: false };
    }

    const commit = await githubRequest(token, `/repos/${repo}/git/commits`, {
        method: "POST",
        body: JSON.stringify({ message, tree: newTree.sha, parents: [parent.commit] })
    });

    await githubRequest(token, `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
        method: "PATCH",
        body: JSON.stringify({ sha: commit.sha })
    });

    return { commit: commit.sha, tree: newTree.sha, changed: true };
}

export async function createGitHubTag(token, repo, version, commit) {
    try {
        await githubRequest(token, `/repos/${repo}/git/refs`, {
            method: "POST",
            body: JSON.stringify({ ref: `refs/tags/v${version}`, sha: commit })
        });
        return { success: true, tag: `v${version}` };
    }
    catch (error) {
        return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
}

export async function createGitHubRepo(token, repository, organization = false) {
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

    try {
        const check = await fetch(
            `${GITHUB_API}/repos/${owner}/${repo}`,
            {
                headers: githubHeaders(token)
            }
        );

        if (check.ok) {
            return {
                success: false,
                msg: `Repository ${repository} already exists`
            };
        }

        if (check.status !== 404) {
            const data = await check.json();

            return {
                success: false,
                msg: data.message || `GitHub API error: ${check.status}`
            };
        }

        if (!organization) {
            const userResponse = await fetch(
                `${GITHUB_API}/user`,
                {
                    headers: githubHeaders(token)
                }
            );

            if (!userResponse.ok) {
                const data = await userResponse.json();

                return {
                    success: false,
                    msg: data.message || "Failed to get GitHub user"
                };
            }

            const user = await userResponse.json();

            if (user.login.toLowerCase() !== owner.toLowerCase()) {
                return {
                    success: false,
                    msg: `You cannot create ${repository}. Your GitHub account is ${user.login}`
                };
            }
        }

        const createUrl = organization
            ? `${GITHUB_API}/orgs/${owner}/repos`
            : `${GITHUB_API}/user/repos`;

        const response = await fetch(
            createUrl,
            {
                method: "POST",
                headers: githubHeaders(token, {
                    "Content-Type": "application/json"
                }),
                body: JSON.stringify({
                    name: repo,
                    private: false,
                    auto_init: true
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return {
                success: false,
                msg: data.message || `GitHub API error: ${response.status}`
            };
        }

        return {
            success: true,
            msg: `Repository ${repository} created`,
            repo: data
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
}

export async function deleteGitHubRepo(token, repository) {
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

    try {
        const response = await fetch(
            `${GITHUB_API}/repos/${owner}/${repo}`,
            {
                method: "DELETE",
                headers: githubHeaders(token)
            }
        );

        if (response.status === 204) {
            return {
                success: true,
                msg: `Repository ${repository} deleted`
            };
        }

        const data = await response.json().catch(() => null);

        return {
            success: false,
            msg: data?.message || `GitHub API error: ${response.status}`
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
}
