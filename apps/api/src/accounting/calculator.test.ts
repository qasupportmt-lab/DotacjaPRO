import assert from 'node:assert/strict';
import {
  calculatePit36ActivityLine,
  calculateQuarterLimitSummary,
  formatPln
} from './calculator.js';

const sale = (overrides: Partial<any> = {}) => ({
  status: 'COMPLETED',
  currency: 'PLN',
  amountDueGrosz: 100_000,
  amountReceivedGrosz: 100_000,
  refundedGrosz: 0,
  dueAt: new Date('2026-10-04T07:00:00+02:00'),
  receivedAt: new Date('2026-10-04T07:00:00+02:00'),
  refundedAt: null,
  isTest: false,
  ...overrides
});

{
  const summary = calculateQuarterLimitSummary(
    [sale(), sale({ amountDueGrosz: 50_050, amountReceivedGrosz: 50_050 })],
    2026,
    4
  );
  assert.equal(summary.dueRevenueGrosz, 150_050);
  assert.equal(summary.remainingGrosz, 931_300);
  assert.equal(formatPln(summary.remainingGrosz!), '9313.00');
  assert.equal(summary.arithmetic.computationalErrorPln, '0.000');
}

{
  const summary = calculateQuarterLimitSummary(
    [
      sale({ refundedGrosz: 25_000, refundedAt: new Date('2026-10-05T12:00:00+02:00') }),
      sale({ isTest: true, amountDueGrosz: 999_999 })
    ],
    2026,
    4
  );
  assert.equal(summary.dueRevenueGrosz, 75_000);
}

{
  const pit = calculatePit36ActivityLine(
    [
      sale(),
      sale({
        amountDueGrosz: 50_000,
        amountReceivedGrosz: 50_000,
        refundedGrosz: 10_000,
        refundedAt: new Date('2026-11-01T12:00:00+01:00')
      })
    ],
    [
      {
        amountGrosz: 20_000,
        incurredAt: new Date('2026-10-10T12:00:00+02:00'),
        deductible: true,
        documentReference: 'FV/1/2026'
      }
    ],
    2026
  );
  assert.equal(pit.revenueCandidateGrosz, 140_000);
  assert.equal(pit.deductibleCostsGrosz, 20_000);
  assert.equal(pit.incomeCandidateGrosz, 120_000);
}

console.log('accounting calculator tests: OK');
