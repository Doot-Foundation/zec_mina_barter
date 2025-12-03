import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const makePrice = (price: string) => ({
  status: true,
  data: {
    price_data: {
      price,
      decimals: 1_000_000_000,
      aggregationTimestamp: Date.now(),
      signature: {
        signature: 'sig',
        publicKey: 'pk',
        data: 'd',
      },
    },
  },
});

describe('oracle-client', () => {
  beforeEach(() => {
    process.env.ORACLE_API_KEY = 'oracle-key';
    process.env.ORACLE_BASE_URL = 'https://doot.example';
    process.env.OPERATOR_PRIVATE_KEY =
      'EKFHtzKvGhST9bDtN1FuHj9gkT8azAmfF4nqcjB3yPJr2UyVvXjq';
    process.env.MINA_GRAPHQL_ENDPOINT = 'https://example.com/graphql';
    process.env.MINA_POOL_ADDRESS =
      'B62qqyR2krDKXTVVkUKToQjXeFm1WbVTadLc9XmZZkupG9YecCyWM44';
    process.env.ESCROWD_OPERATOR_TOKEN = 'token';
    process.env.SUPABASE_URL = 'https://supabase.example';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'supabase-key';
    jest.restoreAllMocks();
  });

  it('derives cross rate from MINA/USD and ZEC/USD', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch' as any)
      // mina
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makePrice('250000000'), // $0.25
      } as any)
      // zec
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makePrice('5000000000'), // $5.00
      } as any);

    const { getCrossRate } = await import('../../src/oracle-client.js');
    const result = await getCrossRate();

    expect(result.priceMinaPerZec).toBe(
      (250000000n * 1_000_000_000n) / 5_000_000_000n
    );
    expect(result.priceZecPerMina).toBe(
      (5_000_000_000n * 1_000_000_000n) / 250000000n
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
