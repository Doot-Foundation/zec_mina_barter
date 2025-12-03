import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { logger } from './logger.js';
import { KeypairRecord } from './types.js';

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (client) return client;
  client = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false },
  });
  return client;
}

/**
 * Look up a keypair by Mina public key.
 */
export async function fetchKeypairByMina(minaPublicKey: string): Promise<KeypairRecord | null> {
  try {
    const supabase = getClient();
    const { data, error } = await supabase
      .from('keypairs')
      .select('Mina_PublicKey,Zcash_PublicKey')
      .eq('Mina_PublicKey', minaPublicKey)
      .maybeSingle();

    if (error) {
      logger.error(`Supabase query failed (mina): ${error.message}`);
      return null;
    }
    if (!data) return null;
    return {
      minaPublicKey: data.Mina_PublicKey,
      zcashPublicKey: data.Zcash_PublicKey,
    };
  } catch (error: any) {
    logger.error(`Supabase lookup (mina) failed: ${error?.message ?? error}`);
    return null;
  }
}

/**
 * Look up a keypair by Zcash public key/address.
 */
export async function fetchKeypairByZcash(zcashPublicKey: string): Promise<KeypairRecord | null> {
  try {
    const supabase = getClient();
    const { data, error } = await supabase
      .from('keypairs')
      .select('Mina_PublicKey,Zcash_PublicKey')
      .eq('Zcash_PublicKey', zcashPublicKey)
      .maybeSingle();

    if (error) {
      logger.error(`Supabase query failed (zec): ${error.message}`);
      return null;
    }
    if (!data) return null;
    return {
      minaPublicKey: data.Mina_PublicKey,
      zcashPublicKey: data.Zcash_PublicKey,
    };
  } catch (error: any) {
    logger.error(`Supabase lookup (zec) failed: ${error?.message ?? error}`);
    return null;
  }
}
