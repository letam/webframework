import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactElement,
  ReactNode,
  Dispatch,
  SetStateAction,
} from "react";

import { store } from "store";

interface IUser {
  id: number;
  username: string;
}

interface IAuthContext {
  isInitialized: boolean;
  isAuthenticated: boolean;
  user: IUser;
  setIsAuthenticated: Dispatch<SetStateAction<boolean>>;
  setUser: Dispatch<SetStateAction<IUser>>;
}

export const userUninitialized = { id: 0, username: "" };

const AuthContext = createContext({
  isInitialized: false,
  isAuthenticated: false,
  user: userUninitialized,
  setIsAuthenticated: () => {},
  setUser: () => {},
} as IAuthContext);

export function useAuthContext(): IAuthContext {
  return useContext(AuthContext);
}

function useAuthContextManager(): IAuthContext {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(userUninitialized);

  useEffect(() => {
    const userFromStore = store.get("user") as IUser;
    if (userFromStore) {
      console.log("auth as:", userFromStore);
      setIsInitialized(true);
      setIsAuthenticated(true);
      setUser({ id: userFromStore.id, username: userFromStore.username });
    } else {
      setIsInitialized(true);
    }
  }, []);

  return {
    isInitialized,
    isAuthenticated,
    user,
    setIsAuthenticated,
    setUser,
  };
}

export function AuthContextProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const value = useAuthContextManager();
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
