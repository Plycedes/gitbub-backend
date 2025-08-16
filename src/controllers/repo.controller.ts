import { Request, Response } from "express";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import fsp from "fs/promises";
import { Repo } from "../models/repo.model";
import { CustomRequest } from "../middlewares/auth.middleware";
import { ApiError } from "../utils/ApiError";
import { asyncHandler } from "../utils/asyncHandler";
import { CreateRepoRequestBody } from "../types/requestTypes";
import {
    bareRepoPath,
    ensureRepoExists,
    formatGitServiceHeader,
    makeTempWorkdir,
    rmrf,
    toPosix,
} from "./helpers/git.helpers";
import * as git from "isomorphic-git";

export const createRepo = asyncHandler(
    async (req: CustomRequest<CreateRepoRequestBody>, res: Response) => {
        const { name, visibility } = req.body;

        if (!req.user) {
            throw new ApiError(401, "Unauthorized Request");
        }

        const ownerId = req.user._id;

        const userDir = path.join(process.env.GIT_STORAGE_PATH || "/git", req.user.username);
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }

        const repoPath = path.join(userDir, `${name}.git`);

        await new Promise<void>((resolve, reject) => {
            const git = spawn("git", ["init", "--bare", repoPath]);
            git.on("close", (code) => {
                if (code === 0) resolve();
                else reject(new Error(`git init failed with code ${code}`));
            });
        });

        const repo = await Repo.create({
            name,
            owner: ownerId,
            visibility,
            path: repoPath,
        });

        res.status(201).json({ success: true, repo });
    }
);

interface RepoTreeItem {
    name: string;
    path: string;
    type: "dir" | "file";
    oid: string;
}

export async function getRepoTree(req: Request, res: Response) {
    try {
        const { user, repo } = req.params as { user: string; repo: string };
        const branch = (req.query.branch as string) || "main";
        const scopePath = toPosix((req.query.path as string) || "");

        const gitdir = bareRepoPath(user, repo);
        await ensureRepoExists(gitdir);

        // Resolve branch → commit
        let head: string;
        try {
            head = await git.resolveRef({ fs, gitdir, ref: branch });
        } catch {
            return res.status(404).json({ error: `Branch not found: ${branch}` });
        }

        // Use git.walk to traverse tree at the given path
        const { tree } = await git.readTree({ fs, gitdir, oid: head });

        const items: RepoTreeItem[] = tree.map((entry) => ({
            name: entry.path.split("/").pop()!,
            path: entry.path,
            type: entry.type === "tree" ? "dir" : "file",
            oid: entry.oid,
        }));

        // Apply scope filtering
        items.sort((a, b) =>
            a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1
        );

        res.json({ branch, path: scopePath, items });
    } catch (err: any) {
        res.status(err.status || 500).json({ error: err.message || "Failed to read tree" });
    }
}
