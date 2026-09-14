import { Redirect } from 'expo-router';

import { Welcome } from '@/components/welcome';
import { useCanDecide, useMembershipReady } from '@/lib/membership';
import { useStore } from '@/lib/store';

export default function Entry() {
  const onboarded = useStore((s) => s.onboarded);
  const lockedOut = useStore((s) => s.lockedOut);
  // Which tabs to land in comes from the database membership, not a role the
  // device remembered. Until it's known, render nothing rather than briefly
  // routing a decider into the helper view (or the reverse).
  const ready = useMembershipReady();
  const canDecide = useCanDecide();

  // First-time visitor: the front door — try the demo, start a home, or sign in.
  if (!onboarded) return <Welcome />;
  // Logged out → the household stays on-device but locked behind sign-in.
  if (lockedOut) return <Redirect href="/login" />;
  if (!ready) return null;
  return <Redirect href={canDecide ? '/decide' : '/capture'} />;
}
