// Pure view decision for the web root, so the gating logic is unit-testable
// without a DOM. `null` = authStatus still loading.
import type { AuthStatus } from '../preload/index.d'

export function chooseView(status: AuthStatus | null): 'loading' | 'landing' | 'app' {
  if (status === null) return 'loading'
  return status.signedIn ? 'app' : 'landing'
}
