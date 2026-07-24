'use client';

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { WalletProvider, useWallet, Mutex } from './WalletContext';
import * as freighter from '@stellar/freighter-api';

vi.mock('@stellar/freighter-api', () => ({
  isConnected: vi.fn(),
  requestAccess: vi.fn(),
  signTransaction: vi.fn(),
}));

const mockedFreighter = vi.mocked(freighter, true);

function mountWallet() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const stateRef = { current: null as any };

  function TestComponent() {
    const wallet = useWallet();
    useEffect(() => {
      stateRef.current = wallet;
    }, [wallet]);
    return null;
  }

  act(() => {
    createRoot(container).render(
      <WalletProvider>
        <TestComponent />
      </WalletProvider>,
    );
  });

  return { stateRef, container };
}

describe('WalletContext', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('prevents stale async connection state from applying after disconnect', async () => {
    let resolveConnect: (value: { address: string; error: null }) => void;
    const connectPromise = new Promise<{ address: string; error: null }>((resolve) => {
      resolveConnect = resolve;
    });

    mockedFreighter.isConnected.mockResolvedValue({ isConnected: true });
    mockedFreighter.requestAccess.mockReturnValue(connectPromise as any);

    const { stateRef, container } = mountWallet();
    const wallet = stateRef.current;

    act(() => {
      void wallet.connect();
    });

    act(() => {
      wallet.disconnect();
    });

    act(() => {
      resolveConnect!({ address: 'GA123TEST', error: null });
    });

    await act(async () => {
      await connectPromise;
    });

    expect(stateRef.current?.connected).toBe(false);
    expect(stateRef.current?.publicKey).toBe(null);
    expect(localStorage.getItem('conduit:wallet')).toBeNull();

    document.body.removeChild(container);
  });

  it('cancels a connect() attempt still queued behind an in-flight one, under rapid repeated clicks', async () => {
    // First call acquires the mutex immediately and hangs inside
    // freighterIsConnected() — simulating heavy load / a slow extension.
    let resolveFirstCheck: (v: { isConnected: boolean }) => void;
    mockedFreighter.isConnected.mockImplementationOnce(
      () => new Promise((r) => { resolveFirstCheck = r; }),
    );

    const { stateRef, container } = mountWallet();
    const wallet = stateRef.current;

    await act(async () => {
      void wallet.connect(); // acquires the mutex, then hangs on isConnected()
      await Promise.resolve();
      await Promise.resolve();
    });

    // Second and third calls queue behind the first, each superseding the
    // last. Only the third should still be "pending" once the first
    // finishes — the second must never reach freighterIsConnected().
    await act(async () => {
      void wallet.connect();
      void wallet.connect();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      resolveFirstCheck!({ isConnected: false }); // first call finishes (no Freighter)
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // isConnected: 1 call for the first (hung) attempt, 1 for the third
    // (the one that actually got to run) — the superseded second attempt
    // was aborted while queued and never called it.
    expect(mockedFreighter.isConnected).toHaveBeenCalledTimes(2);

    document.body.removeChild(container);
  });
});

// The Mutex guarding connect() under concurrent "connect wallet" clicks
// serializes access via a wait queue. When a queued waiter's AbortSignal
// fires, its entry must be dequeued and its acquire() promise rejected —
// this is what the initialization path relies on to stay responsive under
// heavy load (many rapid connect attempts) instead of leaving a stale
// entry hanging.
describe('Mutex — queued acquire under load', () => {
  it('lets a second acquire() through once the first releases', async () => {
    const mutex = new Mutex();
    const release1 = await mutex.acquire();

    let acquired2 = false;
    const p2 = mutex.acquire().then((release) => {
      acquired2 = true;
      return release;
    });

    expect(acquired2).toBe(false); // still queued behind release1
    release1();

    const release2 = await p2;
    expect(acquired2).toBe(true);
    release2();
  });

  it('rejects a queued waiter when its AbortSignal fires, without corrupting the queue', async () => {
    const mutex = new Mutex();
    const release1 = await mutex.acquire();

    const controller = new AbortController();
    const queuedAcquire = mutex.acquire(controller.signal);

    controller.abort();
    await expect(queuedAcquire).rejects.toThrow(/aborted/i);

    // The mutex must still be usable afterwards — the aborted entry should
    // have been cleanly removed from the queue, not left dangling.
    release1();
    const release3 = await mutex.acquire();
    expect(typeof release3).toBe('function');
    release3();
  });
});
