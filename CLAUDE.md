# CLAUDE.md — Labora MVP

Reglas operativas para este proyecto. Actualizar tras cada corrección o sesión significativa.
Notas detalladas del proyecto: `.notes/project-log.md`

---

## Contexto del proyecto

Motor de matching laboral para egresados chilenos. Stack: Node.js + Express + multer + vanilla JS frontend.
Servidor activo en PM2, puerto 3000. Comando: `pm2 restart labora-mvp`.

Archivos clave:
- `server/services/roleMatcher.js` — motor de scoring (6 dimensiones, pesos dinámicos)
- `server/routes/analyze.js` — POST /api/analyze, recibe CV + metadatos del formulario
- `server/services/aiExtractor.js` — extrae perfil estructurado del texto del CV
- `data/junior_roles.json` — catálogo de 11 roles junior con required_skills, families, etc.
- `public/app.js` — lógica frontend + renderizado de resultados
- `public/upload.html` — formulario de onboarding
- `server/utils/text.js` — `normalizeText`, `arrayIncludesNormalized`, `overlapCount`

---

## Reglas de flujo de trabajo

### Planificación
- Entrar en modo plan para cualquier tarea de 3+ pasos o con decisiones de arquitectura.
- Escribir la especificación antes de tocar código.
- Si algo se desvía, detenerse y replantear antes de continuar.

### Verificación
- Nunca declarar una tarea completa sin evidencia: correr el servidor, hacer una llamada real, revisar logs.
- Ante cualquier cambio en `roleMatcher.js` o `analyze.js`: reiniciar PM2 y hacer un request de prueba.
- Revisar `pm2 logs labora-mvp` ante errores inesperados.

### Subagentes
- Exploración de código → agente Explore.
- Investigación / análisis paralelo → agente general-purpose.
- No hacer búsquedas amplias en el hilo principal.

### Corrección de errores
- Ante un reporte de error: leer logs → identificar causa raíz → corregir → verificar. Sin preguntar.
- Actualizar este CLAUDE.md y `.notes/project-log.md` después de cada corrección.

---

## Reglas técnicas — lecciones aprendidas

### 1. No asumir que `parsedText` está definida en el scope completo
**Error:** `ReferenceError: parsedText is not defined` en el return de `analyze.js` cuando no hay CV.
**Regla:** Si una variable se usa en el `return` final, inicializarla antes de cualquier bloque `if`.
```js
let parsedText = "";          // ← fuera del if
if (req.file) {
  const { text: cvText } = await parseUploadedFile(...);
  parsedText = cvText;        // ← asignar dentro del if
}
return res.json({ cvTextPreview: parsedText.slice(0, 500), ... });
```

### 2. La normalización de pesos cambia la escala efectiva de los scores
**Error:** Bajar `STRETCH_THRESHOLD` a 40 tras Fase 2 produjo 0 resultados para perfiles thin.
**Causa:** Con normalización `(raw/max × peso) / totalWeightSum × 100`, el máximo alcanzable con solo grado+interés es ~39, no 40.
**Regla:** Al cambiar la fórmula de scoring, recalcular los umbrales. Perfil thin (grado exacto + interés prioridad 1) debe llegar al STRETCH_THRESHOLD.
**Umbral actual:** `STRETCH_THRESHOLD = 25`, `STRONG_THRESHOLD = 65`.
_(Bajado de 35 → 25 para permitir que carreras de salud y carreras desconocidas muestren resultados cuando declaran interés. Perfiles thin con solo grado secondary + interés alcanzan ~22-28; la penalización ×0.6 para combos completamente no relacionados los baja a ~7.)_

### 3. No incluir degreeScore en evidenceScore
**Error:** `classifyUserType` y `evaluateInterestAlignment` inflaban la evidencia contando el grado.
**Causa:** Ing. Comercial tiene degree=30 para finanzas Y comercial → no discrimina qué área conoce el usuario.
**Regla:** `evidenceScore = skillScore + expScore + specScore`. El grado es contexto formativo, no evidencia de especialización.

### 4. GENERIC_INTERESTS no debe filtrar en classifyUserType
**Error:** Usuarios con interés declarado en "finanzas" o "analitica" eran clasificados como "explore".
**Causa:** `GENERIC_INTERESTS` eliminaba esos valores, dejando sin intereses específicos.
**Regla:** EXPLORE = `interests.length === 0 OR allMatches.length === 0`. No filtrar por genericidad.

### 5. Encoding UTF-8 en tests con curl en Windows/bash
**Nota:** `curl -F "degree=Ingeniería Comercial"` corrompe caracteres especiales en bash de Windows.
El servidor recibe "Ingenier\ufffd\ufffda Comercial" → `normalizeText` no puede hacer match.
**Regla:** Siempre testear desde el browser real o usar `-H "Content-Type: application/json"` con `-d` y escape Unicode (`\u00ed`) para tests con curl.

### 6. has_postgrad: dos fuentes, una respuesta
**Regla:** `has_postgrad` se fusiona con OR: `extractedProfile.has_postgrad || formPostgrad`.
- Sin CV: viene 100% del formulario (`hasPostgrad: "true"` en el body).
- Con CV: cualquiera de las dos fuentes lo activa.
La pregunta del formulario solo aparece cuando `academicStatus === "titulado"`.

### 7. academicStatus es hidden input, no select
**Error:** `renderSummary` usaba `.options[selectedIndex].text` para leer el valor → devolvía "—" siempre.
**Causa:** Se reemplazó el `<select>` por tarjetas + `<input type="hidden" id="academicStatus">`.
**Regla:** Leer `.value` directamente y mapear con `STATUS_LABELS = { estudiante, egresado, titulado }`.

### 8. Variables `let` en express handlers: scope dentro de try
**Regla general:** Declarar con `let` fuera de cualquier `if`/bloque todas las variables que se usen en el `return` del handler. No asumir que el scope de `const` dentro de un `if` es visible afuera.

---

## Principios de diseño del motor (no cambiar sin razón)

- **Degree score ≠ evidencia de especialización.** El grado abre la puerta; skills/exp/spec la acreditan.
- **Normalización por totalWeightSum.** Garantiza escala 0-100 independiente de la configuración de pesos.
- **Penalización ×0.6 en vez de exclusión.** Sin overlap formativo → score reducido, no descartado.
- **required_skills vs skills.** `required_skills` = las indispensables (subset). `skills` = todas las deseables. `buildMissingSkills` usa solo `required_skills`.
- **GetOnBoard solo para analitica/tecnologia.** La plataforma es de tech; aplicar a otros roles genera ruido.

---

## Estado actual (2026-04-01)

### Completado en esta iteración
- Catálogo expandido de 11 → 24 roles con required_skills calibrados
- Revisión completa de formulario + resultados (21 cambios en total)
- Pregunta condicional de postgrado (aparece al seleccionar "Titulado")
- has_postgrad fusionado: formulario + detección de CV (OR)
- Copy de tarjetas de rol rediseñado: qualitativo, sin listar déficits
- Capitalización de herramientas: displayTool() con tabla de acrónimos
- Filtro de "Otras opciones" por carrera (geociencias/medioambiente excluidos para negocios)
- Etapa académica: tarjetas visuales (grid 3 columnas) en vez de select
- CV drop zone estilizado
- Límite de intereses: 2 → 3
- **Batch estructural (2026-03-31):**
  - CAREER_FAMILIES: psicología → primary ["personas","ciencias-sociales","educacion"]; kinesiología + terapia ocupacional → primary incluye "personas"
  - AREA_LABELS: extendido con tecnologia, comunicacion, derecho, educacion, negocios, ingenieria, ciencias-sociales, diseno, salud
  - Unknown career weight adjustment: carrera -15, intereses +15; sin doble penalización ×0.6
  - STRETCH_THRESHOLD bajado a 25 para permitir carreras de salud y desconocidas
  - getFilteredGeneralInterests: exclusiones por dominio (salud/cs: no fin/anal/tech; tech: no amb/geo/personas; comms: no fin/geo/amb)
  - buildRoleAlignment: frases puente específicas por carrera (_buildBridgeSentence)
- **Batch final pre-deploy (2026-03-31):**
  - Flujo explore: confirmado intacto (4 pasos: tareas → evitar → motivación → confirmación)
  - Badges sin CV: fit-badge y role-description ocultos cuando !currentHasCv (renderRoleCard y renderCompactRoleCard)
  - "Qué se espera de alguien en este rol": oculto cuando !currentHasCv
  - Banner area: `detectedArea.label` se traduce vía INTEREST_REGISTRY antes de renderizar ("clinica-psico" → "Psicología")
  - INTEREST_REGISTRY: añadidas entradas de nivel área para claves raw del backend (clinica-psico, organizacional, desarrollo-sw, litigacion, etc.)
  - Pantalla "¿Todo listo?": fila ciudad+CV rediseñada como tercera fila de pills (summary-tag--meta y summary-tag--cv), consistente con el resto de la tarjeta
  - Cobertura CAREER_FAMILIES: verificada 85/85 carreras del autocomplete — 0 faltantes
- **Batch estudiantes + correcciones (2026-04-01):**
  - Etapa "Estoy estudiando": pregunta condicional "¿Estás en tu último año?" (tarjetas Sí/No)
  - Sí → backend trata `academicStatus` como "egresado" para scoring
  - No → mensaje informativo no bloqueante; copy de resultados cambia a "orientar tu formación"
  - `isLastYear` viaja en formData y sessionStorage; leído en `analyze.js` (lines ~61-65)
  - `next-2` deshabilitado hasta responder la pregunta de último año
  - Pantalla "¿Todo listo?": pills ciudad+CV unificadas visualmente (mismo dark-gray que modalidades); eliminado border-top de summary-meta-row

### Regla 9. isLastYear en analyze.js
**Regla:** Leer `req.body.isLastYear` antes de construir el extractedProfile. Si `academicStatus === "estudiante" && isLastYear === "true"`, sobrescribir `metadata.academicStatus = "egresado"` antes de pasar al matcher.

### Dead data conocido
- `extra_motivation_text` ignorado en scoring.
- `exploreAvoid` solo afecta 4/6 opciones (trabajo-repetitivo e industrias-no-van requieren LLM).

### Prioridades

1. ~~Deploy en Render.com~~ — completado. Env vars: solo `NODE_ENV=production` (PORT lo asigna Render).
2. **Refactorizar public/app.js** — ~2300 líneas, deuda técnica real. Bloqueante para iterar en frontend.
3. ~~Ampliar catálogo~~ — completado (24 roles).

Repo en GitHub (público): https://github.com/juanddpalacios-hash/labora-mvp

---

## Comandos frecuentes

```bash
pm2 restart labora-mvp       # reiniciar servidor tras cambios
pm2 logs labora-mvp          # ver logs en tiempo real
pm2 status                   # estado del proceso

# Test rápido (sin CV, sin caracteres especiales)
curl -s -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","degree":"Ingenieria Comercial","academicStatus":"titulado","city":"Santiago","desiredModality":"[]","areasOfInterest":"[{\"value\":\"finanzas\",\"weight\":3}]"}' \
  | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('roles:', (d.matches?.strong_matches?.length||0)+(d.matches?.stretch_matches?.length||0), '| user_type:', d.matches?.user_type)"
```
