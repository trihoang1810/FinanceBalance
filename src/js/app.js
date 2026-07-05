import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import {
  CHART_COLORS,
  ELEMENT_IDS,
  PAGE_META,
  STORAGE_KEY,
  SUPABASE_KEY,
  SUPABASE_URL,
  TABLES,
} from "./config.js";
import {
  clone,
  compactCurrency,
  compareIso,
  createId,
  createStableDeviceId,
  escapeHtml,
  formatDateDisplay,
  formatDateFile,
  formatDateInput,
  formatDateTime,
  formatDurationBetween,
  getSiteURL,
  nowIso,
  sanitizeName,
  sanitizeText,
  sortTransactionsAsc,
  sortTransactionsDesc,
  sumBy,
} from "./utils.js";
import {
  addDebtCycle,
  applyTransactionToBalances,
  calculateDebtDueDateFromAnchor,
  calculateDebtImpact,
  clampDebtDueDay,
  chooseCanonicalCategory,
  deduplicateCategoriesByName,
  deduplicateCategoriesByNameWithActive,
  getCategoryCanonicalKey,
  hasDomainData,
  mergeRecords,
  mergeMeta,
  mergeStates,
  parseLocalDate,
  remapCategoryReferences,
  settleDebtPeriodIfEligible,
} from "./domain.js";
const runtime = {
  charts: {},
  editingTransactionId: null,
  editingDebtPlanId: null,
  cloudSyncTimer: null,
  cloudRealtimeSubscriptions: [],
  txList: {
    page: 1,
    pageSize: 10,
    query: "",
    type: "all",
    selectedIds: new Set(),
  },
  auth: {
    session: null,
    user: null,
    busy: false,
    lastError: "",
    lastInfo: "Chưa đăng nhập cloud.",
  },
  loginCooldownUntil: 0,
  loginCooldownTimer: null,
  balancesCacheKey: null,
  balancesCacheValue: null,
  debtEntryList: { page: 1, pageSize: 10, from: "", to: "" },
};
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
const el = {};
let state = loadState();

document.addEventListener("DOMContentLoaded", async () => {
  cacheElements();
  bindEvents();
  bindDatePickerEvents();
  initializeCharts();
  window.addEventListener("storage", handleStorageSync);
  await initializeSupabaseAuth();
  renderAll();
});

function cacheElements() {
  ELEMENT_IDS.forEach((id) => (el[id] = document.getElementById(id)));
}
function bindEvents() {
  el.navMenu.addEventListener("click", handleNavClick);
  el.openTransactionsBtn.addEventListener("click", () =>
    openPage("transactions"),
  );
  el.syncNowTopBtn.addEventListener("click", () => syncCloudData("both"));
  el.exportJsonBtn.addEventListener("click", exportJson);
  el.settingsExportBtn.addEventListener("click", exportJson);
  el.importJsonInput.addEventListener("change", handleImportJson);
  el.settingsImportInput.addEventListener("change", handleImportJson);
  el.generalSettingsForm.addEventListener("submit", handleSaveGeneralSettings);
  el.suggestMonthlyTargetBtn.addEventListener(
    "click",
    applySuggestedMonthlyExpenseTarget,
  );
  el.monthlyExpenseTargetInput.addEventListener(
    "input",
    renderMonthlyExpenseTargetRecommendation,
  );
  el.expenseCategoryForm.addEventListener("submit", (event) =>
    handleAddCategory(event, "expense"),
  );
  el.incomeCategoryForm.addEventListener("submit", (event) =>
    handleAddCategory(event, "income"),
  );
  el.accountForm.addEventListener("submit", handleAccountSubmit);
  el.transactionForm.addEventListener("submit", handleTransactionSubmit);
  el.transactionCancelEditBtn.addEventListener("click", cancelTransactionEdit);
  el.txTypeInput.addEventListener("change", updateTransactionFormVisibility);
  el.transactionSearchInput.addEventListener("input", () => {
    runtime.txList.query = el.transactionSearchInput.value.trim();
    runtime.txList.page = 1;
    renderTransactionsTable();
  });
  el.transactionTypeFilter.addEventListener("change", () => {
    runtime.txList.type = el.transactionTypeFilter.value;
    runtime.txList.page = 1;
    renderTransactionsTable();
  });
  el.transactionPageSize.addEventListener("change", () => {
    runtime.txList.pageSize = Number(el.transactionPageSize.value || 10);
    runtime.txList.page = 1;
    renderTransactionsTable();
  });
  el.transactionPrevBtn.addEventListener("click", () =>
    changeTransactionPage(-1),
  );
  el.transactionNextBtn.addEventListener("click", () =>
    changeTransactionPage(1),
  );
  el.bulkDeleteBtn.addEventListener("click", bulkDeleteTransactions);
  el.clearSelectionBtn.addEventListener("click", clearTransactionSelection);

  el.dashboardQuickRange.addEventListener("change", () => {
    applyQuickRange(
      el.dashboardQuickRange,
      el.dashboardDateFrom,
      el.dashboardDateTo,
    );
    renderDashboard();
  });
  // FIX DASH-007: validate from <= to
  el.dashboardDateFrom.addEventListener("change", () => {
    if (
      el.dashboardDateTo.value &&
      el.dashboardDateFrom.value > el.dashboardDateTo.value
    ) {
      alert("Ngày bắt đầu không được lớn hơn ngày kết thúc.");
      el.dashboardDateFrom.value = "";
      return;
    }
    el.dashboardQuickRange.value = "custom";
    renderDashboard();
  });
  el.dashboardDateTo.addEventListener("change", () => {
    if (
      el.dashboardDateFrom.value &&
      el.dashboardDateTo.value < el.dashboardDateFrom.value
    ) {
      alert("Ngày kết thúc không được nhỏ hơn ngày bắt đầu.");
      el.dashboardDateTo.value = "";
      return;
    }
    el.dashboardQuickRange.value = "custom";
    renderDashboard();
  });
  el.dashboardDistributionMode.addEventListener("change", renderDashboard);

  el.reportQuickRange.addEventListener("change", () => {
    applyQuickRange(el.reportQuickRange, el.reportDateFrom, el.reportDateTo);
    renderReportsPage();
  });
  el.reportDateFrom.addEventListener("change", () => {
    if (
      el.reportDateTo.value &&
      el.reportDateFrom.value > el.reportDateTo.value
    ) {
      alert("Ngày bắt đầu không được lớn hơn ngày kết thúc.");
      el.reportDateFrom.value = "";
      return;
    }
    el.reportQuickRange.value = "custom";
    renderReportsPage();
  });
  el.reportDateTo.addEventListener("change", () => {
    if (
      el.reportDateFrom.value &&
      el.reportDateTo.value < el.reportDateFrom.value
    ) {
      alert("Ngày kết thúc không được nhỏ hơn ngày bắt đầu.");
      el.reportDateTo.value = "";
      return;
    }
    el.reportQuickRange.value = "custom";
    renderReportsPage();
  });
  [
    el.reportAccountFilter,
    el.reportTypeFilter,
    el.reportExpenseModeFilter,
  ].forEach((node) => node.addEventListener("change", renderReportsPage));

  el.compareQuickRange.addEventListener("change", () => {
    applyQuickRange(el.compareQuickRange, el.compareDateFrom, el.compareDateTo);
    renderComparePage();
  });
  // FIX DASH-007 for compare page
  el.compareDateFrom.addEventListener("change", () => {
    if (
      el.compareDateTo.value &&
      el.compareDateFrom.value > el.compareDateTo.value
    ) {
      alert("Ngày bắt đầu không được lớn hơn ngày kết thúc.");
      el.compareDateFrom.value = "";
      return;
    }
    el.compareQuickRange.value = "custom";
    renderComparePage();
  });
  el.compareDateTo.addEventListener("change", () => {
    if (
      el.compareDateFrom.value &&
      el.compareDateTo.value < el.compareDateFrom.value
    ) {
      alert("Ngày kết thúc không được nhỏ hơn ngày bắt đầu.");
      el.compareDateTo.value = "";
      return;
    }
    el.compareQuickRange.value = "custom";
    renderComparePage();
  });
  [el.compareGranularity, el.compareBy].forEach(
    (node) => node && node.addEventListener("change", renderComparePage),
  );
  document.addEventListener("click", handleDocumentClick);

  el.debtPlanForm.addEventListener("submit", handleDebtPlanSubmit);
  el.debtPlanCancelEditBtn.addEventListener("click", cancelDebtPlanEdit);
  el.debtEntryForm.addEventListener("submit", handleDebtEntrySubmit);
  el.debtEntryPlanSelect.addEventListener(
    "change",
    fillDebtEntryTransactionSelect,
  );
  el.debtEntryTransactionSelect.addEventListener(
    "change",
    renderDebtEntryTransactionInfo,
  );
  el.debtProjectionPlanSelect.addEventListener("change", renderDebtProjection);
  el.debtProjectionPaymentInput.addEventListener("input", renderDebtProjection);
  el.debtProjectionPeriodsInput.addEventListener("input", renderDebtProjection);
  el.debtEntryDateFrom.addEventListener("change", () => {
    if (
      el.debtEntryDateTo.value &&
      el.debtEntryDateFrom.value > el.debtEntryDateTo.value
    ) {
      alert("Ngày bắt đầu không được lớn hơn ngày kết thúc.");
      el.debtEntryDateFrom.value = "";
      return;
    }
    runtime.debtEntryList.from = el.debtEntryDateFrom.value || "";
    runtime.debtEntryList.page = 1;
    renderDebtEntriesTable();
  });
  el.debtEntryDateTo.addEventListener("change", () => {
    if (
      el.debtEntryDateFrom.value &&
      el.debtEntryDateTo.value < el.debtEntryDateFrom.value
    ) {
      alert("Ngày kết thúc không được nhỏ hơn ngày bắt đầu.");
      el.debtEntryDateTo.value = "";
      return;
    }
    runtime.debtEntryList.to = el.debtEntryDateTo.value || "";
    runtime.debtEntryList.page = 1;
    renderDebtEntriesTable();
  });
  el.debtEntryPageSize.addEventListener("change", () => {
    runtime.debtEntryList.pageSize = Number(el.debtEntryPageSize.value || 10);
    runtime.debtEntryList.page = 1;
    renderDebtEntriesTable();
  });
  el.debtEntryPrevBtn.addEventListener("click", () => changeDebtEntryPage(-1));
  el.debtEntryNextBtn.addEventListener("click", () => changeDebtEntryPage(1));

  el.cloudLoginForm.addEventListener("submit", handleCloudLogin);
  el.cloudSyncBtn.addEventListener("click", () => syncCloudData("both"));
  el.cloudPullBtn.addEventListener("click", () => syncCloudData("pull", true));
  el.cloudLogoutBtn.addEventListener("click", handleCloudLogout);

  el.sidebarToggleBtn.addEventListener("click", toggleSidebar);
  el.sidebarBackdrop.addEventListener("click", closeSidebar);

  el.txDateInput.value = formatDateInput(new Date());
  el.dashboardQuickRange.value = "current-month";
  applyQuickRange(
    el.dashboardQuickRange,
    el.dashboardDateFrom,
    el.dashboardDateTo,
  );
  el.reportQuickRange.value = "current-month";
  applyQuickRange(el.reportQuickRange, el.reportDateFrom, el.reportDateTo);
  el.compareQuickRange.value = "current-month";
  applyQuickRange(el.compareQuickRange, el.compareDateFrom, el.compareDateTo);
  initializeCompareDefaultRange();
  const loginButton = el.cloudLoginForm?.querySelector('button[type="submit"]');
  if (loginButton) loginButton.textContent = "Gửi magic link";
  if (el.debtEntryPageSize)
    el.debtEntryPageSize.value = String(runtime.debtEntryList.pageSize);
  updateTransactionFormVisibility();
}

function bindDatePickerEvents() {
  document.querySelectorAll('input[type="date"]').forEach((input) => {
    const openPicker = () => {
      if (typeof input.showPicker === "function") {
        try {
          input.showPicker();
        } catch (_) {}
      }
    };
    input.addEventListener("focus", openPicker);
    input.addEventListener("click", openPicker);
  });
}

function toggleSidebar() {
  const sidebar = document.querySelector(".sidebar");
  const backdrop = el.sidebarBackdrop;
  const btn = el.sidebarToggleBtn;

  sidebar?.classList.toggle("active");
  backdrop?.classList.toggle("active");
  btn?.classList.toggle("active");
}

function closeSidebar() {
  const sidebar = document.querySelector(".sidebar");
  const backdrop = el.sidebarBackdrop;
  const btn = el.sidebarToggleBtn;

  sidebar?.classList.remove("active");
  backdrop?.classList.remove("active");
  btn?.classList.remove("active");
}

async function initializeSupabaseAuth() {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error) runtime.auth.lastError = error.message;
  runtime.auth.session = session || null;
  runtime.auth.user = session?.user || null;
  runtime.auth.lastInfo = runtime.auth.user
    ? `Đã đăng nhập cloud với ${runtime.auth.user.email}`
    : "Chưa đăng nhập cloud.";
  renderCloudStatus();
  if (runtime.auth.user) {
    subscribeToCloudChanges();
    await syncCloudData("pull");
  }
  supabase.auth.onAuthStateChange(async (event, sessionValue) => {
    runtime.auth.session = sessionValue || null;
    runtime.auth.user = sessionValue?.user || null;
    runtime.auth.lastError = "";
    runtime.auth.lastInfo = runtime.auth.user
      ? `Đăng nhập thành công: ${runtime.auth.user.email}`
      : "Đã đăng xuất cloud.";
    renderCloudStatus();
    if (runtime.auth.user) {
      if (event !== "INITIAL_SESSION") {
        subscribeToCloudChanges();
        await syncCloudData("pull");
      }
    } else {
      unsubscribeFromCloudChanges();
    }
  });
}

function initializeCharts() {
  Chart.defaults.color = "rgba(233,255,245,0.85)";
  Chart.defaults.font.family = "Inter, system-ui, sans-serif";
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  runtime.charts.assetDonut = createDonutChart("assetDonutChart");
  runtime.charts.netFlowAllocation = createBarChart(
    "netFlowAllocationChart",
    true,
  );
  runtime.charts.dashboardDistributionDonut = createDonutChart(
    "dashboardDistributionDonutChart",
  );
  runtime.charts.cashflowLine = new Chart(
    document.getElementById("cashflowLineChart"),
    {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "Tổng tài sản",
            data: [],
            fill: true,
            tension: 0.28,
            borderWidth: 3,
            borderColor: "#35E58D",
            backgroundColor: "rgba(53,229,141,0.12)",
            pointRadius: 3,
            pointHoverRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: getCommonScales(),
      },
    },
  );
  runtime.charts.expenseDonut = createDonutChart("expenseDonutChart");
  runtime.charts.incomeDonut = createDonutChart("incomeDonutChart");
  runtime.charts.reportTrendStacked = createStackedBarChart(
    "reportTrendStackedChart",
    "Kỳ",
  );
  runtime.charts.reportExpenseCategoryStacked = createStackedBarChart(
    "reportExpenseCategoryStackedChart",
    "Kỳ",
  );
  runtime.charts.compareStacked = createStackedBarChart(
    "compareStackedChart",
    "Kỳ",
  );
}

function createDonutChart(id) {
  return new Chart(document.getElementById(id), {
    type: "doughnut",
    data: {
      labels: [],
      datasets: [{ data: [], backgroundColor: CHART_COLORS, borderWidth: 0 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      plugins: { legend: { position: "bottom" } },
    },
  });
}

function createBarChart(id, horizontal = false) {
  return new Chart(document.getElementById(id), {
    type: "bar",
    data: {
      labels: [],
      datasets: [
        {
          label: "Giá trị",
          data: [],
          backgroundColor: "rgba(88,176,255,0.72)",
          borderRadius: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: horizontal ? "y" : "x",
      plugins: { legend: { display: false } },
      scales: getCommonScales(horizontal),
    },
  });
}

function createStackedBarChart(id, xTitle) {
  return new Chart(document.getElementById(id), {
    type: "bar",
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, title: { display: false, text: xTitle } },
        y: {
          stacked: true,
          ticks: { callback: (value) => compactCurrency(value) },
        },
      },
    },
  });
}

function getCommonScales(horizontal = false) {
  return horizontal
    ? {
        x: {
          grid: { color: "rgba(255,255,255,0.06)" },
          ticks: { callback: (value) => compactCurrency(value) },
        },
        y: { grid: { color: "rgba(255,255,255,0.04)" } },
      }
    : {
        x: { grid: { color: "rgba(255,255,255,0.04)" } },
        y: {
          grid: { color: "rgba(255,255,255,0.06)" },
          ticks: { callback: (value) => compactCurrency(value) },
        },
      };
}

function createDefaultState() {
  const now = nowIso();
  return {
    version: 12,
    meta: {
      currency: "VND",
      themeLabel: "dark-green",
      monthlyExpenseTarget: 0,
      settingsUpdatedAt: now,
      lastSavedAt: now,
      lastCloudSyncAt: null,
      deviceId: createStableDeviceId(),
    },
    accounts: [],
    categories: { expense: [], income: [] },
    transactions: [],
    debtPlans: [],
    debtEntries: [],
  };
}

function makeAccount(name, type, openingBalance, note) {
  const t = nowIso();
  return {
    id: createId("acc"),
    name,
    type,
    openingBalance: Number(openingBalance || 0),
    note,
    created_at: t,
    updated_at: t,
    deleted_at: null,
  };
}
function makeCategory(kind, name) {
  const t = nowIso();
  return {
    id: createId(kind === "expense" ? "exp" : "inc"),
    kind,
    name,
    created_at: t,
    updated_at: t,
    deleted_at: null,
  };
}
function makeDebtPlan(
  name,
  linkedAccountId,
  currentTargetAmount,
  cycle,
  dueDay,
  carryShortfall,
  note,
) {
  const t = nowIso();
  const now = new Date();
  const anchorDate = formatDateInput(now);
  const normalizedDueDay = Number(dueDay || 1);
  return {
    id: createId("debt"),
    kind: "fund_replenishment",
    name,
    linkedAccountId,
    currentTargetAmount: Number(currentTargetAmount || 0),
    cycle: cycle || "monthly",
    dueDay: normalizedDueDay,
    carryShortfall: Number(carryShortfall || 0),
    note: note || "",
    anchorDate,
    nextDueDate: formatDateInput(
      calculateDebtDueDateFromAnchor(
        {
          anchorDate,
          cycle: cycle || "monthly",
          dueDay: normalizedDueDay,
        },
        now,
      ),
    ),
    lastSettledPeriod: null,
    created_at: t,
    updated_at: t,
    deleted_at: null,
  };
}
function makeDebtEntry(
  planId,
  transactionId,
  date,
  amount,
  replenishAmount,
  growthAmount,
  targetAfterPayment,
  note,
) {
  const t = nowIso();
  return {
    id: createId("debt_entry"),
    planId,
    transactionId,
    date,
    amount: Number(amount || 0),
    replenishAmount: Number(replenishAmount || 0),
    growthAmount: Number(growthAmount || 0),
    targetAfterPayment: Number(targetAfterPayment || 0),
    note: note || "",
    created_at: t,
    updated_at: t,
    deleted_at: null,
  };
}

function applyTheme(themeName = state?.meta?.themeLabel || "dark-green") {
  const allowedThemes = ["dark-green", "dark-blue", "light"];
  const finalTheme = allowedThemes.includes(themeName)
    ? themeName
    : "dark-green";
  document.body.classList.remove(
    "theme-dark-green",
    "theme-dark-blue",
    "theme-light",
  );
  document.body.classList.add(`theme-${finalTheme}`);
}

function renderAll() {
  applyTheme(state.meta.themeLabel || "dark-green");
  fillBaseForms();
  renderCloudStatus();
  renderSettingsPage();
  renderAccountsPage();
  renderTransactionFormOptions();
  renderTransactionsTable();
  renderDashboard();
  renderReportsPage();
  renderComparePage();
  renderDebtPage();
  updateSelectedCountLabel();
  logStateSnapshot("renderAll");
}

function fillBaseForms() {
  el.currencyInput.value = state.meta.currency || "VND";
  el.themeLabelInput.value = state.meta.themeLabel || "dark-green";
  el.monthlyExpenseTargetInput.value = state.meta.monthlyExpenseTarget
    ? String(state.meta.monthlyExpenseTarget)
    : "";
  fillAccountSelect(el.reportAccountFilter, true, "Tất cả tài khoản");
  fillCompareAccountFilter();
  fillAccountSelect(el.txAccountFromInput, false);
  fillAccountSelect(el.txAccountToInput, false);
  fillCompareCategoryFilter();
  fillDebtAccountSelect();
  fillDebtPlanSelects();
  fillDebtEntryTransactionSelect();
  renderDebtEntryTransactionInfo();
  updateTransactionFormVisibility();
}

function renderSettingsPage() {
  renderCategoryList("expense", el.expenseCategoryList);
  renderCategoryList("income", el.incomeCategoryList);
  renderMonthlyExpenseTargetRecommendation();
}

function renderCloudStatus() {
  const user = runtime.auth.user;
  const lastCloudSync = state.meta.lastCloudSyncAt
    ? new Date(state.meta.lastCloudSyncAt).toLocaleString("vi-VN")
    : "Chưa có";
  const lastSaved = state.meta.lastSavedAt
    ? new Date(state.meta.lastSavedAt).toLocaleString("vi-VN")
    : "Chưa có";
  el.cloudStatusBox.innerHTML = `<div><span class="pill pill-cloud">Cloud ${user ? "đã kết nối" : "chưa kết nối"}</span></div><div><strong>Trạng thái:</strong> ${escapeHtml(runtime.auth.lastInfo || "")}</div><div><strong>Lưu local gần nhất:</strong> ${escapeHtml(lastSaved)}</div><div><strong>Đồng bộ cloud gần nhất:</strong> ${escapeHtml(lastCloudSync)}</div><div><strong>Thiết bị:</strong> ${escapeHtml(state.meta.deviceId)}</div>${runtime.auth.lastError ? `<div style="color:#ff7d7d"><strong>Lỗi:</strong> ${escapeHtml(runtime.auth.lastError)}</div>` : ""}`;
  el.cloudSyncBtn.disabled = !user || runtime.auth.busy;
  el.cloudPullBtn.disabled = !user || runtime.auth.busy;
  el.cloudLogoutBtn.disabled = !user || runtime.auth.busy;
  el.syncNowTopBtn.disabled = !user || runtime.auth.busy;
}

function renderAccountsPage() {
  const accounts = getActiveAccounts();
  const balances = calculateAccountBalances();
  if (!accounts.length) {
    el.accountsTable.innerHTML =
      '<div class="empty-state">Chưa có tài khoản nào.</div>';
    return;
  }
  const utdNow = nowIso();
  el.accountsTable.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Tên tài khoản</th><th>Loại</th><th>Số dư khởi tạo</th><th>Số dư hiện tại</th><th>Ngày khởi tạo</th><th>UTD</th><th>Khoảng thời gian</th><th>Ghi chú</th><th>Thao tác</th></tr></thead><tbody>${accounts
    .map((account) => {
      const linked = getActiveTransactions().some(
        (tx) =>
          tx.accountFromId === account.id || tx.accountToId === account.id,
      );
      return `<tr><td>${escapeHtml(account.name)}</td><td>${mapAccountType(account.type)}</td><td>${formatCurrency(account.openingBalance)}</td><td><strong>${formatCurrency(balances[account.id] || 0)}</strong></td><td>${formatDateTime(account.created_at)}</td><td>${formatDateTime(utdNow)}</td><td>${formatDurationBetween(account.created_at, utdNow)}</td><td>${escapeHtml(account.note || "-")}</td><td><button class="btn btn-secondary" type="button" data-action="delete-account" data-id="${account.id}" ${linked ? "disabled" : ""}>Xóa</button></td></tr>`;
    })
    .join("")}</tbody></table></div>`;
}

function renderDashboard() {
  const balances = calculateAccountBalances();
  const transactions = getFilteredDashboardTransactions();
  const incomeTotal = sumBy(
    transactions.filter((tx) => tx.type === "income"),
    "amount",
  );
  const expenseTotal = sumBy(
    transactions.filter((tx) => tx.type === "expense"),
    "amount",
  );
  const netFlow = incomeTotal - expenseTotal;
  el.metricNetWorth.textContent = formatCurrency(
    Object.values(balances).reduce((sum, v) => sum + v, 0),
  );
  el.metricIncome.textContent = formatCurrency(incomeTotal);
  el.metricExpense.textContent = formatCurrency(expenseTotal);
  el.metricNetFlow.textContent = formatCurrency(netFlow);
  el.metricNetFlow.className =
    "metric-value " + (netFlow >= 0 ? "metric-positive" : "metric-negative");
  const accounts = getActiveAccounts();
  const assetLabels = accounts.map((a) => a.name);
  const assetValues = accounts.map((a) => balances[a.id] || 0);
  updateDonutChart(runtime.charts.assetDonut, assetLabels, assetValues);
  renderAssetLegend(assetLabels, assetValues);
  const { from } = getDateRangeFromInputs(
    el.dashboardDateFrom,
    el.dashboardDateTo,
  );
  const lineData = buildNetWorthSeries(transactions, from);
  runtime.charts.cashflowLine.data.labels = lineData.labels;
  runtime.charts.cashflowLine.data.datasets[0].data = lineData.values;
  runtime.charts.cashflowLine.update();
  renderNetFlowAllocationChart(
    transactions,
    incomeTotal,
    expenseTotal,
    netFlow,
  );
  updateDashboardDistributionDonut(
    transactions,
    el.dashboardDistributionMode.value,
  );
  renderMonthlyExpenseTargetCard();
  renderDashboardDebtAlerts();
}

function renderMonthlyExpenseTargetCard() {
  if (
    !el.dashboardExpenseTargetSummary ||
    !el.dashboardExpenseTargetProgressFill ||
    !el.dashboardExpenseTargetMeta ||
    !el.dashboardExpenseTargetHint
  )
    return;
  const snapshot = getCurrentMonthExpenseTargetSnapshot();
  const suggestion = getRecentMonthlyExpenseAverage();
  const clampedProgress =
    snapshot.target > 0 ? Math.min(snapshot.usedPct, 100) : 0;
  el.dashboardExpenseTargetProgressFill.style.width = `${clampedProgress}%`;
  // cập nhật số tháng hiện tại cho thẻ div có class card-subtitle
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const currentMonthElement = document.querySelector(".card-subtitle");
  if (currentMonthElement) {
    currentMonthElement.textContent = `Theo dõi mức dùng chi tiêu của tháng ${currentMonth}/${currentYear}`;
  }
  el.dashboardExpenseTargetProgressFill.className = `progress-fill${snapshot.target > 0 && snapshot.usedPct >= 100 ? " danger" : snapshot.target > 0 && snapshot.usedPct >= 80 ? " warning" : ""}`;
  el.dashboardExpenseTargetSummary.innerHTML = `${pill("Đã chi", "pill-expense")} ${pill(formatCurrency(snapshot.spent), "pill-expense")} ${snapshot.target > 0 ? `${pill("Target", "pill-income")} ${pill(formatCurrency(snapshot.target), "pill-income")}` : pill("Chưa thiết lập target", "pill-adjustment")}`;
  el.dashboardExpenseTargetMeta.innerHTML =
    snapshot.target > 0
      ? `<span>${snapshot.usedPct.toFixed(1)}% target</span><span>${formatCurrency(snapshot.spent)} / ${formatCurrency(snapshot.target)}</span>`
      : `<span>Chưa có target</span><span>${formatCurrency(snapshot.spent)} đã chi trong tháng này</span>`;
  if (snapshot.target <= 0) {
    el.dashboardExpenseTargetHint.textContent =
      suggestion.average > 0
        ? `Chưa thiết lập target. App đang gợi ý ${formatCurrency(suggestion.average)} dựa trên trung bình chi tiêu của 3 tháng gần nhất.`
        : "Chưa thiết lập target và chưa có đủ dữ liệu chi tiêu 3 tháng gần nhất để đề xuất.";
    return;
  }
  const paceText =
    snapshot.usedPct > snapshot.elapsedPct
      ? "Mức chi hiện tại đang nhanh hơn tiến độ thời gian của tháng."
      : "Mức chi hiện tại vẫn đang chậm hơn hoặc bám sát tiến độ thời gian của tháng.";
  el.dashboardExpenseTargetHint.textContent =
    snapshot.remaining >= 0
      ? `Còn lại ${formatCurrency(snapshot.remaining)} so với target tháng. ${paceText}`
      : `Bạn đã vượt target ${formatCurrency(Math.abs(snapshot.remaining))}. ${paceText}`;
}

function renderNetFlowAllocationChart(
  transactions,
  incomeTotal,
  expenseTotal,
  netFlow,
) {
  const allocation = buildNetFlowAllocationByAccount(transactions, netFlow);
  const labels = allocation.labels.length
    ? allocation.labels
    : ["Không có dữ liệu"];
  const values = allocation.values.length ? allocation.values : [0];
  runtime.charts.netFlowAllocation.data.labels = labels;
  runtime.charts.netFlowAllocation.data.datasets[0].data = values;
  runtime.charts.netFlowAllocation.data.datasets[0].backgroundColor =
    values.map((v) =>
      v >= 0 ? "rgba(53,229,141,0.72)" : "rgba(255,125,125,0.72)",
    );
  runtime.charts.netFlowAllocation.update();
  const detail = allocation.labels.length
    ? allocation.labels
        .map(
          (label, i) =>
            `${pill(label, values[i] >= 0 ? "pill-income" : "pill-expense")} ${pill(formatCurrency(values[i]), values[i] >= 0 ? "pill-income" : "pill-expense")}`,
        )
        .join(" ")
    : pill(
        netFlow === 0
          ? "Không phát sinh dòng tiền ròng trong kỳ lọc"
          : "Không xác định được phân bổ",
        "pill-adjustment",
      );
  el.netFlowSummary.innerHTML = `${pill("Thu nhập", "pill-income")} ${pill(formatCurrency(incomeTotal), "pill-income")} ${pill("Chi tiêu", "pill-expense")} ${pill(formatCurrency(expenseTotal), "pill-expense")} ${pill("Ròng", netFlow >= 0 ? "pill-income" : "pill-expense")} ${pill(formatCurrency(netFlow), netFlow >= 0 ? "pill-income" : "pill-expense")} ${detail}`;
}

function buildNetFlowAllocationByAccount(transactions, netFlow) {
  if (!transactions.length || netFlow === 0) return { labels: [], values: [] };
  const deltas = {};
  getActiveAccounts().forEach((a) => {
    deltas[a.id] = 0;
  });
  transactions.forEach((tx) => {
    if (tx.type === "income" && tx.accountToId)
      deltas[tx.accountToId] = (deltas[tx.accountToId] || 0) + tx.amount;
    else if (tx.type === "expense" && tx.accountFromId)
      deltas[tx.accountFromId] = (deltas[tx.accountFromId] || 0) - tx.amount;
    else if (tx.type === "transfer") {
      if (tx.accountFromId)
        deltas[tx.accountFromId] = (deltas[tx.accountFromId] || 0) - tx.amount;
      if (tx.accountToId)
        deltas[tx.accountToId] = (deltas[tx.accountToId] || 0) + tx.amount;
    } else if (tx.type === "adjustment" && tx.accountFromId)
      deltas[tx.accountFromId] = (deltas[tx.accountFromId] || 0) + tx.amount;
  });
  const direction = netFlow > 0 ? 1 : -1;
  const sameDir = getActiveAccounts()
    .map((a) => ({ label: a.name, raw: deltas[a.id] || 0 }))
    .filter((r) => (direction > 0 ? r.raw > 0 : r.raw < 0));
  const base = sumBy(
    sameDir.map((r) => ({ amount: Math.abs(r.raw) })),
    "amount",
  );
  if (!sameDir.length || base === 0) return { labels: [], values: [] };
  const rows = sameDir.map((r) => ({
    label: r.label,
    value: Number(
      ((Math.abs(r.raw) / base) * Math.abs(netFlow) * direction).toFixed(2),
    ),
  }));
  return { labels: rows.map((r) => r.label), values: rows.map((r) => r.value) };
}

function updateDashboardDistributionDonut(transactions, mode) {
  const list = transactions.filter((tx) => tx.type === mode);
  const map = aggregateByCategory(list);
  updateDonutChart(
    runtime.charts.dashboardDistributionDonut,
    Object.keys(map),
    Object.values(map),
  );
}

function renderReportsPage() {
  const filtered = getFilteredReportTransactions();
  const incomeTotal = sumBy(
    filtered.filter((tx) => tx.type === "income"),
    "amount",
  );
  const expenseTotal = sumBy(
    filtered.filter((tx) => tx.type === "expense"),
    "amount",
  );
  const netAmount = incomeTotal - expenseTotal;
  el.reportIncomeTotal.textContent = formatCurrency(incomeTotal);
  el.reportExpenseTotal.textContent = formatCurrency(expenseTotal);
  el.reportTransactionCount.textContent = String(filtered.length);
  el.reportNetAmount.textContent = formatCurrency(netAmount);
  el.reportNetAmount.className =
    "metric-value " + (netAmount >= 0 ? "metric-positive" : "metric-negative");
  const expFiltered = filtered.filter((tx) => tx.type === "expense");
  const incFiltered = filtered.filter((tx) => tx.type === "income");
  updateDonutChart(
    runtime.charts.expenseDonut,
    Object.keys(aggregateByCategory(expFiltered)),
    Object.values(aggregateByCategory(expFiltered)),
  );
  updateDonutChart(
    runtime.charts.incomeDonut,
    Object.keys(aggregateByCategory(incFiltered)),
    Object.values(aggregateByCategory(incFiltered)),
  );
  renderReportTrendStackedChart(filtered);
  renderReportExpenseCategoryStackedChart(expFiltered);
  renderReportTransactionsTable(filtered);
  toggleReportExpenseModeVisibility();
}

function renderReportTrendStackedChart(transactions) {
  const grouped = groupTransactionsByPeriod(
    transactions.filter((tx) => tx.type === "income" || tx.type === "expense"),
    "month",
  );
  const labels = Object.keys(grouped).sort();
  runtime.charts.reportTrendStacked.data.labels = labels.length
    ? labels
    : ["Chưa có dữ liệu"];
  runtime.charts.reportTrendStacked.data.datasets = [
    {
      label: "Thu nhập",
      data: labels.map((l) =>
        sumBy(
          grouped[l].filter((tx) => tx.type === "income"),
          "amount",
        ),
      ),
      backgroundColor: "rgba(53,229,141,0.72)",
    },
    {
      label: "Chi tiêu",
      data: labels.map((l) =>
        sumBy(
          grouped[l].filter((tx) => tx.type === "expense"),
          "amount",
        ),
      ),
      backgroundColor: "rgba(255,125,125,0.72)",
    },
  ];
  runtime.charts.reportTrendStacked.update();
}

function renderReportExpenseCategoryStackedChart(expenseTransactions) {
  const grouped = groupTransactionsByPeriod(expenseTransactions, "month");
  const labels = Object.keys(grouped).sort();
  const categories = [
    ...new Set(
      expenseTransactions.map((tx) => getCategoryNameByTransaction(tx)),
    ),
  ];
  runtime.charts.reportExpenseCategoryStacked.data.labels = labels.length
    ? labels
    : ["Chưa có dữ liệu"];
  runtime.charts.reportExpenseCategoryStacked.data.datasets = categories.map(
    (cat, i) => ({
      label: cat,
      data: labels.map((l) =>
        sumBy(
          grouped[l].filter((tx) => getCategoryNameByTransaction(tx) === cat),
          "amount",
        ),
      ),
      backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
    }),
  );
  runtime.charts.reportExpenseCategoryStacked.update();
}

function renderReportTransactionsTable(items) {
  if (!items.length) {
    el.reportTransactionsTable.innerHTML =
      '<div class="empty-state">Không có giao dịch phù hợp với bộ lọc hiện tại.</div>';
    return;
  }
  el.reportTransactionsTable.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Loại</th><th>Chi tiêu</th><th>Số tiền</th><th>Tài khoản</th><th>Phân loại</th><th>Ghi chú</th></tr></thead><tbody>${[
    ...items,
  ]
    .sort(sortTransactionsDesc)
    .map(
      (tx) =>
        `<tr><td>${formatDateDisplay(tx.date)}</td><td>${getTypeBadge(tx.type)}</td><td>${tx.type === "expense" ? getExpenseModeBadge(tx.expenseMode) : "-"}</td><td>${formatCurrency(tx.amount)}</td><td>${escapeHtml(getTransactionAccountText(tx))}</td><td>${escapeHtml(getCategoryNameByTransaction(tx))}</td><td>${escapeHtml(tx.note || "-")}</td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}

// FIX CMP-013: compare page renders chart only, dropdowns re-bind their own change events
function renderComparePage() {
  fillCompareTypeFilter();
  fillCompareAccountFilter();
  fillCompareCategoryFilter();
  renderCompareChart();
}

function renderCompareChart() {
  const filtered = getFilteredCompareTransactions();
  const grouped = groupTransactionsByPeriod(
    filtered,
    el.compareGranularity.value,
  );
  const labels = Object.keys(grouped).sort();
  const compareBy = el.compareBy.value;
  const seriesNames = getCompareSeriesNames(filtered, compareBy);
  runtime.charts.compareStacked.data.labels = labels.length
    ? labels
    : ["Chưa có dữ liệu"];
  runtime.charts.compareStacked.data.datasets = seriesNames.map((name, i) => ({
    label: name,
    data: labels.map((l) =>
      sumBy(
        grouped[l].filter((tx) => getCompareSeriesKey(tx, compareBy) === name),
        "amount",
      ),
    ),
    backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
  }));
  runtime.charts.compareStacked.update();
}

function getCompareSeriesNames(transactions, compareBy) {
  if (!transactions.length) return ["Không có dữ liệu"];
  return [
    ...new Set(transactions.map((tx) => getCompareSeriesKey(tx, compareBy))),
  ];
}

function getCompareSeriesKey(tx, compareBy) {
  if (compareBy === "account") return getTransactionAccountText(tx);
  if (compareBy === "category") return getCategoryNameByTransaction(tx);
  return tx.type === "income"
    ? "Thu nhập"
    : tx.type === "expense"
      ? "Chi tiêu"
      : tx.type === "transfer"
        ? "Chuyển khoản nội bộ"
        : "Điều chỉnh số dư";
}

function handleDocumentClick(event) {
  const trigger = event.target.closest(".multi-trigger");
  const container = event.target.closest(".multi-dropdown");
  if (trigger && container) {
    const willOpen = !container.classList.contains("open");
    closeAllMultiDropdowns();
    if (willOpen) {
      container.classList.add("open");
      // FIX CMP-011: flip dropdown if near bottom of viewport
      requestAnimationFrame(() => {
        const menu = container.querySelector(".multi-menu");
        if (!menu) return;
        const rect = menu.getBoundingClientRect();
        if (rect.bottom > window.innerHeight - 16) {
          container.classList.add("flip-up");
        } else {
          container.classList.remove("flip-up");
        }
      });
    }
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    const action = actionButton.dataset.action;
    const id = actionButton.dataset.id;
    const type = actionButton.dataset.type;
    if (action === "edit-transaction") {
      startEditTransaction(id);
      return;
    }
    if (action === "delete-transaction") {
      softDeleteTransaction(id);
      return;
    }
    if (action === "delete-account") {
      softDeleteAccount(id);
      return;
    }
    if (action === "delete-category") {
      softDeleteCategory(type, id);
      return;
    }
    if (action === "edit-debt-plan") {
      startEditDebtPlan(id);
      return;
    }
    if (action === "delete-debt-plan") {
      softDeleteDebtPlan(id);
      return;
    }
  }

  if (!container) closeAllMultiDropdowns();
}

function closeAllMultiDropdowns() {
  document.querySelectorAll(".multi-dropdown.open").forEach((n) => {
    n.classList.remove("open");
    n.classList.remove("flip-up");
  });
}

const PILL_CLASSES = new Set([
  "pill-income",
  "pill-expense",
  "pill-transfer",
  "pill-adjustment",
  "pill-fixed",
  "pill-variable",
  "pill-cloud",
]);

function sanitizePillClass(cls) {
  return PILL_CLASSES.has(cls) ? cls : "pill-adjustment";
}

function getDebtEntryByTransactionId(transactionId) {
  return getActiveDebtEntries().find(
    (entry) => entry.transactionId === transactionId,
  );
}

function buildCategoryAliasMap(categories) {
  const canonicalMap = new Map();
  const aliasMap = new Map();
  for (const category of categories) {
    if (category.deleted_at) continue;
    const key = getCategoryCanonicalKey(category);
    if (!canonicalMap.has(key)) {
      canonicalMap.set(key, category.id);
    } else if (category.id !== canonicalMap.get(key)) {
      aliasMap.set(category.id, canonicalMap.get(key));
    }
  }
  return aliasMap;
}

// FIX CMP-013: renderCustomMultiDropdown binds change events that only update chart, not rebuild dropdown
function renderCustomMultiDropdown(
  container,
  options,
  selectedValues,
  placeholder,
  onChangeFn,
) {
  if (!container) return;
  const selectedSet = new Set(selectedValues || []);
  const summary = getMultiDropdownSummary(options, selectedSet, placeholder);
  const wasOpen = container.classList.contains("open");
  container.innerHTML = `
        <button type="button" class="btn btn-secondary multi-trigger">
          <span id="summary-${container.id}">${summary}</span>
          <span class="muted">${selectedSet.size ? `${selectedSet.size} mục` : "Tất cả"}</span>
        </button>
        <div class="multi-menu">
          ${
            options.length
              ? options
                  .map(
                    (opt) => `
            <label class="multi-option">
              <input type="checkbox" value="${escapeHtml(opt.value)}" ${selectedSet.has(opt.value) ? "checked" : ""} />
              <span>${escapeHtml(opt.label)}</span>
            </label>
          `,
                  )
                  .join("")
              : '<div class="multi-empty">Không có lựa chọn</div>'
          }
        </div>
      `;
  if (wasOpen) container.classList.add("open");
  // Bind checkbox changes — update summary label + trigger chart only, no full re-render
  container.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.addEventListener("change", () => {
      const checkedVals = [
        ...container.querySelectorAll('input[type="checkbox"]:checked'),
      ].map((i) => i.value);
      const newSet = new Set(checkedVals);
      const newSummary = getMultiDropdownSummary(options, newSet, placeholder);
      const summaryEl = container.querySelector(`#summary-${container.id}`);
      if (summaryEl) summaryEl.textContent = newSummary;
      const countEl = container.querySelector(".muted");
      if (countEl)
        countEl.textContent = newSet.size ? `${newSet.size} mục` : "Tất cả";
      if (onChangeFn) onChangeFn();
    });
  });
}

function getMultiDropdownSummary(options, selectedSet, placeholder) {
  if (!selectedSet.size) return placeholder;
  const sel = options.filter((o) => selectedSet.has(o.value));
  if (sel.length === 1) return sel[0].label;
  if (sel.length === options.length) return `Tất cả ${options.length} mục`;
  return `Đã chọn ${sel.length} mục`;
}

function renderCategoryList(type, container) {
  const list = getActiveCategories(type);
  if (!list.length) {
    container.innerHTML =
      '<div class="empty-state">Chưa có phân loại nào.</div>';
    return;
  }
  container.innerHTML = `<div class="list-simple">${list.map((item) => `<div class="list-item"><div><strong>${escapeHtml(item.name)}</strong><span>${type === "expense" ? "Danh mục chi tiêu" : "Danh mục thu nhập"}</span></div><button class="btn btn-secondary" type="button" data-action="delete-category" data-type="${type}" data-id="${item.id}">Xóa</button></div>`).join("")}</div>`;
}

function renderAssetLegend(labels, values) {
  const total = values.reduce((s, v) => s + v, 0);
  if (!labels.length || total === 0) {
    el.assetLegend.innerHTML =
      '<div class="empty-state">Chưa đủ dữ liệu để hiển thị tỷ trọng tài sản.</div>';
    return;
  }
  el.assetLegend.innerHTML = labels
    .map(
      (l, i) =>
        `<div class="legend-row"><span class="legend-swatch" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></span><span>${escapeHtml(l)}</span><span>${formatCurrency(values[i] || 0)} · ${(((values[i] || 0) / total) * 100).toFixed(1)}%</span></div>`,
    )
    .join("");
}

function renderTransactionFormOptions() {
  fillAccountSelect(el.txAccountFromInput, false);
  fillAccountSelect(el.txAccountToInput, false);
  updateTransactionCategoryOptions();
  updateTransactionFormVisibility();
}

function updateTransactionCategoryOptions() {
  const type = el.txTypeInput.value;
  const items =
    type === "expense"
      ? getActiveCategories("expense")
      : type === "income"
        ? getActiveCategories("income")
        : [];
  el.txCategoryInput.innerHTML =
    !items.length || type === "transfer" || type === "adjustment"
      ? '<option value="">Không áp dụng</option>'
      : items
          .map((i) => `<option value="${i.id}">${escapeHtml(i.name)}</option>`)
          .join("");
}

function updateTransactionFormVisibility() {
  updateTransactionCategoryOptions();
  const type = el.txTypeInput.value;
  el.txAccountFromField.classList.remove("hidden");
  el.txAccountToField.classList.remove("hidden");
  el.txAdjustmentField.classList.add("hidden");
  el.txExpenseModeField.classList.add("hidden");
  el.txCategoryInput.disabled = false;
  if (type === "expense") {
    el.txAccountFromField.querySelector("label").textContent =
      "Tài khoản nguồn";
    el.txAccountToField.classList.add("hidden");
    el.txExpenseModeField.classList.remove("hidden");
  } else if (type === "income") {
    el.txAccountToField.querySelector("label").textContent =
      "Tài khoản nhận tiền";
    el.txAccountFromField.classList.add("hidden");
  } else if (type === "transfer") {
    el.txAccountFromField.querySelector("label").textContent =
      "Tài khoản nguồn";
    el.txAccountToField.querySelector("label").textContent = "Tài khoản đích";
    el.txCategoryInput.disabled = true;
  } else {
    el.txAccountFromField.querySelector("label").textContent =
      "Tài khoản bị điều chỉnh";
    el.txAccountToField.classList.add("hidden");
    el.txAdjustmentField.classList.remove("hidden");
    el.txCategoryInput.disabled = true;
  }
}

function renderTransactionsTable() {
  const all = getFilteredTransactionsForList();
  const totalPages = Math.max(
    1,
    Math.ceil(all.length / runtime.txList.pageSize),
  );
  runtime.txList.page = Math.min(runtime.txList.page, totalPages);
  const start = (runtime.txList.page - 1) * runtime.txList.pageSize;
  const pageItems = all.slice(start, start + runtime.txList.pageSize);
  if (!all.length) {
    el.transactionsTable.innerHTML =
      '<div class="empty-state">Không có giao dịch phù hợp với bộ lọc tìm kiếm hiện tại.</div>';
    el.transactionPaginationInfo.textContent = "Trang 1 / 1";
    el.transactionPrevBtn.disabled = true;
    el.transactionNextBtn.disabled = true;
    return;
  }
  el.transactionsTable.innerHTML = `<div class="table-wrap"><table><thead><tr><th><input type="checkbox" id="selectAllTransactions" ${pageItems.every((i) => runtime.txList.selectedIds.has(i.id)) ? "checked" : ""}></th><th>Ngày</th><th>Loại</th><th>Chi tiêu</th><th>Số tiền</th><th>Tài khoản</th><th>Phân loại</th><th>Ghi chú</th><th>Thao tác</th></tr></thead><tbody>${pageItems.map((tx) => `<tr><td><input type="checkbox" class="tx-select" data-id="${tx.id}" ${runtime.txList.selectedIds.has(tx.id) ? "checked" : ""}></td><td>${formatDateDisplay(tx.date)}</td><td>${getTypeBadge(tx.type)}</td><td>${tx.type === "expense" ? getExpenseModeBadge(tx.expenseMode) : "-"}</td><td>${formatCurrency(tx.amount)}</td><td>${escapeHtml(getTransactionAccountText(tx))}</td><td>${escapeHtml(getCategoryNameByTransaction(tx))}</td><td>${escapeHtml(tx.note || "-")}</td><td><div class="actions-inline"><button class="btn btn-secondary" type="button" data-action="edit-transaction" data-id="${tx.id}">Sửa</button><button class="btn btn-danger" type="button" data-action="delete-transaction" data-id="${tx.id}">Xóa</button></div></td></tr>`).join("")}</tbody></table></div>`;
  bindTransactionSelectionEvents();
  el.transactionPaginationInfo.textContent = `Trang ${runtime.txList.page} / ${totalPages} · ${all.length} giao dịch`;
  el.transactionPrevBtn.disabled = runtime.txList.page <= 1;
  el.transactionNextBtn.disabled = runtime.txList.page >= totalPages;
  updateSelectedCountLabel();
}

function bindTransactionSelectionEvents() {
  const selectAll = document.getElementById("selectAllTransactions");
  if (selectAll) {
    selectAll.addEventListener("change", () => {
      document.querySelectorAll(".tx-select").forEach((n) => {
        const id = n.dataset.id;
        n.checked = selectAll.checked;
        if (selectAll.checked) runtime.txList.selectedIds.add(id);
        else runtime.txList.selectedIds.delete(id);
      });
      updateSelectedCountLabel();
    });
  }
  document.querySelectorAll(".tx-select").forEach((n) => {
    n.addEventListener("change", () => {
      const id = n.dataset.id;
      if (n.checked) runtime.txList.selectedIds.add(id);
      else runtime.txList.selectedIds.delete(id);
      updateSelectedCountLabel();
    });
  });
}

function updateSelectedCountLabel() {
  el.selectedCountLabel.textContent = `Đã chọn ${runtime.txList.selectedIds.size} mục`;
}

function clearTransactionSelection() {
  runtime.txList.selectedIds.clear();
  renderTransactionsTable();
}

function bulkDeleteTransactions() {
  if (!runtime.txList.selectedIds.size) {
    alert("Chưa có giao dịch nào được chọn.");
    return;
  }
  if (
    !confirm(
      `Bạn muốn xóa ${runtime.txList.selectedIds.size} giao dịch đã chọn?`,
    )
  )
    return;
  const deletedAt = nowIso();
  state.transactions.forEach((tx) => {
    if (runtime.txList.selectedIds.has(tx.id) && !tx.deleted_at) {
      tx.deleted_at = deletedAt;
      tx.updated_at = deletedAt;
      tx.deviceId = state.meta.deviceId;
    }
  });
  runtime.txList.selectedIds.clear();
  persistState();
  renderAll();
}

function getFilteredTransactionsForList() {
  const keyword = runtime.txList.query.toLowerCase();
  const selectedType = runtime.txList.type;
  return [...getActiveTransactions()]
    .filter((tx) => (selectedType === "all" ? true : tx.type === selectedType))
    .filter((tx) => {
      if (!keyword) return true;
      const haystack = [
        tx.date,
        String(tx.amount),
        tx.note || "",
        getTransactionAccountText(tx),
        getCategoryNameByTransaction(tx),
        tx.expenseMode || "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(keyword);
    })
    .sort(sortTransactionsDesc);
}

function changeTransactionPage(offset) {
  const all = getFilteredTransactionsForList();
  const totalPages = Math.max(
    1,
    Math.ceil(all.length / runtime.txList.pageSize),
  );
  runtime.txList.page = Math.min(
    totalPages,
    Math.max(1, runtime.txList.page + offset),
  );
  renderTransactionsTable();
}

async function handleCloudLogin(event) {
  event.preventDefault();
  const email = (el.cloudEmailInput.value || "").trim();
  if (!email) {
    alert("Vui lòng nhập email để đăng nhập cloud.");
    return;
  }
  if (Date.now() < runtime.loginCooldownUntil) {
    const s = Math.ceil((runtime.loginCooldownUntil - Date.now()) / 1000);
    alert(`Vui lòng chờ ${s} giây rồi thử lại.`);
    return;
  }
  runtime.auth.busy = true;
  renderCloudStatus();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: getSiteURL() },
  });
  runtime.auth.busy = false;
  if (error) {
    runtime.auth.lastError = error.message || "";
    const msg = (error.message || "").toLowerCase();
    if (
      msg.includes("rate limit") ||
      msg.includes("too many requests") ||
      msg.includes("email rate limit exceeded")
    ) {
      startMagicLinkCooldown(60);
      runtime.auth.lastInfo =
        "Bạn vừa gửi quá nhanh. Hệ thống đã tạm khóa gửi lại trong 60 giây.";
    } else {
      runtime.auth.lastInfo = "Không gửi được magic link.";
    }
  } else {
    runtime.auth.lastError = "";
    runtime.auth.lastInfo = `Đã gửi magic link tới ${email}.`;
    startMagicLinkCooldown(60);
  }
  renderCloudStatus();
}

async function handleCloudLogout() {
  runtime.auth.busy = true;
  renderCloudStatus();
  const { error } = await supabase.auth.signOut();
  unsubscribeFromCloudChanges();
  runtime.auth.busy = false;
  runtime.auth.lastError = error ? error.message : "";
  runtime.auth.lastInfo = error ? runtime.auth.lastInfo : "Đã đăng xuất cloud.";
  renderCloudStatus();
}

async function syncCloudData(mode = "both", forceReplace = false) {
  if (!runtime.auth.user) {
    alert("Bạn cần đăng nhập cloud trước khi đồng bộ.");
    return;
  }
  runtime.auth.busy = true;
  runtime.auth.lastError = "";
  runtime.auth.lastInfo =
    mode === "pull"
      ? "Đang tải dữ liệu từ cloud..."
      : "Đang đồng bộ dữ liệu với cloud...";
  renderCloudStatus();
  try {
    if (mode === "pull") {
      const cloudState = await fetchCloudState();
      const cloudHasData =
        Boolean(cloudState.hasCloudSettings) || hasDomainData(cloudState);
      // FIX AUTH-009/010: only replace local if it's the first sync AND local has no data
      const localHasData = hasDomainData(state);
      const shouldReplaceLocalFromCloud =
        forceReplace ||
        (!state.meta.lastCloudSyncAt && cloudHasData && !localHasData);
      state = shouldReplaceLocalFromCloud
        ? normalizeState({
            ...cloudState,
            meta: {
              ...cloudState.meta,
              currency: cloudState.meta?.currency || state.meta.currency,
              themeLabel:
                cloudState.meta?.themeLabel ||
                state.meta.themeLabel ||
                "dark-green",
              monthlyExpenseTarget: normalizeNonNegativeNumber(
                cloudState.meta?.monthlyExpenseTarget ??
                  state.meta.monthlyExpenseTarget ??
                  0,
              ),
              settingsUpdatedAt:
                cloudState.meta?.settingsUpdatedAt ||
                state.meta.settingsUpdatedAt ||
                nowIso(),
              deviceId: state.meta.deviceId,
              lastSavedAt: state.meta.lastSavedAt,
              lastCloudSyncAt: nowIso(),
            },
          })
        : mergeStates(state, cloudState);
      state.meta.lastCloudSyncAt = nowIso();
      persistState({ skipCloud: true });
    } else {
      const cloudState = await fetchCloudState();
      state = mergeStates(state, cloudState);
      await pushLocalStateToCloud(state);
      state.meta.lastCloudSyncAt = nowIso();
      persistState({ skipCloud: true });
    }
    renderAll();
    runtime.auth.lastInfo = "Đồng bộ cloud thành công.";
  } catch (error) {
    console.error(error);
    runtime.auth.lastError = error.message || "Không thể đồng bộ cloud.";
  } finally {
    runtime.auth.busy = false;
    renderCloudStatus();
  }
}

async function fetchCloudState() {
  const userId = runtime.auth.user.id;

  const [sR, aR, cR, tR, dpR, deR] = await Promise.all([
    supabase.from(TABLES.appSettings).select("*").eq("user_id", userId),
    supabase.from(TABLES.accounts).select("*").eq("user_id", userId),
    supabase.from(TABLES.categories).select("*").eq("user_id", userId),
    supabase.from(TABLES.transactions).select("*").eq("user_id", userId),
    supabase.from(TABLES.debtPlans).select("*").eq("user_id", userId),
    supabase.from(TABLES.debtEntries).select("*").eq("user_id", userId),
  ]);

  const failed = [sR, aR, cR, tR, dpR, deR].find((r) => r.error);
  if (failed?.error) throw failed.error;
  const settingsRow = (sR.data || [])[0] || null;
  const cloudSettings = mapCloudSettingsToLocal(settingsRow);

  return {
    version: 12,
    hasCloudSettings: Boolean(settingsRow),
    meta: { ...clone(state.meta), ...cloudSettings },
    accounts: (aR.data || []).map(mapCloudAccountToLocal),
    categories: {
      expense: (cR.data || [])
        .filter((r) => r.kind === "expense")
        .map(mapCloudCategoryToLocal),
      income: (cR.data || [])
        .filter((r) => r.kind === "income")
        .map(mapCloudCategoryToLocal),
    },
    transactions: (tR.data || []).map(mapCloudTransactionToLocal),
    debtPlans: (dpR.data || []).map(mapCloudDebtPlanToLocal),
    debtEntries: (deR.data || []).map(mapCloudDebtEntryToLocal),
  };
}

async function pushLocalStateToCloud(currentState) {
  const userId = runtime.auth.user.id;

  const sR = await supabase
    .from(TABLES.appSettings)
    .upsert([mapLocalSettingsToCloud(currentState.meta, userId)], {
      onConflict: "user_id",
    });
  if (sR.error) throw sR.error;

  const aR = await supabase.from(TABLES.accounts).upsert(
    currentState.accounts.map((i) => mapLocalAccountToCloud(i, userId)),
    { onConflict: "id" },
  );
  if (aR.error) throw aR.error;

  const cR = await supabase.from(TABLES.categories).upsert(
    [...currentState.categories.expense, ...currentState.categories.income].map(
      (i) => mapLocalCategoryToCloud(i, userId),
    ),
    { onConflict: "id" },
  );
  if (cR.error) throw cR.error;

  const tR = await supabase.from(TABLES.transactions).upsert(
    currentState.transactions.map((i) => mapLocalTransactionToCloud(i, userId)),
    { onConflict: "id" },
  );
  if (tR.error) throw tR.error;

  const dpR = await supabase.from(TABLES.debtPlans).upsert(
    currentState.debtPlans.map((i) => mapLocalDebtPlanToCloud(i, userId)),
    { onConflict: "id" },
  );
  if (dpR.error) throw dpR.error;

  const deR = await supabase.from(TABLES.debtEntries).upsert(
    currentState.debtEntries.map((i) => mapLocalDebtEntryToCloud(i, userId)),
    { onConflict: "id" },
  );
  if (deR.error) throw deR.error;
}

function scheduleCloudSync() {
  if (!runtime.auth.user) return;
  clearTimeout(runtime.cloudSyncTimer);
  runtime.cloudSyncTimer = setTimeout(() => syncCloudData("both"), 900);
}

function handleStorageSync(event) {
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  try {
    const external = normalizeState(JSON.parse(event.newValue));
    state = mergeStates(state, external);
    renderAll();
  } catch (e) {
    console.error(e);
  }
}

function subscribeToCloudChanges() {
  if (!runtime.auth.user) {
    console.log("Cannot subscribe to cloud changes: user not logged in");
    return;
  }
  unsubscribeFromCloudChanges();
  const userId = runtime.auth.user.id;
  const tables = [
    TABLES.appSettings,
    TABLES.accounts,
    TABLES.categories,
    TABLES.transactions,
    TABLES.debtPlans,
    TABLES.debtEntries,
  ];
  tables.forEach((table) => {
    const subscription = supabase
      .channel(`public:${table}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `user_id=eq.${userId}` },
        async () => {
          console.log(`Cloud change detected in ${table}, syncing...`);
          await syncCloudData("pull");
        },
      )
      .subscribe((status) => {
        console.log(`Subscription to ${table}: ${status}`);
      });
    runtime.cloudRealtimeSubscriptions.push({ table, subscription });
  });
}

function unsubscribeFromCloudChanges() {
  runtime.cloudRealtimeSubscriptions.forEach(({ subscription }) => {
    if (subscription) {
      supabase.removeChannel(subscription);
    }
  });
  runtime.cloudRealtimeSubscriptions = [];
}

function handleSaveGeneralSettings(event) {
  event.preventDefault();
  const currency = (el.currencyInput.value || "").trim().toUpperCase();
  const monthlyExpenseTargetRaw = (
    el.monthlyExpenseTargetInput.value || ""
  ).trim();
  const monthlyExpenseTarget =
    monthlyExpenseTargetRaw === "" ? 0 : Number(monthlyExpenseTargetRaw);
  const allowedThemes = ["dark-green", "dark-blue", "light"];
  const theme = allowedThemes.includes(el.themeLabelInput.value)
    ? el.themeLabelInput.value
    : "dark-green";
  if (!currency || currency.length > 10) {
    alert("Đơn vị tiền tệ không hợp lệ.");
    return;
  }
  if (!Number.isFinite(monthlyExpenseTarget) || monthlyExpenseTarget < 0) {
    alert("Target chi tiêu tháng phải là số không âm.");
    return;
  }
  state.meta.currency = currency;
  state.meta.themeLabel = theme;
  state.meta.monthlyExpenseTarget = monthlyExpenseTarget;
  state.meta.settingsUpdatedAt = nowIso();
  applyTheme(state.meta.themeLabel);
  persistState();
  renderAll();
}

function applySuggestedMonthlyExpenseTarget() {
  const suggestion = getRecentMonthlyExpenseAverage();
  if (!suggestion.average) {
    alert("Chưa có đủ dữ liệu chi tiêu 3 tháng gần nhất để đề xuất target.");
    return;
  }
  el.monthlyExpenseTargetInput.value = String(suggestion.average);
  renderMonthlyExpenseTargetRecommendation();
}

function handleAddCategory(event, type) {
  event.preventDefault();
  const input =
    type === "expense" ? el.expenseCategoryInput : el.incomeCategoryInput;
  const name = sanitizeName(input.value, 50);
  if (!name) {
    alert("Vui lòng nhập tên phân loại hợp lệ.");
    return;
  }
  if (
    getActiveCategories(type).some(
      (i) => i.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    alert("Phân loại này đã tồn tại.");
    return;
  }
  const category = makeCategory(type, name);
  (type === "expense"
    ? state.categories.expense
    : state.categories.income
  ).push(category);
  input.value = "";
  persistState();
  renderAll();
}

function handleAccountSubmit(event) {
  event.preventDefault();
  const name = sanitizeName(el.accountNameInput.value, 50);
  const openingBalance = Number(el.openingBalanceInput.value || 0);
  const note = sanitizeText(el.accountNoteInput.value, 120);
  if (!name) {
    alert("Tên tài khoản không hợp lệ.");
    return;
  }
  if (!Number.isFinite(openingBalance) || openingBalance < 0) {
    alert("Số dư khởi tạo phải là số không âm.");
    return;
  }
  if (
    getActiveAccounts().some((i) => i.name.toLowerCase() === name.toLowerCase())
  ) {
    alert("Tên tài khoản đã tồn tại.");
    return;
  }
  state.accounts.push(
    makeAccount(name, el.accountTypeInput.value, openingBalance, note),
  );
  el.accountForm.reset();
  el.accountTypeInput.value = "cash";
  persistState();
  renderAll();
}

function handleTransactionSubmit(event) {
  event.preventDefault();
  const payload = collectTransactionFormData();
  if (!payload) return;
  if (runtime.editingTransactionId) {
    const idx = state.transactions.findIndex(
      (i) => i.id === runtime.editingTransactionId,
    );
    if (idx >= 0) {
      const old = state.transactions[idx];
      state.transactions[idx] = {
        ...old,
        ...payload,
        id: old.id,
        sequence: old.sequence || Number(new Date(old.created_at).getTime()),
        created_at: old.created_at,
        updated_at: nowIso(),
        deviceId: state.meta.deviceId,
        deleted_at: null,
      };
    }
  } else {
    state.transactions.push({
      id: createId("tx"),
      ...payload,
      sequence: Number(Date.now()),
      deviceId: state.meta.deviceId,
      created_at: nowIso(),
      updated_at: nowIso(),
      deleted_at: null,
    });
  }
  state.transactions.sort(sortTransactionsAsc);
  cancelTransactionEdit({ silent: true });
  persistState();
  renderAll();
}

function collectTransactionFormData() {
  const type = el.txTypeInput.value;
  const date = el.txDateInput.value;
  const amountRaw = Number(el.txAmountInput.value || 0);
  const note = sanitizeText(el.txNoteInput.value, 300);
  const accountFromId = el.txAccountFromInput.value || null;
  const accountToId = el.txAccountToInput.value || null;
  const categoryId = el.txCategoryInput.value || null;
  const adjustmentMode = el.txAdjustmentModeInput.value;
  const expenseMode = el.txExpenseModeInput.value || "variable";
  const today = formatDateInput(new Date());
  if (!date || date > today) {
    alert("Ngày giao dịch không hợp lệ hoặc đang ở tương lai.");
    return null;
  }
  if (!Number.isFinite(amountRaw) || amountRaw <= 0) {
    alert("Số tiền phải lớn hơn 0.");
    return null;
  }
  const activeAccountIds = new Set(getActiveAccounts().map((i) => i.id));
  const activeExpenseIds = new Set(
    getActiveCategories("expense").map((i) => i.id),
  );
  const activeIncomeIds = new Set(
    getActiveCategories("income").map((i) => i.id),
  );
  if (type === "expense") {
    if (!accountFromId || !activeAccountIds.has(accountFromId)) {
      alert("Chi tiêu cần tài khoản nguồn hợp lệ.");
      return null;
    }
    if (!categoryId || !activeExpenseIds.has(categoryId)) {
      alert("Chi tiêu cần phân loại chi tiêu hợp lệ.");
      return null;
    }
  }
  if (type === "income") {
    if (!accountToId || !activeAccountIds.has(accountToId)) {
      alert("Thu nhập cần tài khoản nhận tiền hợp lệ.");
      return null;
    }
    if (!categoryId || !activeIncomeIds.has(categoryId)) {
      alert("Thu nhập cần phân loại thu nhập hợp lệ.");
      return null;
    }
  }
  if (type === "transfer") {
    if (
      !accountFromId ||
      !accountToId ||
      !activeAccountIds.has(accountFromId) ||
      !activeAccountIds.has(accountToId)
    ) {
      alert("Chuyển khoản nội bộ cần tài khoản nguồn và đích hợp lệ.");
      return null;
    }
    if (accountFromId === accountToId) {
      alert("Tài khoản nguồn và đích phải khác nhau.");
      return null;
    }
  }
  if (
    type === "adjustment" &&
    (!accountFromId || !activeAccountIds.has(accountFromId))
  ) {
    alert("Điều chỉnh số dư cần chọn tài khoản hợp lệ.");
    return null;
  }
  const amount =
    type === "adjustment"
      ? adjustmentMode === "subtract"
        ? -Math.abs(amountRaw)
        : Math.abs(amountRaw)
      : amountRaw;
  return {
    type,
    date,
    amount,
    accountFromId,
    accountToId,
    categoryId,
    note,
    expenseMode: type === "expense" ? expenseMode : null,
  };
}

function cancelTransactionEdit(options = {}) {
  runtime.editingTransactionId = null;
  el.transactionForm.reset();
  el.txDateInput.value = formatDateInput(new Date());
  el.txTypeInput.value = "expense";
  el.txAdjustmentModeInput.value = "add";
  el.txExpenseModeInput.value = "fixed";
  el.transactionFormTitle.textContent = "Nhập giao dịch hằng ngày";
  el.transactionSubmitBtn.textContent = "Lưu giao dịch";
  el.transactionCancelEditBtn.classList.add("hidden");
  updateTransactionFormVisibility();
  if (!options.silent) renderAll();
}

function startEditTransaction(id) {
  const tx = state.transactions.find((i) => i.id === id && !i.deleted_at);
  if (!tx) return;
  if (getDebtEntryByTransactionId(tx.id)) {
    alert("Giao dịch này đã được liên kết với quỹ nên không thể sửa.");
    return;
  }
  runtime.editingTransactionId = id;
  openPage("transactions");
  el.txDateInput.value = tx.date;
  el.txTypeInput.value = tx.type;
  updateTransactionFormVisibility();
  el.txAmountInput.value =
    tx.type === "adjustment" ? Math.abs(tx.amount) : tx.amount;
  if (tx.accountFromId) el.txAccountFromInput.value = tx.accountFromId;
  if (tx.accountToId) el.txAccountToInput.value = tx.accountToId;
  if (tx.categoryId) el.txCategoryInput.value = tx.categoryId;
  el.txAdjustmentModeInput.value =
    tx.type === "adjustment" && tx.amount < 0 ? "subtract" : "add";
  el.txExpenseModeInput.value = tx.expenseMode || "fixed";
  el.txNoteInput.value = tx.note || "";
  el.transactionFormTitle.textContent = "Sửa giao dịch";
  el.transactionSubmitBtn.textContent = "Cập nhật giao dịch";
  el.transactionCancelEditBtn.classList.remove("hidden");
}

function softDeleteTransaction(id) {
  const tx = state.transactions.find((i) => i.id === id && !i.deleted_at);
  if (!tx) return;
  if (getDebtEntryByTransactionId(tx.id)) {
    alert("Giao dịch này đã được liên kết với quỹ nên không thể xóa.");
    return;
  }
  if (!confirm("Bạn muốn xóa giao dịch này?")) return;
  tx.deleted_at = nowIso();
  tx.updated_at = nowIso();
  tx.deviceId = state.meta.deviceId;
  runtime.txList.selectedIds.delete(id);
  if (runtime.editingTransactionId === id)
    cancelTransactionEdit({ silent: true });
  persistState();
  renderAll();
}

function softDeleteAccount(id) {
  const account = state.accounts.find((i) => i.id === id && !i.deleted_at);
  if (!account) return;
  if (
    getActiveTransactions().some(
      (tx) => tx.accountFromId === id || tx.accountToId === id,
    )
  ) {
    alert("Tài khoản này còn giao dịch đang hoạt động nên chưa thể xóa.");
    return;
  }
  account.deleted_at = nowIso();
  account.updated_at = nowIso();
  persistState();
  renderAll();
}

function softDeleteCategory(type, id) {
  const list =
    type === "expense" ? state.categories.expense : state.categories.income;
  const category = list.find((i) => i.id === id && !i.deleted_at);
  if (!category) return;
  if (getActiveTransactions().some((tx) => tx.categoryId === id)) {
    alert("Phân loại này đang được dùng trong giao dịch nên chưa thể xóa.");
    return;
  }
  category.deleted_at = nowIso();
  category.updated_at = nowIso();
  persistState();
  renderAll();
}

function getFilteredDashboardTransactions() {
  const { from, to } = getDateRangeFromInputs(
    el.dashboardDateFrom,
    el.dashboardDateTo,
  );
  return getActiveTransactions().filter(
    (tx) => (from ? tx.date >= from : true) && (to ? tx.date <= to : true),
  );
}

function getFilteredReportTransactions() {
  const { from, to } = getDateRangeFromInputs(
    el.reportDateFrom,
    el.reportDateTo,
  );
  const accountId = el.reportAccountFilter.value;
  const type = el.reportTypeFilter.value;
  const expenseMode = el.reportExpenseModeFilter.value;
  return getActiveTransactions().filter((tx) => {
    const typeMatch = type === "all" ? true : tx.type === type;
    const accountMatch =
      !accountId || accountId === "all"
        ? true
        : tx.accountFromId === accountId || tx.accountToId === accountId;
    const dateMatch =
      (from ? tx.date >= from : true) && (to ? tx.date <= to : true);
    const expenseModeMatch =
      tx.type !== "expense"
        ? true
        : expenseMode === "all"
          ? true
          : tx.expenseMode === expenseMode;
    return typeMatch && accountMatch && dateMatch && expenseModeMatch;
  });
}

function getFilteredCompareTransactions() {
  const { from, to } = getDateRangeFromInputs(
    el.compareDateFrom,
    el.compareDateTo,
  );
  const types = getMultiSelectValues(el.compareTypeFilter);
  const accounts = getMultiSelectValues(el.compareAccountFilter);
  const categories = getMultiSelectValues(el.compareCategoryFilter);
  return getActiveTransactions().filter((tx) => {
    const typeMatch = !types.length ? true : types.includes(tx.type);
    const accountMatch = !accounts.length
      ? true
      : accounts.includes(tx.accountFromId) ||
        accounts.includes(tx.accountToId);
    const categoryMatch = !categories.length
      ? true
      : categories.includes(tx.categoryId);
    const dateMatch =
      (from ? tx.date >= from : true) && (to ? tx.date <= to : true);
    return typeMatch && accountMatch && categoryMatch && dateMatch;
  });
}

function calculateAccountBalances() {
  const cacheKey = `${state.meta.lastSavedAt}|${state.accounts.length}|${state.transactions.length}`;
  if (runtime.balancesCacheKey === cacheKey && runtime.balancesCacheValue)
    return { ...runtime.balancesCacheValue };
  const balances = {};
  getActiveAccounts().forEach((a) => {
    balances[a.id] = Number(a.openingBalance || 0);
  });
  getActiveTransactions().forEach((tx) =>
    applyTransactionToBalances(tx, balances),
  );
  runtime.balancesCacheKey = cacheKey;
  runtime.balancesCacheValue = { ...balances };
  return { ...balances };
}

function buildNetWorthSeries(
  sourceTransactions = getActiveTransactions(),
  fromDate = "",
) {
  const balances = {};
  getActiveAccounts().forEach((a) => {
    balances[a.id] = Number(a.openingBalance || 0);
  });
  const allTx = [...getActiveTransactions()].sort(sortTransactionsAsc);
  if (fromDate)
    allTx
      .filter((tx) => tx.date < fromDate)
      .forEach((tx) => applyTransactionToBalances(tx, balances));
  const labels = [],
    values = [];
  [...sourceTransactions].sort(sortTransactionsAsc).forEach((tx) => {
    applyTransactionToBalances(tx, balances);
    labels.push(formatDateDisplay(tx.date));
    values.push(Object.values(balances).reduce((s, v) => s + v, 0));
  });
  return labels.length
    ? { labels, values }
    : { labels: ["Chưa có dữ liệu"], values: [0] };
}

function aggregateByCategory(transactions) {
  const result = {};
  transactions.forEach((tx) => {
    const name = getCategoryNameByTransaction(tx);
    result[name] = (result[name] || 0) + Math.abs(tx.amount);
  });
  if (!Object.keys(result).length) result["Không có dữ liệu"] = 0;
  return result;
}

function groupTransactionsByPeriod(transactions, granularity = "month") {
  return transactions.reduce((acc, tx) => {
    const key = formatPeriodKey(tx.date, granularity);
    if (!acc[key]) acc[key] = [];
    acc[key].push(tx);
    return acc;
  }, {});
}

function formatPeriodKey(date, granularity) {
  const [year, month, day] = date.split("-");
  if (granularity === "day") return `${day}/${month}/${year}`;
  if (granularity === "year") return year;
  return `${month}/${year}`;
}

function updateDonutChart(chart, labels, values) {
  chart.data.labels = labels.length ? labels : ["Không có dữ liệu"];
  chart.data.datasets[0].data = values.length ? values : [0];
  chart.data.datasets[0].backgroundColor = labels.length
    ? labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length])
    : ["rgba(255,255,255,0.14)"];
  chart.update();
}

function applyQuickRange(selectEl, fromEl, toEl) {
  const mode = selectEl.value;
  const today = new Date();
  let from = "",
    to = formatDateInput(today);
  if (mode === "current-month")
    from = formatDateInput(new Date(today.getFullYear(), today.getMonth(), 1));
  else if (mode === "3m")
    from = formatDateInput(
      new Date(today.getFullYear(), today.getMonth() - 2, 1),
    );
  else if (mode === "30d") {
    const s = new Date(today);
    s.setDate(s.getDate() - 29);
    from = formatDateInput(s);
  } else if (mode === "ytd")
    from = formatDateInput(new Date(today.getFullYear(), 0, 1));
  else if (mode === "all") {
    from = "";
    to = "";
  } else return;
  fromEl.value = from;
  toEl.value = to;
}

function initializeCompareDefaultRange() {
  el.compareQuickRange.value = "current-month";
  applyQuickRange(el.compareQuickRange, el.compareDateFrom, el.compareDateTo);
}

function toggleReportExpenseModeVisibility() {
  const wrap = el.reportExpenseModeFilter.closest(".field");
  if (!wrap) return;
  wrap.classList.toggle(
    "hidden",
    !(
      el.reportTypeFilter.value === "expense" ||
      el.reportTypeFilter.value === "all"
    ),
  );
}

function getDateRangeFromInputs(fromEl, toEl) {
  return { from: fromEl.value || "", to: toEl.value || "" };
}

function handleNavClick(event) {
  const button = event.target.closest(".nav-btn");
  if (!button) return;
  openPage(button.dataset.page);
  closeSidebar();
}

function openPage(pageName) {
  document
    .querySelectorAll(".nav-btn")
    .forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.page === pageName),
    );
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  document.getElementById(`page-${pageName}`).classList.add("active");
  el.pageTitle.textContent = PAGE_META[pageName].title;
  el.pageSubtitle.textContent = PAGE_META[pageName].subtitle;
  if (pageName === "compare") renderComparePage();
  if (pageName === "reports") renderReportsPage();
  if (pageName === "debt") renderDebtPage();
}

// FIX ERR-001: persistState với try/catch
function persistState(options = {}) {
  state.meta.lastSavedAt = nowIso();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error("[FinanceApp] Không thể lưu vào localStorage:", err);
    runtime.auth.lastError =
      "Không thể lưu dữ liệu cục bộ. Bộ nhớ trình duyệt có thể đã đầy.";
    renderCloudStatus();
    return;
  }
  if (!options.skipCloud) scheduleCloudSync();
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw
      ? normalizeState(JSON.parse(raw))
      : normalizeState(createDefaultState());
  } catch (e) {
    console.error(e);
    return normalizeState(createDefaultState());
  }
}

function normalizeState(input) {
  const base = createDefaultState();
  return {
    version: 12,
    meta: {
      currency: input?.meta?.currency || base.meta.currency,
      themeLabel: input?.meta?.themeLabel || base.meta.themeLabel,
      monthlyExpenseTarget: normalizeNonNegativeNumber(
        input?.meta?.monthlyExpenseTarget ??
          input?.meta?.monthly_expense_target ??
          base.meta.monthlyExpenseTarget ??
          0,
      ),
      settingsUpdatedAt:
        input?.meta?.settingsUpdatedAt ||
        input?.meta?.settings_updated_at ||
        base.meta.settingsUpdatedAt,
      lastSavedAt: input?.meta?.lastSavedAt || base.meta.lastSavedAt,
      lastCloudSyncAt: input?.meta?.lastCloudSyncAt || null,
      deviceId: input?.meta?.deviceId || base.meta.deviceId,
    },
    accounts: normalizeArray(input?.accounts, base.accounts).map((item) => ({
      id: item.id || createId("acc"),
      name: item.name || "Tài khoản",
      type: item.type || "other",
      openingBalance: Number(item.openingBalance || item.opening_balance || 0),
      note: item.note || "",
      created_at: item.created_at || nowIso(),
      updated_at: item.updated_at || item.created_at || nowIso(),
      deleted_at: item.deleted_at || null,
    })),
    categories: {
      expense: normalizeCategoryList(
        input?.categories?.expense || [],
        "expense",
        base.categories.expense,
      ),
      income: normalizeCategoryList(
        input?.categories?.income || [],
        "income",
        base.categories.income,
      ),
    },
    transactions: normalizeArray(input?.transactions, base.transactions).map(
      (item) => ({
        id: item.id || createId("tx"),
        type: item.type || "expense",
        date: item.date || formatDateInput(new Date()),
        amount: Number(item.amount || 0),
        accountFromId: item.accountFromId || item.account_from_id || null,
        accountToId: item.accountToId || item.account_to_id || null,
        categoryId: item.categoryId || item.category_id || null,
        note: item.note || "",
        expenseMode:
          item.expenseMode ||
          item.expense_mode ||
          (item.type === "expense" ? "variable" : null),
        sequence:
          Number(item.sequence) ||
          Number(item.occurred_at ? new Date(item.occurred_at).getTime() : 0) ||
          Number(new Date(item.created_at || nowIso()).getTime()),
        deviceId: item.deviceId || item.device_id || base.meta.deviceId,
        created_at: item.created_at || nowIso(),
        updated_at: item.updated_at || item.created_at || nowIso(),
        deleted_at: item.deleted_at || null,
      }),
    ),
    debtPlans: normalizeDebtPlans(
      input?.debtPlans || input?.fundPlans || [],
      base.debtPlans,
    ),
    debtEntries: normalizeDebtEntries(
      input?.debtEntries || input?.fundEntries || [],
      base.debtEntries,
    ),
  };
}

function normalizeCategoryList(input, kind, fallback) {
  const source = Array.isArray(input)
    ? input.filter((i) => (i.kind || kind) === kind)
    : fallback;
  return normalizeArray(source, fallback).map((item) => ({
    id: item.id || createId(kind === "expense" ? "exp" : "inc"),
    kind,
    name: item.name || "Danh mục",
    created_at: item.created_at || nowIso(),
    updated_at: item.updated_at || item.created_at || nowIso(),
    deleted_at: item.deleted_at || null,
  }));
}

function normalizeDebtPlans(input, fallback) {
  const source = normalizeArray(input, fallback);
  return source.map((item) => ({
    id: item.id || createId("debt"),
    kind: item.kind || "fund_replenishment",
    name: item.name || "Quỹ hoàn quỹ",
    linkedAccountId: item.linkedAccountId || item.linked_account_id || "",
    currentTargetAmount: Number(
      item.currentTargetAmount || item.current_target_amount || 0,
    ),
    cycle: item.cycle || "monthly",
    dueDay: Number(item.dueDay || item.due_day || 1),
    carryShortfall: Number(item.carryShortfall || item.carry_shortfall || 0),
    note: item.note || "",
    anchorDate:
      item.anchorDate || item.anchor_date || formatDateInput(new Date()),
    nextDueDate: item.nextDueDate
      ? item.nextDueDate
      : formatDateInput(
          calculateDebtDueDateFromAnchor(
            {
              anchorDate:
                item.anchorDate ||
                item.anchor_date ||
                formatDateInput(new Date()),
              cycle: item.cycle || "monthly",
              dueDay: Number(item.dueDay || item.due_day || 1),
            },
            new Date(),
          ),
        ),
    lastSettledPeriod:
      item.lastSettledPeriod || item.last_settled_period || null,
    created_at: item.created_at || nowIso(),
    updated_at: item.updated_at || item.created_at || nowIso(),
    deleted_at: item.deleted_at || null,
  }));
}

function normalizeDebtEntries(input, fallback) {
  const source = normalizeArray(input, fallback);
  return source.map((item) => ({
    id: item.id || createId("debt_entry"),
    planId: item.planId || item.plan_id || "",
    transactionId: item.transactionId || item.transaction_id || "",
    date: item.date || formatDateInput(new Date()),
    amount: Number(item.amount || 0),
    replenishAmount: Number(item.replenishAmount || item.replenish_amount || 0),
    growthAmount: Number(item.growthAmount || item.growth_amount || 0),
    targetAfterPayment: Number(
      item.targetAfterPayment || item.target_after_payment || 0,
    ),
    note: item.note || "",
    created_at: item.created_at || nowIso(),
    updated_at: item.updated_at || item.created_at || nowIso(),
    deleted_at: item.deleted_at || null,
  }));
}

function normalizeArray(value, fallback) {
  return Array.isArray(value) ? value : fallback;
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tai-chinh-ca-nhan-${formatDateFile(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function handleImportJson(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = normalizeState(JSON.parse(reader.result));
      const mode = prompt(
        "Nhập chế độ import: merge để gộp tránh trùng, hoặc replace để ghi đè toàn bộ.",
        "merge",
      );
      if (!mode) {
        event.target.value = "";
        return;
      }
      state =
        mode.toLowerCase() === "replace" ? parsed : mergeStates(state, parsed);
      persistState();
      renderAll();
      alert("Đã nhập dữ liệu JSON thành công.");
    } catch (e) {
      console.error(e);
      alert("Tệp JSON không hợp lệ.");
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file, "utf-8");
}

// FIX JSON-008: dedup category by name after merge, preserve canonical references

function fillAccountSelect(selectEl, includeAll = false, allLabel = "Tất cả") {
  const options = [];
  if (includeAll)
    options.push(`<option value="all">${escapeHtml(allLabel)}</option>`);
  options.push(
    ...getActiveAccounts().map(
      (a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`,
    ),
  );
  selectEl.innerHTML = options.join("");
}

function getMonthRange(date = new Date(), offset = 0) {
  const start = new Date(date.getFullYear(), date.getMonth() + offset, 1);
  const end = new Date(date.getFullYear(), date.getMonth() + offset + 1, 0);
  return { start, end, from: formatDateInput(start), to: formatDateInput(end) };
}

function getExpenseTotalInRange(from = "", to = "") {
  return sumBy(
    getActiveTransactions().filter(
      (tx) =>
        tx.type === "expense" &&
        (from ? tx.date >= from : true) &&
        (to ? tx.date <= to : true),
    ),
    "amount",
  );
}

function normalizeNonNegativeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function getMonthLabel(dateValue) {
  const [year, month] = String(dateValue || "").split("-");
  return month && year ? `${month}/${year}` : "";
}

function getRecentMonthlyExpenseAverage(monthCount = 3) {
  const months = [];
  for (let offset = -1; offset >= -monthCount; offset -= 1) {
    const range = getMonthRange(new Date(), offset);
    months.push({
      ...range,
      total: getExpenseTotalInRange(range.from, range.to),
      label: getMonthLabel(range.from),
    });
  }
  const total = months.reduce((sum, month) => sum + month.total, 0);
  return {
    average: Math.max(
      0,
      Math.round(total / Math.max(months.length, 1) / 1000) * 1000,
    ),
    months,
  };
}

function renderMonthlyExpenseTargetRecommendation() {
  if (!el.monthlyExpenseTargetRecommendation) return;
  const suggestion = getRecentMonthlyExpenseAverage();
  const currentTarget = Number(
    el.monthlyExpenseTargetInput?.value || state.meta.monthlyExpenseTarget || 0,
  );
  if (!suggestion.average) {
    el.monthlyExpenseTargetRecommendation.textContent =
      currentTarget > 0
        ? `Target hiện tại là ${formatCurrency(currentTarget)}. Chưa có đủ dữ liệu chi tiêu trong 3 tháng gần nhất để app đề xuất mức mới.`
        : "Chưa có đủ dữ liệu chi tiêu trong 3 tháng gần nhất để app đề xuất target.";
    return;
  }
  const monthBreakdown = suggestion.months
    .map((month) => `${month.label}: ${formatCurrency(month.total)}`)
    .join(" · ");
  el.monthlyExpenseTargetRecommendation.textContent =
    currentTarget > 0
      ? `Target hiện tại: ${formatCurrency(currentTarget)}. Đề xuất từ app: ${formatCurrency(suggestion.average)} dựa trên chi tiêu 3 tháng gần nhất (${monthBreakdown}).`
      : `Đề xuất từ app: ${formatCurrency(suggestion.average)} dựa trên chi tiêu 3 tháng gần nhất (${monthBreakdown}).`;
}

function getCurrentMonthExpenseTargetSnapshot() {
  const monthRange = getMonthRange(new Date(), 0);
  const now = new Date();
  const spent = getExpenseTotalInRange(monthRange.from, formatDateInput(now));
  const target = Number(state.meta.monthlyExpenseTarget || 0);
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate();
  const elapsedPct = (now.getDate() / daysInMonth) * 100;
  const usedPct = target > 0 ? (spent / target) * 100 : 0;
  return {
    spent,
    target,
    remaining: target - spent,
    usedPct,
    elapsedPct,
    from: monthRange.from,
    to: formatDateInput(now),
  };
}

function getMultiSelectValues(selectEl) {
  if (!selectEl) return [];
  if (selectEl.tagName === "SELECT")
    return [...selectEl.selectedOptions].map((o) => o.value);
  return [...selectEl.querySelectorAll('input[type="checkbox"]:checked')].map(
    (i) => i.value,
  );
}

function fillCompareTypeFilter() {
  const selected = getMultiSelectValues(el.compareTypeFilter);
  renderCustomMultiDropdown(
    el.compareTypeFilter,
    [
      { value: "income", label: "Thu nhập" },
      { value: "expense", label: "Chi tiêu" },
      { value: "transfer", label: "Chuyển khoản nội bộ" },
      { value: "adjustment", label: "Điều chỉnh số dư" },
    ],
    selected,
    "Chọn loại giao dịch",
    renderCompareChart,
  );
}

function fillCompareAccountFilter() {
  const selected = getMultiSelectValues(el.compareAccountFilter);
  renderCustomMultiDropdown(
    el.compareAccountFilter,
    getActiveAccounts().map((a) => ({ value: a.id, label: a.name })),
    selected,
    "Chọn tài khoản",
    renderCompareChart,
  );
}

function fillCompareCategoryFilter() {
  const selected = getMultiSelectValues(el.compareCategoryFilter);
  const all = [
    ...getActiveCategories("expense"),
    ...getActiveCategories("income"),
  ];
  renderCustomMultiDropdown(
    el.compareCategoryFilter,
    all.map((i) => ({ value: i.id, label: i.name })),
    selected,
    "Chọn phân loại",
    renderCompareChart,
  );
}

function getActiveDebtPlans() {
  return (state.debtPlans || []).filter((i) => !i.deleted_at);
}
function getActiveDebtEntries() {
  return (state.debtEntries || []).filter((i) => !i.deleted_at);
}

function isDebtTransactionAlreadyUsed(transactionId, planId = null) {
  if (!transactionId) return false;

  return getActiveDebtEntries().some((entry) => {
    if (entry.transactionId !== transactionId) return false;

    // Mặc định: chặn trùng toàn cục, 1 giao dịch chỉ được dùng 1 lần
    if (!planId) return true;

    // Nếu muốn chỉ chặn trong cùng 1 quỹ thì đổi return này thành:
    // return entry.planId === planId;
    return true;
  });
}

function getAvailableDebtPlanLinkedTransactions(plan) {
  return getDebtPlanLinkedTransactions(plan).filter(
    (tx) => !isDebtTransactionAlreadyUsed(tx.id, plan.id),
  );
}

function fillDebtAccountSelect() {
  if (!el.debtPlanAccountInput) return;
  const accounts = getActiveAccounts();
  if (!accounts.length) {
    el.debtPlanAccountInput.innerHTML =
      '<option value="">Chưa có tài khoản để liên kết</option>';
    el.debtPlanAccountInput.disabled = true;
    return;
  }
  el.debtPlanAccountInput.disabled = false;
  el.debtPlanAccountInput.innerHTML = accounts
    .map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`)
    .join("");
}

function fillDebtPlanSelects() {
  const plans = getActiveDebtPlans();
  const planOptions = plans.length
    ? plans
        .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
        .join("")
    : '<option value="">Chưa có quỹ</option>';
  if (el.debtEntryPlanSelect) {
    const current = el.debtEntryPlanSelect.value;
    el.debtEntryPlanSelect.innerHTML = planOptions;
    el.debtEntryPlanSelect.disabled = !plans.length;
    if (plans.some((p) => p.id === current))
      el.debtEntryPlanSelect.value = current;
  }
  if (el.debtProjectionPlanSelect) {
    const current = el.debtProjectionPlanSelect.value;
    el.debtProjectionPlanSelect.innerHTML = planOptions;
    el.debtProjectionPlanSelect.disabled = !plans.length;
    if (plans.some((p) => p.id === current))
      el.debtProjectionPlanSelect.value = current;
  }
}

function getDebtCycleLabel(cycle) {
  return (
    { monthly: "Hàng tháng", quarterly: "Hàng quý", yearly: "Hàng năm" }[
      cycle
    ] || cycle
  );
}

function getDebtPlanLinkedTransactions(plan) {
  const usedTransactionIds = new Set(
    getActiveDebtEntries()
      .map((entry) => entry.transactionId)
      .filter(Boolean),
  );
  return getActiveTransactions()
    .filter((tx) => {
      if (usedTransactionIds.has(tx.id)) return false;
      if (tx.type === "income") return tx.accountToId === plan.linkedAccountId;
      if (tx.type === "transfer")
        return tx.accountToId === plan.linkedAccountId;
      if (tx.type === "adjustment")
        return (
          tx.accountFromId === plan.linkedAccountId && Number(tx.amount) > 0
        );
      return false;
    })
    .sort(sortTransactionsDesc);
}

function calculateBalanceAroundTransaction(accountId, transactionId) {
  const balances = {};
  getActiveAccounts().forEach((account) => {
    balances[account.id] = Number(account.openingBalance || 0);
  });
  let before = Number(balances[accountId] || 0);
  let after = before;
  let found = false;
  for (const tx of [...getActiveTransactions()].sort(sortTransactionsAsc)) {
    if (tx.id === transactionId) {
      before = Number(balances[accountId] || 0);
      applyTransactionToBalances(tx, balances);
      after = Number(balances[accountId] || 0);
      found = true;
      break;
    }
    applyTransactionToBalances(tx, balances);
  }
  return { before, after, found };
}

function calculateDebtDueInfo(plan, referenceDate = new Date()) {
  const today = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );
  const nextDue = calculateDebtDueDateFromAnchor(plan, today);
  const daysUntilDue = Math.floor((nextDue - today) / 86400000);
  return { nextDue, daysUntilDue };
}

function calculateDebtSnapshot(
  plan,
  accountBalances = calculateAccountBalances(),
) {
  const currentBalance = Number(accountBalances[plan.linkedAccountId] || 0);
  const currentTargetAmount = Number(plan.currentTargetAmount || 0);
  const carryShortfall = Math.max(0, Number(plan.carryShortfall || 0));
  const gapToTarget = Math.max(0, currentTargetAmount - currentBalance);
  const minimumDue = gapToTarget + carryShortfall;
  const coverageRatio =
    currentTargetAmount > 0
      ? Math.min(1, currentBalance / currentTargetAmount)
      : 1;
  const lastEntry =
    getActiveDebtEntries()
      .filter((e) => e.planId === plan.id)
      .sort(
        (a, b) =>
          compareIso(b.date, a.date) || compareIso(b.updated_at, a.updated_at),
      )[0] || null;
  const dueInfo = calculateDebtDueInfo(plan);
  let status = "Ổn định";
  if (minimumDue > 0 && dueInfo.daysUntilDue < 0) status = "Quá hạn";
  else if (minimumDue > 0 && dueInfo.daysUntilDue <= 7) status = "Sắp hạn";
  else if (minimumDue > 0) status = "Cần bù";
  return {
    currentBalance,
    currentTargetAmount,
    carryShortfall,
    gapToTarget,
    minimumDue,
    coverageRatio,
    lastEntry,
    dueInfo,
    status,
  };
}

function simulateDebtProjection(
  plan,
  plannedPayment,
  periods,
  startingBalance = null,
) {
  const snapshot = calculateDebtSnapshot(plan);
  let projectedBalance =
    startingBalance == null
      ? snapshot.currentBalance
      : Number(startingBalance || 0);
  let target = Number(plan.currentTargetAmount || 0);
  let carry = Number(plan.carryShortfall || 0);
  const rows = [];
  for (let i = 1; i <= periods; i += 1) {
    const gap = Math.max(0, target - projectedBalance);
    const minimumDue = gap + carry;
    const payToCarry = Math.min(plannedPayment, carry);
    const remainingAfterCarry = plannedPayment - payToCarry;
    const payToGap = Math.min(remainingAfterCarry, gap);
    const remainingAfterGap = remainingAfterCarry - payToGap;
    const replenish = payToCarry + payToGap;
    const growth = remainingAfterGap;
    projectedBalance += plannedPayment;
    target += growth;
    const remainingGap = Math.max(0, target - projectedBalance);
    carry = Math.max(0, carry - payToCarry);
    rows.push({
      period: i,
      dueLabel: `${getDebtCycleLabel(plan.cycle)} · ngày ${plan.dueDay}`,
      minimumDue,
      plannedPayment,
      replenish,
      growth,
      targetAfter: target,
      projectedBalance,
      carry,
      remainingGap,
    });
  }
  return { snapshot, rows };
}

function renderDashboardDebtAlerts() {
  if (!el.dashboardDebtAlerts) return;
  const rows = getActiveDebtPlans()
    .map((plan) => ({ plan, snapshot: calculateDebtSnapshot(plan) }))
    .filter(
      (row) =>
        row.snapshot.minimumDue > 0 && row.snapshot.dueInfo.daysUntilDue <= 7,
    )
    .sort(
      (a, b) =>
        a.snapshot.dueInfo.daysUntilDue - b.snapshot.dueInfo.daysUntilDue,
    );
  if (!rows.length) {
    el.dashboardDebtAlerts.innerHTML =
      '<div class="empty-state">Không có quỹ nào cần nộp trong 7 ngày tới.</div>';
    return;
  }
  el.dashboardDebtAlerts.innerHTML = `<div class="alert-list">${rows
    .map(({ plan, snapshot }) => {
      const cls = snapshot.dueInfo.daysUntilDue < 0 ? "danger" : "warning";
      const label =
        snapshot.dueInfo.daysUntilDue < 0
          ? "Đã quá hạn"
          : `Còn ${snapshot.dueInfo.daysUntilDue} ngày`;
      return `<div class="alert-item ${cls}"><strong>${escapeHtml(plan.name)}</strong><span>${escapeHtml(getAccountName(plan.linkedAccountId))}</span><span>${label} · cần nộp tối thiểu ${formatCurrency(snapshot.minimumDue)}</span></div>`;
    })
    .join("")}</div>`;
}

function fillDebtEntryTransactionSelect() {
  if (!el.debtEntryTransactionSelect) return;

  const plan = getActiveDebtPlans().find(
    (p) => p.id === el.debtEntryPlanSelect.value,
  );

  if (!plan) {
    el.debtEntryTransactionSelect.innerHTML =
      '<option value="">Chọn quỹ trước</option>';
    el.debtEntryTransactionSelect.disabled = true;
    renderDebtEntryTransactionInfo();
    return;
  }

  const items = getAvailableDebtPlanLinkedTransactions(plan);

  if (!items.length) {
    el.debtEntryTransactionSelect.innerHTML =
      '<option value="">Không còn giao dịch chưa liên kết</option>';
    el.debtEntryTransactionSelect.disabled = true;
    renderDebtEntryTransactionInfo();
    return;
  }

  el.debtEntryTransactionSelect.disabled = false;
  el.debtEntryTransactionSelect.innerHTML = items
    .map(
      (tx) =>
        `<option value="${tx.id}">${formatDateDisplay(tx.date)} · ${formatCurrency(tx.amount)} · ${escapeHtml(tx.note || getTransactionAccountText(tx))}</option>`,
    )
    .join("");

  renderDebtEntryTransactionInfo();
}

function renderDebtEntryTransactionInfo() {
  if (!el.debtEntryTransactionInfo) return;
  const plan = getActiveDebtPlans().find(
    (p) => p.id === el.debtEntryPlanSelect.value,
  );
  const tx = getActiveTransactions().find(
    (item) => item.id === el.debtEntryTransactionSelect.value,
  );
  if (!plan) {
    el.debtEntryTransactionInfo.innerHTML =
      "Chọn quỹ để hiện danh sách giao dịch có thể liên kết.";
    return;
  }
  if (!tx) {
    el.debtEntryTransactionInfo.innerHTML =
      "Chọn một giao dịch thật đã đi vào tài khoản liên kết để hệ thống tính phần bù hụt và phần tăng mốc.";
    return;
  }
  const around = calculateBalanceAroundTransaction(plan.linkedAccountId, tx.id);
  const impact = calculateDebtImpact(plan, tx, around.before, around.after);
  el.debtEntryTransactionInfo.innerHTML = `${escapeHtml(getAccountName(plan.linkedAccountId))} · trước giao dịch ${formatCurrency(around.before)} · sau giao dịch ${formatCurrency(around.after)} · bù hụt ${formatCurrency(impact.replenishAmount)} · tăng mốc ${formatCurrency(impact.growthAmount)}`;
}

function computeDebtPlanMetrics(plan) {
  return calculateDebtSnapshot(plan);
}

function hasMatchingDebtTopUpTransaction(plan, date, amount) {
  return getActiveTransactions().some((tx) => {
    if (tx.date !== date) return false;
    if (Number(tx.amount) !== Number(amount)) return false;
    if (tx.type === "income") return tx.accountToId === plan.linkedAccountId;
    if (tx.type === "transfer") return tx.accountToId === plan.linkedAccountId;
    if (tx.type === "adjustment")
      return tx.accountFromId === plan.linkedAccountId && Number(tx.amount) > 0;
    return false;
  });
}

function renderDebtPage() {
  if (!el.debtTable) return;
  fillDebtAccountSelect();
  fillDebtPlanSelects();
  fillDebtEntryTransactionSelect();
  const plans = getActiveDebtPlans();
  const rows = plans.map((plan) => ({
    plan,
    metrics: computeDebtPlanMetrics(plan),
  }));
  el.debtTotalGap.textContent = formatCurrency(
    rows.reduce((sum, row) => sum + row.metrics.gapToTarget, 0),
  );
  el.debtTotalMinDue.textContent = formatCurrency(
    rows.reduce((sum, row) => sum + row.metrics.minimumDue, 0),
  );
  el.debtFundCount.textContent = String(rows.length);
  el.debtTargetTotal.textContent = formatCurrency(
    rows.reduce((sum, row) => sum + row.metrics.currentTargetAmount, 0),
  );

  if (!rows.length) {
    el.debtTable.innerHTML =
      '<div class="empty-state">Chưa có quỹ hoàn quỹ nào. Hãy tạo quỹ đầu tiên để theo dõi mốc mục tiêu động và phần cần bù.</div>';
  } else {
    el.debtTable.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Tên quỹ</th><th>Tài khoản</th><th>Tiến độ</th><th>Số dư hiện tại</th><th>Mốc hiện hành</th><th>Cần bù về mốc</th><th>Thiếu dồn từ kỳ trước</th><th>Cần nộp tối thiểu</th><th>Chu kỳ</th><th>Ngày hạn</th><th>Lần nộp gần nhất</th><th>Trạng thái</th><th>Ghi chú</th><th>Thao tác</th></tr></thead><tbody>${rows
      .map(({ plan, metrics }) => {
        const progressPct = Math.round(metrics.coverageRatio * 100);
        const progressClass =
          metrics.status === "Quá hạn"
            ? "danger"
            : metrics.status === "Sắp hạn"
              ? "warning"
              : "";
        return `<tr><td>${escapeHtml(plan.name)}</td><td>${escapeHtml(getAccountName(plan.linkedAccountId))}</td><td><div class="progress-track"><div class="progress-fill ${progressClass}" style="width:${Math.min(progressPct, 100)}%"></div></div><div class="progress-meta"><span>${progressPct}% đạt mốc</span><span>${formatCurrency(metrics.currentBalance)} / ${formatCurrency(plan.currentTargetAmount)}</span></div></td><td>${formatCurrency(metrics.currentBalance)}</td><td>${formatCurrency(plan.currentTargetAmount)}</td><td>${formatCurrency(metrics.gapToTarget)}</td><td>${formatCurrency(metrics.carryShortfall)}</td><td><strong>${formatCurrency(metrics.minimumDue)}</strong></td><td>${escapeHtml(getDebtCycleLabel(plan.cycle))}</td><td>${formatDateDisplay(formatDateInput(metrics.dueInfo.nextDue))}</td><td>${metrics.lastEntry ? `${formatDateDisplay(metrics.lastEntry.date)} · ${formatCurrency(metrics.lastEntry.amount)}` : "-"}</td><td>${metrics.status === "Quá hạn" ? pill("Quá hạn", "pill-expense") : metrics.status === "Sắp hạn" ? pill("Sắp hạn", "pill-fixed") : metrics.status === "Cần bù" ? pill("Cần bù", "pill-expense") : pill("Ổn định", "pill-income")}</td><td>${escapeHtml(plan.note || "-")}</td><td><div class="actions-inline"><button class="btn btn-secondary" type="button" data-action="edit-debt-plan" data-id="${plan.id}">Sửa</button><button class="btn btn-danger" type="button" data-action="delete-debt-plan" data-id="${plan.id}">Xóa</button></div></td></tr>`;
      })
      .join("")}</tbody></table></div>`;
  }
  renderDebtEntriesTable();
  renderDebtProjection();
}

function getFilteredDebtEntries() {
  const from = runtime.debtEntryList.from || "";
  const to = runtime.debtEntryList.to || "";
  return getActiveDebtEntries()
    .filter(
      (entry) =>
        (from ? entry.date >= from : true) && (to ? entry.date <= to : true),
    )
    .sort(
      (a, b) =>
        compareIso(b.date, a.date) || compareIso(b.updated_at, a.updated_at),
    );
}

function changeDebtEntryPage(offset) {
  const all = getFilteredDebtEntries();
  const totalPages = Math.max(
    1,
    Math.ceil(all.length / runtime.debtEntryList.pageSize),
  );
  runtime.debtEntryList.page = Math.min(
    totalPages,
    Math.max(1, runtime.debtEntryList.page + offset),
  );
  renderDebtEntriesTable();
}

function renderDebtEntriesTable() {
  if (!el.debtEntryTable) return;
  const entries = getFilteredDebtEntries();
  const totalPages = Math.max(
    1,
    Math.ceil(entries.length / runtime.debtEntryList.pageSize),
  );
  runtime.debtEntryList.page = Math.min(runtime.debtEntryList.page, totalPages);
  const start =
    (runtime.debtEntryList.page - 1) * runtime.debtEntryList.pageSize;
  const pageItems = entries.slice(
    start,
    start + runtime.debtEntryList.pageSize,
  );
  if (!entries.length) {
    el.debtEntryTable.innerHTML =
      '<div class="empty-state">Không có lần nộp quỹ nào phù hợp với bộ lọc hiện tại.</div>';
    el.debtEntryPaginationInfo.textContent = "Trang 1 / 1";
    el.debtEntryPrevBtn.disabled = true;
    el.debtEntryNextBtn.disabled = true;
    return;
  }
  el.debtEntryTable.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Quỹ</th><th>Giao dịch liên kết</th><th>Số tiền nộp</th><th>Phần bù hụt</th><th>Phần tăng mốc</th><th>Mốc mới sau khi nộp</th><th>Ghi chú</th></tr></thead><tbody>${pageItems.map((entry) => `<tr><td>${formatDateDisplay(entry.date)}</td><td>${escapeHtml(getDebtPlanName(entry.planId))}</td><td>${escapeHtml(getDebtTransactionLabel(entry.transactionId))}</td><td>${formatCurrency(entry.amount)}</td><td>${formatCurrency(entry.replenishAmount)}</td><td>${formatCurrency(entry.growthAmount)}</td><td><strong>${formatCurrency(entry.targetAfterPayment)}</strong></td><td>${escapeHtml(entry.note || "-")}</td></tr>`).join("")}</tbody></table></div>`;
  el.debtEntryPaginationInfo.textContent = `Trang ${runtime.debtEntryList.page} / ${totalPages} · ${entries.length} bản ghi`;
  el.debtEntryPrevBtn.disabled = runtime.debtEntryList.page <= 1;
  el.debtEntryNextBtn.disabled = runtime.debtEntryList.page >= totalPages;
}
function renderDebtProjection() {
  if (!el.debtProjectionTable || !el.debtProjectionPlanSelect) return;
  const planId = el.debtProjectionPlanSelect.value;
  const plan = getActiveDebtPlans().find((p) => p.id === planId);
  const periods = Math.min(
    24,
    Math.max(1, Number(el.debtProjectionPeriodsInput?.value || 6)),
  );
  const plannedPayment = Math.max(
    0,
    Number(el.debtProjectionPaymentInput?.value || 0),
  );
  if (!plan) {
    el.debtProjectionSummary.innerHTML = pill(
      "Chưa có dữ liệu mô phỏng",
      "pill-adjustment",
    );
    el.debtProjectionTable.innerHTML =
      '<div class="empty-state">Chưa có quỹ để mô phỏng.</div>';
    return;
  }
  const { snapshot, rows } = simulateDebtProjection(
    plan,
    plannedPayment,
    periods,
  );
  el.debtProjectionSummary.innerHTML = `${pill(plan.name, "pill-adjustment")} ${pill("Hiện tại", "pill-adjustment")} ${pill(formatCurrency(snapshot.currentBalance), "pill-adjustment")} ${pill("Cần nộp tối thiểu hiện tại", "pill-expense")} ${pill(formatCurrency(snapshot.minimumDue), "pill-expense")} ${pill("Mốc hiện hành", "pill-income")} ${pill(formatCurrency(plan.currentTargetAmount), "pill-income")}`;
  el.debtProjectionTable.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Kỳ</th><th>Chu kỳ</th><th>Cần nộp tối thiểu kỳ này</th><th>Số tiền dự kiến nộp</th><th>Bù hụt</th><th>Tăng mốc</th><th>Mốc mới sau kỳ</th><th>Số dư dự kiến sau kỳ</th><th>Thiếu dồn từ kỳ trước</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${row.period}</td><td>${escapeHtml(row.dueLabel)}</td><td><strong>${formatCurrency(row.minimumDue)}</strong></td><td>${formatCurrency(row.plannedPayment)}</td><td>${formatCurrency(row.replenish)}</td><td>${formatCurrency(row.growth)}</td><td><strong>${formatCurrency(row.targetAfter)}</strong></td><td>${formatCurrency(row.projectedBalance)}</td><td>${formatCurrency(row.remainingGap)}</td></tr>`).join("")}</tbody></table></div>`;
}

function handleDebtPlanSubmit(event) {
  event.preventDefault();
  const name = sanitizeName(el.debtPlanNameInput.value, 80);
  const linkedAccountId = el.debtPlanAccountInput.value || "";
  const currentTargetAmount = Number(el.debtPlanCurrentTargetInput.value || 0);
  const cycle = el.debtPlanCycleInput.value || "monthly";
  const dueDay = Number(el.debtPlanDueDayInput.value || 0);
  const carryShortfall = Number(el.debtPlanCarryShortfallInput.value || 0);
  const note = sanitizeText(el.debtPlanNoteInput.value, 300);
  if (!name) {
    alert("Tên quỹ không hợp lệ.");
    return;
  }
  if (!linkedAccountId) {
    alert("Vui lòng chọn tài khoản liên kết cho quỹ.");
    return;
  }
  if (!Number.isFinite(currentTargetAmount) || currentTargetAmount < 0) {
    alert("Mốc mục tiêu hiện hành phải là số không âm.");
    return;
  }
  if (!Number.isFinite(dueDay) || dueDay < 1 || dueDay > 31) {
    alert("Ngày đến hạn phải nằm trong khoảng từ 1 đến 31.");
    return;
  }
  if (!Number.isFinite(carryShortfall) || carryShortfall < 0) {
    alert("Phần thiếu dồn từ kỳ trước phải là số không âm.");
    return;
  }
  if (runtime.editingDebtPlanId) {
    const idx = state.debtPlans.findIndex(
      (item) => item.id === runtime.editingDebtPlanId,
    );
    if (idx >= 0) {
      const old = state.debtPlans[idx];
      const anchorDate = old.anchorDate || formatDateInput(new Date());
      state.debtPlans[idx] = {
        ...old,
        name,
        linkedAccountId,
        currentTargetAmount,
        cycle,
        dueDay,
        carryShortfall,
        note,
        anchorDate,
        nextDueDate: formatDateInput(
          calculateDebtDueDateFromAnchor(
            { anchorDate, cycle, dueDay },
            new Date(),
          ),
        ),
        updated_at: nowIso(),
        deleted_at: null,
      };
    }
  } else {
    state.debtPlans.push(
      makeDebtPlan(
        name,
        linkedAccountId,
        currentTargetAmount,
        cycle,
        dueDay,
        carryShortfall,
        note,
      ),
    );
  }
  cancelDebtPlanEdit({ silent: true });
  persistState();
  renderAll();
}
function handleDebtEntrySubmit(event) {
  event.preventDefault();

  const planId = el.debtEntryPlanSelect.value || "";
  const transactionId = el.debtEntryTransactionSelect.value || "";
  const note = sanitizeText(el.debtEntryNoteInput.value, 300);

  const plan = getActiveDebtPlans().find((p) => p.id === planId);
  const transaction = getActiveTransactions().find(
    (tx) => tx.id === transactionId,
  );

  if (!plan) {
    alert("Vui lòng chọn quỹ cần ghi nhận nộp.");
    return;
  }

  if (!transaction) {
    alert("Vui lòng chọn giao dịch thật liên kết.");
    return;
  }

  if (isDebtTransactionAlreadyUsed(transaction.id, plan.id)) {
    alert(
      "Giao dịch này đã được dùng để ghi nhận nộp quỹ rồi. Vui lòng chọn giao dịch khác.",
    );
    fillDebtEntryTransactionSelect();
    renderDebtEntryTransactionInfo();
    return;
  }

  const around = calculateBalanceAroundTransaction(
    plan.linkedAccountId,
    transaction.id,
  );

  if (!around.found) {
    alert("Không xác định được vị trí giao dịch trong nhật ký.");
    return;
  }

  const impact = calculateDebtImpact(
    plan,
    transaction,
    around.before,
    around.after,
  );

  state.debtEntries.push(
    makeDebtEntry(
      plan.id,
      transaction.id,
      transaction.date,
      transaction.amount,
      impact.replenishAmount,
      impact.growthAmount,
      impact.targetAfterPayment,
      note,
    ),
  );

  const idx = state.debtPlans.findIndex((item) => item.id === plan.id);
  if (idx >= 0) {
    let updatedPlan = {
      ...state.debtPlans[idx],
      currentTargetAmount: impact.targetAfterPayment,
      carryShortfall: impact.remainingCarry,
      updated_at: nowIso(),
    };

    // Check if this debt period should be settled and advance nextDueDate
    updatedPlan = settleDebtPeriodIfEligible(updatedPlan, impact, around.after);

    state.debtPlans[idx] = updatedPlan;
  }

  el.debtEntryForm.reset();
  fillDebtPlanSelects();
  fillDebtEntryTransactionSelect();
  renderDebtEntryTransactionInfo();
  persistState();
  renderAll();
}

function startEditDebtPlan(id) {
  const plan = state.debtPlans.find(
    (item) => item.id === id && !item.deleted_at,
  );
  if (!plan) return;
  runtime.editingDebtPlanId = id;
  openPage("debt");
  el.debtPlanNameInput.value = plan.name || "";
  el.debtPlanAccountInput.value = plan.linkedAccountId || "";
  el.debtPlanCurrentTargetInput.value = plan.currentTargetAmount || 0;
  el.debtPlanCycleInput.value = plan.cycle || "monthly";
  el.debtPlanDueDayInput.value = plan.dueDay || 1;
  el.debtPlanCarryShortfallInput.value = plan.carryShortfall || 0;
  el.debtPlanNoteInput.value = plan.note || "";
  el.debtFormTitle.textContent = "Sửa quỹ hoàn quỹ";
  el.debtPlanSubmitBtn.textContent = "Cập nhật quỹ";
  el.debtPlanCancelEditBtn.classList.remove("hidden");
}

function cancelDebtPlanEdit(options = {}) {
  runtime.editingDebtPlanId = null;
  el.debtPlanForm.reset();
  el.debtPlanCycleInput.value = "monthly";
  el.debtPlanDueDayInput.value = 1;
  el.debtFormTitle.textContent = "Tạo quỹ hoàn quỹ";
  el.debtPlanSubmitBtn.textContent = "Lưu quỹ";
  el.debtPlanCancelEditBtn.classList.add("hidden");
  fillDebtAccountSelect();
  if (!options.silent) renderAll();
}

function softDeleteDebtPlan(id) {
  const plan = state.debtPlans.find(
    (item) => item.id === id && !item.deleted_at,
  );
  if (!plan) return;
  const linkedEntry = getActiveDebtEntries().find(
    (entry) => entry.planId === id,
  );
  if (linkedEntry) {
    alert(
      "Quỹ này đang có ghi nhận nộp quỹ liên kết nên không thể xóa trực tiếp. Hãy lưu trữ quỹ hoặc xoá các ghi nhận nộp quỹ trước.",
    );
    return;
  }
  if (!confirm("Bạn muốn xóa quỹ hoàn quỹ này?")) return;
  plan.deleted_at = nowIso();
  plan.updated_at = nowIso();
  if (runtime.editingDebtPlanId === id) cancelDebtPlanEdit({ silent: true });
  persistState();
  renderAll();
}

function getDebtPlanName(id) {
  return state.debtPlans.find((item) => item.id === id)?.name || "-";
}

function getDebtTransactionLabel(id) {
  const tx = state.transactions.find((item) => item.id === id);
  return tx
    ? `${formatDateDisplay(tx.date)} · ${formatCurrency(tx.amount)}`
    : "-";
}

function getActiveAccounts() {
  return state.accounts.filter((i) => !i.deleted_at);
}
function getActiveCategories(type) {
  return (
    type === "expense" ? state.categories.expense : state.categories.income
  ).filter((i) => !i.deleted_at);
}
function getActiveTransactions() {
  return state.transactions.filter((i) => !i.deleted_at);
}
function getAccountName(id) {
  return state.accounts.find((i) => i.id === id)?.name || "-";
}
function getCategoryNameByTransaction(tx) {
  if (tx.type === "expense")
    return (
      state.categories.expense.find((i) => i.id === tx.categoryId)?.name ||
      "Chưa phân loại chi"
    );
  if (tx.type === "income")
    return (
      state.categories.income.find((i) => i.id === tx.categoryId)?.name ||
      "Chưa phân loại thu"
    );
  if (tx.type === "transfer") return "Chuyển khoản nội bộ";
  return "Điều chỉnh số dư";
}
function getTransactionAccountText(tx) {
  if (tx.type === "expense") return getAccountName(tx.accountFromId);
  if (tx.type === "income") return getAccountName(tx.accountToId);
  if (tx.type === "transfer")
    return `${getAccountName(tx.accountFromId)} → ${getAccountName(tx.accountToId)}`;
  return getAccountName(tx.accountFromId);
}
function getTypeBadge(type) {
  return type === "income"
    ? pill("Thu nhập", "pill-income")
    : type === "expense"
      ? pill("Chi tiêu", "pill-expense")
      : type === "transfer"
        ? pill("Chuyển khoản nội bộ", "pill-transfer")
        : pill("Điều chỉnh số dư", "pill-adjustment");
}
function getExpenseModeBadge(mode) {
  return mode === "fixed"
    ? pill("Cố định", "pill-fixed")
    : pill("Không cố định", "pill-variable");
}
function pill(text, cls) {
  return `<span class="pill ${sanitizePillClass(cls)}">${escapeHtml(text)}</span>`;
}
function mapAccountType(type) {
  return (
    {
      cash: "Tiền mặt",
      bank: "Ngân hàng",
      saving: "Tiết kiệm",
      investment: "Đầu tư",
      other: "Khác",
    }[type] || type
  );
}
function formatCurrency(value) {
  const currency = state.meta.currency || "VND";
  return `${new Intl.NumberFormat("vi-VN").format(Number(value || 0))} ${currency === "VND" ? "₫" : currency}`;
}
function logStateSnapshot(source) {
  console.info("[FinanceApp] State snapshot", {
    source,
    deviceId: state.meta.deviceId,
    lastSavedAt: state.meta.lastSavedAt,
    lastCloudSyncAt: state.meta.lastCloudSyncAt,
    activeAccounts: getActiveAccounts().length,
    activeExpenseCategories: getActiveCategories("expense").length,
    activeIncomeCategories: getActiveCategories("income").length,
    activeTransactions: getActiveTransactions().length,
    cloudUser: runtime.auth.user?.email || null,
  });
}
function startMagicLinkCooldown(seconds = 60) {
  runtime.loginCooldownUntil = Date.now() + seconds * 1000;
  clearInterval(runtime.loginCooldownTimer);
  const updateButton = () => {
    const rem = Math.max(
      0,
      Math.ceil((runtime.loginCooldownUntil - Date.now()) / 1000),
    );
    const btn = el.cloudLoginForm?.querySelector('button[type="submit"]');
    if (!btn) return;
    if (rem > 0) {
      btn.disabled = true;
      btn.textContent = `Gửi lại sau ${rem}s`;
    } else {
      btn.disabled = false;
      btn.textContent = "Gửi magic link";
      clearInterval(runtime.loginCooldownTimer);
      runtime.loginCooldownTimer = null;
    }
  };
  updateButton();
  runtime.loginCooldownTimer = setInterval(updateButton, 1000);
}

function mapLocalAccountToCloud(item, userId) {
  return {
    id: item.id,
    user_id: userId,
    name: item.name,
    type: item.type,
    opening_balance: item.openingBalance,
    note: item.note,
    created_at: item.created_at,
    updated_at: item.updated_at,
    deleted_at: item.deleted_at,
  };
}
function mapLocalSettingsToCloud(meta, userId) {
  return {
    user_id: userId,
    currency: meta.currency || "VND",
    theme_label: meta.themeLabel || "dark-green",
    monthly_expense_target: normalizeNonNegativeNumber(
      meta.monthlyExpenseTarget || 0,
    ),
    updated_at: meta.settingsUpdatedAt || nowIso(),
  };
}
function mapCloudSettingsToLocal(row) {
  if (!row) return null;
  return {
    currency: row.currency || "VND",
    themeLabel: row.theme_label || "dark-green",
    monthlyExpenseTarget: normalizeNonNegativeNumber(
      row.monthly_expense_target || 0,
    ),
    settingsUpdatedAt: row.updated_at || nowIso(),
  };
}
function mapCloudAccountToLocal(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    openingBalance: Number(row.opening_balance || 0),
    note: row.note || "",
    created_at: row.created_at || nowIso(),
    updated_at: row.updated_at || row.created_at || nowIso(),
    deleted_at: row.deleted_at || null,
  };
}
function mapLocalCategoryToCloud(item, userId) {
  return {
    id: item.id,
    user_id: userId,
    kind: item.kind,
    name: item.name,
    created_at: item.created_at,
    updated_at: item.updated_at,
    deleted_at: item.deleted_at,
  };
}
function mapCloudCategoryToLocal(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    created_at: row.created_at || nowIso(),
    updated_at: row.updated_at || row.created_at || nowIso(),
    deleted_at: row.deleted_at || null,
  };
}
function mapLocalTransactionToCloud(item, userId) {
  return {
    id: item.id,
    user_id: userId,
    type: item.type,
    date: item.date,
    amount: item.amount,
    account_from_id: item.accountFromId,
    account_to_id: item.accountToId,
    category_id: item.categoryId,
    note: item.note,
    expense_mode: item.expenseMode,
    device_id: item.deviceId,
    created_at: item.created_at,
    updated_at: item.updated_at,
    deleted_at: item.deleted_at,
  };
}
function mapCloudTransactionToLocal(row) {
  return {
    id: row.id,
    type: row.type,
    date: row.date,
    amount: Number(row.amount || 0),
    accountFromId: row.account_from_id || null,
    accountToId: row.account_to_id || null,
    categoryId: row.category_id || null,
    note: row.note || "",
    expenseMode:
      row.expense_mode || (row.type === "expense" ? "variable" : null),
    deviceId: row.device_id || state.meta.deviceId,
    created_at: row.created_at || nowIso(),
    updated_at: row.updated_at || row.created_at || nowIso(),
    deleted_at: row.deleted_at || null,
  };
}
function mapLocalDebtPlanToCloud(item, userId) {
  return {
    id: item.id,
    user_id: userId,
    kind: item.kind,
    name: item.name,
    linked_account_id: item.linkedAccountId,
    current_target_amount: item.currentTargetAmount,
    cycle: item.cycle,
    due_day: item.dueDay,
    carry_shortfall: item.carryShortfall,
    anchor_date: item.anchorDate,
    next_due_date: item.nextDueDate,
    last_settled_period: item.lastSettledPeriod,
    note: item.note,
    created_at: item.created_at,
    updated_at: item.updated_at,
    deleted_at: item.deleted_at,
  };
}

function mapCloudDebtPlanToLocal(row) {
  return {
    id: row.id,
    kind: row.kind || "fund_replenishment",
    name: row.name || "Quỹ hoàn quỹ",
    linkedAccountId: row.linked_account_id || "",
    currentTargetAmount: Number(row.current_target_amount || 0),
    cycle: row.cycle || "monthly",
    dueDay: Number(row.due_day || 1),
    carryShortfall: Number(row.carry_shortfall || 0),
    anchorDate: row.anchor_date || formatDateInput(new Date()),
    nextDueDate:
      row.next_due_date ||
      formatDateInput(
        calculateDebtDueDateFromAnchor(
          {
            anchorDate: row.anchor_date || formatDateInput(new Date()),
            cycle: row.cycle || "monthly",
            dueDay: Number(row.due_day || 1),
          },
          new Date(),
        ),
      ),
    lastSettledPeriod: row.last_settled_period || null,
    note: row.note || "",
    created_at: row.created_at || nowIso(),
    updated_at: row.updated_at || row.created_at || nowIso(),
    deleted_at: row.deleted_at || null,
  };
}

function mapLocalDebtEntryToCloud(item, userId) {
  return {
    id: item.id,
    user_id: userId,
    plan_id: item.planId,
    transaction_id: item.transactionId,
    date: item.date,
    amount: item.amount,
    replenish_amount: item.replenishAmount,
    growth_amount: item.growthAmount,
    target_after_payment: item.targetAfterPayment,
    note: item.note,
    created_at: item.created_at,
    updated_at: item.updated_at,
    deleted_at: item.deleted_at,
  };
}

function mapCloudDebtEntryToLocal(row) {
  return {
    id: row.id,
    planId: row.plan_id || "",
    transactionId: row.transaction_id || "",
    date: row.date || formatDateInput(new Date()),
    amount: Number(row.amount || 0),
    replenishAmount: Number(row.replenish_amount || 0),
    growthAmount: Number(row.growth_amount || 0),
    targetAfterPayment: Number(row.target_after_payment || 0),
    note: row.note || "",
    created_at: row.created_at || nowIso(),
    updated_at: row.updated_at || row.created_at || nowIso(),
    deleted_at: row.deleted_at || null,
  };
}
window.startEditTransaction = startEditTransaction;
window.softDeleteTransaction = softDeleteTransaction;
window.softDeleteAccount = softDeleteAccount;
window.softDeleteCategory = softDeleteCategory;
window.startEditDebtPlan = startEditDebtPlan;
window.softDeleteDebtPlan = softDeleteDebtPlan;
