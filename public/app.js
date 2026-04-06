const form          = document.getElementById("cv-form");
const formStatus    = document.getElementById("form-status");
const resultsRoot   = document.getElementById("results-root");
const loadingOverlay = document.getElementById("loading-overlay");

// Estado de intereses (ordenado por prioridad, máx. 3)
let selectedInterests = [];
let currentRawDegree  = "";

// Indicador global: si el usuario cargó un CV (se setea en renderResults)
let currentHasCv = false;

// Indicador global: estudiante en año no final (cambia el copy de resultados)
let currentIsStudentNotLastYear = false;

// Intención del usuario (step 0)
let userIntentMode = "guided";

// ------------------------------------------------------------------ //
// Helpers
// ------------------------------------------------------------------ //

/**
 * Normaliza un string: quita tildes, minúsculas, trim.
 * Igual que la función del backend para que el matching sea consistente.
 */
function normalizeStr(str) {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Intenta mapear lo que el usuario escribió a la carrera canónica más cercana.
 * Estrategia:
 *   0. Alias exacto
 *   1. Coincidencia exacta en lista canónica
 *   2. Alias por substring
 *   3. La carrera canónica contiene lo que escribió el usuario
 *   4. Lo que escribió el usuario contiene la carrera canónica
 * Si no hay match, devuelve el valor original con capitalización limpia.
 */
function normalizeDegree(raw) {
  if (!raw) return raw;
  const q = normalizeStr(raw);

  // 0. Alias exacto
  if (CAREER_ALIASES[q]) return CAREER_ALIASES[q];

  // 1. Exacto en lista canónica
  const exact = CARRERAS.find((c) => normalizeStr(c) === q);
  if (exact) return exact;

  // 2. Alias por substring (la clave del alias está contenida en lo que escribió)
  const aliasKey = Object.keys(CAREER_ALIASES).find(
    (k) => k.length >= 4 && q.includes(k)
  );
  if (aliasKey) return CAREER_ALIASES[aliasKey];

  // 3. La carrera canónica contiene lo que escribió — prioriza la más corta
  const contains = CARRERAS
    .filter((c) => normalizeStr(c).includes(q))
    .sort((a, b) => a.length - b.length);
  if (contains.length) return contains[0];

  // 4. Lo que escribió contiene la carrera canónica — prioriza la más larga (más específica)
  const contained = CARRERAS
    .filter((c) => q.includes(normalizeStr(c)))
    .sort((a, b) => b.length - a.length);
  if (contained.length) return contained[0];

  // Sin match: devolver el raw con primera letra en mayúscula
  return raw.trim().replace(/^\w/, (c) => c.toUpperCase());
}

/** Devuelve los valores de todos los checkboxes marcados con ese name */
function getCheckedValues(name) {
  return Array.from(
    document.querySelectorAll(`input[name="${name}"]:checked`)
  ).map((el) => el.value);
}

/** Muestra u oculta el overlay de carga */
function setLoading(active) {
  if (!loadingOverlay) return;
  loadingOverlay.classList.toggle("active", active);
}

/**
 * Devuelve la clase CSS del score badge según el puntaje.
 * >=65 → verde (strong match), >=40 → amarillo (stretch), <40 → gris
 */
function scoreBadgeClass(score) {
  if (score >= 65) return "score-high";
  if (score >= 40) return "score-mid";
  return "score-low";
}

// ------------------------------------------------------------------ //
// Formulario de upload
// ------------------------------------------------------------------ //

async function handleFormSubmit(event) {
  event.preventDefault();
  if (!form) return;

  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  formStatus.textContent = "";
  setLoading(true);

  try {
    // Carrera: usa autocomplete si hay valor; si no, usa el campo libre
    const rawDegree = document.getElementById("degree").value ||
                      document.getElementById("degree_other").value || "";
    const normalizedDegree = normalizeDegree(rawDegree);

    // Intereses con peso según orden de selección (primero = peso 3)
    const weightedInterests = selectedInterests.map((val, idx) => ({
      value:  val,
      weight: 3 - idx
    }));

    const formData = new FormData();
    formData.append("raw_degree",      rawDegree);
    formData.append("degree",          normalizedDegree);
    formData.append("academicStatus",  document.getElementById("academicStatus").value);
    formData.append("isLastYear",      document.getElementById("isLastYear")?.value || "");
    formData.append("city",            document.getElementById("city")?.value || "");
    formData.append("desiredModality", JSON.stringify(getCheckedValues("desiredModality")));
    formData.append("areasOfInterest", JSON.stringify(weightedInterests));
    formData.append("user_intent_mode", userIntentMode);

    // Explore flow data
    if (userIntentMode === "explore") {
      formData.append("discovery_mode", "true");
      formData.append("task_preferences",   JSON.stringify(exploreTaskPrefs));
      formData.append("avoid_preferences",  JSON.stringify(exploreAvoid));
      formData.append("motivation_preferences", JSON.stringify(exploreMotivations));
      formData.append("areas_interest",     JSON.stringify(exploreAreasInterest));
      formData.append("areas_avoid",        JSON.stringify(exploreAreasAvoid));
      formData.append("extra_motivation_text", document.getElementById("extra-motivation")?.value || "");
    }

    const fileInput = document.getElementById("cv");
    if (fileInput?.files[0]) {
      formData.append("cv", fileInput.files[0]);
    }

    const response = await fetch("/api/analyze", { method: "POST", body: formData });
    const data     = await response.json();

    if (!response.ok) throw new Error(data.error || "No se pudo analizar el CV.");

    sessionStorage.setItem("laboraResults", JSON.stringify(data));
    sessionStorage.setItem("laboraCvRawText", data.cvRawText || "");
    // Persistir modo y señales explore para la página de resultados
    sessionStorage.setItem("laboraUserIntentMode", userIntentMode);
    if (userIntentMode === "explore") {
      sessionStorage.setItem("laboraExploreTaskPrefs",    JSON.stringify(exploreTaskPrefs));
      sessionStorage.setItem("laboraExploreAvoid",        JSON.stringify(exploreAvoid));
      sessionStorage.setItem("laboraExploreMotivations",  JSON.stringify(exploreMotivations));
      sessionStorage.setItem("laboraExploreAreasInterest",JSON.stringify(exploreAreasInterest));
      sessionStorage.setItem("laboraExploreAreasAvoid",   JSON.stringify(exploreAreasAvoid));
    }
    // Guardar si es estudiante en año no final (para ajustar copy de resultados)
    const academicStatusVal = document.getElementById("academicStatus")?.value || "";
    const isLastYearVal     = document.getElementById("isLastYear")?.value || "";
    sessionStorage.setItem("laboraIsStudentNotLastYear",
      academicStatusVal === "estudiante" && isLastYearVal === "false" ? "true" : "false"
    );
    window.location.href = "/results.html";
  } catch (error) {
    setLoading(false);
    formStatus.textContent = error.message;
    submitButton.disabled = false;
  }
}

// ------------------------------------------------------------------ //
// Página de resultados
// ------------------------------------------------------------------ //

/**
 * Genera un resumen interpretativo del perfil (1 frase).
 * Evita el genérico "Perfil junior con formación en..."
 */
function buildProfileHook(profile) {
  const degree = profile.degree || "";
  const tools  = profile.tools || [];
  const areas  = profile.areas_of_interest || [];
  const primaryArea = areas.length > 0
    ? (typeof areas[0] === "object" ? areas[0].value : areas[0])
    : "";

  // Mapeo de área a frase humana
  const areaDescriptors = {
    finanzas:         "en lo que respondiste aparece una preferencia por analizar información, trabajar con criterio y moverte en entornos más estructurados",
    analitica:        "en lo que respondiste aparece una preferencia por trabajar con datos, encontrar patrones y apoyar decisiones con información",
    comercial:        "en lo que respondiste aparece una preferencia por relacionarte con clientes, generar negocio y trabajar orientado a resultados",
    operaciones:      "en lo que respondiste aparece una preferencia por ordenar procesos, coordinar equipos y hacer que las cosas funcionen",
    personas:         "en lo que respondiste aparece una preferencia por trabajar con personas, acompañar equipos y generar cultura",
    tecnologia:       "en lo que respondiste aparece una preferencia por resolver problemas con lógica, construir soluciones y aprender herramientas técnicas",
    marketing:        "en lo que respondiste aparece una preferencia por comunicar, posicionar marcas y trabajar en canales digitales",
    proyectos:        "en lo que respondiste aparece una preferencia por planificar, coordinar iniciativas y hacer que las cosas avancen",
    "control-gestion":"en lo que respondiste aparece una preferencia por el control, el seguimiento de metas y los reportes de gestión"
  };

  const descriptor = areaDescriptors[primaryArea] || "en lo que respondiste aparece una base para distintos caminos dentro de Ingeniería Comercial";

  return `Por lo que nos contaste, ${descriptor}. Eso hace que ciertos caminos hoy se vean más naturales para ti que otros.`;
}

/**
 * Limpia fortalezas: máximo 3, sin redundancias obvias.
 */
function cleanStrengths(strengths) {
  if (!strengths || strengths.length === 0) return ["Tu formación te da una base inicial para explorar estos caminos."];
  // Deduplicar conceptos similares (normalizar y comparar primeras 3 palabras)
  const seen = new Set();
  const clean = [];
  for (const s of strengths) {
    const key = s.toLowerCase().split(" ").slice(0, 3).join(" ");
    if (!seen.has(key)) {
      seen.add(key);
      clean.push(s);
    }
    if (clean.length >= 3) break;
  }
  return clean;
}

/** Capitaliza herramientas y acrónimos conocidos para display */
function displayTool(t) {
  const KNOWN_CAPS = {
    "sql": "SQL", "sap": "SAP", "vba": "VBA", "crm": "CRM",
    "erp": "ERP", "kpi": "KPI", "api": "API", "bi": "BI",
    "spss": "SPSS", "stata": "Stata", "matlab": "MATLAB",
    "dbt": "dbt", "git": "Git", "github": "GitHub",
    "r": "R", "seo": "SEO", "sem": "SEM",
    "excel": "Excel", "word": "Word", "powerpoint": "PowerPoint",
    "python": "Python", "javascript": "JavaScript", "typescript": "TypeScript",
    "java": "Java", "php": "PHP", "html": "HTML", "css": "CSS",
    "tensorflow": "TensorFlow", "pytorch": "PyTorch", "langchain": "LangChain",
    "figma": "Figma", "notion": "Notion", "jira": "Jira",
    "hubspot": "HubSpot", "salesforce": "Salesforce",
    "trello": "Trello", "asana": "Asana", "zapier": "Zapier",
    "tableau": "Tableau", "looker": "Looker",
    "qgis": "QGIS", "arcgis": "ArcGIS", "autocad": "AutoCAD",
  };
  const norm = t.toLowerCase().trim();
  if (KNOWN_CAPS[norm]) return KNOWN_CAPS[norm];
  // Multi-word: capitalizar cada palabra
  return t.split(" ").map(w => {
    const wn = w.toLowerCase();
    return KNOWN_CAPS[wn] || (w.charAt(0).toUpperCase() + w.slice(1));
  }).join(" ");
}

/**
 * Genera texto interpretativo para la página de resultados del flujo explore.
 * Lee señales del sessionStorage (guardadas en submit).
 */
function buildExploreResultsHook() {
  const tasks    = JSON.parse(sessionStorage.getItem("laboraExploreTaskPrefs")     || "[]");
  const avoid    = JSON.parse(sessionStorage.getItem("laboraExploreAvoid")         || "[]");
  const motivs   = JSON.parse(sessionStorage.getItem("laboraExploreMotivations")   || "[]");

  const isAnalytic  = tasks.includes("analizar-datos") || tasks.includes("resolver-problemas");
  const isOrderly   = tasks.includes("organizar-procesos");
  const isStrategic = tasks.includes("crear-estrategias");
  const isPeople    = tasks.includes("trabajar-personas");

  const avoidsClients = avoid.includes("atencion-clientes") || avoid.includes("ventas-metas");
  const avoidsTerrain = avoid.includes("trabajo-terreno");
  const avoidsCompete = avoid.includes("ambientes-competitivos");

  const wantsLearning  = motivs.includes("aprender");
  const wantsGrowth    = motivs.includes("crecer-rapido");
  const wantsStability = motivs.includes("estabilidad");
  const wantsImpact    = motivs.includes("impacto");

  let primary = "";
  if (isAnalytic && avoidsClients && avoidsTerrain) {
    primary = "Se ve una afinidad por roles analíticos y de oficina, más que en trabajos con contacto constante con clientes o con mucho movimiento en terreno.";
  } else if (isAnalytic && avoidsClients) {
    primary = "Se ve una afinidad por roles más analíticos y estructurados, donde puedas trabajar con información y criterio, más que en dinámicas de contacto constante con clientes.";
  } else if (isAnalytic && avoidsTerrain) {
    primary = "Se ve una preferencia por roles de análisis y trabajo estructurado, más que por roles con mucho movimiento o trabajo fuera de oficina.";
  } else if (isAnalytic && isStrategic) {
    primary = "Hay señales de un perfil que mezcla análisis con visión: leer información, encontrar sentido y usarla para decidir mejor, más que ejecutar desde un guión fijo.";
  } else if (isAnalytic) {
    primary = "Se ve una preferencia por roles donde puedas trabajar con información, resolver problemas concretos y comunicar hallazgos que sirvan.";
  } else if (isPeople && !avoidsClients) {
    primary = "Se ve una preferencia por roles donde las personas estén en el centro: trabajar en equipo, acompañar procesos y construir desde las relaciones.";
  } else if (isOrderly && !isStrategic) {
    primary = "Hay señales de una preferencia por roles operativos: coordinar, ordenar procesos y asegurarse de que las cosas funcionen bien.";
  } else if (isStrategic) {
    primary = "Hay señales de una preferencia por roles donde puedas pensar el negocio, proponer iniciativas y tomar decisiones con más visión.";
  } else {
    primary = "Con lo que nos contaste, se ven señales de un perfil que puede moverse bien en roles analíticos, de coordinación o de trabajo en equipo.";
  }

  let extra = "";
  if (wantsLearning) {
    extra = " La búsqueda de aprendizaje continuo orienta a roles con curva activa y entornos donde se aprende haciendo.";
  } else if (wantsGrowth) {
    extra = " El interés en crecer rápido orienta a entornos con más responsabilidad desde temprano.";
  } else if (wantsStability) {
    extra = " La búsqueda de estabilidad orienta más a empresas con procesos definidos y culturas establecidas.";
  } else if (wantsImpact) {
    extra = " El interés en impacto orienta a organizaciones donde el trabajo tiene un efecto visible más allá de los resultados comerciales.";
  }

  return primary + extra;
}

/**
 * Obtiene el contenido de práctica para un rol (ROLE_PRACTICE_CONTENT o fallback por área).
 */
function getPracticeContent(role) {
  const content = ROLE_PRACTICE_CONTENT[role.title];
  if (content) return content;
  const area = role.area || role.category || "";
  const areaText = ROLE_AREA_EXPECTATIONS[area] || "";
  return {
    practice:    areaText || `En este rol el trabajo está orientado a ${(area || "esta área").toLowerCase()} y combina análisis, coordinación y comunicación con distintos equipos.`,
    howItLooks:  "Las dinámicas varían bastante entre empresas. Vale la pena preguntar en entrevistas cómo se ve este rol en la práctica — el título puede ser el mismo pero el día a día cambia mucho según el tamaño y sector de la empresa."
  };
}

function renderResults() {
  if (!resultsRoot) return;

  const raw = sessionStorage.getItem("laboraResults");

  if (!raw) {
    resultsRoot.innerHTML = `
      <div class="card">
        <h2>No hay resultados cargados</h2>
        <p class="muted">Primero debes subir un CV para ver el análisis.</p>
        <a class="button primary" href="/upload.html">Ir a subir CV</a>
      </div>`;
    return;
  }

  const data    = JSON.parse(raw);
  const profile = data.profile || {};
  const matches = data.matches || {};

  currentHasCv = (profile.raw_text_length || 0) > 0;
  currentIsStudentNotLastYear = sessionStorage.getItem("laboraIsStudentNotLastYear") === "true";

  const strongMatches  = matches.strong_matches  || [];
  const stretchMatches = matches.stretch_matches || [];
  const allRoles       = [...strongMatches, ...stretchMatches];
  const totalMatches   = allRoles.length;
  const detectedArea   = matches.detected_area   || null;
  const contextMsg     = matches.context_message || null;

  // 1) Resumen interpretativo
  const profileHook = buildProfileHook(profile);

  // 2) Herramientas + Idiomas separados
  const toolsTags = (profile.tools || []).length > 0
    ? (profile.tools || []).map(t => `<span class="tag">${displayTool(t)}</span>`).join("")
    : "<span class='muted'>No detectadas</span>";

  const languages = profile.languages || [];
  const langLevels = profile.language_levels || {};
  const langTags = languages.length > 0
    ? languages.map(l => {
        const level = langLevels[l.toLowerCase()] || langLevels[l] || "";
        return `<span class="tag">${l}${level ? ` · ${level}` : ""}</span>`;
      }).join("")
    : "<span class='muted'>No detectados</span>";

  // 3) Fortalezas limpias (máx 3)
  const strengths = cleanStrengths(profile.strengths);

  // 4) Bloque de dirección principal
  // detectedArea.label puede venir como clave raw (ej: "clinica-psico") si el backend
  // no tiene entrada en AREA_LABELS — usar INTEREST_REGISTRY como fallback de traducción.
  const areaDisplayLabel = INTEREST_REGISTRY[detectedArea?.label] || detectedArea?.label;
  const areaBlock = detectedArea ? `
    <section class="card area-insight">
      <p class="area-insight-statement">Por lo que elegiste, <strong>${areaDisplayLabel}</strong> aparece como uno de los caminos más naturales para ti hoy.</p>
      <p class="muted" style="margin-top:4px;">De todas las opciones, estas son las que hoy se ven más cercanas a lo que nos contaste.</p>
      ${detectedArea.subareas.length > 0 ? `
        <div class="area-insight-subareas">
          <span class="area-insight-sublabel">Caminos dentro de esta opción</span>
          <div class="inline-tags">
            ${detectedArea.subareas.map((s) => `<span class="tag">${s}</span>`).join("")}
          </div>
        </div>` : ""}
    </section>` : "";

  // 5) Detectar modo y renderizar según flujo
  const isExploreMode = sessionStorage.getItem("laboraUserIntentMode") === "explore";
  const userType = matches.user_type || "aligned";

  const noResultsMsg = `
    <div class="card no-results-card">
      <p class="no-results-title">No encontramos opciones claras con lo que elegiste.</p>
      <p class="muted">Prueba seleccionando otros caminos o cambia la modalidad para ver más.</p>
    </div>`;

  const contextBanner = contextMsg ? `
    <section class="card context-banner">
      <p class="context-headline">${contextMsg.headline}</p>
      <p class="muted">${contextMsg.subtext}</p>
    </section>` : "";

  if (isExploreMode) {
    // ── FLUJO EXPLORE ─────────────────────────────────────────────────
    const exploreHook = buildExploreResultsHook();

    let rolesSection = "";
    if (totalMatches > 0) {
      const primaryRole    = allRoles[0];
      const secondaryRoles = allRoles.slice(1, 4);

      rolesSection = `
        <section class="card">
          <h2 class="section-title">Tu mejor punto de partida hoy</h2>
          <p class="muted" style="margin-bottom:16px;">De todo lo que vemos, esta es la opción que hoy se ve más alineada con lo que nos contaste.</p>
          <div class="role-list">
            ${renderRoleCard(primaryRole, true)}
          </div>
        </section>

        ${secondaryRoles.length > 0 ? `
        <section class="card">
          <h2 class="section-title">Otros caminos que también podrían calzar contigo</h2>
          <p class="muted" style="margin-bottom:16px;">Opciones cercanas que también podrías explorar, aunque hoy se ven un poco menos directas que la principal.</p>
          <div class="role-list">
            ${secondaryRoles.map(r => renderCompactRoleCard(r, true)).join("")}
          </div>
        </section>` : ""}`;
    }

    resultsRoot.innerHTML = `
      <section class="card">
        <h2 class="section-title">Esto es lo que vemos en ti</h2>
        <p class="profile-hook">${exploreHook}</p>
        ${currentHasCv && strengths.length > 0 ? `
        <div style="margin-top:16px;">
          <ul class="list">${strengths.map(s => `<li>${s}</li>`).join("")}</ul>
        </div>` : ""}
      </section>

      ${contextBanner}
      ${totalMatches === 0 ? noResultsMsg : rolesSection}`;

  } else {
    // ── FLUJO GUIDED ──────────────────────────────────────────────────
    let rolesSection = "";
    if (totalMatches > 0) {
      const primaryRole    = allRoles[0];
      const secondaryRoles = allRoles.slice(1, 4);

      rolesSection = `
        <section class="card">
          <h2 class="section-title">${currentIsStudentNotLastYear
            ? "Estos son los caminos hacia los que puedes orientar tu formación"
            : "Estas son las opciones que hoy se ven más cercanas a ti"}</h2>
          <p class="muted" style="margin-bottom:16px;">De todas las opciones, esta es la que hoy se ve más cercana a lo que nos contaste.</p>
          <div class="role-list">
            ${renderRoleCard(primaryRole, false)}
          </div>
        </section>

        ${secondaryRoles.length > 0 ? `
        <section class="card">
          <h2 class="section-title">También aparecen caminos cercanos</h2>
          <p class="muted" style="margin-bottom:16px;">Opciones que también podrías considerar, aunque hoy se ven un poco menos directas que la principal.</p>
          <div class="role-list">
            ${secondaryRoles.map(r => renderCompactRoleCard(r, false)).join("")}
          </div>
        </section>` : ""}`;
    }

    const profileColumns = currentHasCv ? `
        <div class="grid three" style="margin-top:16px;">
          <div>
            <h3>Herramientas</h3>
            <div class="inline-tags">${toolsTags}</div>
          </div>
          <div>
            <h3>Idiomas</h3>
            <div class="inline-tags">${langTags}</div>
          </div>
          <div>
            <h3>Fortalezas</h3>
            <ul class="list">${strengths.map(s => `<li>${s}</li>`).join("")}</ul>
          </div>
        </div>` : (strengths.length > 0 ? `
        <div style="margin-top:16px;">
          <h3>Fortalezas</h3>
          <ul class="list">${strengths.map(s => `<li>${s}</li>`).join("")}</ul>
        </div>` : "");

    resultsRoot.innerHTML = `
      <section class="card">
        <h2 class="section-title">
          ${profile.name ? `Hola, ${profile.name}` : "Lo que se alcanza a ver con lo que nos contaste"}
        </h2>
        <p class="profile-hook">${profileHook}</p>
        ${profileColumns}
      </section>

      ${areaBlock}
      ${contextBanner}
      ${totalMatches === 0 ? noResultsMsg : rolesSection}`;
  }
}

/** Renderiza el desglose de puntaje como chips */
function renderBreakdown(breakdown) {
  if (!breakdown) return "";

  const labels = {
    carrera:         "Carrera",
    skills:          "Habilidades",
    especializacion: "Especialización",
    experiencia:     "Experiencia",
    intereses:       "Intereses",
    modalidad:       "Modalidad"
  };

  return Object.entries(breakdown)
    .map(([key, val]) => {
      const hasScore = val > 0;
      return `<span class="breakdown-item ${hasScore ? "has-score" : ""}">
        ${labels[key] || key}: ${val}
      </span>`;
    })
    .join("");
}

/** Interpretación humana del score */
function scoreInterpretation(score) {
  if (score >= 70) return "Ya tienes buena base para este rol";
  if (score >= 50) return "Vas bien encaminado para este rol";
  return "Hay potencial, pero necesitas reforzar áreas clave";
}

/** Texto del CTA del CV builder con nombre del rol (fallback si es muy largo) */
function cvBuilderLabel(roleTitle, hasCv) {
  const verb = hasCv ? "Optimizar CV para" : "Crear CV para";
  const fallback = hasCv ? "Optimizar mi CV para este rol" : "Crear CV para este rol";
  // Si el texto completo supera 44 chars, usar fallback genérico
  const full = `${verb} ${roleTitle}`;
  return full.length > 44 ? fallback : full;
}

// ------------------------------------------------------------------ //
// Nivel de ajuste cualitativo (reemplaza score numérico)
// ------------------------------------------------------------------ //

function fitLevel(score) {
  if (score >= 65) return { label: "Hace mucho sentido",   css: "fit-high" };
  if (score >= 40) return { label: "Hay base para esto",   css: "fit-mid" };
  return              { label: "Más distante hoy",         css: "fit-low" };
}

function fitDescription(score, roleTitle) {
  if (score >= 65) return `Por lo que nos contaste, ${roleTitle} es uno de los caminos que hoy se ven más naturales para ti.`;
  if (score >= 40) return `Hay base real para este camino. Hay cosas que reforzar, pero la dirección tiene sentido.`;
  return `Este camino hoy se ve más distante. Es alcanzable, pero hay pasos previos que conviene trabajar primero.`;
}

// ------------------------------------------------------------------ //
// Brechas basadas en mercado
// ------------------------------------------------------------------ //

/**
 * Construye brechas con lenguaje de mercado a partir de los datos del backend.
 * Usa: missing_skills, score_breakdown, profile (languages, experience).
 * Máximo 4 brechas, priorizando empleabilidad real.
 */
function buildMarketGaps(role, profile) {
  const gaps = [];
  const missingSkills = role.missing_skills || [];
  const breakdown     = role.score_breakdown || {};
  const roleTitle     = role.title || "este rol";
  const roleArea      = role.area || role.category || "";

  // A) Herramientas / skills faltantes (las más relevantes primero)
  if (missingSkills.length > 0) {
    gaps.push(`En roles de ${roleArea.toLowerCase()} se suele pedir ${missingSkills[0]}, y no aparece en tu perfil.`);
  }
  if (missingSkills.length > 1) {
    gaps.push(`También se pide ${missingSkills[1]}.`);
  }

  // B) Experiencia
  if (breakdown.experiencia === 0) {
    gaps.push(`Se valora experiencia práctica en el área.`);
  }

  // C) Idiomas — revisar si el perfil tiene inglés
  const profileLangs = (profile?.languages || []).map(l => l.toLowerCase());
  const hasEnglish   = profileLangs.some(l => l.includes("ingl") || l.includes("english"));
  if (!hasEnglish) {
    gaps.push(`Inglés intermedio es requisito frecuente en estas posiciones.`);
  }

  // D) Skills adicionales del rol (si quedan slots)
  if (gaps.length < 4 && missingSkills.length > 2) {
    const extra = missingSkills[2];
    gaps.push(`También se valora manejo de ${extra}.`);
  }

  // Fallback: si no se generó ninguna brecha
  if (gaps.length === 0) {
    gaps.push(`Tu perfil cubre las principales habilidades para ${roleTitle}. Busca diferenciarte con experiencia práctica.`);
  }

  return gaps.slice(0, 4);
}

// Descripciones cualitativas de qué caracteriza a alguien exitoso por área
const ROLE_AREA_PROFILE = {
  "Finanzas":    "un perfil analítico con capacidad para interpretar información financiera y apoyar decisiones de negocio",
  "Analítica":   "un perfil orientado a datos con habilidad para transformar información en insights accionables",
  "Comercial":   "un perfil orientado al cliente con habilidad para gestionar relaciones y generar negocio",
  "Marketing":   "un perfil creativo y estratégico con visión de marca y dominio de canales digitales",
  "Personas":    "un perfil humano con capacidad para gestionar procesos de talento y relaciones organizacionales",
  "Operaciones": "un perfil sistemático con visión de procesos y capacidad de coordinar equipos",
  "Logística":   "un perfil orientado a la eficiencia, con capacidad de coordinación en la cadena de suministro",
  "Tecnología":  "un perfil técnico con pensamiento lógico y orientación a la resolución de problemas",
};

const ROLE_AREA_EXPECTATIONS = {
  "Finanzas":         "En la práctica, suele implicar revisar datos financieros, apoyar presupuestos, armar reportes y ayudar a que una empresa entienda mejor dónde está parada y qué decisiones le convienen. Se trabaja con Excel casi siempre, y se reporta a personas que toman decisiones. Se espera orientación al detalle y capacidad para comunicar números de forma clara.",
  "Analítica":        "En la práctica, suele implicar extraer datos, limpiarlos, analizarlos y traducirlos en algo que otros puedan usar para decidir. Se trabaja con SQL, Excel o herramientas de visualización, según el equipo. Se espera curiosidad real por los datos y capacidad de comunicar hallazgos sin perder a quien te escucha.",
  "Comercial":        "En la práctica, suele implicar identificar oportunidades, mantener relaciones con clientes y apoyar el proceso de venta. Hay metas, hay rechazo, y hay satisfacción cuando algo se cierra. Se espera comunicación efectiva, energía y orientación a resultados — las herramientas de CRM se aprenden en el camino.",
  "Marketing":        "En la práctica, suele implicar crear contenido, gestionar campañas en plataformas digitales, medir resultados y proponer mejoras. Se trabaja en ciclos rápidos. Se espera creatividad combinada con criterio analítico, y disposición a probar, medir y ajustar constantemente.",
  "Personas":         "En la práctica, suele implicar apoyar procesos de selección, gestionar documentación, organizar iniciativas de clima y servir de punto de contacto entre las personas y la empresa. Se espera empatía, discreción y capacidad de hacer muchas cosas a la vez sin perder el foco.",
  "Operaciones":      "En la práctica, suele implicar coordinar procesos entre áreas, identificar cuellos de botella y proponer mejoras concretas. Se trabaja con datos, reportes y personas al mismo tiempo. Se espera visión sistémica, proactividad y habilidad para comunicarse con equipos distintos.",
  "Logística":        "En la práctica, suele implicar controlar inventarios, coordinar proveedores y hacer seguimiento de flujos físicos o de información. Se trabaja con presión, plazos y varios frentes abiertos. Se espera orientación al detalle, capacidad de coordinación y manejo de urgencias sin perder el orden.",
  "Tecnología":       "En la práctica, suele implicar construir o mantener sistemas, resolver problemas técnicos y trabajar en equipo con otros desarrolladores o analistas. Se aprende constantemente. Se espera pensamiento lógico, capacidad de aprender rápido y disposición a iterar hasta que algo funciona bien.",
  "Negocios":         "En la práctica, suele implicar acompañar a clientes o usuarios en su experiencia con el producto o servicio, identificar problemas y generar soluciones. Se trabaja con datos y personas a la vez. Se espera empatía, comunicación clara y orientación a resolver.",
  "Proyectos":        "En la práctica, suele implicar planificar tareas, hacer seguimiento de avances, coordinar equipos y asegurarse de que los plazos se cumplan. Se trabaja con incertidumbre. Se espera capacidad organizativa, comunicación fluida y habilidad para mantener el ritmo del equipo sin perder el norte.",
};

/**
 * Frase puente específica según carrera (normalizada) y área del rol.
 * Reemplaza el genérico "tu carrera tiene puntos de contacto…"
 */
function _buildBridgeSentence(degreeNorm, roleArea) {
  const d = degreeNorm;
  const a = (roleArea || "").toLowerCase();

  // Psicología → cualquier área
  if (d.includes("psicolog")) {
    if (a.includes("personas") || a.includes("recursos"))
      return "Tu formación en psicología te da base directa en comportamiento humano y dinámicas organizacionales.";
    if (a.includes("educacion"))
      return "Tu carrera en psicología tiene aplicación directa en entornos educativos y de desarrollo humano.";
    return "Tu formación en psicología es transferible a roles que involucran personas, procesos o análisis de comportamiento.";
  }

  // Kinesiología / terapia ocupacional / fonoaudiología → fuera del área clínica
  if (d.includes("kinesio") || d.includes("terapia ocupacional") || d.includes("fonoaudio")) {
    if (a.includes("personas") || a.includes("recursos"))
      return "Tu carrera en salud te da comprensión profunda de las personas y sus necesidades, base valiosa en roles de personas.";
    return "Tu formación en salud te da capacidad analítica y orientación al servicio que se transfiere a distintos entornos laborales.";
  }

  // Ingeniería comercial / administración → roles de tecnología o analítica
  if (d.includes("ingenieria comercial") || d.includes("administracion de empresas") || d.includes("ingenieria en administracion")) {
    if (a.includes("tecnolog") || a.includes("analitica"))
      return "Tu formación en gestión te da contexto de negocio que potencia cualquier rol técnico o de datos.";
    return "Tu base en negocios y gestión es aplicable en la mayoría de áreas funcionales de una organización.";
  }

  // Comunicación / periodismo / publicidad
  if (d.includes("periodismo") || d.includes("comunicacion") || d.includes("publicidad") || d.includes("relaciones publicas")) {
    if (a.includes("marketing") || a.includes("comercial"))
      return "Tu base en comunicación es directamente transferible a roles comerciales y de marketing.";
    if (a.includes("personas") || a.includes("recursos"))
      return "Tu carrera en comunicación te da habilidades de escucha, narrativa y relacionamiento clave en roles de personas.";
    return "Tu formación en comunicación es un diferenciador en roles que requieren transmitir información con claridad e impacto.";
  }

  // Ingeniería (genérico) → roles de negocios o personas
  if (d.includes("ingenieria") || d.includes("computacion") || d.includes("sistemas")) {
    if (a.includes("analitica") || a.includes("tecnolog"))
      return "Tu base técnica y lógica es el insumo más directo para roles de tecnología y datos.";
    return "Tu formación te da rigor analítico y capacidad de resolución de problemas, atributos valorados en casi cualquier rol.";
  }

  // Ciencias sociales (sociología, trabajo social, historia, etc.)
  if (d.includes("sociolog") || d.includes("trabajo social") || d.includes("antropolog") || d.includes("ciencia politica")) {
    if (a.includes("personas") || a.includes("recursos"))
      return "Tu carrera en ciencias sociales te da perspectiva sobre grupos humanos y organizaciones, base sólida para roles de personas.";
    return "Tu formación te entrega herramientas para entender contextos sociales y organizacionales complejos.";
  }

  // Educación
  if (d.includes("pedagogia") || d.includes("educacion")) {
    if (a.includes("personas") || a.includes("recursos"))
      return "Tu experiencia formando y acompañando personas se transfiere a roles de desarrollo y gestión de talento.";
    return "Tu formación en educación te da capacidad comunicativa y de facilitación valiosa en distintos entornos profesionales.";
  }

  // Fallback genérico mejorado
  return `Tu carrera tiene elementos formativos que conectan con el tipo de trabajo que requiere este rol.`;
}

/**
 * Genera razonamiento cualitativo de por qué el perfil encaja con el rol.
 * Basado en área del rol, carrera del perfil e intereses declarados.
 */
function buildRoleAlignment(role, profile) {
  const items  = [];
  const degree = profile?.degree || "";
  const area   = role.area || "";
  const pitch  = role.pitch || "";

  // 1. Qué necesita este rol (cualitativo + pitch)
  const areaProfile = ROLE_AREA_PROFILE[area];
  if (areaProfile && pitch) {
    items.push(`Este rol requiere ${areaProfile}. En concreto: ${pitch.endsWith(".") ? pitch : pitch + "."}`);
  } else if (pitch) {
    items.push(pitch);
  }

  // 2. Conexión formativa
  const relatedDegrees = (role.related_degrees || []).map(d => d.toLowerCase());
  const degreeNorm     = degree.toLowerCase();
  const directMatch    = relatedDegrees.some(d => d === degreeNorm ||
    (degreeNorm.length > 5 && (d.includes(degreeNorm.split(" ")[0]) || degreeNorm.includes(d.split(" ")[0]))));

  if (degree) {
    if (directMatch) {
      items.push(`Tu formación en ${degree} cubre la base que necesita este camino.`);
    } else {
      items.push(_buildBridgeSentence(degreeNorm, area));
    }
  }

  // 3. Interés declarado
  const matchedInterest = (profile?.areas_of_interest || []).find(i => {
    const val = typeof i === "object" ? i.value : i;
    return val === (role.category || "");
  });
  if (matchedInterest) {
    const weight = typeof matchedInterest === "object" ? matchedInterest.weight : 1;
    const phrase = weight === 3
      ? `Elegiste ${area} como tu primera prioridad — eso ya es una señal de dirección clara.`
      : `Tienes interés declarado en ${area}, que es justo el campo de este camino.`;
    items.push(phrase);
  }

  return items.slice(0, 3);
}

/**
 * Describe qué se espera de alguien en este rol.
 * Sin mencionar lo que le falta al usuario.
 */
function buildRoleExpectations(role) {
  const area = role.area || "";
  const expectation = ROLE_AREA_EXPECTATIONS[area];
  if (expectation) return [expectation];

  // Fallback con skills del rol
  const skills = (role.skills || []).slice(0, 4);
  if (skills.length > 0) {
    return [`Quienes trabajan en este tipo de roles suelen manejar ${skills.join(", ")}. El perfil base es consistente aunque las herramientas específicas varían por empresa.`];
  }
  return [`Este rol requiere un perfil con base técnica y orientación al trabajo en equipo. Los requisitos específicos varían según la empresa.`];
}

function buildNextStep(role, profile) {
  const area      = (role.area || role.category || "").toLowerCase();
  const breakdown = role.score_breakdown || {};
  const missingSkills = role.missing_skills || [];
  const hasExp    = breakdown.experiencia > 0;

  // Próximos pasos específicos por área
  const NEXT_STEPS = {
    finanzas: hasExp
      ? "Busca posiciones donde aparezcan términos como 'estados financieros', 'flujo de caja' o 'presupuesto'. Traduce tu experiencia académica a lenguaje de negocio en tu CV: en vez de 'tesis de valorización', di 'modelo de valorización de empresa usando DCF'."
      : `Refuerza Excel financiero con funciones como BUSCARV, tablas dinámicas y modelos de caja. Practica analizando estados financieros reales — muchas empresas los publican. Una buena siguiente señal sería armar un caso simple de análisis financiero y tenerlo listo para mostrar.${missingSkills.length > 0 ? ` También conviene acercarte a ${missingSkills[0]}.` : ""}`,
    "control de gestión": hasExp
      ? "Enfoca tu búsqueda en roles que mencionen 'KPIs', 'control presupuestario' o 'variaciones'. Asegúrate de que tu CV muestre casos concretos donde hayas medido o reportado resultados."
      : `Aprende Power BI o Tableau a nivel básico — es lo que más piden en Control de Gestión junior. Practica construyendo un dashboard simple con datos reales (Excel o Google Sheets también sirve). Eso ya es algo concreto que puedes mostrar.${missingSkills.length > 0 ? ` También es valorado el manejo de ${missingSkills[0]}.` : ""}`,
    analítica: hasExp
      ? "Arma un portafolio con 1 o 2 análisis reales — pueden ser de datos públicos o proyectos académicos. GitHub o Notion funcionan bien para mostrarlo. En entrevistas, explica el problema que resolviste, no solo el código que escribiste."
      : `Empieza con SQL básico — hay cursos gratuitos en línea y en un par de semanas ya puedes hacer consultas reales. Practica con datos abiertos del INE o similares. Un análisis simple bien documentado ya es mejor portafolio que nada.${missingSkills.length > 0 ? ` También conviene conocer ${missingSkills[0]}.` : ""}`,
    comercial: hasExp
      ? "Muestra en tu CV experiencias donde hayas influido en una decisión o resultado, aunque sea en contexto universitario. Los roles comerciales junior valoran la actitud tanto como la experiencia — prepárate para hablar de eso en entrevistas."
      : "Busca una práctica o trabajo part-time donde tengas contacto con clientes, aunque sea en contexto distinto al rol ideal. La experiencia en ventas o atención se transfiere bien. También puedes buscar ayudantías en cursos de marketing o ventas para sumar señales.",
    marketing: hasExp
      ? "Arma un portafolio con 1 campaña real o simulada que hayas gestionado. Aunque sea pequeña, documenta el objetivo, lo que hiciste y el resultado. Eso diferencia candidatos en roles de marketing junior."
      : `Crea o gestiona una cuenta o campaña real, aunque sea pequeña. Puedes hacerlo para algún proyecto, negocio conocido o voluntariado. El dominio práctico de Google Ads o Meta Ads es más valorado que el teórico.${missingSkills.length > 0 ? ` También conviene acercarte a ${missingSkills[0]}.` : ""}`,
    operaciones: hasExp
      ? "En tu CV, enfatiza situaciones donde hayas mejorado un proceso, coordinado un equipo o resuelto un problema operativo. Los roles de operaciones junior valoran mucho la proactividad y la capacidad de ver el sistema completo."
      : `Busca una práctica donde puedas participar en procesos reales. Si no tienes acceso a eso todavía, documenta algún caso académico donde hayas propuesto una mejora de proceso. Aprender Excel a nivel avanzado es un buen punto de partida concreto.${missingSkills.length > 0 ? ` También se valora el manejo de ${missingSkills[0]}.` : ""}`,
    personas: hasExp
      ? "Destaca en tu CV procesos de selección, encuestas de clima u otras iniciativas de personas en las que hayas participado. En entrevistas, habla de cómo abordas relaciones y conflictos — eso es muy valorado en RRHH junior."
      : "Busca una práctica en área de personas, aunque sea pequeña empresa. También puedes sumar señales a través de voluntariados o iniciativas estudiantiles donde hayas coordinado personas. Eso ya es experiencia relevante.",
  };

  const areaKey = Object.keys(NEXT_STEPS).find(k => area.includes(k));
  if (areaKey) return NEXT_STEPS[areaKey];

  // Fallback genérico mejorado
  if (!hasExp) {
    return `Una buena siguiente señal sería buscar una práctica, ayudantía o proyecto donde puedas aplicar algo de lo que sabes y documentar el resultado. No tiene que ser el rol perfecto — cualquier experiencia real que puedas describir con resultados concretos suma.`;
  }
  return `Conecta con personas que ya trabajan en ${area} en LinkedIn — no para pedir trabajo directamente, sino para entender cómo es el día a día. Una conversación de 20 minutos puede orientarte más que una semana de búsqueda en portales.`;
}

// ------------------------------------------------------------------ //
// Render de tarjeta de rol (unificada, sin score numérico)
// ------------------------------------------------------------------ //

/** Tarjeta completa — rol principal. isExplore=true usa estructura nueva. */
function renderRoleCard(role, isExplore = false) {
  const fit         = fitLevel(role.score);
  const description = fitDescription(role.score, role.title);
  const extraClass  = role.is_recommended ? " role-card--recommended" : "";

  const storedData = sessionStorage.getItem("laboraResults");
  const profile    = storedData ? JSON.parse(storedData).profile : null;

  if (isExplore) {
    // ── Estructura explore: Qué hace + Cómo se ve ─────────────────────
    const { practice, howItLooks } = getPracticeContent(role);
    return `
      <article class="role-card role-card--pilot${extraClass}">
        <div class="role-header">
          <div>
            ${!role.requires_cv_gate && role.entry_type === "selective" ? `<span class="role-entry-badge role-entry-badge--selective">Competitivo</span>` : ""}
            ${!role.requires_cv_gate && role.entry_type === "conditional" ? `<span class="role-entry-badge role-entry-badge--conditional">Requiere preparación</span>` : ""}
            ${!role.requires_cv_gate && role.entry_type === "real" ? `<span class="role-entry-badge role-entry-badge--real">Accesible de entrada</span>` : ""}
            <h3>${role.title}</h3>
            <p class="muted" style="margin:2px 0 0;">${role.area || role.category || ""}${role.subarea ? ` · ${role.subarea}` : ""}</p>
          </div>
        </div>

        <div class="role-section">
          <h4>Qué hace este rol en la práctica</h4>
          <p>${practice}</p>
        </div>

        <div class="role-section">
          <h4>Cómo suele verse este rol</h4>
          <p>${howItLooks}</p>
        </div>

        <div class="role-cv-builder-action">
          <a href="/vacantes.html?role=${encodeURIComponent(role.title)}" class="button secondary" style="text-align:center;">
            Ver ofertas de este tipo
          </a>
          <a href="/cv-builder.html?mode=${currentHasCv ? "optimize" : "generate"}&role=${encodeURIComponent(role.title)}"
             class="button primary">
            ${cvBuilderLabel(role.title, currentHasCv)}
          </a>
        </div>
      </article>`;
  }

  // ── Estructura guided (original) ──────────────────────────────────────
  const nextStep = buildNextStep(role, profile);

  return `
    <article class="role-card role-card--pilot${extraClass}">
      <div class="role-header">
        <div>
          ${role.is_recommended ? `<span class="role-recommended-badge">Recomendado</span>` : ""}
          ${!role.requires_cv_gate && role.entry_type === "selective" ? `<span class="role-entry-badge role-entry-badge--selective">Competitivo</span>` : ""}
          ${!role.requires_cv_gate && role.entry_type === "conditional" ? `<span class="role-entry-badge role-entry-badge--conditional">Requiere preparación</span>` : ""}
          ${!role.requires_cv_gate && role.entry_type === "real" ? `<span class="role-entry-badge role-entry-badge--real">Accesible de entrada</span>` : ""}
          <h3>${role.title}</h3>
          <p class="muted" style="margin:2px 0 0;">${role.area || role.category || ""}${role.subarea ? ` · ${role.subarea}` : ""}</p>
        </div>
        ${currentHasCv ? `<span class="fit-badge ${fit.css}">${fit.label}</span>` : ""}
      </div>

      ${currentHasCv ? `<p class="role-description">${description}</p>` : ""}

      ${role.has_commission ? `
      <div class="role-commission-notice">
        <strong>Rol con componente variable:</strong> incluye cuota o comisión. El sueldo total depende del rendimiento comercial.
      </div>` : ""}

      <div class="role-section">
        <h4>Por qué este camino podría hacerte sentido</h4>
        <ul class="list">
          ${
            buildRoleAlignment(role, profile).map(r => `<li>${r}</li>`).join("") ||
            "<li>Por lo que nos contaste, hay elementos en tu perfil que conectan con este camino.</li>"
          }
        </ul>
      </div>

      ${currentHasCv ? `
      <div class="role-section">
        <h4>Cómo se ve este trabajo en la práctica</h4>
        <ul class="list">
          ${buildRoleExpectations(role).map(e => `<li>${e}</li>`).join("")}
        </ul>
      </div>` : ""}

      <div class="role-next-step-highlight">
        <h4>Si quisieras acercarte a esto</h4>
        <p>${nextStep}</p>
      </div>

      <div class="role-cv-builder-action">
        <a href="/vacantes.html?role=${encodeURIComponent(role.title)}" class="button secondary" style="text-align:center;">
          Ver ofertas de este tipo
        </a>
        <a href="/cv-builder.html?mode=${currentHasCv ? "optimize" : "generate"}&role=${encodeURIComponent(role.title)}"
           class="button primary">
          ${cvBuilderLabel(role.title, currentHasCv)}
        </a>
      </div>
    </article>`;
}

/** Tarjeta compacta — roles secundarios. isExplore=true usa estructura simplificada. */
function renderCompactRoleCard(role, isExplore = false) {
  const fit        = fitLevel(role.score);
  const extraClass = role.is_recommended ? " role-card--recommended" : "";
  const area       = role.area || role.category || "";

  if (isExplore) {
    const { practice } = getPracticeContent(role);
    const shortPractice = practice.split(".")[0] + "."; // Solo la primera oración
    return `
      <article class="role-card role-card--compact${extraClass}">
        <div class="role-header">
          <div>
            ${!role.requires_cv_gate && role.entry_type === "selective" ? `<span class="role-entry-badge role-entry-badge--selective">Competitivo</span>` : ""}
            ${!role.requires_cv_gate && role.entry_type === "conditional" ? `<span class="role-entry-badge role-entry-badge--conditional">Requiere preparación</span>` : ""}
            ${!role.requires_cv_gate && role.entry_type === "real" ? `<span class="role-entry-badge role-entry-badge--real">Accesible de entrada</span>` : ""}
            <h3>${role.title}</h3>
            <p class="muted" style="margin:2px 0 0;">${area}${role.subarea ? ` · ${role.subarea}` : ""}</p>
          </div>
        </div>
        <p class="muted" style="margin-top:8px; font-size:14px;">${shortPractice}</p>
        <div class="role-compact-actions">
          <a href="/vacantes.html?role=${encodeURIComponent(role.title)}" class="button secondary">Ver ofertas</a>
          <a href="/cv-builder.html?mode=${currentHasCv ? "optimize" : "generate"}&role=${encodeURIComponent(role.title)}"
             class="button primary">
            ${cvBuilderLabel(role.title, currentHasCv)}
          </a>
        </div>
      </article>`;
  }

  const storedData = sessionStorage.getItem("laboraResults");
  const profile    = storedData ? JSON.parse(storedData).profile : null;

  return `
    <article class="role-card role-card--compact${extraClass}">
      <div class="role-header">
        <div>
          ${!role.requires_cv_gate && role.entry_type === "selective" ? `<span class="role-entry-badge role-entry-badge--selective">Competitivo</span>` : ""}
          ${!role.requires_cv_gate && role.entry_type === "conditional" ? `<span class="role-entry-badge role-entry-badge--conditional">Requiere preparación</span>` : ""}
          ${!role.requires_cv_gate && role.entry_type === "real" ? `<span class="role-entry-badge role-entry-badge--real">Accesible de entrada</span>` : ""}
          <h3>${role.title}</h3>
          <p class="muted" style="margin:2px 0 0;">${area}${role.subarea ? ` · ${role.subarea}` : ""}</p>
        </div>
        ${currentHasCv ? `<span class="fit-badge ${fit.css}">${fit.label}</span>` : ""}
      </div>

      ${currentHasCv ? `
      <div class="role-section">
        <h4>Cómo se ve este trabajo en la práctica</h4>
        <ul class="list">
          ${buildRoleExpectations(role).slice(0, 1).map(e => `<li>${e}</li>`).join("")}
        </ul>
      </div>` : ""}

      <div class="role-compact-actions">
        <a href="/vacantes.html?role=${encodeURIComponent(role.title)}" class="button secondary">Ver ofertas</a>
        <a href="/cv-builder.html?mode=${currentHasCv ? "optimize" : "generate"}&role=${encodeURIComponent(role.title)}"
           class="button primary">
          ${cvBuilderLabel(role.title, currentHasCv)}
        </a>
      </div>
    </article>`;
}

// ------------------------------------------------------------------ //
// Intereses por carrera (dinámico)
// ------------------------------------------------------------------ //

/**
 * Registro completo de valores de interés y sus etiquetas de display.
 * Valores que coinciden con categorías del backend (analitica, finanzas…)
 * participan en el scoring. Los demás se almacenan para uso futuro.
 */
const INTEREST_REGISTRY = {
  // ── Traducciones de nivel de área (para el banner de área detectada) ──
  // Claves que el backend puede enviar como detectedArea.label cuando no hay
  // entrada en AREA_LABELS — mapeamos al nombre de área legible.
  "clinica-psico":          "Psicología",
  "organizacional":         "Recursos Humanos",
  "salud-mental":           "Psicología",
  "rehab-clinica":          "Kinesiología / Salud",
  "rehab-deportiva":        "Kinesiología Deportiva",
  "clinica-hosp":           "Salud Clínica",
  "clinica":                "Salud Clínica",
  "docencia":               "Educación",
  "desarrollo-sw":          "Tecnología",
  "infra-sistemas":         "Tecnología",
  "litigacion":             "Derecho",
  "corporativo":            "Derecho",
  "medios":                 "Comunicación",
  "comunicaciones-corp":    "Comunicación",
  "sector-publico":         "Administración Pública",
  "investigacion":          "Investigación",
  // ── Generales (fallback) ──────────────────────────────────────────────
  "analitica":              "Analítica / Datos",
  "comercial":              "Comercial / Ventas",
  "finanzas":               "Finanzas",
  "operaciones":            "Operaciones",
  "proyectos":              "Proyectos",
  "personas":               "Recursos Humanos",
  "tecnologia":             "Tecnología",
  "medioambiente":          "Medioambiente",
  "geociencias":            "Geociencias",
  "emprendimiento":         "Emprendimiento",
  // ── Negocios y Administración ─────────────────────────────────────────
  "control-gestion":        "Control de gestión",
  "marketing":              "Marketing",
  "gestion-adm":            "Gestión / Administración",
  "auditoria":              "Auditoría",
  "contabilidad":           "Contabilidad",
  "tributario":             "Tributario / Impuestos",
  "finanzas-corp":          "Finanzas corporativas",
  "control-interno":        "Control interno",
  "investigacion":          "Investigación",
  "politicas-publicas":     "Políticas públicas",
  "economia-aplicada":      "Economía aplicada",
  "supply-chain":           "Supply Chain",
  "planificacion":          "Planificación",
  "comercio-exterior":      "Comercio exterior",
  "gestion-inventarios":    "Gestión de inventarios",
  "mkt-digital":            "Marketing digital",
  "investigacion-mercado":  "Investigación de mercado",
  "publicidad":             "Publicidad",
  "gestion-marca":          "Gestión de marca",
  "analitica-mkt":          "Analítica de marketing",
  // ── Ingeniería ────────────────────────────────────────────────────────
  "logistica-sc":           "Logística / Supply Chain",
  "control-procesos":       "Control de procesos",
  "desarrollo-sw":          "Desarrollo de software",
  "infra-sistemas":         "Infraestructura / Sistemas",
  "ciberseguridad":         "Ciberseguridad",
  "proyectos-tech":         "Proyectos tecnológicos",
  "proyectos-construccion": "Proyectos de construcción",
  "obras-civiles":          "Obras civiles",
  "infraestructura":        "Infraestructura",
  "gestion-ambiental":      "Gestión ambiental",
  "eval-ambiental":         "Evaluación ambiental",
  "proyectos-amb":          "Proyectos ambientales",
  "cumplimiento-norm":      "Cumplimiento normativo",
  "consultoria-amb":        "Consultoría ambiental",
  "seguridad-laboral":      "Seguridad laboral",
  "gestion-riesgos":        "Gestión de riesgos",
  "salud-ocupacional":      "Salud ocupacional",
  "auditorias-seg":         "Auditorías de seguridad",
  // ── Salud ─────────────────────────────────────────────────────────────
  "clinica-psico":          "Clínica / Psicoterapia",
  "organizacional":         "Organizacional / RRHH",
  "educacional":            "Educacional",
  "salud-mental":           "Salud mental",
  "nutricion-clinica":      "Nutrición clínica",
  "alimentacion-colectiva": "Alimentación colectiva",
  "salud-publica":          "Salud pública",
  "nutricion-deportiva":    "Nutrición deportiva",
  "educacion-alimentaria":  "Educación alimentaria",
  "rehab-clinica":          "Rehabilitación clínica",
  "rehab-deportiva":        "Rehabilitación deportiva",
  "ergonomia":              "Ergonomía / Empresas",
  "salud-comunitaria":      "Salud comunitaria",
  "clinica-hosp":           "Clínica hospitalaria",
  "urgencias":              "Urgencias",
  "gestion-clinica":        "Gestión clínica",
  "clinica":                "Clínica",
  "gestion-salud":          "Gestión en Salud",
  "salud-digital":          "Salud Digital",
  "voz-profesional":        "Voz profesional",
  "rehabilitacion":         "Rehabilitación",
  "gerontologia":           "Gerontología",
  "educacion-especial":     "Educación especial",
  // ── Educación ─────────────────────────────────────────────────────────
  "docencia":               "Docencia escolar",
  "educ-diferencial":       "Educación diferencial",
  "orientacion-educ":       "Orientación educativa",
  "gestion-pedagogica":     "Gestión pedagógica",
  "educacion-inicial":      "Educación inicial",
  "estimulacion-temprana":  "Estimulación temprana",
  "gestion-educativa":      "Gestión educativa",
  // ── Derecho ───────────────────────────────────────────────────────────
  "litigacion":             "Litigación",
  "corporativo":            "Derecho corporativo",
  "tributario-d":           "Derecho tributario",
  "laboral-d":              "Derecho laboral",
  "sector-publico":         "Sector público",
  "compliance":             "Compliance",
  // ── Comunicación y Diseño ─────────────────────────────────────────────
  "medios":                 "Medios de comunicación",
  "comunicaciones-corp":    "Comunicaciones corporativas",
  "contenidos-digitales":   "Contenidos digitales",
  "comunicacion-publica":   "Comunicación pública",
  "creatividad":            "Creatividad",
  "produccion-av":          "Producción audiovisual",
  "gestion-cuentas":        "Gestión de cuentas",
  "diseno-digital":         "Diseño digital",
  "branding":               "Branding",
  "contenido-visual":       "Contenido visual",
  "diseno":                 "Diseño",
  "diseno-arq":             "Diseño arquitectónico",
  "construccion":           "Construcción",
  "urbanismo":              "Urbanismo",
  "diseno-interiores":      "Diseño de interiores",
  // ── Geociencias ───────────────────────────────────────────────────────
  "exploracion":            "Exploración",
  "geotecnia":              "Geotecnia",
  "hidrogeologia":          "Hidrogeología",
  "mineria":                "Minería",
  "consultoria":            "Consultoría"
};

/** Intereses generales mostrados cuando no hay carrera reconocida */
const GENERAL_INTERESTS = [
  "analitica", "comercial", "finanzas", "operaciones", "proyectos",
  "personas", "tecnologia", "medioambiente", "geociencias", "emprendimiento"
];

/**
 * Intereses sugeridos por carrera (en orden de relevancia).
 * Pueden mezclar valores generales y específicos.
 */
const CAREER_SPECIFIC_INTERESTS = {
  // ── Negocios y Administración ─────────────────────────────────────────
  "ingenieria comercial":              ["finanzas", "control-gestion", "comercial", "marketing", "analitica", "gestion-adm"],
  "administracion de empresas":        ["comercial", "operaciones", "personas", "finanzas", "control-gestion", "emprendimiento"],
  "contador auditor":                  ["auditoria", "contabilidad", "tributario", "finanzas-corp", "control-interno"],
  "auditoria":                         ["auditoria", "contabilidad", "tributario", "finanzas-corp", "control-interno"],
  "economia":                          ["analitica", "finanzas", "politicas-publicas", "investigacion", "economia-aplicada"],
  "logistica":                         ["supply-chain", "operaciones", "planificacion", "comercio-exterior", "gestion-inventarios"],
  "marketing":                         ["mkt-digital", "investigacion-mercado", "publicidad", "gestion-marca", "analitica-mkt"],
  "finanzas":                          ["finanzas", "finanzas-corp", "analitica", "control-gestion"],
  "comercio internacional":            ["comercio-exterior", "operaciones", "finanzas", "comercial"],
  "administracion publica":            ["sector-publico", "personas", "operaciones", "politicas-publicas"],
  "ingenieria en finanzas":            ["finanzas", "finanzas-corp", "analitica", "control-gestion"],
  "ingenieria en marketing":           ["mkt-digital", "investigacion-mercado", "gestion-marca", "analitica-mkt"],
  "ingenieria en administracion de empresas": ["operaciones", "personas", "finanzas", "control-gestion"],
  "ingenieria en gestion de personas": ["personas", "operaciones", "comercial"],
  "ingenieria en negocios internacionales":   ["comercio-exterior", "operaciones", "finanzas", "comercial"],
  "relaciones publicas":               ["comunicaciones-corp", "comercial", "personas", "emprendimiento"],
  // ── Ingeniería ────────────────────────────────────────────────────────
  "ingenieria civil industrial":       ["operaciones", "logistica-sc", "proyectos", "analitica", "control-procesos"],
  "ingenieria en informatica":         ["desarrollo-sw", "analitica", "infra-sistemas", "ciberseguridad", "proyectos-tech"],
  "ingenieria de software":            ["desarrollo-sw", "analitica", "infra-sistemas", "ciberseguridad", "proyectos-tech"],
  "ingenieria en desarrollo de software": ["desarrollo-sw", "analitica", "infra-sistemas", "ciberseguridad", "proyectos-tech"],
  "ingenieria en computacion":         ["desarrollo-sw", "analitica", "infra-sistemas", "proyectos-tech"],
  "ciencias de la computacion":        ["desarrollo-sw", "analitica", "infra-sistemas"],
  "analisis de sistemas":              ["infra-sistemas", "analitica", "desarrollo-sw"],
  "ingenieria en ciberseguridad":      ["ciberseguridad", "infra-sistemas", "proyectos-tech"],
  "ingenieria civil":                  ["proyectos-construccion", "obras-civiles", "proyectos", "infraestructura", "planificacion"],
  "ingenieria en construccion":        ["proyectos-construccion", "obras-civiles", "proyectos", "infraestructura"],
  "ingenieria civil electrica":        ["tecnologia", "proyectos", "infraestructura", "operaciones"],
  "ingenieria civil mecanica":         ["operaciones", "proyectos", "tecnologia", "control-procesos"],
  "ingenieria civil quimica":          ["tecnologia", "proyectos", "medioambiente", "control-procesos"],
  "ingenieria ambiental":              ["gestion-ambiental", "eval-ambiental", "proyectos-amb", "cumplimiento-norm", "consultoria-amb"],
  "ingenieria en recursos naturales":  ["medioambiente", "gestion-ambiental", "geociencias"],
  "ingenieria en prevencion de riesgos": ["seguridad-laboral", "gestion-riesgos", "salud-ocupacional", "cumplimiento-norm", "auditorias-seg"],
  "ingenieria en gestion industrial":  ["operaciones", "logistica-sc", "proyectos", "analitica", "control-procesos"],
  "ingenieria en telecomunicaciones":  ["tecnologia", "infra-sistemas", "proyectos-tech", "proyectos"],
  "ingenieria forestal":               ["medioambiente", "gestion-ambiental", "operaciones", "proyectos"],
  "ingenieria en alimentos":           ["operaciones", "medioambiente", "tecnologia", "control-procesos"],
  "ingenieria en biotecnologia":       ["investigacion", "tecnologia", "medioambiente"],
  "estadistica":                       ["analitica", "investigacion", "finanzas"],
  "arquitectura":                      ["diseno-arq", "proyectos", "construccion", "urbanismo", "diseno-interiores"],
  // ── Salud ─────────────────────────────────────────────────────────────
  "psicologia":                        ["clinica-psico", "organizacional", "educacional", "salud-mental", "investigacion"],
  "nutricion y dietetica":             ["nutricion-clinica", "alimentacion-colectiva", "salud-publica", "nutricion-deportiva", "educacion-alimentaria"],
  "kinesiologia":                      ["rehab-clinica", "rehab-deportiva", "ergonomia", "salud-comunitaria"],
  "enfermeria":                        ["clinica-hosp", "urgencias", "salud-publica", "gestion-clinica"],
  "fonoaudiologia":                    ["rehab-clinica", "educacional", "salud-publica", "voz-profesional"],
  "terapia ocupacional":               ["rehabilitacion", "salud-mental", "gerontologia", "educacion-especial"],
  "medicina":                          ["clinica", "investigacion", "salud-publica", "gestion-salud", "salud-digital"],
  "odontologia":                       ["clinica", "gestion-salud", "investigacion"],
  "medicina veterinaria":              ["clinica", "investigacion", "medioambiente"],
  "obstetricia":                       ["clinica-hosp", "salud-publica", "investigacion"],
  "quimico farmaceutico":              ["clinica", "investigacion", "tecnologia"],
  "tecnologia medica":                 ["clinica", "salud-digital", "investigacion"],
  // ── Personas / social / legal ─────────────────────────────────────────
  "trabajo social":                    ["sector-publico", "personas", "operaciones"],
  "sociologia":                        ["investigacion", "personas", "sector-publico", "analitica"],
  "ciencia politica":                  ["sector-publico", "investigacion", "politicas-publicas"],
  "historia":                          ["investigacion", "sector-publico", "educacional"],
  "derecho":                           ["litigacion", "corporativo", "tributario-d", "laboral-d", "sector-publico"],
  "antropologia":                      ["investigacion", "personas", "sector-publico"],
  "filosofia":                         ["investigacion", "sector-publico", "educacional"],
  // ── Educación ─────────────────────────────────────────────────────────
  "pedagogia en educacion basica":     ["docencia", "educ-diferencial", "orientacion-educ", "gestion-pedagogica"],
  "pedagogia en educacion media":      ["docencia", "educ-diferencial", "orientacion-educ", "gestion-pedagogica"],
  "educacion diferencial":             ["educ-diferencial", "docencia", "orientacion-educ", "rehabilitacion"],
  "educacion parvularia":              ["educacion-inicial", "estimulacion-temprana", "gestion-educativa"],
  "pedagogia en historia":             ["docencia", "investigacion", "sector-publico"],
  "pedagogia en ingles":               ["docencia", "comercial"],
  "pedagogia en matematicas":          ["docencia", "analitica"],
  "pedagogia en lenguaje":             ["docencia", "comunicacion-publica"],
  // ── Comunicación y Diseño ─────────────────────────────────────────────
  "periodismo":                        ["medios", "comunicaciones-corp", "contenidos-digitales", "comunicacion-publica"],
  "comunicacion social":               ["medios", "comunicaciones-corp", "contenidos-digitales", "comunicacion-publica"],
  "comunicacion audiovisual":          ["creatividad", "produccion-av", "mkt-digital", "gestion-cuentas"],
  "publicidad":                        ["creatividad", "mkt-digital", "produccion-av", "gestion-cuentas"],
  "diseno grafico":                    ["diseno-digital", "branding", "publicidad", "contenido-visual"],
  "diseno industrial":                 ["diseno", "proyectos", "tecnologia"],
  // ── Geociencias / medioambiente ──────────────────────────────────────
  "geologia":                          ["exploracion", "geotecnia", "hidrogeologia", "medioambiente", "consultoria"],
  "geografia":                         ["geociencias", "medioambiente", "analitica"],
  "biologia":                          ["investigacion", "medioambiente", "tecnologia"],
  "agronomia":                         ["medioambiente", "operaciones", "investigacion"],
  "oceanografia":                      ["investigacion", "medioambiente", "geociencias"],
  "ingenieria en minas":               ["mineria", "geotecnia", "exploracion", "operaciones"],
  // ── Turismo / gastronomía ─────────────────────────────────────────────
  "turismo":                           ["comercial", "operaciones", "emprendimiento"],
  "hoteleria":                         ["comercial", "operaciones"],
  "gastronomia":                       ["operaciones", "emprendimiento"],
  "gestion del turismo":               ["comercial", "operaciones", "emprendimiento"]
};

function getCareerSpecificInterests(normalizedDegree) {
  if (!normalizedDegree) return [];

  // Normalizar la entrada también, por si llega con tildes o espacios extra
  const key = normalizeStr(normalizedDegree);

  // 1. Match exacto (clave del objeto ya normalizada en el literal)
  if (CAREER_SPECIFIC_INTERESTS[key]) {
    return CAREER_SPECIFIC_INTERESTS[key];
  }

  // 2. Normalizar todas las claves en runtime y comparar (resguardo por encoding)
  const entries = Object.entries(CAREER_SPECIFIC_INTERESTS);
  const exactEntry = entries.find(([k]) => normalizeStr(k) === key);
  if (exactEntry) {
    return exactEntry[1];
  }

  // 3. Substring: la clave contiene el input o viceversa
  const subEntry = entries.find(([k]) => {
    const nk = normalizeStr(k);
    return key.includes(nk) || nk.includes(key);
  });
  if (subEntry) {
    return subEntry[1];
  }

  return [];
}

/**
 * Crea un elemento div para una opción de interés (sin checkbox).
 * El orden de selección determina la prioridad (1 = más importante).
 */
function createInterestItem(value, label, suggested) {
  const div = document.createElement("div");
  const idx = selectedInterests.indexOf(value);
  const isSelected = idx >= 0;
  const atLimit    = selectedInterests.length >= 3;

  div.className = "interest-item" +
    (suggested  && !isSelected ? " suggested" : "") +
    (isSelected                ? " selected"  : "") +
    (!isSelected && atLimit    ? " disabled"  : "");

  if (isSelected) {
    div.innerHTML = `
      <span class="interest-priority-num">${idx + 1}</span>
      <span class="interest-label">${label}</span>`;
  } else {
    div.innerHTML = `<span class="interest-label">${label}</span>`;
  }

  div.addEventListener("click", () => {
    const currentIdx = selectedInterests.indexOf(value);
    if (currentIdx >= 0) {
      selectedInterests.splice(currentIdx, 1);       // deseleccionar
    } else if (selectedInterests.length < 3) {
      selectedInterests.push(value);                  // seleccionar
    }
    renderInterestsForCareer(currentRawDegree);
  });

  return div;
}

/** Actualiza el contador según las selecciones actuales */
function updateInterestUI() {
  const counter  = document.getElementById("interests-counter");
  const limitMsg = document.getElementById("interests-limit-msg");
  const count    = selectedInterests.length;
  const atLimit  = count >= 3;

  if (counter) {
    counter.textContent = atLimit
      ? "Las 3 elegidas — haz clic en una para cambiarla"
      : count === 0
        ? "La primera nos ayuda a entender qué te importa más hoy (máx. 3)"
        : `${count} de 3 elegida${count > 1 ? "s"  : ""}`;
    counter.classList.toggle("at-limit", atLimit);
  }
  if (limitMsg) limitMsg.classList.toggle("visible", atLimit);
}

/**
 * Filtra GENERAL_INTERESTS según la carrera.
 * Aplica dos capas de filtro:
 *  1. geociencias/medioambiente solo aparecen si la carrera los tiene específicamente.
 *  2. Por dominio de carrera, se excluyen áreas que no tienen conexión razonable.
 */
function getFilteredGeneralInterests(careerSpecificInterests, normalizedCareer) {
  const EXCLUDE_IF_NOT_SPECIFIC = new Set(["geociencias", "medioambiente"]);

  // Carreras por dominio → qué áreas de GENERAL_INTERESTS excluir
  const DOMAIN_CAREERS = {
    salud: [
      "psicologia", "kinesiologia", "medicina", "enfermeria", "fonoaudiologia",
      "terapia ocupacional", "nutricion y dietetica", "odontologia",
      "medicina veterinaria", "obstetricia", "quimico farmaceutico", "tecnologia medica"
    ],
    "ciencias-sociales": [
      "sociologia", "trabajo social", "antropologia", "ciencia politica",
      "historia", "filosofia"
    ],
    tecnologia: [
      "ingenieria en informatica", "ingenieria de software", "ingenieria en desarrollo de software",
      "ingenieria en computacion", "ciencias de la computacion", "analisis de sistemas",
      "ingenieria en ciberseguridad", "ingenieria en sistemas", "ingenieria en redes"
    ],
    comunicacion: [
      "periodismo", "comunicacion social", "comunicacion audiovisual", "publicidad",
      "diseno grafico", "relaciones publicas"
    ]
  };
  const DOMAIN_EXCLUSIONS = {
    salud:              ["finanzas", "analitica", "tecnologia"],
    "ciencias-sociales":["finanzas", "analitica", "tecnologia"],
    tecnologia:         ["medioambiente", "geociencias", "personas"],
    comunicacion:       ["finanzas", "geociencias", "medioambiente"]
  };

  let domainExclusions = [];
  if (normalizedCareer) {
    for (const [domain, careers] of Object.entries(DOMAIN_CAREERS)) {
      if (careers.includes(normalizedCareer)) {
        domainExclusions = DOMAIN_EXCLUSIONS[domain] || [];
        break;
      }
    }
  }

  if (!careerSpecificInterests || careerSpecificInterests.length === 0) {
    return GENERAL_INTERESTS.filter(val => !domainExclusions.includes(val));
  }
  return GENERAL_INTERESTS.filter(val => {
    if (EXCLUDE_IF_NOT_SPECIFIC.has(val)) {
      return careerSpecificInterests.includes(val);
    }
    if (domainExclusions.includes(val)) return false;
    return true;
  });
}

/**
 * Reconstruye el grid según la carrera seleccionada.
 * Intereses específicos (core) primero, generales después.
 * Preserva selecciones al cambiar de carrera.
 */
function renderInterestsForCareer(rawDegree) {
  const grid = document.querySelector(".interests-grid");
  const hint = document.getElementById("interests-suggestion-hint");

  if (!grid) {
    console.warn("[render] ABORTADO — no se encontró .interests-grid en el DOM");
    return;
  }

  currentRawDegree = rawDegree || "";

  const careerValue      = currentRawDegree;
  const canonical        = normalizeDegree(careerValue) || careerValue;
  const normalizedCareer = normalizeStr(canonical);

  const areas = getCareerSpecificInterests(normalizedCareer);

  grid.innerHTML = "";

  if (areas.length) {
    if (hint) {
      hint.textContent = "Te mostramos opciones comunes para Ingeniería Comercial, pero puedes elegir otras si quieres.";
      hint.className   = "interests-suggestion-hint";
      hint.hidden      = false;
    }

    areas.forEach((val) => {
      grid.appendChild(createInterestItem(val, INTEREST_REGISTRY[val] || val, true));
    });

    const sep = document.createElement("div");
    sep.className   = "interests-separator";
    sep.textContent = "Otras opciones";
    grid.appendChild(sep);

    const filteredGeneral = getFilteredGeneralInterests(areas, normalizedCareer)
      .filter((val) => !areas.includes(val));
    filteredGeneral.forEach((val) => {
      grid.appendChild(createInterestItem(val, INTEREST_REGISTRY[val] || val, false));
    });
  } else {
    const hasInput = careerValue.trim().length > 0;
    if (hint) {
      hint.textContent = hasInput
        ? "No encontramos una coincidencia exacta para tu carrera, pero puedes elegir entre estas áreas."
        : "";
      hint.className = "interests-suggestion-hint" + (hasInput ? " no-match" : "");
      hint.hidden    = !hasInput;
    }
    GENERAL_INTERESTS.forEach((val) => {
      grid.appendChild(createInterestItem(val, INTEREST_REGISTRY[val] || val, false));
    });
  }

  updateInterestUI();
}

/** Llamada desde el autocomplete de carrera */
function updateInterestSuggestions(rawDegree) {
  renderInterestsForCareer(rawDegree);
}

/**
 * TEST MANUAL — ejecuta desde la consola del navegador:
 *   window.testCareerInterests("Nutrición y Dietética")
 *   window.testCareerInterests("Ingeniería Comercial")
 */
window.testCareerInterests = function(carrera) {
  renderInterestsForCareer(carrera);
};

// ------------------------------------------------------------------ //
// Autocomplete de carrera (por categorías)
// ------------------------------------------------------------------ //

const CAREER_CATEGORIES = [
  { category: "Negocios", careers: ["Ingeniería Comercial"] }
];

/** Lista plana de carreras (para normalizeDegree y búsqueda) */
const CARRERAS = CAREER_CATEGORIES.flatMap((c) => c.careers);

/**
 * Aliases y abreviaciones comunes → carrera canónica.
 * Claves ya normalizadas (sin tildes, minúsculas).
 */
const CAREER_ALIASES = {
  "comercial":      "Ingeniería Comercial",
  "ing comercial":  "Ingeniería Comercial"
};

function initDegreeAutocomplete() {
  const input = document.getElementById("degree");
  const list  = document.getElementById("degree-suggestions");
  if (!input || !list) return;

  let activeIndex = -1;

  function norm(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  /** Construye el dropdown agrupado por categoría */
  function openList(matches) {
    list.innerHTML = "";
    activeIndex    = -1;

    if (!matches.length) { list.classList.remove("open"); return; }

    const grouped = CAREER_CATEGORIES
      .map((cat) => ({
        category: cat.category,
        items:    cat.careers.filter((c) => matches.includes(c))
      }))
      .filter((g) => g.items.length > 0);

    grouped.forEach((group) => {
      // Header de categoría (no seleccionable)
      const header = document.createElement("li");
      header.className   = "category-header";
      header.textContent = group.category;
      list.appendChild(header);

      group.items.forEach((carrera) => {
        const li = document.createElement("li");
        li.textContent = carrera;
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          input.value = carrera;
          list.classList.remove("open");
          updateInterestSuggestions(carrera);
        });
        list.appendChild(li);
      });
    });

    list.classList.add("open");
  }

  function closeList() {
    list.classList.remove("open");
    activeIndex = -1;
  }

  /** Solo navega entre items seleccionables (no headers) */
  function selectableItems() {
    return Array.from(list.querySelectorAll("li:not(.category-header)"));
  }

  function setActive(index) {
    selectableItems().forEach((li) => li.classList.remove("active"));
    const items = selectableItems();
    if (index >= 0 && index < items.length) {
      items[index].classList.add("active");
      items[index].scrollIntoView({ block: "nearest" });
    }
  }

  input.addEventListener("input", () => {
    const query = norm(input.value);
    if (!query) { closeList(); updateInterestSuggestions(""); return; }

    // Matches directos en la lista canónica
    const direct = CARRERAS.filter((c) => norm(c).includes(query));

    // Matches por alias: si el query coincide con una clave de alias, agregar la canónica
    const fromAlias = Object.entries(CAREER_ALIASES)
      .filter(([alias]) => alias.includes(query) || query.includes(alias))
      .map(([, canonical]) => canonical);

    openList([...new Set([...direct, ...fromAlias])]);
    updateInterestSuggestions(input.value);
  });

  input.addEventListener("keydown", (e) => {
    if (!list.classList.contains("open")) return;
    const items = selectableItems();
    if (!items.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      setActive(activeIndex);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      setActive(activeIndex);
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      input.value = items[activeIndex].textContent;
      closeList();
      updateInterestSuggestions(items[activeIndex].textContent);
    } else if (e.key === "Escape") {
      closeList();
    }
  });

  input.addEventListener("blur", () => {
    updateInterestSuggestions(input.value);
  });

  document.addEventListener("click", (e) => {
    if (!input.contains(e.target) && !list.contains(e.target)) closeList();
  });

  // Cambio 1: toggle degree-other
  const degreeOtherWrapper = document.getElementById("degree-other-wrapper");
  const toggleBtn          = document.getElementById("toggle-degree-other");

  if (toggleBtn && degreeOtherWrapper) {
    toggleBtn.addEventListener("click", () => {
      degreeOtherWrapper.hidden = false;
      toggleBtn.hidden = true;
    });
  }

  // Cuando el autocomplete hace match → ocultar wrapper
  // Cuando no hay matches y hay texto → mostrar toggle
  const originalOpenList = openList;
  input.addEventListener("input", () => {
    const query = input.value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    if (degreeOtherWrapper && toggleBtn) {
      if (!query) {
        degreeOtherWrapper.hidden = true;
        toggleBtn.hidden = false;
      }
    }
  });
}

// ------------------------------------------------------------------ //
// Lógica de áreas de interés (máx. 3, con prioridad)
// ------------------------------------------------------------------ //

function initInterests() {
  renderInterestsForCareer(""); // render inicial sin carrera
}

// ------------------------------------------------------------------ //
// Autocomplete de ciudad (Chile)
// ------------------------------------------------------------------ //

/**
 * Ciudades principales de Chile con su región.
 * Se usa para el autocomplete del campo de ubicación.
 * La región se guarda en un campo oculto para uso futuro en el backend.
 */
const CITIES = [
  { name: "Santiago",      region: "Región Metropolitana" },
  { name: "Antofagasta",   region: "Región de Antofagasta" },
  { name: "Calama",        region: "Región de Antofagasta" },
  { name: "Viña del Mar",  region: "Región de Valparaíso" },
  { name: "Valparaíso",    region: "Región de Valparaíso" },
  { name: "San Antonio",   region: "Región de Valparaíso" },
  { name: "La Serena",     region: "Región de Coquimbo" },
  { name: "Coquimbo",      region: "Región de Coquimbo" },
  { name: "Ovalle",        region: "Región de Coquimbo" },
  { name: "Copiapó",       region: "Región de Atacama" },
  { name: "Iquique",       region: "Región de Tarapacá" },
  { name: "Arica",         region: "Región de Arica y Parinacota" },
  { name: "Rancagua",      region: "Región del Libertador Gral. Bernardo O'Higgins" },
  { name: "Talca",         region: "Región del Maule" },
  { name: "Curicó",        region: "Región del Maule" },
  { name: "Linares",       region: "Región del Maule" },
  { name: "Chillán",       region: "Región de Ñuble" },
  { name: "Concepción",    region: "Región del Biobío" },
  { name: "Talcahuano",    region: "Región del Biobío" },
  { name: "Los Ángeles",   region: "Región del Biobío" },
  { name: "Temuco",        region: "Región de La Araucanía" },
  { name: "Valdivia",      region: "Región de Los Ríos" },
  { name: "Osorno",        region: "Región de Los Lagos" },
  { name: "Puerto Montt",  region: "Región de Los Lagos" },
  { name: "Punta Arenas",  region: "Región de Magallanes" }
];

function initCityAutocomplete() {
  const input       = document.getElementById("city");
  const list        = document.getElementById("city-suggestions");
  const regionInput = document.getElementById("cityRegion");
  if (!input || !list) return;

  let activeIndex = -1;

  function normalize(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  function openList(matches) {
    list.innerHTML = "";
    activeIndex = -1;
    if (!matches.length) { list.classList.remove("open"); return; }

    matches.forEach((city) => {
      const li = document.createElement("li");
      li.textContent = city.name;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.value = city.name;
        if (regionInput) regionInput.value = city.region;
        list.classList.remove("open");
      });
      list.appendChild(li);
    });

    list.classList.add("open");
  }

  function closeList() {
    list.classList.remove("open");
    activeIndex = -1;
  }

  function setActive(index) {
    const items = list.querySelectorAll("li");
    items.forEach((li) => li.classList.remove("active"));
    if (index >= 0 && index < items.length) {
      items[index].classList.add("active");
      items[index].scrollIntoView({ block: "nearest" });
    }
  }

  input.addEventListener("input", () => {
    const query = normalize(input.value);
    if (regionInput) regionInput.value = ""; // limpiar región si edita manualmente
    if (!query) { closeList(); return; }
    openList(CITIES.filter((c) => normalize(c.name).includes(query)).slice(0, 8));
  });

  input.addEventListener("keydown", (e) => {
    const items = list.querySelectorAll("li");
    if (!list.classList.contains("open") || !items.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      setActive(activeIndex);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      setActive(activeIndex);
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      const selected = CITIES.find((c) => c.name === items[activeIndex].textContent);
      input.value = items[activeIndex].textContent;
      if (regionInput && selected) regionInput.value = selected.region;
      closeList();
    } else if (e.key === "Escape") {
      closeList();
    }
  });

  document.addEventListener("click", (e) => {
    if (!input.contains(e.target) && !list.contains(e.target)) closeList();
  });
}

// ------------------------------------------------------------------ //
// Modalidad de trabajo
// ------------------------------------------------------------------ //

function initModality() {
  const nextBtn = document.getElementById("next-5");

  function updateModalityNext() {
    const anyChecked = [...document.querySelectorAll('input[name="desiredModality"]')].some(cb => cb.checked);
    if (nextBtn) nextBtn.disabled = !anyChecked;
  }

  document.querySelectorAll('input[name="desiredModality"]').forEach((cb) => {
    cb.addEventListener("change", () => {
      const label = cb.closest(".modality-option");
      if (label) label.classList.toggle("selected", cb.checked);
      updateModalityNext();
    });
  });

  updateModalityNext(); // estado inicial
}

// ------------------------------------------------------------------ //
// Preferencias de empresa
// ------------------------------------------------------------------ //

const COMPANY_PREFERENCE_OPTIONS = [
  { value: "empresas-grandes",   label: "Prefiero empresas grandes"              },
  { value: "startups",           label: "Prefiero startups"                      },
  { value: "impacto-social",     label: "Me interesa el impacto social"          },
  { value: "enfoque-ambiental",  label: "Prefiero empresas con enfoque ambiental" },
  { value: "estabilidad",        label: "Busco estabilidad laboral"              },
  { value: "crecimiento-rapido", label: "Me interesa crecimiento rápido"         }
];

// Estado: array de valores seleccionados + cuál es prioritaria
let selectedPreferences = [];   // valores seleccionados (máx. 3)
let priorityPreference  = null; // valor marcado como "más importante"

function renderPreferences() {
  const grid     = document.getElementById("preferences-grid");
  const counter  = document.getElementById("preferences-counter");
  const limitMsg = document.getElementById("preferences-limit-msg");
  if (!grid) return;

  const MAX     = 3;
  const count   = selectedPreferences.length;
  const atLimit = count >= MAX;

  if (counter) {
    counter.textContent = atLimit
      ? `Máximo alcanzado (${MAX}/${MAX})`
      : count === 0
        ? "Puedes elegir hasta 3"
        : `${count} de 3 elegida${count > 1 ? "s" : ""}`;
    counter.classList.toggle("at-limit", atLimit);
  }
  if (limitMsg) limitMsg.classList.toggle("visible", atLimit);

  grid.innerHTML = "";

  COMPANY_PREFERENCE_OPTIONS.forEach(({ value, label }) => {
    const isSelected = selectedPreferences.includes(value);
    const isPriority = priorityPreference === value;

    const item = document.createElement("div");
    item.className = "pref-item" +
      (isSelected ? " selected" : "") +
      (isPriority ? " priority" : "") +
      (!isSelected && atLimit ? " disabled" : "");

    // Botón de prioridad (solo visible si está seleccionado)
    const priorityBtn = isSelected
      ? `<button type="button" class="pref-priority-btn${isPriority ? " active" : ""}"
           title="${isPriority ? "Quitar prioridad" : "Marcar como más importante"}"
           data-value="${value}">
           ${isPriority ? "★ Más importante" : "☆ Marcar como importante"}
         </button>`
      : "";

    item.innerHTML = `
      <span class="pref-label">${label}</span>
      ${priorityBtn}`;

    // Clic en el item → seleccionar/deseleccionar
    item.addEventListener("click", (e) => {
      // Si el clic fue en el botón de prioridad, no toggle la selección
      if (e.target.closest(".pref-priority-btn")) return;

      if (isSelected) {
        selectedPreferences = selectedPreferences.filter((v) => v !== value);
        if (priorityPreference === value) priorityPreference = null;
      } else if (!atLimit) {
        selectedPreferences.push(value);
      }
      renderPreferences();
    });

    // Clic en botón de prioridad
    const btn = item.querySelector(".pref-priority-btn");
    if (btn) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        priorityPreference = isPriority ? null : value;
        renderPreferences();
      });
    }

    grid.appendChild(item);
  });
}

function initPreferences() {
  renderPreferences();
}

// ------------------------------------------------------------------ //
// Explore flow — pantallas de descubrimiento
// ------------------------------------------------------------------ //

// Estado del flujo explore
let exploreTaskPrefs      = [];  // máx 2
let exploreAvoid          = [];  // min 1, sin límite superior
let exploreMotivations    = [];  // min 1, máx 2
let selectedInferredAreas = [];  // áreas confirmadas (máx 2)
let exploreAreasInterest  = [];  // áreas explícitas de interés (min 1)
let exploreAreasAvoid     = [];  // áreas explícitas a evitar (opcional)

const EXPLORE_TASKS = [
  { value: "analizar-datos",    label: "Mirar información, encontrar patrones y llegar a conclusiones claras" },
  { value: "resolver-problemas",label: "Resolver problemas específicos con soluciones concretas" },
  { value: "trabajar-personas", label: "Coordinar con personas y trabajar en equipo para que las cosas avancen" },
  { value: "organizar-procesos",label: "Ordenar procesos y hacer que las cosas funcionen mejor" },
  { value: "crear-estrategias", label: "Pensar estrategias, priorizar y tomar decisiones con más visión" }
];

// Flat list — sin grupos, sin "industrias-no-van"
const EXPLORE_AVOID = [
  { value: "ventas-metas",          label: "Tener que cumplir metas comerciales o vender constantemente" },
  { value: "atencion-clientes",     label: "Estar en contacto constante con clientes o resolviendo sus requerimientos" },
  { value: "trabajo-repetitivo",    label: "Hacer tareas muy repetitivas, con poca variación" },
  { value: "trabajo-terreno",       label: "Trabajar moviéndome constantemente o fuera de oficina" },
  { value: "ambientes-competitivos",label: "Estar en ambientes muy competitivos o de presión permanente" }
];

const EXPLORE_MOTIVATIONS = [
  { value: "aprender",       label: "Aprender constantemente, aunque implique salir de mi zona de confort" },
  { value: "crecer-rapido",  label: "Crecer rápido profesionalmente, aunque sea exigente" },
  { value: "estabilidad",    label: "Tener estabilidad, aunque el crecimiento sea más lento" },
  { value: "buen-sueldo",    label: "Ganar buen sueldo, aunque haya más presión" },
  { value: "buen-ambiente",  label: "Tener buen ambiente laboral, aunque el sueldo no sea el más alto" },
  { value: "impacto",        label: "Trabajar en algo con impacto o propósito, aunque no sea lo más rentable" }
];

const EXPLORE_AREAS = [
  { value: "finanzas",        label: "Finanzas" },
  { value: "analitica",       label: "Analítica y datos" },
  { value: "control-gestion", label: "Control de Gestión" },
  { value: "comercial",       label: "Comercial y ventas" },
  { value: "marketing",       label: "Marketing" },
  { value: "operaciones",     label: "Operaciones" },
  { value: "personas",        label: "Personas / RRHH" },
  { value: "proyectos",       label: "Proyectos" },
  { value: "tecnologia",      label: "Tecnología (BA / Producto)" },
  { value: "emprendimiento",  label: "Emprendimiento" }
];

// Contenido específico por rol para el flujo explore.
// Claves: título exacto del catálogo (data/junior_roles.json).
// Campos: practice (qué hace) + howItLooks (cómo se vive en el día a día).
const ROLE_PRACTICE_CONTENT = {

  // ── ANALÍTICA ──────────────────────────────────────────────────────────
  "Analista de Datos Junior": {
    practice:   "Trabaja con datos para responder preguntas concretas del negocio: por qué cayeron las ventas en un período, qué clientes tienen señales de riesgo o dónde hay oportunidades sin explotar. El producto de este rol es siempre una conclusión que alguien puede usar para decidir.",
    howItLooks: "Cada encargo parte de una pregunta diferente, lo que hace el trabajo más exploratorio que rutinario. Se pasa tiempo limpiando información, buscando patrones y armando una explicación clara de lo que los datos dicen. El área de datos suele atender preguntas de múltiples equipos al mismo tiempo."
  },
  "Analista de Reporting Junior": {
    practice:   "Construye y mantiene los reportes y tableros que distintas áreas de la empresa usan para ver cómo está funcionando el negocio. Su trabajo garantiza que la información correcta llegue a las personas correctas de forma consistente y oportuna.",
    howItLooks: "El trabajo sigue un ritmo fijo: reportes semanales, cierres mensuales, dashboards que se actualizan con regularidad. El desafío no está en explorar datos nuevos, sino en asegurar que la información sea siempre confiable y llegue a tiempo. Se trabaja con múltiples áreas y se aprende rápido cómo se mueve el negocio desde adentro."
  },

  // ── FINANZAS ───────────────────────────────────────────────────────────
  "Analista Financiero Junior": {
    practice:   "Analiza cómo está parada la empresa financieramente: revisa ingresos, costos, rentabilidad y flujo de caja para convertir esos datos en conclusiones que la gerencia pueda usar para tomar decisiones.",
    howItLooks: "El trabajo sigue ciclos definidos: cierres mensuales, presupuesto anual, reportes trimestrales. Gran parte del tiempo se trabaja con modelos y estados financieros, interpretando qué hay detrás de los números. El perfil que encaja combina precisión numérica con capacidad de explicar qué significa un resultado para el negocio."
  },
  "Analista Control de Gestión Junior": {
    practice:   "Monitorea si la empresa está cumpliendo sus metas: compara lo planificado con lo que realmente ocurrió, identifica dónde hay desviaciones y ayuda a entender por qué. La gerencia usa este análisis para saber si el negocio va por buen camino.",
    howItLooks: "El trabajo es muy cercano al presupuesto y los indicadores de gestión. Se construyen reportes de seguimiento periódicos, se trabaja con distintas áreas para entender el contexto de cada variación, y se comunica directamente con quienes toman decisiones. La relación con la gerencia es frecuente."
  },
  "Asistente Contable Junior": {
    practice:   "Registra y ordena las transacciones financieras de la empresa: facturas, pagos, compras, conciliaciones. Su trabajo garantiza que cada movimiento quede correctamente capturado en los libros y que las cuentas cuadren al cierre.",
    howItLooks: "El trabajo es detallado y regular: los mismos tipos de registros, los mismos controles, los mismos plazos de cierre. Lo que importa es la precisión — un error se propaga. El ritmo lo marcan las fechas de cierre mensual y las obligaciones tributarias. Es un rol que da visibilidad concreta a cómo funciona la contabilidad de un negocio real."
  },

  // ── COMERCIAL ──────────────────────────────────────────────────────────
  "Analista Comercial Junior": {
    practice:   "Apoya al equipo de ventas con análisis que les ayudan a tomar mejores decisiones: mide el desempeño de canales y clientes, detecta oportunidades, identifica tendencias y alerta sobre riesgos comerciales. La diferencia entre un equipo comercial que actúa con criterio y uno que solo actúa está en este tipo de análisis.",
    howItLooks: "El trabajo combina análisis de datos comerciales con mucho contacto con el equipo de ventas. Se entienden los números desde adentro — por qué subió un canal, qué cliente está en riesgo, qué producto tiene más tracción. Es un rol analítico, pero orientado a lo que el área comercial necesita para operar mejor."
  },
  "Analista de Marketing Junior": {
    practice:   "Ejecuta y mide el desempeño de las acciones de marketing: campañas, contenido, activaciones. Trabaja para que las iniciativas de comunicación lleguen al público correcto y para que haya información que permita mejorar lo que no está funcionando.",
    howItLooks: "El trabajo tiene ciclos cortos: una campaña se lanza, se mide, se ajusta. Hay una parte más creativa — qué decir y cómo decirlo — y una parte más analítica — qué está funcionando y por qué. Se trabaja con agencias, diseñadores y equipos internos. El ritmo es más dinámico que en roles de finanzas o control."
  },

  // ── OPERACIONES ────────────────────────────────────────────────────────
  "Coordinador de Operaciones Junior": {
    practice:   "Coordina los procesos operativos del día a día: hace seguimiento de indicadores, gestiona incidencias y actúa como punto de contacto entre áreas para que los procesos no se detengan. Cuando algo falla o se traba, este rol participa en resolverlo.",
    howItLooks: "Las prioridades cambian con lo que la operación necesita, lo que hace el trabajo dinámico. Se trabaja con datos y con personas al mismo tiempo: hay que entender los números para saber qué está fallando, y hay que coordinar con equipos para corregirlo. El perfil que encaja combina capacidad analítica con orientación práctica."
  },
  "Analista de Logística Junior": {
    practice:   "Controla el flujo de productos e insumos a través de la cadena de abastecimiento: gestiona inventarios, coordina pedidos y hace seguimiento para que los productos lleguen a tiempo y en las condiciones correctas. Cualquier error en este flujo tiene un costo concreto e inmediato.",
    howItLooks: "El trabajo tiene mucha presión de plazos — los retrasos se notan de inmediato. Se trabaja con proveedores, bodegas y equipos internos al mismo tiempo. El detalle importa: una diferencia en el inventario o un pedido mal registrado se convierte rápidamente en un problema operacional."
  },

  // ── PROYECTOS ──────────────────────────────────────────────────────────
  "Asistente de Proyectos Junior": {
    practice:   "Mantiene los proyectos en movimiento: hace seguimiento de tareas, actualiza el estado de avance, coordina compromisos entre los equipos involucrados y asegura que nada quede sin dueño. Sin este rol, los proyectos tienden a perder ritmo.",
    howItLooks: "El trabajo es más de coordinación que de análisis. Se gestiona información de múltiples frentes al mismo tiempo, se mantiene a todos alineados sobre qué está pasando y qué falta, y se trabaja de cerca con personas que tienen distintos roles y prioridades. El desafío es mantener el hilo sin tener autoridad directa sobre nadie."
  },

  // ── PERSONAS ───────────────────────────────────────────────────────────
  "Asistente de RRHH Junior": {
    practice:   "Apoya los procesos que hacen que las personas puedan trabajar bien dentro de una organización: reclutamiento, incorporación de nuevos empleados, documentación, bienestar y clima laboral. Es uno de los primeros puntos de contacto de los trabajadores con el área de personas.",
    howItLooks: "El trabajo combina tareas concretas — publicar ofertas, coordinar entrevistas, actualizar contratos — con momentos de mayor contacto humano, como organizar iniciativas de clima o comunicación interna. La discreción es fundamental: se maneja información sensible de personas de forma constante."
  },

  // ── DERECHO ────────────────────────────────────────────────────────────
  "Asistente Legal Junior": {
    practice:   "Apoya al área legal en la revisión de contratos, preparación de documentación y seguimiento de procesos jurídicos. Su trabajo garantiza que los compromisos legales de la empresa estén correctamente registrados y que nada quede sin gestionar.",
    howItLooks: "El trabajo es principalmente documental y de revisión: contratos, minutas, poderes, notificaciones. Requiere atención extrema al detalle y manejo de lenguaje formal. Hay plazos que no se pueden mover y consecuencias directas si algo se pierde. Es un rol de soporte que hace que el área legal funcione con orden."
  },
  "Analista de Compliance Junior": {
    practice:   "Verifica que la empresa cumpla con las regulaciones que le aplican: leyes sectoriales, políticas internas, estándares de la industria. Cuando hay un riesgo de incumplimiento, este rol lo identifica y trabaja para resolverlo antes de que se convierta en un problema.",
    howItLooks: "El trabajo combina revisión de normativas, análisis de procesos internos y reporte a la gerencia. Se trabaja con distintas áreas para verificar que sus prácticas estén alineadas con lo que exige la regulación. Requiere criterio, capacidad de comunicar con claridad y comodidad trabajando con ambigüedad normativa."
  },

  // ── NEGOCIOS ───────────────────────────────────────────────────────────
  "Analista de Customer Success Junior": {
    practice:   "Acompaña a los clientes después de que contratan un servicio o producto: se asegura de que lo estén usando bien, resuelve dudas y problemas, y trabaja para que cada cliente sienta que está obteniendo el valor que esperaba. El objetivo es que se queden y crezcan.",
    howItLooks: "Mucho contacto con clientes vía correo, videollamada o reuniones. El trabajo combina escucha activa, resolución de problemas y capacidad de explicar cosas con claridad. El foco está en la relación y el éxito del cliente, no solo en resolver incidencias. Se aprende rápido cómo un producto genera valor en la práctica."
  },

  // ── TECNOLOGÍA ─────────────────────────────────────────────────────────
  "Desarrollador Web Junior": {
    practice:   "Construye y mantiene aplicaciones o sitios web: escribe el código que hace que algo funcione para quien lo usa. El trabajo consiste en traducir requisitos de negocio o de diseño en experiencias funcionales.",
    howItLooks: "El proceso es iterativo: se construye algo, se prueba, se corrige, se mejora. Hay colaboración constante con diseñadores, analistas y otros desarrolladores. Lo que distingue a alguien que crece rápido en este rol es entender el propósito de lo que está construyendo, no solo el código."
  },
  "QA Tester Junior": {
    practice:   "Verifica que el software funcione correctamente antes de llegar a los usuarios: busca errores, casos borde y comportamientos inesperados. Su trabajo protege la calidad de lo que desarrolla el equipo.",
    howItLooks: "Parte del tiempo se diseñan casos de prueba — qué escenarios podrían romper algo — y parte se ejecutan. El desafío intelectual está en pensar como un usuario que hace todo lo que no debería, y hacerlo de forma sistemática. Encontrar el error es solo la mitad del trabajo; comunicarlo con precisión es la otra."
  },
  "Analista de Soporte TI Junior": {
    practice:   "Es el primer punto de contacto cuando algo tecnológico falla dentro de la empresa: computadores, sistemas, conectividad, accesos. Diagnostica el problema y lo resuelve — o lo escala — para que las personas puedan seguir trabajando.",
    howItLooks: "Trabajo con personas todo el tiempo — el usuario que llega está frustrado y necesita una solución rápida. Requiere paciencia, diagnóstico bajo presión y la habilidad de explicar soluciones técnicas a personas no técnicas. El ritmo lo define la demanda: hay días tranquilos y días donde todo falla al mismo tiempo."
  },

  // ── DISEÑO ─────────────────────────────────────────────────────────────
  "Diseñador UX/UI Junior": {
    practice:   "Diseña la experiencia que tienen los usuarios al interactuar con aplicaciones o sitios web: cómo se ve, cómo se navega y qué tan fácil es lograr lo que se quiere. El objetivo es que algo funcione bien para quien lo usa, no solo que se vea bien.",
    howItLooks: "El proceso parte entendiendo al usuario y termina en diseños concretos que el equipo de desarrollo puede implementar. Hay mucha iteración: los primeros diseños casi nunca son los finales. Se trabaja en estrecha colaboración con producto, desarrollo y negocio, y se aprende a defender decisiones de diseño con argumentos de usabilidad."
  },

  // ── COMUNICACIÓN ───────────────────────────────────────────────────────
  "Community Manager Junior": {
    practice:   "Gestiona la presencia de una marca en redes sociales: crea contenido, programa publicaciones, responde a la comunidad y mide cómo está funcionando cada canal. Es la voz pública de la marca en el mundo digital.",
    howItLooks: "El trabajo tiene mucho componente creativo — qué decir, cómo decirlo, con qué formato — y también analítico — qué está funcionando y por qué. Los canales digitales exigen presencia regular y respuesta oportuna. El ritmo es constante y hay que adaptarse al tono de cada plataforma."
  },
  "Redactor de Contenidos Junior": {
    practice:   "Produce textos para distintos canales y propósitos: artículos, correos, fichas de producto, guiones. El trabajo consiste en comunicar ideas de forma clara, atractiva y adaptada a quien va a leer, en el formato correcto para cada canal.",
    howItLooks: "Cada encargo tiene un contexto diferente: un artículo de blog no es lo mismo que un correo de ventas o un post para redes. Se trabaja con brief — instrucciones sobre qué comunicar y a quién — y se pasa por varias rondas de edición antes de publicar. La relación con marketing, comunicaciones o producto es constante."
  },
  "Relacionador Público Junior": {
    practice:   "Construye y cuida las relaciones que permiten que una organización sea percibida de la manera que necesita: trabaja con medios de comunicación, autoridades y públicos estratégicos para gestionar la imagen y reputación institucional.",
    howItLooks: "Mucho contacto con periodistas, instituciones y stakeholders. Hay trabajo de redacción — comunicados, notas de prensa — pero también de coordinación y seguimiento de relaciones. El criterio importa más que los procesos, especialmente en situaciones de crisis donde el margen de error es pequeño."
  },

  // ── GEOCIENCIAS ────────────────────────────────────────────────────────
  "Analista GIS Junior": {
    practice:   "Trabaja con información geográfica y espacial para analizar territorios e identificar patrones en el espacio. Se usa para apoyar decisiones que dependen de dónde ocurren las cosas: planificación territorial, recursos naturales, infraestructura.",
    howItLooks: "El trabajo combina análisis de datos con visualización cartográfica. Se trabaja con capas de información georreferenciada y se producen mapas o reportes que ayudan a equipos técnicos y directivos a tomar decisiones sobre el territorio. Requiere pensamiento espacial y capacidad de traducir análisis complejos en algo visual y comunicable."
  },

  // ── MEDIOAMBIENTE ──────────────────────────────────────────────────────
  "Analista Ambiental Junior": {
    practice:   "Apoya proyectos relacionados con el cumplimiento ambiental, la evaluación de impactos y la gestión de recursos. El trabajo consiste en asegurar que los procesos o proyectos de una organización cumplan con la normativa ambiental y minimicen su impacto.",
    howItLooks: "Combina trabajo de escritorio — informes técnicos, revisión de normativas, análisis de datos ambientales — con trabajo en terreno, como monitoreo o visitas a sitios. Se trabaja con equipos multidisciplinarios y se navegan procesos regulatorios que son lentos y exigen precisión documental."
  },

  // ── EDUCACIÓN ──────────────────────────────────────────────────────────
  "Coordinador Académico Junior": {
    practice:   "Apoya la gestión de procesos educativos dentro de una institución: coordina cursos, programas o actividades académicas, y sirve de punto de contacto entre estudiantes, docentes y administración para que todo funcione.",
    howItLooks: "El trabajo combina coordinación operativa — inscripciones, calendarios, materiales — con trato directo con personas que tienen distintas necesidades y expectativas. Se trabaja bajo plazos rígidos y la capacidad de gestionar múltiples frentes simultáneamente es fundamental. Los períodos de inicio de semestre son los más intensos."
  }
};

/**
 * Heurística de inferencia de áreas.
 * Tasks son la señal positiva principal, avoid resta, motivations no puntúan directo.
 * Se devuelven las top 3 áreas con su score y descripción.
 */
const AREA_SCORE_MAP = {
  // Tasks (señal positiva principal)
  "analizar-datos":     { "analitica": 3, "finanzas": 2, "control-gestion": 1 },
  "trabajar-personas":  { "personas": 3, "comercial": 2, "operaciones": 1 },
  "resolver-problemas": { "operaciones": 2, "analitica": 2, "proyectos": 1, "tecnologia": 1 },
  "organizar-procesos": { "operaciones": 3, "proyectos": 2, "control-gestion": 1 },
  "crear-estrategias":  { "comercial": 2, "finanzas": 2, "marketing": 1, "emprendimiento": 1 },
  // Avoid (restan puntos)
  "ventas-metas":           { "comercial": -3 },
  "atencion-clientes":      { "comercial": -2, "personas": -1 },
  "trabajo-repetitivo":     { "operaciones": -2, "contabilidad": -1 },
  "trabajo-terreno":        { "medioambiente": -2, "geociencias": -2 },
  "ambientes-competitivos": { "comercial": -1, "finanzas": -1 },
  "industrias-no-van":      {}  // señal cualitativa, no puntúa
};

const AREA_DESCRIPTIONS = {
  "analitica":       "Analizar información, encontrar patrones y ayudar a tomar decisiones basadas en datos.",
  "finanzas":        "Trabajar con números, entender cómo se mueve la plata en una empresa y apoyar decisiones importantes.",
  "comercial":       "Relacionarte con clientes, generar negocio y trabajar orientado a resultados concretos.",
  "operaciones":     "Ordenar procesos, coordinar equipos y hacer que las cosas funcionen bien.",
  "proyectos":       "Planificar, hacer seguimiento y asegurarte de que los equipos avancen hacia el objetivo.",
  "personas":        "Acompañar equipos, gestionar talento y trabajar en todo lo que tiene que ver con las personas en una organización.",
  "tecnologia":      "Construir soluciones, resolver problemas con lógica y aprender herramientas técnicas constantemente.",
  "marketing":       "Comunicar marcas, gestionar campañas digitales y medir el impacto de cada acción.",
  "emprendimiento":  "Crear o hacer crecer negocios, tomar decisiones con incertidumbre y moverse rápido.",
  "control-gestion": "Seguir cómo va una empresa, detectar desviaciones y ayudar a que las cosas funcionen mejor.",
  "medioambiente":   "Gestión ambiental, sustentabilidad y evaluación de impacto.",
  "geociencias":     "Exploración, geotecnia, minería e hidrogeología."
};

function inferAreas() {
  const scores = {};

  // Sumar puntos de tasks y avoid
  const allSelections = [...exploreTaskPrefs, ...exploreAvoid];
  for (const sel of allSelections) {
    const mapping = AREA_SCORE_MAP[sel];
    if (!mapping) continue;
    for (const [area, pts] of Object.entries(mapping)) {
      scores[area] = (scores[area] || 0) + pts;
    }
  }

  // Señal explícita de áreas: +4 por interés declarado, -3 por descarte declarado
  for (const area of exploreAreasInterest) {
    scores[area] = (scores[area] || 0) + 4;
  }
  for (const area of exploreAreasAvoid) {
    scores[area] = (scores[area] || 0) - 3;
  }

  // Ordenar por score descendente, filtrar los que tienen score > 0
  const ranked = Object.entries(scores)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([area, score]) => ({
      value: area,
      label: INTEREST_REGISTRY[area] || area,
      description: AREA_DESCRIPTIONS[area] || "",
      score
    }));

  // Si no hay resultados, usar áreas explícitas de interés o fallback neutro
  if (ranked.length === 0) {
    const fallback = exploreAreasInterest.length > 0
      ? exploreAreasInterest.slice(0, 3)
      : ["analitica", "operaciones", "proyectos"];
    return fallback.map(a => ({
      value: a,
      label: INTEREST_REGISTRY[a] || a,
      description: AREA_DESCRIPTIONS[a] || "",
      score: 0
    }));
  }

  return ranked;
}

/**
 * Renderiza un grid de opciones explore.
 * onChangeCallback(selectedArr) se llama cada vez que cambia la selección.
 */
function renderExploreGrid(containerId, options, selectedArr, maxSelections, onChangeCallback) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  grid.innerHTML = "";

  const atLimit = maxSelections && selectedArr.length >= maxSelections;

  options.forEach(({ value, label }) => {
    const isSelected = selectedArr.includes(value);
    const card = document.createElement("div");
    card.className = "explore-option" +
      (isSelected ? " selected" : "") +
      (!isSelected && atLimit ? " disabled" : "");
    card.innerHTML = `<span class="explore-option-check">✓</span><span>${label}</span>`;

    card.addEventListener("click", () => {
      if (isSelected) {
        selectedArr.splice(selectedArr.indexOf(value), 1);
      } else if (!maxSelections || selectedArr.length < maxSelections) {
        selectedArr.push(value);
      }
      renderExploreGrid(containerId, options, selectedArr, maxSelections, onChangeCallback);
      if (onChangeCallback) onChangeCallback(selectedArr);
    });

    grid.appendChild(card);
  });
}

/**
 * Renderiza el grid de áreas explícitas (interés / evitar).
 * Evita contradicciones: si un área está en el otro array, no se puede seleccionar aquí.
 */
function renderExploreAreasGrid(containerId, options, selectedArr, oppositeArr, onChangeCallback) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  grid.innerHTML = "";

  options.forEach(({ value, label }) => {
    const isSelected = selectedArr.includes(value);
    const isBlocked  = oppositeArr.includes(value);
    const card = document.createElement("div");
    card.className = "explore-option" +
      (isSelected ? " selected" : "") +
      (isBlocked ? " disabled" : "");
    card.innerHTML = `<span class="explore-option-check">✓</span><span>${label}</span>`;

    card.addEventListener("click", () => {
      if (isBlocked) return;
      if (isSelected) {
        selectedArr.splice(selectedArr.indexOf(value), 1);
      } else {
        selectedArr.push(value);
      }
      renderExploreAreasGrid(containerId, options, selectedArr, oppositeArr, onChangeCallback);
      if (onChangeCallback) onChangeCallback();
    });

    grid.appendChild(card);
  });
}

// Mapeo de tasks a descripciones naturales para la frase explicativa
const TASK_NATURAL = {
  "analizar-datos":    "se analizan datos",
  "trabajar-personas": "se trabaja con personas",
  "resolver-problemas":"se resuelven problemas",
  "organizar-procesos":"se organizan procesos",
  "crear-estrategias": "se crean estrategias"
};

const AVOID_NATURAL = {
  "ventas-metas":           "lo comercial",
  "atencion-clientes":      "la atención a clientes",
  "trabajo-repetitivo":     "lo repetitivo",
  "trabajo-terreno":        "el trabajo en terreno",
  "ambientes-competitivos": "ambientes muy competitivos",
  "industrias-no-van":      "industrias que no van contigo"
};

function buildConfirmExplanation() {
  const tasks  = exploreTaskPrefs;
  const avoids = exploreAvoid;
  const motivs = exploreMotivations;
  const areasI = exploreAreasInterest;

  // Señales de perfil — tareas
  const isAnalytic  = tasks.includes("analizar-datos") || tasks.includes("resolver-problemas");
  const isOrderly   = tasks.includes("organizar-procesos");
  const isStrategic = tasks.includes("crear-estrategias");
  const isPeople    = tasks.includes("trabajar-personas");

  // Señales de evitar
  const avoidsClients = avoids.includes("atencion-clientes") || avoids.includes("ventas-metas");
  const avoidsRepeat  = avoids.includes("trabajo-repetitivo");
  const avoidsCompete = avoids.includes("ambientes-competitivos");
  const avoidsTerrain = avoids.includes("trabajo-terreno");

  // Señales de motivación
  const wantsLearning  = motivs.includes("aprender");
  const wantsGrowth    = motivs.includes("crecer-rapido");
  const wantsStability = motivs.includes("estabilidad");
  const wantsImpact    = motivs.includes("impacto");

  // Señal de áreas explícitas (refuerzo)
  const hasAnalyticArea  = areasI.some(a => ["analitica","finanzas","control-gestion"].includes(a));
  const hasPeopleArea    = areasI.includes("personas");
  const hasOpsArea       = areasI.includes("operaciones") || areasI.includes("proyectos");

  // Clasificar perfil predominante
  let profile = "mixto";
  if ((isAnalytic || isOrderly) && avoidsClients)      profile = "analitico";
  else if (isAnalytic && isOrderly)                    profile = "analitico";
  else if (isAnalytic || hasAnalyticArea)              profile = "analitico";
  else if (isPeople && !avoidsClients)                 profile = "relacional";
  else if (isOrderly && !isStrategic)                  profile = "operativo";
  else if (isStrategic && !isPeople && avoidsClients)  profile = "estrategico";
  else if (isStrategic)                                profile = "estrategico";

  // Frase base (perfil)
  const baseTexts = {
    analitico() {
      if (avoidsClients && avoidsTerrain)
        return "Parece que te acomoda más un trabajo donde puedas analizar, ordenar y sacar conclusiones, más que estar en contacto constante con clientes o en movimiento.";
      if (avoidsClients)
        return "Se ve que te atrae un trabajo donde puedas analizar información y tomar decisiones con criterio, más que uno centrado en atención a clientes o metas comerciales.";
      if (avoidsRepeat)
        return "Se ve que te motiva más un trabajo donde puedas pensar y resolver problemas concretos, más que repetir tareas muy definidas.";
      return "Se ve que te atrae un trabajo donde puedas analizar información, encontrar patrones y tomar decisiones con criterio.";
    },
    relacional() {
      if (avoidsCompete)
        return "Probablemente te sientas más cómodo en un ambiente colaborativo donde puedas conectar con personas y construir relaciones, más que en uno muy competitivo o de presión constante.";
      return "Se ve que te motiva un trabajo donde puedas trabajar con personas, acompañar equipos y generar resultados de forma colaborativa.";
    },
    operativo() {
      if (avoidsRepeat)
        return "Parece que te acomoda un trabajo donde puedas ordenar y mejorar procesos, más que uno donde todo ya esté definido y no haya margen para cambiar cómo se hacen las cosas.";
      return "Parece que te acomoda un trabajo donde puedas coordinar, ordenar y asegurarte de que los procesos funcionen bien.";
    },
    estrategico() {
      if (avoidsClients)
        return "Se ve que te motiva más pensar el negocio y proponer iniciativas con criterio, más que estar en la línea comercial directa.";
      return "Se ve que te motiva un trabajo donde puedas crear estrategias, proponer iniciativas y pensar con visión de negocio.";
    },
    mixto() {
      if (isAnalytic && isStrategic)
        return "Probablemente te sientas cómodo en roles que combinen análisis con visión: leer información y usarla para tomar decisiones que importen.";
      if (isPeople && isAnalytic)
        return "Hay señales de un perfil que mezcla lo relacional con lo analítico. Probablemente disfrutes roles donde trabajar con personas y trabajar con datos no sean cosas separadas.";
      return "Hay señales de un perfil versátil. Probablemente te sientas cómodo en roles que combinen análisis, coordinación y trato con personas.";
    }
  };

  let text = (baseTexts[profile] || baseTexts.mixto)();

  // Segunda frase: motivación o señal de áreas explícitas
  let extra = "";
  if (wantsLearning) {
    extra = " El interés en seguir aprendiendo orienta a roles con curva activa y entornos donde se aprende haciendo.";
  } else if (wantsGrowth && !wantsStability) {
    extra = " El interés en crecer rápido orienta a entornos más exigentes donde hay más responsabilidad desde temprano.";
  } else if (wantsStability) {
    extra = " La búsqueda de estabilidad orienta más a empresas con procesos definidos y culturas establecidas.";
  } else if (wantsImpact) {
    extra = " El interés en impacto orienta a organizaciones donde el trabajo tiene un efecto visible más allá de los resultados comerciales.";
  }

  return text + extra;
}

function renderExploreConfirm() {
  const grid    = document.getElementById("explore-confirm-grid");
  const nextBtn = document.getElementById("next-explore-confirm");
  const hintEl  = document.getElementById("explore-confirm-hint");
  if (!grid) return;
  grid.innerHTML = "";

  const explainEl = document.getElementById("explore-confirm-explanation");
  if (explainEl) {
    explainEl.innerHTML = `<p class="muted">${buildConfirmExplanation()}</p>`;
  }

  const inferred = inferAreas();
  selectedInferredAreas = [];
  if (nextBtn) nextBtn.disabled = true;
  if (hintEl)  hintEl.hidden = true;

  const headerEl = document.createElement("div");
  headerEl.className = "explore-confirm-header";
  headerEl.innerHTML = `<p class="explore-confirm-section-label">Con todo lo que nos contaste, estas áreas se ven más cercanas a ti:</p>`;
  grid.appendChild(headerEl);

  inferred.forEach(({ value, label, description }) => {
    const card = document.createElement("div");
    card.className = "explore-confirm-card";
    card.innerHTML = `
      <span class="explore-option-check">✓</span>
      <h3>${label}</h3>
      <p class="muted">${description}</p>`;

    card.addEventListener("click", () => {
      const idx = selectedInferredAreas.indexOf(value);
      if (idx >= 0) {
        selectedInferredAreas.splice(idx, 1);
        card.classList.remove("selected");
      } else if (selectedInferredAreas.length < 2) {
        selectedInferredAreas.push(value);
        card.classList.add("selected");
      }
      const hasSelection = selectedInferredAreas.length > 0;
      if (nextBtn) nextBtn.disabled = !hasSelection;
      if (hintEl)  hintEl.hidden = hasSelection;
    });

    grid.appendChild(card);
  });

  const instrEl = document.createElement("p");
  instrEl.className = "muted explore-confirm-instruction";
  instrEl.style.marginTop = "12px";
  instrEl.textContent = "Elige 1 o 2 caminos que sientas más cercanos a ti ahora.";
  grid.appendChild(instrEl);
}

// Explore step sequence: explore-areas → explore-1 → explore-2 → explore-3 → explore-confirm
const EXPLORE_STEP_IDS = ["step-explore-areas", "step-explore-1", "step-explore-2", "step-explore-3", "step-explore-confirm"];
let currentExploreStep = 0;

function showExploreStep(idx) {
  document.querySelectorAll(".step").forEach(s => { s.hidden = true; });
  const target = document.getElementById(EXPLORE_STEP_IDS[idx]);
  if (target) target.hidden = false;
  currentExploreStep = idx;

  // idx 0→3, 1→4, 2→5, 3→6, 4→7 (de 9 pasos totales)
  const progressStep = 3 + idx;
  updateExploreProgress(progressStep);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateExploreProgress(step) {
  const total = 9; // 1:carrera, 2:etapa, 3-6:explore screens, 7:CV, 8:ciudad, 9:resumen
  const fill = document.getElementById("step-progress-fill");
  const label = document.getElementById("step-progress-label");
  const pct = Math.round((step / total) * 100);
  if (fill)  fill.style.width = pct + "%";
  if (label) label.textContent = `Paso ${step} de ${total}`;
}

function initExploreFlow() {
  // ── Render grids ──────────────────────────────────────────────────────

  // explore-areas: dos grids que se sincronizan (interés / evitar)
  function refreshAreasGrids() {
    renderExploreAreasGrid("explore-areas-interest-grid", EXPLORE_AREAS, exploreAreasInterest, exploreAreasAvoid, refreshAreasGrids);
    renderExploreAreasGrid("explore-areas-avoid-grid",    EXPLORE_AREAS, exploreAreasAvoid,    exploreAreasInterest, refreshAreasGrids);
    const nextBtn = document.getElementById("next-explore-areas");
    const hintEl  = document.getElementById("explore-areas-hint");
    const hasMin  = exploreAreasInterest.length > 0;
    if (nextBtn) nextBtn.disabled = !hasMin;
    if (hintEl)  hintEl.hidden = hasMin;
  }
  refreshAreasGrids();

  // explore-1 (tareas)
  renderExploreGrid("explore-tasks-grid", EXPLORE_TASKS, exploreTaskPrefs, 2, (arr) => {
    const nextBtn = document.getElementById("next-explore-1");
    const hintEl  = document.getElementById("explore-tasks-hint");
    if (nextBtn) nextBtn.disabled = arr.length === 0;
    if (hintEl)  hintEl.hidden = arr.length > 0;
  });
  const nextExplore1Btn = document.getElementById("next-explore-1");
  if (nextExplore1Btn) nextExplore1Btn.disabled = exploreTaskPrefs.length === 0;

  // explore-2 (evitar) — ahora flat, validación mínimo 1
  renderExploreGrid("explore-avoid-grid", EXPLORE_AVOID, exploreAvoid, null, (arr) => {
    const nextBtn = document.getElementById("next-explore-2");
    const hintEl  = document.getElementById("explore-avoid-hint");
    if (nextBtn) nextBtn.disabled = arr.length === 0;
    if (hintEl)  hintEl.hidden = arr.length > 0;
  });
  const nextExplore2Btn = document.getElementById("next-explore-2");
  if (nextExplore2Btn) nextExplore2Btn.disabled = exploreAvoid.length === 0;

  // explore-3 (motivación) — validación mínimo 1
  renderExploreGrid("explore-motivation-grid", EXPLORE_MOTIVATIONS, exploreMotivations, 2, (arr) => {
    const nextBtn = document.getElementById("next-explore-3");
    const hintEl  = document.getElementById("explore-motivation-hint");
    if (nextBtn) nextBtn.disabled = arr.length === 0;
    if (hintEl)  hintEl.hidden = arr.length > 0;
  });
  const nextExplore3Btn = document.getElementById("next-explore-3");
  if (nextExplore3Btn) nextExplore3Btn.disabled = exploreMotivations.length === 0;

  // ── Navegación ────────────────────────────────────────────────────────

  // explore-areas (idx 0)
  document.getElementById("back-explore-areas")?.addEventListener("click", () => showStep(2));
  document.getElementById("next-explore-areas")?.addEventListener("click", () => {
    if (exploreAreasInterest.length === 0) {
      const hintEl = document.getElementById("explore-areas-hint");
      if (hintEl) hintEl.hidden = false;
      return;
    }
    showExploreStep(1);
  });

  // explore-1 (idx 1)
  document.getElementById("back-explore-1")?.addEventListener("click", () => showExploreStep(0));
  document.getElementById("next-explore-1")?.addEventListener("click", () => {
    if (exploreTaskPrefs.length === 0) {
      const hintEl = document.getElementById("explore-tasks-hint");
      if (hintEl) hintEl.hidden = false;
      return;
    }
    showExploreStep(2);
  });

  // explore-2 (idx 2)
  document.getElementById("back-explore-2")?.addEventListener("click", () => showExploreStep(1));
  document.getElementById("next-explore-2")?.addEventListener("click", () => {
    if (exploreAvoid.length === 0) {
      const hintEl = document.getElementById("explore-avoid-hint");
      if (hintEl) hintEl.hidden = false;
      return;
    }
    showExploreStep(3);
  });

  // explore-3 (idx 3)
  document.getElementById("back-explore-3")?.addEventListener("click", () => showExploreStep(2));
  document.getElementById("next-explore-3")?.addEventListener("click", () => {
    if (exploreMotivations.length === 0) {
      const hintEl = document.getElementById("explore-motivation-hint");
      if (hintEl) hintEl.hidden = false;
      return;
    }
    renderExploreConfirm();
    showExploreStep(4);
  });

  // explore-confirm (idx 4)
  document.getElementById("back-explore-confirm")?.addEventListener("click", () => showExploreStep(3));
  document.getElementById("next-explore-confirm")?.addEventListener("click", () => {
    if (selectedInferredAreas.length === 0) {
      const hintEl = document.getElementById("explore-confirm-hint");
      if (hintEl) hintEl.hidden = false;
      return;
    }
    selectedInterests = [...selectedInferredAreas];
    showStep(4); // CV step
  });
}

// ------------------------------------------------------------------ //
// Step 0 — Selección de modo (guided / explore)
// ------------------------------------------------------------------ //

function initIntentStep() {
  const stepIntent   = document.getElementById("step-intent");
  const cvForm       = document.getElementById("cv-form");
  const stepProgress = document.getElementById("step-progress");
  const continueBtn  = document.getElementById("intent-continue");
  // Solo las cards con data-mode (no las de CV choice)
  const intentCards  = document.querySelectorAll(".intent-card[data-mode]");

  if (!stepIntent) return;

  intentCards.forEach((card) => {
    card.addEventListener("click", () => {
      intentCards.forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      userIntentMode = card.dataset.mode;
      continueBtn.disabled = false;
    });
  });

  continueBtn.addEventListener("click", () => {
    if (!userIntentMode) return;
    stepIntent.hidden = true;
    cvForm.hidden = false;
    stepProgress.hidden = false;
    updateInterestStepCopy();
    showStep(1);
  });
}

// ------------------------------------------------------------------ //
// Multi-step form
// ------------------------------------------------------------------ //

let currentStep = 1;
let cvChoice    = null; // "yes" | "no"
const TOTAL_STEPS = 5;

function showStep(n) {
  document.querySelectorAll(".step").forEach((s) => { s.hidden = true; });
  const target = document.getElementById(`step-${n}`);
  if (target) target.hidden = false;
  currentStep = n;
  updateProgress(n);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateProgress(n) {
  const fill  = document.getElementById("step-progress-fill");
  const label = document.getElementById("step-progress-label");

  if (userIntentMode === "explore") {
    // 1:carrera, 2:etapa, 3-7:explore screens, 8:CV, 9:ciudad (resumen eliminado)
    const exploreMap = { 1: 1, 2: 2, 4: 8, 5: 9 };
    const total = 9;
    const mapped = exploreMap[n] || n;
    const pct = Math.round((mapped / total) * 100);
    if (fill)  fill.style.width = pct + "%";
    if (label) label.textContent = `Paso ${mapped} de ${total}`;
  } else {
    const displayStep = Math.min(n, TOTAL_STEPS);
    const pct = Math.round((displayStep / TOTAL_STEPS) * 100);
    if (fill)  fill.style.width = pct + "%";
    if (label) label.textContent = n <= TOTAL_STEPS ? `Paso ${n} de ${TOTAL_STEPS}` : "Revisión final";
  }
}

function validateStep(n) {
  clearStepError(n);
  if (n === 1) {
    const degree = document.getElementById("degree")?.value.trim();
    const other  = document.getElementById("degree_other")?.value.trim();
    if (!degree && !other) {
      showStepError(n, "Escribe tu carrera para continuar.");
      return false;
    }
  }
  if (n === 2) {
    if (!document.getElementById("academicStatus")?.value) {
      showStepError(n, "Elige tu etapa para continuar.");
      return false;
    }
  }
  return true;
}

function showStepError(n, msg) {
  const step = document.getElementById(`step-${n}`);
  let err = step?.querySelector(".step-error");
  if (!err) {
    err = document.createElement("p");
    err.className = "step-error status error";
    step?.querySelector(".step-actions")?.before(err);
  }
  err.textContent = msg;
}

function clearStepError(n) {
  document.getElementById(`step-${n}`)?.querySelector(".step-error")?.remove();
}

function updateInterestStepCopy() {
  const title = document.getElementById("interest-step-title");
  const note  = document.getElementById("interest-step-note");
  if (userIntentMode === "guided") {
    if (title) title.textContent = "¿Qué tipo de camino te interesa más hoy?";
    if (note)  note.textContent  = "No necesitas tenerlo completamente claro. Esto solo nos ayuda a acercarnos a opciones que hoy podrían hacer más sentido para ti.";
  } else {
    if (title) title.textContent = "¿Qué tipo de camino te interesa más hoy?";
    if (note)  note.textContent  = "No necesitas tenerlo completamente claro. Esto solo nos ayuda a acercarnos a opciones que hoy podrían hacer más sentido para ti.";
  }
}

function renderSummary() {
  const container = document.getElementById("summary-content");
  if (!container) return;

  const degree     = document.getElementById("degree")?.value.trim() ||
                     document.getElementById("degree_other")?.value.trim() || "—";
  const statusRaw  = document.getElementById("academicStatus")?.value || "";
  const hasPostgrad = document.getElementById("hasPostgrad")?.value === "true";
  const STATUS_LABELS = { estudiante: "Estoy estudiando", egresado: "Egresado", titulado: "Titulado" };
  const statusLabel = STATUS_LABELS[statusRaw] || statusRaw || "—";
  const statusBadge = statusLabel + (hasPostgrad ? " · Con postgrado" : "");

  const city    = document.getElementById("city")?.value.trim() || "";
  const mods    = getCheckedValues("desiredModality");
  const cvFile  = cvChoice === "yes" ? (document.getElementById("cv")?.files[0]?.name || null) : null;

  const interestValues = selectedInterests;
  const interestLabel  = userIntentMode === "explore" ? "Caminos elegidos" : "Intereses";
  const interestTags   = interestValues.length > 0
    ? interestValues.map((v) => `<span class="summary-tag summary-tag--interest">${INTEREST_REGISTRY[v] || v}</span>`).join("")
    : `<span class="summary-tag summary-tag--empty">Sin selección</span>`;

  const modTags = mods.length > 0
    ? mods.map((m) => `<span class="summary-tag summary-tag--mod">${m.charAt(0).toUpperCase() + m.slice(1)}</span>`).join("")
    : `<span class="summary-tag summary-tag--empty">Sin preferencia</span>`;

  container.innerHTML = `
    <div class="summary-v2">
      <div class="summary-degree-block">
        <p class="summary-degree-name">${degree}</p>
        <span class="summary-status-badge">${statusBadge}</span>
      </div>

      <div class="summary-tags-row">
        <div class="summary-tags-col">
          <p class="summary-col-label">${interestLabel}</p>
          <div class="summary-tags-list">${interestTags}</div>
        </div>
        <div class="summary-tags-col">
          <p class="summary-col-label">Modalidad</p>
          <div class="summary-tags-list">${modTags}</div>
        </div>
      </div>

      <div class="summary-tags-row summary-meta-row">
        <div class="summary-tags-col">
          <p class="summary-col-label">Ubicación</p>
          <div class="summary-tags-list">
            ${city
              ? `<span class="summary-tag summary-tag--meta">${city}</span>`
              : `<span class="summary-tag summary-tag--empty">Sin especificar</span>`}
          </div>
        </div>
        <div class="summary-tags-col">
          <p class="summary-col-label">CV</p>
          <div class="summary-tags-list">
            ${cvFile
              ? `<span class="summary-tag summary-tag--cv">${cvFile}</span>`
              : `<span class="summary-tag summary-tag--empty">Sin CV</span>`}
          </div>
        </div>
      </div>
    </div>`;
}

function initMultiStep() {
  if (!document.getElementById("cv-form")) return;

  // Step 1 next/back
  document.getElementById("next-1")?.addEventListener("click", () => {
    if (!validateStep(1)) return;
    showStep(2);
  });
  document.getElementById("back-1")?.addEventListener("click", () => {
    document.getElementById("cv-form").hidden     = true;
    document.getElementById("step-progress").hidden = true;
    document.getElementById("step-intent").hidden  = false;
  });

  // Step 2 next/back — BRANCHING POINT
  document.getElementById("next-2")?.addEventListener("click", () => {
    if (!validateStep(2)) return;
    if (userIntentMode === "explore") {
      // Enter explore flow
      showExploreStep(0);
    } else {
      showStep(3); // guided → interests
    }
  });
  document.getElementById("back-2")?.addEventListener("click", () => showStep(1));

  // Tarjetas de etapa académica (cambio 2)
  document.querySelectorAll(".academic-status-cards .intent-card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".academic-status-cards .intent-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      const statusInput = document.getElementById("academicStatus");
      if (statusInput) statusInput.value = card.dataset.status;

      // Mostrar pregunta de postgrado solo para titulados
      const postgradQ   = document.getElementById("postgrad-question");
      const postgradVal = document.getElementById("hasPostgrad");
      if (postgradQ) postgradQ.hidden = (card.dataset.status !== "titulado");
      if (postgradVal && card.dataset.status !== "titulado") postgradVal.value = "false";

      // Mostrar pregunta de último año solo para estudiantes
      const lastYearQ    = document.getElementById("last-year-question");
      const lastYearVal  = document.getElementById("isLastYear");
      const lastYearInfo = document.getElementById("last-year-info");
      if (lastYearQ) lastYearQ.hidden = (card.dataset.status !== "estudiante");
      if (lastYearVal && card.dataset.status !== "estudiante") lastYearVal.value = "";
      if (lastYearInfo) lastYearInfo.hidden = true;
      // Reset selección de tarjetas último año al cambiar etapa
      document.querySelectorAll(".last-year-cards .intent-card").forEach(c => c.classList.remove("selected"));

      const nextBtn = document.getElementById("next-2");
      if (nextBtn) {
        // Si es estudiante, esperar respuesta de último año antes de habilitar
        nextBtn.disabled = (card.dataset.status === "estudiante");
      }
    });
  });

  // Tarjetas de postgrado
  document.querySelectorAll(".postgrad-cards .intent-card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".postgrad-cards .intent-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      const postgradVal = document.getElementById("hasPostgrad");
      if (postgradVal) postgradVal.value = card.dataset.postgrad;
    });
  });

  // Tarjetas de último año (solo visibles cuando "Estoy estudiando" está seleccionado)
  document.querySelectorAll(".last-year-cards .intent-card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".last-year-cards .intent-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      const lastYearVal  = document.getElementById("isLastYear");
      const lastYearInfo = document.getElementById("last-year-info");
      if (lastYearVal) lastYearVal.value = card.dataset.lastyear;
      // Mostrar mensaje informativo solo si responde "No"
      if (lastYearInfo) lastYearInfo.hidden = (card.dataset.lastyear !== "false");
      // Habilitar siguiente
      const nextBtn = document.getElementById("next-2");
      if (nextBtn) nextBtn.disabled = false;
    });
  });

  // Step 3 (interests, guided only) next/back
  document.getElementById("next-3")?.addEventListener("click", () => showStep(4));
  document.getElementById("back-3")?.addEventListener("click", () => showStep(2));

  // Step 4 (CV) next/back
  document.getElementById("next-4")?.addEventListener("click", () => showStep(5));
  document.getElementById("back-4")?.addEventListener("click", () => {
    if (userIntentMode === "explore") {
      // Back from CV → explore-confirm (índice 4 en EXPLORE_STEP_IDS)
      showExploreStep(4);
    } else {
      showStep(3);
    }
  });

  // Step 5 (city/modality) next/back
  document.getElementById("next-5")?.addEventListener("click", () => {
    if (userIntentMode === "explore") {
      // Flujo explore: saltar step-6 y enviar directamente
      form.requestSubmit();
    } else {
      showStep(6);
      renderSummary();
    }
  });
  document.getElementById("back-5")?.addEventListener("click", () => showStep(4));

  // Step 6 (resumen) — solo back
  document.getElementById("back-6")?.addEventListener("click", () => showStep(5));

  // CV choice cards
  const cvYes       = document.getElementById("cv-yes-card");
  const cvNo        = document.getElementById("cv-no-card");
  const next4       = document.getElementById("next-4");
  const uploadArea  = document.getElementById("cv-upload-area");

  cvYes?.addEventListener("click", () => {
    cvChoice = "yes";
    cvYes.classList.add("selected");
    cvNo?.classList.remove("selected");
    if (uploadArea) uploadArea.hidden = false;
    if (next4) next4.disabled = false;
  });

  cvNo?.addEventListener("click", () => {
    cvChoice = "no";
    cvNo.classList.add("selected");
    cvYes?.classList.remove("selected");
    if (uploadArea) uploadArea.hidden = true;
    if (next4) next4.disabled = false;
  });
}

// ------------------------------------------------------------------ //
// Inicialización
// ------------------------------------------------------------------ //

if (form)        form.addEventListener("submit", handleFormSubmit);
if (resultsRoot) renderResults();
initIntentStep();
initMultiStep();
initExploreFlow();
initDegreeAutocomplete();
initCityAutocomplete();
initInterests();
initModality();
initPreferences();

// CV drop zone: actualizar nombre de archivo al seleccionar
(function initCvDropZone() {
  const cvInput    = document.getElementById("cv");
  const cvFileName = document.getElementById("cv-file-name");
  const dropZone   = document.getElementById("cv-drop-zone");
  if (!cvInput || !cvFileName) return;

  cvInput.addEventListener("change", () => {
    const file = cvInput.files[0];
    if (file) {
      cvFileName.textContent = file.name;
      if (dropZone) dropZone.classList.add("has-file");
    } else {
      cvFileName.textContent = "PDF o DOCX, máx. 10 MB";
      if (dropZone) dropZone.classList.remove("has-file");
    }
  });
})();
