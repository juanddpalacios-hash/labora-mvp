const {
  normalizeText,
  arrayIncludesNormalized
} = require("../utils/text");

// -------------------------------------------------------------------
// CAREER_FAMILIES
// Mapa canónico: carrera normalizada → { primary, secondary }
// Cada carrera puede pertenecer a VARIAS familias simultáneamente.
// "primary"   = áreas donde la carrera tiene formación core
// "secondary" = áreas con overlap real pero no central
//
// Familias disponibles:
//   negocios | analitica | finanzas | ingenieria | operaciones
//   personas | geociencias | medioambiente | comunicacion
//   tecnologia | ciencias | salud | diseno | ciencias-sociales | educacion
// -------------------------------------------------------------------
const CAREER_FAMILIES = {
  "ingenieria comercial": { primary: ["negocios"], secondary: ["analitica", "finanzas"] }
};

// -------------------------------------------------------------------
// Skills genéricas: ponderadas a 0.3x para que no impulsen
// matches sin base formativa real.
// -------------------------------------------------------------------
const GENERIC_SKILLS = new Set([
  "excel", "word", "powerpoint", "comunicacion", "trabajo en equipo",
  "coordinacion", "planificacion", "reportes", "reporte",
  "levantamiento de datos", "investigacion", "proyecto", "proyectos", "experiencia"
]);

// -------------------------------------------------------------------
// Skills accionables: priorizadas en top_missing_skills porque el
// usuario puede aprenderlas en cursos cortos o certificaciones.
// -------------------------------------------------------------------
const ACTIONABLE_SKILLS = new Set([
  "excel", "sql", "python", "power bi", "tableau", "sap", "crm", "erp",
  "powerpoint", "google analytics", "qgis", "arcgis", "r"
]);

// -------------------------------------------------------------------
// AREA_TO_ROLES
// Mapa canónico: área (valor del step-explore-areas) → títulos exactos
// del catálogo de roles que pertenecen a esa área.
// Un rol puede aparecer en más de un área si es genuinamente transversal.
// Usado para filtrar el catálogo en modo "explore" antes del scoring.
// -------------------------------------------------------------------
const AREA_TO_ROLES = {
  "analitica": [
    "Analista de Datos Junior",
    "Analista de Reporting Junior",
    "Analista Comercial Junior",
    "Analista BI Junior"
  ],
  "finanzas": [
    "Analista Financiero Junior",
    "Asistente Contable Junior",
    "Analista de Tesorería Junior",
    "Analista de Presupuestos Junior",
    "Analista de Riesgo Junior",
    "Analista de Inversiones Junior"
  ],
  "control-gestion": [
    "Analista Control de Gestión Junior",
    "Analista de Reporting Junior",
    "Analista Financiero Junior",
    "Analista de Presupuestos Junior"
  ],
  "comercial": [
    "Analista Comercial Junior",
    "Ejecutivo Comercial Junior",
    "Ejecutivo de Ventas Junior",
    "Key Account Manager Junior",
    "Analista de Customer Success Junior"
  ],
  "marketing": [
    "Analista de Marketing Junior",
    "Analista de Marketing Digital Junior",
    "Analista de Performance Junior",
    "Community Manager Junior",
    "Redactor de Contenidos Junior"
  ],
  "operaciones": [
    "Coordinador de Operaciones Junior",
    "Analista de Logística Junior",
    "Analista de Supply Chain Junior",
    "Analista de Operaciones Junior"
  ],
  "personas": [
    "Asistente de RRHH Junior",
    "Analista de Reclutamiento y Selección Junior",
    "Analista de Desarrollo Organizacional Junior",
    "Coordinador Académico Junior"
  ],
  "proyectos": [
    "Asistente de Proyectos Junior",
    "Project Manager Junior",
    "Analista de Compliance Junior",
    "Coordinador de Operaciones Junior"
  ],
  "tecnologia": [
    "Business Analyst Junior",
    "Product Analyst Junior"
  ],
  "emprendimiento": [
    "Analista de Innovación Junior",
    "Analista de Nuevos Negocios Junior",
    "Venture Analyst"
  ]
};

// -------------------------------------------------------------------
// AREA_ADJACENCY — soft boost map for explore mode
// Used to give +3 pts to roles in adjacent areas when user hasn't selected them directly.
// -------------------------------------------------------------------
const AREA_ADJACENCY = {
  "finanzas":         ["control-gestion", "analitica"],
  "control-gestion":  ["finanzas", "analitica", "proyectos", "operaciones"],
  "analitica":        ["finanzas", "control-gestion", "tecnologia"],
  "comercial":        ["marketing", "personas"],
  "marketing":        ["comercial"],
  "operaciones":      ["proyectos", "control-gestion"],
  "proyectos":        ["operaciones", "control-gestion"],
  "personas":         ["comercial"],
  "tecnologia":       ["analitica"],
  "emprendimiento":   ["comercial", "proyectos"]
};

// Task preferences → behavioral trait deltas
const TASK_TO_TRAITS = {
  "analizar-datos":     { analisis: 2, aprendizaje: 1 },
  "resolver-problemas": { analisis: 1, ejecucion: 1 },
  "trabajar-personas":  { social: 2, coordinacion: 1, contacto_cliente: 1 },
  "organizar-procesos": { ejecucion: 2, coordinacion: 1 },
  "crear-estrategias":  { analisis: 1, coordinacion: 1, aprendizaje: 1 }
};

// Motivation preferences → behavioral trait deltas (can be negative)
const MOTIVATION_TO_TRAITS = {
  "aprender":      { aprendizaje: 2 },
  "crecer-rapido": { presion: 1, ejecucion: 1 },
  "estabilidad":   { presion: -1, movilidad: -1 },
  "buen-sueldo":   { presion: 1, contacto_cliente: 1 },
  "buen-ambiente": { social: 1 },
  "impacto":       { aprendizaje: 1, coordinacion: 1 }
};

// Behavioral interest preferences → trait deltas.
// Mirrors BEHAVIORAL_INTERESTS in public/app.js — keep in sync if options change.
const INTEREST_TO_TRAITS = {
  "entender-datos":      { analisis: 2, aprendizaje: 1 },
  "numeros-negocio":     { analisis: 2 },
  "procesos-ordenados":  { ejecucion: 2, coordinacion: 1 },
  "coordinar-avanzar":   { coordinacion: 2, social: 1 },
  "cerca-personas":      { social: 2, contacto_cliente: 1, coordinacion: 1 },
  "mejorar-organizacion":{ coordinacion: 1, ejecucion: 1, aprendizaje: 1 },
  "aprender-profundo":   { aprendizaje: 3 },
  "crear-impacto":       { analisis: 1, coordinacion: 1, aprendizaje: 1 }
};

// -------------------------------------------------------------------
// DOMAIN FIT — soft context layer for explore mode
// Maps career (normalised) → domain affinity classification.
// Source: declared career only. CV not used here.
// Modifier applied AFTER base scoring, on top-20 only.
// -------------------------------------------------------------------
const DOMAIN_FIT_MAP = {
  "ingenieria comercial": {
    // "business_general" es temporal y debería reducirse en el tiempo moviendo roles a dominios más específicos
    natural:  ["finance", "commercial", "marketing", "analytics", "business_general"],
    nearby:   ["operations", "people_org", "tech"],
    distant:  ["education", "communications"]
  }
};

const DOMAIN_MODIFIERS = { natural: 5, nearby: 0, distant: -4 };

/**
 * Returns domain fit score modifier for a role given the user's career.
 *   +5 → natural domain for this career
 *    0 → nearby domain (or career/domain not in map)
 *   -4 → distant domain for this career
 */
function getDomainFitModifier(userCareer, roleDomain) {
  const norm = normalizeText(userCareer || "");
  const careerMap = DOMAIN_FIT_MAP[norm];
  if (!careerMap || !roleDomain) return 0;
  if (careerMap.natural.includes(roleDomain))  return DOMAIN_MODIFIERS.natural;
  if (careerMap.nearby.includes(roleDomain))   return DOMAIN_MODIFIERS.nearby;
  if (careerMap.distant.includes(roleDomain))  return DOMAIN_MODIFIERS.distant;
  return 0;
}

// Additive avoid penalties — subtracted from final score.
// Rules are ordered strongest-first; only the first match per avoid value applies.
const AVOID_PENALTY_RULES = [
  { avoid: "ventas-metas",           condition: (t) => t.contacto_cliente >= 3 && t.presion >= 2, penalty: 40 },
  { avoid: "ventas-metas",           condition: (t) => t.contacto_cliente >= 2,                   penalty: 25 },
  { avoid: "ventas-metas",           condition: (t) => t.contacto_cliente >= 1 && t.presion >= 1, penalty: 12 },
  { avoid: "atencion-clientes",      condition: (t) => t.contacto_cliente >= 3,                   penalty: 30 },
  { avoid: "atencion-clientes",      condition: (t) => t.contacto_cliente >= 2,                   penalty: 15 },
  { avoid: "atencion-clientes",      condition: (t) => t.contacto_cliente >= 1,                   penalty: 8  },
  { avoid: "trabajo-terreno",        condition: (t) => t.movilidad >= 2,                          penalty: 30 },
  { avoid: "trabajo-terreno",        condition: (t) => t.movilidad >= 1,                          penalty: 15 },
  { avoid: "ambientes-competitivos", condition: (t) => t.presion >= 3,                            penalty: 30 },
  { avoid: "ambientes-competitivos", condition: (t) => t.presion >= 2,                            penalty: 15 },
  { avoid: "trabajo-repetitivo",     condition: (t) => t.aprendizaje <= 1 && t.ejecucion >= 3,   penalty: 20 }
];

// -------------------------------------------------------------------
// ROLE_INTENT_GATE
// Roles con perfil conductual genérico (match muchos usuarios) que
// requieren al menos una señal explícita del dominio para aparecer
// sin penalización. Impide que Compliance y CdG surfacen para perfiles
// que usan "estructura" u "orden" como proxy sin intención financiera.
// -------------------------------------------------------------------
const ROLE_INTENT_GATE = {
  "analista-compliance-junior": {
    // Compliance requiere señal financiera/estratégica — "procesos-ordenados" solo
    // indica operaciones, no regulación. "numeros-negocio" o "mejorar-organizacion"
    // son los discriminadores clave: implican rigor de negocio, no solo estructura.
    required_signals: {
      interests: ["numeros-negocio", "mejorar-organizacion"],
      tasks:     ["crear-estrategias"]
    },
    absent_penalty: 22
  },
  "analista-control-gestion-junior": {
    // CdG requiere señal de seguimiento de negocio. Un perfil puramente analítico
    // (entender-datos + analizar-datos) apunta a data/analytics, no a control/reporting.
    required_signals: {
      interests: ["numeros-negocio", "procesos-ordenados", "mejorar-organizacion"],
      tasks:     ["organizar-procesos", "crear-estrategias"]
    },
    absent_penalty: 15
  }
};

/**
 * Returns the intent gate penalty for a role.
 * 0 if the role has no gate or the user has at least one matching signal.
 */
function computeIntentGatePenalty(roleId, interestPrefs, taskPrefs) {
  const gate = ROLE_INTENT_GATE[roleId];
  if (!gate) return 0;
  const hasMatch =
    gate.required_signals.interests.some(i => (interestPrefs || []).includes(i)) ||
    gate.required_signals.tasks.some(t => (taskPrefs || []).includes(t));
  return hasMatch ? 0 : gate.absent_penalty;
}

// Role clusters for diversity logic in explore mode.
// One cluster per conceptual area — kept granular so adjacent areas don't block each other.
const ROLE_CLUSTERS = {
  "analitica":       "data",
  "tecnologia":      "data",
  "finanzas":        "finance",
  "control-gestion": "control_gestion", // own cluster: CdG can appear alongside finanzas roles
  "comercial":       "commercial",
  "negocios":        "commercial",      // customer success → commercial bucket
  "marketing":       "marketing",
  "comunicacion":    "marketing",       // community mgr, redactor → marketing bucket
  "operaciones":     "operations",
  "proyectos":       "projects",
  "personas":        "people",
  "emprendimiento":  "entrepreneurship"
};

// -------------------------------------------------------------------
// Explore-mode scoring functions
// -------------------------------------------------------------------

/**
 * Builds a user trait vector (8 dims, each 0-3) from task and motivation signals.
 * Each task/motivation adds deltas to the corresponding traits; final values clamped to [0,3].
 */
function buildUserTraitVector(taskPrefs, motivPrefs, interestPrefs = []) {
  const traits = { analisis: 0, ejecucion: 0, coordinacion: 0, contacto_cliente: 0, social: 0, presion: 0, aprendizaje: 0, movilidad: 0 };

  for (const task of (taskPrefs || [])) {
    const deltas = TASK_TO_TRAITS[task] || {};
    for (const [key, val] of Object.entries(deltas)) {
      if (Object.prototype.hasOwnProperty.call(traits, key)) traits[key] += val;
    }
  }

  for (const motiv of (motivPrefs || [])) {
    const deltas = MOTIVATION_TO_TRAITS[motiv] || {};
    for (const [key, val] of Object.entries(deltas)) {
      if (Object.prototype.hasOwnProperty.call(traits, key)) traits[key] += val;
    }
  }

  for (const interest of (interestPrefs || [])) {
    const deltas = INTEREST_TO_TRAITS[interest] || {};
    for (const [key, val] of Object.entries(deltas)) {
      if (Object.prototype.hasOwnProperty.call(traits, key)) traits[key] += val;
    }
  }

  for (const key of Object.keys(traits)) {
    traits[key] = Math.max(0, Math.min(3, traits[key]));
  }

  return traits;
}

/**
 * Behavioral score (0-40): rewards trait alignment, penalizes mismatch.
 * formula per dim: min(role,user)*2 - max(role-user,0)*1
 * raw range: [−24, +48] → normalized to [0, 40]
 */
function scoreBehavioral(userTraits, role) {
  const rTraits = role.traits || {};
  const dims = ["analisis", "ejecucion", "coordinacion", "contacto_cliente", "social", "presion", "aprendizaje", "movilidad"];

  let raw = 0;
  for (const dim of dims) {
    const r = rTraits[dim] ?? 0;
    const u = userTraits[dim] ?? 0;
    raw += Math.min(r, u) * 2 - Math.max(r - u, 0);
  }

  return Math.max(0, Math.min(40, Math.round(((raw + 24) / 72) * 40)));
}

/**
 * Area boost (0-10): +8 for direct area match, +3 for adjacent area.
 * Does NOT filter — roles with no area match simply get 0.
 */
function scoreAreaBoost(areasInterest, role) {
  if (!areasInterest || areasInterest.length === 0) return 0;
  const cat = role.category || "";
  if (areasInterest.includes(cat)) return 8;
  for (const area of areasInterest) {
    if ((AREA_ADJACENCY[area] || []).includes(cat)) return 3;
  }
  return 0;
}

/**
 * Additive avoid penalty (subtracted from final score).
 * Returns total points to subtract (>= 0).
 * Applies rules in order; for each avoid value, only the first matching rule fires.
 */
function computeAvoidPenaltyAdditive(avoidPreferences, role) {
  if (!avoidPreferences || avoidPreferences.length === 0) return 0;
  const rTraits = role.traits || {};
  let total = 0;

  for (const avoidVal of avoidPreferences) {
    for (const rule of AVOID_PENALTY_RULES) {
      if (rule.avoid === avoidVal && rule.condition(rTraits)) {
        total += rule.penalty;
        break;
      }
    }
  }

  return total;
}

/**
 * CV-based score (0-35): maps degree/skills/experience/specialization to a fixed scale.
 * Degree: 30→14, 20→10, 10→5, 0→0 | Skills: max 12 | Exp: max 5 | Spec: max 4
 */
function scoreCv(profile, role) {
  const degreeRaw = scoreDegree(profile, role);
  const skillsRaw = scoreSkills(profile, role);
  const expRaw    = scoreExperience(profile, role);
  const specRaw   = scoreSpecialization(profile, role);

  const degreePts = degreeRaw === 30 ? 14 : degreeRaw === 20 ? 10 : degreeRaw === 10 ? 5 : 0;
  const skillsPts = Math.round((skillsRaw / 25) * 12);
  const expPts    = Math.round((expRaw    / 15) * 5);
  const specPts   = Math.round((specRaw   / 15) * 4);

  return {
    cv: Math.min(35, degreePts + skillsPts + expPts + specPts),
    degreeRaw, skillsRaw, expRaw, specRaw
  };
}

/**
 * Structured diversity for explore-mode top-5:
 *   top3: best by score, max 2 from same cluster
 *   #4:   best from a cluster not in top3, with +5 discovery bonus for "wide" clusters
 *         so that operations/projects/people/etc. can surface over a marginally higher-score
 *         analytical role
 *   #5:   stretch — sorted by aprendizaje DESC (not pure score) from an unused cluster,
 *         so high-learning roles surface even if their overall score is lower
 */
function diversifyResults(allScored) {
  if (allScored.length === 0) return [];

  const clusterOf = (r) => ROLE_CLUSTERS[r.category] || "other";
  const usedSet = new Set();
  const clusterCount = {};

  // top3: best by score, max 2 from same cluster
  const top3 = [];
  for (const r of allScored) {
    if (top3.length >= 3) break;
    const cl = clusterOf(r);
    if ((clusterCount[cl] || 0) < 2) {
      top3.push(r);
      usedSet.add(r);
      clusterCount[cl] = (clusterCount[cl] || 0) + 1;
    }
  }

  const top3Clusters = new Set(top3.map(clusterOf));

  // Dominant cluster = the one with 2 slots in top3 (last-resort anchor for #5 fallback)
  const dominantCluster = Object.entries(clusterCount).find(([, v]) => v >= 2)?.[0] || null;

  // "Wide" clusters are non-data/finance areas — areas a highly analytical profile
  // wouldn't naturally surface. Give them +5 at #4 so discovery roles compete fairly.
  const WIDE_CLUSTERS = new Set([
    "control_gestion", "operations", "projects",
    "people", "entrepreneurship", "marketing", "commercial"
  ]);

  // #4: best from non-top3 cluster, wide clusters get +5 discovery bonus
  const fourth = allScored
    .filter(r => !usedSet.has(r) && !top3Clusters.has(clusterOf(r)))
    .sort((a, b) => {
      const aAdj = a.score + (WIDE_CLUSTERS.has(clusterOf(a)) ? 5 : 0);
      const bAdj = b.score + (WIDE_CLUSTERS.has(clusterOf(b)) ? 5 : 0);
      return bAdj - aAdj;
    })[0] || null;

  if (fourth) usedSet.add(fourth);

  const usedClusters = new Set([
    ...top3.map(clusterOf),
    fourth ? clusterOf(fourth) : null
  ].filter(Boolean));

  // #5: stretch — discovery-oriented, NOT pure score
  // Sort unused-cluster candidates by aprendizaje DESC, then score DESC.
  // A role with aprendizaje=3 and score=20 beats one with aprendizaje=1 and score=35.
  const fifth =
    allScored
      .filter(r => !usedSet.has(r) && !usedClusters.has(clusterOf(r)))
      .sort((a, b) => {
        const learnDiff = (b.role_traits?.aprendizaje ?? 0) - (a.role_traits?.aprendizaje ?? 0);
        return learnDiff !== 0 ? learnDiff : b.score - a.score;
      })[0] ||
    // Fallback: at least avoid dominant cluster, still aprendizaje-first
    allScored
      .filter(r => !usedSet.has(r) && clusterOf(r) !== dominantCluster)
      .sort((a, b) => (b.role_traits?.aprendizaje ?? 0) - (a.role_traits?.aprendizaje ?? 0))[0] ||
    // Last resort
    allScored.find(r => !usedSet.has(r));

  return [top3[0], top3[1], top3[2], fourth, fifth].filter(Boolean);
}

// -------------------------------------------------------------------
// Scoring weights — DINÁMICOS según calidad del perfil
// Carrera: 30 | Skills: 25 | Especialización: 15 | Experiencia: 15
// Intereses: 10 | Modalidad: 5  → máximo teórico: 100 (perfil medio)
// -------------------------------------------------------------------
const WEIGHTS_BY_PROFILE = {
  // Perfil fuerte: el CV habla por sí solo → experiencia y skills dominan
  strong: { carrera: 15, skills: 30, experiencia: 25, especializacion: 20, intereses: 5, modalidad: 5 },
  // Perfil medio: balance entre formación y CV
  medium: { carrera: 25, skills: 25, experiencia: 15, especializacion: 20, intereses: 10, modalidad: 5 },
  // Perfil débil: sin mucho CV → la carrera es la mejor señal disponible
  weak:   { carrera: 30, skills: 20, experiencia: 10, especializacion: 20, intereses: 5, modalidad: 5 }
};

// Señales en el CV que indican experiencia de impacto real
const HIGH_EXPERIENCE_SIGNALS = [
  "metrica", "automatiz", "resultado", "logr", "impacto", "lider",
  "implemento", "desarrollo", "aumento", "redujo", "mejoro", "ownership"
];

/**
 * Evalúa la calidad de la señal del perfil del usuario en tres ejes:
 *   experience_level:       low | medium | high
 *   skill_level:            low | medium | high
 *   specialization_clarity: low | high
 */
function evaluateProfileQuality(profile) {
  const tools      = profile.tools      || [];
  const skills     = profile.skills     || [];
  const experience = profile.experience || [];
  const projects   = profile.projects   || [];

  // skill_level: cuántas herramientas y skills concretas tiene el perfil
  const skillCount = tools.length + skills.length;
  const skill_level = skillCount >= 5 ? "high" : skillCount >= 2 ? "medium" : "low";

  // experience_level: ¿tiene experiencia? ¿tiene señales de impacto?
  const expTexts  = experience.map((e) => normalizeText(e.description || ""));
  const projTexts = projects.map((p) => normalizeText(typeof p === "string" ? p : ""));
  const allExpText = [...expTexts, ...projTexts].join(" ");
  const hasHighSignals  = HIGH_EXPERIENCE_SIGNALS.some((s) => allExpText.includes(s));
  const hasAnyExperience = experience.length > 0 || projects.length > 0;
  const experience_level = hasHighSignals ? "high" : hasAnyExperience ? "medium" : "low";

  // specialization_clarity: ¿se detectó una especialización en el CV?
  const specialization_clarity = (profile.specialization || []).length > 0 ? "high" : "low";

  return { experience_level, skill_level, specialization_clarity };
}

/**
 * Devuelve los pesos a usar según la calidad del perfil.
 *   Perfil fuerte (alta experiencia o muchas skills) → experiencia/skills pesan más.
 *   Perfil débil (sin experiencia y sin skills)      → carrera pesa más.
 *   Resto → pesos medios balanceados.
 */
function getDynamicWeights(profileQuality) {
  const { experience_level, skill_level } = profileQuality;
  if (experience_level === "high" || skill_level === "high") return WEIGHTS_BY_PROFILE.strong;
  if (experience_level === "low"  && skill_level === "low")  return WEIGHTS_BY_PROFILE.weak;
  return WEIGHTS_BY_PROFILE.medium;
}

// Palabras clave para inferir familia cuando la carrera no está en el catálogo
const FAMILY_KEYWORD_MAP = [
  { keywords: ["software", "computacion", "informatica", "sistemas", "ciberseguridad", "programacion", "datos", "digital"], family: "tecnologia" },
  { keywords: ["finanzas", "financiero", "contable", "tributario", "auditoria", "bancario", "contabilidad"],                family: "finanzas"   },
  { keywords: ["empresas", "negocios", "gestion", "administracion", "comercial", "marketing", "mercadeo", "ventas"],        family: "negocios"   },
  { keywords: ["medico", "clinico", "salud", "enfermeria", "medicina", "farmaceutico", "kinesio", "nutri", "fono", "obste"], family: "salud"     },
  { keywords: ["ambiental", "forestal", "recursos naturales", "ecologia", "sustentab", "oceanografia"],                     family: "medioambiente" },
  { keywords: ["geologia", "geografi", "mineria", "geodesia", "cartografia", "topografia"],                                 family: "geociencias" },
  { keywords: ["personas", "recursos humanos", "rrhh", "talento", "laboral"],                                               family: "personas"   },
  { keywords: ["construccion", "obras", "hidraul", "estructur", "edificacion"],                                             family: "ingenieria"  },
  { keywords: ["quimica", "bioquimica", "microbiolog", "biologia", "farmacia"],                                             family: "ciencias"   },
  { keywords: ["educacion", "pedagogia", "docencia", "profesor", "parvularia"],                                             family: "educacion"  },
  { keywords: ["comunicacion", "periodismo", "publicidad", "relaciones publicas", "prensa", "medios"],                      family: "comunicacion" },
  { keywords: ["diseno", "arquitectura", "arte", "grafico", "visual"],                                                      family: "diseno"     },
  { keywords: ["derecho", "juridico", "legal", "abogado", "leyes"],                                                         family: "derecho" },
  { keywords: ["psicolog", "sociolog", "antropolog", "trabajo social", "filosofia"],                                        family: "ciencias-sociales" },
  { keywords: ["turismo", "hoteleria", "gastronomia", "hospitalidad"],                                                      family: "operaciones" }
];

/**
 * Retorna las familias de una carrera.
 * 1. Match exacto en CAREER_FAMILIES
 * 2. El texto contiene un nombre canónico conocido (ej: carrera con mención)
 * 3. Inferencia por palabras clave (fallback para carreras no catalogadas)
 */
function getCareerFamilies(degree) {
  const norm = normalizeText(degree);
  if (CAREER_FAMILIES[norm]) return CAREER_FAMILIES[norm];

  // El texto escrito contiene una carrera canónica conocida
  const key = Object.keys(CAREER_FAMILIES).find((k) => norm.includes(k));
  if (key) return CAREER_FAMILIES[key];

  // Fallback: inferir por palabras clave
  const primary = [];
  for (const { keywords, family } of FAMILY_KEYWORD_MAP) {
    if (keywords.some((k) => norm.includes(normalizeText(k)))) {
      if (!primary.includes(family)) primary.push(family);
      if (primary.length >= 2) break;
    }
  }
  return primary.length ? { primary, secondary: [] } : null;
}

/**
 * Calcula el score de carrera en tres niveles:
 *  30 → match exacto en related_degrees
 *  20 → familia primaria del usuario ∩ familias primarias del rol
 *  10 → cualquier otro overlap de familias (primaria↔secundaria o secundaria↔secundaria)
 *   0 → sin ningún overlap → rol EXCLUIDO
 */
function scoreDegree(profile, role) {
  if (!profile.degree) return 0;

  // Nivel 1: match exacto
  if (arrayIncludesNormalized(role.related_degrees || [], profile.degree)) return 30;

  // Nivel 2 y 3: matching por familias
  const careerFamilies = getCareerFamilies(profile.degree);
  if (!careerFamilies) return 0;

  const userPrimary   = careerFamilies.primary   || [];
  const userSecondary = careerFamilies.secondary || [];

  const rolePrimary   = role.primary_families   || [];
  const roleSecondary = role.secondary_families || [];

  // Nivel 2: familia primaria del usuario en familias primarias del rol
  if (userPrimary.some((f) => rolePrimary.includes(f))) return 20;

  // Nivel 3: cualquier otro cruce
  const partialMatch =
    userPrimary.some((f)   => roleSecondary.includes(f)) ||
    userSecondary.some((f) => rolePrimary.includes(f))   ||
    userSecondary.some((f) => roleSecondary.includes(f));

  if (partialMatch) return 10;

  return 0;
}

/** Hasta +25. Skills genéricas ponderadas a 0.3x */
function scoreSkills(profile, role) {
  const profileItems = [...(profile.tools || []), ...(profile.skills || [])].map(normalizeText);
  const roleSkills   = role.skills || [];
  if (roleSkills.length === 0) return 0;

  let weightedMatches = 0;
  let totalWeight     = 0;

  for (const skill of roleSkills) {
    const isGeneric = GENERIC_SKILLS.has(normalizeText(skill));
    const weight    = isGeneric ? 0.3 : 1;
    totalWeight    += weight;
    if (profileItems.includes(normalizeText(skill))) weightedMatches += weight;
  }

  return Math.min(25, Math.round((weightedMatches / totalWeight) * 25));
}

/** Hasta +15 según señales de experiencia del CV que coinciden con el rol */
function scoreExperience(profile, role) {
  const expDescriptions = (profile.experience || []).map((e) => e.description || "");
  const combined        = normalizeText(
    expDescriptions.join(" ") + " " + (profile.projects || []).join(" ")
  );
  const signals = role.experience_signals || [];
  if (signals.length === 0) return 0;

  let matches = 0;
  for (const signal of signals) {
    if (combined.includes(normalizeText(signal))) matches += 1;
  }
  return Math.min(15, Math.round((matches / signals.length) * 15));
}

/** Hasta +15 si el CV muestra especialización en el área del rol.
 *  15 → especialización coincide directamente con área o categoría del rol.
 *   8 → coincide con la subárea (match más estrecho que el área general).
 *   0 → sin coincidencia.
 */
function scoreSpecialization(profile, role) {
  const specializations = profile.specialization || [];
  if (!specializations.length) return 0;

  const roleArea     = normalizeText(role.area     || "");
  const roleSubarea  = normalizeText(role.subarea  || "");
  const roleCategory = normalizeText(role.category || "");

  // Match directo: especialización === área o categoría del rol
  const directMatch = specializations.some((s) => {
    const ns = normalizeText(s);
    return ns === roleArea || ns === roleCategory ||
           roleArea.includes(ns) || roleCategory.includes(ns);
  });
  if (directMatch) return 15;

  // Match parcial: especialización contenida en la subárea del rol
  const partialMatch = specializations.some((s) =>
    roleSubarea.includes(normalizeText(s))
  );
  if (partialMatch) return 8;

  return 0;
}

/**
 * Hasta +10. Scoring ponderado por prioridad:
 *   peso 3 (prioridad 1) → +10
 *   peso 2 (prioridad 2) → +7
 *   peso 1 (prioridad 3) → +4
 * Acepta tanto [{value, weight}] (nuevo) como ["string"] (legado).
 */
function scoreInterests(profile, role) {
  const interests = profile.areas_of_interest || [];
  if (!interests.length) return 0;

  const SCORE_BY_WEIGHT = { 3: 10, 2: 7, 1: 4 };
  const roleCategory    = normalizeText(role.category || "");

  for (const interest of interests) {
    const val    = typeof interest === "object" ? interest.value  : interest;
    const weight = typeof interest === "object" ? interest.weight : 1;
    if (normalizeText(val) === roleCategory) {
      return SCORE_BY_WEIGHT[weight] ?? 4;
    }
  }
  return 0;
}

/** +5 si alguna de las modalidades seleccionadas por el usuario está en las del rol.
 *  Si el usuario no seleccionó ninguna (sin preferencia), no suma ni resta. */
function scoreModality(profile, role) {
  const modalities = Array.isArray(profile.desired_modality)
    ? profile.desired_modality
    : (profile.desired_modality ? [profile.desired_modality] : []);

  if (!modalities.length) return 0;
  return modalities.some((m) => arrayIncludesNormalized(role.modalities || [], m)) ? 5 : 0;
}

// -------------------------------------------------------------------
// Razones y brechas
// -------------------------------------------------------------------

function buildReasons(profile, role, degreeScore, specializationScore) {
  const reasons = [];

  // 1. Qué hace este rol (pitch específico)
  if (role.pitch) {
    reasons.push(role.pitch);
  }

  // 2. Alineación formativa — tono orientador
  if (degreeScore === 30) {
    reasons.push(`Tu formación en ${profile.degree} cubre directamente esta área.`);
  } else if (degreeScore === 20) {
    const area = role.primary_families?.[0] || role.area || role.category;
    reasons.push(`Tu carrera tiene base sólida en ${area}.`);
  } else if (degreeScore === 10) {
    reasons.push(`Tu carrera tiene puntos de contacto con esta área.`);
  }

  // 3. Especialización — cita la subárea concreta
  if (specializationScore > 0) {
    const specLabel = role.subarea || role.area;
    reasons.push(`Tu CV tiene señales claras en ${specLabel}.`);
  }

  // 4. Solo skills NO genéricas que aparezcan en el perfil
  const profileItems = [...(profile.tools || []), ...(profile.skills || [])].map(normalizeText);
  const specificOverlap = (role.skills || []).filter((s) => {
    const ns = normalizeText(s);
    return !GENERIC_SKILLS.has(ns) && profileItems.includes(ns);
  });
  if (specificOverlap.length > 0) {
    reasons.push(`Manejas: ${specificOverlap.slice(0, 3).join(", ")}.`);
  }

  // 5. Interés declarado (maneja formato plano y ponderado)
  const matchedInterest = (profile.areas_of_interest || []).find((i) => {
    const val = typeof i === "object" ? i.value : i;
    return normalizeText(val) === normalizeText(role.category || "");
  });
  if (matchedInterest) {
    const weight = typeof matchedInterest === "object" ? matchedInterest.weight : null;
    reasons.push(
      weight === 3 ? "Es tu área de interés principal."
      : weight === 2 ? "Es tu segunda área de interés."
      : "Declaraste interés en esta área."
    );
  }

  return reasons;
}

function buildMissingSkills(profile, role) {
  const profileItems = new Set(
    [...(profile.tools || []), ...(profile.skills || [])].map(normalizeText)
  );
  // Usa SOLO required_skills — las habilidades verdaderamente necesarias para el rol.
  // Si el rol no las define, retorna vacío (no usamos role.skills aquí).
  const requiredSkills = role.required_skills || [];
  const missing = [...new Set(
    requiredSkills.filter((s) => !profileItems.has(normalizeText(s)))
  )];
  return missing;
}

// Frases rotativas para brechas de skills — primera verbosa, el resto directas
const SKILL_GAP_PHRASES = [
  (s) => `Para acercarte a este rol, refuerza ${s}.`,
  (s) => `También se pide ${s}.`,
  (s) => `Se valora experiencia con ${s}.`,
  (s) => `Conocer ${s} marcaría diferencia.`
];

function buildGaps(profile, role) {
  const gaps         = [];
  const profileItems = [...(profile.tools || []), ...(profile.skills || [])].map(normalizeText);
  let   phraseIdx    = 0;

  for (const roleSkill of role.skills || []) {
    if (
      !profileItems.includes(normalizeText(roleSkill)) &&
      !GENERIC_SKILLS.has(normalizeText(roleSkill))
    ) {
      gaps.push(SKILL_GAP_PHRASES[phraseIdx % SKILL_GAP_PHRASES.length](roleSkill));
      phraseIdx++;
    }
  }

  if ((profile.experience || []).length === 0) {
    gaps.push("Buscar una práctica, proyecto o ayudantía en esta área te daría experiencia concreta que mostrar.");
  }

  return gaps.slice(0, 4);
}

// -------------------------------------------------------------------
// Área detectada (capa intermedia para el frontend)
// -------------------------------------------------------------------

const AREA_LABELS = {
  finanzas:           "Finanzas",
  analitica:          "Analítica y Datos",
  marketing:          "Marketing Digital",
  comercial:          "Comercial",
  personas:           "Recursos Humanos y Personas",
  operaciones:        "Operaciones",
  logistica:          "Logística",
  geociencias:        "Geociencias",
  medioambiente:      "Medioambiente",
  tecnologia:         "Tecnología",
  comunicacion:       "Comunicación",
  derecho:            "Derecho y Cumplimiento",
  educacion:          "Educación",
  negocios:           "Negocios",
  ingenieria:         "Ingeniería",
  "ciencias-sociales":"Ciencias Sociales",
  diseno:             "Diseño",
  salud:              "Salud"
};

/**
 * Infiere el área principal del perfil y las subáreas probables
 * a partir de especialización, intereses y roles encontrados.
 */
function buildDetectedArea(profile, strongMatches, stretchMatches) {
  let mainArea = null;

  // 1. Especialización detectada en el CV
  const spec = (profile.specialization || [])[0];
  if (spec) mainArea = AREA_LABELS[normalizeText(spec)] || spec;

  // 2. Interés declarado (primer elemento = mayor prioridad)
  if (!mainArea) {
    const first    = (profile.areas_of_interest || [])[0];
    const interest = first && typeof first === "object" ? first.value : first;
    if (interest) mainArea = AREA_LABELS[normalizeText(interest)] || interest;
  }

  // 3. Área del rol con mayor puntaje
  if (!mainArea && strongMatches.length > 0) {
    mainArea = strongMatches[0].area || null;
  }

  if (!mainArea) return null;

  // Filtrar matches cuyo área coincide con mainArea para extraer solo subareas relevantes
  const mainAreaNorm = normalizeText(mainArea);
  const allMatches   = [...strongMatches, ...stretchMatches];
  const areaMatches  = allMatches.filter((m) => {
    const mArea = normalizeText(m.area || m.category || "");
    return mArea === mainAreaNorm || normalizeText(AREA_LABELS[mArea] || "") === mainAreaNorm;
  });
  const sourceMatches = areaMatches.length > 0 ? areaMatches : allMatches;
  const subareas      = [...new Set(sourceMatches.map((m) => m.subarea).filter(Boolean))].slice(0, 4);

  return { label: mainArea, subareas };
}

// -------------------------------------------------------------------
// Clasificación de tipo de usuario (Fase 4)
// -------------------------------------------------------------------

// Intereses que cualquier carrera puede tener — no son señal específica de dirección
const GENERIC_INTERESTS = new Set([
  "analitica", "comercial", "finanzas", "operaciones", "proyectos",
  "personas", "tecnologia", "medioambiente", "geociencias", "emprendimiento"
]);

/**
 * Clasifica al usuario en uno de tres tipos según la coherencia entre
 * sus intereses declarados y la evidencia real del perfil.
 *
 *  "explore"    → sin intereses claros o sin dirección detectada en el perfil
 *  "misaligned" → tiene intereses pero el perfil real apunta a otra dirección
 *  "aligned"    → intereses y evidencia del perfil van en la misma dirección
 */
function classifyUserType(profile, results) {
  const interests      = profile.areas_of_interest || [];
  const { strong_matches, stretch_matches } = results;
  const allMatches     = [...strong_matches, ...stretch_matches];

  // Sin intereses declarados → sin dirección
  if (interests.length === 0) return "explore";

  // Sin resultados de ningún tipo → sin base para orientar
  if (allMatches.length === 0) return "explore";

  // Interés principal (mayor peso primero)
  const sortedInterests = [...interests].sort((a, b) => {
    const wa = typeof a === "object" ? (a.weight || 1) : 1;
    const wb = typeof b === "object" ? (b.weight || 1) : 1;
    return wb - wa;
  });
  const primaryRaw = sortedInterests[0];
  const primaryVal = normalizeText(typeof primaryRaw === "object" ? primaryRaw.value : primaryRaw);

  // ¿El top match por score está en el área de interés declarado?
  const topMatch           = allMatches[0];
  const topInInterestArea  = normalizeText(topMatch.category || "") === primaryVal;
  const strongInInterestArea = strong_matches.some(
    (r) => normalizeText(r.category || "") === primaryVal
  );

  // Evidencia no-carrera para el match en el área declarada.
  // Se excluye deliberadamente el score de carrera porque aplica a muchas áreas
  // (ej: Ing. Comercial tiene degree match alto en finanzas Y en comercial),
  // lo que inflaría la evidencia y encubriría la desalineación real.
  const interestAreaMatch = allMatches.find(
    (r) => normalizeText(r.category || "") === primaryVal
  );
  const evidenceScore = interestAreaMatch
    ? (interestAreaMatch.score_breakdown.skills          || 0) +
      (interestAreaMatch.score_breakdown.especializacion || 0) +
      (interestAreaMatch.score_breakdown.experiencia     || 0)
    : 0;

  if (topInInterestArea || strongInInterestArea || evidenceScore >= 15) return "aligned";

  // Tiene intereses claros, pero la evidencia apunta a otra dirección
  return "misaligned";
}

// -------------------------------------------------------------------
// Alineación de interés por rol (Fase 5)
// -------------------------------------------------------------------

/**
 * Evalúa qué tan alineado está el perfil REAL con un rol concreto,
 * más allá de lo que el usuario declaró querer.
 *
 *   alignment: "high" | "medium" | "low"
 *   declared_interest: boolean — si el usuario marcó este área
 */
function evaluateInterestAlignment(profile, role, degreeScore, skillScore, experienceScore, specializationScore) {
  const interests    = profile.areas_of_interest || [];
  const roleCategory = normalizeText(role.category || "");

  const declaredInterest = interests.some((i) => {
    const val = normalizeText(typeof i === "object" ? i.value : i);
    return val === roleCategory;
  });

  // Evidencia objetiva: skills + experiencia + especialización.
  // Se excluye deliberadamente el score de carrera porque Ingeniería Comercial, por ejemplo,
  // da match exacto tanto para finanzas como para comercial — no discrimina.
  // El grado de preparación REAL viene de lo que el CV muestra, no de la carrera sola.
  // Max posible: skills(25) + spec(15) + exp(15) = 55
  const evidenceScore = skillScore + experienceScore + specializationScore;

  if (evidenceScore >= 20) return { alignment: "high",   declared_interest: declaredInterest };
  if (evidenceScore >= 8)  return { alignment: "medium", declared_interest: declaredInterest };
  return                          { alignment: "low",    declared_interest: declaredInterest };
}

/**
 * Genera el mensaje interpretativo cuando hay desalineación.
 * Solo se usa cuando alignment === "low" y el usuario declaró ese interés.
 */
function buildInterestNote(topMissingSkills) {
  let note = "Tu interés en este tipo de rol es válido, pero hoy tu perfil aún no está completamente alineado.";
  if (topMissingSkills.length > 0) {
    note += ` Para acercarte a este rol podrías reforzar: ${topMissingSkills.join(", ")}.`;
  }
  return note;
}

// -------------------------------------------------------------------
// Links a ofertas laborales reales
// -------------------------------------------------------------------

// Roles con componente tech/data → incluir GetOnBoard
const GETONBOARD_CATEGORIES = new Set(["analitica", "tecnologia"]);

/**
 * Genera URLs de búsqueda en plataformas laborales para un rol dado.
 * No usa APIs ni scraping — solo arma los links de búsqueda estándar.
 *
 * @param {object} role     — rol del catálogo (necesita title y category)
 * @param {string} location — ciudad del usuario (ej: "Santiago"); fallback "Chile"
 * @returns {{ linkedin, indeed, laborum, getonboard? }}
 */
function generateJobLinks(role, location) {
  const query = encodeURIComponent(role.title.toLowerCase());
  const loc   = encodeURIComponent(location || "Chile");

  const links = {
    linkedin: `https://www.linkedin.com/jobs/search/?keywords=${query}&location=${loc}`,
    indeed:   `https://cl.indeed.com/jobs?q=${query}&l=${loc}`,
    laborum:  `https://www.laborum.cl/empleos.html?recientes=1&query=${query}`
  };

  if (GETONBOARD_CATEGORIES.has(role.category)) {
    links.getonboard = `https://www.getonbrd.com/jobs?q=${query}`;
  }

  return links;
}

// -------------------------------------------------------------------
// Score de recomendación inteligente (Fase 6)
// -------------------------------------------------------------------

/**
 * Calcula un score de recomendación más matizado que el score bruto.
 * Penaliza brechas reales, premia alineación confirmada y especialización.
 *
 * Base: score total
 * - missing_skills.length × 3  (penalizar por brechas críticas pendientes)
 * + 8 si alignment=high / +3 si alignment=medium (el perfil realmente soporta el rol)
 * + 5 si top_missing_skills está vacío (listo para aplicar ya)
 * + 4 si hay especialización confirmada en el área del rol
 */
function computeRecommendationScore(scoredRole) {
  const base           = scoredRole.score;
  const missingPenalty = scoredRole.missing_skills.length * 3;
  const { alignment }  = scoredRole.interest_alignment;
  const alignmentBonus = alignment === "high" ? 8 : alignment === "medium" ? 3 : 0;
  const noGapsBonus    = scoredRole.top_missing_skills.length === 0 ? 5 : 0;
  const specBonus      = (scoredRole.score_breakdown.especializacion || 0) > 0 ? 4 : 0;
  return base - missingPenalty + alignmentBonus + noGapsBonus + specBonus;
}

// -------------------------------------------------------------------
// Mensaje contextual según tipo de usuario (Fase 8)
// -------------------------------------------------------------------

/**
 * Genera headline + subtext adaptados al user_type.
 * El frontend los renderiza como banner antes de la lista de roles.
 */
function buildContextMessage(userType, profile, topMatch) {
  const declaredInterest = (profile.areas_of_interest || [])[0];
  const declaredVal      = declaredInterest
    ? normalizeText(typeof declaredInterest === "object" ? declaredInterest.value : declaredInterest)
    : null;
  const declaredLabel = (declaredVal && AREA_LABELS[declaredVal]) || declaredVal || "esa área";
  const topArea       = (topMatch && (topMatch.area || AREA_LABELS[normalizeText(topMatch.category || "")] || topMatch.category)) || "otra dirección";

  switch (userType) {
    case "explore":
      return {
        headline: "Estos son los caminos donde tienes mejor base hoy.",
        subtext:  "Te conviene explorar estas opciones antes de cerrarte con un solo camino."
      };
    case "misaligned":
      return {
        headline: `Tu perfil muestra una base más fuerte en ${topArea} que en ${declaredLabel}.`,
        subtext:  `Eso no significa que no puedas ir hacia ${declaredLabel} — pero necesitarías reforzar ciertas áreas primero.`
      };
    case "aligned":
      return {
        headline: "Tu perfil está bien alineado con esta dirección.",
        subtext:  "Estas son las opciones más coherentes para empezar."
      };
    default:
      return null;
  }
}

// -------------------------------------------------------------------
// Explore-mode context message (derived from top-role clusters, not declared areas)
// -------------------------------------------------------------------

const CLUSTER_WORK_LABELS = {
  data:             "analizar información y convertirla en decisiones",
  finance:          "entender los números del negocio y trabajar con criterio financiero",
  control_gestion:  "controlar, hacer seguimiento y mejorar cómo funciona una organización",
  commercial:       "relacionarte con clientes y generar resultados concretos",
  marketing:        "comunicar, medir y hacer crecer una marca o producto",
  operations:       "ordenar procesos y asegurarte de que las cosas funcionen bien",
  projects:         "planificar, coordinar equipos y que los proyectos lleguen a buen término",
  people:           "acompañar personas, gestionar talento y trabajar cerca de equipos",
  entrepreneurship: "crear o hacer crecer negocios con visión y capacidad de decisión"
};

// Short work descriptions for 3+ cluster headlines (no area labels)
const CLUSTER_WORK_SHORT = {
  data:             "trabajar con datos",
  finance:          "manejar los números del negocio",
  control_gestion:  "controlar y mejorar procesos",
  commercial:       "gestionar clientes y resultados",
  marketing:        "comunicar y medir impacto",
  operations:       "ordenar la operación",
  projects:         "coordinar proyectos y equipos",
  people:           "trabajar con personas",
  entrepreneurship: "crear y hacer crecer negocios"
};

/**
 * Derives context message from top-5 ranked roles.
 * Areas are interpreted from the result, never used as ranking input.
 */
function buildExploreContextMessage(topRoles) {
  if (!topRoles || topRoles.length === 0) {
    return {
      headline: "Vemos señales hacia ciertos tipos de trabajo según lo que nos contaste.",
      subtext:  "Las opciones que ves abajo combinan bien con esta forma de trabajar y el tipo de tareas que te interesan hoy."
    };
  }

  const top3 = topRoles.slice(0, 3);
  const clusterCounts = {};
  for (const r of top3) {
    const cl = ROLE_CLUSTERS[r.category] || null;
    if (cl) clusterCounts[cl] = (clusterCounts[cl] || 0) + 1;
  }
  const clusters = Object.entries(clusterCounts).sort((a, b) => b[1] - a[1]).map(([c]) => c);

  if (clusters.length === 1) {
    const label = CLUSTER_WORK_LABELS[clusters[0]] || clusters[0];
    return {
      headline: `Hay señales claras de que te calzan roles donde ${label}.`,
      subtext:  "Las opciones que ves abajo combinan bien con esta forma de trabajar y el tipo de tareas que te interesan hoy."
    };
  }

  if (clusters.length === 2) {
    const l1 = CLUSTER_WORK_LABELS[clusters[0]] || clusters[0];
    const l2 = CLUSTER_WORK_LABELS[clusters[1]] || clusters[1];
    return {
      headline: `Vemos una mezcla entre roles donde ${l1} y otros donde ${l2}.`,
      subtext:  "Eso es normal al inicio — hay más de un camino posible. Estas son las opciones que hoy muestran mejor fit con lo que nos contaste."
    };
  }

  const shortLabels = clusters.slice(0, 3).map(c => CLUSTER_WORK_SHORT[c] || c).join(", ");
  return {
    headline: `Hoy aparecen varias direcciones posibles: ${shortLabels}.`,
    subtext:  "El perfil muestra señales distribuidas. Estas son las opciones que hoy muestran mejor fit con lo que nos contaste."
  };
}

// -------------------------------------------------------------------
// Matching principal
// -------------------------------------------------------------------

const STRONG_THRESHOLD  = 65;
const STRETCH_THRESHOLD = 25;

// Mapeo de opciones "evitar" a categorías/familias que penalizan.
// Se verifica contra role.category (más específico) Y role.primary_families (más amplio).
// Valores de clave coinciden con los que envía el frontend (exploreAvoid).
const AVOID_PENALTIES = {
  "ventas-metas":         { categories: ["comercial"],              families: [] },
  "atencion-clientes":    { categories: ["comercial", "personas"],  families: [] },
  "trabajo-terreno":      { categories: ["geociencias", "medioambiente"], families: ["geociencias", "medioambiente"] },
  "ambiente-competitivo": { categories: ["comercial"],              families: [] }
  // "trabajo-repetitivo" y "industrias-no-van" no se mapean sin LLM
};

/**
 * Retorna 0.75 si el rol pertenece a una categoría o familia que el usuario quiere evitar.
 * La penalización se aplica una sola vez aunque múltiples avoid coincidan.
 */
function computeAvoidPenalty(avoidPreferences, role) {
  if (!avoidPreferences || avoidPreferences.length === 0) return 1;
  const roleCategory = role.category || "";
  const roleFamilies = new Set(role.primary_families || []);

  for (const avoidVal of avoidPreferences) {
    const rule = AVOID_PENALTIES[avoidVal];
    if (!rule) continue;
    if (rule.categories.includes(roleCategory)) return 0.75;
    if (rule.families.some((f) => roleFamilies.has(f))) return 0.75;
  }
  return 1;
}

function matchRoles(profile, roleCatalog, metadata = {}) {
  const isExploreMode = (metadata.user_intent_mode === "explore");

  const areasInterest = Array.isArray(metadata.areas_interest)
    ? metadata.areas_interest
    : (metadata.areas_interest ? JSON.parse(metadata.areas_interest) : []);

  const enrichedProfile = {
    ...profile,
    areas_of_interest: metadata.areasOfInterest || profile.areas_of_interest || [],
    desired_modality:  metadata.desiredModality  || profile.desired_modality  || [],
    specialization:    profile.specialization    || []
  };
  const avoidPreferences = metadata.avoidPreferences || [];

  // ─── EXPLORE MODE: behavioral-first scoring ──────────────────────
  if (isExploreMode) {
    const taskPrefs     = metadata.task_prefs       || [];
    const motivPrefs    = metadata.motivation_prefs || [];
    const interestPrefs = metadata.interest_prefs   || [];
    const cv_weight     = metadata.cv_weight !== undefined ? metadata.cv_weight : 1.0;
    const userTraits = buildUserTraitVector(taskPrefs, motivPrefs, interestPrefs);

    const EXPLORE_STRONG  = 40;
    const EXPLORE_STRETCH = 12;

    const exploreCatalog = roleCatalog.filter(r => !r.requires_cv_gate);

    const allScored = exploreCatalog
      .map((role) => {
        // CV component (0-35)
        const cvResult  = scoreCv(enrichedProfile, role);
        // Separar grado (siempre estable) del cvSignal (modulado por relevancia)
        const degreePts = cvResult.degreeRaw === 30 ? 14 : cvResult.degreeRaw === 20 ? 10 : cvResult.degreeRaw === 10 ? 5 : 0;
        const cvSignal  = cvResult.cv - degreePts;
        const cvScore   = degreePts + Math.round(cvSignal * cv_weight);

        // Behavioral component (0-40)
        const behavioralScore = scoreBehavioral(userTraits, role);

        // Avoid penalty (additive subtraction)
        const avoidPenalty = computeAvoidPenaltyAdditive(avoidPreferences, role);

        // Postgraduate penalty for basic roles (flat deduction)
        const isBasicRole = /^Asistente\s/i.test(role.title);
        const pgPenalty   = (enrichedProfile.has_postgrad && isBasicRole) ? 8 : 0;

        // Intent gate penalty: roles with generic behavioral profiles require domain signals
        const intentGatePenalty = computeIntentGatePenalty(role.id, interestPrefs, taskPrefs);

        const score = Math.max(0, Math.min(75,
          cvScore + behavioralScore - avoidPenalty - pgPenalty - intentGatePenalty
        ));

        const missingSkills = buildMissingSkills(enrichedProfile, role);
        const top_missing_skills = [...missingSkills]
          .sort((a, b) => (ACTIONABLE_SKILLS.has(normalizeText(a)) ? 0 : 1) - (ACTIONABLE_SKILLS.has(normalizeText(b)) ? 0 : 1))
          .slice(0, 3);

        const interestAlignment = evaluateInterestAlignment(
          enrichedProfile, role, cvResult.degreeRaw, cvResult.skillsRaw, cvResult.expRaw, cvResult.specRaw
        );
        const interestNote = (interestAlignment.alignment === "low" && interestAlignment.declared_interest)
          ? buildInterestNote(top_missing_skills)
          : null;

        return {
          id:               role.id,
          title:            role.title,
          area:             role.area,
          subarea:          role.subarea,
          category:         role.category,
          entry_type:       role.entry_type,
          has_commission:   role.has_commission   || false,
          requires_cv_gate: role.requires_cv_gate || false,
          domain:           role.domain           || null,
          score,
          role_traits:      role.traits || {},
          score_breakdown: {
            cv:                 cvScore,
            cv_weight,
            behavioral:         behavioralScore,
            avoid_penalty:      avoidPenalty,
            intent_gate_penalty: intentGatePenalty,
            // Legacy fields — kept for evaluateInterestAlignment + computeRecommendationScore
            carrera:         cvResult.degreeRaw,
            skills:          cvResult.skillsRaw,
            especializacion: cvResult.specRaw,
            experiencia:     cvResult.expRaw,
            intereses:       0,
            modalidad:       0
          },
          match_reasons:      buildReasons(enrichedProfile, role, cvResult.degreeRaw, cvResult.specRaw),
          gaps:               buildGaps(enrichedProfile, role),
          missing_skills:     missingSkills,
          top_missing_skills,
          interest_alignment: interestAlignment,
          interest_note:      interestNote,
          job_links:          generateJobLinks(role, enrichedProfile.city)
        };
      })
      .filter((r) => r.score >= EXPLORE_STRETCH)
      .sort((a, b) => b.score - a.score);

    // Domain fit: apply soft modifier to top 20, then re-sort.
    // Operates on already-scored roles so behavioral stays as primary driver.
    // Uses map (not forEach) to avoid mutating allScored objects.
    const userCareer = enrichedProfile.degree || "";
    const topN = allScored.slice(0, 20).map(r => {
      const modifier = getDomainFitModifier(userCareer, r.domain);
      return {
        ...r,
        score: modifier !== 0 ? Math.max(0, Math.min(75, r.score + modifier)) : r.score,
        score_breakdown: { ...r.score_breakdown, domain_fit: modifier }
      };
    });
    const rest = allScored.slice(20);
    const reRanked = [...topN.sort((a, b) => b.score - a.score), ...rest];

    const top5 = diversifyResults(reRanked);

    const strongMatches  = top5.filter((r) => r.score >= EXPLORE_STRONG);
    const stretchMatches = top5.filter((r) => r.score < EXPLORE_STRONG);

    [...strongMatches, ...stretchMatches].forEach((r) => {
      r.recommendation_score = computeRecommendationScore(r);
    });

    const allRanked = [...strongMatches, ...stretchMatches]
      .sort((a, b) => b.recommendation_score - a.recommendation_score);
    if (allRanked[0]) allRanked[0].is_recommended = true;

    const profileQuality = evaluateProfileQuality(enrichedProfile);
    const allTopRoles = [...strongMatches, ...stretchMatches];
    const context_message = buildExploreContextMessage(allTopRoles);

    return {
      detected_area:   buildDetectedArea(enrichedProfile, strongMatches, stretchMatches),
      strong_matches:  strongMatches,
      stretch_matches: stretchMatches,
      profile_quality: profileQuality,
      weights_used:    { mode: "explore", user_traits: userTraits },
      context_message
    };
  }

  // ─── GUIDED MODE: original weighted scoring ────────────────────────
  const profileQuality  = evaluateProfileQuality(enrichedProfile);
  const baseWeights     = getDynamicWeights(profileQuality);

  const isUnknownCareer = !getCareerFamilies(enrichedProfile.degree || "");
  const weights = isUnknownCareer
    ? { ...baseWeights, carrera: Math.max(10, baseWeights.carrera - 15), intereses: baseWeights.intereses + 15 }
    : baseWeights;

  const totalWeightSum = Object.values(weights).reduce((a, b) => a + b, 0);

  const allScored = roleCatalog
    .map((role) => {
      const degreeScore         = scoreDegree(enrichedProfile, role);
      const skillScore          = scoreSkills(enrichedProfile, role);
      const experienceScore     = scoreExperience(enrichedProfile, role);
      const specializationScore = scoreSpecialization(enrichedProfile, role);
      const interestScore       = scoreInterests(enrichedProfile, role);
      const modalityScore       = scoreModality(enrichedProfile, role);

      const weightedRaw =
        (degreeScore         / 30) * weights.carrera        +
        (skillScore          / 25) * weights.skills          +
        (experienceScore     / 15) * weights.experiencia     +
        (specializationScore / 15) * weights.especializacion +
        (interestScore       / 10) * weights.intereses       +
        (modalityScore       / 5)  * weights.modalidad;

      const rawScore = Math.round((weightedRaw / totalWeightSum) * 100);

      const isBasicRole         = /^Asistente\s/i.test(role.title);
      const postgraduatePenalty = (enrichedProfile.has_postgrad && isBasicRole) ? 0.7 : 1;
      const avoidPenalty        = computeAvoidPenalty(avoidPreferences, role);
      const noFamilyPenalty     = (degreeScore === 0 && !isUnknownCareer) ? 0.6 : 1;
      const score = Math.min(100, Math.round(
        rawScore * postgraduatePenalty * avoidPenalty * noFamilyPenalty
      ));

      const missingSkills = buildMissingSkills(enrichedProfile, role);
      const top_missing_skills = [...missingSkills]
        .sort((a, b) => {
          const aActionable = ACTIONABLE_SKILLS.has(normalizeText(a)) ? 0 : 1;
          const bActionable = ACTIONABLE_SKILLS.has(normalizeText(b)) ? 0 : 1;
          return aActionable - bActionable;
        })
        .slice(0, 3);

      const interestAlignment = evaluateInterestAlignment(
        enrichedProfile, role, degreeScore, skillScore, experienceScore, specializationScore
      );
      const interestNote = (interestAlignment.alignment === "low" && interestAlignment.declared_interest)
        ? buildInterestNote(top_missing_skills)
        : null;

      return {
        id:              role.id,
        title:           role.title,
        area:            role.area,
        subarea:         role.subarea,
        category:        role.category,
        entry_type:      role.entry_type,
        has_commission:  role.has_commission  || false,
        requires_cv_gate: role.requires_cv_gate || false,
        score,
        score_breakdown: {
          carrera:         degreeScore,
          skills:          skillScore,
          especializacion: specializationScore,
          experiencia:     experienceScore,
          intereses:       interestScore,
          modalidad:       modalityScore
        },
        match_reasons:      buildReasons(enrichedProfile, role, degreeScore, specializationScore),
        gaps:               buildGaps(enrichedProfile, role),
        missing_skills:     missingSkills,
        top_missing_skills,
        interest_alignment: interestAlignment,
        interest_note:      interestNote,
        job_links:          generateJobLinks(role, enrichedProfile.city)
      };
    })
    .filter((r) => r !== null && r.score >= STRETCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  const strongMatches  = allScored.filter((r) => r.score >= STRONG_THRESHOLD).slice(0, 5);
  const stretchMatches = allScored.filter((r) => r.score < STRONG_THRESHOLD).slice(0, 5);

  [...strongMatches, ...stretchMatches].forEach((r) => {
    r.recommendation_score = computeRecommendationScore(r);
  });

  const allRanked = [...strongMatches, ...stretchMatches]
    .sort((a, b) => b.recommendation_score - a.recommendation_score);
  const topRecommended = allRanked[0];
  if (topRecommended) topRecommended.is_recommended = true;

  const user_type = classifyUserType(enrichedProfile, {
    strong_matches:  strongMatches,
    stretch_matches: stretchMatches
  });

  const context_message = buildContextMessage(user_type, enrichedProfile, topRecommended || allRanked[0] || null);

  return {
    detected_area:   buildDetectedArea(enrichedProfile, strongMatches, stretchMatches),
    strong_matches:  strongMatches,
    stretch_matches: stretchMatches,
    profile_quality: profileQuality,
    weights_used:    weights,
    user_type,
    context_message
  };
}

module.exports = { matchRoles };
