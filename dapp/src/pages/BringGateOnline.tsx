import { useState, useEffect } from 'react';
import { useConnection } from '@evefrontier/dapp-kit';
import { useDAppKit } from '@mysten/dapp-kit-react';
import { rpcClient, suiClient } from '../lib/rpcClient';
import { Transaction } from '@mysten/sui/transactions';
import {
  SILK_ROAD_PACKAGE_ID,
  CHARACTER_PACKAGE_ID,
  FOUNDATION_TREASURY_ID,
  ENERGY_CONFIG_ID,
} from '../constants';
import { useSmartGate } from '../context/SmartGateContext';

interface NodeStatus {
  nodeOnline:       boolean;
  gateOnline:       boolean;
  fuelQty:          number;
  fuelMax:          number;
  fuelBurnRate:     number;
  fuelBurning:      boolean;
  energyProduction: number;
  maxEnergy:        number;
}

export default function BringGateOnline() {
  const { walletAddress } = useConnection();
  const { signAndExecuteTransaction } = useDAppKit();
  const { gateId, nodeId, gateName, gateState } = useSmartGate();

  const [nodeStatus, setNodeStatus] = useState<NodeStatus | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [loading,     setLoading]     = useState(false);
  const [status,      setStatus]      = useState<{ type: 'ok'|'err'|'info'; msg: string } | null>(null);

  useEffect(() => {
    if (!gateId || !nodeId) { setDataLoading(false); return; }
    fetchStatus();
    const id = setInterval(fetchStatus, 15000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateId, nodeId]);

  async function fetchStatus() {
    try {
      const [gateRes, nodeRes] = await Promise.all([
        rpcClient.getObject({ objectId: gateId, include: { json: true } }),
        rpcClient.getObject({ objectId: nodeId, include: { json: true } }),
      ]);

      const gf = gateRes?.object?.json ?? {};
      const nf = nodeRes?.object?.json ?? {};

      // Gate online: status.status variant
      const rawGateStatus = gf?.status?.status;
      const gateStatusKind: string =
        rawGateStatus?.['@variant'] ??
        rawGateStatus?.variant ??
        rawGateStatus?.$kind ??
        (typeof rawGateStatus === 'string' ? rawGateStatus : '') ?? '';
      const gateOnline = gateStatusKind.toUpperCase() === 'ONLINE' || gateState === 'online';

      // Node fields
      const fuel    = nf?.fuel?.fields ?? nf?.fuel ?? {};
      const energy  = nf?.energy_source?.fields ?? nf?.energy_source ?? {};
      const rawNodeStatus = nf?.status?.status;
      const nodeStatusKind: string =
        rawNodeStatus?.['@variant'] ??
        rawNodeStatus?.variant ??
        rawNodeStatus?.$kind ??
        (typeof rawNodeStatus === 'string' ? rawNodeStatus : '') ?? '';
      const nodeOnline = nodeStatusKind.toUpperCase() === 'ONLINE';

      setNodeStatus({
        nodeOnline,
        gateOnline,
        fuelQty:          Number(fuel?.quantity ?? 0),
        fuelMax:          (() => {
          const cap = Number(fuel?.max_capacity ?? 0);
          const vol = Number(fuel?.unit_volume ?? 0);
          return vol > 0 ? Math.floor(cap / vol) : cap;
        })(),
        fuelBurnRate:     Number(fuel?.burn_rate_in_ms ?? 0),
        fuelBurning:      Boolean(fuel?.is_burning),
        energyProduction: Number(energy?.current_energy_production ?? 0),
        maxEnergy:        Number(energy?.max_energy_production ?? 0),
      });
    } catch (e: any) {
      console.error('[GateMonitor] fetchStatus:', e);
    } finally {
      setDataLoading(false);
    }
  }

  async function handleBringOnline() {
    if (!walletAddress) { setStatus({ type: 'err', msg: 'Wallet not connected.' }); return; }
    if (!gateId || !nodeId) { setStatus({ type: 'err', msg: 'Gate or Node ID not detected.' }); return; }
    setLoading(true);
    setStatus({ type: 'info', msg: 'Looking up GateCap in treasury…' });
    try {
      const ownedRes = await suiClient.getOwnedObjects({
        owner: FOUNDATION_TREASURY_ID,
        filter: { StructType: `${CHARACTER_PACKAGE_ID}::access::OwnerCap<${CHARACTER_PACKAGE_ID}::gate::Gate>` },
        options: { showContent: true },
      });
      const caps: any[] = (ownedRes as any)?.data ?? [];
      const match = caps.find(
        (item: any) => item?.data?.content?.fields?.authorized_object_id === gateId,
      );
      if (!match?.data) throw new Error('No GateCap found in treasury for this gate.');

      const tx = new Transaction();
      tx.moveCall({
        target: `${SILK_ROAD_PACKAGE_ID}::silk_road::bring_gate_online`,
        arguments: [
          tx.object(FOUNDATION_TREASURY_ID),
          tx.object(gateId),
          tx.object(nodeId),
          tx.object(ENERGY_CONFIG_ID),
          tx.receivingRef({
            objectId: match.data.objectId,
            version:  String(match.data.version),
            digest:   match.data.digest,
          }),
          tx.object('0x0000000000000000000000000000000000000000000000000000000000000006'),
        ],
      });
      setStatus({ type: 'info', msg: 'Waiting for wallet signature…' });
      const result = await signAndExecuteTransaction({ transaction: tx });
      setStatus({ type: 'ok', msg: `Gate brought online! Digest: ${result.Transaction?.digest}` });
      setTimeout(fetchStatus, 2000);
      setTimeout(fetchStatus, 5000);
      setTimeout(fetchStatus, 10000);
    } catch (e: any) {
      setStatus({ type: 'err', msg: e?.message ?? String(e) });
    } finally {
      setLoading(false);
    }
  }

  const fuelPct = nodeStatus && nodeStatus.fuelMax > 0
    ? Math.round(nodeStatus.fuelQty / nodeStatus.fuelMax * 100)
    : 0;

  const onlineStyle = (online: boolean) => ({
    color: online ? '#4a9a7a' : '#c0392b',
    fontFamily: 'monospace' as const,
  });

  return (
    <div>
      <p style={{ fontSize: '0.82rem', color: '#6a8a9a', marginBottom: '20px' }}>
        View your gate's current operational status and reactivate it if it has gone offline.
      </p>

      {gateId && dataLoading && (
        <p style={{ fontSize: '0.82rem', color: '#6a8a9a' }}>Loading…</p>
      )}

      {gateId && !dataLoading && nodeStatus && (
        <section style={{ marginBottom: '20px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <tbody>
              <tr style={{ borderBottom: '1px solid #1e3040' }}>
                <td style={{ padding: '6px 8px', color: '#6a8a9a', width: '200px' }}>Gate</td>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace', wordBreak: 'break-all', fontSize: '0.75rem' }}>
                  {gateName && <span style={{ color: '#c9e8ff', marginRight: '8px' }}>{gateName}</span>}
                  {gateId}
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid #1e3040' }}>
                <td style={{ padding: '6px 8px', color: '#6a8a9a' }}>Gate Status</td>
                <td style={{ padding: '6px 8px', ...onlineStyle(nodeStatus.gateOnline) }}>
                  {nodeStatus.gateOnline ? 'Online' : 'Offline'}
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid #1e3040' }}>
                <td style={{ padding: '6px 8px', color: '#6a8a9a' }}>Network Node</td>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace', wordBreak: 'break-all', fontSize: '0.75rem' }}>{nodeId}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #1e3040' }}>
                <td style={{ padding: '6px 8px', color: '#6a8a9a' }}>Node Status</td>
                <td style={{ padding: '6px 8px', ...onlineStyle(nodeStatus.nodeOnline) }}>
                  {nodeStatus.nodeOnline ? 'Online' : 'Offline'}
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid #1e3040' }}>
                <td style={{ padding: '6px 8px', color: '#6a8a9a' }}>Fuel</td>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>
                  {nodeStatus.fuelQty.toLocaleString()} / {nodeStatus.fuelMax.toLocaleString()} ({fuelPct}%)
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid #1e3040' }}>
                <td style={{ padding: '6px 8px', color: '#6a8a9a' }}>Fuel Burning</td>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: nodeStatus.fuelBurning ? '#4a9a7a' : '#6a8a9a' }}>
                  {nodeStatus.fuelBurning ? 'Yes' : 'No'}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      {gateId && !dataLoading && (
        <button
          className="primary"
          onClick={handleBringOnline}
          disabled={loading || !walletAddress || nodeStatus?.gateOnline === true}
        >
          {loading ? 'Processing…' : 'Reactivate Gate'}
        </button>
      )}

      {status && <div className={`status ${status.type}`}>{status.msg}</div>}
    </div>
  );
}



