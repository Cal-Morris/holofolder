'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Holds one state value driven by a pure `transition(state, event)` from lib/. Unlike `useReducer`, `send` applies the
 * event straight away and says whether it was accepted (the transition returned a new state), so a second tap in the
 * same frame sees the first one's state instead of a stale render and is turned away.
 */
export function useMachine<S, E>(transition: (state: S, event: E) => S, initial: S | (() => S)) {
  const [state, setState] = useState(initial);
  const current = useRef(state);
  const send = useCallback(
    (event: E) => {
      const next = transition(current.current, event);
      if (next === current.current) return false;
      current.current = next;
      setState(next);
      return true;
    },
    [transition],
  );
  return [state, send] as const;
}
