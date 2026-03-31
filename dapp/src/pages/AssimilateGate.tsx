import { useState } from 'react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { Transaction } from '@mysten/sui/transactions';
import {
  SILK_ROAD_PACKAGE_ID,
  FOUNDATION_TREASURY_ID,
  CLOCK_ID,
} from '../constants';
import { useSmartGate } from '../context/SmartGateContext';
import { suiClient } from '../lib/rpcClient';

export default function AssimilateGate({ isAssimilated }: { isAssimilated?: boolean }) {
  const isConnected = !!useCurrentAccount();
  const { signAndExecuteTransaction } = useDAppKit();
  const { gateId, gateCapId, linkedGateId } = useSmartGate();

  const [status,      setStatus]      = useState<{ type: 'ok'|'err'|'info'; msg: string } | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  function handleClickSubmit() {
    if (!isConnected) { setStatus({ type: 'err', msg: 'Wallet not connected.' }); return; }
    if (!gateId)      { setStatus({ type: 'err', msg: 'Gate ID not detected. Open this dapp from the game client.' }); return; }
    if (!gateCapId)   { setStatus({ type: 'err', msg: 'GateCap not found in your character for this gate.' }); return; }
    if (!linkedGateId) { setStatus({ type: 'err', msg: 'Gate is not linked to a destination. Link both ends before submitting.' }); return; }
    setShowConfirm(true);
  }

  async function handleSubmit() {
    setShowConfirm(false);
    if (!isConnected) { setStatus({ type: 'err', msg: 'Wallet not connected.' }); return; }
    if (!gateId)      { setStatus({ type: 'err', msg: 'Gate ID not detected. Open this dapp from the game client.' }); return; }
    if (!gateCapId)   { setStatus({ type: 'err', msg: 'GateCap not found in your character for this gate.' }); return; }
    setLoading(true);
    setStatus({ type: 'info', msg: 'Fetching GateCap object reference…' });
    try {
      // Fetch the GateCap object to get its version/digest (for receivingRef)
      // and its owner — the owner IS the Character's Sui Object ID.
      const capObj = await suiClient.getObject({ objectId: gateCapId, options: { showOwner: true } });
      const capRef = capObj?.data;
      if (!capRef?.objectId) throw new Error('Could not fetch GateCap object. Has it already been assimilated?');

      // GateCap is owned by the Character shared object, not the wallet directly.
      const owner = (capRef as any).owner;
      const characterObjectId: string =
        owner?.ObjectOwner ?? owner?.AddressOwner ?? owner?.object_id ?? owner;
      if (!characterObjectId || typeof characterObjectId !== 'string')
        throw new Error('Could not determine Character object ID from GateCap owner: ' + JSON.stringify(owner));

      const tx = new Transaction();
      tx.moveCall({
        target: `${SILK_ROAD_PACKAGE_ID}::silk_road::assimilate_gate_from_character`,
        arguments: [
          tx.object(FOUNDATION_TREASURY_ID),
          tx.object(gateId),
          tx.object(characterObjectId),
          tx.receivingRef({
            objectId: capRef.objectId,
            version:  String(capRef.version),
            digest:   capRef.digest,
          }),
          tx.object(CLOCK_ID),
        ],
      });
      setStatus({ type: 'info', msg: 'Waiting for wallet signature…' });
      const result = await signAndExecuteTransaction({ transaction: tx });
      setStatus({ type: 'ok', msg: `Gate assimilated! SRP_Share minted. Digest: ${result?.digest ?? (result as any)?.Transaction?.digest}` });
    } catch (e: any) {
      setStatus({ type: 'err', msg: e?.message ?? String(e) });
    } finally {
      setLoading(false);
    }
  }
  return (
    <div>
      <p style={{ fontSize: '0.82rem', color: '#6a8a9a', marginBottom: '20px' }}>
        Lock your GateCap into the treasury via your Character. You will receive SRP_Share tokens in return.
        The gate must have a NetworkNode bound before calling this.
      </p>

      {!isAssimilated && (
        <>
          <div className="field">
            <label>Gate ID</label>
            <input value={gateId || 'Not detected'} readOnly style={{ color: '#6a8a9a' }} />
          </div>
          <div className="field">
            <label>GateCap (OwnerCap&lt;Gate&gt;)</label>
            <input value={gateCapId || (isConnected && gateId ? 'Searching…' : 'Connect wallet')} readOnly style={{ color: '#6a8a9a' }} />
          </div>
        </>
      )}

      <button
        className="primary"
        onClick={handleClickSubmit}
        disabled={loading || isAssimilated || !isConnected || !gateId || !gateCapId}
      >
        {loading ? 'Submitting…' : isAssimilated ? 'Gate Assimilated' : 'Submit Gate'}
      </button>

      {status && <div className={`status ${status.type}`}>{status.msg}</div>}

      {showConfirm && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
          onClick={() => setShowConfirm(false)}
        >
          <div
            style={{ background: '#0a0a0f', border: '1px solid #4a8ab4', padding: '28px 32px', maxWidth: '480px', width: '90%' }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ color: '#7eb8d4', fontSize: '1rem', marginBottom: '16px' }}>Gate Assimilation Agreement</h3>
            <div style={{ fontSize: '0.82rem', color: '#c8d8e8', lineHeight: '1.75', marginBottom: '20px' }}>
              <p style={{ marginBottom: '10px' }}>By submitting this gate, you agree to the following terms:</p>
              <ul style={{ paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '7px' }}>
                <li>Gate control (GateCap) is permanently transferred to the SRP Foundation Treasury and <strong>cannot be reclaimed</strong>.</li>
                <li>You will <strong>lose the ability</strong> to modify the gate's name, description, destination link, dApp link, or take it offline / dismantle it.</li>
                <li>Ensure <strong>both ends of the gate are linked</strong> before proceeding — this cannot be changed afterwards.</li>
                <li>The Foundation will rename this gate to <strong>SRP Gate</strong> as part of network unification.</li>
                <li>In return, you will <strong>immediately receive SRP_Share tokens</strong> and earn ongoing <strong>dividend payouts</strong> from transit revenue and <strong>uptime maintenance rewards</strong>.</li>
              </ul>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                style={{ background: 'transparent', border: '1px solid #2e4e6e', color: '#6a8a9a', padding: '6px 18px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.85rem' }}
                onClick={() => setShowConfirm(false)}
              >
                Cancel
              </button>
              <button className="primary" onClick={handleSubmit}>
                Confirm & Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


