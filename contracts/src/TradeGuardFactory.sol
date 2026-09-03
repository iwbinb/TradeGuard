// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TradeGuardAccount} from "./TradeGuardAccount.sol";

/// @notice One non-upgradeable account per owner for a fixed testnet deployment.
contract TradeGuardFactory {
    address public immutable module;
    address public immutable collateral;
    mapping(address => address) public accountOf;
    event AccountCreated(address indexed owner, address indexed account);
    error AlreadyCreated();
    error InvalidDeployment();

    constructor(address module_, address collateral_) {
        if (block.chainid != 50312 || module_.code.length == 0 || collateral_.code.length == 0) {
            revert InvalidDeployment();
        }
        module = module_;
        collateral = collateral_;
    }

    function createAccount() external returns (address account) {
        if (accountOf[msg.sender] != address(0)) revert AlreadyCreated();
        account = address(new TradeGuardAccount(msg.sender, module, collateral));
        accountOf[msg.sender] = account;
        emit AccountCreated(msg.sender, account);
    }
}
