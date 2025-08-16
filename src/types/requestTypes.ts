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

enum Visibility {
    PUBLIC = "public",
    PRIVATE = "private",
}

export interface CreateRepoRequestBody {
    name: string;
    visibility: Visibility;
    description?: string;
}

export interface RepoTreeItem {
    name: string;
    path: string;
    type: "dir" | "file";
    oid: string;
    children?: RepoTreeItem[];
}
