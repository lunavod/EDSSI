import { createContext, useContext } from 'react';

/**
 * Whether what is being drawn is a VR panel rather than the window on the desk.
 *
 * A headset has no pointer, so anything that only works by being clicked is dead weight there:
 * left out, not shown greyed. Most modules are handed a prop for it (`vr` on `CommsView`,
 * `periods` on the session strip), but a control drawn deep inside several modules, like the copy
 * button beside a system name, asks this instead of having the flag passed down through each one.
 */
export const InVr = createContext(false);

export function useInVr(): boolean {
  return useContext(InVr);
}
