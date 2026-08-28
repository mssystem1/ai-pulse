// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract MockERC20Pulse {
    string public name;string public symbol;uint8 public immutable decimals;uint256 public totalSupply;mapping(address=>uint256)public balanceOf;mapping(address=>mapping(address=>uint256))public allowance;
    constructor(string memory name_,string memory symbol_,uint8 decimals_){name=name_;symbol=symbol_;decimals=decimals_;}
    function mint(address to,uint256 amount)external{balanceOf[to]+=amount;totalSupply+=amount;}
    function approve(address spender,uint256 amount)external returns(bool){allowance[msg.sender][spender]=amount;return true;}
    function transfer(address to,uint256 amount)external returns(bool){_transfer(msg.sender,to,amount);return true;}
    function transferFrom(address from,address to,uint256 amount)external returns(bool){uint256 allowed=allowance[from][msg.sender];require(allowed>=amount,"ALLOWANCE");if(allowed!=type(uint256).max)allowance[from][msg.sender]=allowed-amount;_transfer(from,to,amount);return true;}
    function _transfer(address from,address to,uint256 amount)private{require(balanceOf[from]>=amount,"BALANCE");balanceOf[from]-=amount;balanceOf[to]+=amount;}
}
contract MockRouterPulse {
    function swap(address sell,address buy,uint256 amount,uint256 amountOut)external{require(MockERC20Pulse(sell).transferFrom(msg.sender,address(this),amount),"SELL");require(MockERC20Pulse(buy).transfer(msg.sender,amountOut),"BUY");}
}
contract MockApprovalSpenderPulse {
    function pull(address token,address from,address to,uint256 amount)external{require(MockERC20Pulse(token).transferFrom(from,to,amount),"PULL");}
}
contract MockRouterWithSpenderPulse {
    function swap(address spender,address sell,address buy,uint256 amount,uint256 amountOut)external{MockApprovalSpenderPulse(spender).pull(sell,msg.sender,address(this),amount);require(MockERC20Pulse(buy).transfer(msg.sender,amountOut),"BUY");}
}
