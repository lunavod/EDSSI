import { useEffect, useReducer } from 'react';

import { useEdssi } from '../api/context';
import { initialJournalSync, type JournalState, journalSyncReducer } from './state';

/** Follows the journal via the main process: a snapshot of the session, then live messages. */
export function useJournal(): JournalState {
  const edssi = useEdssi();
  const [state, dispatch] = useReducer(journalSyncReducer, initialJournalSync);

  useEffect(() => {
    let active = true;
    // Subscribe before asking for the snapshot so nothing falls between the two.
    const unsubscribe = edssi.journal.onMessage((message) => {
      dispatch({ type: 'message', message });
    });
    void edssi.journal.getSnapshot().then((snapshot) => {
      if (active) dispatch({ type: 'snapshot', snapshot });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [edssi]);

  return state.journal;
}
