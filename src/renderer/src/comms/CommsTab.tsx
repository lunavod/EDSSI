import type { AssistantSnapshot } from '../../../shared/assistant';
import { BrowserView } from '../browser/BrowserView';
import { Tabs } from '../hud/Tabs';
import { CommsView } from './CommsView';
import type { Voice } from './useVoice';

/** The Comms module's pages; each is a window tab of its own, so the assistant can open either. */
export type CommsPage = 'comms' | 'browser';

const PAGES = [
  { id: 'comms', label: 'Chat' },
  { id: 'browser', label: 'Browser' },
] as const;

/** The Comms module: the conversation with the ship, and the browser it drives. */
export function CommsTab({
  page,
  onPage,
  snapshot,
  voice,
  browserActive,
}: {
  page: CommsPage;
  onPage: (page: CommsPage) => void;
  snapshot: AssistantSnapshot | undefined;
  voice: Voice;
  /** Whether the browser page is the one showing; its page is laid over the window only then. */
  browserActive: boolean;
}) {
  return (
    <>
      <Tabs tabs={PAGES} active={page} onSelect={onPage} sub ariaLabel="Comms" />
      {/* Both stay mounted, so the conversation keeps its scroll and the address bar its text. */}
      <div className="comms-page" hidden={page !== 'comms'}>
        <CommsView snapshot={snapshot} voice={voice} />
      </div>
      <div className="comms-page" hidden={page !== 'browser'}>
        <BrowserView active={browserActive} prompt={snapshot?.prompt} />
      </div>
    </>
  );
}
