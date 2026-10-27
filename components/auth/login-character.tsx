import styles from './login-character.module.css';

/** Original pre-optimised artwork: decorative, with finite CSS-only motion. */
export function LoginCharacter({ compact = false }: { compact?: boolean }) {
  return (
    <div aria-hidden="true" className={compact ? styles.compact : styles.scene}>
      {/* Pre-optimised local asset; no request-time image processing. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img data-login-character src="/login/art/welcome-coach.webp" alt="" width={720} height={480} decoding="async" loading="eager" className={styles.player} />

    </div>
  );
}
