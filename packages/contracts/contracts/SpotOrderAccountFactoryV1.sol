// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import "./SpotOrderAccountV1.sol";

contract SpotOrderAccountFactoryV1 {
    address public immutable registry;
    address public immutable oracle;
    mapping(address => address) public accountOf;
    event AccountCreated(address indexed owner, address indexed account);
    constructor(address registry_,address oracle_) { require(registry_ != address(0)&&oracle_!=address(0), "ZERO"); registry = registry_; oracle=oracle_; }
    function createAccount() external returns (address account) { require(accountOf[msg.sender] == address(0), "EXISTS"); account = address(new SpotOrderAccountV1(msg.sender, registry,oracle)); accountOf[msg.sender] = account; emit AccountCreated(msg.sender, account); }
}
