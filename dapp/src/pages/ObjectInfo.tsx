import { useState, useEffect } from 'react';
import { rpcClient } from '../lib/rpcClient';
import { useSmartGate } from '../context/SmartGateContext';

interface FieldRow {
  label: string;
  value: string;
}

function toStr(v: any): string {
  if (v === null || v === undefined) return '(none)';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v, null, 2);
}

// Unwrap a Move struct field that may be either flat (gRPC json) or wrapped in {fields:...} (JSON-RPC).
function unwrap(v: any): any {
  return v?.fields ?? v;
}

function extractFields(obj: any): FieldRow[] {
  // obj is the full Object from the SDK response (has objectId, owner, json, ...)
  const fields = obj?.json;
  if (!fields) return [];
  const rows: FieldRow[] = [];

  // Object ID — prefer top-level objectId, fall back to json.id.id
  rows.push({ label: 'id', value: obj.objectId ?? unwrap(fields.id)?.id ?? '?' });

  // Name from metadata (handle both flat and wrapped shapes)
  const meta = unwrap(fields.metadata);
  const metaName = meta?.name ?? unwrap(meta?.some)?.name;
  if (metaName !== undefined) rows.push({ label: 'name', value: metaName || '(empty)' });

  // In-game key
  const key = unwrap(fields.key);
  if (key?.tenant !== undefined) rows.push({ label: 'game key', value: `${key.tenant} / ${key.item_id}` });

  // type_id
  if (fields.type_id !== undefined) rows.push({ label: 'type_id', value: String(fields.type_id) });

  // owner_cap_id
  if (fields.owner_cap_id) rows.push({ label: 'owner_cap_id', value: fields.owner_cap_id });

  // Status
  const statusInner = unwrap(unwrap(fields.status)?.status);
  if (statusInner?.variant ?? statusInner?.$kind)
    rows.push({ label: 'status', value: statusInner.variant ?? statusInner.$kind });

  // Gate: linked_gate_id, energy_source_id
  if ('linked_gate_id' in fields) {
    const v = fields.linked_gate_id;
    rows.push({ label: 'linked_gate_id', value: typeof v === 'string' ? v : (unwrap(v)?.id ?? '(none)') });
  }
  if ('energy_source_id' in fields) {
    const v = fields.energy_source_id;
    rows.push({ label: 'energy_source_id', value: typeof v === 'string' ? v : (unwrap(v)?.id ?? '(none)') });
  }

  // NetworkNode: connected assemblies
  if (fields.connected_assembly_ids) {
    const ids: string[] = fields.connected_assembly_ids;
    rows.push({ label: 'connected_assemblies', value: ids.length ? ids.join('\n') : '(none)' });
  }

  // NetworkNode: fuel
  const fuel = unwrap(fields.fuel);
  if (fuel?.quantity !== undefined) {
    rows.push({ label: 'fuel', value: `${fuel.quantity} / ${fuel.max_capacity} (burn ${fuel.burn_rate_in_ms}ms/unit)` });
    rows.push({ label: 'fuel burning', value: String(fuel.is_burning) });
  }

  // NetworkNode: energy
  const energy = unwrap(fields.energy_source);
  if (energy?.current_energy_production !== undefined) {
    rows.push({ label: 'energy_production', value: `${energy.current_energy_production} / ${energy.max_energy_production}` });
    rows.push({ label: 'reserved_energy', value: String(energy.total_reserved_energy) });
  }

  return rows;
}

export default function ObjectInfo() {
  const { gateId, nodeId, gateCapId } = useSmartGate();

  const [gateData,    setGateData]    = useState<FieldRow[] | null>(null);
  const [nodeData,    setNodeData]    = useState<FieldRow[] | null>(null);
  const [gateCapData, setGateCapData] = useState<FieldRow[] | null>(null);
  const [gateOwner,   setGateOwner]   = useState<string>('');
  const [nodeOwner,   setNodeOwner]   = useState<string>('');
  const [error,       setError]       = useState<string>('');
  const [loading,     setLoading]     = useState(false);

  useEffect(() => {
    if (gateId) fetchAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateId, nodeId, gateCapId]);

  async function fetchAll() {
    setLoading(true);
    setError('');
    try {
      const opts = { include: { json: true } };
      const [gateRes, nodeRes, capRes] = await Promise.all([
        rpcClient.getObject({ objectId: gateId,    ...opts }),
        rpcClient.getObject({ objectId: nodeId,    ...opts }),
        rpcClient.getObject({ objectId: gateCapId, ...opts }),
      ]);

      setGateData(extractFields(gateRes.object));
      setNodeData(extractFields(nodeRes.object));
      setGateCapData(extractFields(capRes.object));

      const ownerStr = (res: any) => {
        const o = res.object?.owner;
        if (!o) return '(unknown)';
        if (o.AddressOwner) return o.AddressOwner;
        if (o.ObjectOwner)  return o.ObjectOwner;
        if (o.Shared || o.$kind === 'Shared') return 'Shared';
        return JSON.stringify(o);
      };
      setGateOwner(ownerStr(gateRes));
      setNodeOwner(ownerStr(nodeRes));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {loading && <p style={{ fontSize: '0.82rem', color: '#6a8a9a', marginBottom: '12px' }}>Loading…</p>}
      {error && <div className="status err" style={{ marginBottom: '12px' }}>{error}</div>}

      {gateData && (
        <section style={{ marginTop: '24px' }}>
          <h3>Gate</h3>
          <p style={{ fontSize: '0.78rem', color: '#6a8a9a' }}>Owner: {gateOwner}</p>
          <InfoTable rows={gateData} />
        </section>
      )}

      {nodeData && (
        <section style={{ marginTop: '24px' }}>
          <h3>NetworkNode</h3>
          <p style={{ fontSize: '0.78rem', color: '#6a8a9a' }}>Owner: {nodeOwner}</p>
          <InfoTable rows={nodeData} />
        </section>
      )}

      {gateCapData && (
        <section style={{ marginTop: '24px' }}>
          <h3>GateCap (OwnerCap&lt;Gate&gt;)</h3>
          <InfoTable rows={gateCapData} />
        </section>
      )}
    </div>
  );
}

function InfoTable({ rows }: { rows: FieldRow[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
      <tbody>
        {rows.map(r => (
          <tr key={r.label} style={{ borderBottom: '1px solid #1e3040' }}>
            <td style={{ padding: '6px 8px', color: '#6a8a9a', whiteSpace: 'nowrap', width: '180px' }}>{r.label}</td>
            <td style={{ padding: '6px 8px', wordBreak: 'break-all', fontFamily: 'monospace' }}>{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
