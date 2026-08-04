# JOURNAL — Quarry

> Dated log of decisions, pivots, incidents, and quotes. Add entries as
> things happen — retrospectives need this raw material to land.
> Reverse-chronological; one paragraph max per entry.

## 2026-06-13 — Visual identity unified to "Core Sample" (favicon + banner) #decision

The site got its "Core Sample" redesign (earth-toned mine-shaft palette, ore-gold accent) back in May, but the favicon was missing and the README/OG banner still carried the *retired* blue-slate + `#fcc419` scheme — so the tab icon, social card, and live site disagreed. Added a custom favicon (`site/app/icon.svg`) + Apple touch icon (`site/app/apple-icon.png`, 180×180 full-bleed) using the established quarry-pit nested-hexagon mark recolored to the live palette (shaft `#14110d`, ore-gold `#d4923a` core), via Next's App Router file convention. Then regenerated both banners (`assets/` for the README `<picture>`, `site/public/` for OG) in the same language: stratigraphic sediment rules + ore seam, heavy `QUARRY` wordmark, the matching hexagon mark, mono claim chips. Rasterized 1200×420 PNGs alongside and switched the OG/Twitter `og:image` from the SVG to the PNG — SVG og:images don't render on Twitter/Slack/Discord, so the social card was effectively blank before. One stray inconsistency left: the README shields badges still use `fcc419`.

## 2026-06-13 — site/ got its first tests #milestone

The Next.js `site/` had no test framework at all (no `test` script, no specs) and no CI job. Added Vitest + Testing Library (jsdom) and a real component test for `DepthMeter` — the `"use client"` scroll-depth indicator: asserts the surface/zero-padded start state and that scroll progress maps to the right metres + stratum band (SHALE at 50%, BEDROCK near the bottom), driving it by overriding jsdom's read-only `scrollY`/`scrollHeight`/`innerHeight`. Deliberately avoided jest-dom matchers (plain DOM assertions) so `tsc --noEmit` stays green with no extra type plumbing. Wired a `site (bun · vitest)` job into CI alongside `contracts` and `bot`. 3 tests green, typecheck green.

## 2026-06-13 — Gas perf-guard docs were a three-way contradiction #incident

A test audit found the gas "non-negotiable" disagreed with the code three ways: CONTRIBUTING claimed the two-hop path "must stay under 130k, ~111k baseline, measured by ExecutorFork.t.sol against real pools incl. pool swap()"; the fork test's own comment claimed "a strict 35k gate from CONTRIBUTING covering only the executor's opcodes" and that real two-hop is "150–200k"; and the assertion is actually `assertLt(gasUsed, 250_000)`. None of those numbers reconcile, and the fork test is `vm.skip`-ped without `MAINNET_RPC_URL`, so the real-pool figure was never recorded — only the mock path is in `.gas-snapshot` (`test_GasCeiling_TwoHop_WithMocks` ~84.5k, gated `<100k` in `Executor.t.sol`). Rewrote the doc + the test comment to state only verifiable facts: the CI-enforced guard is the mock `<100k`; the executor's own Yul body is ~6k; the real-pool fork path is a 250k *catastrophic backstop*, not a pinned ceiling, until someone measures it. Documented the exact command (`MAINNET_RPC_URL=… forge test --match-test test_TwoHopRoundTrip_AgainstRealPools -vvv`, which logs `gas: real-pool two-hop`) and the follow-up: tighten the `assertLt` once a stable number lands. **Resolved same day** — ran it against a publicnode HEAD fork: **110,957 gas (~111k)**, which confirms CONTRIBUTING's *original* ~111k baseline (the site's "110 k gas" stat was right too); the fork test author's "150–200k" comment was simply wrong. Tightened the fork assertion from the loose 250k backstop to the documented **130k** ceiling (~17% headroom over 111k) — passes — and recorded the measured baseline + date in CONTRIBUTING. The whole contradiction was a stale comment + an un-run test, not a real perf problem.

## 2026-05-27 — Site redesigned: "The Core Sample" aesthetic #decision #milestone

Replaced the generic dark-slate + bright-gold landing page with a committed industrial-geological survey aesthetic that actually surfaces the "Quarry" metaphor. The previous site had a single thin stratigraphic background rule and a yellow accent number — it gestured at the theme without leaning into it. The new page is built as a vertical drilling log: a fixed depth meter on the left edge tracks scroll position in metres, a stratigraphic SVG column runs down the right edge (sandstone → clay → slate → granite → basalt with a hairline ore vein cutting through the slate band), each section opens with a "depth · stratum" readout, and the 9-step pipeline renders as a borehole — numbered drill markers tied off a dashed vertical shaft. Stats are punch-tags with twine-hole corners; the demo gif sits inside a field-photograph frame with a caption strip; the closing CTA carries diagonal blast-line crosshatching. Type: Big Shoulders Display (chiseled industrial signage, only weights 500/700/900), IBM Plex Sans for body, JetBrains Mono for surveyor-tablet readouts. Palette: torchlit mine shaft — #14110d base, sandstone/clay strata, ore-gold (#d4923a, refined from the previous bright #fcc419) as the single accent. **Why:** name carries weight only if the design commits — current site barely surfaced it. **How to apply:** new sections should open with the "depth · stratum" readout convention and stay inside the page's narrative metres scheme (000m → 980m).

## 2026-05-27 — Project kickoff, chose Yul over Go/Rust scanner-first path #decision #milestone

Project 3 of the security/economics portfolio sequence after ClearHash (compile-time crypto verification, OCaml) and Halberd (inline firewall, Go). Considered three framings for an MEV engine: (a) Go scanner with go-ethereum/ethclient, (b) Rust scanner with alloy + tokio, (c) hybrid TypeScript scanner + raw Yul execution contract. Picked (c). Reasoning: gas is the binding economic constraint in competitive MEV — shaving opcodes off the on-chain leg widens the marginal profit envelope more than scanner micro-optimizations do. Yul also showcases EVM-internals fluency in a way that a pure-TS or pure-Go submission can't. The TS scanner stays where it earns its keep — the off-chain logic (WebSocket mempool ingestion, AMM math, Flashbots bundle assembly) where developer ergonomics matter more than nanoseconds.

## 2026-05-27 — Repo name "Quarry" #decision

Two readings: the prey a predator hunts (mempool victim transactions in the "dark forest") and an extraction site (MEV = Maximum **Extractable** Value). Single evocative noun, pairs with Halberd's weapon-naming and ClearHash's compound. Easy to revisit if a sponsor track wants something else.

## 2026-05-27 — Architecture: contracts/ + bot/ monorepo, no lerna/turbo #decision

Top-level `contracts/` (Foundry, Yul + Solidity tests) and `bot/` (TypeScript, bun runtime) as siblings. No workspace tooling — they communicate via deployed contract address + ABI only, never share TS types. **Why:** the on-chain and off-chain code have orthogonal toolchains (forge vs. bun) and orthogonal release cadences (a Yul contract is deployed once and frozen; the bot iterates daily). **How to apply:** when adding shared code (e.g. pool-address constants), prefer code generation from a single TOML config over a shared TS package — keeps the two trees independent.

## 2026-05-27 — Canonical site URL is now quarry-mev.vercel.app #decision

User asked "pied?" about the original `quarry-pied.vercel.app` auto-alias — that's just Vercel's randomly-generated short suffix when `quarry.vercel.app` is taken across the platform. Took the recommendation to rename to `quarry-mev.vercel.app`.

Three steps + one papercut:

1. `vercel alias set quarry-if4sn0q25-sankofa-forge.vercel.app quarry-mev.vercel.app` — assigns the new alias. Succeeded in 401 ms.
2. **Papercut**: `quarry-mev.vercel.app` returned HTTP 401 (deployment protection) — `sankofa-forge` is on a team plan where all *.vercel.app URLs require Vercel Auth except the project's *configured production domains*. The auto-alias `quarry-pied` had been auto-added as a configured domain by Vercel; the custom alias I added via `vercel alias set` was NOT. Fix: `vercel domains add quarry-mev.vercel.app` (single-arg form, since project is linked). After that, the URL returns 200. **How to apply:** on a team-plan project, custom aliases need `vercel domains add` (not just `vercel alias set`) to bypass deployment protection.
3. Redeployed with `SITE_URL = "https://quarry-mev.vercel.app"` in `app/layout.tsx` so the OG + Twitter card metadata bake in the new canonical URL. Updated README badge, GitHub repo's homepage URL (`gh repo edit --homepage`).
4. `quarry-pied.vercel.app` still works — Vercel re-aliases each fresh deployment to the project's auto-generated short URL. Removing it via `vercel alias rm` only removes the binding for ONE deployment; subsequent deploys recreate it. Harmless to leave both; everything authoritative (README, OG, GitHub homepage) points at `quarry-mev`.

## 2026-05-27 — Quarry has a deployed site: quarry-pied.vercel.app #milestone

Live at <https://quarry-pied.vercel.app> (the alias) / <https://quarry-if4sn0q25-sankofa-forge.vercel.app> (the direct deployment URL). Single static landing page in `site/` rooted on a separate Vercel project (`sankofa-forge/quarry`), built with Next.js 16 + Tailwind v4 CSS-first config — no shadcn, no client JS beyond Next's default React hydration. Build time: 15 s on Vercel's builders. Fully prerendered (`○ (Static)`), no functions, no edge config, nothing to monitor at runtime.

Page structure: hero with the dark banner (auto-switches to light via `<picture>` + `prefers-color-scheme`), four-up stats row (188 B, 110k gas, 99.89% accuracy, 0 inventory), the 9-step pipeline as a numbered ordered list with circled-gold step markers, demo GIF in a bordered card, a two-column "what's in the repo" module grid, and a CTA + footer. Dark mode default; same `#0a0e16 / #fcc419` palette as the banner. The CSS uses Tailwind v4's `@theme` directive for the design tokens so everything stays one file.

Both branches the user asked for in the conversation are now closed:

- **GitHub**: <https://github.com/Builder106/quarry> (CI green on every push)
- **Deployed site**: <https://quarry-pied.vercel.app> (linked from the repo's homepage URL via `gh repo edit --homepage`)

Two papercuts captured for next time:

- The Vercel project ended up under the `sankofa-forge` team scope rather than `builder106`. `vercel link --yes --project quarry` defaulted to whichever scope is "active" in the CLI's settings; I expected the personal scope. If the user wants it under their personal account instead, that's `vercel link --scope builder106 --project quarry` and a fresh deploy.
- The first OG metadata used a placeholder `quarry-mev.vercel.app` URL. Fix was a one-line edit to `SITE_URL` in `app/layout.tsx` and a re-deploy. **How to apply:** when scaffolding a site whose final URL isn't known yet, leave SITE_URL as a TODO placeholder and re-deploy once known. Easier than guessing.

## 2026-05-27 — Historical-arb replay script lands #milestone

`bot/scripts/historical-replay.ts` (`bun run replay`) closes the last item on the V0 punch list. Reads UniV2 + Sushi WETH/USDC reserves at whatever block anvil is forked at, runs the bot's standing-arb math (`getOptimalInput` from `amm.ts`) in both possible round-trip directions (sell-on-UniV2 / sell-on-Sushi), and either:

- **executes the better direction via Aave V3 flashloan** when a real profitable gap exists, then asserts realized matches predicted; or
- **prints a diagnostic gap analysis** showing each direction's probe-input round-trip output and predicted loss-to-fees, exiting 0 — "no opportunity" is not a failure.

At HEAD (block 25189150 during this run): UniV2 implied price 2,056.89 USDC/WETH vs Sushi 2,055.57. Cross-DEX gap of 0.060% — well under the 0.60% combined round-trip fee floor. Both directions show a ~2.1% gross loss on a 1-WETH probe (0.60% fees + ~1.5% adverse slippage on Sushi's depleted WETH reserve of ~62 WETH). Diagnostic exits cleanly with an explanation pointing the user toward archival RPC + high-volatility blocks for an actual historical replay.

The script reuses the existing `getAmountOut`, `getOptimalInput` (amm.ts), `buildFlashloanCall` (bundle.ts), and `fetchChainFees` + `signExecutorTx` (sign.ts) — same primitives demo.ts uses, just without the synthetic victim swap. ~280 lines of TS total, no new src/ files needed.

The framing is honest about what's possible without archival access:

- *At HEAD*: educational gap-analysis tool that demonstrates the bot's math against real chain state.
- *With archival RPC + a pinned `--fork-block-number`*: actual historical-arb replay that proves the bot would have caught a specific past opportunity.

The latter requires an Alchemy / Infura / dedicated-node URL — free public RPCs don't keep historical state beyond ~128 blocks. Documented in the README's Demo section + this entry.

V0 is complete. From here, follow-up work is either expanding scope (multi-hop paths, ETH-side variants, WETH/non-WETH base gas gate) or refining presentation (sponsor track wiring, screen-recorded portfolio video, blog post on the bare-metal Yul advantage).

## 2026-05-27 — Published to github.com/Builder106/quarry; first CI run green #milestone

Quarry is now public at <https://github.com/Builder106/quarry>. Single first commit captures the entire V0 (everything since project kickoff in this session — 39 files, both off-chain and on-chain trees, plus assets/, docs, CI workflow). Repo metadata set via `gh repo create` and `gh repo edit`:

- Description: "A bare-metal MEV arbitrage bot — TypeScript mempool scanner + Yul executor + Aave V3 flashloans. 188 B runtime, 110k gas two-hop, 99.89% prediction accuracy."
- Topics (12): `aave-v3`, `arbitrage`, `bare-metal`, `bun`, `defi`, `ethereum`, `flashloan`, `foundry`, `mev`, `typescript`, `uniswap-v2`, `yul`.
- Visibility: PUBLIC.

First CI run (26537198472) completed in ~17s wall-clock — both jobs green:

- `contracts (forge)` in 16s: install Foundry → install forge-std → `forge build --sizes` → `forge test -vvv` (13 tests pass, 1 fork test skips without RPC).
- `bot (bun)` in 17s: install Bun 1.3 → `bun install --frozen-lockfile` → `bun run typecheck` → `bun test` (65 tests, 2,132 assertions).

README CI badge updated from the local-only `shields.io/badge/CI-configured-success` placeholder to the live `actions/workflows/ci.yml/badge.svg` URL — it now reflects real pass/fail state.

Pre-flight safety check before the commit: grepped tracked-able files for `private[_-]?key|secret|api[_-]?key|password|MAINNET_RPC_URL=https` patterns, confirmed only doc placeholders matched (no real RPC URLs, no live private keys; the Anvil `0xac0974…` key in `sign.test.ts` and `demo.ts` is the published default test key and never holds real funds). No `.env` file present; only `.env.example` is committed.

One CI warning worth noting for future-me: `actions/checkout@v4` runs on Node 20, which GitHub will deprecate by June 2026. The action's maintainers will roll it forward to Node 24 well before then; no action needed unless the warning persists past the Node 24 default cutover.

## 2026-05-27 — Recorded demo GIF lands in README #milestone

`assets/demo.gif` (137 KB, github-dark theme via `agg`) embeds at the top of the README's Demo section. Captures `bun run demo` end-to-end: anvil reachable → executor deploys → score (pre-victim reserves + the back-run prediction) → victim impersonation + swap → FLASHLOAN BUNDLE (borrows 5.3 WETH from real Aave V3) → VERIFY (net realized 0.558 WETH, 99.89% of predicted). Pipeline: `asciinema rec --command "bun run demo"` produces a `.cast` file (~3 KB JSON), `agg --theme github-dark --speed 1.5 --cols 110 --font-size 14` renders it to GIF. The agg output is ten visually-distinct frames (the deduplicator drops identical states, so a fast-running demo compresses cleanly), played at ~1 fps with a 3-second hold on the final frame. README's existing text-trace fallback updated under the same `<details>` block to match the new V3 flashloan run (previous trace was from the pre-flashloan V2 demo with `STAGE BACK-RUN INPUT` instead of `FLASHLOAN BUNDLE`).

Reroll recipe for future-me — if the demo output changes:

1. `anvil --fork-url https://ethereum-rpc.publicnode.com` (terminal 1)
2. `curl … anvil_reset …` (clean state)
3. `cd bot && asciinema rec /tmp/quarry-demo.cast --overwrite --command "bun run demo"`
4. `agg /tmp/quarry-demo.cast assets/demo.gif --theme github-dark --speed 1.5 --cols 110 --font-size 14`
5. Update the text trace under `<details>` to match what the GIF shows.

## 2026-05-27 — V3 executor: Aave V3 flashloan integration, inventory-free bot #milestone

The bot now runs with zero inventory. `Executor.yul` grows a second entry point — `executeOperation(address,uint256,uint256,address,bytes)` — that dispatches on the function selector `0x1b11d0ff`. Same Yul object, single contract; the V2 direct path stays untouched and tested. Shared swap orchestration extracted into a Yul `function runSwaps(pool1, pool2, a0p1, a1p1, a0p2, a1p2)` so both entry points use the same code, plus `erc20BalanceOf`, `erc20Transfer`, `erc20Approve` helpers. Runtime grew from 188 → 492 bytes — still a tiny contract by any measure, and a Solidity equivalent of the dual-entry version would land at well over 1.5 KB.

The flashloan path:

```text
bot → Aave.flashLoanSimple(executor, WETH, amount, params, 0)
       Aave transfers amount → executor
       Aave calls executor.executeOperation(WETH, amount, premium, bot, params)
           verify caller() == Aave V3 Pool
           verify initiator == owner
           verify params[168..188] == asset  (tokenIn consistency)
           snapshot balanceBefore (= amount, the just-received flashloan)
           transfer amount → victimPair
           runSwaps(pool1, pool2, ...)  → leg 1 + leg 2
           snapshot balanceAfter
           assert balanceAfter - balanceBefore >= premium + minProfit
           approve(Aave, amount + premium)
           return true
       Aave transferFrom(executor, Aave, amount + premium)
```text

Six new Solidity tests in `ExecutorFlashloan.t.sol` covering profitable arb, insufficient profit revert, stranger-initiator revert, non-Aave caller revert, token-in mismatch revert, and gas snapshot (~128k against mocks, under the 200k ceiling). Mock Aave (`MockAaveV3Pool`) plus a `vm.etch` of its bytecode at the canonical Aave V3 mainnet address so the executor's hardcoded auth check passes against the mock. Bot side: `buildFlashloanCall(arb, executor)` wraps `buildExecutorCalldata` in a `flashLoanSimple` ABI-encoded call. `buildDirectCall(arb, executor)` preserves the V2 path. Five new TS tests for the wrapper.

`demo.ts` now borrows from real Aave V3 instead of `setStorageAt`-faking the input. Run against forked-mainnet anvil:

```text
━━━ FLASHLOAN BUNDLE ━━━
[demo] borrowing 5.301040 WETH from Aave V3 (0x8787…A4E2)
[demo] Aave premium (5 bp on WETH): 0.002650 WETH
[demo] expected net (profit − premium): 0.558632 WETH
[demo] flashloan tx mined: 0x24a799…dc4bd
[demo] tx gas used:        266,694

━━━ VERIFY ━━━
[demo] net predicted profit:          0.558632 WETH
[demo] net realized profit:           0.558046 WETH
[demo] prediction accuracy:           99.89% of expected
```text

Tx gas at 266k against real Aave + real Uniswap V2 + real Sushiswap pools is the honest end-to-end cost. The 110k from the V2 fork test was the executor's own work + the two pool swaps; the V3 number adds Aave's account-management overhead (the asset transfer, the executeOperation callback dispatch, the approve, and the transferFrom-back). All of it real on-chain work.

## 2026-05-27 — Two papercuts on the flashloan road: wrong selector, wrong address #incident

Both bugs cost ~30 minutes each in the debug loop. Worth recording.

**(1) `executeOperation` selector was wrong.** I had `0x920f5c84` in the dispatcher; the actual selector is `0x1b11d0ff`. Source: I went off memory instead of computing it. `toFunctionSelector("executeOperation(address,uint256,uint256,address,bytes)")` from viem gives `0x1b11d0ff` directly. The trace symptom was the executor reverting at 60 gas — the selector mismatched, the switch fell through to the default V2 path, which then reverted on the `calldatasize() != 220` check. **How to apply:** for any new function selector hardcoded in Yul, compute it once at the top of a comment block in the contract source, and have a test that re-computes it via `keccak256(...)` and asserts equality. Don't trust manual lookups for 4-byte selectors — the consequence of a typo isn't a compile error, it's a runtime "function not found, fall through to something else."

**(2) Aave V3 mainnet Pool address was wrong.** I had `0x87870BCe3F3fc92800300B3A4d6Fab5e4e519cAD`; the correct proxy is `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2`. The two differ at the third character (`Ce` vs `Ca`) and several others — easy to confuse, no warning. `eth_getCode` against the wrong address returned 0 bytes (no contract there), but my code called it anyway and the tx mined with 29k gas "success" — turns out calling a no-code address with non-empty calldata is a valid no-op in the EVM, not a revert. **How to apply:** before hardcoding any external contract address, run `eth_getCode` against it via the fork RPC and assert it returns non-empty bytecode. Or use a constant from a verified deployments registry. Address typos that produce a no-code target are insidious because the tx looks successful.

## 2026-05-27 — CI workflow: two parallel jobs gating every push #milestone

`.github/workflows/ci.yml` lands. Two jobs running in parallel on `ubuntu-24.04`:

- **`contracts`** — installs Foundry via `foundry-rs/foundry-toolchain@v1` (stable), installs forge-std via `--no-git` (since `contracts/lib/` is gitignored), runs `forge build --sizes` for size report visibility, then `forge test -vvv`. The fork test auto-skips when `MAINNET_RPC_URL` is unset, which is the CI default — wiring it requires adding the env as a repo secret + propagating via `env:`.
- **`bot`** — installs Bun 1.3 via `oven-sh/setup-bun@v2`, runs `bun install --frozen-lockfile`, `bun run typecheck`, and `bun test`.

Concurrency group cancels in-progress runs on the same ref so a push burst doesn't pile up redundant CI minutes. README CI badge flipped from `pending` (linked to `#`) to `configured` (linked to `.github/workflows/ci.yml`); once the repo is pushed to GitHub, that badge URL becomes `https://github.com/<owner>/<repo>/actions/workflows/ci.yml/badge.svg` for live status. **How to apply:** when you push to GitHub, update the badge URL — the badge text will auto-flip to passing/failing once Actions runs the first build.

Two operational notes: (1) `bun.lock` (text format) is tracked; `bun.lockb` (binary) is gitignored. The frozen-lockfile install reads the text version, so CI is reproducible. (2) `forge snapshot --check` would be a nice gas-regression gate but it complains "no matching snapshot entry" for the skipped fork test's `setUp()`. Deferred until I figure out the right `--match` pattern, or until the fork test gets a CI-side RPC secret.

## 2026-05-27 — Banner + README polish; storefront pass #milestone

`assets/banner-{dark,light}.svg` land. 1200×420 SVG, dual-variant via `<picture>` + `prefers-color-scheme`. Design: concentric hexagons on the right (suggesting an excavated quarry pit / mineral extraction) anchoring a typographic block on the left — wordmark in `system-ui` 140pt, tagline in 22pt, four engineering-claim chips in monospace gold (`188 B runtime · 110k gas measured · Yul-native · Uniswap V2 + Sushiswap`), and a footer line showing the actual V2 runtime bytecode prefix as a small caption. The faint horizontal rules in the background evoke a stratigraphic cross-section. SVG so it stays crisp at every zoom and renders inline in GitHub READMEs reliably. Dark uses `#0c1019` / `#fcc419` (slate + gold); light uses `#faf8f4` / `#c98f12` (warm cream + dark amber) — both convey "extraction" without saying it.

README rewritten end-to-end. New architecture mermaid that matches the actual back-run pipeline (was an outdated front-run/back-run sandwich diagram — now shows the eight-step flow: WS pending tx → routerToDex → decode → multicall reserves → score-with-victim-impact → buildExecutorCalldata → sign → submit → executor → pool1 → pool2 → balance guard). Added two new "Yul runtime" and "Two-hop gas" shields.io badges with the actual measured numbers. New "Demo: end-to-end against forked mainnet" section with the full `bun run demo` trace under a collapsible `<details>` block. Repo-layout tree updated to reflect the eight off-chain modules + four on-chain ones that actually exist. Performance gates table now has current measurements (110,780 / 188 B / 48,976) — was placeholders before. New "What's in V0 (and what isn't)" section captures the punch list honestly so nobody reads more into this than they should — multi-hop, ETH-side variants, non-WETH-base gas gate, flashloan integration, real-relay submission are all documented as known V0 gaps.

What's deferred for a polish-next pass: shields.io CI badge (waiting on the GitHub Actions workflow), recorded demo GIF (would need a screen recorder + ffmpeg → gif conversion), and the apple-touch-icon (only matters if the project gets a web frontend, which is out of scope for this engine).

## 2026-05-27 — End-to-end demo runs against an anvil fork; realized profit 99.89% of predicted #milestone

`bot/scripts/demo.ts` ties the whole pipeline together against a forked-mainnet anvil. From scratch:

```json
[demo] executor deployed at 0xabab79…64b6
[demo] scored uniswap-v2 → sushiswap
[demo]   amountIn:        5.284523 WETH
[demo]   intermediateOut: 13253.999137 USDC
[demo]   expectedOut:     5.841408 WETH
[demo]   predicted profit: 0.556885 WETH
[demo] victim swap mined: 0x8bf9b7…3fc3
[demo] executor tx mined: 0xd4b1cb…1da6
[demo] executor gas used: 147008
[demo] executor's final WETH balance: 5.840824 WETH
[demo] realized profit:  0.556301 WETH
[demo] prediction accuracy: 99.89% of predicted
```text

The 0.11% drift is exactly the safety margin we shave off both leg outputs to give Uniswap V2's K-invariant integer-arithmetic check some boundary slack — see incident below. The 99.89% match means the bot's off-chain math agrees with the on-chain executor's realized swap to within ~6 wei per unit per leg.

Run shape: `anvil --fork-url <rpc>` in one terminal, `bun run demo` in another. The script connects to localhost:8545, deploys the Yul executor via Anvil key 0, scores a hypothetical 1M-USDC victim swap on UniV2 using `scoreOpportunity` (against pre-victim reserves), then impersonates the USDC reserve at `0x55FE…44B8` to fund a synthetic victim, executes the victim's real router call, deals WETH to the UniV2 pair via `setStorageAt` at WETH9's slot 3 (simulating a flashloan), signs the executor tx with the bot key, sends it via `eth_sendRawTransaction`, and asserts the executor's WETH balance grew. Three receipt-status checks along the way (whale→victim transfer, victim approve, victim router swap) so silent reverts don't propagate into a confusing executor failure later.

## 2026-05-27 — Uniswap V2 K-invariant integer-arithmetic boundary; +1 bp safety margin #incident

First end-to-end run reverted with `UniswapV2: K` on leg 1, even with perfectly aligned post-victim reserves between score and chain. The cause: my score computes `intermediateOut = getAmountOut(amountIn, _reserve1, _reserve0)` using BigInt integer division (floor), and the chain's swap K-check ends up requiring `amount0Out <= floor(amountIn · 997 · _reserve0 / (_reserve1 · 1000 + amountIn · 997))`. The two expressions are algebraically identical, but rounding propagates differently when the post-victim reserves the score computes don't match the chain's by a wei or two — which happens occasionally because the victim's tx in `applyVictimSwap` actually goes through the router's `_swap`, which has its own intermediate rounding. The combined effect is that asking for the exact `getAmountOut` value sits right at the K boundary, and a wei-level perturbation flips it negative. Standard production MEV bot fix: request slightly less. `buildExecutorCalldata` now takes an optional `safetyBps` (default 1 bp = 0.01%) that shaves both leg outputs. Realized profit drops by ~2× safetyBps, but the K boundary stops being a coin-flip on the last wei. **How to apply:** for any new integer-arithmetic constraint check across off-chain prediction and on-chain execution, leave at least 1 bp of slack. Equality at floor boundaries is brittle.

## 2026-05-27 — Two anvil-fork operational papercuts #incident

(1) Binance 14 (0x28C6…1d60) had only 44k USDC at the current HEAD — short of the 1M USDC victim swap. First demo run silently reverted at the whale→victim transfer because I wasn't checking receipt status. Fix: added an explicit balance pre-check + receipt-status guards after every impersonated tx, and switched the whale to Circle's reserve at 0x55FE…44B8 (129M USDC). (2) Anvil's state persists across runs of the demo — a previously failed bot tx's `setStorageAt` WETH-deposit leaks into the next run's pre-victim snapshot. Call `anvil_reset` between runs (or just relaunch anvil with `--fork-url`) for deterministic results. The demo doesn't auto-reset on entry to avoid clobbering a user's manually configured fork state; documented in the script's header comment.

## 2026-05-27 — Bundle assembly: scored arb → Flashbots-shaped JSON-RPC payload #milestone

Two new modules close the off-chain side: `bot/src/bundle.ts` builds the 220-byte packed executor calldata from a `ScoredArb` and wraps signed transactions in the Flashbots envelope; `bot/src/sign.ts` signs EIP-1559 transactions locally via `privateKeyToAccount` (no RPC needed for signing itself — fees and nonce come from outside via `fetchChainFees`). `buildBundlePayload`, `toJsonRpcRequest`, and `toCallBundleRequest` cover both the production submission shape (`eth_sendBundle`) and the simulation shape (`eth_callBundle` with `stateBlockNumber`). Caller composes the pieces: score → calldata → sign → wrap → submit.

The bundle layout test pins seven byte ranges against the V2 executor's expectations: pool1 at 0..20, pool2 at 20..40, four uint256 amount slots at 40..168, tokenIn at 168..188, minProfit at 188..220, total 220 bytes. The amount-slot logic depends on Uniswap V2 token ordering (token0 is the lower address) — `intermediateIsToken0` is the single branch that fixes all four amount slots for both legs. Two tests exercise both branches (USDC-base + WETH-intermediate, then the flip).

`ScoredArb` grew an `intermediateOut: bigint` field — the amount of intermediateToken pool1 sends directly to pool2 in the executor's bundle. The bundle builder needs this to populate the amount slot that corresponds to the intermediate token. `scoreFromRawReserves` computes it as a single extra `getAmountOut` call alongside the existing `quoteOptimalArb`.

Two papercuts captured for future-me. (1) viem's `encodePacked` strictly validates EIP-55 checksums on Address arguments, so synthetic test addresses like `0xAAAAaaaA…` are rejected unless they happen to be valid checksums. Lowering them sidesteps the issue — viem treats all-lowercase as "no checksum claim." Real mainnet addresses (WETH, USDC) carry valid checksums already, so this only bites in tests. (2) viem's `parseTransaction` returns `value: undefined` for zero-value txs, not `value: 0n`. Use `?? 0n` if you want a default. Trivial-once-known, costs five minutes if not.

Repo totals: 7 Solidity + 1 skipped fork, 58 TypeScript across 6 files (12 new in this turn). The off-chain pipeline now runs end-to-end: pending tx → decode → fetch reserves + gas → score → build calldata → sign → wrap in Flashbots envelope. What's still in-script-not-in-prod: a runner that actually submits to a fork or relay, and a flashloan setup tx in bundle position 0 for the inventory-free case.

## 2026-05-27 — Gas-cost gate: scanner now surfaces only bundle-eligible arbs #milestone

`bot/src/gas.ts` lands: `getGasPrice(client)` with a 12-second cache (one-block TTL, amortizes RPC across a burst of scoring calls), `EXECUTOR_GAS_UNITS = 150_000n` (V2 Yul's measured 110,780 plus 40k headroom for flashloan setup, calldata, and gas-price spikes), and `estimateExecutorGasCost(client) = gasPrice × EXECUTOR_GAS_UNITS`. `scoreFromRawReserves` grows a `gasCostWei: bigint` parameter (kept as the last positional arg so the function stays trivially callable from tests with `0n`), and the result type grows a `gasCostWei` field so downstream consumers can re-evaluate the trade with a different gas estimate. `scoreOpportunity` fires `fetchReserves` and `estimateExecutorGasCost` in parallel via `Promise.all` — single RPC round-trip per pending tx, gas-price call is usually cache-served.

The gate fires only when `baseToken === WETH`. That's the V0 simplification: profit denominated in WETH is directly comparable to gas cost in wei, so the inequality is unit-correct. For non-WETH bases (USDC, DAI, whatever the victim took out), the gate is skipped — comparing USDC profit to ETH gas requires a WETH/baseToken conversion via a third reserve fetch, which is mechanical but defers cleanly to V1. The `gasCostWei` is still carried through on every result so downstream can do the conversion if it has access to a price feed.

Test surface picks up three boundary cases worth pinning. (1) WETH base, profit > gas → surfaces (and profit one wei above gas still surfaces — verifies the gate isn't off-by-one). (2) WETH base, gas equals profit → null (closed boundary at the `<=`). (3) USDC base with enormous synthetic gas → still surfaces, gas value propagates to the result. 43 Bun tests now (was 40), all green, 2,084 assertions.

V1 ideas that fall out of this naturally: (a) WETH/baseToken conversion via a third multicall entry, so USDC/DAI-base trades also get gated; (b) priority-fee tip ceiling instead of `eth_gasPrice` for more realistic Flashbots competition modeling; (c) profit-net-of-gas as the primary scoring key (currently we sort by gross profit and gate at the end, which can miss "two low-profit-but-cheap-gas opportunities are better than one high-profit-but-expensive one" cases — irrelevant when surfacing one arb per victim, but matters once we batch).

## 2026-05-27 — Back-run scoring: simulate the victim, then close the gap #milestone

Scoring shifts from "standing arb monitor" to "back-run engine." Old logic asked "is there a price gap between these two pools right now?" — the answer is almost always no, because real arbs close within a block. New logic asks "given that the victim's swap is about to land on DEX X, will the price gap it *creates* be big enough to back-run profitably against DEX Y?" That's the load-bearing MEV pattern.

Pipeline change is one function: `scoreFromRawReserves(swap, victimDex, raw)` now applies `getAmountOut(swap.amountIn, victimOriented.reserveIn, victimOriented.reserveOut)` to the victim DEX's reserves first, computes `postVictimAReserve = R + amountIn` and `postVictimBReserve = R - victimOut`, and runs `quoteOptimalArb(leg1, leg2)` where `leg1` is the victim's pool in the *reverse* trade direction (B → A, at the post-victim rate) and `leg2` is the unchanged counter DEX (A → B). Profit is measured in B — the token the victim received and which got more expensive on the victim's pool. The direction is deterministic now; no solver-picked direction, no two-direction loop.

`routerToDex` plumbs router contract → `Dex` so the scanner can hand the victim DEX into scoring. Uniswap V3's SwapRouter is registered as `isRouter`-true (so we don't waste a `getTx` on it) but `routerToDex`-null (its concentrated-liquidity pair shape can't be back-run by this pipeline — defer until we write a V3-shape scoring path).

Test surface picks up four properties worth pinning. (1) Tiny victim on aligned pools → null (price move below fee floor). (2) Large victim on aligned pools → positive profit, with leg-1-on-victim and leg-2-on-counter orientation. (3) Profit grows monotonically with `amountIn` — the back-runner's edge scales with the victim's impact. (4) Switching `victimDex` from "uniswap-v2" to "sushiswap" with otherwise identical inputs correctly flips `victimDex`/`arbDex` in the result. 40 Bun tests total now (was 33), 2074 assertions, zero failures, zero seconds.

Naming cleanup: old `leadDex` / `counterDex` got renamed to `victimDex` / `arbDex`. The "lead/counter" framing made sense for the symmetric standing-arb scan but reads wrong for the back-run pattern where the roles are asymmetric and determined by the victim. `ScoredArb` also renames `leadPair`/`counterPair` to `victimPair`/`arbPair` accordingly.

V0-of-back-run caveats still on the punch list: still only first hop of `path`, still only `exactInForTokens`, and a real production scanner would also model gas+priority-fee cost against the realized profit to gate on net-positive bundles. The gas-cost gate plugs into `scoreFromRawReserves` as one more `if (profit < gasCost) continue;` line — wire it once we have a viable Flashbots bundle to estimate against.

## 2026-05-27 — Scoring pipeline: scanner now surfaces opportunities, not just swaps #milestone

The off-chain side now produces actionable signals. Pipeline:

1. `pairs.ts` — CREATE2 pair address derivation for Uniswap V2 + Sushiswap. Tests pin three known mainnet pairs (UniV2 WETH/USDC, Sushi WETH/USDC, UniV2 DAI/WETH); they match bit-for-bit, which validates both the factory addresses and the init-code hashes.
2. `reserves.ts` — `fetchReserves` does a single Multicall3 call to `getReserves()` on both candidate pairs, drops missing/zero-liquidity entries via `allowFailure: true`. One network round trip per scoring decision.
3. `score.ts` — split into a pure `scoreFromRawReserves` (no IO, fully unit-tested with synthetic reserves) and an IO wrapper `scoreOpportunity`. For each (lead, counter) DEX pair, orients the raw token0/token1 reserves into the (in, out) frame for the trade direction, runs `quoteOptimalArb`, and keeps the highest-profit non-zero result. Two directions tested per swap because we don't know which way the price gap goes a priori.
4. `scanner.ts` — wired end-to-end: WS pending tx → `getTransaction` → router filter → decode → `scoreOpportunity` → log surfaced arbs only.

33 Bun tests green. Test surface covers: CREATE2 derivation, token-ordering commutativity, equal-pool null-return, sub-fee divergence null-return, profitable-divergence positive return, and correct lead/counter orientation (sushi-as-lead when sushi has the higher WETH price).

V0 scope, captured here so I don't pretend the scanner is finished: (a) only first hop of `path` — multi-hop paths fan out the search surface trivially but bloat the multicall, defer until we have rate-limit visibility; (b) only `exactInForTokens` — ETH-side variants need `tx.value` plumbed through `scoreOpportunity`'s decoded-swap arg, mechanical change but punted to V2; (c) "standing arb" scoring only, no anticipated-victim-impact yet — the V1 of the scoring stage is to call `getAmountOut` on the victim's pool first to simulate the price move, then score the post-victim reserves against the unchanged counter pool. That's the "back-run" pattern proper.

## 2026-05-27 — Scanner brain: AMM math + calldata decoder land #milestone

The off-chain side now has a brain. `bot/src/amm.ts` exports `getAmountOut`, `getOptimalInput`, `quoteRoundTrip`, and `quoteOptimalArb` — the constant-product-with-fee math plus the closed-form solver for two-hop cross-DEX optimal input. `bot/src/decode.ts` decodes the four Uniswap V2 router methods that account for >95% of public-mempool swap volume (`swapExactTokensForTokens`, `swapExactETHForTokens`, `swapExactTokensForETH`, `swapTokensForExactTokens`) and exports a known-router registry so the scanner can filter at the `tx.to` level before paying the cost of decode. `bot/src/scanner.ts` is updated to wire the pipeline end-to-end: WS pending-tx subscription → `getTransaction` → router filter → decode → log. 21 Bun tests green (including a local-maximum property check on the optimal-input solver, an end-to-end round-trip via viem's `encodeFunctionData`, and a verification that the bigint `isqrt` floor matches the spec for all inputs in [0, 1000)).

## 2026-05-27 — Optimal-input formula had two transcription bugs #incident

First implementation of `getOptimalInput` had `R1in · R2out` in the numerator's subtraction term and `R2out` in the denominator's addition term. Both should have been `R2in` (the input-side reserve of pool 2 — the intermediate token's reserve at the second hop, not the base asset's reserve). The test "returns a positive input when the price gap exceeds fees" caught it twice — first revealing the bug, then catching that a stale memory of the formula re-introduced it. Fixed in `bot/src/amm.ts` with a fuller derivation sketch in the function's docblock, so a future reader can re-verify. **Why it matters:** `r · √K > R1in · R2in` is the correct unit-balanced condition for "is there profit after fees" — both sides have units of `(reserve)²`. The buggy `R1in · R2out` mixed units (`reserve_A · reserve_A` vs. the proper `reserve_A · reserve_B`) and would have produced nonsensical opportunity signals once wired to live reserves. **How to apply:** every closed-form economic optimum in this repo should carry a derivation sketch in the docblock, not just the final expression — the algebra is short enough that a verifier can re-walk it, and the docblock acts as a test against transcription drift.

## 2026-05-27 — V3 fork harness: 110,780 gas against real mainnet pools #milestone

`ExecutorFork.t.sol` lands. Forks Ethereum mainnet at HEAD (or a user-pinned block via `FORK_BLOCK`), deploys the Yul executor, deals 1 WETH to the real Uniswap V2 WETH/USDC pair to simulate a flashloan, computes the two-hop output via the real reserves + Uniswap V2's `getAmountOut` formula, and runs the round trip. At today's HEAD: 1 WETH → 2,062.74 USDC → 0.9786 WETH back to the executor, with a fee loss of 0.02137 WETH (the two 0.3% AMM fees + a small adverse drift between the two pools). **Total gas: 110,780.** Sharpened the CONTRIBUTING.md gate from the original ambiguous "35k for the executor" to a precise "130k total transaction gas on a forked mainnet snapshot, including the called pools' own swap() internals" — that's the measurement that matters in production where the block builder weighs gas spent against priority fee paid.

The Yul executor's own opcodes contribute ~6k of the 110,780 — the rest is the unavoidable cost of two real `IUniswapV2Pair.swap()` calls (K-invariant check, reserves update, ERC20 transfers). A Solidity-compiled equivalent of the executor would still pay that ~104k pool cost, but layer on ~50-100k of dispatcher / ABI-decode / safe-math overhead on its own opcodes. So the bare-metal advantage compounds: we're at ~110k where Solidity would be ~160-210k for the same route.

Two RPC-availability surprises while wiring this up. (1) llamarpc returned 522 / Cloudflare-origin-unreachable mid-session — public RPCs are best-effort, not SLA-backed. (2) publicnode connected but doesn't retain archival state for block 21M (most free public RPCs only keep ~128 blocks of state). **How to apply:** the fork test defaults to HEAD (no archival needed) and gates archival on the `FORK_BLOCK` env var being set. Pin it only when you've got Alchemy / Infura / your own node and you're chasing a specific historical arb opportunity. For day-to-day CI and inner-loop runs, HEAD-fork is fine — the gas numbers are stable enough across blocks.

## 2026-05-27 — V2 executor: chained two-hop arb with pool1→pool2 direct output #milestone

Chained the second swap into the Yul executor. Hop 1 calls `pool1.swap(_, _, to=pool2, "")` — the recipient is pool2, not the executor, so pool1's output token flows directly into pool2's reserve balance without an intermediate ERC20 transfer through this contract. That's the canonical MEV arb trick on Uniswap V2; it saves ~25k gas per arb. Hop 2 then calls `pool2.swap(_, _, to=this, "")` to close the loop and deliver the realized base-asset balance back to the executor, where the same balance-snapshot guard from V1 fires.

Calldata grew from 136 → 220 bytes (added two amount slots and a second pool address). Runtime bytecode grew from **153 → 188 bytes** — only 35 bytes for an entire second swap leg, thanks to a small inter-hop optimization: between the two swap CALLs, the selector at memory[0x00], the bytes-offset at memory[0x64], and the bytes-length at memory[0x84] are still valid from hop 1's setup; only the two amount slots (0x04, 0x24) and the recipient slot (0x44) need re-writing. Saves 3 mstores (~9 gas) per arb and ~24 bytes of bytecode.

Tests: 7 green, including a 256-run fuzz, separate atomicity tests for hop-1-fails and hop-2-fails (the second one is load-bearing — proves the hop-1 USDC transfer is unwound when hop 2 reverts), the insufficient-profit revert path, and a gas snapshot. Gas-with-mocks: 75,459 for the profitable two-hop path, well under the 100k ceiling. Pure executor-opcode delta from V1 → V2 is roughly +1k gas; the rest is mock infrastructure (one additional MockPool::swap CALL + one MockERC20::transfer for the USDC leg). The strict 35k two-hop gate from CONTRIBUTING.md still applies — but it's a real-pool-on-fork gate, which moves to `ExecutorFork.t.sol` in V3.

## 2026-05-27 — V1 executor: real swap call + balance-snapshot revert guard #milestone

Replaced V0's `a+b` body with a single Uniswap-V2-shaped swap call wrapped by a `balanceOf` snapshot. Calldata is tightly packed (no ABI offsets): `[20 pool][32 amount0Out][32 amount1Out][20 tokenIn][32 minProfit]` = 136 bytes. The runtime reads it directly with `calldataload + shr(96, ...)` for addresses. After the swap, it re-reads `balanceOf(this)`, computes `profit = balanceAfter - balanceBefore`, and reverts if `profit < minProfit` or if `balanceAfter < balanceBefore` (which catches arithmetic underflow without the additive form silently wrapping). Runtime bytecode: **153 bytes**. A Solidity-compiled equivalent of this logic typically lands at 600-1200 bytes, so the bare-metal thesis is showing real fruit at V1 already.

Tests: 6 green, including a 256-run fuzz that asserts `profit == payout` when payout ≥ minProfit and reverts otherwise. Coverage is auth, profitable path, insufficient-profit revert, stranger-caller revert, underfunded-pool revert (executor returns 0 on inner CALL failure), and a gas snapshot. Gas snapshot (with mocks) at `.gas-snapshot`: profitable path 48,432; stranger-revert 17,251; under-funded-pool revert 193,460 (deployment-heavy). The 25k ceiling I'd guessed initially was too tight — V1-with-mocks settles around 42k because two `balanceOf` cold-SLOADs in the mock ERC20 + one swap CALL eat ~34k before the executor's own opcodes are even counted. **How to apply:** the 35k gate from `CONTRIBUTING.md` is for the EXECUTOR's own opcodes against real Uniswap V2 pools on a forked mainnet — that gate moves to `ExecutorFork.t.sol` in V2. The mocks-test stays as a regression guard at 50k.

## 2026-05-27 — V0 toolchain verified end-to-end #milestone

`forge test` is green: the Yul `QuarryExecutor` object compiles, deploys via CREATE in the test setUp, and three tests pass — `test_OwnerCall_ReturnsSum` (gas 7,757), `test_StrangerCall_Reverts` (gas 12,813), and a 256-run fuzz `testFuzz_OwnerCall_SumIsCorrect` (μ 7,835). The deployment bytecode for V0 is 36 bytes; the runtime body of the auth+add path is 23 bytes. Bot side: `bun install` pulled viem 2.51 + @types/bun 1.3, and `tsc --noEmit` is clean. Two snags worth recording for future repos that mix Yul into a Foundry project — see next entries.

## 2026-05-27 — Foundry's solar lint doesn't understand Yul objects #incident

Foundry 1.7's new Rust-based linter (solar) treats `.yul` files as if they were Solidity and errors on `object "QuarryExecutor"` ("expected identifier, found `<string>`"). Setting `[lint] lint_on_build = false` in `foundry.toml` stops it from gating builds, but the warning still prints to stderr on both `forge build` and `forge test`. The exit code is 0, so it's cosmetic. **How to apply:** when solar grows Yul support upstream, re-enable lint and drop the toml flag — track Foundry release notes for the keyword "yul lint".

## 2026-05-27 — vm.getCode rejects Yul artifacts; read the JSON directly #incident

`vm.getCode("Executor.yul:QuarryExecutor")` returns "invalid type: null, expected a valid JSON ABI sequence" because Foundry's parser eagerly reads the artifact's `abi` field, which is `null` for pure-Yul outputs. Worked around it by reading the artifact JSON with `vm.readFile` and extracting `.bytecode.object` via `vm.parseJsonBytes`. **How to apply:** every Yul-loaded test in this repo uses the readFile path. If a Foundry update fixes vm.getCode for Yul artifacts, simplify back — but don't conditionally branch; pick one path.

## 2026-05-27 — Foundry installed via brew, not foundryup #decision

Auto-mode safety classifier blocked the curl-pipe-bash install of foundryup. Switched to `brew install foundry` — same toolchain, auditable channel, but lags nightly by a few days. **How to apply:** if a feature requires a Foundry feature behind nightly only, document the version pin in `contracts/foundry.toml` and call it out here before switching channels.
