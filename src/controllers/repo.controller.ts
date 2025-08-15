import { Request, Response } from "express";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { Repo } from "../models/repo.model";
import { asyncHandler } from "../utils/asyncHandler";
import { CustomRequest } from "../middlewares/auth.middleware";
import { ApiError } from "../utils/ApiError";

export async function createRepo(req: CustomRequest, res: Response) {
    try {
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
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
}

function handleGitService(req: Request, res: Response, service: "upload-pack" | "receive-pack") {
    const { user, repo } = req.params;
    const repoPath = path.join(process.env.GIT_STORAGE_PATH || "/git", user, `${repo}.git`);

    if (!fs.existsSync(repoPath)) {
        res.status(404).send("Repository not found");
        return;
    }

    res.setHeader("Content-Type", `application/x-git-${service}-result`);

    const gitCommand = service === "upload-pack" ? "upload-pack" : "receive-pack";
    const git = spawn("git", [gitCommand, "--stateless-rpc", repoPath]);
    console.log("Executing handleGit: ", gitCommand);

    req.pipe(git.stdin);
    git.stdout.pipe(res);
    git.stderr.on("data", (data) => console.error(data.toString()));
}

// Handle info/refs (advertise refs for push/clone)
export function getInfoRefs(req: Request, res: Response) {
    const { user, repo } = req.params;
    const { service } = req.query;
    console.log("Executing getInfo");

    if (!service || (service !== "git-upload-pack" && service !== "git-receive-pack")) {
        res.status(400).send("Invalid service");
        return;
    }

    const repoPath = path.join(process.env.GIT_STORAGE_PATH || "/git", user, `${repo}.git`);
    console.log("Repo", repoPath);
    if (!fs.existsSync(repoPath)) {
        res.status(404).send("Repository not found");
        return;
    }

    res.setHeader("Content-Type", `application/x-${service}-advertisement`);
    res.write(formatGitServiceHeader(`# service=${service}\n`));
    res.write("0000");

    const gitCommand = service === "git-upload-pack" ? "upload-pack" : "receive-pack";
    const git = spawn("git", [gitCommand, "--stateless-rpc", "--advertise-refs", repoPath]);

    git.stdout.pipe(res);
    git.stderr.on("data", (data) => console.error(data.toString()));
}

function formatGitServiceHeader(message: string) {
    const length = (message.length + 4).toString(16).padStart(4, "0");
    return length + message;
}

// Handle clone/fetch
export function gitUploadPack(req: Request, res: Response) {
    handleGitService(req, res, "upload-pack");
}

// Handle push
export function gitReceivePack(req: Request, res: Response) {
    console.log("here");
    handleGitService(req, res, "receive-pack");
}
