# Fotos en la carga masiva — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que la planilla de carga masiva cargue fotos de producto desde dos columnas nuevas: `img` (foto pegada en el Excel) y `link-img` (link que se descarga), revisadas en la vista previa.

**Architecture:** al subir el Excel se sacan las fotos pegadas (abriendo el `.xlsx` como zip) y se descargan las de los links con una descarga protegida contra direcciones internas. Las fotos de cada fila se asignan al producto, sin repetir, con una huella SHA-256. Todo se guarda en una carpeta pendiente junto al Excel. Al confirmar, se escriben los archivos y la transacción crea las filas de `producto_fotos`.

**Tech Stack:** Node 24 (ESM, `node:sqlite`, `node:test`), Express 5, multer, read-excel-file, write-excel-file y `fflate` (nueva dependencia directa).

**Spec:** `docs/superpowers/specs/2026-11-16-fotos-carga-masiva-design.md`

## Global Constraints

- Títulos exactos de las columnas: `img` y `link-img`. Alias: `imagen` y `foto` → `img`; `link imagen`, `link foto` y `url imagen` → `link-img`.
- Si están las dos, gana `img`. Si una está vacía, se usa la otra.
- Tope por producto: `MAX_FOTOS` (10, de `src/productos.js`). Tope por foto: `TAMANO_MAXIMO_IMAGEN` (5 MB, de `src/imagenes.js`). Tipos aceptados: los que devuelve `tipoDeImagen` (jpg, png y webp).
- El Excel puede pesar hasta **30 MB**. Hasta **200** links distintos por planilla. Descargas: tiempo máximo de **15 s** por foto, hasta **3** redirecciones y **4** a la vez.
- Solo `http:` y `https:`. Se rechazan las direcciones no públicas, también las que aparecen después de una redirección.
- Si hay un solo problema, no se guarda nada, fotos incluidas.
- La única dependencia nueva es `fflate@^0.8.3`, que ya está en `node_modules` porque la usa `read-excel-file`.
- Los textos visibles van en español rioplatense (voseo), como el resto del panel.
- Tests: `npm test`. Se trabaja en la rama `fotos-carga-masiva`, con un commit por tarea.

## Review Focus

1. **Excel reales:** los archivos de Excel 365 ("Colocar en celda"), Google Sheets y LibreOffice pueden traer las rutas de los `Target` absolutas (`/xl/media/...`) y prefijos de namespace distintos. El parser tiene que encontrar la foto igual. Test en la Tarea 3: rels con `Target` absoluto. Después de terminar, hay que probarlo a mano con un Excel real.
2. **Links que llevan a direcciones internas:** un nombre que resuelve a `127.0.0.1`, una IP escrita directo en el link, o una redirección hacia una IP privada. Se rechazan todos sin conectarse. Tests en la Tarea 4.
3. **La misma foto en varias filas, en dos productos o en una segunda subida:** no se duplica dentro de un producto. Cada producto tiene su propio archivo, así que borrar una foto no rompe la del otro. Tests en las Tareas 5, 6 y 7.
4. **Un link de Drive sin compartir devuelve una página HTML:** tiene que dar el error "no lleva a una foto JPG, PNG o WEBP", no un error genérico. Test en la Tarea 4.
5. **Vistas previas abandonadas:** subir otro archivo borra la carpeta pendiente anterior, y una sesión que trae el formato viejo (`{ archivo }`) se trata como "no hay importación pendiente", sin romper. Tests en la Tarea 7.

---

### Task 1: Huella de las fotos

**Files:**
- Create: `src/migraciones/005_huellas_fotos.sql`, `src/importacion/fotos.js`, `test/fotos.test.js`
- Modify: `src/imagenes.js`, `src/productos.js:343-348` (`agregarFoto`), `src/rutas/admin-tienda.js:165-176`, `test/ayudantes.js`, `test/gestion.test.js:15-18`

**Interfaces:**
- Produces: `huellaDe(buffer: Buffer): string` (sha256 en hex) en `src/imagenes.js`. `agregarFoto(db, tiendaId, productoId, archivo, huella = null)`. `completarHuellas(db, dirSubidas, tiendaId): Promise<void>` en `src/importacion/fotos.js`. En `test/ayudantes.js`: `PNG` (se mueve desde `gestion.test.js`) y `otraFoto(n: number): Buffer` = `Buffer.concat([PNG, Buffer.from([n])])`, que sigue siendo PNG pero tiene otra huella.

- [ ] **Step 0: Crear la rama.** `git checkout -b fotos-carga-masiva`

- [ ] **Step 1: Write the failing tests**

En `test/fotos.test.js`:
```js
test('completarHuellas calcula la huella de las fotos viejas y saltea las que no tienen archivo', async () => {
  const db = abrirBase(':memory:');
  const tiendaId = crearTiendaVacia(db, 'huellas');
  const dir = mkdtempSync(path.join(tmpdir(), 'subidas-'));
  const productoId = Number(db.prepare("INSERT INTO productos (tienda_id, slug, nombre) VALUES (?, 'p', 'P')").run(tiendaId).lastInsertRowid);
  mkdirSync(path.join(dir, String(tiendaId)));
  writeFileSync(path.join(dir, String(tiendaId), 'vieja.png'), PNG);
  agregarFoto(db, tiendaId, productoId, 'vieja.png');
  agregarFoto(db, tiendaId, productoId, 'perdida.png');

  await completarHuellas(db, dir, tiendaId);

  assert.deepEqual(
    db.prepare('SELECT archivo, huella FROM producto_fotos ORDER BY id').all().map((f) => ({ ...f })),
    [{ archivo: 'vieja.png', huella: huellaDe(PNG) }, { archivo: 'perdida.png', huella: null }],
  );
});
```
En el test `'fotos: subir varias, …'` de `test/gestion.test.js`, después de la subida:
```js
assert.deepEqual(db.prepare('SELECT huella FROM producto_fotos').all().map((f) => f.huella), [huellaDe(PNG), huellaDe(PNG)]);
```

- [ ] **Step 2: Run** `node --test test/fotos.test.js test/gestion.test.js`. Expected: FAIL (`huellaDe`/`completarHuellas` no existen).

- [ ] **Step 3: Implementar.**
  - Migración `005_huellas_fotos.sql`: `ALTER TABLE producto_fotos ADD COLUMN huella TEXT;` y `CREATE INDEX fotos_por_huella ON producto_fotos (producto_id, huella);`.
  - `completarHuellas`: lee las filas de esa tienda con `huella IS NULL`, lee cada archivo de `<dirSubidas>/<tiendaId>/<archivo>` y guarda la huella. Si el archivo no existe, la deja en NULL.
  - En la subida desde el editor (`admin-tienda.js`), guardar `{ archivo, huella }` y pasar la huella a `agregarFoto`. El editor sigue aceptando fotos repetidas, como hoy.

- [ ] **Step 4: Run** `npm test`. Expected: todo PASS.

- [ ] **Step 5: Commit** `git commit -m "Huella SHA-256 de las fotos de producto"` (más los archivos tocados).

---

### Task 2: Columnas `img` y `link-img` en la planilla

**Files:**
- Modify: `src/importacion/interpretar.js`, `src/importacion/plantilla.js`, `test/interpretar.test.js`

**Interfaces:**
- Produces: `COLUMNAS` termina en `…, visible, { clave: 'img', titulo: 'img', alias: ['imagen', 'foto'] }, { clave: 'linkImg', titulo: 'link-img', alias: ['link imagen', 'link foto', 'url imagen'] }`. Cada variante que devuelve `interpretarHoja` suma `link: string|null` y `textoImg: string|null` (con `textoCelda`). `interpretarHoja` devuelve `{ productos, errores, columnaImg: number|null }`, donde `columnaImg` es el índice (base 0) de la columna `img`, o `null` si no está. También el retorno temprano por columnas obligatorias faltantes lleva `columnaImg: null`.

- [ ] **Step 1: Write the failing test.** En `test/interpretar.test.js`, sumar `link: null, textoImg: null` a `VACIO` y agregar:
```js
test('lee img y link-img (también por sus alias) y dice en qué columna está img', () => {
  const { productos, errores, columnaImg } = interpretarHoja([
    ['SKU', 'Nombre', 'Precio', 'Foto', 'Link imagen'],
    ['A', 'Uno', 100, null, ' https://ejemplo.com/a.jpg '],
    ['B', 'Dos', 100, 'texto', null],
  ]);
  assert.deepEqual(errores, []);
  assert.equal(columnaImg, 3);
  assert.deepEqual(productos.map((p) => [p.variantes[0].link, p.variantes[0].textoImg]), [
    ['https://ejemplo.com/a.jpg', null],
    [null, 'texto'],
  ]);
  assert.equal(interpretarHoja([['SKU', 'Nombre'], ['A', 'Uno']]).columnaImg, null);
});
```

- [ ] **Step 2: Run** `node --test test/interpretar.test.js`. Expected: FAIL.

- [ ] **Step 3: Implementar** las columnas y los campos. En `plantilla.js`: ancho 24 para `img`, 40 para `linkImg` y `descripcion`, y 18 para el resto. Sumar estas líneas a `INSTRUCCIONES`, justo después de la de "Peso y medidas":
```js
'img: pegá la foto adentro de la celda. En Excel: Insertar > Imágenes > Colocar en celda. También sirve pegarla encima de la celda.',
'link-img: el link de la foto (JPG, PNG o WEBP). Sirven los links de Google Drive compartidos con "Cualquier persona con el enlace" y los de Dropbox.',
'   Si completás las dos, se usa la foto de img. Si una está vacía, se usa la otra.',
'   Las fotos de todas las filas de un producto se suman a ese producto. La de la primera fila es la principal.',
'   Cada producto puede tener hasta 10 fotos de hasta 5 MB. Si volvés a subir la planilla, las fotos no se duplican.',
```

- [ ] **Step 4: Run** `npm test`. Expected: PASS. El test de la plantilla en `admin.test.js` ya compara contra `COLUMNAS`.

- [ ] **Step 5: Commit** `git commit -m "Plantilla: columnas img y link-img"`

---

### Task 3: Leer las fotos pegadas en el Excel

**Files:**
- Create: `src/importacion/fotos-excel.js`, `test/fotos-excel.test.js`
- Modify: `package.json` (`npm install fflate@0.8.3`), `test/ayudantes.js`

**Interfaces:**
- Produces: `leerFotosExcel(buffer: Buffer): Array<{ fila: number, columna: number, contenido: Buffer }>`. Es sincrónica. `fila` va en base 1, como en `interpretarHoja`, y `columna` en base 0. Viene ordenada por fila, después por columna, y dentro de la misma celda de izquierda a derecha. Si no hay fotos, devuelve `[]`. En `test/ayudantes.js`: `conFotoEnCelda(xlsx: Buffer, referencia: string, contenido: Buffer, { targetAbsoluto = false } = {}): Buffer`. Con `targetAbsoluto`, el `.rels` de `richValueRel` apunta a `/xl/media/foto-en-celda.png` en vez de `../media/foto-en-celda.png`.

Cómo se ubica cada foto (solo la primera hoja, igual que `readSheet`):
- **Hoja:** el primer `<sheet r:id>` de `xl/workbook.xml` se busca en `xl/_rels/workbook.xml.rels`. Los `Target` pueden ser relativos a la carpeta del `.rels` o absolutos (empiezan con `/`).
- **Flotantes:** el `<drawing r:id>` de la hoja se busca en `xl/worksheets/_rels/<hoja>.rels`, y eso lleva al drawing. Cada `twoCellAnchor` u `oneCellAnchor` tiene `from/col`, `from/colOff` y `from/row` (base 0, así que `fila = row + 1`). Su `<pic>…<blip r:embed>` se busca en los rels del drawing y lleva al archivo en `xl/media`. Los `absoluteAnchor` y los grupos se ignoran.
- **En celda:** la celda `<c r="U2" vm="N">` usa `N` en base 1 sobre los `<bk>` de `<valueMetadata>` de `xl/metadata.xml`. El `rc@v` de ese `bk` (base 0) apunta al `<bk>` de `<futureMetadata name="XLRICHVALUE">`. Su `rvb@i` (base 0) apunta a un `<rv>` de `xl/richData/rdrichvalue.xml`. El `rv@s` indica la estructura en `xl/richData/rdrichvaluestructure.xml`, y la posición de la clave `_rvRel:LocalImageIdentifier` en esa estructura dice cuál `<v>` del `rv` usar. Ese valor es el índice del `<rel r:id>` en `xl/richData/richValueRel.xml`, que se busca en `xl/richData/_rels/richValueRel.xml.rels` y lleva al archivo en `xl/media`.
- **XML:** se lee con expresiones regulares que aceptan cualquier prefijo de namespace (`<(?:\w+:)?nombre`). No se suma un parser.

- [ ] **Step 1: Write the failing tests.** El helper `conFotoEnCelda` descomprime con `unzipSync`. Agrega `<c r="${referencia}" t="e" vm="1"><v>#VALUE!</v></c>` al final del `<row r="${fila}">` de `xl/worksheets/sheet1.xml`. Escribe `xl/media/foto-en-celda.png` y las cinco partes con un solo valor: `metadata.xml` (con `metadataType XLRICHVALUE`, `futureMetadata` con `rvb i="0"` y `valueMetadata` con `rc t="1" v="0"`), `rdrichvaluestructure.xml` (`<s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/></s>`), `rdrichvalue.xml` (`<rv s="0"><v>0</v><v>5</v></rv>`), `richValueRel.xml` (`<rel r:id="rId1"/>`) y su `.rels`, que apunta a `../media/foto-en-celda.png`. Vuelve a comprimir con `zipSync`.
```js
const hoja = [['SKU', 'Nombre', 'img'], ['A', 'Uno', null], ['B', 'Dos', null]];
const foto = (row, column, contenido, offsetX = 0) =>
  ({ content: contenido, contentType: 'image/png', width: 10, height: 10, dpi: 96, anchor: { row, column }, offsetX });

test('ubica una foto flotante en la celda de su esquina de arriba a la izquierda', async () => {
  const xlsx = await writeExcelFile(hoja, { images: [foto(3, 3, PNG)] }).toBuffer();
  assert.deepEqual(leerFotosExcel(xlsx), [{ fila: 3, columna: 2, contenido: PNG }]);
});

test('varias fotos flotantes en la misma celda vienen de izquierda a derecha', async () => {
  const xlsx = await writeExcelFile(hoja, { images: [foto(2, 3, otraFoto(2), 40), foto(2, 3, otraFoto(1), 0)] }).toBuffer();
  assert.deepEqual(leerFotosExcel(xlsx).map((f) => f.contenido), [otraFoto(1), otraFoto(2)]);
});

test('lee una foto colocada en la celda', async () => {
  const xlsx = conFotoEnCelda(await writeExcelFile(hoja).toBuffer(), 'C2', PNG);
  assert.deepEqual(leerFotosExcel(xlsx), [{ fila: 2, columna: 2, contenido: PNG }]);
});

test('acepta Target absolutos en los rels', async () => {
  const xlsx = conFotoEnCelda(await writeExcelFile(hoja).toBuffer(), 'C2', PNG, { targetAbsoluto: true });
  assert.deepEqual(leerFotosExcel(xlsx), [{ fila: 2, columna: 2, contenido: PNG }]);
});

test('un Excel sin fotos devuelve una lista vacía', async () => {
  assert.deepEqual(leerFotosExcel(await writeExcelFile(hoja).toBuffer()), []);
});
```
(Los `contenido` se comparan como `Buffer`: convertí los `Uint8Array` de fflate con `Buffer.from`.)

- [ ] **Step 2: Run** `node --test test/fotos-excel.test.js`. Expected: FAIL.
- [ ] **Step 3: Implementar** `leerFotosExcel` con `unzipSync` de `fflate`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Leer las fotos pegadas en el Excel"` (incluye `package.json` y `package-lock.json`).

---

### Task 4: Descargar fotos de links sin abrir la red interna

**Files:**
- Create: `src/importacion/descargar.js`, `test/descargar.test.js`

**Interfaces:**
- Produces:
  - `class ErrorDeDescarga extends Error`.
  - `linkDeDescarga(link: string): string`. Convierte `drive.google.com/file/d/<ID>/…` y `drive.google.com/open?id=<ID>` en `https://drive.google.com/uc?export=download&id=<ID>`, y en `dropbox.com` cambia o agrega `dl=1`. El resto queda igual.
  - `esDireccionPublica(ip: string): boolean`, armada con `net.BlockList`. Bloquea `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`, `192.168/16`, `198.18/15`, `224/3`, `::`, `::1`, `fc00::/7` y `fe80::/10`. Las `::ffff:a.b.c.d` se evalúan como IPv4.
  - `crearDescargador({ permitirDireccion = esDireccionPublica, tiempoMaximoMs = 15000, tamanoMaximo = TAMANO_MAXIMO_IMAGEN, maxRedirecciones = 3 } = {}): (link: string) => Promise<Buffer>`. Solo resuelve con una imagen que `tipoDeImagen` acepta.
- Mensajes exactos de `ErrorDeDescarga`:
  - `el link no es válido: tiene que empezar con http:// o https://`
  - `el link apunta a una dirección que no está permitida`
  - `no pudimos descargar la foto del link`
  - `el link tardó demasiado en responder`
  - `` `el link respondió con un error (${status})` ``
  - `la foto del link pesa más de 5 MB`
  - `el link redirige demasiadas veces`
  - `el link no lleva a una foto JPG, PNG o WEBP`

Usar `node:http`/`node:https` con la opción `lookup` propia, no `fetch`, porque `fetch` no deja controlar la resolución. Hay dos trampas:
1. Si el host es una IP literal, Node **no** llama a `lookup`. Hay que revisarla antes con `net.isIP` (en IPv6, sin los corchetes).
2. Node puede llamar a `lookup` con `{ all: true }` (por `autoSelectFamily`). El `lookup` propio usa `dns.lookup(…, { all: true })`, rechaza si **alguna** dirección no está permitida y responde con la forma que pidió quien lo llamó.

Las redirecciones (301, 302, 303, 307 y 308) se siguen a mano, revisando cada destino. La descarga se corta apenas pasa `tamanoMaximo` (se mira primero el `content-length`).

- [ ] **Step 1: Write the failing tests.** Hace falta un servidor local en `127.0.0.1` con estas rutas: `/foto.png` (PNG), `/pagina` (HTML), `/no-existe` (404), `/grande` (6 MB), `/lenta` (no responde nunca), `/vueltas/:n` (redirige a `/vueltas/n+1`) y `/a-privada` (redirige a `http://10.255.255.1/x`). `abierto` es `crearDescargador({ permitirDireccion: () => true, tiempoMaximoMs: 500 })`.
```js
test('linkDeDescarga convierte links compartidos de Drive y Dropbox', () => {
  assert.equal(linkDeDescarga('https://drive.google.com/file/d/ABC123/view?usp=sharing'), 'https://drive.google.com/uc?export=download&id=ABC123');
  assert.equal(linkDeDescarga('https://drive.google.com/open?id=ABC123'), 'https://drive.google.com/uc?export=download&id=ABC123');
  assert.equal(linkDeDescarga('https://www.dropbox.com/s/x/foto.jpg?dl=0'), 'https://www.dropbox.com/s/x/foto.jpg?dl=1');
  assert.equal(linkDeDescarga('https://ejemplo.com/a.jpg'), 'https://ejemplo.com/a.jpg');
});
test('esDireccionPublica', () => {
  for (const ip of ['8.8.8.8', '2001:4860:4860::8888']) assert.equal(esDireccionPublica(ip), true, ip);
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1'])
    assert.equal(esDireccionPublica(ip), false, ip);
});
test('por defecto no descarga de direcciones internas, ni por IP ni por nombre', async () => {
  const descargar = crearDescargador();
  await assert.rejects(descargar(`http://127.0.0.1:${puerto}/foto.png`), { message: 'el link apunta a una dirección que no está permitida' });
  await assert.rejects(descargar(`http://localhost:${puerto}/foto.png`), { message: 'el link apunta a una dirección que no está permitida' });
});
test('revisa también el destino de cada redirección', async () => {
  const descargar = crearDescargador({ permitirDireccion: (ip) => ip === '127.0.0.1' });
  await assert.rejects(descargar(`http://127.0.0.1:${puerto}/a-privada`), { message: 'el link apunta a una dirección que no está permitida' });
});
test('descarga una foto y explica cada falla', async () => {
  assert.deepEqual(await abierto(`http://127.0.0.1:${puerto}/foto.png`), PNG);
  const casos = {
    'ftp://ejemplo.com/a.png': 'el link no es válido: tiene que empezar con http:// o https://',
    [`http://127.0.0.1:${puerto}/no-existe`]: 'el link respondió con un error (404)',
    [`http://127.0.0.1:${puerto}/pagina`]: 'el link no lleva a una foto JPG, PNG o WEBP',
    [`http://127.0.0.1:${puerto}/grande`]: 'la foto del link pesa más de 5 MB',
    [`http://127.0.0.1:${puerto}/lenta`]: 'el link tardó demasiado en responder',
    [`http://127.0.0.1:${puerto}/vueltas/0`]: 'el link redirige demasiadas veces',
  };
  for (const [link, mensaje] of Object.entries(casos)) await assert.rejects(abierto(link), { message: mensaje }, link);
});
```
- [ ] **Step 2: Run** `node --test test/descargar.test.js`. Expected: FAIL.
- [ ] **Step 3: Implementar** `descargar.js`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Descarga de fotos por link con protección de red interna"`

---

### Task 5: Juntar las fotos de cada fila

**Files:**
- Modify: `src/importacion/fotos.js`, `test/fotos.test.js`

**Interfaces:**
- Consumes: `interpretarHoja` (Tarea 2: `link`, `textoImg`, `columnaImg`), `leerFotosExcel` (Tarea 3), un `descargar(link) => Promise<Buffer>` (Tarea 4), y `tipoDeImagen`, `TAMANO_MAXIMO_IMAGEN` y `huellaDe`.
- Produces:
  - `MAX_LINKS = 200`.
  - `obtenerFotos({ productos, columnaImg, fotosExcel, descargar }): Promise<{ fotosPorFila: Map<number, Buffer[]>, errores: Array<{ fila, mensaje }> }>`.
  - `asignarFotos(productos, fotosPorFila): void`. Le pone a cada producto `fotos: Array<{ huella: string, contenido: Buffer }>`, en el orden de sus filas y sin huellas repetidas. Un producto sin fotos queda con `[]`.

Reglas de `obtenerFotos`. "Filas con datos" son las `fila` de todas las variantes.
- Una foto pegada en una fila sin datos se ignora. Si está en una fila con datos pero fuera de `columnaImg` (o la planilla no tiene `img`), es el problema `Hay una foto pegada fuera de la columna "img"`.
- Por fila:
  - Si tiene fotos pegadas en `img`, se usan; el link y el texto se ignoran. Cada foto se revisa: si no es de un tipo aceptado, `La foto pegada en "img" no es JPG, PNG ni WEBP`; si pesa más de 5 MB, `La foto pegada en "img" pesa más de 5 MB`.
  - Si no tiene foto pero tiene `textoImg`: `En "img" va la foto pegada. Los links van en "link-img"`.
  - Si no tiene foto ni texto pero tiene `link`, se descarga (convertido con `linkDeDescarga`).
- Si hay más de `MAX_LINKS` links distintos, el problema es `La planilla tiene más de 200 links en "link-img". Subila en partes`, en la fila del link 201, y no se descarga nada.
- Cada link distinto se descarga una sola vez, hasta 4 a la vez. Si falla con un `ErrorDeDescarga`, cada fila que lo usa recibe `` `Foto de "link-img": ${error.message}` ``. Cualquier otro error se vuelve a lanzar.
- `errores` vuelve ordenado por fila.

- [ ] **Step 1: Write the failing tests.** Usar productos de `interpretarHoja` con encabezados `['SKU', 'Nombre', 'Precio', 'img', 'link-img']` (`columnaImg` = 3) y un `descargar` falso que anota los links que recibe y devuelve `otraFoto(9)`, o rechaza con `new ErrorDeDescarga('el link respondió con un error (404)')` para `…/caido`.
  - `'la foto pegada gana sobre el link de la misma fila'`: fila 2 con foto en la columna 3 y link → `fotosPorFila.get(2)` es `[PNG]` y `descargar` no se llamó.
  - `'sin foto pegada se usa el link, una sola vez aunque se repita'`: filas 2 y 3 con el mismo link → las dos dan `[otraFoto(9)]` y hubo 1 llamada.
  - `'foto fuera de la columna img es un problema; en una fila sin datos se ignora'`: foto en `{ fila: 2, columna: 1 }` → `[{ fila: 2, mensaje: 'Hay una foto pegada fuera de la columna "img"' }]`; foto en la fila 9 → sin errores.
  - `'texto en img es un problema'`: `{ fila: 2, mensaje: 'En "img" va la foto pegada. Los links van en "link-img"' }`.
  - `'una foto pegada que no es imagen o es muy pesada es un problema'`: `Buffer.from('GIF89a')` y `Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])` dan sus dos mensajes.
  - `'un link que falla marca todas las filas que lo usan'`: filas 2 y 3 con `…/caido` → dos errores `Foto de "link-img": el link respondió con un error (404)`.
  - `'más de 200 links es un problema y no se descarga nada'`: 201 filas con links distintos → un error en la fila 202 y 0 llamadas.
  - `'asignarFotos junta las fotos de las filas del producto sin repetir'`: producto de 3 filas con `[PNG]`, `[otraFoto(1)]` y `[PNG]` → `fotos.map((f) => f.huella)` es `[huellaDe(PNG), huellaDe(otraFoto(1))]`.
- [ ] **Step 2: Run** `node --test test/fotos.test.js`. Expected: FAIL.
- [ ] **Step 3: Implementar** `obtenerFotos` y `asignarFotos`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Fotos de la planilla: pegadas o por link, por fila y por producto"`

---

### Task 6: Guardar las fotos con la importación

**Files:**
- Modify: `src/importacion/aplicar.js`, `test/aplicar.test.js`

**Interfaces:**
- Consumes: `producto.fotos` (Tarea 5; si no está, cuenta como `[]`), `MAX_FOTOS` y `agregarFoto(…, huella)` (Tarea 1).
- Produces:
  - `claveFoto(slug, huella): string` = `` `${slug}\u0000${huella}` ``.
  - `previsualizar(db, tiendaId, productos)` devuelve `{ resumen, errores, fotosAGuardar: Array<{ slug, huella, contenido }> }`. `resumen` suma `fotosNuevas: number` (cuántas son).
  - `aplicarImportacion(db, tiendaId, productos, archivos = new Map())`. `archivos` va de `claveFoto` al nombre del archivo ya guardado. Devuelve `resumen`, también con `fotosNuevas`.

En `analizar`, para cada producto: las fotos nuevas son las de `producto.fotos` cuya huella no está entre las de `producto_fotos` de ese producto (si es nuevo, no tiene ninguna). Si `existentes + nuevas > MAX_FOTOS`, el problema va en `primeraFila`: `` `"${producto.nombre}" quedaría con ${total} fotos y el máximo es ${MAX_FOTOS}` ``. En la transacción, después de las variantes, cada foto nueva que tenga archivo en `archivos` se agrega con `agregarFoto(db, tiendaId, productoId, archivo, huella)`, en orden. Si no tiene archivo, se saltea.

- [ ] **Step 1: Write the failing tests.** Sumar `fotosNuevas: 0` a los `assert.deepEqual(resumen, …)` que ya existen.
  - Las fotos de los productos de prueba se ponen con `asignarFotos(productos, new Map([[fila, [buffers…]]]))` (Tarea 5).
  - `'previsualizar cuenta las fotos nuevas y saltea las que el producto ya tiene'`: importar `Gorra` con `fotos: [PNG]` y archivo `'a.png'`. Volver a previsualizar con `[PNG, otraFoto(1)]` → `resumen.fotosNuevas === 1` y `fotosAGuardar[0].huella === huellaDe(otraFoto(1))`.
  - `'aplicarImportacion agrega las fotos en orden; la primera queda como principal'`: después, `listarFotos(db, tiendaId, id)` da `['a.png', 'b.png']`.
  - `'un producto que pasaría de 10 fotos es un problema'`: 11 fotos (`otraFoto(0..10)`) → `errores` es `[{ fila: 2, mensaje: '"Gorra" quedaría con 11 fotos y el máximo es 10' }]`, y `aplicarImportacion` lanza `ErrorDeImportacion`.
  - `'la misma foto en dos productos se guarda para cada uno'`: `Gorra` y `Remera` con `[PNG]` y archivos `g.png` y `r.png` → cada uno tiene su propia fila en `producto_fotos`.
- [ ] **Step 2: Run** `node --test test/aplicar.test.js`. Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "La importación guarda las fotos nuevas sin duplicar"`

---

### Task 7: Rutas, carpeta pendiente, vista previa y textos

**Files:**
- Create: `src/importacion/pendiente.js`
- Modify: `src/rutas/admin.js`, `src/vistas/admin/importar.ejs`, `src/vistas/admin/vista-previa.ejs`, `README.md`, `test/admin.test.js`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces, en `pendiente.js`:
  - `guardarPendiente(dir, tiendaId, { excel, fotosPorFila }): Promise<string>`. Devuelve el nombre de la carpeta `` `${tiendaId}-${randomUUID()}` ``, que contiene `planilla.xlsx`, `fotos/<huella>` (una vez por huella) y `fotos.json` = `[[fila, [huella, …]], …]`.
  - `leerPendiente(dir, carpeta): Promise<{ excel, fotosPorFila }>`.
  - `borrarPendiente(dir, carpeta): Promise<void>`.
  - `borrarPendientesViejos(dir): Promise<void>` (se mueve desde `admin.js` y ahora borra con `recursive: true`).
  - Toda ruta que se arma con `carpeta` pasa antes por `path.basename`.
- En la config: `permitirLinksLocales` (booleano). Solo lo activan los tests y no se lee del entorno. `rutasAdmin` arma `crearDescargador({ permitirDireccion: config.permitirLinksLocales ? () => true : esDireccionPublica })`.

**Vista previa** (`POST /importar`):
1. `leerExcel`
2. `interpretarHoja`
3. `leerFotosExcel(req.file.buffer)`
4. `obtenerFotos`
5. `asignarFotos`
6. `completarHuellas`
7. `previsualizar`

Los errores de fotos se mezclan con los de formato y los de la base, igual que hoy, ordenados por fila. Si no hay ningún problema: `req.session.importacion = { carpeta, nombreOriginal }`.

**Confirmar:**
1. Si `pendiente?.carpeta` no existe, se trata como "no hay importación pendiente" (eso cubre las sesiones viejas con `{ archivo }`).
2. `leerPendiente`, `interpretarHoja`, `asignarFotos` con el `fotosPorFila` leído, `completarHuellas` y `previsualizar`. Si hay errores, se muestra la vista previa con errores, como hoy.
3. Cada elemento de `fotosAGuardar` se guarda con `guardarImagen` en un mapa `claveFoto → archivo`.
4. `aplicarImportacion(…, archivos)`. Si lanza, se borran los archivos escritos. Si sale bien, se borran los que no quedaron en `producto_fotos`.
5. En el `finally`: `borrarPendiente`.

**Textos:**
- `TAMANO_MAXIMO` pasa a `30 * 1024 * 1024`. El mensaje es `El archivo pesa más de 30 MB.` y `importar.ejs` dice `Hasta 30 MB`.
- En el paso 2 de `importar.ejs` se suma `<p class="texto-suave">Para cargar fotos, pegalas en la columna img o poné el link en link-img.</p>`.
- En `vista-previa.ejs` se suma `<div class="dato"><strong data-dato="fotos-nuevas"><%= resumen.fotosNuevas %></strong><span>fotos a agregar</span></div>`.
- `textoResumen` suma `` ` Se agregaron ${plural(n, 'foto', 'fotos')}.` `` cuando `n > 0`.
- En `README.md`, sección de carga masiva: las columnas `img` y `link-img`, sus reglas y el límite de 30 MB. En la lista de archivos: `fotos.js`, `fotos-excel.js`, `descargar.js` y `pendiente.js`.

- [ ] **Step 1: Write the failing tests** en `test/admin.test.js`. Primero, separar `dirSubidas` en su propia carpeta temporal y sumar `permitirLinksLocales: true` a la config. Después, levantar un servidor de fotos local con `/foto.png` → `otraFoto(7)` y `/no-existe` → 404.
```js
test('carga masiva con fotos pegadas y por link, sin duplicar al volver a subir', async () => {
  const nav = await ingresarComoNuevaTienda('confotos');
  const hoja = [['SKU', 'Nombre', 'Precio', 'img', 'link-img'],
    ['A1', 'Flotante', 1000, null, null], ['B1', 'Por Link', 1000, null, `${fotos}/foto.png`], ['C1', 'En Celda', 1000, null, null]];
  const imagen = { content: PNG, contentType: 'image/png', width: 10, height: 10, dpi: 96, anchor: { row: 2, column: 4 } };
  const xlsx = conFotoEnCelda(await writeExcelFile(hoja, { images: [imagen] }).toBuffer(), 'D4', otraFoto(3));

  assert.match(await (await nav.subirExcel(xlsx)).text(), /data-dato="fotos-nuevas">3</);
  await nav.enviar('/admin/importar/confirmar', {}, { desde: '/admin/importar' });
  const filas = db.prepare(`SELECT f.archivo FROM producto_fotos f JOIN tiendas t ON t.id = f.tienda_id WHERE t.slug = 'confotos'`).all();
  assert.equal(filas.length, 3);
  // cada archivo existe en <dirSubidas>/<tiendaId>/

  assert.match(await (await nav.subirExcel(xlsx)).text(), /data-dato="fotos-nuevas">0</);
});

test('un link caído se ve en la vista previa y no deja confirmar', async () => {
  const nav = await ingresarComoNuevaTienda('linkcaido');
  const html = await (await nav.subirExcel(await excel([['SKU', 'Nombre', 'Precio', 'link-img'], ['X', 'Algo', 1000, `${fotos}/no-existe`]]))).text();
  assert.match(html, /Fila 2/);
  assert.match(html, /Foto de &#34;link-img&#34;: el link respondió con un error \(404\)/);
  assert.doesNotMatch(html, /importar\/confirmar/);
});

test('subir otro archivo descarta la carpeta pendiente anterior', async () => {
  const nav = await ingresarComoNuevaTienda('dosveces');
  const xlsx = await excel([['SKU', 'Nombre', 'Precio'], ['Z', 'Zeta', 1000]]);
  await nav.subirExcel(xlsx);
  await nav.subirExcel(xlsx);
  assert.equal(readdirSync(dirImportaciones).filter((n) => n.startsWith(`${tiendaIdDe('dosveces')}-`)).length, 1);
});

test('un Excel de más de 30 MB se rechaza con un mensaje claro', async () => {
  const nav = await ingresarComoNuevaTienda('pesado');
  const respuesta = await nav.subirExcel(Buffer.alloc(31 * 1024 * 1024));
  assert.equal(respuesta.status, 400);
  assert.match(await respuesta.text(), /pesa más de 30 MB/);
});
```
Se asume que EJS escapa `"` como `&#34;`; si escapa distinto, ajustar la regex. `tiendaIdDe(slug)` es un `SELECT id FROM tiendas WHERE slug = ?` local del test.

Las sesiones se guardan como JSON en la tabla `sesiones`, así que el test puede escribir una sesión con el formato viejo:
```js
test('una importación pendiente del formato viejo se trata como si no hubiera ninguna', async () => {
  const nav = await ingresarComoNuevaTienda('sesionvieja');
  await nav.subirExcel(await excel([['SKU', 'Nombre', 'Precio'], ['V', 'Vieja', 1000]]));
  db.prepare(`UPDATE sesiones SET datos = json_set(datos, '$.importacion', json(?))
              WHERE json_extract(datos, '$.usuario.tiendaId') = ?`)
    .run(JSON.stringify({ archivo: 'viejo.xlsx', nombreOriginal: 'viejo.xlsx' }), tiendaIdDe('sesionvieja'));
  const respuesta = await nav.enviar('/admin/importar/confirmar', {}, { desde: '/admin/importar' });
  assert.equal(respuesta.status, 302);
  assert.equal(respuesta.headers.get('location'), '/admin/importar');
});
```

- [ ] **Step 2: Run** `node --test test/admin.test.js`. Expected: FAIL.
- [ ] **Step 3: Implementar** `pendiente.js`, las rutas, las vistas y el README.
- [ ] **Step 4: Run** `npm test`. Expected: todo PASS.
- [ ] **Step 5: Prueba a mano** con `npm run dev`: descargar la plantilla, pegar una foto con "Colocar en celda" en Excel, otra flotante y un link de Drive público. Subirla, ver "fotos a agregar 3", confirmar y ver las fotos en el editor y en la tienda.
- [ ] **Step 6: Commit** `git commit -m "Carga masiva: fotos en la vista previa y al confirmar"`
