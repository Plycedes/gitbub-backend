import { Request, Response } from "express";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import fsp from "fs/promises";
import { Repo } from "../models/repo.model";
import { CustomRequest } from "../middlewares/auth.middleware";
import { ApiError } from "../utils/ApiError";
import { asyncHandler } from "../utils/asyncHandler";
import { CreateRepoRequestBody, EditFileRequest, RepoTreeItem } from "../types/requestTypes";
import {
    bareRepoPath,
    ensureRepoExists,
    formatGitServiceHeader,
    makeTempWorkdir,
    rmrf,
    toPosix,
} from "./helpers/git.helpers";
import * as git from "isomorphic-git";
import { ApiResponse } from "../utils/ApiResponse";
import { User } from "../models/user.model";

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

export const getUserRepos = asyncHandler(async (req: Request, res: Response) => {
    const { username } = req.params;
    const user = await User.findOne({ username: username });
    if (!user) {
        throw new ApiError(404, "User not found");
    }
    const repos = await Repo.find({ $and: [{ owner: user._id }, { visibility: "public" }] });
    return res.status(200).json(new ApiResponse(200, repos, "Fetched user repos successfully"));
});

export const getRepoPath = asyncHandler(async (req: Request, res: Response) => {
    try {
        const { user, repo } = req.params as { user: string; repo: string };
        const branch = (req.query.branch as string) || "main";
        const scopePath = toPosix((req.query.path as string) || "");

        const gitdir = bareRepoPath(user, repo);
        await ensureRepoExists(gitdir);

        // Resolve branch → commit
        let commitOid: string;
        if (req.query.commit) {
            commitOid = req.query.commit as string;
        } else {
            try {
                commitOid = await git.resolveRef({ fs, gitdir, ref: branch });
            } catch {
                throw new ApiError(404, `Branch not found: ${branch}`);
            }
        }

        // Read commit to get root tree
        const commitInfo = await git.readCommit({ fs, gitdir, oid: commitOid }).catch(() => null);
        if (!commitInfo) throw new ApiError(404, "Commit not found");
        let treeOid = commitInfo.commit.tree;

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
    let commitOid: string;
    if (req.query.commit) {
        commitOid = req.query.commit as string;
    } else {
        try {
            commitOid = await git.resolveRef({ fs, gitdir, ref: branch });
        } catch {
            throw new ApiError(404, `Branch not found: ${branch}`);
        }
    }

    // Read commit to get root tree
    const commitInfo = await git.readCommit({ fs, gitdir, oid: commitOid }).catch(() => null);
    if (!commitInfo) throw new ApiError(404, "Commit not found");
    let treeOid = commitInfo.commit.tree;

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

export const getRepoCommits = asyncHandler(async (req: Request, res: Response) => {
    const { user, repo } = req.params as { user: string; repo: string };
    const branch = (req.query.branch as string) || "main";
    const depth = req.query.depth;

    const gitdir = bareRepoPath(user, repo);
    await ensureRepoExists(gitdir);

    const entries = await git.log({ fs, gitdir, ref: branch, depth: 100 }).catch(() => null);
    if (!entries) throw new ApiError(404, `Branch not found: ${branch}`);

    const history = entries.map((e) => ({
        sha: e.oid,
        message: e.commit.message,
        author: e.commit.author?.name,
        email: e.commit.author?.email,
        date: e.commit.author?.timestamp ? new Date(e.commit.author.timestamp * 1000) : undefined,
        parents: e.commit.parent,
    }));

    res.json(history);
});

export const getFileContent = asyncHandler(async (req: Request, res: Response) => {
    const { user, repo } = req.params as { user: string; repo: string };
    const branch = (req.query.branch as string) || "main";
    const filepath = toPosix((req.query.path as string) || "");

    if (!filepath) throw new ApiError(400, "File path missing");

    const gitdir = bareRepoPath(user, repo);
    await ensureRepoExists(gitdir);

    let commitOid: string;
    if (req.query.commit) {
        commitOid = req.query.commit as string;
    } else {
        try {
            commitOid = await git.resolveRef({ fs, gitdir, ref: branch });
        } catch {
            throw new ApiError(404, `Branch not found: ${branch}`);
        }
    }

    const content = await git.readBlob({ fs, gitdir, oid: commitOid, filepath }).catch(() => null);
    if (!content) return res.status(404).json({ error: "File not found at ref" });
    const text = new TextDecoder("utf-8").decode(content.blob);

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.status(200).send(text);
});

export const editFileAndCommit = asyncHandler(
    async (req: CustomRequest<EditFileRequest>, res: Response) => {
        const { user, repo } = req.params as { user: string; repo: string };
        const { branch = "main", filepath, content, message, authorName, authorEmail } = req.body;

        if (!filepath || !message) {
            throw new ApiError(400, "Missing filepath or commit message");
        }

        const safePath = toPosix(filepath);
        const gitdir = bareRepoPath(user, repo);

        try {
            await git.resolveRef({ fs, gitdir, ref: branch });
        } catch {
            throw new ApiError(404, `Branch not found: ${branch}`);
        }

        try {
            await ensureRepoExists(gitdir);

            // Make a tiny temp workdir linked to the bare repo
            const { dir } = await makeTempWorkdir(gitdir);
            try {
                // Ensure folder structure exists
                const absFile = path.join(dir, safePath);
                await fsp.mkdir(path.dirname(absFile), { recursive: true });

                // Write new content (you can support base64 or binary if needed)
                await fsp.writeFile(absFile, content, "utf8");

                // Stage & commit against the branch in the *bare* repo
                await git.add({ fs, dir, gitdir, filepath: safePath });

                const author = {
                    name: authorName || "Web Editor",
                    email: authorEmail || "web@example.com",
                    timestamp: Math.floor(Date.now() / 1000),
                    timezoneOffset: new Date().getTimezoneOffset(),
                };

                const oid = await git.commit({
                    fs,
                    dir,
                    gitdir,
                    message,
                    author,
                    committer: author,
                    ref: branch,
                });

                // Optionally return the new commit + tree info
                res.json({ ok: true, oid, branch, path: safePath });
            } finally {
                await rmrf(dir);
            }
        } catch (err: any) {
            throw new ApiError(500, "Edit/commit failed");
        }
    }
);
