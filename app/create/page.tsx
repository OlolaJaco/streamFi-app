'use client';

import { useState, useEffect } from 'react';
import { useRouter }        from 'next/navigation';
import { useForm }          from 'react-hook-form';
import { z, ZodType } from 'zod';
import { ArrowRight, Info } from 'lucide-react';
import { useWallet }        from '@/contexts/WalletContext';
import { createStream }     from '@/lib/factory';
import { TOKENS_TESTNET, tokenLogoUrl } from '@/lib/tokens';
import { CopyHashButton }   from '@/components/ui/CopyHashButton';
import { useDebounce }      from '@/hooks/useDebounce';
import { refreshStreamData } from '@/lib/queryClient';
import styles from './CreateStream.module.css';
import { toStroops, wouldRateTruncateToZero } from '@/lib/format';


const schema = z.object({
  recipient:       z.string()
    .min(56, 'Must be a valid Stellar address (56 characters)')
    .max(56, 'Must be a valid Stellar address (56 characters)')
    .regex(/^G[A-Z0-9]{55}$/, 'Must be a valid Stellar address starting with G'),
  token:           z.string().min(1, 'Select a token'),
  depositAmount:   z.string().regex(/^\d+(\.\d+)?$/, 'Enter a valid amount').refine(val => parseFloat(val) > 0, 'Amount must be greater than 0'),
  durationSeconds: z.coerce.number().min(3600, 'Minimum 1 hour'),
  clawback:        z.boolean(),
});

/** Timeout for the full create-stream pipeline (simulate + sign + submit + poll). */
const CREATE_STREAM_TIMEOUT_MS = 60_000;

/**
 * Race a promise against a timeout. Rejects with a descriptive error
 * if the operation does not complete within `ms` milliseconds.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms / 1000}s. The network may be congested — please try again.`));
    }, ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

function zodResolver<T extends ZodType>(schema: T) {
  return async (values: Record<string, unknown>) => {
    const result = await schema.safeParseAsync(values);
    if (result.success) {
      return { values: result.data, errors: {} };
    }
    const errors: Record<string, { message?: string; type?: string }> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      if (!errors[path]) {
        errors[path] = { message: issue.message, type: issue.code };
      }
    }
    return { values: {}, errors };
  };
}

type FormValues = z.infer<typeof schema>;

export default function CreatePage() {
  const router = useRouter();
  const { publicKey, signTx, connected } = useWallet();

  const [step,    setStep]    = useState<1 | 2>(1);
  const [pending, setPending] = useState(false);
  const [txHash,  setTxHash]  = useState<string | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [addressValid, setAddressValid] = useState<boolean | null>(null);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { token: 'XLM', clawback: false, durationSeconds: 2592000 },
  });

  const deposit  = watch('depositAmount');
  const duration = watch('durationSeconds');
  const token    = watch('token');
  const recipient = watch('recipient');

  // Debounce recipient address to reduce API calls during validation
  const debouncedRecipient = useDebounce(recipient, 300);

  // Validate recipient address when debounced value changes
  useEffect(() => {
    if (!debouncedRecipient || debouncedRecipient.length < 56) {
      setAddressValid(null);
      return;
    }

    // Basic Stellar address validation (G followed by 55 alphanumeric characters)
    const isValidStellarAddress = /^G[A-Z0-9]{55}$/.test(debouncedRecipient);
    setAddressValid(isValidStellarAddress);
  }, [debouncedRecipient]);

  // Tokens aren't all 7 decimals (the native XLM/SAC convention) — this app
  // supports arbitrary TOKENS_TESTNET entries, so the preview must use each
  // token's own decimals rather than assume one for all of them.
  const tokenDecimals = TOKENS_TESTNET.find(t => t.symbol === token)?.decimals ?? 7;

  const rate = deposit && duration
    ? (parseFloat(deposit) * 10 ** tokenDecimals / duration).toFixed(2)
    : '—';

  const ratePerDay = deposit && duration
    ? (parseFloat(deposit) / (duration / 86400)).toFixed(4)
    : null;
  {rateWouldBeZero && (
                <p className="text-red-600 font-semibold">
                  Deposit too small for this duration — increase the amount or shorten the duration.
                </p>
              )}

  // Live check, mirrors the exact bigint math onSubmit uses (see #243):
  // depositStroops / durationSeconds truncates, and a small deposit over a
  // long duration can silently compute to a rate of 0n with nothing ever
  // streaming out. Caught here so the form blocks submission with a clear
  // message instead of letting funds get locked into a dead stream.
  const rateWouldBeZero = deposit && duration
    ? wouldRateTruncateToZero(deposit, tokenDecimals, duration)
    : false;

  async function onSubmit(data: FormValues) {
    if (!publicKey) {
      setError('Connect your wallet first.');
      return;
    }
    setPending(true);
    setError(null);

    try {
      const tokenMeta = TOKENS_TESTNET.find(t => t.symbol === data.token);
      const tokenAddr = tokenMeta?.address;
      if (!tokenAddr) throw new Error(`Unknown token: ${data.token}`);

      // Must use this token's own decimals, not the default — toStroops()
      // silently produces a value wrong by orders of magnitude for any
      // non-7-decimal token if the decimals argument is omitted.
      const depositStroops = toStroops(data.depositAmount, tokenMeta.decimals);
      if (depositStroops <= 0n) throw new Error('Deposit must be greater than 0');
      const rateStroops    = depositStroops / BigInt(data.durationSeconds);
      if (rateStroops <= 0n) {
        throw new Error(
          'Deposit too small for this duration — increase the amount or shorten the duration.',
        );
      }
      const startTime      = Math.floor(Date.now() / 1000) + 60; // 60s buffer
      const endTime        = startTime + data.durationSeconds;

      const hash = await withTimeout(
        createStream({
          sender:     publicKey,
          recipient:  data.recipient,
          token:      tokenAddr,
          deposit:    depositStroops,
          ratePerSec: rateStroops,
          startTime,
          endTime,
          clawback:   data.clawback,
        }, signTx),
        CREATE_STREAM_TIMEOUT_MS,
        'Stream creation',
      );

      // Invalidate and refetch active stream data so the streams/dashboard
      // pages reflect the newly created stream immediately (fixes #162).
      await refreshStreamData();

      setTxHash(hash);
      setTimeout(() => router.push('/streams'), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transaction failed');
    } finally {
      setPending(false);
    }
  }

  if (txHash) {
    return (
      <div className="max-w-lg mx-auto px-4 py-10 text-center">
        <div className="card py-12">
          <p className="text-4xl mb-4">✓</p>
          <h1 className="text-xl font-black mb-2">Stream created successfully</h1>
          <p className="text-sm text-gray-500 mb-4">
            Transaction confirmed. Redirecting to your streams…
          </p>
          <div className={`inline-flex items-center gap-1.5 max-w-full ${styles.inlineFlexRow}`}>
            <p className="font-mono text-xs text-gray-400 dark:text-gray-500 break-all">{txHash}</p>
            <CopyHashButton hash={txHash} className={`shrink-0 ${styles.shrink0}`} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-10">
      <h1 className="text-2xl font-black tracking-tight mb-2">Create a stream</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
        Tokens will be deployed into a new DripStream contract and released continuously.
      </p>

      {!connected && (
        <div className="card border-gray-200 bg-gray-50 dark:bg-gray-800 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 mb-6 py-3 px-4">
          Connect your wallet before creating a stream.
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

        {/* Recipient */}
        <div>
          <label className="block text-xs font-semibold mb-1 dark:text-white">Recipient address</label>
          <input
            {...register('recipient')}
            placeholder="G…"
            className="input font-mono"
          />
          {errors.recipient && (
            <p className="text-xs text-red-600 mt-1">{errors.recipient.message}</p>
          )}
          {debouncedRecipient && debouncedRecipient.length >= 56 && addressValid !== null && !errors.recipient && (
            <p className={`text-xs mt-1 ${addressValid ? 'text-green-600' : 'text-red-600'}`}>
              {addressValid ? 'Valid Stellar address' : 'Invalid Stellar address'}
            </p>
          )}
        </div>

        {/* Token */}
        <div>
          <label className="block text-xs font-semibold mb-1 dark:text-white">Token</label>
          <div className={`relative flex items-center gap-2 ${styles.flexRow}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={tokenLogoUrl(token, 'testnet')}
              alt={`${token} logo`}
              width={20}
              height={20}
              className={`w-5 h-5 rounded-full shrink-0 ${styles.shrink0}`}
            />
            <select {...register('token')} className={`input flex-1 ${styles.flexGrow}`}>
              {TOKENS_TESTNET.map(t => (
                <option key={t.symbol} value={t.symbol}>{t.symbol} — {t.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Deposit */}
        <div>
          <label className="block text-xs font-semibold mb-1 dark:text-white">Total deposit</label>
          <input
            {...register('depositAmount')}
            placeholder="1000"
            className="input"
            type="text"
            inputMode="decimal"
          />
          {errors.depositAmount && (
            <p className="text-xs text-red-600 mt-1">{errors.depositAmount.message}</p>
          )}
        </div>

        {/* Duration */}
        <div>
          <label className="block text-xs font-semibold mb-1 dark:text-white">Duration (seconds)</label>
          <input
            {...register('durationSeconds')}
            placeholder="2592000"
            className="input"
            type="number"
          />
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            {duration ? `${Math.floor(duration / 86400)}d ${Math.floor((duration % 86400) / 3600)}h` : ''}
          </p>
          {errors.durationSeconds && (
            <p className="text-xs text-red-600 mt-1">{errors.durationSeconds.message}</p>
          )}
        </div>

        {/* Rate preview */}
        {deposit && duration && (
          <div className={`card bg-gray-50 dark:bg-gray-800 border-gray-100 dark:border-gray-700 flex items-start gap-2 ${styles.flexRowStart}`}>
            <Info className={`w-4 h-4 text-gray-400 dark:text-gray-500 mt-0.5 shrink-0 ${styles.shrink0}`} />
            <div className="text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
              <p>
                Release rate:{' '}
                <span className="font-mono font-semibold text-black dark:text-white">{rate} stroops/s</span>
              </p>
              {ratePerDay && (
                <p>
                  ≈ <span className="font-semibold text-black dark:text-white">{ratePerDay} {token}</span> per day
                </p>
              )}
            </div>
          </div>
        )}

        {/* Clawback */}
        <label className={`flex items-start gap-3 cursor-pointer ${styles.flexRowStart}`}>
          <input
            {...register('clawback')}
            type="checkbox"
            className="mt-0.5 rounded border-gray-300"
          />
          <div>
            <span className="text-sm font-semibold dark:text-white">Enable clawback</span>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Allows you to reclaim unstreamed tokens at any time. Recipients can see this flag —
              use only when necessary.
            </p>
          </div>
        </label>

        {/* Error */}
        {error && (
          <p className="text-xs text-red-600 border border-red-200 rounded px-3 py-2">
            {error}
          </p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={pending || !connected || rateWouldBeZero}
          className="btn-primary w-full"
        >
          {pending ? 'Signing transaction…' : 'Create stream'}
          {!pending && <ArrowRight className="w-4 h-4" />}
        </button>
      </form>
    </div>
  );
}
