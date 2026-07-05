import { compareIso, formatDateInput } from "./utils.js";

export function hasDomainData(candidateState) {
  return Boolean(
    candidateState.accounts?.length ||
    candidateState.transactions?.length ||
    candidateState.categories?.expense?.length ||
    candidateState.categories?.income?.length ||
    candidateState.debtPlans?.length ||
    candidateState.debtEntries?.length,
  );
}

export function getCategoryCanonicalKey(item) {
  return `${item.kind || ""}::${String(item.name || "")
    .trim()
    .toLowerCase()}`;
}

export function deduplicateCategoriesByName(list) {
  const seen = new Set();
  const aliasMap = new Map();
  const categories = [];
  for (const item of list) {
    const key = getCategoryCanonicalKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      categories.push(item);
      continue;
    }
    const canonical = categories.find(
      (category) => getCategoryCanonicalKey(category) === key,
    );
    if (canonical && canonical.id !== item.id) {
      aliasMap.set(item.id, canonical.id);
    }
  }
  return { categories, aliasMap };
}

export function remapCategoryReferences(transactions, aliasMap) {
  if (!aliasMap || !aliasMap.size) return transactions;
  return transactions.map((tx) => {
    if (!tx.categoryId || !aliasMap.has(tx.categoryId)) return tx;
    return { ...tx, categoryId: aliasMap.get(tx.categoryId) };
  });
}

export function mergeRecords(left = [], right = []) {
  const map = new Map();
  [...left, ...right].forEach((record) => {
    if (!record?.id) return;
    const existing = map.get(record.id);
    if (!existing || compareIso(record.updated_at, existing.updated_at) > 0) {
      map.set(record.id, { ...record });
    }
  });
  return Array.from(map.values());
}

function normalizeNonNegativeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function mergeMeta(localMeta = {}, incomingMeta = {}) {
  const localSettingsUpdatedAt = localMeta.settingsUpdatedAt || "";
  const incomingSettingsUpdatedAt = incomingMeta.settingsUpdatedAt || "";
  const useIncomingSettings =
    compareIso(incomingSettingsUpdatedAt, localSettingsUpdatedAt) > 0;
  const settingsSource = useIncomingSettings ? incomingMeta : localMeta;
  return {
    currency:
      settingsSource.currency ||
      localMeta.currency ||
      incomingMeta.currency ||
      "VND",
    themeLabel:
      settingsSource.themeLabel ||
      localMeta.themeLabel ||
      incomingMeta.themeLabel ||
      "dark-green",
    monthlyExpenseTarget: normalizeNonNegativeNumber(
      settingsSource.monthlyExpenseTarget ??
        localMeta.monthlyExpenseTarget ??
        incomingMeta.monthlyExpenseTarget ??
        0,
    ),
    settingsUpdatedAt:
      (useIncomingSettings
        ? incomingSettingsUpdatedAt
        : localSettingsUpdatedAt) || nowIsoString(),
    lastSavedAt:
      localMeta.lastSavedAt || incomingMeta.lastSavedAt || nowIsoString(),
    lastCloudSyncAt:
      incomingMeta.lastCloudSyncAt || localMeta.lastCloudSyncAt || null,
    deviceId: localMeta.deviceId || incomingMeta.deviceId || "unknown-device",
  };
}

function nowIsoString() {
  return new Date().toISOString();
}

export function mergeStates(localState, incomingState) {
  const mergedMeta = mergeMeta(localState.meta, incomingState.meta);
  const mergedAccounts = mergeRecords(
    localState.accounts,
    incomingState.accounts,
  );
  const expenseDedup = deduplicateCategoriesByName(
    mergeRecords(
      localState.categories.expense,
      incomingState.categories.expense,
    ),
  );
  const incomeDedup = deduplicateCategoriesByName(
    mergeRecords(localState.categories.income, incomingState.categories.income),
  );
  const aliasMap = new Map([...expenseDedup.aliasMap, ...incomeDedup.aliasMap]);
  const mergedTransactions = remapCategoryReferences(
    mergeRecords(localState.transactions, incomingState.transactions),
    aliasMap,
  );
  return {
    version: 12,
    meta: mergedMeta,
    accounts: mergedAccounts,
    categories: {
      expense: expenseDedup.categories,
      income: incomeDedup.categories,
    },
    transactions: mergedTransactions,
    debtPlans: mergeRecords(localState.debtPlans, incomingState.debtPlans),
    debtEntries: mergeRecords(
      localState.debtEntries,
      incomingState.debtEntries,
    ),
  };
}

export function clampDebtDueDay(year, month, dueDay) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return Math.min(Math.max(Number(dueDay || 1), 1), daysInMonth);
}

export function addDebtCycle(date, cycle, dueDay) {
  const year = date.getFullYear();
  const month = date.getMonth();
  let nextYear = year;
  let nextMonth = month;
  if (cycle === "yearly") {
    nextYear += 1;
  } else if (cycle === "quarterly") {
    nextMonth += 3;
  } else {
    nextMonth += 1;
  }
  const rolled = new Date(nextYear, nextMonth, 1);
  const clampedDay = clampDebtDueDay(
    rolled.getFullYear(),
    rolled.getMonth(),
    dueDay,
  );
  return new Date(rolled.getFullYear(), rolled.getMonth(), clampedDay);
}

export function calculateDebtDueDateFromAnchor(
  plan,
  referenceDate = new Date(),
) {
  const anchor = new Date(plan.anchorDate || formatDateInput(new Date()));
  const dueDay = Number(plan.dueDay || 1);
  const clampedDueDay = clampDebtDueDay(
    anchor.getFullYear(),
    anchor.getMonth(),
    dueDay,
  );
  let current = new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    clampedDueDay,
  );
  if (current < anchor)
    current = addDebtCycle(current, plan.cycle, clampedDueDay);
  const today = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );
  while (true) {
    const next = addDebtCycle(current, plan.cycle, clampedDueDay);
    if (next > today) break;
    current = next;
  }
  return current;
}

export function calculateDebtImpact(
  plan,
  transaction,
  balanceBefore,
  balanceAfter,
) {
  const targetBefore = Number(plan.currentTargetAmount || 0);
  const carryBefore = Math.max(0, Number(plan.carryShortfall || 0));
  const paymentAmount = Number(transaction.amount || 0);
  const gapBefore = Math.max(0, targetBefore - balanceBefore);
  const payToCarry = Math.min(paymentAmount, carryBefore);
  const remainingAfterCarry = paymentAmount - payToCarry;
  const payToGap = Math.min(remainingAfterCarry, gapBefore);
  const remainingAfterGap = remainingAfterCarry - payToGap;
  const replenishAmount = payToCarry + payToGap;
  const growthAmount = remainingAfterGap;
  const targetAfterPayment = targetBefore + growthAmount;
  return {
    paymentAmount,
    gapBefore,
    minimumDueBefore: gapBefore + carryBefore,
    replenishAmount,
    growthAmount,
    targetAfterPayment,
    remainingCarry: Math.max(0, carryBefore - payToCarry),
    balanceBefore,
    balanceAfter,
  };
}

export function applyTransactionToBalances(tx, balances) {
  if (tx.type === "income" && tx.accountToId)
    balances[tx.accountToId] = (balances[tx.accountToId] || 0) + tx.amount;
  else if (tx.type === "expense" && tx.accountFromId)
    balances[tx.accountFromId] = (balances[tx.accountFromId] || 0) - tx.amount;
  else if (tx.type === "transfer") {
    if (tx.accountFromId)
      balances[tx.accountFromId] =
        (balances[tx.accountFromId] || 0) - tx.amount;
    if (tx.accountToId)
      balances[tx.accountToId] = (balances[tx.accountToId] || 0) + tx.amount;
  } else if (tx.type === "adjustment" && tx.accountFromId)
    balances[tx.accountFromId] = (balances[tx.accountFromId] || 0) + tx.amount;
}

export function parseLocalDate(value) {
  const [year, month, day] = String(value || "")
    .split("-")
    .map(Number);

  return new Date(year, month - 1, day);
}

export function chooseCanonicalCategory(a, b) {
  const aActive = !a.deleted_at;
  const bActive = !b.deleted_at;

  if (aActive !== bActive) {
    return aActive ? a : b;
  }

  const timeDiff = compareIso(a.updated_at, b.updated_at);

  if (timeDiff !== 0) {
    return timeDiff > 0 ? a : b;
  }

  return String(a.id).localeCompare(String(b.id)) <= 0 ? a : b;
}

export function deduplicateCategoriesByNameWithActive(list) {
  const seen = new Map();
  const aliasMap = new Map();
  const categories = [];

  for (const item of list) {
    const key = getCategoryCanonicalKey(item);

    if (!seen.has(key)) {
      seen.set(key, item);
      categories.push(item);
      continue;
    }

    const existing = seen.get(key);
    const canonical = chooseCanonicalCategory(existing, item);

    if (canonical.id !== existing.id) {
      const oldCanonicalIdx = categories.findIndex((c) => c.id === existing.id);
      if (oldCanonicalIdx >= 0) {
        categories[oldCanonicalIdx] = canonical;
      }
      seen.set(key, canonical);

      if (existing.id !== item.id) {
        aliasMap.set(existing.id, canonical.id);
      }
    }

    if (item.id !== canonical.id) {
      aliasMap.set(item.id, canonical.id);
    }
  }

  return { categories, aliasMap };
}

export function settleDebtPeriodIfEligible(plan, impact, balanceAfter) {
  const isSettled =
    impact.remainingCarry === 0 && balanceAfter >= impact.targetAfterPayment;

  if (!isSettled) return plan;

  const currentDueDate = parseLocalDate(plan.nextDueDate);

  return {
    ...plan,
    lastSettledPeriod: plan.nextDueDate
      ? plan.nextDueDate.slice(0, 7)
      : formatDateInput(new Date()).slice(0, 7),
    nextDueDate: formatDateInput(
      addDebtCycle(currentDueDate, plan.cycle, plan.dueDay),
    ),
  };
}
