// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockERC20, MockProfitablePool, MockAaveV3Pool} from "./mocks/Mocks.sol";

interface IFlashLoanProvider {
    function flashLoanSimple(
        address receiver,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

/// @notice V3 flashloan-path tests for the Yul executor. Uses `vm.etch` to
/// put MockAaveV3Pool bytecode at the canonical Aave V3 mainnet pool
/// address, so the executor's hardcoded caller() == AAVE_V3_POOL check
/// passes against the mock.
contract ExecutorFlashloanTest is Test {
    address internal constant AAVE_V3_POOL = 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2;

    address internal stranger = makeAddr("stranger");
    address internal executor;
    MockERC20 internal weth; // borrow asset (base) — also pool2's output token
    MockERC20 internal usdc; // intermediate
    MockProfitablePool internal pool1; // pays out USDC
    MockProfitablePool internal pool2; // pays out WETH

    function setUp() public {
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
        usdc.mint(address(pool1), 1_000_000 * 1e6);
        weth.mint(address(pool2), 1000 ether);

        // Etch our mock Aave pool's runtime bytecode at the real mainnet
        // address so the executor's hardcoded auth check passes. The mock
        // has no constructor state, so vm.etch alone is enough.
        MockAaveV3Pool template = new MockAaveV3Pool();
        vm.etch(AAVE_V3_POOL, address(template).code);
        // Fund the etched pool with WETH so it can serve flashloan requests.
        weth.mint(AAVE_V3_POOL, 1000 ether);
    }

    function _params(
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

    function test_Flashloan_ProfitableArb() public {
        // Borrow 1 WETH. Pool1 hands 1000 USDC to pool2. Pool2 hands 1.1 WETH
        // back to executor — gross profit 0.1 WETH. Aave's 5-bp premium on
        // 1 WETH is 0.0005 WETH, well within profit.
        uint256 amount = 1 ether;
        bytes memory params =
            _params(address(pool1), address(pool2), 0, 1000 * 1e6, 0, 1.1 ether, address(weth), 0);

        uint256 aavePoolBalBefore = weth.balanceOf(AAVE_V3_POOL);
        uint256 executorBalBefore = weth.balanceOf(executor);

        IFlashLoanProvider(AAVE_V3_POOL).flashLoanSimple(executor, address(weth), amount, params, 0);

        uint256 premium = (amount * 5) / 10_000;
        // Aave's WETH balance must net the premium (got back amount + premium).
        assertEq(
            weth.balanceOf(AAVE_V3_POOL), aavePoolBalBefore + premium, "Aave should net the premium"
        );
        // Executor keeps profit − premium.
        assertEq(
            weth.balanceOf(executor),
            executorBalBefore + 1.1 ether - amount - premium,
            "executor should keep profit minus premium"
        );
    }

    function test_Flashloan_InsufficientProfit_Reverts() public {
        // Pool2 hands back only 1.0001 WETH; gross profit 0.0001 WETH; Aave
        // wants 0.0005 WETH premium. Net is negative → revert.
        bytes memory params = _params(
            address(pool1), address(pool2), 0, 1000 * 1e6, 0, 1.0001 ether, address(weth), 0
        );

        vm.expectRevert();
        IFlashLoanProvider(AAVE_V3_POOL)
            .flashLoanSimple(executor, address(weth), 1 ether, params, 0);
    }

    function test_Flashloan_StrangerInitiator_Reverts() public {
        // Stranger calls Aave directly. Aave passes stranger as initiator.
        // Executor's check `initiator == owner` fails.
        bytes memory params =
            _params(address(pool1), address(pool2), 0, 1000 * 1e6, 0, 1.1 ether, address(weth), 0);

        vm.prank(stranger);
        vm.expectRevert();
        IFlashLoanProvider(AAVE_V3_POOL)
            .flashLoanSimple(executor, address(weth), 1 ether, params, 0);
    }

    function test_Flashloan_DirectCallByNonAave_Reverts() public {
        // Calling executeOperation directly (bypassing Aave) should revert
        // because msg.sender != AAVE_V3_POOL.
        bytes memory params =
            _params(address(pool1), address(pool2), 0, 1000 * 1e6, 0, 1.1 ether, address(weth), 0);
        bytes memory calldataPayload = abi.encodeWithSelector(
            bytes4(0x920f5c84), // executeOperation
            address(weth),
            uint256(1 ether),
            uint256(5 * 10 ** 14), // 0.05% premium
            address(this),
            params
        );
        (bool ok,) = executor.call(calldataPayload);
        assertFalse(ok, "non-Aave caller must be rejected");
    }

    function test_Flashloan_TokenInMismatch_Reverts() public {
        // params says tokenIn = USDC, but the flashloan asset is WETH. The
        // executor must catch this and revert (otherwise it'd execute with
        // a mismatched balance-check token).
        bytes memory params =
            _params(address(pool1), address(pool2), 0, 1000 * 1e6, 0, 1.1 ether, address(usdc), 0);

        vm.expectRevert();
        IFlashLoanProvider(AAVE_V3_POOL)
            .flashLoanSimple(executor, address(weth), 1 ether, params, 0);
    }

    function test_GasCeiling_Flashloan_WithMocks() public {
        bytes memory params =
            _params(address(pool1), address(pool2), 0, 1000 * 1e6, 0, 1.1 ether, address(weth), 0);
        uint256 g0 = gasleft();
        IFlashLoanProvider(AAVE_V3_POOL)
            .flashLoanSimple(executor, address(weth), 1 ether, params, 0);
        uint256 used = g0 - gasleft();
        // V2 mocks-only ~85k; flashloan adds the Aave round trip + transfer +
        // approve + transferFrom — measure and gate against runaway regression.
        assertLt(used, 200_000, "flashloan-with-mocks must stay under 200k gas");
        emit log_named_uint("gas: flashloan two-hop (mocks)", used);
    }
}
