#!/usr/bin/env node
const chalk = require('chalk')
const chai = require('chai')
const { toWei } = require('web3-utils')
const { runShell } = require('../fork/runShell')


async function migrate(context, ozNetworkName, ozOptions = '') {
  console.log(chalk.yellow('Starting migration...'))

  let {
    walletAtIndex
  } = context

  const randomContract = '0x8f2b78169B0970F11a762e56659Db52B59CBCf1B'
  const ownerWallet = await walletAtIndex(0)
  const feeFraction = '0'
  const lockDuration = 40
  const cooldownDuration = ozNetworkName === 'mainnet' ? lockDuration : 1
  const nextDrawShare = toWei('0.15') // 15%
  const executorShare = toWei('0.01') // 1%

  runShell(`oz session ${ozOptions} --network ${ozNetworkName} --from ${process.env.ADMIN_ADDRESS} --expires 3600 --timeout 600`)

  console.log(chalk.green('Starting'))

  runShell(`oz create Pool --init init --args ${ownerWallet.address},${randomContract},${feeFraction},${ownerWallet.address},${lockDuration},${cooldownDuration},${nextDrawShare},${executorShare}`)
  context.reload()

  runShell(`oz create PoolToken ${ozOptions} --network ${ozNetworkName} --init init --args '"Pool POA","poolPOA",[],${context.contracts.Pool.address}'`)
  context.reload()

  chai.expect(await context.contracts.Pool.isAdmin(ownerWallet.address)).to.be.true
  await context.contracts.Pool.setPoolToken(context.contracts.PoolToken.address)
  await context.contracts.Pool.addAdmin('0x79DF43B54c31c72a3d93465bdf72317C751822B3')

  console.log(chalk.green('Done!'))
}

module.exports = {
  migrate
}
