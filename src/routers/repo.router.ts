import { Router } from "express";
import { createRepo, getRepoPath, getRepoTree } from "../controllers/repo.controller";
import { verifyJWT } from "../middlewares/auth.middleware";

const router = Router();

router.post("/create", verifyJWT, createRepo);
router.get("/:user/:repo/tree", verifyJWT, getRepoTree);
router.get("/:user/:repo/path", verifyJWT, getRepoPath);

export default router;
