// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./SpotOrderAccountV1.sol";

/// @notice Executes an exact, pre-built OKX route while independently
/// allowlisting the call target and ERC-20 approval spender. OKX deliberately
/// separates these contracts, and may upgrade either address.
contract OkxSwapAdapterV2 {
    address public immutable admin;
    mapping(address => bool) public approvedRouters;
    mapping(address => bool) public approvedSpenders;
    uint256 private locked = 1;

    event RouterSet(address indexed router, bool approved);
    event SpenderSet(address indexed spender, bool approved);
    event SwapExecuted(
        address indexed caller,
        address indexed router,
        address indexed spender,
        address sellToken,
        address buyToken,
        uint256 amountIn,
        uint256 amountOut,
        uint256 refundedInput
    );

    modifier onlyAdmin() {
        require(msg.sender == admin, "ADMIN");
        _;
    }

    modifier nonReentrant() {
        require(locked == 1, "REENTRANT");
        locked = 2;
        _;
        locked = 1;
    }

    constructor(address admin_) {
        require(admin_ != address(0), "ZERO");
        admin = admin_;
    }

    function setRouter(address router, bool approved) external onlyAdmin {
        require(router != address(0), "ZERO");
        approvedRouters[router] = approved;
        emit RouterSet(router, approved);
    }

    function setSpender(address spender, bool approved) external onlyAdmin {
        require(spender != address(0), "ZERO");
        approvedSpenders[spender] = approved;
        emit SpenderSet(spender, approved);
    }

    function execute(
        address router,
        address spender,
        address sellToken,
        address buyToken,
        uint256 amount,
        uint256 minOut,
        bytes calldata routerCalldata
    ) external nonReentrant returns (uint256 amountOut) {
        require(
            approvedRouters[router] && approvedSpenders[spender] &&
            sellToken != address(0) && buyToken != address(0) &&
            sellToken != buyToken && amount > 0,
            "INPUT"
        );
        uint256 sellBalance = IERC20Pulse(sellToken).balanceOf(address(this));
        require(sellBalance >= amount, "BALANCE");
        uint256 priorSellBalance = sellBalance - amount;
        uint256 beforeBuy = IERC20Pulse(buyToken).balanceOf(address(this));

        _approve(sellToken, spender, 0);
        _approve(sellToken, spender, amount);
        (bool ok,) = router.call(routerCalldata);
        require(ok, "ROUTER");
        _approve(sellToken, spender, 0);

        amountOut = IERC20Pulse(buyToken).balanceOf(address(this)) - beforeBuy;
        require(amountOut >= minOut, "MIN_OUT");
        require(IERC20Pulse(buyToken).transfer(msg.sender, amountOut), "PAYOUT");

        uint256 remainingSellBalance = IERC20Pulse(sellToken).balanceOf(address(this));
        uint256 refundedInput = remainingSellBalance > priorSellBalance
            ? remainingSellBalance - priorSellBalance
            : 0;
        if (refundedInput > 0) {
            require(IERC20Pulse(sellToken).transfer(msg.sender, refundedInput), "REFUND");
        }
        emit SwapExecuted(msg.sender, router, spender, sellToken, buyToken, amount, amountOut, refundedInput);
    }

    function rescue(address token, uint256 amount, address recipient) external onlyAdmin {
        require(recipient != address(0), "ZERO");
        require(IERC20Pulse(token).transfer(recipient, amount), "TRANSFER");
    }

    function _approve(address token, address spender, uint256 amount) private {
        (bool ok, bytes memory result) = token.call(
            abi.encodeWithSignature("approve(address,uint256)", spender, amount)
        );
        require(ok && (result.length == 0 || abi.decode(result, (bool))), "APPROVE");
    }
}
