let tournament;
let matchById;

function getInitials(name) {
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1
    ? parts.slice(0, 3).map((part) => part[0]).join("")
    : name.replace(/[^a-z0-9]/gi, "").slice(0, 3)
  ).toUpperCase();
}

function renderOpeningMatch() {
  const match = matchById.get(tournament.nextMatchId);
  if (!match) return;

  document.querySelector("#tournament-name").textContent = tournament.name;
  document.querySelector('[data-next-player="1"]').textContent = match.player1;
  document.querySelector('[data-next-player="2"]').textContent = match.player2;
  document.querySelector("#player-count").textContent = String(tournament.players.length).padStart(2, "0");
  document.querySelector("#match-count").textContent = String(tournament.matches.length).padStart(2, "0");
}

function renderPlayers() {
  const grid = document.querySelector("#players-grid");
  grid.innerHTML = tournament.players.map((player, index) => `
    <article class="player-card">
      <span class="player-card-number">${String(index + 1).padStart(2, "0")}</span>
      <span class="player-avatar" aria-hidden="true">${getInitials(player)}</span>
      <span class="player-card-name">${player}</span>
    </article>
  `).join("");
}

function renderBracket() {
  const board = document.querySelector("#bracket-board");
  const rounds = [
    {
      title: "ROUND OF 16",
      matches: tournament.matches,
      positions: [1, 3, 5, 7, 9, 11, 13, 15],
      slots: tournament.matches.map((match) => match.id)
    },
    { title: "QUARTER-FINALS", positions: [2, 6, 10, 14], slots: ["QF1", "QF2", "QF3", "QF4"] },
    { title: "SEMI-FINALS", positions: [4, 12], slots: ["SF1", "SF2"] },
    { title: "FINAL", positions: [8], slots: ["F"] }
  ];

  board.innerHTML = rounds.map((round, roundIndex) => {
    const matchCount = round.positions.length;
    const countLabel = round.matches
      ? `${matchCount} MATCHES`
      : `${matchCount} OPEN ${matchCount === 1 ? "SLOT" : "SLOTS"}`;

    return `
      <section class="bracket-round ${roundIndex > 0 ? "bracket-round--target" : ""} ${roundIndex < rounds.length - 1 ? "bracket-round--source" : ""}" aria-label="${round.title}">
        <header class="bracket-round-header"><h3>${round.title}</h3><span>${countLabel}</span></header>
        <div class="bracket-stage">
          ${round.positions.map((position, index) => {
            const match = round.matches?.[index];
            const connectorSpan = round.positions[index + 1] - position;
            const players = [match?.player1, match?.player2].map((player) => `
              <div class="bracket-team ${player ? "" : "is-empty"}">
                <span>${player || "—"}</span>${player ? `<small>${getInitials(player)}</small>` : ""}
              </div>
            `).join("");

            return `
              <article class="bracket-match ${match ? "is-confirmed" : "is-open"}" style="--slot:${position};" aria-label="${match ? `${match.player1} versus ${match.player2}` : `${round.title}, place en attente`}">
                <span class="bracket-match-id">${round.slots[index]}</span>
                ${players}
                <span class="bracket-versus">VS</span>
                ${roundIndex < rounds.length - 1 && index % 2 === 0
                  ? `<span class="bracket-join" style="--connector-height:${connectorSpan * 42}px;" aria-hidden="true"></span>`
                  : ""}
              </article>
            `;
          }).join("")}
        </div>
      </section>
    `;
  }).join("");
}

function renderMatches(filter = "tous") {
  const list = document.querySelector("#matches-list");
  const matches = filter === "tous"
    ? tournament.matches
    : tournament.matches.filter((match) => match.round === filter);

  list.innerHTML = matches.map((match) => `
    <article class="match-row">
      <span class="match-row-id">${match.id}</span>
      <span class="match-row-round">${match.round}</span>
      <div class="match-row-contest"><strong>${match.player1}</strong><span>VS</span><strong>${match.player2}</strong></div>
    </article>
  `).join("");
}

function setupFilters() {
  document.querySelectorAll(".filter-button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".filter-button").forEach((item) => {
        const selected = item === button;
        item.classList.toggle("selected", selected);
        item.setAttribute("aria-pressed", String(selected));
      });
      renderMatches(button.dataset.filter);
    });
  });
}

function setupMobileNavigation() {
  const toggle = document.querySelector(".menu-toggle");
  const nav = document.querySelector("#main-nav");

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    toggle.setAttribute("aria-label", expanded ? "Ouvrir le menu" : "Fermer le menu");
    nav.classList.toggle("is-open", !expanded);
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Ouvrir le menu");
    });
  });
}

function setupSectionNavigation() {
  const links = [...document.querySelectorAll(".nav-link")];
  const observer = new IntersectionObserver((entries) => {
    const visibleSection = entries
      .filter((entry) => entry.isIntersecting)
      .sort((first, second) => first.boundingClientRect.top - second.boundingClientRect.top)[0]?.target.id;

    if (!visibleSection) return;

    links.forEach((link) => {
      const active = link.getAttribute("href") === `#${visibleSection}`;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  }, { rootMargin: "-20% 0px -70% 0px" });

  document.querySelectorAll("main section[id]").forEach((section) => observer.observe(section));
}

async function initializeTournament() {
  const response = await fetch("/api/tournament", { cache: "no-store" });
  if (!response.ok) throw new Error("Tournament data is unavailable.");
  tournament = await response.json();
  matchById = new Map(tournament.matches.map((match) => [match.id, match]));
  renderOpeningMatch();
  renderPlayers();
  renderBracket();
  renderMatches();
  setupFilters();
  setupMobileNavigation();
  setupSectionNavigation();
}

initializeTournament().catch(() => {
  const message = document.querySelector("#site-error");
  message.textContent = "Le serveur du tournoi est indisponible. Démarrez-le avec npm start pour charger les dernières données.";
  message.hidden = false;
});