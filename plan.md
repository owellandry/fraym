# ShortsAI - Plan de Mejoras

## Estado: En progreso

---

### 1. [x] Subtitulos animados word-by-word (estilo TikTok) -- COMPLETADO
- [x] Parsear VTT a nivel palabra con timing proporcional
- [x] Generar archivo .ass con highlight por palabra activa (color accent)
- [x] Agrupar en bloques de 4 palabras para vertical video
- [x] Quemar subtitulos con ffmpeg -vf "ass=..." en pipeline
- [x] Integrado en worker.ts: genera .ass por clip antes de cortar

### 2. [x] Face tracking real con YOLO (PRIORIDAD) -- COMPLETADO
- [x] Integrar ONNX Runtime para correr YOLOv8 en Node.js
- [x] Modelo YOLOv8n-face (12MB) + YOLOv8n-person (12MB) descargados
- [x] Detectar caras por frame, fallback a deteccion de personas
- [x] NMS (Non-Maximum Suppression) para eliminar duplicados
- [x] Estrategia por segmento: face/person/center basado en detecciones
- [x] Mediana de posiciones para crop estable (no salta entre frames)
- [x] Reemplazar smartcrop.ts completo con YOLO
- [x] Testeado: detecta caras correctamente, genera filtro ffmpeg OK

### 3. [x] Hook visual en los primeros 2 segundos -- COMPLETADO
- [x] Overlay de texto grande con el titulo del clip (generado por IA)
- [x] Animacion fade-in/fade-out via ASS tags
- [x] Integrado en subtitles.ts: se agrega como primera linea del .ass
- [x] Color accent, centrado arriba, escala 130%

### 4. [ ] Zoom dinamico automatico
- Detectar momentos de enfasis (exclamaciones, cambios de tono en transcript)
- Aplicar zoom sutil 1.0x a 1.1x con ffmpeg zoompan filter
- Cambio visual cada 2-4 segundos

### 5. [x] Deteccion de escenas (cortes naturales) -- COMPLETADO
- [x] Funcion findNearestSceneCut() en video.ts
- [x] Usa ffmpeg scene detection: select='gt(scene,0.25)'
- [x] Busca +/- 2s del punto original para snap al corte mas cercano
- [x] Integrado en worker.ts antes de cortar clips

### 6. [x] Calidad adaptativa del encoding -- COMPLETADO
- [x] Cambiar preset ultrafast a fast
- [x] Cambiar CRF 23 a CRF 20
- [x] Mejor calidad visual sin ser excesivamente lento

### 7. [ ] Sound effects automaticos
- Whoosh en transiciones
- Ding en puntos clave
- Biblioteca de SFX embebida

### 8. [ ] Multiples formatos de salida
- TikTok: max 60s
- YouTube Shorts: max 60s
- Instagram Reels: max 90s
- Metadata optimizada por plataforma
