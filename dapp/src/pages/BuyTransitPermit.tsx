import { useState, useEffect } from 'react';
import { useConnection } from '@evefrontier/dapp-kit';
import { useDAppKit } from '@mysten/dapp-kit-react';
import { Transaction } from '@mysten/sui/transactions';
import { suiClient } from '../lib/rpcClient';
import {
  SILK_ROAD_PACKAGE_ID,
  FOUNDATION_TREASURY_ID,
  CLOCK_ID,
  EVE_COIN_TYPE,
  WORLD_PACKAGE_ID,
  CHARACTER_PACKAGE_ID,
} from '../constants';
import { useCharacterId } from '../hooks/useCharacterId';
import { useSmartGate } from '../context/SmartGateContext';

const EVE_DECIMALS = BigInt(1_000_000_000);

function balanceToEve(raw: bigint): string {
  const whole = raw / EVE_DECIMALS;
  const frac  = (raw % EVE_DECIMALS) * BigInt(1000) / EVE_DECIMALS;
  return `${whole}.${String(frac).padStart(3, '0')} EVE`;
}

export default function BuyTransitPermit() {
  const { walletAddress } = useConnection();
  const { signAndExecuteTransaction } = useDAppKit();
  const { characterId } = useCharacterId();
  const { gateId, linkedGateId, gateName, gateCapId } = useSmartGate();

  const [eveBalance,        setEveBalance]        = useState<bigint>(BigInt(0));
  const [toll,              setToll]              = useState<bigint>(BigInt(0));
  const [permitCount,       setPermitCount]       = useState<number | null>(null);
  const [dataLoading,       setDataLoading]       = useState(true);
  const [loading,           setLoading]           = useState(false);
  const [status,            setStatus]            = useState<{ type: 'ok'|'err'|'info'; msg: string } | null>(null);
  const [isGateInFoundation, setIsGateInFoundation] = useState<boolean | null>(null);

  useEffect(() => {
    if (!walletAddress) return;
    setDataLoading(true);
    Promise.all([
      fetchEveBalance(),
      fetchToll(),
      fetchPermitCount(),
      fetchIsGateInFoundation(),
    ]).finally(() => setDataLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, gateId, characterId]);

  async function fetchIsGateInFoundation() {
    if (!gateId) { setIsGateInFoundation(null); return; }
    try {
      const res = await suiClient.queryEvents({
        query: { MoveEventType: `${SILK_ROAD_PACKAGE_ID}::silk_road::GateAssimilatedEvent` },
        limit: 50,
      });
      const assimilatedIds: string[] = ((res as any)?.data ?? [])
        .map((e: any) => e?.parsedJson?.gate_id ?? '');
      setIsGateInFoundation(assimilatedIds.includes(gateId));
    } catch {
      setIsGateInFoundation(null);
    }
  }

  async function fetchEveBalance() {
    if (!walletAddress) return;
    const res = await suiClient.getCoins({ owner: walletAddress, coinType: EVE_COIN_TYPE });
    const coins: any[] = (res as any)?.data ?? [];
    const raw = coins.reduce((sum: bigint, c: any) => sum + BigInt(c.balance ?? '0'), BigInt(0));
    setEveBalance(raw);
  }

  async function fetchToll() {
    const res = await suiClient.getObject({
      objectId: FOUNDATION_TREASURY_ID,
      options:  { showContent: true },
    });
    const f = (res as any)?.data?.content?.fields ?? {};
    setToll(BigInt(f.base_toll_fee ?? 0));
  }

  async function fetchPermitCount() {
    if (!characterId) return;
    try {
      const charObj = await suiClient.getObject({ objectId: characterId, options: { showContent: true } });
      const characterAddress: string =
        (charObj as any)?.data?.content?.fields?.character_address ?? '';
      if (!characterAddress) return;
      const res = await suiClient.getOwnedObjects({
        owner:   characterAddress,
        filter:  { StructType: `${CHARACTER_PACKAGE_ID}::gate::JumpPermit` },
        options: {},
      });
      setPermitCount(((res as any)?.data ?? []).length);
    } catch {}
  }

  async function handleBuy() {
    if (!walletAddress) { setStatus({ type: 'err', msg: 'Wallet not connected.' }); return; }
    if (!gateId)        { setStatus({ type: 'err', msg: 'Gate ID not detected.' }); return; }
    if (!linkedGateId)  { setStatus({ type: 'err', msg: 'Destination gate not linked.' }); return; }
    if (!characterId)   { setStatus({ type: 'err', msg: 'Character ID not detected.' }); return; }
    setLoading(true);
    setStatus({ type: 'info', msg: 'Fetching EVE coins…' });
    try {
      const coinsRes = await suiClient.getCoins({ owner: walletAddress, coinType: EVE_COIN_TYPE });
      const coins: any[] = (coinsRes as any)?.data ?? [];
      if (coins.length === 0) throw new Error('No EVE coins found in wallet.');

      const tx = new Transaction();
      let paymentCoin;
      if (coins.length === 1) {
        paymentCoin = tx.object(coins[0].coinObjectId);
      } else {
        const primary = tx.object(coins[0].coinObjectId);
        tx.mergeCoins(primary, coins.slice(1).map((c: any) => tx.object(c.coinObjectId)));
        paymentCoin = primary;
      }
      tx.moveCall({
        target: `${SILK_ROAD_PACKAGE_ID}::silk_road::buy_transit_permit`,
        arguments: [
          tx.object(FOUNDATION_TREASURY_ID),
          tx.object(gateId),
          tx.object(linkedGateId),
          tx.object(characterId),
          paymentCoin,
          tx.object(CLOCK_ID),
        ],
      });
      setStatus({ type: 'info', msg: 'Waiting for wallet signature…' });
      const result = await signAndExecuteTransaction({ transaction: tx });
      setStatus({ type: 'ok', msg: `JumpPermit issued! Digest: ${result.Transaction?.digest}` });
      setTimeout(() => { fetchEveBalance(); fetchPermitCount(); }, 2000);
    } catch (e: any) {
      setStatus({ type: 'err', msg: e?.message ?? String(e) });
    } finally {
      setLoading(false);
    }
  }

  async function handleBuyTen() {
    if (!walletAddress) { setStatus({ type: 'err', msg: 'Wallet not connected.' }); return; }
    if (!gateId)        { setStatus({ type: 'err', msg: 'Gate ID not detected.' }); return; }
    if (!linkedGateId)  { setStatus({ type: 'err', msg: 'Destination gate not linked.' }); return; }
    if (!characterId)   { setStatus({ type: 'err', msg: 'Character ID not detected.' }); return; }
    setLoading(true);
    setStatus({ type: 'info', msg: 'Fetching EVE coins…' });
    try {
      const coinsRes = await suiClient.getCoins({ owner: walletAddress, coinType: EVE_COIN_TYPE });
      const coins: any[] = (coinsRes as any)?.data ?? [];
      if (coins.length === 0) throw new Error('No EVE coins found in wallet.');
      const tx = new Transaction();
      let paymentCoin;
      if (coins.length === 1) {
        paymentCoin = tx.object(coins[0].coinObjectId);
      } else {
        const primary = tx.object(coins[0].coinObjectId);
        tx.mergeCoins(primary, coins.slice(1).map((c: any) => tx.object(c.coinObjectId)));
        paymentCoin = primary;
      }
      tx.moveCall({
        target: `${SILK_ROAD_PACKAGE_ID}::silk_road::buy_transit_permit_bulk`,
        arguments: [
          tx.object(FOUNDATION_TREASURY_ID),
          tx.object(gateId),
          tx.object(linkedGateId),
          tx.object(characterId),
          paymentCoin,
          tx.pure.u64(10),
          tx.object(CLOCK_ID),
        ],
      });
      setStatus({ type: 'info', msg: 'Waiting for wallet signature…' });
      const result = await signAndExecuteTransaction({ transaction: tx });
      setStatus({ type: 'ok', msg: `10 JumpPermits issued! Digest: ${result.Transaction?.digest}` });
      setTimeout(() => { fetchEveBalance(); fetchPermitCount(); }, 2000);
    } catch (e: any) {
      setStatus({ type: 'err', msg: e?.message ?? String(e) });
    } finally {
      setLoading(false);
    }
  }

  const canBuy = !!walletAddress && !!gateId && !!linkedGateId && !!characterId && eveBalance >= toll && isGateInFoundation === true;

  return (
    <div>
      <h2>Buy Transit Permit</h2>
      <p style={{ fontSize: '0.82rem', color: '#6a8a9a', marginBottom: '20px' }}>
        Purchase a JumpPermit for permanent use. Each gate jump consumes one permit.
      </p>

      {gateId && (
        <section style={{ marginBottom: '20px' }}>
          {dataLoading ? (
            <p style={{ fontSize: '0.82rem', color: '#6a8a9a' }}>Loading…</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <tbody>
                <tr style={{ borderBottom: '1px solid #1e3040' }}>
                  <td style={{ padding: '6px 8px', color: '#6a8a9a', width: '180px' }}>Source Gate</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'monospace', wordBreak: 'break-all', fontSize: '0.75rem' }}>
                    {gateName && <span style={{ color: '#c9e8ff', marginRight: '8px' }}>{gateName}</span>}
                    {gateId}
                  </td>
                </tr>
                <tr style={{ borderBottom: '1px solid #1e3040' }}>
                  <td style={{ padding: '6px 8px', color: '#6a8a9a' }}>Destination Gate</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'monospace', wordBreak: 'break-all', fontSize: '0.75rem' }}>{linkedGateId || '(not linked)'}</td>
                </tr>
                <tr style={{ borderBottom: '1px solid #1e3040' }}>
                  <td style={{ padding: '6px 8px', color: '#6a8a9a' }}>Toll Fee</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: '#c9e8ff' }}>{balanceToEve(toll)}</td>
                </tr>
                <tr style={{ borderBottom: '1px solid #1e3040' }}>
                  <td style={{ padding: '6px 8px', color: '#6a8a9a' }}>Your EVE Balance</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: eveBalance >= toll ? '#4a9a7a' : '#c0392b' }}>{balanceToEve(eveBalance)}</td>
                </tr>
                <tr style={{ borderBottom: '1px solid #1e3040' }}>
                  <td style={{ padding: '6px 8px', color: '#6a8a9a' }}>Permits Held</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{permitCount ?? '—'}</td>
                </tr>
              </tbody>
            </table>
          )}
        </section>
      )}

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <button
          className="primary"
          onClick={handleBuy}
          disabled={loading || !canBuy}
        >
          {loading ? 'Submitting…' : 'Buy Permit'}
        </button>
        <button
          className="primary"
          onClick={handleBuyTen}
          disabled={loading || !canBuy || eveBalance < toll * BigInt(10)}
        >
          {loading ? 'Submitting…' : 'Buy Permit x10'}
        </button>
      </div>

      {isGateInFoundation === false && (
        <div style={{ marginTop: '12px', fontSize: '0.82rem', color: '#9a7a4a', border: '1px solid #4a3a1e', padding: '10px 14px', lineHeight: '1.6' }}>
          This gate is not part of the Silk Road Protocol — permits cannot be purchased here.
          {gateCapId && (
            <span> If you own this gate, you can submit it via the <strong>Contributor</strong> page to join the network and start earning rewards.</span>
          )}
        </div>
      )}

      {status && <div className={`status ${status.type}`}>{status.msg}</div>}
    </div>
  );
}



