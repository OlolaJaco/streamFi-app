/**
 * Copy text to the clipboard, working in both secure and insecure contexts.
 *
 * `navigator.clipboard` is only defined in secure contexts (HTTPS or
 * localhost). When the app is served over plain HTTP — e.g. testing locally
 * on a LAN IP, or behind a proxy without TLS — `navigator.clipboard` is
 * `undefined` and calling `.writeText()` throws, causing the "Copy" buttons
 * to silently fail (issue #145).
 *
 * This helper prefers the async Clipboard API when available and falls back to
 * the legacy `document.execCommand('copy')` textarea trick otherwise, so the
 * copy succeeds regardless of the page's security context.
 *
 * @returns `true` if the text was copied, `false` if every strategy failed.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Preferred path: async Clipboard API (secure contexts only).
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or blocked — fall through to the legacy path.
    }
  }

  // Fallback path: hidden textarea + execCommand('copy'). Works over plain
  // HTTP where the Clipboard API is unavailable.
  if (typeof document === 'undefined') return false;

  const textArea = document.createElement('textarea');
  textArea.value = text;
  // Keep it out of view and out of the layout/scroll flow.
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'fixed';
  textArea.style.top = '0';
  textArea.style.left = '0';
  textArea.style.width = '1px';
  textArea.style.height = '1px';
  textArea.style.padding = '0';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);

  try {
    textArea.select();
    textArea.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textArea);
  }
}
