// Logo de Vezza y la firma "Desarrollado por VEZZA". Los SVG de src/publico/vezza/ son la fuente: acá se incrustan en la
// página tomando los colores del CSS (--vezza-tinta y --vezza-acento), así el logo sigue la apariencia clara u oscura
// sin duplicarlo. Se usa en las vistas con <%- vezza({ forma: 'logo', etiqueta: true }) %>.
import { readFileSync } from 'node:fs';

const NEGRO = '#13121a';
const INDIGO = '#3b2ee4';

const leer = (nombre) => readFileSync(new URL(`../publico/vezza/${nombre}.svg`, import.meta.url), 'utf8').trim();

// El texto del logo pasa a currentColor y el índigo a una clase; el tamaño lo da el CSS, no el atributo width.
const incrustar = (svg) =>
  svg
    .replace(/ width="\d+" height="\d+"/, '')
    .replaceAll(`"${NEGRO}"`, '"currentColor"')
    .replaceAll(`fill="${INDIGO}"`, 'class="vz-a"')
    .replaceAll(`stroke="${INDIGO}"`, 'class="vz-a"');

const FORMAS = { logo: incrustar(leer('logo')), marca: incrustar(leer('marca')) };

// forma: 'logo' (símbolo y nombre, uno sobre otro) o 'marca' (solo el símbolo).
// etiqueta: agrega "Desarrollado por" arriba. decorativo: el lector de pantalla lo ignora (cuando el texto de al lado ya lo dice).
export function vezza({ forma = 'logo', etiqueta = false, decorativo = false, clase = '' } = {}) {
  const base = FORMAS[forma];
  if (!base) throw new Error(`Forma de logo desconocida: ${forma}`);
  let svg = base.replace('<svg ', `<svg class="vezza-${forma}" `);
  if (decorativo) svg = svg.replace(' role="img" aria-label="Vezza"', ' aria-hidden="true" focusable="false"');
  if (!etiqueta) return svg;
  return `<span class="vezza-firma${clase ? ` ${clase}` : ''}"><span class="vezza-etiqueta">Desarrollado por</span>${svg}</span>`;
}
