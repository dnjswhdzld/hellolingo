import type { CartLine } from '../lib/cart'
import styles from './CartItem.module.css'

type Props = {
  line: CartLine
  onRemove: (id: string) => void
  onChangeQuantity: (id: string, quantity: number) => void
}

export function CartItem({ line, onRemove, onChangeQuantity }: Props) {
  return (
    <li className={styles.item}>
      <span className={styles.name}>{line.name}</span>
      <span className={styles.stepper}>
        <button onClick={() => onChangeQuantity(line.id, line.quantity - 1)}>−</button>
        <span>{line.quantity}</span>
        <button onClick={() => onChangeQuantity(line.id, line.quantity + 1)}>+</button>
      </span>
      <span className={styles.price}>{(line.price * line.quantity).toLocaleString()}원</span>
      <button className={styles.remove} onClick={() => onRemove(line.id)}>
        삭제
      </button>
    </li>
  )
}
