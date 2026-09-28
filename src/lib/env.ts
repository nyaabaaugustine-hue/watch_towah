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

  CLOUDINARY_CLOUD_NAME: z.string().min(1, "CLOUDINARY_CLOUD_NAME is required for the evidence vault"),
  CLOUDINARY_API_KEY: z.string().min(1, "CLOUDINARY_API_KEY is required for the evidence vault"),
  CLOUDINARY_API_SECRET: z.string().min(1, "CLOUDINARY_API_SECRET is required for the evidence vault"),

  EVIDENCE_ENCRYPTION_KEY: z
    .string()
    .min(43, "EVIDENCE_ENCRYPTION_KEY must be a 32-byte key encoded as 44-char base64url"),

  /**
   * Shared secret for the cron routes. Optional so a fresh checkout boots, but
   * the sweeps refuse to run without it rather than exposing an endpoint that
   * can page somebody's family on demand.
   */
  CRON_SECRET: z.string().min(16, "CRON_SECRET must be at least 16 characters").optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

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
    throw new Error(
      `Invalid environment configuration. Copy .env.example to .env.local and fill in every value.\n${formatIssues(parsed.error)}`,
    );
  }

  cached = parsed.data;
  return cached;
};

export const env = new Proxy({} as Env, {
  get: (_target, property: string) => loadEnv()[property as keyof Env],
});
