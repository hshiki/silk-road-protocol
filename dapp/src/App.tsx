import { useState, useEffect } from 'react';
import { useSmartObject, useConnection } from '@evefrontier/dapp-kit';
import { SmartGateContext } from './context/SmartGateContext';
import TreasuryDashboard from './pages/TreasuryDashboard';
import BuyTransitPermit from './pages/BuyTransitPermit';
import ContributorPage from './pages/ContributorPage';
import MaintainerPage from './pages/MaintainerPage';
import TreasuryBanner from './components/TreasuryBanner';
import ObjectInfo from './pages/ObjectInfo';
import { suiClient } from './lib/rpcClient';

type Page = 'treasury' | 'traveler' | 'contributor' | 'maintainer';

const PAGES: { id: Page; label: string }[] = [
  { id: 'treasury',    label: 'Treasury' },
  { id: 'traveler',    label: 'Traveler' },
  { id: 'contributor', label: 'Contributor' },
  { id: 'maintainer',  label: 'Maintainer' },
];
export default function App() {
  const [page, setPage] = useState<Page>('traveler');
  const { isConnected, walletAddress, handleConnect, handleDisconnect } = useConnection();
  const { assembly, loading, error } = useSmartObject();
  const [gateCapId, setGateCapId] = useState('');
  const [showObjectInfo, setShowObjectInfo] = useState(false);

  const gateId       = assembly?.id ?? '';
  const nodeId       = (assembly as any)?.energySourceId ?? '';
  const gateName     = assembly?.name ?? '';
  const gateState    = assembly?.state ?? '';
  const linkedGateId = (assembly as any)?.gate?.destinationId ?? '';

  // Read owner_cap_id directly from the Gate object's fields.
  useEffect(() => {
    if (!gateId) { setGateCapId(''); return; }
    suiClient.getObject({ objectId: gateId, options: { showContent: true } })
      .then((res: any) => {
        const fields = res?.data?.content?.fields ?? res?.data?.content?.json ?? {};
        setGateCapId(fields.owner_cap_id ?? '');
      })
      .catch((e: any) => { console.error('[GateCap]', e); setGateCapId(''); });
  }, [gateId]);

  return (
    <SmartGateContext.Provider value={{ gateId, nodeId, gateName, gateState, gateCapId, linkedGateId, loading, error: error ?? null }}>
      <div className="app">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <h1 style={{ margin: 0 }}>Silk Road Protocol</h1>
            <p className="subtitle" style={{ margin: '4px 0 2px' }}>EVE Frontier — Decentralised Gate Network Protocol</p>
            {gateId && (
              <p style={{ fontSize: '0.78rem', color: '#6a8a9a', margin: 0 }}>
                {gateName || gateId.slice(0, 8) + '…'}
                {' · '}
                <span style={{ color: gateState === 'online' ? '#4a9a7a' : '#c0392b' }}>{gateState}</span>
              </p>
            )}
          </div>
          <button
            onClick={() => setShowObjectInfo(v => !v)}
            style={{ background: 'transparent', border: '1px solid #2e4e6e', color: '#7eb8d4', cursor: 'pointer', fontSize: '0.85rem', padding: '6px 14px', fontFamily: 'inherit', marginTop: '4px', flexShrink: 0 }}
          >
            Object Info
          </button>
        </div>

        <TreasuryBanner />

        <nav style={{ justifyContent: 'flex-start', alignItems: 'center' }}>
          {PAGES.map(p => (
            <button
              key={p.id}
              className={page === p.id ? 'active' : ''}
              onClick={() => setPage(p.id)}
            >
              {p.label}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isConnected ? (
              <>
                <span style={{ fontSize: '0.85rem', fontFamily: 'inherit', color: '#7eb8d4' }}>
                  {walletAddress ? walletAddress.slice(0, 6) + '…' + walletAddress.slice(-4) : ''}
                </span>
                <button className="disconnect" onClick={handleDisconnect}>Disconnect</button>
              </>
            ) : (
              <button className="primary" style={{ padding: '4px 12px', fontSize: '0.78rem' }} onClick={handleConnect}>Connect Wallet</button>
            )}
          </div>
        </nav>

        <div className="page">
          {page === 'treasury'    && <TreasuryDashboard />}
          {page === 'traveler'    && <BuyTransitPermit />}
          {page === 'contributor' && <ContributorPage />}
          {page === 'maintainer'  && <MaintainerPage />}
        </div>

        {showObjectInfo && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 100, overflowY: 'auto', padding: '40px 16px' }} onClick={() => setShowObjectInfo(false)}>
            <div style={{ background: '#0a0a0f', border: '1px solid #2e4e6e', padding: '24px', width: '100%', maxWidth: '760px' }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ margin: 0, color: '#7eb8d4', fontSize: '0.95rem' }}>Object Info</h3>
                <button onClick={() => setShowObjectInfo(false)} style={{ background: 'none', border: 'none', color: '#6a8a9a', cursor: 'pointer', fontSize: '1rem', fontFamily: 'monospace' }}>✕</button>
              </div>
              <ObjectInfo />
            </div>
          </div>
        )}
      </div>
    </SmartGateContext.Provider>
  );
}


