import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    // `next-env.d.ts` is rewritten by the Next.js build on every run, so lint
    // findings in it are not actionable and disappear the next `next dev`.
    ignores: [".next/**", "node_modules/**", "drizzle/**", "next-env.d.ts", "public/sw.js", "public/swe-worker-*.js"],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
