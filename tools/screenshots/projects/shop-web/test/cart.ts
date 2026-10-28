import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addItem, removeItem, total } from '../src/lib/cart.ts'

const tee = { id: 'tee', name: '기본 티셔츠', price: 19000 }
const cap = { id: 'cap', name: '볼캡', price: 25000 }

test('같은 상품을 또 담으면 수량이 늘어난다', () => {
  assert.equal(addItem(addItem([], tee), tee)[0].quantity, 2)
})

test('상품을 빼면 장바구니에서 사라진다', () => {
  assert.deepEqual(removeItem(addItem([], tee), 'tee'), [])
})

test('합계는 가격 곱하기 수량을 더한 값이다', () => {
  assert.equal(total(addItem(addItem(addItem([], tee), tee), cap)), 63000)
})
