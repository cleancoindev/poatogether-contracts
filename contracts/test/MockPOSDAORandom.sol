pragma solidity 0.5.12;

import "../IPOSDAORandom.sol";

contract MockPOSDAORandom is IPOSDAORandom {
    function collectRoundLength() external view returns (uint256) {
        return 1;
    }
    function currentSeed() external view returns (uint256) {
        return uint256(keccak256(abi.encode(block.number)));
    }
    function isCommitPhase() external view returns (bool) {
        // return (block.number % 2) == 0;
        return true;
    }
}
