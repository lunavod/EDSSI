import { useEffect, useRef, useState } from 'react';

import { boldRuns, type ReleaseNotes } from '../../../shared/updates';
import { Glyph } from '../hud/Glyph';

/** The release notes of a few versions, newest first, over the whole window. */
export function WhatsNewDialog({
  notes,
  onClose,
}: {
  notes: readonly ReleaseNotes[];
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="modal whats-new"
      aria-label="What’s new"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="modal-head">
        <h2 className="sec-title">What’s new</h2>
        <button
          type="button"
          className="ibtn sm"
          aria-label="Close"
          title="Close"
          onClick={onClose}
        >
          <Glyph name="close" />
        </button>
      </div>
      <div className="modal-scroll whats-new-notes">
        {notes.length === 0 && <p className="muted">No release notes yet.</p>}
        {notes.map((note) => (
          <section key={note.version}>
            <h3 className="settings-subtitle">{note.version}</h3>
            <ul>
              {note.items.map((item, index) => (
                <li key={index}>
                  {boldRuns(item).map((run, at) =>
                    run.bold ? <b key={at}>{run.text}</b> : <span key={at}>{run.text}</span>,
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="modal-actions">
        <button type="button" className="btn primary" onClick={onClose}>
          Got it
        </button>
      </div>
    </dialog>
  );
}

/** After an update, what it brought, once. */
export function WhatsNewOnUpdate() {
  const [notes, setNotes] = useState<ReleaseNotes[]>([]);
  useEffect(() => {
    void window.edssi.updates.getWhatsNew().then((whatsNew) => setNotes(whatsNew.unseen));
  }, []);
  if (notes.length === 0) return null;
  return (
    <WhatsNewDialog
      notes={notes}
      onClose={() => {
        setNotes([]);
        void window.edssi.updates.markSeen();
      }}
    />
  );
}
