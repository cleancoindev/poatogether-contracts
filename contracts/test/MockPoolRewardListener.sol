pragma solidity 0.5.12;

import "../IPoolRewardListener.sol";
import "../MCDAwarePool.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/introspection/ERC1820Implementer.sol";

contract MockPoolRewardListener is Initializable, IPoolRewardListener, IERC1820Implementer {
  IERC1820Registry internal constant ERC1820_REGISTRY = IERC1820Registry(0x1820a4B7618BdE71Dce8cdc73aAB6C95905faD24);
  // keccak256("PoolRewardListener")
  bytes32 internal constant POOL_REWARD_LISTENER_HASH =
    0x0eac87979bfaf2ee04214abb7b986230831facc465751b8c410d8cd5f24e6398;

  // keccak256(abi.encodePacked("ERC1820_ACCEPT_MAGIC"));
  bytes32 constant private ERC1820_ACCEPT_MAGIC =
    0xa2ef4600d742022d532d4747cb3547474667d6f13804902513b2ec01c848f4b4;

  MCDAwarePool pool;

  bool public consumeGas;
  bool public raiseError;

  uint256 public drawId;
  address public winner;
  uint256 public netWinnings;

  mapping(uint256 => uint256) gasEater;

  function initialize(MCDAwarePool _pool) public initializer {
    pool = _pool;
    ERC1820_REGISTRY.setInterfaceImplementer(address(this), POOL_REWARD_LISTENER_HASH, address(this));
  }

  function canImplementInterfaceForAddress(bytes32 interfaceHash, address) external view returns (bytes32) {
    if (interfaceHash == POOL_REWARD_LISTENER_HASH) {
      return ERC1820_ACCEPT_MAGIC;
    } else {
      return bytes32(0);
    }
  }

  function setRaiseError(bool _raiseError) external {
    raiseError = _raiseError;
  }

  function setConsumeGas(bool _consumeGas) external {
    consumeGas = _consumeGas;
  }

  function drawWinner(uint256 _drawId, address _winner, uint256 _netWinnings) external {
    if (raiseError) {
      revert("eyyy this didna work eh?");
    } else if (consumeGas) {
      uint256 value = _netWinnings;
      while (true) {
        gasEater[value] = value;
        value = value + 1;
      }
    } else {
      drawId = _drawId;
      winner = _winner;
      netWinnings = _netWinnings;
    }
  }
}