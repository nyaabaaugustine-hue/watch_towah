import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = {
  title: "Create your account",
  description:
    "Create a Watchtower account and build a Guardian Circle that gets to you when it matters.",
};

const SignUpPage = () => (
  <AuthShell
    title="Create your account"
    subtitle="Two minutes now, so the people who care about you can find you when it matters."
  >
    <SignUpForm />
  </AuthShell>
);

export default SignUpPage;
