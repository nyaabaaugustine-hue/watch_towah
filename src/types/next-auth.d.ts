import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

// `next-auth/jwt` is a bare `export * from "@auth/core/jwt"`, and augmenting a
// re-export does not merge into the original interface. The augmentation has to
// be declared against the module that actually owns `JWT`.
declare module "@auth/core/jwt" {
  interface JWT {
    userId?: string;
  }
}
