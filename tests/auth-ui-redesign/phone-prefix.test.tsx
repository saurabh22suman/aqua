// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PhoneField } from '@/components/auth/phone-field';
afterEach(cleanup);
it('shows a concise hint and fixed country prefix without duplicating a pasted prefix', () => {
  render(<PhoneField id="phone" value="+91 98765 43210" onChange={vi.fn()} onBlur={vi.fn()} />);
  expect(screen.getByText('Enter your 10-digit mobile number')).toBeTruthy();
  expect(screen.getByText('+91')).toBeTruthy();
  expect((screen.getByLabelText('Mobile number') as HTMLInputElement).value).toBe('98765 43210');
  expect(screen.queryByText(/Any format works/)).toBeNull();
});
