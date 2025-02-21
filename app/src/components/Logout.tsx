import type { ReactElement, FormEvent } from "react";
import { useNavigate } from "react-router";

import { store } from "../store";
import { logout } from "../api/auth";

import { useAuthContext, userUninitialized } from "../contexts/auth";

export default function Logout(): ReactElement {
  const navigate = useNavigate();
  const auth = useAuthContext();

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ): Promise<void> {
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
  }

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
