import { memo } from 'react'
import { glyph } from '../lib/icons'

type Props = {
  name: string
  className?: string
  size?: number | string
  title?: string
  style?: React.CSSProperties
}

/**
 * Renderiza um glyph Nerd Font. Sem SVG — apenas a fonte.
 * `name` pode ser a chave do mapa (`play`), um hex (`f04b`) ou o char cru.
 */
function Icon({ name, className = '', size, title, style }: Props) {
  return (
    <i
      className={`nf ${className}`}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
      title={title}
      style={{ fontSize: typeof size === 'number' ? `${size}px` : size, ...style }}
    >
      {glyph(name)}
    </i>
  )
}

/**
 * memo: o Icon aparece dezenas de vezes por tela e recebe só props primitivas.
 * Sem isso, cada tick do relógio reconciliava todos eles à toa.
 */
export default memo(Icon)
