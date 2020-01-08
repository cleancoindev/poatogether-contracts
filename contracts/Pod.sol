pragma solidity ^0.5.12;

import "./MCDAwarePool.sol";
import "@openzeppelin/upgrades/contracts/Initializable.sol";
import "fixidity/contracts/FixidityLib.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/introspection/IERC1820Registry.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC777/ERC777.sol";
import "./IPoolRewardListener.sol";

/*

  When a user deposits through a pod, we need to track their shares.

  The user will have shares of the open draw before it commits.

  new_exchange_rate = old_exchange_rate * (old_total + winnings) / old_total

  only when the winnings from a draw are accounted for do we know what a users shares are

*/
contract Pod is ERC777, IPoolRewardListener {
  IERC1820Registry internal constant ERC1820_REGISTRY = IERC1820Registry(0x1820a4B7618BdE71Dce8cdc73aAB6C95905faD24);

  // keccak256("PoolRewardListener")
  bytes32 internal constant POOL_REWARD_LISTENER_HASH =
    0x0eac87979bfaf2ee04214abb7b986230831facc465751b8c410d8cd5f24e6398;

  MCDAwarePool pool;

  uint256[] exchangeRateDrawIds;
  mapping(uint256 => int256) drawIndexExchangeRates;
  mapping(address => uint256) latestDepositDrawId;
  mapping(address => uint256) latestDepositAmount;

  function initialize(
    MCDAwarePool _pool
  ) public initializer {
    require(address(_pool) != address(0), "Pod/pool-def");
    pool = _pool;
    ERC1820_REGISTRY.setInterfaceImplementer(address(this), POOL_REWARD_LISTENER_HASH, address(this));
    exchangeRateDrawIds.push(0);
    drawIndexExchangeRates[0] = FixidityLib.fixed1();
  }

  function findExchangeRateIndex(uint256 _drawId) internal view returns (uint256) {
    for (uint256 i = exchangeRateDrawIds.length - 1; i >= 0; i--) {
      if (exchangeRateDrawIds[i] <= _drawId) {
        return i;
      }
    }
  }

  function drawWinner(uint256 _drawId, address _winner, uint256 _netWinnings) external onlyPool {
    require(_winner == address(this), "Pod/no-win-match"); // only watches for itself

    uint256 currentDrawIndex = findExchangeRateIndex(_drawId);
    int256 currentExchangeRate = drawIndexExchangeRates[currentDrawIndex];

    // newExchangeRate = currentExchangeRate * (1 + _netWinnings / oldTotal);
    int256 winnings = FixidityLib.newFixed(int256(_netWinnings));
    int256 oldTotal = FixidityLib.newFixed(int256(pool.committedBalanceOf(address(this))));
    int256 multiplier = FixidityLib.add(FixidityLib.divide(winnings, oldTotal), FixidityLib.fixed1());
    int256 newExchangeRate = FixidityLib.multiply(currentExchangeRate, multiplier);

    uint256 drawIndex = exchangeRateDrawIds.push(_drawId);
    drawIndexExchangeRates[drawIndex] = newExchangeRate;
  }

  function depositPool(uint256 _amount) public {
    uint256 openDrawId = pool.currentOpenDrawId();
    // if the latest deposit has been committed, then mint tokens
    if (latestDepositDrawId[msg.sender] != openDrawId) {
      uint256 mintBalance = latestBalanceOf(msg.sender);

      latestDepositDrawId[msg.sender] = openDrawId;
      latestDepositAmount[msg.sender] = _amount;

      _mint(address(this), msg.sender, mintBalance, "", "");
    } else {
      latestDepositAmount[msg.sender] = latestDepositAmount[msg.sender] + _amount;
    }

    pool.token().transferFrom(msg.sender, address(this), _amount);
    pool.token().approve(address(pool), _amount);

    pool.depositPool(_amount);
  }

  function withdrawCommittedDeposit(uint256 _amount) public {
    require(_amount < balanceOf(msg.sender), "Pod/insuff");
    consolidateLatestDeposit(msg.sender);
  }

  function consolidateLatestDeposit(address user) internal view returns (uint256) {
    uint256 latestDrawId = latestDepositDrawId[user];
    if (latestDrawId != pool.currentOpenDrawId()) {
      _mint(address(this), user, latestBalanceOf(user), "", "");
      latestDepositDrawId[user] = 0;
      latestDepositAmount[user] = 0;
    }
  }

  function latestBalanceOf(address user) internal view returns (uint256) {
    uint256 latestDrawId = latestDepositDrawId[msg.sender];
    uint256 drawIndex = findExchangeRateIndex(latestDrawId);
    int256 exchangeRate = drawIndexExchangeRates[drawIndex];
    return uint256(FixidityLib.multiply(exchangeRate, FixidityLib.newFixed(latestDepositAmount[msg.sender])));
  }

  function balanceOf(address user) public view returns (uint256) {
    uint256 committedBalance = super.balanceOf(user);
    if (latestDepositDrawId[user] != pool.currentOpenDrawId()) {
      committedBalance = committedBalance + latestBalanceOf(user);
    }
    return committedBalance;
  }

  function underlyingBalanceOf(address user) public view returns (uint256) {
    return balanceOf(user) * exchangeRate();
  }

  function exchangeRate() public view returns (int256) {
    return drawIndexExchangeRates[exchangeRateDrawIds.length - 1];
  }

  modifier onlyPool() {
    require(msg.sender == address(pool), "Pod/only-pool");
    _;
  }
}