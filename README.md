# Silk Road Protocol

A decentralised gate network protocol for the [EVE Frontier](https://evefrontier.com), deployed on **Sui** (testnet_utopia).

Players contribute Smart Gates to a shared foundation treasury, earn **SRP_Share** tokens, collect uptime rewards, and receive dividends from transit revenue.

Built for the EVE Frontier Hackathon.

## How It Works

1. **Contribute a gate** — Lock your GateCap into the FoundationTreasury via `assimilate_gate`. Receive SRP_Share tokens proportional to your contribution.
2. **Keep it online** — Maintain fuel in your Network Node. Earn continuous uptime rewards while the gate is live.
3. **Transit revenue** — Other players pay EVE tolls to use the network. Revenue is split: 75% → SRP_Share dividend pool, 25% → uptime reward pool.
4. **Claim rewards** — Call `claim_uptime_reward` (anyone can trigger on your behalf) or `claim_dividend` to withdraw accrued EVE.

## Key Design Decisions

- **GateCap is permanently locked** in the treasury — prevents contributors from selling or manually offlining their gate to game the reward system.
- **SilkRoadAuth typed witness** — the extension config is frozen at assimilation; the gate's jump permit authority can never be revoked.
- **MasterChef dividend algorithm** — new SRP_Share holders only claim dividends earned after their contribution.
- **Keeper-friendly** — `claim_uptime_reward` and `bring_gate_online` can be called by anyone; payouts always go to the registered contributor.

## Repository Structure

```
contract/          Sui Move smart contract
  sources/         silk_road.move — main protocol module
  world-contracts/ Vendored EVE Frontier world package (local dependency)

dapp/              React/Vite frontend dApp
  src/             Source code
```

## Contract (testnet_utopia)

| | |
|---|---|
| Package | `0x5e9b4582d440403ad7a6de9ac1ffad9d155ef926d371602537cd163c27cb6f3c` |
| FoundationTreasury | `0x37dc73e19be7da77ed7c8503d4b75107249bae29da55f100571598f4b48b6166` |
| Chain | Sui testnet (`4c78adac`) |

## Build & Run

### Contract

```bash
cd contract
sui move build
sui move test
sui client publish
```

### dApp

```bash
cd dapp
pnpm install
pnpm dev        # dev server on :5173
pnpm build      # production build
```
