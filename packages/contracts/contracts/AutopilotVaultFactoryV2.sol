// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import "./AutopilotVaultV2.sol";
contract AutopilotVaultFactoryV2 {
    address public immutable registry;address public immutable oracle;mapping(address=>address[]) private vaults;
    event VaultCreated(address indexed owner,address indexed vault,address indexed settlementAsset,bytes32 policyHash);
    constructor(address registry_,address oracle_){require(registry_!=address(0)&&oracle_!=address(0),"ZERO");registry=registry_;oracle=oracle_;}
    function createVault(address settlementAsset,bytes32 policyHash) external returns(address vault){require(settlementAsset!=address(0)&&policyHash!=bytes32(0),"INPUT");vault=address(new AutopilotVaultV2(msg.sender,settlementAsset,registry,oracle,policyHash));vaults[msg.sender].push(vault);emit VaultCreated(msg.sender,vault,settlementAsset,policyHash);}
    function vaultsOf(address owner) external view returns(address[] memory){return vaults[owner];}
}
