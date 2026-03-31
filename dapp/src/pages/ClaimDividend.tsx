import { useState, useEffect } from 'react';
import { useConnection } from '@evefrontier/dapp-kit';
import { useDAppKit } from '@mysten/dapp-kit-react';
import { Transaction } from '@mysten/sui/transactions';
import { suiClient } from '../lib/rpcClient';
import {
  SILK_ROAD_PACKAGE_ID,
  SILK_ROAD_ORIGINAL_ID,
  FOUNDATION_TREASURY_ID,
} from '../constants';

const PRECISION = BigInt(1_000_000_000);
const EVE_DECIMALS = BigInt(1_000_000_000);

function balanceToEve(raw: bigint): string {
  const whole = raw / EVE_DECIMALS;
  const frac  = (raw % EVE_DECIMALS) * BigInt(1000) / EVE_DECIMALS;
  return `${whole}.${String(frac).padStart(3, '0')} EVE`;
}

interface ShareInfo {
  objectId:   string;
  shares:     bigint;
  rewardDebt: bigint;
  claimable:  bigint;
}

export default function ClaimDividend() {
  const { walletAddress } = useConnection();
  const { signAndExecuteTransaction } = useDAppKit();

  const [shares,       setShares]       = useState<ShareInfo[]>([]);
  const [sharesLoading, setSharesLoading] = useState(true);
  const [loading,       setLoading]       = useState(false);
  const [status,        setStatus]        = useState<{ type: 'ok'|'err'|'info'; msg: string } | null>(null);

  useEffect(() => {
    if (!walletAddress) { setShares([]); return; }
    setSharesLoading(true);
    fetchShares().finally(() => setSharesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress]);

  async function fetchShares() {
    try {
      const [sharesRes, treasuryRes] = await Promise.all([
        suiClient.getOwnedObjects({
          owner:   walletAddress!,
          filter:  { StructType: `${SILK_ROAD_ORIGINAL_ID}::silk_road::SRP_Share` },
          options: { showContent: true },
        }),
        suiClient.getObject({
          objectId: FOUNDATION_TREASURY_ID,
          options:  { showContent: true },
        }),
      ]);

      const globalRPS = BigInt(
        (treasuryRes as any)?.data?.content?.fields?.global_reward_per_share ?? 0
      );

      const items: ShareInfo[] = ((sharesRes as any)?.data ?? [])
        .map((item: any) => {
          const f          = item?.data?.content?.fields ?? {};
          const objectId   = item?.data?.objectId ?? '';
          const shares     = BigInt(f.shares ?? 0);
          const rewardDebt = BigInt(f.reward_debt ?? 0);
          const gross      = shares * globalRPS;
          const claimable  = gross > rewardDebt
            ? (gross - rewardDebt) / PRECISION
            : BigInt(0);
          return { objectId, shares, rewardDebt, claimable };
        })
        .filter((s: ShareInfo) => s.objectId);

      setShares(items);
    } catch (e: any) {
      console.error('[ClaimDividend] fetchShares:', e);
    }
  }

  async function handleClaimAll() {
    if (!walletAddress) { setStatus({ type: 'err', msg: 'Wallet not connected.' }); return; }
    const claimable = shares.filter(s => s.claimable > BigInt(0));
    if (claimable.length === 0) { setStatus({ type: 'info', msg: 'No claimable dividend at this time.' }); return; }
    setLoading(true);
    setStatus({ type: 'info', msg: 'Waiting for wallet signature…' });
    try {
      const tx = new Transaction();
      for (const s of claimable) {
        tx.moveCall({
          target: `${SILK_ROAD_PACKAGE_ID}::silk_road::claim_dividend`,
          arguments: [
            tx.object(FOUNDATION_TREASURY_ID),
            tx.object(s.objectId),
          ],
        });
      }
      const result = await signAndExecuteTransaction({ transaction: tx });
      setStatus({ type: 'ok', msg: `Claimed! Digest: ${result.Transaction?.digest}` });
      setTimeout(fetchShares, 2000);
    } catch (e: any) {
      setStatus({ type: 'err', msg: e?.message ?? String(e) });
    } finally {
      setLoading(false);
    }
  }

  const totalClaimable = shares.reduce((acc, s) => acc + s.claimable, BigInt(0));
  const totalShares    = shares.reduce((acc, s) => acc + s.shares,    BigInt(0));

  return (
    <div>
      <p style={{ fontSize: '0.82rem', color: '#6a8a9a', marginBottom: '20px' }}>
        Dividends accrue from transit revenue proportional to your SRP_Share holdings.
      </p>

      {!walletAddress && (
        <p style={{ fontSize: '0.82rem', color: '#6a8a9a' }}>Connect your wallet to view dividends.</p>
      )}

      {walletAddress && sharesLoading && (
        <p style={{ fontSize: '0.82rem', color: '#6a8a9a' }}>Loading share data…</p>
      )}
      {walletAddress && !sharesLoading && shares.length === 0 && (
        <p style={{ fontSize: '0.82rem', color: '#6a8a9a' }}>No SRP_Share found in this wallet.</p>
      )}

      {shares.length > 0 && (
        <>
          <section style={{ marginBottom: '20px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2a4560' }}>
                  <th style={{ padding: '6px 8px', textAlign: 'left',  color: '#6a8a9a' }}>SRP_Share Object</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', color: '#6a8a9a' }}>Shares</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', color: '#6a8a9a' }}>Claimable</th>
                </tr>
              </thead>
              <tbody>
                {shares.map(s => (
                  <tr key={s.objectId} style={{ borderBottom: '1px solid #1e3040' }}>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace', wordBreak: 'break-all', fontSize: '0.75rem' }}>{s.objectId}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{String(s.shares)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', color: s.claimable > 0 ? '#4a9a7a' : '#6a8a9a' }}>{balanceToEve(s.claimable)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div style={{ marginBottom: '16px', fontSize: '0.9rem' }}>
            <span style={{ color: '#6a8a9a' }}>Total shares: </span>
            <strong style={{ color: '#c9e8ff' }}>{String(totalShares)}</strong>
            <span style={{ color: '#6a8a9a', marginLeft: '20px' }}>Total claimable: </span>
            <strong style={{ color: totalClaimable > 0 ? '#4a9a7a' : '#6a8a9a' }}>{balanceToEve(totalClaimable)}</strong>
          </div>

          <button
            className="primary"
            onClick={handleClaimAll}
            disabled={loading || totalClaimable === BigInt(0)}
          >
            {loading ? 'Claiming…' : 'Claim Dividend'}
          </button>
        </>
      )}

      {status && <div className={`status ${status.type}`}>{status.msg}</div>}
    </div>
  );
}


