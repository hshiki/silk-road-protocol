import { useState, useEffect } from 'react';
import { suiClient } from '../lib/rpcClient';
import { FOUNDATION_TREASURY_ID, SILK_ROAD_ORIGINAL_ID } from '../constants';

function rawToEve(raw: string | undefined): string {
  if (!raw) return '0';
  const n = BigInt(raw);
  const D = BigInt(1_000_000_000);
  const whole = n / D;
  const frac  = (n % D) * BigInt(1000) / D;
  return `${whole}.${String(frac).padStart(3, '0')}`;
}

export default function TreasuryBanner() {
  const [stats, setStats] = useState<{
    gateCount: number;
    totalPool: string;
    jumpCount: number;
    baseToll: string;
  } | null>(null);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  async function load() {
    try {
      const res = await suiClient.getObject({
        objectId: FOUNDATION_TREASURY_ID,
        options:  { showContent: true },
      });
      const f = (res as any)?.data?.content?.fields ?? {};
      const gateCount = Number(
        f?.gate_contributors?.fields?.size ?? f?.gate_contributors?.size ?? 0
      );
      const dividendPool  = BigInt(f?.dividend_pool       ?? '0');
      const uptimePool    = BigInt(f?.uptime_reward_pool  ?? '0');
      const prepaidEscrow = BigInt(f?.prepaid_escrow      ?? '0');
      const totalPool = dividendPool + uptimePool + prepaidEscrow;
      const BULK_PRICE_10  = BigInt(9_000_000_000);
      const BULK_PRICE_100 = BigInt(80_000_000_000);
      let jumpCount = 0;
      let cursor: string | null | undefined = undefined;
      do {
        const page: any = await suiClient.queryEvents({
          query:  { MoveEventType: `${SILK_ROAD_ORIGINAL_ID}::silk_road::TransitPermitIssuedEvent` },
          cursor: cursor ?? undefined,
          limit:  50,
        });
        for (const ev of (page?.data ?? [])) {
          const paid = BigInt(ev?.parsedJson?.toll_paid ?? '0');
          if (paid >= BULK_PRICE_100)     jumpCount += 100;
          else if (paid >= BULK_PRICE_10) jumpCount += 10;
          else                            jumpCount += 1;
        }
        cursor = page?.hasNextPage ? page?.nextCursor : null;
      } while (cursor);
      setStats({
        gateCount,
        totalPool: rawToEve(String(totalPool)),
        jumpCount,
        baseToll:  rawToEve(String(f?.base_toll_fee ?? '0')),
      });
    } catch {}
  }

  const items = stats ? [
    { label: 'Gates in Network', value: String(stats.gateCount)      },
    { label: 'Treasury Balance', value: stats.totalPool + ' EVE'     },
    { label: 'Permits Issued',   value: String(stats.jumpCount)      },
    { label: 'Base Toll',        value: stats.baseToll + ' EVE'      },
  ] : [];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '1px',
      background: '#1e2e3e',
      border: '1px solid #1e2e3e',
      marginBottom: '20px',
    }}>
      {items.map(item => (
        <div key={item.label} style={{ background: '#0a0a0f', padding: '10px 14px' }}>
          <div style={{ fontSize: '0.68rem', color: '#6a8a9a', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {item.label}
          </div>
          <div style={{ fontSize: '0.88rem', fontFamily: 'monospace', color: '#c9e8ff' }}>
            {item.value}
          </div>
        </div>
      ))}
      {!stats && (
        <div style={{ gridColumn: '1 / -1', background: '#0a0a0f', padding: '10px 14px', fontSize: '0.78rem', color: '#4a6a7a' }}>
          Loading treasury…
        </div>
      )}
    </div>
  );
}
