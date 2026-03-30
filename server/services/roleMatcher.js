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
  "administracion de empresas":       { primary: ["negocios"],                          secondary: ["personas"] },
  "arquitectura":                     { primary: ["diseno", "ingenieria"],              secondary: [] },
  "biologia":                         { primary: ["ciencias", "medioambiente"],         secondary: [] },
  "bioquimica":                       { primary: ["ciencias"],                          secondary: [] },
  "ciencia politica":                 { primary: ["ciencias-sociales"],                 secondary: ["personas"] },
  "comunicacion audiovisual":         { primary: ["comunicacion"],                      secondary: [] },
  "contador auditor":                 { primary: ["finanzas", "negocios"],              secondary: ["analitica"] },
  "derecho":                          { primary: ["derecho"],                           secondary: ["negocios"] },
  "diseno grafico":                   { primary: ["diseno"],                            secondary: ["comunicacion"] },
  "economia":                         { primary: ["negocios", "analitica"],             secondary: ["finanzas"] },
  "enfermeria":                       { primary: ["salud"],                             secondary: [] },
  "estadistica":                      { primary: ["analitica"],                         secondary: ["negocios"] },
  "geografia":                        { primary: ["geociencias"],                       secondary: ["medioambiente"] },
  "geologia":                         { primary: ["geociencias"],                       secondary: ["medioambiente", "ingenieria"] },
  "historia":                         { primary: ["ciencias-sociales"],                 secondary: [] },
  "ingenieria ambiental":             { primary: ["medioambiente", "ingenieria"],       secondary: ["geociencias"] },
  "ingenieria civil":                 { primary: ["ingenieria"],                        secondary: ["operaciones"] },
  "ingenieria civil electrica":       { primary: ["ingenieria"],                        secondary: ["tecnologia"] },
  "ingenieria civil industrial":      { primary: ["ingenieria", "operaciones"],         secondary: ["analitica", "negocios"] },
  "ingenieria civil mecanica":        { primary: ["ingenieria"],                        secondary: ["operaciones"] },
  "ingenieria civil quimica":         { primary: ["ingenieria", "ciencias"],            secondary: [] },
  "ingenieria comercial":             { primary: ["negocios"],                          secondary: ["analitica", "finanzas"] },
  "ingenieria en biotecnologia":      { primary: ["ciencias", "ingenieria"],            secondary: [] },
  "ingenieria en informatica":        { primary: ["tecnologia", "analitica"],           secondary: ["negocios"] },
  "ingenieria en minas":              { primary: ["ingenieria", "geociencias"],         secondary: [] },
  "ingenieria en recursos naturales": { primary: ["geociencias", "medioambiente"],      secondary: ["ingenieria"] },
  "kinesiologia":                     { primary: ["salud"],                             secondary: [] },
  "logistica":                        { primary: ["operaciones", "negocios"],           secondary: [] },
  "medicina":                         { primary: ["salud"],                             secondary: ["ciencias"] },
  "nutricion y dietetica":            { primary: ["salud"],                             secondary: ["ciencias"] },
  "odontologia":                      { primary: ["salud"],                             secondary: [] },
  "pedagogia en educacion basica":    { primary: ["educacion", "personas"],             secondary: [] },
  "periodismo":                       { primary: ["comunicacion"],                      secondary: ["ciencias-sociales"] },
  "psicologia":                       { primary: ["personas"],                          secondary: ["salud"] },
  "quimica":                          { primary: ["ciencias"],                          secondary: [] },
  "relaciones publicas":              { primary: ["comunicacion", "negocios"],          secondary: ["personas"] },
  "sociologia":                       { primary: ["personas", "ciencias-sociales"],     secondary: ["analitica"] },
  "trabajo social":                   { primary: ["personas"],                          secondary: ["ciencias-sociales"] },
  "terapia ocupacional":              { primary: ["salud"],                             secondary: ["personas"] },
  // Negocios — carreras nuevas
  "auditoria":                        { primary: ["finanzas", "negocios"],              secondary: ["analitica"] },
  "comercio internacional":           { primary: ["negocios"],                          secondary: ["operaciones"] },
  "finanzas":                         { primary: ["finanzas", "negocios"],              secondary: ["analitica"] },
  "marketing":                        { primary: ["negocios"],                          secondary: ["comunicacion"] },
  "ingenieria en finanzas":           { primary: ["finanzas", "negocios"],              secondary: ["analitica"] },
  "ingenieria en marketing":          { primary: ["negocios"],                          secondary: ["comunicacion"] },
  "ingenieria en administracion de empresas": { primary: ["negocios"],                 secondary: ["operaciones"] },
  "ingenieria en negocios internacionales":   { primary: ["negocios"],                 secondary: ["operaciones"] },
  "ingenieria en gestion de personas": { primary: ["personas", "negocios"],            secondary: [] },
  "administracion publica":           { primary: ["negocios", "ciencias-sociales"],    secondary: ["personas"] },
  // Ingeniería — carreras nuevas
  "ingenieria en alimentos":          { primary: ["ingenieria", "ciencias"],            secondary: [] },
  "ingenieria en computacion":        { primary: ["tecnologia", "analitica"],           secondary: ["ingenieria"] },
  "ingenieria en construccion":       { primary: ["ingenieria"],                        secondary: ["operaciones"] },
  "ingenieria en gestion industrial": { primary: ["ingenieria", "operaciones"],         secondary: ["negocios"] },
  "ingenieria en metalurgia":         { primary: ["ingenieria"],                        secondary: [] },
  "ingenieria en prevencion de riesgos": { primary: ["operaciones"],                   secondary: ["ingenieria"] },
  "ingenieria en telecomunicaciones": { primary: ["tecnologia", "ingenieria"],          secondary: [] },
  "ingenieria forestal":              { primary: ["medioambiente", "ingenieria"],       secondary: [] },
  // Tecnología — carreras nuevas
  "ingenieria en sistemas":           { primary: ["tecnologia", "analitica"],           secondary: ["ingenieria"] },
  "ingenieria en redes":              { primary: ["tecnologia", "ingenieria"],          secondary: [] },
  "analisis de sistemas":             { primary: ["tecnologia", "analitica"],           secondary: [] },
  "ciencias de la computacion":       { primary: ["tecnologia", "analitica"],           secondary: ["ingenieria"] },
  "ingenieria de software":           { primary: ["tecnologia"],                        secondary: ["analitica"] },
  "ingenieria en ciberseguridad":     { primary: ["tecnologia"],                        secondary: ["ingenieria"] },
  "ingenieria en desarrollo de software": { primary: ["tecnologia"],                   secondary: ["analitica"] },
  // Ciencias — nuevas
  "agronomia":                        { primary: ["medioambiente", "ciencias"],         secondary: [] },
  "oceanografia":                     { primary: ["geociencias", "medioambiente"],      secondary: ["ciencias"] },
  // Salud — nuevas
  "fonoaudiologia":                   { primary: ["salud"],                             secondary: [] },
  "medicina veterinaria":             { primary: ["salud", "ciencias"],                 secondary: [] },
  "obstetricia":                      { primary: ["salud"],                             secondary: [] },
  "quimico farmaceutico":             { primary: ["salud", "ciencias"],                 secondary: [] },
  "tecnologia medica":                { primary: ["salud"],                             secondary: ["analitica"] },
  // Educación — nuevas
  "educacion diferencial":            { primary: ["educacion", "personas"],             secondary: [] },
  "educacion parvularia":             { primary: ["educacion", "personas"],             secondary: [] },
  "pedagogia en educacion media":     { primary: ["educacion", "personas"],             secondary: [] },
  "pedagogia en historia":            { primary: ["educacion", "ciencias-sociales"],    secondary: [] },
  "pedagogia en ingles":              { primary: ["educacion"],                         secondary: ["comunicacion"] },
  "pedagogia en lenguaje":            { primary: ["educacion", "comunicacion"],         secondary: [] },
  "pedagogia en matematicas":         { primary: ["educacion", "analitica"],            secondary: [] },
  // Humanidades — nuevas
  "antropologia":                     { primary: ["ciencias-sociales"],                 secondary: ["personas"] },
  "filosofia":                        { primary: ["ciencias-sociales"],                 secondary: [] },
  // Comunicación / diseño — nuevas
  "comunicacion social":              { primary: ["comunicacion"],                      secondary: [] },
  "diseno industrial":                { primary: ["diseno", "ingenieria"],              secondary: [] },
  "publicidad":                       { primary: ["comunicacion", "negocios"],          secondary: [] },
  // Turismo / gastronomía — nuevas
  "turismo":                          { primary: ["operaciones", "negocios"],           secondary: [] },
  "hoteleria":                        { primary: ["operaciones", "negocios"],           secondary: [] },
  "gastronomia":                      { primary: ["operaciones"],                       secondary: [] },
  "gestion del turismo":              { primary: ["operaciones", "negocios"],           secondary: [] }
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

// Frases rotativas para brechas de skills — tono accionable, orientado a progreso
const SKILL_GAP_PHRASES = [
  (s) => `Practicar ${s} te acercaría más a este rol.`,
  (s) => `Reforzar tu manejo de ${s} te daría más base para este rol.`,
  (s) => `Sumar práctica en ${s} fortalecería tu candidatura.`,
  (s) => `Aprender ${s} marcaría diferencia para este rol.`
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
  finanzas:      "Finanzas",
  analitica:     "Analítica y Datos",
  marketing:     "Marketing Digital",
  comercial:     "Comercial",
  personas:      "Recursos Humanos",
  operaciones:   "Operaciones",
  logistica:     "Logística",
  geociencias:   "Geociencias",
  medioambiente: "Medioambiente"
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

  const allMatches = [...strongMatches, ...stretchMatches];
  const subareas   = [...new Set(allMatches.map((m) => m.subarea).filter(Boolean))].slice(0, 4);

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
// Matching principal
// -------------------------------------------------------------------

const STRONG_THRESHOLD  = 65;
const STRETCH_THRESHOLD = 35;

function matchRoles(profile, roleCatalog, metadata = {}) {
  const enrichedProfile = {
    ...profile,
    areas_of_interest: metadata.areasOfInterest || profile.areas_of_interest || [],
    desired_modality:  metadata.desiredModality  || profile.desired_modality  || [],
    specialization:    profile.specialization    || []
  };

  // Evaluar calidad del perfil UNA VEZ antes del loop
  const profileQuality  = evaluateProfileQuality(enrichedProfile);
  const weights         = getDynamicWeights(profileQuality);
  const totalWeightSum  = Object.values(weights).reduce((a, b) => a + b, 0);

  const allScored = roleCatalog
    .map((role) => {
      const degreeScore         = scoreDegree(enrichedProfile, role);
      const skillScore          = scoreSkills(enrichedProfile, role);
      const experienceScore     = scoreExperience(enrichedProfile, role);
      const specializationScore = scoreSpecialization(enrichedProfile, role);
      const interestScore       = scoreInterests(enrichedProfile, role);
      const modalityScore       = scoreModality(enrichedProfile, role);

      // Cada dimensión se normaliza (0-1) y luego se escala por su peso dinámico.
      // El resultado se normaliza a 100 dividiendo por totalWeightSum.
      const weightedRaw =
        (degreeScore         / 30) * weights.carrera        +
        (skillScore          / 25) * weights.skills          +
        (experienceScore     / 15) * weights.experiencia     +
        (specializationScore / 15) * weights.especializacion +
        (interestScore       / 10) * weights.intereses       +
        (modalityScore       / 5)  * weights.modalidad;

      const rawScore = Math.round((weightedRaw / totalWeightSum) * 100);

      // Sin overlap formativo → penalización suave (×0.6) en vez de exclusión total
      const score = Math.min(100, degreeScore === 0 ? Math.round(rawScore * 0.6) : rawScore);

      const missingSkills = buildMissingSkills(enrichedProfile, role);

      // Priorizar skills accionables (Excel, SQL, Python, etc.) en el top
      const top_missing_skills = [...missingSkills]
        .sort((a, b) => {
          const aActionable = ACTIONABLE_SKILLS.has(normalizeText(a)) ? 0 : 1;
          const bActionable = ACTIONABLE_SKILLS.has(normalizeText(b)) ? 0 : 1;
          return aActionable - bActionable;
        })
        .slice(0, 3);

      // Alineación entre interés declarado y evidencia real del perfil (Fase 5)
      const interestAlignment = evaluateInterestAlignment(
        enrichedProfile, role, degreeScore, skillScore, experienceScore, specializationScore
      );
      const interestNote = (interestAlignment.alignment === "low" && interestAlignment.declared_interest)
        ? buildInterestNote(top_missing_skills)
        : null;

      return {
        id:       role.id,
        title:    role.title,
        area:     role.area,
        subarea:  role.subarea,
        category: role.category,
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

  // Calcular recommendation_score en cada rol (Fase 6)
  [...strongMatches, ...stretchMatches].forEach((r) => {
    r.recommendation_score = computeRecommendationScore(r);
  });

  // El recomendado principal es el de mayor recommendation_score,
  // no necesariamente el de mayor score bruto
  const allRanked = [...strongMatches, ...stretchMatches]
    .sort((a, b) => b.recommendation_score - a.recommendation_score);
  const topRecommended = allRanked[0];
  if (topRecommended) topRecommended.is_recommended = true;

  // Clasificar tipo de usuario (Fase 4)
  const user_type = classifyUserType(enrichedProfile, {
    strong_matches:  strongMatches,
    stretch_matches: stretchMatches
  });

  // Mensaje contextual adaptado al tipo de usuario (Fase 8)
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
