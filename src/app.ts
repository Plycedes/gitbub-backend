import express, { Application, Request, Response } from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import { errorHandler } from "./middlewares/error.middleware";

dotenv.config();

const app: Application = express();

app.use(
    cors({
        origin: process.env.CORS_ORIGIN || "*",
        credentials: true,
    })
);

app.use(express.static("public"));
app.use(cookieParser());

// Debug logging
app.use((req, res, next) => {
    console.log("Incoming request:", req.method, req.url);
    next();
});

// Health check
app.get("/", (req: Request, res: Response) => {
    res.status(200).send({ status: "OK" });
});
app.get("/api/v1/", (req: Request, res: Response) => {
    res.status(200).send({ status: "OK" });
});

import userRouter from "./routers/user.router";
import repoRouter from "./routers/repo.router";

app.use(
    "/api/v1/users",
    express.json({ limit: "16kb" }),
    express.urlencoded({ extended: true, limit: "16kb" }),
    userRouter
);
app.use("/api/v1/repos", express.json(), express.urlencoded({ extended: true }), repoRouter);

import gitRouter from "./routers/git.router";
app.use("", gitRouter);

app.use(errorHandler);

export { app };
