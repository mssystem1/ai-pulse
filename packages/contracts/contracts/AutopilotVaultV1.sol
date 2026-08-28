// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import "./SpotOrderAccountV1.sol";

contract AutopilotVaultV1 {
    address public immutable owner; address public immutable settlementAsset; IPulseRegistry public immutable registry;
    bytes32 public policyHash; uint64 public policyVersion = 1; uint64 public actionNonce; bool public paused;
    uint128 public maxTradeAmount; uint128 public dailyTurnoverCap; uint64 public cooldown; uint64 public expiry; uint64 public lastActionAt; uint64 public turnoverDay; uint256 public dailyTurnover;
    uint256 private locked = 1;
    event PolicyUpdated(bytes32 indexed policyHash, uint256 version);
    event Executed(bytes32 indexed decisionId, address indexed adapter, uint256 nonce, bytes32 evidenceHash);
    event Paused(bool paused); event OwnerWithdrawal(address indexed token, uint256 amount);
    modifier onlyOwner(){ require(msg.sender == owner,"OWNER"); _; } modifier nonReentrant(){ require(locked==1,"REENTRANT"); locked=2;_;locked=1; }
    constructor(address owner_, address settlement_, address registry_, bytes32 policyHash_){ require(owner_!=address(0)&&settlement_!=address(0)&&registry_!=address(0),"ZERO"); owner=owner_;settlementAsset=settlement_;registry=IPulseRegistry(registry_);policyHash=policyHash_; }
    function updatePolicy(bytes32 next) external onlyOwner { require(next != bytes32(0),"POLICY"); policyHash=next; policyVersion++; emit PolicyUpdated(next,policyVersion); }
    function configureLimits(uint128 maxTrade,uint128 dailyCap,uint64 cooldown_,uint64 expiry_) external onlyOwner {require(maxTrade>0&&dailyCap>=maxTrade&&cooldown_>=30&&expiry_>block.timestamp,"LIMITS");maxTradeAmount=maxTrade;dailyTurnoverCap=dailyCap;cooldown=cooldown_;expiry=expiry_;policyVersion++;}
    function setPaused(bool value) external onlyOwner { paused=value; emit Paused(value); }
    function execute(bytes32 decisionId,uint64 expectedVersion,uint64 expectedNonce,address adapter,address sellToken,uint256 sellAmount,bytes calldata adapterData,bytes32 evidenceHash) external nonReentrant {
        require(!paused&&!registry.automationPaused(),"PAUSED"); require(registry.autopilotExecutors(msg.sender),"EXECUTOR"); require(registry.approvedAdapters(adapter),"ADAPTER"); require(expectedVersion==policyVersion&&expectedNonce==actionNonce,"NONCE"); require(decisionId!=bytes32(0)&&evidenceHash!=bytes32(0)&&sellAmount>0&&sellAmount<=maxTradeAmount,"INPUT"); require(expiry>block.timestamp&&block.timestamp>=lastActionAt+cooldown,"TIME"); uint64 day=uint64(block.timestamp/1 days);if(day!=turnoverDay){turnoverDay=day;dailyTurnover=0;}require(dailyTurnover+sellAmount<=dailyTurnoverCap,"DAILY_CAP");dailyTurnover+=sellAmount;lastActionAt=uint64(block.timestamp);actionNonce++; require(IERC20Pulse(sellToken).transfer(adapter,sellAmount),"TRANSFER"); (bool ok,)=adapter.call(adapterData); require(ok,"EXECUTE"); emit Executed(decisionId,adapter,expectedNonce,evidenceHash);
    }
    function withdraw(address token,uint256 amount) external onlyOwner nonReentrant { require(IERC20Pulse(token).transfer(owner,amount),"TRANSFER"); emit OwnerWithdrawal(token,amount); }
}
