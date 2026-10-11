import { type DragEvent, useEffect, useRef, useState } from 'react';

import type { ShoppingNeed } from '../../../shared/commodities';
import { useEdssi, useOpenDialog, useOwnsEvent } from '../api/context';
import { Glyph } from '../hud/Glyph';
import { formatNumber } from '../journal/format';

/** Screenshots are shrunk to fit this many pixels on their longer side before they are sent. */
const MAX_SIDE = 2560;
/** As `MAX_SCREENSHOTS` in the main process. */
const MAX_SCREENSHOTS = 12;

interface Screenshot {
  id: number;
  name: string;
  url: string;
}

let shots = 0;

/** An image file as a PNG data URL, shrunk if it is larger than the model needs. */
async function toDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/png');
}

const images = (files: Iterable<File>) =>
  [...files].filter((file) => file.type.startsWith('image/'));

/**
 * Reads the shopping list off screenshots of the game's colonisation panel. Screenshots are
 * pasted, picked or dropped, and the assistant's model reads them; what it read is shown before
 * it replaces the list or is added to it.
 */
export function ScreenshotImport({
  initialFiles,
  listEmpty,
  onImport,
  onClose,
}: {
  /** Files dropped on the list that opened this. */
  initialFiles?: File[];
  listEmpty: boolean;
  onImport: (needs: ShoppingNeed[], mode: 'replace' | 'add') => void;
  onClose: () => void;
}) {
  const edssi = useEdssi();
  const dialog = useRef<HTMLDialogElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [read, setRead] = useState<ShoppingNeed[]>();
  /** Bumped on close, so an answer that comes back after it is dropped. */
  const attempt = useRef(0);
  const started = useRef(false);

  const add = (files: Iterable<File>) => {
    const wanted = images(files);
    if (wanted.length === 0) return;
    setProblem(undefined);
    setRead(undefined);
    for (const file of wanted) {
      toDataUrl(file).then(
        (url) => setScreenshots((current) => [...current, { id: ++shots, name: file.name, url }]),
        () => setProblem(`Couldn't open ${file.name || 'that image'}.`),
      );
    }
  };

  const ownsEvent = useOwnsEvent();
  const openDialog = useOpenDialog();
  useEffect(() => {
    if (dialog.current) openDialog(dialog.current);
    // Once, even where effects run twice in development.
    if (initialFiles && !started.current) add(initialFiles);
    started.current = true;
    const onPaste = (event: ClipboardEvent) => {
      // Embedded in a page (the mock UI), a paste elsewhere on it is the page's.
      if (!ownsEvent(event)) return;
      const files = [...(event.clipboardData?.files ?? [])];
      if (images(files).length === 0) return;
      event.preventDefault();
      add(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // Only the files it opened with; later ones come through `add`.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [openDialog, ownsEvent]);

  const close = () => {
    attempt.current++;
    onClose();
  };

  const readThem = () => {
    const mine = ++attempt.current;
    setReading(true);
    setProblem(undefined);
    void edssi.commodities
      .readScreenshots(screenshots.map((shot) => shot.url))
      .then(
        (outcome) => {
          if (mine !== attempt.current) return;
          if ('error' in outcome) setProblem(outcome.error);
          else setRead(outcome.result);
        },
        (error: unknown) => {
          if (mine === attempt.current) setProblem(String(error));
        },
      )
      .finally(() => {
        if (mine === attempt.current) setReading(false);
      });
  };

  const finish = (mode: 'replace' | 'add') => {
    if (read) onImport(read, mode);
    close();
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    add(event.dataTransfer.files);
  };
  const tooMany = screenshots.length > MAX_SCREENSHOTS;

  return (
    // Drops anywhere on the dialog are its own, not the shopping list's behind it.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={dialog}
      className="modal screenshot-import"
      aria-label="Import from screenshots"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        event.stopPropagation();
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <div className="modal-head">
        <h2 className="sec-title">Import from screenshots</h2>
        <button type="button" className="ibtn sm" aria-label="Close" title="Close" onClick={close}>
          <Glyph name="close" />
        </button>
      </div>

      {read ? (
        <>
          <p className="muted">
            Read {read.length} {read.length === 1 ? 'commodity' : 'commodities'} from{' '}
            {screenshots.length} {screenshots.length === 1 ? 'screenshot' : 'screenshots'}. Check
            them against the game before using them.
          </p>
          <div className="modal-scroll">
            <table className="tbl compact">
              <thead>
                <tr>
                  <th scope="col">Commodity</th>
                  <th scope="col">Needed</th>
                </tr>
              </thead>
              <tbody>
                {read.map((need) => (
                  <tr key={need.commodity}>
                    <td>{need.commodity}</td>
                    <td className="v">{formatNumber(need.quantity, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="modal-actions">
            {listEmpty ? (
              <button type="button" className="btn sm" onClick={() => finish('replace')}>
                Use these
              </button>
            ) : (
              <>
                <button type="button" className="btn sm" onClick={() => finish('replace')}>
                  Replace the list
                </button>
                <button type="button" className="btn sm" onClick={() => finish('add')}>
                  Add to it
                </button>
              </>
            )}
            <button type="button" className="link" onClick={() => setRead(undefined)}>
              Back
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="screenshot-drop" data-dragging={dragging || undefined}>
            {screenshots.length === 0 ? (
              <p className="muted">
                Paste screenshots of the colonisation panel (Ctrl+V), drop them here, or{' '}
                <button type="button" className="link" onClick={() => picker.current?.click()}>
                  pick files
                </button>
                . Take one per scroll if the list is longer than the panel.
              </p>
            ) : (
              <ul className="screenshot-thumbs">
                {screenshots.map((shot) => (
                  <li key={shot.id}>
                    <img src={shot.url} alt={shot.name || 'Screenshot'} />
                    <button
                      type="button"
                      className="link screenshot-remove"
                      aria-label={`Remove ${shot.name || 'screenshot'}`}
                      title="Remove"
                      disabled={reading}
                      onClick={() =>
                        setScreenshots((current) => current.filter((other) => other !== shot))
                      }
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <input
            ref={picker}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              add(event.target.files ?? []);
              event.target.value = '';
            }}
          />
          {problem && (
            <p className="settings-problem" role="alert">
              {problem}
            </p>
          )}
          {tooMany && (
            <p className="settings-problem" role="alert">
              At most {MAX_SCREENSHOTS} screenshots at a time.
            </p>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="btn sm"
              disabled={screenshots.length === 0 || tooMany || reading}
              onClick={readThem}
            >
              {reading ? 'Reading…' : 'Read'}
            </button>
            {screenshots.length > 0 && (
              <button
                type="button"
                className="link"
                disabled={reading}
                onClick={() => picker.current?.click()}
              >
                Add files
              </button>
            )}
            <button type="button" className="link" onClick={close}>
              Cancel
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
