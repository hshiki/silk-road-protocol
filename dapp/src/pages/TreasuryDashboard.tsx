import { useState, useEffect } from 'react';
import { suiClient } from '../lib/rpcClient';
import {
  FOUNDATION_TREASURY_ID,
} from '../constants';

interface TreasuryStats {
  gateCount:     number;
  totalShares:   string;
  dividendPool:  string;
  uptimePool:    string;
  baseToll:      string;
  sharesPerGate: string;
}

// EVE has 9 decimals
function balanceToEve(raw: string | undefined): string {
  if (!raw) return '0';
  const n = BigInt(raw);
  const DECIMALS = BigInt(1_000_000_000);
  const whole = n / DECIMALS;
  const frac  = (n % DECIMALS) * BigInt(1000) / DECIMALS;
  return `${whole}.${String(frac).padStart(3, '0')} EVE`;
}

export default function TreasuryDashboard() {
  const [stats, setStats] = useState<TreasuryStats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 15000);
    return () => clearInterval(id);
  }, []);

  async function fetchAll() {
    setError('');
    try {
      await fetchTreasury();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  async function fetchTreasury() {
    const res = await suiClient.getObject({
      objectId: FOUNDATION_TREASURY_ID,
      options:  { showContent: true },
    });
    const f = (res as any)?.data?.content?.fields ?? {};
    const gateCount = Number(
      f?.gate_contributors?.fields?.size ??
      f?.gate_contributors?.size ?? 0
    );
    setStats({
      gateCount,
      totalShares:   String(f.total_shares_issued ?? '0'),
      dividendPool:  String(f.dividend_pool?.fields?.balance ?? f.dividend_pool ?? '0'),
      uptimePool:    String(f.uptime_reward_pool?.fields?.balance ?? f.uptime_reward_pool ?? '0'),
      baseToll:      String(f.base_toll_fee ?? '0'),
      sharesPerGate: String(f.shares_per_gate ?? '0'),
    });
  }

  return (
    <div>
      {error && <div className="status err">{error}</div>}

      {stats && (
        <section style={{ marginBottom: '24px' }}>
          <h2 style={{ marginBottom: '10px' }}>Protocol Stats</h2>
          <StatTable rows={[
            { label: 'Gates Controlled',    value: String(stats.gateCount) },
            { label: 'Total Shares Issued', value: stats.totalShares },
            { label: 'Dividend Pool',       value: balanceToEve(stats.dividendPool) },
            { label: 'Uptime Pool',         value: balanceToEve(stats.uptimePool) },
            { label: 'Base Toll',           value: balanceToEve(stats.baseToll) },
            { label: 'Shares per Gate',     value: stats.sharesPerGate },
          ]} />
        </section>
      )}


    </div>
  );
}

function StatTable({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
      <tbody>
        {rows.map(r => (
          <tr key={r.label} style={{ borderBottom: '1px solid #1e3040' }}>
            <td style={{ padding: '6px 8px', color: '#6a8a9a', whiteSpace: 'nowrap', width: '200px' }}>{r.label}</td>
            <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}





