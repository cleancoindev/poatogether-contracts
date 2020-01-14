pragma solidity ^0.5.12;

import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";

// Algorithm taken from https://accu.org/index.php/journals/1717
contract FixedPoint {
  using SafeMath for uint256;

  uint256 public constant SCALE = 1e18;
  uint256 public constant HALF_SCALE = SCALE / 2;

  struct Fixed18 {
    uint256 mantissa;
  }

  function newFixed(uint256 mantissa) internal pure returns (Fixed18 memory) {
    return Fixed18(mantissa);
  }

  function newFixed(uint256 numerator, uint256 denominator) internal pure returns (Fixed18 memory) {
    uint256 mantissa = numerator.mul(SCALE);
    mantissa = mantissa.div(denominator);
    return Fixed18(mantissa);
  }

  function multiplyUint(Fixed18 memory f, uint256 b) internal pure returns (uint256) {
    uint256 result = f.mantissa.mul(b);
    result = result.div(SCALE);
    return result;
  }

  function divideUintByFixed(uint256 dividend, Fixed18 memory divisor) internal pure returns (uint256) {
    uint256 result = SCALE.mul(dividend);
    result = result.div(divisor.mantissa);
    return result;
  }

  function multiplyMantissa(uint256 a, uint256 b) public pure returns (uint256) {
    uint256 result = a.mul(b);
    result = result.add(HALF_SCALE);
    result = result.div(SCALE);
    return result;
  }

  function divideMantissa(uint256 dividend, uint256 divisor) public pure returns (uint256) {
    uint256 result = dividend.add(divisor.div(2));
    result = result.mul(SCALE);
    result = result.div(divisor);
    return result;
  }
}