/**
 * Bridge between "some action needs the operator's name" and the one dialog
 * that asks for it (OperatorNameDialog, mounted once in AppShell).
 *
 * useOperator() is used by ~a dozen unrelated components, so the dialog can't
 * live inside any one of them — a module-level request keeps every caller on
 * the same designed pop-up instead of the browser's window.prompt().
 */

export interface OperatorNameRequest {
  /** The name currently saved on this device; null = first time asking. */
  current: string | null;
  /** True when an action is waiting on the name and will be cancelled without one. */
  forAction: boolean;
  /** Called by the dialog: a name, "" to clear it, or null when dismissed. */
  resolve: (name: string | null) => void;
}

type Listener = (req: OperatorNameRequest | null) => void;

let listener: Listener | null = null;
let pending: { req: OperatorNameRequest; promise: Promise<string | null> } | null = null;

/** The dialog registers itself here. Returns the unsubscribe. */
export function subscribeOperatorNameRequests(fn: Listener): () => void {
  listener = fn;
  // A request raised just before the dialog mounted must still be shown.
  if (pending) fn(pending.req);
  return () => {
    if (listener === fn) listener = null;
  };
}

/**
 * Ask the user for their name. Resolves with the typed name, "" when they
 * chose to clear it, or null when they dismissed the dialog.
 *
 * Two actions asking at once (e.g. picking a drawing and then saving) share
 * ONE dialog and both get its answer.
 */
export function requestOperatorName(
  current: string | null,
  forAction = false,
): Promise<string | null> {
  if (pending) return pending.promise;
  // No dialog on this page — answer "dismissed" rather than hang for ever.
  // (Callers cancel their action when no name comes back.)
  if (!listener) return Promise.resolve(null);

  let resolveFn: (name: string | null) => void = () => {};
  const promise = new Promise<string | null>((res) => {
    resolveFn = res;
  });
  const req: OperatorNameRequest = {
    current,
    forAction,
    resolve: (name) => {
      pending = null;
      listener?.(null);
      resolveFn(name);
    },
  };
  pending = { req, promise };
  listener(req);
  return promise;
}
