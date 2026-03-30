const form          = document.getElementById("cv-form");
const formStatus    = document.getElementById("form-status");
const resultsRoot   = document.getElementById("results-root");
const loadingOverlay = document.getElementById("loading-overlay");

// Estado de intereses (ordenado por prioridad, máx. 3)
let selectedInterests = [];
let currentRawDegree  = "";

// Indicador global: si el usuario cargó un CV (se setea en renderResults)
let currentHasCv = false;

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
    formData.append("city",            document.getElementById("city")?.value || "");
    formData.append("desiredModality", JSON.stringify(getCheckedValues("desiredModality")));
    formData.append("areasOfInterest", JSON.stringify(weightedInterests));
    formData.append("user_intent_mode", userIntentMode);

    // Explore flow data
    if (userIntentMode === "explore") {
      formData.append("discovery_mode", "true");
      formData.append("task_preferences", JSON.stringify(exploreTaskPrefs));
      formData.append("avoid_preferences", JSON.stringify(exploreAvoid));
      formData.append("motivation_preferences", JSON.stringify(exploreMotivations));
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
    // Guardar texto crudo por separado (puede ser grande; evitar inflar laboraResults)
    sessionStorage.setItem("laboraCvRawText", data.cvRawText || "");
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

  // Mapeo de área a descriptor
  const areaDescriptors = {
    finanzas:    "orientado al análisis financiero y la toma de decisiones con datos",
    analitica:   "orientado a trabajar con datos, métricas y modelos",
    comercial:   "orientado a negocios, ventas y desarrollo comercial",
    operaciones: "orientado a optimizar procesos y gestionar operaciones",
    personas:    "orientado a gestión de personas y cultura organizacional",
    tecnologia:  "orientado a tecnología y soluciones digitales",
    marketing:   "orientado a estrategia de marca y comunicación",
    proyectos:   "orientado a planificación y gestión de proyectos"
  };

  const descriptor = areaDescriptors[primaryArea] || "con base para distintos caminos profesionales";

  if (degree) {
    return `Tienes un perfil con base en ${degree}, ${descriptor}.`;
  }
  return `Tienes un perfil ${descriptor}.`;
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
    ? (profile.tools || []).map(t => `<span class="tag">${t}</span>`).join("")
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
  const areaBlock = detectedArea ? `
    <section class="card area-insight">
      <p class="area-insight-statement">Tienes una alta coherencia con el área de <strong>${detectedArea.label}</strong>.</p>
      <p class="muted" style="margin-top:4px;">Estas son las opciones más naturales para comenzar.</p>
      ${detectedArea.subareas.length > 0 ? `
        <div class="area-insight-subareas">
          <span class="area-insight-sublabel">Subáreas probables</span>
          <div class="inline-tags">
            ${detectedArea.subareas.map((s) => `<span class="tag">${s}</span>`).join("")}
          </div>
        </div>` : ""}
    </section>` : "";

  // 5) Roles: 1 principal completo + resto compactos
  const noResultsMsg = `
    <div class="card">
      <p class="muted">No encontramos caminos con suficiente conexión con tu perfil actual.
      Intenta agregar más información o ajustar tus áreas de interés.</p>
    </div>`;

  // Banner contextual
  const contextBanner = contextMsg ? `
    <section class="card context-banner">
      <p class="context-headline">${contextMsg.headline}</p>
      <p class="muted">${contextMsg.subtext}</p>
    </section>` : "";

  let rolesSection = "";
  if (totalMatches > 0) {
    // Primer rol = completo
    const primaryRole = allRoles[0];
    const secondaryRoles = allRoles.slice(1, 4); // máx 3 adicionales

    rolesSection = `
      <section class="card">
        <h2 class="section-title">Estos son los caminos más coherentes para empezar según tu perfil</h2>
        <div class="role-list">
          ${renderRoleCard(primaryRole)}
        </div>
      </section>

      ${secondaryRoles.length > 0 ? `
      <section class="card">
        <h2 class="section-title">Otras opciones a explorar</h2>
        <p class="muted" style="margin-bottom:16px;">Caminos cercanos donde también tienes base.</p>
        <div class="role-list">
          ${secondaryRoles.map(renderCompactRoleCard).join("")}
        </div>
      </section>` : ""}`;
  }

  resultsRoot.innerHTML = `
    <section class="card">
      <h2 class="section-title">
        ${profile.name ? `Hola, ${profile.name}` : "Tu perfil"}
      </h2>
      <p class="profile-hook">${profileHook}</p>

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
          <ul class="list">
            ${strengths.map(s => `<li>${s}</li>`).join("")}
          </ul>
        </div>
      </div>
    </section>

    ${areaBlock}

    ${totalMatches === 0 ? noResultsMsg : contextBanner + rolesSection}`;
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
  if (score >= 65) return { label: "Buen punto de partida",    css: "fit-high" };
  if (score >= 40) return { label: "Vas bien encaminado",      css: "fit-mid" };
  return              { label: "Necesitas fortalecer base",    css: "fit-low" };
}

function fitDescription(score, roleTitle) {
  if (score >= 65) return `Tienes una buena base para ${roleTitle}. Estás en buen punto para dar el siguiente paso.`;
  if (score >= 40) return `Tienes una base clara para este rol. Esto es lo que te puede acercar más.`;
  return `Este camino es alcanzable, pero hay áreas concretas que te conviene reforzar primero.`;
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
  for (const skill of missingSkills.slice(0, 2)) {
    gaps.push(`En roles de ${roleArea.toLowerCase()} se suele pedir ${skill}, y no aparece en tu perfil.`);
  }

  // B) Experiencia
  if (breakdown.experiencia === 0) {
    gaps.push(`Se valora experiencia práctica en ${roleArea.toLowerCase()} (prácticas, proyectos o ayudantías), y no hay evidencia en tu perfil.`);
  }

  // C) Idiomas — revisar si el perfil tiene inglés
  const profileLangs = (profile?.languages || []).map(l => l.toLowerCase());
  const hasEnglish   = profileLangs.some(l => l.includes("ingl") || l.includes("english"));
  if (!hasEnglish) {
    gaps.push(`Muchas ofertas de ${roleArea.toLowerCase()} requieren inglés intermedio, y no aparece en tu perfil.`);
  }

  // D) Skills adicionales del rol (si quedan slots)
  if (gaps.length < 4 && missingSkills.length > 2) {
    const extra = missingSkills[2];
    gaps.push(`También se valora manejo de ${extra} para ${roleTitle}, y no se observa en tu perfil.`);
  }

  // Fallback: si no se generó ninguna brecha
  if (gaps.length === 0) {
    gaps.push(`Tu perfil cubre las principales habilidades para ${roleTitle}. Busca diferenciarte con experiencia práctica.`);
  }

  return gaps.slice(0, 4);
}

/**
 * Genera el "próximo paso recomendado" basado en la brecha principal.
 */
function buildNextStep(role, profile) {
  const missingSkills = role.missing_skills || [];
  const breakdown     = role.score_breakdown || {};
  const roleArea      = role.area || role.category || "";

  // Prioridad 1: skill faltante más importante
  if (missingSkills.length > 0) {
    const topSkill = missingSkills[0];
    return `Enfócate en aprender ${topSkill} con un caso práctico. Un proyecto personal o curso corto puede marcar la diferencia en tu CV.`;
  }

  // Prioridad 2: experiencia
  if (breakdown.experiencia === 0) {
    return `Busca una práctica profesional, proyecto universitario o voluntariado en ${roleArea.toLowerCase()} para sumar experiencia concreta.`;
  }

  // Default
  return `Refuerza tu perfil con experiencia práctica en ${roleArea.toLowerCase()} y asegúrate de que tu CV refleje tus habilidades actuales.`;
}

// ------------------------------------------------------------------ //
// Render de tarjeta de rol (unificada, sin score numérico)
// ------------------------------------------------------------------ //

/** Tarjeta completa — rol principal */
function renderRoleCard(role) {
  const fit         = fitLevel(role.score);
  const description = fitDescription(role.score, role.title);
  const extraClass  = role.is_recommended ? " role-card--recommended" : "";

  const storedData = sessionStorage.getItem("laboraResults");
  const profile    = storedData ? JSON.parse(storedData).profile : null;

  const marketGaps = buildMarketGaps(role, profile);
  const nextStep   = buildNextStep(role, profile);

  // Limitar match_reasons a 3, sin repeticiones obvias
  const reasons = (role.match_reasons || []).slice(0, 3);

  return `
    <article class="role-card role-card--pilot${extraClass}">
      <div class="role-header">
        <div>
          ${role.is_recommended ? `<span class="role-recommended-badge">Recomendado</span>` : ""}
          <h3>${role.title}</h3>
          <p class="muted" style="margin:2px 0 0;">${role.area || role.category || ""}${role.subarea ? ` · ${role.subarea}` : ""}</p>
        </div>
        <span class="fit-badge ${fit.css}">${fit.label}</span>
      </div>

      <p class="role-description">${description}</p>

      <div class="role-section">
        <h4>Por qué este rol hace sentido para ti</h4>
        <ul class="list">
          ${
            reasons.map((r) => `<li>${r}</li>`).join("") ||
            "<li>Tu perfil tiene elementos que conectan con este rol.</li>"
          }
        </ul>
      </div>

      <div class="role-section">
        <h4>Lo que suele pedir el mercado para este rol</h4>
        <ul class="list">
          ${marketGaps.map(g => `<li>${g}</li>`).join("")}
        </ul>
      </div>

      <div class="role-next-step-highlight">
        <h4>Próximo paso recomendado</h4>
        <p>${nextStep}</p>
      </div>

      <div class="role-cv-builder-action">
        <a href="/vacantes.html?role=${encodeURIComponent(role.title)}" class="button secondary" style="text-align:center;">
          Ver vacantes para este rol
        </a>
        <a href="/cv-builder.html?mode=${currentHasCv ? "optimize" : "generate"}&role=${encodeURIComponent(role.title)}"
           class="button primary">
          ${cvBuilderLabel(role.title, currentHasCv)}
        </a>
      </div>
    </article>`;
}

/** Tarjeta compacta — roles secundarios */
function renderCompactRoleCard(role) {
  const fit        = fitLevel(role.score);
  const extraClass = role.is_recommended ? " role-card--recommended" : "";

  const storedData = sessionStorage.getItem("laboraResults");
  const profile    = storedData ? JSON.parse(storedData).profile : null;
  const marketGaps = buildMarketGaps(role, profile);

  return `
    <article class="role-card role-card--compact${extraClass}">
      <div class="role-header">
        <div>
          <h3>${role.title}</h3>
          <p class="muted" style="margin:2px 0 0;">${role.area || role.category || ""}${role.subarea ? ` · ${role.subarea}` : ""}</p>
        </div>
        <span class="fit-badge ${fit.css}">${fit.label}</span>
      </div>

      <div class="role-section">
        <h4>Lo que suele pedir el mercado</h4>
        <ul class="list">
          ${marketGaps.slice(0, 2).map(g => `<li>${g}</li>`).join("")}
        </ul>
      </div>

      <div class="role-compact-actions">
        <a href="/vacantes.html?role=${encodeURIComponent(role.title)}" class="button secondary">Ver vacantes</a>
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
    console.log("[Labora] match exacto en CAREER_SPECIFIC_INTERESTS con clave:", key);
    return CAREER_SPECIFIC_INTERESTS[key];
  }

  // 2. Normalizar todas las claves en runtime y comparar (resguardo por encoding)
  const entries = Object.entries(CAREER_SPECIFIC_INTERESTS);
  const exactEntry = entries.find(([k]) => normalizeStr(k) === key);
  if (exactEntry) {
    console.log("[Labora] match exacto normalizado con clave:", exactEntry[0]);
    return exactEntry[1];
  }

  // 3. Substring: la clave contiene el input o viceversa
  const subEntry = entries.find(([k]) => {
    const nk = normalizeStr(k);
    return key.includes(nk) || nk.includes(key);
  });
  if (subEntry) {
    console.log("[Labora] match por substring con clave:", subEntry[0]);
    return subEntry[1];
  }

  console.log("[Labora] sin match en CAREER_SPECIFIC_INTERESTS para:", key);
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
  const atLimit    = selectedInterests.length >= 2;

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
    } else if (selectedInterests.length < 2) {
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
  const atLimit  = count >= 2;

  if (counter) {
    counter.textContent = atLimit
      ? "Orden guardado (2 de 2)"
      : count === 0
        ? "Elige en orden de prioridad (máx. 2)"
        : `${count} de 2 elegida${count > 1 ? "s" : ""}`;
    counter.classList.toggle("at-limit", atLimit);
  }
  if (limitMsg) limitMsg.classList.toggle("visible", atLimit);
}

/**
 * Reconstruye el grid según la carrera seleccionada.
 * Intereses específicos (core) primero, generales después.
 * Preserva selecciones al cambiar de carrera.
 */
function renderInterestsForCareer(rawDegree) {
  console.log("[updateInterestOptions] se disparó");

  const grid = document.querySelector(".interests-grid");
  const hint = document.getElementById("interests-suggestion-hint");

  console.log("[render] container:", grid);

  if (!grid) {
    console.warn("[render] ABORTADO — no se encontró .interests-grid en el DOM");
    return;
  }

  currentRawDegree = rawDegree || "";

  const careerValue   = currentRawDegree;
  const canonical     = normalizeDegree(careerValue) || careerValue;
  const normalizedCareer = normalizeStr(canonical);

  console.log("[career raw]", careerValue);
  console.log("[career normalized]", normalizedCareer);

  const areas = getCareerSpecificInterests(normalizedCareer);
  const matchedCareerKey = areas.length ? normalizedCareer : null;

  console.log("[match found]", matchedCareerKey);
  console.log("[areas found]", areas);

  // --- render ---
  console.log("[render] areas to paint:", areas);

  grid.innerHTML = "";

  if (areas.length) {
    if (hint) {
      hint.textContent = "Te sugerimos algunas áreas comunes para tu carrera, pero puedes elegir otras si quieres.";
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

    GENERAL_INTERESTS
      .filter((val) => !areas.includes(val))
      .forEach((val) => {
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

  console.log("[render] final HTML:", grid.innerHTML.slice(0, 300));

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
  console.log("=== TEST MANUAL:", carrera, "===");
  renderInterestsForCareer(carrera);
};

// ------------------------------------------------------------------ //
// Autocomplete de carrera (por categorías)
// ------------------------------------------------------------------ //

const CAREER_CATEGORIES = [
  { category: "Negocios y Administración", careers: [
    "Administración de Empresas",
    "Administración Pública",
    "Auditoría",
    "Comercio Internacional",
    "Contador Auditor",
    "Economía",
    "Finanzas",
    "Ingeniería Comercial",
    "Ingeniería en Administración de Empresas",
    "Ingeniería en Finanzas",
    "Ingeniería en Gestión de Personas",
    "Ingeniería en Marketing",
    "Ingeniería en Negocios Internacionales",
    "Logística",
    "Marketing",
    "Relaciones Públicas"
  ]},
  { category: "Ingeniería", careers: [
    "Ingeniería Ambiental",
    "Ingeniería Civil",
    "Ingeniería Civil Eléctrica",
    "Ingeniería Civil Industrial",
    "Ingeniería Civil Mecánica",
    "Ingeniería Civil Química",
    "Ingeniería en Alimentos",
    "Ingeniería en Biotecnología",
    "Ingeniería en Computación",
    "Ingeniería en Construcción",
    "Ingeniería en Gestión Industrial",
    "Ingeniería en Informática",
    "Ingeniería en Metalurgia",
    "Ingeniería en Minas",
    "Ingeniería en Prevención de Riesgos",
    "Ingeniería en Recursos Naturales",
    "Ingeniería en Telecomunicaciones",
    "Ingeniería Forestal"
  ]},
  { category: "Tecnología y Datos", careers: [
    "Análisis de Sistemas",
    "Ciencias de la Computación",
    "Ingeniería de Software",
    "Ingeniería en Ciberseguridad",
    "Ingeniería en Desarrollo de Software"
  ]},
  { category: "Ciencias", careers: [
    "Agronomía",
    "Biología",
    "Bioquímica",
    "Estadística",
    "Geografía",
    "Geología",
    "Oceanografía",
    "Química"
  ]},
  { category: "Salud", careers: [
    "Enfermería",
    "Fonoaudiología",
    "Kinesiología",
    "Medicina",
    "Medicina Veterinaria",
    "Nutrición y Dietética",
    "Obstetricia",
    "Odontología",
    "Químico Farmacéutico",
    "Tecnología Médica",
    "Terapia Ocupacional"
  ]},
  { category: "Educación", careers: [
    "Educación Diferencial",
    "Educación Parvularia",
    "Pedagogía en Educación Básica",
    "Pedagogía en Educación Media",
    "Pedagogía en Historia",
    "Pedagogía en Inglés",
    "Pedagogía en Lenguaje",
    "Pedagogía en Matemáticas"
  ]},
  { category: "Humanidades y Ciencias Sociales", careers: [
    "Antropología",
    "Ciencia Política",
    "Filosofía",
    "Historia",
    "Psicología",
    "Sociología",
    "Trabajo Social"
  ]},
  { category: "Comunicación y Diseño", careers: [
    "Arquitectura",
    "Comunicación Audiovisual",
    "Comunicación Social",
    "Diseño Gráfico",
    "Diseño Industrial",
    "Periodismo",
    "Publicidad"
  ]},
  { category: "Turismo y Gastronomía", careers: [
    "Gastronomía",
    "Gestión del Turismo",
    "Hotelería",
    "Turismo"
  ]},
  { category: "Derecho", careers: [
    "Derecho"
  ]}
];

/** Lista plana de carreras (para normalizeDegree y búsqueda) */
const CARRERAS = CAREER_CATEGORIES.flatMap((c) => c.careers);

/**
 * Aliases y abreviaciones comunes → carrera canónica.
 * Claves ya normalizadas (sin tildes, minúsculas).
 */
const CAREER_ALIASES = {
  // Ingeniería Comercial
  "comercial":                         "Ingeniería Comercial",
  "ing comercial":                     "Ingeniería Comercial",
  // Ingeniería Civil Industrial
  "industrial":                        "Ingeniería Civil Industrial",
  "civil industrial":                  "Ingeniería Civil Industrial",
  "ing civil industrial":              "Ingeniería Civil Industrial",
  "iciv industrial":                   "Ingeniería Civil Industrial",
  // Ingeniería Civil
  "ing civil":                         "Ingeniería Civil",
  // Ingeniería en Informática
  "informatica":                       "Ingeniería en Informática",
  "ing informatica":                   "Ingeniería en Informática",
  "icinf":                             "Ingeniería en Informática",
  // Ingeniería de Software / Computación
  "software":                          "Ingeniería de Software",
  "ing software":                      "Ingeniería de Software",
  "desarrollo de software":            "Ingeniería en Desarrollo de Software",
  "computacion":                       "Ciencias de la Computación",
  "ing computacion":                   "Ciencias de la Computación",
  "sistemas":                          "Análisis de Sistemas",
  "analisis de sistemas":              "Análisis de Sistemas",
  // Administración
  "administracion":                    "Administración de Empresas",
  "admin empresas":                    "Administración de Empresas",
  "adm empresas":                      "Administración de Empresas",
  "ingenieria en administracion":      "Ingeniería en Administración de Empresas",
  // Contador Auditor
  "contador":                          "Contador Auditor",
  "contabilidad":                      "Contador Auditor",
  "auditoria":                         "Auditoría",
  // Economía
  "economista":                        "Economía",
  // Finanzas
  "finanzas":                          "Finanzas",
  "ing finanzas":                      "Ingeniería en Finanzas",
  // Marketing
  "mercadeo":                          "Marketing",
  "ing marketing":                     "Ingeniería en Marketing",
  // RRHH / Gestión de Personas
  "recursos humanos":                  "Ingeniería en Gestión de Personas",
  "rrhh":                              "Ingeniería en Gestión de Personas",
  "gestion de personas":               "Ingeniería en Gestión de Personas",
  // Logística
  "logistica":                         "Logística",
  // Negocios Internacionales
  "negocios internacionales":          "Ingeniería en Negocios Internacionales",
  // Comercio Internacional
  "comercio internacional":            "Comercio Internacional",
  // Ingeniería Mecánica
  "mecanica":                          "Ingeniería Civil Mecánica",
  "ing mecanica":                      "Ingeniería Civil Mecánica",
  // Ingeniería Eléctrica
  "electrica":                         "Ingeniería Civil Eléctrica",
  "ing electrica":                     "Ingeniería Civil Eléctrica",
  // Ingeniería Química
  "quimica industrial":                "Ingeniería Civil Química",
  "ing quimica":                       "Ingeniería Civil Química",
  // Ingeniería Ambiental
  "ambiental":                         "Ingeniería Ambiental",
  "ing ambiental":                     "Ingeniería Ambiental",
  // Ingeniería en Minas
  "minas":                             "Ingeniería en Minas",
  "mineria":                           "Ingeniería en Minas",
  // Ingeniería Forestal
  "forestal":                          "Ingeniería Forestal",
  "ing forestal":                      "Ingeniería Forestal",
  // Ingeniería en Construcción
  "construccion":                      "Ingeniería en Construcción",
  "ing construccion":                  "Ingeniería en Construcción",
  // Prevención de riesgos
  "prevencion de riesgos":             "Ingeniería en Prevención de Riesgos",
  "prev riesgos":                      "Ingeniería en Prevención de Riesgos",
  "prevencionista":                    "Ingeniería en Prevención de Riesgos",
  // Ingeniería en Alimentos
  "alimentos":                         "Ingeniería en Alimentos",
  "ing alimentos":                     "Ingeniería en Alimentos",
  // Psicología
  "psico":                             "Psicología",
  // Derecho
  "abogacia":                          "Derecho",
  "leyes":                             "Derecho",
  // Medicina
  "medico":                            "Medicina",
  // Medicina Veterinaria
  "veterinaria":                       "Medicina Veterinaria",
  "mv":                                "Medicina Veterinaria",
  // Kinesiología
  "kine":                              "Kinesiología",
  // Nutrición
  "nutricion":                         "Nutrición y Dietética",
  "nutricionista":                     "Nutrición y Dietética",
  // Fonoaudiología
  "fono":                              "Fonoaudiología",
  // Obstetricia
  "matrona":                           "Obstetricia",
  "matrona y obstetricia":             "Obstetricia",
  // Tecnología Médica
  "tecnologia medica":                 "Tecnología Médica",
  "tecnologo medico":                  "Tecnología Médica",
  // Químico Farmacéutico
  "farmacia":                          "Químico Farmacéutico",
  "quimico farmaceutico":              "Químico Farmacéutico",
  // Agronomía
  "agronomia":                         "Agronomía",
  "agronomo":                          "Agronomía",
  // Geografía
  "gis":                               "Geografía",
  // Geología
  "geologo":                           "Geología",
  // Comunicación
  "comunicaciones":                    "Comunicación Social",
  "audiovisual":                       "Comunicación Audiovisual",
  // Diseño
  "diseno":                            "Diseño Gráfico",
  "diseno industrial":                 "Diseño Industrial",
  // Arquitectura
  "arq":                               "Arquitectura",
  // Publicidad
  "publicidad":                        "Publicidad",
  // Educación
  "educacion basica":                  "Pedagogía en Educación Básica",
  "prof basica":                       "Pedagogía en Educación Básica",
  "educacion media":                   "Pedagogía en Educación Media",
  "prof media":                        "Pedagogía en Educación Media",
  "parvularia":                        "Educación Parvularia",
  "educacion diferencial":             "Educación Diferencial",
  // Trabajo Social
  "ts":                                "Trabajo Social",
  // Turismo
  "turismo":                           "Turismo",
  "hoteleria":                         "Hotelería",
  "gastronomia":                       "Gastronomía",
  "gestion del turismo":               "Gestión del Turismo",
  // Administración Pública
  "adm publica":                       "Administración Pública",
  "administracion publica":            "Administración Pública"
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
  document.querySelectorAll('input[name="desiredModality"]').forEach((cb) => {
    cb.addEventListener("change", () => {
      const label = cb.closest(".modality-option");
      if (label) label.classList.toggle("selected", cb.checked);
    });
  });
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
let exploreTaskPrefs     = [];  // máx 2
let exploreAvoid         = [];  // sin límite
let exploreMotivations   = [];  // máx 2
let selectedInferredAreas = []; // áreas confirmadas por el usuario (máx 2)

const EXPLORE_TASKS = [
  { value: "analizar-datos",       label: "Analizar datos y sacar conclusiones" },
  { value: "trabajar-personas",    label: "Trabajar con personas y equipos" },
  { value: "resolver-problemas",   label: "Resolver problemas concretos" },
  { value: "organizar-procesos",   label: "Organizar procesos o sistemas" },
  { value: "crear-estrategias",    label: "Crear estrategias o planes de acción" }
];

const EXPLORE_AVOID_GROUPS = [
  { group: "Tipo de trabajo", items: [
    { value: "ventas-metas",       label: "Ventas o metas comerciales" },
    { value: "atencion-clientes",  label: "Atención constante a clientes" }
  ]},
  { group: "Forma de trabajo", items: [
    { value: "trabajo-repetitivo", label: "Trabajo repetitivo" },
    { value: "trabajo-terreno",    label: "Trabajo en terreno" }
  ]},
  { group: "Ambiente", items: [
    { value: "ambientes-competitivos", label: "Ambientes muy competitivos" },
    { value: "industrias-no-van",      label: "Industrias o empresas que no van conmigo" }
  ]}
];

// Flat list for scoring compatibility
const EXPLORE_AVOID = EXPLORE_AVOID_GROUPS.flatMap(g => g.items);

const EXPLORE_MOTIVATIONS = [
  { value: "crecer-rapido",  label: "Crecer rápido profesionalmente, aunque sea exigente" },
  { value: "estabilidad",    label: "Tener estabilidad, aunque el crecimiento sea más lento" },
  { value: "buen-sueldo",    label: "Ganar buen sueldo, aunque haya más presión" },
  { value: "buen-ambiente",  label: "Tener buen ambiente laboral, aunque el sueldo no sea el más alto" },
  { value: "aprender",       label: "Aprender constantemente, aunque implique salir de tu zona de confort" },
  { value: "impacto",        label: "Trabajar en algo con impacto o propósito, aunque no sea lo más rentable" }
];

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
  "analitica":       "Trabajar con datos, modelos y métricas para tomar decisiones informadas.",
  "finanzas":        "Análisis financiero, presupuestos, inversiones y control de recursos.",
  "comercial":       "Ventas, negociación y desarrollo de negocios.",
  "operaciones":     "Optimizar procesos, logística y cadenas de producción.",
  "proyectos":       "Planificar, coordinar y ejecutar iniciativas con equipos.",
  "personas":        "Gestión de talento, cultura organizacional y desarrollo de equipos.",
  "tecnologia":      "Desarrollo de software, sistemas y soluciones digitales.",
  "marketing":       "Estrategias de marca, comunicación y posicionamiento.",
  "emprendimiento":  "Crear negocios, innovar y gestionar startups.",
  "control-gestion": "Planificación, control presupuestario y reportes de gestión.",
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

  // Si no hay resultados, devolver las 3 áreas más neutras
  if (ranked.length === 0) {
    return ["analitica", "operaciones", "proyectos"].map(a => ({
      value: a,
      label: INTEREST_REGISTRY[a] || a,
      description: AREA_DESCRIPTIONS[a] || "",
      score: 0
    }));
  }

  return ranked;
}

function renderExploreGrid(containerId, options, selectedArr, maxSelections) {
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
        const idx = selectedArr.indexOf(value);
        selectedArr.splice(idx, 1);
      } else if (!maxSelections || selectedArr.length < maxSelections) {
        selectedArr.push(value);
      }
      renderExploreGrid(containerId, options, selectedArr, maxSelections);
    });

    grid.appendChild(card);
  });
}

function renderExploreAvoidGrid(containerId, groups, selectedArr) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  grid.innerHTML = "";

  groups.forEach(({ group, items }) => {
    const groupLabel = document.createElement("p");
    groupLabel.className = "explore-group-label";
    groupLabel.textContent = group;
    grid.appendChild(groupLabel);

    items.forEach(({ value, label }) => {
      const isSelected = selectedArr.includes(value);
      const card = document.createElement("div");
      card.className = "explore-option" + (isSelected ? " selected" : "");
      card.innerHTML = `<span class="explore-option-check">✓</span><span>${label}</span>`;

      card.addEventListener("click", () => {
        if (isSelected) {
          const idx = selectedArr.indexOf(value);
          selectedArr.splice(idx, 1);
        } else {
          selectedArr.push(value);
        }
        renderExploreAvoidGrid(containerId, groups, selectedArr);
      });

      grid.appendChild(card);
    });
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
  const taskParts = exploreTaskPrefs.map(v => TASK_NATURAL[v]).filter(Boolean);
  const avoidParts = exploreAvoid.slice(0, 2).map(v => AVOID_NATURAL[v]).filter(Boolean);

  // No selections at all
  if (taskParts.length === 0 && avoidParts.length === 0) {
    return "Según tus respuestas, estos son los caminos que más se alinean con tu perfil.";
  }

  // Build natural sentence
  let sentence = "Por lo que elegiste, te calzan mejor áreas donde ";

  if (taskParts.length) {
    sentence += taskParts.join(" y ");
  }

  if (avoidParts.length) {
    if (taskParts.length) sentence += ", alejándote de ";
    else sentence += "se evita ";
    sentence += avoidParts.join(" y ");
  }

  sentence += ".";
  return sentence;
}

function renderExploreConfirm() {
  const grid = document.getElementById("explore-confirm-grid");
  const nextBtn = document.getElementById("next-explore-confirm");
  if (!grid) return;
  grid.innerHTML = "";

  // Update explanation text
  const explainEl = document.getElementById("explore-confirm-explanation");
  if (explainEl) explainEl.textContent = buildConfirmExplanation();

  const inferred = inferAreas();
  selectedInferredAreas = [];
  if (nextBtn) nextBtn.disabled = true;

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
      if (nextBtn) nextBtn.disabled = selectedInferredAreas.length === 0;
    });

    grid.appendChild(card);
  });
}

// Explore step sequence: explore-1 → explore-2 → explore-3 → explore-confirm
const EXPLORE_STEP_IDS = ["step-explore-1", "step-explore-2", "step-explore-3", "step-explore-confirm"];
let currentExploreStep = 0;

function showExploreStep(idx) {
  // Hide all explore steps and regular steps
  document.querySelectorAll(".step").forEach(s => { s.hidden = true; });
  const target = document.getElementById(EXPLORE_STEP_IDS[idx]);
  if (target) target.hidden = false;
  currentExploreStep = idx;

  // Progress: steps 1-2 already done, then explore 1-5 maps to steps 3-7
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
  // Render grids
  renderExploreGrid("explore-tasks-grid", EXPLORE_TASKS, exploreTaskPrefs, 2);
  renderExploreAvoidGrid("explore-avoid-grid", EXPLORE_AVOID_GROUPS, exploreAvoid);
  renderExploreGrid("explore-motivation-grid", EXPLORE_MOTIVATIONS, exploreMotivations, 2);

  // Navigation: explore-1 (tareas)
  document.getElementById("back-explore-1")?.addEventListener("click", () => showStep(2));
  document.getElementById("next-explore-1")?.addEventListener("click", () => showExploreStep(1));

  // explore-2 (evitar)
  document.getElementById("back-explore-2")?.addEventListener("click", () => showExploreStep(0));
  document.getElementById("next-explore-2")?.addEventListener("click", () => showExploreStep(2));

  // explore-3 (motivación)
  document.getElementById("back-explore-3")?.addEventListener("click", () => showExploreStep(1));
  document.getElementById("next-explore-3")?.addEventListener("click", () => {
    renderExploreConfirm();
    showExploreStep(3);
  });

  // explore-confirm
  document.getElementById("back-explore-confirm")?.addEventListener("click", () => showExploreStep(2));
  document.getElementById("next-explore-confirm")?.addEventListener("click", () => {
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
    // Explore: 1:carrera, 2:etapa, 3-6:explore, 7:CV, 8:ciudad, 9:resumen
    const exploreMap = { 1: 1, 2: 2, 4: 7, 5: 8, 6: 9 };
    const total = 9;
    const mapped = exploreMap[n] || n;
    const pct = Math.round((mapped / total) * 100);
    if (fill)  fill.style.width = pct + "%";
    if (label) label.textContent = n === 6 ? "Revisión final" : `Paso ${mapped} de ${total}`;
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
    if (title) title.textContent = "¿Qué área tienes en mente hoy?";
    if (note)  note.textContent  = "No te preocupes si no estás 100% seguro. Labora contrastará esta dirección con tu perfil.";
  } else {
    if (title) title.textContent = "¿Qué áreas te llaman más la atención?";
    if (note)  note.textContent  = "Puedes dejar esto vacío si prefieres que Labora explore desde tu perfil.";
  }
}

function renderSummary() {
  const container = document.getElementById("summary-content");
  if (!container) return;

  const degree  = document.getElementById("degree")?.value.trim() ||
                  document.getElementById("degree_other")?.value.trim() || "—";
  const statusEl = document.getElementById("academicStatus");
  const status  = statusEl?.options[statusEl.selectedIndex]?.text || "—";
  const city    = document.getElementById("city")?.value.trim() || "Sin preferencia";
  const mods    = getCheckedValues("desiredModality");
  const modText = mods.length ? mods.join(", ") : "Sin preferencia";
  const iLabels = selectedInterests.map((v) => INTEREST_REGISTRY[v] || v).join(", ") || "Sin selección";
  const cvText  = cvChoice === "yes"
    ? (document.getElementById("cv")?.files[0]?.name || "Con CV")
    : "Sin CV";
  const modeText = userIntentMode === "guided" ? "Ya tengo una idea" : "Quiero explorar";

  const interestRow = userIntentMode === "explore"
    ? `<div class="summary-row"><span class="summary-key">Áreas sugeridas</span><span class="summary-val">${iLabels}</span></div>`
    : `<div class="summary-row"><span class="summary-key">Intereses</span><span class="summary-val">${iLabels}</span></div>`;

  container.innerHTML = `
    <div class="summary-list">
      <div class="summary-row"><span class="summary-key">Modo</span><span class="summary-val">${modeText}</span></div>
      <div class="summary-row"><span class="summary-key">Carrera</span><span class="summary-val">${degree}</span></div>
      <div class="summary-row"><span class="summary-key">Etapa</span><span class="summary-val">${status}</span></div>
      ${interestRow}
      <div class="summary-row"><span class="summary-key">CV</span><span class="summary-val">${cvText}</span></div>
      <div class="summary-row"><span class="summary-key">Ciudad</span><span class="summary-val">${city}</span></div>
      <div class="summary-row"><span class="summary-key">Modalidad</span><span class="summary-val">${modText}</span></div>
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

  // Step 3 (interests, guided only) next/back
  document.getElementById("next-3")?.addEventListener("click", () => showStep(4));
  document.getElementById("back-3")?.addEventListener("click", () => showStep(2));

  // Step 4 (CV) next/back
  document.getElementById("next-4")?.addEventListener("click", () => showStep(5));
  document.getElementById("back-4")?.addEventListener("click", () => {
    if (userIntentMode === "explore") {
      // Back from CV → last explore confirm step
      showExploreStep(4);
    } else {
      showStep(3);
    }
  });

  // Step 5 (city/modality) next/back
  document.getElementById("next-5")?.addEventListener("click", () => {
    showStep(6);
    renderSummary();
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
