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

interface IAuthContext {
  isInitialized: boolean;
  isAuthenticated: boolean;
  username: string;
  setIsAuthenticated: Dispatch<SetStateAction<boolean>>;
  setUsername: Dispatch<SetStateAction<string>>;
}

const AuthContext = createContext({
  isInitialized: false,
  isAuthenticated: false,
  username: "",
  setIsAuthenticated: () => {},
  setUsername: () => {},
} as IAuthContext);

export function useAuthContext(): IAuthContext {
  return useContext(AuthContext);
}

function useAuthContextManager(): IAuthContext {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState("");

  useEffect(() => {
    const usernameFromStore = store.get("username") as string;
    if (usernameFromStore) {
      console.log("auth as:", usernameFromStore);
      setIsInitialized(true);
      setIsAuthenticated(true);
      setUsername(usernameFromStore);
    } else {
      setIsInitialized(true);
    }
  }, []);

  return {
    isInitialized,
    isAuthenticated,
    username,
    setIsAuthenticated,
    setUsername,
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
