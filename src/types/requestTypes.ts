import { ParsedQs } from "qs";

export interface RegisterRequestBody {
    email: string;
    username: string;
    password: string;
}

export interface LoginRequestBody {
    email?: string;
    username?: string;
    password: string;
}

export interface ChangePasswordRequestBody {
    oldPassword: string;
    newPassword: string;
}

export interface PaginationType extends ParsedQs {
    page?: string;
    limit?: string;
    query?: string;
}
