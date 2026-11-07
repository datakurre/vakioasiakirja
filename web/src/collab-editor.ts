// Collaborative editor stub for Phase 1.
// The full Yjs CRDT synchronization, WebSocket provider, and CodeMirror binding
// will be connected in Phase 3.

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Initializes the collaborative editor shell.
 * Stubs out collaborative mode UI for Phase 1 without touching personal localStorage.
 */
export function initCollabEditor(roomId: string, _token: string) {
  document.body.classList.add("collab-mode");

  const statusEl = document.getElementById("status");
  if (statusEl) {
    statusEl.textContent = "yhteismuokkaustila (vaihe 3)";
  }

  const bannerEl = document.getElementById("viewer-banner");
  if (bannerEl) {
    bannerEl.hidden = false;
    bannerEl.style.background = "#2e7d32"; // Green/teal banner for collab
    bannerEl.textContent = `Yhteismuokkaustila (huone: ${roomId}) – Yhteiskäyttö yhdistetään vaiheessa 3.`;
  }

  const editorContainer = document.getElementById("editor");
  if (editorContainer) {
    editorContainer.innerHTML = `
      <div class="collab-stub-container">
        <div class="collab-stub-card">
          <h2>Yhteismuokkaus: ${escapeHtml(roomId)}</h2>
          <p>Tämä näkymä on varattu asiakirjan reaaliaikaiselle yhteismuokkaukselle.</p>
          <div class="collab-stub-notice">
            <p><strong>Huomautus:</strong> Yhteiskäyttöasiakirjat käsitellään erillään henkilökohtaisesta luonnoksestasi. Oma paikallinen asiakirjasi säilyy koskemattomana selaimen muistissa.</p>
            <p style="margin-top: 0.5rem; font-size: 0.85rem; color: #607d8b;">
              Yjs-pohjainen reaaliaikainen synkronointi ja jaetun muokkaimen CodeMirror-integraatio otetaan käyttöön vaiheessa 3.
            </p>
          </div>
          <div style="margin-top: 1.5rem;">
            <button id="collab-return-btn" class="textbtn" style="background: #37474f; font-size: 0.95rem; padding: 0.5rem 1.2rem;">
              Palaa henkilökohtaiseen editoriin
            </button>
          </div>
        </div>
      </div>
    `;

    document.getElementById("collab-return-btn")?.addEventListener("click", () => {
      window.location.hash = "#/";
      window.location.reload();
    });
  }
}

/**
 * Renders an informative error view when a collaborative link is malformed or missing tokens.
 * Guarantees personal localStorage is unaltered.
 */
export function renderCollabError(message: string) {
  document.body.classList.remove("show-editor", "show-preview");
  document.body.classList.add("collab-error-view");

  const bannerEl = document.getElementById("viewer-banner");
  if (bannerEl) {
    bannerEl.hidden = false;
    bannerEl.style.background = "#c62828";
    bannerEl.textContent = message;
  }

  const statusEl = document.getElementById("status");
  if (statusEl) {
    statusEl.textContent = "virheellinen linkki";
    statusEl.classList.add("error");
  }

  const appMain = document.querySelector("main");
  if (appMain) {
    for (const child of Array.from(appMain.children)) {
      (child as HTMLElement).style.display = "none";
    }

    const errorContainer = document.createElement("div");
    errorContainer.id = "collab-error-container";
    errorContainer.className = "error-card-container";
    errorContainer.setAttribute("role", "alert");
    errorContainer.innerHTML = `
      <div class="collab-error-card">
        <h2 style="margin-top: 0; color: #b71c1c;">Virheellinen muokkauslinkki</h2>
        <p style="margin: 1rem 0; font-size: 1rem; color: #37474f;">${escapeHtml(message)}</p>
        <p style="color: #607d8b; font-size: 0.9rem; line-height: 1.4;">
          Yhteismuokkaus vaatii toimivan huonetunnisteen sekä salaisen valtuutusavaimen.
          Tarkista linkki tai palaa henkilökohtaiseen editoriin.
        </p>
        <div style="margin-top: 1.5rem;">
          <button id="return-personal-btn" class="textbtn" style="background: #1565c0; font-size: 0.95rem; padding: 0.6rem 1.2rem;">
            Palaa henkilökohtaiseen editoriin
          </button>
        </div>
      </div>
    `;
    appMain.appendChild(errorContainer);

    document.getElementById("return-personal-btn")?.addEventListener("click", () => {
      window.location.hash = "#/";
      window.location.reload();
    });
  }
}
