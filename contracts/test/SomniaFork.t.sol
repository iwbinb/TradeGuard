// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TradeGuardAccount} from "../src/TradeGuardAccount.sol";
import {TradeGuardFactory} from "../src/TradeGuardFactory.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ForkVm {
    function envOr(string calldata, string calldata) external returns (string memory);
    function envUint(string calldata) external returns (uint256);
    function envBytes32(string calldata) external returns (bytes32);
    function createSelectFork(string calldata, uint256) external returns (uint256);
    function skip(bool) external;
    function expectRevert(bytes4) external;
}

interface TestnetFaucet {
    function faucet(uint256 amount) external;
}

/// @dev LOCAL fork only. No broadcasting, owner secret, or real wallet is used.
contract SomniaForkTest {
    ForkVm private constant vm = ForkVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    // Addresses below are set from the official SDK by the read-only harness.
    TradeGuardAccount private account;
    IERC20 private token;
    TradeGuardAccount.Buy private buy;
    bool private enabled;

    function setUp() public {
        string memory url = vm.envOr("TRADEGUARD_FORK_RPC", "");
        if (bytes(url).length == 0) return;
        enabled = true;
        vm.createSelectFork(url, vm.envUint("TRADEGUARD_FORK_BLOCK"));
        address module = address(uint160(vm.envUint("TRADEGUARD_MODULE")));
        address collateral = address(uint160(vm.envUint("TRADEGUARD_COLLATERAL")));
        TradeGuardFactory factory = new TradeGuardFactory(module, collateral);
        account = TradeGuardAccount(factory.createAccount());
        token = IERC20(collateral);
        TestnetFaucet(collateral).faucet(20e6);
        require(token.approve(address(account), 20e6));
        account.deposit(20e6);
        bytes32 id = vm.envBytes32("TRADEGUARD_FORK_MARKET");
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = id;
        account.setPolicy(address(this), 5e6, 10e6, uint64(block.timestamp), uint64(block.timestamp + 3600), 9500, ids);
        buy = TradeGuardAccount.Buy(
            bytes32(uint256(1)),
            id,
            1,
            uint64(block.timestamp + 60),
            vm.envUint("TRADEGUARD_FORK_PRICE"),
            vm.envUint("TRADEGUARD_FORK_QUANTITY"),
            500000,
            true
        );
    }

    function testForkRealProtocolIOCAndRecovery() public {
        if (!enabled) {
            vm.skip(true);
            return;
        }
        (uint256 paid, uint256 filled) = account.executeBuy(buy);
        require(paid > 0 && filled > 0, "live fork did not fill");
        require(paid <= 500000 && account.remaining() == 10e6 - paid, "spending accounting");
        require(
            token.balanceOf(address(account)) <= 20e6 && token.balanceOf(address(account)) >= 20e6 - paid,
            "account balance"
        );
        account.revoke();
        uint256 available = token.balanceOf(address(account));
        uint256 beforeBalance = token.balanceOf(address(this));
        account.withdraw(available);
        require(token.balanceOf(address(this)) == beforeBalance + available, "owner withdrawal");
        account.recoverPosition(buy.marketId, 0, filled);
    }

    function testForkRevokedPermissionRejectedByGuard() public {
        if (!enabled) {
            vm.skip(true);
            return;
        }
        account.revoke();
        vm.expectRevert(TradeGuardAccount.InactivePolicy.selector);
        account.executeBuy(buy);
    }
}
