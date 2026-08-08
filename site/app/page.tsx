import {DepthMeter} from "./depth-meter";

const GITHUB_URL = "https://github.com/Builder106/quarry";
const DEMO_GIF_URL = "/demo.gif";

/* Field-manifest tags — the four headline figures, treated as core sample
 * punches rather than generic stat cards. */
const SAMPLES = [
    {
        depth: "02",
        figure: "188",
        unit: "B",
        label: "Runtime bytecode",
        note: "vs. 1.5–3 KB for a Solidity equivalent of the same dual-entry contract.",
    },
    {
        depth: "05",
        figure: "110",
        unit: "k gas",
        label: "Two-hop arbitrage",
        note: "Measured against real Uniswap V2 + Sushiswap on a mainnet fork.",
    },
    {
        depth: "08",
        figure: "99.89",
        unit: "%",
        label: "Solver accuracy",
        note: "Off-chain prediction vs. on-chain realised profit, end-to-end.",
    },
    {
        depth: "11",
        figure: "0",
        unit: "wei",
        label: "Capital required",
        note: "Aave V3 flashLoanSimple fronts the WETH; atomic repayment.",
    },
] as const;

const DRILLING_LOG = [
    {step: "01", depth: "100 m", title: "WebSocket pending-tx", body: "Subscribe to mempool over WS via viem."},
    {step: "02", depth: "140 m", title: "Router filter", body: "Uniswap V2 + Sushiswap only. Everything else dropped."},
    {step: "03", depth: "200 m", title: "Calldata decode", body: "Four router methods, discriminated union — no dynamic dispatch."},
    {step: "04", depth: "280 m", title: "Multicall reserves", body: "Multicall3 reads both pair reserves in a single RPC round-trip."},
    {step: "05", depth: "360 m", title: "Score the back-run", body: "Apply victim → solve x* = (r·√K − R₁ᵢₙ·R₂ᵢₙ) / (r·(R₂ᵢₙ + r·R₁ₒᵤₜ))."},
    {step: "06", depth: "460 m", title: "Gate against gas", body: "Refuse if profit ≤ flashloan premium + bundle gas cost."},
    {step: "07", depth: "580 m", title: "Pack 220-byte calldata", body: "No ABI offsets. Tight byte string designed for calldataload."},
    {step: "08", depth: "720 m", title: "Sign + bundle", body: "EIP-1559 envelope → Aave V3 flashLoanSimple → Yul executor."},
    {step: "09", depth: "870 m", title: "Yul executes", body: "Borrow → swap → swap → assert → approve → return profit."},
] as const;

const INVENTORY = [
    {
        crate: "bot/src",
        kind: "TypeScript · Bun",
        items: ["amm.ts", "decode.ts", "pairs.ts", "reserves.ts", "score.ts", "gas.ts", "bundle.ts", "sign.ts", "scanner.ts"],
    },
    {
        crate: "contracts/src",
        kind: "Yul · Foundry",
        items: ["Executor.yul"],
    },
    {
        crate: "bot/test",
        kind: "Bun · 60 tests",
        items: ["amm.test.ts", "decode.test.ts", "pairs.test.ts", "score.test.ts", "bundle.test.ts", "sign.test.ts", "flashloan.test.ts"],
    },
    {
        crate: "contracts/test",
        kind: "Solidity · forge",
        items: ["Executor.t.sol", "ExecutorFork.t.sol", "ExecutorFlashloan.t.sol"],
    },
] as const;

/* Vertical strata column — drawn inline as an SVG so it can be precisely tuned
 * to the page's narrative depth. Each band corresponds to one major section
 * below. Annotations are punched into the right edge. */
function StrataColumn() {
    const BANDS = [
        {y: 0, h: 60, fill: "var(--color-strata-topsoil)", name: "TOPSOIL"},
        {y: 60, h: 140, fill: "var(--color-strata-sand)", name: "SANDSTONE"},
        {y: 200, h: 180, fill: "var(--color-strata-clay)", name: "CLAY · SHALE"},
        {y: 380, h: 220, fill: "var(--color-strata-slate)", name: "SLATE"},
        {y: 600, h: 260, fill: "#1c1812", name: "GRANITE"},
        {y: 860, h: 140, fill: "var(--color-strata-basalt)", name: "BASALT"},
    ];
    return (
        <svg
            aria-hidden
            viewBox="0 0 80 1000"
            preserveAspectRatio="none"
            className="hidden lg:block fixed right-0 top-0 h-screen w-12 xl:w-16 z-10 opacity-90 pointer-events-none"
        >
            {BANDS.map((b) => (
                <g key={b.name}>
                    <rect x="0" y={b.y} width="80" height={b.h} fill={b.fill} />
                    {/* Hairline cracks within each band */}
                    <line
                        x1="0"
                        y1={b.y + b.h * 0.3}
                        x2="80"
                        y2={b.y + b.h * 0.32}
                        stroke="rgba(0,0,0,0.4)"
                        strokeWidth="0.3"
                    />
                    <line
                        x1="0"
                        y1={b.y + b.h * 0.7}
                        x2="80"
                        y2={b.y + b.h * 0.68}
                        stroke="rgba(255,255,255,0.04)"
                        strokeWidth="0.3"
                    />
                </g>
            ))}
            {/* Bedding-plane bright dividers — the visible stratification. */}
            {BANDS.map((b) => (
                <line
                    key={`div-${b.y}`}
                    x1="0"
                    y1={b.y}
                    x2="80"
                    y2={b.y}
                    stroke="rgba(0,0,0,0.55)"
                    strokeWidth="0.6"
                />
            ))}
            {/* A vein of gold cuts diagonally through the slate band. */}
            <path
                d="M 0 480 Q 30 510, 55 520 T 80 560"
                stroke="var(--color-ore)"
                strokeWidth="1.4"
                fill="none"
                opacity="0.7"
            />
            <path
                d="M 0 520 Q 25 540, 50 545 T 80 580"
                stroke="var(--color-ore-deep)"
                strokeWidth="0.6"
                fill="none"
                opacity="0.5"
            />
        </svg>
    );
}

/* Inline brand mark used in the top nav — the quarry-pit nested-hexagon mark matching the favicon. */
function QuarryMark() {
    return (
        <svg
            aria-hidden
            viewBox="0 0 64 64"
            className="h-7 w-7"
            fill="none"
        >
            <g fill="none" strokeLinejoin="round">
                <polygon
                    points="32,7 53.65,19.5 53.65,44.5 32,57 10.35,44.5 10.35,19.5"
                    stroke="var(--color-ore-deep)"
                    strokeWidth="3"
                    opacity="0.75"
                />
                <polygon
                    points="32,15 46.72,23.5 46.72,40.5 32,49 17.28,40.5 17.28,23.5"
                    stroke="var(--color-ore)"
                    strokeWidth="3.5"
                />
            </g>
            <polygon
                points="32,23 39.79,27.5 39.79,36.5 32,41 24.21,36.5 24.21,27.5"
                fill="var(--color-ore)"
            />
        </svg>
    );
}

export default function Home() {
    return (
        <>
            <DepthMeter />
            <StrataColumn />

            {/* Top bar — minimal, like a notebook header. */}
            <header className="border-b border-[var(--color-vein-line)] bg-[var(--color-shaft)]/80 backdrop-blur sticky top-0 z-40">
                <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 lg:px-12">
                    <div className="flex items-center gap-3">
                        <QuarryMark />
                        <span className="font-mono text-sm tracking-[0.2em] text-[var(--color-chalk)]">
                            QUARRY
                        </span>
                        <span className="readout hidden sm:inline">/ field op · V3 · 2026</span>
                    </div>
                    <nav className="flex items-center gap-6 text-sm">
                        <a href="#log" className="text-[var(--color-dust)] hover:text-[var(--color-ore)]">Drilling log</a>
                        <a href="#demo" className="text-[var(--color-dust)] hover:text-[var(--color-ore)]">Field demo</a>
                        <a href={GITHUB_URL} className="font-mono text-xs tracking-[0.15em] uppercase text-[var(--color-ore)] hover:text-[var(--color-pearl)]">
                            Source ↗
                        </a>
                    </nav>
                </div>
            </header>

            <main className="relative mx-auto max-w-6xl px-6 lg:px-12 lg:pr-24 pb-32">

                {/* ============== HERO ============== */}
                <section className="relative pt-20 lg:pt-28">
                    <div className="grid lg:grid-cols-12 gap-10">
                        <div className="lg:col-span-8">
                            <div className="flex items-baseline gap-4 mb-6">
                                <span className="readout">000 m</span>
                                <span className="h-px flex-1 bg-[var(--color-vein-line)]" />
                                <span className="readout">field op QRY-3·26</span>
                            </div>

                            <h1 className="display text-[clamp(4.5rem,12vw,12rem)] text-[var(--color-chalk)]">
                                Quarry
                                <span className="block text-[var(--color-ore)]">the mempool.</span>
                            </h1>

                            <p className="mt-10 text-lg leading-relaxed text-[var(--color-dust)] max-w-2xl">
                                A bare-metal MEV arbitrage engine. A TypeScript scanner
                                watches Ethereum&apos;s public mempool for swaps about to land on a
                                Uniswap-V2-shaped DEX; for each candidate it back-computes the
                                price the victim will leave behind, runs a closed-form
                                optimal-input solver, and — if the round-trip profit clears
                                fees and gas — signs an EIP-1559 transaction that borrows
                                from Aave V3 and routes through a{" "}
                                <span className="text-[var(--color-ore)] font-medium">188-byte Yul executor</span>.
                            </p>

                            <p className="mt-5 text-[var(--color-dust)] max-w-2xl">
                                Every opcode shaved off the on-chain leg widens the marginal
                                profit envelope. That&apos;s the engineering thesis.
                            </p>

                            <div className="mt-10 flex flex-wrap gap-4">
                                <a href={GITHUB_URL} className="cta primary">
                                    Open the shaft
                                    <span aria-hidden>↗</span>
                                </a>
                                <a href="#demo" className="cta ghost">
                                    Watch the demo
                                </a>
                            </div>

                            <div className="mt-12 max-w-2xl field-note text-sm">
                                <span className="font-medium not-italic text-[var(--color-pearl)]">
                                    Scope.
                                </span>{" "}
                                Quarry targets cross-DEX arbitrage — closing price gaps the market
                                would close anyway. The kind of MEV broadly considered net-positive
                                for on-chain price efficiency. Predatory strategies (sandwiches,
                                JIT against retail) are out of scope.
                            </div>
                        </div>

                        {/* Vertical key card on the right — like a survey title block. */}
                        <aside className="lg:col-span-4">
                            <div className="lg:sticky lg:top-32 border border-[var(--color-vein-line)] bg-[var(--color-rock)] p-6 font-mono text-xs">
                                <div className="readout mb-4 text-[var(--color-ore)]">SURVEY TITLE BLOCK</div>
                                <dl className="space-y-3 text-[var(--color-dust)]">
                                    <div className="flex justify-between gap-4">
                                        <dt>Operation</dt>
                                        <dd className="text-[var(--color-chalk)]">Quarry</dd>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                        <dt>Substrate</dt>
                                        <dd className="text-[var(--color-chalk)]">Ethereum mainnet</dd>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                        <dt>Method</dt>
                                        <dd className="text-[var(--color-chalk)]">Cross-DEX arb</dd>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                        <dt>Tooling</dt>
                                        <dd className="text-[var(--color-chalk)]">Yul · viem · Bun</dd>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                        <dt>Funding</dt>
                                        <dd className="text-[var(--color-chalk)]">Aave V3 flashloan</dd>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                        <dt>Surveyor</dt>
                                        <dd className="text-[var(--color-chalk)]">Builder106</dd>
                                    </div>
                                </dl>
                                <div className="drillmark my-5" />
                                <div className="text-[var(--color-shadow)] leading-relaxed">
                                    Filed under field operations. Sample integrity verified
                                    against forked mainnet (anvil HEAD). Cross-referenced with
                                    JOURNAL.md.
                                </div>
                            </div>
                        </aside>
                    </div>
                </section>

                {/* ============== FIELD MANIFEST (stats) ============== */}
                <section className="mt-32">
                    <div className="flex items-baseline gap-4 mb-10">
                        <span className="readout text-[var(--color-ore)]">020 m · sandstone</span>
                        <span className="h-px flex-1 bg-[var(--color-vein-line)]" />
                        <span className="readout">manifest 01 / 04</span>
                    </div>

                    <h2 className="display text-4xl md:text-5xl text-[var(--color-pearl)]">
                        Core samples<br />from the seam.
                    </h2>
                    <p className="mt-4 text-[var(--color-dust)] max-w-2xl">
                        Four headline figures from the working operation. Pulled from the
                        repository&apos;s test ledger; reproducible against the published
                        anvil fork harness.
                    </p>

                    <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                        {SAMPLES.map((s) => (
                            <article key={s.label} className="tag">
                                <div className="readout">Sample · {s.depth} m</div>
                                <div className="mt-6 flex items-baseline gap-2">
                                    <span className="display text-6xl text-[var(--color-ore)] tabular">
                                        {s.figure}
                                    </span>
                                    <span className="font-mono text-sm text-[var(--color-dust)]">
                                        {s.unit}
                                    </span>
                                </div>
                                <div className="mt-3 font-medium text-[var(--color-pearl)]">
                                    {s.label}
                                </div>
                                <div className="mt-2 text-sm text-[var(--color-shadow)] leading-relaxed">
                                    {s.note}
                                </div>
                            </article>
                        ))}
                    </div>
                </section>

                {/* ============== DRILLING LOG (pipeline) ============== */}
                <section id="log" className="mt-32">
                    <div className="flex items-baseline gap-4 mb-10">
                        <span className="readout text-[var(--color-ore)]">200 m · clay · shale</span>
                        <span className="h-px flex-1 bg-[var(--color-vein-line)]" />
                        <span className="readout">manifest 02 / 04</span>
                    </div>

                    <div className="grid lg:grid-cols-12 gap-10">
                        <div className="lg:col-span-5">
                            <h2 className="display text-4xl md:text-5xl text-[var(--color-pearl)]">
                                The drilling<br />log.
                            </h2>
                            <p className="mt-4 text-[var(--color-dust)] leading-relaxed">
                                Nine deterministic steps from a pending mempool transaction
                                to a signed Flashbots-shaped bundle. The off-chain side does
                                all the math; the on-chain Yul executor is monolithic —
                                no Solidity, no function dispatcher, no ABI decoding, just{" "}
                                <code className="font-mono text-[var(--color-ore)]">calldataload</code>
                                {" "}reads against a tightly packed 220-byte payload.
                            </p>
                            <p className="mt-6 text-sm text-[var(--color-shadow)] leading-relaxed">
                                Pool 1&apos;s output flows directly to pool 2 — the canonical
                                Uniswap V2 trick, saving ~25k gas of intermediate ERC20
                                transfer. A balance snapshot at entry and exit guards the
                                trade: if the arbitrage window closes between detection and
                                inclusion, the whole transaction reverts and only the base
                                network fee is burned.
                            </p>
                        </div>

                        <ol className="lg:col-span-7 space-y-7">
                            {DRILLING_LOG.map((s) => (
                                <li key={s.step} className="borehole">
                                    <div className="borehole-marker">{s.step}</div>
                                    <div className="flex items-baseline gap-3 mb-1">
                                        <span className="readout text-[var(--color-ore)] tabular">{s.depth}</span>
                                        <h3 className="text-[var(--color-pearl)] font-medium">
                                            {s.title}
                                        </h3>
                                    </div>
                                    <p className="text-sm text-[var(--color-dust)] leading-relaxed">
                                        {s.body}
                                    </p>
                                </li>
                            ))}
                        </ol>
                    </div>
                </section>

                {/* ============== FIELD DEMO ============== */}
                <section id="demo" className="mt-32 scroll-mt-24">
                    <div className="flex items-baseline gap-4 mb-10">
                        <span className="readout text-[var(--color-ore)]">480 m · slate · vein</span>
                        <span className="h-px flex-1 bg-[var(--color-vein-line)]" />
                        <span className="readout">manifest 03 / 04</span>
                    </div>

                    <h2 className="display text-4xl md:text-5xl text-[var(--color-pearl)]">
                        Field demo.<br />
                        <span className="text-[var(--color-ore)]">Forked mainnet.</span>
                    </h2>
                    <p className="mt-4 text-[var(--color-dust)] max-w-3xl">
                        The full pipeline runs against a local anvil fork. The bot holds
                        zero inventory; Aave V3 fronts the WETH and gets repaid atomically
                        plus a 5 bp premium inside the same transaction.
                    </p>

                    {/* Polaroid-style field photo frame around the demo gif. */}
                    <figure className="mt-10">
                        <div className="border border-[var(--color-vein-line)] bg-[var(--color-rock)] p-3">
                            <div className="flex items-center justify-between font-mono text-[10px] tracking-[0.18em] uppercase text-[var(--color-shadow)] mb-3 px-2">
                                <span>Field capture · anvil-fork · HEAD</span>
                                <span>frame 01 / 01</span>
                            </div>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={DEMO_GIF_URL}
                                alt="bun run demo — back-run pipeline scoring a 1M-USDC victim swap, borrowing 5.3 WETH from Aave V3, netting 0.557 WETH net of premium against real Uniswap V2 + Sushiswap pools"
                                className="block w-full"
                                loading="lazy"
                            />
                        </div>
                        <figcaption className="mt-3 text-sm text-[var(--color-shadow)] font-mono">
                            Back-run pipeline scoring a 1 M USDC victim swap, borrowing 5.3 WETH
                            from Aave V3, netting 0.557 WETH net of premium.
                        </figcaption>
                    </figure>

                    <pre className="field-log mt-8">
<span className="dim"># Terminal 1 — fork mainnet at HEAD</span>
{"\n"}<span className="ore">anvil</span> --fork-url https://ethereum-rpc.publicnode.com
{"\n"}
{"\n"}<span className="dim"># Terminal 2 — run the pipeline</span>
{"\n"}cd bot
{"\n"}<span className="ore">bun</span> run demo
                    </pre>

                    <p className="mt-6 text-sm text-[var(--color-shadow)] max-w-3xl">
                        The 0.11% drift between net predicted and net realised is exactly the
                        2 bp safety margin baked into the calldata builder for Uniswap V2&apos;s
                        K-invariant integer-arithmetic check —{" "}
                        <a
                            href={`${GITHUB_URL}/blob/main/JOURNAL.md`}
                            className="text-[var(--color-ore)] underline-offset-4 hover:underline"
                        >
                            documented in JOURNAL.md
                        </a>
                        .
                    </p>
                </section>

                {/* ============== INVENTORY ============== */}
                <section className="mt-32">
                    <div className="flex items-baseline gap-4 mb-10">
                        <span className="readout text-[var(--color-ore)]">720 m · granite</span>
                        <span className="h-px flex-1 bg-[var(--color-vein-line)]" />
                        <span className="readout">manifest 04 / 04</span>
                    </div>

                    <h2 className="display text-4xl md:text-5xl text-[var(--color-pearl)]">
                        Equipment<br />inventory.
                    </h2>
                    <p className="mt-4 text-[var(--color-dust)] max-w-3xl">
                        Two intentionally independent trees. They communicate via deployed
                        contract address + ABI only — never via a shared TS package. Each
                        side has its own toolchain, its own test suite, its own gas/perf
                        budget.
                    </p>

                    <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-5">
                        {INVENTORY.map((crate) => (
                            <div
                                key={crate.crate}
                                className="border border-[var(--color-vein-line)] bg-[var(--color-rock)] p-5"
                            >
                                <div className="flex items-baseline justify-between">
                                    <div className="font-mono text-sm text-[var(--color-ore)]">
                                        {crate.crate}
                                    </div>
                                    <div className="readout">{crate.kind}</div>
                                </div>
                                <div className="drillmark my-4" />
                                <ul className="font-mono text-sm text-[var(--color-dust)] space-y-1.5 columns-1 sm:columns-2">
                                    {crate.items.map((i) => (
                                        <li key={i} className="break-inside-avoid">
                                            <span className="text-[var(--color-shadow)] mr-2">·</span>
                                            {i}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </section>

                {/* ============== EXTRACTION CTA ============== */}
                <section className="mt-32 relative">
                    <div className="flex items-baseline gap-4 mb-10">
                        <span className="readout text-[var(--color-ore)]">980 m · bedrock</span>
                        <span className="h-px flex-1 bg-[var(--color-vein-line)]" />
                        <span className="readout">closing report</span>
                    </div>

                    <div className="relative border border-[var(--color-vein-line)] bg-gradient-to-br from-[var(--color-face)] to-[var(--color-rock)] p-10 md:p-16 overflow-hidden">
                        {/* Decorative blast crosshatch behind the heading. */}
                        <div
                            aria-hidden
                            className="crosshatch absolute inset-0 opacity-30 pointer-events-none"
                        />
                        <div className="relative">
                            <h2 className="display text-5xl md:text-7xl text-[var(--color-chalk)] max-w-3xl">
                                188 bytes of Yul.
                                <span className="block text-[var(--color-ore)]">110k gas on real pools.</span>
                            </h2>
                            <p className="mt-6 text-[var(--color-dust)] max-w-2xl leading-relaxed">
                                Read the JOURNAL for the incidents — selector bugs, K-invariant
                                boundary drift, whale-balance shortages — that shaped the
                                design. Every entry is a sample log.
                            </p>
                            <div className="mt-10 flex flex-wrap gap-4">
                                <a href={GITHUB_URL} className="cta primary">
                                    Read the source
                                    <span aria-hidden>↗</span>
                                </a>
                                <a href={`${GITHUB_URL}/blob/main/JOURNAL.md`} className="cta ghost">
                                    Open JOURNAL.md
                                </a>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ============== FOOTER ============== */}
                <footer className="mt-24 pt-8 border-t border-[var(--color-vein-line)]">
                    <div className="flex flex-wrap items-center justify-between gap-4 font-mono text-xs tracking-[0.15em] uppercase text-[var(--color-shadow)]">
                        <div>
                            <span className="text-[var(--color-ore)]">Quarry</span>
                            {" · "}
                            V3 · 2026 ·{" "}
                            <a
                                href={`${GITHUB_URL}/blob/main/LICENSE`}
                                className="hover:text-[var(--color-ore)]"
                            >
                                MIT
                            </a>
                        </div>
                        <div>
                            Surveyed with Next.js · cut on Vercel
                        </div>
                    </div>
                </footer>
            </main>
        </>
    );
}
