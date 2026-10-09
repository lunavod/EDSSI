import { describe, expect, it, vi } from 'vitest';

import { jumpCancelledPayload, jumpScheduledPayload, postWebhook, testPayload } from './discord';

const CARRIER = { name: 'SWS//HI ZEV', serial: 'G9N-T7J' };

describe('the carrier posts', () => {
  it('announce a jump as the plugin does', () => {
    expect(jumpScheduledPayload(CARRIER, 'Yegor', 'Col 285 Sector MN-B b29-1')).toEqual({
      embeds: [
        {
          title: '🚨 SWS//HI ZEV (G9N-T7J) — Jump Scheduled!',
          description:
            'The hyperspace countdown sequence has been initiated. **All personnel lock your ships down.**',
          color: 15105570,
          fields: [
            { name: 'Commanding Officer', value: 'Yegor', inline: true },
            { name: 'Destination System', value: 'Col 285 Sector MN-B b29-1', inline: true },
            { name: 'Time to Departure', value: '15 Minutes (Lockdown in 10)', inline: false },
          ],
          footer: { text: 'SWS Automated Log Protocol — G9N-T7J' },
        },
      ],
    });
  });

  it('announce a cancelled jump as the plugin does', () => {
    const [embed] = jumpCancelledPayload(CARRIER).embeds;
    expect(embed.title).toBe('🛑 SWS//HI ZEV (G9N-T7J) — Jump Aborted');
    expect(embed.color).toBe(15158332);
    expect(embed.fields).toEqual([
      {
        name: 'Status Update',
        value: 'The carrier will remain at its current coordinates.',
        inline: false,
      },
    ]);
  });

  it('carry the image only when there is one, and never the plugin’s key', () => {
    expect(testPayload(CARRIER).embeds[0]).not.toHaveProperty('image');
    const [embed] = testPayload(CARRIER, 'https://example.com/carrier.png').embeds;
    expect(embed.image).toEqual({ url: 'https://example.com/carrier.png' });
    expect(embed.footer.text).toBe('SWS Verification Link — G9N-T7J');
    expect(embed).not.toHaveProperty('key');
  });
});

describe('postWebhook', () => {
  it('posts the payload as JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await postWebhook('https://discord.test/hook', jumpCancelledPayload(CARRIER), fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://discord.test/hook');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(jumpCancelledPayload(CARRIER));
  });

  it('rejects on an error status', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{}', { status: 404, statusText: 'Not Found' }),
    );
    await expect(
      postWebhook('https://discord.test/hook', testPayload(CARRIER), fetchImpl),
    ).rejects.toThrow('404 Not Found');
  });
});
