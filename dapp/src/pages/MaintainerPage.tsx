import ClaimUptimeReward from './ClaimUptimeReward';
import BringGateOnline from './BringGateOnline';

export default function MaintainerPage() {
  return (
    <div>
      <h2 style={{ marginBottom: '4px' }}>Maintainer</h2>
      <p style={{ fontSize: '0.82rem', color: '#6a8a9a', marginBottom: '28px' }}>
        Monitor your gate's operational status, reactivate it when offline, and collect uptime rewards.
      </p>

      <section style={{ marginBottom: '40px' }}>
        <h3 style={{ fontSize: '0.95rem', color: '#7eb8d4', borderBottom: '1px solid #1e3040', paddingBottom: '6px', marginBottom: '16px' }}>
          Uptime Reward
        </h3>
        <ClaimUptimeReward />
      </section>

      <section>
        <h3 style={{ fontSize: '0.95rem', color: '#7eb8d4', borderBottom: '1px solid #1e3040', paddingBottom: '6px', marginBottom: '16px' }}>
          Gate Status &amp; Reactivation
        </h3>
        <BringGateOnline />
      </section>

    </div>
  );
}
