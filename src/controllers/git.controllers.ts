import { NextFunction, Request, Response } from "express";
import { spawn } from "child_process";
import { Repo } from "../models/repo.model";
import { CustomRequest } from "../middlewares/auth.middleware";
import { ApiError } from "../utils/ApiError";
import {
    bareRepoPath,
    ensureRepoExists,
    formatGitServiceHeader,
    makeTempWorkdir,
    rmrf,
    toPosix,
} from "./helpers/git.helpers";
import { asyncHandler } from "../utils/asyncHandler";
import * as git from "isomorphic-git";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";

export const getInfoRefs = asyncHandler(async (req: Request, res: Response) => {
    const { user, repo } = req.params;
    const { service } = req.query;
    console.log("Executing getInfo");

    if (!service || (service !== "git-upload-pack" && service !== "git-receive-pack")) {
        throw new ApiError(400, "Invalid service");
    }

    const repoPath = bareRepoPath(user, repo);
    await ensureRepoExists(repoPath);

    res.setHeader("Content-Type", `application/x-${service}-advertisement`);
    res.write(formatGitServiceHeader(`# service=${service}\n`));
    res.write("0000");

    const gitCommand = service === "git-upload-pack" ? "upload-pack" : "receive-pack";
    const git = spawn("git", [gitCommand, "--stateless-rpc", "--advertise-refs", repoPath]);

    git.stdout.pipe(res);
    git.stderr.on("data", (data) => console.error(data.toString()));
});

export const gitUploadPack = asyncHandler(async (req: Request, res: Response) => {
    const { user, repo } = req.params;

    const repoPath = bareRepoPath(user, repo);
    await ensureRepoExists(repoPath);

    res.setHeader("Content-Type", `application/x-git-upload-pack-result`);

    const git = spawn("git", ["upload-pack", "--stateless-rpc", repoPath]);
    console.log("Executing upload-pack");

    req.pipe(git.stdin);
    git.stdout.pipe(res);
    git.stderr.on("data", (data) => console.error(data.toString()));
});

export const gitReceivePack = asyncHandler(
    async (req: CustomRequest, res: Response, next: NextFunction) => {
        const { user, repo } = req.params;
        const repoPath = bareRepoPath(user, repo);
        await ensureRepoExists(repoPath);

        const repoDoc = await Repo.findOne({ name: repo }).populate("owner", "username _id");
        if (!repoDoc) {
            res.status(404).send("Repository not found");
            return;
        }

        if (!req.user || repoDoc.owner._id.toString() !== req.user?._id.toString()) {
            console.log(
                "Wrong credentials: ",
                req.user?._id.toString(),
                repoDoc.owner._id.toString()
            );
            res.status(403).send("You do not have permission to push to this repository");
            return;
        }

        const branchProtectionEnabled = false; // could be a DB field
        if (branchProtectionEnabled) {
            let rawBody = "";
            req.on("data", (chunk) => (rawBody += chunk));
            req.on("end", () => {
                if (rawBody.includes("refs/heads/main")) {
                    const err = new ApiError(403, "Direct pushes not allowed");
                    next(err);
                }
                proxyGitService(res, repoPath, rawBody, "receive-pack");
            });
            return;
        }

        proxyGitService(res, repoPath, req, "receive-pack");
    }
);

export function proxyGitService(
    res: Response,
    repoPath: string,
    input: any,
    service: "upload-pack" | "receive-pack"
) {
    res.setHeader("Content-Type", `application/x-git-${service}-result`);
    const git = spawn("git", [service, "--stateless-rpc", repoPath]);

    if (typeof input === "string") {
        git.stdin.write(input);
        git.stdin.end();
    } else {
        input.pipe(git.stdin);
    }

    git.stdout.pipe(res);
    git.stderr.on("data", (data) => console.error(data.toString()));
}
