'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const getSnapshot = () => window.isSecureContext && typeof PublicKeyCredential !== 'undefined';
const getServerSnapshot = () => false;

export function usePasskeySupport() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
