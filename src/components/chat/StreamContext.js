import { createContext, useContext } from 'react';
export const StreamContext = createContext(null);
export function useStreamSession() { return useContext(StreamContext); }
