import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { env } from "@/lib/env";

import * as schema from "./schema";

/**
 * Neon's HTTP driver is the right choice for Vercel: no persistent TCP socket
 * to keep alive, and it works unchanged on the Edge runtime.
 *
 * The client is created on first property access rather than at module load.
 * `neon()` throws immediately on an empty connection string, and this module is
 * imported by the Auth.js route, which Next.js evaluates while collecting page
 * data. Constructing eagerly therefore turned a missing `DATABASE_URL` into a
 * failed deployment of every route rather than a 500 from the one endpoint that
 * needs the database.
 *
 * A Proxy keeps the `db.query`/`db.select` call sites unchanged, and the
 * instance is memoised so a warm lambda reuses one HTTP client.
 */
let instance: DrizzleInstance | undefined;

const createDb = () => drizzle(neon(env.DATABASE_URL), { schema });

export const db: DrizzleInstance = new Proxy({} as DrizzleInstance, {
  get: (_target, property: string) => {
    if (instance === undefined) {
      instance = createDb();
    }
    const value = Reflect.get(instance, property);
    if (typeof value === "function") {
      return value.bind(instance);
    }
    return value;
  },
});

export type DrizzleInstance = ReturnType<typeof createDb>;
export type Database = DrizzleInstance;

export { schema };