import { Redirect } from 'expo-router';

import { useStore } from '@/lib/store';

export default function Entry() {
  const onboarded = useStore((s) => s.onboarded);
  const role = useStore((s) => s.role);
  const lockedOut = useStore((s) => s.lockedOut);

  if (!onboarded) return <Redirect href="/onboarding" />;
  // Logged out → the household stays on-device but locked behind sign-in.
  if (lockedOut) return <Redirect href="/login" />;
  return <Redirect href={role === 'owner' ? '/(parent)/decide' : '/(child)/capture'} />;
}
