// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {TradeGuardAccount} from "../src/TradeGuardAccount.sol";
import {TradeGuardFactory} from "../src/TradeGuardFactory.sol";
import {IBinaryModule, IBinaryPool} from "../src/IDreamDex.sol";

interface Vm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function warp(uint256) external;
    function chainId(uint256) external;
    function expectRevert(bytes4) external;
}

contract TestCoin is ERC20 {
    constructor() ERC20("Test collateral", "tUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract TestOutcomes {
    mapping(address => mapping(uint256 => uint256)) public balanceOf;
    mapping(address => mapping(address => bool)) public isOperator;

    function mint(address to, uint256 id, uint256 amount) external {
        balanceOf[to][id] += amount;
    }

    function setOperator(address spender, bool approved) external returns (bool) {
        isOperator[msg.sender][spender] = approved;
        return true;
    }

    function transfer(address to, uint256 id, uint256 amount) external returns (bool) {
        balanceOf[msg.sender][id] -= amount;
        balanceOf[to][id] += amount;
        return true;
    }

    function burn(address from, uint256 id, uint256 amount) external {
        require(isOperator[from][msg.sender], "operator");
        balanceOf[from][id] -= amount;
    }
}

contract TestMarket {
    uint8 public status = 1;
    address public outcomeToken;
    uint256[] private payouts;

    constructor(address token) {
        outcomeToken = token;
    }

    function setStatus(uint8 s) external {
        status = s;
    }

    function resolve(uint256 yes, uint256 no, bool voided) external {
        delete payouts;
        payouts.push(yes);
        payouts.push(no);
        status = voided ? 5 : 4;
    }

    function payoutNumerators() external view returns (uint256[] memory) {
        return payouts;
    }

    function isResolved() external view returns (bool) {
        return status == 4;
    }

    function isVoided() external view returns (bool) {
        return status == 5;
    }
}

contract TestSettlement {
    TestCoin private coin;
    mapping(address => mapping(address => uint256)) public owed;

    constructor(TestCoin token) {
        coin = token;
    }

    function credit(address account, uint256 value) external {
        owed[account][address(coin)] += value;
    }

    function claimOwed(address token) external returns (uint256 value) {
        value = owed[msg.sender][token];
        owed[msg.sender][token] = 0;
        coin.mint(msg.sender, value);
    }
}

contract TestPool is IBinaryPool {
    Params private params;
    TestCoin public coin;
    TestOutcomes public outcomes;
    uint256 public fillBps = 10_000;
    uint256 public executionPrice = 0;
    uint256 public extraCharge = 0;
    bool public accept = true;
    bool public callbackSucceeded;
    bytes public callback;
    mapping(address => uint256) private credits;

    constructor(address token, address market, address out) {
        coin = TestCoin(token);
        outcomes = TestOutcomes(out);
        params.collateralToken = token;
        params.market = market;
        params.outcomeToken = out;
        params.yesId = 11;
        params.noId = 12;
        params.oneCollateral = 1e6;
        params.marketNonce = 1;
    }

    function getBinaryPoolParams() external view returns (Params memory) {
        return params;
    }

    function setSettlement(address settlement) external {
        params.settlement = settlement;
    }

    function configure(uint256 fill, uint256 price, uint256 extra, bool accepted) external {
        fillBps = fill;
        executionPrice = price;
        extraCharge = extra;
        accept = accepted;
    }

    function recycle(address market) external {
        params.market = market;
        params.marketNonce++;
        params.yesId += 10;
        params.noId += 10;
    }

    function setCallback(bytes calldata data) external {
        callback = data;
    }

    function credit(address account, uint256 amount) external {
        credits[account] += amount;
        coin.mint(address(this), amount);
    }

    function getWithdrawableBalance(address account, address) external view returns (uint256) {
        return credits[account];
    }

    function withdraw(address, uint256 amount) external {
        credits[msg.sender] -= amount;
        require(coin.transfer(msg.sender, amount));
    }

    function placeBinaryOrder(
        uint8 kind,
        uint256 price,
        uint256 quantity,
        uint64,
        uint8 orderType,
        uint8,
        address builder,
        uint96 fee,
        uint64
    ) external returns (bool, uint128) {
        require(orderType == 2 && builder == address(0) && fee == 0, "IOC only");
        require(kind == 0 || kind == 2, "buy only");
        if (!accept) return (false, 0);
        if (callback.length > 0) (callbackSucceeded,) = msg.sender.call(callback);
        uint256 filled = quantity * fillBps / 10_000;
        uint256 ownPrice = executionPrice == 0 ? (kind == 0 ? price : 1e6 - price) : executionPrice;
        uint256 cost = filled * ownPrice / 1e6 + extraCharge;
        uint256 fromVault = cost < credits[msg.sender] ? cost : credits[msg.sender];
        credits[msg.sender] -= fromVault;
        if (cost > fromVault) require(coin.transferFrom(msg.sender, address(this), cost - fromVault));
        outcomes.mint(msg.sender, kind == 0 ? params.yesId : params.noId, filled);
        return (true, 0);
    }
}

contract TestModule is IBinaryModule {
    mapping(bytes32 => MarketRecord) private records;
    mapping(bytes32 => uint64) public marketNonce;
    TestCoin private coin;
    TestOutcomes private outcomes;

    constructor(TestCoin token, TestOutcomes out) {
        coin = token;
        outcomes = out;
    }

    function add(bytes32 id, address market, address pool) external {
        records[id] = MarketRecord(
            1, 2, 0, address(coin), 4, bytes32(uint256(9)), address(0), address(this), market, pool, 11, 12, 900, 2000
        );
        marketNonce[id] = 1;
    }

    function corrupt(bytes32 id) external {
        records[id].originVenueId = bytes32(uint256(66));
    }

    function markets(bytes32 id) external view returns (MarketRecord memory) {
        return records[id];
    }

    function redeem(uint32, bytes32, bytes32 id, uint8 side, uint256 amount) external {
        MarketRecord memory r = records[id];
        uint256[] memory p = TestMarket(r.market).payoutNumerators();
        outcomes.burn(msg.sender, side == 0 ? r.yesId : r.noId, amount);
        coin.mint(msg.sender, amount * p[side] / (p[0] + p[1]));
    }
}

contract TradeGuardTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant OWNER = address(0xA11CE);
    address private constant AGENT = address(0xB0B);
    address private constant STRANGER = address(0xBAD);
    bytes32 private constant MARKET = bytes32(uint256(1));
    TestCoin coin;
    TestOutcomes outcomes;
    TestMarket market;
    TestPool pool;
    TestModule module;
    TradeGuardAccount account;
    TradeGuardFactory factory;
    TestSettlement settlement;

    function setUp() public {
        vm.chainId(50312);
        vm.warp(1000);
        coin = new TestCoin();
        outcomes = new TestOutcomes();
        market = new TestMarket(address(outcomes));
        pool = new TestPool(address(coin), address(market), address(outcomes));
        module = new TestModule(coin, outcomes);
        settlement = new TestSettlement(coin);
        pool.setSettlement(address(settlement));
        module.add(MARKET, address(market), address(pool));
        factory = new TradeGuardFactory(address(module), address(coin));
        vm.prank(OWNER);
        account = TradeGuardAccount(factory.createAccount());
        coin.mint(OWNER, 100e6);
        vm.startPrank(OWNER);
        coin.approve(address(account), 100e6);
        account.deposit(100e6);
        vm.stopPrank();
        grant();
    }

    function grant() private {
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = MARKET;
        vm.prank(OWNER);
        account.setPolicy(AGENT, 5e6, 20e6, 900, 3000, 9500, ids);
    }

    function order(uint256 n) private pure returns (TradeGuardAccount.Buy memory o) {
        o = TradeGuardAccount.Buy(bytes32(n), MARKET, 1, 1500, 500000, 10e6, 5e6, true);
    }

    function buy(uint256 n) private {
        vm.prank(AGENT);
        account.executeBuy(order(n));
    }

    function eq(uint256 a, uint256 b) private pure {
        require(a == b, "not equal");
    }

    function testRealAccountingAndAllowanceCleanup() public {
        buy(1);
        eq(account.remaining(), 15e6);
        eq(coin.balanceOf(address(account)), 95e6);
        eq(outcomes.balanceOf(address(account), 11), 10e6);
        eq(coin.allowance(address(account), address(pool)), 0);
    }

    function testSettlementCreditRecoveryAfterRevokeAndRecycle() public {
        settlement.credit(address(account), 3e6);
        vm.prank(OWNER);
        account.revoke();
        pool.recycle(address(0x999));
        vm.prank(STRANGER);
        account.recoverSettlementCredit(MARKET);
        eq(coin.balanceOf(address(account)), 103e6);
        eq(coin.balanceOf(STRANGER), 0);
        eq(settlement.owed(address(account), address(coin)), 0);
    }

    function testUnknownSettlementRecoveryRejected() public {
        vm.expectRevert(TradeGuardAccount.UnknownMarket.selector);
        account.recoverSettlementCredit(bytes32(uint256(999)));
    }

    function testPartialFillOnlySpendsActualAmount() public {
        pool.configure(6400, 0, 0, true);
        buy(1);
        eq(account.remaining(), 16800000);
        eq(coin.balanceOf(address(account)), 96800000);
    }

    function testPriceImprovementOnlySpendsActualAmount() public {
        pool.configure(10_000, 400000, 0, true);
        buy(1);
        eq(account.remaining(), 16e6);
    }

    function testVaultFirstFundsAreIncludedInBudget() public {
        pool.credit(address(account), 4e6);
        buy(1);
        eq(account.remaining(), 15e6);
        eq(coin.balanceOf(address(account)), 99e6);
    }

    function testPostExecutionCapRevertsExcessVaultDebit() public {
        pool.credit(address(account), 30e6);
        pool.configure(10_000, 0, 10e6, true);
        vm.expectRevert(TradeGuardAccount.BudgetExceeded.selector);
        buy(1);
        eq(account.remaining(), 20e6);
        eq(pool.getWithdrawableBalance(address(account), address(coin)), 30e6);
        require(!account.usedIntents(bytes32(uint256(1))), "revert consumed nonce");
    }

    function testZeroFillConsumesIntentButNotBudget() public {
        pool.configure(0, 0, 0, true);
        buy(1);
        eq(account.remaining(), 20e6);
        require(account.usedIntents(bytes32(uint256(1))), "nonce");
    }

    function testNoFillCannotChargePrincipal() public {
        pool.configure(0, 0, 1e6, true);
        vm.expectRevert(TradeGuardAccount.UnexpectedBalance.selector);
        buy(1);
    }

    function testDownPriceUsesComplement() public {
        TradeGuardAccount.Buy memory o = order(1);
        o.up = false;
        o.yesPrice = 800000;
        o.quantity = 20e6;
        vm.prank(AGENT);
        account.executeBuy(o);
        eq(account.remaining(), 16e6);
        eq(outcomes.balanceOf(address(account), 12), 20e6);
    }

    function testPerOrderLimit() public {
        TradeGuardAccount.Buy memory o = order(1);
        o.maxSpend = 6e6;
        vm.expectRevert(TradeGuardAccount.PerOrderExceeded.selector);
        vm.prank(AGENT);
        account.executeBuy(o);
    }

    function testCumulativeLimit() public {
        for (uint256 i = 1; i <= 4; ++i) {
            buy(i);
        }
        vm.expectRevert(TradeGuardAccount.BudgetExceeded.selector);
        buy(5);
        eq(account.remaining(), 0);
    }

    function testExternalDonationDoesNotResetBudget() public {
        buy(1);
        coin.mint(address(account), 1_000e6);
        eq(account.remaining(), 15e6);
    }

    function testReplayRejected() public {
        buy(1);
        vm.expectRevert(TradeGuardAccount.IntentAlreadyUsed.selector);
        buy(1);
    }

    function testUnknownMarket() public {
        TradeGuardAccount.Buy memory o = order(1);
        o.marketId = bytes32(uint256(999));
        vm.expectRevert(TradeGuardAccount.UnknownMarket.selector);
        vm.prank(AGENT);
        account.executeBuy(o);
    }

    function testWrongExecutor() public {
        vm.expectRevert(TradeGuardAccount.NotExecutor.selector);
        vm.prank(STRANGER);
        account.executeBuy(order(1));
    }

    function testAgentCannotWithdraw() public {
        vm.expectRevert(TradeGuardAccount.NotOwner.selector);
        vm.prank(AGENT);
        account.withdraw(1e6);
    }

    function testAgentCannotRevokeOrChangePolicy() public {
        vm.expectRevert(TradeGuardAccount.NotOwner.selector);
        vm.prank(AGENT);
        account.revoke();
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = MARKET;
        vm.expectRevert(TradeGuardAccount.NotOwner.selector);
        vm.prank(AGENT);
        account.setPolicy(AGENT, 100e6, 100e6, 900, 3000, 9900, ids);
    }

    function testRevokedBlocksNewOrders() public {
        vm.prank(OWNER);
        account.revoke();
        vm.expectRevert(TradeGuardAccount.InactivePolicy.selector);
        buy(1);
    }

    function testOldPolicyVersionCannotExecute() public {
        grant();
        vm.expectRevert(TradeGuardAccount.WrongPolicyVersion.selector);
        buy(1);
    }

    function testExpiredPolicy() public {
        vm.warp(3000);
        vm.expectRevert(TradeGuardAccount.InactivePolicy.selector);
        buy(1);
    }

    function testExpiredIntent() public {
        vm.warp(1500);
        vm.expectRevert(TradeGuardAccount.DeadlineExpired.selector);
        buy(1);
    }

    function testWrongChain() public {
        vm.chainId(1);
        vm.expectRevert(TradeGuardAccount.WrongChain.selector);
        buy(1);
    }

    function testLockedMarket() public {
        market.setStatus(2);
        vm.expectRevert(TradeGuardAccount.MarketNotTrading.selector);
        buy(1);
    }

    function testRecycledPoolRejectsStaleBinding() public {
        pool.recycle(address(0xF00));
        vm.expectRevert(TradeGuardAccount.MarketChanged.selector);
        buy(1);
    }

    function testChangedVenueRejected() public {
        module.corrupt(MARKET);
        vm.expectRevert(TradeGuardAccount.MarketChanged.selector);
        buy(1);
    }

    function testPriceLimit() public {
        TradeGuardAccount.Buy memory o = order(1);
        o.yesPrice = 990000;
        o.quantity = 1e6;
        vm.expectRevert(TradeGuardAccount.PriceLimit.selector);
        vm.prank(AGENT);
        account.executeBuy(o);
    }

    function testRejectedPlacementRollsBackApproval() public {
        pool.configure(10_000, 0, 0, false);
        vm.expectRevert(TradeGuardAccount.PlacementFailed.selector);
        buy(1);
        eq(coin.allowance(address(account), address(pool)), 0);
        eq(account.remaining(), 20e6);
    }

    function testClaimAfterRevocationAndPoolRecycling() public {
        buy(1);
        vm.prank(OWNER);
        account.revoke();
        market.resolve(1, 0, false);
        pool.recycle(address(0xF00));
        vm.prank(STRANGER);
        account.claim(MARKET);
        eq(coin.balanceOf(address(account)), 105e6);
        eq(coin.balanceOf(STRANGER), 0);
        require(!outcomes.isOperator(address(account), address(module)), "operator not cleared");
        eq(account.remaining(), 15e6);
    }

    function testVoidUsesActualPayoutVector() public {
        outcomes.mint(address(account), 11, 10e6);
        outcomes.mint(address(account), 12, 20e6);
        market.resolve(7, 3, true);
        account.claim(MARKET);
        eq(coin.balanceOf(address(account)), 113e6);
    }

    function testLosingSideDoesNotInventPayout() public {
        buy(1);
        market.resolve(0, 1, false);
        eq(account.claim(MARKET), 0);
        eq(coin.balanceOf(address(account)), 95e6);
    }

    function testUnsettledClaimRejected() public {
        vm.expectRevert(TradeGuardAccount.NotSettled.selector);
        account.claim(MARKET);
    }

    function testOwnerCanWithdrawAndRecoverPositions() public {
        buy(1);
        vm.prank(OWNER);
        account.recoverPosition(MARKET, 0, 10e6);
        eq(outcomes.balanceOf(OWNER, 11), 10e6);
        vm.prank(OWNER);
        account.withdraw(95e6);
        eq(coin.balanceOf(OWNER), 95e6);
    }

    function testOwnerRecoversVaultFallback() public {
        pool.credit(address(account), 3e6);
        vm.prank(OWNER);
        account.recoverPoolCredit(MARKET);
        eq(coin.balanceOf(address(account)), 103e6);
        eq(account.remaining(), 20e6);
    }

    function testFactoryCannotCreateDuplicateAccount() public {
        vm.expectRevert(TradeGuardFactory.AlreadyCreated.selector);
        vm.prank(OWNER);
        factory.createAccount();
    }

    function testReentrancyCannotOpenAnotherOrder() public {
        pool.setCallback(abi.encodeCall(account.executeBuy, (order(2))));
        buy(1);
        require(!pool.callbackSucceeded(), "reentered");
        eq(account.remaining(), 15e6);
    }

    function testFuzzActualDebitMatchesBudget(uint16 percentage) public {
        uint256 fill = uint256(percentage) % 10_001;
        pool.configure(fill, 0, 0, true);
        buy(1);
        uint256 paid = 5e6 * fill / 10_000;
        eq(account.remaining(), 20e6 - paid);
        eq(coin.balanceOf(address(account)), 100e6 - paid);
    }
}
