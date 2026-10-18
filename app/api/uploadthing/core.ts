import { createUploadthing, type FileRouter } from "uploadthing/next";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";

const f = createUploadthing();

export const ourFileRouter = {
  vehicleImage: f({
    image: { maxFileSize: "4MB", maxFileCount: 1 },
  })
    .middleware(async () => {
      const cookieStore = await cookies();
      const token = cookieStore.get("aura_token")?.value;
      if (!token) throw new Error("Unauthorized");

      try {
        const secret = process.env.JWT_SECRET;
        if (!secret) throw new Error("JWT_SECRET not configured");
        const payload = jwt.verify(token, secret) as unknown as { sub: number; role: string };
        if (payload.role !== "admin" && payload.role !== "staff") {
          throw new Error("Only admin/staff can upload");
        }
        return { userId: payload.sub };
      } catch {
        throw new Error("Unauthorized");
      }
    })
    .onUploadComplete(async ({ file }) => {
      return { url: file.ufsUrl };
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
