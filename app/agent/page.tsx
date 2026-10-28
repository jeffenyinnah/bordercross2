import { AgentApp } from '@/components/agent-app/AgentApp'

// A static shell: the service worker precaches it so the app opens with no network.
// Session, device and data checks all happen on the phone.
export const dynamic = 'force-static'

export default function AgentPage() {
  return <AgentApp />
}
