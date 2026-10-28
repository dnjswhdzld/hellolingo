export type CartLine = { id: string; name: string; price: number; quantity: number }

export function addItem(lines: CartLine[], item: Omit<CartLine, 'quantity'>): CartLine[] {
  if (lines.some(l => l.id === item.id)) {
    return lines.map(l => (l.id === item.id ? { ...l, quantity: l.quantity + 1 } : l))
  }
  return [...lines, { ...item, quantity: 1 }]
}

export function removeItem(lines: CartLine[], id: string): CartLine[] {
  return lines.filter(l => l.id !== id)
}

export function setQuantity(lines: CartLine[], id: string, quantity: number): CartLine[] {
  if (quantity <= 0) {
    return removeItem(lines, id)
  }
  return lines.map(l => (l.id === id ? { ...l, quantity } : l))
}

export function total(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.price * l.quantity, 0)
}
