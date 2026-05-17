/* ===============================
   Private JSON Decryption Setup
   =============================== */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const PRIVATE_KEY_STORAGE = "privateDerivedKey";

function base64ToBytes(base64) {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function deriveKey(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["decrypt"]
  );
}

async function decryptPrivateJson({ password, key }, encryptedPayload) {
  let cryptoKey = key;

  if (!cryptoKey) {
    const salt = base64ToBytes(encryptedPayload.salt);
    cryptoKey = await deriveKey(password, salt, encryptedPayload.iterations);
  }

  const iv = base64ToBytes(encryptedPayload.iv);
  const ciphertext = base64ToBytes(encryptedPayload.ciphertext);

  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    ciphertext
  );

  return {
    data: JSON.parse(textDecoder.decode(plaintextBuffer)),
    key: cryptoKey,
  };
}

async function exportKey(key) {
  const raw = await crypto.subtle.exportKey("raw", key);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

async function importKey(base64Key) {
  const raw = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "decrypt",
  ]);
}

function setLockedUI() {
  const trigger = document.getElementById("unlock-trigger");
  const lockBtn = document.getElementById("lock-button");
  const form = document.getElementById("unlock-form");
  if (trigger) {
    trigger.innerHTML =
      'Private bookmarks require unlocking with <a href="#" id="unlock-link">password</a> 🔒';
  }
  if (lockBtn) lockBtn.hidden = true;
  if (form) form.hidden = true;
}

function setUnlockedUI() {
  const trigger = document.getElementById("unlock-trigger");
  const lockBtn = document.getElementById("lock-button");
  const form = document.getElementById("unlock-form");
  if (trigger)
    trigger.textContent = "Private bookmarks are currently unlocked 🔓";
  if (lockBtn) lockBtn.hidden = false;
  if (form) form.hidden = true;
}

function hideUnlockForm() {
  const form = document.getElementById("unlock-form");
  const error = document.getElementById("unlock-error");
  const input = document.getElementById("password-input");
  if (form) form.hidden = true;
  if (error) error.hidden = true;
  if (input) input.value = "";
}

async function revokePrivateAccess() {
  // 1. Remove stored crypto material
  localStorage.removeItem(PRIVATE_KEY_STORAGE);
  sessionStorage.clear();

  // 2. Clear in-memory private data
  if (typeof allCategories === "object") {
    for (const key in allCategories) {
      allCategories[key] = [];
    }
  }

  // 3. Clear Service Worker caches (if any)
  if ("caches" in window) {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));
  }

  // 4. Hard reload (bypass HTTP cache)
  location.reload(true);
}

let allCategories = {};

/* 🔽 Simpler Active Link Highlighter (with click protection) 🔽 */
function initActiveObserverSimple() {
  const sidebar = document.getElementById("sidebar");

  // We'll compute sections and nav links dynamically so newly-added
  // sections (from private data) are detected immediately.
  const getSections = () =>
    Array.from(document.querySelectorAll("section[id]"));

  let isClickScrolling = false;
  let scrollTimeoutId = null;
  const SCROLL_TIMEOUT = 700;
  let hasScrolled = false; // <-- new flag
  let ticking = false;

  function activateSectionById(id) {
    if (!sidebar) return;
    const navLinks = Array.from(sidebar.querySelectorAll("a[href^='#']"));
    navLinks.forEach((link) => {
      const li = link.closest("li");
      if (!li) return;
      li.classList.toggle("active", link.hash === `#${id}`);
    });
  }

  function onScroll() {
    if (isClickScrolling) return;
    hasScrolled = true; // <-- mark that the user has scrolled

    const sections = getSections();
    const viewportCenter = window.scrollY + window.innerHeight / 2;

    // Choose the last section whose top is at-or-above the viewport center.
    // This avoids falling back to the first section when the center lies
    // in the gap between sections (which caused the flicker).
    let currentId = null;
    for (const section of sections) {
      const rect = section.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      if (top <= viewportCenter) {
        currentId = section.id;
      } else {
        // since sections are ordered, once a section's top is below the
        // center, later sections will be too — we can break early.
        break;
      }
    }

    // If none matched (e.g. viewport above first section), fall back to first
    if (!currentId && sections.length) currentId = sections[0].id;

    activateSectionById(currentId);
  }

  // Throttle scroll handling with requestAnimationFrame to avoid
  // rapid toggles which can cause the active link to flicker.
  window.addEventListener("scroll", () => {
    if (!hasScrolled) hasScrolled = true;
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(() => {
        onScroll();
        ticking = false;
      });
    }
  });
  window.addEventListener("resize", onScroll);

  // Delegated click handler on the sidebar so newly-inserted links work
  if (sidebar) {
    sidebar.addEventListener("click", (e) => {
      const a = e.target.closest && e.target.closest("a[href^='#']");
      if (!a) return;
      const li = a.closest("li");
      const allLis = Array.from(sidebar.querySelectorAll("li"));
      allLis.forEach((i) => i.classList.remove("active"));
      if (li) li.classList.add("active");
      isClickScrolling = true;
      if (scrollTimeoutId) clearTimeout(scrollTimeoutId);
      scrollTimeoutId = setTimeout(
        () => (isClickScrolling = false),
        SCROLL_TIMEOUT
      );
    });
  }
}

/* 🔽 DOM generation 🔽 */
document.addEventListener("DOMContentLoaded", () => {
  fetch("data.json")
    .then((res) => res.json())
    .then((data) => {
      allCategories = data.categories;
      const categories = data.categories || {};
      const sidebarList = document.getElementById("sidebar-list");
      const sidebarScroll = document.querySelector(".sidebar-scroll");
      const content = document.getElementById("content");

      if (!sidebarList || !content) return;

      // Templates
      const tplSidebar = document.getElementById("tpl-sidebar-item");
      const tplSection = document.getElementById("tpl-section");
      const tplCard = document.getElementById("tpl-card");

      // Generate unique alphanumeric IDs
      function generateId() {
        return "sec-" + Math.random().toString(36).substr(2, 8);
      }

      Object.entries(categories).forEach(([categoryName, items]) => {
        const match = categoryName.match(
          /^(\p{Emoji_Presentation}|\p{Emoji}\ufe0f?)?\s*(.*)$/u
        );
        const emoji = match && match[1] ? match[1] : "📂";
        const label = match && match[2] ? match[2] : categoryName;
        const sectionId = generateId();

        /* Sidebar item */
        if (tplSidebar) {
          const li = tplSidebar.content.cloneNode(true);
          const a = li.querySelector("a");
          if (a) {
            a.href = `#${sectionId}`;
            const emojiSpan = a.querySelector(".emoji");
            const labelSpan = a.querySelector(".label");
            if (emojiSpan) emojiSpan.textContent = emoji;
            if (labelSpan) labelSpan.textContent = label;
          }
          // Append dynamic sidebar items into the scrolling container when present
          (sidebarScroll || sidebarList).appendChild(li);
        }

        /* Section */
        if (tplSection) {
          const section = tplSection.content.cloneNode(true);
          const secEl = section.querySelector("section");
          secEl.id = sectionId;

          const h2 = section.querySelector("h2");
          if (h2) h2.textContent = `${emoji ? emoji + " " : ""}${label}`;

          const grid = section.querySelector(".grid-container");

          // Sort by Priority
          items
            .slice()
            .sort((a, b) => {
              const pa =
                a.Priority === "" || a.Priority === null
                  ? Infinity
                  : Number(a.Priority);
              const pb =
                b.Priority === "" || b.Priority === null
                  ? Infinity
                  : Number(b.Priority);
              return pa - pb;
            })
            .forEach((item) => {
              const card = tplCard.content.cloneNode(true);
              const a = card.querySelector("a.card");
              const h3 = card.querySelector("h3");
              const pDesc = card.querySelector("p:not(.link)");
              const pLink = card.querySelector("p.link");
              const tagsDiv = card.querySelector(".tags");

              if (a) a.href = item.URL || "#";

              // Title + favicon
              if (h3) {
                const faviconSpan = h3.querySelector(".favicon");
                h3.textContent = "";
                if (faviconSpan) h3.appendChild(faviconSpan);
                h3.appendChild(
                  document.createTextNode(item.Title || "Untitled")
                );
              }

              if (pDesc) pDesc.textContent = item.Description || "";

              if (pLink && item.URL) {
                try {
                  const parsed = new URL(item.URL);
                  pLink.textContent = parsed.hostname.replace(/^www\./i, "");
                } catch {
                  pLink.textContent = item.URL.replace(
                    /^https?:\/\/(www\.)?/i,
                    ""
                  );
                }
              }

              // Favicon
              const faviconImg = h3.querySelector(".favicon img");
              if (faviconImg) {
                if (item["Favicon Filename"]) {
                  faviconImg.src = `favicons/${item["Favicon Filename"]}`;
                  faviconImg.alt = `${item.Title || "Site"} favicon`;
                } else {
                  faviconImg.src = `favicons/default.png`;
                  faviconImg.alt = "default favicon";
                }
              }

              // Tags
              if (tagsDiv && item.Tags) {
                const tags = item.Tags.split(/[,;]+/)
                  .map((t) => t.trim())
                  .filter(Boolean);
                tags.forEach((tag) => {
                  const span = document.createElement("span");
                  span.className = "tag";
                  span.textContent = tag;
                  tagsDiv.appendChild(span);
                });
              }

              grid.appendChild(card);
            });

          content.appendChild(section);
        }
      });

      // Initialize simplified observer
      initActiveObserverSimple();

      // Sync default favicons with the current theme
      updateDefaultFavicons();

      // === PRIVATE DATA MERGING ===
      // Expose a safe global `mergePrivateData` that merges private items
      // into `allCategories` and appends them into the DOM without requiring
      // a full re-render function to exist.
      function mergePrivateData(privateData) {
        for (const [category, items] of Object.entries(
          privateData.categories || {}
        )) {
          // Normalize items to an array if it's a single object or an object map
          let normalized = [];
          if (Array.isArray(items)) normalized = items;
          else if (items && typeof items === "object")
            normalized = Object.values(items);
          else if (items != null) normalized = [items];

          if (!allCategories[category]) allCategories[category] = [];
          if (normalized.length) allCategories[category].push(...normalized);

          // Append items to existing section or create a new section
          appendItemsToCategory(category, normalized);
        }
      }

      // Helper: find or create a section for a given category name and return its grid element
      function appendItemsToCategory(categoryName, items) {
        const tplSidebar = document.getElementById("tpl-sidebar-item");
        const tplSection = document.getElementById("tpl-section");
        const tplCard = document.getElementById("tpl-card");
        const sidebarList = document.getElementById("sidebar-list");
        const content = document.getElementById("content");

        if (!tplSection || !tplCard || !content) return;

        // Derive emoji + label (same logic as initial render)
        const match = categoryName.match(
          /^(\p{Emoji_Presentation}|\p{Emoji}\ufe0f?)?\s*(.*)$/u
        );
        const emoji = match && match[1] ? match[1] : "📂";
        const label = match && match[2] ? match[2] : categoryName;

        // Try to find existing section by matching its H2 text
        let secEl = Array.from(content.querySelectorAll("section")).find(
          (sec) => {
            const h2 = sec.querySelector("h2");
            return h2 && h2.textContent.trim().includes(label);
          }
        );

        // If not found, create section + sidebar item
        if (!secEl) {
          const sectionFrag = tplSection.content.cloneNode(true);
          secEl = sectionFrag.querySelector("section");
          secEl.id = "sec-" + Math.random().toString(36).substr(2, 8);
          const h2 = secEl.querySelector("h2");
          if (h2) h2.textContent = `${label}`;

          // Append to content
          content.appendChild(sectionFrag);

          // Create sidebar item
          if (tplSidebar) {
            const liFrag = tplSidebar.content.cloneNode(true);
            const a = liFrag.querySelector("a");
            if (a) {
              a.href = `#${secEl.id}`;
              const emojiSpan = a.querySelector(".emoji");
              const labelSpan = a.querySelector(".label");
              if (emojiSpan) emojiSpan.textContent = emoji;
              if (labelSpan) labelSpan.textContent = label;
            }
            (sidebarScroll || sidebarList).appendChild(liFrag);
          }
        }

        const grid = secEl.querySelector(".grid-container");
        if (!grid) return;

        // For each item, create a card using tplCard
        items.forEach((item) => {
          const cardFrag = tplCard.content.cloneNode(true);
          const a = cardFrag.querySelector("a.card");
          const h3 = cardFrag.querySelector("h3");
          const pDesc = cardFrag.querySelector("p:not(.link)");
          const pLink = cardFrag.querySelector("p.link");

          if (a) a.href = item.URL || "#";

          if (h3) {
            const faviconSpan = h3.querySelector(".favicon");
            h3.textContent = "";
            if (faviconSpan) h3.appendChild(faviconSpan);
            h3.appendChild(document.createTextNode(item.Title || "Untitled"));
          }

          if (pDesc) pDesc.textContent = item.Description || "";

          if (pLink && item.URL) {
            try {
              const parsed = new URL(item.URL);
              pLink.textContent = parsed.hostname.replace(/^www\./i, "");
            } catch {
              pLink.textContent = item.URL.replace(/^https?:\/\/(www\.)?/i, "");
            }
          }

          // Favicon handling
          const faviconImg = h3 && h3.querySelector(".favicon img");
          if (faviconImg) {
            if (item["Favicon Filename"]) {
              faviconImg.src = `/favicons/${item["Favicon Filename"]}`;
              faviconImg.alt = `${item.Title || "Site"} favicon`;
            } else {
              faviconImg.src = `/favicons/default.png`;
              faviconImg.alt = "default favicon";
            }
          }

          grid.appendChild(cardFrag);
        });

        // Update default favicons for theme
        updateDefaultFavicons();
      }

      // Expose to global so unlock handler can call it
      window.mergePrivateData = mergePrivateData;

      // === FUZZY SEARCH SETUP ===
      let fuse = null;

      function initializeSearch(allCategories) {
        const searchIndex = [];

        // Flatten categories into searchable items
        for (const categoryName in allCategories) {
          const items = allCategories[categoryName];

          items.forEach((item) => {
            searchIndex.push({
              ...item,
              categoryName,
            });
          });
        }

        fuse = new Fuse(searchIndex, {
          keys: ["Title", "Description", "Tags", "URL", "categoryName"],
          threshold: 0.35,
          distance: 100,
        });

        console.log("Fuzzy search initialized:", searchIndex.length, "items");
      }

      /* 🔍 Initialize fuzzy search (Fuse.js) AFTER building all cards */
      initializeSearch(categories);

      /* 🔍 Initialize Search Filter AFTER content is built */
      initSearchFilter();

      function initSearchFilter() {
        const searchInput = document.getElementById("search-input");
        const clearBtn = document.getElementById("search-clear");

        if (!searchInput) {
          console.warn("Search input not found");
          return;
        }

        function filterCards() {
          const query = searchInput.value.trim();

          // Empty query = restore everything
          if (!query) {
            document
              .querySelectorAll("section")
              .forEach((sec) => (sec.style.display = ""));
            document
              .querySelectorAll(".card")
              .forEach((card) => (card.style.display = ""));
            return;
          }

          const results = fuse.search(query);

          const matched = new Set(results.map((r) => r.item.Title));

          document.querySelectorAll("section").forEach((section) => {
            let visibleCount = 0;

            section.querySelectorAll(".card").forEach((card) => {
              const title = card.querySelector("h3")?.innerText.trim();

              const show = title && matched.has(title);
              card.style.display = show ? "" : "none";
              if (show) visibleCount++;
            });

            section.style.display = visibleCount > 0 ? "" : "none";
          });
        }

        searchInput.addEventListener("input", filterCards);

        if (clearBtn) {
          clearBtn.addEventListener("click", () => {
            searchInput.value = "";
            filterCards();
            searchInput.focus();
          });
        }

        console.log("Search filter initialized");
      }
    })
    .catch((err) => {
      console.error("Error loading data.json:", err);
    });
});

/* 🔽 Dark Mode 🔽 */
let darkmode = localStorage.getItem("darkmode");
const themeSwitch = document.getElementById("theme-switch");

const enableDarkmode = () => {
  document.body.classList.add("darkmode");
  localStorage.setItem("darkmode", "active");
};

const disableDarkmode = () => {
  document.body.classList.remove("darkmode");
  localStorage.setItem("darkmode", null);
};

if (darkmode === "active") enableDarkmode();

themeSwitch.addEventListener("click", () => {
  darkmode = localStorage.getItem("darkmode");
  darkmode !== "active" ? enableDarkmode() : disableDarkmode();
  updateDefaultFavicons();
});

function updateDefaultFavicons() {
  const isDark = document.body.classList.contains("darkmode");
  const defaultIcons = document.querySelectorAll(
    '.favicon img[alt="default favicon"]'
  );

  defaultIcons.forEach((img) => {
    img.src = isDark ? "/favicons/default_dark.png" : "/favicons/default.png";
  });
}

// --- Credits overlay functionality ---
const creditsBtn = document.getElementById("credits-btn");
const creditsOverlay = document.getElementById("credits-overlay");
const closeOverlayBtn = creditsOverlay.querySelector(".close-overlay");

creditsBtn.addEventListener("click", () => {
  creditsOverlay.classList.add("show");
});

closeOverlayBtn.addEventListener("click", () => {
  creditsOverlay.classList.remove("show");
});

// Optional: close overlay when clicking outside the content
creditsOverlay.addEventListener("click", (e) => {
  if (e.target === creditsOverlay) {
    creditsOverlay.classList.remove("show");
  }
});

/* 🔽 Service Worker Registration 🔽 */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .then((reg) => console.log("✅ Service Worker registered:", reg.scope))
      .catch((err) =>
        console.log("❌ Service Worker registration failed:", err)
      );
  });
}

/* -----------------------------------------
   FUZZY SEARCH SETUP USING FUSE.JS
----------------------------------------- */

// Holds a flattened list of all bookmark items
let searchIndex = [];

// Fuse.js instance
let fuse = null;

// Call this after all JSON files are loaded
function initializeSearch(allData) {
  // Flatten categories into a single list
  searchIndex = [];

  for (const categoryName in allData) {
    const items = allData[categoryName].map((item) => ({
      ...item,
      categoryName, // keep track of the category for filtering/tag display
    }));

    searchIndex.push(...items);
  }

  // Create Fuse instance
  fuse = new Fuse(searchIndex, {
    keys: ["Title", "Description", "Tags", "URL", "categoryName"],
    threshold: 0.35, // fuzziness: 0 = strict, 1 = very fuzzy
    distance: 100,
    includeMatches: false,
  });

  console.log("Fuse.js Search initialized with", searchIndex.length, "items.");
}

/* -----------------------------------------
   SEARCH HANDLER
----------------------------------------- */

function handleSearchInput(query) {
  const trimmed = query.trim();

  if (trimmed.length === 0) {
    renderAllCards(); // your existing function (shows everything)
    return;
  }

  const results = fuse.search(trimmed);

  // Extract actual items
  const matchedItems = results.map((r) => r.item);

  renderSearchResults(matchedItems);
}

/* -----------------------------------------
   CONNECT TO SEARCH BAR INPUT
----------------------------------------- */

const searchEl = document.getElementById("search-input");
if (searchEl) {
  searchEl.addEventListener("input", function () {
    handleSearchInput(this.value);
  });
} else {
  console.warn("Search input (#search-input) not found");
}

/* -----------------------------------------
    PRIVATE BOOKMARKS UNLOCKING
----------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  const unlockTrigger = document.getElementById("unlock-trigger");
  const unlockLink = document.getElementById("unlock-link");
  const unlockForm = document.getElementById("unlock-form");
  const passwordInput = document.getElementById("password-input");
  const errorText = document.getElementById("unlock-error");
  const lockButton = document.getElementById("lock-button");

  // Don't bail if `unlock-link` isn't present yet — we'll use delegated clicks
  if (unlockLink) {
    unlockLink.addEventListener("click", (e) => {
      e.preventDefault();
      if (unlockForm) unlockForm.hidden = false;
      if (passwordInput) passwordInput.focus();
    });
  }

  unlockForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorText.hidden = true;

    try {
      const res = await fetch("data/private.json.enc");
      const encryptedPayload = await res.json();

      const { data, key } = await decryptPrivateJson(
        {
          password: passwordInput.value,
        },
        encryptedPayload
      );

      mergePrivateData(data);

      // persist derived key (best-effort). don't fail unlock if export isn't allowed
      try {
        const exportedKey = await exportKey(key);
        localStorage.setItem(PRIVATE_KEY_STORAGE, exportedKey);
      } catch (err) {
        console.warn("Could not export derived key (non-exportable)", err);
      }

      // mark unlocked for this session and hide form
      sessionStorage.setItem("privateUnlocked", "true");
      unlockForm.hidden = true;
      passwordInput.value = "";
    } catch (err) {
      console.error("Private unlock failed:", err);
      errorText.hidden = false;
    }
    // Only update the unlocked UI if we successfully unlocked
    if (!errorText.hidden) {
      // there was an error, keep the locked UI
    } else {
      setUnlockedUI();
    }

    passwordInput.value = "";
  });

  if (unlockTrigger) {
    unlockTrigger.addEventListener("click", (e) => {
      const clicked =
        e.target && e.target.closest && e.target.closest("#unlock-link");
      if (!clicked) return;
      e.preventDefault();
      if (unlockForm) unlockForm.hidden = false;
      if (errorText) errorText.hidden = true;
      if (passwordInput) passwordInput.focus();
    });
  }

  // Optional: auto-unlock on refresh (same tab)

  (async () => {
    const storedKey = localStorage.getItem(PRIVATE_KEY_STORAGE);
    if (!storedKey) {
      setLockedUI();
      return;
    }

    try {
      const res = await fetch("data/private.json.enc");
      const encryptedPayload = await res.json();

      const key = await importKey(storedKey);

      const { data } = await decryptPrivateJson({ key }, encryptedPayload);
      mergePrivateData(data);
      setUnlockedUI();
      hideUnlockForm();
    } catch (err) {
      console.warn("Stored key invalid, clearing");
      localStorage.removeItem(PRIVATE_KEY_STORAGE);
      setLockedUI();
    }
  })();

  if (lockButton) {
    lockButton.addEventListener("click", () => {
      revokePrivateAccess();
      location.reload();
    });
  }

  document.addEventListener("click", (e) => {
    if (unlockForm.hidden) return;

    const clickedInsideForm = unlockForm.contains(e.target);
    const clickedUnlockLink = e.target.id === "unlock-link";

    if (!clickedInsideForm && !clickedUnlockLink) {
      hideUnlockForm();
    }
  });

  const closeOverlayBtn = document.querySelector(".close-overlay");

  if (closeOverlayBtn) {
    closeOverlayBtn.addEventListener("click", () => {
      hideUnlockForm();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !unlockForm.hidden) {
      hideUnlockForm();
    }
  });
});
