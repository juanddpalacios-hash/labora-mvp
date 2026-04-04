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
- `data/junior_roles.json` — catálogo de 24 roles junior con required_skills, families, etc.
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

## Estado actual (2026-04-04)

### Completado en iteraciones anteriores (hasta 2026-04-01)
- Catálogo expandido de 11 → 24 roles con required_skills calibrados
- Motor de scoring 6 dimensiones, umbrales Strong ≥65 / Stretch 25-64
- Pregunta condicional postgrado + isLastYear
- has_postgrad fusionado (formulario + CV)
- Etapa académica: tarjetas visuales
- Deploy en Render.com completado

### Completado en esta iteración (2026-04-04)

**Simplificación a Ingeniería Comercial:**
- CAREER_FAMILIES: 85 carreras → solo "ingenieria comercial"
- CAREER_CATEGORIES y CAREER_ALIASES: eliminadas todas las demás carreras
- junior_roles.json: related_degrees → ["Ingeniería Comercial"] en los 24 roles
- upload.html step-1: campo estático (no autocomplete), hidden input

**Sprint UX — humanización de copy y tono:**
- Pantalla inicial: título, subtítulo, cards y CTA reescritos
- Flujo guided: subtítulos más humanos en todos los pasos
- Flujo explore: copy nuevo en tareas, evitar, motivación y confirmación
- Resumen: "Antes de ver tus opciones" + CTA "Ver mis opciones →"
- Resultados: perfil → "Lo que se alcanza a ver...", área → lenguaje humano
- Cards de rol: secciones renombradas, fitLevel más humano
- buildNextStep: próximos pasos accionables y específicos por área (finanzas, analítica, comercial, operaciones, personas, marketing)
- buildProfileHook: frases conectadas al área que eligió el usuario
- buildRoleAlignment: interés principal con framing más directo
- Jerarquía: rol principal con contexto + "También aparecen caminos cercanos"
- ROLE_AREA_EXPECTATIONS: reescritas en lenguaje concreto y específico

**Sprint UX — pantalla explore-confirm:**
- Título: "Esto es lo que más hace sentido con lo que nos contaste"
- buildConfirmExplanation: clasificación por perfil (analitico / relacional / operativo / estrategico / mixto)
- Texto interpretativo: lenguaje natural, sin enumerar inputs
- Contraste "más que…" opcional — solo cuando hay señal de avoid relevante
- Header "Tienes más afinidad hoy con:" antes de las cards
- Instrucción "Elige 1 o 2 caminos que sientas más cercanos a ti ahora."
- CTA: "Quiero ver cómo seguir desde aquí →"
- AREA_DESCRIPTIONS: en lenguaje claro y cotidiano

### Reglas de copy (no violar)
- No usar: "como elegiste", "según tus respuestas", enumeraciones de inputs
- No usar: expresiones forzadas que no dirías en conversación real
- Sí usar: "parece que te acomoda", "se ve que te motiva", "probablemente te sientas"
- Contraste "más que..." solo cuando hay avoid claro (clientes, terreno, repetición, competencia)
- Cada rol debe sonar distinto — no variaciones del mismo template

### Regla 9. isLastYear en analyze.js
**Regla:** Leer `req.body.isLastYear` antes de construir el extractedProfile. Si `academicStatus === "estudiante" && isLastYear === "true"`, sobrescribir `metadata.academicStatus = "egresado"` antes de pasar al matcher.

### Dead data conocido
- `extra_motivation_text` ignorado en scoring.
- `exploreAvoid` solo afecta 4/6 opciones (trabajo-repetitivo e industrias-no-van requieren LLM).

### Prioridades

1. ~~Deploy en Render.com~~ — completado.
2. ~~Ampliar catálogo~~ — completado (24 roles).
3. ~~Simplificar a Ingeniería Comercial~~ — completado.
4. ~~Sprint UX humanización~~ — completado.
5. **Refactorizar public/app.js** — ~2300 líneas, deuda técnica real. Bloqueante para iterar en frontend.

Repo en GitHub (público): https://github.com/juanddpalacios-hash/labora-mvp

---

## Comandos frecuentes

```bash
pm2 restart labora-mvp       # reiniciar servidor tras cambios
pm2 logs labora-mvp          # ver logs en tiempo real
pm2 status                   # estado del proceso

# Test rápido (sin CV) — Windows-compatible (sin /dev/stdin)
curl -s -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d "{\"degree\":\"Ingenieria Comercial\",\"academicStatus\":\"titulado\",\"city\":\"Santiago\",\"desiredModality\":\"[]\",\"areasOfInterest\":\"[{\\\"value\\\":\\\"finanzas\\\",\\\"weight\\\":3}]\"}" \
  > C:/Temp/result.json && node -e "const d=JSON.parse(require('fs').readFileSync('C:/Temp/result.json','utf8')); console.log('roles:', (d.matches?.strong_matches?.length||0)+(d.matches?.stretch_matches?.length||0), '| user_type:', d.matches?.user_type)"
```
