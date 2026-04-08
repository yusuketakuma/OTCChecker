import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createNodePrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function createPrismaClient() {
  try {
    const { env } = getCloudflareContext();
    const cloudflareEnv = env as {
      DB?: ConstructorParameters<typeof PrismaD1>[0];
    };

    if (cloudflareEnv.DB) {
      const adapter = new PrismaD1(cloudflareEnv.DB);

      return new PrismaClient({
        adapter,
        log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
      });
    }
  } catch {
    // Fall through to local Node.js / Next.js development using sqlite DATABASE_URL.
  }

  return globalForPrisma.prisma ?? createNodePrismaClient();
}

export function getPrisma() {
  const prisma = createPrismaClient();

  if (process.env.NODE_ENV !== "production" && !globalForPrisma.prisma) {
    globalForPrisma.prisma = prisma;
  }

  return prisma;
}
