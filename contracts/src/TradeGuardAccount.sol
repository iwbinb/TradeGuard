// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IBinaryModule, IBinaryMarket, IBinaryPool, IBinarySettlement, IOutcomeToken} from "./IDreamDex.sol";

/// @notice Testnet-only, non-upgradeable, owner-controlled account for bounded IOC buys.
/// @dev Spending limits are not insurance against protocol/token bugs or trading losses.
contract TradeGuardAccount is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable owner;
    IBinaryModule public immutable module;
    IERC20 public immutable collateral;
    uint256 public immutable chainId;
    uint256 public immutable scale;
    uint256 public constant MAX_MARKETS = 16;
    uint256 public constant MAX_TRACKED_MARKETS = 64;

    struct Policy {
        address executor;
        uint128 perOrder;
        uint128 budget;
        uint128 spent;
        uint64 validAfter;
        uint64 validUntil;
        uint64 version;
        uint16 maxPriceBps;
        bool revoked;
    }

    struct Binding {
        address market;
        address pool;
        address outcomeToken;
        bytes32 venueId;
        uint256 yesId;
        uint256 noId;
        uint64 nonce;
        uint64 expiry;
        uint64 policyVersion;
        uint32 operatorId;
    }

    struct Buy {
        bytes32 intentId;
        bytes32 marketId;
        uint64 policyVersion;
        uint64 deadline;
        uint256 yesPrice;
        uint256 quantity;
        uint256 maxSpend;
        bool up;
    }

    Policy public policy;
    mapping(bytes32 => Binding) public bindings;
    mapping(bytes32 => address) public settlements;
    mapping(bytes32 => bool) public usedIntents;
    bytes32[] private tracked;

    error NotOwner();
    error NotExecutor();
    error WrongChain();
    error InvalidPolicy();
    error InactivePolicy();
    error WrongPolicyVersion();
    error UnknownMarket();
    error MarketChanged();
    error MarketNotTrading();
    error InvalidOrder();
    error PriceLimit();
    error BudgetExceeded();
    error PerOrderExceeded();
    error IntentAlreadyUsed();
    error DeadlineExpired();
    error UnexpectedBalance();
    error PlacementFailed();
    error TransferFailed();
    error NotSettled();

    event PolicySet(
        uint64 indexed version, address indexed executor, uint128 perOrder, uint128 budget, uint64 validUntil
    );
    event MarketAllowed(uint64 indexed version, bytes32 indexed marketId, address indexed market, address pool);
    event PolicyRevoked(uint64 indexed version);
    event BuyExecuted(
        bytes32 indexed intentId,
        bytes32 indexed marketId,
        uint64 indexed version,
        bool up,
        uint256 spent,
        uint256 filled,
        uint128 orderId
    );
    event Deposited(uint256 amount);
    event Withdrawn(uint256 amount);
    event Claimed(bytes32 indexed marketId, uint256 received);
    event PositionRecovered(bytes32 indexed marketId, uint8 outcome, uint256 amount);
    event PoolCreditRecovered(bytes32 indexed marketId, uint256 amount);
    event SettlementCreditRecovered(bytes32 indexed marketId, uint256 received);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }
    modifier correctChain() {
        if (block.chainid != chainId) revert WrongChain();
        _;
    }

    constructor(address owner_, address module_, address collateral_) {
        if (block.chainid != 50312) revert WrongChain();
        if (owner_ == address(0) || module_.code.length == 0 || collateral_.code.length == 0) revert InvalidPolicy();
        uint8 decimals = IERC20Metadata(collateral_).decimals();
        if (decimals > 18 || decimals < 4) revert InvalidPolicy();
        owner = owner_;
        module = IBinaryModule(module_);
        collateral = IERC20(collateral_);
        scale = 10 ** decimals;
        chainId = block.chainid;
    }

    function setPolicy(
        address executor,
        uint128 perOrder,
        uint128 budget,
        uint64 validAfter,
        uint64 validUntil,
        uint16 maxPriceBps,
        bytes32[] calldata marketIds
    ) external onlyOwner correctChain nonReentrant {
        if (
            executor == address(0) || perOrder == 0 || budget < perOrder || validUntil <= block.timestamp
                || validUntil <= validAfter || maxPriceBps == 0 || maxPriceBps >= 10_000 || marketIds.length == 0
                || marketIds.length > MAX_MARKETS
        ) revert InvalidPolicy();
        uint64 version = policy.version + 1;
        policy = Policy(executor, perOrder, budget, 0, validAfter, validUntil, version, maxPriceBps, false);
        for (uint256 i; i < marketIds.length; ++i) {
            bytes32 id = marketIds[i];
            IBinaryModule.MarketRecord memory r = module.markets(id);
            if (
                r.market == address(0) || r.collateral != address(collateral) || r.outcomeSlotCount != 2
                    || r.expiry <= block.timestamp
            ) revert UnknownMarket();
            IBinaryPool.Params memory p = IBinaryPool(r.pool).getBinaryPoolParams();
            if (
                p.market != r.market || p.collateralToken != r.collateral || p.yesId != r.yesId || p.noId != r.noId
                    || p.oneCollateral != scale || p.finalized || p.marketNonce != module.marketNonce(id)
                    || p.outcomeToken != IBinaryMarket(r.market).outcomeToken()
            ) {
                revert MarketChanged();
            }
            if (bindings[id].market == address(0)) {
                if (tracked.length >= MAX_TRACKED_MARKETS) revert InvalidPolicy();
                tracked.push(id);
            }
            if (p.settlement.code.length == 0 || (settlements[id] != address(0) && settlements[id] != p.settlement)) {
                revert MarketChanged();
            }
            settlements[id] = p.settlement;
            bindings[id] = Binding(
                r.market,
                r.pool,
                p.outcomeToken,
                r.originVenueId,
                r.yesId,
                r.noId,
                p.marketNonce,
                r.expiry,
                version,
                r.originOperatorId
            );
            emit MarketAllowed(version, id, r.market, r.pool);
        }
        emit PolicySet(version, executor, perOrder, budget, validUntil);
    }

    function revoke() external onlyOwner correctChain {
        policy.revoked = true;
        emit PolicyRevoked(policy.version);
    }

    function remaining() external view returns (uint256) {
        return uint256(policy.budget) - policy.spent;
    }

    function executeBuy(Buy calldata order) external correctChain nonReentrant returns (uint256 paid, uint256 filled) {
        Policy memory p = policy;
        if (msg.sender != p.executor) revert NotExecutor();
        if (order.policyVersion != p.version) revert WrongPolicyVersion();
        if (p.revoked || p.version == 0 || block.timestamp < p.validAfter || block.timestamp >= p.validUntil) {
            revert InactivePolicy();
        }
        if (order.deadline <= block.timestamp || order.deadline > p.validUntil) revert DeadlineExpired();
        if (order.intentId == bytes32(0) || usedIntents[order.intentId]) revert IntentAlreadyUsed();
        Binding memory b = bindings[order.marketId];
        if (b.market == address(0) || b.policyVersion != p.version) revert UnknownMarket();
        _checkBinding(order.marketId, b);
        if (IBinaryMarket(b.market).status() != 1 || block.timestamp >= b.expiry) revert MarketNotTrading();
        if (order.quantity == 0 || order.yesPrice == 0 || order.yesPrice >= scale || order.maxSpend == 0) {
            revert InvalidOrder();
        }
        uint256 ownPrice = order.up ? order.yesPrice : scale - order.yesPrice;
        if (ownPrice > Math.mulDiv(scale, p.maxPriceBps, 10_000)) revert PriceLimit();
        if (order.maxSpend > p.perOrder) revert PerOrderExceeded();
        if (order.maxSpend > uint256(p.budget) - p.spent) revert BudgetExceeded();
        if (Math.mulDiv(order.quantity, ownPrice, scale, Math.Rounding.Ceil) > order.maxSpend) revert InvalidOrder();

        IBinaryPool pool = IBinaryPool(b.pool);
        uint256 beforeFunds =
            collateral.balanceOf(address(this)) + pool.getWithdrawableBalance(address(this), address(collateral));
        uint256 id = order.up ? b.yesId : b.noId;
        uint256 beforePosition = IOutcomeToken(b.outcomeToken).balanceOf(address(this), id);
        usedIntents[order.intentId] = true;
        collateral.forceApprove(b.pool, order.maxSpend);
        uint64 expires = order.deadline < b.expiry ? order.deadline : b.expiry;
        (bool ok, uint128 orderId) = pool.placeBinaryOrder(
            order.up ? 0 : 2, order.yesPrice, order.quantity, expires * 1_000_000_000, 2, 0, address(0), 0, 0
        );
        if (!ok) revert PlacementFailed();
        collateral.forceApprove(b.pool, 0);
        uint256 afterFunds =
            collateral.balanceOf(address(this)) + pool.getWithdrawableBalance(address(this), address(collateral));
        uint256 afterPosition = IOutcomeToken(b.outcomeToken).balanceOf(address(this), id);
        if (afterFunds > beforeFunds || afterPosition < beforePosition) revert UnexpectedBalance();
        paid = beforeFunds - afterFunds;
        filled = afterPosition - beforePosition;
        if (paid > order.maxSpend || paid > p.perOrder || paid > uint256(p.budget) - p.spent) revert BudgetExceeded();
        if ((paid > 0 && filled == 0) || filled > order.quantity) revert UnexpectedBalance();
        // paid <= p.budget - p.spent above, and budget is uint128; truncation is impossible.
        // forge-lint: disable-next-line(unsafe-typecast)
        policy.spent = p.spent + uint128(paid);
        emit BuyExecuted(order.intentId, order.marketId, p.version, order.up, paid, filled, orderId);
    }

    function _checkBinding(bytes32 id, Binding memory b) private view {
        IBinaryModule.MarketRecord memory r = module.markets(id);
        IBinaryPool.Params memory p = IBinaryPool(b.pool).getBinaryPoolParams();
        if (
            r.market != b.market || r.pool != b.pool || r.collateral != address(collateral) || r.yesId != b.yesId
                || r.noId != b.noId || r.originVenueId != b.venueId || r.originOperatorId != b.operatorId
                || r.expiry != b.expiry || p.market != b.market || p.marketNonce != b.nonce
                || module.marketNonce(id) != b.nonce || p.yesId != b.yesId || p.noId != b.noId
                || p.outcomeToken != b.outcomeToken || p.collateralToken != address(collateral)
                || p.oneCollateral != scale || p.finalized
        ) revert MarketChanged();
    }

    function deposit(uint256 amount) external onlyOwner correctChain nonReentrant {
        uint256 beforeBalance = collateral.balanceOf(address(this));
        collateral.safeTransferFrom(owner, address(this), amount);
        if (collateral.balanceOf(address(this)) != beforeBalance + amount) revert UnexpectedBalance();
        emit Deposited(amount);
    }

    function withdraw(uint256 amount) external onlyOwner correctChain nonReentrant {
        collateral.safeTransfer(owner, amount);
        emit Withdrawn(amount);
    }

    /// @notice Any caller may trigger redemption; the protocol always pays THIS account.
    /// @dev Uses the archived market record, not recycled pool state. No new trade authority.
    function claim(bytes32 marketId) external correctChain nonReentrant returns (uint256 received) {
        Binding memory b = bindings[marketId];
        if (b.market == address(0)) revert UnknownMarket();
        IBinaryModule.MarketRecord memory r = module.markets(marketId);
        if (r.market != b.market || r.collateral != address(collateral) || r.yesId != b.yesId || r.noId != b.noId) {
            revert MarketChanged();
        }
        IBinaryMarket market = IBinaryMarket(b.market);
        if (!market.isResolved() && !market.isVoided()) revert NotSettled();
        uint256[] memory payout = market.payoutNumerators();
        if (payout.length != 2) revert NotSettled();
        IOutcomeToken token = IOutcomeToken(b.outcomeToken);
        uint256 beforeBalance = collateral.balanceOf(address(this));
        if (!token.setOperator(address(module), true)) revert TransferFailed();
        for (uint8 i; i < 2; ++i) {
            uint256 amount = token.balanceOf(address(this), i == 0 ? b.yesId : b.noId);
            if (amount != 0 && payout[i] != 0) module.redeem(b.operatorId, b.venueId, marketId, i, amount);
        }
        if (!token.setOperator(address(module), false)) revert TransferFailed();
        uint256 afterBalance = collateral.balanceOf(address(this));
        if (afterBalance < beforeBalance) revert UnexpectedBalance();
        received = afterBalance - beforeBalance;
        emit Claimed(marketId, received);
    }

    function recoverPoolCredit(bytes32 marketId) external onlyOwner correctChain nonReentrant {
        Binding memory b = bindings[marketId];
        if (b.pool == address(0)) revert UnknownMarket();
        uint256 credit = IBinaryPool(b.pool).getWithdrawableBalance(address(this), address(collateral));
        if (credit != 0) IBinaryPool(b.pool).withdraw(address(collateral), credit);
        emit PoolCreditRecovered(marketId, credit);
    }

    /// @notice Pull a failed settlement payout into this account, never to the caller.
    function recoverSettlementCredit(bytes32 marketId) external correctChain nonReentrant returns (uint256 received) {
        address settlement = settlements[marketId];
        if (settlement == address(0)) revert UnknownMarket();
        uint256 beforeBalance = collateral.balanceOf(address(this));
        IBinarySettlement(settlement).claimOwed(address(collateral));
        uint256 afterBalance = collateral.balanceOf(address(this));
        if (afterBalance < beforeBalance) revert UnexpectedBalance();
        received = afterBalance - beforeBalance;
        emit SettlementCreditRecovered(marketId, received);
    }

    function recoverPosition(bytes32 marketId, uint8 outcome, uint256 amount)
        external
        onlyOwner
        correctChain
        nonReentrant
    {
        Binding memory b = bindings[marketId];
        if (b.market == address(0) || outcome > 1) revert UnknownMarket();
        if (!IOutcomeToken(b.outcomeToken).transfer(owner, outcome == 0 ? b.yesId : b.noId, amount)) {
            revert TransferFailed();
        }
        emit PositionRecovered(marketId, outcome, amount);
    }

    function trackedMarketCount() external view returns (uint256) {
        return tracked.length;
    }

    function trackedMarket(uint256 index) external view returns (bytes32) {
        return tracked[index];
    }
}
