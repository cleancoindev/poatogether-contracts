const toWei = require('./helpers/toWei')
const fromWei = require('./helpers/fromWei')
const chai = require('./helpers/chai')
const PoolContext = require('./helpers/PoolContext')
const setupERC1820 = require('./helpers/setupERC1820')
const BN = require('bn.js')
const Pool = artifacts.require('BasePool.sol')
const {
  ZERO_ADDRESS,
  TICKET_PRICE
} = require('./helpers/constants')

const debug = require('debug')('Pool.test.js')

contract('BasePool', (accounts) => {
  let pool
  
  const [owner, admin, user1, user2, rewardAccount] = accounts

  const priceForTenTickets = TICKET_PRICE.mul(new BN(10))

  let feeFraction, contracts

  let poolContext = new PoolContext({ web3, artifacts, accounts })

  beforeEach(async () => {
    feeFraction = new BN('0')
    await setupERC1820({ web3, artifacts, account: owner })
    await poolContext.init()
    contracts = poolContext
    random = contracts.random
    await Pool.link("DrawManager", contracts.drawManager.address)
    await Pool.link("FixidityLib", contracts.fixidity.address)
    await Pool.link("Blocklock", contracts.blocklock.address)
  })

  describe('init()', () => {
    it('should fail if owner is zero', async () => {
      pool = await Pool.new()
      await chai.assert.isRejected(pool.init(
        ZERO_ADDRESS,
        random.address,
        new BN('0'),
        owner,
        10,
        10
      ), /Pool\/owner-zero/)
    })

    it('should fail if random contract is zero', async () => {
      pool = await Pool.new()
      await chai.assert.isRejected(pool.init(
        owner,
        ZERO_ADDRESS,
        new BN('0'),
        owner,
        10,
        10
      ), /Random\/contract-zero/)
    })
  })

  describe('addAdmin()', () =>{
    beforeEach(async () => {
      pool = await poolContext.createPool(feeFraction)
    })

    it('should allow an admin to add another', async () => {
      await pool.addAdmin(user1)
      assert.ok(await pool.isAdmin(user1))
    })

    it('should not allow a non-admin to remove an admin', async () => {
      await chai.assert.isRejected(pool.addAdmin(user2, { from: user1 }), /Pool\/admin/)
    })
  })

  describe('removeAdmin()', () =>{
    beforeEach(async () => {
      pool = await poolContext.createPool(feeFraction)
      await pool.addAdmin(user1)
    })

    it('should allow an admin to remove another', async () => {
      await pool.removeAdmin(user1)
      assert.ok(!(await pool.isAdmin(user1)))
    })

    it('should not allow a non-admin to remove an admin', async () => {
      await chai.assert.isRejected(pool.removeAdmin(user1, { from: admin }), /Pool\/admin/)
    })

    it('should not an admin to remove an non-admin', async () => {
      await chai.assert.isRejected(pool.removeAdmin(user2), /Pool\/no-admin/)
    })

    it('should not allow an admin to remove themselves', async () => {
      await chai.assert.isRejected(pool.removeAdmin(owner), /Pool\/remove-self/)
    })
  })

  describe('committedBalanceOf()', () => {
    it('should return the users balance for the current draw', async () => {
      pool = await poolContext.createPool(feeFraction)

      await poolContext.depositPool({ from: user1, value: TICKET_PRICE })

      assert.equal((await pool.committedBalanceOf(user1)).toString(), '0')

      await poolContext.nextDraw()

      assert.equal(await pool.committedBalanceOf(user1), TICKET_PRICE.toString())
    })
  })

  describe('openBalanceOf()', () => {
    it('should return the users balance for the current draw', async () => {
      pool = await poolContext.createPool(feeFraction)

      await pool.depositPool({ from: user1, value: TICKET_PRICE })

      assert.equal((await pool.openBalanceOf(user1)).toString(), TICKET_PRICE.toString())

      await poolContext.nextDraw()

      assert.equal(await pool.openBalanceOf(user1), '0')
    })
  })

  describe('getDraw()', () => {
    it('should return empty values if no draw exists', async () => {
      pool = await poolContext.createPool(feeFraction)
      const draw = await pool.getDraw(12)
      assert.equal(draw.feeFraction, '0')
      assert.equal(draw.feeBeneficiary, ZERO_ADDRESS)
      assert.equal(draw.openedBlock, '0')
    })

    it('should return true values if a draw exists', async () => {
      feeFraction = toWei('0.1')
      pool = await poolContext.createPool(feeFraction)
      await poolContext.nextDraw()
      const draw = await pool.getDraw(1)
      assert.equal(draw.feeFraction.toString(), feeFraction.toString())
      assert.equal(draw.feeBeneficiary, owner)
      assert.ok(draw.openedBlock !== '0')
    })
  })

  describe('openNextDraw()', () => {
    beforeEach(async () => {
      pool = await poolContext.createPool(feeFraction)
    })

    it('should have opened a draw', async () => {
      assert.equal(await pool.currentOpenDrawId(), '1')
      const events = await pool.getPastEvents()
      assert.equal(events.length, 1)
      const firstEvent = events[0]
      assert.equal(firstEvent.event, 'Opened')
      const { drawId } = firstEvent.args
      assert.equal(drawId, '1')
    })

    it('should emit a committed event', async () => {
      const tx = await pool.openNextDraw() // now has a committed draw

      const [Committed, Opened] = tx.logs
      assert.equal(Committed.event, 'Committed')
      assert.equal(Committed.args.drawId, '1')
      assert.equal(Opened.event, 'Opened')
      assert.equal(Opened.args.drawId, '2')
    })

    it('should revert when the committed draw has not been rewarded', async () => {
      await pool.openNextDraw()
      await chai.assert.isRejected(pool.openNextDraw(), /Pool\/not-reward/)
    })

    it('should succeed when the committed draw has been rewarded', async () => {
      await pool.openNextDraw() // now has a committed draw 2
      await pool.lockTokens()
      await pool.reward() // committed draw 2 is now rewarded
      const tx = await pool.openNextDraw() // now can open the next draw 3

      const [Committed, Opened] = tx.logs
      assert.equal(Committed.event, 'Committed')
      assert.equal(Committed.args.drawId, '2')
      assert.equal(Opened.event, 'Opened')
      assert.equal(Opened.args.drawId, '3')
    })
  })

  describe('reward()', () => {
    beforeEach(async () => {
      pool = await poolContext.createPool(feeFraction)
    })

    it('should fail if there is no committed draw', async () => {
      await pool.lockTokens()
      await chai.assert.isRejected(pool.reward(), /Pool\/committed/)
    })

    it('should fail if the committed draw has already been rewarded', async () => {
      await poolContext.nextDraw()
      await pool.lockTokens()
      await pool.reward()

      // Trigger the next block (only on testrpc!)
      await web3.eth.sendTransaction({ to: user1, from: user2, value: 1 })
      await pool.lockTokens()
      await chai.assert.isRejected(pool.reward(), /Pool\/already/)
    })

    it('should award the interest to the winner', async () => {
      await poolContext.depositPool({ from: user1, value: toWei('10') })
      await pool.openNextDraw() // now committed and open

      await web3.eth.sendTransaction({ to: pool.address, from: rewardAccount, value: toWei('2') })
      await pool.lockTokens()
      await pool.reward() // reward winnings to user1 and fee to owner
      assert.equal(await pool.balanceOf(user1), toWei('10'))
      assert.equal(await pool.openBalanceOf(user1), toWei('2'))
    })
  })

  describe('lockTokens()', () => {
    beforeEach(async () => {
      pool = await poolContext.createPool(feeFraction, 12)
    })

    it('should lock the pool', async () => {
      assert.equal(await pool.isLocked(), false)
      await pool.lockTokens()
      assert.equal(await pool.isLocked(), true)
    })

    it('should only be called by the admin', async () => {
      await chai.assert.isRejected(pool.lockTokens({ from: user1 }), /Pool\/admin/)
    })
  })

  describe('lockDuration()', () => {
    beforeEach(async () => {
      pool = await poolContext.createPool(feeFraction, 12)
    })

    it('should return the lock duration', async () => {
      assert.equal(await pool.lockDuration(), '3')
    })
  })

  describe('lockEndAt()', () => {
    beforeEach(async () => {
      pool = await poolContext.createPool(feeFraction, 12)
    })

    it('should return the lock end block', async () => {
      await pool.lockTokens()
      const blockNumber = await web3.eth.getBlockNumber()
      assert.equal((await pool.lockEndAt()).toString(), '' + (blockNumber + 3))
    })
  })

  describe('cooldownEndAt()', () => {
    beforeEach(async () => {
      pool = await poolContext.createPool(feeFraction, 12)
    })

    it('should return the cooldown end block', async () => {
      await pool.lockTokens()
      const blockNumber = await web3.eth.getBlockNumber()
      assert.equal((await pool.cooldownEndAt()).toString(), '' + (blockNumber + 3 + 12))
    })
  })

  describe('cooldownDuration()', () => {
    beforeEach(async () => {
      pool = await poolContext.createPool(feeFraction, 12)
    })

    it('should return the cooldown duration', async () => {
      assert.equal(await pool.cooldownDuration(), '12')
    })
  })

  describe('unlockTokens()', () => {
    beforeEach(async () => {
      pool = await poolContext.createPool(feeFraction)
      await pool.lockTokens()  
    })

    it('should unlock the pool', async () => {
      await pool.unlockTokens()  
      assert.equal(await pool.isLocked(), false)
    })

    it('should only be called by the admin', async () => {
      await chai.assert.isRejected(pool.unlockTokens({ from: user1 }), /Pool\/admin/)
    })
  })

  describe('rewardAndOpenNextDraw()', () => {
    beforeEach(async () => {
      pool = await poolContext.createPool(feeFraction)
    })

    it('should revert if the pool isnt locked', async () => {
      await chai.assert.isRejected(pool.rewardAndOpenNextDraw(), /Pool\/unlocked/)
    })

    it('should revert if there is no committed draw', async () => {
      await pool.lockTokens()
      await chai.assert.isRejected(pool.rewardAndOpenNextDraw(), /Pool\/committed/)
    })
  })

  describe('depositPool()', () => {
    beforeEach(async () => {
      pool = await poolContext.createPoolNoOpenDraw()
    })

    it('should fail if there is no open draw', async () => {
      await chai.assert.isRejected(pool.depositPool({ from: user1, value: TICKET_PRICE }), /Pool\/no-open/)
    })
  })

  describe('with a fresh pool', () => {
    beforeEach(async () => {
      pool = await poolContext.createPool(feeFraction)
    })

    describe('depositPool()', () => {
      it('should deposit some tokens into the pool', async () => {
        const response = await pool.depositPool({ from: user1, value: TICKET_PRICE })
        const deposited = response.receipt.logs[response.receipt.logs.length - 1]
        assert.equal(deposited.event, 'Deposited')
        assert.equal(deposited.address, pool.address)
        assert.equal(deposited.args[0], user1)
        assert.equal(deposited.args[1].toString(), TICKET_PRICE)
      })

      it('should allow multiple deposits', async () => {
        await pool.depositPool({ from: user1, value: TICKET_PRICE })
        await pool.depositPool({ from: user1, value: TICKET_PRICE })

        const amount = await pool.totalBalanceOf(user1)
        assert.equal(amount.toString(), TICKET_PRICE.mul(new BN(2)).toString())
      })
    })

    describe('withdrawOpenDeposit()', () => {
      it('should allow a user to withdraw their open deposit', async () => {
        await pool.depositPool({ from: user1, value: toWei('10') })

        assert.equal(await pool.openBalanceOf(user1), toWei('10'))

        const { logs } = await pool.withdrawOpenDeposit(toWei('10'), { from: user1 })

        assert.equal(await pool.openBalanceOf(user1), toWei('0'))

        const [ OpenDepositWithdrawn ] = logs

        assert.equal(OpenDepositWithdrawn.event, 'OpenDepositWithdrawn')
        assert.equal(OpenDepositWithdrawn.args.sender, user1)
        assert.equal(OpenDepositWithdrawn.args.amount, toWei('10'))
      })

      it('should allow a user to partially withdraw their open deposit', async () => {
        await pool.depositPool({ from: user1, value: toWei('10') })
        assert.equal(await pool.openBalanceOf(user1), toWei('10'))
        await pool.withdrawOpenDeposit(toWei('6'), { from: user1 })
        assert.equal(await pool.openBalanceOf(user1), toWei('4'))
      })

      it('should not allow a user to withdraw more than their open deposit', async () => {
        await chai.assert.isRejected(pool.withdrawOpenDeposit(toWei('6'), { from: user1 }), /DrawMan\/exceeds-open/)
      })
    })

    describe('withdrawCommittedDeposit()', () => {
      it('should allow a user to withdraw their committed deposit', async () => {
        await pool.depositPool({ from: user1, value: toWei('10') })
        await poolContext.nextDraw()

        const { logs } = await pool.withdrawCommittedDeposit(toWei('3'), { from: user1 })
        assert.equal(await pool.committedBalanceOf(user1), toWei('7'))

        const [ CommittedDepositWithdrawn ] = logs

        assert.equal(CommittedDepositWithdrawn.event, 'CommittedDepositWithdrawn')
        assert.equal(CommittedDepositWithdrawn.args.sender, user1)
        assert.equal(CommittedDepositWithdrawn.args.amount, toWei('3'))
      })

      it('should call burn on the poolToken if available', async () => {
        let poolToken = await poolContext.createToken()

        await pool.depositPool({ from: user1, value: toWei('10') })
        await poolContext.nextDraw()

        const { receipt } = await pool.withdrawCommittedDeposit(toWei('3'), { from: user1 })

        const [Redeemed] = await poolToken.getPastEvents({fromBlock: receipt.blockNumber, toBlock: 'latest'})

        assert.equal(Redeemed.event, 'Redeemed')
        assert.equal(Redeemed.args.from, user1)
        assert.equal(Redeemed.args.amount, toWei('3'))
      })
    })

    describe('withdrawCommittedDepositFrom(address,uint256)', () => {
      it('should only be called by the token', async () => {
        await chai.assert.isRejected(pool.withdrawCommittedDepositFrom(user1, toWei('0')), /Pool\/only-token/)
      })
    })

    describe('withdraw()', () => {

      it('should call the PoolToken', async () => {
        await pool.depositPool({ from: user1, value: TICKET_PRICE })
        await poolContext.nextDraw()

        const poolToken = await poolContext.createToken()

        await pool.withdraw({ from: user1 })

        const [Redeemed, Transfer] = await poolToken.getPastEvents({fromBlock: 0, toBlock: 'latest'})

        // console.log(Redeemed)

        assert.equal(Redeemed.event, 'Redeemed')
        assert.equal(Redeemed.args.from, user1)
        assert.equal(Redeemed.args.amount, TICKET_PRICE.toString())
      })

      it('should work for one participant', async () => {
        await pool.depositPool({ from: user1, value: TICKET_PRICE })
        await poolContext.nextDraw()
        await poolContext.nextDraw()

        let balance = await pool.totalBalanceOf(user1)
        assert.equal(balance.toString(), toWei('1.2'))

        const balanceBefore = await web3.eth.getBalance(user1)
        const { receipt } = await pool.withdraw({ from: user1, gasPrice: 1 })
        const balanceAfter = await web3.eth.getBalance(user1)

        assert.equal(
          new BN(balanceAfter).add(new BN(receipt.gasUsed)).toString(),
          new BN(balanceBefore).add(balance).toString()
        )
      })

      it('should work for two participants', async () => {
        await pool.depositPool({ from: user1, value: priceForTenTickets })
        await pool.depositPool({ from: user2, value: priceForTenTickets })

        assert.equal((await pool.openSupply()).toString(), toWei('20'))

        await poolContext.nextDraw()

        assert.equal((await pool.openSupply()).toString(), toWei('0'))
        assert.equal((await pool.committedSupply()).toString(), toWei('20'))

        const { Rewarded } = await poolContext.nextDraw()
        
        const user1BalanceBefore = await web3.eth.getBalance(user1)
        const tx1 = await pool.withdraw({ from: user1, gasPrice: 1 })
        const user1BalanceAfter = await web3.eth.getBalance(user1)

        const user2BalanceBefore = await web3.eth.getBalance(user2)        
        const tx2 = await pool.withdraw({ from: user2, gasPrice: 1 })
        const user2BalanceAfter = await web3.eth.getBalance(user2)

        const earnedInterest = priceForTenTickets.mul(new BN(2)).mul(new BN(20)).div(new BN(100))

        if (Rewarded.args.winner === user1) {
          assert.equal(
            new BN(user2BalanceAfter).add(new BN(tx2.receipt.gasUsed)).toString(),
            new BN(user2BalanceBefore).add(priceForTenTickets).toString()
          )
          assert.equal(
            new BN(user1BalanceAfter).add(new BN(tx1.receipt.gasUsed)).toString(),
            new BN(user1BalanceBefore).add(priceForTenTickets.add(earnedInterest)).toString()
          )
        } else if (Rewarded.args.winner === user2) {
          assert.equal(
            new BN(user2BalanceAfter).add(new BN(tx2.receipt.gasUsed)).toString(),
            new BN(user2BalanceBefore).add(priceForTenTickets.add(earnedInterest)).toString()
          )
          assert.equal(
            new BN(user1BalanceAfter).add(new BN(tx1.receipt.gasUsed)).toString(),
            new BN(user1BalanceBefore).add(priceForTenTickets).toString()
          )
        } else {
          throw new Error(`Unknown winner: ${info.winner}`)
        }
      })

      it('should work when one user withdraws before the next draw', async () => {
        await pool.depositPool({ from: user1, value: priceForTenTickets })
        await pool.depositPool({ from: user2, value: priceForTenTickets })

        await poolContext.nextDraw()

        // pool is now committed and earning interest
        await pool.withdraw({ from: user2 })

        const { Rewarded } = await poolContext.nextDraw()

        // pool has been rewarded
        // earned interest will only be 20% of user1's ticket balance
        const earnedInterest = priceForTenTickets.mul(new BN(20)).div(new BN(100))

        assert.equal(Rewarded.args.winner, user1)
        assert.equal((await pool.totalBalanceOf(user1)).toString(), earnedInterest.add(priceForTenTickets).toString())
      })
    })

    describe('balanceOf()', () => {
      it('should return the entrants total to withdraw', async () => {
        await pool.depositPool({ from: user1, value: TICKET_PRICE })

        let balance = await pool.totalBalanceOf(user1)

        assert.equal(balance.toString(), TICKET_PRICE.toString())
      })
    })
  })

  describe('when fee fraction is greater than zero', () => {
    beforeEach(() => {
      /// Fee fraction is 10%
      feeFraction = web3.utils.toWei('0.1', 'ether')
    })

    it('should reward the owner the fee', async () => {

      pool = await poolContext.createPool(feeFraction)

      const user1Tickets = TICKET_PRICE.mul(new BN(10))
      await pool.depositPool({ from: user1, value: user1Tickets })

      await poolContext.nextDraw()

      /// CErc20Mock awards 20% regardless of duration.
      const totalDeposit = user1Tickets
      const interestEarned = totalDeposit.mul(new BN(20)).div(new BN(100))
      const fee = interestEarned.mul(new BN(10)).div(new BN(100))

      // we expect unlocking to transfer the fee to the owner
      const { Rewarded } = await poolContext.nextDraw()

      assert.equal(Rewarded.args.fee.toString(), fee.toString())

      assert.equal((await pool.totalBalanceOf(owner)).toString(), fee.toString())

      // we expect the pool winner to receive the interest less the fee
      const user1Balance = new BN(await web3.eth.getBalance(user1))
      const { receipt } = await pool.withdraw({ from: user1, gasPrice: 1 })
      const newUser1Balance = new BN(await web3.eth.getBalance(user1))
      assert.equal(
        newUser1Balance.add(new BN(receipt.gasUsed)).toString(),
        user1Balance.add(user1Tickets).add(interestEarned).sub(fee).toString()
      )
    })
  })

  describe('when a pool is rewarded without a winner', () => {
    it('should save the winnings for the next draw', async () => {

      // Here we create the pool and open the first draw
      pool = await poolContext.createPool(feeFraction)

      // Now we commit a draw, and open a new draw
      await poolContext.openNextDraw()

      // We deposit into the pool
      const depositAmount = web3.utils.toWei('10', 'ether')
      await pool.depositPool({ from: user1, value: depositAmount })

      // The money market should have received this
      assert.equal(await poolContext.balance(), toWei('10'))

      // The pool is awarded interest, now should have deposit + 20%
      await web3.eth.sendTransaction({ to: pool.address, from: rewardAccount, value: toWei('2') })

      // The new balance should include 20%
      assert.equal(await poolContext.balance(), toWei('12'))

      // Now we reward the first committed draw.  There should be no winner, and the winnings should carry over
      await poolContext.rewardAndOpenNextDraw()

      // The user's balance should remain the same
      assert.equal((await pool.totalBalanceOf(user1)).toString(), depositAmount.toString())

      // Trigger the next block (only on testrpc!)
      await web3.eth.sendTransaction({ to: user1, from: user2, value: 1 })

      // Now even though there was no reward, the winnings should have carried over
      await poolContext.rewardAndOpenNextDraw()

      // The user's balance should include the winnings
      assert.equal((await pool.totalBalanceOf(user1)).toString(), web3.utils.toWei('12'))

    })
  })

  describe('setNextFeeFraction()', () => {
    beforeEach(async () => {
      pool = await poolContext.createPool(feeFraction)
    })

    it('should allow the owner to set the next fee fraction', async () => {
      await pool.setNextFeeFraction(toWei('0.05'))
      assert.equal((await pool.nextFeeFraction()).toString(), toWei('0.05'))
    })

    it('should not allow anyone else to set the fee fraction', async () => {
      await chai.assert.isRejected(pool.setNextFeeFraction(toWei('0.05'), { from: user1 }), /Pool\/admin/)
    })

    it('should require the fee fraction to be less than or equal to 1', async () => {
      // 1 is okay
      await pool.setNextFeeFraction(toWei('1'))
      await chai.assert.isRejected(pool.setNextFeeFraction(toWei('1.1')), /Pool\/less-1/)
    })
  })

  describe('setNextFeeBeneficiary()', () => {
    beforeEach(async () => {
      pool = await poolContext.createPool(feeFraction)
    })

    it('should allow the owner to set the next fee fraction', async () => {
      await pool.setNextFeeBeneficiary(user1)
      assert.equal((await pool.nextFeeBeneficiary()).toString(), user1)
    })

    it('should not allow anyone else to set the fee fraction', async () => {
      await chai.assert.isRejected(pool.setNextFeeBeneficiary(user1, { from: user1 }), /Pool\/admin/)
    })

    it('should not allow the beneficiary to be zero', async () => {
      await chai.assert.isRejected(pool.setNextFeeBeneficiary(ZERO_ADDRESS), /Pool\/not-zero/)
    })
  })

  describe('pauseDeposits()', () => {
    beforeEach(async () => {
      pool = await poolContext.createPool(feeFraction)
      await poolContext.nextDraw()
    })

    it('should not allow any more deposits', async () => {
      await pool.pauseDeposits()
      await chai.assert.isRejected(poolContext.depositPool({ from: user2, value: toWei('10') }), /Pool\/d-paused/)
    })
  })

  describe('unpauseDeposits()', () => {
    beforeEach(async () => {
      pool = await poolContext.createPool(feeFraction)
    })

    it('should not work unless paused', async () => {
      await chai.assert.isRejected(pool.unpauseDeposits(), /Pool\/d-not-paused/)
    })

    it('should allow deposit after unpausing', async () => {
      await pool.pauseDeposits()
      await pool.unpauseDeposits()
      await poolContext.depositPool({ from: user2, value: toWei('10') })
    })
  })
})
