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
import { useSmartGate } from '../context/SmartGateContext';
import AssimilateGate from './AssimilateGate';

const PRECISION    = BigInt(1_000_000_000);
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
interface ContribGate { gateId: string; nodeId: string; }
export default function ContributorPage() {
  const { walletAddress } = useConnection();
  const { signAndExecuteTransaction } = useDAppKit();
  const { gateId } = useSmartGate();

  const [shares,       setShares]       = useState<ShareInfo[]>([]);
  const [contrib,      setContrib]      = useState<ContribGate[]>([]);
  const [isAssimilated, setIsAssimilated] = useState(false);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [claimLoading, setClaimLoading] = useState(false);
  const [status,       setStatus]       = useState<{ type: 'ok'|'err'|'info'; msg: string } | null>(null);

  useEffect(() => {
    if (!walletAddress) { setShares([]); setContrib([]); setIsAssimilated(false); return; }
    setHoldingsLoading(true);
    Promise.all([fetchShares(), fetchContribGates()]).finally(() => setHoldingsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, gateId]);

  async function fetchShares() {
    const [sharesRes, treasuryRes] = await Promise.all([
      suiClient.getOwnedObjects({
        owner:   walletAddress!,
        filter:  { StructType: `${SILK_ROAD_ORIGINAL_ID}::silk_road::SRP_Share` },
        options: { showContent: true },
      }),
      suiClient.getObject({ objectId: FOUNDATION_TREASURY_ID, options: { showContent: true } }),
    ]);
    const globalRPS = BigInt((treasuryRes as any)?.data?.content?.fields?.global_reward_per_share ?? 0);
    const items: ShareInfo[] = ((sharesRes as any)?.data ?? [])
      .map((item: any) => {
        const f = item?.data?.content?.fields ?? {};
        const objectId   = item?.data?.objectId ?? '';
        const shares     = BigInt(f.shares ?? 0);
        const rewardDebt = BigInt(f.reward_debt ?? 0);
        const gross      = shares * globalRPS;
        const claimable  = gross > rewardDebt ? (gross - rewardDebt) / PRECISION : BigInt(0);
        return { objectId, shares, rewardDebt, claimable };
      })
      .filter((s: ShareInfo) => s.objectId);
    setShares(items);
  }
  async function fetchContribGates() {
    const res = await suiClient.queryEvents({
      query: { MoveEventType: `${SILK_ROAD_ORIGINAL_ID}::silk_road::GateAssimilatedEvent` },
      limit: 50,
    });
    const events: ContribGate[] = ((res as any)?.data ?? [])
      .filter((e: any) => e?.parsedJson?.submitter === walletAddress)
      .map((e: any) => ({ gateId: e?.parsedJson?.gate_id ?? '', nodeId: e?.parsedJson?.network_node_id ?? '' }))
      .filter((g: ContribGate) => g.gateId);
    setContrib(events);
    if (gateId) setIsAssimilated(events.some(g => g.gateId === gateId));
  }

  async function handleClaimAll() {
    if (!walletAddress) { setStatus({ type: 'err', msg: 'Wallet not connected.' }); return; }
    const claimable = shares.filter(s => s.claimable > BigInt(0));
    if (claimable.length === 0) { setStatus({ type: 'info', msg: 'No claimable dividend at this time.' }); return; }
    setClaimLoading(true);
    setStatus({ type: 'info', msg: 'Waiting for wallet signature…' });
    try {
      const tx = new Transaction();
      for (const s of claimable) {
        tx.moveCall({
          target: `${SILK_ROAD_PACKAGE_ID}::silk_road::claim_dividend`,
          arguments: [tx.object(FOUNDATION_TREASURY_ID), tx.object(s.objectId)],
        });
      }
      const result = await signAndExecuteTransaction({ transaction: tx });
      setStatus({ type: 'ok', msg: `Claimed! Digest: ${result.Transaction?.digest}` });
      setTimeout(() => fetchShares(), 2000);
    } catch (e: any) {
      setStatus({ type: 'err', msg: e?.message ?? String(e) });
    } finally {
      setClaimLoading(false);
    }
  }

  const totalShares    = shares.reduce((acc, s) => acc + s.shares,    BigInt(0));
  const totalClaimable = shares.reduce((acc, s) => acc + s.claimable, BigInt(0));
  return (
    <div>
      <h2 style={{ marginBottom: '4px' }}>Contributor</h2>
      <p style={{ fontSize: '0.82rem', color: '#6a8a9a', marginBottom: '28px' }}>
        Lock your Smart Gate into the Foundation Treasury to receive SRP_Share tokens, then claim your share of protocol dividends.
      </p>

      <section style={{ marginBottom: '40px' }}>
        <h3 style={{ fontSize: '0.95rem', color: '#7eb8d4', borderBottom: '1px solid #1e3040', paddingBottom: '6px', marginBottom: '16px' }}>
          Assimilate Gate
        </h3>
        <AssimilateGate isAssimilated={isAssimilated} />
      </section>

      <section style={{ marginBottom: '40px' }}>
        <h3 style={{ fontSize: '0.95rem', color: '#7eb8d4', borderBottom: '1px solid #1e3040', paddingBottom: '6px', marginBottom: '16px' }}>
          Your Holdings
        </h3>
        {!walletAddress && <p style={{ fontSize: '0.82rem', color: '#6a8a9a' }}>Connect your wallet to see your holdings.</p>}
        {walletAddress && holdingsLoading && <p style={{ fontSize: '0.82rem', color: '#6a8a9a' }}>Loading…</p>}
        {walletAddress && !holdingsLoading && shares.length === 0 && (
          <p style={{ fontSize: '0.82rem', color: '#6a8a9a' }}>No SRP_Share found in this wallet.</p>
        )}
        {walletAddress && !holdingsLoading && shares.length > 0 && (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', marginBottom: '14px' }}>
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
            <div style={{ fontSize: '0.82rem', marginBottom: '16px' }}>
              <span style={{ color: '#6a8a9a' }}>Total shares: </span>
              <strong style={{ color: '#c9e8ff' }}>{String(totalShares)}</strong>
              <span style={{ color: '#6a8a9a', marginLeft: '20px' }}>Total claimable: </span>
              <strong style={{ color: totalClaimable > 0 ? '#4a9a7a' : '#6a8a9a' }}>{balanceToEve(totalClaimable)}</strong>
            </div>
            <button className="primary" onClick={handleClaimAll} disabled={claimLoading || totalClaimable === BigInt(0)}>
              {claimLoading ? 'Claiming…' : 'Claim Dividend'}
            </button>
          </>
        )}
        {walletAddress && !holdingsLoading && contrib.length > 0 && (
          <div style={{ marginTop: '20px' }}>
            <p style={{ fontSize: '0.82rem', color: '#6a8a9a', marginBottom: '8px' }}>Contributed gates:</p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2a4560' }}>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: '#6a8a9a' }}>Gate ID</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: '#6a8a9a' }}>Network Node ID</th>
                </tr>
              </thead>
              <tbody>
                {contrib.map(g => (
                  <tr key={g.gateId} style={{ borderBottom: '1px solid #1e3040' }}>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace', wordBreak: 'break-all', fontSize: '0.75rem' }}>{g.gateId}</td>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace', wordBreak: 'break-all', fontSize: '0.75rem' }}>{g.nodeId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {status && <div className={`status ${status.type}`} style={{ marginTop: '16px' }}>{status.msg}</div>}
      </section>
    </div>
  );
}


