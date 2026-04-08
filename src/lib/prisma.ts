import { getCloudflareContext } from "@opennextjs/cloudflare";

type PrismaClientInstance = Awaited<ReturnType<typeof createNodePrismaClient>>;
type CloudflareEnvWithDb = {
  DB?: unknown;
};

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClientInstance;
};

function getPrismaLogLevels(): Array<"error" | "warn"> {
  return process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"];
}

async function getCloudflareD1Binding() {
  const { env } = await getCloudflareContext({ async: true });
  return (env as CloudflareEnvWithDb).DB;
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
  let cloudflareContextError: unknown;

  try {
    const cloudflareDb = await getCloudflareD1Binding();

    if (cloudflareDb) {
      return createCloudflarePrismaClient(cloudflareDb);
    }
  } catch (error) {
    cloudflareContextError = error;
  }

  if (process.env.DATABASE_URL) {
    return globalForPrisma.prisma ?? createNodePrismaClient();
  }

  throw new Error(
    "Prisma could not find a Cloudflare D1 binding (`env.DB`) or a `DATABASE_URL`. " +
      "Deployed Cloudflare requests must provide the D1 binding, and local `next dev` requires `DATABASE_URL`.",
    {
      cause: cloudflareContextError,
    },
  );
}

export async function getPrisma() {
  const prisma = await createPrismaClient();

  if (process.env.NODE_ENV !== "production" && !globalForPrisma.prisma) {
    globalForPrisma.prisma = prisma;
  }

  return prisma;
}
