// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import "./AutopilotVaultV1.sol";
contract AutopilotVaultFactoryV1 {
    address public immutable registry; mapping(address=>address[]) private vaults;
    event VaultCreated(address indexed owner,address indexed vault,address indexed settlementAsset,bytes32 policyHash);
    constructor(address registry_){require(registry_!=address(0),"ZERO");registry=registry_;}
    function createVault(address settlementAsset,bytes32 policyHash) external returns(address vault){require(settlementAsset!=address(0)&&policyHash!=bytes32(0),"INPUT");vault=address(new AutopilotVaultV1(msg.sender,settlementAsset,registry,policyHash));vaults[msg.sender].push(vault);emit VaultCreated(msg.sender,vault,settlementAsset,policyHash);}
    function vaultsOf(address owner) external view returns(address[] memory){return vaults[owner];}
}
