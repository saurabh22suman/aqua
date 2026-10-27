import type { ReactNode } from 'react';
import { BrandLockup } from './sports-mark';
import { LoginCharacter } from './login-character';
import styles from './login-welcome.module.css';

export function LoginWelcome({ children }: { children: ReactNode }) {
  return (
    <main className={styles.page} data-login-welcome>
      <div className={styles.card}>
        <header className={styles.hero}>
          <div className={styles.brand}><BrandLockup size="sm" /></div>
          <div className={styles.contours} aria-hidden="true" />
          <div className={styles.art}><LoginCharacter /></div>
        </header>
        <section className={styles.formPanel} aria-label="Club sign in">{children}</section>
      </div>
      <p className={styles.footer}>A little less admin. A little more sport.</p>
    </main>
  );
}
