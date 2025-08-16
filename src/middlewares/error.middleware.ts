import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/ApiError"; // adjust path

const errorHandler = (err: any, _: Request, res: Response, next: NextFunction) => {
    console.error(err);

    if (err instanceof ApiError) {
        return res.status(err.statusCode).json({
            success: err.success,
            message: err.message,
            errors: err.errors,
            data: err.data,
        });
    }

    return res.status(500).json({
        success: false,
        message: err.message || "Internal Server Error",
        errors: [],
        data: null,
    });
};

export { errorHandler };
