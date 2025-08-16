import { Router } from "express";
import { createRepo } from "../controllers/repo.controller";
import { verifyJWT } from "../middlewares/auth.middleware";

const router = Router();

router.post("/repo/create", verifyJWT, createRepo);

export default router;
