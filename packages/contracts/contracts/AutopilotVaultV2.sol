// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import "./SpotOrderAccountV1.sol";

/// @notice Owner-custodied trading vault. The executor can trade, but cannot withdraw,
/// change policy, add assets, bypass oracle valuation, or select an unapproved adapter.
contract AutopilotVaultV2 {
    address public immutable owner;
    address public immutable settlementAsset;
    IPulseRegistry public immutable registry;
    IOracleRouterPulse public immutable oracle;
    bytes32 public policyHash;
    uint64 public policyVersion = 1;
    uint64 public actionNonce;
    bool public paused = true;
    uint128 public maxTradeValue;
    uint128 public dailyTurnoverCap;
    uint16 public maxSlippageBps;
    uint16 public maxDailyLossBps;
    uint64 public cooldown;
    uint64 public expiry;
    uint64 public lastActionAt;
    uint64 public turnoverDay;
    uint256 public dailyTurnover;
    uint256 public dayStartValue;
    uint256 private locked = 1;
    address[] private assets;
    mapping(address => bool) public allowedAssets;
    mapping(address => uint256) public exposureCap;

    event PolicyUpdated(bytes32 indexed policyHash, uint256 version);
    event AssetConfigured(address indexed asset, bool allowed, uint256 exposureCap);
    event LimitsConfigured(uint256 maxTradeValue,uint256 dailyTurnoverCap,uint256 maxSlippageBps,uint256 maxDailyLossBps,uint256 cooldown,uint256 expiry);
    event Executed(bytes32 indexed decisionId,address indexed adapter,uint256 nonce,address sellToken,address buyToken,uint256 sellAmount,uint256 amountOut,bytes32 evidenceHash);
    event Paused(bool paused);
    event OwnerWithdrawal(address indexed token,uint256 amount);
    modifier onlyOwner(){require(msg.sender==owner,"OWNER");_;}
    modifier nonReentrant(){require(locked==1,"REENTRANT");locked=2;_;locked=1;}

    constructor(address owner_,address settlement_,address registry_,address oracle_,bytes32 policyHash_){
        require(owner_!=address(0)&&settlement_!=address(0)&&registry_!=address(0)&&oracle_!=address(0)&&policyHash_!=bytes32(0),"INPUT");
        owner=owner_;settlementAsset=settlement_;registry=IPulseRegistry(registry_);oracle=IOracleRouterPulse(oracle_);policyHash=policyHash_;
        allowedAssets[settlement_]=true;assets.push(settlement_);
    }
    function assetsOf() external view returns(address[] memory){return assets;}
    function updatePolicy(bytes32 next) external onlyOwner {require(next!=bytes32(0),"POLICY");policyHash=next;policyVersion++;paused=true;emit PolicyUpdated(next,policyVersion);emit Paused(true);}
    function configureAsset(address asset,bool allowed,uint256 cap) external onlyOwner {
        require(asset!=address(0),"ASSET");
        if(allowed&&!allowedAssets[asset]){require(assets.length<16,"ASSET_LIMIT");assets.push(asset);}
        require(asset==settlementAsset||cap>0||!allowed,"CAP");allowedAssets[asset]=allowed;exposureCap[asset]=cap;policyVersion++;paused=true;emit AssetConfigured(asset,allowed,cap);emit Paused(true);
    }
    function configureLimits(uint128 maxTrade,uint128 dailyCap,uint16 slippageBps,uint16 dailyLossBps,uint64 cooldown_,uint64 expiry_) external onlyOwner {
        require(maxTrade>0&&dailyCap>=maxTrade&&slippageBps<=1000&&dailyLossBps<=3000&&cooldown_>=30&&expiry_>block.timestamp,"LIMITS");
        maxTradeValue=maxTrade;dailyTurnoverCap=dailyCap;maxSlippageBps=slippageBps;maxDailyLossBps=dailyLossBps;cooldown=cooldown_;expiry=expiry_;policyVersion++;paused=true;
        emit LimitsConfigured(maxTrade,dailyCap,slippageBps,dailyLossBps,cooldown_,expiry_);emit Paused(true);
    }
    function setPaused(bool value) external onlyOwner {if(!value)require(maxTradeValue>0&&dailyTurnoverCap>0,"CONFIG");paused=value;emit Paused(value);}
    function portfolioValue() public view returns(uint256 total){for(uint256 i=0;i<assets.length;i++){address token=assets[i];if(!allowedAssets[token])continue;uint256 balance=IERC20Pulse(token).balanceOf(address(this));if(balance==0)continue;total+=_value(token,balance);}}
    function execute(bytes32 decisionId,uint64 expectedVersion,uint64 expectedNonce,address adapter,address sellToken,address buyToken,uint256 sellAmount,uint256 minOut,bytes calldata adapterData,bytes32 evidenceHash) external nonReentrant {
        require(!paused&&!registry.automationPaused(),"PAUSED");require(registry.autopilotExecutors(msg.sender),"EXECUTOR");require(registry.approvedAdapters(adapter),"ADAPTER");
        require(expectedVersion==policyVersion&&expectedNonce==actionNonce,"NONCE");require(decisionId!=bytes32(0)&&evidenceHash!=bytes32(0)&&allowedAssets[sellToken]&&allowedAssets[buyToken]&&sellToken!=buyToken&&sellAmount>0,"INPUT");
        require(expiry>block.timestamp&&block.timestamp>=lastActionAt+cooldown,"TIME");uint256 tradeValue=_value(sellToken,sellAmount);require(tradeValue<=maxTradeValue,"MAX_TRADE");
        uint64 day=uint64(block.timestamp/1 days);uint256 beforeValue=portfolioValue();if(day!=turnoverDay){turnoverDay=day;dailyTurnover=0;dayStartValue=beforeValue;}require(dailyTurnover+tradeValue<=dailyTurnoverCap,"DAILY_TURNOVER");
        uint256 oracleMinimum=_minimumOut(sellToken,buyToken,sellAmount);require(minOut>=oracleMinimum,"SLIPPAGE");
        dailyTurnover+=tradeValue;lastActionAt=uint64(block.timestamp);actionNonce++;require(IERC20Pulse(sellToken).transfer(adapter,sellAmount),"TRANSFER");
        (bool ok,bytes memory result)=adapter.call(adapterData);require(ok&&result.length>=32,"EXECUTE");uint256 amountOut=abi.decode(result,(uint256));require(amountOut>=minOut,"MIN_OUT");
        uint256 buyExposure=_value(buyToken,IERC20Pulse(buyToken).balanceOf(address(this)));if(buyToken!=settlementAsset)require(buyExposure<=exposureCap[buyToken],"EXPOSURE");
        uint256 afterValue=portfolioValue();require(afterValue*10000>=beforeValue*(10000-maxSlippageBps),"TRADE_LOSS");require(dayStartValue==0||afterValue*10000>=dayStartValue*(10000-maxDailyLossBps),"DAILY_LOSS");
        emit Executed(decisionId,adapter,expectedNonce,sellToken,buyToken,sellAmount,amountOut,evidenceHash);
    }
    function withdraw(address token,uint256 amount) external onlyOwner nonReentrant {require(IERC20Pulse(token).transfer(owner,amount),"TRANSFER");emit OwnerWithdrawal(token,amount);}
    function _minimumOut(address sell,address buy,uint256 amount) private view returns(uint256){uint256 sellValue=_value(sell,amount);uint256 buyPrice=buy==settlementAsset?1e18:_price(buy);return sellValue*(10**_decimals(buy))*1e18/buyPrice/(10**_decimals(settlementAsset))*(10000-maxSlippageBps)/10000;}
    function _value(address token,uint256 amount) private view returns(uint256){if(token==settlementAsset)return amount;return amount*_price(token)*(10**_decimals(settlementAsset))/(10**_decimals(token))/1e18;}
    function _price(address token) private view returns(uint256 price){(price,)=oracle.readPrice(token,settlementAsset);}
    function _decimals(address token) private view returns(uint256 d){(bool ok,bytes memory data)=token.staticcall(abi.encodeWithSignature("decimals()"));require(ok&&data.length>=32,"DECIMALS");d=abi.decode(data,(uint256));require(d<=24,"DECIMALS_RANGE");}
}
