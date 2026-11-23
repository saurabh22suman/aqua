import type { ReactNode } from "react";
import Link from "next/link";
import { BrandLockup } from "./sports-mark";
import { LoginCharacter } from "./login-character";
import styles from "./login-welcome.module.css";

const signInPaths = [
  { role: "staff", href: "/login", label: "Staff sign in" },
  { role: "member", href: "/member/sign-in", label: "Member sign in" },
  { role: "family", href: "/family/sign-in", label: "Family sign in" },
] as const;

type SignInRole = (typeof signInPaths)[number]["role"];

export function LoginWelcome({
  children,
  activeRole,
  clubId,
  operations = false,
}: {
  children: ReactNode;
  activeRole?: SignInRole;
  clubId?: string;
  operations?: boolean;
}) {
  return (
    <main className={styles.page} data-login-welcome data-operations={operations || undefined}>
      <div className={styles.card}>
        <header className={styles.hero}>
          <div className={styles.brand}><BrandLockup size="sm" /></div>
          <div className={styles.contours} aria-hidden="true" />
          {operations ? null : <div className={styles.art}><LoginCharacter /></div>}
        </header>
        <section className={styles.formPanel} aria-label={activeRole ? "Club sign in" : undefined}>
          {children}
          {activeRole ? (
            <details className={styles.roleOptions}>
              <summary>Other sign-in options</summary>
              <nav className={styles.roleNav} aria-label="Other sign-in options">
                {signInPaths.filter(({ role }) => role !== activeRole).map(({ role, href, label }) => (
                  <Link key={role} href={clubId && role !== "staff" ? { pathname: href, query: { clubId } } : href}>
                    {label}
                  </Link>
                ))}
              </nav>
            </details>
          ) : null}
        </section>
      </div>
    </main>
  );
}
