import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NotificationCenter } from './NotificationCenter';

describe('NotificationCenter', () => {
  let container: HTMLDivElement | undefined;
  let root: ReturnType<typeof createRoot> | undefined;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.restoreAllMocks();
  });

  it('removes its event listener on unmount and bounds retained notifications', () => {
    const removeListener = vi.spyOn(window, 'removeEventListener');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(<NotificationCenter />));
    act(() => {
      for (let i = 0; i < 8; i++) {
        window.dispatchEvent(new CustomEvent('notification', { detail: `Notice ${i}` }));
      }
      window.dispatchEvent(new CustomEvent('notification', { detail: null }));
    });

    expect(container.textContent).toContain('Notice 7');
    expect(container.textContent).not.toContain('Notice 0');

    act(() => root?.unmount());
    expect(removeListener).toHaveBeenCalledWith('notification', expect.any(Function));
  });
});
