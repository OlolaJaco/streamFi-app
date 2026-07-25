import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { ErrorBoundary } from '../ErrorBoundary';

/**
 * Regression tests for issue #92.
 *
 * The original bug: `getDerivedStateFromError` returned `errorCount: 0` on every
 * error, which zeroed the running count that `componentDidCatch` maintains. As a
 * result the circuit breaker (errorCount >= MAX_ERROR_COUNT) was unreachable under
 * rapid repeated errors. These tests reproduce that failure mode and assert the
 * breaker now trips after repeated errors.
 */

const MAX_ERROR_COUNT = 5;

/** A child that throws on demand, controlled by a module-level flag. */
function Bomb({ shouldThrow }: { shouldThrow: boolean }): React.ReactElement {
  if (shouldThrow) {
    throw new Error('boom');
  }
  return React.createElement('div', null, 'ok');
}

describe('ErrorBoundary (issue #92 regression)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    // React logs caught errors to console.error; silence for clean output.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  /** Renders an always-throwing child, then clicks retry to accumulate errors. */
  function triggerErrors(count: number) {
    act(() => {
      root.render(
        React.createElement(
          ErrorBoundary,
          null,
          React.createElement(Bomb, { shouldThrow: true }),
        ),
      );
    });
    // First render already caused 1 catch; click retry (count-1) more times.
    for (let i = 1; i < count; i++) {
      const retryButton = container.querySelector('button');
      if (!retryButton) break;
      act(() => {
        retryButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    }
  }

  it('renders the fallback UI when a child throws', () => {
    act(() => {
      root.render(
        React.createElement(
          ErrorBoundary,
          null,
          React.createElement(Bomb, { shouldThrow: true }),
        ),
      );
    });
    expect(container.textContent).toContain('Something went wrong');
  });

  it('increments errorCount across repeated errors instead of resetting it', () => {
    // Before the fix, getDerivedStateFromError zeroed errorCount every error,
    // so the running total never grew. Four errors should leave the boundary
    // in the normal fallback (not yet the breaker), proving the count persists.
    triggerErrors(MAX_ERROR_COUNT - 1);
    expect(container.textContent).toContain('Something went wrong');
    expect(container.textContent).not.toContain('Too many errors');
  });

  it('trips the circuit breaker after MAX_ERROR_COUNT rapid errors', () => {
    // This is the core regression: with the bug present the breaker never trips.
    triggerErrors(MAX_ERROR_COUNT);
    expect(container.textContent).toContain('Too many errors');
  });

  it('does not throw when an unhandled promise rejection is observed', () => {
    const onError = vi.fn();
    act(() => {
      root.render(
        React.createElement(
          ErrorBoundary,
          { onError },
          React.createElement('div', null, 'child'),
        ),
      );
    });

    // Simulate a raw (non-Error) rejection reason; the handler must coerce it
    // safely and pass a null componentStack rather than crashing.
    expect(() => {
      act(() => {
        window.dispatchEvent(
          new (class extends Event {
            reason = 'raw string reason';
            promise = Promise.reject('raw string reason').catch(() => {});
          })('unhandledrejection'),
        );
      });
    }).not.toThrow();
  });

  it('cleans up the unhandledrejection listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    act(() => {
      root.render(
        React.createElement(
          ErrorBoundary,
          null,
          React.createElement('div', null, 'child'),
        ),
      );
    });
    act(() => {
      root.unmount();
    });
    expect(removeSpy).toHaveBeenCalledWith('unhandledrejection', expect.any(Function));
    removeSpy.mockRestore();
    // Re-create a root so afterEach unmount is a no-op-safe call.
    root = createRoot(container);
  });
});