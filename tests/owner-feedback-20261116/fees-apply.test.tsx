// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({useRouter: () => ({push:vi.fn()})}));
import { FeesPeriodControl } from '@/components/fees/fees-period-control';
afterEach(cleanup);
const props = {tab:'transactions' as const,from:'2026-11-01',to:'2026-12-01',facility:'all',timezone:'Asia/Kolkata',method:'cash',group:'digital'};

it('uses a real GET submission so the applied range reloads the heading and data together', () => {
  render(<FeesPeriodControl {...props}/>);
  const form = screen.getByRole('form',{name:'Collection period'}) as HTMLFormElement;
  expect(form.getAttribute('action')).toBe('/owner/fees');
  expect(form.getAttribute('method')?.toLowerCase()).toBe('get');
  fireEvent.click(screen.getByRole('button',{name:'Change dates'}));
  // Select actual calendar days, rather than changing the read-only textbox.
  fireEvent.click(screen.getByLabelText('From date'));
  fireEvent.click(screen.getByRole('button',{name:'5 November 2026'}));
  fireEvent.click(screen.getByLabelText('Through date'));
  fireEvent.click(screen.getByRole('button',{name:'12 November 2026'}));
  const data = new FormData(form);
  expect(Object.fromEntries(data)).toEqual({tab:'transactions',from:'2026-11-05',to:'2026-11-13',facility:'all',method:'cash',group:'digital'});
  const submission = new Event('submit',{bubbles:true,cancelable:true});
  form.dispatchEvent(submission);
  expect(submission.defaultPrevented).toBe(false);
});

it('keeps the large date editor closed until requested and exposes the applied range', () => {
  render(<FeesPeriodControl {...props}/>);
  expect(screen.queryByLabelText('From date')).toBeNull();
  expect(screen.getByRole('button',{name:'Change dates'}).getAttribute('aria-expanded')).toBe('false');
  expect(screen.getByText('1 Nov 2026 – 30 Nov 2026')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Change dates'}));
  expect(screen.getByRole('button',{name:'Change dates'}).getAttribute('aria-expanded')).toBe('true');
});

it('prevents invalid ranges without replacing the applied period', () => {
  render(<FeesPeriodControl {...props}/>);
  fireEvent.click(screen.getByRole('button',{name:'Change dates'}));
  fireEvent.click(screen.getByLabelText('From date'));
  fireEvent.click(screen.getByRole('button',{name:'20 November 2026'}));
  fireEvent.click(screen.getByLabelText('Through date'));
  fireEvent.click(screen.getByRole('button',{name:'10 November 2026'}));
  const form = screen.getByRole('form',{name:'Collection period'});
  expect(fireEvent.submit(form)).toBe(false);
  expect(screen.getByRole('alert').textContent).toContain('Choose a valid date range');
  expect(screen.getByText('1 Nov 2026 – 30 Nov 2026')).toBeTruthy();
});
