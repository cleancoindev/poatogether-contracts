const BN = require('bn.js')
const setupERC1820 = require('./setupERC1820')

const debug = require('debug')('PoolContext.js')

module.exports = function PoolContext({ web3, artifacts, accounts }) {

  const [owner, admin, user1, user2, rewardAccount] = accounts

  const BasePool = artifacts.require('BasePool.sol')
  const MockPOSDAORandom = artifacts.require('MockPOSDAORandom.sol')
  const FixidityLib = artifacts.require('FixidityLib.sol')
  const SortitionSumTreeFactory = artifacts.require('SortitionSumTreeFactory.sol')
  const DrawManager = artifacts.require('DrawManager.sol')
  const Blocklock = artifacts.require('Blocklock.sol')
  const PoolToken = artifacts.require('RecipientWhitelistPoolToken.sol')

  this.init = async () => {
    this.registry = await setupERC1820({ web3, artifacts, account: owner })
    this.sumTree = await SortitionSumTreeFactory.new()
    await DrawManager.link("SortitionSumTreeFactory", this.sumTree.address)
    this.drawManager = await DrawManager.new()
    await BasePool.link('DrawManager', this.drawManager.address)
    this.fixidity = await FixidityLib.new({ from: admin })
    this.blocklock = await Blocklock.new()
    this.random = await MockPOSDAORandom.new({ from: admin })
  }

  this.balance = async () => {
    return await web3.eth.getBalance(this.pool.address)
  }

  this.depositPool = async (options) => {
    await this.pool.depositPool(options) 
  }

  this.createPool = async (feeFraction = new BN('0'), cooldownDuration = 1) => {
    this.pool = await this.createPoolNoOpenDraw(feeFraction, cooldownDuration)
    await this.openNextDraw()
    return this.pool
  }

  this.createToken = async () => {
    this.poolToken = await PoolToken.new()
    await this.poolToken.init(
      'Prize Dai', 'pzDAI', [], this.pool.address
    )

    assert.equal(await this.poolToken.pool(), this.pool.address)

    await this.pool.setPoolToken(this.poolToken.address)

    return this.poolToken
  }

  this.newPool = async () => {
    await BasePool.link("DrawManager", this.drawManager.address)
    await BasePool.link("FixidityLib", this.fixidity.address)
    await BasePool.link('Blocklock', this.blocklock.address)
    
    return await BasePool.new()
  }

  this.createPoolNoOpenDraw = async (feeFraction = new BN('0'), cooldownDuration = 1) => {
    this.pool = await this.newPool()

    // just long enough to lock then reward
    const lockDuration = 3
    
    await this.pool.init(
      owner,
      this.random.address,
      feeFraction,
      owner,
      lockDuration,
      cooldownDuration
    )

    return this.pool
  }

  this.rewardAndOpenNextDraw = async (options) => {
    let logs

    debug(`rewardAndOpenNextDraw()`)
    await this.pool.lockTokens()
    if (options) {
      logs = (await this.pool.rewardAndOpenNextDraw(options)).logs;
    } else {
      logs = (await this.pool.rewardAndOpenNextDraw()).logs;
    }

    // console.log(logs.map(log => log.event))

    const [Rewarded, FeeCollected, Committed, Opened] = logs

    debug('rewardAndOpenNextDraw: ', logs)
    assert.equal(Opened.event, "Opened")
    assert.equal(Rewarded.event, 'Rewarded')
    assert.equal(Committed.event, 'Committed')  

    return { Rewarded, Committed }
  }

  this.openNextDraw = async () => {
    debug(`openNextDraw()`)
    let logs = (await this.pool.openNextDraw()).logs

    const Committed = logs.find(log => log.event === 'Committed')
    const Opened = logs.find(log => log.event === 'Opened')

    return { Committed, Opened }
  }

  this.nextDraw = async (options) => {
    const currentDrawId = await this.pool.currentCommittedDrawId()

    if (currentDrawId.toString() === '0') {
      return await this.openNextDraw()
    } else {
      debug(`reward(${this.pool.address})`)
      const balance = await web3.eth.getBalance(this.pool.address)
      await web3.eth.sendTransaction({
        to: this.pool.address,
        from: rewardAccount,
        value: new BN(balance).mul(new BN(2)).div(new BN(10))
      })
      return await this.rewardAndOpenNextDraw(options)
    }
  }

  this.printDrawIds = async () => {
    const rewardId = await this.pool.currentRewardedDrawId()
    const commitId = await this.pool.currentCommittedDrawId()
    const openId = await this.pool.currentOpenDrawId()
    console.log({ rewardId, commitId, openId })
  }
}
