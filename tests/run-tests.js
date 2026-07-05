process.env.TZ = "Asia/Ho_Chi_Minh";

import assert from "assert";
import {
  applyTransactionToBalances,
  calculateDebtImpact,
  calculateDebtDueDateFromAnchor,
  deduplicateCategoriesByName,
  getCategoryCanonicalKey,
  hasDomainData,
  mergeStates,
} from "../src/js/domain.js";
import { formatDateInput } from "../src/js/utils.js";

function assertDeepEqual(actual, expected, message) {
  try {
    assert.deepStrictEqual(actual, expected);
  } catch (err) {
    console.error(message);
    throw err;
  }
}

function runBalanceTests() {
  const balances = { a1: 0, a2: 0 };
  applyTransactionToBalances(
    { type: "income", accountToId: "a2", amount: 1000 },
    balances,
  );
  assert.strictEqual(
    balances.a2,
    1000,
    "Income should increase receiving account",
  );

  const balances2 = { a1: 1000, a2: 0 };
  applyTransactionToBalances(
    { type: "expense", accountFromId: "a1", amount: 500 },
    balances2,
  );
  assert.strictEqual(
    balances2.a1,
    500,
    "Expense should decrease source account",
  );

  const balances3 = { a1: 1000, a2: 1000 };
  applyTransactionToBalances(
    { type: "transfer", accountFromId: "a1", accountToId: "a2", amount: 300 },
    balances3,
  );
  assert.strictEqual(
    balances3.a1 + balances3.a2,
    2000,
    "Transfer should preserve total asset",
  );
  assert.strictEqual(
    balances3.a1,
    700,
    "Transfer should subtract from source account",
  );
  assert.strictEqual(
    balances3.a2,
    1300,
    "Transfer should add to destination account",
  );

  const balances4 = { a1: 1000 };
  applyTransactionToBalances(
    { type: "adjustment", accountFromId: "a1", amount: 200 },
    balances4,
  );
  assert.strictEqual(
    balances4.a1,
    1200,
    "Positive adjustment should increase account balance",
  );

  const balances5 = { a1: 1000 };
  applyTransactionToBalances(
    { type: "adjustment", accountFromId: "a1", amount: -200 },
    balances5,
  );
  assert.strictEqual(
    balances5.a1,
    800,
    "Negative adjustment should decrease account balance",
  );

  const transactions = [
    { id: "t1", type: "income", accountToId: "a1", amount: 500 },
    {
      id: "t2",
      type: "expense",
      accountFromId: "a1",
      amount: 200,
      deleted_at: "2025-01-01T00:00:00Z",
    },
  ];
  const balances6 = { a1: 0 };
  transactions
    .filter((tx) => !tx.deleted_at)
    .forEach((tx) => applyTransactionToBalances(tx, balances6));
  assert.strictEqual(
    balances6.a1,
    500,
    "Soft-deleted transaction should not be applied",
  );
}

function runMergeTests() {
  const localState = {
    meta: {
      settingsUpdatedAt: "2024-01-01T00:00:00Z",
      currency: "VND",
      themeLabel: "dark-green",
      monthlyExpenseTarget: 1000,
    },
    accounts: [],
    categories: {
      expense: [
        {
          id: "c1",
          kind: "expense",
          name: "Food",
          updated_at: "2024-01-01T00:00:00Z",
        },
      ],
      income: [],
    },
    transactions: [
      { id: "tx1", type: "expense", categoryId: "c1", amount: 100 },
    ],
    debtPlans: [{ id: "d1", kind: "fund_replenishment" }],
    debtEntries: [],
  };
  const incomingState = {
    meta: {
      settingsUpdatedAt: "2024-02-01T00:00:00Z",
      currency: "USD",
      themeLabel: "light",
      monthlyExpenseTarget: 2000,
    },
    accounts: [],
    categories: {
      expense: [
        {
          id: "c2",
          kind: "expense",
          name: "food",
          updated_at: "2024-02-01T00:00:00Z",
        },
      ],
      income: [],
    },
    transactions: [
      {
        id: "tx1",
        type: "expense",
        categoryId: "c2",
        amount: 100,
        updated_at: "2024-02-01T00:00:00Z",
      },
    ],
    debtPlans: [],
    debtEntries: [],
  };
  const merged = mergeStates(localState, incomingState);
  assert.strictEqual(
    merged.meta.currency,
    "USD",
    "Newer cloud settings should win based on settingsUpdatedAt",
  );
  assert.strictEqual(
    merged.meta.themeLabel,
    "light",
    "Newer cloud theme should win",
  );
  assert.strictEqual(
    merged.transactions.length,
    1,
    "Merged transactions should preserve the record",
  );
  assert.strictEqual(
    merged.transactions[0].categoryId,
    "c1",
    "Duplicate category IDs should be remapped to canonical category",
  );
  assert.strictEqual(
    merged.categories.expense.length,
    1,
    "Duplicate categories should merge by canonical key",
  );

  const hasDomain = hasDomainData({
    accounts: [],
    transactions: [],
    categories: { expense: [], income: [] },
    debtPlans: [{ id: "d1" }],
    debtEntries: [],
  });
  assert.strictEqual(
    hasDomain,
    true,
    "Debt plan alone should count as domain data",
  );
}

function runDebtTests() {
  const plan = { currentTargetAmount: 1000, carryShortfall: 200 };
  const result = calculateDebtImpact(plan, { amount: 400 }, 700, 1100);
  assert.strictEqual(
    result.replenishAmount,
    400,
    "Payment should cover carry before gap and contribute to gap",
  );
  assert.strictEqual(
    result.growthAmount,
    0,
    "No growth if payment does not exceed carry+gap",
  );
  assert.strictEqual(
    result.targetAfterPayment,
    1000,
    "Target should remain unchanged when no extra payment beyond gap",
  );

  const result2 = calculateDebtImpact(plan, { amount: 600 }, 700, 1300);
  assert.strictEqual(
    result2.replenishAmount,
    500,
    "Payment should cover carry and gap before growth",
  );
  assert.strictEqual(
    result2.growthAmount,
    100,
    "Remaining payment beyond carry+gap should increase target",
  );
  assert.strictEqual(
    result2.targetAfterPayment,
    1100,
    "Target should increase by the leftover amount",
  );

  const dueDate = calculateDebtDueDateFromAnchor(
    { anchorDate: "2024-01-10", dueDay: 31, cycle: "monthly" },
    new Date("2024-03-01T00:00:00+07:00"),
  );
  assert.strictEqual(
    formatDateInput(dueDate),
    "2024-02-29",
    "Due day 31 in February should clamp to the last day of February",
  );
}

function runDateTests() {
  const date = new Date("2024-02-29T00:30:00+07:00");
  const expected = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  assert.strictEqual(
    formatDateInput(date),
    expected,
    "formatDateInput should use local date fields not UTC slice",
  );

  const endMonth = new Date("2024-03-31T10:00:00+07:00");
  assert.strictEqual(
    formatDateInput(endMonth),
    "2024-03-31",
    "End of month should format correctly",
  );

  const endYear = new Date("2024-12-31T23:59:59+07:00");
  assert.strictEqual(
    formatDateInput(endYear),
    "2024-12-31",
    "End of year should format correctly",
  );

  const leapDate = new Date("2024-02-29T12:00:00+07:00");
  assert.strictEqual(
    formatDateInput(leapDate),
    "2024-02-29",
    "Leap year end of February should format correctly",
  );
}

function runAll() {
  console.log("Running FinanceBalance domain tests...");
  runBalanceTests();
  runMergeTests();
  runDebtTests();
  runDateTests();
  console.log("All tests passed.");
}

runAll();
