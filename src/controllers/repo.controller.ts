import { Response } from "express";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { Repo } from "../models/repo.model";
import { CustomRequest } from "../middlewares/auth.middleware";
import { ApiError } from "../utils/ApiError";
import { asyncHandler } from "../utils/asyncHandler";
import { CreateRepoRequestBody } from "../types/requestTypes";

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
