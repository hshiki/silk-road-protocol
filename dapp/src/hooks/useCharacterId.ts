import { useState, useEffect } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { suiClient } from '../lib/rpcClient';
import { CHARACTER_PACKAGE_ID } from '../constants';

/**
 * Queries the connected wallet's owned objects for a PlayerProfile,
 * extracts the character_id, and returns it.
 */
export function useCharacterId() {
  const currentAccount = useCurrentAccount();
  const [characterId, setCharacterId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!currentAccount?.address) {
      setCharacterId('');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError('');

    (async () => {
      try {
        const res = await suiClient.getOwnedObjects({
          owner: currentAccount.address,
          filter: { StructType: `${CHARACTER_PACKAGE_ID}::character::PlayerProfile` },
          options: { showContent: true },
        });
        if (cancelled) return;

        const profile = res?.data?.[0];
        const charId = profile?.data?.content?.fields?.character_id;
        if (charId) {
          setCharacterId(String(charId));
        } else {
          setError('No PlayerProfile found for this wallet.');
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [currentAccount?.address]);

  return { characterId, loading, error };
}
