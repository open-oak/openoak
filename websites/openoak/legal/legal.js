const tabs = document.querySelectorAll(".legal-tab");
const panels = document.querySelectorAll(".legal-panel");

const appAnchors = {
  account: "account",
  opentodo: "opentodo",
  openoutline: "openoutline",
  openkanbanboard: "openkanbanboard",
  futureapps: "future-apps",
  "future-apps": "future-apps",
};

function activate(tabId) {
  tabs.forEach((tab) => tab.setAttribute("aria-selected", "false"));
  panels.forEach((panel) => panel.classList.remove("active"));

  const tab = document.getElementById(tabId);
  if (!tab) return;

  tab.setAttribute("aria-selected", "true");
  document.getElementById(tab.getAttribute("aria-controls"))?.classList.add("active");
}

function scrollToSection(id) {
  document.getElementById(id)?.scrollIntoView({ block: "start" });
}

function routeHash(scroll = false) {
  const hash = location.hash.replace("#", "");

  if (hash === "terms" || hash.startsWith("terms-")) {
    activate("tab-terms");
    if (scroll && hash !== "terms") scrollToSection(hash);
    return;
  }

  activate("tab-privacy");
  if (hash === "privacy") return;
  if (hash.startsWith("privacy-")) {
    if (scroll) scrollToSection(hash);
    return;
  }
  if (appAnchors[hash] && scroll) scrollToSection(appAnchors[hash]);
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const hash = tab.id === "tab-privacy" ? "privacy" : "terms";
    history.replaceState(null, "", `#${hash}`);
    activate(tab.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});

document.querySelectorAll(".footer-action[data-tab]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    activate(link.dataset.tab);
    history.replaceState(null, "", link.getAttribute("href"));
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});

routeHash();
window.addEventListener("hashchange", () => routeHash(true));
if (location.hash) requestAnimationFrame(() => routeHash(true));
