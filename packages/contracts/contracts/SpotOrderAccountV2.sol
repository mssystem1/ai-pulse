// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import "./SpotOrderAccountV1.sol";

/// @notice Connected-wallet owned conditional order account supporting both
/// protective OCO exits and buy/sell limit entries without a delegated wallet.
contract SpotOrderAccountV2 {
    enum State { None, Active, Paused, Filled, Cancelled }
    struct Order {address sellToken;address buyToken;address oracleBase;address oracleQuote;uint128 amount;uint128 triggerPrice;uint128 minOut;uint64 expiry;uint64 nonce;bool triggerAbove;State state;}
    address public immutable owner;IPulseRegistry public immutable registry;IOracleRouterPulse public immutable oracle;uint256 public nextOrderId=1;uint256 private locked=1;mapping(uint256=>Order) public orders;
    event OrderCreated(uint256 indexed id,address indexed sellToken,address indexed buyToken,uint256 amount,uint256 triggerPrice,bool triggerAbove,uint256 minOut);
    event OrderUpdated(uint256 indexed id,uint256 triggerPrice,bool triggerAbove,uint256 minOut,uint256 nonce);event OrderPaused(uint256 indexed id,bool paused);
    event OrderFilled(uint256 indexed id,address indexed adapter,uint256 amountIn,uint256 amountOut);event OrderCancelled(uint256 indexed id,uint256 returnedAmount);
    modifier onlyOwner(){require(msg.sender==owner,"OWNER");_;}modifier nonReentrant(){require(locked==1,"REENTRANT");locked=2;_;locked=1;}
    constructor(address owner_,address registry_,address oracle_){require(owner_!=address(0)&&registry_!=address(0)&&oracle_!=address(0),"ZERO");owner=owner_;registry=IPulseRegistry(registry_);oracle=IOracleRouterPulse(oracle_);}
    function createOrder(address sellToken,address buyToken,address oracleBase,address oracleQuote,uint128 amount,uint128 triggerPrice,bool triggerAbove,uint128 minOut,uint64 expiry) external onlyOwner nonReentrant returns(uint256 id){
        require(sellToken!=address(0)&&buyToken!=address(0)&&sellToken!=buyToken&&oracleBase!=address(0)&&oracleQuote!=address(0)&&amount>0&&triggerPrice>0&&minOut>0&&expiry>block.timestamp,"INPUT");
        require(IERC20Pulse(sellToken).transferFrom(owner,address(this),amount),"TRANSFER");id=nextOrderId++;orders[id]=Order(sellToken,buyToken,oracleBase,oracleQuote,amount,triggerPrice,minOut,expiry,1,triggerAbove,State.Active);emit OrderCreated(id,sellToken,buyToken,amount,triggerPrice,triggerAbove,minOut);
    }
    function updateOrder(uint256 id,uint128 triggerPrice,bool triggerAbove,uint128 minOut,uint64 expiry) external onlyOwner {Order storage o=orders[id];require(o.state==State.Active||o.state==State.Paused,"STATE");require(triggerPrice>0&&minOut>0&&expiry>block.timestamp,"INPUT");o.triggerPrice=triggerPrice;o.triggerAbove=triggerAbove;o.minOut=minOut;o.expiry=expiry;o.nonce++;emit OrderUpdated(id,triggerPrice,triggerAbove,minOut,o.nonce);}
    function setPaused(uint256 id,bool value) external onlyOwner {Order storage o=orders[id];require(o.state==State.Active||o.state==State.Paused,"STATE");o.state=value?State.Paused:State.Active;emit OrderPaused(id,value);}
    function execute(uint256 id,address adapter,bytes calldata adapterData) external nonReentrant returns(uint256 amountOut){Order storage o=orders[id];require(o.state==State.Active,"STATE");require(!registry.automationPaused()&&registry.spotKeepers(msg.sender),"KEEPER");require(registry.approvedAdapters(adapter),"ADAPTER");require(block.timestamp<=o.expiry,"EXPIRED");(uint256 price,)=oracle.readPrice(o.oracleBase,o.oracleQuote);require(o.triggerAbove?price>=o.triggerPrice:price<=o.triggerPrice,"NOT_TRIGGERED");o.state=State.Filled;uint256 beforeBalance=IERC20Pulse(o.buyToken).balanceOf(address(this));require(IERC20Pulse(o.sellToken).transfer(adapter,o.amount),"TRANSFER");(bool ok,bytes memory result)=adapter.call(adapterData);require(ok&&result.length>=32,"EXECUTE");amountOut=IERC20Pulse(o.buyToken).balanceOf(address(this))-beforeBalance;require(amountOut>=o.minOut&&amountOut==abi.decode(result,(uint256)),"MIN_OUT");require(IERC20Pulse(o.buyToken).transfer(owner,amountOut),"PAYOUT");emit OrderFilled(id,adapter,o.amount,amountOut);}
    function cancelAndWithdraw(uint256 id) external onlyOwner nonReentrant {Order storage o=orders[id];require(o.state==State.Active||o.state==State.Paused,"STATE");o.state=State.Cancelled;require(IERC20Pulse(o.sellToken).transfer(owner,o.amount),"TRANSFER");emit OrderCancelled(id,o.amount);}
    function cancelMany(uint256[] calldata ids) external onlyOwner nonReentrant {for(uint256 i=0;i<ids.length;i++){Order storage o=orders[ids[i]];if(o.state!=State.Active&&o.state!=State.Paused)continue;o.state=State.Cancelled;require(IERC20Pulse(o.sellToken).transfer(owner,o.amount),"TRANSFER");emit OrderCancelled(ids[i],o.amount);}}
}
