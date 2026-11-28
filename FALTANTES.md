# Qué falta y qué tenés que hacer vos

Estado al 24/11/2026. **No hice commit ni push** (solo si me lo pedís). La suite tiene 482 tests: pasan 476 y fallan los 6 de siempre
(apariencia CSS del panel, banners x2 de diseño, migración de imágenes x2, recorte), que ya fallaban antes de tocar nada.

## Qué quedó hecho (de tu lista de 11 puntos)

| Punto | Estado |
| --- | --- |
| 1. Clave de 6 caracteres | Hecho |
| 2. Aumento de precios con clientes exceptuados | Hecho: pantalla de confirmación con una casilla por cliente; el exceptuado queda con **precio fijo** |
| 3. Mail a los clientes cuando se modifica un plan | Hecho (evento `plan_modificado`) |
| 4. Baja de suscripción: "tu tienda sigue activa hasta el X" + reactivar | Hecho, en pantalla y por mail (evento `suscripcion_cancelada`) |
| 5. Pasos de la tienda nueva completos → aparecen los pedidos | Hecho |
| 6. Lista de pedidos: menú "Acciones" (computadora) y botón "Ver" (celular) | Hecho |
| 7. Envíos: empresa, n.º de seguimiento, estados, historial, aviso por mail y WhatsApp, línea de tiempo para el comprador, nota interna, remito para imprimir | Hecho (evento `pedido_actualizado`) |
| 8. Mercado Pago dentro de cada tienda: cobro en el momento, pedido a "Pagado" solo, comisiones reales y calculadora ($50.000 → cuánto queda, y a cuánto vender para que queden $50.000) | Hecho |
| 9. Diseño por plan (Esencial / Acompañado / A medida) y dominio propio | Hecho (ver abajo) |
| 10. Productos: filtros, orden, acciones en lote, "ocultar sin stock" | Hecho |
| 11. Muchas categorías: no listar todas en la portada | Hecho |

El flujo de n8n **ya está actualizado en vivo** (nodo "Validar y armar mail" y remitente / Reply-To del nodo de envío).

### Punto 9 en dos líneas
- **Diseño por plan:** cada plan tiene su propia lista de **funciones de diseño** que tildás en `/plataforma/planes` (colores, logo y cabecera, portada, tarjetas, pie, tipografías, ancho, CSS propio, dominio
  propio, códigos de seguimiento y kit de marca), más los textos de su tarjeta en la web. En el panel de Diseño de cada cliente, lo que su plan no incluye sale **bloqueado** función por función, y
  arriba hay una tabla de qué incluye cada plan. Los tres niveles de antes (Esencial, Acompañado y A medida) quedaron como botones de punto de partida que tildan sus funciones. Lo de más que haya
  elegido un cliente que baja de plan queda guardado pero no se ve.
- **Dominio propio:** el cliente cuyo plan lo incluye lo pide en *Cuenta*, verifica su DNS, y **vos lo activás** desde su ficha en `/plataforma` (en la lista de clientes aparece "Dominio por activar").

## Lo que tenés que hacer vos

### 1. Revisar y guardar el trabajo
- [ ] Mirá los cambios (`git status`: 52 archivos modificados y 38 nuevos, entre ellos `n8n/`, `src/cambios-de-plan.js`, `src/envios.js`,
      `src/estados-pedido.js`, `src/secretos.js`, `src/cobros-mp.js`, `src/mercadopago-tiendas.js`, `src/tienda-mercadopago.js`, `src/comisiones-mp.js`,
      `src/diseno-por-plan.js`, `src/dominios-propios.js`, migraciones `012` a `016`, tests nuevos). Si está bien, decime y hago el commit (o hacelo vos).
- [ ] Antes de publicar en Coolify, **hacé una copia de la base** (pestaña Backups del recurso PostgreSQL). Las migraciones 012 a 016 se aplican
      solas al arrancar.
- [ ] **No cambies `SECRETO_SESION`**: ahora también cifra los tokens de Mercado Pago de las tiendas. Si cambia, cada tienda tiene que volver a conectar.

### 2. Planes y funciones de diseño (punto 9)
Los planes ya no tienen tres niveles fijos: cada uno tiene su **lista de funciones de diseño** (colores, portada, tarjetas, CSS propio, dominio propio...), que tildás en `/plataforma/planes`, y los textos de su tarjeta en la web.
- [ ] Entrá a `/plataforma/planes` y mirá la columna **Diseño** de cada plan. La migración `020` copió el nivel de antes a las funciones: *Acompañado* al plan que se llamaba "Acompañado", *A medida* a "A medida" y a "Sin límites"
      (el interno de las tiendas que ya existían, para que no pierdan nada), y ninguna (*Esencial*) a los demás. Si renombraste planes, corregilo editando cada plan: tocá un plan y tildá lo que corresponda
      (los botones **Esencial / Acompañado / A medida** tildan de una las funciones de ese nivel).
- [ ] La migración también marcó como **Recomendado** al plan pago más barato (lo que se mostraba hasta ahora). Si preferís otro, abrilo y tildá *Mostrarlo como "Recomendado"*: lo tiene un solo plan.
- [ ] Armá un plan a tu gusto (por ejemplo, solo *Colores* y *Pie de página*) y escribí su **frase** y su **lista de lo que incluye** en *Cómo se ve en la web*: la frase y el Recomendado se ven en la landing, y la lista también en `/suscribirse` y en `/admin/suscripcion`. Dejá vacío lo que
      quieras que se arme solo. No lo hice con tus planes reales: probalo con uno de prueba.
- [ ] Mirá el panel de **Diseño** de un cliente de cada plan (podés entrar a su panel desde `/plataforma`) y probá guardar colores, logo al centro, portada con ofertas, etc. Probé todo con
      fotos de relleno (letras); conviene verlo con **fotos y un logo reales**, y con un menú de categorías, que fue lo que no pude probar. Lo que el plan no incluye sale bloqueado, función por función.
- [ ] Probá una **tipografía de Google Fonts** a elección (función *Tipografías a elección*, ej. `Playfair Display`). Con `Playfair Display` y conexión a internet se vio bien; probá una que tenga un solo peso
      (ej. `Pacifico`) por si tu navegador la trata distinto.
- [ ] Tené en cuenta: los **colores** personalizados no se aplican al checkout ni a la página del pedido (para no romper su lectura); el **CSS propio** sí se aplica en todas las páginas de la tienda.
- [ ] Si le sacás una función a un plan que ya tienen clientes, la pantalla de confirmación te lo muestra y, si dejás tildado "Avisarles por mail", se les avisa. Lo que habían elegido queda guardado y vuelve si la función se vuelve a tildar.

### 3. Dominio propio de un cliente (punto 9): lo que hacés cuando pide uno
La plataforma **no** avisa por mail cuando un cliente pide o verifica su dominio: lo ves en `/plataforma/clientes` (etiqueta "Dominio por activar"). Para cada uno:
- [ ] En la ficha del cliente → *Dominio propio* → **Verificar DNS** (tiene que apuntar al dominio del panel).
- [ ] En **Coolify**: aplicación → *Configuration* → *Domains* → sumá `https://www.sudominio.com` a los que ya hay (separados por coma) → guardar → *Redeploy* (Coolify saca el certificado solo).
- [ ] Abrí `https://www.sudominio.com`, comprobá que carga con el candado y recién ahí tocá **Activar** en la ficha. Desde ahí el link de siempre redirige al dominio propio.
- [ ] Para dominios **sin www** (`sudominio.com`) hace falta un registro A: poné en Coolify la variable `IP_SERVIDOR` (la IP pública de tu servidor) para que el panel se la muestre al cliente.
- [ ] Si el cliente usa Cloudflare, el registro tiene que estar en "solo DNS" (nube gris), o la verificación no lo ve (igual podés activarlo a mano si ya carga).
- [ ] Los **códigos de seguimiento** (píxel de Meta, Google Analytics) los cargás vos en la misma ficha, en *Códigos de seguimiento*: solo se usan si su plan incluye la función *Códigos de seguimiento*.

### 4. n8n: probar los mails nuevos (no mandé ninguno de prueba, como pediste)
El secreto del webhook no está en el repo, así que tampoco llamé al flujo en vivo. Probá con un email tuyo, uno de cada tipo:
- [ ] **Cambio de plan** (`plan_modificado`): en `/plataforma`, cambiá el precio, un tope o las funciones de diseño de un plan que tenga un cliente de prueba, y dejá tildado "Avisarles por mail".
- [ ] **Baja** (`suscripcion_cancelada`): cancelá la suscripción de un cliente de prueba y fijate que el mail diga hasta cuándo sigue la tienda y traiga el botón para reactivar.
- [ ] **Pedido** (`pedido_actualizado`): en una tienda de prueba, un pedido con tu email; pasalo a "Despachado" con "Avisarle por email" tildado. Tiene que salir con **el nombre de la tienda** como remitente y responder al email de contacto de la tienda.
- [ ] Si algo sale mal, se vuelve atrás: en n8n, historial de versiones del flujo (versión `1009cd1c`), o el respaldo local `17863`. El código nuevo del nodo está también en `n8n/validar-y-armar-mail.js`.

### 5. Mercado Pago de las tiendas (punto 8)
- [ ] En tu aplicación de [Mercado Pago Developers](https://www.mercadopago.com.ar/developers/panel/app): habilitá OAuth y cargá la Redirect URL **exacta**
      `https://tiendas.vezzadev.com/admin/pagos/mercadopago/volver`.
- [ ] En Coolify, variables `MP_CLIENT_ID` y `MP_CLIENT_SECRET` (las dos juntas, las de esa aplicación). Sin ellas no aparece el botón "Conectar con Mercado Pago"
      y las tiendas solo pueden pegar su Access Token.
- [ ] **Probalo con cuentas de prueba** (una de vendedor y una de comprador) antes de ofrecerlo: conectar la tienda, comprar, ver que el pedido pasa a "Pagado" solo y que el pedido
      muestra la comisión y lo que le llega. Mis tests usan un Mercado Pago de mentira; **no está verificado contra el real**: el canje del código de OAuth, si el
      refresh token es de un solo uso, el formato de la fecha de vencimiento del pago, y que llegue el aviso a `https://tiendas.vezzadev.com/webhooks/mercadopago/tienda/<id>`.
      Si algo no coincide, todo está en `src/mercadopago-tiendas.js` y `src/cobros-mp.js`.
- [ ] Confirmá las tasas de la calculadora cuando salgas (6,29 % al instante, 4,39 % a 10 días, 3,39 % a 18, 1,49 % a 35, más 21 % de IVA sobre la comisión; las leí en noviembre de 2026
      de la página de Mercado Pago). Si cambian, se editan en `src/publico/comisiones-mp.js`, un solo lugar.

### 6. Suscripciones a los planes (puntos 2 y 4): confirmarlo en el sandbox de Mercado Pago
- [ ] Que `PUT /preapproval/{id}` acepte el aumento de monto (puede tener límites de cuánto se sube de una vez; si lo rechaza, el panel lo avisa y queda para reintentar desde la ficha del cliente).
- [ ] Que al reactivar con `start_date` el primer cobro caiga el día de siempre y no se cobre dos veces.

### 7. Kit de marca y maqueta web (función del plan): ponerlo en marcha
El panel, el pedido a n8n, la entrega y el flujo de n8n (`n8n/maqueta-web.json`) están hechos y probados (ver *Kit de marca y maquetas web* en el README). Falta lo que depende de tu n8n y tu Coolify:
- [x] En n8n: el flujo **VEZZA Shop · Maquetas web** ya está creado (id `DCgxn1z2ELG90S0f`), **inactivo**, con tu credencial *VEZZA Shop · Secreto del webhook de cuentas* en el webhook, la de Google Gemini en *Redactar los textos*
      (`models/gemini-3.5-flash-lite`) y *VEZZA · Alerta de errores* como flujo de errores. Lo probé activo, con un secreto temporal que ya borré (y borré también las ejecuciones de prueba): un pedido inválido
      responde 400 con sus errores; uno válido, 202 en menos de un segundo, y después Gemini redacta los textos (con tildes y ñ), la plantilla arma la maqueta y la entrega sale con el cuerpo que espera la plataforma.
      Lo único que no pude ver es la entrega exitosa, porque apunté a un dominio de prueba que no existe: eso se ve cuando la plataforma nueva esté en producción.
- [ ] **Activar el flujo** cuando subas la plataforma nueva (no lo dejé activo porque hasta entonces nadie lo llama).
- [ ] Recomendado: escribí tu dominio del panel en `DOMINIO_DE_LA_PLATAFORMA` (`n8n/maqueta-pedido.js`), corré `node scripts/armar-flujo-n8n.js` y pegá el código en el nodo: así la entrega de la maqueta no puede ir a ningún otro dominio.
- [ ] En Coolify: `N8N_MAQUETAS_URL=https://<tu n8n>/webhook/vezza-shop-maquetas` (y `N8N_MAQUETAS_SECRET` si no querés usar el mismo secreto que los mails).
- [ ] Probalo con una tienda cuyo plan incluya el kit de marca (por ejemplo, Acompañado): subí un logo y fotos, guardá los colores, "Armar mi maqueta" y esperá menos de un minuto. Si el resumen debajo de la vista previa dice "Textos de ejemplo" en vez de
      "Textos redactados con IA", Gemini no contestó (o contestó en otro formato): mirá esa ejecución en n8n y mandame lo que devolvió el nodo.
- [ ] Mirá cómo queda: el diseño de la maqueta es la plantilla de `n8n/maqueta-armar.js` (hay cuatro estilos). Si querés otro look, se cambia ahí y se vuelve a armar el flujo.
- [ ] Decidí si querés que al cliente le llegue un mail cuando su maqueta está lista (hoy solo la ve en el panel) y si querés que pueda **aplicar los colores de la maqueta a su tienda** con un botón.

## Otras cosas a tener en cuenta
- Los pedidos con Mercado Pago **reservan el stock hasta que la tienda cancela** uno sin pagar (no se cancelan solos), y los reembolsos se hacen desde Mercado Pago: quedó anotado en "Qué falta" del README.
- Que el dominio propio se agregue solo en Coolify (hoy lo hacés a mano) y un mail cuando un cliente lo pide son mejoras posibles; no las hice porque dependen de tu Coolify.
- El README documenta todo lo hecho (envíos, avisos por mail, Mercado Pago en cada tienda, calculadora, diseño por plan, dominio propio, configuración).
