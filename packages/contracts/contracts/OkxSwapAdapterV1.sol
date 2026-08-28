// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import "./SpotOrderAccountV1.sol";

contract OkxSwapAdapterV1 {
    address public immutable admin; mapping(address=>bool) public approvedRouters; uint256 private locked=1;
    event RouterSet(address indexed router,bool approved); event SwapExecuted(address indexed caller,address indexed router,address sellToken,address buyToken,uint256 amountIn,uint256 amountOut);
    modifier onlyAdmin(){require(msg.sender==admin,"ADMIN");_;} modifier nonReentrant(){require(locked==1,"REENTRANT");locked=2;_;locked=1;}
    constructor(address admin_){require(admin_!=address(0),"ZERO");admin=admin_;}
    function setRouter(address router,bool approved) external onlyAdmin {require(router!=address(0),"ZERO");approvedRouters[router]=approved;emit RouterSet(router,approved);}
    function execute(address router,address sellToken,address buyToken,uint256 amount,uint256 minOut,bytes calldata routerCalldata) external nonReentrant returns(uint256 amountOut){
        require(approvedRouters[router]&&sellToken!=address(0)&&buyToken!=address(0)&&sellToken!=buyToken&&amount>0,"INPUT");
        uint256 beforeBuy=IERC20Pulse(buyToken).balanceOf(address(this));
        _approve(sellToken,router,0);_approve(sellToken,router,amount);
        (bool ok,)=router.call(routerCalldata);require(ok,"ROUTER");_approve(sellToken,router,0);
        amountOut=IERC20Pulse(buyToken).balanceOf(address(this))-beforeBuy;require(amountOut>=minOut,"MIN_OUT");require(IERC20Pulse(buyToken).transfer(msg.sender,amountOut),"PAYOUT");
        emit SwapExecuted(msg.sender,router,sellToken,buyToken,amount,amountOut);
    }
    function rescue(address token,uint256 amount,address recipient) external onlyAdmin {require(recipient!=address(0),"ZERO");require(IERC20Pulse(token).transfer(recipient,amount),"TRANSFER");}
    function _approve(address token,address spender,uint256 amount) private {(bool ok,bytes memory result)=token.call(abi.encodeWithSignature("approve(address,uint256)",spender,amount));require(ok&&(result.length==0||abi.decode(result,(bool))),"APPROVE");}
}
