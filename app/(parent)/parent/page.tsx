import { notFound } from "next/navigation";

// This legacy address has no access token or data. Its public fallback
// explains where to sign in or how to recover the private club link.
export default function ParentPage() {
  notFound();
}
