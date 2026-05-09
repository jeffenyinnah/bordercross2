import { createClient } from '@/lib/supabase/server'
import { BorderPostsManager } from '@/components/settings/BorderPostsManager'

export default async function BorderPostsPage() {
  const supabase = await createClient()
  const { data: borderPosts } = await supabase
    .from('border_posts')
    .select('*')
    .order('name')

  return <BorderPostsManager borderPosts={borderPosts ?? []} />
}
