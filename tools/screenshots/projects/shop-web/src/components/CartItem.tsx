import type { CartLine } from '../lib/cart'
import styles from './CartItem.module.css'

type Props = {
  line: CartLine
  onRemove: (id: string) => void
}

export function CartItem({ line, onRemove }: Props) {
  return (
    <li className={styles.item}>
      <span className={styles.name}>{line.name}</span>
      <span className={styles.quantity}>{line.quantity}개</span>
      <span className={styles.price}>{(line.price * line.quantity).toLocaleString()}원</span>
      <button className={styles.remove} onClick={() => onRemove(line.id)}>
        삭제
      </button>
    </li>
  )
}
