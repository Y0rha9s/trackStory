# Maple Track

Tracker de EXP/hora para **MapleStory Classic** que corre 100% en el navegador.
Compartes la ventana del juego, cada 10 s se lee el HUD (nivel y EXP) con visión por computador
local y se calculan EXP/hora, EXP ganada y tiempo para subir de nivel. Sin backend, sin cuentas,
sin leer memoria del juego.

Reimplementación propia (React + Vite + Tailwind + TypeScript) inspirada en la funcionalidad de
`dwlim/maple-exp-tracker`. No contiene código de ese repositorio.

## Uso

```bash
npm install
npm run dev        # http://localhost:5173  (diagnóstico: ?debug=1, tarjeta OBS: ?card=1)
npm run build      # dist/ listo para GitHub Pages, Vercel o cualquier hosting estático
npm test
```

Requiere Chrome o Edge de escritorio (API `getDisplayMedia`). Escala de HUD «Ideal» recomendada.

## Cómo funciona

| Etapa | Archivo | Qué hace |
|---|---|---|
| Captura | `src/tracker/tracker.ts` | `getDisplayMedia` → `<video>` → canvas cada 10 s; un único reintento a los 250 ms si la lectura fue ambigua y el video avanzó |
| Detección del HUD | `src/ocr/hud.ts` | Busca en el 35% inferior los tiles naranjos del nivel (con label «LV.» a la izquierda) y pares de corchetes verdes; HP/MP usan el mismo verde, así que se prueban candidatos y gana el que contiene un porcentaje válido |
| Matcher de glifos | `src/ocr/glyphs.ts` | Segmenta por columnas, normaliza cada glifo a una grilla 5×7 con cobertura suave y contraste normalizado, compara contra prototipos. Rechaza si el mejor puntaje o el margen sobre el segundo no alcanzan |
| Plantillas | `src/ocr/train.ts`, `src/ocr/templates.json` | Prototipos agrupados por similitud (no promedios borrosos). El usuario puede enseñar su propio HUD desde el panel de diagnóstico |
| Fallback neuronal | `src/ocr/neural.ts`, `src/tracker/neuralWorker.ts` | Tesseract LSTM en Web Worker, autoalojado en `public/ocr` (~15 MB, se carga solo si hace falta). Lee cantidad y % por separado con dos preprocesados que deben coincidir entre sí **y** con cada glifo que el matcher sí leyó |
| Validación | `src/core/validator.ts` | Cantidad y % deben cuadrar con la curva de EXP (±0,03 pp); subir de nivel exige confirmar en otro frame; saltos se rechazan; nivel ilegible se deduce de la EXP solo si un único nivel calza y se confirma en 2 frames en 25 s; modo solo-% estima la EXP (marcada con ~) |
| Métricas | `src/core/metrics.ts` | EXP total acumulada (cruza subidas de nivel), tasa en ventana de 5 min, tramos cortados por pausas o huecos > 90 s |
| UI | `src/App.tsx`, `src/components/*` | Dashboard, gráfico, registro de lecturas, entrada manual, tarjeta para OBS (BroadcastChannel) |

## Entrenar y evaluar con tus capturas

Guarda PNGs completos del juego en una carpeta con un `labels.json`:

```json
[{ "file": "captura1.png", "level": "40", "exp": "221.609[75.32%]" },
 { "file": "captura2.png", "level": "60", "exp": "[92.09%]" }]
```

```bash
npm run train -- ./mis-capturas            # entrena con 1/3 y evalúa con el resto
npm run train -- ./mis-capturas --write    # regenera src/ocr/templates.json con todo
npm run eval  -- ./mis-capturas            # pipeline completo con Tesseract
```

Resultado actual en 75 capturas (incluye ventanas, escalas y HUD tapado): 58 por glifos + 5 por
Tesseract, 7 rechazadas, **0 incorrectas**. Las capturas de streams de Twitch muy comprimidas aún se
rechazan.

## Pendiente (fase 2)

- Mesos por hora (lectura del inventario)
- Conteo de pociones en quickslots y costo por hora
- Nombre del mapa

## Licencias

Tesseract.js y tesseract.js-core: Apache-2.0 (ver `public/ocr/LICENSE-*`). Proyecto comunitario sin
relación con Nexon.
