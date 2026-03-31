import { useState, useEffect } from 'react';
import { useConnection } from '@evefrontier/dapp-kit';
import { useDAppKit } from '@mysten/dapp-kit-react';
import { Transaction } from '@mysten/sui/transactions';
import {
  SILK_ROAD_PACKAGE_ID,
  FOUNDATION_TREASURY_ID,
  CLOCK_ID,
} from '../constants';
import { useSmartGate } from '../context/SmartGateContext';
import { suiClient } from '../lib/rpcClient';

function balanceToEve(raw: number): string {
  const n = BigInt(Math.floor(raw));
  const DECIMALS = BigInt(1_000_000_000);
  const whole = n / DECIMALS;
  const frac  = (n % DECIMALS) * BigInt(1000) / DECIMALS;
  return `${whole}.${String(frac).padStart(3, '0')} EVE`;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export default function ClaimUptimeReward() {
  const { walletAddress } = useConnection();
  const { signAndExecuteTransaction } = useDAppKit();
  const { gateId, nodeId } = useSmartGate();

  const [lastRewardAt,    setLastRewardAt]    = useState<number | null>(null);
  const [rewardPerMs,     setRewardPerMs]     = useState<number>(1);
  const [poolBalance,     setPoolBalance]     = useState<number>(0);
  const [isContributor,   setIsContributor]   = useState<boolean | null>(null);
  const [now,             setNow]             = useState<number>(Date.now());
  const [status,          setStatus]          = useState<{ type: 'ok'|'err'|'info'; msg: string } | null>(null);
  const [loading,         setLoading]         = useState(false);

  // Tick every second so elapsed time updates live
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Fetch treasury stats when gateId is available
  useEffect(() => {
    if (!gateId) return;
    fetchStats();
    const id = setInterval(fetchStats, 30000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateId]);

  async function fetchStats() {
    try {
      const res = await suiClient.getObject({
        objectId: FOUNDATION_TREASURY_ID,
        options:  { showContent: true },
      });
      const f = (res as any)?.data?.content?.fields ?? {};
      setRewardPerMs(Number(f.uptime_reward_per_ms ?? 1));
      setPoolBalance(Number(
        f.uptime_reward_pool?.fields?.balance ?? f.uptime_reward_pool ?? 0
      ));

      // Read gate_last_reward_at[gateId] via dynamic field lookup
      const tableId =
        f.gate_last_reward_at?.fields?.id?.id ??
        f.gate_last_reward_at?.id?.id ?? '';

      if (tableId && gateId) {
        try {
          const dfRes = await suiClient.getDynamicFieldObject({
            parentId: tableId,
            name: { type: '0x2::object::ID', value: gateId },
          });
          const ts = (dfRes as any)?.data?.content?.fields?.value;
          if (ts !== undefined) {
            setLastRewardAt(Number(ts));
            setIsContributor(true);
          } else {
            setIsContributor(false);
          }
        } catch (_) {
          setIsContributor(false);
        }
      }
    } catch (e: any) {
      console.error('[ClaimUptime] fetchStats:', e);
    }
  }

  async function handleClaim() {
    if (!walletAddress) { setStatus({ type: 'err', msg: 'Wallet not connected.' }); return; }
    if (!gateId)        { setStatus({ type: 'err', msg: 'Gate ID not detected.' }); return; }
    if (!nodeId)        { setStatus({ type: 'err', msg: 'Network Node ID not detected.' }); return; }
    setLoading(true);
    setStatus({ type: 'info', msg: 'Waiting for wallet signature…' });
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${SILK_ROAD_PACKAGE_ID}::silk_road::claim_uptime_reward`,
        arguments: [
          tx.object(FOUNDATION_TREASURY_ID),
          tx.object(gateId),
          tx.object(nodeId),
          tx.object(CLOCK_ID),
        ],
      });
      const result = await signAndExecuteTransaction({ transaction: tx });
      setStatus({ type: 'ok', msg: `Claimed! Digest: ${result.Transaction?.digest}` });
      // Refresh stats after claim
      setTimeout(fetchStats, 2000);
    } catch (e: any) {
      setStatus({ type: 'err', msg: e?.message ?? String(e) });
    } finally {
      setLoading(false);
    }
  }

  const elapsedMs      = lastRewardAt !== null ? Math.max(0, now - lastRewardAt) : 0;
  const pendingReward  = elapsedMs * rewardPerMs;
  const cappedReward   = Math.min(pendingReward, poolBalance);
  const isRegistered   = isContributor === true;

  return (
    <div>
      <p style={{ fontSize: '0.82rem', color: '#6a8a9a', marginBottom: '20px' }}>
        Reward accrues while both your gate and network node are online.
        Anyone can trigger the claim — it always goes to the original contributor.
      </p>

      {gateId && isContributor === false && (
        <p style={{ fontSize: '0.82rem', color: '#6aaada', marginBottom: '16px' }}>This gate is not registered with Silk Road.</p>
      )}

      {gateId && isRegistered && (
        <section style={{ marginBottom: '20px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <tbody>
              <tr style={{ borderBottom: '1px solid #1e3040' }}>
                <td style={{ padding: '6px 8px', color: '#6a8a9a', width: '200px' }}>Gate ID</td>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace', wordBreak: 'break-all', fontSize: '0.75rem' }}>{gateId}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #1e3040' }}>
                <td style={{ padding: '6px 8px', color: '#6a8a9a' }}>Network Node ID</td>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace', wordBreak: 'break-all', fontSize: '0.75rem' }}>{nodeId}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #1e3040' }}>
                <td style={{ padding: '6px 8px', color: '#6a8a9a' }}>Accrual Time</td>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: '#c9e8ff' }}>{formatDuration(elapsedMs)}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #1e3040' }}>
                <td style={{ padding: '6px 8px', color: '#6a8a9a' }}>Pending Reward</td>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: '#4a9a7a' }}>{balanceToEve(cappedReward)}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #1e3040' }}>
                <td style={{ padding: '6px 8px', color: '#6a8a9a' }}>Uptime Pool Balance</td>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{balanceToEve(poolBalance)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      {gateId && (
        <button
          className="primary"
          onClick={handleClaim}
          disabled={loading || !walletAddress || !isRegistered || cappedReward === 0}
        >
          {loading ? 'Claiming…' : 'Claim Uptime Reward'}
        </button>
      )}

      {status && <div className={`status ${status.type}`}>{status.msg}</div>}
    </div>
  );
}


