/**
 * Discord posts for a fleet carrier's jumps, as the SWS Carrier Tracker EDMC plugin
 * (github.com/EddiesMinion/SWS-Carrier-Tracker) sends them. The embeds are its own, word for word,
 * so a channel reads the same whichever of the two posted; only the plugin's `key` field, which
 * Discord ignores, is left out.
 */

/** What the plugin falls back on when no name or serial is set. */
export const DEFAULT_CARRIER_NAME = 'SWS Carrier';
export const DEFAULT_CARRIER_SERIAL = '8008135';

export interface CarrierIdentity {
  name: string;
  serial: string;
}

export interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  fields: { name: string; value: string; inline: boolean }[];
  footer: { text: string };
  image?: { url: string };
}

export interface DiscordPayload {
  embeds: [DiscordEmbed];
}

/** `CarrierJumpRequest`: the countdown has started. */
export function jumpScheduledPayload(
  carrier: CarrierIdentity,
  commander: string,
  targetSystem: string,
  imageUrl?: string,
): DiscordPayload {
  return withImage(
    {
      embeds: [
        {
          title: `🚨 ${carrier.name} (${carrier.serial}) — Jump Scheduled!`,
          description:
            'The hyperspace countdown sequence has been initiated. **All personnel lock your ships down.**',
          color: 15105570,
          fields: [
            { name: 'Commanding Officer', value: commander, inline: true },
            { name: 'Destination System', value: targetSystem, inline: true },
            { name: 'Time to Departure', value: '15 Minutes (Lockdown in 10)', inline: false },
          ],
          footer: { text: `SWS Automated Log Protocol — ${carrier.serial}` },
        },
      ],
    },
    imageUrl,
  );
}

/** `CarrierJumpCancelled`. */
export function jumpCancelledPayload(carrier: CarrierIdentity, imageUrl?: string): DiscordPayload {
  return withImage(
    {
      embeds: [
        {
          title: `🛑 ${carrier.name} (${carrier.serial}) — Jump Aborted`,
          description: 'The scheduled frame shift drive jump has been **CANCELLED** by command.',
          color: 15158332,
          fields: [
            {
              name: 'Status Update',
              value: 'The carrier will remain at its current coordinates.',
              inline: false,
            },
          ],
          footer: { text: `SWS Automated Log Protocol — ${carrier.serial}` },
        },
      ],
    },
    imageUrl,
  );
}

/** The settings screen's test button. */
export function testPayload(carrier: CarrierIdentity, imageUrl?: string): DiscordPayload {
  return withImage(
    {
      embeds: [
        {
          title: `🧪 Connection Test — ${carrier.name} (${carrier.serial})`,
          description:
            'If you are reading this, your settings have been saved and the Discord bridge is active!',
          color: 3066993,
          fields: [
            { name: 'Status', value: 'Online & Listening', inline: true },
            { name: 'Engine Bridge', value: 'EDMC Client UI v5', inline: true },
          ],
          footer: { text: `SWS Verification Link — ${carrier.serial}` },
        },
      ],
    },
    imageUrl,
  );
}

function withImage(payload: DiscordPayload, imageUrl: string | undefined): DiscordPayload {
  if (imageUrl) payload.embeds[0].image = { url: imageUrl };
  return payload;
}

/** Posts to a webhook; rejects on anything but a 2xx, as the plugin's `raise_for_status` does. */
export async function postWebhook(
  webhookUrl: string,
  payload: DiscordPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'EDMC-Carrier-Bridge' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }
}
