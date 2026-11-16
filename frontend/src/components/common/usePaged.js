import { useMemo, useState } from 'react'

export const PAGE_SIZES = [10, 25, 50]

// Pages a list that is already loaded: { page, size, shown, offset, total, lastPage, setPage, setSize }.
// Pass a reset key (e.g. the filters) to go back to page 1 when it changes.
export default function usePaged(rows, initialSize = 10, resetKey = '') {
  const [state, setState] = useState({ page: 0, size: initialSize, key: resetKey })
  const list = useMemo(() => rows || [], [rows])
  const page = state.key === resetKey ? state.page : 0
  const total = list.length
  const lastPage = Math.max(0, Math.ceil(total / state.size) - 1)
  const current = Math.min(page, lastPage)
  const offset = current * state.size
  return {
    page: current, size: state.size, total, lastPage, offset,
    shown: list.slice(offset, offset + state.size),
    setPage: (p) => setState((s) => ({ ...s, key: resetKey, page: Math.max(0, Math.min(p, lastPage)) })),
    setSize: (n) => setState({ page: 0, size: n, key: resetKey }),
  }
}
