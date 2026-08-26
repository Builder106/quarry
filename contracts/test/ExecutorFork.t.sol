// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IUniswapV2Pair, IERC20} from "./interfaces/IUniswapV2.sol";

/// @notice Real-pool fork tests for the Yul executor. Forks mainnet at a
/// recent stable block, deploys the V2 executor against real Uniswap V2 +
/// Sushiswap WETH/USDC pairs, and runs a full two-hop round trip.
///
/// Skips cleanly when `MAINNET_RPC_URL` isn't set — the rest of the suite
/// still runs against mocks under plain `forge test`. To exercise the fork
/// path locally:
///
///   export MAINNET_RPC_URL=https://eth.llamarpc.com   # or your provider
///   forge test --match-contract ExecutorForkTest -vvv
///
/// Note on profitability: at an arbitrary historical block the two pools are
/// usually price-aligned, so a round trip nets a small loss to the two 0.3%
/// fees. That doesn't break this test — the executor reads its OWN balance,
/// not its source-of-input. The pre-condition WETH that funds pool1 doesn't
/// move through the executor; it's sent there directly (a flashloan would do
/// the same). The executor's "profit" is whatever pool2 hands back at the
/// end. With minProfit = 0 the test always passes. A true arb-replay (where
/// price discrepancy makes the round trip net-positive for the bundle as a
/// whole) lands in V4 against a hand-picked historical block.
contract ExecutorForkTest is Test {
    // ---- Mainnet canonical addresses ----
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address internal constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    // Uniswap V2 WETH/USDC pair. token0 = USDC, token1 = WETH (USDC < WETH lex).
    address internal constant UNIV2_WETH_USDC = 0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc;
    // Sushiswap WETH/USDC pair. Same token0/token1 ordering as Uniswap V2.
    address internal constant SUSHI_WETH_USDC = 0x397FF1542f962076d0BFE58eA045FfA2d347ACa0;

    address internal executor;

    function setUp() public {
        string memory url = vm.envOr("MAINNET_RPC_URL", string(""));
        if (bytes(url).length == 0) {
            // No RPC configured — skip the entire fork suite. Mock tests in
            // ExecutorTest.t.sol still cover correctness.
            vm.skip(true);
            return;
        }
        // Default to forking at HEAD so non-archival public RPCs work out of
        // the box. Pin FORK_BLOCK to replay a specific historical arb — but
        // that requires an archival provider (Alchemy / Infura / your own
        // node), since free public endpoints typically only retain the last
        // ~128 blocks of state.
        uint256 forkBlock = vm.envOr("FORK_BLOCK", uint256(0));
        if (forkBlock == 0) {
            vm.createSelectFork(url);
        } else {
            vm.createSelectFork(url, forkBlock);
        }

        string memory artifact = vm.readFile("out/Executor.yul/QuarryExecutor.json");
        bytes memory bytecode = vm.parseJsonBytes(artifact, ".bytecode.object");
        address deployed;
        assembly {
            deployed := create(0, add(bytecode, 0x20), mload(bytecode))
        }
        require(deployed != address(0), "deploy failed");
        executor = deployed;
    }

    /// @dev Uniswap V2 constant-product output formula with the 0.3% fee.
    function _getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        internal
        pure
        returns (uint256)
    {
        uint256 amountInWithFee = amountIn * 997;
        return (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
    }

    function test_TwoHopRoundTrip_AgainstRealPools() public {
        // Confirm token ordering — both pairs have USDC=token0, WETH=token1.
        require(IUniswapV2Pair(UNIV2_WETH_USDC).token0() == USDC, "uniV2 token0 != USDC");
        require(IUniswapV2Pair(UNIV2_WETH_USDC).token1() == WETH, "uniV2 token1 != WETH");
        require(IUniswapV2Pair(SUSHI_WETH_USDC).token0() == USDC, "sushi token0 != USDC");
        require(IUniswapV2Pair(SUSHI_WETH_USDC).token1() == WETH, "sushi token1 != WETH");

        (uint112 uniUSDC, uint112 uniWETH,) = IUniswapV2Pair(UNIV2_WETH_USDC).getReserves();
        (uint112 sushiUSDC, uint112 sushiWETH,) = IUniswapV2Pair(SUSHI_WETH_USDC).getReserves();

        uint256 wethIn = 1 ether;

        // Pre-fund pool1 (Uniswap V2) with WETH — simulates the in-bundle
        // flashloan transfer that would precede the executor call on mainnet.
        // `deal` writes the ERC20 storage slot directly; balance grows, K is
        // satisfied when pool1.swap reads its own balance during the call.
        uint256 uniWethBalBefore = IERC20(WETH).balanceOf(UNIV2_WETH_USDC);
        deal(WETH, UNIV2_WETH_USDC, uniWethBalBefore + wethIn);

        // Hop 1 (Uniswap V2): WETH in (token1) → USDC out (token0).
        uint256 usdcOut = _getAmountOut(wethIn, uniWETH, uniUSDC);

        // Hop 2 (Sushiswap): USDC in (token0) → WETH out (token1).
        uint256 wethOut = _getAmountOut(usdcOut, sushiUSDC, sushiWETH);

        // Build the 220-byte packed calldata expected by the V2 executor.
        // Token ordering (USDC=t0, WETH=t1) → on Uniswap V2 we want token0 out
        // (USDC), so a0p1 = usdcOut, a1p1 = 0. On Sushi we want token1 out
        // (WETH), so a0p2 = 0, a1p2 = wethOut.
        bytes memory payload = abi.encodePacked(
            UNIV2_WETH_USDC,
            SUSHI_WETH_USDC,
            usdcOut,
            uint256(0),
            uint256(0),
            wethOut,
            WETH,
            uint256(0)
        );

        uint256 sushiUsdcBalBefore = IERC20(USDC).balanceOf(SUSHI_WETH_USDC);
        uint256 sushiWethBalBefore = IERC20(WETH).balanceOf(SUSHI_WETH_USDC);

        uint256 gasBefore = gasleft();
        (bool ok, bytes memory ret) = executor.call(payload);
        uint256 gasUsed = gasBefore - gasleft();

        assertTrue(ok, "real-pool two-hop should succeed");
        uint256 profit = abi.decode(ret, (uint256));
        assertEq(profit, wethOut, "profit must equal pool2's WETH payout");
        assertEq(IERC20(WETH).balanceOf(executor), wethOut, "executor must hold the payout");

        // Atomicity / mechanics sanity: pool2 received the USDC from pool1
        // (its USDC balance went up by usdcOut, its WETH balance went down by
        // wethOut).
        assertEq(
            IERC20(USDC).balanceOf(SUSHI_WETH_USDC) - sushiUsdcBalBefore,
            usdcOut,
            "pool2 must have received USDC from pool1"
        );
        assertEq(
            sushiWethBalBefore - IERC20(WETH).balanceOf(SUSHI_WETH_USDC),
            wethOut,
            "pool2 must have paid out WETH"
        );

        emit log_named_uint("wethIn (to pool1)", wethIn);
        emit log_named_uint("usdcOut (pool1 -> pool2)", usdcOut);
        emit log_named_uint("wethOut (pool2 -> executor)", wethOut);
        emit log_named_uint("fee loss (wethIn - wethOut)", wethIn - wethOut);
        emit log_named_uint("gas: real-pool two-hop", gasUsed);

        // Real-pool two-hop measured at 110,957 gas (2026-06-13, mainnet fork
        // at HEAD via publicnode). The bulk is the unavoidable Uniswap V2 +
        // Sushiswap swap() cost; the executor's own Yul body is ~6k. 130k is
        // the CONTRIBUTING.md non-negotiable — ~17% headroom over the 111k
        // baseline, enough to absorb block-to-block reserve variance on a
        // HEAD fork without masking a real regression.
        assertLt(gasUsed, 130_000, "real-pool two-hop must stay under 130k gas (baseline ~111k)");
    }
}
