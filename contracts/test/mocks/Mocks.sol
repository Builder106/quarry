// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Minimal ERC20 used only by the V1 test suite. Strict on insufficient
/// balance so the executor's revert path is exercised end-to-end.
contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function burnFrom(address target, uint256 amount) external {
        uint256 balance = balanceOf[target];
        require(balance >= amount, "MockERC20: insufficient");
        unchecked {
            balanceOf[target] = balance - amount;
            totalSupply -= amount;
        }
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        uint256 from = balanceOf[msg.sender];
        require(from >= amount, "MockERC20: insufficient");
        unchecked {
            balanceOf[msg.sender] = from - amount;
            balanceOf[to] += amount;
        }
        return true;
    }

    mapping(address => mapping(address => uint256)) public allowance;

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "MockERC20: not allowed");
            allowance[from][msg.sender] = allowed - amount;
        }
        uint256 fromBal = balanceOf[from];
        require(fromBal >= amount, "MockERC20: insufficient");
        unchecked {
            balanceOf[from] = fromBal - amount;
            balanceOf[to] += amount;
        }
        return true;
    }
}

/// @notice Stand-in for a Uniswap V2 pair. Honors only the swap() selector and
/// transfers whichever amount is non-zero to `to`. Skips the K invariant — the
/// V1 executor test cares about the call orchestration and the balance guard,
/// not the constant-product accounting. Real-pool tests come in V2 via an
/// anvil mainnet fork.
contract MockProfitablePool {
    MockERC20 public immutable token;

    constructor(MockERC20 _token) {
        token = _token;
    }

    /// @dev Matches Uniswap V2 IUniswapV2Pair.swap signature exactly so the
    /// executor's 0x022c0d9f selector + ABI layout hits cleanly.
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata) external {
        uint256 amount = amount0Out > 0 ? amount0Out : amount1Out;
        require(amount > 0, "MockPool: zero output");
        token.transfer(to, amount);
    }
}

interface IFlashLoanSimpleReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

/// @notice Stand-in for Aave V3's Pool.flashLoanSimple. Premium is 5 bps,
/// matching mainnet. Honors only flashLoanSimple — no supply/borrow/etc.
/// Tests put this contract's bytecode at the real Aave V3 mainnet address
/// via `vm.etch` so the executor's hardcoded caller() check passes.
contract MockAaveV3Pool {
    uint256 public constant FLASHLOAN_PREMIUM_BPS = 5; // 0.05%

    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 /* referralCode */
    ) external {
        uint256 premium = (amount * FLASHLOAN_PREMIUM_BPS) / 10_000;

        // 1. Transfer the asset to the receiver.
        MockERC20(asset).transfer(receiverAddress, amount);

        // 2. Invoke the receiver's executeOperation callback. The initiator
        //    is msg.sender — the address that called flashLoanSimple. The
        //    Yul executor checks this matches its stored owner.
        bool ok = IFlashLoanSimpleReceiver(receiverAddress)
            .executeOperation(asset, amount, premium, msg.sender, params);
        require(ok, "MockAavePool: executeOperation returned false");

        // 3. Pull back amount + premium. The receiver must have approved us.
        IERC20Like(asset).transferFrom(receiverAddress, address(this), amount + premium);
    }
}

interface IERC20Like {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Completes a profitable-pool-shaped swap while reducing the executor's
/// tracked-token balance, isolating its negative balance change guard.
contract MockDrainingPool {
    MockERC20 public immutable drainToken;
    MockERC20 public immutable outputToken;
    address public immutable target;
    uint256 public immutable drainAmount;

    constructor(
        MockERC20 _drainToken,
        MockERC20 _outputToken,
        address _target,
        uint256 _drainAmount
    ) {
        drainToken = _drainToken;
        outputToken = _outputToken;
        target = _target;
        drainAmount = _drainAmount;
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata) external {
        uint256 outputAmount = amount0Out > 0 ? amount0Out : amount1Out;
        require(outputAmount > 0, "MockDrainingPool: zero output");
        drainToken.burnFrom(target, drainAmount);
        outputToken.transfer(to, outputAmount);
    }
}
