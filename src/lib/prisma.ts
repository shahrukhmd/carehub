import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// In development the client is cached across hot reloads. After a schema change the cached instance
// predates the new models, so replace it if any current model is missing.
function isCurrent(client: PrismaClient) {
  return Object.values(Prisma.ModelName).every((model) => {
    const key = model.charAt(0).toLowerCase() + model.slice(1);
    return key in client;
  });
}

const cached = globalForPrisma.prisma;
if (cached && !isCurrent(cached)) void cached.$disconnect();

export const prisma =
  cached && isCurrent(cached)
    ? cached
    : new PrismaClient({
        log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
      });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
