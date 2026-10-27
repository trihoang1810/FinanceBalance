process.env.TZ = "Asia/Ho_Chi_Minh";

import assert from "assert";
import fs from "fs";
import {
  addDebtCycle,
  applyTransactionToBalances,
  calculateDebtImpact,
  calculateDebtDueDateFromAnchor,
  deduplicateCategoriesByNameWithActive,
  getCategoryCanonicalKey,
  hasDomainData,
  mergeStates,
  parseLocalDate,
  settleDebtPeriodIfEligible,
} from "../src/js/domain.js";
import { formatDateInput } from "../src/js/utils.js";

const appSource = fs.readFileSync(
  new URL("../src/js/app.js", import.meta.url),
  "utf8",
);
const cssSource = fs.readFileSync(
  new URL("../src/css/styles.css", import.meta.url),
  "utf8",
);
const htmlSource = fs.readFileSync(
  new URL("../index.html", import.meta.url),
  "utf8",
);
const packageSource = fs.readFileSync(
  new URL("../package.json", import.meta.url),
  "utf8",
);
const migrationSource = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260705_security_and_debt_schema.sql",
    import.meta.url,
  ),
  "utf8",
);

function assertDeepEqual(actual, expected, message) {
  try {
    assert.deepStrictEqual(actual, expected);
  } catch (error) {
    console.error(message);
    throw error;
  }
}

function assertMatch(source, pattern, message) {
  assert.ok(pattern.test(source), message);
}

function runThemeTests() {
  assertMatch(
    appSource,
    /themeLabelInput\.addEventListener\("change",\s*\(\) => \{\s*applyTheme\(el\.themeLabelInput\.value\);/,
    "Changing the theme select should apply the theme immediately",
  );
  assertMatch(
    cssSource,
    /body\.theme-dark-blue\s*\{/,
    "Dark blue theme selector should be defined",
  );
  assertMatch(
    cssSource,
    /body\.theme-light\s*\{/,
    "Light theme selector should be defined",
  );
}

function runAccountVisibilityTests() {
  assertMatch(
    appSource,
    /function toggleAccountVisibility\(id\)/,
    "Account visibility should be toggled instead of blocked by linked transactions",
  );
  assert.ok(
    !appSource.includes("Tài khoản này còn giao dịch đang hoạt động nên chưa thể xóa."),
    "Account hiding should not be blocked by existing transactions",
  );
  assertMatch(
    appSource,
    /data-action="toggle-account-visibility"/,
    "Account list should expose a visibility toggle",
  );
}

function runUiRegressionTests() {
  assert.ok(
    htmlSource.includes('class="nav-group-title">Phân tích</div>') &&
      htmlSource.includes('class="nav-group-title">Quản lý</div>') &&
      htmlSource.includes('class="nav-group-title">Hệ thống</div>'),
    "Sidebar navigation should remain grouped by user intent",
  );
  assert.ok(
    htmlSource.includes('id="clearDashboardFiltersBtn"') &&
      htmlSource.includes('id="clearReportFiltersBtn"') &&
      htmlSource.includes('id="clearTransactionFiltersBtn"'),
    "Primary filter surfaces should expose reset controls",
  );
  assert.ok(
    appSource.includes('data-action="clear-report-filters"') &&
      appSource.includes('data-action="clear-transaction-filters"'),
    "Empty states should provide an inline filter reset action",
  );
  assert.ok(
    cssSource.includes("button:focus-visible") &&
      cssSource.includes("table { min-width: 720px; }"),
    "UI should retain keyboard focus and readable mobile table sizing",
  );
  assert.ok(
    appSource.includes("Chart.defaults.color") &&
      appSource.includes("finalTheme === \"light\""),
    "Chart labels should follow the selected theme",
  );
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
    "c2",
    "Duplicate category IDs should be remapped to canonical category",
  );
  assert.strictEqual(
    merged.categories.expense.length,
    1,
    "Duplicate categories should merge by canonical key",
  );

  const deduped = deduplicateCategoriesByNameWithActive([
    {
      id: "c1",
      kind: "expense",
      name: "Food",
      updated_at: "2024-01-01T00:00:00Z",
    },
    {
      id: "c2",
      kind: "expense",
      name: " food ",
      updated_at: "2024-02-01T00:00:00Z",
    },
  ]);
  assert.strictEqual(
    deduped.categories.length,
    1,
    "Category deduplication should keep one canonical category",
  );
  assert.strictEqual(
    getCategoryCanonicalKey({ kind: "expense", name: " Food " }),
    "expense::food",
    "Canonical category keys should be normalized",
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

  const validLocalDate = parseLocalDate("2024-04-15");
  assert.strictEqual(
    formatDateInput(validLocalDate),
    "2024-04-15",
    "parseLocalDate should preserve local civil dates",
  );
  assert.strictEqual(
    parseLocalDate("2024-02-30"),
    null,
    "parseLocalDate should reject invalid business dates",
  );

  assertMatch(
    appSource,
    /const storedDueDate = plan\.nextDueDate \? parseLocalDate\(plan\.nextDueDate\) : null;[\s\S]*calculateDebtDueDateFromAnchor\(plan, today\)/,
    "calculateDebtDueInfo should prefer nextDueDate and fall back safely",
  );

  const unsettledPlan = {
    nextDueDate: "2024-07-31",
    cycle: "monthly",
    dueDay: 31,
    anchorDate: "2024-01-10",
    currentTargetAmount: 1000,
    carryShortfall: 100,
  };
  const unsettledResult = settleDebtPeriodIfEligible(
    unsettledPlan,
    {
      remainingCarry: 50,
      targetAfterPayment: 1000,
    },
    900,
  );
  assertDeepEqual(
    unsettledResult,
    unsettledPlan,
    "Unsettled debt periods should not advance",
  );

  const settledPlan = {
    nextDueDate: "2024-01-31",
    cycle: "monthly",
    dueDay: 31,
    anchorDate: "2024-01-10",
    currentTargetAmount: 1000,
    carryShortfall: 0,
  };
  const settledResult = settleDebtPeriodIfEligible(
    settledPlan,
    {
      remainingCarry: 0,
      targetAfterPayment: 1000,
    },
    1000,
  );
  assert.strictEqual(
    settledResult.lastSettledPeriod,
    "2024-01",
    "Settled debt periods should track the settled period",
  );
  assert.strictEqual(
    settledResult.nextDueDate,
    "2024-02-29",
    "Settled debt periods should advance exactly one cycle",
  );

  const invalidStoredResult = settleDebtPeriodIfEligible(
    {
      ...settledPlan,
      nextDueDate: "invalid-date",
    },
    {
      remainingCarry: 0,
      targetAfterPayment: 1000,
    },
    1000,
  );
  assert.ok(
    parseLocalDate(invalidStoredResult.nextDueDate),
    "Invalid stored due dates should still fall back to a valid next due date",
  );

  assert.strictEqual(
    formatDateInput(addDebtCycle(parseLocalDate("2024-01-31"), "monthly", 31)),
    "2024-02-29",
    "January 31 should advance to February 29 in leap years",
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

function runSourceRegressionTests() {
  assert.ok(
    !appSource.includes('\\"[data-progress]\\"'),
    'No escaped \\"[data-progress]\\" selector should remain',
  );
  assert.ok(
    appSource.includes('data-progress="${Math.min(progressPct, 100)}"'),
    "Debt progress HTML should use data-progress",
  );
  assert.ok(
    appSource.includes('querySelectorAll("[data-progress]").forEach((element) => {'),
    "Debt progress width should be applied after DOM creation",
  );
  assert.ok(
    !appSource.includes('style="width:'),
    "Debt progress HTML should not render inline width styles",
  );
  assert.ok(
    appSource.includes('<div class="cloud-error"><strong>Lỗi:</strong>'),
    "Cloud error should use a CSS class",
  );
  assert.ok(
    cssSource.includes(".cloud-error { color: #ff7d7d; }"),
    "Cloud error CSS should exist",
  );
  assert.ok(
    !htmlSource.includes('style="'),
    "HTML should not retain inline style attributes that conflict with CSP",
  );
  assert.ok(
    appSource.includes(
      'el.cloudPullBtn.addEventListener("click", () => syncCloudData("pull"));',
    ),
    "Normal cloud pull should merge instead of replacing",
  );
  assert.ok(
    appSource.includes('async function syncCloudData(mode = "both", options = {})'),
    "Cloud sync should use an options object",
  );
  assert.ok(
    appSource.includes("const shouldReplaceLocalFromCloud = replaceLocal;"),
    "Normal cloud pull should merge unless replaceLocal is explicitly requested",
  );
  assert.ok(
    appSource.includes('return tx.type === "expense" && tx.expenseMode === "variable";'),
    "Monthly target should only count variable expenses",
  );
  assert.ok(
    appSource.includes("isVariableExpenseForMonthlyTarget(tx)"),
    "Monthly target calculations should use the variable-expense helper",
  );
  assert.ok(
    !appSource.includes('syncCloudData("pull", true)'),
    "Forced replacement should not be wired to the normal cloud pull button",
  );
  assert.ok(
    appSource.includes("const protectedTransactions = selectedTransactions.filter"),
    "Bulk delete should identify protected debt-linked transactions",
  );
  assert.ok(
    appSource.includes("const deletableTransactions = selectedTransactions.filter"),
    "Bulk delete should identify deletable transactions separately",
  );
  assert.ok(
    appSource.includes("alert(\"Không thể xóa giao dịch đã liên kết với quỹ.\");"),
    "Bulk delete should stop when all selected transactions are protected",
  );
  assert.ok(
    appSource.includes("Bỏ qua ${protectedTransactions.length} giao dịch liên kết với quỹ."),
    "Bulk delete should report skipped linked transactions",
  );
  assert.ok(
    appSource.includes("sequence: Number(item.sequence || 0)"),
    "Transaction sequence should map from local to cloud",
  );
  assert.ok(
    appSource.includes("Number(row.sequence) ||"),
    "Transaction sequence should map from cloud to local",
  );
  assert.ok(
    appSource.includes("function isMissingSequenceSchemaError(error)"),
    "Supabase sync should detect missing sequence schema errors",
  );
  assert.ok(
    appSource.includes("const legacyTransactionRows = transactionRows.map(({ sequence, ...row }) => row);"),
    "Supabase sync should retry transaction upserts without sequence when the remote schema is outdated",
  );
  assert.ok(
    appSource.includes("anchor_date: item.anchorDate"),
    "Debt lifecycle fields should map local anchorDate to cloud",
  );
  assert.ok(
    appSource.includes("next_due_date: item.nextDueDate"),
    "Debt lifecycle fields should map local nextDueDate to cloud",
  );
  assert.ok(
    appSource.includes("last_settled_period: item.lastSettledPeriod"),
    "Debt lifecycle fields should map local lastSettledPeriod to cloud",
  );
  assert.ok(
    appSource.includes("row.next_due_date ||"),
    "Debt lifecycle fields should map cloud next_due_date to local",
  );
  assert.ok(
    appSource.includes("lastSettledPeriod: row.last_settled_period || null"),
    "Debt lifecycle fields should map cloud last_settled_period to local",
  );
  assert.ok(
    migrationSource.includes("ADD COLUMN IF NOT EXISTS sequence bigint;"),
    "Migration should add the sequence column",
  );
  assert.ok(
    migrationSource.includes("WHERE sequence IS NULL;"),
    "Migration should backfill missing sequence values",
  );
  assert.ok(
    htmlSource.includes("v1.2.0"),
    "The visible app version should be updated to 1.2.0",
  );
  assert.ok(
    packageSource.includes('"version": "1.2.0"'),
    "package.json version should be updated to 1.2.0",
  );
}

function runAll() {
  console.log("Running FinanceBalance tests...");
  runThemeTests();
  runAccountVisibilityTests();
  runUiRegressionTests();
  runBalanceTests();
  runMergeTests();
  runDebtTests();
  runDateTests();
  runSourceRegressionTests();
  console.log("All tests passed.");
}

runAll();
