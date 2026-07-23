/** Clipboard write with a `document.execCommand` fallback for contexts
 * (older browsers, non-secure origins) where the async Clipboard API isn't
 * available. Shared by the host-wait screen and the in-game sidebar's
 * "Copy invite link" action. */
export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      resolve();
    } catch (e) {
      reject(e);
    } finally {
      ta.remove();
    }
  });
}
