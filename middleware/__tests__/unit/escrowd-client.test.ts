import { describe, it, expect, beforeEach, jest } from '@jest/globals';

describe('escrowd-client', () => {
  beforeEach(() => {
    process.env.OPERATOR_PRIVATE_KEY =
      'EKFHtzKvGhST9bDtN1FuHj9gkT8azAmfF4nqcjB3yPJr2UyVvXjq';
    process.env.MINA_GRAPHQL_ENDPOINT = 'https://example.com/graphql';
    process.env.MINA_POOL_ADDRESS =
      'B62qqyR2krDKXTVVkUKToQjXeFm1WbVTadLc9XmZZkupG9YecCyWM44';
    process.env.ESCROWD_OPERATOR_TOKEN = 'token';
    process.env.SUPABASE_URL = 'https://supabase.example';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'supabase-key';
    process.env.ORACLE_API_KEY = 'oracle-key';
    jest.restoreAllMocks();
  });

  it('fetches status and sets in transit', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch' as any)
      // status
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          ({
            verified: true,
            in_transit: false,
          } satisfies any),
      } as any)
      // set-in-transit
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
        text: async () => '',
      } as any);

    const { escrowdClient } = await import('../../src/escrowd-client.js');
    const status = await escrowdClient.getStatus('trade-1');
    expect(status).not.toBeNull();
    const locked = await escrowdClient.setInTransit(
      'trade-1',
      'mina-hash',
      '1000000000',
      {
        mina_usd: '250000000',
        zec_usd: '5000000000',
        decimals: 1_000_000_000,
        aggregationTimestamp: Date.now(),
      }
    );
    expect(locked).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
