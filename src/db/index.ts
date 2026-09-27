import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { env } from "@/lib/env";

import * as schema from "./schema";

/**
 * Neon's HTTP driver is the right choice for Vercel: no persistent TCP socket
 * to keep alive, and it works unchanged on the Edge runtime.
 */
export const db = drizzle(neon(env.DATABASE_URL), { schema });

export type Database = typeof db;

export { schema };
