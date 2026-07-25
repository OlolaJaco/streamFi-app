'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Badge } from '@/components/ui/Badge';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { truncateAddress } from '@/lib/format';

interface Recipient {
  address: string;
  ratePerSecond: bigint;
}

export function BatchStreamCreator() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [addressInput, setAddressInput] = useState('');
  const [rateInput, setRateInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSubmittingRef = useRef(false);
  const isMountedRef = useRef(true);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      // Under poor network conditions the simulated submission can still
      // be pending when the user navigates away — cancel it rather than
      // leaving it running against a detached component.
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
  }, []);

  const addRecipient = () => {
    if (!addressInput || !rateInput) return;

    // Validate Stellar address format: G + 55 alphanumeric characters
    if (!/^G[A-Z0-9]{55}$/.test(addressInput.trim())) {
      alert("Invalid Stellar address. Must start with G and be 56 characters.");
      return;
    }

    if (!/^\d+$/.test(rateInput)) {
      setError("Invalid rate input. Must be a positive integer.");
      return;
    }
    try {
      const rate = BigInt(rateInput);
      if (rate <= 0n) {
        alert("Rate must be greater than zero.");
        return;
      }
      setRecipients([...recipients, { address: addressInput.trim(), ratePerSecond: rate }]);
      setAddressInput('');
      setRateInput('');
      setError(null);
    } catch (e) {
      setError("Invalid rate input. Must be an integer.");
    }
  };

  const removeRecipient = (index: number) => {
    setRecipients(recipients.filter((_, i) => i !== index));
  };

  const handleBatchCreate = async () => {
    if (recipients.length === 0 || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      // Simulate interaction with SDK ConduitBatcher
      await new Promise<void>((resolve) => {
        pendingTimerRef.current = setTimeout(() => {
          pendingTimerRef.current = null;
          resolve();
        }, 2000);
      });
      if (!isMountedRef.current) return;
      setSuccess(true);
      setRecipients([]);
    } catch (submitError) {
      if (!isMountedRef.current) return;
      console.error("Batch creation failed", submitError);
      setError("Failed to submit batch transaction. Please try again.");
    } finally {
      isSubmittingRef.current = false;
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  if (success) {
    return (
      <div className="card text-center py-8">
        <h3 className="text-xl font-bold text-green-600 mb-2">Batch Stream Created!</h3>
        <p className="text-gray-500">Your transaction was successful.</p>
        <button className="btn btn-primary mt-4" onClick={() => setSuccess(false)}>
          Create Another Batch
        </button>
      </div>
    );
  }

  return (
    <div className="card max-w-2xl mx-auto p-6">
      <h2 className="text-2xl font-bold mb-4">Batch Stream Creation</h2>

      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="border border-gray-200 dark:border-gray-800 rounded p-4 text-sm text-gray-500 dark:text-gray-400 mb-4"
        >
          {error}
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <input 
          className="input flex-1" 
          placeholder="Recipient Address (G...)" 
          value={addressInput} 
          onChange={e => setAddressInput(e.target.value.toUpperCase())} 
          maxLength={56}
        />
        <input 
          className="input w-32" 
          placeholder="Rate (units/sec)" 
          value={rateInput} 
          onChange={e => setRateInput(e.target.value)} 
          type="number"
        />
        <button className="btn btn-secondary" onClick={addRecipient}>Add</button>
      </div>

      <div className="mb-6 space-y-2">
        {recipients.map((rec, i) => (
          <div key={i} className="flex justify-between items-center bg-gray-50 dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700">
            <span className="font-mono text-sm">{truncateAddress(rec.address)}</span>
            <div className="flex items-center gap-4">
              <span className="font-mono text-green-600 dark:text-green-400 font-bold">{rec.ratePerSecond.toString()}/s</span>
              <button className="text-red-500 text-sm hover:underline" onClick={() => removeRecipient(i)}>Remove</button>
            </div>
          </div>
        ))}
        {recipients.length === 0 && <p className="text-sm text-gray-500 italic text-center py-4">No recipients added yet.</p>}
      </div>

      <button 
        className="btn btn-primary w-full" 
        onClick={handleBatchCreate} 
        disabled={recipients.length === 0 || isSubmitting}
      >
        {isSubmitting ? 'Submitting...' : `Create ${recipients.length} Streams`}
      </button>
    </div>
  );
}
