// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20Pulse { function transfer(address,uint256) external returns (bool); function transferFrom(address,address,uint256) external returns (bool); function balanceOf(address) external view returns (uint256); }
interface IPulseRegistry { function approvedAdapters(address) external view returns (bool); function spotKeepers(address) external view returns (bool); function autopilotExecutors(address) external view returns (bool); function automationPaused() external view returns (bool); }
interface IOracleRouterPulse { function readPrice(address,address) external view returns(uint256,uint256); }

contract SpotOrderAccountV1 {
    enum State { None, Protected, Paused, Closed, Cancelled }
    struct Position { address asset; address settlement; uint128 amount; uint128 takeProfit; uint128 stopLoss; uint64 expiry; uint64 nonce; State state; }
    address public immutable owner;
    IPulseRegistry public immutable registry;
    IOracleRouterPulse public immutable oracle;
    uint256 public nextPositionId = 1;
    uint256 private locked = 1;
    mapping(uint256 => Position) public positions;

    event PositionCreated(uint256 indexed id, address indexed asset, uint256 amount, uint256 takeProfit, uint256 stopLoss);
    event ProtectionUpdated(uint256 indexed id, uint256 takeProfit, uint256 stopLoss, uint256 nonce);
    event PositionPaused(uint256 indexed id, bool paused);
    event PositionClosed(uint256 indexed id, address indexed adapter, uint256 amountIn, uint256 amountOut);
    event PositionCancelled(uint256 indexed id, uint256 returnedAmount);

    modifier onlyOwner() { require(msg.sender == owner, "OWNER"); _; }
    modifier nonReentrant() { require(locked == 1, "REENTRANT"); locked = 2; _; locked = 1; }
    constructor(address owner_, address registry_, address oracle_) { require(owner_ != address(0) && registry_ != address(0) && oracle_ != address(0), "ZERO"); owner = owner_; registry = IPulseRegistry(registry_); oracle = IOracleRouterPulse(oracle_); }

    function createPosition(address asset, address settlement, uint128 amount, uint128 takeProfit, uint128 stopLoss, uint64 expiry) external onlyOwner nonReentrant returns (uint256 id) {
        require(asset != address(0) && settlement != address(0) && asset != settlement && amount > 0, "INPUT");
        require(takeProfit > stopLoss, "LEVELS");
        require(IERC20Pulse(asset).transferFrom(owner, address(this), amount), "TRANSFER");
        id = nextPositionId++;
        positions[id] = Position(asset, settlement, amount, takeProfit, stopLoss, expiry, 1, State.Protected);
        emit PositionCreated(id, asset, amount, takeProfit, stopLoss);
    }
    function updateProtection(uint256 id, uint128 takeProfit, uint128 stopLoss, uint64 expiry) external onlyOwner { Position storage p = positions[id]; require(p.state == State.Protected || p.state == State.Paused, "STATE"); require(takeProfit > stopLoss, "LEVELS"); p.takeProfit = takeProfit; p.stopLoss = stopLoss; p.expiry = expiry; p.nonce++; emit ProtectionUpdated(id, takeProfit, stopLoss, p.nonce); }
    function setPaused(uint256 id, bool paused) external onlyOwner { Position storage p = positions[id]; require(p.state == State.Protected || p.state == State.Paused, "STATE"); p.state = paused ? State.Paused : State.Protected; emit PositionPaused(id, paused); }
    function executeExit(uint256 id, address adapter, bytes calldata adapterData, uint256 minOut) external nonReentrant returns (uint256 amountOut) {
        Position storage p = positions[id]; require(p.state == State.Protected, "STATE"); require(!registry.automationPaused() && registry.spotKeepers(msg.sender), "KEEPER"); require(registry.approvedAdapters(adapter), "ADAPTER"); require(p.expiry == 0 || block.timestamp <= p.expiry, "EXPIRED");
        (uint256 triggerPrice,) = oracle.readPrice(p.asset,p.settlement); require(triggerPrice >= p.takeProfit || triggerPrice <= p.stopLoss,"NOT_TRIGGERED");
        p.state = State.Closed; uint256 beforeBalance = IERC20Pulse(p.settlement).balanceOf(address(this)); require(IERC20Pulse(p.asset).transfer(adapter, p.amount), "TRANSFER");
        (bool ok,) = adapter.call(adapterData); require(ok, "EXECUTE"); amountOut = IERC20Pulse(p.settlement).balanceOf(address(this)) - beforeBalance; require(amountOut >= minOut, "MIN_OUT"); require(IERC20Pulse(p.settlement).transfer(owner, amountOut), "PAYOUT"); emit PositionClosed(id, adapter, p.amount, amountOut);
    }
    function cancelAndWithdraw(uint256 id) external onlyOwner nonReentrant { Position storage p = positions[id]; require(p.state == State.Protected || p.state == State.Paused, "STATE"); p.state = State.Cancelled; uint256 amount = p.amount; require(IERC20Pulse(p.asset).transfer(owner, amount), "TRANSFER"); emit PositionCancelled(id, amount); }
}
