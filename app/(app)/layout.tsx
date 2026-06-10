import AppShell from '@/components/layout/AppShell'
import CutoverGate from '@/components/CutoverGate'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <CutoverGate>
      <AppShell>{children}</AppShell>
    </CutoverGate>
  )
}
