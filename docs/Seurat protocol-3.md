# Seurat/1 — Protocolo de Entrega Puntillista con Densidad Controlada

Especificación v1.0 · 2026-09-22 · WebTransport sobre HTTP/3 (respaldo WebSocket `seurat.1`) · Servidor Java 21+

> Seurat no pintaba copias de una escena a distintos tamaños: pintaba **puntos**, y el ojo hacía el resto. Seurat/1 entrega imágenes de más de 50 GB igual. La resolución de un cliente no es "qué copia tiene", sino **cuántos puntos tiene de cada región**. Acercar añade solo los puntos que faltan: de cada 4 puntos nuevos viajan 3. Alejar no transfiere nada. Los puntos se **prestan** con caducidad en vez de regalarse, y la contabilidad de lo prestado es exacta, por rangos, como un SACK.

---

## 1. Visión de la arquitectura

### 1.1 Componentes del servidor

```
                  HTTPS/TCP: visor estático · POST /sesion · PUT|DELETE obras · respaldo WebSocket seurat.1
 Navegador ────────────────────────────────────────────────────►┌──────────────────────────────────────────────────────────┐
 (visor +   ◄═══ Seurat/1 · WebTransport (HTTP/3 · QUIC) ══════►│ MapeoWT · MapeoWS ──► Caballete (1 por sesión)           │
  Worker de   caballete bidi · MIRADA en datagramas ·           │     MIRADA │               ▲ RECIBO · SOLTAR · RASPADO   │
  síntesis)   1 flujo unidireccional por pincelada              │            ▼               │                             │
                                                                │ ControladorDeConcesión ──► LibroDePréstamos              │
                                                                │   │  CONCESION · RASPAR ·      (1 por lienzo)            │
                                                                │   │  RENOVAR · AUDITAR ──► Caballete                     │
                                                                │   ▼                                                      │
                                                                │ PlanificadorDeCono ──plan──► Pintor (global)             │
                                                                │                              max-min · CoDel/DCTCP       │
                                                                │                              PresupuestoDePincel         │
                                                                │                                 │ lecturas posicionales  │
                                                                │                                 ▼                        │
                                                                │ Catálogo ◄── Ingestor ──► AlmacénDePinceladas            │
                                                                └──────────────────────────────────────────────────────────┘
                                                                 disco: obras/<id>/{meta.json, semilla.bin, E*.pinc, E*.idx, master/}
```

| Componente | Responsabilidad | Estado que posee |
|---|---|---|
| **Ingestor** | Detecta másteres nuevos (`inbox/` con `WatchService`, o `PUT /seurat/v1/obras/{id}`) y lanza un `IngestJob` por archivo. Una ingesta activa a la vez. | Cola de trabajos. |
| **IngestJob** | Una sola pasada secuencial por bandas de 256 filas: YCoCg-R → transformada S por estratos → pinceladas cuantizadas, ordenadas por significancia, comprimidas y escritas en el `AlmacénDePinceladas`. Si el máster trae visión general (*overview*), publica antes un boceto provisional (edición 1). | Acumuladores de banda por estrato (≈ 600 MB para la imagen de ejemplo). |
| **Catálogo** | Registro `id → FichaObra` persistido en `obras/<id>/meta.json`; empuja `OBRA` a todas las sesiones. | Mapa concurrente en memoria. |
| **AlmacénDePinceladas** (uno por obra) | `E{s}.pinc` (solo anexar) + `E{s}.idx` (40 B por pincelada, mapeado en memoria). Servir *b* bandas de una pincelada es leer un **prefijo** de sus bytes. Inmutable por edición. | Ficheros + índices mmap. |
| **Caballete** (uno por sesión) | Lee y valida el flujo de control; despacha por tipo; posee los lienzos abiertos (*handles*). Es el único escritor del estado de su sesión. | En memoria; muere con la conexión. |
| **LibroDePréstamos** (uno por lienzo) | Modelo autoritativo de lo prestado: `entrega → (pincelada, bandas, bytes, estado, vencimiento)`. Opera con conjuntos de entregas codificados como rangos. | Mapa ordenado + vencimientos. **Sobrevive L + δ a la desconexión** (reanudación, §8). |
| **ControladorDeConcesión** | Calcula el derecho de posesión por (sesión, lienzo). Emite `CONCESION`, `RASPAR`, `RENOVAR` y `AUDITAR`. Confirma `RASPADO` e `INVENTARIO` por igualdad exacta de conjuntos. | Política por obra y rol; temporizadores. |
| **PlanificadorDeCono** | `MIRADA + concesión + libro →` plan de entregas en tres pasadas: esbozo, densidad y periferia (§2.3, §4.1). | Sin estado. |
| **Pintor** (global) | **Único punto por el que salen puntos del servidor.** Elige globalmente la siguiente entrega (max-min por nitidez, §6.2). Antes de cada entrega comprueba concesión, libro, presupuesto y ventanas. Después la numera, abre su flujo y copia las bandas del disco. Mide la espera en su cola (CoDel) y regula cada sesión (DCTCP, §6.3). | Colas por sesión (ids, no bytes), ranuras, `α_i`, `e_i`. |
| **PresupuestoDePincel** | Cubeta de fichas por (principal, obra) para los estratos finos + mapa de cobertura persistente de lo entregado alguna vez (§9). | `cobertura/<principal>/<obra>.bits` (mmap). |

Tres caminos disjuntos:

- **Camino de puntos**: `MIRADA → PlanificadorDeCono → Pintor → AlmacénDePinceladas → flujo PINCELADA`.
- **Camino de derechos**: `ControladorDeConcesión → CONCESION / RASPAR / RENOVAR / AUDITAR ⇄ RASPADO / INVENTARIO`.
- **Camino de préstamos**: `PINCELADA → RECIBO → LibroDePréstamos (vencimientos) ← SOLTAR`.

### 1.2 Dónde vive el máster y en qué forma derivada se conserva

- **Máster**: `obras/<id>/master/<original>` (o una ruta de archivo frío). Solo lo abre `IngestJob`; el camino de entrega no tiene ninguna referencia a él. Con `keepMaster=false` se borra al terminar la ingesta.
- **Forma derivada — estratos de puntos, no copias**:
  - La imagen se transforma a YCoCg-R y se descompone con una Haar entera (transformada S) en estratos.
  - Cada estrato solo guarda lo que le falta al anterior, así que el almacén es **no redundante en coeficientes**: N coeficientes para N píxeles, frente a los 4N/3 de una pirámide de copias. En bytes no lo es (§2.4).
  - Los detalles se cuantizan y se agrupan en **pinceladas** de 256 × 256 puntos, con sus bandas ordenadas por significancia.
  - El estrato 0 del almacén es **con pérdida**: luminancia con paso 6 y croma sin refinar, equivalente a 4:2:0. Los bytes del máster nunca están en el almacén ni salen del servidor.
- **Qué se materializa y cuándo**: todo, en la única pasada de ingesta. No hay derivación perezosa ni hilos de derivación en el servidor:
  - en el modelo aditivo cada estrato es dato primario (sus detalles solo se pueden calcular con los valores exactos, que solo existen durante la ingesta);
  - la "derivación" a un zoom arbitrario ocurre en el cliente (§2.2).
- **Boceto** (conjunto base): la semilla (estrato 10, sin pérdida) más las 43 pinceladas de los estratos 7–9, completas.
  - Se entrega al abrir la obra y nunca se raspa salvo con `RASPAR TODO`.
  - Garantiza que el visor siempre tiene algo que pintar.

Imagen de ejemplo usada en todo el documento: `slide-0421`, 196 608 × 163 840 px RGB, 96,6 GB en crudo. Los bytes son una estimación de **peor caso** con la tasa medida en §2.4: textura de tejido denso en toda la superficie. El fondo de vidrio cuesta casi cero porque los padres de energía nula se omiten.

| Estrato | Puntos | Pinceladas | Bytes en almacén (peor caso) | Papel |
|---|---|---|---|---|
| 0 | 196608 × 163840 | 768 × 640 = 491 520 | ≈ 8,23 GB | fino · con pérdida (qY 6, croma sin refinar) |
| 1 | 98304 × 81920 | 384 × 320 = 122 880 | ≈ 4,35 GB | fino · qY 4, qC 6 |
| 2 | 49152 × 40960 | 192 × 160 = 30 720 | ≈ 2,07 GB | intermedio · qY 2, qC 3 |
| 3 | 24576 × 20480 | 96 × 80 = 7 680 | ≈ 494 MB | casi sin pérdida · qY 1, qC 2 |
| 4 | 12288 × 10240 | 48 × 40 = 1 920 | ≈ 112 MB | casi sin pérdida |
| 5 | 6144 × 5120 | 24 × 20 = 480 | ≈ 28 MB | casi sin pérdida |
| 6 | 3072 × 2560 | 12 × 10 = 120 | ≈ 7,0 MB | casi sin pérdida |
| 7 | 1536 × 1280 | 6 × 5 = 30 | ≈ 1,75 MB | boceto |
| 8 | 768 × 640 | 3 × 3 = 9 | ≈ 0,44 MB | boceto |
| 9 | 384 × 320 | 2 × 2 = 4 | ≈ 0,11 MB | boceto |
| 10 (semilla) | 192 × 160 | 1 | ≈ 16 KB (medido en la muestra) | boceto · sin pérdida |

Total: 655 363 pinceladas + semilla ≈ **15,3 GB** para todos los estratos. Boceto ≈ **2,3 MB** en el peor caso.

---

## 2. Modelo de resolución: densidad de puntos

### 2.1 Representación: estratos, pinceladas y puntos

**Color.** YCoCg-R, entero y exactamente reversible. Se verificó sobre los 2²⁴ colores RGB8: Y ∈ [0, 255], Co y Cg ∈ [−255, 255].

```
directa:  Co = R − B;   t = B + (Co >> 1);   Cg = G − t;   Y = t + (Cg >> 1)
inversa:  t = Y − (Cg >> 1);   G = Cg + t;   B = t − (Co >> 1);   R = B + Co
```

**Transformada S** (Haar entera por *lifting*) sobre cada bloque 2 × 2 `[a b; c d]` de cada canal:

```
directa:  l1 = (a + b) >> 1   h1 = a − b      l2 = (c + d) >> 1   h2 = c − d
          S  = (l1 + l2) >> 1 V  = l1 − l2    H  = (h1 + h2) >> 1 D  = h1 − h2
inversa:  l1 = S + ((V + 1) >> 1);  l2 = l1 − V;  h1 = H + ((D + 1) >> 1);  h2 = h1 − D
          a = l1 + ((h1 + 1) >> 1);  b = a − h1;  c = l2 + ((h2 + 1) >> 1);  d = c − h2
```

- Exacta: se verificó con bloques aleatorios con signo y con los patrones extremos.
- Con entrada de 8 bits, H y V caben en ±255 (±510 en croma) y D en ±510 (±1020 en croma): `int16` basta en todo el camino.

**Estratos.**

- `E0` es la imagen en YCoCg-R; `E(s+1)` son los `S` de `E(s)`.
- `top = ⌈log2(max(W, H) / 256)⌉`: 10 en el ejemplo, cuya semilla es `E10` = 192 × 160.
- Las dimensiones se completan replicando el borde hasta múltiplos de `2^top`. En el ejemplo ya lo son: 196 608 = 3·2¹⁶ y 163 840 = 5·2¹⁵.

**Pincelada `P(s, bx, by)`.**

- Es el bloque 256 × 256 `(bx, by)` del estrato `s`, descrito como sus 128 × 128 **padres** en `E(s+1)` más 3 detalles (H, V, D) por padre y canal.
- Los padres ya están en el cliente, porque son puntos de la pincelada padre. Por eso **de cada 4 puntos nuevos solo viajan 3**.
- Huella en píxeles nativos: `[bx·256·2^s, (bx+1)·256·2^s) × [by·256·2^s, (by+1)·256·2^s)`.
- Pinceladas de borde incompletas (p. ej. la última fila del estrato 8): mismo formato, con menos padres.

```
pincelada_id (u64) = s << 56 | morton(bx, by)       // 8 bits de estrato · 56 bits Morton (x en bits pares, y en impares)
padre(id)          = (s + 1) << 56 | morton >> 2
hijos(id)          = (s − 1) << 56 | (morton << 2 | k),   k ∈ {0, 1, 2, 3}
```

Con Morton, cualquier región del *quadtree* es un rango contiguo de ids, y subir al padre es un desplazamiento. Ejemplo: `P(1, 131, 98)` → `morton = 0x680D` → id `0x010000000000680D`; su padre es `P(2, 65, 49)`.

**Predicción S+P.** Antes de cuantizar, H y V se predicen a partir de los padres vecinos; D no se predice:

```
Ĥ = (S[i][j−1] − S[i][j+1] + 2) >> 2          V̂ = (S[i−1][j] − S[i+1][j] + 2) >> 2
```

- Los vecinos se leen solo dentro del cuadrante de padres de la propia pincelada, replicando el borde. Así cada pincelada se decodifica sin leer ninguna otra, dados sus padres.
- El codificador predice con los padres **verdaderos** (lazo abierto) y el decodificador con los reconstruidos. Así la ingesta es una sola pasada sin decodificar.
- Coste medido del lazo abierto frente al lazo cerrado: 0,07–0,16 dB.
- Frente a Haar pura, la predicción reduce los bytes un 20 % en el estrato 0 y un 17 % en total (muestra IHC).

**Cuantización** de zona muerta sobre los residuos `H − Ĥ`, `V − V̂` y `D`:

```
i = sign(x) · ⌊|x| / q⌋            x̂ = 0 si i = 0;  si no, sign(i) · (|i|·q + ⌊q/2⌋)            q = 1 ⇒ sin pérdida
```

| Estrato | qY | qC (Co, Cg) | Motivo |
|---|---|---|---|
| 0 | 6 | ∞ (croma no se refina) | Es el estrato más caro. El ojo tolera croma a mitad de resolución (≈ 4:2:0). |
| 1 | 4 | 6 | Se muestra y además es padre del estrato 0. |
| 2 | 2 | 3 | Padre de padres. |
| ≥ 3 | 1 | 2 | Casi sin pérdida: su error se hereda en todos sus descendientes. |
| semilla | 1 | 1 | Sin pérdida. |

Por qué los estratos gruesos van casi sin pérdida:

- La transformada S es una pirámide de **medias**, y el detalle de un hijo describe diferencias dentro del bloque 2 × 2, no su media.
- Por tanto un error en un padre llega intacto a todos sus descendientes: los detalles finos no pueden corregirlo, ni en lazo cerrado.
- Medido en el mosaico de §2.4, cuantizar más grueso desde el estrato 2 ahorra solo el **2,5 %** de los bytes totales y cuesta **2 dB** en el estrato 0 (38,26 → 36,27 dB).

**Bandas de significancia.** Dentro de cada pincelada se ordenan los padres por la energía de sus residuos cuantizados y se reparten en 4 bandas:

```
E(p) = Σ_{d ∈ {H,V,D}} ( 2·|qY_d| + |qCo_d| + |qCg_d| )      orden: E descendente, Morton ascendente (determinista)
banda 0 = rangos [0, 2048) · banda 1 = [2048, 4096) · banda 2 = [4096, 8192) · banda 3 = [8192, 16384)
         (12,5 % · 12,5 % · 25 % · 50 % de los padres; los padres con E = 0 se omiten: no cuestan nada)
```

Formato de una banda en disco:

- Mapa de pertenencia: 1 bit por padre en orden de barrido.
- Valores **planares**: por canal refinado (Y, Co, Cg) y por detalle (H, V, D), los residuos de los miembros en orden de barrido, en *zigzag* + LEB128.
- Todo comprimido con *deflate* crudo (RFC 1951), independiente por banda.

Propiedades:

- Las bandas se guardan contiguas, así que servir `b` bandas es servir un **prefijo** de bytes.
- Una banda ausente equivale a residuos nulos: sus padres se refinan solo con la predicción (Ĥ, V̂, D = 0), lo que da una interpolación suave, no bloques.
- Se usa LEB128 y no las varints de QUIC porque aquí hay millones de valores pequeños. LEB128 mete 7 bits por byte, y la mayoría de residuos cabe en 1 byte. Las varints de QUIC (§3.2) se reservan para cabeceras, donde conocer la longitud por el primer byte vale más que 1 bit.

Tres usos de las bandas:

- **Techos por rol**: son máscaras anidadas, porque el orden de los padres es el mismo para todos los clientes.
- **Densidad fraccional** a zoom intermedio (§2.2).
- **Degradación bajo carga** (§6.3): se quitan bandas, no pinceladas.

### 2.2 Densidad fraccional y derivación (vista a zoom arbitrario)

Para un viewport de `vw × vh` píxeles de dispositivo que muestra `[x0, x1) × [y0, y1)` en coordenadas nativas:

```
ideal   = log2( max((x1 − x0) / vw, (y1 − y0) / vh) )       // píxeles de imagen por píxel de pantalla
s_i     = clamp(⌊ideal⌋, 0, 10);   φ = ideal − s_i          (φ = 0 si ideal ≤ 0 o s_i = 10)
bandas  = 4 − ⌊4φ⌋                   // φ ∈ [0, ¼) → 4 · [¼, ½) → 3 · [½, ¾) → 2 · [¾, 1) → 1
```

- Con φ = 0, el estrato `s_i` se ve a 1:1 y todos sus puntos son visibles.
- Al crecer φ, la GPU reduce `s_i` por un factor `2^φ`, se distinguen menos puntos, y se envían menos: los de mayor energía.
- El estrato `s_i + 1` siempre está completo.

El zoom continuo se convierte así en un número entero de bandas, sin que el servidor remuestree nada.

**Derivación.**

- El servidor no deriva: no hay niveles perezosos, ni caché de derivaciones, ni trabajo de CPU por cliente.
- El cliente sintetiza cada estrato con la transformada S inversa entera en un Web Worker. Cada pincelada que posee es una capa de textura sobre su huella, pintadas de gruesa a fina (algoritmo del pintor).
- El zoom no diádico lo resuelve la GPU con un factor entre 1× y 2×.

Trade-off: la síntesis ocurre en cada cliente. A cambio, las pinceladas son inmutables y compartidas, y el servidor solo copia bytes.

### 2.3 Quién decide la densidad máxima y qué la cambia

Seurat separa dos cosas que suelen ir juntas:

| | **Concesión** | **Cono de entrega** |
|---|---|---|
| Qué es | Derecho de **posesión**: qué puede tener el cliente. | **Plan**: qué se le pinta ahora. |
| Quién la cambia | Política por obra y rol; `OCULTA` / inactividad. | `MIRADA`; carga del servidor; presupuesto de pincel; cola de síntesis del cliente. |
| Si se reduce | `RASPAR` + confirmación exacta (§4.2). | Nada: lo entregado se queda (con su arriendo). |
| Mensaje | `CONCESION` (con `época`). | `PLAN`. |

**Concesión** por (sesión, lienzo):

```
estrato_min    = max( techo[obra][rol].estrato,                 // anónimo 1 · autenticado 0 · privilegiado 0
                      piso_inactividad(sesión) )                // 7 (solo boceto) si OCULTA, sin MIRADA aún, o sin MIRADA en 60 s
bandas_max     = (estrato_min == techo.estrato) ? techo.bandas : 4      // anónimo 2 · autenticado 2 · privilegiado 4
max_pinceladas = min(mem_mib × 3, sesión_max_pinceladas, política)      // 256 MiB → 768
max_kib        = max_pinceladas × 48                                     // bytes comprimidos retenidos
arriendo       = 120 s
```

Reglas de cambio:

- Ampliar la concesión exige demanda (una `MIRADA`); reducirla es inmediato.
- Todo cambio produce `CONCESION` con `época + 1`.
- Si la concesión se reduce, le sigue un `RASPAR` (§4.2).
- La **carga y el presupuesto no tocan la concesión**: solo recortan el cono. Revocar por carga obligaría a reenviar exactamente los mismos bytes cuando la carga baje, y la carga es transitoria.

**Cono de entrega** para una `MIRADA` (foveación: denso en el centro, disperso en la periferia):

```
s_f  = max(s_i, estrato_min)
b_f  = (s_f == s_i) ? 4 − ⌊4φ⌋ : 4;       si s_f == estrato_min:  b_f = min(b_f, bandas_max)
F_0  = ROI;   F_j = F_0 escalado ×2^j alrededor de su centro

quiero(P) = b_f      P del estrato s_f que interseca F_0                 (foco)
          = 4        P ancestro de una pincelada del foco, s < 7         (esqueleto)
          = 3 − j    P del estrato s_f + j que interseca F_j, j ∈ {1, 2}  (periferia: 2 y 1 bandas)
cierre:   quiero(padre(P)) ≥ quiero(P)       // regla monótona: un hijo nunca es más denso que su padre
entregar: bandas [tiene(P), quiero(P)) para toda P con quiero(P) > tiene(P)     (retoques incluidos)
```

- **El cono es cerrado por ancestros.** Escalar un rectángulo ×2 alrededor de su centro da un superconjunto, luego `F_j ⊆ F_{j+1}`. La huella del padre contiene la del hijo. Por tanto, si un hijo del estrato `s_f + j` interseca `F_j`, su padre interseca `F_{j+1}`. Más allá del segundo anillo lo añade el paso de cierre, y los estratos ≥ 7 siempre están (boceto).
- **Tamaño acotado.**
  - En el estrato `s_f + j`, `F_j` mide `2^j` veces la ROI y cada pincelada mide `256·2^(s_f+j)`. El cociente no depende de `j`: cada anillo tiene ≈ `(w/(256·2^s_f) + 1)(h/(256·2^s_f) + 1)` pinceladas.
  - La posesión es proporcional al foco, no a la imagen; solo la cadena de ancestros crece con `log(imagen)`.
  - El anillo 1 hace de *prefetch*: un desplazamiento de hasta media pantalla ya tiene puntos debajo.

Ejemplo (vista de §3.4.2). ROI `[65536, 69376) × [49152, 51312)` (3840 × 2160 px) en 1920 × 1080 da `ideal = 1`, `φ = 0`. Con concesión `estrato_min = 0, bandas_max = 2`: `s_f = 1`, `b_f = 4`.

| Estrato | Pinceladas | Composición | Bytes (peor caso) |
|---|---|---|---|
| 6 | 4 | 1 esqueleto (4 bandas) + 3 cierre (2) | 0,12 MB |
| 5 | 6 | 1 esqueleto + 3 cierre (2) + 2 cierre (1) | 0,14 MB |
| 4 | 15 | 1 esqueleto + 5 cierre (2) + 9 cierre (1) | 0,25 MB |
| 3 | 40 | 4 esqueleto + 8 anillo 2 cerrado (2) + 28 anillo 2 (1) | 0,74 MB |
| 2 | 48 | 12 esqueleto + 36 anillo 1 (2) | 1,58 MB |
| 1 | 40 | foco: x ∈ [128, 135], y ∈ [96, 100], 4 bandas | 1,42 MB |
| **Total** | **153** | 212 entregas en 3 pasadas (§4.1) | **4,25 MB** |

### 2.4 Coste medido del códec (y dónde pierde)

Todas las cifras salen de una implementación de referencia (Python/NumPy, `deflate` de zlib nivel 9):

- **Mosaico**: 4096 × 4096 píxeles formado por 64 copias rotadas y volteadas de la muestra de inmunohistoquímica de `scikit-image` (512 × 512), es decir, textura de tejido en toda la superficie.
- **Comparación**: WebP de libwebp (método 6) en teselas 256 × 256 sobre la misma muestra.

| Estrato | Bytes por pincelada completa, bandas 0 · 1 · 2 · 3 | Total | bits/punto | PSNR del estrato con 0 · 1 · 2 · 3 · 4 bandas |
|---|---|---|---|---|
| 0 | 4 171 · 3 728 · 5 531 · 3 310 | 16,7 kB | 2,04 | 32,90 · 34,78 · 35,94 · 37,49 · **38,26 dB** |
| 1 | 6 452 · 5 872 · 10 128 · 12 962 | 35,4 kB | 4,32 | 29,10 · 31,38 · 33,17 · 36,51 · **40,78 dB** |
| 2 | 10 972 · 10 446 · 18 475 · 27 391 | 67,3 kB | 8,21 | — |
| 3 | 11 082 · 10 883 · 17 340 · 25 058 | 64,4 kB | 7,86 | — |
| ≥ 4 | 10 289 · 10 202 · 16 436 · 21 318 | 58,2 kB | 7,11 | — |

La PSNR es la del estrato reconstruido frente al estrato exacto del máster, con todo el error acumulado de los estratos superiores. En el estrato 0 es la PSNR frente al máster.

Tablas de cuantización alternativas, medidas sobre el mismo mosaico:

| Tabla | s0 · s1 · s2 · s≥3 | PSNR s0 | Bytes totales |
|---|---|---|---|
| **A (elegida)** | (6,∞) · (4,6) · (2,3) · (1,2) | **38,26 dB** | 7 777 KiB |
| A2 | (6,∞) · (4,6) · (3,4) · (1,2) | 38,01 dB | −15 % en s2 |
| B | (6,∞) · (4,6) · (3,4) · (2,3) | 36,27 dB | 7 586 KiB (−2,5 %) |
| C | (6,∞) · (4,6) · (3,5) · (3,5) | 35,10 dB | 7 465 KiB (−4,0 %) |

**Dónde gana**:

- **Acercar ×2 con el padre ya en el cliente** (45 pinceladas del estrato 0, vista de §3.4.3): 355 kB con 2 bandas o 753 kB con 4. Una pirámide WebP de teselas autónomas pide 45 teselas nuevas: 659 kB en q85 o 864 kB en q90.
- **Incremento de detalle frente a WebP a calidad comparable** (±0,7 dB): el incremento del estrato 0 cuesta 0,77–0,88× los bytes de WebP q90 (astronauta: 38,6 kB, 38,20 dB frente a 50,1 kB, 37,55 dB; IHC: 67,3 kB frente a 76,8 kB).
- **Alejar** no transfiere nada.
- **Techos de calidad por rol**: salen gratis, porque son prefijos de bytes y no recodificaciones.

**Dónde pierde, y no se oculta**:

- **La primera vista es cara en el peor caso.** El foco necesita su esqueleto de ancestros completos, y los estratos gruesos cuestan 7–8 bits/punto (van casi sin pérdida, por lo dicho en §2.1).

  | Vista de §3.4.2 (peor caso) | Seurat | Pirámide WebP q85 (21,1 kB/tesela medido) |
  |---|---|---|
  | Foco visible en esbozo (pasada 1) | 0,90 MB | — |
  | Foco completo (pasadas 1–2) | 2,66 MB | 40 teselas = 0,84 MB |
  | Con periferia (pasada 3) | 4,25 MB | 70 teselas con anillo = 1,48 MB |
  | Boceto | 2,3 MB | ≈ 0,93 MB (estimado: 44 × 21,1 kB) |

  El esbozo del foco cuesta lo mismo que las teselas de la referencia, con menos calidad. La calidad completa cuesta ≈ 3×.
- **El almacén no es más pequeño en bytes.** Es no redundante en coeficientes, pero la fidelidad que exigen los estratos gruesos cuesta más que la redundancia que se ahorra. En el peor caso: 15,3 GB frente a ≈ 10,6 GB estimados para una pirámide WebP q85 completa sobre la misma textura.
- **El códec de entropía es deliberadamente simple.** *Deflate* sobre LEB128 se decodifica con `DecompressionStream('deflate-raw')`, nativo del navegador. Un codificador aritmético adaptativo reduciría bytes a cambio de decodificar en JS/WASM (no medido).

**Parentesco**: las capas de calidad y el modelo de caché del servidor recuerdan a JPIP (JPEG 2000, ISO/IEC 15444-9). Seurat se diferencia en:

- una Haar entera con S+P decodificable en un Worker sin WASM;
- el préstamo con caducidad y la contabilidad exacta por rangos;
- la revocación sin barrera;
- un flujo QUIC por pincelada.

---

## 3. Especificación del protocolo

### 3.1 Transporte

**Decisión: WebTransport sobre HTTP/3 como mapeo principal y WebSocket como mapeo de respaldo obligatorio.** La semántica de Seurat/1 es una sola y los mapeos son dos, igual que HTTP tiene una semántica (RFC 9110) y varios mapeos (RFC 9112/9113/9114).

Por qué WebTransport:

- **Un flujo QUIC por pincelada.**
  - Un paquete perdido solo retrasa su pincelada: no hay bloqueo de cabeza de línea entre pinceladas.
  - Una pincelada revocada en vuelo se corta con `RESET_STREAM`, así que una revocación cuesta lo que ya está en el cable, no el resto de la pincelada.
  - El FIN delimita la pincelada: el entramado sale gratis.
- **Datagramas para la mirada.** `MIRADA` es estado, no un evento: retransmitir una mirada vieja es peor que perderla. Gana la de mayor `seq`.
- **Control separado de los datos.** Las órdenes (`CONCESION`, `RASPAR`) viajan por un flujo bidireccional propio, ordenado y fiable, y nunca esperan detrás de 60 kB de pincelada.
- **Control de flujo QUIC** por flujo y por conexión, y TLS 1.3 obligatorio.
- **El handshake es HTTP** (CONNECT extendido) y todo lo demás es Seurat/1: cumple "HTTP para el handshake, protocolo propio para los datos".
- **Soporte en navegadores.** WebTransport es *Baseline* desde marzo de 2026 (Safari 26.4) y está disponible en Web Workers, así que el Worker de síntesis puede ser dueño de la sesión.

Límites asumidos:

- **Redes que bloquean UDP.** El visor intenta WebTransport con un plazo de 3 s y cae al mapeo WebSocket.
- **Borradores distintos.** Los navegadores y las bibliotecas Java implementan borradores distintos de WebTransport/HTTP3. La interoperabilidad es el primer hito del proyecto (Anexo B).
- **Sin 0-RTT.** `SALUDO` lleva un token de un solo uso (no idempotente), y los datos 0-RTT se pueden reinyectar.
- **Sin migración de conexión.** El servidor QUIC elegido no la soporta: la continuidad se resuelve en la aplicación (`REANUDAR`, §8).

Descartados:

- **Solo WebSocket**: un único flujo ordenado (bloqueo de cabeza de línea) y sin forma de abortar un mensaje ya empezado. Queda como respaldo, con la misma semántica.
- **Un `fetch` por pincelada sobre HTTP/3**: técnicamente parecido (un flujo por petición), pero convierte las pinceladas en URLs direccionables, es decir, en "dame la pincelada X". Eso rompe el punto único de salida y el modelo de amenazas (los planes salen de `MIRADA`), e invita a que cachés intermedias las sirvan fuera de la concesión.
- **WebRTC DataChannel**: ICE/STUN/TURN + SCTP para un caso cliente-servidor, sin beneficio.

| Elemento | WebTransport (principal) | WebSocket (respaldo) |
|---|---|---|
| Flujo de control ("caballete") | El primer flujo bidireccional que abre el cliente. | Mensajes binarios con `u8 canal = 0` + una trama. |
| Una entrega | Un flujo unidireccional abierto por el servidor; FIN = fin de la entrega. | Un mensaje binario con `canal = 1` + el contenido del flujo. |
| Cancelar una entrega | `RESET_STREAM` (servidor) o `STOP_SENDING` (cliente), más `PLAN CANCELADAS`. | Solo antes de empezar a escribirla. |
| `MIRADA` en movimiento | Datagrama. | Mensaje con `canal = 2`, fiable, limitado a 20/s por el cliente. |
| Control de flujo | Ventanas QUIC por flujo y por conexión. | `bufferedAmount` + un mensaje pendiente por sesión. |
| Bloqueo de cabeza de línea entre pinceladas | No. | Sí (aceptado en el respaldo). |

Superficie HTTP (todo lo demás va por Seurat/1):

| Método y ruta | Uso |
|---|---|
| `GET /`, `/static/*` | Ficheros del visor. |
| `POST /seurat/v1/sesion` | Autentica (cookie o Bearer) y emite un token de sesión: 32 B, un solo uso, caduca en 120 s si no se usa. Devuelve las URL de ambos mapeos. En desarrollo devuelve además el hash del certificado para `serverCertificateHashes` (ECDSA, validez ≤ 14 días). |
| `CONNECT /seurat/v1/lienzo` (HTTP/3, `:protocol = webtransport`) | Sesión WebTransport. Comprueba `origin`. |
| `GET /seurat/v1/lienzo-ws` (`Upgrade: websocket`, `Sec-WebSocket-Protocol: seurat.1`) | Mapeo de respaldo. Comprueba `Origin`. |
| `PUT /seurat/v1/obras/{id}` | Subida en *streaming* de un máster a `inbox/`. Solo administrador. |
| `PUT /seurat/v1/obras/{id}/politica` | Cambia los techos por rol. Provoca `CONCESION`/`RASPAR` en las sesiones abiertas. Solo administrador. |
| `DELETE /seurat/v1/obras/{id}` | Baja de una obra. Solo administrador. |

**Ningún endpoint HTTP devuelve puntos.** El único camino es un flujo `PINCELADA` abierto por el Pintor.

### 3.2 Tramas, datagramas y flujos

**Enteros.**

- `vi` es la varint de QUIC (RFC 9000 §16). Los dos bits altos del primer byte dan la longitud: `00` → 1 B (6 bits), `01` → 2 B (14 bits), `10` → 4 B (30 bits), `11` → 8 B (62 bits). El resto va en *big-endian*.
- Vectores de RFC 9000 A.1: `25` = 37 · `7b bd` = 15 293 · `9d 7f 3e 7d` = 494 878 333 · `c2 19 7c 5e ff 14 e8 8c` = 151 288 809 941 952 652.
- El emisor usa la codificación mínima; el receptor acepta cualquiera (`40 25` = 37).
- `u8`, `u32` y `u64` son fijos en *big-endian*. Las cadenas son `vi largo + UTF-8`.

**Trama de control** (flujo de control; mensaje WebSocket con `canal = 0`):

```
+----------------+----------------+-------------------------------------------+
|   tipo (vi)    |   largo (vi)   |   payload (largo bytes)                   |
+----------------+----------------+-------------------------------------------+
payload = campos núcleo del tipo · [ etiqueta (vi) · largo (vi) · valor ]*      ← cola TLV de extensiones
```

Reglas:

- **Tipo obligatorio u opcional.** `tipo < 0x40` (varint de 1 byte) es **obligatorio**: uno desconocido es fatal (`ERROR 1`). `tipo ≥ 0x40` es **opcional**: se ignora saltando `largo` bytes. Así un servidor nuevo puede informar a un cliente viejo, pero nunca puede *asumir* que un cliente viejo entendió una orden.
- **Largo.** `largo` es el tamaño exacto del payload. Una trama de más de 64 KiB es fatal.
- **Extensiones.** Los campos núcleo son fijos para un (tipo, versión) y las extensiones van solo en la cola TLV. Una etiqueta desconocida se ignora, y un número de etiqueta nunca se reutiliza (§3.5).
- **Sin números de secuencia.** El orden del flujo de control lo da el transporte, y las entregas tienen identidad propia (`entrega`).
- **Datagrama** (solo `MIRADA`): `vi tipo · payload`, sin `largo` (el datagrama delimita). Como máximo 1 200 B.

**Flujo `PINCELADA`** (unidireccional S→C; mensaje WebSocket con `canal = 1`):

```
vi   tipo_flujo = 0x01 (PINCELADA)
vi   handle
vi   entrega                  número de entrega: por lienzo, monótono desde 1, asignado al abrir el flujo
u64  pincelada_id             s << 56 | morton(bx, by)
u8   bandas                   nibble alto = desde (b0), nibble bajo = hasta (b1, exclusivo)
vi   época                    concesión bajo la que se planificó y abrió la entrega
u8   qY · u8 qC               pasos de cuantización del estrato (qC = 0 ⇒ croma sin refinar)
vi   edición                  edición del almacén (1 = boceto provisional, 2 = definitiva)
u32  crc32c × (b1 − b0)       CRC-32C de cada banda, tal como está en disco
vi   largo  × (b1 − b0)       bytes de cada banda
...  bandas b0 .. b1−1        concatenadas
FIN
```

- **Número de entrega.** Es al lienzo lo que el número de secuencia es a un flujo TCP, pero cuenta pinceladas, no bytes.
- **Bandas.** `0x04` = todas · `0x02` = esbozo · `0x24` = retoque de las dos bandas densas · `0x01` = semilla.
- **Integridad extremo a extremo.** El cliente aplica una entrega solo al llegar el FIN y tras verificar el CRC-32C de cada banda.
  - El CRC se calcula en la ingesta y viaja sin cambios desde el disco.
  - Cubre el disco, la caché de páginas, las copias y el propio código del servidor, no solo el cable (que QUIC/TLS ya protege).
- **Época.** Toda entrega con número mayor que el `hasta_entrega` de un `RASPAR` lleva una `época` ≥ la de ese `RASPAR` (defensa en profundidad).
- **Semilla.** `pincelada_id = 10 << 56`, `bandas = 0x01`, y una sola banda con los valores codificados en DPCM (vecino izquierdo) + *zigzag* + LEB128 + *deflate*.

### 3.3 Catálogo de mensajes

| Tipo | Nombre | Dir. | Canal | Propósito |
|---|---|---|---|---|
| `0x01` | `SALUDO` | C→S | control | Versiones, capacidades, memoria, token; opcionalmente `REANUDAR`. |
| `0x02` | `BIENVENIDA` | S→C | control | Versión elegida, id de sesión, parámetros fijos, ficha de reanudación. |
| `0x03` | `LATIDO` | S→C | control | Latido de aplicación: detecta JS colgado, no solo QUIC vivo. |
| `0x04` | `ECO` | C→S | control | Respuesta al latido. |
| `0x05` | `ERROR` | ↔ | control | Error; con `fatal = 1` precede al cierre. |
| `0x06` | `ADIOS` | ↔ | control | Cierre ordenado. |
| `0x10` | `CATALOGO` | C→S | control | Solicita el catálogo. |
| `0x11` | `OBRA` | S→C | control | Un registro del catálogo. Se **empuja** al añadirse, cambiar de estado o de edición, o retirarse una obra. |
| `0x12` | `ABRIR` | C→S | control | Abre una obra (crea un lienzo). |
| `0x13` | `ABIERTA` | S→C | control | Asigna *handle* y describe la obra. Le siguen `CONCESION` y el boceto. |
| `0x14` | `CERRAR` | C→S | control | Cierra el lienzo; implica haber soltado todo lo suyo. |
| `0x20` | `MIRADA` | C→S | datagrama / control | ROI + viewport. Gana la de mayor `seq`. |
| `0x21` | `CONCESION` | S→C | control | Derecho de posesión vigente. Una concesión menor **es** la revocación. |
| `0x23` | `PLAN` | S→C | control | Inicio, fin y cancelaciones de las entregas de una `MIRADA`. |
| `0x24` | `RASPAR` | S→C | control | Orden de raspado: predicado + `hasta_entrega`. |
| `0x25` | `RASPADO` | C→S | control | Confirmación exacta: lo que se conserva hasta `hasta_entrega`. |
| `0x26` | `RECIBO` | C→S | control | Entregas completadas (rangos) + estado del receptor. |
| `0x27` | `SOLTAR` | C→S | control | Liberación voluntaria (LRU, caducidad, fallo…). |
| `0x28` | `RENOVAR` | S→C | control | Prorroga el arriendo de un conjunto de entregas. |
| `0x2A` | `AUDITAR` | S→C | control | Pide inventario sin raspar nada. |
| `0x2B` | `INVENTARIO` | C→S | control | Posesión exacta hasta `hasta_entrega`. |
| flujo `0x01` | `PINCELADA` | S→C | unidireccional | Una entrega: bandas `[b0, b1)` de una pincelada. |

Payloads:

```
Rangos       vi mayor · vi n_huecos · vi primer_rango · (vi hueco · vi largo_rango) × n_huecos
             Semántica de los ACK de QUIC (RFC 9000 §19.3.1): primer rango = [mayor − primer_rango, mayor];
             cada par siguiente: mayor' = menor_anterior − hueco − 2,  menor' = mayor' − largo_rango.
             mayor = 0 ⇒ conjunto vacío (las entregas empiezan en 1).

SALUDO       vi ver_min · vi ver_max · vi caps · vi mem_mib · vi token_len · token
             caps: 0x01 DATAGRAMAS · 0x02 REANUDAR   (resto reservado)
             TLV 0x01 REANUDAR: u64 sesión_anterior · 32 B ficha · vi n_handles · (vi handle · Rangos reclamados) × n_handles
BIENVENIDA   vi versión · vi caps · u64 sesión_id · vi lado · vi arriendo_s · vi latido_s · vi max_en_vuelo · vi sesión_max_pinceladas
             TLV 0x02 FICHA: 32 B (ficha de reanudación) · TLV 0x03 REANUDADA: vi n · (vi handle) × n
LATIDO/ECO   u64 nonce
ERROR        vi código · u8 fatal · vi ref_tipo · vi msg_len · msg
             código: 1 PROTOCOLO · 2 VERSION · 3 AUTENTICACION · 4 OBRA_INEXISTENTE · 5 OBRA_NO_LISTA · 6 HANDLE
                     7 POSESION_DISCREPANTE · 8 LIQUIDACION_VENCIDA · 9 LIMITE_TASA · 10 PRESUPUESTO · 11 INTERNO
                     12 REANUDACION_RECHAZADA
ADIOS        vi código · vi msg_len · msg
CATALOGO     (vacío)
OBRA         u8 evento · u8 estado · u8 progreso · vi edición · vi ancho · vi alto · u8 estratos · vi id_len · id · vi nombre_len · nombre
             evento: 0 LISTADO · 1 ALTA · 2 ESTADO · 3 EDICION · 4 BAJA
             estado: 0 RECIBIENDO · 1 BOCETO · 2 PINTANDO · 3 LISTA · 4 FALLIDA · 5 RETIRADA
ABRIR        vi id_len · id
ABIERTA      vi handle · vi ancho · vi alto · u8 estratos · vi edición · u8 techo_estrato · u8 techo_bandas
             vi semilla_ancho · vi semilla_alto
CERRAR       vi handle
MIRADA       vi handle · vi seq · vi x0 · vi y0 · vi x1 · vi y1 (coords. nativas; x1, y1 exclusivas) · vi vw · vi vh · u8 mflags
             mflags: bit0 OCULTA · bit1 QUIETA (la vista se detuvo: copia fiable por el flujo de control)
CONCESION    vi handle · vi época · u8 estrato_min · u8 bandas_max · u8 motivo · vi max_pinceladas · vi max_kib · vi arriendo_s
             motivo: 0 INICIAL · 1 MIRADA · 2 POLITICA · 3 OCULTA · 4 INACTIVIDAD · 5 ROL
PLAN         vi handle · vi seq_mirada · u8 evento · …
               0 INICIO       vi primera_entrega · vi previstas · u8 regulación (bit0 CARGA · bit1 PRESUPUESTO · bit2 COLA)
               1 FIN          vi última_entrega
               2 CANCELADAS   Rangos (entregas abiertas que nunca terminarán)
RASPAR       vi handle · vi orden · vi época · vi hasta_entrega · u8 predicado · parámetros
               1 ESTRATO_BAJO   u8 estrato                       raspar toda pincelada con s < estrato
               2 FUERA          vi x0 · vi y0 · vi x1 · vi y1    raspar las de s < 7 que no intersequen el rectángulo
               3 BANDAS         u8 estrato · u8 bandas_max        raspar las entregas de ese estrato con hasta > bandas_max
               4 LISTA          Rangos
               5 TODO
             ESTRATO_BAJO, FUERA y BANDAS nunca afectan al boceto; TODO sí. BANDAS solo se emite con estrato = estrato_min
             (ahí no hay hijos que queden huérfanos).
RASPADO      vi handle · vi orden · vi época · vi hasta_entrega · vi raspadas · vi liberadas_kib · Rangos (conservadas ≤ hasta_entrega)
RECIBO       vi handle · Rangos (completadas y verificadas desde el RECIBO anterior) · vi cola_ms · vi libre · vi renov_hasta
SOLTAR       vi handle · u8 motivo · Rangos
             motivo: 1 LRU · 2 DECODIFICACION · 3 CADUCADA · 4 PRESUPUESTO · 5 CONTEXTO_GPU · 6 CRC · 7 REEMPLAZADA
RENOVAR      vi handle · vi orden · vi arriendo_s · Rangos
AUDITAR      vi handle · vi orden · vi hasta_entrega
INVENTARIO   vi handle · vi orden · vi hasta_entrega · vi pinceladas · vi kib · Rangos (en posesión ≤ hasta_entrega)
```

`orden` es un contador por lienzo, compartido por las órdenes del servidor (`RASPAR`, `RENOVAR`, `AUDITAR`). `renov_hasta` es el mayor `orden` de `RENOVAR` que el cliente ya aplicó.

**Por qué rangos y no un resumen (*digest*).**

- El conjunto que posee un cliente está acotado por el cono (cientos de entregas) y es casi contiguo: las entregas se numeran en el orden en que se pintan, y un raspado quita estratos enteros, es decir, tramos.
- Por eso cabe en pocos bytes (el `RASPADO` de §3.4.3 describe 256 entregas en 5 bytes) y permite comparar por **igualdad exacta de conjuntos**, no con una suma de verificación que un cliente puede fabricar.
- La misma estructura sirve para acusar (`RECIBO`), soltar (`SOLTAR`), renovar (`RENOVAR`), reclamar al reanudar (`REANUDAR`) y confirmar (`RASPADO`, `INVENTARIO`).

### 3.4 Ejemplos de cable

Constantes del ejemplo:

- Obra `slide-0421` (§1.2), viewport 1920 × 1080.
- Rol autenticado: techo estrato 0 con 2 bandas.
- `mem_mib = 256`, luego `max_pinceladas = 768`; arriendo de 120 s; `max_en_vuelo = 12`.

En WebTransport todas las tramas de control van por el flujo bidireccional que abre el cliente, cada entrega por su propio flujo unidireccional, y la mirada en movimiento por datagramas.

#### 3.4.1 Handshake

```http
POST /seurat/v1/sesion HTTP/1.1
Host: img.example.edu
Authorization: Bearer eyJhbGciOi...
Content-Type: application/json

{"cliente":"visor/2.0","memMiB":256,"transportes":["webtransport","websocket"]}

HTTP/1.1 201 Created
Content-Type: application/json
Cache-Control: no-store

{"token":"de906b90...(64 hex)","lienzo":"https://img.example.edu/seurat/v1/lienzo",
 "respaldo":"wss://img.example.edu/seurat/v1/lienzo-ws","versiones":[1],"lado":256}
```

Handshake QUIC + TLS 1.3 (ALPN `h3`) y `SETTINGS` de HTTP/3. El servidor anuncia:

- `ENABLE_CONNECT_PROTOCOL = 1` (RFC 9220);
- `H3_DATAGRAM = 1` (RFC 9297);
- el ajuste de WebTransport del borrador negociado.

Después, el CONNECT extendido (cabeceras codificadas con QPACK):

```
C→S  HEADERS  :method = CONNECT   :protocol = webtransport   :scheme = https
              :authority = img.example.edu   :path = /seurat/v1/lienzo   origin = https://img.example.edu
S→C  HEADERS  :status = 200
```

El token no viaja en `:path` (acabaría en los registros): va en `SALUDO`. Del lado del navegador:

```js
const wt = new WebTransport(r.lienzo);            // desarrollo: { serverCertificateHashes: [{ algorithm: 'sha-256', value }] }
await wt.ready;
const caballete = await wt.createBidirectionalStream();            // flujo de control
const pinceladas = wt.incomingUnidirectionalStreams.getReader();   // una entrega por flujo
const miradas = wt.datagrams.writable.getWriter();                 // MIRADA en movimiento
```

Primer mensaje por el flujo de control, C→S, `SALUDO` (2 + 38 bytes):

```
01 26                                    tipo=SALUDO (0x01)  largo=38
01 01                                    ver_min=1  ver_max=1
03                                       caps = DATAGRAMAS | REANUDAR
41 00                                    mem_mib = 256
20                                       token_len = 32
de 90 6b 90 ... (32 bytes)               token del POST /sesion (un solo uso)
```

S→C, `BIENVENIDA` (2 + 52 bytes):

```
02 34                                    tipo=BIENVENIDA (0x02)  largo=52
01                                       versión = 1
03                                       caps = DATAGRAMAS | REANUDAR
3a 91 5e 0c 77 d2 14 b8                  sesión_id
41 00                                    lado = 256
40 78                                    arriendo_s = 120
0f                                       latido_s = 15
0c                                       max_en_vuelo = 12
44 00                                    sesión_max_pinceladas = 1024
02 20                                    TLV etiqueta=0x02 FICHA  largo=32
7a c5 61 8a ... (32 bytes)               ficha de reanudación
```

C→S, `ABRIR`. S→C, `ABIERTA` + `CONCESION` inicial:

```
12 0b                                    tipo=ABRIR (0x12)  largo=11
0a 73 6c 69 64 65 2d 30 34 32 31         id_len=10 "slide-0421"

13 11                                    tipo=ABIERTA (0x13)  largo=17
01                                       handle = 1
80 03 00 00                              ancho = 196608
80 02 80 00                              alto  = 163840
0b                                       estratos = 11  (0..10; 10 = semilla)
02                                       edición = 2 (definitiva)
00 02                                    techo del rol: estrato 0 · 2 bandas
40 c0 40 a0                              semilla 192 × 160

21 0d                                    tipo=CONCESION (0x21)  largo=13
01                                       handle = 1
01                                       época = 1
07                                       estrato_min = 7      ← solo el boceto hasta la primera MIRADA
04                                       bandas_max = 4  (en estrato_min)
00                                       motivo = INICIAL
43 00                                    max_pinceladas = 768
80 00 90 00                              max_kib = 36864  (36 MiB de bandas comprimidas)
40 78                                    arriendo_s = 120
```

Aún no hay `MIRADA`, así que `piso_inactividad = 7`: el cliente solo tiene derecho al boceto. El servidor lo pinta con las entregas 1–44: semilla, 4 × E9, 9 × E8 y 30 × E7, cada una en su flujo unidireccional. Cabecera del primer flujo:

```
01                                       tipo_flujo = PINCELADA
01                                       handle = 1
01                                       entrega = 1
0a 00 00 00 00 00 00 00                  pincelada_id: estrato=10 (semilla) morton=0
01                                       bandas = [0,1)
01                                       época = 1
01 01                                    qY=1  qC=1  (sin pérdida)
02                                       edición = 2
0c cd cf 6d                              crc32c banda 0
7f 58                                    largo banda 0 = 16216
ad bd 69 b0 ... (16216 bytes)            DPCM + zigzag + LEB128, deflate crudo
                                         FIN del flujo
```

#### 3.4.2 Subida de densidad (del boceto al estrato 1)

El usuario arrastra y amplía hacia la ROI `[65536, 69376) × [49152, 51312)`. Mientras se mueve, el visor envía una `MIRADA` por datagrama en cada fotograma. Si alguna se pierde no se retransmite: la siguiente la sustituye. Última `MIRADA` del gesto (24 bytes):

```
20                                       tipo=MIRADA (datagrama: sin largo, el datagrama delimita)
01                                       handle = 1
08                                       seq = 8
80 01 00 00                              x0 = 65536
80 00 c0 00                              y0 = 49152
80 01 0f 00                              x1 = 69376
80 00 c8 70                              y1 = 51312
47 80 44 38                              vw = 1920  vh = 1080
00                                       mflags = 0 (en movimiento)
```

Tras 300 ms sin cambios, la copia fiable con `QUIETA` va por el flujo de control:

```
20 17                                    tipo=MIRADA (0x20)  largo=23
01                                       handle = 1
09                                       seq = 9
80 01 00 00                              x0 = 65536
80 00 c0 00                              y0 = 49152
80 01 0f 00                              x1 = 69376
80 00 c8 70                              y1 = 51312
47 80 44 38                              vw = 1920  vh = 1080
02                                       mflags = QUIETA
```

El controlador ve la primera mirada, así que `piso_inactividad = 0`. La concesión sube al techo del rol:

```
21 0d                                    tipo=CONCESION (0x21)  largo=13
01                                       handle = 1
02                                       época = 2
00                                       estrato_min = 0      ← más fino que antes
02                                       bandas_max = 2  (en estrato_min)
01                                       motivo = MIRADA
43 00                                    max_pinceladas = 768
80 00 90 00                              max_kib = 36864  (36 MiB de bandas comprimidas)
40 78                                    arriendo_s = 120
```

El planificador calcula:

- `ideal = log2(3840/1920) = 1` y `φ = 0`, luego `s_f = max(1, 0) = 1`.
- `b_f = 4`: `s_f` no es `estrato_min`, así que el techo de bandas no aplica.
- El cono es el de la tabla de §2.3: 153 pinceladas y 212 entregas en tres pasadas.

```
23 07                                    tipo=PLAN (0x23)  largo=7
01                                       handle = 1
08                                       seq_mirada = 8
00                                       evento = INICIO
2d                                       primera_entrega = 45
40 d4                                    previstas = 212  (59 esbozo · 59 densidad · 94 periferia)
00                                       regulación = 0
```

Orden de las entregas:

- **Pasada 1, esbozo** (entregas 45–103):
  - primero los 19 ancestros del foco con bandas `[0,2)`, de grueso a fino: `P(6,4,3)`, `P(5,8,6)`, `P(4,16,12)`, 4 × E3 y 12 × E2;
  - después las 40 pinceladas del foco con `[0,2)`, del centro hacia fuera.
- **Pasada 2, densidad** (104–162): retoques `[2,4)` en el mismo orden, primero padres y después hijos.
- **Pasada 3, periferia** (163–256): anillos y cierre.

Primera pincelada del foco, `P(1,131,98)`, la más cercana al centro de la mirada. Longitudes y CRC son reales: son la salida del códec sobre la pincelada de estrato 1 de la muestra de §2.4.

```
01                                       tipo_flujo = PINCELADA
01                                       handle = 1
40 40                                    entrega = 64
01 00 00 00 00 00 68 0d                  pincelada_id: estrato=1 bx=131 by=98 (morton 0x680d)
02                                       bandas = [0,2)  (pasada de esbozo)
02                                       época = 2
04 06                                    qY=4  qC=6
02                                       edición = 2
64 7c be 67 07 62 9c 02                  crc32c banda 0 · banda 1
59 60 56 f1                              largos: 6496 · 5873
ed 5a 49 8c ... (6496 bytes)             banda 0
ed 9a cb 8f ... (5873 bytes)             banda 1
                                         FIN del flujo
```

El cliente acusa a medida que verifica. Aquí han terminado 45–60, salvo la 52, que sigue en vuelo:

```
26 0a                                    tipo=RECIBO (0x26)  largo=10
01                                       handle = 1
3c 01 07                                 mayor=60  n_huecos=1  primer_rango=7  → [53, 60]
00 06                                    hueco=0  largo_rango=6  → [45, 51]
28                                       cola_ms = 40   (verde)
42 c4                                    libre = 708
00                                       renov_hasta = 0
```

Si el `PLAN INICIO` hubiera anunciado `regulación ≠ 0`, el cono ya vendría recortado por carga, presupuesto o cola del cliente (§6).

#### 3.4.3 Bajada de densidad (estrato 0 → estrato 1) con raspado sin barrera

Contexto:

- El usuario amplía a 1:1 en el centro de la vista anterior: `MIRADA seq = 12`, ROI `[66496, 68416) × [49692, 50772)`.
- Entonces `ideal = 0` y `s_f = 0 = estrato_min`, luego `b_f = min(4, bandas_max) = 2`.
- Esqueleto y anillos ya están en el cliente, así que el plan es solo el foco: 45 pinceladas del estrato 0 con `[0,2)`, entregas 257–301, 355 kB.

Con la entrega 289 recién abierta (33 de 45), un administrador ejecuta `PUT /seurat/v1/obras/slide-0421/politica`: el rol autenticado pasa a techo estrato 1 (4 bandas). El controlador aplica el cambio de forma atómica sobre el estado del Pintor:

1. `concesión := época 3`. Desde este instante todo flujo que se abra lleva `época 3` y pasa el nuevo chequeo.
2. `N :=` última entrega numerada = 289.
3. Las 12 pinceladas del estrato 0 que aún no se habían abierto salen de la cola; nunca tuvieron número. Las 5 que están en vuelo (285–289) se cortan con `RESET_STREAM`.
4. Por el flujo de control salen, en este orden, `CONCESION`, `PLAN CANCELADAS` y `RASPAR`.

```
21 0d                                    tipo=CONCESION (0x21)  largo=13
01                                       handle = 1
03                                       época = 3
01                                       estrato_min = 1      ← revoca el estrato 0
04                                       bandas_max = 4  (en estrato_min)
02                                       motivo = POLITICA
43 00                                    max_pinceladas = 768
80 00 90 00                              max_kib = 36864  (36 MiB de bandas comprimidas)
40 78                                    arriendo_s = 120

23 07                                    tipo=PLAN (0x23)  largo=7
01                                       handle = 1
0c                                       seq_mirada = 12
02                                       evento = CANCELADAS
41 21 00 04                              mayor=289  n_huecos=0  primer_rango=4  → [285, 289]

24 07                                    tipo=RASPAR (0x24)  largo=7
01                                       handle = 1
03                                       orden = 3
03                                       época = 3
41 21                                    hasta_entrega = 289
01                                       predicado = ESTRATO_BAJO
01                                       estrato = 1   → raspar toda pincelada con s < 1
```

**No hay barrera.** El usuario sigue desplazándose 4096 px a la derecha (`MIRADA seq = 13`). El Pintor planifica con `s_f = max(0, 1) = 1` y pinta las entregas 290–336 **sin esperar el `RASPADO`**:

- 18 entregas de esbozo: 15 pinceladas nuevas del estrato 1, 2 ancestros nuevos y un retoque;
- 24 entregas de densidad;
- 5 entregas de periferia.

Son 47 entregas y 1,08 MB, todas con `época 3`.

El cliente:

- raspa las 28 entregas del estrato 0 ya recibidas (257–284): libera 28 capas de textura (7 MiB de VRAM) y 216 KiB de bandas;
- para 285–289 recibe los `RESET_STREAM` y el `PLAN CANCELADAS`: quedan liquidadas;
- con toda entrega ≤ 289 liquidada, responde:

```
25 0d                                    tipo=RASPADO (0x25)  largo=13
01                                       handle = 1
03                                       orden = 3
03                                       época = 3
41 21                                    hasta_entrega = 289
1c                                       raspadas = 28
40 d8                                    liberadas_kib = 216
41 00 00 40 ff                           conservadas: mayor=256  n_huecos=0  primer_rango=255  → [1, 256]
```

El servidor calcula `esperado = libro ∩ [1, 289] \ {s < 1} \ canceladas = [1, 256]`, es decir, el boceto más el plan de §3.4.2.

- **Coincide**: el raspado queda **confirmado**. Las entregas 290–336 no participan, porque se planificaron bajo la `época 3`.
- **No coincide**: `ERROR 7 POSESION_DISCREPANTE` fatal.
- **Sin `RASPADO` en 10 s**: `ERROR 8 LIQUIDACION_VENCIDA` fatal.

#### 3.4.4 Préstamos: renovación y reanudación

Cada `arriendo / 2 = 60 s` el controlador renueva lo que sigue permitido: aquí, el boceto, el plan de §3.4.2 y el de §3.4.3.

```
28 0b                                    tipo=RENOVAR (0x28)  largo=11
01                                       handle = 1
0c                                       orden = 12
40 78                                    arriendo_s = 120
41 50 01 2e                              mayor=336  n_huecos=1  primer_rango=46  → [290, 336]
20 40 ff                                 hueco=32  largo_rango=255  → [1, 256]
```

El cliente fija `vence = t_recepción + 120 s` para esas entregas y lo acusa con `renov_hasta = 12` en su siguiente `RECIBO`.

Cuarenta segundos después el usuario pasa de Wi-Fi a 4G. El servidor QUIC no migra conexiones, así que la conexión muere. El visor hace `POST /sesion` para obtener un token nuevo, abre otra sesión WebTransport y reclama lo que conserva:

```
01 40 59                                 tipo=SALUDO (0x01)  largo=89
01 01                                    ver_min=1  ver_max=1
03                                       caps = DATAGRAMAS | REANUDAR
41 00                                    mem_mib = 256
20                                       token_len = 32
d5 b9 e4 a5 ... (32 bytes)               token nuevo (POST /sesion tras el cambio de red)
01 31                                    TLV etiqueta=0x01 REANUDAR  largo=49
3a 91 5e 0c 77 d2 14 b8                  sesión_anterior
7a c5 61 8a ... (32 bytes)               ficha de reanudación vigente
01                                       n_handles = 1
01                                       handle = 1
41 50 01 2e                              reclamo: mayor=336  n_huecos=1  primer_rango=46  → [290, 336]
20 40 ff                                 reclamo: hueco=32  largo_rango=255  → [1, 256]
```

Respuesta del servidor:

- **Acepta.** Conservó el libro de la sesión anterior durante `L + δ`, comprueba que la ficha coincide y que el reclamo ⊆ libro no vencido. Adopta el libro: `BIENVENIDA` con `REANUDADA {1}` y una ficha nueva, seguida de la `CONCESION` vigente para el handle 1. El cliente conserva sus 303 entregas (218 pinceladas) sin volver a descargar un byte.
- **Rechaza.** Si el reclamo contuviera algo fuera del modelo, responde `ERROR 12 REANUDACION_RECHAZADA` (no fatal): el cliente vacía el lienzo y empieza por el boceto.

### 3.5 Versionado y negociación de capacidades

- **Versión mayor**: va en la ruta (`/seurat/v1/…`) y en el nombre del subprotocolo WebSocket (`seurat.1`). No se depende de la opción `protocols` de WebTransport, que no está disponible en todas partes. Una versión mayor puede cambiar tramas, el formato de flujo o el códec.
- **Versión menor**: `ver_min..ver_max` en `SALUDO` y `versión` en `BIENVENIDA`. Dentro de una mayor, los campos núcleo y los tipos existentes no cambian: solo se añaden tipos nuevos y etiquetas TLV nuevas.
- **Capacidades**: máscara `caps`. El servidor responde con el subconjunto que usará; en el mapeo WebSocket, `DATAGRAMAS = 0` y la mirada viaja por el canal 2.
- **Registro**: tipos, etiquetas TLV, códigos de error y motivos. Un número retirado **no se reutiliza jamás**. Tipo obligatorio desconocido: fatal. Tipo opcional o etiqueta desconocidos: se ignoran.
- **Códec**: `qY`/`qC` viajan en cada pincelada y `edición` identifica la versión del almacén de cada obra. Cambiar la tabla de cuantización de obras nuevas no requiere una versión nueva; cambiar la transformada o el formato de banda sí (versión mayor).

---

## 4. Flujos de subida y bajada de densidad

### 4.1 Subir la densidad (transferencia)

1. **Cliente → `MIRADA`.**
   - En movimiento va por datagrama, como mucho una por fotograma.
   - Al detenerse (300 ms sin cambios) o al cambiar `OCULTA`, va una copia fiable por el flujo de control.
   - El servidor aplica una cubeta de 20/s (ráfaga de 40) por sesión. El exceso se **coalesce**, porque gana la última; no es un error.
2. **Controlador.** Si la mirada levanta el piso de inactividad (primera mirada, pestaña visible de nuevo), amplía la concesión: `CONCESION` con `época + 1`. Ampliar nunca requiere `RASPAR`.
3. **Planificador.**
   - Calcula el cono (§2.3) y lo ordena en pasadas.
   - **Sustituye** el plan pendiente de la sesión: las entradas del plan anterior que aún no se abrieron se descartan (no tienen número y no hay nada que cancelar), y las que están en vuelo continúan (el cono nuevo casi siempre las contiene).
   - Emite `PLAN INICIO` con `primera_entrega` = siguiente número y `previstas`.
4. **Pintor**, el punto único de salida. Cuando llega el turno de una entrada (§6.2), comprueba en este orden:
   - (a) La concesión la permite: `s ≥ estrato_min`; si `s == estrato_min`, `b1 ≤ bandas_max`; la edición es la vigente.
   - (b) Regla monótona sobre el libro: `bandas(padre) ≥ b1`. Basta con que el padre esté **enviado**; el cliente retiene al hijo hasta sintetizar al padre.
   - (c) `|libro| < max_pinceladas` y las entregas abiertas desde el último `RECIBO` son menos que `libre`.
   - (d) Presupuesto de pincel (§9) si `s ≤ 1`.
   - (e) Hay ranura libre: `max_en_vuelo` de la sesión y ranuras globales.

   Si falla (a) o (b), la entrada se descarta: se planificó con un estado ya viejo. Si falla (c) o (e), espera. Si falla (d), se sustituye por la versión del estrato `s + 1` (recorte de entrega, marcado en `regulación`).
5. **Número y libro antes que bytes.** El Pintor asigna el número, anota la entrega en el libro (estado `EN_VUELO`, época) y después abre el flujo unidireccional. Escribe la cabecera y copia las bandas con lecturas posicionales del `.pinc`, y termina con FIN.
6. **Cliente.** Al recibir el FIN:
   - Verifica el CRC de cada banda, la época y la concesión, el padre (presente o en vuelo) y el contador.
   - Sintetiza en el Worker: `DecompressionStream('deflate-raw')` → LEB128 → predicción inversa → S inversa → capa de textura.
   - Si era un retoque de un padre, re-sintetiza sus descendientes poseídos.
   - Acusa con `RECIBO` cada 100 ms o cada 8 entregas, lo que llegue antes.
7. **Servidor.** Con cada `RECIBO` marca las entregas como `RECIBIDA` y fija `vence_srv = t + L + δ`. Cuando termina la última entrega prevista emite `PLAN FIN`.

Plan en pasadas:

```
planificar(M, C, libro, e):
  (s_i, φ) = ideal(M)
  s_f = max(s_i, C.estrato_min);   b_f = (s_f == s_i) ? 4 − ⌊4φ⌋ : 4
  si s_f == C.estrato_min:  b_f = min(b_f, C.bandas_max)
  (s_f, b_f, anillos) = regular(s_f, b_f, e)                    // §6.3: escalera de degradación por carga
  quiero = cono(M, s_f, b_f, anillos) con cierre monótono       // §2.3
  núcleo = foco ∪ ancestros(foco)
  orden(P) = (−s, distancia² del centro de P al centro de la mirada, morton)
  pasada 1  esbozo:    P ∈ núcleo, por orden:  [tiene(P), min(quiero(P), 2))
  pasada 2  densidad:  P ∈ núcleo, por orden:  [max(tiene(P), 2), quiero(P))
  pasada 3  periferia: P ∉ núcleo, por orden:  [tiene(P), quiero(P))
  (se omiten los intervalos vacíos; tiene(P) se actualiza tras cada entrada planificada)
```

Por qué tres pasadas:

- **Latencia del foco.** En el ejemplo de §3.4.2, tras la pasada 1 (0,90 MB) el foco entero está a la vista con densidad de esbozo, y tras la pasada 2 (2,66 MB) está completo.
- **La periferia va al final.** Solo sirve para desplazarse, así que va la última y es lo primero que se recorta bajo carga.
- **Cada pasada respeta la regla monótona en todo instante.** Un padre siempre alcanza sus bandas antes que su hijo.

### 4.2 Bajar la densidad (revocación con raspado confirmado, sin barrera)

1. **Disparador**: cambio de política (`PUT …/politica`), cambio de rol (reautenticación), pestaña oculta (`OCULTA`) o inactividad (60 s sin `MIRADA`).
2. **Controlador**, de forma atómica sobre el estado de la sesión en el Pintor:
   - `concesión := época + 1`;
   - `N :=` último número de entrega asignado;
   - purga de la cola las entradas no permitidas y hace `RESET_STREAM` de las entregas en vuelo no permitidas;
   - encola `CONCESION` → `PLAN CANCELADAS` (si hay) → `RASPAR {orden, época, hasta_entrega = N, predicado}`.
3. **El Pintor sigue** en el acto con las entregas permitidas, que llevan números `> N`. No hay barrera.
4. **Cliente.** Procesa el `RASPAR` de forma síncrona, antes de la siguiente trama de control:
   - (a) Aplica el predicado a toda entrega poseída `≤ N`: libera la textura, los bytes de las bandas y los valores en caché.
   - (b) Las entregas `≤ N` aún no liquidadas se descartan al llegar si cumplen el predicado; las que no lo cumplen se aplican normalmente.
   - (c) Espera a que **toda** entrega `≤ N` esté liquidada: FIN verificado, o `RESET_STREAM` / `PLAN CANCELADAS`.
   - (d) Envía primero los `SOLTAR` pendientes y luego `RASPADO {orden, hasta_entrega, conservadas ≤ N}`.
5. **Servidor.** El bucle de entrada es ordenado, así que al procesar el `RASPADO` ya aplicó todos los `SOLTAR` anteriores. Calcula `esperado = {k ∈ libro : k ≤ N} \ predicado \ canceladas`.
   - `conservadas == esperado`: confirmado, y las entradas raspadas salen del libro.
   - Si no coinciden: `ERROR 7` fatal.
   - Sin `RASPADO` en 10 s: `ERROR 8` fatal.
   - Varias órdenes pendientes se confirman en orden: el `RASPADO` de la orden `k` implica que se aplicaron todas las anteriores.
6. **Revocación pasiva.** Lo que ya no está permitido no se renueva nunca. Aunque un cliente conforme perdiera o ignorara el `RASPAR` por un fallo, soltaría esas entregas como mucho `L` después de su última renovación.
7. **Auditoría.** `AUDITAR` cada 60 s o cada 500 entregas: el cliente responde `INVENTARIO` y el servidor lo compara con las mismas reglas. Detecta pronto los fallos del cliente.

**Por qué no hay carreras.**

- **Orden en el servidor.** El cambio de concesión y la fijación de `N` ocurren antes de escribir el `RASPAR`. Todo flujo abierto después tiene número `> N` y época nueva, y se planificó y comprobó bajo la concesión nueva.
- **Flujos que adelantan al control.** Los flujos de pinceladas son independientes del flujo de control, así que una entrega `> N` puede llegar antes que el propio `RASPAR`. Es inocuo: está permitida por la concesión nueva. Si su `época` es mayor que la conocida, el cliente la retiene (como mucho `max_en_vuelo`) hasta que llegue la `CONCESION`.
- **Entregas viejas tardías.** Las entregas `≤ N` que llegan tras el `RASPAR` las resuelve el paso 4b.
- **Rango explícito.** Ambos lados conocen `N` explícitamente, sin adivinar "lo que estaba en vuelo", y comparan exactamente el mismo rango.
- **Frente a una barrera.** Con barrera ("no pintes hasta confirmar"), el visor se congelaría durante cada revocación. Aquí lo permitido sigue fluyendo y la cuenta se hace por rangos de números.

### 4.3 Aislamiento entre clientes

- **Estado por sesión**: caballete, libros, concesiones, cola de plan, `e_i` y `α_i`. Solo se comparte lo inmutable (almacén, catálogo) y el planificador justo del Pintor.
- **Raspados independientes.** Un `RASPAR` de una sesión jamás afecta a otra. Un cambio de política produce órdenes independientes por sesión, cada una con su propio `N`.
- **Presupuesto por (principal, obra)**, no por sesión: dos pestañas del mismo usuario comparten presupuesto.
- **Únicos acoplamientos**: el orden del Pintor (justo por diseño, §6.2) y la regulación por carga (`e_i` por sesión, §6.3).

---

## 5. Gestión de memoria en el cliente

### 5.1 Modelo de presupuesto

El cliente declara `mem_mib` en `SALUDO`:

- `min(256, navigator.deviceMemory × 64)` si la API existe (solo Chromium);
- 128 si no.

El servidor fija `max_pinceladas = min(3 × mem_mib, sesión_max, política)` y `max_kib = 48 × max_pinceladas`.

| Recurso | Qué guarda | Cota | Quién la fija |
|---|---|---|---|
| VRAM | `TEXTURE_2D_ARRAY` RGBA8 256 × 256, una capa por pincelada poseída, en arrays de 256 capas (el mínimo garantizado de `MAX_ARRAY_TEXTURE_LAYERS`). | `max_pinceladas × 256 KiB` = 192 MiB | Servidor (`CONCESION`). |
| Heap: bandas comprimidas | Los bytes de cada entrega poseída. Sirven para re-sintetizar descendientes, rehacer texturas si se pierde el contexto WebGL y raspar bandas sin volver a descargar. | `max_kib` = 36 MiB | Servidor. |
| Heap del Worker: caché de valores | `Int16Array` YCoCg 256 × 256 × 3 (384 KiB) de las pinceladas recién sintetizadas que hacen falta como padres. LRU, recalculable desde los bytes. | 48 entradas = 18 MiB | Cliente. |
| Entregas en vuelo | Flujos abiertos. | `max_en_vuelo` = 12 × ≤ 70 kB | Servidor + ventanas QUIC. |
| Índice | `Map<entrega, {pincelada, bandas, capa, bytes, vence}>` + `Map<pincelada, entregas[]>`. | ≈ 768 × 100 B | — |

- **Estado canónico**: los bytes de las bandas (pequeños) más las texturas. Los valores sintetizados son **caché**.
- **Ejemplo** tras §3.4.2: 197 pinceladas (con la semilla) → 49,25 MiB de VRAM, ≈ 6,6 MB de bandas y 18 MiB de caché: menos de 75 MiB de los 256 declarados.

### 5.2 Política de desalojo

1. **Obligatorio (`RASPAR`)**: síncrono y completo antes de procesar la siguiente trama de control (§4.2).
2. **Por caducidad**:
   - La comprobación no depende de temporizadores. Antes de cada pintado y con cada mensaje entrante se compara `performance.now()` (monótono) con `vence`.
   - Lo vencido se borra, se agrupa y se comunica con `SOLTAR CADUCADA` (como mucho uno cada 100 ms).
   - Una pincelada vence con su padre: `vence_efectivo = min(vence, vence_efectivo(padre))`. Así lo poseído sigue cerrado por ancestros.
   - **Nada vencido se pinta.**
3. **Voluntario (presión)**. Se activa cuando `poseídas + en vuelo ≥ max_pinceladas − 8`, cuando los bytes superan el 90 % de `max_kib` o cuando falla una reserva de VRAM.
   - Solo son candidatas las pinceladas **sin hijos poseídos** (se desaloja de las hojas hacia arriba). Así lo poseído sigue cerrado por ancestros, que es lo que exigen la regla monótona y la síntesis.
   - Nunca se desalojan el boceto ni el núcleo del cono actual.
   - Orden: primero lo que está fuera del cono actual; después el estrato más fino; después lo más lejano al centro de la mirada; por último lo menos recientemente pintado.
   - Se libera una pincelada entera (todas sus entregas) o sus entregas superiores (soltar el retoque `[2,4)` y conservar `[0,2)`). Nunca una entrega inferior conservando una superior.
   - Se comunica con `SOLTAR LRU` **antes** de enviar cualquier cosa que dependa de la cuenta (`RECIBO.libre`, `RASPADO`, `INVENTARIO`).

### 5.3 Presión del navegador

| Señal | Acción del cliente | Efecto en el protocolo |
|---|---|---|
| `visibilitychange` → oculta | `MIRADA` con `OCULTA` | `CONCESION(estrato_min = 7, OCULTA)` + `RASPAR ESTRATO_BAJO 7`: queda el boceto (44 capas, 11 MiB). Al volver a ser visible, la `MIRADA` provoca concesión y plan, y la vista se repinta desde la pasada de esbozo con menos de 1 MB. |
| `webglcontextlost` | Las texturas desaparecen pero los bytes siguen en el heap. Con `webglcontextrestored` se re-sintetiza y se re-sube desde los bytes. | Ninguno: la posesión no cambia y no se re-descarga nada. |
| Fallo de síntesis / OOM del Worker | `SOLTAR DECODIFICACION` | Se reenvía una vez. Si falla de nuevo, esa pincelada queda inutilizable en la sesión: el área se ve a la densidad del padre. |
| CRC incorrecto | `SOLTAR CRC` | Se reenvía una vez. Si falla de nuevo, alerta en el servidor (§8). |
| `pagehide` (bfcache) | Nada: la página se congela y la conexión se cierra. | El libro sobrevive `L + δ`. `pageshow` con `persisted` y dentro de `L` → `REANUDAR`; si no, se vacía. |
| Pestaña en segundo plano (temporizadores estrangulados) | Las caducidades se comprueban al pintar y al recibir, no con temporizadores. | Se cumplen en la primera oportunidad; el margen `δ` del servidor lo cubre (§8). |
| Falta de memoria sin API (falla una reserva) | Desalojo voluntario (§5.2.3). | `SOLTAR LRU`. |

### 5.4 Garantía "nunca más de lo concedido"

- **En el cliente** (defensa en profundidad), para cada entrega que llega:
  - `época ≥` la vigente (la retiene si es mayor y aún desconocida);
  - `s ≥ estrato_min`, y si `s == estrato_min`, `b1 ≤ bandas_max`;
  - cabe en `max_pinceladas` y en `max_kib`;
  - su padre está poseído con `≥ b1` bandas (o en vuelo: espera);
  - los CRC son correctos.

  Si algo falla, la descarta y la suelta con `SOLTAR` (y lo registra: es un fallo del servidor).
- **En el servidor**, que es la autoridad:
  - el Pintor nunca abre un flujo que viole la concesión o el libro (§4.1);
  - los raspados se confirman por igualdad exacta;
  - las auditorías periódicas cierran el hueco entre raspados.
- **En el tiempo**: sin renovación, un cliente conforme conserva una entrega como mucho `L = 120 s` después de la última concesión que recibió (entrega o `RENOVAR`), aunque no haya ningún mensaje más.

---

## 6. Control de flujo, contrapresión y equidad

### 6.1 Tres lazos, uno por unidad

1. **Transporte (bytes).**
   - Ventanas QUIC por flujo y por conexión. El navegador concede crédito a medida que la aplicación lee.
   - Ventanas iniciales ≥ BDP: con 50 Mb/s y 100 ms de RTT hay 625 kB en vuelo, luego ventana de conexión ≥ 1 MiB. La ventana por flujo es de 128 KiB, así que una pincelada entera (≤ 70 kB) nunca espera crédito a mitad.
2. **Aplicación (pinceladas).**
   - `max_en_vuelo = 12` flujos simultáneos por sesión.
   - `libre`, publicado en cada `RECIBO`, es la ventana del receptor en pinceladas: la que el cliente puede aceptar ahora. Es el análogo de la `rwnd` de TCP.
   - Dimensionado con la ley de Little: en vuelo = λ · R ≈ 100 pinceladas/s (≈ 3,5 MB/s con 35 kB de media) × 0,1 s (RTT + transmisión) ≈ 10, luego 12.
3. **Receptor (tiempo).**
   - `cola_ms` es el trabajo pendiente del Worker de síntesis. **El cliente lo mide directamente**; no se infiere de los bytes.
   - Verde, `< 150 ms`: normal.
   - Ámbar, `150–400 ms`: el Pintor reduce `max_en_vuelo` a la mitad y limita a 2 bandas las entregas nuevas del foco (el resto llegará como retoque).
   - Rojo, `> 400 ms`: ninguna entrega nueva hasta que baje de 150 ms (histéresis).

Además:

- **Un cliente lento no le cuesta memoria al servidor.** Su cola guarda entradas de plan (id + bandas, ≈ 24 B), no bytes: los bytes se leen del disco solo cuando se abre una ranura.
- **Flujos estancados.** Un flujo sin progreso en 30 s se corta con `RESET_STREAM` y se anuncia en `PLAN CANCELADAS`.
- **Tasa por sesión.** Un límite configurable (p. ej. 25 MB/s) impide que un cliente de LAN monopolice la interfaz de red.

### 6.2 Equidad entre N sesiones: max-min sobre la nitidez

El objetivo: **ninguna sesión recibe puntos finos mientras otra espera puntos gruesos**. Es el llenado progresivo del max-min, aplicado a la nitidez en lugar de al caudal.

- **Clase.** La clase de una entrada pendiente es su estrato `s`: cuanto más gruesa, más urgente, y el boceto es lo máximo. A igual estrato van primero la pasada 1, luego la 2, luego la 3.
- **Envejecimiento.** `clase_efectiva = s + ⌊espera / 500 ms⌋`, con tope 10. Una entrada del estrato 0 que lleva 5 s esperando compite como un boceto: no hay inanición.
- **Reparto por bytes.** Dentro de la misma clase efectiva se usa *stride scheduling*. Se elige la sesión con menor `paso_i` y se actualiza `paso_i += bytes / peso_i` (peso por rol, 1 por defecto). Resultado: reparto proporcional en bytes, como WFQ.
- **Ranuras.** 512 flujos de entrega simultáneos en todo el servidor, más el `max_en_vuelo` de cada sesión.
- **Disco.** Lecturas posicionales desde hilos virtuales. Los estratos gruesos (E3–E9, ≈ 0,65 GB en el ejemplo) son pocos, calientes y compartidos por todos: la caché de páginas del SO los sirve desde RAM.
- **`MIRADA`.** Cubeta de 20/s con ráfaga de 40 por sesión; el exceso se coalesce. `ERROR 9` solo ante un abuso sostenido (> 200/s durante 5 s).
- **Medición.** En las pruebas de carga se calcula el índice de Jain `J = (Σ xᵢ)² / (n · Σ xᵢ²)` sobre la nitidez servida (estrato medio de lo pintado en la ROI) de sesiones con la misma demanda. Objetivo: `J ≥ 0,9`.

### 6.3 La carga como palanca de entrega, no de posesión

**Señal: CoDel sobre la cola del Pintor.**

- Para cada entrega, `estancia = t_inicio − t_lista`, donde "lista" significa que le tocaba y estaba permitida.
- En cada tic de 250 ms: si la **estancia mínima** del tic supera el objetivo de 25 ms, hay cola persistente, no una ráfaga, y el Pintor entra en estado congestionado.
- Mientras dura, toda entrega que empieza se **marca**, como el CE de ECN.

**Respuesta por sesión: DCTCP.** Sea `F_i` la fracción de entregas de la sesión `i` marcadas en el tic:

```
α_i ← (1 − g)·α_i + g·F_i,   g = 1/16
si F_i > 0:  e_i ← max(⅛, e_i · (1 − α_i / 2))       // decremento multiplicativo proporcional a la congestión
si no:       e_i ← min(1, e_i + 1/32)                 // incremento aditivo por tic
```

Es un AIMD, así que converge a `e_i` iguales entre sesiones con la misma demanda (Chiu–Jain). La escalera traduce `e_i` en recortes del cono; la concesión no cambia:

| `e_i` | Efecto en el cono |
|---|---|
| ≥ ¾ | Normal. |
| [½, ¾) | Sin anillo 2; anillo 1 con 1 banda. |
| [¼, ½) | Además, foco con ≤ 2 bandas (se pospone la pasada 2 del foco). |
| [⅛, ¼) | Además, foco en `s_f + 1`: una octava más grueso. |

- **Aviso y recuperación.** `PLAN INICIO.regulación` activa el bit `CARGA` cuando el plan salió recortado. Cuando `e_i` se recupera, el planificador re-planifica la mirada vigente y lo que faltaba llega como retoque.
- **Histéresis intrínseca.** Subir de ⅛ a 1 lleva 28 tics, es decir, 7 s, así que no oscila.
- **Nunca se raspa por carga.** Lo entregado se queda hasta que venza su arriendo o lo desaloje el LRU. Reenviar esos mismos bytes costaría justo cuando la carga acaba de bajar.
- **Por qué no basta el control de congestión de QUIC.** Ese regula el camino de red de cada conexión. La cola del Pintor capta los cuellos de botella del servidor (disco, CPU, ranuras globales) que la red no ve: es CoDel contra el *bufferbloat* dentro del servidor.

---

## 7. Ingesta de imágenes nuevas

### 7.1 Ciclo de vida

```
 inbox/ (WatchService) ──┐
 PUT /seurat/v1/obras/id ┴──► [1] REGISTRO     OBRA(ALTA, RECIBIENDO)
                             [2] SONDEO       formato (TIFF/BigTIFF, SVS, OME-TIFF…); ¿trae visión general?
                             [3] BOCETO       si la trae: semilla y E7–E9 a partir de ella → edición 1
                                              OBRA(ESTADO, BOCETO): ya se puede ABRIR (solo boceto)
                             [4] PASADA       una lectura secuencial del máster por bandas de 256 filas
                                              OBRA(ESTADO, PINTANDO, progreso) cada 1 %
                             [5] CIERRE       índices + meta.json con fsync → edición 2
                                              OBRA(EDICION, LISTA)
                             [6] SUSTITUCIÓN  los lienzos con pinceladas de edición 1 reciben las de edición 2
                                              como entregas nuevas; el cliente suelta las viejas (SOLTAR REEMPLAZADA)
```

**La pasada (paso 4).**

- **Lectura.** El lector decodifica el máster por bandas de 256 filas (TwelveMonkeys ImageIO para TIFF/BigTIFF; Bio-Formats para formatos de escáner) y convierte a YCoCg-R.
- **Acumulador por estrato.** Cada estrato `s` tiene uno de `256 × (W/2^s) × 3` valores `int16`.
- **Emisión.** Al llenarse el acumulador de un estrato:
  - se aplica la transformada S a sus 256 filas;
  - las 128 filas de padres pasan al acumulador de `s + 1`;
  - se codifican las pinceladas de esa fila de bloques en un *pool* de CPU (predicción con padres verdaderos, cuantización, orden por energía, bandas, *deflate*). Las pinceladas son independientes entre sí, así que el paralelismo es trivial.
  - Los bytes se anexan a `E{s}.pinc` y **después** se escribe la entrada del índice.
- **Memoria.** `Σ_s 256 · (W/2^s) · 3 · 2 B ≤ 2 · 256 · W · 6 B ≈ 604 MB` para `W = 196 608`, más los búferes del *pool*. No depende del alto de la imagen.
- **Borde.** La última banda (parcial) se completa replicando el borde.

**Por qué no hay servicio fino durante `PINTANDO`.**

- Las pinceladas finas se emiten primero: el estrato 0 sale desde la primera banda.
- Sus ancestros (los estratos gruesos) se completan al final: el estrato 9 necesita la imagen entera.
- Una pincelada sin padres no se puede sintetizar. Por eso, durante la pasada, lo único servible es el boceto de la edición 1.

**Coste.** Domina la decodificación del máster, como en cualquier ingesta. La transformada son sumas y desplazamientos enteros, y el *deflate* por banda se paraleliza. No está medido en Java.

### 7.2 Disposición en disco

```
obras/slide-0421/
  meta.json        id, nombre, ancho, alto, lado = 256, estratos = 11, qtab, techos por rol, estado, edición, keepMaster
  semilla.bin      estrato 10 sin pérdida (DPCM + zigzag + LEB128 + deflate) con su CRC-32C
  E0.pinc          bandas de todas las pinceladas del estrato 0; solo anexar, en orden de escritura
  E0.idx           40 B por pincelada en orden de barrido (by · nx + bx):
                     u64 offset · 4 × u32 fin acumulado de banda · 4 × u32 crc32c de banda
  E1.pinc … E9.idx
  ed1/             boceto provisional (edición 1); se borra cuando ningún lienzo lo usa
  master/          opcional; nunca se sirve
cobertura/<principal>/slide-0421.bits      presupuesto (§9): 4 bits por pincelada de E0 y E1 (bandas máximas entregadas)
```

- **Registro del índice.**
  - `offset = 0xFFFF_FFFF_FFFF_FFFF` indica pincelada **ausente** (aún no escrita).
  - Todos los fines a 0 indican pincelada **vacía**: todos sus padres tienen energía nula. Es válida, cuesta 0 bytes y se pinta con la predicción.
  - `E0.idx` ocupa 491 520 × 40 B = 19,7 MB y se mapea en memoria.
- **Servir `b` bandas** es una sola lectura posicional de `fin[b−1]` bytes desde `offset`. Un retoque `[b0, b1)` lee desde `offset + fin[b0−1]`.
- **Atomicidad.** Primero se anexan los bytes y después la entrada del índice: la entrada es el *commit*. Tras una caída:
  - se trunca cada `.pinc` al máximo `offset + fin[3]` indexado;
  - si `meta.json` no dice `LISTA`, se repite la pasada (la edición 1 sigue servible).

### 7.3 Visibilidad

- **Catálogo.** `OBRA` se empuja a todas las sesiones en cada cambio: `ALTA`, `ESTADO` (progreso cada 1 %), `EDICION`, `BAJA`. El catálogo es pequeño.
- **Abrir durante `BOCETO` o `PINTANDO`.** `ABIERTA` con `edición = 1` y concesión con `estrato_min = 7`. El visor muestra el boceto, y la `MIRADA` no levanta el piso hasta `LISTA`.
- **Abrir durante `RECIBIENDO`** (aún sin boceto): `ERROR 5 OBRA_NO_LISTA`, no fatal.
- **Paso a `LISTA`.** `OBRA(EDICION)`. En cada lienzo abierto:
  - nueva `CONCESION` normal;
  - el Pintor vuelve a pintar el boceto en edición 2: mismos ids, entregas nuevas;
  - el cliente sustituye y suelta cada entrega de edición 1 con `SOLTAR REEMPLAZADA`.

  Un hijo solo se sintetiza sobre padres **de su misma edición**; el cliente lo comprueba.

### 7.4 Baja

1. `DELETE /seurat/v1/obras/{id}` → estado `RETIRADA`, y se empuja `OBRA(BAJA)`.
2. A cada lienzo abierto: `RASPAR TODO` → `RASPADO` confirmado → `ERROR 4 OBRA_INEXISTENTE` (no fatal). El handle queda inválido.
3. Los ficheros se borran cuando se cierra el último lienzo y vencen todos los libros que la referencian (`L + δ`). Un `REANUDAR` sobre una obra retirada se rechaza.

---

## 8. Modos de fallo

| Fallo | Detección | Comportamiento | Garantía |
|---|---|---|---|
| Desconexión del cliente | Temporizador de inactividad QUIC (30 s), 3 `LATIDO` sin `ECO` (45 s) o `CONNECTION_CLOSE`. | El caballete muere y sus libros se conservan `L + δ` (`δ = max(1 s, 2·RTT)`). Las entregas y renovaciones sin acuse pasan a `vence = t_desconexión + L + δ`. | La posesión de un cliente desaparecido está acotada por `L + δ`. Reanudar dentro de esa ventana no re-descarga nada. |
| Cambio de red (Wi-Fi → 4G) | La conexión muere: el servidor no migra conexiones. | `POST /sesion` + `SALUDO` con `REANUDAR`. Si el reclamo ⊆ libro no vencido, se adopta. La ficha sigue siendo válida hasta el primer `RECIBO` de la sesión nueva, así que un reintento tras perder la `BIENVENIDA` da el mismo resultado. | Igual que arriba; reanudación idempotente. |
| Entrega parcial | `RESET_STREAM` o pérdida de conexión antes del FIN. | El cliente la descarta: solo se aplica completa y verificada. El servidor la marca `CANCELADA`, la anuncia y, si aún se desea, la re-planifica con otro número. | Atomicidad por entrega. |
| Reinicio del servidor | — | Se pierden sesiones y libros (en memoria por diseño). `REANUDAR` → `ERROR 12` y el cliente vacía el lienzo. En el almacén se truncan los `.pinc` al índice; una obra no `LISTA` se re-ingesta (la edición 1 sigue). | El almacén es duradero y verificado por CRC; no se persiste estado de sesión. |
| Banda corrupta en disco | El Pintor verifica el CRC-32C al leer (instrucción de CPU, GB/s) o llega `SOLTAR CRC`. | Se sirve el prefijo de bandas válidas, se alerta al operador y se repara re-ingestando la región si se conserva el máster. | **Una banda perdida es un área menos densa, no un agujero.** |
| Trama C→S inválida | *Parser*. | `ERROR 1` fatal y cierre (`CONNECTION_CLOSE` con error de aplicación / WebSocket 1002). | Tolerancia cero: a un par malformado no se le confía posesión. |
| UDP bloqueado | WebTransport no está listo en 3 s. | Mapeo WebSocket. | Misma semántica; se acepta el bloqueo de cabeza de línea. |
| Cliente que miente (`RECIBO`/`RASPADO`/`INVENTARIO` falsos) | Comparación exacta y presupuesto. | No obtiene más de lo que permiten la concesión y el presupuesto. Una incoherencia es fatal. | El futuro lo controla el Pintor. |
| Relojes desincronizados | — | Nada depende del reloj de pared. Los arriendos son duraciones locales medidas con relojes monótonos, y el servidor añade `δ`. | Orden de eventos, no hora del día. |

**Arriendos sin relojes compartidos.**

- **Cliente.** Fija `vence_cli = t_recepción + L` al completar una entrega o recibir un `RENOVAR` que la incluya.
- **Servidor.** Fija `vence_srv = t_acuse + L + δ`, donde `t_acuse` es la llegada del `RECIBO` que acusa la entrega o del que trae `renov_hasta ≥ orden`.
- **Por qué es seguro.** Por causalidad, el cliente recibió la concesión antes de que el servidor recibiera su acuse, luego `vence_cli ≤ vence_srv − δ`. El margen `δ` absorbe la deriva de frecuencia entre relojes (`|deriva| · L ≪ 1 s`). Para lo concedido sin acuse al desconectarse, el cliente lo recibió como tarde en `t_desconexión + retardo`, que es `≤ t_desconexión + δ`.

**Invariantes:**

1. Ningún flujo viola la concesión vigente en el instante en que se abre.
2. El libro es cerrado por ancestros y monótono (`bandas(padre) ≥ bandas(hijo)`) en todo instante. Lo mantienen:
   - las pasadas del planificador;
   - el desalojo por hojas;
   - los predicados de `RASPAR`: `ESTRATO_BAJO` quita estratos por abajo; `FUERA` quita padres solo si tampoco intersecan sus hijos; `BANDAS` solo actúa en `estrato_min`, donde no hay hijos;
   - la caducidad: una pincelada vence con su padre, `vence_efectivo = min(vence, vence_efectivo(padre))`.
3. Lo que posee el cliente ⊆ libro del servidor, también tras una desconexión y hasta el vencimiento.
4. Toda entrega `≤ N` está liquidada antes de `RASPADO` o `INVENTARIO`; la comparación es de igualdad exacta, o fatal.
5. Toda entrega de `s ≤ 1` pasó por el presupuesto y el mapa de cobertura antes de abrir su flujo.
6. Las pinceladas son inmutables dentro de una edición, y su CRC se verifica de extremo a extremo.
7. Un cliente conforme nunca pinta una entrega vencida.

---

## 9. Modelo de amenazas: "nunca calidad completa"

### 9.1 Por qué es exigible por construcción

1. **El máster no está en el almacén.** El estrato 0 es con pérdida (qY 6, croma sin refinar). Un cliente con todas las pinceladas de todos los estratos tiene ≈ 38 dB y color 4:2:0, no los bytes del máster.
2. **Los techos por rol son máscaras anidadas.** El orden de los padres en las bandas es fijo por pincelada e igual para todos. La unión de lo que obtienen varios roles nunca supera al rol más alto: coludir una cuenta anónima con una autenticada no añade nada sobre el techo autenticado.
3. **Salida única.** El único código que escribe puntos en la red es el Pintor, que comprueba concesión, libro y presupuesto antes de cada flujo.
4. **No existe "dame X".** El cliente nunca nombra una pincelada. Los planes se derivan de `MIRADA` y se recortan con la concesión: pedir fuera del cono es imposible, no solo prohibido.
5. **Presupuesto de pincel.** Acota la cobertura total de los estratos finos por principal y obra, a través de sesiones y aunque se mienta sobre la posesión.

### 9.2 Ataques y defensas

| Ataque | Defensa | Riesgo residual |
|---|---|---|
| **Barrido**: un script envía `MIRADA`s que recorren toda la imagen a 1:1 para reconstruir el estrato 0. | `PresupuestoDePincel` por (principal, obra), en bandas: <br>• autenticado, s0: capacidad 20 000 bandas, recarga 10 bandas/s y tope total del 15 % de las pinceladas de E0; <br>• anónimo, s1: 1 000 bandas, 1/s, tope 25 % de E1. <br>El mapa de cobertura hace gratis re-entregar bandas ya cubiertas, así que acercar y alejar no cobra dos veces. Con la cubeta vacía, el área nueva se sirve en `s + 1` (`regulación = PRESUPUESTO`). | Barrer el 15 % de E0 lleva ≥ 3,5 h y ahí se detiene. |
| Ignorar `RASPAR` y arriendos (cliente modificado). | No recibe nada nuevo fuera de la concesión. El presupuesto acota la acumulación y las auditorías detectan la incoherencia, lo que es fatal. | Conserva lo que ya recibió: un arriendo no borra memoria ajena. |
| Colusión entre roles. | Máscaras anidadas. | Igual al rol más alto. |
| Colusión entre cuentas del mismo rol. | Presupuesto por principal, más tope global por obra y rol (p. ej. 30 % de E0 en 24 h sumando todos los principales anónimos) y alertas de auditoría. | N cuentas ≈ N × presupuesto, hasta el tope global. |
| `RECIBO`/`RASPADO`/`INVENTARIO` falsos. | Comparación exacta. Declarar menos posesión libera `libre`, pero lo nuevo sigue pagando concesión y presupuesto. | Nada más allá del presupuesto. |
| Reutilizar el token; 0-RTT. | Token de un solo uso (120 s); 0-RTT desactivado. | — |
| Secuestro de la sesión desde otra web (CSWSH). | `origin` en el CONNECT y `Origin` en el Upgrade WebSocket. El token solo va en `SALUDO`. | — |
| Robo de la reanudación. | Ficha de 32 B, rotada en cada reanudación y ligada al principal: reanudar exige autenticarse como el mismo principal. Además, el reclamo ⊆ libro no vencido. | — |
| Denegación de servicio. | Cubeta de `MIRADA`. El servidor concede al cliente 1 flujo bidireccional y 0 unidireccionales (`MAX_STREAMS`). Límite de datagramas. Flujos estancados cortados a los 30 s. Cola de entrada de 256 tramas por sesión. Tramas ≤ 64 KiB. Sin token no se crea estado. | — |
| Amplificación. | El servidor envía mucho más de lo que recibe por diseño, acotado por concesión, presupuesto y tasa por sesión (§6.1). | — |

### 9.3 Lo que no se promete

- **Marca de agua por usuario**: las pinceladas son inmutables y compartidas; es el precio de no calcular nada por cliente.
- **Capturas de pantalla**: un usuario legítimo puede capturar lo que ve. El protocolo limita lo que se entrega, no lo que se muestra.
- **Borrado remoto**: los arriendos no borran nada en un cliente malicioso. Acotan la posesión de los clientes conformes y hacen honesta la contabilidad del servidor.
- **Atacante paciente con muchas cuentas**: el presupuesto detiene barridos, no a ese atacante, que solo está acotado por el tope global.

---

## 10. Esbozo de implementación en Java

Pila:

- **Java 21** con hilos virtuales.
- **Kwik + Flupke** (QUIC, HTTP/3, WebTransport) para UDP. El soporte de WebTransport de Flupke es experimental (Anexo B).
- **Jetty 12** para TCP: estático, `POST /sesion`, `PUT`/`DELETE` de obras y el mapeo WebSocket.
- `java.util.zip.Deflater(nivel, nowrap = true)` para *deflate* crudo, compatible con `DecompressionStream('deflate-raw')`, y `java.util.zip.CRC32C`.
- **TwelveMonkeys ImageIO** (TIFF/BigTIFF) y **Bio-Formats** para la ingesta.
- Sin base de datos.

```java
public final class SeuratServer {
    public static void main(String[] args) throws Exception {
        var cfg         = Config.cargar(Path.of("seurat.conf"));
        var catalogo    = Catalogo.cargar(cfg.obras());
        var presupuesto = new PresupuestoDePincel(cfg.cobertura());
        var regulador   = new Regulador();
        var pintor      = new Pintor(cfg.ranurasGlobales(), regulador, presupuesto);     // 512 ranuras
        var controlador = new ControladorDeConcesion(catalogo, pintor);
        var sesiones    = new Sesiones(catalogo, pintor, controlador);
        Thread.ofPlatform().name("pintor").start(pintor);                                // único punto de salida de puntos
        Thread.ofVirtual().start(new Ingestor(cfg.inbox(), catalogo));
        var reloj = Executors.newSingleThreadScheduledExecutor();
        reloj.scheduleAtFixedRate(() -> regulador.tic(sesiones.todas()), 250, 250, MILLISECONDS);
        reloj.scheduleAtFixedRate(controlador::renovarAuditarYVencer, 1, 1, SECONDS);
        new MapeoWebTransport.Servidor(cfg, sesiones).iniciar();                         // Kwik/Flupke, UDP 443
        new MapeoWebSocket.Servidor(cfg, sesiones).iniciar();                            // Jetty 12, TCP 443
    }
}

/** Un mapeo lleva la semántica de Seurat/1 a un transporte concreto (§3.1). */
sealed interface Mapeo permits MapeoWebTransport, MapeoWebSocket {
    OutputStream abrirEntrega(Lienzo l, Entrega e) throws IOException;  // WT: flujo uni del servidor · WS: mensaje, canal 1
    void enviarControl(ByteBuffer trama);                              // WT: flujo bidi del cliente · WS: canal 0
    void cancelar(Entrega e);                                          // WT: RESET_STREAM · WS: solo si no empezó
}

record PinceladaId(int s, int bx, int by) {                            // 8 bits de estrato · 56 bits de Morton
    long id()           { return ((long) s << 56) | Morton.codificar(bx, by); }
    PinceladaId padre() { return new PinceladaId(s + 1, bx >> 1, by >> 1); }
}

record Concesion(int epoca, int estratoMin, int bandasMax, int maxPinceladas, int maxKib, Duration arriendo) {
    boolean permite(PinceladaId p, int hasta) {
        return p.s() > estratoMin || (p.s() == estratoMin && hasta <= bandasMax);
    }
}

record Entrega(long numero, PinceladaId p, int desde, int hasta, int bytes, int epoca) {}

/** Modelo autoritativo de lo prestado a un lienzo. Lo tocan su caballete y el Pintor, bajo el cerrojo del lienzo. */
final class LibroDePrestamos {
    private final TreeMap<Long, Entrega> entregas = new TreeMap<>();
    private final Map<PinceladaId, TreeMap<Integer, Entrega>> porPincelada = new HashMap<>();  // desde → entrega
    private final Map<Long, Long> venceNs = new HashMap<>();
    private long ultimo;

    long ultimoNumero() { return ultimo; }
    int bandas(PinceladaId p) {                                        // la semilla cuenta como completa
        if (p.s() == 10) return 4;
        var m = porPincelada.get(p);
        return m == null ? 0 : m.lastEntry().getValue().hasta();
    }
    Entrega anotar(PinceladaId p, int desde, int hasta, int bytes, int epoca) {   // ANTES de abrir el flujo
        var e = new Entrega(++ultimo, p, desde, hasta, bytes, epoca);
        entregas.put(e.numero(), e);
        porPincelada.computeIfAbsent(p, k -> new TreeMap<>()).put(desde, e);
        return e;
    }
    void acusar(Rangos r, long ahoraNs, long arriendoNs, long deltaNs) {
        r.forEach(n -> venceNs.put(n, ahoraNs + arriendoNs + deltaNs));   // vence_srv = t_acuse + L + δ
    }
    void soltar(Rangos r) { r.forEach(this::quitar); }

    /** libro ∩ [1, hasta] \ predicado \ canceladas: lo que el cliente DEBE conservar (§4.2). */
    Rangos esperado(long hasta, Predicate<Entrega> raspar, Rangos canceladas) {
        var c = new Rangos.Constructor();
        for (var e : entregas.headMap(hasta, true).values())
            if (!raspar.test(e) && !canceladas.contiene(e.numero())) c.agregar(e.numero());
        return c.construir();
    }
    void quitar(long n) {
        var e = entregas.remove(n);
        if (e == null) return;
        venceNs.remove(n);
        var m = porPincelada.get(e.p());
        m.remove(e.desde());
        if (m.isEmpty()) porPincelada.remove(e.p());
    }
}

/** Único punto por el que salen puntos del servidor (§4.1). */
final class Pintor implements Runnable {
    private final PriorityBlockingQueue<Pendiente> cola =                 // clase efectiva, pasada, paso_i (§6.2)
            new PriorityBlockingQueue<>(4096, Pendiente.ORDEN);
    private final Semaphore ranurasGlobales;
    private final Regulador regulador;
    private final PresupuestoDePincel presupuesto;

    public void run() {
        for (;;) {
            Pendiente x = tomar();                                        // bloquea hasta que haya trabajo
            Lienzo l = x.lienzo();
            synchronized (l) {                                            // atómico frente a ControladorDeConcesion.reducir
                Concesion c = l.concesion();
                var libro = l.libro();
                if (!c.permite(x.p(), x.hasta()) || libro.bandas(x.p().padre()) < x.hasta())
                    continue;                                             // (a)(b): se planificó con un estado viejo
                if (!l.cabe(x) || !x.sesion().ranuraLibre() || !ranurasGlobales.tryAcquire()) {
                    aparcar(x); continue;                                 // (c)(e): espera a RECIBO, SOLTAR o ranura
                }
                if (x.p().s() <= 1 && !presupuesto.consumir(x.sesion().principal(), l.obra(), x.p(), x.desde(), x.hasta())) {
                    ranurasGlobales.release();
                    l.recortar(Regulacion.PRESUPUESTO); continue;         // (d): recorte de entrega, no revocación
                }
                regulador.alEmpezar(x.sesion(), System.nanoTime() - x.listaNs());   // estancia → CoDel
                var e = libro.anotar(x.p(), x.desde(), x.hasta(),
                                     l.almacen().bytes(x.p(), x.desde(), x.hasta()), c.epoca());
                x.sesion().ocuparRanura();
                Thread.ofVirtual().start(() -> pintar(l, e));
            }
        }
    }

    private void pintar(Lienzo l, Entrega e) {
        var s = l.sesion();
        try (var out = s.mapeo().abrirEntrega(l, e)) {
            out.write(Cabecera.pincelada(l, e));                          // tipo, handle, entrega, id, bandas, época, q, edición, crc, largos
            l.almacen().copiar(e.p(), e.desde(), e.hasta(), out);          // lectura posicional; CRC-32C verificado al leer
        } catch (IOException | Cancelada ex) {
            l.cancelada(e.numero());                                      // → PLAN CANCELADAS; el plan decide si re-planifica
        } finally {
            s.liberarRanura();
            ranurasGlobales.release();
        }
    }
}

final class ControladorDeConcesion {
    /** Reducción atómica y sin barrera: época nueva, N, purga, y CONCESION → PLAN CANCELADAS → RASPAR (§4.2). */
    void reducir(Lienzo l, Concesion nueva, Predicate<Entrega> raspar, Predicado cable) {
        synchronized (l) {
            l.fijarConcesion(nueva);                                     // todo flujo que se abra desde ahora pasa el chequeo nuevo
            long n = l.libro().ultimoNumero();
            Rangos canceladas = pintor.purgar(l, nueva);                  // cola: fuera · en vuelo: RESET_STREAM
            l.enviar(Tramas.concesion(l, nueva));
            if (!canceladas.vacio()) l.enviar(Tramas.planCanceladas(l, canceladas));
            int orden = l.siguienteOrden();
            l.enviar(Tramas.raspar(l, orden, nueva.epoca(), n, cable));
            l.pendiente(new OrdenRaspado(orden, n, raspar, canceladas, System.nanoTime() + SECONDS.toNanos(10)));
        }
    }
    /** RASPADO: igualdad exacta de conjuntos o ERROR 7 (fatal). */
    void confirmar(Lienzo l, Raspado r) {
        synchronized (l) {
            var o = l.pendiente(r.orden());
            var esperado = l.libro().esperado(o.hasta(), o.raspar(), o.canceladas());
            if (!esperado.equals(r.conservadas())) throw new ErrorFatal(7, "POSESION_DISCREPANTE");
            l.libro().quitarSalvo(o.hasta(), r.conservadas());
            l.resuelta(o);
        }
    }
}

final class Caballete {                                                  // un hilo virtual por sesión
    void bucleDeEntrada() throws IOException {
        var in = new DataInputStream(control.getInputStream());
        leerSaludo(in);                                                   // token de un solo uso; REANUDAR opcional
        for (;;) {
            var t = Trama.leer(in, 64 * 1024);                            // vi tipo · vi largo · payload
            switch (t.tipo()) {
                case MIRADA     -> lienzo(t).mirada(Mirada.leer(t));      // también llega por datagrama (gana la última)
                case RECIBO     -> lienzo(t).recibo(Recibo.leer(t));      // vencimientos, libre, cola_ms, renov_hasta
                case SOLTAR     -> lienzo(t).libro().soltar(Soltar.leer(t).rangos());
                case RASPADO    -> controlador.confirmar(lienzo(t), Raspado.leer(t));
                case INVENTARIO -> controlador.auditar(lienzo(t), Inventario.leer(t));
                case ABRIR      -> abrir(t);
                case CERRAR     -> cerrar(t);
                case ECO        -> latido.eco(t);
                case ADIOS      -> { cerrarOrdenado(); return; }
                default         -> { if (t.tipo() < 0x40) throw new ErrorFatal(1, "tipo obligatorio desconocido"); }
            }
        }
    }
}

/** CoDel sobre la cola del Pintor + respuesta DCTCP por sesión (§6.3). */
final class Regulador {
    static final long OBJETIVO_NS = 25_000_000;
    private long minEstancia = Long.MAX_VALUE;
    private volatile boolean congestionado;

    synchronized void alEmpezar(Sesion s, long estanciaNs) {
        minEstancia = Math.min(minEstancia, estanciaNs);
        s.entregasTic++;
        if (congestionado) s.marcadasTic++;
    }
    synchronized void tic(Collection<Sesion> sesiones) {                   // cada 250 ms
        congestionado = minEstancia != Long.MAX_VALUE && minEstancia > OBJETIVO_NS;
        minEstancia = Long.MAX_VALUE;
        for (var s : sesiones) {
            double f = s.entregasTic == 0 ? 0 : (double) s.marcadasTic / s.entregasTic;
            s.alfa = (1 - 1.0 / 16) * s.alfa + f / 16;
            s.e = f > 0 ? Math.max(0.125, s.e * (1 - s.alfa / 2)) : Math.min(1.0, s.e + 1.0 / 32);
            s.entregasTic = s.marcadasTic = 0;
        }
    }
}

final class PresupuestoDePincel {
    boolean consumir(Principal pr, Obra o, PinceladaId p, int desde, int hasta) {
        var cob = cobertura(pr, o);                                      // mmap: 4 bits por pincelada de E0 y E1
        int nuevas = Math.max(0, hasta - Math.max(desde, cob.get(p)));
        if (nuevas == 0) return true;                                     // re-entregar lo ya cubierto es gratis
        if (cob.fraccion(p.s()) >= tope(pr.rol(), p.s()) || !cubeta(pr, o, p.s()).tomar(nuevas)) return false;
        cob.set(p, hasta);
        return true;
    }
}

final class IngestJob implements Runnable {
    public void run() {
        try (var maestro = Maestro.abrir(ruta)) {                        // TwelveMonkeys / Bio-Formats, bandas de 256 filas
            maestro.visionGeneral().ifPresent(v -> almacen.escribirBoceto(v, 1));      // edición 1 (§7.1)
            for (var banda : maestro) {                                   // una sola pasada secuencial
                empujar(0, YCoCgR.directa(banda));
                catalogo.progreso(id, maestro.fraccion());
            }
            vaciarBandasParciales();                                      // bordes; el estrato 9 produce la semilla
            almacen.cerrar(2);                                            // índices + meta.json con fsync → edición 2
            catalogo.lista(id);                                           // OBRA(EDICION, LISTA)
        }
    }
    private void empujar(int s, Filas f) {
        if (!acumuladores[s].agregar(f)) return;                          // aún no hay 256 filas
        var t = TransformadaS.directa(acumuladores[s].vaciar());         // padres + (H, V, D)
        pool.submit(() -> almacen.anexar(s, Pincelada.codificar(t, qtab[s])));   // S+P con padres verdaderos, bandas, deflate
        if (s + 1 < top) empujar(s + 1, t.padres()); else semilla.agregar(t.padres());
    }
}
```

| Hilo | Cantidad | Trabajo |
|---|---|---|
| Kwik: E/S UDP | 1–2 por puerto | Paquetes QUIC: acuses, retransmisión, control de congestión. |
| Caballete (virtual) | 1 por sesión | Lee el flujo de control. Es el único escritor del estado de su sesión. |
| Datagramas (virtual) | 1 por sesión | `MIRADA`: la última gana (`AtomicReference`) → planificador. |
| Pintor (plataforma) | 1 | Elige y comprueba; no hace E/S. |
| Entregas (virtuales) | ≤ 512 simultáneas | Abre el flujo, lee del disco (posicional), escribe y cierra con FIN. |
| Temporizadores | 1 (`ScheduledExecutor`) | `RENOVAR` cada 60 s, `AUDITAR`, plazos de 10 s, vencimientos, inactividad, `LATIDO`. |
| Regulador | tic de 250 ms | CoDel + DCTCP. |
| Ingesta | 1 lector + *pool* de N − 1 núcleos | Pasada del máster y codificación de pinceladas. |
| Jetty | *pool* propio | HTTPS/TCP: estático, `POST /sesion`, WebSocket de respaldo. |

---

## Anexo A. Trazabilidad con el temario

| Mecanismo de Seurat/1 | Concepto | Tema |
|---|---|---|
| CRC-32C calculado en la ingesta y verificado en el visor | Argumento extremo a extremo | l01 / p01 |
| Libro de préstamos que sobrevive a la conexión | *Fate-sharing* (y cuándo romperlo a propósito) | l01 / p01 |
| `max_en_vuelo = λ·R`; ventanas QUIC ≥ BDP | Ley de Little; producto ancho de banda × retardo | l01 / p05 |
| Una semántica, dos mapeos (WebTransport y WebSocket) | Semántica vs. mapeo (RFC 9110 vs. 9112/9113/9114) | l01 / l02 |
| Un flujo QUIC por pincelada; `MIRADA` por datagrama | HTTP/3 y QUIC: sin bloqueo de cabeza de línea entre flujos | l02 / p02 |
| Sin 0-RTT; token de un solo uso | 0-RTT, repetición e idempotencia | l02 / p02 |
| `REANUDAR` en la aplicación | Migración de conexión QUIC (y qué hacer sin ella) | l02 / p02 |
| `edición` en cada pincelada | ETag y validación de cachés | l02 / p02 |
| Arriendos con `δ` y relojes monótonos | NTP; no depender del reloj de pared | l03 / p03 |
| `RENOVAR` y caducidad | TTL de DNS y CDN | l03 / p03 |
| `cola_ms` medida por el cliente | ABR basado en búfer: medir directamente en vez de inferir | l03 / p03 |
| Tipos obligatorios / opcionales, cola TLV, números nunca reutilizados | Entramado y extensibilidad (TLV) | l04 / p04 |
| Varints QUIC en cabeceras, LEB128 en los datos | Enteros de longitud variable | l04 / p04 |
| Ficha de reanudación como clave de idempotencia | Reintentos seguros, claves de idempotencia | l04 / p04 |
| Un hilo virtual por sesión + un Pintor sin E/S | Modelos de concurrencia del servidor (bucle de eventos vs. hilos) | l04 / p04 |
| Rangos en `RECIBO`, `SOLTAR`, `RENOVAR`, `RASPADO` | SACK y rangos de ACK | p05 |
| Cancelación selectiva por flujo | *Selective repeat* vs. *go-back-N* | p05 |
| `libre` | Ventana del receptor (`rwnd`) | p05 |
| Sin estado de sesión antes de un `SALUDO` con token válido | SYN cookies: no crear estado antes de validar | p05 |
| Max-min por nitidez, *stride* por bytes | Equidad max-min, llenado progresivo, WFQ | p06 |
| `e_i` con incremento aditivo y decremento multiplicativo | AIMD y convergencia de Chiu–Jain | p06 |
| CoDel sobre la cola del Pintor | *Bufferbloat* y AQM por tiempo de estancia | p06 |
| Marcas + `α_i` | ECN y DCTCP | p06 |
| Índice de Jain en las pruebas de carga | Medición de la equidad | p06 |

## Anexo B. Riesgos de implementación y decisiones abiertas

| Riesgo | Impacto | Mitigación |
|---|---|---|
| WebTransport en Java: Flupke/Kwik lo soportan de forma experimental, y navegadores y servidor implementan borradores distintos. | Sin mapeo principal. | Hito 0: prueba de interoperabilidad con Chrome, Firefox y Safari. El mapeo WebSocket es **obligatorio y completo**, no un parche: el sistema funciona entero sin UDP. |
| Redes que bloquean UDP. | Sin WebTransport. | Respaldo WebSocket automático a los 3 s. |
| Coste de la primera vista (§2.4): ≈ 3× en bytes en el peor caso. | Arranque más lento en redes pobres. | Pasada de esbozo (foco visible con 0,9 MB). Tabla de cuantización por obra (A2 ahorra un 15 % en E2 por 0,25 dB). Codificador de entropía mejor como trabajo futuro. |
| Códec propio (redondeos, bordes, pinceladas parciales). | Imágenes corruptas sutiles. | Vectores de prueba bit a bit generados por la implementación de referencia y compartidos por Java y JS. CRC por banda. |
| Sin migración de conexión en el servidor. | Cortes al cambiar de red. | `REANUDAR` (§3.4.4, §8). |
| Síntesis en el cliente. | CPU en equipos modestos. | Worker dedicado. `cola_ms` regula la entrega (§6.1). La S inversa son sumas y desplazamientos. |
| Umbrales del presupuesto de pincel. | Demasiado laxos (barridos) o estrictos (usuarios legítimos). | Parámetros por obra y rol; alertas de auditoría; cobertura persistente para ajustar con datos reales. |
