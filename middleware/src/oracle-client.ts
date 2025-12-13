import { config } from './config.js';
import { logger, colors } from './logger.js';

// CoinGecko token ID mapping
const COINGECKO_TOKEN_IDS: Record<'mina' | 'zec', string> = {
  mina: 'mina-protocol',
  zec: 'zcash'
};

export type OraclePrice = {
  price: string;               // processed mean as string
  decimals: number;            // scaling factor (e.g., 1e9)
  aggregationTimestamp: number;
  signature: {
    signature: string;
    publicKey: string;
    data: string;
  };
};

type OracleResponse = {
  status: boolean;
  data: {
    price_data: OraclePrice;
  };
};

/**
 * Fetch price from CoinGecko (fallback oracle)
 */
async function fetchFromCoinGecko(token: 'mina' | 'zec'): Promise<OraclePrice> {
  const cgId = COINGECKO_TOKEN_IDS[token];
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd`;

  const resp = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!resp.ok) {
    throw new Error(`CoinGecko HTTP ${resp.status}: ${await resp.text()}`);
  }

  const data = await resp.json() as Record<string, { usd?: number }>;
  const priceUSD = data[cgId]?.usd;

  if (!priceUSD || priceUSD <= 0) {
    throw new Error(`Invalid CoinGecko price: ${priceUSD}`);
  }

  // Transform to match Doot format
  const DECIMALS = 1e9;
  const scaledPrice = Math.floor(priceUSD * DECIMALS);

  return {
    price: scaledPrice.toString(),
    decimals: DECIMALS,
    aggregationTimestamp: Date.now(),
    signature: {
      signature: 'coingecko-fallback',
      publicKey: 'coingecko',
      data: 'fallback-source'
    }
  };
}

/**
 * Fetch price from Doot oracle with CoinGecko fallback
 */
async function fetchPrice(token: 'mina' | 'zec'): Promise<OraclePrice> {
  try {
    // Try Doot first (primary source)
    const url = `${config.oracle.baseUrl}/api/get/price?token=${token}`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.oracle.apiKey}`,
      },
    });

    if (!resp.ok) {
      throw new Error(`Doot HTTP ${resp.status}`);
    }

    const json = (await resp.json()) as OracleResponse;
    if (!json.status || !json.data?.price_data) {
      throw new Error(`Doot response missing price_data for ${token}`);
    }

    return json.data.price_data;

  } catch (dootError: any) {
    // Doot failed, try CoinGecko fallback
    logger.warn(`${colors.oracle}⚠️  Doot oracle failed for ${token}, using CoinGecko fallback: ${dootError.message}`);

    try {
      const fallbackPrice = await fetchFromCoinGecko(token);
      logger.info(`${colors.oracle}✓ CoinGecko fallback successful for ${token}`);
      return fallbackPrice;
    } catch (fallbackError: any) {
      throw new Error(
        `All oracle sources failed for ${token}. Doot: ${dootError.message}, CoinGecko: ${fallbackError.message}`
      );
    }
  }
}

function withinTtl(ts: number, ttlMs: number): boolean {
  return Date.now() - ts <= ttlMs;
}

export async function getCrossRate() {
  logger.debug(`${colors.oracle}Fetching cross-rate from oracle...`);
  const [mina, zec] = await Promise.all([fetchPrice('mina'), fetchPrice('zec')]);

  if (!withinTtl(mina.aggregationTimestamp, config.oracle.ttlMs)) {
    throw new Error('MINA oracle price stale');
  }
  if (!withinTtl(zec.aggregationTimestamp, config.oracle.ttlMs)) {
    throw new Error('ZEC oracle price stale');
  }

  const minaUsd = BigInt(mina.price);
  const zecUsd = BigInt(zec.price);
  const decimals = BigInt(mina.decimals || 1);

  if (zecUsd === 0n || minaUsd === 0n) {
    throw new Error('Oracle returned zero price');
  }

  // MINA per ZEC = mina_usd / zec_usd (same decimals)
  const priceMinaPerZec = (minaUsd * decimals) / zecUsd; // scaled by decimals
  // ZEC per MINA = zec_usd / mina_usd
  const priceZecPerMina = (zecUsd * decimals) / minaUsd; // scaled by decimals

  return {
    mina,
    zec,
    priceMinaPerZec,
    priceZecPerMina,
    decimals,
  };
}

/**
 * Check if Doot oracle is healthy
 */
export async function isDootHealthy(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const resp = await fetch(`${config.oracle.baseUrl}/api/health`, {
        method: 'GET',
        signal: controller.signal
      });
      clearTimeout(timeout);
      return resp.ok;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
}
