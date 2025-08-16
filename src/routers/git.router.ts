import { Router } from "express";
import { getInfoRefs, gitUploadPack, gitReceivePack } from "../controllers/git.controllers";
import { verifyBasicAuth } from "../middlewares/basicAuth.middleware";

const router = Router();

// Git Smart HTTP endpoints
router.get("/:user/:repo([^.]+)\\.git/info/refs", getInfoRefs);
router.post("/:user/:repo([^.]+)\\.git/git-upload-pack", gitUploadPack);
router.post("/:user/:repo([^.]+)\\.git/git-receive-pack", verifyBasicAuth, gitReceivePack);

export default router;
