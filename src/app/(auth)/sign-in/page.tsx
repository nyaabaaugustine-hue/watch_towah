import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/auth-shell";
import { SignInForm } from "@/components/auth/sign-in-form";
import { TrustBadges } from "@/components/ui/trust-badge";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Watchtower to reach your Guardian Circle and your Guardian Circle to reach you.",
};

type SignInPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const single = (value: string | string[] | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

const SignInPage = async ({ searchParams }: SignInPageProps) => {
  const params = await searchParams;
  const method = single(params.method);
  const phone = single(params.phone);

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to check in, share your journey, or reach your Guardian Circle."
      aside={<TrustBadges variant="row" />}
    >
      <SignInForm
        callbackUrl={single(params.callbackUrl) ?? "/"}
        initialMethod={method === "phone" ? "phone" : "password"}
        initialPhone={phone ?? ""}
      />
    </AuthShell>
  );
};

export default SignInPage;
