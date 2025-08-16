import { Router } from "express";
import {
    createRepo,
    getFileContent,
    getRepoCommits,
    getRepoPath,
    getRepoTree,
} from "../controllers/repo.controller";
import { verifyJWT } from "../middlewares/auth.middleware";

const router = Router();

router.post("/create", verifyJWT, createRepo);
router.get("/:user/:repo/tree", verifyJWT, getRepoTree);
router.get("/:user/:repo/path", verifyJWT, getRepoPath);
router.get("/:user/:repo/commits", verifyJWT, getRepoCommits);
router.get("/:user/:repo/file", verifyJWT, getFileContent);

export default router;
