'use client'
import { useEffect, useState, useCallback } from 'react'
import { getAll, subscribeOutbox, type OutboxAction } from './outbox'

export interface OutboxStats {
  pending: number
  failed: number
  total: number
  actions: OutboxAction[]
}

export function useOutbox(): OutboxStats {
  const [actions, setActions] = useState<OutboxAction[]>([])

  const refresh = useCallback(() => {
    void getAll().then(setActions)
  }, [])

  useEffect(() => {
    refresh()
    const unsub = subscribeOutbox(refresh)
    return () => { unsub() }
  }, [refresh])

  const failed = actions.filter(a => a.status === 'failed').length
  const pending = actions.length - failed
  return { pending, failed, total: actions.length, actions }
}
