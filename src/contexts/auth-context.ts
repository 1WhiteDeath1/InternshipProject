import { createContext } from 'react';

export interface User {
  id: number;
  username: string;
  full_name: string;
  email: string;
  role_id: number;
  is_supervisor: boolean;
  role_name: string;
  preferences: string | null;
}

export interface AuthContextType {
  user: User | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loading: boolean;
}

export const AuthContext = createContext<AuthContextType | null>(null);
