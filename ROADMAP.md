# Quarry Roadmap

Next steps and architectural milestones for the Quarry MEV arbitrage engine and Yul executor.

## v0.2 — Multi-Hop & Transaction Expansion

- **3-Hop Triangular Arbitrage**: Pure Yul execution routing for 3-hop triangular arbitrage cycles (e.g. WETH → USDC → DAI → WETH).
- **ETH-Side Transaction Decoding**: Decode `swapExactETHForTokens` and plumb `tx.value` through to the candidate scoring solver.
- **Multi-Hop Path Expansion**: Expand the transaction decoder to traverse arbitrary swap path lengths beyond the initial hop.

## v1.0 — Flashloans & Builder Relay Integration

- **Direct Flashloan Integration**: Native Aave V3 and Balancer V2 flashloan calls in bundle position 0.
- **Multi-Token Base Routing**: Dynamic WETH/baseToken reserve queries for non-WETH base pair opportunities.
- **Live Flashbots / MEV-Share Relay Pipeline**: Production-ready bundle submission targeting Ethereum block builders and MEV-Share.

## Out of Scope

Per [CONTRIBUTING.md](CONTRIBUTING.md), Quarry explicitly does not aim to:

- Execute sandwich attacks or JIT liquidity extraction against retail traders (strictly non-predatory cross-DEX price balancing).
- Support centralized exchange (CEX-DEX) arbitrage requiring custodial balances.
- Run speculative directional trading strategies.

---

For technical specifications and gas benchmarks, see [`docs/MEV_ENGINEERING.md`](docs/MEV_ENGINEERING.md).
