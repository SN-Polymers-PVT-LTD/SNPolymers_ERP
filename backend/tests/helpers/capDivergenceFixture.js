const { seedFinancialScenario, cleanupFinancialScenario, insertRequisitionViaRpc } = require('./financialFixture');

/**
 * Seeds a scenario where work_order_value !== estimate_amount for cap-divergence tests.
 */
async function seedCapDivergenceScenario({
  suffix,
  workOrderValue = 500000,
  estimateAmount = 300000,
  cementHeadAmount = 300000,
  sandHeadAmount = 0,
  zoBalance = 50000
} = {}) {
  return seedFinancialScenario({
    suffix,
    workOrderValue,
    estimateAmount,
    cementHeadAmount,
    sandHeadAmount,
    zoBalance
  });
}

module.exports = {
  seedCapDivergenceScenario,
  cleanupFinancialScenario,
  insertRequisitionViaRpc
};
