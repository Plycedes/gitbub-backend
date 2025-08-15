import mongoose, { Schema, Document, Types } from "mongoose";

export interface IRepo extends Document {
    name: string;
    owner: Types.ObjectId; // Reference to User
    description?: string;
    visibility: "public" | "private";
    path: string; // Path to bare repo folder
    defaultBranch: string;
    createdAt: Date;
}

const repoSchema = new Schema<IRepo>(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        owner: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        description: {
            type: String,
        },
        visibility: {
            type: String,
            enum: ["public", "private"],
            default: "public",
        },
        path: {
            type: String,
            required: true, // full path on disk to the bare repo
        },
        defaultBranch: {
            type: String,
            default: "main",
        },
    },
    { timestamps: { createdAt: true, updatedAt: false } }
);

// Ensure unique repo name per user
repoSchema.index({ owner: 1, name: 1 }, { unique: true });

export const Repo = mongoose.model<IRepo>("Repo", repoSchema);
