import { Redirect } from 'expo-router';

import { useStore } from '@/lib/store';

export default function Entry() {
  const onboarded = useStore((s) => s.onboarded);
  const role = useStore((s) => s.role);

  if (!onboarded) return <Redirect href="/onboarding" />;
  return <Redirect href={role === 'owner' ? '/(parent)/decide' : '/(child)/capture'} />;
}
