// Scaffold for Multisig Transaction Coordination

import { copyToClipboard } from './clipboard';

/**
 * Serializes an XDR string and copies it to the clipboard, preventing broadcast.
 * @param xdr - The base64 transaction XDR
 */
export async function proposeTransaction(xdr: string): Promise<void> {
  // copyToClipboard handles insecure contexts (no navigator.clipboard) via an
  // execCommand fallback, so this works over plain HTTP too (issue #145).
  const ok = await copyToClipboard(xdr);
  if (ok) {
    console.log("Transaction XDR copied to clipboard. Share this with your multisig co-signers.");
  } else {
    console.error("Failed to copy XDR to clipboard.");
  }
}
