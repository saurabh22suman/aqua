// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import LoginPage from '@/app/(auth)/login/page';
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()})}));
vi.mock('@/lib/actions/auth-ui',()=>({homeForSessionAction:vi.fn()}));
vi.mock('@/lib/offline/client-session',()=>({clearOfflineData:vi.fn(),runOfflineLifecycle:vi.fn()}));
vi.mock('@/lib/offline/logout',()=>({syncBeforeLogout:vi.fn()}));
afterEach(cleanup);
it('uses one dedicated login illustration and one sign-in form in the overlapping-panel composition',()=>{
 const{container}=render(<LoginPage/>);
 expect(container.querySelector('[data-login-welcome]')).not.toBeNull();
 const images=container.querySelectorAll('img');
 expect(images).toHaveLength(1);
 expect(images[0]?.getAttribute('src')).toBe('/login/art/welcome-coach.webp');
 expect(container.querySelectorAll('form')).toHaveLength(1);
 expect(screen.getByLabelText('Mobile number')).toBeTruthy();
});
