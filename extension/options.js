(() => {
  // src/operator-name.js
  var normalizeOperatorName = (value) => String(value || "").trim().replace(/\s+/g, " ").slice(0, 100);
  var hasOperatorName = (value) => {
    const name = normalizeOperatorName(value);
    return !!name && !/^(оператор|operator)$/i.test(name);
  };

  // src/options.js
  var byId = (id) => document.getElementById(id);
  var initialized = false;
  async function request(message) {
    const r = await chrome.runtime.sendMessage(message);
    if (!r?.ok) throw Error(r?.error || "\u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u0435 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E");
    return r;
  }
  function error(text) {
    byId("error").textContent = text;
    byId("error").hidden = !text;
  }
  async function refresh() {
    try {
      const { state } = await request({ type: "GET_STATE" });
      byId("namePrompt").hidden = !state.needsName;
      if (!initialized) {
        byId("operator").value = state.needsName ? "" : state.config.operatorName;
        byId("hub").value = state.config.lanUrl;
        byId("lanEnabled").checked = state.config.lanEnabled;
        initialized = true;
        if (state.needsName) byId("operator").focus();
      }
      byId("connection").textContent = state.lan.detail;
      byId("connection").className = `status${state.lan.connected ? " online" : ""}`;
      const records = Object.values(state.records).filter((r) => !r.deleted && r.ownerDeviceId === state.deviceId);
      byId("export").disabled = records.length === 0;
      byId("recordCount").textContent = `\u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E: ${records.length}`;
    } catch (e) {
      error(e.message);
    }
  }
  byId("settings").addEventListener("submit", async (event) => {
    event.preventDefault();
    error("");
    try {
      const operatorName = normalizeOperatorName(byId("operator").value);
      if (!hasOperatorName(operatorName)) throw Error("\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u0441\u0432\u043E\u0451 \u0438\u043C\u044F, \u0447\u0442\u043E\u0431\u044B \u043A\u043E\u043B\u043B\u0435\u0433\u0438 \u0432\u0438\u0434\u0435\u043B\u0438 \u0438\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044F");
      const url = new URL(byId("hub").value.trim());
      if (!["ws:", "wss:"].includes(url.protocol)) throw Error("\u0410\u0434\u0440\u0435\u0441 \u0434\u043E\u043B\u0436\u0435\u043D \u043D\u0430\u0447\u0438\u043D\u0430\u0442\u044C\u0441\u044F \u0441 ws:// \u0438\u043B\u0438 wss://");
      const scheme = url.protocol === "wss:" ? "https" : "http";
      const enabled = byId("lanEnabled").checked;
      if (enabled) {
        const granted = await chrome.permissions.request({ origins: [`${scheme}://${url.hostname}/*`] });
        if (!granted) throw Error("\u0414\u043B\u044F \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F \u043D\u0443\u0436\u043D\u043E \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0438\u0435 \u043D\u0430 \u0430\u0434\u0440\u0435\u0441 \u0445\u0430\u0431\u0430");
      }
      await request({ type: "SAVE_CONFIG", config: { operatorName, lanUrl: url.href, lanEnabled: enabled } });
      byId("saved").textContent = "\u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E";
      setTimeout(() => {
        byId("saved").textContent = "";
      }, 2500);
      await refresh();
    } catch (e) {
      error(e.message);
    }
  });
  byId("export").onclick = async () => {
    try {
      const { text } = await request({ type: "EXPORT" });
      const url = URL.createObjectURL(new Blob(["\uFEFF" + text], { type: "text/plain;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `maxtracker-${new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(/* @__PURE__ */ new Date())}.txt`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5e3);
    } catch (e) {
      error(e.message);
    }
  };
  void refresh();
  setInterval(() => void refresh(), 3e3);
})();
