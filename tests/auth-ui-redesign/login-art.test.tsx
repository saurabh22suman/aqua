// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ClubEditorialPanel } from '@/components/auth/club-editorial-panel';
import { LoginForm } from '@/components/login-form';
vi.mock('next/navigation', () => ({ useRouter: () => ({push:vi.fn(),refresh:vi.fn()}) }));
vi.mock('@/lib/actions/auth-ui', () => ({homeForSessionAction:vi.fn()}));
vi.mock('@/lib/offline/client-session', () => ({ clearOfflineData:vi.fn(),runOfflineLifecycle:vi.fn() }));
vi.mock('@/lib/offline/logout', () => ({syncBeforeLogout:vi.fn()}));
afterEach(cleanup);
it.each([['desktop', ClubEditorialPanel], ['mobile', LoginForm]] as const)('adds decorative sports artwork to the %s login composition', (_, Component) => {
 const {container}=render(<Component />);
 const art=container.querySelector('img[data-login-character]');
 expect(art).not.toBeNull();
 expect(art?.getAttribute('alt')).toBe('');
 expect(art?.closest('[aria-hidden="true"]')).not.toBeNull();
 expect(art?.getAttribute('width')).toBeTruthy();
});
