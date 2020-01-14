const toWei = require('./helpers/toWei')
const fromWei = require('./helpers/fromWei')
const chai = require('./helpers/chai')
const PoolContext = require('./helpers/PoolContext')
const Pod = artifacts.require('Pod.sol')
const BN = require('bn.js')

const FIXED_1 = '1000000000000000000'

contract('Pod', (accounts) => {
  const [owner, admin, user1, user2, user3] = accounts

  let pod, contracts
  let token, registry, moneyMarket, pool, poolToken

  let poolContext = new PoolContext({ web3, artifacts, accounts })

  beforeEach(async () => {
    contracts = await poolContext.init()
    token = contracts.token
    registry = contracts.registry
    moneyMarket = contracts.moneyMarket
    pool = await poolContext.createPool(new BN('0'))
    poolToken = await poolContext.createToken()
  })

  async function depositDrawTransfer(amount, user, options = {}) {
    // deposit into pool
    await poolContext.depositPool(amount, { from: user })
    // commit and mint tickets
    await poolContext.nextDraw({ prize: options.prize || toWei('2') })
    // transfer into pod
    await poolToken.transfer(pod.address, amount, { from: user })
  }

  describe('initialize()', () => {
    beforeEach(async () => {
      pod = await Pod.new()
    })
    
    it('should initialize the contract properly', async () => {
      await pod.initialize(pool.address)
      assert.equal(await pod.pool(), pool.address)
      assert.equal(await registry.getInterfaceImplementer(pod.address, web3.utils.soliditySha3('ERC777TokensRecipient')), pod.address)
    })
  })

  describe('exchangeRate()', () => {
    beforeEach(async () => {
      pod = await poolContext.createPod()
    })

    it('should default to one million', async () => {
      assert.equal(await pod.exchangeRate(), toWei('1000000'))
    })    
  })

  describe('tokensReceived()', () => {
    beforeEach(async () => {
      pod = await poolContext.createPod()
    })

    it('should accept pool tokens', async () => {
      const amount = toWei('10')

      await depositDrawTransfer(amount, user1)

      // now should have 10 million tokens
      const tenMillion = toWei('10000000')
      assert.equal(await pod.balanceOf(user1), tenMillion)
      assert.equal(await pod.totalSupply(), tenMillion)

      assert.equal(await pool.committedBalanceOf(pod.address), amount)
    })

    it('should mint everyone the same number', async () => {
      const amount = toWei('10')

      // deposit into pool
      await poolContext.depositPool(amount, { from: user1 })
      // deposit into pool
      await poolContext.depositPool(amount, { from: user2 })

      // commit and mint tickets
      await poolContext.nextDraw()

      // transfer into pod
      await poolToken.transfer(pod.address, amount, { from: user1 })

      // transfer into pod
      await poolToken.transfer(pod.address, amount, { from: user2 })
    
      const tenMillion = toWei('10000000')
      // both should have 10 million tokens
      assert.equal(await pod.balanceOf(user1), tenMillion)
      assert.equal(await pod.balanceOf(user2), tenMillion)
    })

    it('should calculate the exchange rate when there are winnings', async () => {
      const amount = toWei('10')
      // deposit, commit and transfer
      await depositDrawTransfer(amount, user1)

      // deposit, reward, and transfer.
      await depositDrawTransfer(amount, user2)

      const tenMillion = toWei('10000000')
      assert.equal(await pod.balanceOf(user1), tenMillion)

      assert.equal((await pod.balanceOfUnderlying(user1)).toString(), toWei('12'))
      assert.equal((await pod.balanceOfUnderlying(user2)).toString(), toWei('10'))
      assert.equal((await pool.committedBalanceOf(pod.address)), toWei('22'))

      // deposit, reward, and transfer.
      await depositDrawTransfer(amount, user3)

      // now 12/22 = 0.545454545...
      // and 10/22 = 0.454545454...
      // 2 * 12 / 22 = 1.0909090909090909...
      // 2 * 10 / 22 = 0.9090909090909090...

      assert.equal((await pod.balanceOfUnderlying(user1)).toString(), '13090909090909090909')
      assert.equal((await pod.balanceOfUnderlying(user2)).toString(), '10909090909090909090')
      assert.equal((await pod.balanceOfUnderlying(user3)).toString(), toWei('10'))
      assert.equal((await pool.committedBalanceOf(pod.address)), toWei('34'))
    })
  })
})
