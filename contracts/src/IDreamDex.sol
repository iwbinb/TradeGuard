// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Mirrors @somnia-chain/markets-sdk 0.29.0's published read/write ABIs.
interface IBinaryModule {
    struct MarketRecord {
        uint256 oracleQuestionId;
        uint8 outcomeSlotCount;
        uint8 voidPolicy;
        address collateral;
        uint32 originOperatorId;
        bytes32 originVenueId;
        address oracleAdapter;
        address creator;
        address market;
        address pool;
        uint256 yesId;
        uint256 noId;
        uint64 tradingStart;
        uint64 expiry;
    }
    function markets(bytes32 marketId) external view returns (MarketRecord memory);
    function marketNonce(bytes32 marketId) external view returns (uint64);
    function redeem(uint32 operatorId, bytes32 venueId, bytes32 marketId, uint8 outcomeIdx, uint256 amount) external;
}

interface IBinaryMarket {
    function status() external view returns (uint8);
    function outcomeToken() external view returns (address);
    function payoutNumerators() external view returns (uint256[] memory);
    function isResolved() external view returns (bool);
    function isVoided() external view returns (bool);
}

interface IBinarySettlement {
    function claimOwed(address token) external returns (uint256);
    function owed(address owner, address token) external view returns (uint256);
}

interface IOutcomeToken {
    function balanceOf(address owner, uint256 id) external view returns (uint256);
    function setOperator(address spender, bool approved) external returns (bool);
    function transfer(address receiver, uint256 id, uint256 amount) external returns (bool);
}

interface IBinaryPool {
    struct Params {
        address collateralToken;
        address market;
        address outcomeToken;
        uint256 yesId;
        uint256 noId;
        uint256 oneCollateral;
        uint256 setBacking;
        address feeRecipient;
        uint256 makerFeeBpsTimes1k;
        uint256 takerFeeBpsTimes1k;
        uint256 maxBuilderFeeBpsTimes1k;
        uint256 settlementFeeBpsTimes1k;
        address settlement;
        uint64 marketNonce;
        bool finalized;
    }
    function getBinaryPoolParams() external view returns (Params memory);
    function placeBinaryOrder(
        uint8 kind,
        uint256 price,
        uint256 quantity,
        uint64 expireNs,
        uint8 orderType,
        uint8 selfMatchingOption,
        address builder,
        uint96 builderFee,
        uint64 userData
    ) external returns (bool, uint128);
    function getWithdrawableBalance(address account, address token) external view returns (uint256);
    function withdraw(address token, uint256 amount) external;
}
