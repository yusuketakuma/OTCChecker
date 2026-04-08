import { getCloudflareContext } from "@opennextjs/cloudflare";

type PrismaClientInstance = Awaited<ReturnType<typeof createNodePrismaClient>>;

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClientInstance;
};

function getPrismaLogLevels(): Array<"error" | "warn"> {
  return process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"];
}

async function createNodePrismaClient() {
  const { PrismaClient } = await import("@prisma/client");

  return new PrismaClient({
    log: getPrismaLogLevels(),
  });
}

async function createCloudflarePrismaClient(db: unknown) {
  const [{ PrismaClient }, { PrismaD1 }] = await Promise.all([
    import("@prisma/client"),
    import("@prisma/adapter-d1"),
  ]);

  const adapter = new PrismaD1(db as ConstructorParameters<typeof PrismaD1>[0]);

  return new PrismaClient({
    adapter,
    log: getPrismaLogLevels(),
  }) as unknown as PrismaClientInstance;
}

async function createPrismaClient() {
  if (process.env.DATABASE_URL) {
    return globalForPrisma.prisma ?? createNodePrismaClient();
  }

  try {
    const { env } = await getCloudflareContext({ async: true });
    const cloudflareEnv = env as {
      DB?: unknown;
    };

    if (cloudflareEnv.DB) {
      return createCloudflarePrismaClient(cloudflareEnv.DB);
    }
  } catch {
    // Fall through to local Node.js / Next.js development using sqlite DATABASE_URL.
  }

  return globalForPrisma.prisma ?? createNodePrismaClient();
}

export async function getPrisma() {
  const prisma = await createPrismaClient();

  if (process.env.NODE_ENV !== "production" && !globalForPrisma.prisma) {
    globalForPrisma.prisma = prisma;
  }

  return prisma;
}
