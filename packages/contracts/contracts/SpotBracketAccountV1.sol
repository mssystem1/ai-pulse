// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./SpotOrderAccountV1.sol";

/// @notice Owner-funded OTOCO spot order. A keeper may execute the exact entry
/// and, when requested by the owner, retain only its received asset under the
/// owner's TP/SL levels. It cannot choose assets, levels, size, or recipient.
contract SpotBracketAccountV1 {
    enum State { None, Pending, PausedEntry, Protected, PausedProtection, Executed, Cancelled }
    struct Order {
        address sellToken;
        address buyToken;
        address oracleBase;
        address oracleQuote;
        uint128 entryAmount;
        uint128 positionAmount;
        uint128 entryTrigger;
        uint128 takeProfit;
        uint128 stopLoss;
        uint128 entryMinOut;
        uint64 expiry;
        uint64 nonce;
        bool triggerAbove;
        bool protectAfterFill;
        State state;
    }

    address public immutable owner;
    IPulseRegistry public immutable registry;
    IOracleRouterPulse public immutable oracle;
    uint256 public nextOrderId = 1;
    uint256 private locked = 1;
    mapping(uint256 => Order) public orders;

    event BracketCreated(uint256 indexed id,address indexed sellToken,address indexed buyToken,uint256 entryAmount,uint256 entryTrigger,uint256 takeProfit,uint256 stopLoss,bool triggerAbove,bool protectAfterFill);
    event EntryFilled(uint256 indexed id,address indexed adapter,uint256 amountIn,uint256 amountOut,bool protectedAfterFill);
    event ProtectionUpdated(uint256 indexed id,uint256 takeProfit,uint256 stopLoss,uint256 nonce);
    event OrderPaused(uint256 indexed id,bool paused,uint8 phase);
    event PositionClosed(uint256 indexed id,address indexed adapter,uint256 amountIn,uint256 amountOut);
    event OrderCancelled(uint256 indexed id,address indexed token,uint256 returnedAmount);

    modifier onlyOwner(){require(msg.sender==owner,"OWNER");_;}
    modifier nonReentrant(){require(locked==1,"REENTRANT");locked=2;_;locked=1;}

    constructor(address owner_,address registry_,address oracle_){
        require(owner_!=address(0)&&registry_!=address(0)&&oracle_!=address(0),"ZERO");
        owner=owner_;registry=IPulseRegistry(registry_);oracle=IOracleRouterPulse(oracle_);
    }

    function createOrder(
        address sellToken,address buyToken,address oracleBase,address oracleQuote,
        uint128 entryAmount,uint128 entryTrigger,bool triggerAbove,uint128 entryMinOut,
        uint128 takeProfit,uint128 stopLoss,bool protectAfterFill,uint64 expiry
    ) external onlyOwner nonReentrant returns(uint256 id){
        require(sellToken!=address(0)&&buyToken!=address(0)&&sellToken!=buyToken&&oracleBase!=address(0)&&oracleQuote!=address(0),"TOKEN");
        require(entryAmount>0&&entryTrigger>0&&entryMinOut>0&&expiry>block.timestamp,"INPUT");
        if(protectAfterFill) require(takeProfit>stopLoss&&takeProfit>0&&stopLoss>0,"LEVELS");
        require(IERC20Pulse(sellToken).transferFrom(owner,address(this),entryAmount),"TRANSFER");
        id=nextOrderId++;
        orders[id]=Order(sellToken,buyToken,oracleBase,oracleQuote,entryAmount,0,entryTrigger,takeProfit,stopLoss,entryMinOut,expiry,1,triggerAbove,protectAfterFill,State.Pending);
        emit BracketCreated(id,sellToken,buyToken,entryAmount,entryTrigger,takeProfit,stopLoss,triggerAbove,protectAfterFill);
    }

    function executeEntry(uint256 id,address adapter,bytes calldata adapterData) external nonReentrant returns(uint256 amountOut){
        Order storage o=orders[id];require(o.state==State.Pending,"STATE");_keeperAndAdapter(adapter);require(block.timestamp<=o.expiry,"EXPIRED");
        (uint256 price,)=oracle.readPrice(o.oracleBase,o.oracleQuote);require(o.triggerAbove?price>=o.entryTrigger:price<=o.entryTrigger,"NOT_TRIGGERED");
        o.state=State.Executed;
        uint256 beforeBalance=IERC20Pulse(o.buyToken).balanceOf(address(this));
        require(IERC20Pulse(o.sellToken).transfer(adapter,o.entryAmount),"TRANSFER");
        (bool ok,bytes memory result)=adapter.call(adapterData);require(ok&&result.length>=32,"EXECUTE");
        amountOut=IERC20Pulse(o.buyToken).balanceOf(address(this))-beforeBalance;
        require(amountOut>=o.entryMinOut&&amountOut==abi.decode(result,(uint256)),"MIN_OUT");
        if(o.protectAfterFill){require(amountOut<=type(uint128).max,"AMOUNT");o.positionAmount=uint128(amountOut);o.state=State.Protected;}
        else require(IERC20Pulse(o.buyToken).transfer(owner,amountOut),"PAYOUT");
        emit EntryFilled(id,adapter,o.entryAmount,amountOut,o.protectAfterFill);
    }

    function executeExit(uint256 id,address adapter,bytes calldata adapterData,uint256 minOut) external nonReentrant returns(uint256 amountOut){
        Order storage o=orders[id];require(o.state==State.Protected,"STATE");_keeperAndAdapter(adapter);require(block.timestamp<=o.expiry,"EXPIRED");
        (uint256 price,)=oracle.readPrice(o.buyToken,o.sellToken);require(price>=o.takeProfit||price<=o.stopLoss,"NOT_TRIGGERED");
        o.state=State.Executed;
        uint256 beforeBalance=IERC20Pulse(o.sellToken).balanceOf(address(this));
        require(IERC20Pulse(o.buyToken).transfer(adapter,o.positionAmount),"TRANSFER");
        (bool ok,bytes memory result)=adapter.call(adapterData);require(ok&&result.length>=32,"EXECUTE");
        amountOut=IERC20Pulse(o.sellToken).balanceOf(address(this))-beforeBalance;
        require(amountOut>=minOut&&amountOut==abi.decode(result,(uint256)),"MIN_OUT");
        require(IERC20Pulse(o.sellToken).transfer(owner,amountOut),"PAYOUT");
        emit PositionClosed(id,adapter,o.positionAmount,amountOut);
    }

    function updateProtection(uint256 id,uint128 takeProfit,uint128 stopLoss,uint64 expiry) external onlyOwner {
        Order storage o=orders[id];require(o.state==State.Protected||o.state==State.PausedProtection,"STATE");require(takeProfit>stopLoss&&stopLoss>0&&expiry>block.timestamp,"LEVELS");
        o.takeProfit=takeProfit;o.stopLoss=stopLoss;o.expiry=expiry;o.nonce++;emit ProtectionUpdated(id,takeProfit,stopLoss,o.nonce);
    }

    function setPaused(uint256 id,bool value) external onlyOwner {
        Order storage o=orders[id];
        if(o.state==State.Pending||o.state==State.PausedEntry)o.state=value?State.PausedEntry:State.Pending;
        else if(o.state==State.Protected||o.state==State.PausedProtection)o.state=value?State.PausedProtection:State.Protected;
        else revert("STATE");
        emit OrderPaused(id,value,o.state==State.PausedEntry||o.state==State.Pending?1:2);
    }

    function cancelAndWithdraw(uint256 id) external onlyOwner nonReentrant {
        Order storage o=orders[id];address token;uint256 amount;
        if(o.state==State.Pending||o.state==State.PausedEntry){token=o.sellToken;amount=o.entryAmount;}
        else if(o.state==State.Protected||o.state==State.PausedProtection){token=o.buyToken;amount=o.positionAmount;}
        else revert("STATE");
        o.state=State.Cancelled;require(IERC20Pulse(token).transfer(owner,amount),"TRANSFER");emit OrderCancelled(id,token,amount);
    }

    function _keeperAndAdapter(address adapter) private view {
        require(!registry.automationPaused()&&registry.spotKeepers(msg.sender),"KEEPER");require(registry.approvedAdapters(adapter),"ADAPTER");
    }
}
