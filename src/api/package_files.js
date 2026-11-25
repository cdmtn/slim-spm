import fs from "node:fs/promises"
import path from "node:path"

export const DEFAULT_IGNORES = ["node_modules/", "slim-dist/", "spm.lock.json", ".DS_Store", "Thumbs.db"]

function escapeRegex(char) {
    return /[.*+?^${}()|[\]\\/]/.test(char) ? `\\${char}` : char
}

function globToRegex(glob, anchored) {
    let source = ""

    for (let i = 0; i < glob.length; i++) {
        const char = glob[i]

        if (char === "*") {
            if (glob[i + 1] === "*" && (i === 0 || glob[i - 1] === "/")) {
                if (i + 2 === glob.length) {
                    source += ".*"
                    i += 1
                    continue
                }
                if (glob[i + 2] === "/") {
                    source += "(?:.*/)?"
                    i += 2
                    continue
                }
            }
            source += "[^/]*"
        }
        else if (char === "?") {
            source += "[^/]"
        }
        else if (char === "[") {
            const end = glob.indexOf("]", i + 2)
            if (end === -1) {
                source += "\\["
                continue
            }
            let set = glob.slice(i + 1, end).replaceAll("\\", "\\\\")
            if (set[0] === "!") set = "^" + set.slice(1)
            source += `[${set}]`
            i = end
        }
        else if (char === "\\" && i + 1 < glob.length) {
            source += escapeRegex(glob[++i])
        }
        else {
            source += escapeRegex(char)
        }
    }

    return new RegExp(`^${anchored ? "" : "(?:.*/)?"}${source}$`)
}

export function parseIgnore(content, base = "") {
    const rules = []

    for (const raw of content.split(/\r?\n/)) {
        let line = raw.replace(/(?<!\\)\s+$/, "")
        if (!line || line.startsWith("#")) continue

        let negate = false
        if (line.startsWith("!")) {
            negate = true
            line = line.slice(1)
        }
        else if (line.startsWith("\\!") || line.startsWith("\\#")) {
            line = line.slice(1)
        }

        let dirOnly = false
        if (line.endsWith("/")) {
            dirOnly = true
            line = line.replace(/\/+$/, "")
        }
        if (!line) continue

        const anchored = line.includes("/")
        line = line.replace(/^\/+/, "")
        if (!line) continue

        rules.push({ base, negate, dirOnly, regex: globToRegex(line, anchored) })
    }

    return rules
}

export function isIgnored(rules, relPath, isDir) {
    let ignored = false

    for (const rule of rules) {
        if (rule.dirOnly && !isDir) continue
        if (rule.base && !relPath.startsWith(rule.base)) continue
        if (rule.regex.test(relPath.slice(rule.base.length))) ignored = !rule.negate
    }

    return ignored
}

async function readIgnoreFile(file, base) {
    try {
        return parseIgnore(await fs.readFile(file, "utf8"), base)
    }
    catch (error) {
        if (error.code === "ENOENT" || error.code === "EISDIR") return []
        throw error
    }
}

export async function getPackageFiles(dir) {
    const files = []

    async function walk(absDir, relDir, inherited) {
        const own = await readIgnoreFile(path.join(absDir, ".gitignore"), relDir ? `${relDir}/` : "")
        const rules = own.length ? [...inherited, ...own] : inherited
        const entries = await fs.readdir(absDir, { withFileTypes: true })
        entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

        for (const entry of entries) {
            if (entry.name === ".git") continue

            const relPath = relDir ? `${relDir}/${entry.name}` : entry.name
            const isDir = entry.isDirectory()
            if (isIgnored(rules, relPath, isDir)) continue

            if (isDir) await walk(path.join(absDir, entry.name), relPath, rules)
            else if (entry.isFile()) files.push({ path: relPath, fullPath: path.join(absDir, entry.name) })
        }
    }

    await walk(dir, "", parseIgnore(DEFAULT_IGNORES.join("\n")))
    return files
}
