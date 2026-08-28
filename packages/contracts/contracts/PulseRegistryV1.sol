// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract PulseRegistryV1 {
    address public immutable admin;
    address public guardian;
    bool public automationPaused;
    mapping(address => bool) public approvedAdapters;
    mapping(address => bool) public spotKeepers;
    mapping(address => bool) public autopilotExecutors;

    event AdapterSet(address indexed adapter, bool approved);
    event RoleSet(bytes32 indexed role, address indexed account, bool approved);
    event AutomationPaused(bool paused);

    modifier onlyAdmin() { require(msg.sender == admin, "ADMIN"); _; }
    modifier onlyGuardian() { require(msg.sender == guardian || msg.sender == admin, "GUARDIAN"); _; }

    constructor(address guardian_) { require(guardian_ != address(0), "ZERO"); admin = msg.sender; guardian = guardian_; }
    function setAdapter(address adapter, bool approved) external onlyAdmin { require(adapter != address(0), "ZERO"); approvedAdapters[adapter] = approved; emit AdapterSet(adapter, approved); }
    function setSpotKeeper(address account, bool approved) external onlyAdmin { spotKeepers[account] = approved; emit RoleSet(keccak256("SPOT_KEEPER"), account, approved); }
    function setAutopilotExecutor(address account, bool approved) external onlyAdmin { autopilotExecutors[account] = approved; emit RoleSet(keccak256("AUTOPILOT_EXECUTOR"), account, approved); }
    function setGuardian(address next) external onlyAdmin { require(next != address(0), "ZERO"); guardian = next; }
    function pauseAutomation(bool paused) external onlyGuardian { automationPaused = paused; emit AutomationPaused(paused); }
}
