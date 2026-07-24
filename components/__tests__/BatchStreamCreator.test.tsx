import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { BatchStreamCreator } from '../stream/BatchStreamCreator';

// Regression coverage for #124: the batch submission's async operation had
// no unmount guard. Under poor network conditions (long-pending submission)
// a user navigating away mid-submit would hit a state update on an
// unmounted component the moment the operation settled.

function addRecipient(container: HTMLElement, address: string, rate: string) {
  const inputs = container.querySelectorAll('input');
  const addressInput = inputs[0] as HTMLInputElement;
  const rateInput = inputs[1] as HTMLInputElement;
  const addButton = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent === 'Add',
  )!;

  const setNativeValue = (el: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  act(() => {
    setNativeValue(addressInput, address);
    setNativeValue(rateInput, rate);
  });
  act(() => {
    addButton.click();
  });
}

describe('BatchStreamCreator — unmount safety during submission', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancels the pending submission timer on unmount instead of leaving it dangling', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<BatchStreamCreator />);
    });

    addRecipient(container, 'GRECIPIENT1234567890', '100');

    const submitButton = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.startsWith('Create'),
    )!;

    act(() => {
      submitButton.click(); // kicks off the (fake-timer-backed) async submission
    });

    expect(vi.getTimerCount()).toBeGreaterThan(0);

    // Unmount while the submission is still pending (e.g. the user
    // navigates away under a slow/poor-network submission). The in-flight
    // timer must be cancelled, not left running against a detached
    // component.
    act(() => {
      root.unmount();
    });

    expect(vi.getTimerCount()).toBe(0);

    document.body.removeChild(container);
  });

  it('completes normally and shows the success state when mounted throughout', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<BatchStreamCreator />);
    });

    addRecipient(container, 'GRECIPIENT1234567890', '100');

    const submitButton = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.startsWith('Create'),
    )!;

    act(() => {
      submitButton.click();
    });

    await act(async () => {
      vi.advanceTimersByTime(2100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Batch Stream Created!');

    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
  });
});
