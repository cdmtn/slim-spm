#!/usr/bin/env node

import { Command } from "commander";
import { formatError, formatBold, formatItalic, formatSuccess, createFolder, createFile } from "./helpers.js"
import pkg from "../package.json" with { type: "json" };
import { log, isPackageExists, isValidPackageName, rootPath, deleteDirectory, loading, delay, projectPackagesDir } from "./helpers.js";

import fs from "node:fs"
import path from "node:path"
import { getSPM } from "./parsers/spm.js";
import { loginGitHub } from "./api/github_auth.js";
import { deleteGitHubToken, getGitHubToken, saveGitHubToken } from "./api/storage.js";
import { downloadGitHubRepo, getGitHubUser, packageIntegrity } from "./api/github_get.js";

import { getPackage, publishPackage, removePackage, updatePackage } from "./api/spm.js"
import { readLock, setLockEntry, removeLockEntry } from "./api/lock.js"
import { createGitHubRepo, createGitHubTag, deleteGitHubRepo, githubHeaders, publishToGitHub, updateGitHubRepo } from "./api/github_req.js";

import open from "open";

export const spm = new Command();

function spmlog(...args) {
	console.log("[SPM]", ...args)
}
function errlog(...args) {
	console.log(formatError(...args))
	process.exitCode = 1
}

const packagesPath = projectPackagesDir()

function packageDir(name) {
	if (!isValidPackageName(name)) {
		throw new Error(`"${name}" is not a valid package name: use letters, digits, ".", "_" and "-"`)
	}
	return path.join(packagesPath, name)
}

async function installPackage(name, { version = null, latest = false } = {}) {
	const target = packageDir(name)
	const getPackageReq = await getPackage({ name: name })

	if (!getPackageReq.success) {
		return { success: false, msg: `SPM Install: ${getPackageReq.content}` }
	}

	const githubToken = await getGitHubToken()
	const data = getPackageReq.content
	const repo = data.repo
	const resolvedVersion = version ?? data.latest
	const entry = readLock().packages[name]
	const locked = !latest && entry && entry.repo === repo && (version === null || entry.version === version) ? entry : null
	const wanted = locked ? locked.version : resolvedVersion

	console.log(`\nDownloading ${repo}${locked?.commit ? ` @ ${locked.commit.slice(0, 7)} (locked)` : ""}...`)

	const result = await downloadGitHubRepo(githubToken, repo, target, wanted ?? null, locked, { fallbackToMain: !locked && version === null })
	if (!result.success) return result

	if (result.untagged) {
		spmlog(`${repo} has no tag v${wanted}, installed the newest commit of main instead`)
	}

	if (result.rejected?.length) {
		spmlog(`Skipped ${result.rejected.length} unsafe entr${result.rejected.length === 1 ? "y" : "ies"}: ${result.rejected.slice(0, 5).join(", ")}`)
	}
	setLockEntry(name, { version: wanted, repo, commit: result.commit, integrity: result.integrity })
	return { success: true, msg: `Package @${name}:${wanted} installed (${result.commit.slice(0, 7)})` }
}

function renderObject(obj, indent = 0) {
    let output = "";
    const prefix = " ".repeat(indent);

    Object.entries(obj).forEach(([key, value]) => {
        if (value && typeof value === "object" && !Array.isArray(value)) {
            output += `\n${formatItalic(prefix)}${formatBold(key)}:`;
            output += renderObject(value, indent + 2);
        } else {
            output += `\n${formatItalic(prefix)}${formatBold(key)}: ${value}`;
        }
    });

    return output;
}

function renderBlock({ name, content }) {
	function generateSepLines(len) {
		let line = `-------------------------------------`

		if (len) {
			for (let i = 0; i < len; i++) {
				line += "-"
			}
		}

		return line
	}

	const nameLen = name.length

	return `${formatSuccess(name)} ${generateSepLines()}` +
	content +
	`\n${generateSepLines(nameLen + 1)}`
}

spm
    .name("spm")
    .description(`Slim Package Manager (SPM ${pkg.version})`)
    .version(pkg.version);

spm
    .command("list")
	.action(() => {
		const targetDir = packagesPath
		if (!fs.existsSync(targetDir)) {
			spmlog("No packages installed (the packages/ directory does not exist)")
			return
		}

		const relativePaths = fs.readdirSync(targetDir, { withFileTypes: true })
			.filter(entry => entry.isDirectory() && !/\.spm-(old-)?\d+-\d+$/.test(entry.name))
			.map(entry => entry.name);

		if (relativePaths.length === 0) {
			spmlog("No packages installed")
			return
		}

		function getPkgPath(pkg) {
			const relative = path.relative(process.cwd(), path.join(targetDir, pkg))
			return relative
		}

		spmlog(`List of all installed packages:\n${relativePaths.map(item => "- @" + item + ` (${getPkgPath(item)})`).join(",\n")}`)
	});

spm
    .command("lock")
	.description("Show resolved package versions from spm.lock.json")
	.action(() => {
		const { packages } = readLock()
		const names = Object.keys(packages)

		if (names.length === 0) {
			spmlog("No locked packages (spm.lock.json is empty or missing)")
			return
		}

		spmlog(`Locked packages:\n${names.map(name => `- @${name}:${packages[name].version} (${packages[name].repo}${packages[name].commit ? ` @ ${packages[name].commit.slice(0, 7)}` : ""})`).join("\n")}`)
	});

spm
    .command("get")
    .argument("<name>")
    .action(async (name) => {
        let msg = null;

        if (isPackageExists(name)) {
            const spmFileContent = await getSPM(name);

            if (!spmFileContent.success) {
                errlog(spmFileContent.content);
                return;
            }

			const SPMContent = spmFileContent.content;
			let packageName = "@" + name

			const infoFromRegistryReq = await getPackage({ name: name })

			if(infoFromRegistryReq.success) {
				packageName = `${packageName} (${infoFromRegistryReq.content.latest})`
			}

			msg = renderBlock({
				name: packageName,
				content: renderObject(SPMContent)
			})
        } else {
            msg =
                formatError(`@${name} not installed\n`) +
                `Want to install? Try ${formatItalic(`${spm.name()} i ${name}`)}`;
        }

        spmlog(msg);
    });

spm
    .command("rm")
	.argument('<name>')
	.option("--g", "Removes the project from the project registry and GitHub")
	.action(async (name, opt) => {
		await loading({
			startMsg: `Removing @${name}...`,
			callback: async ({ fail, ok }) => {
				const isGlobally = opt.g == undefined ? false : true

				if (isGlobally) {
					const spmFileContent = await getSPM(name);

					if (!spmFileContent.success) {
						return fail("SPM Check:", spmFileContent.content);
					}

					const SPMContent = spmFileContent.content;
					const githubRepo = SPMContent.github?.repo

					if (!githubRepo) {
						return fail("SPM Check: the .spm file has no @github repo")
					}

					const githubToken = await getGitHubToken()

					const removePackageRegReq = await removePackage({
						token: githubToken,
						name: name
					})

					if (!removePackageRegReq.success) {
						return fail("SPM Registry remove:", removePackageRegReq.content)
					}

					const removeFromGithubReq = await deleteGitHubRepo(githubToken, githubRepo)

					if (!removeFromGithubReq.success) {
						return fail(`${githubRepo} failed to remove from Github`)
					}
					else {
						return ok(`${githubRepo} removed from Github and registry`)
					}
				}

				let res = false
				try {
					const dir = packageDir(name)
					if (!fs.existsSync(dir)) {
						if (name in readLock().packages) removeLockEntry(name)
						return fail(`@${name} is not installed`)
					}
					res = await deleteDirectory(dir)
				} catch (error) {
					return fail(error.message)
				}

				if (res) {
					removeLockEntry(name)
					return ok(`package @${name} successfully removed locally`)
				}
				else {
					return fail(`Failed to remove the @${name} package`)
				}
			}
		})
	});

spm
    .command("i")
	.argument("[name]")
	.description("Install a package, or every package in spm.lock.json when no name is given")
    .option("--ver <version>", "Download a specific version")
	.option("--latest", "Ignore the locked commit and take the newest one")
	.action(async (name, opt) => {
		const names = name ? [name] : Object.keys(readLock().packages)
		if (names.length === 0) {
			spmlog("Nothing to install: spm.lock.json is empty or missing")
			return
		}
		for (const packageName of names) {
			await loading({
				startMsg: `Installing @${packageName}...`,
				callback: async ({ fail, ok }) => {
					try {
						const result = await installPackage(packageName, { version: name ? opt.ver ?? null : null, latest: !!opt.latest })
						return result.success ? ok(result.msg) : fail(result.msg)
					} catch (error) {
						return fail(error.message)
					}
				}
			})
		}
	});

spm
    .command("verify")
	.description("Check that installed packages match spm.lock.json")
	.action(() => {
		const { packages } = readLock()
		const names = Object.keys(packages)
		if (names.length === 0) {
			spmlog("No locked packages (spm.lock.json is empty or missing)")
			return
		}
		let broken = 0
		for (const name of names) {
			const dir = packageDir(name)
			const expected = packages[name].integrity
			if (!fs.existsSync(dir)) {
				broken++
				errlog(`@${name}: not installed`)
			} else if (!expected) {
				spmlog(`@${name}: no integrity in spm.lock.json, reinstall it to record one`)
			} else if (packageIntegrity(dir) !== expected) {
				broken++
				errlog(`@${name}: files differ from spm.lock.json`)
			} else {
				spmlog(`@${name}: ok`)
			}
		}
		if (broken > 0) process.exitCode = 1
	});

spm
    .command("create")
	.argument("<name>")

	.option("--github", "Create repository on Github")
	.option("--local", "Create minimum package template in packages")

	.option("--github-repo <repoName>", "Fill in '@github/repo' in the configuration")
	.option("--description <description>", "Fill in 'description' in the configuration")
	.option("--ver <version>", "Fill in 'version' in the configuration")

	.action(async (name, opt) => {
		const defaultGithubRepo = opt.githubRepo == undefined ? "username/repo" : opt.githubRepo
		const defaultDescription = opt.description == undefined ? "My first Slim package" : opt.description
		const defaultVersion = opt.ver == undefined ? "1.0.0" : opt.ver

		if (opt.local) {
			const isExists = isPackageExists(name)

			await loading({
				startMsg: `Creating path for ${name}`,
				callback: async ({ fail, ok }) => {
					const packagePath = packageDir(name)
					const unsafe = [defaultDescription, defaultVersion, defaultGithubRepo].find(value => /["\r\n]/.test(String(value)))

					if (unsafe !== undefined) return fail(`Values cannot contain quotes or line breaks: ${unsafe}`)
					if (isExists) return fail("Package is already exists")
					else {
						const createFolderReq = await createFolder(packagePath)

						if (!createFolderReq.success) {
							return fail(createFolderReq.content)
						}
						else {
							const createSPMReq = createFile(path.join(packagePath, ".spm"), `
							name = "${name}"
							description = "${defaultDescription}"
							version = "${defaultVersion}"

							@ github
								repo = "${defaultGithubRepo}"
							`.trim())

							if (!createSPMReq.success) {
								return fail(createSPMReq.content)
							}
							else {
								return ok("Local package created")
							}
						}
					}
				}
			})
		}
		else if (opt.github || opt.githubRepo) {
			const spmFileContent = await getSPM(name);

			if (!spmFileContent.success) {
				spmlog(formatError(spmFileContent.content));
				return;
			}

			const SPMContent = spmFileContent.content;
			const packageName = "@" + name;
			const githubRepo = SPMContent.github?.repo
			const organization = SPMContent.github?.organization === true

			if (!githubRepo) {
				errlog("The .spm file has no @github repo");
				return;
			}

			await loading({
				startMsg: `Creating repository for ${packageName}`,
				callback: async ({ fail, ok }) => {
					const githubToken = await getGitHubToken();

					const createRepoReq = await createGitHubRepo(githubToken, githubRepo, organization)

					if (!createRepoReq.success) {
						return fail(createRepoReq.msg)
					}
					else {
						return ok(createRepoReq.msg)
					}
				},
			})
		}
	})

spm
    .command("publish")
	.argument('<name>')
	.action(async (name) => {
		if (isPackageExists(name)) {
			const spmFileContent = await getSPM(name);

			if (!spmFileContent.success) {
				spmlog(formatError(spmFileContent.content));
				return;
			}

			const SPMContent = spmFileContent.content;
			const packageName = "@" + name;

			const githubRepo = SPMContent.github?.repo
			const version = SPMContent.version
			const description = SPMContent.description
			const packagePath = packageDir(name)

			if (githubRepo) {
				await loading({
					startMsg: `Publishing ${packageName}`,
					callback: async ({ fail, ok }) => {
						const githubToken = await getGitHubToken()

						const installationsReq = await fetch(
							"https://api.github.com/user/installations",
							{
								headers: githubHeaders(githubToken),
							},
						);

						const installations = await installationsReq.json()

						if ("total_count" in installations) {
							if (installations.total_count == 0) {
								await open(
									"https://github.com/apps/slim-package-manager/installations/new",
								);

								console.log("\n")
								spmlog(formatError(`No application has been installed on the "${githubRepo}" repository\n`))
								spmlog("Open:", formatBold.underline("https://github.com/apps/slim-package-manager/installations/new"))
								spmlog(`Install the app, then run ${formatItalic(`${spm.name()} publish ${name}`)} again\n`)

								return fail(`No application has been installed on the "${githubRepo}" repository`)
							}
							else {
								const githubPublishReq = await publishToGitHub({
									token: githubToken,
									repo: githubRepo,
									contentPath: packagePath
								})

								if (!githubPublishReq.success) {
									return fail("Github publish:", githubPublishReq.msg)
								}
								else {
									const isPackagesExists = (await getPackage({ name })).success

									if (isPackagesExists) {
										console.log("\nPackage is already exists... updating")

										const updatePackageReq = await updatePackage({
											token: githubToken,
											name: name,
											description: description,
											version: version,
											github: githubRepo
										})

										if (!updatePackageReq.success) {
											return fail("Something went wrong while requesting a package update. Please try again later")
										}
										else {
											console.log("\nUpdating package on Github...")

											const updateReq = await updateGitHubRepo({
												token: githubToken,
												repo: githubRepo,
												packagePath: packagePath,
												version: updatePackageReq.content.latest
											})

											if (!updateReq.success) {
												return fail("Failed to push the new version to GitHub:", updateReq.msg)
											}
											else {
												const publishedVer = updateReq.version
												return ok(`@${name} ${publishedVer} published on Github`)
											}
										}
									}
									else {
										const publishReq = await publishPackage({
											token: githubToken,
											name: name,
											version: version,
											github: githubRepo,
											description: description
										})

										if (!publishReq.success) {
											return fail("SPM Registry publishing:", publishReq.content)
										}
										else {
											const tagReq = await createGitHubTag(githubToken, githubRepo, version, githubPublishReq.commit)
											if (!tagReq.success) {
												return fail(`${packageName} registered, but tagging v${version} on GitHub failed:`, tagReq.msg)
											}
											return ok(`${packageName} published and registred: ${name} v${version}`)
										}
									}
								}
							}
						}
						else {
							return fail("Installations:", installations.message)
						}
					}
				})
			}
			else {
				errlog("No GitHub repository specified");
			}
		} else {
			errlog(`No package founded: ${path.relative(process.cwd(), path.join(packagesPath, name)) || name}`);
		}
	});

spm
    .command("login")
	.description("Connect your GitHub account")
	.option("--check", "Check if you logged in")
	.action(async (opt) => {
		if (opt.check) {
			const token = await getGitHubToken()

			if (token) {
				try {
					const user = await getGitHubUser(token)

					spmlog(formatSuccess("Github connected"))
					spmlog(`${formatBold("Account")}: ${user.name} (${user.html_url})`)
				}
				catch (e) {
					spmlog(formatError(String(e)))
				}
			}
			else {
				spmlog(formatError(`Github NOT connected. Use ${formatItalic.underline(spm.name() + " login")} to login via Github`))
			}
		}
		else {
			await loading({
				startMsg: `Waiting for GitHub authorization...`,
				callback: async () => {
					try {
			            const token = await loginGitHub();
						await saveGitHubToken(token)

						return {
							success: true,
							msg: "Github account connected"
						}
			        }
					catch (error) {
						return {
							success: false,
							msg:`${error.message}`
						}
			        }
				}
			})
		}
    });

spm
    .command("logout")
    .description("Disconnect GitHub account")
    .action(async () => {
        try {
            await deleteGitHubToken();

            spmlog(formatSuccess("GitHub account disconnected"));
        } catch (error) {
        	spmlog(formatError(`✗ ${error.message}`));
            process.exitCode = 1;
        }
    });

spm.parseAsync().catch(err => {
    spmlog(formatError(err?.message ?? String(err)))
    process.exitCode = 1
})
