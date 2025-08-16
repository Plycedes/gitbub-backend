import { Router } from "express";
import {
    createRepo,
    getInfoRefs,
    gitUploadPack,
    gitReceivePack,
} from "../controllers/repo.controller";
import { verifyJWT } from "../middlewares/auth.middleware";
import { verifyBasicAuth } from "../middlewares/basicAuth.middleware";

const router = Router();

// Create a new repo (needs auth)
router.post("/repo/create", verifyJWT, createRepo);

// Git Smart HTTP endpoints
router.get("/:user/:repo([^.]+)\\.git/info/refs", getInfoRefs);
router.post("/:user/:repo([^.]+)\\.git/git-upload-pack", gitUploadPack);
router.post("/:user/:repo([^.]+)\\.git/git-receive-pack", verifyBasicAuth, gitReceivePack);

export default router;
