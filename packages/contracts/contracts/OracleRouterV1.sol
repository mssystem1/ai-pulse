// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract OracleRouterV1 {
    struct Observation { uint192 price; uint64 updatedAt; uint64 maxAge; }
    address public immutable admin; mapping(address => bool) public updaters; mapping(bytes32 => Observation) public observations;
    event UpdaterSet(address indexed updater,bool approved); event PriceUpdated(address indexed base,address indexed quote,uint256 price,uint256 updatedAt,uint256 maxAge);
    modifier onlyAdmin(){require(msg.sender==admin,"ADMIN");_;} modifier onlyUpdater(){require(updaters[msg.sender],"UPDATER");_;}
    constructor(address updater){require(updater!=address(0),"ZERO");admin=msg.sender;updaters[updater]=true;}
    function setUpdater(address updater,bool approved) external onlyAdmin {updaters[updater]=approved;emit UpdaterSet(updater,approved);}
    function setPrice(address base,address quote,uint192 price,uint64 maxAge) external onlyUpdater {require(base!=address(0)&&quote!=address(0)&&price>0&&maxAge>=30,"INPUT");observations[keccak256(abi.encode(base,quote))]=Observation(price,uint64(block.timestamp),maxAge);emit PriceUpdated(base,quote,price,block.timestamp,maxAge);}
    function readPrice(address base,address quote) external view returns(uint256 price,uint256 updatedAt){Observation memory o=observations[keccak256(abi.encode(base,quote))];require(o.price>0&&block.timestamp<=o.updatedAt+o.maxAge,"STALE");return(o.price,o.updatedAt);}
}
