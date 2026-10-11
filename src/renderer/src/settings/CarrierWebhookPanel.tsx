import { useState } from 'react';

import type { CarrierWebhookSettings } from '../../../shared/settings';
import { useEdssi } from '../api/context';
import type { Getter } from './fields';

/**
 * The SWS Carrier Tracker plugin's "Send Test Alert": posts its test embed with the values as they
 * are on screen, saved or not, so a webhook can be tried before it is kept.
 */
export function CarrierWebhookPanel({ get }: { get: Getter }) {
  const edssi = useEdssi();
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string>();

  const test = async () => {
    const draft: Partial<CarrierWebhookSettings> = {};
    for (const key of ['webhook_url', 'image_url', 'carrier_name', 'carrier_serial'] as const) {
      const value = get(['carrier_webhook', key]);
      draft[key] = typeof value === 'string' ? value : undefined;
    }
    setSending(true);
    setResult(undefined);
    try {
      setResult(await edssi.carrierWebhook.test(draft));
    } catch (error) {
      setResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="settings-panel">
      <div className="settings-actions">
        <button
          type="button"
          className="btn ghost sm"
          disabled={sending}
          onClick={() => void test()}
        >
          {sending ? 'Sending…' : '⚡ Send Test Alert'}
        </button>
      </div>
      {result === 'Success' && (
        <p className="settings-help">✨ Test alert dispatched successfully!</p>
      )}
      {result !== undefined && result !== 'Success' && (
        <p className="settings-problem">❌ {result}</p>
      )}
    </div>
  );
}
