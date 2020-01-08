pragma solidity 0.5.12;

interface IPoolRewardListener {
  function drawWinner(uint256 _drawId, address _winner, uint256 _netWinnings) external;
}