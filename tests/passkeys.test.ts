import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passkeyErrorMessage } from '../lib/passkeys';

test('passkey cancellation is recoverable without exposing platform errors', () => {
  assert.equal(
    passkeyErrorMessage({ cause: { name: 'NotAllowedError' } }, 'sign-in'),
    'Passkey sign-in was cancelled. Try again or use email or password.',
  );
  assert.equal(
    passkeyErrorMessage({ code: 'ERROR_CEREMONY_ABORTED' }, 'register'),
    'Adding a passkey was cancelled. You can try again.',
  );
});

test('failed passkey operations keep account recovery instructions', () => {
  assert.equal(
    passkeyErrorMessage(new Error('sensitive upstream details'), 'sign-in'),
    'Could not sign in with a passkey. Try again or use email or password.',
  );
  assert.equal(
    passkeyErrorMessage(null, 'register'),
    'Could not add a passkey. Try again on holofolder.com in a supported browser.',
  );
});
