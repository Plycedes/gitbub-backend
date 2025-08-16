import * as git from "isomorphic-git";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { ApiError } from "../../utils/ApiError";

export function bareRepoPath(user: string, repo: string) {
    return path.join(process.env.GIT_STORAGE_PATH || "./data/git", user, `${repo}.git`);
}

export async function ensureRepoExists(p: string) {
    if (!fs.existsSync(p)) {
        throw new ApiError(404, "Repository not found");
    }
}

export function toPosix(fp: string) {
    return fp.replace(/\\/g, "/");
}

export async function makeTempWorkdir(gitdir: string) {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), `repo-edit-`));
    return { dir: tmp, gitdir };
}

export async function rmrf(p: string) {
    try {
        await fsp.rm(p, { recursive: true, force: true });
    } catch {}
}

export function formatGitServiceHeader(message: string) {
    const length = (message.length + 4).toString(16).padStart(4, "0");
    return length + message;
}
