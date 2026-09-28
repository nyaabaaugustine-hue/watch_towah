import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),

  NEXTAUTH_URL: z.string().min(1, "NEXTAUTH_URL is required"),

  MAPBOX_ACCESS_TOKEN: z.string().min(1, "MAPBOX_ACCESS_TOKEN is required for map rendering"),

  VAPID_PUBLIC_KEY: z.string().min(1, "VAPID_PUBLIC_KEY is required for web push"),
  VAPID_PRIVATE_KEY: z.string().min(1, "VAPID_PRIVATE_KEY is required for web push"),
  VAPID_SUBJECT_MAILTO: z.string().min(1, "VAPID_SUBJECT_MAILTO is required for web push"),

  AFRICAS_TALKING_USERNAME: z.string().min(1, "AFRICAS_TALKING_USERNAME is required for SMS fallback"),
  AFRICAS_TALKING_API_KEY: z.string().min(1, "AFRICAS_TALKING_API_KEY is required for SMS fallback"),

  /**
   * Evidence Vault credentials, optional because the vault is not built.
   *
   * These five were previously required, which meant any deploy without a
   * filled-in Evidence Vault crashed during page-data collection. That is a
   * contradiction rather than strictness: the variables back `evidence_items`,
   * and nothing in the app writes to or reads from that table. Requiring
   * credentials for an unimplemented feature made the deployment depend on
   * config it could not possibly use.
   *
   * They stay declared so the values validate and type-check the moment the
   * vault is implemented, at which point `.optional()` should be dropped so a
   * half-configured vault fails loudly instead of silently skipping writes.
   */
  CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
  CLOUDINARY_API_KEY: z.string().min(1).optional(),
  CLOUDINARY_API_SECRET: z.string().min(1).optional(),

  EVIDENCE_ENCRYPTION_KEY: z
    .string()
    .min(43, "EVIDENCE_ENCRYPTION_KEY must be a 32-byte key encoded as 44-char base64url")
    .optional(),

  /**
   * Shared secret for the cron routes. Optional so a fresh checkout boots, but
   * the sweeps refuse to run without it rather than exposing an endpoint that
   * can page somebody's family on demand.
   */
  CRON_SECRET: z.string().min(16, "CRON_SECRET must be at least 16 characters").optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Shape used only while the build is collecting page data with incomplete
 * config. Every key resolves so no module crashes on property access, and any
 * feature that actually needs a real credential fails on use instead of on
 * import. At runtime `loadEnv` throws instead, so a misconfigured deployment is
 * never silently served.
 */
const buildFallback = (): Env =>
  Object.fromEntries(
    Object.keys(envSchema.shape).map((key) => [key, ""]),
  ) as unknown as Env;

const formatIssues = (error: z.ZodError): string =>
  error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");

const loadEnv = (): Env => {
  if (cached !== undefined) {
    return cached;
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = formatIssues(parsed.error);
    const message = `Invalid environment configuration. Copy .env.example to .env.local and fill in every value.\n${detail}`;

    // The build reaches this by collecting page data, which evaluates the
    // Auth.js route. Throwing there aborted the whole deployment, so a missing
    // optional integration secret took down every page in the app rather than
    // the one feature that needed it. A configuration fault is a runtime
    // condition; report it where it happens and let the route return a 500
    // with the detail attached.
    if (process.env.NEXT_PHASE === "phase-production-build") {
      console.error(`[env] Invalid configuration during build:\n${detail}`);
      const fallback = buildFallback();
      cached = fallback;
      return fallback;
    }

    throw new Error(message);
  }

  cached = parsed.data;
  return cached;
};

export const env = new Proxy({} as Env, {
  get: (_target, property: string) => loadEnv()[property as keyof Env],
});
