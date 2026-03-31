import { createContext, useContext } from 'react';

export interface SmartGateContextValue {
  /** Gate Sui object ID (from useSmartObject or URL param) */
  gateId: string;
  /** NetworkNode Sui object ID (assembly.energySourceId) */
  nodeId: string;
  /** Gate name */
  gateName: string;
  /** Assembly state */
  gateState: string;
  /** OwnerCap<Gate> object ID owned by the connected wallet */
  gateCapId: string;
  /** Linked (destination) gate Sui object ID */
  linkedGateId: string;
  /** Whether smart object data is still loading */
  loading: boolean;
  /** Error message if loading failed */
  error: string | null;
}

export const SmartGateContext = createContext<SmartGateContextValue>({
  gateId: '',
  nodeId: '',
  gateName: '',
  gateState: '',
  gateCapId: '',
  linkedGateId: '',
  loading: true,
  error: null,
});

export function useSmartGate(): SmartGateContextValue {
  return useContext(SmartGateContext);
}
