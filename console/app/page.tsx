import { Landing } from "@/components/Landing";
import { auth } from "@/lib/auth";

/**
 * The marketing page, shown to everyone.
 *
 * A signed-in visitor gets the same page with the call to action pointed at
 * their console instead of sign-in. Bouncing them straight to /devices, which
 * is what this route used to do, made the product's own front door unreachable
 * to the only people who have an opinion about it.
 */
export default async function Home() {
  const session = await auth();
  return <Landing signedIn={Boolean(session?.user)} />;
}
