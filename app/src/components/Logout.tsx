import type { ReactElement } from "react";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { store } from "store";
import { logout } from "api/auth";

import { useAuthContext, userUninitialized } from "contexts/auth";

export default function Logout(): ReactElement {
  const navigate = useNavigate();
  const auth = useAuthContext();

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      try {
        await logout();
        store.remove("user");
        auth.setIsAuthenticated(false);
        auth.setUser(userUninitialized);
        navigate("/");
      } catch {
        console.error("Failed to logout on server.");
      }
    },
    [navigate, auth]
  );
  return (
    <form
      className="space-y-6"
      style={{ display: "inline-block" }}
      onSubmit={handleSubmit}
      method="POST"
    >
      <button type="submit">Logout</button>
    </form>
  );
}
