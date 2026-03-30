"use strict";

/**
 * routes/cv.js
 *
 * POST /api/cv/build
 *
 * Maneja dos flujos:
 *   flow: "optimize" — usuario tiene CV → normalizar + optimizar
 *   flow: "generate" — usuario sin CV → generar borrador desde inputs
 *
 * Body (JSON):
 * {
 *   flow:       "optimize" | "generate",
 *   targetRole: string,
 *   profile:    object,   // perfil de aiExtractor (solo para flow:optimize)
 *   rawCvText:  string,   // texto crudo del CV (solo para flow:optimize)
 *   userInputs: object,   // respuestas del formulario (solo para flow:generate)
 * }
 */

const express    = require("express");
const router     = express.Router();
const { normalizeCV }     = require("../services/cvNormalizer");
const { optimizeCV }      = require("../services/cvOptimizer");
const { generateCVDraft } = require("../services/cvDraftGenerator");

router.post("/build", (req, res) => {
  const { flow, targetRole, profile, rawCvText, userInputs } = req.body;

  if (!flow || !targetRole) {
    return res.status(400).json({
      success: false,
      error:   "Se requieren los campos 'flow' y 'targetRole'.",
    });
  }

  if (flow !== "optimize" && flow !== "generate") {
    return res.status(400).json({
      success: false,
      error:   "El campo 'flow' debe ser 'optimize' o 'generate'.",
    });
  }

  try {
    let result;

    if (flow === "optimize") {
      if (!profile) {
        return res.status(400).json({
          success: false,
          error:   "El flow 'optimize' requiere el campo 'profile'.",
        });
      }
      const normalizedCV = normalizeCV(profile, rawCvText || "");
      result = optimizeCV(normalizedCV, profile, targetRole);
      result.flow            = "optimize";
      result.cv_version_type = "optimized";
      result.target_role     = targetRole;

    } else {
      // flow === "generate"
      if (!userInputs) {
        return res.status(400).json({
          success: false,
          error:   "El flow 'generate' requiere el campo 'userInputs'.",
        });
      }
      result = generateCVDraft(userInputs, targetRole);
      result.flow            = "generate";
      result.cv_version_type = "generated";
      result.target_role     = targetRole;
    }

    // Mapa de secciones presentes (útil para el frontend)
    result.sections = {
      has_summary:     !!result.cv.professional_summary,
      experience_count: (result.cv.experience || []).length,
      education_count:  (result.cv.education  || []).length,
      courses_count:    (result.cv.courses_certifications || []).length,
      has_tools:        (result.cv.additional_info?.softwares || []).length > 0,
      has_languages:    (result.cv.additional_info?.languages || []).length > 0,
    };

    return res.json({ success: true, ...result });

  } catch (err) {
    console.error("[cv/build] Error:", err);
    return res.status(500).json({
      success: false,
      error:   "Error interno al procesar el CV.",
    });
  }
});

module.exports = router;
