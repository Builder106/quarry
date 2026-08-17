// Mempool scanner — V2. Subscribes to pending transactions, filters for
// known DEX routers, decodes Uniswap V2 swap calldata, fetches reserves on
// both Uniswap V2 and Sushiswap for the first hop of the path, runs the
// cross-DEX optimal-arb solver, and logs surfaced opportunities. Anything
// uninteresting (non-router target, non-matching ABI, no profitable arb)
// is dropped silently to keep the signal-to-noise high.

import { createPublicClient, webSocket, type Hex } from 'viem';
import { mainnet } from 'viem/chains';
import { decodeSwap, routerToDex } from './decode';
import { scoreOpportunity } from './score';

const WS_URL = process.env.WS_URL;
if (!WS_URL) {
  console.error('WS_URL is required (e.g. wss://eth-mainnet.g.alchemy.com/v2/<key>)');
  process.exit(1);
}

const client = createPublicClient({
  chain: mainnet,
  transport: webSocket(WS_URL),
});

let seen = 0;
let matched = 0;
let opportunities = 0;
const startedAt = Date.now();

const unwatch = client.watchPendingTransactions({
  onTransactions: async (hashes: readonly Hex[]) => {
    seen += hashes.length;
    await Promise.all(hashes.map(handleHash));
    if (seen % 250 === 0) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = (seen / elapsed).toFixed(1);
      console.log(
        `[scanner] ${seen} tx | ${matched} matched | ${opportunities} arb | ${elapsed.toFixed(1)}s | ${rate} tx/s`,
      );
    }
  },
  onError: (err: Error) => {
    console.error('[scanner] subscription error:', err.message);
  },
});

async function handleHash(hash: Hex): Promise<void> {
  try {
    const tx = await client.getTransaction({ hash });
    const victimDex = routerToDex(tx.to);
    if (!victimDex) return;
    const swap = decodeSwap(tx.input);
    if (!swap) return;
    matched++;

    const arb = await scoreOpportunity(client, swap, victimDex);
    if (!arb) return;
    opportunities++;

    const short = `${tx.hash.slice(0, 10)}…`;
    const base = arb.baseToken.slice(0, 6);
    const inter = arb.intermediateToken.slice(0, 6);
    console.log(
      `[scanner] back-run #${opportunities} ${short} victim=${arb.victimDex} arb=${arb.arbDex} ` +
        `${base}/${inter} in=${arb.amountIn} profit=${arb.profit}`,
    );
  } catch {
    // Pending tx may have been replaced or mined between subscription
    // and getTransaction. Drop silently — that's expected mempool churn.
  }
}

process.on('SIGINT', () => {
  console.log(`\n[scanner] stopped after ${seen} tx, ${matched} matched, ${opportunities} arb`);
  unwatch();
  process.exit(0);
});

const masked = WS_URL.replace(/\/v2\/.+$/, '/v2/****');
console.log(`[scanner] subscribed to pending tx on ${masked}`);
