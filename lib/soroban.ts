/**
 * Soroban client helpers for conduit-app.
 *
 * Thin wrappers around @stellar/stellar-sdk's SorobanRpc that handle
 * the simulate → assemble → sign → submit → poll pipeline.
 *
 * All signing goes through the WalletContext `signTx` callback so this
 * module never holds key material.
 */

import {
  Contract,
  SorobanRpc,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  xdr,
} from '@stellar/stellar-sdk';
import { getRpcUrl, getNetworkPassphrase } from './env';

// ── Config ────────────────────────────────────────────────────────────────────

// Lazily constructed: these pages are client-rendered and only ever call
// Soroban RPC from the browser, but Next.js still evaluates this module
// during the build's static-generation pass, before real env vars exist.
let serverInstance: SorobanRpc.Server | undefined;

function getServer(): SorobanRpc.Server {
  if (!serverInstance) {
    const rpcUrl = getRpcUrl();
    serverInstance = new SorobanRpc.Server(rpcUrl, {
      allowHttp: rpcUrl.startsWith('http://'),
    });
  }
  return serverInstance;
}

/**
 * Default RPC timeout in milliseconds. All network calls in this module
 * are raced against this deadline so they never hang indefinitely.
 */
export const RPC_TIMEOUT_MS = 15_000;

/**
 * Races `promise` against a timeout. Rejects with an `RpcTimeoutError` if
 * the promise does not settle within `ms` milliseconds.
 */
export class RpcTimeoutError extends Error {
  constructor(ms: number) {
    super(`RPC request timed out after ${ms} ms`);
    this.name = 'RpcTimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms = RPC_TIMEOUT_MS): Promise<T> {
  const timer = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new RpcTimeoutError(ms)), ms),
  );
  return Promise.race([promise, timer]);
}

// ── Core pipeline ─────────────────────────────────────────────────────────────

/**
 * Build a contract-call transaction, simulate it to get the fee + footprint,
 * assemble it, hand it to the wallet for signing, then submit and poll.
 *
 * @param source     Stellar public key of the invoker
 * @param contractId Contract address (C…)
 * @param method     Function name
 * @param args       XDR ScVal arguments
 * @param signTx     Wallet sign callback from WalletContext
 * @returns          Transaction hash
 */
export async function invokeContract(
  source:     string,
  contractId: string,
  method:     string,
  args:       xdr.ScVal[],
  signTx:     (xdrBase64: string) => Promise<string>,
): Promise<string> {
  const passphrase = getNetworkPassphrase();
  const account = await withTimeout(getServer().getAccount(source));

  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(account, {
    fee:             BASE_FEE,
    networkPassphrase: passphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(180)
    .build();

  // Simulate to get auth + footprint
  const simResult = await withTimeout(getServer().simulateTransaction(tx));
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  // Assemble
  const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
  const xdrBase64 = assembled.toEnvelope().toXDR('base64');

  // Sign via wallet
  const signedXdr = await signTx(xdrBase64);
  const signedTx  = TransactionBuilder.fromXDR(signedXdr, passphrase);

  // Submit
  const sendResult = await withTimeout(getServer().sendTransaction(signedTx));
  if (sendResult.status === 'ERROR') {
    throw new Error(`Submission failed: ${JSON.stringify(sendResult.errorResult)}`);
  }

  // Poll
  const hash = sendResult.hash;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const status = await withTimeout(getServer().getTransaction(hash));
    if (status.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) return hash;
    if (status.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction failed: ${hash}`);
    }
  }
  throw new Error(`Transaction timed out: ${hash}`);
}

/**
 * Simulate a read-only contract call and return the decoded result.
 *
 * @param source     Any Stellar public key (just needs to exist on-chain)
 * @param contractId Contract address
 * @param method     Read-only function name
 * @param args       XDR ScVal arguments
 * @returns          Raw ScVal result
 */
export async function simulateReadOnly(
  source:     string,
  contractId: string,
  method:     string,
  args:       xdr.ScVal[],
): Promise<xdr.ScVal> {
  const account  = await withTimeout(getServer().getAccount(source));
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(account, {
    fee:             BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build();

  const result = await withTimeout(getServer().simulateTransaction(tx));
  if (SorobanRpc.Api.isSimulationError(result)) {
    throw new Error(`Simulation error: ${result.error}`);
  }
  const retval = result.result?.retval;
  if (!retval) throw new Error('No result returned from simulation');

  return xdr.ScVal.fromXDR(retval.toXDR());
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/** Convert an i128 ScVal to bigint */
export function scValToI128(val: xdr.ScVal): bigint {
  const i128 = val.i128();
  const hi   = BigInt(i128.hi().toString());
  const lo   = BigInt(i128.lo().toString());
  return (hi << 64n) | lo;
}

/** Convert a u64 ScVal to bigint */
export function scValToU64(val: xdr.ScVal): bigint {
  return BigInt(val.u64().toString());
}
