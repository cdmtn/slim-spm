import path from "node:path"
import { formatItalic, getPackagePath, isPackageExists } from "../helpers.js"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"

export function validateGitHub(value) {
    const regex = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\/[a-zA-Z0-9._-]+$/;

    if (regex.test(value)) {
        return {
            success: true,
            value
        };
    }

    try {
        const url = new URL(value);

        if (url.hostname === "github.com") {
            const parts = url.pathname.split("/").filter(Boolean);

            if (parts.length >= 2) {
                const github = `${parts[0]}/${parts[1]}`;

                return {
                    success: false,
                    value: github,
                    msg: `Use "${github}" instead of "${value}"`
                };
            }
        }
    } catch {}

    return {
        success: false,
        msg: `Invalid GitHub repository. Expected "user/repo".`
    };
}

export async function getSPM(pkgName) {
	if (isPackageExists(pkgName)) {
		const pkgPath = getPackagePath(pkgName)
		const dotSpmPath = path.join(pkgPath, ".spm")

		if (existsSync(dotSpmPath)) {
			try {
				const data = await readFile(dotSpmPath, 'utf8');
				return {
					success: true,
					content: parseSPM(data)
				}
			} catch (err) {
				return {
					success: false,
					content: String(err)
				}
			}
		}
		else {
			return {
				success: false,
				content: ".spm file doest not exists inside the package"
			}
		}
	}
	else return {
		success: false,
		content: "Package does not exists"
	}
}

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"])

export function parseSPM(content) {
	const result = {};
    const required = ["name", "version"]
	const allowedRoot = new Set(["name", "version", "description"]);

	const githubSectionAllowed = new Set(["repo", "organization"]);

	let currentSection = null;

    for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith("#")) {
            continue;
        }

        if (trimmed.startsWith("@")) {
			const section = trimmed.slice(1).trim();

            if (!section) {
                throw new Error("empty section name");
            }

            currentSection = section.split("/").map(part => part.trim());

			let target = result;

            for (const part of currentSection) {
                if (!/^[a-zA-Z_][\w-]*$/.test(part) || UNSAFE_KEYS.has(part)) {
                    throw new Error(`invalid section name "${section}"`);
                }
                if (!Object.hasOwn(target, part)) {
                    target[part] = {};
				}
                else if (typeof target[part] !== "object") {
                    throw new Error(`section "${section}" conflicts with property "${part}"`);
                }

                target = target[part];
            }

            continue;
        }

        const match = trimmed.match(/^([a-zA-Z_][\w-]*)\s*=\s*"([^"]*)"$/);

        if (!match) {
            throw new Error(`invalid line: ${trimmed}`);
        }

        const [, key, value] = match;

        if (!currentSection) {
            if (!allowedRoot.has(key)) {
                throw new Error(`unknown property "${key}"`);
            }

            if (Object.hasOwn(result, key)) {
                throw new Error(`duplicate property "${key}"`);
            }

            result[key] = value;
            continue;
        }

        const sectionName = currentSection.join("/");

        if (sectionName === "github") {
            if (!githubSectionAllowed.has(key)) {
                throw new Error(
                    `unknown property "${key}" in @${sectionName} section`
                );
			}

			if (key == "repo") {
				const repoTest = validateGitHub(value)
				if (!repoTest.success) {
					throw new Error(`@${sectionName}/${key}: ${repoTest.msg}`);
				}
			}

			if (key === "organization" && value !== "true" && value !== "false") {
				throw new Error(`@${sectionName}/${key} must be "true" or "false"`);
			}
		}

        let target = result;

		for (const part of currentSection) {
            target = target[part];
        }

        if (UNSAFE_KEYS.has(key)) {
            throw new Error(`invalid property name "${key}"`);
        }

        if (Object.hasOwn(target, key)) {
            throw new Error(`duplicate property "${key}"`);
        }

        target[key] = (sectionName === "github" && key === "organization")
            ? value === "true"
            : value;
    }

    for (const key of required) {
        if (!result[key]) {
            throw new Error(`missing required property "${key}"`);
        }
    }

    return result;
}
