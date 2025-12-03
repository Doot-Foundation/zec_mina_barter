import { describe, it, expect, beforeEach, jest } from '@jest/globals';

describe('supabase-client', () => {
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

  it('returns null on supabase error', async () => {
    const mockFrom = {
      select: () => mockFrom,
      eq: () => mockFrom,
      maybeSingle: async () => ({ data: null, error: { message: 'fail' } }),
    };
    const mockClient = { from: () => mockFrom } as any;
    jest.unstable_mockModule('@supabase/supabase-js', () => ({
      createClient: () => mockClient,
    }));

    const { fetchKeypairByMina, fetchKeypairByZcash } = await import(
      '../../src/supabase-client.js'
    );
    const res1 = await fetchKeypairByMina('mina');
    const res2 = await fetchKeypairByZcash('zec');
    expect(res1).toBeNull();
    expect(res2).toBeNull();
  });
});
