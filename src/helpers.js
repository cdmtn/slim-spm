import fs from "node:fs";
import path from "node:path";
import { rm, mkdir } from 'node:fs/promises';
import chalk from "chalk";

export function readJson(file) {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""))
}

export function projectPackagesDir() {
    let config = {}
    try {
        config = readJson(path.join(process.cwd(), "slimconfig.json"))
    } catch {}
    const names = config.names && typeof config.names === "object" ? config.names : {}
    const value = names.packages ?? config.packages
    return path.resolve(typeof value === "string" && value.trim() ? value : "packages")
}

export const formatError = chalk.red.bold
export const formatSuccess = chalk.green.bold
export const formatItalic = chalk.italic
export const formatBold = chalk.bold
export const rootPath = process.cwd()
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function log(...text) {
    console.log(`[SPM]`, ...text)
}
export function error(...text) {
    console.error(`[SPM]`, ...text)
}

export function isValidPackageName(name) {
	return typeof name === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) && !name.includes("..")
}

export function isPackageExists(name) {
	return isValidPackageName(name) && fs.existsSync(path.join(projectPackagesDir(), name))
}
export function getPackagePath(name) {
	return path.join(projectPackagesDir(), name)
}

export async function deleteDirectory(dirPath) {
	try {
		await rm(dirPath, { recursive: true, force: true });
		return true
	} catch (err) {
		return false
	}
}

export async function loading({ startMsg, callback }) {
	function fail(...args) {
		return {
			success: false,
			msg: args.join(" ")
		}
	}
	function ok(...args) {
		return {
			success: true,
			msg: args.join(" ")
		}
	}

    const spinChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;

    const render = (char, msg) => {
        process.stdout.write(
            `\r\x1b[2K${chalk.green.bold(`[SPM] ${char} ${msg}`)}`
        );
    };

    const spinnerInterval = setInterval(() => {
        render(spinChars[i++ % spinChars.length], startMsg);
	}, 100);

    try {
        const result = await callback({ fail, ok });

        clearInterval(spinnerInterval);

        process.stdout.write('\r\x1b[2K');

        if (!result || typeof result.success !== 'boolean') {
            process.exitCode = 1;
            return {
                success: false,
                msg: 'Invalid callback result'
            };
        }

        if (!result.success) process.exitCode = 1;

        const icon = result.success ? '✓' : '✗';

        process.stdout.write(
            `${chalk.green.bold(`[SPM] ${icon} ${result.msg}`)}\n`
        );

        return result;
    } catch (error) {
        clearInterval(spinnerInterval);
        process.exitCode = 1;

        process.stdout.write('\r\x1b[2K');

        const result = {
            success: false,
            msg: error instanceof Error ? error.message : String(error)
        };

        process.stdout.write(
            `${chalk.red.bold(`[SPM] ✗ ${result.msg}`)}\n`
        );

        return result;
    }
}

export async function createFolder(path) {
	try {
		await mkdir(path, { recursive: true });
		return { success: true }
	} catch (err) {
		return {
			success: false,
			content: err.message
		}
	}
}

export function createFile(filePath, content) {
    try {
        const normalized = content
            .replace(/^\s*\n/, "")
            .replace(/\n\s*$/, "")
            .replace(/^[ \t]+/gm, line => {
                return line.replace(/^[ \t]{0,7}/, "");
            });

        fs.writeFileSync(filePath, normalized);

		return {
			success: true
		}
    }
    catch (err) {
        return {
            success: false,
            content: err.message
        };
    }
}