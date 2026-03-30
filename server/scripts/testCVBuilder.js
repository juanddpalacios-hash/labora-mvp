"use strict";

/**
 * testCVBuilder.js
 *
 * Corre con: node server/scripts/testCVBuilder.js
 *
 * Valida los dos flujos del CV builder:
 *   Caso A — IC + finanzas, con CV → flow optimize
 *   Caso B — Estudiante sin CV  → flow generate
 */

const { normalizeCV }     = require("../services/cvNormalizer");
const { optimizeCV }      = require("../services/cvOptimizer");
const { generateCVDraft } = require("../services/cvDraftGenerator");

// ─────────────────────────────────────────────────────────────────────
// CASO A — IC + finanzas, optimizar CV existente
// ─────────────────────────────────────────────────────────────────────

const MOCK_PROFILE_A = {
  name:           "Valentina Rojas",
  degree:         "Ingeniería Comercial",
  has_postgrad:   false,
  tools:          ["excel", "sap", "power bi"],
  languages:      ["inglés"],
  specialization: ["finanzas", "análisis financiero"],
  experience:     ["Práctica en BCI — área de finanzas corporativas"],
};

const MOCK_RAW_CV_A = `
VALENTINA ROJAS MUÑOZ
valentinarojas@gmail.com | +56 9 8765 4321 | linkedin.com/in/valentinarojas

EXPERIENCIA

BCI Banco
Analista Financiero (Práctica Profesional)
Mar 2024 – Jul 2024
- Elaboró reportes de gestión mensual para el área de finanzas corporativas
- Apoyó en la consolidación de estados financieros trimestrales
- Analizó variaciones de costos operacionales usando Excel avanzado
- Participó en cierre contable de fin de mes con SAP

EDUCACIÓN

Universidad de Chile
Ingeniería Comercial
2019 – 2024

CURSOS
Excel Avanzado — Coursera, 2023
Introducción a Power BI — LinkedIn Learning, 2024
`.trim();

console.log("\n" + "═".repeat(60));
console.log("CASO A — Optimizar CV existente");
console.log("Rol objetivo: Analista Financiero Junior");
console.log("═".repeat(60));

const normalizedA = normalizeCV(MOCK_PROFILE_A, MOCK_RAW_CV_A);
const resultA = optimizeCV(normalizedA, MOCK_PROFILE_A, "Analista Financiero Junior");

console.log("\n[HEADER]");
console.log("  Nombre:", resultA.cv.header.full_name);
console.log("  Carrera:", resultA.cv.header.degree_line);
console.log("  Contacto:", resultA.cv.header.contact_line);

console.log("\n[RESUMEN PROFESIONAL]");
console.log(" ", resultA.cv.professional_summary);

console.log("\n[EXPERIENCIAS]");
for (const exp of resultA.cv.experience) {
  console.log(`  ${exp.organization} — ${exp.role} (${exp.date_range}) [relevancia: ${exp.relevance_score}]`);
  for (const b of exp.bullets) {
    console.log(`    • ${b}`);
  }
}

console.log("\n[EDUCACIÓN]");
for (const edu of resultA.cv.education) {
  console.log(`  ${edu.institution} — ${edu.degree} (${edu.date_range})`);
}

console.log("\n[HERRAMIENTAS]", resultA.cv.additional_info.softwares.join(", "));
console.log("[IDIOMAS]", resultA.cv.additional_info.languages.join(", "));

console.log("\n[MEJORAS]");
for (const m of resultA.improvements_made) console.log("  ✓", m);

console.log("\n[INFORMACIÓN FALTANTE]");
if (resultA.missing_information.length === 0) {
  console.log("  (ninguna)");
} else {
  for (const m of resultA.missing_information) console.log("  ⚠", m);
}

// ─────────────────────────────────────────────────────────────────────
// CASO B — Estudiante sin CV, generar borrador
// ─────────────────────────────────────────────────────────────────────

const USER_INPUTS_B = {
  full_name:       "Martín Soto",
  email:           "martinsotos@gmail.com",
  phone:           "+56 9 1234 5678",
  linkedin:        "",
  degree:          "Ingeniería en Información y Control de Gestión",
  has_postgrad:    false,
  academic_status: "cursando",
  graduation_year: "2025",
  institution:     "Universidad de Santiago",

  experiences: [
    {
      organization: "StartupCL",
      role:         "Ayudante de análisis de datos",
      date_range:   "Ago 2024 – Dic 2024",
      what_did:     "Procesé datos de ventas en Excel y Python. Generé dashboards en Power BI. Apoyé al equipo con reportes semanales de KPIs.",
    },
  ],

  tools:     ["Python", "Excel", "Power BI", "SQL"],
  languages: ["Inglés B1", "Español nativo"],
  courses:   ["Python para Análisis de Datos — Udemy, 2024"],
};

console.log("\n" + "═".repeat(60));
console.log("CASO B — Generar CV desde cero (sin archivo)");
console.log("Rol objetivo: Analista de Datos Junior");
console.log("═".repeat(60));

const resultB = generateCVDraft(USER_INPUTS_B, "Analista de Datos Junior");

console.log("\n[HEADER]");
console.log("  Nombre:", resultB.cv.header.full_name);
console.log("  Carrera:", resultB.cv.header.degree_line);
console.log("  Contacto:", resultB.cv.header.contact_line);

console.log("\n[RESUMEN PROFESIONAL]");
console.log(" ", resultB.cv.professional_summary);

console.log("\n[EXPERIENCIAS]");
for (const exp of resultB.cv.experience) {
  console.log(`  ${exp.organization} — ${exp.role} (${exp.date_range})`);
  for (const b of exp.bullets) {
    console.log(`    • ${b}`);
  }
}

console.log("\n[EDUCACIÓN]");
for (const edu of resultB.cv.education) {
  console.log(`  ${edu.institution} — ${edu.degree} (${edu.date_range})`);
}

console.log("\n[CURSOS]", resultB.cv.courses_certifications.join(", "));
console.log("[HERRAMIENTAS]", resultB.cv.additional_info.softwares.join(", "));
console.log("[IDIOMAS]", resultB.cv.additional_info.languages.join(", "));

console.log("\n[MEJORAS]");
for (const m of resultB.improvements_made) console.log("  ✓", m);

console.log("\n[INFORMACIÓN FALTANTE]");
if (resultB.missing_information.length === 0) {
  console.log("  (ninguna)");
} else {
  for (const m of resultB.missing_information) console.log("  ⚠", m);
}

console.log("\n" + "═".repeat(60));
console.log("Test completado.");
console.log("═".repeat(60) + "\n");
