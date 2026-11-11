export function passkeyErrorMessage(error: unknown, action: 'sign-in' | 'register') {
  const cancelled =
    typeof error === 'object' &&
    error !== null &&
    (('code' in error && error.code === 'ERROR_CEREMONY_ABORTED') ||
      ('cause' in error &&
        typeof error.cause === 'object' &&
        error.cause !== null &&
        'name' in error.cause &&
        error.cause.name === 'NotAllowedError'));
  if (action === 'sign-in')
    return cancelled
      ? 'Passkey sign-in was cancelled. Try again or use email or password.'
      : 'Could not sign in with a passkey. Try again or use email or password.';
  return cancelled
    ? 'Adding a passkey was cancelled. You can try again.'
    : 'Could not add a passkey. Try again on holofolder.com in a supported browser.';
}
