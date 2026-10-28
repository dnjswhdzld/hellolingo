import { useState } from 'react'
import { CartItem } from './CartItem'
import { removeItem, setQuantity, total, type CartLine } from '../lib/cart'

export function Cart({ initial }: { initial: CartLine[] }) {
  const [lines, setLines] = useState(initial)

  return (
    <section>
      <h2>장바구니</h2>
      <ul>
        {lines.map(line => (
          <CartItem
            key={line.id}
            line={line}
            onRemove={id => setLines(removeItem(lines, id))}
            onChangeQuantity={(id, quantity) => setLines(setQuantity(lines, id, quantity))}
          />
        ))}
      </ul>
      <p>합계 {total(lines).toLocaleString()}원</p>
    </section>
  )
}
