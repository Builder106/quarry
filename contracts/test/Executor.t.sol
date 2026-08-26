// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockERC20, MockProfitablePool} from "./mocks/Mocks.sol";

/// @notice V2 tests for the Yul executor — full two-hop cross-DEX arbitrage
/// against two mock Uniswap-V2-shaped pools. The fork-replay tests against
/// real mainnet pools (where the strict 35k two-hop gas gate from
/// CONTRIBUTING.md applies) live in ExecutorFork.t.sol once V3 lands.
contract ExecutorTest is Test {
    address internal stranger = makeAddr("stranger");
    address internal executor;

    MockERC20 internal weth; // base asset — what the profit guard measures
    MockERC20 internal usdc; // intermediate token between the two hops
    MockProfitablePool internal pool1; // first hop, pays out USDC
    MockProfitablePool internal pool2; // second hop, pays out WETH

    function setUp() public {
        // vm.getCode rejects Yul artifacts (abi field is null) — read the
        // bytecode directly from the artifact JSON.
        string memory artifact = vm.readFile("out/Executor.yul/QuarryExecutor.json");
        bytes memory bytecode = vm.parseJsonBytes(artifact, ".bytecode.object");
        address deployed;
        assembly {
            deployed := create(0, add(bytecode, 0x20), mload(bytecode))
        }
        require(deployed != address(0), "deploy failed");
        executor = deployed;

        weth = new MockERC20();
        usdc = new MockERC20();
        pool1 = new MockProfitablePool(usdc);
        pool2 = new MockProfitablePool(weth);

        // Fund both pools generously. Pool1's USDC reserve becomes "what
        // pool2 receives on hop 1"; pool2's WETH reserve becomes "what the
        // executor receives on hop 2".
        usdc.mint(address(pool1), 1_000_000 * 1e6);
        weth.mint(address(pool2), 1000 ether);
    }

    function _payload(
        address pool1_,
        address pool2_,
        uint256 a0p1,
        uint256 a1p1,
        uint256 a0p2,
        uint256 a1p2,
        address tokenIn,
        uint256 minProfit
    ) internal pure returns (bytes memory) {
        return abi.encodePacked(pool1_, pool2_, a0p1, a1p1, a0p2, a1p2, tokenIn, minProfit);
    }

    function test_ProfitableArb_TwoHop() public {
        // Hop 1: pool1 hands 1,000 USDC to pool2.
        // Hop 2: pool2 hands 1.1 WETH back to executor.
        bytes memory payload = _payload(
            address(pool1), address(pool2), 0, 1000 * 1e6, 0, 1.1 ether, address(weth), 1 ether
        );
        (bool ok, bytes memory ret) = executor.call(payload);
        assertTrue(ok, "profitable two-hop should succeed");
        assertEq(abi.decode(ret, (uint256)), 1.1 ether, "profit must equal WETH payout");
        assertEq(weth.balanceOf(executor), 1.1 ether);
        // Sanity: pool2 received the USDC from pool1.
        assertEq(usdc.balanceOf(address(pool2)), 1000 * 1e6);
    }

    function test_InsufficientProfit_Reverts() public {
        // Pool2 hands back only 0.5 WETH but we required 1 WETH minimum.
        bytes memory payload = _payload(
            address(pool1), address(pool2), 0, 1000 * 1e6, 0, 0.5 ether, address(weth), 1 ether
        );
        (bool ok,) = executor.call(payload);
        assertFalse(ok, "must revert when profit < minProfit");
        // Atomic: the USDC transfer in hop 1 was undone.
        assertEq(usdc.balanceOf(address(pool2)), 0, "hop 1 must be unwound");
        assertEq(weth.balanceOf(executor), 0);
    }

    function test_Hop1Reverts_StopsAtomically() public {
        // Empty pool1 — no USDC to hand to pool2 — hop 1 reverts on the
        // inner transfer, which bubbles up to the executor's CALL guard.
        MockProfitablePool emptyPool1 = new MockProfitablePool(usdc);
        bytes memory payload = _payload(
            address(emptyPool1), address(pool2), 0, 1000 * 1e6, 0, 1.1 ether, address(weth), 0
        );
        (bool ok,) = executor.call(payload);
        assertFalse(ok, "hop 1 failure must revert");
        assertEq(weth.balanceOf(executor), 0);
    }

    function test_Hop2Reverts_StopsAtomically() public {
        // Empty pool2 — pool1 successfully sends USDC to pool2, but pool2
        // can't pay out WETH. The whole transaction reverts and the USDC
        // transfer is undone (the load-bearing atomicity property).
        MockProfitablePool emptyPool2 = new MockProfitablePool(weth);
        bytes memory payload = _payload(
            address(pool1), address(emptyPool2), 0, 1000 * 1e6, 0, 1.1 ether, address(weth), 0
        );
        (bool ok,) = executor.call(payload);
        assertFalse(ok, "hop 2 failure must revert");
        // Atomic: pool2's USDC balance never changed.
        assertEq(usdc.balanceOf(address(emptyPool2)), 0, "hop 1 must be unwound");
        // And pool1's USDC reserve is intact.
        assertEq(usdc.balanceOf(address(pool1)), 1_000_000 * 1e6);
    }

    function test_StrangerCall_Reverts() public {
        bytes memory payload =
            _payload(address(pool1), address(pool2), 0, 1000 * 1e6, 0, 1.1 ether, address(weth), 0);
        vm.prank(stranger);
        (bool ok,) = executor.call(payload);
        assertFalse(ok, "stranger must not pass auth");
    }

    function testFuzz_TwoHopProfit(uint64 wethPayout, uint64 minProfit) public {
        vm.assume(wethPayout > 0 && uint256(wethPayout) <= 100 ether);
        bytes memory payload = _payload(
            address(pool1),
            address(pool2),
            0,
            100 * 1e6,
            0,
            uint256(wethPayout),
            address(weth),
            uint256(minProfit)
        );
        (bool ok, bytes memory ret) = executor.call(payload);
        if (uint256(wethPayout) >= uint256(minProfit)) {
            assertTrue(ok, "profit >= minProfit should succeed");
            assertEq(abi.decode(ret, (uint256)), uint256(wethPayout));
        } else {
            assertFalse(ok, "profit < minProfit must revert");
        }
    }

    /// @dev Gas snapshot for the V2-with-mocks profitable two-hop path. The
    /// strict 35k two-hop gate from CONTRIBUTING.md applies against real
    /// Uniswap V2 pools on a forked mainnet — that gate moves to
    /// ExecutorFork.t.sol in V3. Here we guard against regressions in the
    /// executor's own opcodes on top of mock infrastructure.
    function test_GasCeiling_TwoHop_WithMocks() public {
        bytes memory payload =
            _payload(address(pool1), address(pool2), 0, 1000 * 1e6, 0, 1.1 ether, address(weth), 0);
        uint256 g0 = gasleft();
        (bool ok,) = executor.call(payload);
        uint256 used = g0 - gasleft();
        assertTrue(ok);
        // V1-with-mocks settled around 49k. Adding the second hop:
        //   + ~26k for one more MockPool::swap (the second mock CALL)
        //   + ~25k for the inner MockERC20::transfer (USDC -> pool2)
        // → V2 is roughly double, with some shared overhead amortized.
        // Ceiling at 100k gives 25k headroom for solar/Solc version drift.
        assertLt(used, 100_000, "two-hop-with-mocks must stay under 100k gas");
        emit log_named_uint("gas: two-hop swap (mocks)", used);
    }
}
