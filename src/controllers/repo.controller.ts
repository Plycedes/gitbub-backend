import { Request, Response } from "express";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import fsp from "fs/promises";
import { Repo } from "../models/repo.model";
import { CustomRequest } from "../middlewares/auth.middleware";
import { ApiError } from "../utils/ApiError";
import { asyncHandler } from "../utils/asyncHandler";
import { CreateRepoRequestBody, RepoTreeItem } from "../types/requestTypes";
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

export const getRepoPath = asyncHandler(async (req: Request, res: Response) => {
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
            throw new ApiError(404, `Branch not found: ${branch}`);
        }

        // Read commit to get root tree
        const { commit } = await git.readCommit({ fs, gitdir, oid: head });
        let treeOid = commit.tree;

        // Walk down to the requested scopePath
        if (scopePath) {
            const parts = scopePath.split("/").filter(Boolean);

            for (const part of parts) {
                const { tree } = await git.readTree({ fs, gitdir, oid: treeOid });
                const entry = tree.find((e) => e.path === part);
                if (!entry || entry.type !== "tree") {
                    throw new ApiError(404, `Path not found: ${scopePath}`);
                }
                treeOid = entry.oid;
            }
        }

        // Finally read the tree at the resolved location
        const { tree } = await git.readTree({ fs, gitdir, oid: treeOid });

        const items: RepoTreeItem[] = tree.map((entry) => ({
            name: entry.path,
            path: (scopePath ? scopePath + "/" : "") + entry.path,
            type: entry.type === "tree" ? "dir" : "file",
            oid: entry.oid,
        }));

        // Sort dirs before files
        items.sort((a, b) =>
            a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1
        );

        res.json({ branch, path: scopePath, items });
    } catch (err: any) {
        res.status(err.status || 500).json({ error: err.message || "Failed to read tree" });
    }
});

export const getRepoTree = asyncHandler(async (req: Request, res: Response) => {
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

    // Read commit to get root tree
    const { commit } = await git.readCommit({ fs, gitdir, oid: head });
    let treeOid = commit.tree;

    // Walk down to the requested scopePath if given
    if (scopePath) {
        const parts = scopePath.split("/").filter(Boolean);
        for (const part of parts) {
            const { tree } = await git.readTree({ fs, gitdir, oid: treeOid });
            const entry = tree.find((e) => e.path === part);
            if (!entry || entry.type !== "tree") {
                return res.status(404).json({ error: `Path not found: ${scopePath}` });
            }
            treeOid = entry.oid; // descend into subdirectory
        }
    }

    // recursive walker
    async function buildTree(oid: string, basePath: string): Promise<RepoTreeItem[]> {
        const { tree } = await git.readTree({ fs, gitdir, oid });
        const results: RepoTreeItem[] = [];

        for (const entry of tree) {
            const fullPath = basePath ? `${basePath}/${entry.path}` : entry.path;
            if (entry.type === "tree") {
                results.push({
                    name: entry.path,
                    path: fullPath,
                    type: "dir",
                    oid: entry.oid,
                    children: await buildTree(entry.oid, fullPath),
                });
            } else {
                results.push({
                    name: entry.path,
                    path: fullPath,
                    type: "file",
                    oid: entry.oid,
                });
            }
        }

        results.sort((a, b) =>
            a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1
        );

        return results;
    }

    const tree = await buildTree(treeOid, scopePath);

    res.json({ branch, path: scopePath, tree });
});
