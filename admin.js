const authView = document.querySelector("#auth-view");
const editorView = document.querySelector("#editor-view");
const authForm = document.querySelector("#auth-form");
const authMessage = document.querySelector("#auth-message");
const authNote = document.querySelector("#auth-note");
const passwordInput = document.querySelector("#admin-password");
const passwordConfirmField = document.querySelector("#password-confirm-field");
const passwordConfirmInput = document.querySelector("#admin-password-confirm");
const authSubmit = document.querySelector("#auth-submit");
const saveMessage = document.querySelector("#save-message");
const saveButton = document.querySelector("#save-button");
const playerEditor = document.querySelector("#players-editor");
const matchEditor = document.querySelector("#matches-editor");
let currentTournament;
let setupAvailable = false;
let adminConfigured = false;

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "La requête n'a pas abouti.");
  return result;
}

function setAuthMessage(message, isError = false) {
  authMessage.textContent = message;
  authMessage.classList.toggle("is-error", isError);
}

function showAuthentication() {
  authView.hidden = false;
  editorView.hidden = true;
  passwordInput.value = "";
  passwordConfirmInput.value = "";
  const setupMode = setupAvailable && !adminConfigured;
  document.querySelector("#auth-heading").textContent = setupMode ? "Créer l'accès administrateur" : "Connexion administrateur";
  document.querySelector("#password-label").textContent = setupMode ? "Créer un mot de passe (12 caractères minimum)" : "Mot de passe";
  passwordInput.autocomplete = setupMode ? "new-password" : "current-password";
  passwordInput.minLength = setupMode ? 12 : 1;
  passwordConfirmField.hidden = !setupMode;
  passwordConfirmInput.required = setupMode;
  authSubmit.innerHTML = setupMode
    ? 'Créer mon accès <span aria-hidden="true">↗</span>'
    : 'Se connecter <span aria-hidden="true">↗</span>';
  authSubmit.disabled = !adminConfigured && !setupAvailable;
  authNote.textContent = !adminConfigured && !setupAvailable
    ? "Configurez ADMIN_PASSWORD (12 caractères minimum) dans l'environnement de votre hébergeur pour activer l'administration."
    : "Vos informations ne sont jamais affichées sur le site public.";
  if (authSubmit.disabled) setAuthMessage("L'accès administrateur n'est pas encore configuré.", true);
}

function createPlayerInput(player, index) {
  const label = document.createElement("label");
  label.className = "admin-player-field";
  const number = document.createElement("span");
  number.textContent = String(index + 1).padStart(2, "0");
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 32;
  input.required = true;
  input.value = player;
  input.dataset.playerIndex = String(index);
  input.setAttribute("aria-label", `Nom du joueur ${index + 1}`);
  label.append(number, input);
  return label;
}

function createPlayerSelect(match, index, side, players) {
  const select = document.createElement("select");
  const selectedName = match[side === 1 ? "player1" : "player2"];
  select.dataset.matchIndex = String(index);
  select.dataset.side = String(side);
  select.setAttribute("aria-label", `Match ${index + 1}, joueur ${side}`);
  players.forEach((name, playerIndex) => {
    const option = document.createElement("option");
    option.value = String(playerIndex);
    option.textContent = name;
    option.selected = name === selectedName;
    select.append(option);
  });
  return select;
}

function createMatchCard(match, index, players) {
  const card = document.createElement("article");
  card.className = "admin-match-card";
  const id = document.createElement("span");
  id.className = "admin-match-id";
  id.textContent = match.id;
  const first = createPlayerSelect(match, index, 1, players);
  const versus = document.createElement("span");
  versus.className = "admin-versus";
  versus.textContent = "VS";
  const second = createPlayerSelect(match, index, 2, players);
  card.append(id, first, versus, second);
  return card;
}

function refreshPlayerOptions() {
  const names = [...playerEditor.querySelectorAll("input[data-player-index]")].map((input) => input.value);
  matchEditor.querySelectorAll("select").forEach((select) => {
    const selectedIndex = select.value;
    [...select.options].forEach((option, index) => {
      option.textContent = names[index];
    });
    select.value = selectedIndex;
  });
}

function renderEditor(data) {
  currentTournament = data;
  authView.hidden = true;
  editorView.hidden = false;
  document.querySelector("#tournament-name-input").value = data.name;
  playerEditor.replaceChildren(...data.players.map(createPlayerInput));
  matchEditor.replaceChildren(...data.matches.map((match, index) => createMatchCard(match, index, data.players)));
  saveMessage.textContent = "";
}

async function loadEditor() {
  const data = await requestJson("/api/tournament");
  renderEditor(data);
}

async function initialize() {
  try {
    const status = await requestJson("/api/admin/status");
    setupAvailable = status.setupAvailable;
    adminConfigured = status.adminConfigured;
    if (status.authenticated) await loadEditor();
    else showAuthentication();
  } catch {
    authView.hidden = false;
    editorView.hidden = true;
    authSubmit.disabled = true;
    setAuthMessage("Impossible de joindre le serveur du tournoi. Démarrez-le avec npm start.", true);
  }
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const setupMode = setupAvailable && !adminConfigured;
  if (setupMode && passwordInput.value !== passwordConfirmInput.value) {
    setAuthMessage("Les deux mots de passe ne correspondent pas.", true);
    return;
  }

  authSubmit.disabled = true;
  setAuthMessage("");
  try {
    await requestJson(setupMode ? "/api/admin/setup" : "/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: passwordInput.value })
    });
    adminConfigured = true;
    await loadEditor();
  } catch (error) {
    setAuthMessage(error.message, true);
    authSubmit.disabled = !adminConfigured && !setupAvailable;
  }
});

document.querySelector("#tournament-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const players = [...playerEditor.querySelectorAll("input[data-player-index]")].map((input) => input.value.trim());
  const matches = [...matchEditor.querySelectorAll(".admin-match-card")].map((card) => ({
    player1Index: Number(card.querySelector('select[data-side="1"]').value),
    player2Index: Number(card.querySelector('select[data-side="2"]').value)
  }));
  const usedPlayers = matches.flatMap((match) => [match.player1Index, match.player2Index]);
  if (new Set(players.map((name) => name.toLocaleLowerCase())).size !== 16) {
playerEditor.addEventListener("input", refreshPlayerOptions);

    saveMessage.textContent = "Chaque joueur doit avoir un nom unique.";
    saveMessage.classList.add("is-error");
    return;
  }
  if (new Set(usedPlayers).size !== 16) {
    saveMessage.textContent = "Chaque joueur doit apparaître dans une seule affiche.";
    saveMessage.classList.add("is-error");
    return;
  }

  saveButton.disabled = true;
  saveMessage.classList.remove("is-error");
  saveMessage.textContent = "Enregistrement…";
  try {
    const result = await requestJson("/api/admin/tournament", {
      method: "POST",
      body: JSON.stringify({
        name: document.querySelector("#tournament-name-input").value,
        players,
        matches
      })
    });
    renderEditor(result.tournament);
    saveMessage.textContent = "Modifications enregistrées. Le site public est à jour.";
  } catch (error) {
    saveMessage.textContent = error.message;
    saveMessage.classList.add("is-error");
  } finally {
    saveButton.disabled = false;
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await requestJson("/api/admin/logout", { method: "POST", body: "{}" });
    showAuthentication();
  } catch (error) {
    saveMessage.textContent = error.message;
    saveMessage.classList.add("is-error");
  }
});

initialize();