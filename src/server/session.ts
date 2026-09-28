import { auth } from "@/auth";
import { AuthenticationError } from "@/lib/errors";

/**
 * The signed-in user's id, or an error.
 *
 * This lives in its own module rather than in `users.ts` because `auth.ts`
 * already imports the user lookups from there; adding a session reader to that
 * file would close an import cycle back to `auth`.
 *
 * @throws AuthenticationError when there is no valid session.
 */
export const requireUserId = async (): Promise<string> => {
  const session = await auth();
  const userId = session?.user.id;

  if (userId === undefined) {
    throw new AuthenticationError("Sign in to continue.");
  }

  return userId;
};
