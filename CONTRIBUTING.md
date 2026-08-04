# Contributing to Quarry

Quarry is a personal portfolio project. PRs from outside contributors are
welcome but the scope is tight — read this first to avoid wasted work.

## Project scope

Quarry is a **hybrid MEV arbitrage engine**: an off-chain TypeScript scanner
that watches the public mempool and an on-chain Yul execution contract that
atomically captures cross-DEX arbitrage opportunities. The engineering thesis
is that **gas is the binding economic constraint** in competitive MEV — every
opcode shaved off the on-chain leg widens the marginal profit envelope.

### In scope

- Mempool ingestion via WebSocket (Alchemy / Infura / local Reth)
- ABI decoding of Uniswap v2 / v3 swap calldata
- Constant-product AMM math for optimal arbitrage sizing
- Flashbots bundle assembly and simulation
- Yul contract for atomic front-run + back-run execution
- Foundry tests that fork mainnet via anvil and replay historical opportunities

### Out of scope

- **JIT liquidity, sandwich attacks on retail users, or any strategy that
  extracts value from individual victims.** Quarry targets *cross-DEX
  arbitrage* — closing price discrepancies the market would close anyway.
  This is the kind of MEV that's broadly considered net-positive for
  on-chain price efficiency. Anything predatory is a hard no.
- Cross-chain MEV (LayerZero, Wormhole). One chain at a time.
- Solana or non-EVM chains.
- Production deployment with real capital. Quarry is a *simulator*, run
  against forked mainnet state. No mainnet broadcasts.

## Dev setup

Prerequisites:

- macOS or Linux
- Foundry (`brew install foundry` on macOS; otherwise `foundryup`)
- Bun ≥ 1.3 (`brew install oven-sh/bun/bun`)
- Node ≥ 22 (only for `pnpm`-installed dev deps; runtime is Bun)

```bash
git clone <repo-url>
cd Quarry
cp .env.example .env   # then fill in MAINNET_RPC_URL for fork tests

# On-chain side
cd contracts
forge install
forge build
forge test -vvv                                   # mock tests only

# Fork tests against real Uniswap V2 + Sushiswap pools (needs MAINNET_RPC_URL)
export $(cat ../.env | xargs)
forge test --match-contract ExecutorForkTest -vvv

# Off-chain side
cd ../bot
bun install
bun run typecheck
```text

The mock test suite (`ExecutorTest`) runs in milliseconds without any RPC
config and is what CI gates on. The fork suite (`ExecutorForkTest`) skips
itself when `MAINNET_RPC_URL` is empty, so leaving it unset is fine for the
fast inner loop. Wire up the RPC env var when you want the real-pool gas
numbers or to validate the calldata layout against unmocked Uniswap V2
bytecode.

## Build and test

| Command | What it does |
| --- | --- |
| `forge build` (in `contracts/`) | Compiles Solidity + Yul, emits artifacts to `out/` |
| `forge test -vvv` | Runs Solidity tests against the Yul contract; `-vvv` shows traces |
| `forge test --gas-report` | Emits a per-function gas snapshot — gate against regression |
| `forge snapshot` | Writes `.gas-snapshot` checked into git |
| `bun run typecheck` (in `bot/`) | Strict TS typecheck, no emit |
| `bun test` | Runs the scanner unit tests |
| `bun run scanner` | Starts the WebSocket mempool scanner |

## Performance non-negotiables

- **Executor gas budget — two complementary guards:**
  - *Mock path (CI-enforced).* The full two-hop swap through mocked pools must
    stay under **100,000 gas** — `Executor.t.sol::test_GasCeiling_TwoHop_WithMocks`,
    currently **~84.5k** (see `.gas-snapshot`). This is the gate every PR must
    keep green. The executor's own Yul body is only ~6k of it; the rest is the
    mocks' swap accounting.
  - *Real-pool path (fork test).* `ExecutorFork.t.sol::test_TwoHopRoundTrip_AgainstRealPools`
    runs the same path against live Uniswap V2 + Sushiswap WETH/USDC pools,
    whose own `swap()` gas dominates and is unavoidable. **Must stay under
    130,000 gas** — measured baseline **110,957 (~111k)** on 2026-06-13
    (mainnet fork at HEAD), so the ceiling carries ~17% headroom for
    block-to-block reserve variance. It's skipped unless `MAINNET_RPC_URL` is
    set, so it's not part of the default CI gate; re-measure / re-run with:

    ```bash
    cd contracts
    MAINNET_RPC_URL=https://ethereum-rpc.publicnode.com \
      forge test --match-test test_TwoHopRoundTrip_AgainstRealPools -vvv
    ```

    (any mainnet RPC works — the test forks at HEAD, no archive node needed;
    it logs `gas: real-pool two-hop`). Wire `MAINNET_RPC_URL` as a CI secret to
    enforce this ceiling on every push.

  Any PR that pushes either guard needs justification and a corresponding
  reduction elsewhere.
- The scanner's mempool-tx-to-opportunity-decision latency must stay under
  20 ms at the p99 (measured on a 1-hour mainnet sample). Cross-DEX math
  hot path may not allocate.

## Commit conventions

- Imperative mood, present tense ("add Yul revert guard", not "added").
- Prefix with the area touched: `yul:`, `scanner:`, `flashbots:`, `infra:`,
  `docs:`, `journal:`.
- One logical change per commit. If a commit touches both `contracts/`
  and `bot/`, the description should explain the cross-cut.

## PR process

1. Branch from `main`. Branch names: `area/short-description`.
2. PR title matches the would-be merge commit message.
3. PR body has a **Why** section (one paragraph) and a **What changed**
   section (bullet list). No emoji headers, no AI-slop checklists.
4. CI must be green. Gas snapshot diffs must be acknowledged in the PR.
5. Squash-merge to `main`.

## What I'll close without merging

- Solidity rewrites of the Yul contract "for readability." The whole point
  is the Yul.
- Dependency-bump PRs from automation accounts.
- PRs that touch `JOURNAL.md` — that's mine.
- Strategies that target retail (see "out of scope" above).
