import type { ReactElement, ReactNode, Dispatch, SetStateAction } from "react";
import { createContext, use, useEffect, useState } from "react";

import { store } from "../store";
import { fetchAuthStatus } from "../api/auth";

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
  return use(AuthContext);
}

function useAuthContextManager(): IAuthContext {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(userUninitialized);

  async function checkAuthStatus(): Promise<void> {
    // TODO: If app is PWA with extensive offine capabilities, then
    //       check if user is online or not before automatically removing
    //       user data from localStorage, in case we want to enable
    //       offline mode that saves data when user reconnects online
    //       (i.e. to the network/internet)
    const authStatus = await fetchAuthStatus();
    const userFromStore = store.get("user") as IUser | null;
    if (!authStatus.is_authenticated) {
      if (userFromStore !== null) store.remove("user");
      setIsInitialized(true);
      return;
    }
    if (userFromStore !== null) {
      console.log("auth as:", userFromStore);
      setIsInitialized(true);
      setIsAuthenticated(true);
      // TODO: get user id and user name from `fetchAuthStatus` request/response
      setUser({ id: userFromStore.id, username: userFromStore.username });
    } else {
      setIsInitialized(true);
    }
  }

  useEffect(() => {
    checkAuthStatus();
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
  return <AuthContext value={value}>{children}</AuthContext>;
}
