import styles from './login-character.module.css';

/** Original pre-optimised artwork: decorative, with finite CSS-only motion. */
export function LoginCharacter({ compact = false }: { compact?: boolean }) {
  return (
    <div aria-hidden="true" className={compact ? styles.compact : styles.scene}>
      {/* Pre-optimised local asset; no request-time image processing. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img data-login-character src="/login/art/badminton.webp" alt="" width={640} height={673} decoding="async" loading="lazy" className={styles.player} />
      <span className={styles.shuttle}>✦</span>
    </div>
  );
}
